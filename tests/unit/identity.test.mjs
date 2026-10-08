import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  normalizeName,
  validateName,
  generateCode,
  playerId,
  boardId,
  generateBoardKey,
  formatCode,
  parseCode,
  NAME_MAX,
} from '../../js/sync/identity.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('normalizeName: NFKC, trim, collapse whitespace, lower-case', () => {
  assert.equal(normalizeName('  Ali   Baba  '), 'ali baba');
  assert.equal(normalizeName('ＡＬＩ'), 'ali', 'full-width folds to ASCII');
  assert.equal(normalizeName('é'), 'é', 'decomposed accent composes');
  assert.equal(normalizeName('A B'), 'a b', 'NBSP counts as whitespace');
});

test('normalizeName keeps Arabic letters (diacritics and spelling variants fold only in the KEY)', () => {
  assert.equal(normalizeName('حسين'), 'حسين');
  assert.equal(normalizeName('  حسين   علي '), 'حسين علي');
  assert.equal(validateName('حُسَيْن').name, 'حُسَيْن', 'display keeps what the player typed');
});

test('validateName rejects with typed reasons', () => {
  assert.deepEqual(validateName(''), { ok: false, reason: 'empty' });
  assert.deepEqual(validateName('   　 '), { ok: false, reason: 'empty' });
  assert.deepEqual(validateName(undefined), { ok: false, reason: 'not_string' });
  assert.deepEqual(validateName(42), { ok: false, reason: 'not_string' });
  assert.equal(validateName('a'.repeat(NAME_MAX + 1)).reason, 'too_long');
  assert.equal(validateName('a'.repeat(NAME_MAX)).ok, true);
  for (const bad of ['a\u0000b', 'a\nb', 'a\tb', 'a\u007fb', 'a\u2028b']) {
    assert.equal(validateName(bad).reason, 'control_chars', JSON.stringify(bad));
  }
  assert.equal(validateName('\ud800').reason, 'control_chars', 'lone surrogate');
});

test('names that are nothing but invisible characters are rejected with their own reason', () => {
  for (const blank of ['\u200b', '\u200b\u200c\u200d', '\u2800', '\u3164', '\u115f\u1160', '\uffa0', '\u202e', '\u2066\u2069', '\ufe0f', '\u{e0041}', ' \u200b ']) {
    assert.deepEqual(validateName(blank), { ok: false, reason: 'invisible' }, JSON.stringify(blank));
  }
  assert.equal(validateName('\u200b').ok, false);
});

test('invisible and bidi characters are stripped from the display name AND the key', () => {
  const plain = validateName('Ali');
  for (const sneaky of ['A\u200bli', 'Al\u200ci', '\u202eAli', 'Ali\u2066', 'A\u3164li', 'Ali\u2800', 'A\u115fl\u1160i', 'Ali\ufe0f', 'A\u{e0020}li', 'Ali\ufeff', 'A\u00adli', 'A\u200fl\u200ei']) {
    const r = validateName(sneaky);
    assert.deepEqual(r, plain, JSON.stringify(sneaky));
  }
  assert.equal(validateName('x\u202ey').name, 'xy', 'a right-to-left override cannot reverse the row text');
});

test('length is counted in code points after stripping invisibles', () => {
  assert.equal(validateName('a\u200b'.repeat(NAME_MAX)).ok, true, 'invisibles do not count');
  assert.equal(validateName('😀'.repeat(NAME_MAX)).ok, true);
});

test('key folding: equivalent Arabic spellings share one key', () => {
  const same = (...names) => {
    const keys = names.map((n) => normalizeName(n));
    assert.ok(keys.every((k) => k !== null && k === keys[0]), JSON.stringify([names, keys]));
  };
  same('أحمد', 'احمد', 'إحمد', 'آحمد', 'ٱحمد'); // alef variants
  same('علي', 'على', 'عليّ', 'عَلِيّ', 'علی'); // yeh / alef maqsura / persian yeh + harakat + shadda
  same('كريم', 'کریم'); // kaf, persian kaf/yeh
  same('مــحمد', 'محمد'); // tatweel
  same('مُحَمَّد', 'محمد'); // harakat
  same('١٢٣', '۱۲۳', '123'); // Arabic-Indic, Eastern Arabic and ASCII digits
  same('سارة١', 'سارة1');
});

