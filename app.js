/* ===== OneMoreThing — app.js =====
   Wishlist logic: CRUD, localStorage, filtering, search
================================================== */

'use strict';

// ── State ──────────────────────────────────────────────────
const STORAGE_KEY = 'omt_wishes_v1';
let wishes = [];
let editingId = null;
let activeFilter = 'all';
let searchQuery = '';

// ── DOM refs ───────────────────────────────────────────────
const modal        = document.getElementById('wish-modal');
const form         = document.getElementById('wish-form');
const grid         = document.getElementById('wishlist-grid');
const emptyState   = document.getElementById('empty-state');

const modalTitle   = document.getElementById('modal-title');
const submitLabel  = document.getElementById('submit-label');

const titleInput   = document.getElementById('wish-title');
const descInput    = document.getElementById('wish-desc');
const linkInput    = document.getElementById('wish-link');
const priceInput   = document.getElementById('wish-price');
const currencyInput= document.getElementById('wish-currency');
const priorityInput= document.getElementById('wish-priority');
const emojiInput   = document.getElementById('wish-emoji');
const priorityDisp = document.getElementById('priority-display');

const titleCount   = document.getElementById('title-count');
const descCount    = document.getElementById('desc-count');

const statTotal    = document.getElementById('stat-total-num');
const statDream    = document.getElementById('stat-dream-num');
const statDone     = document.getElementById('stat-done-num');

const searchInput  = document.getElementById('search-input');

// ── Storage ────────────────────────────────────────────────
function load() {
  try {
    wishes = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    wishes = [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wishes));
}

// ── Helpers ────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escHtml(str) {
  const el = document.createElement('div');
  el.textContent = str;
  return el.innerHTML;
}

const PRIORITY_STARS = ['', '⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'];
const CATEGORY_LABELS = { want: '🛍️ Хочу', dream: '🌠 Мрію', done: '✅ Здійснилось' };
const CURRENCY_SYMBOLS = { UAH: '₴', USD: '$', EUR: '€', GBP: '£' };

