'use strict';

let wishes = [];
let activeFilter = 'all';
let searchQuery = '';

const grid = document.getElementById('wishlist-grid');
const emptyState = document.getElementById('empty-state');
const pageCount = document.getElementById('page-count');
const searchInput = document.getElementById('search-input');

const PRIORITY_LABELS = { want: 'Хочу', nice: 'Було б добре', unsure: 'Не певен' };

function escHtml(value = '') {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

function safeUrl(value = '') {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
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
  const originalUrl = safeUrl(wish.originalUrl);
  const localUrl = safeUrl(wish.localUrl);
  const priority = PRIORITY_LABELS[wish.priority] || PRIORITY_LABELS.want;
  return `
    ${image
      ? `<div class="card-image"><img src="${escHtml(image)}" alt="${escHtml(wish.title)}" loading="lazy" /></div>`
      : '<div class="card-image card-image--empty"><span>без фото</span></div>'}
    <div class="card-body">
      <span class="card-priority card-priority--${escHtml(wish.priority || 'want')}">${priority}</span>
      <p class="card-title">${escHtml(wish.title)}</p>
      ${wish.description ? `<p class="card-description">${escHtml(wish.description)}</p>` : ''}
      <div class="card-footer">
        <div class="card-links">
          ${originalUrl ? `<a href="${escHtml(originalUrl)}" target="_blank" rel="noopener noreferrer" class="card-link-btn">↗ Офіційний сайт</a>` : ''}
          ${localUrl ? `<a href="${escHtml(localUrl)}" target="_blank" rel="noopener noreferrer" class="card-link-btn card-link-btn--local">↗ Локальний ринок</a>` : ''}
        </div>
      </div>
    </div>`;
}

function renderGrid() {
  const list = filteredWishes();
  const count = list.length;
  pageCount.textContent = `${count} ${count === 1 ? 'річ' : count > 1 && count < 5 ? 'речі' : 'речей'}`;
  emptyState.hidden = count !== 0;
  grid.hidden = count === 0;
  grid.innerHTML = list.map((wish, index) => `
    <article class="wish-card" role="listitem" style="--card-index:${index}" data-id="${escHtml(wish.id || '')}">
      ${buildCard(wish)}
    </article>`).join('');
}

document.querySelectorAll('.filter-btn').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(item => item.classList.toggle('active', item === button));
    activeFilter = button.dataset.filter;
    renderGrid();
  });
});

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  renderGrid();
});

async function init() {
  try {
    const response = await fetch('data/wishes.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    wishes = Array.isArray(data) ? data.filter(item => item && typeof item.title === 'string') : [];
  } catch (error) {
    console.error('Не вдалося завантажити список бажань:', error);
    emptyState.querySelector('.empty-title').textContent = 'Не вдалося завантажити список';
    emptyState.querySelector('.empty-sub').textContent = 'Спробуй оновити сторінку трохи пізніше.';
  }
  renderGrid();
}

init();
