'use strict';

window.PriceMonitor = (() => {
  let observations = {};
  function describe(id, now = Date.now()) {
    const item = observations[id];
    if (!item || typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price <= 0 || typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency)) return null;
    const checked = Date.parse(item.checkedAt);
    if (!Number.isFinite(checked) || checked > now + 300000) return null;
    const stale = Boolean(item.checkFailed) || now - checked > 24 * 60 * 60 * 1000;
    return {
      price: new Intl.NumberFormat('uk-UA', { style: 'currency', currency: item.currency }).format(item.price),
      stock: stale ? 'Наявність потребує перевірки' : ({ in_stock: 'Є в наявності', out_of_stock: 'Немає в наявності' }[item.availability] || 'Наявність невідома'),
      checked: new Date(checked).toLocaleString('uk-UA'),
      stale, store: typeof item.store === 'string' ? item.store : '',
      url: typeof item.url === 'string' ? item.url : ''
    };
  }
  async function init() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('data/prices.json', { cache: 'no-cache', signal: controller.signal });
      if (!response.ok) return;
      const data = await response.json();
      if (data && typeof data === 'object' && !Array.isArray(data)) observations = data;
    } catch { /* The wishlist also works when monitoring is unavailable. */ }
    finally { clearTimeout(timeout); }
  }
  return { init, describe };
})();
