(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  if (!x) return;
  c.id = 'rain';
  c.setAttribute('aria-hidden', 'true');
  document.body.prepend(c);

  const root = document.documentElement;
  const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789ﾊﾋﾌﾍﾎ';
  const atlas = document.createElement('canvas');
  const a = atlas.getContext('2d');
  if (!a) { c.remove(); return; }
  const FRAME_MS = 50;
  let size = 16;
  let drops = [];
  let last = 0;
  let raf = 0;

  function setup() {
    size = innerWidth < 640 ? 24 : 16;
    c.width = innerWidth;
    c.height = innerHeight;
    drops = Array.from({ length: Math.ceil(c.width / size) }, () => Math.random() * c.height / size);
    atlas.width = size * glyphs.length;
    atlas.height = size * 2;
    a.font = size + 'px monospace';
    a.textBaseline = 'top';
    ['#35ff51', '#d9ffe0'].forEach((color, row) => {
      a.fillStyle = color;
      for (let i = 0; i < glyphs.length; i++) a.fillText(glyphs[i], i * size, row * size);
    });
  }

  function paused() {
    return motion.matches || document.hidden || root.classList.contains('matrix-arriving') ||
      document.body.classList.contains('matrix-leaving') || !!document.querySelector('dialog[open]');
  }

  function sync() {
    c.hidden = motion.matches;
    if (paused()) {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      if (motion.matches) x.clearRect(0, 0, c.width, c.height);
    } else if (!raf) {
      raf = requestAnimationFrame(tick);
    }
  }

  function tick(t) {
    raf = 0;
    if (paused()) return;
    if (t - last >= FRAME_MS) {
      last = t - (t - last) % FRAME_MS;
      x.globalCompositeOperation = 'destination-out';
      x.fillStyle = 'rgba(0,0,0,.1)';
      x.fillRect(0, 0, c.width, c.height);
      x.globalCompositeOperation = 'source-over';
      drops.forEach((y, i) => {
        const glyph = Math.random() * glyphs.length | 0;
        const row = Math.random() > .975 ? 1 : 0;
        x.drawImage(atlas, glyph * size, row * size, size, size, i * size, y * size, size, size);
        drops[i] = y * size > c.height && Math.random() > .975 ? 0 : y + 1;
      });
    }
    raf = requestAnimationFrame(tick);
  }

  let lastWidth = innerWidth;
  addEventListener('resize', () => {
    if (innerWidth !== lastWidth) { lastWidth = innerWidth; setup(); }
    else if (c.height !== innerHeight) c.height = innerHeight;
  });
  // Зупиняємо rAF повністю на час переходів і діалогів.
  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.querySelectorAll('dialog').forEach(dialog => observer.observe(dialog, { attributes: true, attributeFilter: ['open'] }));
  motion.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  addEventListener('pageshow', sync);
  setup();
  sync();
})();
