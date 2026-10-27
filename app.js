'use strict';

let wishes = [];
let activeFilter = 'want';
let searchQuery = '';

const grid = document.getElementById('wishlist-grid');
const emptyState = document.getElementById('empty-state');
const pageCount = document.getElementById('page-count');
const searchInput = document.getElementById('search-input');
const details = document.getElementById('quest-details');
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
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

function safeUrl(value = '') {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function filteredWishes() {
  const query = searchQuery.toLocaleLowerCase('uk');
  return wishes.filter(wish => {
    const matchesFilter = wish.priority === activeFilter;
    const matchesQuery = !query || `${wish.title} ${wish.description || ''}`.toLocaleLowerCase('uk').includes(query);
    return matchesFilter && matchesQuery;
  });
}

function buildCard(wish) {
  const image = safeUrl(wish.image);
  const priorityKey = wish.priority in PRIORITY_CONFIG ? wish.priority : 'want';
  const cfg = PRIORITY_CONFIG[priorityKey];
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
  details.innerHTML = `
    <div class="detail-topline"><span>⬡ CHIBA CITY / ДОСЬЄ</span><span>№ ${String(wishes.indexOf(wish) + 1).padStart(2, '0')}</span></div>
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
    </div>
  `;
}

function renderGrid() {
  const list = filteredWishes();
  const count = list.length;
  const ending = count === 1 ? 'контракт' : count > 1 && count < 5 ? 'контракти' : 'контрактів';
  pageCount.textContent = `${count} ${ending}`;
  emptyState.hidden = count !== 0;
  grid.hidden = count === 0;
  if (count && !list.some(wish => wish.id === selectedWishId)) selectedWishId = list[0].id || '';
  grid.innerHTML = list.map((wish, index) => `<article class="notice" role="listitem" style="--card-index:${index}" data-id="${escHtml(wish.id || '')}">${buildCard(wish)}</article>`).join('');
  const selectedWish = list.find(wish => wish.id === selectedWishId) || list[0];
  if (selectedWish) selectedWishId = selectedWish.id || '';
  renderDetails(selectedWish);
  grid.querySelectorAll('.notice-select').forEach(button => button.addEventListener('click', () => {
    const article = button.closest('.notice');
    selectedWishId = article.dataset.id;
    grid.querySelectorAll('.notice-select').forEach(btn => {
      const isSelected = btn.closest('.notice').dataset.id === selectedWishId;
      btn.classList.toggle('is-selected', isSelected);
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
    const currentList = filteredWishes();
    const currentSelectedWish = currentList.find(wish => wish.id === selectedWishId);
    renderDetails(currentSelectedWish);
  }));
}

document.querySelectorAll('.filter-btn').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.filter-btn').forEach(item => {
    const isActive = item === button;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  activeFilter = button.dataset.filter;
  renderGrid();
}));
searchInput.addEventListener('input', () => { searchQuery = searchInput.value.trim(); renderGrid(); });

function updateCategoryCounts() {
  ['want', 'nice', 'unsure'].forEach(category => {
    const count = wishes.filter(w => w.priority === category).length;
    const badge = document.querySelector(`[data-count-for="${category}"]`);
    if (badge) badge.textContent = count;
  });
}

function renderTicker() {
  const track = document.querySelector('.ticker-track');
  if (!track || !wishes.length) return;
  const titles = wishes
    .map(w => (typeof w.title === 'string' ? w.title.trim() : ''))
    .filter(Boolean);
  if (!titles.length) return;
  const content = titles.map(title => `${escHtml(title)} <b>◆</b>`).join(' ');
  track.innerHTML = `<span>${content}</span><span>${content}</span>`;
}

async function init() {
  try {
    const response = await fetch('data/wishes.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    wishes = Array.isArray(data) ? data.filter(item => item && typeof item.title === 'string') : [];
  } catch (error) {
    console.error('Не вдалося завантажити список бажань:', error);
    emptyState.querySelector('.empty-title').textContent = 'Зв’язок обірвався';
    emptyState.querySelector('.empty-sub').textContent = 'Перезавантаж сторінку пізніше. Мережа іноді зникає.';
  }
  updateCategoryCounts();
  renderTicker();
  renderGrid();
}

init();

