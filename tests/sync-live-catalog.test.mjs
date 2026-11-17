import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncLiveCatalog } from '../scripts/sync-live-catalog.mjs';
import { syncCatalog } from '../supabase/functions/sync-catalog/policy.mjs';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const claims = { repository: 'dlevchuk/OneMoreThing', repository_id: '1392882954', repository_owner_id: '24205183',
  ref: 'refs/heads/main', workflow_ref: 'dlevchuk/OneMoreThing/.github/workflows/deploy.yml@refs/heads/main',
  event_name: 'push', sub: 'repo:dlevchuk/OneMoreThing:environment:github-pages', sha: OLD, run_id: '1234' };

// The real Edge Function policy, wired to a fake GitHub (head of main) and a fake database RPC.
function world({ head, rpcApplies = true, rpcOk = true }) {
  const edge = request => syncCatalog(request, {
    verify: async () => claims, supabaseUrl: 'https://project.supabase.co', serviceKey: 'server-only',
    fetcher: async url => {
      if (url.includes('/commits/main')) return Response.json({ sha: head });
      if (url.includes('/data/wishes.json')) return Response.json([{ id: 'gift' }]);
      return rpcOk ? Response.json(rpcApplies) : new Response('boom', { status: 500 });
    }
  });
  return async (url, options) => String(url).startsWith('https://token.test/')
    ? Response.json({ value: 'signed-token' })
    : edge(new Request(String(url), options));
}
function run(fetcher) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-'));
  const output = join(dir, 'output');
  writeFileSync(output, '');
  const env = { SUPABASE_URL: 'https://project.supabase.co', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.test/id?x=1',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token', GITHUB_OUTPUT: output };
  return { promise: syncLiveCatalog({ env, fetcher, log: () => {} }), output: () => readFileSync(output, 'utf8') };
}

test('current commit synchronizes the catalog and may publish', async () => {
  const r = run(world({ head: OLD }));
  assert.equal((await r.promise).superseded, false);
  assert.equal(r.output(), 'superseded=false\n');
});
test('older run re-triggered after a newer deploy finished: HTTP 409, no publishing, no failure', async () => {
  const r = run(world({ head: NEW }));
  const result = await r.promise;
  assert.equal(result.superseded, true);
  assert.match(result.reason, /newer commit/);
  assert.equal(r.output(), 'superseded=true\n');
});
test('same commit but a newer run already owns the catalog: stale run does not publish', async () => {
  const r = run(world({ head: OLD, rpcApplies: false }));
  assert.equal((await r.promise).superseded, true);
  assert.equal(r.output(), 'superseded=true\n');
});
test('real server failures still fail the deployment', async () => {
  await assert.rejects(run(world({ head: OLD, rpcOk: false })).promise, /HTTP 502/);
});

test('workflow publishes only when the run is not superseded', () => {
  const text = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const steps = text.split(/\n      - /).slice(1);
  const byName = name => steps.find(step => step.includes(`name: ${name}`));
  assert.match(byName('Synchronize live booking catalog'), /id: catalog/);
  for (const name of ['Build site into dist/', 'Upload Pages artifact', 'Deploy to GitHub Pages']) {
    assert.match(byName(name), /if: steps\.catalog\.outputs\.superseded != 'true'/, name);
  }
});
