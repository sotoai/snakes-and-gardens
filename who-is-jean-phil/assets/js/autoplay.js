// Who is Jean Phil? · Play mode: the finished mix plays and the page performs itself in time with it.
//
// Press Play (#play-toggle) and <audio id="sg-audio"> (Josh's mix, 630.552 s) starts; every animation frame the page track
// in assets/data/choreography-play.json is evaluated at audio.currentTime (the audio is the master clock): eased scrolls
// to each frame's rest, the stage figures, the one-shot draw-ons, the tape videos seeked so their lips sit on the mix,
// and every interactive part through the hooks main.js and the component scripts expose (window.__sg, canvas.__hat,
// canvas.__monster, window.__headless, deck.__cards; see scratchpad/autoplay/hooks-api.md).
//
// Any reader interaction pauses it (wheel, touch, a tap or click anywhere but the Play control, a key other than Space or
// Enter on the Play control, dragging the scrollbar, or the tab going hidden): the audio stops, the page is handed back
// to the reader exactly where it is (__sg.mode('reader'): snap, sound model, Autoplay, the video manager). Play again, from
// anywhere, backs up to the start of the sentence that was cut off (if it began within 2.5 s), glides the page back to
// where the story is, and carries on. At the end the page rests on the credits and the control reads "Replay".
// A pause is silent: the gesture that paused the story is not a tap for page sound, and page sound stays off until the
// reader's next tap or key (main.js). A pause in the middle of a scroll move leaves the page exactly where it is: snap
// comes back with the reader's own next scroll.
//
// Reader mode (Play never pressed) is untouched: until the first press this module only listens, and every listener
// returns at once. Nothing ever starts on its own.

import {selectPeriod} from './market-data.mjs';

const DATA = 'assets/data/choreography-play.json', SNAPSHOT = 'assets/data/market-snapshot.json';
const btn = document.getElementById('play-toggle');
const audio = document.getElementById('sg-audio');
const root = document.documentElement;
const label = btn && btn.querySelector('.label');
const rm = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => rm.matches;
const LABELS = {idle: 'Play', playing: 'Pause', paused: 'Play', ended: 'Replay'};
const ARIA = {idle: 'Play the story with narration', playing: 'Pause', paused: 'Play the story with narration', ended: 'Replay the story with narration'};
const SG = () => window.__sg;

/* ---------------- easing ---------------- */
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t, sy = t => ((ay * t + by) * t + cy) * t, dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return p => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) { const e = sx(t) - p, d = dx(t); if (Math.abs(e) < 1e-7) return sy(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1; t = p;
    for (let i = 0; i < 40; i++) { const v = sx(t); if (Math.abs(v - p) < 1e-7) break; if (v < p) lo = t; else hi = t; t = (lo + hi) / 2; }
    return sy(t);
  };
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const clamp01 = x => clamp(Number.isFinite(x) ? x : 0, 0, 1);

/* ---------------- the choreography, loaded on the first sign of intent ---------------- */
let C = null, loading = null;
function load() {
  if (!loading) loading = Promise.all([
    fetch(DATA).then(r => { if (!r.ok) throw new Error(`${DATA}: ${r.status}`); return r.json(); }),
    fetch(SNAPSHOT).then(r => r.json()).then(snapRoles, () => null),
  ]).then(([d, roles]) => { prepare(d); C.mkRoles = roles; return C; });
  loading.catch(() => { loading = null; });
  return loading;
}
// The market's dot is choreographed on the saved snapshot's hours (p044: from the first hour to the trough, 25, up to the
// peak, 117, on "bigger.", then the last hour). Play mode keeps the chart live ("Here it is, live."), so each key keeps
// its role (first, the low before the peak, the peak, last) and lands on that role in whatever series the chart is
// drawing now, so the dot still rides left to right: down, up to the peak on "bigger.", on to now.
function snapRoles(snap) {
  const pts = selectPeriod(snap.history, 168), pr = pts.map(p => p.price);
  const max = pr.indexOf(Math.max(...pr)), before = pr.slice(0, max + 1);
  return {n: pts.length, min: before.indexOf(Math.min(...before)), max};
}
let chartMemo = {d: null, map: null};
function chartIndex(v) {
  const R = C.mkRoles, d = document.querySelector('#m-line')?.getAttribute('d');
  if (!R || !d) return v;
  if (chartMemo.d !== d) { // one point per M/L command; SVG y grows downward, so the trough is the largest y
    const ys = [...d.matchAll(/[ML]\s*[-\d.]+,([-\d.]+)/g)].map(m => +m[1]);
    let lo = 0, hi = 0;
    ys.forEach((y, i) => { if (y < ys[hi]) hi = i; });
    for (let i = 0; i <= hi; i++) if (ys[i] > ys[lo]) lo = i;
    chartMemo = {d, map: ys.length > 1 ? {n: ys.length, lo, hi} : null};
  }
  const M = chartMemo.map;
  if (!M) return v;
  return v === R.min ? M.lo : v === R.max ? M.hi : v >= R.n - 1 ? M.n - 1 : v <= 0 ? 0 : Math.round(v / (R.n - 1) * (M.n - 1));
}
function prepare(d) {
  const cache = {};
  const ease = name => {
    if (!name || name === 'native' || name === 'linear') name = 'linear';
    if (name === 'hold') return p => (p >= 1 ? 1 : 0);
    if (name === 'instant' || name === 'cut') return () => 1;
    return cache[name] || (cache[name] = d.ease[name] ? bezier(...d.ease[name]) : (p => p));
  };
  const mqs = new Map();
  const media = q => { if (!q) return true; let m = mqs.get(q); if (!m) mqs.set(q, m = matchMedia(q)); return m.matches; };
  const track = d.track.map(a => ({...a, ok: () => media(a.media)}));
  const of = (...types) => track.filter(a => types.includes(a.type));
  const moves = of('scrollTo', 'advanceBeat').map(a => ({a, s: a.s, b: a.b, part: a.part, p: a.p, t0: a.t0, t1: a.t1, e: ease(a.p.ease), ok: a.ok}));
  const headless = of('headless');
  C = {
    d, ease, media, track, moves,
    D: d.audio.duration,
    rules: d.rules,
    units: d.units.map(u => ({...u, ok: () => media(u.media)})),
    sentences: d.sentences,
    videos: of('video'),
    reveals: of('reveal'),
    marketDraw: of('marketDraw'), marketInspect: of('marketInspect'),
    pile: of('pile')[0] || null, pileSelect: of('pileSelect'),
    slider: of('sliderTo')[0] || null,
    grids: of('grid'),
    monster: of('monster')[0] || null,
    hlReset: headless.find(a => a.p.op === 'reset') || null,
    hlRun: headless.find(a => a.p.op === 'run') || null,
    hlEvents: [...headless.filter(a => a.p.op === 'viral'), ...of('tap')].sort((a, b) => a.t0 - b.t0),
    wall: of('wall', 'hover', 'click'),
    paths: of('paths')[0] || null,
    hat: of('hat')[0] || null,
    cards: of('cardTurn'),
    flags: of('swapMode', 'repriseMode'),
    next: new Map(of('video').map((a, i, all) => [a, all.slice(i + 1).find(x => x.s === a.s && x.el === a.el) || null])),
    labels: {...LABELS, ...(d.rules && d.rules.labels)},
    aria: {...ARIA, ...(d.rules && d.rules.aria)},
  };
  return C;
}
// [[t, v, ease?], ...]: ease applies to the segment ending at that key; def is the default.
function keyAt(keys, t, def) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t < b[0]) {
      const a = keys[i - 1], e = b[2] || def || 'linear';
      if (e === 'hold') return a[1];
      return a[1] + (b[1] - a[1]) * C.ease(e)(clamp01((t - a[0]) / Math.max(1e-9, b[0] - a[0])));
    }
  }
  return keys[keys.length - 1][1];
}
const stepAt = (keys, t, v0) => { let v = v0; for (const k of keys) { if (k[0] <= t) v = k[1]; else break; } return v; };
const lastOf = (list, t, pred) => { let r = null; for (const a of list) { if (a.t0 <= t && a.ok() && (!pred || pred(a))) r = a; } return r; };

