/**
 * BookingManager - Cyberpunk Gift Reservation System with Supabase
 * Бронювання через RPC reserve_gift / cancel_reservation.
 * Код скасування генерується в браузері, на сервері зберігається лише його хеш.
 */
'use strict';

window.SUPABASE_CONFIG = window.SUPABASE_CONFIG || { url: '', anonKey: '' };

window.BookingManager = (() => {
  let supabaseClient = null;
  let isConfigured = false;
  let reservations = new Map();
  const listeners = [];
  const LOCAL_STORAGE_KEY = 'omg_my_bookings'; // { [wishId]: cancelToken }
  const MOCK_STORAGE_KEY = 'omg_mock_reservations';

  const ERRORS = {
    rate_limited: 'Забагато броней за останню годину. Спробуй пізніше.',
    invalid_name: 'Імʼя має бути від 1 до 60 символів.',
    invalid_wish: 'Некоректний контракт.',
    invalid_token: 'Некоректний код скасування.'
  };

  // ---- Токен скасування ----
  function generateToken() {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 символи, без I L O U
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(bytes, b => alphabet[b & 31]).join('');
  }
  const normToken = t => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const formatToken = t => normToken(t).replace(/(.{4})(?=.)/g, '$1-');

  // ---- localStorage ----
  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || fallback); } catch { return JSON.parse(fallback); }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  }
  const getMyBookings = () => readJson(LOCAL_STORAGE_KEY, '{}');
  function saveMyBooking(wishId, token) {
    const b = getMyBookings(); b[wishId] = token; writeJson(LOCAL_STORAGE_KEY, b);
  }
  function removeMyBooking(wishId) {
    const b = getMyBookings(); delete b[wishId]; writeJson(LOCAL_STORAGE_KEY, b);
  }
  const getMockReservations = () => readJson(MOCK_STORAGE_KEY, '[]');
  const saveMockReservations = list => writeJson(MOCK_STORAGE_KEY, list);

  // ---- Supabase ----
  function initClient() {
    const config = window.SUPABASE_CONFIG;
    if (
      window.supabase && config &&
      typeof config.url === 'string' && typeof config.anonKey === 'string' &&
      config.url.trim() && config.anonKey.trim() &&
      !config.url.includes('YOUR_SUPABASE')
    ) {
      try {
        supabaseClient = window.supabase.createClient(config.url.trim(), config.anonKey.trim());
        isConfigured = true;
      } catch (err) {
        console.warn('[BookingManager] Помилка ініціалізації Supabase:', err);
        isConfigured = false;
      }
    } else {
      isConfigured = false;
    }
  }

  function initRealtime() {
    if (!isConfigured || !supabaseClient) return;
    try {
      supabaseClient
        .channel('public:reservations')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => fetchReservations())
        .subscribe();
    } catch (err) {
      console.warn('[BookingManager] Не вдалося увімкнути Realtime:', err);
    }
  }

  // Збираємо новий Map і підміняємо після завантаження: без блимання "вільних" карток.
  // При помилці лишається попередній стан.
  async function fetchReservations() {
    const next = new Map();

    if (isConfigured && supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from('reservations')
          .select('id, wish_id, reserved_by, created_at');
        if (error) throw error;
        (data || []).forEach(item => next.set(item.wish_id, item));
      } catch (err) {
        console.error('[BookingManager] Помилка завантаження бронювань з Supabase:', err);
        return;
      }
    } else {
      getMockReservations().forEach(item => next.set(item.wish_id, item));
    }

    reservations = next;
    notifyListeners();
  }

  function notifyListeners() {
    listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  }

  function mapError(error) {
    if (error && error.code === '23505') return new Error('Цей контракт уже закріплено іншим оператором.');
    const msg = (error && error.message) || '';
    return new Error(ERRORS[msg] || msg || 'Помилка збереження контракту.');
  }

  // Повертає код скасування (показати користувачу один раз)
  async function reserve(wishId, { name }) {
    const cleanName = (name || '').trim();
    if (!cleanName) throw new Error('Вкажи свій позивний або імʼя.');
    const token = generateToken();

    if (isConfigured && supabaseClient) {
      const { error } = await supabaseClient.rpc('reserve_gift', {
        p_wish_id: wishId, p_name: cleanName, p_token: token
      });
      if (error) throw mapError(error);
    } else {
      const mockList = getMockReservations();
      if (mockList.some(i => i.wish_id === wishId)) {
        throw new Error('Цей контракт уже закріплено (локальний режим).');
      }
      mockList.push({
        id: 'mock-' + Date.now(), wish_id: wishId, reserved_by: cleanName,
        created_at: new Date().toISOString(), token
      });
      saveMockReservations(mockList);
    }

    saveMyBooking(wishId, token);
    await fetchReservations();
    return token;
  }

  async function cancel(wishId, token = '') {
    const clean = normToken(token);
    if (!clean) throw new Error('Введи код скасування.');

    if (isConfigured && supabaseClient) {
      const { data, error } = await supabaseClient.rpc('cancel_reservation', {
        p_wish_id: wishId, p_token: clean
      });
      if (error) throw new Error(error.message || 'Помилка скасування контракту.');
      if (!data) throw new Error('Невірний код або контракт не знайдено.');
    } else {
      let mockList = getMockReservations();
      const existing = mockList.find(i => i.wish_id === wishId);
      if (existing) {
        if (normToken(existing.token) !== clean) throw new Error('Невірний код скасування.');
        mockList = mockList.filter(i => i.wish_id !== wishId);
        saveMockReservations(mockList);
      }
    }

    removeMyBooking(wishId);
    await fetchReservations();
  }

  const isReserved = wishId => reservations.has(wishId);
  const getReservation = wishId => reservations.get(wishId) || null;
  const getMyToken = wishId => getMyBookings()[wishId] || '';
  const isMyBooking = wishId => Boolean(getMyToken(wishId));
  const onUpdate = fn => listeners.push(fn);

  // ---- Діалоги ----
  let bookingDialog, cancelDialog, tokenDialog;
  let bookingForm, cancelForm;
  let activeWishForAction = null;

  function setupDialogs() {
    bookingDialog = document.getElementById('booking-modal');
    cancelDialog = document.getElementById('cancel-modal');
    tokenDialog = document.getElementById('token-modal');
    bookingForm = document.getElementById('booking-form');
    cancelForm = document.getElementById('cancel-form');

    // Light dismiss для браузерів без <dialog closedby>
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const outside = (e, dialog) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      [bookingDialog, cancelDialog, tokenDialog].filter(Boolean).forEach(dialog => {
        let pressedOutside = false;
        dialog.addEventListener('pointerdown', e => { pressedOutside = outside(e, dialog); });
        dialog.addEventListener('pointerup', e => { if (pressedOutside && outside(e, dialog)) dialog.close(); });
      });
    }

    document.querySelectorAll('[data-close-dialog]').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('dialog')?.close());
    });

    const copyBtn = document.getElementById('token-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const code = document.getElementById('token-code').textContent;
        try {
          await navigator.clipboard.writeText(code);
          copyBtn.textContent = 'Скопійовано ✓';
        } catch {
          copyBtn.textContent = 'Скопіюй вручну';
        }
        setTimeout(() => { copyBtn.textContent = 'Копіювати'; }, 1800);
      });
    }

    if (bookingForm) {
      bookingForm.addEventListener('submit', async e => {
        e.preventDefault();
        const submitBtn = bookingForm.querySelector('button[type="submit"]');
        const errorEl = document.getElementById('booking-error');
        errorEl.hidden = true;
        errorEl.textContent = '';
        if (!activeWishForAction) return;

        try {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Збереження в мережі…';
          const token = await reserve(activeWishForAction.id, {
            name: document.getElementById('booking-name').value
          });
          bookingDialog.close();
          openTokenModal(activeWishForAction, token);
        } catch (err) {
          errorEl.textContent = err.message || 'Не вдалося закріпити контракт.';
          errorEl.hidden = false;
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Підтвердити контракт</span> ↵';
        }
      });
    }

    if (cancelForm) {
      cancelForm.addEventListener('submit', async e => {
        e.preventDefault();
        const submitBtn = cancelForm.querySelector('button[type="submit"]');
        const errorEl = document.getElementById('cancel-error');
        errorEl.hidden = true;
        errorEl.textContent = '';
        if (!activeWishForAction) return;

        try {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Скасування…';
          await cancel(activeWishForAction.id, document.getElementById('cancel-pin').value);
          cancelDialog.close();
        } catch (err) {
          errorEl.textContent = err.message || 'Не вдалося скасувати контракт.';
          errorEl.hidden = false;
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Зняти контракт</span>';
        }
      });
    }
  }

  function openBookingModal(wish) {
    if (!bookingDialog || !wish) return;
    activeWishForAction = wish;
    document.getElementById('booking-modal-subtitle').textContent = wish.title || '';
    document.getElementById('booking-name').value = '';
    const err = document.getElementById('booking-error');
    err.hidden = true;
    err.textContent = '';
    bookingDialog.showModal();
    document.getElementById('booking-name').focus();
  }

  function openTokenModal(wish, token) {
    if (!tokenDialog) return;
    document.getElementById('token-modal-subtitle').textContent = wish?.title || '';
    document.getElementById('token-code').textContent = formatToken(token);
    tokenDialog.showModal();
  }

  function openCancelModal(wish) {
    if (!cancelDialog || !wish) return;
    activeWishForAction = wish;

    const storedToken = getMyToken(wish.id);
    const pinGroup = document.getElementById('cancel-pin-group');
    const pinInput = document.getElementById('cancel-pin');
    const noteEl = document.getElementById('cancel-modal-note');
    const err = document.getElementById('cancel-error');
    err.hidden = true;
    err.textContent = '';
    document.getElementById('cancel-modal-subtitle').textContent = wish.title || '';

    if (storedToken) {
      pinInput.value = formatToken(storedToken);
      pinGroup.hidden = true;
      noteEl.textContent = 'Ти забронював цей контракт з цього браузера — код підставлено автоматично.';
    } else {
      pinInput.value = '';
      pinGroup.hidden = false;
      noteEl.textContent = 'Введи код скасування, який ти отримав під час бронювання.';
    }

    cancelDialog.showModal();
    if (!storedToken) pinInput.focus();
  }

  // ---- Віджет у досьє ----
  function esc(str = '') {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderDetailWidget(wish) {
    if (!wish) return '';
    const res = getReservation(wish.id);
    const isMine = isMyBooking(wish.id);

    if (res) {
      return `
        <div class="booking-widget booking-widget--reserved" role="region" aria-label="Статус бронювання подарунка">
          <div class="booking-widget-header">
            <span class="booking-status-tag booking-status-tag--locked">
              <span aria-hidden="true">🔒</span> ПОДАРУНОК ЗАБРОНЬОВАНО
            </span>
            <span class="booking-code">// КОНТРАКТ ЗАКРІПЛЕНО</span>
          </div>
          <div class="booking-reserved-info">
            <p class="reserved-by-line">
              <span class="reserved-label">Хто дарує:</span>
              <strong class="reserved-name">${esc(res.reserved_by)}</strong>
              ${isMine ? '<span class="reserved-badge-mine">Це ваша бронь</span>' : ''}
            </p>
          </div>
          <div class="booking-reserved-actions">
            ${isMine ? `<button type="button" class="dialog-btn dialog-btn--cancel" id="btn-show-token" style="width:100%;margin-bottom:8px">Показати код скасування</button>` : ''}
            <button type="button" class="booking-btn-cancel" id="btn-cancel-action" data-wish-id="${esc(wish.id)}">
              <span aria-hidden="true">✕</span> Зняти бронювання
            </button>
          </div>
        </div>`;
    }

    return `
      <div class="booking-widget booking-widget--available" role="region" aria-label="Бронювання подарунка">
        <div class="booking-widget-header">
          <span class="booking-status-tag booking-status-tag--free">
            <span class="status-dot status-dot--green" aria-hidden="true"></span> ВІЛЬНИЙ ПОДАРУНОК
          </span>
          <span class="booking-code">// ДОСТУПНО</span>
        </div>
        <p class="booking-cta-title">Хочеш подарувати цю річ?</p>
        <p class="booking-hint">Забронюй її, щоб інші гості бачили, що подарунок уже зайнятий і не подарували те саме. Імʼя буде видно всім.</p>
        <button type="button" class="booking-cta-btn" id="btn-reserve-action" data-wish-id="${esc(wish.id)}" aria-label="Забронювати подарунок: ${esc(wish.title)}">
          <span class="booking-cta-content">
            <span class="booking-cta-main">ЗАБРОНЮВАТИ ПОДАРУНОК</span>
            <span class="booking-cta-sub">Закріпити цей контракт за собою</span>
          </span>
          <span class="booking-cta-arrow" aria-hidden="true">➔</span>
        </button>
      </div>`;
  }

  function attachDetailListeners(container, wish) {
    if (!container || !wish) return;
    container.querySelector('#btn-reserve-action')?.addEventListener('click', () => openBookingModal(wish));
    container.querySelector('#btn-cancel-action')?.addEventListener('click', () => openCancelModal(wish));
    container.querySelector('#btn-show-token')?.addEventListener('click', () => openTokenModal(wish, getMyToken(wish.id)));
  }

  async function init() {
    initClient();
    setupDialogs();
    await fetchReservations();
    initRealtime();
    if (!isConfigured) {
      console.info(
        '%c[SYS_INFO]%c Supabase не налаштовано (працює локальний демо-режим). Вкажи ключі у supabase-config.js.',
        'color: #ffaa00; font-weight: bold;', 'color: inherit;'
      );
    }
  }

  return {
    init, isReserved, getReservation, isMyBooking, reserve, cancel, onUpdate,
    openBookingModal, openCancelModal, renderDetailWidget, attachDetailListeners,
    get isConfigured() { return isConfigured; }
  };
})();

var BookingManager = window.BookingManager;