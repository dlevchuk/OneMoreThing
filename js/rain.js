(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const c = document.createElement('canvas');
  c.id = 'rain';
  c.setAttribute('aria-hidden', 'true');
  document.body.prepend(c);

  const x = c.getContext('2d');
  const g = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789ﾊﾋﾌﾍﾎ';
  const FRAME_MS = 50; // ~20 fps, як і було
  let s = 16;
  let d = [];
  let last = 0;

  const setup = () => {
    // на вузьких екранах рідші колонки: менше fillText на кадр
    s = innerWidth < 640 ? 24 : 16;
    c.width = innerWidth;
    c.height = innerHeight;
    d = Array.from({ length: Math.ceil(c.width / s) }, () => Math.random() * c.height / s);
  };

  let lastWidth = innerWidth;
  setup();
  addEventListener('resize', () => {
    // на мобілках resize стріляє при ховanні адресного рядка; скидаємо краплі лише при зміні ширини
    if (innerWidth === lastWidth) {
      c.height = innerHeight;
      return;
    }
    lastWidth = innerWidth;
    setup();
  });

  const tick = t => {
    requestAnimationFrame(tick); // rAF сам стає на паузу у прихованій вкладці
    if (t - last < FRAME_MS) return;
    last = t;
    // пауза, поки відкрите модальне вікно
    if (document.querySelector('dialog[open]')) return;

    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = 'rgba(0,0,0,.1)';
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'source-over';
    x.font = s + 'px monospace';
    d.forEach((y, i) => {
      x.fillStyle = Math.random() > .975 ? '#d9ffe0' : '#35ff51';
      x.fillText(g[Math.random() * g.length | 0], i * s, y * s);
      d[i] = y * s > c.height && Math.random() > .975 ? 0 : y + 1;
    });
  };
  requestAnimationFrame(tick);
})();