/* ---------------- targets (by data-frame; resolved once, again if the DOM changed) ---------------- */
const secs = new Map(), els = new Map();
function sectionOf(s) {
  let el = secs.get(s);
  if (!el || !el.isConnected) { el = document.querySelector(`main section[data-frame="${s}"]`); secs.set(s, el); }
  return el;
}
function elOf(a) {
  let el = els.get(a.id);
  if (el && el.isConnected) return el;
  const sec = sectionOf(a.s);
  el = !sec ? null : !a.el ? sec : sec.matches(a.el) ? sec : sec.querySelector(a.el);
  els.set(a.id, el);
  return el;
}
// Where a move (or a unit) rests: a section's top, a beat's centre snap, or (p145) an element's centre. Resolved from the
// DOM every time, by the same __sg.restY the renderer uses, so a late layout change is followed.
function restOf(x) {
  const sec = sectionOf(x.s), sg = SG();
  if (!sec || !sg) return null;
  if (x.b != null) return sg.restY(sec, {frame: x.b, part: x.part});
  const p = x.p || {};
  if (p.align === 'center' && p.center) { const el = sec.querySelector(p.center); if (el) return sg.restY(el, {center: true}); }
  return sg.restY(sec);
}

/* ---------------- player state ---------------- */
const st = {
  state: 'idle',        // idle | loading | playing | paused | ended
  phase: null,          // while playing: 'glide' (the page travels back, the audio waits) | 'run'
  glide: null,          // {from, t0, dur, ease, wait, t}
  pausedAt: 0, exact: false,
  mv: undefined, mvY0: 0, // the scroll move in progress, and where the page was when it began
  lastY: null,          // the scroll position the player last set (anything else moving the page is the reader)
  audioWanted: false, audioLive: false,
  ck: {a: -1, perf: 0, last: 0},
  c: {},                // what each component was last set to (cleared by every jump, so the next apply is cold)
  vs: new Map(),        // owned <video> -> {a, last, seekAt, bench, nudge, pf}
  raf: 0,
  stats: {frames: 0, clockMax: 0, glides: 0, pauses: [], tape: {}},
};

function setButton(s) {
  if (!btn) return;
  const L = C ? C.labels : LABELS, A = C ? C.aria : ARIA;
  btn.dataset.state = s; // a plain button whose label changes with it (no aria-pressed: WAI-ARIA APG)
  btn.setAttribute('aria-label', A[s] || ARIA[s]);
  if (label) label.textContent = L[s] || LABELS[s];
}
function progress(t) {
  const p = clamp01(t / (C ? C.D : 630.552));
  if (Math.abs(p - (st.p ?? -1)) < .0005 && p < 1) return;
  st.p = p;
  btn.style.setProperty('--play-p', p.toFixed(4));
}

/* ---------------- the clock: audio.currentTime, read every frame ---------------- */
// Chrome and Safari move currentTime on every frame; a browser that updates it more coarsely is carried forward by the
// frame clock, for at most one frame past its last change (so the page is never more than a frame off the audio). Small
// backward wobbles are held, so the page never ticks backward.
const FRAME = 1 / 60;
function clock(now) {
  const a = audio.currentTime, ck = st.ck;
  if (a !== ck.a) { if (ck.a >= 0 && !ck.moved) { ck.moved = true; st.liveAt = now; } ck.a = a; ck.perf = now; }
  let t = a;
  if (ck.moved && st.audioLive && !audio.paused && !audio.seeking) t += Math.min(FRAME, (now - ck.perf) / 1000) * (audio.playbackRate || 1);
  if (t < ck.last && ck.last - t <= FRAME) t = ck.last;
  ck.last = t;
  st.stats.frames++;
  st.stats.clockMax = Math.max(st.stats.clockMax, Math.abs(t - a));
  return t;
}
function resetClock(t) { st.ck = {a: -1, perf: 0, last: t, moved: false}; } // extrapolate only once the audio is seen moving
const END = () => Math.min(C.D, Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity) - .02;

/* ---------------- scroll ---------------- */
const moves = () => C.moves.filter(m => m.ok());
function lastMove(t) { let r = null; for (const m of C.moves) if (m.t0 <= t && m.ok()) r = m; return r; }
function restBefore(m) {
  const ms = moves(), i = ms.indexOf(m);
  return i > 0 ? restOf(ms[i - 1]) ?? 0 : 0;
}
// y(t) = y0 + (y1 - y0) * ease((t - t0) / (t1 - t0)), y0 = where the page was when the move began (never assumed),
// y1 = the rest, resolved every frame. Reduced motion: each move is a cut at its t1.
function targetY(t) {
  const m = lastMove(t);
  if (!m) return st.lastY ?? scrollY;
  if (st.mv !== m) { st.mv = m; st.mvY0 = scrollY; }
  const y1 = restOf(m);
  if (y1 == null) return st.lastY ?? scrollY;
  if (t >= m.t1 || m.t1 <= m.t0) return y1;
  const p = reduced() ? 0 : m.e((t - m.t0) / (m.t1 - m.t0));
  return st.mvY0 + (y1 - st.mvY0) * p;
}
function maxY() { return Math.max(0, (document.scrollingElement || root).scrollHeight - innerHeight); }
const docH = () => (document.scrollingElement || root).scrollHeight;
function setScroll(y) {
  y = clamp(y, 0, maxY());
  if (Math.abs(scrollY - y) >= .5) scrollTo({top: y, left: 0, behavior: 'instant'});
  st.lastY = scrollY;
  st.lastH = docH();
}
// Something other than the player moved the page (a scrollbar drag, momentum, find in page): the reader. Not when the
// page's own layout changed since the player last scrolled (the live market's data arriving above, an image): that
// shifts the scroll position without the reader, and the next frame follows the rest from the new layout.
function drifted() {
  if (docH() !== st.lastH) return false;
  const want = Math.min(st.lastY, maxY());
  return Math.abs(scrollY - want) > (C.rules.drift_px || 6);
}
function glideTo(y, {wait, t}) {
  const dy = y - scrollY, g = C.rules.glide, near = Math.abs(dy) <= g.near_vh * innerHeight;
  const [dur, e] = near ? g.near : g.far;
  st.glide = {from: scrollY, t0: performance.now(), dur: dur * 1000, ease: C.ease(e), wait, t};
  st.stats.glides++;
}

