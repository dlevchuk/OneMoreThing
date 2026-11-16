export const AUDIENCE = 'onemorething-wish-import';
export function authorizeWorker(claims) {
  if (claims.repository !== 'dlevchuk/OneMoreThing' || claims.repository_id !== '1392882954' ||
      claims.repository_owner_id !== '24205183' || claims.ref !== 'refs/heads/main' ||
      claims.workflow_ref !== 'dlevchuk/OneMoreThing/.github/workflows/add-wish.yml@refs/heads/main' ||
      !['schedule', 'workflow_dispatch', 'workflow_run'].includes(claims.event_name) ||
      typeof claims.run_id !== 'string' || !/^[1-9][0-9]{0,17}$/.test(claims.run_id)) throw new Error('Unauthorized worker');
}
export async function handleQueue(request, { verify, fetcher = fetch, supabaseUrl, serviceKey }) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  let claims;
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
    if (!token || token.length > 16000) throw new Error('Missing identity');
    claims = await verify(token);
    authorizeWorker(claims);
  } catch { return Response.json({ error: 'Unauthorized worker' }, { status: 403 }); }
  try {
    const text = await request.text();
    if (text.length > 4096) throw new Error('Request too large');
    const body = JSON.parse(text);
    let rpc, args;
    if (body.action === 'claim') { rpc = 'claim_wish_import'; args = { p_run_id: claims.run_id }; }
    else if (body.action === 'finish' && typeof body.id === 'string' && /^[a-f0-9-]{36}$/.test(body.id) && typeof body.success === 'boolean') {
      rpc = 'finish_wish_import'; args = { p_id: body.id, p_run_id: claims.run_id, p_success: body.success };
    } else return Response.json({ error: 'Invalid action' }, { status: 400 });
    if (!supabaseUrl || !serviceKey) throw new Error('Missing server configuration');
    const response = await fetcher(`${supabaseUrl}/rest/v1/rpc/${rpc}`, {
      method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Queue unavailable');
    return Response.json({ ok: true, result: await response.json() });
  } catch { return Response.json({ error: 'Queue unavailable' }, { status: 502 }); }
}
