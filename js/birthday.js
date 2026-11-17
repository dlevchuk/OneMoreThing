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
  const label = countdown.querySelector('.birthday-countdown-label');
  const time = countdown.querySelector('.birthday-countdown-time');
  const defaultLabel = label.textContent;
  const todayLabel = 'РЕЛІЗ СЬОГОДНІ';
  const formatter = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' });
  const pad = value => String(value).padStart(2, '0');
  const isBirthday = now => now.getMonth() === 10 && now.getDate() === 17;

  function nextNovember17(now) {
    let target = new Date(now.getFullYear(), 10, 17);
    if (target <= now) target = new Date(now.getFullYear() + 1, 10, 17);
    return target;
  }

  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  let target = nextNovember17(new Date());

  function render() {
    const now = new Date();
    if (target.getTime() <= now.getTime()) target = nextNovember17(now);
    const today = isBirthday(now);

    // 17 листопада замість відліку на 364 дні показуємо "сьогодні".
    time.hidden = today;
    setText(label, today ? todayLabel : defaultLabel);
    setText(dateLabel, formatter.format(today ? now : target).toUpperCase());
    if (today) return;

    const totalSeconds = Math.floor(Math.max(0, target.getTime() - now.getTime()) / 1000);
    setText(units.days, String(Math.floor(totalSeconds / 86400)));
    setText(units.hours, pad(Math.floor(totalSeconds % 86400 / 3600)));
    setText(units.minutes, pad(Math.floor(totalSeconds % 3600 / 60)));
    setText(units.seconds, pad(totalSeconds % 60));
  }

  render();
  window.setInterval(render, 1000);
})();
