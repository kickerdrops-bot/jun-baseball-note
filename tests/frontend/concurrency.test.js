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
function harness(supabase, { controls = [], elements = {} } = {}) {
  const root = { addEventListener() {}, setAttribute() {}, querySelectorAll: selector =>
    selector === '[data-was-disabled]' ? controls.filter(el => Object.hasOwn(el.dataset, 'wasDisabled')) : controls };
  const storage = new Map();
  const context = vm.createContext({ ...model, supabase, iconUrl: '/icon.svg',
    document: { querySelector: selector => selector === '#app' ? root : elements[selector] || null, addEventListener() {} },
    window: { addEventListener() {} }, navigator: { onLine: true },
    location: { href: 'https://kickerdrops-bot.github.io/jun-baseball-note/' },
    history: { replaceState() {} },
    localStorage: { getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
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
  return { context, storage, run: expression => vm.runInContext(expression, context) };
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

test('a failed cloud form save preserves the unsaved fields, stored notes, and revision', async () => {
  const request = deferred();
  const controls = [
    { name: 'good', value: 'まだ保存できていない気づき', disabled: false, dataset: {} },
    { name: 'type', value: '練習', disabled: false, dataset: {} },
  ];
  const fields = new Map(Object.entries({ date: model.today(), type: '練習',
    good: controls[0].value, improve: '', goal: '', action: '', amount: '', feeling: '' }));
  const form = { fields };
  let submitted;
  const { context, run } = harness({ auth, rpc(_name, args) { submitted = args; return request.promise; } },
    { controls, elements: { '#note-form': form } });
  context.FormData = class {
    constructor(input) { this.fields = input.fields; }
    get(key) { return this.fields.get(key) ?? null; }
    getAll(key) { return this.fields.has(key) ? [this.fields.get(key)] : []; }
    entries() { return this.fields.entries(); }
  };
  context.initial = record('existing');
  run(`notes = [initial]; revision = 4; view = 'form'; editingId = 'existing';`);
  const saving = run('saveForm()');
  assert.equal(submitted.p_expected_revision, 4);
  assert.equal(submitted.p_notes[0].good, controls[0].value);
  assert.equal(controls.every(control => control.disabled), true);
  request.resolve({ error: { status: 503, message: 'Network unavailable' } });
  await saving;
  assert.equal(context.renders, 0, 'error must not replace the form DOM');
  assert.equal(controls[0].value, 'まだ保存できていない気づき');
  assert.equal(controls.every(control => !control.disabled), true, 'retry controls must be restored');
  assert.equal(run('view'), 'form');
  assert.equal(run('revision'), 4);
  assert.equal(run('notes[0].good'), context.initial.good);
  assert.equal(run('busy'), false);
  assert.match(context.errors[0], /保存できませんでした.*入力内容は残っています/);
});

test('viewer and manager cannot reach write RPC or import file handling', async () => {
  let rpcCalls = 0, fileReads = 0;
  for (const role of ['viewer', 'manager']) {
    const { context, run } = harness({ auth, rpc() { rpcCalls++; throw new Error('Unexpected write'); } });
    context.initial = record('existing');
    context.file = { text() { fileReads++; throw new Error('Unexpected file read'); } };
    context.role = role;
    run('notes = [initial]; revision = 7; membership.role = role;');
    assert.equal(await run('persist([])'), false);
    await run('saveForm()');
    await run('importFile(file)');
    assert.equal(run('revision'), 7);
    assert.equal(run('notes.length'), 1);
    assert.equal(context.renders, 0);
  }
  assert.equal(rpcCalls, 0);
  assert.equal(fileReads, 0);
});

test('invite and recovery callbacks clear the old account before verification and force password setup', async () => {
  for (const type of ['invite', 'recovery']) {
    const sequence = [];
    let current;
    const { context, storage, run } = harness({ auth: { ...auth,
      async signOut(options) {
        sequence.push('signout');
        assert.equal(options.scope, 'local');
        assert.equal(current.run('notes.length'), 0);
        assert.equal(current.run('membership'), null);
        assert.equal(current.run('generatedLink'), null);
        assert.equal(storage.has('jun-note.password-setup'), false);
        return { error: null };
      },
      async verifyOtp(options) {
        sequence.push('verify');
        assert.equal(options.type, type);
        assert.equal(options.token_hash, 'test-onetime-hash');
        return { data: { user: { id: 'new-invitee', email: 'invitee@example.invalid' } }, error: null };
      },
    }, from() { throw new Error('No data access before password setup'); } });
    current = { run };
    context.initial = record('old-account-note');
    context.location.href += `?token_hash=test-onetime-hash&type=${type}`;
    context.history.replaceState = (_state, _title, path) => {
      sequence.push('sanitize');
      assert.equal(path, '/jun-baseball-note/');
      context.location.href = `https://kickerdrops-bot.github.io${path}`;
    };
    storage.set('jun-note.password-setup', 'old-account');
    run(`notes = [initial]; family = [{ user_id: 'old-family' }]; generatedLink = { link: 'old-private-link' };`);
    await run('start()');
    assert.deepEqual(sequence, ['sanitize', 'signout', 'verify']);
    assert.equal(run('user.id'), 'new-invitee');
    assert.equal(run('authStage'), 'setup');
    assert.equal(run('ready'), false);
    assert.equal(run('family.length'), 0);
    assert.equal(run('revision'), null);
    assert.equal(storage.get('jun-note.password-setup'), 'new-invitee');
  }
});

test('an invalid or reused callback leaves no old account or record visible', async () => {
  const { context, storage, run } = harness({ auth: { ...auth,
    async signOut() { return { error: null }; },
    async verifyOtp() { return { data: { user: null }, error: { code: 'otp_expired' } }; },
  } });
  context.initial = record('old-account-note');
  context.location.href += '?token_hash=expired-test-hash&type=invite';
  storage.set('jun-note.password-setup', 'old-account');
  run('notes = [initial];');
  await run('start()');
  assert.equal(run('user'), null);
  assert.equal(run('notes.length'), 0);
  assert.equal(run('ready'), false);
  assert.equal(run('authStage'), 'signin');
  assert.equal(storage.has('jun-note.password-setup'), false);
  assert.match(run('authMessage'), /期限切れ、使用済み、または無効/);
});

test('reopening after callback keeps password setup pending before loading records', async () => {
  let dataReads = 0;
  const account = { id: 'setup-user', email: 'setup@example.invalid' };
  const { storage, run } = harness({ auth: { ...auth,
    async getSession() { return { data: { session: { user: account } }, error: null }; },
    async getUser() { return { data: { user: account }, error: null }; },
  }, from() { dataReads++; throw new Error('Unexpected data read'); } });
  storage.set('jun-note.password-setup', account.id);
  run('clearPrivate(); user = null; authStage = "loading";');
  await run('start()');
  assert.equal(run('authStage'), 'setup');
  assert.equal(run('user.id'), account.id);
  assert.equal(dataReads, 0);
});
