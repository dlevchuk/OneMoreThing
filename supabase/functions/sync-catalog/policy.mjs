export const REPOSITORY = 'dlevchuk/OneMoreThing';
export const AUDIENCE = 'onemorething-catalog-sync';
export const ISSUER = 'https://token.actions.githubusercontent.com';

export function authorizeClaims(claims) {
  if (claims.repository !== REPOSITORY || claims.repository_id !== '1392882954' ||
      claims.repository_owner_id !== '24205183' || claims.ref !== 'refs/heads/main' ||
      claims.workflow_ref !== `${REPOSITORY}/.github/workflows/deploy.yml@refs/heads/main` ||
      !['push', 'workflow_dispatch'].includes(claims.event_name) ||
      !(claims.environment === 'github-pages' || claims.sub === `repo:${REPOSITORY}:environment:github-pages`) ||
      typeof claims.sha !== 'string' || !/^[a-f0-9]{40}$/.test(claims.sha) ||
      typeof claims.run_id !== 'string' || !/^[1-9][0-9]{0,17}$/.test(claims.run_id)) {
    throw new Error('Workflow is not authorized');
  }
}

export function catalogIds(wishes) {
  if (!Array.isArray(wishes) || wishes.length < 1 || wishes.length > 500) throw new Error('Invalid catalog size');
  const ids = wishes.map(wish => wish?.id);
  if (ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error('Invalid catalog IDs');
  }
  return ids;
}

export async function syncCatalog(request, { verify, fetcher = fetch, supabaseUrl, serviceKey }) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!token || token.length > 16000) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let claims;
  try {
    claims = await verify(token);
    authorizeClaims(claims);
  } catch {
    return Response.json({ error: 'Unauthorized workflow' }, { status: 403 });
  }
  try {
    // The request body cannot supply IDs. Read only the immutable authenticated commit.
    const head = await fetcher(`https://api.github.com/repos/${REPOSITORY}/commits/main`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OneMoreThing-catalog-sync' },
      signal: AbortSignal.timeout(15000)
    });
    if (!head.ok) throw new Error('GitHub unavailable');
    if ((await head.json()).sha !== claims.sha) return Response.json({ error: 'Superseded commit' }, { status: 409 });
    const source = await fetcher(`https://raw.githubusercontent.com/${REPOSITORY}/${claims.sha}/data/wishes.json`, {
      signal: AbortSignal.timeout(15000)
    });
    if (!source.ok) throw new Error('Catalog unavailable');
    const text = await source.text();
    if (text.length > 500000) throw new Error('Catalog too large');
    const ids = catalogIds(JSON.parse(text));
    if (!supabaseUrl || !serviceKey) throw new Error('Missing server configuration');
    const result = await fetcher(`${supabaseUrl}/rest/v1/rpc/sync_gift_catalog`, {
      method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_ids: ids, p_run_id: claims.run_id, p_sha: claims.sha }),
      signal: AbortSignal.timeout(15000)
    });
    if (!result.ok) throw new Error('Database synchronization failed');
    const applied = await result.json();
    return Response.json({ ok: true, applied, count: ids.length, sha: claims.sha });
  } catch {
    // Never echo upstream errors, tokens, credentials, notes or database responses.
    return Response.json({ error: 'Catalog synchronization failed' }, { status: 502 });
  }
}
