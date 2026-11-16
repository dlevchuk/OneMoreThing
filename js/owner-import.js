'use strict';
(() => {
  const manager = window.OwnerManager;
  const panel = document.getElementById('owner-import-panel');
  if (!manager || !panel) return;
  const form = document.getElementById('wish-import-form');
  const button = document.getElementById('wish-import-submit');
  const status = document.getElementById('wish-import-message');
  const jobs = document.getElementById('wish-import-jobs');
  let saving = false, timer, version = 0;
  const labels = { queued: 'У черзі', processing: 'Перевіряємо товар і ціну', done: 'Імпорт завершено. Дошка оновлюється автоматично.',
    failed: 'Не вдалося додати. Перевір посилання; для сторінки без ціни можна дозволити додавання без моніторингу.' };
  function message(text, error = false) { status.textContent = text; status.classList.toggle('is-error', error); }
  async function refresh() {
    if (!manager.isOwner || document.visibilityState === 'hidden') return;
    const current = version;
    try {
      const entries = await manager.listImports();
      if (current !== version || !manager.isOwner) return;
      jobs.replaceChildren();
      entries.forEach(entry => {
        const row = document.createElement('li');
        const link = document.createElement('a');
        link.textContent = entry.product_url;
        if (/^https?:\/\//.test(entry.product_url)) { link.href = entry.product_url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        const label = document.createElement('p');
        label.textContent = labels[entry.status] || 'Оновлюємо статус';
        label.classList.toggle('is-error', entry.status === 'failed');
        row.append(link, label); jobs.append(row);
      });
    } catch (error) { if (current === version && manager.isOwner) message(error.message, true); }
  }
  function render() {
    version++;
    panel.hidden = !manager.isOwner;
    clearInterval(timer);
    if (manager.isOwner) { refresh(); timer = setInterval(refresh, 15000); }
    else { jobs.replaceChildren(); message(''); }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !manager.isOwner) return;
    saving = true; button.disabled = true;
    try {
      await manager.requestImport(document.getElementById('wish-import-url').value,
        document.getElementById('wish-import-priority').value, document.getElementById('wish-import-unmonitored').checked);
      message('Запит прийнято. Статус оновлюватиметься тут автоматично.');
      form.reset(); await refresh();
    } catch (error) { message(error.message, true); }
    finally { saving = false; button.disabled = false; }
  });
  manager.onUpdate(render);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') refresh(); });
  render();
})();
