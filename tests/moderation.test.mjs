import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/moderation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function setup({ allowed = true, rows = [], error = null, rpcResult = true, throws = false } = {}) {
  const calls = [];
  const query = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'update', 'delete', 'single']) {
    query[method] = (...args) => { calls.push([method, ...args]); return query; };
  }
  query.then = (resolve, reject) => Promise.resolve({ data: rows, error }).then(resolve, reject);
  const client = {
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      return name === 'can_moderate' ? { data: allowed, error: null } : { data: rpcResult, error };
    },
    from: (name) => { calls.push(['from', name]); return query; },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      assert.equal(name, '@/lib/supabaseBrowser');
      return { createClient: () => { if (throws) throw new Error('Missing configuration'); return client; } };
    },
    console,
  });
  return { api: exports, calls };
}

test('denied access never queries moderation tables', async () => {
  const { api, calls } = setup({ allowed: false });
  await assert.rejects(api.getPendingGatherings());
  await assert.rejects(api.getModeratedPrayers());
  assert.equal((await api.moderateGathering('id', 'approve')).ok, false);
  assert.equal((await api.setPrayerVisibility('id', false)).ok, false);
  assert.equal((await api.deletePrayerRequest('id')).ok, false);
  assert.equal(calls.some(([method]) => method === 'from'), false);
});

test('missing configuration fails closed without throwing from access check or writes', async () => {
  const { api } = setup({ throws: true });
  assert.equal(await api.getModerationAccess(), false);
  assert.equal((await api.moderateGathering('id', 'approve')).ok, false);
});

test('pending queue filters and orders newest first', async () => {
  const { api, calls } = setup({ rows: [{ id: 'one', gathering_data: { name: 'Church' }, status: 'pending' }] });
  const result = await api.getPendingGatherings();
  assert.equal(result[0].gathering_data.name, 'Church');
  assert.ok(calls.some(([method, key, value]) => method === 'eq' && key === 'status' && value === 'pending'));
  assert.ok(calls.some(([method, key, value]) => method === 'order' && key === 'created_at' && value.ascending === false));
});

test('read failures are not presented as an empty queue', async () => {
  const { api } = setup({ error: { message: 'Unavailable' } });
  await assert.rejects(api.getPendingGatherings());
  await assert.rejects(api.getModeratedPrayers());
});

for (const action of ['approve', 'reject']) {
  test(`${action} uses one atomic RPC, never a browser insert`, async () => {
    const { api, calls } = setup();
    assert.equal((await api.moderateGathering('submission-id', action)).ok, true);
    const call = calls.find((entry) => entry[1] === 'moderate_gathering');
    assert.equal(call?.[2].p_submission_id, 'submission-id');
    assert.equal(call?.[2].p_action, action);
    assert.equal(calls.some(([method]) => method === 'from'), false);
  });
}

test('invalid actions and stale RPC responses are not successful', async () => {
  const { api } = setup({ rpcResult: false });
  assert.equal((await api.moderateGathering('id', 'approve')).ok, false);
  assert.equal((await api.moderateGathering('id', 'invalid')).ok, false);
});

test('prayer oversight includes private requests and is bounded', async () => {
  const { api, calls } = setup({ rows: [{ id: 'prayer', is_public: false }] });
  assert.equal((await api.getModeratedPrayers())[0].is_public, false);
  assert.ok(calls.some(([method, count]) => method === 'limit' && count === 50));
  assert.equal(calls.some(([method, key]) => method === 'eq' && key === 'is_public'), false);
});

for (const method of ['setPrayerVisibility', 'deletePrayerRequest']) {
  test(`${method} detects denied / zero-row mutations`, async () => {
    assert.equal((await setup().api[method]('id', false)).ok, false);
    assert.equal((await setup({ rows: [{ id: 'id' }] }).api[method]('id', false)).ok, true);
    assert.equal((await setup({ error: { message: 'Denied' } }).api[method]('id', false)).ok, false);
  });
}
