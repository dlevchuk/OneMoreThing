import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0';
import { AUDIENCE, ISSUER, syncCatalog } from './policy.mjs';

const keys = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
Deno.serve((request: Request) => syncCatalog(request, {
  verify: async (token: string) => (await jwtVerify(token, keys, {
    issuer: ISSUER, audience: AUDIENCE, algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub', 'sha', 'run_id'], maxTokenAge: '10m', clockTolerance: 5,
  })).payload,
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
}));
