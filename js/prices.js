'use strict';

window.PriceMonitor = (() => {
  let observations = {};
  let history = {};
  const escape = value => String(value).replace(/[&<>"\']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "\'":"&#39;"}[c]));
  function describe(id, now = Date.now()) {
    const item = observations[id];
    if (!item || typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price <= 0 || typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency)) return null;
    const checked = Date.parse(item.checkedAt);
    if (!Number.isFinite(checked) || checked > now + 300000) return null;
    const stale = Boolean(item.checkFailed) || now - checked > 24 * 60 * 60 * 1000;
    return {
      price: new Intl.NumberFormat('uk-UA', { style: 'currency', currency: item.currency }).format(item.price) + (item.taxIncluded === false ? ' · без ПДВ' : ''),
      stock: stale ? 'Наявність потребує перевірки' : ({ in_stock: 'Є в наявності', out_of_stock: 'Немає в наявності' }[item.availability] || 'Наявність невідома'),
      checked: new Date(checked).toLocaleString('uk-UA'),
      stale, store: typeof item.store === 'string' ? item.store : '',
      url: typeof item.url === 'string' ? item.url : ''
    };
  }
  function chart(id, now = Date.now()) {
    const item = observations[id];
    if (!describe(id, now)) return '';
    const points = (Array.isArray(history[id]) ? history[id] : []).filter(point =>
      point && point.url === item.url && point.currency === item.currency && point.taxIncluded === item.taxIncluded &&
      typeof point.price === 'number' && Number.isFinite(point.price) && point.price > 0 &&
      Number.isFinite(Date.parse(point.checkedAt)) && Date.parse(point.checkedAt) <= now + 300000
    ).slice(-730).sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
    if (!points.length) return '<p class="price-history-empty">Історія цін почне накопичуватися з наступної перевірки.</p>';
    const prices = points.map(point => point.price);
    const minimum = Math.min(...prices), maximum = Math.max(...prices);
    const first = Date.parse(points[0].checkedAt), last = Date.parse(points.at(-1).checkedAt);
    const span = Math.max(maximum - minimum, maximum * .02, 1);
    const lower = minimum - span * .1, upper = maximum + span * .1;
    const x = point => last === first ? 260 : 60 + (Date.parse(point.checkedAt) - first) / (last - first) * 400;
    const y = point => 130 - (point.price - lower) / (upper - lower) * 105;
    const number = value => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(value);
    const date = value => new Date(value).toLocaleDateString('uk-UA');
    const coordinates = points.map(point => `${x(point).toFixed(2)},${y(point).toFixed(2)}`).join(' ');
    const labels = points.map(point => `<circle cx="${x(point).toFixed(2)}" cy="${y(point).toFixed(2)}" r="3"><title>${escape(date(point.checkedAt))}: ${escape(number(point.price))} ${escape(item.currency)}</title></circle>`).join('');
    return `<figure class="price-history"><figcaption>Історія ціни · ${escape(item.currency)}${item.taxIncluded === false ? ' · без ПДВ' : ''}</figcaption>
      <svg viewBox="0 0 480 170" role="img" aria-label="Історія ціни: від ${escape(number(minimum))} до ${escape(number(maximum))} ${escape(item.currency)}; ${points.length} спостережень">
        <path class="price-chart-grid" d="M60 25H460 M60 130H460" />
        <text x="4" y="30">${escape(number(maximum))}</text><text x="4" y="135">${escape(number(minimum))}</text>
        <polyline fill="none" points="${coordinates}" />${labels}
        <text x="60" y="160">${escape(date(first))}</text>${last !== first ? `<text x="460" y="160" text-anchor="end">${escape(date(last))}</text>` : ''}
      </svg><p>${points.length === 1 ? 'Перше спостереження. Графік доповнюватиметься після перевірок.' : `${points.length} спостережень · мін. ${escape(number(minimum))}, макс. ${escape(number(maximum))} ${escape(item.currency)}`}</p></figure>`;
  }
  async function init() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      await Promise.allSettled([
        ['data/prices.json', value => { observations = value; }],
        ['data/price-history.json', value => { history = value; }]
      ].map(async ([url, save]) => {
        const response = await fetch(url, { cache: 'no-cache', signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (data && typeof data === 'object' && !Array.isArray(data)) save(data);
      }));
    } catch { /* The wishlist also works when monitoring is unavailable. */ }
    finally { clearTimeout(timeout); }
  }
  return { init, describe, chart };
})();
