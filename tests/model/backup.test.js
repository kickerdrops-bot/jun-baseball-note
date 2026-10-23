import test from 'node:test';
import assert from 'node:assert/strict';
import { backup, parseBackup, validateNotes, validDate, mergeBackup } from '../../model.js';

function note(overrides = {}) {
  return {
    id: 'fixture-note', date: '2026-10-23', type: '練習', categories: ['打撃'],
    good: 'ボールをよく見られた', improve: '', goal: '強い打球を打つ',
    action: '素振りをする', amount: '10回', feeling: 'よかった',
    goalDone: false, actionDone: false, goalDoneAt: null, actionDoneAt: null,
    createdAt: '2026-10-23T09:00:00.000Z', updatedAt: '2026-10-23T09:00:00.000Z',
    reviews: [], ...overrides,
  };
}

test('legacy backup round trip preserves records and completed goals', () => {
  const records = [note({ goalDone: true, goalDoneAt: '2026-10-23T10:00:00.000Z' })];
  assert.deepEqual(parseBackup(backup(records)), records);
  const legacy = JSON.stringify({ app: 'diamond-note', version: 1, notes: records });
  assert.deepEqual(parseBackup(legacy), records);
});

test('malformed files, foreign formats, and oversized files are rejected', () => {
  for (const raw of ['{bad', 'null', '{}', JSON.stringify({ app: 'other', version: 1, notes: [] }),
    JSON.stringify({ app: 'diamond-note', version: 2, notes: [] })]) {
    assert.throws(() => parseBackup(raw));
  }
  assert.throws(() => parseBackup(' '.repeat(5 * 1024 * 1024 + 1)), /5MB/);
});

test('duplicate IDs and invalid records reject the entire backup', () => {
  assert.throws(() => validateNotes([note(), note({ good: '異なる記録' })]));
  const valid = note();
  const invalid = note({ id: 'another-note', date: '2026-02-30' });
  assert.throws(() => parseBackup(backup([valid, invalid])));
  assert.deepEqual(valid, note(), 'validation must not mutate the original records');
});

test('invalid goal relationships cannot enter through JSON import', () => {
  for (const invalid of [
    { good: ' ', improve: '' },
    { goal: '', action: '素振り', amount: '' },
    { action: '', amount: '10回' },
    { goal: '', action: '', amount: '', goalDone: true },
    { action: '', amount: '', actionDone: true },
    { goalDone: 'true' },
    { categories: ['打撃', '打撃'] },
    { reviews: [{ id: 'review', status: 'unexpected', text: '' }] },
  ]) assert.throws(() => validateNotes([note(invalid)]));
});

test('record bounds and calendar dates are enforced', () => {
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2026-2-01'), false);
  assert.equal(validDate('2101-01-01'), false);
  for (const invalid of [{ good: 'x'.repeat(1601) }, { goal: 'x'.repeat(301) },
    { amount: 'x'.repeat(101) }, { id: '../outside' }, { updatedAt: 'invalid' }]) {
    assert.throws(() => validateNotes([note(invalid)]));
  }
});

test('import canonicalizes data and drops authorization fields', () => {
  const original = note({ role: 'manager', notebook_id: 'other', revision: 999,
    user_metadata: { role: 'writer' }, extra: 'ignored' });
  const clean = validateNotes([original])[0];
  assert.equal(Object.hasOwn(clean, 'role'), false);
  assert.equal(Object.hasOwn(clean, 'notebook_id'), false);
  assert.equal(Object.hasOwn(clean, 'revision'), false);
  assert.equal(Object.hasOwn(clean, 'user_metadata'), false);
  assert.notEqual(clean.categories, original.categories);
  assert.notEqual(clean.reviews, original.reviews);
});

test('text stays literal through backup without becoming markup', () => {
  const text = '<img src=x onerror=alert(1)> & "引用"';
  assert.equal(parseBackup(backup([note({ good: text })]))[0].good, text);
});

test('import adds new records and preserves existing records on ID conflict', () => {
  const existing = note();
  const changed = note({ good: '古いバックアップにある別の本文' });
  const added = note({ id: 'second-note', date: '2026-10-22' });
  const result = mergeBackup([existing], [changed, added]);
  assert.deepEqual(result, { notes: [existing, added], added: 1, skipped: 1 });
  assert.deepEqual(existing, note());
});

test('repeating an import is idempotent, including content duplicates with new IDs', () => {
  const existing = note();
  const duplicate = note({ id: 'duplicate-id' });
  const added = note({ id: 'new-note', good: '守備の一歩目が早かった' });
  const first = mergeBackup([existing], [duplicate, added]);
  const second = mergeBackup(first.notes, [duplicate, added]);
  assert.equal(first.added, 1);
  assert.equal(first.skipped, 1);
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 2);
  assert.deepEqual(second.notes, first.notes);
});

test('a bad imported record leaves the current collection unchanged', () => {
  const current = [note()];
  const snapshot = structuredClone(current);
  assert.throws(() => mergeBackup(current, [note({ id: 'new-note', goalDone: 'yes' })]));
  assert.deepEqual(current, snapshot);
});

export { note };