test('key folding does NOT merge different words or scripts', () => {
  assert.notEqual(normalizeName('مدرسة'), normalizeName('مدرسه'), 'teh marbuta and heh stay different');
  assert.notEqual(normalizeName('а'), normalizeName('a'), 'Cyrillic a is not Latin a');
  assert.notEqual(normalizeName('Αli'), normalizeName('Ali'), 'Greek Alpha is not Latin A');
  assert.notEqual(normalizeName('o'), normalizeName('0'));
  assert.notEqual(normalizeName('علي'), normalizeName('عمر'));
  // Display keeps what was typed, so a leaderboard row still shows the player's own spelling.
  assert.equal(validateName('أحمد').name, 'أحمد');
});

test('key folding is locale independent (Turkish dotless i is not special-cased)', () => {
  assert.equal(normalizeName('I'), 'i');
  assert.equal(normalizeName('İ'.normalize('NFKC')), 'i̇');
});

test('name length counts code points, not UTF-16 units', () => {
  assert.equal(validateName('😀'.repeat(NAME_MAX)).ok, true);
  assert.equal(validateName('😀'.repeat(NAME_MAX + 1)).reason, 'too_long');
});

test('validateName returns display name (case kept) and key (lower-case)', () => {
  const r = validateName('  Ali  Baba ');
  assert.deepEqual(r, { ok: true, name: 'Ali Baba', key: 'ali baba' });
  assert.equal(normalizeName('bad\u0000'), null);
});

test('generateCode: 6 digits, zero padded, leading zeros occur', () => {
  let leading = 0;
  for (let i = 0; i < 20000; i++) {
    const c = generateCode();
    assert.match(c, /^[0-9]{6}$/);
    if (c[0] === '0') leading++;
  }
  // P(first digit is 0) = 0.1; 20000 draws -> mean 2000, sd 42. Six sigma either side.
  assert.ok(leading > 1700 && leading < 2300, `leading zeros: ${leading}`);
});

test('generateCode is roughly uniform per digit position', () => {
  const N = 30000;
  const counts = Array.from({ length: 6 }, () => new Array(10).fill(0));
  for (let i = 0; i < N; i++) {
    const c = generateCode();
    for (let p = 0; p < 6; p++) counts[p][Number(c[p])]++;
  }
  for (let p = 0; p < 6; p++) {
    for (let d = 0; d < 10; d++) {
      // expected 3000, sd ~52; allow +-8 sd so the test is stable yet catches modulo bias patterns
      assert.ok(Math.abs(counts[p][d] - N / 10) < 420, `pos ${p} digit ${d}: ${counts[p][d]}`);
    }
  }
});

test('generateCode rejection sampling: values in the biased tail are re-rolled', () => {
  const seq = [4294967295, 4294000000, 123456789];
  let i = 0;
  const code = generateCode((buf) => {
    buf[0] = seq[i++];
  });
  assert.equal(i, 3, 'two rejected draws before the accepted one');
  assert.equal(code, String(123456789 % 1000000).padStart(6, '0'));
  // the highest accepted value maps to 999999, the lowest to 000000
  assert.equal(generateCode((b) => void (b[0] = 4293999999)), '999999');
  assert.equal(generateCode((b) => void (b[0] = 0)), '000000');
});

test('generateCode throws on a broken constant RNG instead of hanging', () => {
  assert.throws(() => generateCode((b) => void (b[0] = 4294967295)));
});

test('playerId = hex SHA-256("lp1:"+nameKey+":"+code) and is name-normalised', async () => {
  const id = await playerId('  Ali  ', '012345');
  assert.equal(id, sha('lp1:ali:012345'));
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(await playerId('ALI', '012345'), id);
  assert.notEqual(await playerId('ali', '012346'), id);
  assert.notEqual(await playerId('alj', '012345'), id);
});

test('playerId rejects invalid input', async () => {
  await assert.rejects(playerId('', '123456'), TypeError);
  await assert.rejects(playerId('ali', '12345'), TypeError);
  await assert.rejects(playerId('ali', 123456), TypeError);
});

