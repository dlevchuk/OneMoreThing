'use strict';

(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  const currentUrl = new URL(window.location.href);

  // Таймінги (REVEAL_MS має збігатися з .32s у css/perf.css)
  const LEAVE_MS = 360;   // скільки падає дощ перед переходом
  const HOLD_MS = 160;    // скільки дощ видно на новій сторінці
  const REVEAL_MS = 320;  // розчинення завіси

  const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789ﾊﾋﾌﾍﾎ';
  const CELL = 20;        // ширина колонки
  const FONT = 18;
  const ROW = 20;         // крок по вертикалі

  // Гліфи малюємо один раз в атлас, далі лише drawImage (набагато дешевше за fillText)
  let atlasCache = null;
  function getAtlas() {
    if (atlasCache) return atlasCache;
    const rowH = FONT + 4;
    const atlas = document.createElement('canvas');
    atlas.width = CELL * GLYPHS.length;
    atlas.height = rowH * 2;
    const a = atlas.getContext('2d');
    a.font = `${FONT}px monospace`;
    a.textBaseline = 'top';
    ['#35ff51', '#d9ffe0'].forEach((color, row) => {
      a.fillStyle = color;
      for (let i = 0; i < GLYPHS.length; i++) {
        a.fillText(GLYPHS[i], i * CELL, row * rowH + 1);
      }
    });
    atlasCache = { atlas, rowH };
    return atlasCache;
  }

  function startMatrixRain(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};
    const { atlas, rowH } = getAtlas();

    const w = canvas.width = window.innerWidth;
    const h = canvas.height = window.innerHeight;
    const rows = Math.ceil(h / ROW);
    const drops = Array.from({ length: Math.ceil(w / CELL) }, () => ({
      row: Math.random() * rows,
      speed: 1.4 + Math.random() * 1.8
    }));

    let rafId = 0;
    let last = 0;

    const frame = now => {
      if (reducedMotion.matches) return;
      rafId = window.requestAnimationFrame(frame);
      const dt = Math.min((now - (last || now)) / 16.667, 3) || 1;
      last = now;

      // шлейф = плавне згасання попередніх кадрів
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';

      for (let c = 0; c < drops.length; c++) {
        const drop = drops[c];
        const from = Math.floor(drop.row);
        drop.row += drop.speed * dt;
        const to = Math.floor(drop.row);
        for (let r = from + 1; r <= to; r++) {
          if (r < 0 || r > rows) continue;
          const glyph = (Math.random() * GLYPHS.length) | 0;
          const head = r === to ? 1 : 0;
          ctx.drawImage(atlas, glyph * CELL, head * rowH, CELL, rowH, c * CELL, r * ROW, CELL, rowH);
        }
        if (drop.row > rows + 2) drop.row = -Math.random() * rows * .5;
      }
    };

    rafId = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(rafId);
  }

  // Arrival handling
  const isArriving = root.classList.contains('matrix-arriving') ||
    currentUrl.searchParams.get('transition') === 'matrix';

  if (isArriving) {
    root.classList.add('matrix-arriving');
    if (currentUrl.searchParams.has('transition')) {
      currentUrl.searchParams.delete('transition');
      try { window.history.replaceState(null, '', currentUrl); } catch { /* Ignore */ }
    }

    const veil = document.getElementById('matrix-arriving-veil');
    const done = () => {
      if (veil) veil.remove();
      root.classList.remove('matrix-arriving', 'matrix-revealing');
    };

    if (reducedMotion.matches || !veil) {
      done();
    } else {
      const canvas = veil.querySelector('.matrix-transition-canvas');
      const stopRain = canvas ? startMatrixRain(canvas) : () => {};
      window.setTimeout(() => {
        root.classList.add('matrix-revealing');
        window.setTimeout(() => {
          stopRain();
          done();
        }, REVEAL_MS + 40);
      }, HOLD_MS);
    }
  }

  // Departure handling (index.html hero CTA)
  const enterLink = document.querySelector('.hero-cta');
  if (enterLink) {
    enterLink.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (enterLink.dataset.transitioning) { event.preventDefault(); return; }
      enterLink.dataset.transitioning = 'true';

      const destination = new URL(enterLink.href, window.location.href);
      if (reducedMotion.matches) {
        event.preventDefault();
        window.location.assign(destination);
        return;
      }

      event.preventDefault();
      document.body.classList.add('matrix-leaving');
      const overlay = document.createElement('div');
      overlay.className = 'matrix-rain-transition';
      overlay.setAttribute('aria-hidden', 'true');
      const shade = document.createElement('div');
      shade.className = 'matrix-transition-shade';
      const canvas = document.createElement('canvas');
      canvas.className = 'matrix-transition-canvas';
      overlay.append(shade, canvas);
      document.body.append(overlay);

      const stopRain = startMatrixRain(canvas);

      destination.searchParams.set('transition', 'matrix');
      window.setTimeout(() => {
        stopRain();
        window.location.assign(destination);
      }, LEAVE_MS);
    });
  }

  // Reset state on bfcache restore
  window.addEventListener('pageshow', () => {
    if (enterLink) delete enterLink.dataset.transitioning;
    document.body.classList.remove('matrix-leaving');
    const staleOverlay = document.querySelector('.matrix-rain-transition:not(#matrix-arriving-veil)');
    if (staleOverlay) staleOverlay.remove();
  });
})();
