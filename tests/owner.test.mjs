import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function harness({ allowed = true, session = true, userError = null, href = 'https://example.com/project/owner.html', exchangeError = null } = {}) {
  const calls = [];
  let callback;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: session ? {} : null } }),
      getUser: async () => ({ data: { user: userError ? null : { id: 'user' } }, error: userError }),
      onAuthStateChange: fn => { callback = fn; },
      signInWithOtp: async args => { calls.push(['otp', args]); return {}; },
      verifyOtp: async args => { calls.push(['verify', args]); return {}; },
      exchangeCodeForSession: async code => { calls.push(['exchange', code]); return { error: exchangeError }; },
      signOut: async () => { calls.push(['signout']); callback?.('SIGNED_OUT'); return {}; }
    },
    rpc: async (name, args) => { calls.push([name, args]); return { data: name === 'is_site_owner' ? allowed : null }; }
  };
  const context = vm.createContext({ window: { SiteClient: { getClient: () => client }, location: { href }, history: { replaceState: (_state, _title, url) => calls.push(['history', url]) } }, URL, setTimeout });
  vm.runInContext(readFileSync(new URL('../js/owner.js', import.meta.url), 'utf8'), context);
  return { manager: context.window.OwnerManager, calls, client };
}

test('Local sessions alone never confer owner access', async () => {
  const h = harness({ userError: new Error('invalid JWT') });
  await h.manager.init();
  assert.equal(h.manager.isOwner, false);
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.manager.setCompleted('gift', true), /Увійди/);
});

test('Requests links only for existing users and fixes the callback URL', async () => {
  const h = harness();
  await h.manager.requestLink('owner@example.com');
  const call = h.calls.find(([name]) => name === 'otp')[1];
  assert.equal(call.options.shouldCreateUser, false);
  assert.equal(call.options.emailRedirectTo, 'https://example.com/project/owner.html');
  assert.equal(h.manager.isOwner, true);
});

test('Authenticated nonowners cannot use owner mutations', async () => {
  const h = harness({ allowed: false });
  await h.manager.init();
  await assert.rejects(h.manager.setCompleted('gift', true), /Увійди/);
  assert.equal(h.manager.isOwner, false);
  assert.ok(!h.calls.some(([name]) => name === 'set_gift_completed'));
});

test('Owner mutations use the guarded RPC; signout clears controls', async () => {
  const h = harness();
  await h.manager.init();
  await h.manager.setCompleted('gift', true, 'Thank you');
  const args = h.calls.find(([name]) => name === 'set_gift_completed')[1];
  assert.equal(args.p_wish_id, 'gift');
  assert.equal(args.p_completed, true);
  await h.manager.signOut();
  assert.equal(h.manager.isOwner, false);
  await assert.rejects(h.manager.setCompleted('gift', false), /Увійди/);
});

test('PKCE callback exchanges code once and removes it from the URL', async () => {
  const h = harness({ href: 'https://example.com/project/owner.html?code=one-time-code' });
  await h.manager.init();
  await h.manager.init();
  assert.equal(h.calls.filter(([name]) => name === 'exchange').length, 1);
  assert.equal(h.calls.find(([name]) => name === 'history')[1], '/project/owner.html');
  assert.equal(h.manager.isOwner, true);
});

test('Invalid callbacks and nonowners cannot finish login', async () => {
  const invalid = harness({ href: 'https://example.com/project/owner.html?code=expired', exchangeError: new Error('expired') });
  await assert.rejects(invalid.manager.init(), /Не вдалося використати/);
  assert.equal(invalid.manager.isOwner, false);
  const outsider = harness({ href: 'https://example.com/project/owner.html?code=valid', allowed: false });
  await assert.rejects(outsider.manager.init(), /не має доступу/);
  assert.ok(outsider.calls.some(([name]) => name === 'signout'));
});
