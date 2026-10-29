'use strict';

(() => {
  const countdown = document.getElementById('birthday-countdown');
  if (!countdown) return;

  const units = {
    days: countdown.querySelector('[data-countdown-days]'),
    hours: countdown.querySelector('[data-countdown-hours]'),
    minutes: countdown.querySelector('[data-countdown-minutes]'),
    seconds: countdown.querySelector('[data-countdown-seconds]')
  };
  const dateLabel = countdown.querySelector('[data-countdown-date]');
  const pad = value => String(value).padStart(2, '0');

  function nextNovember17(now) {
    let target = new Date(now.getFullYear(), 10, 17);
    if (target <= now) target = new Date(now.getFullYear() + 1, 10, 17);
    return target;
  }

  function render(target) {
    const remaining = Math.max(0, target.getTime() - Date.now());
    const totalSeconds = Math.floor(remaining / 1000);
    units.days.textContent = Math.floor(totalSeconds / 86400);
    units.hours.textContent = pad(Math.floor(totalSeconds % 86400 / 3600));
    units.minutes.textContent = pad(Math.floor(totalSeconds % 3600 / 60));
    units.seconds.textContent = pad(totalSeconds % 60);
  }

  let target = nextNovember17(new Date());
  const updateDateLabel = () => {
    dateLabel.textContent = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' }).format(target).toUpperCase();
  };
  updateDateLabel();
  render(target);
  window.setInterval(() => {
    if (target.getTime() <= Date.now()) {
      target = nextNovember17(new Date());
      updateDateLabel();
    }
    render(target);
  }, 1000);
})();
