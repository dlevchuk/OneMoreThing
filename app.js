'use strict';

let wishes = [];
let activeFilter = 'all';
let searchQuery = '';

const grid = document.getElementById('wishlist-grid');
const emptyState = document.getElementById('empty-state');
const pageCount = document.getElementById('page-count');
const searchInput = document.getElementById('search-input');
const details = document.getElementById('quest-details');
const PRIORITY_LABELS = { want: 'На радарі', nice: 'Було б файно', unsure: 'У сліпій зоні' };
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
    const matchesFilter = activeFilter === 'all' || wish.priority === activeFilter;
    const matchesQuery = !query || `${wish.title} ${wish.description || ''}`.toLocaleLowerCase('uk').includes(query);
    return matchesFilter && matchesQuery;
  });
}

function buildCard(wish) {
  const image = safeUrl(wish.image);
  const priority = PRIORITY_LABELS[wish.priority] || PRIORITY_LABELS.want;
  return `
    <button class="notice-select${wish.id === selectedWishId ? ' is-selected' : ''}" type="button" aria-pressed="${wish.id === selectedWishId}" aria-label="Відкрити досьє: ${escHtml(wish.title)}">
      ${image ? `<span class="notice-thumb"><img src="${escHtml(image)}" alt="" loading="lazy" /></span>` : '<span class="notice-thumb notice-thumb--empty" aria-hidden="true">✧</span>'}
      <span class="notice-copy">
      <span class="notice-priority notice-priority--${escHtml(wish.priority || 'want')}">${priority}</span>
        <span class="notice-title">${escHtml(wish.title)}</span>
      </span>
      <span class="notice-pin" aria-hidden="true">⬡</span>
    </button>`;
}

function renderDetails(wish) {
  if (!wish) {
    details.innerHTML = '<div class="details-empty"><span aria-hidden="true">✧</span><p>Передавач мовчить. Обери запис.</p></div>';
    return;
  }

  const image = safeUrl(wish.image);
  const originalUrl = safeUrl(wish.originalUrl);
  const localUrl = safeUrl(wish.localUrl);
  const priority = PRIORITY_LABELS[wish.priority] || PRIORITY_LABELS.want;
  details.innerHTML = `
    <div class="detail-topline"><span>⬡ CITY GRID / ДОСЬЄ</span><span>№ ${String(wishes.indexOf(wish) + 1).padStart(2, '0')}</span></div>
    ${image ? `<div class="detail-image"><img src="${escHtml(image)}" alt="${escHtml(wish.title)}" /></div>` : ''}
    <div class="detail-content">
      <span class="card-priority card-priority--${escHtml(wish.priority || 'want')}">${priority}</span>
      <h3 class="detail-title">${escHtml(wish.title)}</h3>
      <p class="detail-description">${escHtml(wish.description || 'Опису немає. Дані теж знають, коли треба мовчати.')}</p>
      <div class="detail-divider"><span>✦</span></div>
      <p class="detail-note">Перевір ціну й наявність перед переходом. У місті майбутнього цінники змінюються швидше за політичні гасла.</p>
      <div class="card-links detail-links">
        ${originalUrl ? `<a href="${escHtml(originalUrl)}" target="_blank" rel="noopener noreferrer" class="card-link-btn">Джерело</a>` : ''}
        ${localUrl ? `<a href="${escHtml(localUrl)}" target="_blank" rel="noopener noreferrer" class="card-link-btn card-link-btn--local">Місцева мережа</a>` : ''}
      </div>
    </div>
    <span class="detail-seal" aria-hidden="true">✦</span>`;
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
    renderGrid();
  }));
}

document.querySelectorAll('.filter-btn').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.filter-btn').forEach(item => item.classList.toggle('active', item === button));
  activeFilter = button.dataset.filter;
  renderGrid();
}));
searchInput.addEventListener('input', () => { searchQuery = searchInput.value.trim(); renderGrid(); });

async function init() {
  try {
    const response = await fetch('data/wishes.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    wishes = Array.isArray(data) ? data.filter(item => item && typeof item.title === 'string') : [];
  } catch (error) {
    console.error('Не вдалося завантажити список бажань:', error);
    emptyState.querySelector('.empty-title').textContent = 'Зв’язок обірвався';
    emptyState.querySelector('.empty-sub').textContent = 'Перезавантаж сторінку пізніше. Мережі теж іноді треба зникнути.';
  }
  renderGrid();
}

init();
