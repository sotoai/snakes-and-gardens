// The hat: every comment square, whatever it said, falls and turns into the same gold coin in an
// upturned bowler on the pavement that nobody is holding. One dashed square never falls: the question nobody asked.
// The first coins sink out of sight; the last heap up over the brim. Coins pass in front of the far brim and
// behind the near one. Runs once when it comes into view; tap or Space replays; reduced motion shows the end state.

const canvas = document.querySelector('.hat-canvas');
if (canvas) init(canvas);

function init(canvas) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const big = document.querySelector('.hat-big');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = getComputedStyle(document.documentElement);
  const tok = (n, d) => css.getPropertyValue(n).trim() || d;
  const C = {paper: tok('--paper', '#f2efe8'), ink: '#141312', red: '#fd0001', hair: '#e8cd8c', gold: ['#e8cd8c', '#f0da9f', '#dcc07b'], rim: '#b08e52',
    felt: '#2d2825', felt2: '#383230', lip: '#161312', band: '#d0120d', leather: '#7a5638', pave: '230,224,212', joint: 'rgba(20,19,18,.12)', shadow: 'rgba(20,19,18,.16)',
    f: tok('--blond', '#e8cd8c'), q: tok('--steel', '#8fa3b3'), w: tok('--red', '#fd0001'), m: tok('--garden', '#2f7a4c'), o: '#d8d2c6'};
  const HAIR = new Path2D('M50,6 C65,6 75,15 79,30 C83,45 89,62 95,77 C87,81 76,80 69,74 C70,62 70,50 69,39 C61,35 39,35 31,39 C30,50 30,62 31,74 C24,80 13,81 5,77 C11,62 17,45 21,30 C25,15 35,6 50,6 Z');
  const STACHE = new Path2D('M38.6,64.6 C36.2,62.6 33.4,64.4 34.6,67.2 C35.8,70 40,71.2 43.6,70.2 C46.4,69.4 48.4,68.2 50,67.4 C51.6,68.2 53.6,69.4 56.4,70.2 C60,71.2 64.2,70 65.4,67.2 C66.6,64.4 63.8,62.6 61.4,64.6');

  // The same 475 comments in the wall's default order: played along, real or AI, worried, money, the rest.
  const ORDER = {f: 0, q: 1, w: 2, m: 3, o: 4};
  const data = ((window.SG && window.SG.comments) || []).map((c, i) => ({x: c.x, i})).sort((a, b) => (ORDER[a.x] ?? 9) - (ORDER[b.x] ?? 9) || a.i - b.i);
  const N = data.length || 475, COLS = 25;
  const rnd = (s => () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(475);
  const lag = Array.from({length: N}, () => rnd() * .14);
  const DROP = 3, FALL = 1.15; // seconds for all squares to let go; seconds for one to fall
  const startAt = k => (k / N) * DROP + lag[k];
  const order = [...Array(N).keys()].sort((a, b) => startAt(a) - startAt(b)), rank = [];
  order.forEach((k, i) => { rank[k] = i; });
  // Where each coin comes to rest, in landing order (u, v across the opening; d below the rim, in brim radii).
  const spots = Array.from({length: N}, (_, i) => {
    const p = (i + .5) / N; let u, v;
    do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; } while (u * u + v * v > 1);
    const d = .8 * Math.pow(1 - p, 1.6) - .5 * Math.pow(p, 1.5) * Math.pow(1 - u * u - v * v, .9) + (rnd() - .5) * .04;
    return {u, v, d, tilt: (rnd() - .5) * 1.3, squash: .42 + rnd() * .3, shade: Math.floor(rnd() * 3)};
  });

  const pile = document.createElement('canvas'), pctx = pile.getContext('2d');
  let W = 0, H = 0, dpr = 1, L = null, t0 = null, raf = 0, visible = false, done = false, settled = 0;

  function layout() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.round(r.width * dpr); H = Math.round(r.height * dpr);
    if (!W || !H) return false;
    canvas.width = pile.width = W; canvas.height = pile.height = H;
    const rows = Math.ceil((N + 1) / COLS);
    const cell = Math.min(W * .8 / COLS, H * .3 / rows), gap = cell * .2, sq = cell - gap;
    const Rb = Math.min(W * .4, H * .32), Ro = Rb * .64, k = .36, D = Rb * .8; // brim radius, opening radius, tilt, crown depth
    const groundY = H - Rb * .5;
    L = {cell, gap, sq, gx: (W - COLS * cell + gap) / 2, gy: H * .03, Rb, Ro, k, D, groundY, rimY: groundY - D, cx: W / 2,
      curl: Rb * .08, r: Ro * .15, lw: Math.max(1.2 * dpr, Rb * .016)};
    pctx.clearRect(0, 0, W, H);
    for (let i = 0; i < settled; i++) settle(i);
    return true;
  }
  const pos = k => [L.gx + (k % COLS) * L.cell, L.gy + Math.floor(k / COLS) * L.cell];
  const rest = s => [L.cx + s.u * L.Ro * .86, L.rimY + s.v * L.k * L.Ro * .86 + s.d * L.Rb];
  const smooth = (a, b, x) => { const q = Math.min(1, Math.max(0, (x - a) / (b - a))); return q * q * (3 - 2 * q); };

  function coin(g, x, y, r, sx = 1, sy = 1, rot = 0, face = C.gold[0], edge = 0) {
    const disc = (ox, oy, fill) => {
      g.save(); g.translate(x + ox, y + oy); g.rotate(rot); g.scale(Math.max(.06, sx), Math.max(.06, sy));
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
      g.strokeStyle = C.ink; g.lineWidth = Math.max(.8, r * .12); g.stroke();
      return g;
    };
    if (edge) disc(0, edge, C.rim).restore();
    disc(0, 0, face);
    g.beginPath(); g.arc(0, 0, r * .74, 0, Math.PI * 2); g.fillStyle = C.red; g.fill(); g.clip();
    const s = r * .74 * .74 / 38; g.scale(s, s); g.translate(-50, -46);
    g.fillStyle = C.hair; g.fill(HAIR); g.strokeStyle = C.hair; g.lineWidth = 4.2; g.lineCap = 'round'; g.stroke(STACHE);
    g.restore();
  }
  function settle(i) { const s = spots[i], [x, y] = rest(s); coin(pctx, x, y, L.r, 1, s.squash, s.tilt, C.gold[s.shade], L.r * .16); }

  // The brim, as a ring between the opening and an outer edge whose sides roll down toward the pavement.
  const brimPt = (R, th) => {
    const q = Math.max(0, (R - L.Ro) / (L.Rb - L.Ro)), c = Math.cos(th);
    return [L.cx + R * c, L.rimY + L.k * R * Math.sin(th) + L.curl * q * q * c * c];
  };
  function edge(R, a, b, move = true) {
    for (let i = 0; i <= 60; i++) { const [x, y] = brimPt(R, a + (b - a) * i / 60); i || !move ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  }
  const mouth = (a = 0, b = Math.PI * 2, ccw = false) => ctx.ellipse(L.cx, L.rimY, L.Ro, L.k * L.Ro, 0, a, b, ccw);
  function crown() {
    const {cx, rimY: y, Ro, D} = L;
    ctx.beginPath(); ctx.moveTo(cx - Ro * 1.03, y);
    ctx.bezierCurveTo(cx - Ro * 1.1, y + D * .62, cx - Ro * .7, y + D * 1.02, cx, y + D * 1.02);
    ctx.bezierCurveTo(cx + Ro * .7, y + D * 1.02, cx + Ro * 1.1, y + D * .62, cx + Ro * 1.03, y); ctx.closePath();
  }

  function ground() {
    const {cx, groundY: g, Rb, lw} = L, far = g - Rb * .3, near = Math.min(H, g + Rb * .5);
    const fade = a => { const gr = ctx.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, `rgba(${a},0)`); gr.addColorStop(.16, `rgba(${a},1)`); gr.addColorStop(.84, `rgba(${a},1)`); gr.addColorStop(1, `rgba(${a},0)`); return gr; };
    ctx.fillStyle = fade(C.pave); ctx.fillRect(0, far, W, near - far);
    ctx.save(); ctx.beginPath(); ctx.rect(0, far, W, near - far); ctx.clip();
    ctx.strokeStyle = C.joint; ctx.lineWidth = lw * .7;
    for (let i = -4; i <= 3; i++) { const x = cx + (i + .5) * Rb * 1.15; ctx.beginPath(); ctx.moveTo(cx + (x - cx) * .82, far); ctx.lineTo(cx + (x - cx) * 1.3, near); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = fade('20,19,18'); ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(0, far); ctx.lineTo(W, far); ctx.stroke();
    const bottom = ctx.createLinearGradient(0, near - Rb * .3, 0, near); bottom.addColorStop(0, 'rgba(242,239,232,0)'); bottom.addColorStop(1, C.paper);
    ctx.fillStyle = bottom; ctx.fillRect(0, near - Rb * .3, W, Rb * .3 + 1);
    ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.ellipse(cx + Rb * .16, g - Rb * .03, Rb * .92, Rb * .17, 0, 0, Math.PI * 2); ctx.fill();
  }

  function hatBack() {
    const {cx, rimY: y, Rb, Ro, k, D, lw} = L;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // the crown, resting on the pavement: shade on the right, a sheen on the left, the band just under the brim
    crown(); ctx.fillStyle = C.felt; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(cx + Ro * .8, y + D * .62, Ro * .5, D * .72, -.25, 0, Math.PI * 2); ctx.fill();
    const band = x => y + k * Math.sqrt(Math.max(0, (Ro * 1.04) ** 2 - x * x)) + Rb * .22;
    ctx.beginPath(); ctx.moveTo(cx - Ro * 1.3, y);
    for (let i = 0; i <= 40; i++) { const x = -Ro * 1.1 + Ro * 2.2 * i / 40; ctx.lineTo(cx + x, band(x)); }
    ctx.lineTo(cx + Ro * 1.3, y); ctx.closePath(); ctx.fillStyle = C.band; ctx.fill();
    ctx.beginPath(); for (let i = 0; i <= 40; i++) { const x = -Ro * 1.1 + Ro * 2.2 * i / 40; i ? ctx.lineTo(cx + x, band(x)) : ctx.moveTo(cx + x, band(x)); }
    ctx.strokeStyle = C.ink; ctx.lineWidth = lw * .8; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,246,230,.2)'; ctx.lineWidth = lw * 1.8;
    ctx.beginPath(); ctx.moveTo(cx - Ro * .9, y + D * .5); ctx.quadraticCurveTo(cx - Ro * .8, y + D * .88, cx - Ro * .32, y + D * .96); ctx.stroke();
    ctx.restore();
    crown(); ctx.strokeStyle = C.ink; ctx.lineWidth = lw; ctx.stroke();
    // the whole brim (its near half is drawn again over the coins)
    ctx.beginPath(); edge(Rb, 0, Math.PI * 2); ctx.closePath(); ctx.fillStyle = C.felt2; ctx.fill(); ctx.stroke();
    ctx.beginPath(); edge(Rb * .93, Math.PI, Math.PI * 2); ctx.strokeStyle = 'rgba(255,246,230,.16)'; ctx.lineWidth = lw * .6; ctx.stroke();
    // the inside: lining in shadow, a stitched leather sweatband round the far wall
    const lining = ctx.createLinearGradient(0, y - k * Ro, 0, y + k * Ro); lining.addColorStop(0, '#5a4639'); lining.addColorStop(.55, '#2a211c'); lining.addColorStop(1, '#120e0c');
    ctx.beginPath(); mouth(); ctx.fillStyle = lining; ctx.fill();
    ctx.save(); ctx.beginPath(); mouth(); ctx.clip();
    ctx.beginPath(); ctx.ellipse(cx, y, Ro, k * Ro, 0, Math.PI, Math.PI * 2); ctx.ellipse(cx, y + Rb * .075, Ro * .97, k * Ro * .97, 0, Math.PI * 2, Math.PI, true); ctx.closePath();
    ctx.fillStyle = C.leather; ctx.fill();
    ctx.setLineDash([lw * 1.1, lw * 1.3]); ctx.strokeStyle = 'rgba(255,236,205,.45)'; ctx.lineWidth = lw * .45;
    ctx.beginPath(); ctx.ellipse(cx, y + Rb * .035, Ro * .985, k * Ro * .985, 0, Math.PI * 1.04, Math.PI * 1.96); ctx.stroke();
    ctx.restore();
    ctx.beginPath(); mouth(); ctx.strokeStyle = C.ink; ctx.lineWidth = lw * .8; ctx.stroke();
  }

  function hatFront() {
    const {Rb, lw} = L;
    const ring = () => { ctx.beginPath(); edge(Rb, 0, Math.PI); mouth(Math.PI, 0, true); ctx.closePath(); };
    const lines = w => { ctx.strokeStyle = C.ink; ctx.lineWidth = w; ctx.beginPath(); edge(Rb, 0, Math.PI); ctx.stroke(); ctx.beginPath(); mouth(0, Math.PI); ctx.stroke(); };
    // the near brim, with the thickness of its rolled edge showing underneath
    ctx.save(); ctx.translate(0, Rb * .032); ring(); ctx.fillStyle = C.lip; ctx.fill(); lines(lw); ctx.restore();
    ring(); ctx.fillStyle = C.felt; ctx.fill(); lines(lw);
    ctx.beginPath(); edge(Rb * .93, .04, Math.PI - .04); ctx.strokeStyle = 'rgba(255,246,230,.14)'; ctx.lineWidth = lw * .6; ctx.stroke();
    ctx.beginPath(); edge(Rb * .82, Math.PI * .6, Math.PI * .82); ctx.strokeStyle = 'rgba(255,246,230,.22)'; ctx.lineWidth = lw * 1.4; ctx.stroke();
  }

  function flyer(k, f) {
    const c = data[k] || {x: 'o'}, s = spots[rank[k]], [gx, gy] = pos(k), [x1, y1] = rest(s);
    const x0 = gx + L.sq / 2, y0 = gy + L.sq / 2;
    const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f * f - Math.sin(f * Math.PI) * L.cell * 2.6;
    if (f < .2) { // still a square, turning on its edge
      ctx.save(); ctx.translate(x, y); ctx.scale(Math.max(.06, Math.cos(f / .2 * Math.PI / 2)), 1);
      ctx.fillStyle = C[c.x] || C.o; ctx.fillRect(-L.sq / 2, -L.sq / 2, L.sq, L.sq); ctx.restore(); return;
    }
    const g = (f - .2) / .8, land = smooth(.7, 1, g), spin = Math.abs(Math.cos(Math.PI / 2 + g * Math.PI * 2.5));
    const r = L.sq * .6 + (L.r - L.sq * .6) * Math.min(1, g * 1.5);
    coin(ctx, x, y, r, spin + (1 - spin) * land, 1 + (s.squash - 1) * land, s.tilt * land, C.gold[s.shade]);
  }

  function draw(now) {
    if (!L) return;
    const t = t0 == null ? (reduced ? 99 : 0) : (now - t0) / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    while (settled < N && startAt(order[settled]) + FALL <= t) settle(settled++);
    ground(); hatBack();
    // the squares still on the wall, the ghosts of the ones that let go, and the ones in the air
    const air = [];
    for (let k = 0; k < N; k++) {
      const [x, y] = pos(k), f = (t - startAt(k)) / FALL;
      if (f <= 0) { ctx.fillStyle = C[(data[k] || {x: 'o'}).x] || C.o; ctx.fillRect(x, y, L.sq, L.sq); continue; }
      ctx.strokeStyle = 'rgba(20,19,18,.14)'; ctx.lineWidth = Math.max(.5, dpr * .5); ctx.strokeRect(x + .5, y + .5, L.sq - 1, L.sq - 1);
      if (f < 1) air.push([k, f]);
    }
    // the one that never falls: dashed, empty, its dashes creeping
    const [zx, zy] = pos(N);
    ctx.save(); ctx.setLineDash([L.sq * .22, L.sq * .16]); ctx.lineDashOffset = reduced ? 0 : -now / 90;
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1, dpr); ctx.strokeRect(zx + .5, zy + .5, L.sq - 1, L.sq - 1); ctx.restore();
    // the coins: in front of the far brim, behind the near one
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, L.rimY); mouth(); ctx.clip();
    ctx.drawImage(pile, 0, 0);
    for (const [k, f] of air) flyer(k, f);
    // a thin drizzle of ink specks: everyone who only watched
    if (!reduced && t0 != null) {
      ctx.fillStyle = 'rgba(20,19,18,.28)';
      const top = L.gy + Math.ceil((N + 1) / COLS) * L.cell;
      for (let i = 0; i < 24; i++) { const ph = ((now / 1000) * .5 + i * .173) % 1, sx = L.cx + (((i * 7919) % 97) / 97 - .5) * L.Ro * 1.5; ctx.fillRect(sx, top + (L.rimY + L.k * L.Ro * .5 - top) * ph, dpr, dpr * 1.6); }
    }
    ctx.restore();
    hatFront();
    if (!done && (reduced || t > DROP + FALL + .4)) { done = true; big?.classList.add('on'); }
  }

  function frame(now) {
    raf = 0; draw(now);
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!reduced && !raf && visible && !document.hidden) raf = requestAnimationFrame(frame); }
  function reset() { settled = 0; pctx.clearRect(0, 0, W, H); }
  function play() { if (reduced) { draw(performance.now()); return; } reset(); done = false; big?.classList.remove('on'); t0 = performance.now() + 400; wake(); }
  new IntersectionObserver(es => {
    const e = es[es.length - 1], was = visible; visible = e.isIntersecting && e.intersectionRatio >= .6;
    if (visible && !was) play(); // replays each time it comes back into view
    if (!e.isIntersecting && !reduced) { t0 = null; reset(); done = false; big?.classList.remove('on'); draw(performance.now()); }
  }, {threshold: [0, .6, .9]}).observe(canvas);
  document.addEventListener('visibilitychange', wake);
  canvas.addEventListener('click', play);
  canvas.addEventListener('mousedown', e => e.preventDefault());
  canvas.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); play(); } });
  new ResizeObserver(() => { if (layout()) draw(performance.now()); }).observe(canvas);
  if (reduced) { big?.classList.add('on'); done = true; }
}
