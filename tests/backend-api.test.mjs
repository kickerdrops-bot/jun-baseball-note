// Live acceptance suite. Uses disposable users/notes only, never a service-role key.
// JUN_BACKEND_FIXTURE=/absolute/private/qa-fixture.json node tests/backend-api.test.mjs
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const fixturePath = process.env.JUN_BACKEND_FIXTURE;
if (!fixturePath) throw new Error('Set JUN_BACKEND_FIXTURE to the private disposable QA fixture.');
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const url = fixture.project_url.replace(/\/$/, '');
const key = fixture.publishable_key;
const notebookId = fixture.notebook_id;
const sessions = {};
const result = [];
async function request(path, { role, method = 'GET', body, extraHeaders = {} } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json', ...extraHeaders };
  if (role) headers.Authorization = `Bearer ${sessions[role].access_token}`;
  const response = await fetch(`${url}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  return { status: response.status, ok: response.ok, data };
}
async function check(name, callback) {
  await callback();
  result.push(name);
  console.log(`PASS ${name}`);
}
function deniesRead(response) {
  assert(response.status === 401 || response.status === 403 || (response.ok && Array.isArray(response.data) && response.data.length === 0));
}
const path = `/rest/v1/notebook_documents?notebook_id=eq.${notebookId}&select=*`;
const save = (role, revision, notes) => request('/rest/v1/rpc/save_notebook', {
  role, method: 'POST', body: { p_notebook_id: notebookId, p_expected_revision: revision, p_notes: notes },
});
const family = (role, action, rest = {}) => request('/functions/v1/family-admin', {
  role, method: 'POST', body: { notebook_id: notebookId, action, ...rest },
});
const row = (response) => Array.isArray(response.data) ? response.data[0] : response.data;
for (const account of fixture.accounts) {
  assert(['writer', 'viewer', 'manager', 'uninvited', 'revoked'].includes(account.role), 'Unexpected fixture role');
  const login = await request('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email: account.email, password: account.password },
  });
  assert(login.ok && login.data?.access_token && login.data.user?.id === account.user_id, `Fixture ${account.role} login failed (HTTP ${login.status})`);
  sessions[account.role] = { access_token: login.data.access_token, user_id: account.user_id };
}
for (const role of ['writer','viewer','manager','uninvited','revoked']) assert(sessions[role], `Missing ${role} fixture`);
const notebook = await request(`/rest/v1/notebooks?id=eq.${notebookId}&select=title`, { role: 'manager' });
assert(notebook.ok && notebook.data?.[0]?.title === '__JUN_TEST__', 'Refusing to modify a non-test notebook.');
const initial = await request(path, { role: 'writer' });
assert(initial.ok && initial.data?.length === 1);
let revision = row(initial).revision;
const now = new Date().toISOString();
const note = {
  id: randomUUID(), date: '2026-10-23', type: '練習', categories: ['守備'],
  good: '権限テスト用の記録', improve: '', goal: '正面で捕る', action: 'ゴロを練習', amount: '10球', feeling: 'よかった',
  goalDone: false, actionDone: false, goalDoneAt: null, actionDoneAt: null,
  createdAt: now, updatedAt: now, reviews: [],
};

try {
  await check('unauthenticated cannot read documents', async () => deniesRead(await request(path)));
  await check('uninvited user cannot read documents', async () => deniesRead(await request(path, { role: 'uninvited' })));
  await check('manager, writer and viewer can read same document', async () => {
    for (const role of ['manager','writer','viewer']) {
      const response = await request(path, { role });
      assert(response.ok && response.data.length === 1);
      assert.equal(row(response).notebook_id, notebookId);
    }
  });
  await check('all client roles denied direct document update, insert and delete', async () => {
    for (const role of ['manager','writer','viewer','uninvited']) {
      for (const [method, body] of [['PATCH',{ notes: [], revision: revision + 1 }], ['DELETE',undefined], ['POST',{ notebook_id: notebookId, notes: [] }]]) {
        const response = await request(path, { role, method, body, extraHeaders: { Prefer: 'return=representation' } });
        assert(!response.ok, `${role} ${method} unexpectedly succeeded`);
      }
    }
    assert.equal(row(await request(path, { role: 'writer' })).revision, revision);
  });
  await check('viewer, manager, uninvited cannot call writer save RPC', async () => {
    for (const role of ['viewer','manager','uninvited']) {
      const response = await save(role, revision, [note]);
      assert(!response.ok && response.data.code === '42501');
    }
  });
  await check('writer saves and separate viewer session sees saved note', async () => {
    const response = await save('writer', revision, [note]);
    assert(response.ok);
    revision = row(response).revision;
    const visible = await request(path, { role: 'viewer' });
    assert.deepEqual(row(visible).notes, [note]);
    assert.equal(row(visible).revision, revision);
  });
  await check('simultaneous same-revision saves: exactly one succeeds', async () => {
    const responses = await Promise.all([save('writer', revision, [{ ...note, good: '同時編集A' }]), save('writer', revision, [{ ...note, good: '同時編集B' }])]);
    assert.equal(responses.filter((r) => r.ok).length, 1);
    const failed = responses.find((r) => !r.ok);
    assert.equal(failed.data.message, 'NOTEBOOK_CONFLICT');
    revision = row(responses.find((r) => r.ok)).revision;
  });
  await check('invalid notes rejected and saved data unchanged', async () => {
    const before = row(await request(path, { role: 'viewer' }));
    for (const invalid of [[{ ...note, good: '', improve: '' }], [note,note], [{ ...note, categories: ['bad'] }], [{ ...note, updatedAt: 'bad' }], [{ ...note, goal: '', action: 'action' }], [{ ...note, goalDone: 'true' }]]) {
      const response = await save('writer', revision, invalid);
      assert(!response.ok && response.data.message === 'INVALID_NOTES');
    }
    assert.deepEqual(row(await request(path, { role: 'viewer' })), before);
  });
  await check('clients cannot assign roles or notebook membership through REST', async () => {
    for (const role of ['viewer','writer','manager','uninvited']) {
      const response = await request(`/rest/v1/memberships?notebook_id=eq.${notebookId}&user_id=eq.${sessions[role].user_id}`, { role, method: 'PATCH', body: { role: 'manager' } });
      assert(!response.ok);
    }
  });
  await check('writer and viewer cannot use family management API', async () => {
    for (const role of ['writer','viewer','uninvited']) {
      const response = await family(role, 'list');
      assert.equal(response.status, 403);
    }
  });
  await check('manager list works and manager cannot remove self', async () => {
    const listed = await family('manager', 'list');
    assert(listed.ok && listed.data.members.length === 4);
    const response = await family('manager', 'remove', { user_id: sessions.manager.user_id });
    assert.equal(response.status, 403);
    assert.equal(response.data.code, 'CANNOT_REMOVE_MANAGER');
  });
  await check('second writer invitation blocked before Auth user creation', async () => {
    const response = await family('manager', 'invite', { email: `never-created-${randomUUID()}@example.invalid`, role: 'writer' });
    assert.equal(response.status, 409);
    assert.equal(response.data.code, 'WRITER_EXISTS');
  });
  await check('membership removal blocks the same existing JWT immediately', async () => {
    const before = await request(path, { role: 'revoked' });
    assert(before.ok && before.data.length === 1);
    const response = await family('manager', 'remove', { user_id: sessions.revoked.user_id });
    assert(response.ok && response.data.ok);
    deniesRead(await request(path, { role: 'revoked' }));
    assert.equal((await family('revoked', 'list')).status, 403);
  });
  await check('goal and action achievement flags persist', async () => {
    const checked = { ...note, goalDone: true, actionDone: true, goalDoneAt: now, actionDoneAt: now };
    const response = await save('writer', revision, [checked]);
    assert(response.ok);
    revision = row(response).revision;
    assert.deepEqual(row(await request(path, { role: 'viewer' })).notes, [checked]);
  });
  console.log(JSON.stringify({ passed: result.length, tests: result }, null, 2));
} finally {
  // Clear only this verified disposable notebook, even after a failed assertion.
  const current = await request(path, { role: 'writer' });
  if (current.ok && current.data?.length === 1) await save('writer', row(current).revision, []);
  for (const session of Object.values(sessions)) {
    await fetch(`${url}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${session.access_token}` } });
  }
}