/* ---------------- videos: owned while the track holds them, lips on the mix ---------------- */
// Measured in Chrome: a clip playing at rate 1 holds its offset to the mix within 2 ms; a seek while playing lands about
// 50 ms late (LEAD); a clip told to play starts about 45 ms later (PRESTART). So each tape clip is aligned once (started
// early on its cue, or seeked with the lead) and then only nudged: a rate within 8 % of 1, with pitch preservation off
// (the clips are muted; with it on, every rate change costs Chrome ~20 ms), engaged past 12 ms of drift, released under 4.
// The audio clock itself stutters for a few frames as it starts, so once it has run steadily for 250 ms a clip still more
// than 35 ms off is aligned again with one seek.
// (Re)starts: a tape clip waits for the audio's own 'playing' (not the moment play() is called: the audio clock only moves
// 50-80 ms later), and for its first 1.5 s it is corrected harder (a rate within 25 % of 1). A hard seek leads by what
// this element's seeks have been taking (LEAD at least; a slow phone decoding from a far keyframe takes longer), and one
// that still lands off stops hard seeks on that clip for 1.5 s, while the rate closes the gap.
const LOOKAHEAD = 6, LEAD = .05, PRESTART = .045, TAPE_SEEK = .12, TAPE_ALIGN = .035, TAPE_ON = .012, TAPE_OFF = .004, TAPE_GAIN = 1.5, TAPE_MAX = .08;
const BOOST_MS = 1500, BOOST_GAIN = 4, BOOST_MAX = .25, LEAD_MAX = .6, BACKOFF_MS = 1500, SEEK_WAIT_MS = 250;
const still = a => a.p.mode === 'park' || a.p.mode === 'hold';
function pageTime(a, t) {
  const p = a.p;
  if (still(a)) return {pt: p.at, play: false};
  let pt = p.map[1] + (Math.max(t, a.t0) - p.map[0]) * (p.rate || 1);
  if (p.mode === 'loop' && p.wrap > 0) pt = ((pt % p.wrap) + p.wrap) % p.wrap;
  return {pt, play: true};
}
function driftOf(el, pt, a) {
  let d = el.currentTime - pt;
  const w = a.p.mode === 'loop' ? (a.p.wrap || el.duration) : 0;
  if (w > 0) d = ((d % w) + w * 1.5) % w - w / 2;
  return d;
}
// Every grid is a 3D stack (at every width): only its front clip runs; the ones behind wait on their frame.
function frontOf(el, memo) {
  const grid = el.closest('.stage-media--grid.is-stack');
  if (!grid) return null;
  if (!memo.has(grid)) { const g = SG().grid(grid.dataset.key); memo.set(grid, g && g.stacked ? g.videos[g.index] : null); }
  return memo.get(grid);
}
function pitchFree(el, s) {
  if (s.pf) return;
  s.pf = true;
  el.preservesPitch = false;
  if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = false;
}
// A hard seek on a playing clip, ahead by this element's own seek time (so it lands on the audio), timed for the next one.
function seekPlaying(el, s, a, h, pt, base) {
  const t0 = performance.now(), lead = s.lead ?? LEAD;
  s.seekAt = t0; s.last = t0; s.nudge = false;
  if (el.playbackRate !== base) el.playbackRate = base;
  h.at(pt + lead * base, {play: true, rate: base, tolerance: 0}).then(() => {
    if (st.vs.get(el) !== s) return;
    const took = (performance.now() - t0) / 1000;
    s.lead = clamp(s.lead == null ? Math.max(LEAD, took) : s.lead * .6 + took * .4, LEAD, LEAD_MAX);
    if (!a.p.tape || st.state !== 'playing' || audio.paused || !st.audioLive || s.a !== a) return;
    const d = driftOf(el, pageTime(a, audio.currentTime).pt, a);
    if (Math.abs(d) > TAPE_SEEK) s.noSeekUntil = performance.now() + BACKOFF_MS; // landed off again: let the rate do it
  }, () => {});
}
function cancelPre() { for (const s of st.vs.values()) if (s.pre) { clearTimeout(s.pre); s.pre = 0; } }
function syncVideos(t, now, {cold = false, hold = false} = {}) {
  const sg = SG(), want = new Map();
  // the ones the track holds at t, and the ones it takes within the next few seconds (parked early, so they are buffered
  // and on their first frame when their stage comes up)
  for (const a of C.videos) {
    if (!a.ok() || a.t1 <= t || a.t0 > t + LOOKAHEAD) continue;
    const el = elOf(a); if (!el) continue;
    const live = a.t0 <= t;
    if (live || !want.has(el)) want.set(el, {a, live});
  }
  for (const [el] of st.vs) if (!want.has(el)) release(el);
  // the audio is on its way (play() called on buffered audio, not yet sounding): clips start with it, not after it; audio
  // that still has to buffer holds them until it actually plays (the 'playing' event syncs them at once)
  // (tape clips wait for the audio's own 'playing': their lips must not run ahead of it)
  const starting = st.audioWanted && !st.audioLive && st.startReady && now - st.startedAt < 500;
  const halted = !st.audioWanted || audio.paused || audio.seeking;
  const stalled = halted || (!st.audioLive && !starting), tapeStalled = halted || !st.audioLive;
  const base = audio.playbackRate || 1, memo = new Map(), frameDt = st.frameDt || FRAME;
  for (const [el, {a, live}] of want) {
    let s = st.vs.get(el);
    const fresh = cold || !s || s.a !== a;
    if (!s) st.vs.set(el, s = {a, last: -1e9, seekAt: -1e9, bench: false, nudge: false});
    s.a = a;
    const h = sg.video(el);
    let {pt, play} = pageTime(a, live ? t : a.t0);
    if (!live || hold || (a.p.tape ? tapeStalled : stalled)) play = false;
    const front = frontOf(el, memo);
    if (front && front !== el) { // behind the front clip: paused where it is
      if (fresh || !s.bench || !el.paused) h.at(fresh ? pt : el.currentTime, {play: false, tolerance: fresh ? .02 : 1e9});
      s.bench = true;
      continue;
    }
    const unbenched = s.bench; s.bench = false;
    if (!play) {
      // parked on the frame the next action starts from (its own park, or the lookahead's): started a moment early, so it
      // is moving on the cue
      // (checked a frame ahead, and timed to PRESTART before the cue wherever the frame tick falls)
      const nx = live ? (still(a) ? C.next.get(a) : null) : a;
      if (!hold && !stalled && st.audioLive && nx && !still(nx) && nx.t0 - t <= PRESTART + frameDt && Math.abs(pageTime(nx, nx.t0).pt - pt) < .03) {
        if (el.paused && !s.pre) {
          if (nx.p.tape) pitchFree(el, s);
          const go = () => {
            s.pre = 0;
            if (st.vs.get(el) !== s || st.state !== 'playing' || audio.paused || !el.paused) return;
            s.seekAt = performance.now(); h.at(pt, {play: true, rate: base, tolerance: .03});
          };
          const wait = (nx.t0 - t - PRESTART) * 1000 / base;
          if (wait < 4) go(); else s.pre = setTimeout(go, wait);
        }
        continue;
      }
      if (fresh || unbenched || !el.paused || now - s.last >= 250) { s.last = now; s.nudge = false; if (el.playbackRate !== 1) el.playbackRate = 1; h.at(pt, {play: false}); }
      continue;
    }
    if (el.seeking) continue;
    const tape = !!a.p.tape, d = driftOf(el, pt, a), hard = tape ? TAPE_SEEK : (C.rules.video_drift_s || .15);
    if (tape) pitchFree(el, s);
    const backoff = tape && !fresh && !unbenched && !el.paused && now < (s.noSeekUntil || 0);
    if (fresh || unbenched || el.paused || (Math.abs(d) > hard && !backoff)) {
      if (!fresh && !unbenched && !el.paused && now - s.seekAt < 400) continue; // let the last seek land first
      if (Math.abs(d) > (tape ? .04 : hard)) { seekPlaying(el, s, a, h, pt, base); continue; }
      s.seekAt = now; s.last = now; s.nudge = false;
      h.at(pt, {play: true, rate: base, tolerance: 1e9});
      continue;
    }
    if (tape) {
      if (!st.audioLive) continue;
      const ad = Math.abs(d), boost = backoff || now - Math.max(s.seekAt, st.liveAt || 0) < BOOST_MS;
      if (!backoff && ad > TAPE_ALIGN && st.ck.moved && now - st.liveAt > 250 && now - s.seekAt > 1000) { seekPlaying(el, s, a, h, pt, base); continue; }
      if (!s.nudge && ad > TAPE_ON) s.nudge = true; else if (s.nudge && ad < TAPE_OFF) s.nudge = false;
      const g = boost ? BOOST_GAIN : TAPE_GAIN, cap = boost ? BOOST_MAX : TAPE_MAX;
      const r = s.nudge ? Math.round(base * (1 - clamp(d * g, -cap, cap)) * 200) / 200 : base;
      if (r !== el.playbackRate) el.playbackRate = r;
      // (counted once the start-up alignment has had its chance: 0.6 s after the audio is seen moving)
      if (now - s.seekAt > 300 && now - st.liveAt > 600) {
        const k = st.stats.tape[a.id] || (st.stats.tape[a.id] = {n: 0, sum: 0, max: 0, at: 0, over: 0});
        k.n++; k.sum += ad; if (ad > k.max) { k.max = ad; k.at = +t.toFixed(3); } if (ad > 1 / 30) k.over++;
      }
    } else if (now - s.last >= (C.rules.video_check_ms || 250)) {
      s.last = now;
      h.at(pt, {play: true, rate: base});
    }
  }
}
function release(el) {
  const s = st.vs.get(el);
  if (s && s.pre) clearTimeout(s.pre);
  st.vs.delete(el);
  unrate(el, s);
  try { SG().video(el).release(); } catch {}
}
function unrate(el, s) {
  if (el.playbackRate !== 1) el.playbackRate = 1;
  if (s && s.pf) { el.preservesPitch = true; if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = true; }
}

