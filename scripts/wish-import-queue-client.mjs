export async function queueCall(action, values = {}) {
  const base = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  if (!base || !process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error('Missing worker identity');
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience', 'onemorething-wish-import');
  const identity = await fetch(url, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, signal: AbortSignal.timeout(15000) });
  if (!identity.ok) throw new Error('Could not obtain worker identity');
  const { value: token } = await identity.json();
  if (typeof token !== 'string' || !token) throw new Error('Missing worker identity');
  console.log(`::add-mask::${token}`);
  const response = await fetch(`${base}/functions/v1/wish-import-queue`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...values }), signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Queue request failed (HTTP ${response.status})`);
  const body = await response.json();
  if (!body.ok) throw new Error('Queue request failed');
  return body.result;
}
