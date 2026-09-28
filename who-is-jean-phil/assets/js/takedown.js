// Take him down: a toy version of the paper's machine, played on a sheet of paper.
// Jean Phils pop up; the crowd laughs; every laugh drops a coin in his jar; the jar buys the next
// copy. You tap to take them down. Smash the jar and it has kids. The one thing that stops it is
// nobody watching. The model is deterministic (seeded, fixed 50 ms step) so the demo is repeatable.

export const TUNE = {
  dt: .05, tCoin: 6, rate: .5, cost: 4, cool: .35, buyFlight: .8, coinFlight: .6,
  burst0: 2, burstPer: .25, burstMax: 6, repostRate: .8, coolMin: .2, coolPer: .012, fullAfterKids: 5,
  preRespawn: .9, banAlive: 7, banT: 16, banForce: 24, kidDelay: 2.4, kidCoins: 2,
  hydraDelay: 1.3, maxLive: 6, full: .85, fullHold: 1.5, endT: 40, lookDelay: 2.6, lookAuto: 7,
};

const CAPS = {
  start: 'One face. Easy.',
  again: 'Another one. Still easy.',
  coin: 'Then someone made him a coin.',
  laugh: 'Every laugh drops a coin in the jar.',
  buy: 'The jar buys a copy.',
  grow: 'Every copy earns more coins.',
  behind: "He's posting faster than you can tap.",
  banready: 'Go for the money. Tap the jar.',
  reach: 'Out of reach. For now.',
  ban: 'Jar smashed. Feed clean.',
  banforced: 'The platform stepped in. Jar smashed.',
  kids: 'But his coin had kids.',
  nobody: "New jars, new faces. Nobody's holding these.",
  hydra: 'Smash one, get two.',
  full: "You can't out-tap a face that pays for itself.",
  look: 'One thing pays for all of it. Tap the crowd to look away.',
  dark: 'Nobody watching. Nothing earned.',
  end1: 'The only takedown that worked was nobody watching.',
  end2: 'He was pretty funny, though.',
  demo: 'Watch a round. Tap to take over.',
  yours: 'Your turn. Tap every Jean Phil.',
};
const CRITICAL = new Set(['coin', 'buy', 'behind', 'ban', 'banforced', 'kids', 'nobody', 'hydra', 'full', 'look', 'dark', 'end1', 'end2', 'yours', 'demo', 'banready']);

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- the model
export function createModel({seed = 20260917, slots = 20} = {}) {
  const T = TUNE, rnd = mulberry32(seed);
  const s = {
    t: 0, phase: 'play', slots, faces: Array(slots).fill(null), reserved: new Set(),
    jars: [], flights: [], you: 0, him: 0, posted: 0, watching: true, banDone: false, banReady: false,
    kidsAt: null, lookPromptAt: null, lookAt: null, fullSince: null, fullShown: false, nextSeed: .6,
    said: new Set(), overAt: null, faceId: 0, jarId: 0, repostNext: T.tCoin + 1, kidsBorn: null,
  };
  const events = [];
  const say = key => { if (!s.said.has(key)) { s.said.add(key); events.push({type: 'cap', key}); } };
  const alive = () => s.faces.filter(Boolean).length;
  const liveJars = () => s.jars.filter(j => !j.frozen);
  const freeSlots = () => s.faces.map((f, i) => (!f && !s.reserved.has(i) ? i : -1)).filter(i => i >= 0);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  function jarFor() { const js = liveJars(); return js.length ? pick(js) : null; }

  function post(slot, jar, via) {
    const f = {id: ++s.faceId, born: s.t, next: s.t + (1 / T.rate) * (.6 + .8 * rnd()), jar: jar ? jar.id : null};
    s.faces[slot] = f; s.reserved.delete(slot); s.posted++; s.him++;
    events.push({type: 'spawn', slot, via, id: f.id});
    // A new copy is seen before anyone can reach it: its first laughs pay out right away.
    if (jar && s.watching) {
      const b = Math.min(T.burstMax, T.burst0 + s.posted * T.burstPer);
      let n = Math.floor(b), frac = b - n; if (rnd() < frac) n++;
      for (let k = 0; k < n; k++) coinFrom(slot, jar, k * .09);
    }
  }
  function coinFrom(slot, jar, delay = 0) {
    s.flights.push({kind: 'coin', slot, jar: jar.id, t1: s.t + delay + T.coinFlight});
    events.push({type: 'coin', slot, jar: jar.id, delay});
  }
  function buy(jar) {
    const free = freeSlots(); if (!free.length) return false;
    const slot = pick(free);
    jar.coins -= T.cost; jar.cool = Math.max(T.coolMin, T.cool - s.posted * T.coolPer); s.reserved.add(slot);
    s.flights.push({kind: 'buy', slot, jar: jar.id, t1: s.t + T.buyFlight});
    events.push({type: 'buy', slot, jar: jar.id});
    if (jar.owner === 'none') say('nobody'); else say('buy');
    return true;
  }
  function newJar(owner, coins, parent) {
    const j = {id: ++s.jarId, coins, frozen: false, owner, cool: .6, born: s.t, parent};
    s.jars.push(j); events.push({type: 'jar', id: j.id, parent, owner}); return j;
  }
  function freeze(j) {
    j.frozen = true; events.push({type: 'crack', id: j.id, coins: Math.floor(j.coins)}); j.coins = 0;
    s.flights = s.flights.filter(f => !(f.kind === 'buy' && f.jar === j.id && (s.reserved.delete(f.slot), true)));
  }

  function step() {
    const T_ = T, dt = T_.dt; s.t += dt;
    if (s.phase === 'over') return;
    // before the coin: one face at a time
    if (s.t < T_.tCoin) {
      if (!alive() && !s.reserved.size && s.t >= s.nextSeed) { const f = freeSlots(); post(pick(f), null, 'seed'); if (s.posted === 1) say('start'); }
    } else if (!s.jars.length) {
      newJar('launcher', 0, null); say('coin');
      if (!alive()) post(pick(freeSlots()), s.jars[0], 'seed');
      s.faces.forEach(f => { if (f) { f.jar = s.jars[0].id; f.next = s.t + .5 + rnd() * .8; } });
    }
    // flights land
    for (const f of s.flights.slice()) {
      if (s.t < f.t1) continue;
      s.flights.splice(s.flights.indexOf(f), 1);
      const j = s.jars.find(x => x.id === f.jar);
      if (f.kind === 'coin') { if (j && !j.frozen) { j.coins += 1; say('laugh'); } }
      else if (f.kind === 'buy') { if (!s.faces[f.slot] && s.phase !== 'dark') post(f.slot, j && !j.frozen ? j : jarFor(), 'jar'); else s.reserved.delete(f.slot); }
    }
    if (s.jars.length && s.watching) {
      // live faces keep earning while people watch
      s.faces.forEach((f, i) => {
        if (!f || s.t < f.next) return;
        f.next += (1 / T_.rate) * (.7 + .6 * rnd());
        let j = s.jars.find(x => x.id === f.jar);
        if (!j || j.frozen) { j = jarFor(); f.jar = j ? j.id : null; }
        if (j) coinFrom(i, j);
      });
      // people repost a trending face on their own, now and then
      if (s.t >= s.repostNext) {
        s.repostNext = s.t + (1 / T_.repostRate) * (.6 + .8 * rnd());
        const free = freeSlots(), j = jarFor();
        if (free.length && j) post(pick(free), j, 'repost');
      }
      // jars spend
      for (const j of liveJars()) { j.cool -= dt; if (j.coins >= T_.cost && j.cool <= 0) buy(j); }
    }
    const n = alive();
    if (s.posted > 3 && n >= 4) say('grow');
    if (n >= 7 && s.jars.length) say('behind');
    // the ban: available once he's ahead, forced if you never take it
    if (!s.banDone && s.jars.length && !s.banReady && (n >= T_.banAlive || s.t >= T_.banT) && s.said.has('buy')) { s.banReady = true; say('banready'); events.push({type: 'banready'}); }
    if (!s.banDone && s.banReady && s.t >= T_.banForce) smash(s.jars[0].id, true);
    if (s.kidsAt && s.t >= s.kidsAt) { s.kidsAt = null; const p = s.jars[0].id; newJar('none', T_.kidCoins, p); newJar('none', T_.kidCoins, p); s.kidsBorn = s.t; say('kids'); }
    for (const j of s.jars) if (j.split && s.t >= j.split) {
      j.split = null;
      const room = T_.maxLive - liveJars().length;
      for (let k = 0; k < Math.min(2, room); k++) newJar('none', 1, j.id);
    }
    // the end: he fills the feed
    if (s.phase === 'play' && s.banDone && s.kidsBorn != null && s.t - s.kidsBorn >= T_.fullAfterKids) {
      if (n >= Math.ceil(T_.full * s.slots)) { s.fullSince ??= s.t; } else s.fullSince = null;
      if ((s.fullSince != null && s.t - s.fullSince >= T_.fullHold) || s.t >= T_.endT) { s.phase = 'ending'; s.lookPromptAt = s.t + T_.lookDelay; say('full'); }
    }
    if (s.phase === 'ending' && s.lookPromptAt && s.t >= s.lookPromptAt) { s.lookPromptAt = null; s.lookReady = true; say('look'); events.push({type: 'lookready'}); s.lookAutoAt = s.t + T_.lookAuto; }
    if (s.lookReady && s.watching && s.t >= s.lookAutoAt) lookAway();
    if (s.phase === 'dark') {
      const k = s.t - s.lookAt;
      if (k >= 2.6) say('end1');
      if (k >= 5.2) say('end2');
      if (k >= 6.2) { s.phase = 'over'; events.push({type: 'over'}); }
    }
  }

  function tapFace(slot) {
    const f = s.faces[slot]; if (!f || s.phase === 'dark' || s.phase === 'over') return false;
    s.faces[slot] = null; s.you++;
    events.push({type: 'take', slot, id: f.id});
    if (s.t < T.tCoin) { s.nextSeed = s.t + T.preRespawn; if (s.you === 1) say('again'); }
    return true;
  }
  function smash(id, forced = false) {
    const j = s.jars.find(x => x.id === id); if (!j || j.frozen || s.phase === 'dark' || s.phase === 'over') return false;
    if (j.owner === 'launcher') {
      if (!s.banReady) { say('reach'); events.push({type: 'nope', id}); return false; }
      s.banDone = true; s.banReady = false; freeze(j);
      const gone = [];
      s.faces.forEach((f, i) => { if (f) { gone.push(i); s.faces[i] = null; } });
      s.you += forced ? 0 : gone.length;
      s.flights = s.flights.filter(f => f.kind !== 'buy' || (s.reserved.delete(f.slot), false));
      events.push({type: 'ban', slots: gone, forced});
      say(forced ? 'banforced' : 'ban');
      s.kidsAt = s.t + T.kidDelay;
      return true;
    }
    freeze(j); j.split = s.t + T.hydraDelay; say('hydra');
    return true;
  }
  function lookAway() {
    if (!s.lookReady || !s.watching) return false;
    s.watching = false; s.phase = 'dark'; s.lookAt = s.t; s.lookReady = false;
    s.flights = s.flights.filter(f => f.kind === 'coin' || (s.reserved.delete(f.slot), false));
    events.push({type: 'look'}); say('dark');
    return true;
  }
  return {s, events, step, tapFace, smash, lookAway, alive};
}