/* ---------------- components: each one a pure function of t, set only when it changes ---------------- */
function apply(t, {cold = false} = {}) {
  const sg = SG(), c = st.c, rmo = reduced();
  const once = (k, v, f) => { const j = JSON.stringify(v); if (!cold && c[k] === j) return; c[k] = j; try { f(v); } catch (e) { warn(k, e); } };

  // draw-ons (reel numerals, the Tako drawings, the comment thread): ms(t) through the keys; 0 before, drawn after
  for (const a of C.reveals) {
    if (!a.ok()) continue;
    const k = a.p.keys, first = k[0][0], last = k[k.length - 1][0];
    const v = t < first ? 0 : t >= last || rmo ? 'end' : Math.round(keyAt(k, t, 'linear') * 10) / 10;
    once('rv:' + a.id, v, v => sg.reveal(elOf(a), v));
  }
  // the market: the draw-on and the dot (before the story reaches it, the chart is the page's own)
  const md = lastOf(C.marketDraw, t);
  if (md) {
    once('mk:period', 168, () => sg.market.period(168));
    const k = md.p.keys, v = rmo ? (t >= k[0][0] ? k[k.length - 1][1] : k[0][1]) : keyAt(k, t, md.p.ease);
    once('mk:draw', Math.round(v * 1e4) / 1e4, v => sg.market.draw(v));
  }
  const mi = lastOf(C.marketInspect, t);
  if (mi) {
    const k = mi.p.keys.map(([kt, v, e]) => [kt, chartIndex(v), e]), v = t >= k[k.length - 1][0] ? null : Math.round(keyAt(k, t, mi.p.ease));
    once('mk:inspect', v, v => sg.market.inspect(v));
  }
  // the coin pile: k(t) coins on, each one's drop where it would be; the selected coin
  if (C.pile && C.pile.ok()) {
    const k = stepAt(C.pile.p.keys, t, 0);
    once('pile', k, () => sg.pile.at(t, C.pile.p.keys));
  }
  if (C.pileSelect.length) { const a = lastOf(C.pileSelect, t); once('pile:sel', a ? a.p.index : null, v => sg.pile.select(v)); }
  // the swap line (the page's own position until the story reaches it)
  if (C.slider && C.slider.ok() && t >= C.slider.p.keys[0][0]) {
    once('swap', Math.round(keyAt(C.slider.p.keys, t, 'linear') * 100) / 100, v => sg.swap.setPos(v));
  }
  // the grids: the stack's front clip, the heard one (index 0 before the story gets there)
  for (const key of ['own', 'everywhere']) {
    const a = lastOf(C.grids, t, x => x.p.key === key), i = a ? a.p.index : 0;
    once('grid:' + key, i, i => {
      const g = sg.grid(key); if (!g) return;
      const live = !cold && a && t - a.t0 < .5;
      g.front(i, {instant: !live}); // every grid is a stack (stacked is always true)
    });
  }
  monster(t, cold, rmo);
  headless(t, cold, rmo);
  // the comment wall: reset, then every filter, hover and click up to t, in order (each one deterministic)
  if (C.wall.length) {
    let s = null;
    for (const a of C.wall) {
      if (a.t0 > t) break;
      const p = a.p;
      if (a.type === 'wall') s = {lens: p.lens || 'x', filter: p.filter || 'all', show: p.show ?? null, zero: false, id: a.id};
      else if (!s) continue;
      else if (p.op === 'zero') s = {...s, filter: 'p', zero: true, show: null, id: a.id};
      else if (p.op === 'filter') s = {...s, filter: p.filter, show: p.show ?? null, zero: false, id: a.id};
      else s = {...s, show: p.show ?? null, id: a.id};
    }
    once('wall', s ? s.id : 'reset', () => {
      const W = sg.wall; if (!W) return;
      if (!s || cold) W.reset();
      if (!s) return;
      W.lens(s.lens);
      if (s.zero) W.zero(); else W.filter(s.filter, {show: s.show});
    });
  }
  // the fork: each path and label on its own words
  if (C.paths && C.paths.ok()) {
    const v = {};
    for (const [k, [a, b, from, to, e]] of Object.entries(C.paths.p.parts)) {
      const q = rmo ? (t >= a ? 1 : 0) : C.ease(e)(clamp01((t - a) / Math.max(1e-6, b - a)));
      v[k] = Math.round((from + (to - from) * q) * 1e4) / 1e4;
    }
    once('paths', v, v => sg.paths.set(v));
  }
  hat(t, cold, rmo);
  // the playing cards: the turn scrubbed along its own seven animations; face down before, face up after
  for (const a of C.cards) {
    const x = rmo ? (t >= a.t0 ? 1 : 0) : clamp01((t - a.t0) / ((a.p.ms || 1250) / 1000));
    const deck = elOf(a)?.closest('.tarot');
    once('card:' + a.p.color, Math.round(x * 1e4) / 1e4, x => deck?.__cards?.set(a.p.color, x));
  }
  // the track's flags (the swap's hint sweep, the reprise's own laugh): off from their cue (play mode implies them too)
  for (const a of C.flags) if (t >= a.t0) once('flag:' + a.id, 1, () => a.type === 'swapMode' ? sg.swap?.noHint(!!a.p.noHint) : sg.reprise?.noAuto(!!a.p.noAuto));
}

