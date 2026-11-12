import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

function harness(elements = {}) {
  const requests = [];
  let realtime;
  const storage = new Map();
  const client = {
    from: () => ({ select: () => new Promise(resolve => requests.push(resolve)) }),
    channel: () => ({ on: (_type, _filter, callback) => {
      realtime = callback;
      return { subscribe() {} };
    } }),
    rpc: async () => ({ error: null })
  };
  const context = vm.createContext({
    window: { SUPABASE_CONFIG: { url: 'https://example.supabase.co', anonKey: 'public' }, supabase: { createClient: () => client } },
    document: { getElementById: id => elements[id] || null, querySelectorAll: () => [] },
    HTMLDialogElement: { prototype: { closedBy: 'any' } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    crypto: webcrypto, console
  });
  vm.runInContext(readFileSync(new URL('../js/booking.js', import.meta.url), 'utf8'), context);
  return { manager: context.window.BookingManager, requests, storage, client, update: () => realtime() };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const row = (name = 'guest') => ({ id: 'one', wish_id: 'gift', reserved_by: name, created_at: '2026-11-12' });

test('Realtime bursts serialize requests and converge on the newest state', async () => {
  const h = harness();
  const init = h.manager.init();
  h.requests.shift()({ data: [], error: null });
  await init;
  h.update(); h.update(); h.update();
  assert.equal(h.requests.length, 1);
  h.requests.shift()({ data: [row('old')], error: null });
  await flush();
  assert.equal(h.requests.length, 1);
  h.requests.shift()({ data: [row('new')], error: null });
  await flush();
  assert.equal(h.manager.getReservation('gift').reserved_by, 'new');
});

test('Unchanged snapshots do not notify; errors preserve the previous state', async () => {
  const h = harness();
  let updates = 0;
  h.manager.onUpdate(() => updates++);
  const init = h.manager.init();
  h.requests.shift()({ data: [row()], error: null });
  await init;
  assert.equal(updates, 1);
  h.update(); h.requests.shift()({ data: [row()], error: null });
  await flush();
  assert.equal(updates, 1);
  h.update(); h.requests.shift()({ error: new Error('test offline') });
  await flush();
  assert.equal(h.manager.getReservation('gift').reserved_by, 'guest');
  assert.equal(updates, 1);
});

test('Wrong-shaped localStorage JSON cannot crash token ownership', () => {
  const h = harness();
  for (const value of ['null', '[]', '42', '"text"', '{broken']) {
    h.storage.set('omg_my_bookings', value);
    assert.equal(h.manager.isMyBooking('gift'), false);
  }
});

test('An in-flight booking keeps its gift and rejects duplicate submissions', async () => {
  let submit;
  const button = {};
  const dialog = { showModal() {}, close() {} };
  const elements = {
    'booking-modal': dialog,
    'token-modal': dialog,
    'booking-form': { addEventListener: (_event, fn) => { submit = fn; }, querySelector: () => button },
    'booking-error': {}, 'booking-name': { value: '', focus() {} },
    'booking-modal-subtitle': {}, 'token-modal-subtitle': {}, 'token-code': {}
  };
  const h = harness(elements);
  const init = h.manager.init();
  h.requests.shift()({ data: [], error: null });
  await init;
  let finish;
  let calls = 0;
  h.client.rpc = async (_method, args) => {
    calls++;
    assert.equal(args.p_wish_id, 'first');
    await new Promise(resolve => { finish = resolve; });
    return { error: null };
  };
  h.manager.openBookingModal({ id: 'first', title: 'First gift' });
  elements['booking-name'].value = 'Guest';
  const pending = submit({ preventDefault() {} });
  h.manager.openBookingModal({ id: 'second', title: 'Second gift' });
  await submit({ preventDefault() {} });
  assert.equal(calls, 1);
  assert.equal(elements['booking-modal-subtitle'].textContent, 'First gift');
  finish();
  await flush();
  h.requests.shift()({ data: [{ ...row(), wish_id: 'first' }], error: null });
  await pending;
  assert.equal(elements['token-modal-subtitle'].textContent, 'First gift');
  assert.match(elements['token-code'].textContent, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(button.disabled, false);
});

test('Ownership refreshes when Realtime beats the reservation RPC response', async () => {
  const h = harness();
  const init = h.manager.init();
  h.requests.shift()({ data: [], error: null });
  await init;
  let finish;
  h.client.rpc = () => new Promise(resolve => { finish = resolve; });
  const ownership = [];
  h.manager.onUpdate(() => ownership.push(h.manager.isMyBooking('gift')));
  const pending = h.manager.reserve('gift', { name: 'guest' });
  h.update();
  h.requests.shift()({ data: [row()], error: null });
  await flush();
  assert.deepEqual(ownership, [false]);
  finish({ error: null });
  await flush();
  h.requests.shift()({ data: [row()], error: null });
  await pending;
  assert.deepEqual(ownership, [false, true]);
});
