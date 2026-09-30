// The headless machine: an interactive illustration. The monster sits in the middle of the page and
// sprays Jean Phil copies; every copy sends coins back; viral moments fly in, hit the monster, spike
// an imagined coin's line and set off a burst of new copies. Pop a copy and another takes its place.
// There's no start, no score and no end: it just keeps going, calmly, while it's on screen.
import {makeMonster, blinkAt} from './monster.js';

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Viral moments (all made up). Each has a tag for the chart and art for its card.
const VIRAL = [
  {title: 'Pug Jean Phil becomes a meme', tag: 'pug', doodle: 'pug', mult: 3.2},
  {title: 'Jean Phil gives the State of the Union', tag: 'speech', doodle: 'podium', mult: 2.6},
  {title: 'Jean Phil meets a donkey', tag: 'donkey', doodle: 'donkey', mult: 2.2},
  {title: 'Grandma duets Jean Phil', tag: 'duet', doodle: 'grandma', mult: 2.8},
];

const root = document.querySelector('.hm');
if (root) init(root);

function init(root) {
  const canvas = root.querySelector('canvas'), cap = root.querySelector('.tk-cap');
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const monster = makeMonster(ctx, reduced);
  const C = {paper: '#f2efe8', ink: '#141312', red: '#fd0001', hair: '#e8cd8c', gold: '#e8cd8c', gold2: '#b8975a', bone: '#fbf8f1', mute: '#8a8377', line: 'rgba(20,19,18,.14)'};
  const FACE = new Path2D('M31,38 L69,38 L69,76 C69,88 60,94 50,94 C40,94 31,88 31,76 Z');
  const HAIR = new Path2D('M50,6 C65,6 75,15 79,30 C83,45 89,62 95,77 C87,81 76,80 69,74 C70,62 70,50 69,39 C61,35 39,35 31,39 C30,50 30,62 31,74 C24,80 13,81 5,77 C11,62 17,45 21,30 C25,15 35,6 50,6 Z');
  const STACHE = new Path2D('M38.6,64.6 C36.2,62.6 33.4,64.4 34.6,67.2 C35.8,70 40,71.2 43.6,70.2 C46.4,69.4 48.4,68.2 50,67.4 C51.6,68.2 53.6,69.4 56.4,70.2 C60,71.2 64.2,70 65.4,67.2 C66.6,64.4 63.8,62.6 61.4,64.6');
  const NOSE = new Path2D('M51,51 L48.5,62 L52,62.5');
  const display = getComputedStyle(document.documentElement).getPropertyValue('--display').trim() || 'Georgia, serif';

  let W = 0, H = 0, dpr = 1, L = null, sprite = null, spriteSize = 0;
  const art = {};
  for (const v of VIRAL) { const im = new Image(); im.decoding = 'async'; im.onerror = () => { delete art[v.doodle]; }; im.src = new URL(`../img/viral-${v.doodle}.webp`, import.meta.url).href; art[v.doodle] = im; }
  let raf = 0, visible = false, last = 0, t = 0; // t: scene seconds (only runs while visible)
  let copies = [], flights = [], fx = [], cards = [], history = [], marks = [];
  let seeded = false;
  let hAcc = 0, price = 1, spike = null, nextSpawn = .6, nextViral = 6.4, viralIndex = 0, yaw = .2, shake = -9, chomp = -9, gaze = 0, poked = 0;
  const said = new Set(); const capQ = []; let capUntil = 0, capTimer = 0;
  // It only plays by itself when the page's Autoplay switch is on and motion isn't reduced; taps always work.
  const autoOn = () => !reduced && document.documentElement.dataset.autoplay !== 'off';
  const SEED = 20260928;
  let seed = SEED, rnd = mulberry32(SEED);
  // Hooks (window.__headless, below). selfRun: the page's own loop moves the scene by the wall clock (a reader's page).
  // Off (auto(false), or any stepTo()): the scene moves only through stepTo(), in fixed 1/60 s steps on a frame grid
  // (frame n = scene time n/60), and every viral()/popOldest() is logged at its frame so going back replays it exactly.
  // Captions then follow scene time too (capText/capPrev/capAt; the reader's 140 ms swap included).
  let selfRun = true, hookVirals = false, n = 0, log = [];
  let capText = '\u00a0', capPrev = '\u00a0', capAt = -9;

  // ---- captions: calm, one at a time
  function sayNow(text) { capQ.length = 0; capUntil = 0; say(text); }
  function say(text, once) { if (once && said.has(once)) return; if (once) said.add(once); if (capQ.length > 1) capQ.shift(); capQ.push(text); }
  function pumpCap(now) {
    if (!capQ.length || now < capUntil) return;
    const text = capQ.shift();
    cap.classList.add('swap');
    capTimer = setTimeout(() => { cap.textContent = text; cap.classList.remove('swap'); }, reduced ? 0 : 140);
    capUntil = now + 2800;
  }
  // Hook mode: the queue moves on scene time, and the caption shown is a function of it.
  function pumpScene() {
    if (!capQ.length || t < capUntil) return;
    capPrev = capText; capText = capQ.shift(); capAt = t; capUntil = t + 2.8;
  }
  function showCap() {
    const swapping = !reduced && t - capAt < .14, text = swapping ? capPrev : capText;
    if (cap.textContent !== text) cap.textContent = text;
    cap.classList.toggle('swap', swapping);
  }

  // ---- layout: a chart band on top, the monster in the middle, copies scattered around it
  function layout() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.round(r.width * dpr); H = Math.round(r.height * dpr);
    if (!W || !H) return false;
    canvas.width = W; canvas.height = H;
    const port = W / H < 1.05, band = H * (port ? .16 : .18);
    const S = Math.min((H - band) * (port ? .15 : .17), W * (port ? .17 : .1));
    const mx = W / 2, my = band + (H - band) * .5;
    const size = Math.round(Math.min(W, H) * (port ? .13 : .105));
    // scatter the slots, keeping clear of the monster and the chart
    const rr = mulberry32(11), slots = [], gap = size * 1.08;
    for (let k = 0; k < 2400 && slots.length < 60; k++) {
      const x = size * .6 + rr() * (W - size * 1.2), y = band + size * .65 + rr() * (H - band - size * 1.3);
      const dx = (x - mx) / (S * 1.75), dy = (y - my) / (S * (y < my ? 2.15 : 1.95));
      if (dx * dx + dy * dy < 1) continue;
      if (slots.some(s => Math.hypot(s.x - x, s.y - y) < gap)) continue;
      slots.push({x, y, rot: (rr() - .5) * .34});
    }
    // fill from the monster outwards, so copies crowd in around it first
    slots.sort((a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my));
    L = {port, band, S, mx, my, size, slots, u: Math.min(W, H) / 100};
    // not playing by itself (Autoplay off or reduced motion): start from a still with copies already out
    if (!seeded && !autoOn()) { seeded = true; for (let i = 0; i < Math.min(14, slots.length); i++) copies.push({slot: i, born: -9, next: 1e9}); }
    sprite = null;
    const ok = o => o.slot === undefined || o.slot < slots.length;
    copies = copies.filter(ok); flights = flights.filter(ok); fx = fx.filter(ok);
    return true;
  }
  function stickerSprite(sz) {
    if (sprite && spriteSize === sz) return sprite;
    const pad = Math.ceil(sz * .12), c = document.createElement('canvas'); c.width = c.height = sz + pad * 2;
    const g = c.getContext('2d'); g.translate(pad, pad); g.scale(sz / 100, sz / 100);
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = C.bone; g.lineWidth = 13; g.stroke(HAIR); g.stroke(FACE);
    g.fillStyle = C.bone; g.fill(HAIR); g.fill(FACE);
    g.fillStyle = C.red; g.fill(FACE); g.fillStyle = C.hair; g.fill(HAIR);
    g.strokeStyle = C.ink; g.lineWidth = 2.2; g.stroke(HAIR); g.stroke(FACE);
    g.strokeStyle = C.hair; g.lineWidth = 4; g.stroke(STACHE);
    g.strokeStyle = C.ink; g.lineWidth = 2.6; g.stroke(NOSE);
    sprite = c; spriteSize = sz; return c;
  }
  const ease = k => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
  const back = k => { k = Math.min(1, Math.max(0, k)); const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
  const mouth = () => [L.mx + L.S * .9 * Math.sin(yaw), L.my + L.S * .45];

  // ---- the machine's behaviour
  function freeSlot() {
    const used = new Set(copies.map(c => c.slot).concat(flights.filter(f => f.kind === 'copy').map(f => f.slot)));
    for (let i = 0; i < L.slots.length; i++) if (!used.has(i)) return i;
    // full: the oldest copy scrolls away to make room
    const old = copies.reduce((a, c) => (!c.doomed && (!a || c.born < a.born) ? c : a), null);
    if (old) { old.doomed = true; return old.slot; }
    return -1;
  }
  function spawn(delay = 0) {
    const slot = freeSlot(); if (slot < 0) return;
    flights.push({kind: 'copy', slot, t0: t + delay, dur: reduced ? .01 : .65});
  }
  function earn(c) { // a copy sends a coin back to the machine
    if (flights.filter(f => f.kind === 'coin').length >= 8) return;
    flights.push({kind: 'coin', slot: c.slot, t0: t, dur: reduced ? .01 : .9});
  }
  function viral(fast) {
    const v = VIRAL[viralIndex++ % VIRAL.length], fromLeft = viralIndex % 2 === 1;
    const y = L.band + (H - L.band) * (.28 + rnd() * .44);
    cards.push({v, x0: fromLeft ? -W * .2 : W * 1.2, y0: y, t0: t, dur: fast ? .9 : (reduced ? 3.2 : 4.8), rot: (fromLeft ? -1 : 1) * .12, left: fromLeft});
    sayNow(`Viral: ${v.title}.`);
  }
  function hit(card) {
    const v = card.v;
    shake = t; chomp = t; gaze = 1;
    spike = {from: price, to: Math.max(price, v.mult), t0: t, dur: .7};
    marks.push({tag: v.tag, at: history.length, t});
    const n = L.port ? 9 : 14;
    for (let k = 0; k < n; k++) spawn(.15 + k * .11);
    fx.push({kind: 'ring', x: L.mx, y: L.my, r: L.S * 1.6, t0: t, dur: .6});
    say('An imagined coin jumps. More copies.');
  }

  function step(dt, tNext) {
    t = tNext ?? t + dt;
    // Driven by stepTo(), the calm baseline always runs and virals come only from viral() (unless reset asked for them).
    const baseOn = selfRun ? autoOn() : true, viralOn = selfRun ? autoOn() : hookVirals;
    // a calm baseline: a new copy every couple of seconds
    if (t >= nextSpawn && baseOn) { spawn(); nextSpawn = t + (reduced ? 3.2 : 2.2) * (.8 + rnd() * .4); say('It makes copies.', 'makes'); }
    if (t >= nextViral && viralOn) { viral(false); nextViral = t + 11 + rnd() * 2; }
    // copies earn
    for (const c of copies) if (t >= c.next) { c.next = t + 6 + rnd() * 4; earn(c); if (!said.has('earn') && t > 2.5) say('Every copy earns a little.', 'earn'); }
    // flights land
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i]; if (t < f.t0 + f.dur) continue;
      flights.splice(i, 1);
      if (f.kind === 'copy') {
        const j = copies.findIndex(c => c.slot === f.slot);
        if (j >= 0) { copies.splice(j, 1); fx.push({kind: 'fade', slot: f.slot, t0: t, dur: .3}); }
        copies.push({slot: f.slot, born: t, next: t + 1 + rnd() * 2});
      }
    }
    for (let i = cards.length - 1; i >= 0; i--) { const c = cards[i]; if (t >= c.t0 + c.dur) { cards.splice(i, 1); hit(c); } }
    // the price: spikes on viral moments, then drifts back down
    if (spike) { const k = (t - spike.t0) / spike.dur; price = spike.from + (spike.to - spike.from) * ease(k); if (k >= 1) spike = null; }
    else price = 1 + (price - 1) * Math.exp(-dt / 2.5) + (rnd() - .5) * .02;
    price = Math.min(3.5, Math.max(.6, price));
    // the chart keeps a sample every 0.1 s: about 26 seconds on screen
    for (hAcc += dt; hAcc >= .1; hAcc -= .1) { history.push(price); if (history.length > 260) { history.shift(); marks.forEach(m => m.at--); marks = marks.filter(m => m.at >= -8); } }
    gaze = Math.max(0, gaze - dt * .6);
    yaw = reduced ? .2 : .2 + .5 * Math.sin(t * .25);
    if (!selfRun) pumpScene();
  }

  // ---- drawing
  function draw(now) {
    if (!L) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    drawChart();
    // copies under the monster
    const sz = L.size, spr = stickerSprite(sz), off = spr.width / 2;
    for (const c of copies) {
      const s = L.slots[c.slot], k = reduced ? 1 : back((t - c.born) / .28);
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot); ctx.scale(k, k); ctx.drawImage(spr, -off, -off); ctx.restore();
    }
    // the monster
    const sh = !reduced && t - shake < .5 ? Math.sin((t - shake) * 60) * L.S * .05 * (1 - (t - shake) / .5) : 0;
    let open = (reduced ? .95 : .9 + .07 * Math.sin(t * .8)) + (t - chomp < .7 ? .35 * Math.sin((t - chomp) / .7 * Math.PI) : 0);
    if (cards.some(c => (t - c.t0) / c.dur > CARD_OUT)) open += .3;
    monster({cx: L.mx + sh, cy: L.my + (reduced ? 0 : Math.sin(t * 1.3) * L.S * .04), S: L.S, LW: Math.max(1.3 * dpr, L.S * .02), yaw, t, open, gaze,
      blink: selfRun ? undefined : blinkAt(t), shadow: {y: L.my + L.S * 1.95, bob: 0}});
    // things in the air
    for (const f of flights) {
      const k = (t - f.t0) / f.dur; if (k < 0) continue;
      const s = L.slots[f.slot], [mx, my] = mouth(), e = ease(k);
      if (f.kind === 'copy') {
        const x = mx + (s.x - mx) * e, y = my + (s.y - my) * e - Math.sin(k * Math.PI) * L.S * .9, sc = .35 + .65 * e;
        ctx.save(); ctx.translate(x, y); ctx.rotate(s.rot * e + (1 - e) * 2); ctx.scale(sc, sc); ctx.drawImage(spr, -off, -off); ctx.restore();
      } else {
        const e2 = k * k, x = s.x + (mx - s.x) * e2, y = s.y + (my - s.y) * e2 - Math.sin(k * Math.PI) * L.S * .5;
        coin(x, y, L.size * .17 * (1 - .5 * Math.max(0, (k - .7) / .3)));
      }
    }
    for (const c of cards) drawCard(c);
    drawFx();
  }
  function coin(x, y, r) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = C.gold; ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1, r * .12); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r * .76, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill(); ctx.clip();
    ctx.translate(x, y); ctx.scale(r * .76 * .74 / 38, r * .76 * .74 / 38); ctx.translate(-50, -46);
    ctx.fillStyle = C.red; ctx.fill(FACE); ctx.fillStyle = C.hair; ctx.fill(HAIR);
    ctx.strokeStyle = C.hair; ctx.lineWidth = 4.2; ctx.lineCap = 'round'; ctx.stroke(STACHE);
    ctx.restore();
  }
  function drawChart() {
    const b = L.band, pad = L.u * 2, x0 = W * (L.port ? .27 : .16), x1 = W - pad, y0 = pad * .8, y1 = b - pad * .6;
    ctx.strokeStyle = C.line; ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath(); ctx.moveTo(pad, b); ctx.lineTo(W - pad, b); ctx.stroke();
    const fs = Math.max(11 * dpr, L.u * 3.4);
    ctx.fillStyle = C.ink; ctx.font = `italic ${fs}px ${display}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('a coin', pad, (y0 + y1) / 2 - fs * .45);
    ctx.fillStyle = price > 1.6 ? C.red : C.mute; ctx.font = `${fs * 1.15}px ${display}`;
    ctx.fillText(`×${price.toFixed(1)}`, pad, (y0 + y1) / 2 + fs * .75);
    ctx.fillStyle = C.mute; ctx.font = `italic ${fs * .78}px ${display}`;
    ctx.fillText('imagined', pad, (y0 + y1) / 2 + fs * 1.85);
    if (history.length < 2) return;
    const max = Math.max(2, ...history) * 1.08, n = 260;
    const X = i => x1 - (history.length - 1 - i) * (x1 - x0) / (n - 1), Y = v => y1 - (v / max) * (y1 - y0);
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1.4 * dpr, L.u * .45); ctx.lineJoin = 'round';
    ctx.beginPath(); history.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))); ctx.stroke();
    // mark each viral moment where it hit
    ctx.font = `italic ${fs * .9}px ${display}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const m of marks) {
      const i = Math.min(history.length - 1, Math.max(0, m.at + 7)), x = X(i), y = Y(history[i]);
      if (x < x0) continue;
      // the tag sits beside the peak, and never above the top of the chart
      const tx = x - L.u * 1.6, ty = Math.max(y0 + fs * .4, y + L.u * .2);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = 3.5 * dpr; ctx.strokeStyle = C.paper; ctx.strokeText(m.tag, tx, ty);
      ctx.fillStyle = C.red; ctx.fillText(m.tag, tx, ty);
      ctx.beginPath(); ctx.arc(x, y, L.u * .8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(X(history.length - 1), Y(price), L.u * .9, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
  }
  // A card flies in, parks where it can be read for about three seconds, then dives into the mouth.
  const CARD_IN = .17, CARD_OUT = .81;
  function cardBox(c) {
    const k = (t - c.t0) / c.dur, [mx, my] = mouth();
    const w = Math.min(W * (L.port ? .56 : .26), 300 * dpr), h = w * .78, pad = L.u * 2;
    // parked: above the monster on a phone, beside it on a wide screen
    const hx = L.port ? W / 2 : Math.min(W - w / 2 - pad, Math.max(w / 2 + pad, L.mx + (c.left ? -1 : 1) * (L.S * 1.55 + w / 2)));
    const hy = L.port ? L.band + h / 2 + pad : Math.min(H - h / 2 - pad, Math.max(L.band + h / 2 + pad, c.y0));
    let x, y, sc = 1, e;
    if (k < CARD_IN) { e = ease(k / CARD_IN); x = c.x0 + (hx - c.x0) * e; y = c.y0 + (hy - c.y0) * e; }
    else if (k < CARD_OUT) { e = 1; x = hx; y = hy + (reduced ? 0 : Math.sin((k - CARD_IN) * 9) * L.u * .4); }
    else { const u = (k - CARD_OUT) / (1 - CARD_OUT); e = 1; const q = u * u * u; x = hx + (mx - hx) * q; y = hy + (my - hy) * q; sc = 1 - .88 * u; }
    return {k, e, x, y, w, h, sc};
  }
  function drawCard(c) {
    const {k, x, y, w, h, sc} = cardBox(c);
    const tilt = k < CARD_IN ? c.rot : c.rot * .35;
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt); ctx.scale(sc, sc);
    ctx.fillStyle = 'rgba(20,19,18,.12)'; ctx.fillRect(-w / 2 + 4 * dpr, -h / 2 + 5 * dpr, w, h);
    ctx.fillStyle = C.bone; ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1.5 * dpr, w * .01);
    ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h);
    // picture area: the art for this moment if it has loaded, otherwise a plain Jean Phil sticker
    const ix = -w / 2 + w * .05, iy = -h / 2 + w * .05, iw = w * .9, ih = h * .56;
    ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
    ctx.fillStyle = c.v.tint || '#efe6d2'; ctx.fillRect(ix, iy, iw, ih);
    const img = art[c.v.doodle];
    if (img && img.complete && img.naturalWidth) {
      const r = Math.max(iw / img.naturalWidth, ih / img.naturalHeight), dw = img.naturalWidth * r, dh = img.naturalHeight * r;
      ctx.drawImage(img, ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh);
    } else {
      const spr = stickerSprite(L.size), s2 = ih * .9 / spr.width;
      ctx.translate(0, iy + ih / 2); ctx.scale(s2, s2); ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
    }
    ctx.restore();
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1, w * .006); ctx.strokeRect(ix, iy, iw, ih);
    // a play mark on the picture, and the title underneath
    ctx.fillStyle = C.red; ctx.beginPath(); ctx.moveTo(ix + iw * .05, iy + ih * .1); ctx.lineTo(ix + iw * .05, iy + ih * .28); ctx.lineTo(ix + iw * .13, iy + ih * .19); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fs = Math.max(12 * dpr, h * .1); ctx.font = `italic ${fs}px ${display}`;
    const lines = wrap(c.v.title, w * .9), ty = iy + ih + (h / 2 - (iy + ih)) / 2;
    lines.forEach((ln, i) => ctx.fillText(ln, 0, ty + (i - (lines.length - 1) / 2) * fs * 1.12));
    ctx.restore();
  }
  function wrap(text, maxW) {
    const words = text.split(' '), out = []; let ln = '';
    for (const w of words) { const tst = ln ? ln + ' ' + w : w; if (ctx.measureText(tst).width > maxW && ln) { out.push(ln); ln = w; } else ln = tst; }
    if (ln) out.push(ln); return out;
  }
  function drawFx() {
    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i], k = (t - p.t0) / p.dur;
      if (k >= 1) { fx.splice(i, 1); continue; }
      if (k < 0) continue;
      if (p.kind === 'ring') { ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (.5 + k), 0, Math.PI * 2); ctx.strokeStyle = `rgba(253,0,1,${.5 * (1 - k)})`; ctx.lineWidth = 3 * dpr; ctx.stroke(); }
      else if (p.kind === 'pop') {
        const s = L.slots[p.slot], spr = stickerSprite(L.size), off = spr.width / 2;
        ctx.save(); ctx.globalAlpha = 1 - k; ctx.translate(s.x, s.y - L.size * .3 * k); ctx.rotate(s.rot + k * 1.5); ctx.scale(1 - .5 * k, 1 - .5 * k); ctx.drawImage(spr, -off, -off); ctx.restore();
        ctx.globalAlpha = k < .5 ? 1 : 2 * (1 - k); ctx.strokeStyle = C.red; ctx.lineWidth = Math.max(2 * dpr, L.size * .07); ctx.lineCap = 'round';
        const q = L.size * .26; ctx.beginPath(); ctx.moveTo(s.x - q, s.y - q); ctx.lineTo(s.x + q, s.y + q); ctx.moveTo(s.x + q, s.y - q); ctx.lineTo(s.x - q, s.y + q); ctx.stroke(); ctx.globalAlpha = 1;
      } else if (p.kind === 'fade') {
        const s = L.slots[p.slot], spr = stickerSprite(L.size), off = spr.width / 2;
        ctx.save(); ctx.globalAlpha = 1 - k; ctx.translate(s.x, s.y); ctx.rotate(s.rot); ctx.drawImage(spr, -off, -off); ctx.restore();
      }
    }
  }

  // ---- input: pop a copy (another takes its place), poke the monster, hurry a card along
  let down = null;
  canvas.addEventListener('pointerdown', e => { down = {x: e.clientX, y: e.clientY}; });
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('mousedown', e => e.preventDefault());
  canvas.addEventListener('pointerup', e => {
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved > 12 || !L) return;
    interacted(e);
    const r = canvas.getBoundingClientRect(); tap((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
  });
  canvas.addEventListener('keydown', e => {
    if (e.key !== ' ' && e.key !== 'Enter') return; e.preventDefault(); interacted(e);
    if (e.key === ' ') { if (!cards.length) viral(true); return; }
    const c = copies.reduce((a, c) => (!a || c.born < a.born ? c : a), null); if (c) pop(c);
  });
  // A reader's own tap or key hands a hook-driven scene back to the page's loop (the player pauses on that same input).
  function interacted(e) { if (e && e.isTrusted && !selfRun) api.auto(true); cap.setAttribute('aria-live', 'polite'); wake(); }
  function pop(c) {
    copies.splice(copies.indexOf(c), 1); fx.push({kind: 'pop', slot: c.slot, t0: t, dur: .45});
    spawn(1.1); if (rnd() < .5) spawn(1.5);
    say('Pop one. It makes another.', 'pop');
  }
  function tap(px, py) {
    for (const c of cards) {
      const b = cardBox(c); if (b.k > CARD_OUT) continue;
      const pad = 12 * dpr;
      if (Math.abs(px - b.x) < b.w * b.sc / 2 + pad && Math.abs(py - b.y) < b.h * b.sc / 2 + pad) { c.dur = .9; c.t0 = t - CARD_OUT * c.dur; return; } // straight into the dive
    }
    if (Math.hypot(px - L.mx, py - L.my) < L.S * 1.3) { shake = t; chomp = t; gaze = 1; poked++; say(poked > 2 ? 'Knock knock. Still nobody.' : 'Knock knock. Nobody answers.', poked > 2 ? 'poke2' : 'poke'); return; }
    let best = null, bd = 1e9;
    for (const c of copies) { const s = L.slots[c.slot], d = Math.hypot(px - s.x, py - s.y); if (d < bd) { bd = d; best = c; } }
    if (best && bd < L.size * .7) pop(best);
  }

  // ---- lifecycle: runs only while on screen
  function frame(now) {
    raf = 0;
    if (!selfRun) return; // the scene clock belongs to stepTo()
    const dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now;
    if (L) step(dt);
    pumpCap(now);
    draw(now);
    // still: once nothing is moving and it isn't playing by itself, stop drawing until someone taps
    if (!autoOn() && !cards.length && !flights.length && !fx.length && !spike) return;
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function wake() { if (selfRun && !raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
  new IntersectionObserver(es => { visible = es[es.length - 1].isIntersecting; if (visible) wake(); }, {threshold: [0, .2]}).observe(canvas);
  document.addEventListener('visibilitychange', wake);
  new ResizeObserver(() => { if (layout()) { draw(performance.now()); wake(); } }).observe(canvas);
  (document.fonts?.ready || Promise.resolve()).then(() => draw(performance.now()));

  // ---- hooks for Play mode and the frame renderer (docs: scratchpad/autoplay/hooks-api.md) ----
  function resetScene(sd) {
    seed = sd; rnd = mulberry32(sd);
    t = 0; n = 0; hAcc = 0; price = 1; spike = null; nextSpawn = .6; nextViral = 6.4; viralIndex = 0;
    yaw = .2; shake = -9; chomp = -9; gaze = 0; poked = 0; last = 0;
    copies = []; flights = []; fx = []; cards = []; history = []; marks = [];
    said.clear(); capQ.length = 0; capUntil = 0; clearTimeout(capTimer);
    capText = capPrev = '\u00a0'; capAt = -9; cap.textContent = '\u00a0'; cap.classList.remove('swap');
    seeded = true; // no still start with copies out: a reset scene starts empty
  }
  const oldest = () => copies.reduce((a, c) => (!a || c.born < a.born ? c : a), null);
  function popOldestNow() {
    const c = oldest(); if (!c || !L) return null;
    const s = L.slots[c.slot];
    pop(c);
    return {x: s.x / dpr, y: s.y / dpr, space: 'canvas', slot: c.slot};
  }
  function advance(N) { while (n < N) { n++; step(n / 60 - t, n / 60); } }
  function apply(op) { return op === 'viral' ? (viral(true), null) : popOldestNow(); }
  function replay(N) { // back in time: the same scene from its reset, with the same events at the same frames
    const keep = log.filter(e => e.n <= N);
    resetScene(seed); log = [];
    for (const e of keep) { advance(e.n); log.push(e); apply(e.op); }
    advance(N);
  }
  // Hook calls paint once, at the end of the task that made them (a microtask): Chrome rasterises a canvas redrawn
  // twice in one frame a hair differently from one drawn once, so a cold start (reset, events, stepTo in one go) and a
  // frame-by-frame run must both paint exactly once to give the same pixels. The caption is set at once.
  let paintQueued = false;
  function show() {
    if (!selfRun) showCap();
    if (paintQueued) return;
    paintQueued = true;
    queueMicrotask(() => { paintQueued = false; draw(0); });
  }
  const api = {
    get t() { return t; },
    get copies() { return copies.length; },
    // reset(seed = 20260928, {virals}): a fresh scene: the mulberry32 stream re-created from seed, zero copies, scene
    //   time 0, captions cleared, the event log emptied. virals: true lets a stepped scene bring its own viral cards.
    reset(sd = SEED, opts = {}) {
      resetScene(Number.isFinite(+sd) ? +sd : SEED); log = []; hookVirals = !!(opts && opts.virals);
      if (L) show();
      return api;
    },
    // auto(false): the page's loop stops moving the scene (it is stepped from outside). auto(true): the loop takes
    //   over again from where the scene is, as a reader's page (the next viral card no sooner than 3 s on).
    auto(on = true) {
      on = !!on;
      if (on === selfRun) return api;
      selfRun = on;
      clearTimeout(capTimer); capUntil = 0;
      if (on) { cap.classList.remove('swap'); if (nextViral < t + 3) nextViral = t + 3; last = 0; wake(); }
      else { if (raf) { cancelAnimationFrame(raf); raf = 0; } capText = capPrev = cap.textContent; capAt = -9; n = Math.floor(t * 60 + 1e-6); }
      return api;
    },
    // stepTo(sceneT): the scene at frame floor(sceneT * 60), in fixed 1/60 s steps from where it is, or, going back,
    //   rebuilt from its reset with the events logged up to that frame replayed (later ones are dropped: re-apply them
    //   as you pass them again). State and caption change at once; the canvas paints at the end of the task. Takes the
    //   clock (auto(false)).
    stepTo(sceneT) {
      if (selfRun) api.auto(false);
      if (!L && !layout()) return api;
      const N = Math.max(0, Math.floor((Number(sceneT) || 0) * 60 + 1e-6));
      if (N < n) replay(N); else advance(N);
      show();
      return api;
    },
    // viral(): a fast viral card (0.9 s) flies into the mouth: the coin line spikes and a burst of copies follows.
    viral() {
      if (!L) return api;
      if (!selfRun) log.push({n, op: 'viral'});
      viral(true);
      if (!selfRun) show();
      return api;
    },
    // popOldest(): pops the oldest copy (Enter's pop: another 1-2 come back after 1.1-1.5 s) and returns where it
    //   was, {x, y} in CSS px from the canvas's top-left (space: 'canvas'), or null when there is none.
    popOldest() {
      if (!L) return null;
      if (!selfRun) log.push({n, op: 'pop'});
      const r = popOldestNow();
      if (!selfRun) show();
      return r;
    },
    // ready(): resolves once the viral cards' art and the fonts are in (a render should wait for it once).
    ready() {
      const imgs = Object.values(art).map(im => (im.complete ? Promise.resolve() : new Promise(r => { im.addEventListener('load', r, {once: true}); im.addEventListener('error', r, {once: true}); })));
      return Promise.all([document.fonts?.ready, ...imgs]).then(() => { if (L) show(); return true; });
    },
    get state() {
      return {t, frame: n, auto: selfRun, seed, copies: copies.map(c => c.slot), flights: flights.length, cards: cards.length,
        price: Math.round(price * 1e4) / 1e4, caption: cap.textContent, swap: cap.classList.contains('swap'), events: log.slice()};
    },
  };
  window.__headless = api;
  canvas.__headless = api;
}