// The monster: frozen and set every frame through its keys (0 faces the camera), with the sway after the last key;
// handed back to its own idle loop once the page has left it.
const MONSTER_TAIL = 1;
function yawAt(keys, x) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (x < keys[i][0]) {
    const [ta, ya] = keys[i - 1], [tb, yb, e] = keys[i];
    return e === 'hold' ? ya : ya + (yb - ya) * C.ease(e)((x - ta) / (tb - ta));
  }
  const last = keys[keys.length - 1], sw = last[3];
  return last[1] + (sw ? sw.amp * Math.sin(2 * Math.PI * (x - last[0]) / sw.period) : 0);
}
function monster(t, cold, rmo) {
  const a = C.monster; if (!a) return;
  const m = elOf(a)?.__monster; if (!m) return;
  const k = a.p.keys, inside = t >= a.t0 && t < a.t1 + MONSTER_TAIL;
  if (!inside) { if (st.c.monster || cold) { st.c.monster = false; m.freeze(false); } return; }
  if (!st.c.monster || cold) { st.c.monster = true; m.freeze(true); }
  if (rmo) return void m.set({yaw: 0, vel: 0, t});
  const yaw = yawAt(k, t), vel = (yawAt(k, t + 1 / 120) - yawAt(k, t - 1 / 120)) * 60;
  m.set({yaw, vel, t});
}
// The copy machine: a fresh seeded scene at its reset, stepped on its 1/60 s grid from the audio clock, with the viral
// card and every pop applied at its own frame. Resuming inside rebuilds it (reset + the events up to t). Reduced motion:
// left still, with its copies out.
function headless(t, cold, rmo) {
  const H = window.__headless, r = C.hlReset, run = C.hlRun;
  if (!H || !r || rmo || t < r.t0) return;
  const c = st.c;
  if (cold || !c.hl || t < c.hl.t) { H.reset(r.p.seed); H.auto(false); c.hl = {done: 0, t}; }
  const t0 = run ? run.p.t0 : r.t0;
  const ev = C.hlEvents;
  while (c.hl.done < ev.length && ev[c.hl.done].t0 <= t) {
    const e = ev[c.hl.done++];
    if (e.t0 < r.t0) continue;
    H.stepTo(Math.max(0, e.t0 - t0));
    if (e.p.op === 'viral') H.viral(); else H.popOldest();
  }
  if (run && t >= run.t0 && t <= run.t1 + .5) H.stepTo(t - t0);
  c.hl.t = t;
}
// The hat: runs on its own clock from the story's t (hatT = t - t0), nudged back only if it strays by more than a frame.
function hat(t, cold, rmo) {
  const a = C.hat; if (!a) return;
  const h = elOf(a)?.__hat; if (!h) return;
  if (t < a.t0 || t > a.t1 + 1) { if (cold) st.c.hat = false; return; }
  if (rmo) { if (!st.c.hat || cold) { st.c.hat = true; h.setT(99); } return; }
  const T = t - a.p.t0;
  if (!st.c.hat || cold || Math.abs(h.t - T) > .034) { st.c.hat = true; h.setT(T); }
}
// After a beat lands, its stage figure: the page's own observer switches it within a few ms; this only steps in if it
// hasn't (or on a cold start, with the crossfade placed where it would be).
function stage(t, cold) {
  let m = null;
  for (const x of C.moves) if (x.a.type === 'advanceBeat' && x.a.show && x.t1 <= t && x.ok()) m = x;
  const cur = lastMove(t), after = (C.rules.activate_after_ms || 80) / 1000;
  if (!m || !cur || cur.s !== m.s) return;
  // A later move is still travelling (or has only just landed): the page's own beat observer is switching the figure
  // for it; stepping back to the landed beat's figure here would flicker (new, old, new).
  if (!cold && cur !== m && t < cur.t1 + after) return;
  if (!cold && t < m.t1 + after) return;
  const sec = sectionOf(m.s), on = sec && sec.querySelector('.stage .stage-media.is-active');
  if (!sec || (on && on.dataset.key === m.a.show)) return;
  SG().activate(sec, m.a.show, cold ? {ago: Math.max(0, t - m.t1)} : {});
}
function warn(k, e) { if (!st.warned) { st.warned = 1; console.warn('[play]', k, e); } }

