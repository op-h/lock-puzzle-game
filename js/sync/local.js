// Local persistence: the working copy of the save (ADR 0002 is offline-first; the cloud only replicates).
//
// Every read is corruption-safe and every write is quota-safe, because storage is the one browser API
// that routinely throws (private mode, disabled cookies, full disk) and a throw here would lose a solve.
// On any failure we fall back to memory for the page's lifetime and say so via `persistent`.

import { mergeSaves, parseSave } from './merge.js';

export const PREFIX = 'lp1.';
export const KEY_SESSION = PREFIX + 'session';
export const KEY_LANG = PREFIX + 'lang';
const SAVE_PREFIX = PREFIX + 'save.';
const DIRTY_PREFIX = PREFIX + 'dirty.';
const RUN_PREFIX = PREFIX + 'run.';
export const KEY_PREF = PREFIX + 'pref';

/** In-progress round records are tiny; anything bigger is corruption, not progress. */
const MAX_RUN_CHARS = 20000;

/** Refuse to parse or write blobs beyond this; the Firestore rule caps the document at 900 000. */
export const MAX_SAVE_CHARS = 1000000;

const ID_RE = /^[0-9a-f]{64}$/;

/**
 * @typedef {Object} StorageLike
 */

export function createMemoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? /** @type {string} */ (m.get(k)) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