test('playerId has no delimiter ambiguity between name and code', async () => {
  // "a:1" + "23456" vs "a" + "123456" style collisions are impossible because code is fixed-width digits.
  assert.notEqual(await playerId('a:1', '234567'), await playerId('a', '123456'));
});

test('boardId = hex SHA-256("lp1-board:"+bk) of a random 128-bit key, and refuses anything else', async () => {
  const bk = generateBoardKey();
  assert.match(bk, /^[0-9a-f]{32}$/);
  assert.equal(await boardId(bk), sha('lp1-board:' + bk));
  for (const bad of ['', 'abc', 'A'.repeat(32), 'g'.repeat(32), '0'.repeat(31), '0'.repeat(33), undefined, 42, await playerId('ali', '000001')]) {
    await assert.rejects(() => boardId(bad), TypeError, String(bad));
  }
});

test('generateBoardKey: 16 bytes from the injected source, distinct across calls, hex lower-case', () => {
  assert.equal(generateBoardKey((b) => b.fill(0xab)), 'ab'.repeat(16));
  assert.equal(generateBoardKey((b) => b.fill(0x01)), '01'.repeat(16));
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(generateBoardKey());
  assert.equal(seen.size, 200);
});

test('OFFLINE ORACLE IS GONE: for a fixed name and ALL 10^6 codes, no public value equals anything an attacker can compute from (name, code)', () => {
  // Everything below is computable by an attacker who knows only the name: the save id H("lp1:"+key+":"+code),
  // the OLD public board id H("lp1-board:"+saveId), and a few obvious variants. The new board id comes from a
  // random key that exists nowhere but inside the save, so it must match none of the 10^6 candidates.
  const key = normalizeName('Ali');
  const bid = sha('lp1-board:' + generateBoardKey());
  let oldSchemeHits = 0;
  let candidates = 0;
  for (let n = 0; n < 1000000; n++) {
    const code = String(n).padStart(6, '0');
    const saveId = sha('lp1:' + key + ':' + code);
    const oldBoardId = sha('lp1-board:' + saveId);
    if (oldBoardId === bid || saveId === bid || sha('lp1-board:' + code) === bid || sha('lp1-board:' + key + ':' + code) === bid) oldSchemeHits++;
    candidates++;
  }
  assert.equal(candidates, 1000000);
  assert.equal(oldSchemeHits, 0);
  // Sanity of the harness: the OLD id for a known code IS found by the same recomputation, so a hit would be seen.
  const known = sha('lp1-board:' + sha('lp1:' + key + ':' + '123456'));
  let found = false;
  for (let n = 123450; n < 123460; n++) if (sha('lp1-board:' + sha('lp1:' + key + ':' + String(n).padStart(6, '0'))) === known) found = true;
  assert.ok(found);
});

test('formatCode groups in threes', () => {
  assert.equal(formatCode('123456'), '123 456');
  assert.equal(formatCode('000042'), '000 042');
});

test('parseCode accepts separators and every digit script', () => {
  assert.equal(parseCode('123456'), '123456');
  assert.equal(parseCode('123 456'), '123456');
  assert.equal(parseCode(' 123-456 '), '123456');
  assert.equal(parseCode('123–456'), '123456', 'en dash');
  assert.equal(parseCode('١٢٣٤٥٦'), '123456', 'Arabic-Indic');
  assert.equal(parseCode('۱۲۳۴۵۶'), '123456', 'Eastern Arabic (Persian)');
  assert.equal(parseCode('١٢٣ ۴۵۶'), '123456', 'mixed scripts');
  assert.equal(parseCode('１２３４５６'), '123456', 'full-width');
  assert.equal(parseCode('‏١٢٣‎ ٤٥٦'), '123456', 'bidi marks from pasted RTL text');
  assert.equal(parseCode('000123'), '000123', 'leading zeros preserved');
});

test('parseCode requires exactly six digits', () => {
  for (const bad of ['', '12345', '1234567', '12a456', '12.456', '12 34 5', null, undefined, 123456, '١٢٣٤٥']) {
    assert.equal(parseCode(bad), null, String(bad));
  }
});

test('parseCode(formatCode(c)) round-trips', () => {
  for (const c of ['000000', '999999', '012345']) assert.equal(parseCode(formatCode(c)), c);
});