/* ---------------- run, pause, resume, end ---------------- */
function schedule() { if (!st.raf) st.raf = requestAnimationFrame(tick); }
function tick() {
  st.raf = 0;
  if (st.state !== 'playing') return;
  schedule();
  const now = performance.now(), g = st.glide;
  if (st.tickAt) st.frameDt = clamp((st.frameDt || FRAME) * .8 + clamp((now - st.tickAt) / 1000, .004, .05) * .2, .004, .05);
  st.tickAt = now;
  if (st.lastY != null && drifted()) return pause('scroll');
  let t;
  if (st.phase === 'glide' && g && g.wait) t = g.t;
  else {
    t = clock(now);
    apply(t);
    stage(t, false);
    syncVideos(t, now);
  }
  let y = targetY(t);
  if (g) {
    const p = Math.min(1, (now - g.t0) / g.dur);
    y = g.from + (y - g.from) * g.ease(p);
    if (p >= 1) { st.glide = null; if (st.phase === 'glide') { st.phase = 'run'; startWhenParked(); } }
  }
  setScroll(y);
  progress(t);
  if (st.phase === 'run' && t >= END()) finish();
}
// After a jump, the clips parked on their frames may still be seeking there: the audio waits for them (at most 250 ms),
// so a clip's lips never start behind it. (A press that must start the audio inside it doesn't wait.)
function startWhenParked() {
  const token = st.startToken = (st.startToken || 0) + 1;
  const pend = [...st.vs.keys()].filter(v => v.seeking);
  if (!pend.length) return startAudio();
  st.audioWanted = false;
  const landed = Promise.all(pend.map(v => new Promise(r => { v.addEventListener('seeked', r, {once: true}); v.addEventListener('emptied', r, {once: true}); })));
  Promise.race([landed, new Promise(r => setTimeout(r, SEEK_WAIT_MS))]).then(() => {
    if (st.startToken === token && st.state === 'playing' && st.phase === 'run' && audio.paused) startAudio();
  });
}
function startAudio() {
  st.startToken = (st.startToken || 0) + 1;
  st.audioWanted = true;
  st.startedAt = performance.now();
  st.startReady = audio.readyState >= 3;
  resetClock(audio.currentTime);
  const p = audio.play();
  syncVideos(audio.currentTime, st.startedAt); // every clip that should be moving starts with the audio, not after it
  if (p) p.catch(err => {
    if (!st.audioWanted || st.state !== 'playing') return;
    if (err && err.name === 'AbortError') return;
    console.warn('[play] the audio would not start:', err && err.name);
    if (err && err.name === 'NotAllowedError') st.needGesture = true; // next press: the audio starts inside it
    pause(err && err.name === 'NotAllowedError' ? 'blocked' : 'error');
  });
}
function enterPlay() {
  const sg = SG();
  if (st.state !== 'playing') { st.state = 'playing'; setButton('playing'); }
  if (sg.mode() !== 'play') sg.mode('play'); // page sound off, Autoplay on, one-shots off, the hat and copy machine told
  root.classList.remove('snap');              // the player owns the scroll while the story plays
  root.style.overflowAnchor = 'none';         // nothing moves the page under it (layout shifts are followed instead)
  snapHold(false);
  session('play');
}
// Paused between two rests (a scroll move or a glide under way), the page is off every snap point: html.snap coming back
// would jump it to the next one at once. Snapping stays off (an inline style, so main.js's class can't re-snap it) until
// the reader's own next scroll input, whose scroll it then joins. (Not the pausing event itself: a listener added while
// an event is dispatched isn't called for it. Nor a tap: a touch pause's own touchstart must not re-snap.)
let snapBack = null;
function snapHold(on) {
  const EV = ['wheel', 'touchmove', 'keydown'];
  if (snapBack) { EV.forEach(ty => removeEventListener(ty, snapBack, true)); snapBack = null; }
  root.style.scrollSnapType = on ? 'none' : '';
  if (!on) return;
  snapBack = e => {
    if (e.type === 'keydown' && (MODS.has(e.key) || (onPlay(e) && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')))) return;
    snapHold(false);
  };
  EV.forEach(ty => addEventListener(ty, snapBack, {capture: true, passive: true}));
}
function leavePlay() {
  const between = !!st.glide || (!!st.mv && !reduced() && audio.currentTime < st.mv.t1 && audio.currentTime >= st.mv.t0 - .05);
  cancelAnimationFrame(st.raf); st.raf = 0;
  cancelPre();
  st.phase = null; st.glide = null; st.lastY = null; st.audioWanted = false; st.startToken = (st.startToken || 0) + 1; st.tickAt = 0;
  for (const [el, s] of st.vs) unrate(el, s);
  st.vs.clear();
  if (between) snapHold(true);
  const sg = SG();
  if (sg && sg.mode() === 'play') sg.mode('reader'); // every owned video, reveal and flag back to the page, snap and sound too
  root.style.overflowAnchor = '';
}
// A cold start at t: every component set to its state at t (the choreography's state contract), the videos parked on
// their frames, the scroll move in progress picked up where the story has it.
// glide: the page travels back first and the audio waits for it ({wait: false}: they start together).
function jump(t, {glide = true, wait = true, now: inPress = false} = {}) {
  enterPlay();
  cancelPre();
  st.audioWanted = false;
  if (!audio.paused) audio.pause();
  seekAudio(t);
  st.c = {}; st.mv = undefined;
  const now = performance.now();
  apply(t, {cold: true});
  syncVideos(t, now, {cold: true, hold: true});
  const m = lastMove(t);
  st.mv = m || undefined; st.mvY0 = m ? restBefore(m) : 0;
  stage(t, true);
  const y = targetY(t);
  st.lastY = null; // (the reader's own scroll may still be settling: the drift check starts from the player's first scroll)
  if (glide && wait && !reduced() && !document.hidden && Math.abs(y - scrollY) > 2) { st.phase = 'glide'; glideTo(y, {wait: true, t}); }
  else {
    st.phase = 'run';
    if (glide && !reduced() && !document.hidden && Math.abs(y - scrollY) > 2) glideTo(y, {wait: false}); else setScroll(y);
    if (inPress) startAudio(); else startWhenParked();
  }
  progress(t);
  schedule();
}
function seekAudio(t) {
  t = clamp(t, 0, C.D);
  try { audio.currentTime = t; } catch {}
  resetClock(t);
  st.audioLive = false;
  msPosition(); // the lock screen's scrubber follows
}
// The first press: from the top, or (deeper in the page) from the unit whose section is centred, so a reader at Reel III
// hears Reel III. The audio starts inside the press; the unit's own scroll move carries the page from where it is.
function firstT() {
  const vh = innerHeight;
  if (scrollY < vh * (C.rules.first_press_top_vh ?? 1)) return 0;
  let sec = null;
  for (const s of document.querySelectorAll('main section[data-frame]')) {
    const r = s.getBoundingClientRect();
    if (r.top <= vh / 2 && r.bottom > vh / 2) { sec = s; break; }
  }
  const us = C.units.filter(u => u.ok() && sec && u.s === sec.dataset.frame);
  if (!us.length) return 0; // the credits, the garden card, the notes: the story from its start
  let best = us[0], bd = Infinity;
  for (const u of us) { const y = restOf(u), d = Math.abs((y ?? 0) - scrollY); if (d < bd) { bd = d; best = u; } }
  return best.t;
}
function start(t) {
  enterPlay();
  cancelPre();
  audio.preload = 'auto';
  seekAudio(t);
  st.c = {}; st.mv = undefined; st.lastY = null; // the drift check starts from the player's first scroll
  apply(t, {cold: true});
  syncVideos(t, performance.now(), {cold: true, hold: true});
  stage(t, true);
  st.phase = 'run';
  // At the top, the page settles onto the cold open under the music intro (0.35-2.02 s is music only).
  const y = targetY(t);
  if (t === 0 && !reduced() && Math.abs(y - scrollY) > 2) glideTo(y, {wait: false});
  startAudio();
  progress(t);
  schedule();
}
// Resume rule: back to the start of the sentence that was cut off if it began within 2.5 s of the pause, else the pause.
function resumeT(tp) {
  if (st.exact) return tp;
  for (const [s, e] of C.sentences) {
    if (s > tp) break;
    if (tp < e) return tp - s <= (C.rules.resume_back_s ?? 2.5) ? s : tp;
  }
  return tp;
}
function resume() {
  const t = resumeT(st.pausedAt);
  st.exact = false;
  // A browser that would not let the audio start outside a press gets it inside this one (the page glides meanwhile).
  if (st.needGesture) { st.needGesture = false; jump(t, {wait: false, now: true}); return; }
  jump(t, {glide: true});
}
function pause(why) {
  if (st.state === 'loading') { st.state = 'idle'; st.pendingSeek = null; setButton('idle'); return; }
  if (st.state !== 'playing') return;
  st.pausedAt = st.phase === 'glide' && st.glide && st.glide.wait ? st.glide.t : audio.currentTime;
  st.state = 'paused';
  st.audioWanted = false;
  audio.pause();
  st.stats.pauses.push([why, Math.round(st.pausedAt * 100) / 100]);
  leavePlay();
  setButton('paused');
  session('paused');
}
function finish() {
  st.state = 'ended';
  st.audioWanted = false;
  audio.pause();
  leavePlay();
  setButton('ended');
  progress(C.D);
  session('ended');
}
// The Play control. Every path that can start the audio does it inside this press.
function press() {
  const sg = SG();
  if (!sg || sg.mode() === 'render') return;
  switch (st.state) {
    case 'playing': return pause('button');
    case 'loading': return pause('button');
    case 'paused': return resume();
    case 'ended': return jump(0, {glide: true});
  }
  if (C) return start(firstT());
  // The track isn't here yet: the audio is started and stopped inside the press (so a strict browser lets it play later),
  // and the story starts the moment the track arrives.
  try { const p = audio.play(); audio.pause(); p?.catch(() => {}); } catch {}
  st.state = 'loading'; setButton('playing'); st.pendingSeek = null;
  // (a seek made meanwhile, from the lock screen or a media key, is where the story starts: the page travels there the
  // way it does for a seek while playing)
  load().then(() => {
    if (st.state !== 'loading') return;
    const p = st.pendingSeek; st.state = 'idle'; st.pendingSeek = null;
    if (p == null) return start(firstT());
    audio.preload = 'auto';
    jump(clamp(p, 0, END()), {glide: !document.hidden});
  },
    err => { console.warn('[play]', err); if (st.state === 'loading') { st.state = 'idle'; st.pendingSeek = null; setButton('idle'); } });
}
function seekTo(t) {
  if (st.state === 'loading') { if (Number.isFinite(t)) st.pendingSeek = Math.max(0, t); return; } // kept until the track arrives
  if (!C) return;
  t = clamp(t, 0, END());
  if (st.state === 'playing') return jump(t, {glide: !document.hidden});
  if (st.state === 'paused') { st.pausedAt = t; st.exact = true; seekAudio(t); progress(t); session('paused'); }
}

/* ---------------- reader interaction pauses the story ---------------- */
const MODS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol', 'SymbolLock', 'NumLock', 'ScrollLock']);
const MEDIA_KEYS = /^(Media|AudioVolume)/;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const onPlay = e => e.target instanceof Element && !!e.target.closest('#play-toggle');
let touch0 = null;
function interact(e) {
  if (!e.isTrusted || (st.state !== 'playing' && st.state !== 'loading')) return;
  switch (e.type) {
    case 'keydown':
      if (MODS.has(e.key) || MEDIA_KEYS.test(e.key)) return;
      if (onPlay(e) && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) return; // the control's own press
      if ((e.metaKey || e.ctrlKey) && !SCROLL_KEYS.has(e.key)) return;                   // browser shortcuts
      return pause('key ' + e.key);
    case 'touchstart':
      if (onPlay(e)) { const p = e.touches[0]; touch0 = p ? [p.clientX, p.clientY] : null; return; }
      touch0 = null; return pause('touch');
    case 'touchmove':
      if (onPlay(e) && touch0) { const p = e.touches[0]; if (!p || Math.hypot(p.clientX - touch0[0], p.clientY - touch0[1]) < 12) return; }
      return pause('touch');
    case 'pointerdown': case 'click':
      if (onPlay(e)) return;
      return pause(e.type);
    default: // wheel (even over the control: it scrolls the page)
      return pause(e.type);
  }
}
for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'click', 'keydown']) addEventListener(type, interact, {capture: true, passive: true});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (st.state === 'playing' || st.state === 'loading') pause('hidden'); return; }
  // Back from the lock screen with the story still playing (resumed from the media controls): the page catches up.
  if (st.state === 'playing' && st.phase === 'run') {
    const t = audio.currentTime;
    st.c = {}; apply(t, {cold: true}); syncVideos(t, performance.now(), {cold: true});
    const m = lastMove(t); st.mv = m || undefined; st.mvY0 = m ? restBefore(m) : 0;
    stage(t, true);
    st.lastY = null;
    if (!reduced()) glideTo(targetY(t), {wait: false});
    schedule();
  }
});

