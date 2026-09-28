// The hat: every comment square, whatever it said, falls and turns into the same gold coin in an
// upturned hat that nobody is holding. One dashed square never falls: the question nobody asked.
// Runs once when it comes into view; tap or Space replays; reduced motion shows the end state.

const canvas = document.querySelector('.hat-canvas');
if (canvas) init(canvas);

function init(canvas) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const big = document.querySelector('.hat-big');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = getComputedStyle(document.documentElement);
  const tok = (n, d) => css.getPropertyValue(n).trim() || d;
  const C = {paper: tok('--paper', '#f2efe8'), ink: '#141312', red: '#fd0001', hair: '#e8cd8c', gold: '#e8cd8c', gold2: '#b8975a',
    f: tok('--blond', '#e8cd8c'), q: tok('--steel', '#8fa3b3'), w: tok('--red', '#fd0001'), m: tok('--garden', '#2f7a4c'), o: '#d8d2c6'};
  const FACE = new Path2D('M31,38 L69,38 L69,76 C69,88 60,94 50,94 C40,94 31,88 31,76 Z');
  const HAIR = new Path2D('M50,6 C65,6 75,15 79,30 C83,45 89,62 95,77 C87,81 76,80 69,74 C70,62 70,50 69,39 C61,35 39,35 31,39 C30,50 30,62 31,74 C24,80 13,81 5,77 C11,62 17,45 21,30 C25,15 35,6 50,6 Z');
  const STACHE = new Path2D('M38.6,64.6 C36.2,62.6 33.4,64.4 34.6,67.2 C35.8,70 40,71.2 43.6,70.2 C46.4,69.4 48.4,68.2 50,67.4 C51.6,68.2 53.6,69.4 56.4,70.2 C60,71.2 64.2,70 65.4,67.2 C66.6,64.4 63.8,62.6 61.4,64.6');

  // The same 475 comments in the wall's default order: played along, real or AI, worried, money, the rest.
  const ORDER = {f: 0, q: 1, w: 2, m: 3, o: 4};
  const data = ((window.SG && window.SG.comments) || []).map((c, i) => ({x: c.x, i})).sort((a, b) => (ORDER[a.x] ?? 9) - (ORDER[b.x] ?? 9) || a.i - b.i);
  const N = data.length || 475, COLS = 25;
  const rnd = (s => () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(475);
  const jitter = data.map(() => ({dx: rnd(), spin: rnd() < .5 ? -1 : 1, lag: rnd() * .12}));

  let W = 0, H = 0, dpr = 1, L = null, t0 = null, raf = 0, visible = false, done = false;
  const DROP = 2.4, FALL = .95; // seconds for all squares to let go; seconds for one to fall

  function layout() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.round(r.width * dpr); H = Math.round(r.height * dpr);
    if (!W || !H) return false;
    canvas.width = W; canvas.height = H;
    const rows = Math.ceil(N / COLS) + 1;
    const cell = Math.min(W * .78 / COLS, H * .44 / rows), gap = cell * .2, sq = cell - gap;
    const gx = (W - COLS * cell + gap) / 2, gy = H * .06;
    const hatW = Math.min(W * .5, cell * COLS * .62), hatX = W / 2, groundY = H * .9;
    L = {cell, gap, sq, gx, gy, hatW, hatX, groundY, mouthY: groundY - hatW * .52, u: Math.min(W, H) / 100};
    return true;
  }
  const pos = k => [L.gx + (k % COLS) * L.cell, L.gy + Math.floor(k / COLS) * L.cell];
  const ease = k => k * k; // gravity
  function coin(x, y, r, sx = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(Math.max(.06, sx), 1);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = C.gold; ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(.8, r * .14); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * .76, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill(); ctx.clip();
    const k = r * .76 * .74 / 38; ctx.scale(k, k); ctx.translate(-50, -46);
    ctx.fillStyle = C.hair; ctx.fill(HAIR); ctx.strokeStyle = C.hair; ctx.lineWidth = 4.2; ctx.lineCap = 'round'; ctx.stroke(STACHE);
    ctx.restore();
  }
  function hat(fill) {
    const {hatX: x, hatW: w, groundY: g} = L, lw = Math.max(1.5 * dpr, L.u * .45);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // the pavement: a wobbly hand-inked line
    ctx.strokeStyle = C.ink; ctx.lineWidth = lw; ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const px = W * .06 + (W * .88) * i / 24, py = g + Math.sin(i * 1.7) * L.u * .25; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
    // an upturned bowler: crown resting on the pavement, brim up, one red band
    const cw = w * .62, ch = w * .46, top = g - ch;
    ctx.beginPath(); ctx.moveTo(x - cw / 2, top); ctx.bezierCurveTo(x - cw / 2, g + ch * .05, x + cw / 2, g + ch * .05, x + cw / 2, top); ctx.closePath();
    ctx.fillStyle = '#2a2724'; ctx.fill(); ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.save(); ctx.clip(); ctx.fillStyle = C.red; ctx.fillRect(x - cw / 2, top + ch * .08, cw, ch * .17); ctx.restore();
    // the coins heaped in its mouth
    const n = Math.min(1, fill);
    if (n > 0) {
      ctx.save(); ctx.beginPath(); ctx.ellipse(x, top, cw * .5, ch * .16 + n * ch * .3, 0, Math.PI, 0); ctx.lineTo(x + cw * .5, top); ctx.closePath();
      ctx.fillStyle = C.gold; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = lw * .7; ctx.stroke(); ctx.clip();
      ctx.strokeStyle = C.gold2; ctx.lineWidth = lw * .6;
      for (let i = 0; i < 9; i++) { const cx = x - cw * .4 + cw * .8 * ((i * .37) % 1), cy = top - ch * .04 - (i % 3) * ch * .1 * n; ctx.beginPath(); ctx.ellipse(cx, cy, cw * .07, cw * .035, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }
    // the brim, drawn over the heap
    ctx.beginPath(); ctx.ellipse(x, top, w * .5, w * .1, 0, 0, Math.PI * 2);
    ctx.strokeStyle = C.ink; ctx.lineWidth = lw; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, top, w * .5, w * .1, 0, 0, Math.PI); ctx.fillStyle = '#2a2724'; ctx.fill(); ctx.stroke();
  }

  function draw(now) {
    if (!L) return;
    const t = t0 == null ? (reduced ? 99 : 0) : (now - t0) / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    let landed = 0;
    const [mx, my] = [L.hatX, L.mouthY];
    // the squares, their ghosts, and the ones in the air
    for (let k = 0; k < N; k++) {
      const [x, y] = pos(k), c = data[k] || {x: 'o'}, j = jitter[k] || {dx: .5, spin: 1, lag: 0};
      const start = (k / N) * DROP + j.lag, f = (t - start) / FALL;
      if (f <= 0) { ctx.fillStyle = C[c.x] || C.o; ctx.fillRect(x, y, L.sq, L.sq); continue; }
      ctx.strokeStyle = 'rgba(20,19,18,.14)'; ctx.lineWidth = Math.max(.5, dpr * .5); ctx.strokeRect(x + .5, y + .5, L.sq - 1, L.sq - 1);
      if (f >= 1) { landed++; continue; }
      const tx = mx + (j.dx - .5) * L.hatW * .4, e = ease(f);
      const px = x + (tx - x) * f, py = y + (my - y) * e - Math.sin(f * Math.PI) * L.cell * 2;
      if (f < .5) { // still a square, turning on its edge
        const sx = Math.cos(f * Math.PI); ctx.save(); ctx.translate(px + L.sq / 2, py + L.sq / 2); ctx.scale(Math.max(.06, sx), 1);
        ctx.fillStyle = C[c.x] || C.o; ctx.fillRect(-L.sq / 2, -L.sq / 2, L.sq, L.sq); ctx.restore();
      } else coin(px + L.sq / 2, py + L.sq / 2, L.sq * .75, -Math.cos(f * Math.PI));
    }
    // the one that never falls: dashed, empty, its dashes creeping
    const [zx, zy] = pos(N);
    ctx.save(); ctx.setLineDash([L.sq * .22, L.sq * .16]); ctx.lineDashOffset = reduced ? 0 : -now / 90;
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1, dpr); ctx.strokeRect(zx + .5, zy + .5, L.sq - 1, L.sq - 1); ctx.restore();
    // a thin drizzle of ink specks: everyone who only watched
    if (!reduced && t0 != null) {
      ctx.fillStyle = 'rgba(20,19,18,.3)';
      for (let i = 0; i < 26; i++) { const ph = ((now / 1000) * .55 + i * .173) % 1, sx = mx + (((i * 7919) % 97) / 97 - .5) * L.hatW * .5; ctx.fillRect(sx, L.gy + (my - L.gy) * ph, dpr, dpr * 1.6); }
    }
    hat(reduced ? 1 : landed / N);
    if (!done && (reduced || t > DROP + FALL + .3)) { done = true; big?.classList.add('on'); }
  }

  function frame(now) {
    raf = 0; draw(now);
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!reduced && !raf && visible && !document.hidden) raf = requestAnimationFrame(frame); }
  function play() { if (reduced) { draw(performance.now()); return; } done = false; big?.classList.remove('on'); t0 = performance.now() + 400; wake(); }
  new IntersectionObserver(es => {
    const e = es[es.length - 1], was = visible; visible = e.isIntersecting && e.intersectionRatio >= .6;
    if (visible && !was) play(); // replays each time it comes back into view
    if (!e.isIntersecting) { t0 = null; done = false; big?.classList.remove('on'); draw(performance.now()); if (reduced) { big?.classList.add('on'); done = true; } }
  }, {threshold: [0, .6, .9]}).observe(canvas);
  document.addEventListener('visibilitychange', wake);
  canvas.addEventListener('click', play);
  canvas.addEventListener('mousedown', e => e.preventDefault());
  canvas.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); play(); } });
  new ResizeObserver(() => { if (layout()) draw(performance.now()); }).observe(canvas);
  if (reduced) { big?.classList.add('on'); done = true; }
}
