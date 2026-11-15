import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

async function monitor(data, ok = true) {
  const context = vm.createContext({ window: {}, fetch: async () => ({ ok, json: async () => data }), Intl, Date, AbortController, setTimeout, clearTimeout });
  vm.runInContext(readFileSync(new URL('../js/prices.js', import.meta.url), 'utf8'), context);
  await context.window.PriceMonitor.init();
  return context.window.PriceMonitor;
}
const now = Date.parse('2026-11-15T12:00:00Z');
const observation = { price: 1200, currency: 'UAH', checkedAt: '2026-11-15T11:00:00Z', availability: 'in_stock' };

test('fresh price and stock; old or failed checks require verification', async () => {
  const m = await monitor({ fresh: observation, old: { ...observation, checkedAt: '2026-11-01' }, failed: { ...observation, checkFailed: true } });
  assert.equal(m.describe('fresh', now).stock, 'Є в наявності');
  assert.equal(m.describe('fresh', now).stale, false);
  assert.equal(m.describe('old', now).stale, true);
  assert.equal(m.describe('failed', now).stock, 'Наявність потребує перевірки');
});
test('missing endpoint and malformed observations do not affect wishlist', async () => {
  assert.equal((await monitor({}, false)).describe('gift', now), null);
  for (const bad of [{ ...observation, price: -1 }, { ...observation, currency: 'USD' }, { ...observation, checkedAt: 'invalid' }, { ...observation, checkedAt: '2030-01-01' }]) {
    assert.equal((await monitor({ gift: bad })).describe('gift', now), null);
  }
});
