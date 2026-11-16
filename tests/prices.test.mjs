import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

async function monitor(data, ok = true, history = {}) {
  const context = vm.createContext({ window: {}, fetch: async url => ({ ok, json: async () => url.includes('price-history') ? history : data }), Intl, Date, AbortController, setTimeout, clearTimeout });
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
  for (const bad of [{ ...observation, price: -1 }, { ...observation, currency: 'invalid' }, { ...observation, checkedAt: 'invalid' }, { ...observation, checkedAt: '2030-01-01' }]) {
    assert.equal((await monitor({ gift: bad })).describe('gift', now), null);
  }
});

test('source currency is displayed without conversion', async () => {
  const m = await monitor({ usd: { ...observation, currency: 'USD' } });
  assert.match(m.describe('usd', now).price, /USD|\$/);
});

test('tax-exclusive source price remains explicitly labeled', async () => {
  const m = await monitor({ net: { ...observation, currency: 'EUR', taxIncluded: false }, gross: { ...observation, taxIncluded: true } });
  assert.match(m.describe('net', now).price, /без ПДВ/);
  assert.doesNotMatch(m.describe('gross', now).price, /без ПДВ/);
});

test('chart draws real points and filters other currencies and sources', async () => {
  const item = { ...observation, url: 'https://source.example' };
  const m = await monitor({ gift: item }, true, { gift: [
    { ...item, price: 100, checkedAt: '2026-11-15T10:00:00Z' },
    { ...item, price: 200 },
    { ...item, price: 9999, currency: 'USD' },
    { ...item, price: 9999, url: 'https://other.example' }
  ] });
  const chart = m.chart('gift', now);
  assert.match(chart, /<polyline/);
  assert.equal((chart.match(/<circle /g) || []).length, 2);
  assert.doesNotMatch(chart, /9999/);
  assert.match(chart, /2 спостережень/);
});
test('one real point is honest and malicious history data is ignored', async () => {
  const item = { ...observation, url: 'https://source.example' };
  const m = await monitor({ gift: item }, true, { gift: [item, { ...item, price: '<script>' }, { ...item, checkedAt: 'invalid' }] });
  const chart = m.chart('gift', now);
  assert.match(chart, /Перше спостереження/);
  assert.equal((chart.match(/<circle /g) || []).length, 1);
  assert.doesNotMatch(chart, /<script>/);
});
