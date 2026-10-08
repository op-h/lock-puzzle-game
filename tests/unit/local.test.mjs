import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocal, createMemoryStorage, MAX_SAVE_CHARS, KEY_SESSION } from '../../js/sync/local.js';
import { emptySave } from '../../js/sync/merge.js';

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);

/** Storage whose operations can be switched to throw, like private mode or a full disk. */
function flaky() {
  const inner = createMemoryStorage();
  const f = { failRead: false, failWrite: false, failRemove: false };
  return {
    f,
    inner,
    getItem(k) {
      if (f.failRead) throw new Error('SecurityError');
      return inner.getItem(k);
    },
    setItem(k, v) {
      if (f.failWrite) throw new DOMException('full', 'QuotaExceededError');
      inner.setItem(k, v);
    },
    removeItem(k) {
      if (f.failRemove) throw new Error('nope');
      inner.removeItem(k);
    },
    key: (i) => inner.key(i),
    get length() {
      return inner.length;
    },
  };
}

test('round-trips session, save, dirty flag, language under lp1. keys', () => {
  const storage = createMemoryStorage();
  const l = createLocal({ storage });
  assert.equal(l.persistent, true);
  l.setSession({ name: 'Ali', id: ID_A });
  const save = emptySave('Ali', 5);
  assert.deepEqual(l.storeSave(ID_A, save), { ok: true, persisted: true, merged: save });
  l.setDirty(ID_A, true);
  l.setLang('ar');

  assert.deepEqual(l.getSession(), { name: 'Ali', id: ID_A });
  assert.deepEqual(l.loadSave(ID_A), save);
  assert.equal(l.isDirty(ID_A), true);
  assert.equal(l.getLang(), 'ar');
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).sort();
  assert.deepEqual(keys, ['lp1.dirty.' + ID_A, 'lp1.lang', 'lp1.save.' + ID_A, 'lp1.session']);

  l.setDirty(ID_A, false);
  assert.equal(l.isDirty(ID_A), false);
});

test('the sign-in code is never persisted (no key or value mentions it)', () => {
  const storage = createMemoryStorage();
  const l = createLocal({ storage });
  l.setSession({ name: 'Ali', id: ID_A });
  l.storeSave(ID_A, emptySave('Ali', 5));
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    assert.ok(!/code/i.test(k + storage.getItem(k)));
  }
});

test('corrupt JSON is treated as missing, never throws', () => {
  const storage = createMemoryStorage();
  const l = createLocal({ storage });
  storage.setItem('lp1.session', '{oops');
  storage.setItem('lp1.save.' + ID_A, '<<<');
  storage.setItem('lp1.save.' + ID_B, '[1,2]');
  assert.equal(l.getSession(), null);
  assert.equal(l.loadSave(ID_A), null);
  assert.equal(l.loadSave(ID_B), null);
  storage.setItem('lp1.session', JSON.stringify({ name: 5, id: ID_A }));
  assert.equal(l.getSession(), null);
  storage.setItem('lp1.session', JSON.stringify({ name: 'x', id: '../../etc' }));
  assert.equal(l.getSession(), null, 'ids are validated, so a tampered session cannot steer key names');
  storage.setItem('lp1.lang', 'fr');
  assert.equal(l.getLang(), null);
});

test('structurally valid but damaged saves are repaired on read', () => {
  const storage = createMemoryStorage();
  const l = createLocal({ storage });
  storage.setItem(
    'lp1.save.' + ID_A,
    JSON.stringify({ v: 1, name: 'Ali', createdAt: 1, updatedAt: 1, history: [{ id: 'x', pts: -4 }], runs: [], settings: {} }),
  );
  const s = l.loadSave(ID_A);
  assert.deepEqual(s.history, []);
  assert.equal(s.name, 'Ali');
});

test('size guard: oversized blobs are neither read nor written', () => {
  const storage = createMemoryStorage();
  const l = createLocal({ storage });
  storage.setItem('lp1.save.' + ID_A, 'x'.repeat(MAX_SAVE_CHARS + 1));
  assert.equal(l.loadSave(ID_A), null);
  // force an oversized serialisation without going through merge (which would sanitise it)
  const huge = { toJSON: () => 'x'.repeat(MAX_SAVE_CHARS + 10) };
  assert.deepEqual(l.storeSave(ID_B, huge), { ok: false, reason: 'toolarge' });
  assert.equal(storage.getItem('lp1.save.' + ID_B), null);
  assert.deepEqual(l.storeSave('not-an-id', emptySave('A', 1)), { ok: false, reason: 'invalid' });
});

test('absent storage: memory fallback with persistent:false', () => {
  const l = createLocal({ storage: null });
  assert.equal(l.persistent, false);
  l.setSession({ name: 'Ali', id: ID_A });
  l.storeSave(ID_A, emptySave('Ali', 1));
  assert.equal(l.getSession().id, ID_A);
  assert.equal(l.loadSave(ID_A).name, 'Ali');
  l.clearAccount();
  assert.equal(l.getSession(), null);
  assert.equal(l.loadSave(ID_A), null);
});

test('default storage lookup that throws (private mode) falls back to memory', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('denied', 'SecurityError');
    },
  });
  try {
    const l = createLocal();
    assert.equal(l.persistent, false);
    l.setLang('en');
    assert.equal(l.getLang(), 'en');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else delete globalThis.localStorage;
  }
});

test('a write that throws (quota) keeps the data in memory and flips persistent', () => {
  const st = flaky();
  const l = createLocal({ storage: st });
  l.setSession({ name: 'Ali', id: ID_A });
  assert.equal(l.persistent, true);
  st.f.failWrite = true;
  const r = l.storeSave(ID_A, emptySave('Ali', 9));
  assert.equal(r.ok, true);
  assert.equal(r.persisted, false);
  assert.equal(l.persistent, false);
  assert.equal(l.loadSave(ID_A).createdAt, 9, 'still readable this session');
  l.setDirty(ID_A, true);
  assert.equal(l.isDirty(ID_A), true);
});

test('a read that throws is treated as missing', () => {
  const st = flaky();
  const l = createLocal({ storage: st });
  l.setSession({ name: 'Ali', id: ID_A });
  st.f.failRead = true;
  assert.doesNotThrow(() => l.getSession());
  assert.equal(l.getSession(), null);
  assert.equal(l.persistent, false);
  assert.equal(l.loadSave(ID_A), null);
  assert.equal(l.isDirty(ID_A), false);
});

test('clearAccount removes session, every save.* and dirty.*, but keeps the language', () => {
  const storage = createMemoryStorage();
  const l = createLocal({ storage });
  l.setSession({ name: 'Ali', id: ID_A });
  l.storeSave(ID_A, emptySave('Ali', 1));
  l.storeSave(ID_B, emptySave('Bob', 1));
  l.setDirty(ID_A, true);
  l.setDirty(ID_B, true);
  l.setLang('ar');
  storage.setItem('other.app', 'keep');
  l.clearAccount();
  const left = Array.from({ length: storage.length }, (_, i) => storage.key(i)).sort();
  assert.deepEqual(left, ['lp1.lang', 'other.app']);
  assert.equal(storage.getItem(KEY_SESSION), null);
});

test('clearAccount also clears the memory overlay and survives a throwing remove', () => {
  const st = flaky();
  const l = createLocal({ storage: st });
  l.setSession({ name: 'Ali', id: ID_A });
  st.f.failWrite = true;
  l.storeSave(ID_A, emptySave('Ali', 1)); // lands in the overlay
  st.f.failRemove = true;
  assert.doesNotThrow(() => l.clearAccount());
  assert.equal(l.loadSave(ID_A), null);
});
