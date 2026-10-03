(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.id = 'rain'; c.setAttribute('aria-hidden', 'true');
  document.body.prepend(c);
  const x = c.getContext('2d'), s = 16;
  const g = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789ﾊﾋﾌﾍﾎ';
  let d = [];
  const resize = () => {
    c.width = innerWidth; c.height = innerHeight;
    d = Array.from({ length: Math.ceil(c.width / s) }, () => Math.random() * c.height / s);
  };
  resize(); addEventListener('resize', resize);
  setInterval(() => {
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = 'rgba(0,0,0,.1)'; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'source-over';
    x.font = s + 'px monospace';
    d.forEach((y, i) => {
      x.fillStyle = Math.random() > .975 ? '#d9ffe0' : '#35ff51';
      x.fillText(g[Math.random() * g.length | 0], i * s, y * s);
      d[i] = y * s > c.height && Math.random() > .975 ? 0 : y + 1;
    });
  }, 50);
})();
