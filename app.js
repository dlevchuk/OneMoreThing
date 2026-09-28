'use strict';

// ── State ──────────────────────────────────────────────────
const STORAGE_KEY = 'omt_v2';
let wishes = [];
let editingId = null;
let activeFilter = 'all';
let searchQuery = '';

// ── DOM refs ───────────────────────────────────────────────
const modal       = document.getElementById('wish-modal');
const form        = document.getElementById('wish-form');
const grid        = document.getElementById('wishlist-grid');
const emptyState  = document.getElementById('empty-state');
const pageCount   = document.getElementById('page-count');
const modalTitle  = document.getElementById('modal-title');
const submitLabel = document.getElementById('submit-label');

const titleInput  = document.getElementById('wish-title');
const linkInput   = document.getElementById('wish-link');
const imageInput  = document.getElementById('wish-image');
const imagePreview = document.getElementById('image-preview');
const previewImg  = document.getElementById('preview-img');
const searchInput = document.getElementById('search-input');

// ── Storage ────────────────────────────────────────────────
function load() {
  try { wishes = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { wishes = []; }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wishes));
}

// ── Helpers ────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escHtml(str = '') {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

const PRIORITY_LABELS = {
  want:   'Хочу',
  nice:   'Було б добре',
  unsure: 'Не певен',
};

function isValidUrl(str) {
  try { return /^https?:\/\//.test(str); } catch { return false; }
}

// ── Image preview in form ──────────────────────────────────
function updateFormPreview() {
  const url = imageInput.value.trim();
  if (isValidUrl(url)) {
    previewImg.src = url;
    previewImg.onerror = () => { imagePreview.hidden = true; };
    previewImg.onload  = () => { imagePreview.hidden = false; };
  } else {
    imagePreview.hidden = true;
    previewImg.src = '';
  }
}

// ── Render ─────────────────────────────────────────────────
function filtered() {
  return wishes.filter(w => {
    const matchFilter = activeFilter === 'all' || w.priority === activeFilter;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || w.title.toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });
}

function updateCount() {
  const n = filtered().length;
  pageCount.textContent = `${n} ${n === 1 ? 'річ' : n < 5 ? 'речі' : 'речей'}`;
}

function buildCard(wish) {
  const prioClass = `card-priority--${wish.priority}`;
  const prioLabel = PRIORITY_LABELS[wish.priority] || wish.priority;

  const imageHTML = isValidUrl(wish.image)
    ? `<div class="card-image"><img src="${escHtml(wish.image)}" alt="${escHtml(wish.title)}" loading="lazy" /></div>`
    : `<div class="card-image card-image--empty"><span>без фото</span></div>`;

  const linkHTML = isValidUrl(wish.link)
    ? `<a href="${escHtml(wish.link)}" target="_blank" rel="noopener noreferrer" class="card-link-btn" aria-label="Відкрити посилання для ${escHtml(wish.title)}">↗ Відкрити</a>`
    : `<span></span>`;

  return `
    ${imageHTML}
    <div class="card-body">
      <span class="card-priority ${prioClass}">${escHtml(prioLabel)}</span>
      <p class="card-title">${escHtml(wish.title)}</p>
      <div class="card-footer">
        ${linkHTML}
        <div class="card-actions" role="group" aria-label="Дії">
          <button class="card-icon-btn card-icon-btn--edit" data-id="${wish.id}" aria-label="Редагувати ${escHtml(wish.title)}">✏</button>
          <button class="card-icon-btn card-icon-btn--delete" data-id="${wish.id}" aria-label="Видалити ${escHtml(wish.title)}">✕</button>
        </div>
      </div>
    </div>
  `;
}

function renderGrid() {
  const list = filtered();
  updateCount();

  if (list.length === 0) {
    grid.innerHTML = '';
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  // Remove cards not in current filter
  const keep = new Set(list.map(w => w.id));
  grid.querySelectorAll('.wish-card').forEach(el => {
    if (!keep.has(el.dataset.id)) el.remove();
  });

  // Add or update
  list.forEach((wish, i) => {
    let card = grid.querySelector(`.wish-card[data-id="${wish.id}"]`);
    if (!card) {
      card = document.createElement('article');
      card.className = 'wish-card';
      card.setAttribute('role', 'listitem');
      card.dataset.id = wish.id;
      card.style.animationDelay = `${i * 40}ms`;
      grid.appendChild(card);
    }
    card.innerHTML = buildCard(wish);
  });
}

// ── Modal ──────────────────────────────────────────────────
function openModal(wish = null) {
  editingId = wish?.id ?? null;
  modalTitle.textContent = wish ? 'Редагувати' : 'Нова річ';
  submitLabel.textContent = wish ? 'Оновити' : 'Зберегти';

  titleInput.value  = wish?.title  || '';
  linkInput.value   = wish?.link   || '';
  imageInput.value  = wish?.image  || '';

  const prio = wish?.priority || 'want';
  const radio = form.querySelector(`input[name="priority"][value="${prio}"]`);
  if (radio) radio.checked = true;

  updateFormPreview();
  modal.showModal();
  requestAnimationFrame(() => titleInput.focus());
}

function closeModal() {
  modal.close();
  form.reset();
  imagePreview.hidden = true;
  editingId = null;
}

// ── CRUD ───────────────────────────────────────────────────
function getFormData() {
  return {
    title:    titleInput.value.trim(),
    link:     linkInput.value.trim(),
    image:    imageInput.value.trim(),
    priority: form.querySelector('input[name="priority"]:checked')?.value || 'want',
  };
}

function saveWish(e) {
  e.preventDefault();
  const data = getFormData();
  if (!data.title) { titleInput.focus(); return; }

  if (editingId) {
    const idx = wishes.findIndex(w => w.id === editingId);
    if (idx !== -1) wishes[idx] = { ...wishes[idx], ...data, updatedAt: Date.now() };
  } else {
    wishes.unshift({ id: uid(), createdAt: Date.now(), updatedAt: Date.now(), ...data });
  }

  save();
  closeModal();
  renderGrid();
}

function deleteWish(id) {
  const wish = wishes.find(w => w.id === id);
  if (!wish) return;
  if (!confirm(`Видалити «${wish.title}»?`)) return;
  wishes = wishes.filter(w => w.id !== id);
  save();
  renderGrid();
}

// ── Event delegation ───────────────────────────────────────
grid.addEventListener('click', e => {
  const editBtn   = e.target.closest('.card-icon-btn--edit');
  const deleteBtn = e.target.closest('.card-icon-btn--delete');
  if (editBtn)   openModal(wishes.find(w => w.id === editBtn.dataset.id));
  if (deleteBtn) deleteWish(deleteBtn.dataset.id);
});

// ── Filters ────────────────────────────────────────────────
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderGrid();
  });
});

// ── Search ─────────────────────────────────────────────────
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  renderGrid();
});

// ── Open / close ───────────────────────────────────────────
document.getElementById('btn-open-modal').addEventListener('click', () => openModal());
document.getElementById('btn-empty-add').addEventListener('click', () => openModal());
document.getElementById('btn-close-modal').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', closeModal);
modal.addEventListener('cancel', () => { form.reset(); imagePreview.hidden = true; editingId = null; });

// Image URL live preview
imageInput.addEventListener('input', updateFormPreview);

// Form submit
form.addEventListener('submit', saveWish);

// Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modal.open) closeModal();
});

// ── Init ───────────────────────────────────────────────────
load();
renderGrid();