/* ---------------- the audio's own events ---------------- */
if (audio) {
  audio.addEventListener('playing', () => {
    st.audioLive = true;
    resetClock(audio.currentTime);
    if (st.state === 'playing' && st.phase === 'run' && C) {
      syncVideos(audio.currentTime, performance.now()); // clips move now, not a frame later
      msPosition(); // the lock screen's scrubber runs from where the audio actually starts
    }
  });
  audio.addEventListener('waiting', () => { st.audioLive = false; });
  audio.addEventListener('seeking', () => { st.audioLive = false; });
  audio.addEventListener('ended', () => { if (st.state === 'playing') finish(); });
  audio.addEventListener('error', () => { console.warn('[play] the mix failed to load'); if (st.state === 'playing' || st.state === 'loading') pause('error'); });
  // Paused by something else (an OS interruption, headphones pulled): the story pauses with it.
  audio.addEventListener('pause', () => {
    if (st.state !== 'playing' || !st.audioWanted || !audio.paused) return; // (a pause of ours can land after a restart)
    if (audio.ended) finish(); else pause('audio');
  });
  // Played by something else while the story is not playing: not ours to start; the Play control is.
  audio.addEventListener('play', () => { if (!st.audioWanted) audio.pause(); });
}

/* ---------------- Media Session: the lock screen and media keys ---------------- */
// While the story plays, play/pause/seek point at it. On a pause, main.js's own handlers come back (__sg.mode('reader')
// reinstalls them), and "play" from the lock screen resumes the story unless a page clip is actually sounding (or the
// lock screen's own pause just stopped one, which its play then resumes). End: main.js's handlers only.
const MS = 'mediaSession' in navigator ? navigator.mediaSession : null;
const pageHandlers = {};
let msRaw = null;
function wrapSession() {
  if (!MS || msRaw) return;
  msRaw = MS.setActionHandler.bind(MS);
  // main.js (re)installs its handlers on every return to reader mode: remember them, so the story can hand back to them.
  MS.setActionHandler = (action, fn) => { pageHandlers[action] = fn; return msRaw(action, fn); };
}
const ours = {};
function msSet(action, fn) { ours[action] = fn; try { msRaw(action, fn); } catch {} }
const pageAudible = () => [...document.querySelectorAll('video')].some(v => !v.paused && !v.muted);
let msPausedPage = false;
function session(s) {
  if (!MS) return;
  wrapSession();
  try {
    if (s === 'play') {
      if (!MS.metadata && typeof MediaMetadata === 'function') {
        MS.metadata = new MediaMetadata({title: 'Who is Jean Phil?', artist: 'Snakes & Gardens', album: 'Narrated',
          artwork: [{src: new URL('assets/brand/og.jpg', location.href).href, sizes: '1200x630', type: 'image/jpeg'}]});
      }
      msSet('play', () => press());
      msSet('pause', () => pause('session'));
      msSet('stop', () => pause('session'));
      msSet('seekto', d => seekTo(d.seekTime));
      msSet('seekbackward', d => seekTo(audio.currentTime - (d.seekOffset || 10)));
      msSet('seekforward', d => seekTo(audio.currentTime + (d.seekOffset || 10)));
      MS.playbackState = 'playing';
    } else if (s === 'paused') {
      msPausedPage = false;
      msSet('play', () => { if (st.state === 'paused' && !msPausedPage && !pageAudible()) press(); else { msPausedPage = false; pageHandlers.play?.(); } });
      msSet('pause', () => { msPausedPage = pageAudible(); pageHandlers.pause?.(); });
      msSet('stop', null);
      MS.playbackState = 'paused';
    } else {
      msSet('play', pageHandlers.play || null);
      msSet('pause', pageHandlers.pause || null);
      for (const a of ['stop', 'seekto', 'seekbackward', 'seekforward']) msSet(a, null);
      MS.metadata = null;
      MS.playbackState = 'none';
    }
    if (s !== 'ended') msPosition();
  } catch {}
}
function msPosition() {
  try { if (MS && MS.setPositionState && C) MS.setPositionState({duration: C.D, playbackRate: audio.playbackRate || 1, position: clamp(audio.currentTime, 0, C.D)}); } catch {}
}

