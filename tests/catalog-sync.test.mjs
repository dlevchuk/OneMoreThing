import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeClaims, catalogIds, syncCatalog } from '../supabase/functions/sync-catalog/policy.mjs';

const claims = { repository: 'dlevchuk/OneMoreThing', repository_id: '1392882954', repository_owner_id: '24205183',
  ref: 'refs/heads/main', workflow_ref: 'dlevchuk/OneMoreThing/.github/workflows/deploy.yml@refs/heads/main',
  event_name: 'push', sub: 'repo:dlevchuk/OneMoreThing:environment:github-pages', sha: 'a'.repeat(40), run_id: '1234' };
const request = () => new Request('https://example.com', { method: 'POST', headers: { Authorization: 'Bearer signed-token' },
  body: JSON.stringify({ p_ids: ['attacker-controlled'] }) });

test('trust only the correct repository, owner, branch, workflow and deployment environment', () => {
  authorizeClaims(claims);
  for (const change of [{ repository_id: '1' }, { repository_owner_id: '1' }, { ref: 'refs/pull/1/merge' },
    { workflow_ref: 'other' }, { sub: 'repo:dlevchuk/OneMoreThing:ref:refs/heads/main' }, { sha: '../main' }, { run_id: '-1' }]) {
    assert.throws(() => authorizeClaims({ ...claims, ...change }));
  }
});
test('catalog IDs must be nonempty, bounded, unique and valid', () => {
  assert.deepEqual(catalogIds([{ id: 'gift-1' }]), ['gift-1']);
  for (const bad of [[], [{ id: 'a' }, { id: 'a' }], [{ id: "x');drop table" }], Array.from({ length: 501 }, (_, i) => ({ id: String(i) }))]) {
    assert.throws(() => catalogIds(bad));
  }
});
test('invalid signatures cannot reach GitHub or the database', async () => {
  const response = await syncCatalog(request(), { verify: async () => { throw new Error('bad signature'); },
    fetcher: () => assert.fail('Unauthorized request reached upstream') });
  assert.equal(response.status, 403);
});
test('ignore submitted IDs and synchronize only the authenticated immutable main commit', async () => {
  const calls = [];
  const response = await syncCatalog(request(), { verify: async () => claims, supabaseUrl: 'https://project.supabase.co', serviceKey: 'server-only',
    fetcher: async (url, options) => {
      calls.push([url, options]);
      if (url.includes('/commits/main')) return Response.json({ sha: claims.sha });
      if (url.includes('/data/wishes.json')) return Response.json([{ id: 'real-gift' }]);
      const body = JSON.parse(options.body);
      assert.deepEqual(body, { p_ids: ['real-gift'], p_run_id: '1234', p_sha: claims.sha });
      return Response.json(true);
    } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).count, 1);
  assert.match(calls[1][0], new RegExp(claims.sha));
});
test('old workflows and invalid catalogs never reach the database', async () => {
  for (const invalidCatalog of [false, true]) {
    const response = await syncCatalog(request(), { verify: async () => claims, supabaseUrl: 'https://project.supabase.co', serviceKey: 'server-only',
      fetcher: async url => {
        if (url.includes('/commits/main')) return Response.json({ sha: invalidCatalog ? claims.sha : 'b'.repeat(40) });
        if (url.includes('/data/wishes.json')) return Response.json([{ id: 'duplicate' }, { id: 'duplicate' }]);
        assert.fail('Invalid catalog reached database');
      } });
    assert.equal(response.status, invalidCatalog ? 502 : 409);
  }
});
