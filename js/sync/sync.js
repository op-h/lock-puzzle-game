// Account + cloud-save orchestration (ADR 0002). Offline-first: every mutation is written to local
// storage and flagged dirty *before* any network call, then replicated by a debounced
// pull -> merge -> conditional-write cycle. Because saves merge as set unions, the cycle is safe to
// retry, safe to interleave across devices, and cannot lose or double-count a solve.
//
// All collaborators are injected so the module runs unchanged in Node tests against a fake backend.

import { validateName, parseCode, generateCode, generateBoardKey, playerId, boardId } from './identity.js';
import { mergeSaves, emptySave, derive, parseSave, sanitizeSave, sanitizeHistoryEntry, sanitizeRunEntry, saveVersionOf, SAVE_VERSION, LANGS } from './merge.js';

/**
 * @typedef {'synced'|'saving'|'offline'|'local'} Status
 * @typedef {import('./merge.js').Save} Save
 * @typedef {import('./merge.js').Derived} Derived
 *
 * @typedef {Object} SyncDeps
 */

/** Attempts to find a code whose id is unused. 10^6 codes per name make a second attempt vanishingly rare. */
const SIGNUP_ATTEMPTS = 5;
const BOARD_NAME_POINTS = 24;

export function createSync(deps) {
  const { remote, local } = deps;
  const clock = deps.clock || (() => Date.now());
  const events = deps.events || null;
  const timers = deps.timers || {
    setTimeout: (/** @type {Function} */ f, /** @type {number} */ ms) => globalThis.setTimeout(f, ms),
    clearTimeout: (/** @type {any} */ h) => globalThis.clearTimeout(h),
  };
  const isHidden = deps.isHidden || (() => !!(globalThis.document && globalThis.document.hidden));
  const debounceMs = deps.debounceMs ?? 1500;
  const backoffBaseMs = deps.backoffBaseMs ?? 2000;
  const backoffMaxMs = deps.backoffMaxMs ?? 60000;
  const conflictRetries = deps.conflictRetries ?? 3;
  const minPullIntervalMs = deps.minPullIntervalMs ?? 10000;

  let session = null;
  let save = null;
  let dirty = false;
  /** Bumped on every user mutation; a push clears `dirty` only if nothing changed while it was in flight. */
  let mutation = 0;
  /** Bumped whenever `save` is replaced for any reason; keys the derived-totals cache. */
  let version = 0;
  let derivedCache = null;
  /** True until the cloud has confirmed this account; an offline sign-up shows 'local' rather than 'offline'. */
  let cloudUnconfirmed = false;
  let status = 'local';
  let failures = 0;
  let lastPullAt = 0;
  let pushTimer = null;
  let retryTimer = null;
  let chain = Promise.resolve();
  let bid = null;
  /** The board key `bid` was derived from, so a changed key (merge picked the smaller one) re-derives it. */
  let bidFor = null;
  /**
   * True from sign-up until the player acknowledges the code. Nothing is written to storage meanwhile: a
   * reload with the dialog open must land on the sign-in screen, not in an account whose code was never saved.
   * (The remote document is still created; an unacknowledged orphan is harmless, nobody can find its id.)
   */
  let pendingAck = false;
  /** Set when the cloud holds a save from a NEWER app: we never overwrite it, we stay local. */
  let newer = false;
  let issue = null;
  const issueListeners = new Set();
  let detach = [];
  const statusListeners = new Set();
  const saveListeners = new Set();

  // ---- small helpers -----------------------------------------------------------------------

  function setStatus(s) {
    if (s === status) return;
    status = s;
    for (const fn of [...statusListeners]) {
      try {
        fn(s);
      } catch {
        // a throwing subscriber must not break syncing for the others
      }
    }
  }

  function notifySave() {
    for (const fn of [...saveListeners]) {
      try {
        fn();
      } catch {
        // see setStatus
      }
    }
  }

  function setIssue(kind) {
    if (kind === issue) return;
    issue = kind;
    for (const fn of [...issueListeners]) {
      try {
        fn(kind);
      } catch {
        // see setStatus
      }
    }
  }

  /**
   * Write to the device through the adapter's read-merge-write. A failed or memory-only write is never silent:
   * it raises the 'storage' issue and the status drops to 'local'. Returns the save as it now is on disk, which
   * may include solves another tab appended.
   */
  function persistSave(next) {
    if (!session || pendingAck) return next;
    const r = local.storeSave(session.id, next);
    if (!r.ok) {
      if (r.reason !== 'closed') {
        setIssue('storage');
        setStatus('local');
      }
      return next;
    }
    if (!r.persisted) {
      setIssue('storage');
      setStatus('local');
    } else if (issue === 'storage') setIssue(null);
    return r.merged || next;
  }

  function adopt(next) {
    if (JSON.stringify(next) === JSON.stringify(save)) return;
    save = persistSave(next);
    version++;
    notifySave();
  }

  /** Every account needs a board key before its first push; created here for saves that predate the field. */
  const withBk = (/** @type {Save} */ s) => (s.bk ? s : mergeSaves(s, { ...s, bk: generateBoardKey(deps.bkFill) }).save);

  /** Canonical text; equal content always serialises equally (merge.js builds every save the same way). */
  const text = (/** @type {Save} */ s) => JSON.stringify(s);

  function remoteSave(r) {
    const p = parseSave(r.data.save);
    return p.ok ? p.save : sanitizeSave(null).save;
  }

  function clearTimers() {
    if (pushTimer !== null) timers.clearTimeout(pushTimer);
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    pushTimer = null;
    retryTimer = null;
  }

  function schedulePush() {
    if (!session) return;
    if (pushTimer !== null) timers.clearTimeout(pushTimer);
    pushTimer = timers.setTimeout(() => {
      pushTimer = null;
      void flush();
    }, debounceMs);
  }

  function idleFailureStatus() {
    if (remote.enabled === false) return 'local';
    return cloudUnconfirmed ? 'local' : 'offline';
  }

  function onFailure(reason) {
    failures++;
    if (reason === 'newer') {
      setIssue('newer');
      setStatus('local');
      return;
    }
    if (reason === 'denied' || reason === 'toolarge' || remote.enabled === false) {
      // Retrying cannot help (rules not published, key restricted, document too big); data stays on the
      // device and the next explicit event (online/visibility/new play) tries once more.
      setStatus('local');
      return;
    }
    setStatus(idleFailureStatus());
    if (dirty && retryTimer === null) {
      // Exponential backoff so a dead network does not drain the battery or hammer a rate-limited API.
      const delay = Math.min(backoffMaxMs, backoffBaseMs * 2 ** Math.min(failures - 1, 16));
      retryTimer = timers.setTimeout(() => {
        retryTimer = null;
        void flush();
      }, delay);
    }
  }

  function onSuccess() {
    failures = 0;
    cloudUnconfirmed = false;
  }

  function markDirty() {
    dirty = true;
    if (session && !pendingAck) local.setDirty(session.id, true);
  }

  const isNewer = (r) => {
    const v = saveVersionOf(r.data.save);
    return v !== null && v !== SAVE_VERSION;
  };

  // ---- replication -------------------------------------------------------------------------

  /** Best-effort public leaderboard row; its failure never affects the save's sync result. */
  async function publishBoard() {
    try {
      if (!session || !save || !save.bk) return;
      const d = derive(save);
      if (d.total === 0 && d.bestRun === 0) return; // a score-less account does not belong on the board
      if (bid === null || bidFor !== save.bk) {
        bid = await boardId(save.bk);
        bidFor = save.bk;
      }
      // By code points, not UTF-16 units: an emoji must not be cut in half (the rule allows 96 for 24 x 4 bytes).
      const name = Array.from(save.name).slice(0, BOARD_NAME_POINTS).join('');
      if (name === '') return;
      await remote.putBoard(bid, {
        name,
        total: d.total,
        blood: d.blood,
        solved: d.solved,
        bestRun: d.bestRun,
        updatedAt: save.updatedAt,
      });
    } catch {
      // leaderboard is decoration
    }
  }

  async function pushOnce() {
    if (!session || !save) return { ok: false, reason: 'nosession' };
    if (newer) return { ok: false, reason: 'newer' };
    const { id } = session;
    const startedMutation = mutation;
    let last = { ok: false, reason: 'error' };
    for (let attempt = 0; attempt <= conflictRetries; attempt++) {
      const g = await remote.getPlayer(id);
      if (!session || session.id !== id || !save) return { ok: false, reason: 'nosession' };
      let merged;
      let w;
      if (g.ok) {
        // A save written by a newer app is not ours to rewrite: sanitising it would drop what we cannot read.
        if (isNewer(g)) {
          newer = true;
          return { ok: false, reason: 'newer' };
        }
        const theirs = remoteSave(g);
        merged = withBk(mergeSaves(save, theirs).save);
        // Nothing new for the cloud (a previous attempt, or another device, already wrote it all): skip the write.
        w = text(merged) === text(theirs) ? { ok: true } : await remote.updatePlayer(id, text(merged), g.data.updateTime);
      } else if (g.reason === 'notfound') {
        merged = withBk(save);
        w = await remote.createPlayer(id, text(merged));
      } else {
        last = g;
        break;
      }
      if (w.ok) {
        onSuccess();
        adopt(mergeSaves(save, merged).save);
        // Only now is it safe to clear: if the player played during the round trip, those events are not in the cloud yet.
        if (mutation === startedMutation) {
          dirty = false;
          local.setDirty(id, false);
        }
        return { ok: true };
      }
      last = w;
      if (w.reason !== 'conflict') break;
      // conflict: another writer got in between our read and write. Loop = re-read, re-merge, retry.
    }
    return { ok: false, reason: last.reason || 'error' };
  }

  async function doPush() {
    try {
      if (!session || !dirty) return { ok: true };
      setStatus('saving');
      const r = await pushOnce();
      if (!session) return r;
      if (r.ok) {
        await publishBoard();
        if (dirty) {
          schedulePush(); // mutations arrived mid-flight
        } else {
          setStatus('synced');
        }
      } else if (r.reason !== 'nosession') {
        onFailure(r.reason);
      }
      return r;
    } catch {
      // pushOnce/remote never throw; this is the belt for the braces so a bug cannot become an unhandled rejection
      return { ok: false, reason: 'error' };
    }
  }

  /**
   * Push now (cancelling the debounce) and resolve with the outcome. Calls are serialised so two
   * pushes never race each other into needless conflicts.
   */
  function flush() {
    clearTimers();
    const p = chain.then(doPush);
    chain = p.then(() => undefined, () => undefined);
    return /** @type {Promise<any>} */ (p);
  }

  /** Fetch and merge the cloud copy; if we hold something the cloud lacks, schedule a push. */
  async function pull() {
    try {
      if (!session || !save) return { ok: false, reason: 'nosession' };
      const { id } = session;
      lastPullAt = clock();
      const g = await remote.getPlayer(id);
      if (!session || session.id !== id || !save) return { ok: false, reason: 'nosession' };
      if (!g.ok) {
        if (g.reason === 'notfound') {
          // Cloud has no document yet (offline sign-up, or the first request never landed): push creates it.
          markDirty();
          void flush();
        } else {
          onFailure(g.reason);
        }
        return g;
      }
      if (isNewer(g)) {
        newer = true;
        onFailure('newer');
        return { ok: false, reason: 'newer' };
      }
      onSuccess();
      const theirs = remoteSave(g);
      const merged = withBk(mergeSaves(save, theirs).save);
      adopt(merged);
      if (text(merged) !== text(theirs)) {
        markDirty();
        void flush();
      } else if (!dirty) {
        setStatus('synced');
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'error' };
    }
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  function start() {
    if (!events || detach.length) return;
    const onOnline = () => {
      failures = 0;
      if (!session) return;
      void (dirty ? flush() : pull());
    };
    const onVisibility = () => {
      if (!session) return;
      if (dirty) void flush(); // push as the tab hides: it may be the last chance
      else if (!isHidden() && clock() - lastPullAt >= minPullIntervalMs) void pull();
    };
    events.addEventListener('online', onOnline);
    events.addEventListener('visibilitychange', onVisibility);
    detach = [
      () => events.removeEventListener('online', onOnline),
      () => events.removeEventListener('visibilitychange', onVisibility),
    ];
  }

  function dispose() {
    clearTimers();
    for (const d of detach) d();
    detach = [];
  }

  function open(s, initial, isDirty, persist = true) {
    session = s;
    save = initial;
    version++;
    bid = null;
    bidFor = null;
    newer = false;
    pendingAck = !persist;
    setIssue(null);
    failures = 0;
    // Opening a session is itself a sync point; without this the first tab-focus would pull again at once.
    lastPullAt = clock();
    dirty = isDirty;
    if (persist) {
      local.setSession(s);
      save = persistSave(initial);
      local.setDirty(s.id, isDirty);
    }
    start();
    notifySave();
  }

  // ---- public API --------------------------------------------------------------------------

  /**
   * Create an account. The returned `code` is shown once and never stored anywhere.
   */
  async function signUp(rawName) {
    if (session) return { ok: false, reason: 'already_signed_in' };
    const v = validateName(rawName);
    if (!v.ok) return { ok: false, reason: 'invalid_name', detail: v.reason };
    try {
      for (let attempt = 0; attempt < SIGNUP_ATTEMPTS; attempt++) {
        const code = generateCode(deps.rng);
        const id = await playerId(v.name, code);
        const now = clock();
        const fresh = emptySave(v.name, now);
        fresh.bk = generateBoardKey(deps.bkFill);
        const lang = local.getLang();
        if (lang) fresh.settings = { lang, sound: true, at: now };

        const g = await remote.getPlayer(id);
        if (g.ok) continue; // id taken: re-roll the code (names need not be unique, (name, code) must be)
        if (g.reason === 'notfound') {
          const c = await remote.createPlayer(id, text(fresh));
          if (c.ok) {
            cloudUnconfirmed = false;
            open({ name: v.name, id }, fresh, false, false);
            setStatus('synced');
            return { ok: true, code, id, name: v.name, status: /** @type {Status} */ (status) };
          }
          if (c.reason === 'conflict') continue; // someone claimed it between our get and create
          return localOnlySignUp(v.name, code, id, fresh, c.reason);
        }
        return localOnlySignUp(v.name, code, id, fresh, g.reason);
      }
      return { ok: false, reason: 'error' };
    } catch {
      return { ok: false, reason: 'unsupported' }; // no crypto.subtle (insecure context) or RNG failure
    }
  }

  /**
   * Cloud unreachable or refusing: the account still works on this device and is created remotely on
   * the first successful push. (We could not check for an id collision; at 10^-6 per same-name player
   * the merge on that first push is an acceptable, self-healing risk.)
   */
  function localOnlySignUp(name, code, id, fresh, cause) {
    cloudUnconfirmed = true;
    open({ name, id }, fresh, true, false);
    setStatus('local');
    if (cause !== 'denied' && cause !== 'toolarge') {
      failures = 1;
      schedulePush();
    }
    return { ok: true, code, id, name, status: /** @type {Status} */ (status), local: true, cause };
  }

  async function signIn(rawName, rawCode) {
    if (session) return { ok: false, reason: 'already_signed_in' };
    const v = validateName(rawName);
    if (!v.ok) return { ok: false, reason: 'invalid_name', detail: v.reason };
    const code = parseCode(rawCode);
    if (code === null) return { ok: false, reason: 'invalid_code' };
    try {
      const id = await playerId(v.name, code);
      const g = await remote.getPlayer(id);
      if (!g.ok) {
        // "Missing document" covers both "no such name" and "wrong code"; one generic reason keeps the
        // UI from becoming an oracle for which names exist.
        return { ok: false, reason: g.reason === 'notfound' ? 'invalid' : g.reason };
      }
      // Signing in would merge and later rewrite a save this app version cannot fully read.
      if (isNewer(g)) return { ok: false, reason: 'newer' };
      const theirs = remoteSave(g);
      const cached = local.loadSave(id);
      const merged = mergeSaves(cached, theirs).save;
      if (merged.name === '') merged.name = v.name;
      cloudUnconfirmed = false;
      const needsPush = text(merged) !== text(theirs);
      open({ name: merged.name || v.name, id }, merged, needsPush);
      if (needsPush) void flush();
      else setStatus('synced');
      return { ok: true, id, name: merged.name || v.name };
    } catch {
      return { ok: false, reason: 'unsupported' };
    }
  }

  /**
   * Log out. Refuses (pending:true) when unsynced changes cannot be flushed, so a flaky connection
   * never silently destroys progress; the UI confirms and calls again with {force:true}.
   */
  async function signOut(o = {}) {
    if (!session) return { ok: true };
    let r = await flush();
    if (dirty && r.ok) r = await flush(); // play landed during the first flush
    if (dirty && !o.force) {
      return { ok: false, pending: true, reason: r.ok ? 'error' : r.reason };
    }
    clearTimers();
    local.clearAccount();
    session = null;
    save = null;
    dirty = false;
    bid = null;
    bidFor = null;
    pendingAck = false;
    newer = false;
    setIssue(null);
    version++;
    mutation++;
    cloudUnconfirmed = false;
    failures = 0;
    setStatus('local');
    notifySave();
    return { ok: true };
  }

  /**
   * The player acknowledged the sign-up code: only now does the account exist on this device.
   */
  function acknowledge() {
    if (!session || !save || !pendingAck) return { ok: false };
    pendingAck = false;
    local.setSession(session);
    save = persistSave(save);
    if (dirty) local.setDirty(session.id, true);
    return { ok: true };
  }

  /**
   * Another tab logged out: drop this tab's account state WITHOUT touching storage (it is already wiped) and
   * refuse any later write for the id, so a pending timer cannot resurrect the save.
   */
  function localSignOut() {
    if (!session) return;
    local.markClosed(session.id);
    clearTimers();
    session = null;
    save = null;
    dirty = false;
    bid = null;
    bidFor = null;
    pendingAck = false;
    newer = false;
    setIssue(null);
    version++;
    mutation++;
    cloudUnconfirmed = false;
    failures = 0;
    setStatus('local');
    notifySave();
  }

  /**
   * Another tab changed this account's stored save: fold it into memory and refresh the UI.
   */
  function mergeFromStorage() {
    if (!session || !save || pendingAck) return false;
    const stored = local.loadSave(session.id);
    if (!stored) return false;
    const merged = mergeSaves(save, stored).save;
    if (text(merged) === text(save)) return false;
    save = merged;
    version++;
    if (local.isDirty(session.id)) dirty = true;
    if (text(merged) !== text(stored)) save = persistSave(merged);
    notifySave();
    return true;
  }

  /**
   * Append a record to a log and replicate it.
   */
  function commit(patch) {
    if (!session || !save) return false;
    const base = save;
    const next = mergeSaves(base, { ...base, ...patch, updatedAt: Math.max(clock(), base.updatedAt) }).save;
    save = persistSave(next);
    version++;
    mutation++;
    markDirty();
    // A device that cannot store keeps saying so ('local') until a successful sync proves the cloud has the data.
    if (issue !== 'storage') setStatus('saving');
    schedulePush();
    notifySave();
    return true;
  }

  function recordSolve(raw) {
    if (!session || !save) return { ok: false, reason: 'nosession' };
    const entry = sanitizeHistoryEntry(raw && typeof raw === 'object' && /** @type {any} */ (raw).t === undefined ? { ...raw, t: clock() } : raw);
    if (!entry) return { ok: false, reason: 'invalid' };
    if (save.history.some((e) => e.id === entry.id)) return { ok: true, duplicate: true };
    commit({ history: [entry] });
    return { ok: true, duplicate: false, entry };
  }

  function recordRun(raw) {
    if (!session || !save) return { ok: false, reason: 'nosession' };
    const entry = sanitizeRunEntry(raw && typeof raw === 'object' && /** @type {any} */ (raw).t === undefined ? { ...raw, t: clock() } : raw);
    if (!entry) return { ok: false, reason: 'invalid' };
    if (save.runs.some((e) => e.id === entry.id)) return { ok: true, duplicate: true };
    commit({ runs: [entry] });
    return { ok: true, duplicate: false, entry };
  }

  function updateSettings(patch) {
    if (!session || !save) return { ok: false, reason: 'nosession' };
    const cur = save.settings;
    const lang = patch && patch.lang !== undefined ? patch.lang : cur.lang;
    const sound = patch && patch.sound !== undefined ? patch.sound : cur.sound;
    if (!LANGS.includes(lang) || typeof sound !== 'boolean') return { ok: false, reason: 'invalid' };
    // +1 guarantees this edit beats our own previous one even if the clock stepped backwards.
    const settings = { lang, sound, at: Math.max(clock(), cur.at + 1) };
    commit({ settings });
    local.setLang(lang);
    return { ok: true, settings };
  }

  /**
   * Existing session at startup: show the cached save immediately, reconcile in the background.
   * The network is not touched before this call (nor if there is no session).
   */
  async function resume() {
    const s = local.getSession();
    if (!s) return { ok: true, session: null, save: null, pulled: Promise.resolve({ ok: true }) };
    const cached = local.loadSave(s.id);
    open(s, cached || emptySave(s.name, clock()), local.isDirty(s.id));
    setStatus('saving');
    const pulled = dirty ? flush() : pull();
    return { ok: true, session: { ...s }, save: getSave(), pulled };
  }

  function getSave() {
    return save ? structuredClone(save) : null;
  }

  function getDerived() {
    if (!derivedCache || derivedCache.version !== version) derivedCache = { version, value: derive(save) };
    return derivedCache.value;
  }

  /** Status stream. Calls `fn` immediately with the current status. @param {(s: Status) => void} fn */
  function subscribe(fn) {
    statusListeners.add(fn);
    try {
      fn(status);
    } catch {
      // see setStatus
    }
    return () => void statusListeners.delete(fn);
  }

  /** Fires after the save changes for any reason (play, pull, sign-in/out). @param {() => void} fn */
  function subscribeSave(fn) {
    saveListeners.add(fn);
    return () => void saveListeners.delete(fn);
  }

  return {
    signUp,
    signIn,
    signOut,
    resume,
    recordSolve,
    recordRun,
    updateSettings,
    flush,
    pull,
    acknowledge,
    localSignOut,
    mergeFromStorage,
    getSave,
    getDerived,
    getSession: () => (session ? { ...session } : null),
    getStatus: () => status,
    hasPending: () => dirty,
    /** True between sign-up and the player acknowledging the code (nothing is on disk yet). */
    isPending: () => pendingAck,
    /** Resolves when queued pushes settle (tests and signOut). */
    idle: () => chain,
    subscribe,
    subscribeSave,
    /** Fires with 'newer' | 'storage' when something needs a visible notice, null when it clears. */
    subscribeIssue(fn) {
      issueListeners.add(fn);
      return () => void issueListeners.delete(fn);
    },
    getIssue: () => issue,
    dispose,
  };
}
