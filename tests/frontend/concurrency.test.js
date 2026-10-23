import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../../model.js';

const source = (await readFile(new URL('../../app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\s*$/gm, '')
  .replace(/void start\(\);\s*$/, '');

function record(id, good = 'ボールを最後まで見た') {
  return { id, date: '2026-10-23', type: '練習', categories: [], good, improve: '',
    goal: '', action: '', amount: '', feeling: '', goalDone: false, actionDone: false,
    goalDoneAt: null, actionDoneAt: null, createdAt: '2026-10-23T09:00:00.000Z',
    updatedAt: '2026-10-23T09:00:00.000Z', reviews: [] };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness(supabase) {
  const root = { addEventListener() {}, setAttribute() {}, querySelectorAll: () => [] };
  const context = vm.createContext({ ...model, supabase, iconUrl: '/icon.svg',
    document: { querySelector: selector => selector === '#app' ? root : null, addEventListener() {} },
    window: { addEventListener() {} }, navigator: { onLine: true },
    setTimeout, clearTimeout, URL, URLSearchParams, FormData, Blob,
    errors: [], renders: 0,
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    user = { id: 'writer' }; membership = { notebook_id: 'notebook', role: 'writer' };
    ready = true; authStage = 'ready'; booting = false; revision = 0;
    render = () => { renders++; };
    showError = message => { errors.push(message); };
    toast = () => {};
  `, context);
  return { context, run: expression => vm.runInContext(expression, context) };
}
const auth = { onAuthStateChange() {} };

test('a refresh that finishes during a save cannot erase input or apply stale data', async () => {
  const read = deferred(), write = deferred(), readStarted = deferred();
  const { context, run } = harness({ auth,
    from(table) { return { select() { return { eq() {
      if (table === 'memberships') return Promise.resolve({ data: [{ notebook_id: 'notebook', user_id: 'writer', role: 'writer' }] });
      return { maybeSingle() { readStarted.resolve(); return read.promise; } };
    } }; } }; },
    rpc() { return write.promise; },
  });
  context.initial = record('existing');
  context.saved = record('existing', '保存した新しい内容');
  run(`notes = [initial]; view = 'form'; dirty = () => !busy;`);
  const reading = run('loadLatest()');
  await readStarted.promise;
  const saving = run('persist([saved])');
  read.resolve({ data: { notebook_id: 'notebook', revision: 0, notes: [context.initial] } });
  await reading;
  assert.equal(context.renders, 0, 'pending save must retain the form DOM');
  assert.equal(run('revision'), 0);
  write.resolve({ data: { notebook_id: 'notebook', revision: 1, notes: [context.saved] } });
  assert.equal(await saving, true);
  assert.equal(run('revision'), 1);
  assert.equal(run('notes[0].good'), '保存した新しい内容');
});

test('an import confirmation cannot overwrite changes fetched while the dialog was open', async () => {
  const confirming = deferred(), dialogOpened = deferred();
  let submittedRevision;
  const { context, run } = harness({ auth, rpc(_name, args) {
    submittedRevision = args.p_expected_revision;
    return Promise.resolve({ error: { code: 'P0001', message: 'NOTEBOOK_CONFLICT' } });
  } });
  context.initial = record('existing');
  context.remote = record('remote', '別端末で追加した記録');
  context.file = { size: 1000, text: async () => model.backup([record('imported', '昔の記録')]) };
  context.confirming = confirming.promise;
  context.opened = () => dialogOpened.resolve();
  run(`notes = [initial]; view = 'settings'; confirmAction = () => { opened(); return confirming; };`);
  const importing = run('importFile(file)');
  await dialogOpened.promise;
  run('notes = [initial, remote]; revision = 1;');
  confirming.resolve(true);
  await importing;
  assert.equal(submittedRevision, 0, 'submit the revision the user originally reviewed');
  assert.equal(run('revision'), 1);
  assert.deepEqual(JSON.parse(run('JSON.stringify(notes.map(n => n.id))')), ['existing', 'remote']);
  assert.match(context.errors[0], /別の画面で記録が更新/);
});