function detectStorage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    // Safari private mode used to expose a localStorage that throws on the first write.
    const probe = PREFIX + '__probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function createLocal(opts = {}) {
  const backing = opts.storage === undefined ? detectStorage() : opts.storage;
  const mem = createMemoryStorage();
  let persistent = backing !== null && backing !== undefined;
  /**
   * Ids whose account was logged out in this tab (or in another tab, see markClosed). Nothing may write their
   * keys again until setSession reopens them: a late push or timer must not resurrect a logged-out save.
   * @type {Set<string>}
   */
  const closed = new Set();

  function readRaw(key) {
    // Memory overlay first: it only holds keys whose last persistent write failed, so it is newer.
    const inMem = mem.getItem(key);
    if (inMem !== null) return inMem;
    if (!backing) return null;
    try {
      return backing.getItem(key);
    } catch {
      persistent = false;
      return null;
    }
  }

  function writeRaw(key, value) {
    if (backing) {
      try {
        backing.setItem(key, value);
        mem.removeItem(key);
        return true;
      } catch {
        persistent = false;
      }
    }
    mem.setItem(key, value);
    return false;
  }

  function removeRaw(key) {
    mem.removeItem(key);
    if (!backing) return;
    try {
      backing.removeItem(key);
    } catch {
      persistent = false;
    }
  }

  function keysWithPrefix(prefix) {
    const out = new Set();
    const scan = (/** @type {StorageLike} */ s) => {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k && k.startsWith(prefix)) out.add(k);
      }
    };
    scan(mem);
    if (backing) {
      try {
        scan(backing);
      } catch {
        persistent = false;
      }
    }
    return [...out];
  }

  return {
    /** False once any read/write fell back to memory: progress then lives only until the tab closes. */
    get persistent() {
      return persistent;
    },

    getSession() {
      const raw = readRaw(KEY_SESSION);
      if (raw === null || raw.length > 1000) return null;
      try {
        const s = JSON.parse(raw);
        if (s && typeof s.name === 'string' && typeof s.id === 'string' && ID_RE.test(s.id)) {
          return { name: s.name, id: s.id };
        }
      } catch {
        // corrupt session is the same as no session: the player simply signs in again
      }
      return null;
    },
    setSession(s) {
      closed.delete(s.id);
      writeRaw(KEY_SESSION, JSON.stringify({ name: s.name, id: s.id }));
    },
    /**
     * Another tab logged this account out: refuse every further write for it from this tab, and remove whatever this
     * tab managed to write in the window before the storage event arrived (unless the account is signed in again).
     * @param {string} id
     */
    markClosed(id) {
      closed.add(id);
      const s = this.getSession();
      if (s && s.id === id) return;
      for (const prefix of [SAVE_PREFIX, DIRTY_PREFIX, RUN_PREFIX]) removeRaw(prefix + id);
    },

    loadSave(id) {
      if (!ID_RE.test(id)) return null;
      const raw = readRaw(SAVE_PREFIX + id);
      if (raw === null || raw.length > MAX_SAVE_CHARS) return null;
      const r = parseSave(raw);
      return r.ok ? r.save : null;
    },
    /**
     * Read-merge-write: another tab may have appended solves since this tab last looked, so the stored blob is
     * merged in (a set union, idempotent) instead of being overwritten. `merged` is what is now on disk.
     */
    storeSave(id, save) {
      if (!ID_RE.test(id)) return { ok: false, reason: 'invalid' };
      if (closed.has(id)) return { ok: false, reason: 'closed' };
      let merged = save;
      const stored = readRaw(SAVE_PREFIX + id);
      if (stored !== null && stored.length <= MAX_SAVE_CHARS) {
        const p = parseSave(stored);
        if (p.ok) merged = mergeSaves(p.save, save).save;
      }
      let text;
      try {
        text = JSON.stringify(merged);
      } catch {
        return { ok: false, reason: 'invalid' };
      }
      if (typeof text !== 'string') return { ok: false, reason: 'invalid' };
      if (text.length > MAX_SAVE_CHARS) return { ok: false, reason: 'toolarge' };
      return { ok: true, persisted: writeRaw(SAVE_PREFIX + id, text), merged };
    },

    isDirty(id) {
      return ID_RE.test(id) && readRaw(DIRTY_PREFIX + id) === '1';
    },
    setDirty(id, flag) {
      if (!ID_RE.test(id) || closed.has(id)) return;
      if (flag) writeRaw(DIRTY_PREFIX + id, '1');
      else removeRaw(DIRTY_PREFIX + id);
    },

    /**
     * In-progress round (Classic puzzle or Blood run), keyed by player id. Returned as untrusted parsed
     * JSON: progress.js validates it. Device-local only; it never goes to the cloud.
     */
    loadRun(id) {
      if (!ID_RE.test(id)) return null;
      const raw = readRaw(RUN_PREFIX + id);
      if (raw === null || raw.length > MAX_RUN_CHARS) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    storeRun(id, rec) {
      if (!ID_RE.test(id) || closed.has(id)) return false;
      try {
        const text = JSON.stringify(rec);
        if (typeof text !== 'string' || text.length > MAX_RUN_CHARS) return false;
        return writeRaw(RUN_PREFIX + id, text);
      } catch {
        return false;
      }
    },
    clearRun(id) {
      if (ID_RE.test(id)) removeRaw(RUN_PREFIX + id);
    },

    /** Non-account UI preferences (difficulty, pre-login sound). Survives logout like the language. @returns {Record<string, unknown>} */
    loadPref() {
      const raw = readRaw(KEY_PREF);
      if (raw === null || raw.length > 2000) return {};
      try {
        const v = JSON.parse(raw);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      } catch {
        return {};
      }
    },
    storePref(pref) {
      try {
        writeRaw(KEY_PREF, JSON.stringify(pref));
      } catch {
        // preferences are a convenience
      }
    },

    getLang() {
      const v = readRaw(KEY_LANG);
      return v === 'en' || v === 'ar' ? v : null;
    },
    setLang(lang) {
      if (lang === 'en' || lang === 'ar') writeRaw(KEY_LANG, lang);
    },

    /**
     * Logout: remove the session and every cached save and dirty flag. The language preference is
     * not account data and survives, so the sign-in screen keeps the player's language.
     */
    clearAccount() {
      const sess = this.getSession();
      if (sess) closed.add(sess.id);
      for (const prefix of [SAVE_PREFIX, DIRTY_PREFIX, RUN_PREFIX]) {
        for (const k of keysWithPrefix(prefix)) closed.add(k.slice(prefix.length));
      }
      removeRaw(KEY_SESSION);
      for (const k of keysWithPrefix(SAVE_PREFIX)) removeRaw(k);
      for (const k of keysWithPrefix(DIRTY_PREFIX)) removeRaw(k);
      for (const k of keysWithPrefix(RUN_PREFIX)) removeRaw(k);
    },
  };
}