function formatPrice(price, currency) {
  if (!price) return '';
  const sym = CURRENCY_SYMBOLS[currency] || currency;
  return `${sym}${parseFloat(price).toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function isUrl(str) {
  try { return /^https?:\/\//.test(str); } catch { return false; }
}

// ── Render ─────────────────────────────────────────────────
function getFilteredWishes() {
  return wishes.filter(w => {
    const matchFilter = activeFilter === 'all' || w.category === activeFilter;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q ||
      w.title.toLowerCase().includes(q) ||
      (w.description || '').toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });
}

function renderStats() {
  statTotal.textContent = wishes.length;
  statDream.textContent = wishes.filter(w => w.category === 'dream').length;
  statDone.textContent  = wishes.filter(w => w.category === 'done').length;
}

function buildCardHTML(wish) {
  const visual = isUrl(wish.emoji)
    ? `<img src="${escHtml(wish.emoji)}" alt="${escHtml(wish.title)}" loading="lazy" />`
    : `<span aria-hidden="true">${escHtml(wish.emoji || '🌟')}</span>`;

  const priceHTML = wish.price
    ? `<span class="card-price">${escHtml(formatPrice(wish.price, wish.currency))}</span>`
    : '';

  const linkBtn = wish.link
    ? `<a href="${escHtml(wish.link)}" target="_blank" rel="noopener noreferrer" class="card-btn card-btn--link" aria-label="Відкрити посилання">🔗 Відкрити</a>`
    : '';

  const catLabel = CATEGORY_LABELS[wish.category] || wish.category;
  const catClass = `card-badge--${wish.category}`;

  return `
    <div class="card-visual">${visual}</div>
    <span class="card-badge ${catClass}">${catLabel}</span>
    <p class="card-title">${escHtml(wish.title)}</p>
    ${wish.description ? `<p class="card-desc">${escHtml(wish.description)}</p>` : ''}
    <div class="card-meta">
      ${priceHTML}
      <span class="card-priority" aria-label="Пріоритет ${wish.priority} з 5">${PRIORITY_STARS[wish.priority] || ''}</span>
    </div>
    <div class="card-actions" role="group" aria-label="Дії з бажанням">
      <button class="card-btn card-btn--edit" data-id="${wish.id}" aria-label="Редагувати: ${escHtml(wish.title)}">✏️ Редагувати</button>
      ${linkBtn}
      <button class="card-btn card-btn--delete" data-id="${wish.id}" aria-label="Видалити: ${escHtml(wish.title)}">🗑️ Видалити</button>
    </div>
  `;
}

function renderGrid() {
  const filtered = getFilteredWishes();

  if (filtered.length === 0) {
    grid.innerHTML = '';
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  // Diff: remove cards not in filtered
  const existingIds = new Set([...grid.querySelectorAll('.wish-card')].map(el => el.dataset.id));
  const filteredIds = new Set(filtered.map(w => w.id));

  // Remove stale cards
  grid.querySelectorAll('.wish-card').forEach(el => {
    if (!filteredIds.has(el.dataset.id)) {
      el.style.transition = 'opacity 200ms, transform 200ms';
      el.style.opacity = '0';
      el.style.transform = 'scale(0.95)';
      setTimeout(() => el.remove(), 210);
    }
  });

  // Add or update cards
  filtered.forEach((wish, i) => {
    let card = grid.querySelector(`.wish-card[data-id="${wish.id}"]`);
    if (!card) {
      card = document.createElement('article');
      card.className = 'wish-card';
      card.setAttribute('role', 'listitem');
      card.dataset.id = wish.id;
      card.style.animationDelay = `${i * 50}ms`;
      grid.appendChild(card);
    }
    card.dataset.category = wish.category;
    card.innerHTML = buildCardHTML(wish);
  });

  renderStats();
}

function renderAll() {
  renderGrid();
  renderStats();
}

// ── Modal ──────────────────────────────────────────────────
function openModal(wish = null) {
  editingId = wish ? wish.id : null;
  modalTitle.textContent = wish ? 'Редагувати бажання' : 'Нове бажання';
  submitLabel.textContent = wish ? 'Оновити' : 'Зберегти';

  // Populate form
  titleInput.value   = wish?.title || '';
  descInput.value    = wish?.description || '';
  linkInput.value    = wish?.link || '';
  priceInput.value   = wish?.price || '';
  currencyInput.value= wish?.currency || 'UAH';
  emojiInput.value   = wish?.emoji || '';
  priorityInput.value= wish?.priority || 3;

  // Category radio
  const cat = wish?.category || 'want';
  const catRadio = form.querySelector(`input[name="category"][value="${cat}"]`);
  if (catRadio) catRadio.checked = true;

  updateTitleCount();
  updateDescCount();
  updatePriorityDisplay();
  updateSliderTrack();

  modal.showModal();
  // Wait for animation frame, then focus
  requestAnimationFrame(() => titleInput.focus());
}

function closeModal() {
  modal.close();
  form.reset();
  editingId = null;
}

// ── Form helpers ───────────────────────────────────────────
function updateTitleCount() {
  titleCount.textContent = titleInput.value.length;
}

function updateDescCount() {
  descCount.textContent = descInput.value.length;
}

function updatePriorityDisplay() {
  const val = parseInt(priorityInput.value);
  priorityDisp.textContent = PRIORITY_STARS[val] || '';
  priorityInput.setAttribute('aria-valuenow', val);
}

function updateSliderTrack() {
  const min = 1, max = 5;
  const val = parseInt(priorityInput.value);
  const pct = ((val - min) / (max - min)) * 100;
  priorityInput.style.setProperty('--slider-pct', pct + '%');
  priorityInput.style.background = `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${pct}%, rgba(255,255,255,0.1) ${pct}%, rgba(255,255,255,0.1) 100%)`;
}

// ── CRUD ───────────────────────────────────────────────────
function getFormData() {
  const cat = form.querySelector('input[name="category"]:checked')?.value || 'want';
  return {
    title:       titleInput.value.trim(),
    description: descInput.value.trim(),
    link:        linkInput.value.trim(),
    price:       priceInput.value ? parseFloat(priceInput.value) : null,
    currency:    currencyInput.value,
    category:    cat,
    priority:    parseInt(priorityInput.value),
    emoji:       emojiInput.value.trim() || '🌟',
    updatedAt:   Date.now(),
  };
}

function saveWish(e) {
  e.preventDefault();

  const data = getFormData();
  if (!data.title) {
    titleInput.focus();
    titleInput.classList.add('shake');
    setTimeout(() => titleInput.classList.remove('shake'), 400);
    return;
  }

  if (editingId) {
    const idx = wishes.findIndex(w => w.id === editingId);
    if (idx !== -1) wishes[idx] = { ...wishes[idx], ...data };
  } else {
    wishes.unshift({ id: uid(), createdAt: Date.now(), ...data });
  }

  save();
  closeModal();
  renderAll();
}

function deleteWish(id) {
  wishes = wishes.filter(w => w.id !== id);
  save();
  renderAll();
}

// ── Event delegation ───────────────────────────────────────
grid.addEventListener('click', e => {
  const editBtn   = e.target.closest('.card-btn--edit');
  const deleteBtn = e.target.closest('.card-btn--delete');

  if (editBtn) {
    const id = editBtn.dataset.id;
    const wish = wishes.find(w => w.id === id);
    if (wish) openModal(wish);
  }

  if (deleteBtn) {
    const id = deleteBtn.dataset.id;
    const wish = wishes.find(w => w.id === id);
    if (wish && confirm(`Видалити «${wish.title}»?`)) {
      deleteWish(id);
    }
  }
});

// ── Filters ────────────────────────────────────────────────
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderAll();
  });
});

// ── Search ─────────────────────────────────────────────────
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  renderAll();
});

// ── Open/close modal listeners ─────────────────────────────
document.getElementById('btn-open-modal').addEventListener('click', () => openModal());
document.getElementById('btn-hero-add').addEventListener('click', () => openModal());
document.getElementById('btn-empty-add').addEventListener('click', () => openModal());
document.getElementById('btn-close-modal').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', closeModal);

// Close on Escape (native dialog handles this, but reset form too)
modal.addEventListener('cancel', () => { form.reset(); editingId = null; });

// ── Form input listeners ───────────────────────────────────
titleInput.addEventListener('input', updateTitleCount);
descInput.addEventListener('input', updateDescCount);
priorityInput.addEventListener('input', () => {
  updatePriorityDisplay();
  updateSliderTrack();
});

form.addEventListener('submit', saveWish);

// ── Keyboard: close with Escape ────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modal.open) closeModal();
});

// ── Demo data (first visit) ────────────────────────────────
function seedDemo() {
  if (wishes.length > 0) return;
  wishes = [
    {
      id: uid(), createdAt: Date.now(), updatedAt: Date.now(),
      title: 'MacBook Pro M4',
      description: 'Ноутбук мрії для роботи та творчості. Space Black, 16 дюймів.',
      link: 'https://www.apple.com/ua/macbook-pro/',
      price: 89999, currency: 'UAH',
      category: 'dream', priority: 5, emoji: '💻',
    },
    {
      id: uid(), createdAt: Date.now() - 1000, updatedAt: Date.now() - 1000,
      title: 'Бездротові навушники Sony WH-1000XM5',
      description: 'Найкращі навушники з шумозаглушенням. Чорний колір.',
      link: 'https://www.sony.com.ua/',
      price: 11500, currency: 'UAH',
      category: 'want', priority: 4, emoji: '🎧',
    },
    {
      id: uid(), createdAt: Date.now() - 2000, updatedAt: Date.now() - 2000,
      title: 'Подорож до Японії 🇯🇵',
      description: 'Токіо, Кіото, Осака. Весняний сезон, цвітіння сакури.',
      link: '',
      price: 3500, currency: 'USD',
      category: 'dream', priority: 5, emoji: '🌸',
    },
    {
      id: uid(), createdAt: Date.now() - 3000, updatedAt: Date.now() - 3000,
      title: 'Курс з UI/UX дизайну',
      description: 'Закінчив! Отримав сертифікат від Google.',
      link: 'https://www.coursera.org/',
      price: null, currency: 'UAH',
      category: 'done', priority: 3, emoji: '🎨',
    },
    {
      id: uid(), createdAt: Date.now() - 4000, updatedAt: Date.now() - 4000,
      title: 'Механічна клавіатура Keychron Q1',
      description: 'Gasket mount, Gateron G Pro Red switches.',
      link: 'https://www.keychron.com/',
      price: 180, currency: 'USD',
      category: 'want', priority: 3, emoji: '⌨️',
    },
    {
      id: uid(), createdAt: Date.now() - 5000, updatedAt: Date.now() - 5000,
      title: 'Електро-скутер Xiaomi',
      description: 'Для зручного пересування містом.',
      link: '',
      price: 25000, currency: 'UAH',
      category: 'want', priority: 2, emoji: '🛵',
    },
  ];
  save();
}

// ── Init ───────────────────────────────────────────────────
load();
seedDemo();
renderAll();
