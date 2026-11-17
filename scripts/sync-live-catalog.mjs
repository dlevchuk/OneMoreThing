// GitHub OIDC is short-lived; no database/service-role credentials are used in CI.
// A stale run (newer commit on main, or a newer deploy already synchronized the catalog)
// must NOT publish the site: it reports `superseded=true` and the workflow skips build/deploy.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const AUDIENCE = 'onemorething-catalog-sync';

export async function syncLiveCatalog({ env = process.env, fetcher = fetch, log = console.log } = {}) {
  const base = env.SUPABASE_URL?.trim().replace(/\/$/, '');
  if (!base || !env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error('Catalog sync requires the Supabase URL and a GitHub Actions OIDC job');
  }
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience', AUDIENCE);
  const identity = await fetcher(url, {
    headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    signal: AbortSignal.timeout(15000)
  });
  if (!identity.ok) throw new Error('Could not obtain workflow identity');
  const { value: token } = await identity.json();
  if (typeof token !== 'string' || !token) throw new Error('Missing workflow identity');
  log(`::add-mask::${token}`);
  const result = await fetcher(`${base}/functions/v1/sync-catalog`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000)
  });

  let reason = '';
  if (result.status === 409) {
    reason = 'a newer commit is already on main';
  } else {
    if (!result.ok) throw new Error(`Catalog synchronization failed (HTTP ${result.status}); deployment stopped`);
    const summary = await result.json();
    if (!summary.ok) throw new Error('Catalog synchronization did not complete');
    if (summary.applied === false) reason = 'a newer deploy has already synchronized the catalog';
    else log(`Catalog synchronized: ${summary.count} gifts; applied=${summary.applied}`);
  }

  const superseded = Boolean(reason);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `superseded=${superseded}\n`);
  if (superseded) {
    log(`::warning::Stale deploy: ${reason}. The site will not be published by this run.`);
    if (env.GITHUB_STEP_SUMMARY) {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `### Deploy skipped\nThis run is stale (${reason}). Nothing was published.\n`);
    }
  }
  return { superseded, reason };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await syncLiveCatalog();
}
