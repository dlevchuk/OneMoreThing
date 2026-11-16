import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0';
import { AUDIENCE, handleQueue } from './policy.mjs';
const keys = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
Deno.serve((request: Request) => handleQueue(request, {
  verify: async (token: string) => (await jwtVerify(token, keys, {
    issuer: 'https://token.actions.githubusercontent.com', audience: AUDIENCE, algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub', 'run_id'], maxTokenAge: '10m', clockTolerance: 5,
  })).payload,
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
}));
