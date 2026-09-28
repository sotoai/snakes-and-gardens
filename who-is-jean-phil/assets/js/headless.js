// The headless machine: an interactive illustration. The monster sits in the middle of the page and
// sprays Jean Phil copies; every copy sends coins back; viral moments fly in, hit the monster, spike
// the JEANPHIL line and set off a burst of new copies. Pop a copy and another takes its place.
// There's no start, no score and no end: it just keeps going, calmly, while it's on screen.
import {makeMonster} from './monster.js';

const root = document.querySelector('.hm');
if (root) init(root);

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Viral moments (all made up). Each has a tag for the chart and a doodle for its card.
const VIRAL = [
  {title: 'Pug Jean Phil becomes a meme', tag: 'pug', doodle: 'pug', mult: 3.2},
  {title: 'Jean Phil gives the State of the Union', tag: 'speech', doodle: 'podium', mult: 2.6},
  {title: 'Jean Phil meets a donkey', tag: 'donkey', doodle: 'donkey', mult: 2.2},
  {title: 'Grandma duets Jean Phil', tag: 'duet', doodle: 'grandma', mult: 2.8},
];

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
  let raf = 0, visible = false, last = 0, t = 0; // t: scene seconds (only runs while visible)
  let copies = [], flights = [], fx = [], cards = [], history = [], marks = [];
  let hAcc = 0, price = 1, spike = null, nextSpawn = .6, nextViral = 3.8, viralIndex = 0, yaw = .3, shake = 0, chomp = 0, gaze = 0, poked = 0;
  const said = new Set(); const capQ = []; let capUntil = 0;
  const rnd = mulberry32(20260928);

  // ---- captions: calm, one at a time
  function say(text, once) { if (once && said.has(once)) return; if (once) said.add(once); if (capQ.length > 1) capQ.shift(); capQ.push(text); }
  function pumpCap(now) {
    if (!capQ.length || now < capUntil) return;
    const text = capQ.shift();
    cap.classList.add('swap');
    setTimeout(() => { cap.textContent = text; cap.classList.remove('swap'); }, reduced ? 0 : 140);
    capUntil = now + 2800;
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
    sprite = null; copies = copies.filter(c => c.slot < slots.length);
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
  const mouth = () => [L.mx, L.my + L.S * .25];

  // ---- the machine's behaviour
  function freeSlot() {
    const used = new Set(copies.map(c => c.slot).concat(flights.filter(f => f.kind === 'copy').map(f => f.slot)));
    for (let i = 0; i < L.slots.length; i++) if (!used.has(i)) return i;
    // full: the oldest copy scrolls away to make room
    const old = copies.reduce((a, c) => (!a || c.born < a.born ? c : a), null);
    if (old) { copies.splice(copies.indexOf(old), 1); fx.push({kind: 'fade', slot: old.slot, t0: t, dur: .5}); return old.slot; }
    return -1;
  }
  function spawn(delay = 0) {
    const slot = freeSlot(); if (slot < 0) return;
    flights.push({kind: 'copy', slot, t0: t + delay, dur: reduced ? .01 : .65});
  }
  function earn(c) { // a copy sends a coin back to the machine
    if (flights.filter(f => f.kind === 'coin').length > 14) return;
    flights.push({kind: 'coin', slot: c.slot, t0: t, dur: reduced ? .01 : .9});
  }
  function viral(fast) {
    const v = VIRAL[viralIndex++ % VIRAL.length], fromLeft = viralIndex % 2 === 1;
    const y = L.band + (H - L.band) * (.28 + rnd() * .44);
    cards.push({v, x0: fromLeft ? -W * .2 : W * 1.2, y0: y, t0: t, dur: fast ? .4 : (reduced ? .01 : 1.6), rot: (fromLeft ? -1 : 1) * .12});
    say(`Viral: ${v.title}.`);
  }
  function hit(card) {
    const v = card.v;
    shake = t; chomp = t; gaze = 1;
    spike = {from: price, to: price * v.mult, t0: t, dur: .7};
    marks.push({tag: v.tag, at: history.length, t});
    const n = L.port ? 9 : 14;
    for (let k = 0; k < n; k++) spawn(.15 + k * .11);
    fx.push({kind: 'ring', x: L.mx, y: L.my, r: L.S * 1.6, t0: t, dur: .6});
    setTimeout(() => say(`JEANPHIL ×${(price).toFixed(1)}. More copies.`), 900);
  }

  function step(dt) {
    t += dt;
    // a calm baseline: a new copy every couple of seconds
    if (t >= nextSpawn) { spawn(); nextSpawn = t + (reduced ? 3.2 : 2.2) * (.8 + rnd() * .4); say('It makes copies.', 'makes'); }
    if (t >= nextViral) { viral(false); nextViral = t + 9 + rnd() * 2; }
    // copies earn
    for (const c of copies) if (t >= c.next) { c.next = t + 3.2 + rnd() * 2.2; earn(c); if (!said.has('earn') && t > 2.5) say('Every copy earns a little.', 'earn'); }
    // flights land
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i]; if (t < f.t0 + f.dur) continue;
      flights.splice(i, 1);
      if (f.kind === 'copy') { copies.push({slot: f.slot, born: t, next: t + 1 + rnd() * 2}); }
      if (f.kind === 'coin') price *= 1.004;
    }
    for (let i = cards.length - 1; i >= 0; i--) { const c = cards[i]; if (t >= c.t0 + c.dur) { cards.splice(i, 1); hit(c); } }
    // the price: spikes on viral moments, then drifts back down
    if (spike) { const k = (t - spike.t0) / spike.dur; price = spike.from + (spike.to - spike.from) * ease(k); if (k >= 1) spike = null; }
    else price = 1 + (price - 1) * Math.exp(-dt / 7) + (rnd() - .5) * .02;
    price = Math.max(.6, price);
    // the chart keeps a sample every 0.1 s: about 26 seconds on screen
    for (hAcc += dt; hAcc >= .1; hAcc -= .1) { history.push(price); if (history.length > 260) { history.shift(); marks.forEach(m => m.at--); marks = marks.filter(m => m.at >= -8); } }
    gaze = Math.max(0, gaze - dt * .6);
    yaw += dt * (reduced ? 0 : .35 + (t - chomp < .8 ? 2.2 : 0));
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
    const sh = t - shake < .5 ? Math.sin((t - shake) * 60) * L.S * .05 * (1 - (t - shake) / .5) : 0;
    const open = .9 + .07 * Math.sin(t * .8) + (t - chomp < .7 ? .35 * Math.sin((t - chomp) / .7 * Math.PI) : 0);
    monster({cx: L.mx + sh, cy: L.my + (reduced ? 0 : Math.sin(t * 1.3) * L.S * .04), S: L.S, LW: Math.max(1.3 * dpr, L.S * .02), yaw, t, open, gaze,
      shadow: {y: L.my + L.S * 1.95, bob: 0}});
    // things in the air
    for (const f of flights) {
      const k = (t - f.t0) / f.dur; if (k < 0) continue;
      const s = L.slots[f.slot], [mx, my] = mouth(), e = ease(k);
      if (f.kind === 'copy') {
        const x = mx + (s.x - mx) * e, y = my + (s.y - my) * e - Math.sin(k * Math.PI) * L.S * .9, sc = .35 + .65 * e;
        ctx.save(); ctx.translate(x, y); ctx.rotate(s.rot * e + (1 - e) * 2); ctx.scale(sc, sc); ctx.drawImage(spr, -off, -off); ctx.restore();
      } else {
        const x = s.x + (mx - s.x) * e, y = s.y + (my - L.S * .5 - s.y) * e - Math.sin(k * Math.PI) * L.S * .5;
        coin(x, y, Math.max(3.5 * dpr, L.u * 1.3));
      }
    }
    for (const c of cards) drawCard(c);
    drawFx();
  }
  function coin(x, y, r) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = C.gold; ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1, r * .18); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * .48, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
  }
  function drawChart() {
    const b = L.band, pad = L.u * 2, x0 = W * (L.port ? .27 : .16), x1 = W - pad, y0 = pad * .8, y1 = b - pad * .6;
    ctx.strokeStyle = C.line; ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath(); ctx.moveTo(pad, b); ctx.lineTo(W - pad, b); ctx.stroke();
    const fs = Math.max(11 * dpr, L.u * 3.4);
    ctx.fillStyle = C.ink; ctx.font = `italic ${fs}px ${display}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('JEANPHIL', pad, (y0 + y1) / 2 - fs * .45);
    ctx.fillStyle = price > 1.6 ? C.red : C.mute; ctx.font = `${fs * 1.15}px ${display}`;
    ctx.fillText(`×${price.toFixed(1)}`, pad, (y0 + y1) / 2 + fs * .75);
    if (history.length < 2) return;
    const max = Math.max(2, ...history) * 1.08, n = 260;
    const X = i => x1 - (history.length - 1 - i) * (x1 - x0) / (n - 1), Y = v => y1 - (v / max) * (y1 - y0);
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1.4 * dpr, L.u * .45); ctx.lineJoin = 'round';
    ctx.beginPath(); history.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))); ctx.stroke();
    // mark each viral moment where it hit
    ctx.font = `italic ${fs * .78}px ${display}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const m of marks) {
      const i = Math.min(history.length - 1, Math.max(0, m.at + 7)), x = X(i), y = Y(history[i]);
      if (x < x0) continue;
      // the tag sits beside the peak, and never above the top of the chart
      ctx.fillStyle = C.red; ctx.beginPath(); ctx.arc(x, y, L.u * .8, 0, Math.PI * 2); ctx.fill();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(m.tag, x - L.u * 1.6, Math.max(y0 + fs * .4, y + L.u * .2));
    }
    ctx.beginPath(); ctx.arc(X(history.length - 1), Y(price), L.u * .9, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
  }
  function drawCard(c) {
    const k = (t - c.t0) / c.dur, e = ease(k), [mx, my] = mouth();
    const x = c.x0 + (mx - c.x0) * e, y = c.y0 + (my - c.y0) * e - Math.sin(k * Math.PI) * L.S * .4;
    const w = Math.min(W * (L.port ? .42 : .2), 230 * dpr), h = w * .72, sc = 1 - .75 * Math.max(0, (k - .75) / .25);
    ctx.save(); ctx.translate(x, y); ctx.rotate(c.rot * (1 - e * .5)); ctx.scale(sc, sc);
    ctx.fillStyle = 'rgba(20,19,18,.12)'; ctx.fillRect(-w / 2 + 4 * dpr, -h / 2 + 5 * dpr, w, h);
    ctx.fillStyle = C.bone; ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1.5 * dpr, w * .012);
    ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h);
    // the doodle, top half
    doodle(c.v.doodle, 0, -h * .14, h * .5);
    // a little play mark, and the title
    ctx.fillStyle = C.red; ctx.beginPath(); ctx.moveTo(-w / 2 + w * .06, -h / 2 + h * .08); ctx.lineTo(-w / 2 + w * .06, -h / 2 + h * .2); ctx.lineTo(-w / 2 + w * .14, -h / 2 + h * .14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fs = h * .12; ctx.font = `italic ${fs}px ${display}`;
    wrap(c.v.title, w * .9).forEach((ln, i, a) => ctx.fillText(ln, 0, h * .3 + (i - (a.length - 1) / 2) * fs * 1.1));
    ctx.restore();
  }
  function wrap(text, maxW) {
    const words = text.split(' '), out = []; let ln = '';
    for (const w of words) { const tst = ln ? ln + ' ' + w : w; if (ctx.measureText(tst).width > maxW && ln) { out.push(ln); ln = w; } else ln = tst; }
    if (ln) out.push(ln); return out;
  }
  // Small ink doodles for the viral cards, each around a Jean Phil sticker.
  function doodle(kind, x, y, s) {
    const spr = stickerSprite(L.size), k = s / spr.width * 1.1;
    ctx.save(); ctx.translate(x, y); ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1.2 * dpr, s * .03); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const face = (dx, dy, sc) => { ctx.save(); ctx.translate(dx, dy); ctx.scale(k * sc, k * sc); ctx.drawImage(spr, -spr.width / 2, -spr.height / 2); ctx.restore(); };
    if (kind === 'pug') {
      // a pug in the bob: round face, folded ears, squashed nose
      ctx.fillStyle = C.hair; ctx.beginPath(); ctx.ellipse(0, -s * .05, s * .48, s * .44, 0, Math.PI, 0); ctx.lineTo(s * .5, s * .32); ctx.lineTo(-s * .5, s * .32); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d9b98a'; ctx.beginPath(); ctx.ellipse(0, s * .1, s * .3, s * .27, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.ink; for (const d of [-1, 1]) { ctx.beginPath(); ctx.arc(d * s * .12, s * .03, s * .045, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath(); ctx.ellipse(0, s * .16, s * .08, s * .05, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.hair; ctx.lineWidth = s * .05; ctx.beginPath(); ctx.moveTo(-s * .14, s * .25); ctx.quadraticCurveTo(0, s * .2, s * .14, s * .25); ctx.stroke();
    } else if (kind === 'podium') {
      face(0, -s * .12, .8);
      ctx.fillStyle = C.bone; ctx.beginPath(); ctx.moveTo(-s * .3, s * .12); ctx.lineTo(s * .3, s * .12); ctx.lineTo(s * .24, s * .45); ctx.lineTo(-s * .24, s * .45); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.red; for (const d of [-1, 0, 1]) { ctx.beginPath(); ctx.arc(d * s * .1, s * .26, s * .03, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = C.ink; for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * s * .5, -s * .45); ctx.lineTo(d * s * .5, s * .45); ctx.stroke(); ctx.fillStyle = C.red; ctx.fillRect(d * s * .5 + (d < 0 ? 0 : -s * .16), -s * .45, s * .16, s * .1); }
    } else if (kind === 'donkey') {
      face(s * .26, s * .02, .7);
      ctx.fillStyle = '#b9ae98';
      ctx.beginPath(); ctx.ellipse(-s * .22, s * .02, s * .2, s * .3, -.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(-s * .22 + d * s * .1, -s * .34, s * .05, s * .16, d * .3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(-s * .28, -s * .02, s * .025, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'grandma') {
      face(s * .24, s * .02, .7);
      ctx.fillStyle = '#dcd6ca'; ctx.beginPath(); ctx.arc(-s * .24, -s * .05, s * .2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(-s * .24, -s * .3, s * .1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      for (const d of [-1, 1]) { ctx.beginPath(); ctx.arc(-s * .24 + d * s * .08, -s * .04, s * .06, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(-s * .24, s * .06, s * .06, .2, Math.PI - .2); ctx.stroke();
    }
    ctx.restore();
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
  canvas.addEventListener('pointerup', e => {
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved > 12 || !L) return;
    const r = canvas.getBoundingClientRect(); tap((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
  });
  canvas.addEventListener('keydown', e => {
    if (e.key !== ' ' && e.key !== 'Enter') return; e.preventDefault();
    if (e.key === ' ') { if (!cards.length) viral(true); return; }
    const c = copies.reduce((a, c) => (!a || c.born < a.born ? c : a), null); if (c) pop(c);
  });
  function pop(c) {
    copies.splice(copies.indexOf(c), 1); fx.push({kind: 'pop', slot: c.slot, t0: t, dur: .45});
    spawn(1.1); if (rnd() < .5) spawn(1.5);
    say('Pop one. It makes another.', 'pop');
  }
  function tap(px, py) {
    for (const c of cards) { const k = (t - c.t0) / c.dur; if (k > .9) continue; c.t0 = t - c.dur * .9; c.dur = c.dur; return; }
    if (Math.hypot(px - L.mx, py - L.my) < L.S * 1.3) { shake = t; chomp = t; gaze = 1; poked++; say(poked > 2 ? 'Knock knock. Still nobody.' : 'Knock knock. Nobody answers.', poked > 2 ? 'poke2' : 'poke'); return; }
    let best = null, bd = 1e9;
    for (const c of copies) { const s = L.slots[c.slot], d = Math.hypot(px - s.x, py - s.y); if (d < bd) { bd = d; best = c; } }
    if (best && bd < L.size * .7) pop(best);
  }

  // ---- lifecycle: runs only while on screen
  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now;
    if (L) step(dt);
    pumpCap(now);
    draw(now);
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
  new IntersectionObserver(es => { visible = es[es.length - 1].isIntersecting; if (visible) wake(); }, {threshold: [0, .2]}).observe(canvas);
  document.addEventListener('visibilitychange', wake);
  new ResizeObserver(() => { if (layout()) draw(performance.now()); }).observe(canvas);
  (document.fonts?.ready || Promise.resolve()).then(() => draw(performance.now()));
  window.__headless = {get t() { return t; }, viral: () => viral(true), get copies() { return copies.length; }};
}
