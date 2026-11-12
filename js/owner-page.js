'use strict';

(async () => {
  const manager = window.OwnerManager;
  const login = document.getElementById('owner-login');
  const signedIn = document.getElementById('owner-signed-in');
  const status = document.getElementById('owner-message');
  const send = document.getElementById('owner-send');
  let cooldownUntil = 0;
  let timer;
  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('is-error', error);
  }
  function cooldown() {
    const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    send.disabled = remaining > 0;
    send.textContent = remaining ? `Повторити через ${remaining} с` : 'Надіслати посилання';
    if (!remaining) clearInterval(timer);
  }
  function render() {
    login.hidden = manager.isOwner;
    signedIn.hidden = !manager.isOwner;
    if (manager.isOwner) message('Вхід виконано. Тепер можна керувати контрактами.');
  }
  manager.onUpdate(render);
  login.addEventListener('submit', async event => {
    event.preventDefault();
    if (send.disabled || Date.now() < cooldownUntil) return;
    send.disabled = true;
    const email = document.getElementById('owner-email').value.trim().toLowerCase();
    try {
      await manager.requestLink(email);
      cooldownUntil = Date.now() + 60000;
      clearInterval(timer);
      timer = setInterval(cooldown, 1000);
      cooldown();
      message('Якщо для цієї адреси доступний вхід, надійде лист. Відкрий посилання в цьому самому браузері.');
    } catch (error) { message(error.message, true); send.disabled = false; }
  });
  document.getElementById('owner-signout').addEventListener('click', async () => {
    try { await manager.signOut(); render(); message('Ти вийшов з облікового запису.'); }
    catch (error) { message(error.message, true); }
  });
  try { await manager.init(); render(); }
  catch (error) { message(error.message || 'Не вдалося перевірити вхід. Перезавантаж сторінку.', true); }
})();