// ---------------------------------------------------------------- the view
if (typeof document !== 'undefined') {
  const root = document.querySelector('.tk');
  if (root) initView(root);
}

function initView(root) {
  const canvas = root.querySelector('.tk-canvas'), cap = root.querySelector('.tk-cap');
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const C = {paper: '#f2efe8', ink: '#141312', red: '#fd0001', hair: '#e8cd8c', gold: '#e8cd8c', gold2: '#b8975a', mute: '#8a8377', bone: '#fbf8f1', glow: '#fff1c4', grey: '#cfc9bd'};
  const FACE = new Path2D('M31,38 L69,38 L69,76 C69,88 60,94 50,94 C40,94 31,88 31,76 Z');
  const HAIR = new Path2D('M50,6 C65,6 75,15 79,30 C83,45 89,62 95,77 C87,81 76,80 69,74 C70,62 70,50 69,39 C61,35 39,35 31,39 C30,50 30,62 31,74 C24,80 13,81 5,77 C11,62 17,45 21,30 C25,15 35,6 50,6 Z');
  const STACHE = new Path2D('M38.6,64.6 C36.2,62.6 33.4,64.4 34.6,67.2 C35.8,70 40,71.2 43.6,70.2 C46.4,69.4 48.4,68.2 50,67.4 C51.6,68.2 53.6,69.4 56.4,70.2 C60,71.2 64.2,70 65.4,67.2 C66.6,64.4 63.8,62.6 61.4,64.6');
  const NOSE = new Path2D('M51,51 L48.5,62 L52,62.5');
  const display = getComputedStyle(document.documentElement).getPropertyValue('--display').trim() || 'Georgia, serif';

  let W = 0, H = 0, dpr = 1, L = null, model = null, mode = 'idle', sprite = null, spriteSize = 0;
  let acc = 0, last = 0, raf = 0, visible = false, idleSince = 0, demo = null, finger = null;
  const fx = []; // particles and marks
  const faceAnim = new Map(); // slot -> {born, gone}
  const jarAnim = new Map();  // jar id -> {born, wiggle, crack}
  const capQ = []; let capUntil = 0, capKey = '';

  // ---- captions: one line at a time, held long enough to read
  function queueCap(key) {
    if (!CAPS[key]) return;
    if (CRITICAL.has(key)) { for (let i = capQ.length - 1; i >= 0; i--) if (!CRITICAL.has(capQ[i])) capQ.splice(i, 1); }
    else if (capQ.length >= 2) return;
    capQ.push(key);
  }
  function pumpCap(now) {
    if (!capQ.length || now < capUntil) return;
    const key = capQ.shift(); capKey = key;
    cap.classList.add('swap');
    setTimeout(() => { cap.textContent = CAPS[key]; cap.classList.remove('swap'); }, reduced ? 0 : 140);
    capUntil = now + (key === 'look' ? 3200 : 2300);
  }
  function setCapNow(key) { capQ.length = 0; capUntil = 0; queueCap(key); }

  // ---- layout
  function layout() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.round(r.width * dpr); H = Math.round(r.height * dpr);
    if (!W || !H) return false;
    canvas.width = W; canvas.height = H;
    const port = W / H < 1.05;
    const cols = port ? 4 : 7, rows = port ? 5 : 3;
    const jarBand = H * (port ? .19 : .24), crowdBand = H * (port ? .17 : .2);
    const fx0 = W * .04, fx1 = W * .96, fy0 = jarBand + H * .02, fy1 = H - crowdBand - H * .02;
    const cw = (fx1 - fx0) / cols, ch = (fy1 - fy0) / rows;
    const rnd = mulberry32(7), slots = [];
    for (let r_ = 0; r_ < rows; r_++) for (let c = 0; c < cols; c++) slots.push({x: fx0 + cw * (c + .5) + (rnd() - .5) * cw * .16, y: fy0 + ch * (r_ + .5) + (rnd() - .5) * ch * .14, rot: (rnd() - .5) * .3});
    const size = Math.min(cw, ch) * .92;
    const crowd = [], nHeads = Math.max(6, Math.round(W / (crowdBand * .78)));
    for (let i = 0; i < nHeads; i++) crowd.push({x: W * (i + .5) / nHeads + (rnd() - .5) * W / nHeads * .3, hair: Math.floor(rnd() * 5), tilt: (rnd() - .5) * .2, phase: rnd() * 6});
    L = {port, cols, rows, jarBand, crowdBand, slots, size, crowd, u: Math.min(W, H) / 100};
    sprite = null;
    return true;
  }
  function stickerSprite(sz) {
    if (sprite && spriteSize === sz) return sprite;
    const pad = Math.ceil(sz * .12), c = document.createElement('canvas'); c.width = c.height = sz + pad * 2;
    const g = c.getContext('2d'); g.translate(pad, pad); g.scale(sz / 100, sz / 100);
    // sticker: a bone border around the symbol, then the symbol, outlined in ink
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = C.bone; g.lineWidth = 13; g.stroke(HAIR); g.stroke(FACE);
    g.fillStyle = C.bone; g.fill(HAIR); g.fill(FACE);
    g.fillStyle = C.red; g.fill(FACE); g.fillStyle = C.hair; g.fill(HAIR);
    g.strokeStyle = C.ink; g.lineWidth = 2.2; g.stroke(HAIR); g.stroke(FACE);
    g.strokeStyle = C.hair; g.lineWidth = 4; g.stroke(STACHE);
    g.strokeStyle = C.ink; g.lineWidth = 2.6; g.stroke(NOSE);
    sprite = c; spriteSize = sz; return c;
  }

  // ---- hand-inked helpers (a little wobble, fixed per shape so lines don't boil)
  function wob(pts, seed, amp) {
    const r = mulberry32(seed); return pts.map(([x, y]) => [x + (r() - .5) * amp, y + (r() - .5) * amp]);
  }
  function inkPath(pts, close) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) { const m = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]; ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
    const e = pts[pts.length - 1]; ctx.lineTo(e[0], e[1]); if (close) ctx.closePath();
  }
  const ease = k => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
  const back = k => { k = Math.min(1, Math.max(0, k)); const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };

  // ---- positions
  function jarBoxes() {
    const js = model ? model.s.jars : [];
    const n = Math.max(1, js.length), band = L.jarBand, u = L.u;
    const size = Math.min(band * .78, (W * .72) / n);
    return js.map((j, i) => ({j, x: W / 2 + (i - (n - 1) / 2) * Math.min(size * 1.25, (W * .78) / n), y: band * .52, s: j.frozen ? size * .82 : size}));
  }
  function jarPos(id) { const b = jarBoxes().find(b => b.j.id === id); return b ? [b.x, b.y - b.s * .05] : [W / 2, L.jarBand * .5]; }
  const slotPos = i => [L.slots[i].x, L.slots[i].y];
  function crowdPos(i) { const h = L.crowd[i % L.crowd.length]; return [h.x, H - L.crowdBand * .55]; }

  // ---- drawing
  function drawPaper() {
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    // a ruled line under the jars and over the crowd, like a sketchbook page
    ctx.strokeStyle = 'rgba(20,19,18,.12)'; ctx.lineWidth = Math.max(1, dpr);
    inkPath(wob([[W * .03, L.jarBand], [W * .5, L.jarBand + 1], [W * .97, L.jarBand]], 3, 2 * dpr)); ctx.stroke();
    inkPath(wob([[W * .03, H - L.crowdBand], [W * .5, H - L.crowdBand - 1], [W * .97, H - L.crowdBand]], 4, 2 * dpr)); ctx.stroke();
  }
  function drawJar(b, now) {
    const {j, x, y} = b; let s = b.s;
    const a = jarAnim.get(j.id) || {};
    const grow = a.born ? back((now - a.born) / 450) : 1; s *= grow;
    if (s <= 0) return;
    const wig = a.wiggle && now - a.wiggle < 260 ? Math.sin((now - a.wiggle) / 260 * Math.PI * 3) * .09 : 0;
    ctx.save(); ctx.translate(x, y); ctx.rotate(wig);
    const lw = Math.max(1.4 * dpr, s * .028);
    // the launcher's hand on a string (the first jar only, until it's smashed)
    if (j.owner === 'launcher' && !j.frozen) {
      ctx.strokeStyle = C.ink; ctx.lineWidth = lw * .7;
      inkPath(wob([[s * .05, -s * .55], [s * .12, -s * .75], [s * .06, -s * .98]], 11, s * .03)); ctx.stroke();
      drawHand(s * .06, -s * .98, s * .16, lw);
    }
    // ring pulse when the jar can be smashed
    if (model.s.banReady && j.owner === 'launcher' && !j.frozen && !reduced) {
      const k = (now % 1100) / 1100;
      ctx.beginPath(); ctx.arc(0, 0, s * (.55 + k * .25), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(253,0,1,${.55 * (1 - k)})`; ctx.lineWidth = lw * 1.4; ctx.stroke();
    }
    const body = wob([[-s * .26, -s * .4], [-s * .4, -s * .3], [-s * .42, s * .05], [-s * .4, s * .36], [-s * .3, s * .44], [0, s * .455], [s * .3, s * .44], [s * .4, s * .36], [s * .42, s * .05], [s * .4, s * .3 * -1], [s * .26, -s * .4]], j.id * 17, s * .025);
    // coins inside
    ctx.save(); inkPath(body, true); ctx.clip();
    ctx.fillStyle = j.frozen ? 'rgba(207,201,189,.35)' : 'rgba(255,255,255,.45)'; ctx.fillRect(-s, -s, s * 2, s * 2);
    const n = Math.min(18, Math.floor(j.coins)), cr = s * .11;
    for (let k = 0; k < n; k++) {
      const row = Math.floor(k / 3), col = k % 3;
      const cx = (col - 1) * cr * 2.05 + (row % 2 ? cr * .5 : 0), cy = s * .37 - row * cr * .9;
      ctx.beginPath(); ctx.ellipse(cx, cy, cr, cr * .55, 0, 0, Math.PI * 2); ctx.fillStyle = C.gold; ctx.fill();
      ctx.strokeStyle = C.gold2; ctx.lineWidth = lw * .6; ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = C.ink; ctx.lineWidth = lw; inkPath(body, true); ctx.stroke();
    // glass shine
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = lw * 1.2;
    inkPath([[-s * .3, -s * .2], [-s * .33, 0], [-s * .3, s * .2]]); ctx.stroke();
    // lid
    ctx.fillStyle = j.frozen ? C.grey : C.red; ctx.strokeStyle = C.ink; ctx.lineWidth = lw;
    inkPath(wob([[-s * .3, -s * .42], [-s * .3, -s * .55], [s * .3, -s * .55], [s * .3, -s * .42]], j.id * 5, s * .02), true); ctx.fill(); ctx.stroke();
    // a smashed jar: cracks
    if (j.frozen) {
      ctx.strokeStyle = C.ink; ctx.lineWidth = lw * .8;
      inkPath(wob([[-s * .05, -s * .38], [s * .06, -s * .15], [-s * .08, s * .02], [s * .1, s * .2], [s * .02, s * .42]], j.id * 3, s * .05)); ctx.stroke();
      inkPath(wob([[s * .06, -s * .15], [s * .3, -s * .08]], j.id * 9, s * .04)); ctx.stroke();
    }
    // label
    ctx.fillStyle = j.frozen ? C.mute : C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = `italic ${Math.max(10 * dpr, s * .16)}px ${display}`;
    ctx.fillText(j.frozen ? 'smashed' : j.owner === 'launcher' ? 'JEANPHIL' : 'no owner', 0, s * .5);
    ctx.restore();
  }
  function drawHand(x, y, s, lw) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = C.bone; ctx.strokeStyle = C.ink; ctx.lineWidth = lw * .8;
    ctx.beginPath(); ctx.ellipse(0, -s * .1, s * .45, s * .38, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.ellipse(k * s * .26, s * .28, s * .11, s * .2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
  function drawFaces(now) {
    const sz = Math.round(L.size), spr = stickerSprite(sz), off = spr.width / 2;
    model.s.faces.forEach((f, i) => {
      if (!f) return;
      const a = faceAnim.get(i), [x, y] = slotPos(i);
      let k = a ? (now - a.born) / 280 : 1; const sc = reduced ? 1 : back(k);
      const fade = model.s.phase === 'dark' || model.s.phase === 'over' ? Math.max(0, 1 - (now - (a?.fadeAt || now)) / 600) : 1;
      if (fade <= 0) return;
      ctx.save(); ctx.globalAlpha = fade; ctx.translate(x, y); ctx.rotate(L.slots[i].rot); ctx.scale(sc, sc);
      ctx.drawImage(spr, -off, -off); ctx.restore();
    });
  }
  function drawCrowd(now) {
    const u = L.crowdBand, y0 = H - u * .5, watching = model ? model.s.watching : true;
    const darkAt = model && model.s.lookAt != null ? lookWall : null;
    L.crowd.forEach((h, i) => {
      const r = u * .19, x = h.x, y = y0 - u * .05;
      const off = darkAt != null && now - darkAt > i * 90;
      const pulse = model && model.s.lookReady && !reduced ? Math.sin(now / 180 + i) * .5 + .5 : 0;
      ctx.save(); ctx.translate(x, y); ctx.rotate(h.tilt);
      const lw = Math.max(1.2 * dpr, u * .022);
      // shoulders
      ctx.strokeStyle = C.ink; ctx.lineWidth = lw; ctx.fillStyle = C.bone;
      inkPath(wob([[-r * 1.5, u * .5], [-r * 1.25, r * 1.2], [0, r * .95], [r * 1.25, r * 1.2], [r * 1.5, u * .5]], i * 7 + 1, r * .08)); ctx.fill(); ctx.stroke();
      // head
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // hair
      ctx.fillStyle = C.ink;
      if (h.hair === 0) { ctx.beginPath(); ctx.arc(0, -r * .1, r * 1.02, Math.PI * 1.05, Math.PI * 1.95); ctx.fill(); }
      else if (h.hair === 1) { ctx.beginPath(); ctx.arc(0, -r * 1.05, r * .42, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(0, -r * .15, r * 1.02, Math.PI * 1.1, Math.PI * 1.9); ctx.fill(); }
      else if (h.hair === 2) { ctx.fillStyle = '#6b4a2e'; ctx.beginPath(); ctx.arc(0, -r * .05, r * 1.05, Math.PI, 0); ctx.fill(); }
      else if (h.hair === 3) { ctx.fillStyle = C.ink; ctx.beginPath(); ctx.ellipse(0, -r * .62, r * 1.05, r * .42, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(-r * 1.05, -r * .66, r * 1.5, r * .16); }
      // eyes: on the phone, or closed once they look away
      ctx.strokeStyle = C.ink; ctx.fillStyle = C.ink; ctx.lineWidth = lw * .9;
      if (off) { for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * r * .45 - r * .15, r * .1); ctx.lineTo(s * r * .45 + r * .15, r * .1); ctx.stroke(); } }
      else for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * r * .38, r * .22, r * .1, 0, Math.PI * 2); ctx.fill(); }
      // mouth: a laugh when watching
      const laugh = !off && watching && Math.sin(now / 240 + h.phase) > .2;
      ctx.beginPath();
      if (laugh) { ctx.arc(0, r * .45, r * .22, 0, Math.PI); ctx.closePath(); ctx.fill(); }
      else { ctx.moveTo(-r * .18, r * .55); ctx.lineTo(r * .18, r * .55); ctx.stroke(); }
      // phone
      const pw = r * .62, ph = r * 1.05;
      ctx.save(); ctx.translate(r * .72, r * 1.05); ctx.rotate(-.35);
      if (!off) { ctx.fillStyle = 'rgba(255,241,196,.55)'; ctx.beginPath(); ctx.arc(0, 0, r * .95, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-pw / 2, -ph / 2, pw, ph, r * .12) : ctx.rect(-pw / 2, -ph / 2, pw, ph); ctx.fill();
      ctx.fillStyle = off ? '#2a2724' : C.glow; ctx.beginPath(); ctx.rect(-pw * .36, -ph * .4, pw * .72, ph * .72); ctx.fill();
      ctx.fillStyle = C.bone; ctx.strokeStyle = C.ink; ctx.lineWidth = lw * .8; ctx.beginPath(); ctx.arc(-pw * .1, ph * .5, r * .2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (!off && pulse) { ctx.strokeStyle = `rgba(253,0,1,${.7 * pulse})`; ctx.lineWidth = lw * 1.5; ctx.beginPath(); ctx.arc(0, r * .3, r * 1.55, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    });
  }
  function drawCoin(x, y, r) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = C.gold; ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1, r * .16); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * .5, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
  }
  function drawFx(now) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i], k = (now - p.t0) / p.dur;
      if (k < 0) continue;
      if (k >= 1) { fx.splice(i, 1); continue; }
      if (p.kind === 'ha') {
        const e = ease(k), x = p.x0 + (p.x1 - p.x0) * e, y = p.y0 + (p.y1 - p.y0) * e - Math.sin(k * Math.PI) * p.arc;
        ctx.globalAlpha = k < .8 ? 1 : (1 - k) / .2; ctx.fillStyle = C.ink; ctx.font = `italic ${p.sz}px ${display}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('ha', x, y); ctx.globalAlpha = 1;
      } else if (p.kind === 'coin') {
        const e = ease(k), x = p.x0 + (p.x1 - p.x0) * e, y = p.y0 + (p.y1 - p.y0) * e - Math.sin(k * Math.PI) * p.arc;
        drawCoin(x, y, p.r);
      } else if (p.kind === 'x') { // red scribble where a face was
        const a = k < .15 ? k / .15 : 1, fade = k > .5 ? 1 - (k - .5) / .5 : 1;
        ctx.globalAlpha = fade; ctx.strokeStyle = C.red; ctx.lineWidth = p.w; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x - p.s, p.y - p.s); ctx.lineTo(p.x - p.s + p.s * 2 * Math.min(1, a * 2), p.y - p.s + p.s * 2 * Math.min(1, a * 2)); ctx.stroke();
        if (a > .5) { ctx.beginPath(); ctx.moveTo(p.x + p.s, p.y - p.s); ctx.lineTo(p.x + p.s - p.s * 2 * (a - .5) * 2, p.y - p.s + p.s * 2 * (a - .5) * 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
      } else if (p.kind === 'poof') { // the sticker flies off, spinning
        const e = ease(k), sz = Math.round(L.size), spr = stickerSprite(sz), off = spr.width / 2;
        ctx.save(); ctx.globalAlpha = 1 - k; ctx.translate(p.x + p.dx * e, p.y - p.lift * e); ctx.rotate(p.rot + p.spin * e); ctx.scale(1 - .5 * e, 1 - .5 * e); ctx.drawImage(spr, -off, -off); ctx.restore();
      } else if (p.kind === 'ring') {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (.4 + k), 0, Math.PI * 2); ctx.strokeStyle = `rgba(20,19,18,${.6 * (1 - k)})`; ctx.lineWidth = 2 * dpr; ctx.stroke();
      } else if (p.kind === 'spill') {
        const x = p.x + p.vx * k, y = p.y + p.vy * k + p.g * k * k; drawCoin(x, y, p.r * (1 - k * .3));
      }
    }
  }
  function drawTally() {
    if (!model || mode === 'idle') return;
    const s = model.s, fs = Math.max(11 * dpr, L.u * 3.4);
    ctx.font = `italic ${fs}px ${display}`; ctx.textBaseline = 'top'; ctx.fillStyle = C.ink;
    ctx.textAlign = 'left'; ctx.fillText(`you ${s.you}`, W * .03, L.u * 1.4);
    ctx.textAlign = 'right'; ctx.fillStyle = C.red; ctx.fillText(`him ${s.him}`, W * .97, L.u * 1.4);
  }
  function drawFinger(now) {
    if (!finger) return;
    const k = Math.min(1, (now - finger.t0) / finger.dur), e = ease(k);
    const x = finger.x0 + (finger.x1 - finger.x0) * e, y = finger.y0 + (finger.y1 - finger.y0) * e;
    finger.x = x; finger.y = y;
    const r = L.u * 3.2, press = finger.press && now - finger.press < 160;
    ctx.save(); ctx.translate(x, y + (press ? r * .15 : 0));
    ctx.fillStyle = 'rgba(251,248,241,.92)'; ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1.4 * dpr, r * .08);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-r * .32, 0, r * .64, r * 1.5, r * .32) : ctx.rect(-r * .32, 0, r * .64, r * 1.5); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(r * .1, r * 1.6, r * .6, r * .5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function drawStart(now) {
    ctx.fillStyle = 'rgba(242,239,232,.86)'; ctx.fillRect(0, 0, W, H);
    const big = Math.round(Math.min(W, H) * .3), spr = stickerSprite(big);
    ctx.save(); ctx.translate(W / 2, H * .34); ctx.rotate(-.08 + (reduced ? 0 : Math.sin(now / 700) * .04));
    ctx.drawImage(spr, -spr.width / 2, -spr.height / 2); ctx.restore();
    sprite = null; // the field uses its own size
    drawButton('Start');
  }
  function drawButton(label) {
    const b = startBtn(), fs = Math.max(16 * dpr, b.h * .44);
    ctx.fillStyle = C.bone; ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1.6 * dpr, b.h * .045);
    const r = wob([[b.x, b.y], [b.x + b.w * .5, b.y - 1.5 * dpr], [b.x + b.w, b.y], [b.x + b.w + 1.5 * dpr, b.y + b.h * .5], [b.x + b.w, b.y + b.h], [b.x + b.w * .5, b.y + b.h + 1.5 * dpr], [b.x, b.y + b.h], [b.x - 1.5 * dpr, b.y + b.h * .5]], 21, 2.4 * dpr);
    ctx.beginPath(); r.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `italic ${fs}px ${display}`;
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + fs * .04);
  }
  const startBtn = () => { const w = Math.min(W * .46, 200 * dpr), h = Math.max(46 * dpr, H * .085); return {x: W / 2 - w / 2, y: H * .56, w, h}; };
  function drawEnd() {
    const s = model.s, fs = Math.max(16 * dpr, Math.min(W, H) * .055);
    ctx.fillStyle = 'rgba(242,239,232,.9)'; ctx.fillRect(0, H * .3, W, H * .42);
    ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${fs}px ${display}`;
    ctx.fillText(`You took down ${s.you}. He posted ${s.him}.`, W / 2, H * .4);
    drawButton('Play again');
  }

  // ---- model events -> animation
  let lookWall = null;
  function onEvents(now) {
    for (const e of model.events.splice(0)) {
      if (e.type === 'cap') queueCap(e.key);
      else if (e.type === 'spawn') {
        faceAnim.set(e.slot, {born: now});
        if (!reduced) fx.push({kind: 'ring', x: slotPos(e.slot)[0], y: slotPos(e.slot)[1], r: L.size * .6, t0: now, dur: 380});
      } else if (e.type === 'take') {
        const [x, y] = slotPos(e.slot);
        fx.push({kind: 'poof', x, y, rot: L.slots[e.slot].rot, spin: (Math.random() - .5) * 2, dx: (Math.random() - .5) * L.size * .6, lift: L.size * .3, t0: now, dur: 320});
        fx.push({kind: 'x', x, y, s: L.size * .28, w: Math.max(2 * dpr, L.size * .07), t0: now, dur: 900});
      } else if (e.type === 'coin') {
        const [fx0, fy0] = slotPos(e.slot), [jx, jy] = jarPos(e.jar), [cx, cy] = crowdPos(Math.floor(Math.random() * L.crowd.length));
        const d = e.delay * 1000, haDur = reduced ? 0 : 280, coinDur = TUNE.coinFlight * 1000 - haDur;
        if (!reduced) fx.push({kind: 'ha', x0: cx, y0: cy - L.crowdBand * .3, x1: fx0, y1: fy0 + L.size * .3, arc: L.u * 4, sz: Math.max(11 * dpr, L.u * 3.2), t0: now + d, dur: haDur});
        fx.push({kind: 'coin', x0: fx0, y0: fy0, x1: jx, y1: jy, arc: L.u * 6, r: Math.max(4 * dpr, L.u * 1.6), t0: now + d + haDur, dur: coinDur});
      } else if (e.type === 'buy') {
        const [jx, jy] = jarPos(e.jar), [x, y] = slotPos(e.slot);
        const a = jarAnim.get(e.jar) || {}; a.wiggle = now; jarAnim.set(e.jar, a);
        fx.push({kind: 'coin', x0: jx, y0: jy, x1: x, y1: y, arc: L.u * 10, r: Math.max(6 * dpr, L.u * 2.4), t0: now, dur: TUNE.buyFlight * 1000});
      } else if (e.type === 'jar') { jarAnim.set(e.id, {born: now}); if (e.parent) { const [px, py] = jarPos(e.parent); fx.push({kind: 'ring', x: px, y: py, r: L.jarBand * .5, t0: now, dur: 500}); } }
      else if (e.type === 'crack') {
        const [x, y] = jarPos(e.id), n = Math.min(10, e.coins + 3);
        for (let k = 0; k < n; k++) fx.push({kind: 'spill', x, y, vx: (Math.random() - .5) * W * .35, vy: -L.u * 6, g: L.jarBand * 1.6, r: Math.max(4 * dpr, L.u * 1.4), t0: now, dur: 700});
      } else if (e.type === 'ban') {
        e.slots.forEach((i, k) => { const [x, y] = slotPos(i); fx.push({kind: 'x', x, y, s: L.size * .3, w: Math.max(2 * dpr, L.size * .07), t0: now + k * 35, dur: 1100}); fx.push({kind: 'poof', x, y, rot: L.slots[i].rot, spin: 1, dx: 0, lift: L.size * .2, t0: now + k * 35 + 150, dur: 300}); });
      } else if (e.type === 'nope') { const a = jarAnim.get(e.id) || {}; a.wiggle = now; jarAnim.set(e.id, a); }
      else if (e.type === 'look') { lookWall = now; model.s.faces.forEach((f, i) => { if (f) { const a = faceAnim.get(i) || {born: 0}; a.fadeAt = now + 900 + i * 60; faceAnim.set(i, a); } }); }
      else if (e.type === 'over') { mode = 'over'; if (demo) demo = null; }
    }
  }

  // ---- input
  function hit(px, py) {
    if (mode === 'idle' || mode === 'over') { const b = startBtn(); return (px >= b.x && px <= b.x + b.w && py >= b.y - 10 * dpr && py <= b.y + b.h + 10 * dpr) ? {what: 'start'} : null; }
    const s = model.s;
    if (py > H - L.crowdBand) return {what: 'crowd'};
    if (py < L.jarBand * 1.05) { let best = null, bd = 1e9; for (const b of jarBoxes()) { const d = Math.hypot(px - b.x, py - b.y); if (d < bd) { bd = d; best = b; } } if (best && bd < best.s * .8) return {what: 'jar', id: best.j.id}; }
    let best = -1, bd = 1e9; s.faces.forEach((f, i) => { if (!f) return; const [x, y] = slotPos(i), d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && bd < L.size * .62) return {what: 'face', slot: best};
    return null;
  }
  function act(h) {
    if (!h) return;
    if (h.what === 'start') return startGame(false);
    if (h.what === 'face') model.tapFace(h.slot);
    else if (h.what === 'jar') model.smash(h.id);
    else if (h.what === 'crowd') model.lookAway();
  }
  let down = null;
  canvas.addEventListener('pointerdown', e => { down = {x: e.clientX, y: e.clientY, t: e.timeStamp}; });
  canvas.addEventListener('pointerup', e => {
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved > 12) return; // a scroll, not a tap
    const r = canvas.getBoundingClientRect(), px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
    if (demo) { startGame(false, true); return; } // tap during the demo: your turn
    act(hit(px, py));
  });
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('keydown', e => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (demo || mode === 'idle' || mode === 'over') return startGame(false, !!demo);
    const s = model.s;
    if (s.lookReady) return model.lookAway();
    if (s.banReady && s.jars[0] && !s.jars[0].frozen) return model.smash(s.jars[0].id);
    const i = oldestFace(); if (i >= 0) model.tapFace(i);
  });
  function oldestFace() { let b = -1, bt = 1e9; model.s.faces.forEach((f, i) => { if (f && f.born < bt) { bt = f.born; b = i; } }); return b; }

  // ---- demo: a ghost finger plays one round for the screen recording
  function demoThink(now) {
    const s = model.s;
    if (finger && now < finger.t0 + finger.dur + 60) return;
    let target = null;
    if (s.lookReady && s.t - (s.lookReadyAt ??= s.t) > 1.6) target = {what: 'crowd', xy: crowdPos(Math.floor(L.crowd.length / 2))};
    else if (s.banReady && s.jars[0] && !s.jars[0].frozen && s.t - (s.banReadyAt ??= s.t) > 1.3) target = {what: 'jar', id: s.jars[0].id, xy: jarPos(s.jars[0].id)};
    else if (s.said.has('nobody') && !demo.hydra && s.t - (demo.nobodyAt ??= s.t) > 2.4) { const kid = s.jars.find(j => !j.frozen && j.owner === 'none'); if (kid) { demo.hydra = true; target = {what: 'jar', id: kid.id, xy: jarPos(kid.id)}; } }
    if (!target && s.phase !== 'dark') { const i = oldestFace(); if (i >= 0 && s.t - s.faces[i].born > .35) target = {what: 'face', slot: i, xy: slotPos(i)}; }
    if (!target) return;
    const from = finger ? [finger.x, finger.y] : [W * .5, H * .95];
    const dist = Math.hypot(target.xy[0] - from[0], target.xy[1] - from[1]) / W;
    finger = {x0: from[0], y0: from[1], x1: target.xy[0], y1: target.xy[1] + L.u * 1.5, t0: now, dur: 260 + dist * 380 + (target.what === 'face' ? 60 : 250), target, x: from[0], y: from[1]};
  }
  function demoAct(now) {
    if (!finger || finger.done || now < finger.t0 + finger.dur) return;
    finger.done = true; finger.press = now;
    const t = finger.target;
    if (t.what === 'face' && model.s.faces[t.slot]) model.tapFace(t.slot);
    else if (t.what === 'jar') model.smash(t.id);
    else if (t.what === 'crowd') model.lookAway();
  }

  // ---- lifecycle
  function startGame(isDemo, takeover = false) {
    model = createModel({slots: L.slots.length});
    fx.length = 0; faceAnim.clear(); jarAnim.clear(); lookWall = null; finger = null;
    demo = isDemo ? {} : null; mode = 'play'; acc = 0;
    setCapNow(isDemo ? 'demo' : takeover ? 'yours' : 'start');
    canvas.classList.toggle('is-demo', !!isDemo);
    wake();
  }
  function autoplayOn() { const b = document.getElementById('motion-toggle'); return !b || b.getAttribute('aria-pressed') !== 'false'; }
  function frame(nowMs) {
    raf = 0;
    const now = nowMs; const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now;
    if (mode === 'idle' && visible && !reduced && autoplayOn() && now - idleSince > 2600) startGame(true);
    if (model && (mode === 'play') && visible && !document.hidden) {
      acc += dt;
      while (acc >= TUNE.dt) { acc -= TUNE.dt; model.step(); }
      onEvents(now);
      if (demo) { demoThink(now); demoAct(now); }
    }
    pumpCap(now);
    draw(now);
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function draw(now) {
    if (!L) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawPaper();
    if (model) { for (const b of jarBoxes()) drawJar(b, now); drawFaces(now); }
    drawCrowd(now);
    if (model) { drawFx(now); drawTally(); }
    if (demo) drawFinger(now);
    if (mode === 'idle') drawStart(now);
    if (mode === 'over') drawEnd();
  }
  function wake() { if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
  new IntersectionObserver(es => {
    const e = es[es.length - 1]; const was = visible; visible = e.isIntersecting && e.intersectionRatio >= .35;
    if (visible && !was) { if (mode === 'idle') idleSince = performance.now(); wake(); }
  }, {threshold: [0, .35, .7]}).observe(canvas);
  document.addEventListener('visibilitychange', wake);
  new ResizeObserver(() => {
    if (!layout()) return;
    // a new grid (phone turned, window resized) can't host the old round: start over
    if (model && model.s.slots !== L.slots.length) { model = null; demo = null; finger = null; fx.length = 0; mode = 'idle'; idleSince = performance.now(); setCapNow('start'); cap.textContent = 'Tap every Jean Phil.'; }
    draw(performance.now());
  }).observe(canvas);
  (document.fonts?.ready || Promise.resolve()).then(() => draw(performance.now()));
  cap.textContent = 'Tap every Jean Phil.';
  window.__takedown = {start: d => startGame(!!d), get model() { return model; }, get mode() { return mode; }};
}
