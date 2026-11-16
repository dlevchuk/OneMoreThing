// GitHub OIDC is short-lived; no database/service-role credentials are used in CI.
const audience = 'onemorething-catalog-sync';
const base = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
if (!base || !process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
  throw new Error('Catalog sync requires the Supabase URL and a GitHub Actions OIDC job');
}
const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
url.searchParams.set('audience', audience);
const identity = await fetch(url, {
  headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  signal: AbortSignal.timeout(15000)
});
if (!identity.ok) throw new Error('Could not obtain workflow identity');
const { value: token } = await identity.json();
if (typeof token !== 'string' || !token) throw new Error('Missing workflow identity');
console.log(`::add-mask::${token}`);
const result = await fetch(`${base}/functions/v1/sync-catalog`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000)
});
if (!result.ok) throw new Error(`Catalog synchronization failed (HTTP ${result.status}); deployment stopped`);
const summary = await result.json();
if (!summary.ok) throw new Error('Catalog synchronization did not complete');
console.log(`Catalog synchronized: ${summary.count} gifts; applied=${summary.applied}`);
