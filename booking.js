/**
 * BookingManager - Cyberpunk Gift Reservation System with Supabase
 * Handles data synchronization, Supabase Realtime, and dialog interactions.
 */
'use strict';

window.SUPABASE_CONFIG = window.SUPABASE_CONFIG || { url: '', anonKey: '' };

  window.BookingManager = (() => {
    let supabaseClient = null;
    let isConfigured = false;
    const reservations = new Map();
    const listeners = [];
    const LOCAL_STORAGE_KEY = 'omg_my_bookings';
    const MOCK_STORAGE_KEY = 'omg_mock_reservations';

    // Get locally stored user's bookings: { [wishId]: pinCode }
    function getMyBookings() {
      try {
        return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
      } catch {
        return {};
      }
    }

    function saveMyBooking(wishId, pinCode = '') {
      const bookings = getMyBookings();
      bookings[wishId] = pinCode || '';
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookings));
    }

    function removeMyBooking(wishId) {
      const bookings = getMyBookings();
      delete bookings[wishId];
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookings));
    }

    // Local storage mock helpers for testing before Supabase keys are configured
    function getMockReservations() {
      try {
        return JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) || '[]');
      } catch {
        return [];
      }
    }

    function saveMockReservations(list) {
      localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(list));
    }

    // Initialize Supabase Client
    function initClient() {
      const config = window.SUPABASE_CONFIG;
      if (
        window.supabase &&
        config &&
        typeof config.url === 'string' &&
        typeof config.anonKey === 'string' &&
        config.url.trim().length > 0 &&
        config.anonKey.trim().length > 0 &&
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

    // Subscribe to Realtime events
    function initRealtime() {
      if (!isConfigured || !supabaseClient) return;

      try {
        supabaseClient
          .channel('public:reservations')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'reservations' },
            () => {
              fetchReservations();
            }
          )
          .subscribe();
      } catch (err) {
        console.warn('[BookingManager] Не вдалося увімкнути Realtime:', err);
      }
    }

    // Fetch all reservations
    async function fetchReservations() {
      reservations.clear();

      if (isConfigured && supabaseClient) {
        try {
          const { data, error } = await supabaseClient
            .from('reservations')
            .select('id, wish_id, reserved_by, note, created_at, pin_code');

          if (error) throw error;

          if (Array.isArray(data)) {
            data.forEach(item => {
              reservations.set(item.wish_id, {
                id: item.id,
                wish_id: item.wish_id,
                reserved_by: item.reserved_by,
                note: item.note || '',
                created_at: item.created_at,
                has_pin: Boolean(item.pin_code)
              });
            });
          }
        } catch (err) {
          console.error('[BookingManager] Помилка завантаження бронювань з Supabase:', err);
        }
      } else {
        // Fallback: local demo mode
        const mockList = getMockReservations();
        mockList.forEach(item => {
          reservations.set(item.wish_id, item);
        });
      }

      notifyListeners();
    }

    function notifyListeners() {
      listeners.forEach(fn => {
        try { fn(); } catch (e) { console.error(e); }
      });
    }

    // Reserve a gift
    async function reserve(wishId, { name, note, pin }) {
      const cleanName = (name || '').trim();
      const cleanNote = (note || '').trim();
      const cleanPin = (pin || '').trim();

      if (!cleanName) {
        throw new Error('Вкажи свій позивний або імʼя.');
      }

      if (isConfigured && supabaseClient) {
        const { data, error } = await supabaseClient
          .from('reservations')
          .insert([{
            wish_id: wishId,
            reserved_by: cleanName,
            note: cleanNote || null,
            pin_code: cleanPin || null
          }])
          .select()
          .single();

        if (error) {
          if (error.code === '23505') {
            throw new Error('Цей контракт уже закріплено іншим оператором.');
          }
          throw new Error(error.message || 'Помилка збереження контракту.');
        }
      } else {
        // Local demo mode
        const mockList = getMockReservations();
        if (mockList.some(item => item.wish_id === wishId)) {
          throw new Error('Цей контракт уже закріплено (локальний режим).');
        }
        mockList.push({
          id: 'mock-' + Date.now(),
          wish_id: wishId,
          reserved_by: cleanName,
          note: cleanNote,
          created_at: new Date().toISOString(),
          pin_code: cleanPin,
          has_pin: Boolean(cleanPin)
        });
        saveMockReservations(mockList);
      }

      saveMyBooking(wishId, cleanPin);
      await fetchReservations();
    }

    // Cancel reservation
    async function cancel(wishId, pin = '') {
      const cleanPin = (pin || '').trim();

      if (isConfigured && supabaseClient) {
        const { data, error } = await supabaseClient.rpc('cancel_reservation', {
          p_wish_id: wishId,
          p_pin: cleanPin || null
        });

        if (error) {
          throw new Error(error.message || 'Помилка скасування контракту.');
        }

        if (!data) {
          throw new Error('Невірний PIN-код або контракт не знайдено.');
        }
      } else {
        // Local demo mode
        let mockList = getMockReservations();
        const existing = mockList.find(i => i.wish_id === wishId);
        if (existing) {
          if (existing.pin_code && existing.pin_code !== cleanPin) {
            throw new Error('Невірний PIN-код для скасування.');
          }
          mockList = mockList.filter(i => i.wish_id !== wishId);
          saveMockReservations(mockList);
        }
      }

      removeMyBooking(wishId);
      await fetchReservations();
    }

    function isReserved(wishId) {
      return reservations.has(wishId);
    }

    function getReservation(wishId) {
      return reservations.get(wishId) || null;
    }

    function isMyBooking(wishId) {
      const bookings = getMyBookings();
      return Boolean(bookings[wishId] !== undefined);
    }

    function getMyPin(wishId) {
      const bookings = getMyBookings();
      return bookings[wishId] || '';
    }

    function onUpdate(fn) {
      listeners.push(fn);
    }

    // Dialog Controls
    let bookingDialog, cancelDialog;
    let bookingForm, cancelForm;
    let activeWishForAction = null;

    function setupDialogs() {
      bookingDialog = document.getElementById('booking-modal');
      cancelDialog = document.getElementById('cancel-modal');
      bookingForm = document.getElementById('booking-form');
      cancelForm = document.getElementById('cancel-form');

      // Light dismiss fallback for browsers without native <dialog closedby="any">
      if (!('closedBy' in HTMLDialogElement.prototype)) {
        const outside = (e, dialog) => {
          const r = dialog.getBoundingClientRect();
          return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        };
        [bookingDialog, cancelDialog].filter(Boolean).forEach(dialog => {
          let pressedOutside = false;
          dialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e, dialog); });
          dialog.addEventListener('pointerup', (e) => { if (pressedOutside && outside(e, dialog)) dialog.close(); });
        });
      }

      // Cancel buttons inside dialogs
      document.querySelectorAll('[data-close-dialog]').forEach(btn => {
        btn.addEventListener('click', () => {
          const dialog = btn.closest('dialog');
          if (dialog) dialog.close();
        });
      });

      // Booking submit handler
      if (bookingForm) {
        bookingForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const submitBtn = bookingForm.querySelector('button[type="submit"]');
          const errorEl = document.getElementById('booking-error');
          errorEl.hidden = true;
          errorEl.textContent = '';

          if (!activeWishForAction) return;

          const nameInput = document.getElementById('booking-name');
          const noteInput = document.getElementById('booking-note');
          const pinInput = document.getElementById('booking-pin');

          try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Збереження в мережі…';

            await reserve(activeWishForAction.id, {
              name: nameInput.value,
              note: noteInput.value,
              pin: pinInput.value
            });

            bookingDialog.close();
          } catch (err) {
            errorEl.textContent = err.message || 'Не вдалося закріпити контракт.';
            errorEl.hidden = false;
          } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>Підтвердити контракт</span> ↵';
          }
        });
      }

      // Cancellation submit handler
      if (cancelForm) {
        cancelForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const submitBtn = cancelForm.querySelector('button[type="submit"]');
          const errorEl = document.getElementById('cancel-error');
          errorEl.hidden = true;
          errorEl.textContent = '';

          if (!activeWishForAction) return;

          const pinInput = document.getElementById('cancel-pin');

          try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Скасування…';

            await cancel(activeWishForAction.id, pinInput.value);

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
      document.getElementById('booking-note').value = '';
      document.getElementById('booking-pin').value = '';
      const err = document.getElementById('booking-error');
      err.hidden = true;
      err.textContent = '';

      bookingDialog.showModal();
      document.getElementById('booking-name').focus();
    }

    function openCancelModal(wish) {
      if (!cancelDialog || !wish) return;
      activeWishForAction = wish;

      const res = getReservation(wish.id);
      const isMine = isMyBooking(wish.id);
      const storedPin = getMyPin(wish.id);

      document.getElementById('cancel-modal-subtitle').textContent = wish.title || '';
      const pinGroup = document.getElementById('cancel-pin-group');
      const pinInput = document.getElementById('cancel-pin');
      const noteEl = document.getElementById('cancel-modal-note');
      const err = document.getElementById('cancel-error');
      err.hidden = true;
      err.textContent = '';

      if (storedPin) {
        pinInput.value = storedPin;
      } else {
        pinInput.value = '';
      }

      if (isMine && !storedPin && (!res || !res.has_pin)) {
        pinGroup.hidden = true;
        noteEl.textContent = 'Ти забронював цей контракт з цього браузера. PIN не потрібен для підтвердження.';
      } else {
        pinGroup.hidden = false;
        noteEl.textContent = 'Введи PIN-код, зазначений під час взяття контракту.';
      }

      cancelDialog.showModal();
      if (!pinGroup.hidden && !storedPin) {
        pinInput.focus();
      }
    }

    // Render HTML for the details pane widget
    function renderDetailWidget(wish) {
      if (!wish) return '';

      const reserved = isReserved(wish.id);
      const res = getReservation(wish.id);
      const isMine = isMyBooking(wish.id);

      if (reserved && res) {
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
            ${res.note ? `<p class="reserved-note-line"><em>«${esc(res.note)}»</em></p>` : ''}
          </div>
          <div class="booking-reserved-actions">
            <button type="button" class="booking-btn-cancel" id="btn-cancel-action" data-wish-id="${esc(wish.id)}">
              <span aria-hidden="true">✕</span> Зняти бронювання
            </button>
          </div>
        </div>
      `;
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
        <p class="booking-hint">Забронюй її, щоб інші гості бачили, що подарунок уже зайнятий і не подарували те саме.</p>

        <button type="button" class="booking-cta-btn" id="btn-reserve-action" data-wish-id="${esc(wish.id)}" aria-label="Забронювати подарунок: ${esc(wish.title)}">
          <span class="booking-cta-icon" aria-hidden="true">🎁</span>
          <span class="booking-cta-content">
            <span class="booking-cta-main">ЗАБРОНЮВАТИ ПОДАРУНОК</span>
            <span class="booking-cta-sub">Закріпити цей контракт за собою</span>
          </span>
          <span class="booking-cta-arrow" aria-hidden="true">➔</span>
        </button>
      </div>
    `;
    }

    function attachDetailListeners(container, wish) {
      if (!container || !wish) return;

      const reserveBtn = container.querySelector('#btn-reserve-action');
      if (reserveBtn) {
        reserveBtn.addEventListener('click', () => openBookingModal(wish));
      }

      const cancelBtn = container.querySelector('#btn-cancel-action');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => openCancelModal(wish));
      }
    }

    function esc(str = '') {
      return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function init() {
      initClient();
      setupDialogs();
      await fetchReservations();
      initRealtime();

      if (!isConfigured) {
        console.info(
          '%c[SYS_INFO]%c Supabase не налаштовано (працює локальний демо-режим). Вкажи ключі у supabase-config.js.',
          'color: #ffaa00; font-weight: bold;',
          'color: inherit;'
        );
      }
    }

    return {
      init,
      isReserved,
      getReservation,
      isMyBooking,
      reserve,
      cancel,
      onUpdate,
      openBookingModal,
      openCancelModal,
      renderDetailWidget,
      attachDetailListeners,
      get isConfigured() {
        return isConfigured;
      }
    };
  })();

  var BookingManager = window.BookingManager;