/* ---------------- wiring ---------------- */
if (btn && audio) {
  // Intent: a pointer over the control or keyboard focus fetches the track (34 KB); a press on it lets the mix buffer.
  const warm = () => { load().catch(() => {}); };
  const buffer = () => { warm(); if (audio.preload !== 'auto') audio.preload = 'auto'; };
  for (const type of ['pointerenter', 'focus']) btn.addEventListener(type, warm, {passive: true});
  for (const type of ['pointerdown', 'touchstart']) btn.addEventListener(type, buffer, {passive: true});
  btn.addEventListener('click', press);
  // A read-only view for tests and debugging (never needed by the page).
  window.__sgPlay = {
    version: 1,
    get t() { return audio.currentTime; },
    state: () => ({state: st.state, phase: st.phase, t: audio.currentTime, pausedAt: st.pausedAt, glide: !!st.glide, lastY: st.lastY, scrollY,
      target: C && st.state === 'playing' ? restOf(st.mv || {}) : null, move: st.mv ? st.mv.a.id : null, owned: [...st.vs.keys()].map(v => (v.currentSrc || '').split('/').pop()),
      audio: {paused: audio.paused, rate: audio.playbackRate, live: st.audioLive}, stats: st.stats}),
    seek: t => seekTo(Number(t)),
    rest: () => (C && st.mv ? restOf(st.mv) : null),
    storyY: t => { if (!C) return null; const m = lastMove(t); if (!m) return 0; const y1 = restOf(m); if (t >= m.t1) return y1; const y0 = restBefore(m); return y0 + (y1 - y0) * m.e((t - m.t0) / (m.t1 - m.t0)); },
    pageTime: (id, t) => { const a = C && C.track.find(x => x.id === id); return a ? pageTime(a, t).pt : null; },
    // fires the Media Session action the story has installed (what the lock screen or a media key would do)
    sessionAction: (name, details = {}) => { const f = ours[name]; if (typeof f !== 'function') return false; f({action: name, ...details}); return true; },
  };
}
