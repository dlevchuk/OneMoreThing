import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeWorker, handleQueue } from '../supabase/functions/wish-import-queue/policy.mjs';
const claims = { repository: 'dlevchuk/OneMoreThing', repository_id: '1392882954', repository_owner_id: '24205183',
  ref: 'refs/heads/main', workflow_ref: 'dlevchuk/OneMoreThing/.github/workflows/add-wish.yml@refs/heads/main',
  event_name: 'schedule', run_id: '1234' };
const request = body => new Request('https://example.com', { method: 'POST', headers: { Authorization: 'Bearer signed-token' }, body: JSON.stringify(body) });
test('only the trusted import worker can claim requests', () => {
  authorizeWorker(claims);
  for (const change of [{ repository_id: '1' }, { ref: 'refs/pull/1/merge' }, { workflow_ref: 'other' }, { event_name: 'pull_request' }]) {
    assert.throws(() => authorizeWorker({ ...claims, ...change }));
  }
});
test('browser tokens or invalid signatures never reach queue storage', async () => {
  const response = await handleQueue(request({ action: 'claim' }), { verify: async () => { throw new Error('Not a GitHub identity'); }, fetcher: () => assert.fail('Reached storage') });
  assert.equal(response.status, 403);
});
test('claim binds the lease to the signed run ID, not an input', async () => {
  const response = await handleQueue(request({ action: 'claim', run_id: 'attacker' }), {
    verify: async () => claims, supabaseUrl: 'https://project.supabase.co', serviceKey: 'server-only',
    fetcher: async (url, options) => {
      assert.match(url, /\/rpc\/claim_wish_import$/);
      assert.deepEqual(JSON.parse(options.body), { p_run_id: '1234' });
      return Response.json(null);
    }
  });
  assert.deepEqual(await response.json(), { ok: true, result: null });
});
test('finish cannot supply another run identity or arbitrary RPC', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const response = await handleQueue(request({ action: 'finish', id, success: false, run_id: 'other' }), {
    verify: async () => claims, supabaseUrl: 'https://project.supabase.co', serviceKey: 'server-only',
    fetcher: async (url, options) => {
      assert.match(url, /\/rpc\/finish_wish_import$/);
      assert.deepEqual(JSON.parse(options.body), { p_id: id, p_run_id: '1234', p_success: false });
      return Response.json(true);
    }
  });
  assert.equal(response.status, 200);
  assert.equal((await handleQueue(request({ action: 'arbitrary' }), { verify: async () => claims })).status, 400);
});
