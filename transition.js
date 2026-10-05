'use strict';

(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const currentUrl = new URL(window.location.href);

  if (currentUrl.searchParams.get('transition') === 'matrix') {
    currentUrl.searchParams.delete('transition');
    try { window.history.replaceState(null, '', currentUrl); } catch { /* Keep the URL if replacing it is unavailable. */ }
    document.body.classList.add('matrix-arriving');
    window.setTimeout(() => document.body.classList.remove('matrix-arriving'), 700);
  }

  const enterLink = document.querySelector('.hero-cta');
  if (!enterLink) return;

  enterLink.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || reducedMotion.matches) return;
    event.preventDefault();
    if (enterLink.dataset.transitioning) return;
    enterLink.dataset.transitioning = 'true';

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

    const context = canvas.getContext('2d');
    const cell = 18;
    const fontSize = 16;
    const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789ﾊﾋﾌﾍﾎ';
    let drops = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const columns = Math.ceil(canvas.width / cell);
      drops = Array.from({ length: columns }, () => ({
        row: Math.random() * (canvas.height / fontSize),
        speed: 1.7 + Math.random() * 2.5
      }));
    };

    const draw = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = `${fontSize}px monospace`;
      drops.forEach((drop, column) => {
        const head = Math.floor(drop.row);
        for (let tail = 0; tail < 9; tail++) {
          const row = head - tail;
          if (row < 0) continue;
          context.globalAlpha = tail === 0 ? .98 : .72 - tail * .075;
          context.fillStyle = tail === 0 && Math.random() > .72 ? '#d9ffe0' : '#35ff51';
          context.fillText(glyphs[Math.random() * glyphs.length | 0], column * cell, row * fontSize);
        }
        drop.row += drop.speed;
        if (head * fontSize > canvas.height + 10 * fontSize && Math.random() > .96) {
          drop.row = -Math.random() * 8;
        }
      });
      context.globalAlpha = 1;
      window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    draw();

    const destination = new URL(enterLink.href);
    destination.searchParams.set('transition', 'matrix');
    window.setTimeout(() => window.location.assign(destination), 720);
  });
})();
