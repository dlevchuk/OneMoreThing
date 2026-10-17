'use strict';

(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const currentUrl = new URL(window.location.href);

  function startMatrixRain(canvas) {
    const context = canvas.getContext('2d');
    if (!context) return () => {};
    const cell = 18;
    const fontSize = 16;
    const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789ﾊﾋﾌﾍﾎ';
    let drops = [];
    let animationFrameId = null;

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
      animationFrameId = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    draw();

    return () => {
      window.removeEventListener('resize', resize);
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    };
  }

  // Arrival handling
  const isArriving = document.documentElement.classList.contains('matrix-arriving') ||
    currentUrl.searchParams.get('transition') === 'matrix';

  if (isArriving) {
    document.documentElement.classList.add('matrix-arriving');
    if (currentUrl.searchParams.has('transition')) {
      currentUrl.searchParams.delete('transition');
      try { window.history.replaceState(null, '', currentUrl); } catch { /* Ignore */ }
    }

    const veil = document.getElementById('matrix-arriving-veil');
    if (!reducedMotion.matches && veil) {
      const canvas = veil.querySelector('.matrix-transition-canvas');
      const stopRain = canvas ? startMatrixRain(canvas) : () => {};
      window.setTimeout(() => {
        stopRain();
        veil.remove();
        document.documentElement.classList.remove('matrix-arriving');
      }, 500);
    } else {
      if (veil) veil.remove();
      document.documentElement.classList.remove('matrix-arriving');
    }
  }

  // Departure handling (index.html hero CTA)
  const enterLink = document.querySelector('.hero-cta');
  if (enterLink) {
    enterLink.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (enterLink.dataset.transitioning) return;
      enterLink.dataset.transitioning = 'true';

      const destination = new URL(enterLink.href, window.location.href);
      if (reducedMotion.matches) {
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
      }, 420);
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
