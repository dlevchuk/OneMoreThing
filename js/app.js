'use strict';

let wishes = [];
let activeFilter = 'want';
let searchQuery = '';
let onlyAvailable = false;

const grid = document.getElementById('wishlist-grid');
const emptyState = document.getElementById('empty-state');
const pageCount = document.getElementById('page-count');
const searchInput = document.getElementById('search-input');
const details = document.getElementById('quest-details');
const toggleAvailable = document.getElementById('toggle-available-only');
const PRIORITY_CONFIG = {
  want: {
    label: 'Червона пігулка',
    sub: 'ICE-3 · КРИТИЧНИЙ',
    bars: '▮▮▮',
    ariaLabel: 'Найвищий пріоритет'
  },
  nice: {
    label: 'Чистий лід',
    sub: 'ICE-2 · СТАБІЛЬНИЙ',
    bars: '▮▮▯',
    ariaLabel: 'Середній пріоритет'
  },
  unsure: {
    label: 'Мертвий канал',
    sub: 'ICE-1 · БІЛИЙ ШУМ',
    bars: '▮▯▯',
    ariaLabel: 'Найнижчий пріоритет'
  }
};
let selectedWishId = '';

function escHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Відносні шляхи (img/...) резолвляться від поточної сторінки
function safeUrl(value = '') {
  if (!value) return '';
  try {
    const url = new URL(value, document.baseURI);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function isWishReserved(id) {
  return window.BookingManager ? window.BookingManager.isReserved(id) : false;
}

function filteredWishes() {
  const query = searchQuery.toLocaleLowerCase('uk');
  return wishes.filter(wish => {
    const matchesFilter = wish.priority === activeFilter;
    const matchesQuery = !query || `${wish.title} ${wish.description || ''}`.toLocaleLowerCase('uk').includes(query);
    const matchesAvailability = !onlyAvailable || !isWishReserved(wish.id);
    return matchesFilter && matchesQuery && matchesAvailability;
  });
}

function buildCard(wish) {
  const image = safeUrl(wish.image);
  const priorityKey = wish.priority in PRIORITY_CONFIG ? wish.priority : 'want';
  const cfg = PRIORITY_CONFIG[priorityKey];
  const isReserved = isWishReserved(wish.id);
  return `
    <button class="notice-select${wish.id === selectedWishId ? ' is-selected' : ''}" type="button" aria-pressed="${wish.id === selectedWishId}" aria-label="Відкрити досьє: ${escHtml(wish.title)}">
      ${image ? `<span class="notice-thumb"><img src="${escHtml(image)}" alt="" loading="lazy" /></span>` : '<span class="notice-thumb notice-thumb--empty" aria-hidden="true">✧</span>'}
      <span class="notice-copy">
        <span class="notice-priority notice-priority--${escHtml(priorityKey)}" aria-label="${cfg.label} (${cfg.ariaLabel})">
          <span class="ice-indicator" aria-hidden="true">
            <span class="ice-led ice-led--${escHtml(priorityKey)}"></span>
            <span class="ice-bars ice-bars--${escHtml(priorityKey)}">${cfg.bars}</span>
          </span>
          <span class="notice-priority-text">${cfg.label}</span>
        </span>
        <span class="notice-title">${escHtml(wish.title)}</span>
        ${isReserved ? `
          <span class="notice-status-tag" aria-label="Контракт закріплено">
            <span class="status-dot" aria-hidden="true"></span> ВЗЯТО
          </span>` : `
          <span class="notice-status-tag notice-status-tag--free" aria-label="Контракт вільний для взяття">
            <span class="status-dot" aria-hidden="true"></span> ВІЛЬНИЙ
          </span>`}
      </span>
    </button>`;
}

function renderDetails(wish) {
  if (!wish) {
    details.innerHTML = '<div class="details-empty"><span aria-hidden="true">✧</span><p>Лінія мовчить. Обери запис.</p></div>';
    return;
  }

  const image = safeUrl(wish.image);
  const originalUrl = safeUrl(wish.originalUrl);
  const localUrl = safeUrl(wish.localUrl);
  const priorityKey = wish.priority in PRIORITY_CONFIG ? wish.priority : 'want';
  const cfg = PRIORITY_CONFIG[priorityKey];
  const bookingWidget = window.BookingManager ? window.BookingManager.renderDetailWidget(wish) : '';

  details.innerHTML = `
    <div class="detail-topline"><span>⬡ МАТРИЦЯ / ДОСЬЄ</span><span>№ ${String(wishes.indexOf(wish) + 1).padStart(2, '0')}</span></div>
    ${image ? `<div class="detail-image"><img src="${escHtml(image)}" alt="${escHtml(wish.title)}" /></div>` : ''}
    <div class="detail-content">
      <span class="card-priority card-priority--${escHtml(priorityKey)}" aria-label="${cfg.label} (${cfg.ariaLabel})">
        <span class="ice-indicator" aria-hidden="true">
          <span class="ice-led ice-led--${escHtml(priorityKey)}"></span>
          <span class="ice-bars ice-bars--${escHtml(priorityKey)}">${cfg.bars}</span>
        </span>
        <span class="card-priority-name">${cfg.label}</span>
        <span class="card-priority-level">${cfg.sub}</span>
      </span>
      <h3 class="detail-title">${escHtml(wish.title)}</h3>
      <p class="detail-description">${escHtml(wish.description || 'Опису немає. Дані теж іноді мовчать.')}</p>
      <div class="detail-divider" aria-hidden="true"></div>
      <p class="detail-note">Перевір ціну й наявність перед переходом. У цьому місті цінники міняються швидше за прогнози.</p>
      <div class="card-links detail-links">
        ${originalUrl ? `<a href="${escHtml(originalUrl)}" target="_blank" rel="noopener noreferrer" class="card-link-btn">Джерело</a>` : ''}
        ${localUrl ? `<a href="${escHtml(localUrl)}" target="_blank" rel="noopener noreferrer" class="card-link-btn card-link-btn--local">Місцевий ринок</a>` : ''}
      </div>
      ${bookingWidget}
    </div>
  `;

  if (window.BookingManager) {
    window.BookingManager.attachDetailListeners(details, wish);
  }
}

function updateCategoryCounts() {
  ['want', 'nice', 'unsure'].forEach(category => {
    const count = wishes.filter(w => w.priority === category && (!onlyAvailable || !isWishReserved(w.id))).length;
    const badge = document.querySelector(`[data-count-for="${category}"]`);
    if (badge) badge.textContent = count;
  });
}

function renderGrid(animate = true) {
  const list = filteredWishes();
  const count = list.length;
  const ending = count === 1 ? 'контракт' : count > 1 && count < 5 ? 'контракти' : 'контрактів';
  pageCount.textContent = `${count} ${ending}`;
  emptyState.hidden = count !== 0;
  grid.hidden = count === 0;
  grid.classList.toggle('no-anim', !animate);
  if (count && !list.some(wish => wish.id === selectedWishId)) selectedWishId = list[0].id || '';
  grid.innerHTML = list.map((wish, index) => {
    const isReserved = isWishReserved(wish.id);
    return `<article class="notice${isReserved ? ' is-reserved' : ''}" role="listitem" style="--card-index:${index}" data-id="${escHtml(wish.id || '')}">${buildCard(wish)}</article>`;
  }).join('');
  const selectedWish = list.find(wish => wish.id === selectedWishId) || list[0];
  if (selectedWish) selectedWishId = selectedWish.id || '';
  renderDetails(selectedWish);
  updateCategoryCounts();
}

// Один listener на grid замість перевішування при кожному рендері
grid.addEventListener('click', event => {
  const button = event.target.closest('.notice-select');
  if (!button) return;
  selectedWishId = button.closest('.notice').dataset.id;
  grid.querySelectorAll('.notice-select').forEach(btn => {
    const isSelected = btn.closest('.notice').dataset.id === selectedWishId;
    btn.classList.toggle('is-selected', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
  renderDetails(filteredWishes().find(wish => wish.id === selectedWishId));
  if (window.innerWidth <= 768 && details) {
    details.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

document.querySelectorAll('.filter-btn').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.filter-btn').forEach(item => {
    const isActive = item === button;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  activeFilter = button.dataset.filter;
  renderGrid();
}));
searchInput.addEventListener('input', () => { searchQuery = searchInput.value.trim(); renderGrid(false); });

async function init() {
  try {
    const response = await fetch('data/wishes.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const seen = new Set();
    wishes = (Array.isArray(data) ? data : [])
      .filter(item => item && typeof item.title === 'string')
      .map((item, i) => {
        let id = item.id || `wish-${i}`;
        while (seen.has(id)) id += `-${i}`;
        seen.add(id);
        return { ...item, id, priority: item.priority in PRIORITY_CONFIG ? item.priority : 'unsure' };
      });
  } catch (error) {
    console.error('Не вдалося завантажити список бажань:', error);
    emptyState.querySelector('.empty-title').textContent = 'Зв’язок обірвався';
    emptyState.querySelector('.empty-sub').textContent = 'Перезавантаж сторінку пізніше. Мережа іноді зникає.';
  }
  if (toggleAvailable) {
    toggleAvailable.addEventListener('change', () => {
      onlyAvailable = toggleAvailable.checked;
      renderGrid();
    });
  }

  if (window.BookingManager) {
    await window.BookingManager.init();
    window.BookingManager.onUpdate(() => renderGrid(false));
  }

  renderGrid();
}

init();