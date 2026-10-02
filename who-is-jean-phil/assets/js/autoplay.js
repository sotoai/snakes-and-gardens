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
// The ending runs past the mix (Josh, Sept 30: "Ending video, let it run to the end"): the laugh reprise plays on, muted,
// to the last frame of its file (633.12 on the story clock; the mix ends at 630.55), and only then does the page move to
// the credits. Past the audio's end the story clock is the frame clock, carried on from where the audio stopped ("the
// tail"), up to the track's own 'end' action.
// A pause is silent: the gesture that paused the story is not a tap for page sound, and page sound stays off until the
// reader's next tap or key (main.js). A pause in the middle of a scroll move leaves the page exactly where it is: snap
// comes back with the reader's own next scroll.
//
// Reader mode (Play never pressed) is untouched: until the first press this module only listens, and every listener
// returns at once. Nothing ever starts on its own. (On a phone-class WebKit, WK below, it also reads its learned start lead
// from localStorage and times requestAnimationFrame from the moment it runs to 1.7 s after the page's load event (again on
// coming back to the tab or after a pause, only if that gave no reading): the next press's evidence of Low Power Mode.
// Nothing on the page changes.)

import {selectPeriod} from './market-data.mjs';

const DATA = 'assets/data/choreography-play.json', SNAPSHOT = 'assets/data/market-snapshot.json';
const btn = document.getElementById('play-toggle');
const audio = document.getElementById('sg-audio');
const root = document.documentElement;
const label = btn && btn.querySelector('.label');
// Other Play controls (the cover card's): the same press and the same state; their idle label is their own.
const extra = [...document.querySelectorAll('[data-sg-play]')];
const rm = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => rm.matches;
const LABELS = {idle: 'Play', playing: 'Pause', paused: 'Play', ended: 'Replay'};
const ARIA = {idle: 'Play the story with narration', playing: 'Pause', paused: 'Play the story with narration', ended: 'Replay the story with narration'};
const SG = () => window.__sg;
// (iPhone fixes, Sept 30) A touch device: (pointer: coarse), or a touch seen on the page (a touch screen whose media
// queries say otherwise). WebKit (Safari, and every browser on iOS): GestureEvent is WebKit's own.
const coarse = matchMedia('(pointer: coarse)');
let touched = false;
const touchy = () => touched || coarse.matches;
const WEBKIT = 'GestureEvent' in window;
// (iPhone stutter fix, Oct 1) WK: the WebKit clip driver (see "videos", below), on a phone-class WebKit: iOS (every browser
// there is WebKit), or an iPad presenting a desktop UA (its pointer is still coarse). Desktop Safari keeps the old driver:
// the new one was measured on iOS only, and its cues rest on stills. ?wk=0: the old driver on a phone (A/B); ?wk=1: the
// WebKit driver in any browser (its logic can then be tested in headless Chrome).
const WKQ = new URLSearchParams(location.search).get('wk');
const WK_PHONE = WEBKIT && (coarse.matches || navigator.maxTouchPoints > 1 || /iP(hone|ad|od)/.test(navigator.userAgent));
const WK = WKQ === '1' || (WK_PHONE && WKQ !== '0');

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
    // the story's end: the track's 'end' action, which may lie past the audio's (the tail); never before the audio's
    E: Math.max(d.audio.duration, ...track.filter(a => a.type === 'end').map(a => a.t0)),
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
  // Cuts and fallback lead-ins: an action whose next action on the element starts a different timeline ends in a cut
  // (cutNext). A fallback lead-in (sync "tape", but cutting to its tape on the audio onset: T02, T03, T04) is silent, so
  // it is only loosely synced until the cut; one that starts deep in its file is taken early (LOOKAHEAD_DEEP), so its
  // range and its cut target are fetched well before it comes on screen.
  for (const a of C.videos) {
    const nx = C.next.get(a);
    a.cutNext = !!nx && !still(a) && !still(nx) && !sameAt(a, nx, nx.t0);
    // (WK) lips: a tape, or a lead-in already on its tape's timeline (within W_ADOPT of it: T04's lead-in is 36 ms off).
    // Run-outs and the fallback lead-ins that cut on the onset (T02, T03) are loose. onset: when the tape's voice starts.
    a.lips = WK && (!!a.p.tape || (a.p.sync === 'tape' && !still(a) && !!nx && !!nx.p.tape && (!a.cutNext || sameAt(a, nx, nx.t0, W_ADOPT))));
    a.onset = !WK ? null : a.p.tape ? Math.max(a.t0, a.p.map[0]) : a.lips ? Math.max(nx.t0, nx.p.map[0]) : null;
    // (WK) an adopted lead-in takes its tape's own timeline (T04's ran 36 ms ahead of it, and the hand-over carried that
    // into the tape: +82 ms where the start alone was +46), and where that timeline reaches the file's first frame after
    // the action begins, it begins there (a clip cannot sit before its first frame; started on the action's own t0 it
    // ran that 36 ms early all the same)
    if (a.lips && !a.p.tape && a.cutNext) {
      a.p = {...a.p, map: [nx.p.map[0], nx.p.map[1]]}; a.cutNext = false;
      const t00 = nx.p.map[0] - nx.p.map[1] / (nx.p.rate || 1);
      if (t00 > a.t0) a.t0 = Math.min(t00, nx.t0);
    }
    a.fallback = a.cutNext && a.p.sync === 'tape';
    a.ahead = a.fallback && pageTime(a, a.t0).pt > DEEP ? LOOKAHEAD_DEEP : LOOKAHEAD;
    // A cut's target is fetched ahead (warmAt, WARM_AHEAD s before the cue; and, for a fallback lead-in, by the element
    // itself when the lookahead first takes it, off screen), unless the action itself plays through it (T04's 6.46).
    const x = a.cutNext ? pageTime(nx, nx.t0 + CUT_HOLD).pt : 0;
    a.warmCut = a.cutNext && !(x >= pageTime(a, a.t0).pt && x <= pageTime(a, a.t1).pt);
    a.prefetch = a.fallback && a.warmCut;
  }
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
  stepY: 0, driftAt: 0, vp: null, inputAt: -1e9, // the drift check's own state (see drifted())
  audioWanted: false, audioLive: false, deadA: null,
  ck: {a: -1, perf: 0, last: 0},
  c: {},                // what each component was last set to (cleared by every jump, so the next apply is cold)
  vs: new Map(),        // owned <video> -> {a, last, seekAt, nudge, pf, pre, cut, lead, est}
                        // (WK also: cue, free, outAt, fix, startAt, startLead, startBuf; see the WebKit driver)
  raf: 0,
  stats: {frames: 0, clockMax: 0, glides: 0, pauses: [], tape: {}, clips: {}, seeks: {}, cuts: {}, fixes: {}},
};

function setButton(s) {
  if (!btn) return;
  const L = C ? C.labels : LABELS, A = C ? C.aria : ARIA;
  btn.dataset.state = s; // a plain button whose label changes with it (no aria-pressed: WAI-ARIA APG)
  btn.setAttribute('aria-label', A[s] || ARIA[s]);
  if (label) label.textContent = L[s] || LABELS[s];
  for (const b of extra) {
    b.dataset.state = s; b.setAttribute('aria-label', A[s] || ARIA[s]);
    const l = b.querySelector('.label');
    if (l) l.textContent = s === 'idle' ? (b.dataset.idle ||= l.textContent) : s === 'paused' ? 'Resume' : (L[s] || LABELS[s]);
  }
}
function progress(t) {
  const p = clamp01(t / (C ? C.E : 630.552));
  if (Math.abs(p - (st.p ?? -1)) < .0005 && p < 1) return;
  st.p = p;
  btn.style.setProperty('--play-p', p.toFixed(4));
}

/* ---------------- the clock: audio.currentTime, read every frame ---------------- */
// Chrome and Safari move currentTime on every frame; a browser that updates it more coarsely is carried forward by the
// frame clock, for at most one frame past its last change (so the page is never more than a frame off the audio).
// (iPhone fixes, Sept 30) Between two explicit jumps the story never goes back: a backward step of the audio's time is
// held (WebKit extrapolates currentTime in the page and corrects it from its media process; after a stall that can step
// back by more than a frame, and from 422 s any step back rebuilds the copy machine). While the audio has no metadata or
// is seeking, the story holds the time it was sent to (WebKit can report 0 until a seek made before the metadata lands).
// Held more than HOLD_FAR behind, the audio has not taken the seek: it is asked once more, and if it still isn't there
// HOLD_GIVEUP_MS later, the audio's own time is followed.
const FRAME = 1 / 60, HOLD_FAR = .5, HOLD_GIVEUP_MS = 1500;
function clock(now) {
  if (st.tail) { const t = tailT(now); st.ck.last = t; st.stats.frames++; return t; } // past the audio's end (see "the tail")
  const ck = st.ck;
  st.stats.frames++;
  if (audio.readyState < 1 || audio.seeking) return ck.last;
  const a = audio.currentTime;
  if (a !== ck.a) { if (ck.a >= 0 && !ck.moved) { ck.moved = true; st.liveAt = now; } ck.a = a; ck.perf = now; }
  let t = a;
  if (ck.moved && st.audioLive && !audio.paused) t += Math.min(FRAME, (now - ck.perf) / 1000) * (audio.playbackRate || 1);
  if (t < ck.last) {
    if (ck.last - t <= HOLD_FAR) t = ck.last;
    else if (!ck.asked) { ck.asked = now; t = ck.last; try { audio.currentTime = t; } catch {} }
    else if (now - ck.asked < HOLD_GIVEUP_MS) t = ck.last;
  }
  ck.last = t;
  st.stats.clockMax = Math.max(st.stats.clockMax, Math.abs(t - a));
  return t;
}
// extrapolate only once the audio is seen moving; keep: the same jump (never back from where the story has got to)
function resetClock(t, keep = false) { st.ck = {a: -1, perf: 0, last: keep ? Math.max(st.ck.last, t) : t, moved: false}; }
// The audio's time as the story reads it: the time it was sent to while it has no metadata or is seeking.
const audioT = () => (audio.readyState < 1 || audio.seeking ? st.ck.last : audio.currentTime);
// The audio's end (Chrome reports 630.5), and the story's: the track's 'end' action, past the audio's when the ending runs on.
const AEND = () => Math.min(C.D, Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity) - .02;
const END = () => (C.E > C.D ? C.E : AEND());
// The tail (Josh, Sept 30: "Ending video, let it run to the end"). The mix ends at 630.55, the story at the track's 'end'
// action (634.03): the laugh reprise plays on, muted, to the last frame of its file (633.12), then the page moves to the
// credits. From the audio's end the story clock is the frame clock, carried on from where the audio stopped:
// st.tail = {t0, at}, t = t0 + (now - at); at = null while it waits (a jump into the tail: the glide first), and it starts
// where the audio would (startAudio). A pause keeps the story time; Play again, or a seek into the tail, picks it up there
// (the audio itself is left at its end). The clips keep their own sync rules on it (the reprise, on T12's timeline, its
// tape-grade rate nudges), so the clip ends when the track says it does and the move to the credits follows it.
const tailT = now => (st.tail.at == null ? st.tail.t0 : st.tail.t0 + Math.max(0, now - st.tail.at) / 1000);
const storyT = () => (st.tail ? tailT(performance.now()) : audioT());
function toTail(t, now = performance.now()) {
  if (st.state !== 'playing' || st.tail) return;
  // nothing runs on past the audio (a track without a tail, or a hidden tab: the lock screen played it out): the end
  if (document.hidden || END() <= AEND() + .001) return finish();
  st.tail = {t0: Math.max(t ?? audio.currentTime, st.ck.last || 0), at: now};
  schedule();
}

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
  st.stepY = st.lastY == null ? 0 : Math.abs(y - st.lastY); // the player's own step this frame
  // (not asked again for a position the browser could not give it last frame: iOS Safari left a rest of 6690 at 6689, and
  // was sent the same scrollTo on every frame of that rest. Simulator, Sept 30)
  if (Math.abs(scrollY - y) >= .5 && !(st.askY === y && st.gotY === scrollY)) { scrollTo({top: y, left: 0, behavior: 'instant'}); st.askY = y; st.gotY = scrollY; }
  st.lastY = scrollY;
  st.lastH = docH();
}
// Something other than the player moved the page. Who did it decides what happens (iPhone fixes, Sept 30):
//  - the page's own layout or the viewport changed (since the player last scrolled, or since the last frame: the live
//    market's data arriving above, an image, a rotation, the browser's toolbars): not the reader. The new position is
//    taken as it is (re-anchored) and the next frame follows the rest from the new layout;
//  - a jump far past anything the browser moves by itself (a late scroll position: about one player step; iOS's toolbar
//    shift: 61 px): past 3 x the player's last step + 40 px, and on a touch device also past a quarter of the viewport.
//    The reader (find in page, VoiceOver, a status-bar tap), at once: such a jump comes with no input event and the
//    player would undo it on the frame it is seen, so it can never show on two frames (Sept 30 review);
//  - a touch device: a reader's scroll there always begins with a touch, and a touch has paused the story already. A
//    smaller drift with no reader input in the last INPUT_MS is the browser's own (iOS Safari moved the page by 61 px a
//    frame after the player's first scroll from the top, on every Play: iPhone 16, iOS 18.3 Simulator), re-anchored too;
//  - otherwise (a scrollbar drag sends no input event; momentum): the reader, once the drift has shown on two frames at
//    most DRIFT_MS apart, each past max(drift_px, the player's own last step + 2) (a scroll position that comes back a
//    frame late is off by one step, once). The first sighting is put right by that frame's own scroll.
const INPUT_MS = 800, DRIFT_MS = 250;
function viewportMoved() {
  const vv = window.visualViewport, v = [innerHeight, vv ? vv.height : 0, docH()], w = st.vp;
  st.vp = v;
  return !!w && (w[0] !== v[0] || w[1] !== v[1] || w[2] !== v[2]);
}
function drifted(now, moved) {
  const want = Math.min(st.lastY, maxY()), off = Math.abs(scrollY - want);
  if (off <= Math.max(C.rules.drift_px || 6, st.stepY + 2)) return false;
  if (moved || docH() !== st.lastH) { st.lastY = scrollY; st.driftAt = 0; return false; }
  // far past what the browser moves by itself: the reader, at once
  if (off > (touchy() ? Math.max(innerHeight * .25, 3 * st.stepY + 40) : 3 * st.stepY + 40)) return true;
  if (touchy() && now - st.inputAt > INPUT_MS) { st.lastY = scrollY; st.driftAt = 0; return false; }
  if (now - st.driftAt > DRIFT_MS) { st.driftAt = now; return false; }
  return true;
}
function glideTo(y, {wait, t}) {
  const dy = y - scrollY, g = C.rules.glide, near = Math.abs(dy) <= g.near_vh * innerHeight;
  const [dur, e] = near ? g.near : g.far;
  st.glide = {from: scrollY, t0: performance.now(), dur: dur * 1000, ease: C.ease(e), wait, t};
  st.stats.glides++;
}

/* ---------------- videos: owned while on screen, one continuous timeline each, lips on the mix ---------------- */
// Continuous play (Josh, Sept 30: "i want the video to play continuously ... if the video is on screen, the video plays
// muted"): the track owns every page video for the whole time it is on screen in Play mode (the windows are measured and
// written into choreography.json, "continuous"), and while on screen a video is always playing, muted, on one timeline:
// around a tape, page_time = src_in + (t - tape_start) from the moment it comes on screen until it leaves, so it is already
// running into the tape and runs on after it (looping like the page's own loop past the file's end). Where that timeline
// would start before the file does, the lead-in runs on its own timeline and the one correction is a cut on the tape's
// audio onset, seeked ahead of time so it lands on the onset (see "cuts" below). park/hold only ever happen off screen
// (parked early so a clip is buffered and on its first frame when it comes on).
//
// Measured in Chrome: a clip playing at rate 1 holds its offset to the mix within 2 ms; a seek while playing lands about
// 50 ms late (LEAD); a clip told to play starts about 45 ms later (PRESTART). So each clip is aligned once (started early
// on its cue, or seeked with the lead) and then only nudged: pitch preservation off (the clips are muted; with it on,
// every rate change costs Chrome ~20 ms) and a rate a few percent off 1 until it is back.
//  - On a tape's timeline (the tape itself, and the lead-in and run-out that share its timeline): a rate within 8 % of 1,
//    engaged past 12 ms of drift, released under 4. The audio clock itself stutters for a few frames as it starts, so once
//    it has run steadily for 250 ms a clip still more than 35 ms off is aligned again with one seek.
//  - Any other clip (ambient loops, the grids, and a fallback lead-in until its cut: it is silent, and exactness only
//    matters from the onset): realigned only when off by more than a frame (1/30 s), by a rate within 10 % of 1, released
//    under 8 ms; a hard seek only past 0.35 s (a stall), never for a frame or two.
// (Re)starts: a tape clip waits for the audio's own 'playing' (not the moment play() is called: the audio clock only moves
// 50-80 ms later), and for its first 1.5 s it is corrected harder (a rate within 25 % of 1). A hard seek leads by what
// this element's seeks have been taking (LEAD at least; a slow phone decoding from a far keyframe takes longer; learned
// only from seeks into data the element already had, so a slow network fetch never inflates it), and one that still lands
// off stops hard seeks on that clip for 1.5 s, while the rate closes the gap.
// Slow networks (review, Sept 30; DevTools "Fast 4G", 9 Mbps / 170 ms): a cut's target is fetched before the cut (see
// "cuts"), a fallback lead-in deep in a preload=none file is taken 15 s ahead, and a cut that still lands late is closed by
// the rate (within 25 %) for 2 s rather than by a second hard seek.
const LOOKAHEAD = 6, LOOKAHEAD_DEEP = 15, DEEP = 10, LEAD = .05, PRESTART = .045, TAPE_SEEK = .12, TAPE_ALIGN = .035, TAPE_ON = .012, TAPE_OFF = .004, TAPE_GAIN = 1.5, TAPE_MAX = .08;
const BOOST_MS = 1500, BOOST_GAIN = 4, BOOST_MAX = .25, LEAD_MAX = .6, BACKOFF_MS = 1500, SEEK_WAIT_MS = 250;
const LOOSE_ON = 1 / 30, LOOSE_OFF = .008, LOOSE_GAIN = 1.5, LOOSE_MAX = .1, LOOSE_SEEK = .35, SAME = .03, CUT_EST = .008, CUT_HOLD = .02;
const CUT_EST_MAX = .03, CUT_EARLY = .05, CUT_LATE_MS = 2000, WARM_AHEAD = 8;
const FAST_MAX = .5, BLOCKED_MS = 500, GRID_WAKE = .6;
// The WebKit clip driver (iPhone stutter fix, Oct 1; WK). Everything above was measured in Chrome and does not hold on
// WebKit: a playbackRate write on a playing clip stalls it (WebKit bug 163433; ~22 ms a write in the iOS 18.3 Simulator,
// and a real iPhone at 1.25 advanced 0.14-0.91 s a second), a seek on a playing clip freezes the picture (median 116 ms in
// the Simulator, 284 ms on the phone) and lands behind, and currentTime is an estimate that a rate write or a seek
// disturbs. So the loop above never converged there: tape clips ran at 1.7 seeks and 13 rate writes a second and showed
// 12-16 frames a second, while a clip it never touched held its offset to the mix within 0.1 ms for 20 s. On WK:
//  - the driver never writes playbackRate and never seeks a clip that is playing (nor seeks one in the same task as its
//    play()). One actuator, wkCue: the clip is paused, seeked PAUSED and exactly to the frame the story shows at a cue
//    time, and told to play its start lead before that cue. Every cut is one (the picture rests on the cut's first frame
//    for the lead + W_SEEK), and so are a tape-timeline clip found off its frame at a start, a loose clip taken cold more
//    than FAST_MAX off (paused or playing: a fast seek lands on a keyframe seconds away in the loose files, and a playing
//    seek is what this driver exists to avoid), a stack card coming back into view, and the rare correction. Not the
//    driver's: the browser's own loop wrap (WebKit seeks a looping clip to 0 itself, playing) and main.js's handler that
//    puts #swap-over on #swap-under's time when under's seek ends (it stands down while the player owns #swap-over);
//  - starts: a clip the lookahead parked plays its start lead (wkLeadOf, below) before its cue (the timer armed W_ARM ahead,
//    so a frame lost to a scroll move does not step over it: one did, 116 ms long, and the clip came on with a cue's still
//    instead) from where it is parked; a lips clip held while the audio waits (a press, a resume) is parked its start lead
//    ahead of the story and plays on the audio's 'playing' if the frame it would then land on is inside its band (the
//    'playing' comes a little after the audio's clock has moved; a start that would land outside the band is cued instead);
//    a loose clip starts where it is; a clip with no metadata yet is held, not started (main.js would seek it once its
//    metadata lands, by then playing);
//  - wk.start = what play() takes to move a clip + W_BIAS (the picture is aimed 30 ms early: ITU-R BT.1359, a late
//    picture is noticed from 45 ms, an early one only from 125). Learned (wkSample): each start notes how far ahead of the
//    story its frame was, and W_BLIND_MS later (currentTime is not to be trusted sooner), once the audio has run 600 ms,
//    the error read then gives the lag; a start about to be corrected sooner than that is read first (from W_LAG_GATE_MS:
//    the cold open's first start is corrected 550 ms in, and that sample used to be thrown away). The median of the last
//    5 starts into data the element already had, the default counted among them until there are 5 (the first start, in
//    the press, ran 232 ms late in the Simulator under the page's own start-up work, the next ones 57-90 ms: one slow start
//    must not set the lead). Kept in localStorage for the next visit on the device, but only the last W_KEEP lags, for
//    W_KEEP_MS, from this build (WK_VER), and recomputed with the default counted: a stale slow session (a hot phone, a test
//    with a delay) moves the next visit's first starts, and two of that visit's own starts put it right. Lags up to
//    W_LAG_MAX are learned and the lead may grow to W_START_MAX (the real phone starts a playing seek in 300-800 ms). Not
//    learned from: a start that came late, and clips started together (the stacks' three cards at once took 79-101 ms each,
//    a clip alone 56-74; a lips clip starts alone);
//  - each element keeps its own last lag (s.lag), and once it has one its starts and cues are aimed with it, in both
//    directions (wkLeadOf): the correction after a slow start lands in band (the uniform 300 ms delay: +24 ms at the laugh),
//    and a fast element is not held to a stale slow lead (stored lags of 0.45 s and a real lag of 0.06 left the cold open
//    0.42 s early through the laugh). A correction whose own start, read, leaves the picture past W_EARLY_FIX ahead (its
//    lag was a one-off: the first start under the press's load took 0.21 s, the correction's 0.07, and T01 ran 167 ms early
//    to its cut, inside the hold band) is cued once more at once, with the lag just read, voice or no voice;
//  - a start that comes late (its timer under a busy main thread: the press's own work held the cold open's by up to
//    280 ms; or a slow seek) would put the clip that far behind. A lips clip is not started then: it is cued again, a
//    little further on (it stays the still it already is), twice at most; once its voice is heard only past W_LATE_HOLD (a
//    start up to that late lands in the hold band; a second cue would freeze it over the words); a loose clip starts, late
//    by that much;
//  - lips clips (a tape, and a lead-in on its tape's timeline) are watched against a wide band, d = clip - story, the
//    story being the audio's own time (what is heard; the frame clock can hold ahead of it for up to HOLD_FAR after a
//    backward step, see clock(), and a clip in time with the sound must not be cued for that): while a correction would
//    still end W_QUIET before the voice, -W_LATE..+W_EARLY; once the voice is heard only past ITU acceptability,
//    -W_LATE_HOLD..+W_EARLY_HOLD. Outside it for W_SUSTAIN_MS (W_SUSTAIN_QUIET_MS before the voice: the cold open's clip
//    starts under the press's own work, up to 200 ms late, and has until 1.55 s to be put right before the laugh at
//    2.02): one cue. A second on the same action waits W_COOL_MS; after W_MAX_FIX only an error past W_FAR, W_FAR_MS
//    apart (a phone that cannot hold real time gets a still now and then, never the old freeze every second). Two lips
//    clips on one timeline (the swap's two layers under the slider, T06) are cued together, never one without the other;
//  - loose clips (ambient, loops, run-outs, a fallback lead-in until its cut, stack cards) are never moved while they
//    play, but for a stall: one past LOOSE_SEEK (a stack card: W_CARD_FAR) for W_LOOSE_FAR_MS (a network stall left it
//    there for good: the rate that used to close that is not written here) is cued once, W_LOOSE_GAP_MS at least after
//    its last command. Never a loop: its wrap is the browser's seek, a still each time on the phone, not a drift, and an
//    ambient loop has no right place to be put back to. A stack card held while out of sight is cued onto its timeline
//    as the deck brings it back (it is still out of sight then), so it no longer comes back 0.3-1.2 s behind;
//  - two timelines within W_ADOPT at a hand-over are one (T04's lead-in: 36 ms; a cue would cost a 0.37 s still);
//  - a clip Safari refuses to play (Low Power Mode) is a still until the next press unlocks it: parked once on each new
//    action's first frame (one paused seek), never stepped along its timeline (the phone showed that as a 2 frames-a-
//    second slideshow for a minute); every press unlocks the clips on and next to the screen and, with evidence of Low
//    Power Mode, the rest of the story's clips too (see wkFps, primeVideos, wkUnlock);
//  - a jump (a seek while playing, the lock screen's scrub, the return from a hidden tab) takes every clip cold: its
//    corrections and its start under measurement are forgotten with it.
const W_BIAS = .03, W_START = .12, W_START_MIN = .03, W_START_MAX = .8, W_LAG_MAX = 1, W_SEEK = .25, W_ADOPT = .06;
const W_LATE = .05, W_EARLY = .11, W_LATE_HOLD = .09, W_EARLY_HOLD = .185, W_QUIET = .1;
const W_BLIND_MS = 400, W_SUSTAIN_MS = 500, W_COOL_MS = 2500, W_MAX_FIX = 2, W_FAR = .35, W_FAR_MS = 8000;
const W_LATE_START = .04, W_GROUP_MS = 200;   // a start this much later than led is late; clips started within W_GROUP_MS started together
const W_ARM = .2, W_SUSTAIN_QUIET_MS = 150;    // a parked clip's start timer is armed this long before it is due; the sustain before the voice
const W_LOOSE_FAR_MS = 1000, W_LOOSE_GAP_MS = 4000; // a loose clip past LOOSE_SEEK this long, this long after its last command: one cue
const W_CARD_FAR = .5, W_CARD_OFF = .1;  // a stack card's stall threshold; a card woken further off than this is cued onto its timeline
const W_LAG_GATE_MS = 300;               // a start under measurement is read before a cue forgets it, once it is this old
const W_EARLY_FIX = .125;                // a correction whose own start leaves the picture this far ahead gets one more cue
// Priming (see primeVideos and wkUnlock). For one page load, to A/B on a phone: ?lpm=1 / ?lpm=0 (the Low Power Mode evidence
// forced on / off), ?unlock=mix|src|pp (how the rest of the story's clips are unlocked under that evidence), ?prime=N (the
// press's play()+pause() unlocks capped at N in all, the old build's set counted but always played in full), ?prime=all (every
// one by play()+pause(), no per-file rule), ?prime=none (nothing beyond the old build's set: the Low Power Mode stills, on
// purpose).
const QS = new URLSearchParams(location.search), PRIMEQ = QS.get('prime'), LPMQ = QS.get('lpm'), UNLOCKQ = QS.get('unlock');
const W_UNLOCK = UNLOCKQ === 'src' || UNLOCKQ === 'pp' || UNLOCKQ === 'mix' ? UNLOCKQ : 'mix'; // (the default until a phone shows whether 'src' works: see wkUnlock)
const W_PRIME_AHEAD = 90; // (past this many s of the press, one element per media file is played)
const W_PRIME_MAX = PRIMEQ === 'all' ? Infinity : PRIMEQ === 'none' ? 0 : PRIMEQ && Number.isFinite(+PRIMEQ) ? +PRIMEQ : W_UNLOCK === 'src' ? Infinity : 12; // (play()+pause() unlocks one press makes, refused ones aside)
// rAF: a window of the last W_FPS_N intervals, W_FPS_MS past the page's load (+0.5 s); evidence from W_FPS_FULL intervals (a
// press before that: from W_FPS_MIN); Low Power Mode: at least W_FPS_30 of them in 28-40 ms and under W_FPS_FAST under 22 ms
const W_FPS_MS = 1200, W_FPS_N = 36, W_FPS_FULL = 15, W_FPS_MIN = 8, W_FPS_30 = .7, W_FPS_FAST = .1;
// The start lead (start-up lag + W_BIAS), learned, and kept per device (localStorage) so that a second visit starts right.
const wk = {start: W_START, lags: []}, WK_KEY = 'sg-play-wk', WK_VER = 2, W_KEEP = 2, W_KEEP_MS = 3 * 864e5;
const wkMed = xs => { const o = [...xs].sort((x, y) => x - y), m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };
const wkStartOf = L => clamp(wkMed(L.length < 5 ? [W_START - W_BIAS, ...L] : L) + W_BIAS, W_START_MIN, W_START_MAX);
// (an element whose own start was measured is aimed with its own lag, both ways: the correction that follows a slow start must
// not be aimed with the lead the start just missed by, and a fast element is not held to a stale slow lead)
const wkLeadOf = s => (s && s.lag != null ? clamp(s.lag + W_BIAS, W_START_MIN, W_START_MAX) : wk.start);
function wkLoad() {
  try {
    const o = JSON.parse(localStorage.getItem(WK_KEY) || 'null'), age = o ? Date.now() - o.at : NaN;
    if (!o || o.v !== WK_VER || !(age >= 0 && age < W_KEEP_MS) || !Array.isArray(o.lags)) return; // (another build's, or stale)
    const L = o.lags.filter(x => Number.isFinite(x) && x > -.05 && x < W_LAG_MAX).slice(-W_KEEP);
    if (L.length) { wk.lags = L; wk.start = wkStartOf(L); }
  } catch {}
}
function wkSave() { try { localStorage.setItem(WK_KEY, JSON.stringify({v: WK_VER, lags: wk.lags.slice(-W_KEEP).map(x => +x.toFixed(4)), at: Date.now()})); } catch {} }
const wkRunning = () => st.state === 'playing' && (st.tail ? st.tail.at != null : !audio.paused && st.audioLive);
const wkAlone = s => { for (const o of st.vs.values()) if (o !== s && Math.abs((o.began || -1e9) - s.began) < W_GROUP_MS) return false; return true; };
// (L: the lead a correction made now would be issued with, this element's own: it holds the picture until t + L + W_SEEK)
const wkQuiet = (a, t, L) => a.onset != null && t + L + W_SEEK + W_QUIET < a.onset; // a correction made now ends before the voice
const wkOut = (a, t, d, L) => (wkQuiet(a, t, L) ? d < -W_LATE || d > W_EARLY : d < -W_LATE_HOLD || d > W_EARLY_HOLD); // outside the band
// (WK) The start under measurement (s.startAt): the clip's frame was s.startLead ahead of the story when play() was called and
// is d ahead now, so play() took startLead - d to move it. Kept as this element's own lag (s.lag), and learned into wk.start
// (median of the last 5, the default counted among them until there are 5) when the start was alone. True when it was read
// (a start into data the element had, with a sane reading).
function wkSample(s, d) {
  const lag = s.startLead - d;
  s.startAt = 0;
  if (!s.startBuf || !(lag > -.05 && lag < W_LAG_MAX)) return false; // (a start that waited for the network, or a wild reading, says nothing)
  s.lag = lag;
  if (wkAlone(s)) { wk.lags.push(lag); if (wk.lags.length > 5) wk.lags.shift(); wk.start = wkStartOf(wk.lags); wkSave(); }
  return true;
}
// (WK) Low Power Mode evidence, for the press (primeVideos): a clip refused since the last press (st.reprime), or rAF at a
// steady 30 a second on the page as it loaded. WebKit throttles rAF to 30 in Low Power Mode (bug 168837): every interval is
// then ~33 ms, none under 22, where a 60 or 120 Hz page that drops frames still has many (the phone in Low Power Mode: 30-31
// frames a second, the longest 34 ms; out of it, 60 a second, and its slow seconds still mixed 17 ms frames in). WebKit adds
// the Low Power Mode restriction to a <video> only when the element is created (HTMLMediaElement::initializeMediaSession:
// here, as the page is parsed) and nothing adds it back, so the page's state as it loaded is what matters: rAF is timed from
// the moment this module runs to W_FPS_MS past the page's 'load' + 0.5 s (a rolling window of the last W_FPS_N intervals; a
// gap past 100 ms is the page busy, not its cadence), and that first complete sample is the evidence for good (Low Power
// Mode switched on later restricts no clip already on the page; switched off, it lifts none). A press before it is complete
// reads the window so far. A page that got no complete sample (hidden as it loaded) samples again on coming back to the tab
// and after a pause. A hidden tab stops a sample, and a stale callback cannot end the next one (gen). ?lpm=1 / ?lpm=0 force it.
const fps = {gen: 0, on: false, iv: [], ev: null};
let loadAt = 0;
function fpsOf(iv) {
  const n = iv.length;
  if (n < W_FPS_MIN) return null;
  let s30 = 0, fast = 0;
  for (const x of iv) { if (x < 22) fast++; else if (x >= 28 && x <= 40) s30++; }
  return {n, med: wkMed(iv), s30: s30 / n, fast: fast / n, lpm: s30 / n >= W_FPS_30 && fast / n < W_FPS_FAST};
}
function wkFps() {
  if (!WK || fps.on || fps.ev || document.hidden || st.state === 'playing' || st.state === 'loading') return;
  const gen = ++fps.gen, t0 = performance.now(), iv = fps.iv = [];
  let last = 0;
  fps.on = true;
  const f = now => {
    if (gen !== fps.gen) return;
    if (document.hidden || st.state === 'playing' || st.state === 'loading') { fps.on = false; fps.gen++; return; } // (a press reads what there is)
    if (last && now - last < 100) { iv.push(now - last); if (iv.length > W_FPS_N) iv.shift(); }
    last = now;
    const end = loadAt ? Math.max(t0, loadAt + 500) + W_FPS_MS : Infinity;
    if (now < end || (iv.length < W_FPS_FULL && now < end + 5000)) return void requestAnimationFrame(f);
    fps.on = false; fps.gen++;
    if (iv.length >= W_FPS_FULL) fps.ev = fpsOf(iv);
  };
  requestAnimationFrame(f);
}
const fpsNow = () => fps.ev || fpsOf(fps.iv); // the evidence, or the sample so far
const wkLpm = () => LPMQ === '1' || (LPMQ !== '0' && (!!st.reprime || !!(fpsNow() || {}).lpm));
if (WK) {
  wkLoad();
  if (document.readyState === 'complete') loadAt = performance.now(); else addEventListener('load', () => { loadAt = performance.now(); }, {once: true});
  wkFps();
  window.__sgWK = true; // (main.js: the swap's own sync loop stands down while this driver plays the layers)
}
const isCard = el => !!(el.parentElement && el.parentElement.parentElement && el.parentElement.parentElement.classList.contains('grid4'));
const still = a => a.p.mode === 'park' || a.p.mode === 'hold';
const tight = a => !!(a.p.tape || (a.p.sync === 'tape' && !a.fallback)); // on a tape's timeline: lips-grade sync
// iPhone fixes, Sept 30. WebKit seeks exactly (currentTime, zero tolerance: AVFoundation decodes forward from the last
// keyframe, and the loose page copies have keyframes up to 10 s apart). So there a loose clip (not on a tape's timeline)
// is moved with fastSeek(), which lands on a keyframe near the target, and the rate closes the rest: within FAST_MAX of
// its timeline it is boosted (within 25 %) for as long as that takes, with no hard seek meanwhile; one that lands
// further off (keyframes seconds apart in that file) gets one exact seek, and that element is seeked exactly from then
// on. A paused loose clip within FAST_MAX of its timeline is simply started where it is, the rate closing the gap.
// Tape clips and cuts keep their exact seeks (their windows were re-encoded with 0.5 s keyframes). Chrome: unchanged.
const exactOnly = new WeakSet();
const fastOK = (a, el) => WEBKIT && !tight(a) && !a.lips && typeof el.fastSeek === 'function' && !exactOnly.has(el); // (a.lips: WK only)
const boostMs = d => clamp(Math.abs(d) / BOOST_MAX * 1000 + 600, 1000, 3000);
function catchUp(el, s, h, pt, d, base, now) { // started where it is; the boosted rate closes d
  s.seekAt = now; s.last = now; s.nudge = Math.abs(d) > LOOSE_OFF;
  s.noSeekUntil = s.boostUntil = now + boostMs(d);
  h.at(pt, {play: true, rate: base, tolerance: 1e9});
}
// Phones (iPhone fixes, Sept 30): a stack card wholly out of sight (the one waiting unseen at the back, opacity 0) is
// held where it is instead of played, one decoder less (reader mode plays only the front card; the renderer keeps all
// four moving, by its own rule). It is played again GRID_WAKE s before the next grid action of its stack, so it is
// already moving on its timeline as the deck brings it into view, and until the deck's spring (about 0.5 s) has landed.
function unseenCard(el, t) {
  const fig = el.parentElement;
  if (!fig || !fig.parentElement || !fig.parentElement.classList.contains('grid4') || !(parseFloat(fig.style.opacity) < .02)) return false;
  const key = fig.closest('.stage-media--grid')?.dataset.key;
  return !C.grids.some(g => g.p.key === key && Math.abs(g.t0 - t) < GRID_WAKE && g.ok());
}
// Is page time x in data this element already has? (What a seek there costs is then decoding, not the network.)
function inBuf(el, x) {
  const b = el.buffered;
  for (let i = 0; i < b.length; i++) if (b.start(i) <= x + .001 && x < b.end(i) - .1) return true;
  return false;
}
// A range a clip will cut to while it is on screen, fetched ahead by a detached muted <video> of the same URL. Chrome
// shares a URL's media data between elements: the page element's own seek there then lands from memory (measured at
// 9 Mbps / 170 ms, the cold open's 10.80: 300 ms cold, 4-5 ms warmed). The warmer is kept (paused on that frame, preload
// down to metadata so it stops reading ahead) until holdMs after it has the frame, i.e. until just past the cut, so the
// range stays in use and is not dropped from memory before the cut needs it; at most holdMs + 10 s in all. A browser
// that does not share only spends the bandwidth.
function warmAt(el, x, holdMs = 1000) {
  const url = el.currentSrc || el.querySelector('source')?.src || el.src;
  if (!url) return;
  const w = document.createElement('video');
  let timer = 0;
  const drop = () => { clearTimeout(timer); w.removeAttribute('src'); try { w.load(); } catch {} };
  w.muted = true; w.playsInline = true; w.preload = 'auto';
  w.addEventListener('loadedmetadata', () => { try { w.currentTime = x; } catch { drop(); } }, {once: true});
  w.addEventListener('seeked', () => { w.preload = 'metadata'; clearTimeout(timer); timer = setTimeout(drop, holdMs); }, {once: true});
  w.addEventListener('error', drop, {once: true});
  timer = setTimeout(drop, holdMs + 10000);
  w.src = url;
}
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
// Two actions on one element are one timeline at t when they give the same page time there (modulo a loop).
function sameAt(a, b, t, tol = SAME) {
  if (!a || !b || still(a) || still(b)) return false;
  const x = pageTime(a, t).pt, y = pageTime(b, t).pt, w = (b.p.mode === 'loop' && b.p.wrap) || (a.p.mode === 'loop' && a.p.wrap) || 0;
  let d = x - y;
  if (w > 0) d = ((d % w) + w * 1.5) % w - w / 2;
  return Math.abs(d) < tol;
}
function pitchFree(el, s) {
  if (s.pf || WK) return; // (WK: no rate is ever written, so pitch preservation is left alone)
  s.pf = true;
  el.preservesPitch = false;
  if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = false;
}
function countSeek(a) { st.stats.seeks[a.id] = (st.stats.seeks[a.id] || 0) + 1; }
// What this element's seeks take (from the call to 'seeked'): a hard seek leads by it (LEAD at least), a cut is issued
// that far ahead (CUT_EST until measured: a playing clip seeked to a keyframe of the re-encoded tape windows lands in
// 3-10 ms in Chrome; never more than CUT_EST_MAX, so a cut is never issued far ahead of its cue). Only seeks into data the
// element already had are learned from: one that had to wait for the network says nothing about the next.
function learn(s, took) {
  s.lead = clamp(s.lead == null ? Math.max(LEAD, took) : s.lead * .6 + took * .4, LEAD, LEAD_MAX);
  s.est = clamp(s.est == null ? took : s.est * .6 + took * .4, .004, LEAD_MAX);
}
const cutEst = s => Math.min(s.est ?? CUT_EST, CUT_EST_MAX);
// A hard seek on a playing clip, ahead by this element's own seek time (so it lands on the audio), timed for the next one.
// (WebKit, a loose clip: a fast seek, see fastOK above; exact: the one exact seek after a fast one that landed too far.)
function seekPlaying(el, s, a, h, pt, base, exact = false) {
  const t0 = performance.now(), lead = s.lead ?? LEAD, buf = inBuf(el, pt + lead * base), fast = !exact && fastOK(a, el);
  s.seekAt = t0; s.last = t0; s.nudge = false;
  countSeek(a);
  if (el.playbackRate !== base) el.playbackRate = base;
  h.at(pt + lead * base, {play: true, rate: base, tolerance: 0, fast}).then(() => {
    if (st.vs.get(el) !== s) return;
    if (fast) {
      if (s.a !== a || st.state !== 'playing') return;
      const now = performance.now(), pn = pageTime(a, storyT()).pt, d = driftOf(el, pn, a);
      if (Math.abs(d) <= FAST_MAX) { s.nudge = Math.abs(d) > LOOSE_OFF; s.noSeekUntil = s.boostUntil = now + boostMs(d); return; }
      exactOnly.add(el);
      return seekPlaying(el, s, a, h, pn, base, true);
    }
    if (buf) learn(s, (performance.now() - t0) / 1000);
    if (!tight(a) || st.state !== 'playing' || audio.paused || !st.audioLive || s.a !== a) return;
    const d = driftOf(el, pageTime(a, audio.currentTime).pt, a);
    if (Math.abs(d) > TAPE_SEEK) s.noSeekUntil = performance.now() + BACKOFF_MS; // landed off again: let the rate do it
  }, () => {});
}
// (WK) The one WebKit actuator: pause the clip, seek it PAUSED and exactly to the frame the story shows at cueT, then
// play() L (the start lead: wk.start, or this element's own, see wkLeadOf) before cueT. Never a seek on a playing clip, never
// a rate write. s.cue (the cue time) is set while one is pending: the loop leaves the clip alone until it has been told to
// play. One whose seek has not landed after main.js's 5 s wait stays a still; the loop takes it up again once it lands. The
// start is timed on the audio's own time (storyT), so the frame lands on what is heard. (For tests: the start is noted on
// the cut's record, stats.cuts, when it is one.)
function wkCue(el, s, a, h, cueT, base, again = 0, L = wk.start) {
  const p0 = pageTime(a, cueT).pt;
  if (s.pre) { clearTimeout(s.pre); s.pre = 0; }
  s.seekAt = s.last = performance.now(); s.outAt = 0; s.startAt = 0; s.farAt = 0; s.cue = cueT;
  countSeek(a);
  return h.at(p0, {play: false, exact: true}).then(() => {
    if (st.vs.get(el) !== s || s.cue !== cueT) return;
    if (el.seeking) { s.cue = null; return; }
    const go = () => {
      s.pre = 0;
      if (st.vs.get(el) !== s || s.cue !== cueT) return;
      s.cue = null;
      if (!wkRunning() || !el.paused) return; // (the audio stopped meanwhile: the loop parks it and starts it with the audio)
      // (a lips clip whose start comes late is cued again, a little further on, twice at most; once its voice is heard, only
      // past W_LATE_HOLD: a start up to that late lands inside the hold band, where a second cue would freeze it over the words)
      const lead = cueT - storyT(), late = lead < L - (a.onset != null && cueT >= a.onset ? W_LATE_HOLD : W_LATE_START);
      if (late && a.lips && again < 2) return void wkCue(el, s, a, h, storyT() + (L + W_SEEK) * base, base, again + 1, L);
      s.seekAt = s.last = s.startAt = s.began = performance.now();
      s.startLead = lead; s.startBuf = inBuf(el, el.currentTime) && lead >= L - W_LATE_START;
      s.cueRec = {cue: cueT, started: +storyT().toFixed(4), lead: +lead.toFixed(4), again};
      const rec = st.stats.cuts[a.id]; if (rec && rec.cue === cueT) Object.assign(rec, s.cueRec);
      h.at(p0, {play: true, rate: base, tolerance: 1e9});
    };
    const wait = (cueT - storyT() - L) * 1000 / base;
    if (wait < 4) go(); else s.pre = setTimeout(go, wait);
  }, () => {});
}
// (WK) What the rate nudge and the 35 ms re-align are on WebKit. (1) The start lead is learned from each start (wkSample),
// read W_BLIND_MS after it once the audio has run 600 ms, or, when a correction comes sooner (the cold open's first start
// can be corrected 550 ms in), just before the correction (W_LAG_GATE_MS), which then aims with the lag it just showed
// (wkLeadOf): a slow phone's first correction lands in band instead of as late as the start it corrects. When that lag was
// a one-off (the first start under the press's load), the correction's own start is fast and its picture runs ahead by the
// difference, inside the hold band: read W_LAG_GATE_MS after it, a correction past W_EARLY_FIX ahead is cued once more, at
// once, with the lag it showed (voice or no voice, cool-down or not: a 0.3 s still against a picture 0.17 s early to the
// cut). (2) A lips clip is watched against the band and re-cued, rarely (see the WebKit driver's rules above); the other lips
// clips on its timeline (the swap's two layers) are cued with it, with the same cue, and each counts the fix.
// d here is the clip's lead over the audio's own time (syncVideos: dA).
function wkWatch(el, s, a, h, t, d, base, now) {
  // (a correction's own start is read from W_LAG_GATE_MS, as the start a cue would forget is: the cold open's then ends its
  // one extra still before the laugh)
  const fx = s.fix, own = a.lips && !!fx && fx.a === a && !fx.more && s.began >= fx.at; // (this start was a correction's own)
  if (s.startAt && now - s.startAt > (own ? W_LAG_GATE_MS : W_BLIND_MS) && now - (st.liveAt || 0) > 600) {
    if (wkSample(s, d) && own && d > W_EARLY_FIX) return void wkFix(el, s, a, h, t, base, true);
  }
  if (!a.lips) return;
  const L = wkLeadOf(s);
  if (!wkOut(a, t, d, L) || now - s.seekAt < W_BLIND_MS) { s.outAt = 0; return; }
  if (!s.outAt) { s.outAt = now; return; }
  const quiet = wkQuiet(a, t, L), n = s.fix && s.fix.a === a ? s.fix.n : 0, far = n >= W_MAX_FIX;
  if (now - s.outAt < (quiet ? W_SUSTAIN_QUIET_MS : W_SUSTAIN_MS)) return;
  if (far ? (Math.abs(d) < W_FAR || now - s.seekAt < W_FAR_MS) : (n > 0 && !quiet && now - s.seekAt < W_COOL_MS)) return;
  if (s.startAt && now - s.startAt > W_LAG_GATE_MS) wkSample(s, d); // (the start this cue would forget)
  wkFix(el, s, a, h, t, base, false);
}
// (WK) A correction: the clip cued W_SEEK + its lead ahead (the lead read now: a sample just taken counts), with the other lips
// clips on its timeline, unless its cut is about to re-cue it anyway, and never into data an element does not have. more: the
// one extra cue after a correction that landed early (no second one on that action).
function wkFix(el, s, a, h, t, base, more) {
  const L = wkLeadOf(s), cueT = t + (L + W_SEEK) * base, nx = a.cutNext ? C.next.get(a) : null;
  if (nx && nx.t0 - cueT < L + W_SEEK) return;          // its cut is about to re-cue it anyway
  if (!inBuf(el, pageTime(a, cueT).pt)) return;        // never into data the element does not have
  const at = performance.now();
  const fix = (o, oa) => { const p = o.fix && o.fix.a === oa ? o.fix : null; o.fix = {a: oa, n: (p ? p.n : 0) + 1, at, more: more || !!(p && p.more)}; st.stats.fixes[oa.id] = (st.stats.fixes[oa.id] || 0) + 1; };
  for (const [oel, os] of st.vs) {
    if (oel === el || !os.a || !os.a.lips || os.cue != null || oel.paused || oel.seeking || !sameAt(os.a, a, t, W_ADOPT) || !inBuf(oel, pageTime(os.a, cueT).pt)) continue;
    fix(os, os.a); wkCue(oel, os, os.a, SG().video(oel), cueT, base, 0, L);
  }
  fix(s, a);
  wkCue(el, s, a, h, cueT, base, 0, L);
}
// Cuts: the next action on this element starts a different timeline (the lead-in's one correction on a tape's audio onset,
// or the cold open's re-cue). The seek is issued ahead of the cue by what this element's seeks take, so the new picture
// lands on the cue, and the clip plays on from there (no second seek when the next action takes over). Measured in
// Chrome: a playing clip lands 3-7 ms after the seek, then holds that frame about 40 ms before it moves again, so the
// target is CUT_HOLD (half that hold) further on: the clip is within ~20 ms of the tape's formula across the hold,
// where aiming at the cue itself left it 35-39 ms behind for a frame or two.
// The target is in memory by then: a fallback lead-in taken ahead fetched it before it came on screen, and a clip that is
// on screen has it warmed (warmAt) WARM_AHEAD s before the cue. If the seek still lands more than CUT_EARLY before the cue,
// the clip holds the cue's frame and is started PRESTART ahead of the cue (it never runs ahead of the onset); if it lands
// more than a frame late, a loose clip is not hard-seeked for 2 s and the rate (within 25 %) closes the gap.
function planCut(el, s, a, h, t, base, frameDt) {
  const nx = C.next.get(a);
  if (!nx || still(nx) || !nx.ok() || (s.cut && s.cut.nx === nx) || sameAt(a, nx, nx.t0, WK ? W_ADOPT : SAME)) return;
  const L = WK ? wkLeadOf(s) : 0, est = WK ? L + W_SEEK : cutEst(s);
  if (nx.t0 - t > est + frameDt + .004) return;
  const go = () => {
    if (s.cut) s.cut.timer = 0;
    if (st.vs.get(el) !== s || st.state !== 'playing' || audio.paused || !st.audioLive) { s.cut = null; return; }
    if (WK) { // the cut as a cue: paused on the new timeline's first frame now, playing on the cue (fix 'held', as below)
      const t0 = performance.now(), ta = audio.currentTime, buf = inBuf(el, pageTime(nx, nx.t0).pt);
      wkCue(el, s, nx, h, nx.t0, base, 0, L).then(() => {
        const tl = audio.currentTime; // (landed: the paused seek; started, lead, again: the start, from wkCue)
        st.stats.cuts[nx.id] = {cue: nx.t0, issued: +ta.toFixed(4), landed: +tl.toFixed(4), took: +((performance.now() - t0) / 1000).toFixed(4), d: +driftOf(el, pageTime(nx, tl).pt, nx).toFixed(4), buf, fix: 'held', ...(s.cueRec && s.cueRec.cue === nx.t0 ? s.cueRec : {})};
      });
      return;
    }
    const t0 = performance.now(), e = cutEst(s), ta = audio.currentTime;
    const at = Math.max(nx.t0, ta + e * base) + CUT_HOLD * base; // where the clock will be halfway through the post-seek hold
    const target = pageTime(nx, at).pt, buf = inBuf(el, target);
    s.seekAt = t0; s.last = t0; s.nudge = false;
    countSeek(nx);
    if (el.playbackRate !== base) el.playbackRate = base;
    h.at(target, {play: true, rate: base, tolerance: 0}).then(() => {
      if (st.vs.get(el) !== s) return;
      const now = performance.now(), took = (now - t0) / 1000, tl = audio.currentTime;
      if (buf) learn(s, took);
      const d = driftOf(el, pageTime(nx, tl).pt, nx), early = nx.t0 - tl;
      let fix = null;
      if (early > CUT_EARLY && s.cut && s.cut.nx === nx && st.state === 'playing' && !audio.paused) {
        // landed well before the cue: hold the cue's own frame, then start it PRESTART ahead of the cue
        fix = 'held';
        const p0 = pageTime(nx, nx.t0).pt;
        h.at(p0, {play: false, exact: true});
        if (s.pre) clearTimeout(s.pre);
        const start = () => {
          s.pre = 0;
          if (st.vs.get(el) !== s || st.state !== 'playing' || audio.paused || !el.paused) return;
          s.seekAt = performance.now(); h.at(p0, {play: true, rate: base, tolerance: .03});
        };
        const wait = (nx.t0 - audio.currentTime - PRESTART) * 1000 / base;
        if (wait < 4) start(); else s.pre = setTimeout(start, wait);
      } else if (d < -1 / 30 && !tight(nx)) {
        fix = 'rate';
        s.noSeekUntil = s.boostUntil = now + CUT_LATE_MS;
      }
      // (for tests: where the cut was issued and landed, and how far the clip sat from the new timeline as it landed)
      st.stats.cuts[nx.id] = {cue: nx.t0, issued: +ta.toFixed(4), landed: +tl.toFixed(4), took: +took.toFixed(4), d: +d.toFixed(4), buf, fix};
    }, () => {});
  };
  const wait = (nx.t0 - t - est) * 1000 / base;
  s.cut = {nx, timer: 0};
  if (wait < 4) go(); else s.cut.timer = setTimeout(go, wait);
}
function cancelPre() {
  for (const s of st.vs.values()) {
    if (s.pre) { clearTimeout(s.pre); s.pre = 0; }
    s.cue = null;
    if (s.cut) { if (s.cut.timer) clearTimeout(s.cut.timer); s.cut = null; }
  }
}
// A clip parked on its frame; cold (a jump: every owned clip at once) on WebKit a loose one is moved with fastSeek, and
// one that lands further than FAST_MAX off is parked exactly (and seeked exactly from then on).
// (WK) A clip with its metadata but no frame (readyState 1) that already sits on the frame is parked 1 ms on: WebKit fetches
// a paused clip's frames only for a seek, so a lookahead clip parked at 0 (the stack cards) came on with nothing to show
// and started ~0.2 s behind (Simulator, Oct 1: three cards 'waiting' at their play()), where one parked by a real seek
// started on time. The same frame, off screen, the data fetched a few seconds early: what the lookahead is for.
function park(el, s, a, h, pt, fast) {
  if (WK && el.readyState === 1 && !el.seeking && Math.abs(el.currentTime - pt) < 1e-3) return void h.at(pt + 1e-3, {play: false, exact: true});
  if (!fast) return void h.at(pt, {play: false});
  h.at(pt, {play: false, fast: true}).then(() => {
    if (st.vs.get(el) !== s || s.a !== a || Math.abs(driftOf(el, pt, a)) <= FAST_MAX) return;
    exactOnly.add(el);
    h.at(pt, {play: false});
  }, () => {});
}
function syncVideos(t, now, {cold = false, hold = false} = {}) {
  // (a hidden tab: nothing to show; coming back, the page catches up with a cold sync. iPhone fixes, Sept 30: parking
  // clips from the lock screen only kept the audio waiting for their seeks in a page iOS may have suspended)
  if (document.hidden) return;
  const sg = SG(), want = new Map();
  // the ones the track holds at t (every video on screen), and the ones it takes within the next few seconds (parked early,
  // off screen, so they are buffered and on their first frame when they come on)
  for (const a of C.videos) {
    if (!a.ok() || a.t1 <= t || a.t0 > t + (a.ahead || LOOKAHEAD)) continue;
    const el = elOf(a); if (!el || el.error) continue; // (a clip that failed to load is left alone)
    const live = a.t0 <= t;
    if (live || !want.has(el)) want.set(el, {a, live});
  }
  for (const [el] of st.vs) if (!want.has(el)) release(el);
  // the audio is on its way (play() called on buffered audio, not yet sounding): clips start with it, not after it; audio
  // that still has to buffer holds them until it actually plays (the 'playing' event syncs them at once)
  // (clips on a tape's timeline wait for the audio's own 'playing': their lips must not run ahead of it)
  // (the tail, past the audio's end: the story's own clock runs the clips once it has started; no audio to wait for)
  const tail = st.tail, clockLive = tail ? tail.at != null : st.audioLive;
  const starting = !tail && st.audioWanted && !st.audioLive && st.startReady && now - st.startedAt < 500;
  const halted = !st.audioWanted || (tail ? tail.at == null : audio.paused || audio.seeking);
  const stalled = halted || (!clockLive && !starting), tapeStalled = halted || !clockLive;
  const base = audio.playbackRate || 1, frameDt = st.frameDt || FRAME;
  // (WK) how far the frame clock t holds ahead of the audio's own time (clock() holds a backward step, up to HOLD_FAR; one
  // frame of extrapolation is not a hold): the lips are judged against the audio, dA = d + ckHold
  const ckHold = WK && !tail ? Math.max(0, t - audioT() - FRAME) : 0;
  for (const [el, {a, live}] of want) {
    let s = st.vs.get(el);
    // a new action on the same timeline (lead-in -> tape -> run-out), or the one a cut already moved it onto, carries on
    const carried = !!s && s.a !== a && live && ((s.cut && s.cut.nx === a) || sameAt(s.a, a, t, WK ? W_ADOPT : SAME));
    const fresh = cold || !s || (s.a !== a && !carried);
    if (!s) st.vs.set(el, s = {a, last: -1e9, seekAt: -1e9, nudge: false});
    // (WK, taken cold or on a new timeline: a pending cue, its corrections so far and a start under measurement are over)
    if (WK && fresh) { s.free = false; s.fix = null; s.outAt = 0; s.startAt = 0; s.farAt = 0; if (s.cue != null) { s.cue = null; if (s.pre) { clearTimeout(s.pre); s.pre = 0; } } }
    if (s.a !== a && s.cut && s.cut.nx !== a) { if (s.cut.timer) clearTimeout(s.cut.timer); s.cut = null; }
    if (s.cut && s.cut.nx === a && live) s.cut = null;
    s.a = a;
    const h = sg.video(el);
    const tt = tight(a), wl = WK && (tt || a.lips); // (WK) on a tape's timeline, or a lips lead-in that is not (T04's)
    let {pt, play} = pageTime(a, live ? t : a.t0);
    if (!live || hold || (tt || wl ? tapeStalled : stalled)) play = false;
    if (!play) {
      // (WK) a pending cue: on a clip still to come on (a late start, cued again), left to it; the audio stopped under it:
      // dropped, the clip is parked, and started with the audio
      if (WK && s.cue != null) { if (!live && !hold && !stalled) continue; s.cue = null; if (s.pre) { clearTimeout(s.pre); s.pre = 0; } }
      // A fallback lead-in taken ahead (off screen): the element first fetches its cut target (seeked there, paused), then
      // parks on the lead-in's first frame, so the cut on the audio onset is a seek into data it already has.
      if (!live && a.prefetch) {
        if (!s.warm || s.warm.a !== a) {
          const nx = C.next.get(a), w = s.warm = {a, busy: true};
          s.last = now;
          h.at(pageTime(nx, nx.t0 + CUT_HOLD).pt, {play: false, exact: true})
            .then(() => { w.busy = false; if (st.vs.get(el) === s) s.last = -1e9; }, () => { w.busy = false; });
          continue;
        }
        if (s.warm.busy) continue;
      }
      // parked on the frame the next action starts from (the lookahead's, off screen; or held while the audio waits):
      // started a moment early, so it is moving on the cue
      // (checked a frame ahead, and timed to PRESTART before the cue wherever the frame tick falls)
      const nx = live ? (still(a) ? C.next.get(a) : null) : a;
      const pre = WK ? wkLeadOf(s) : PRESTART; // (WK: what play() takes there, learned, this element's own once measured; see the WebKit driver)
      if (!hold && !stalled && clockLive && nx && !still(nx) && nx.t0 - t <= pre + (WK ? W_ARM : frameDt) && Math.abs(pageTime(nx, nx.t0).pt - pt) < .03) {
        if (el.paused && !s.pre) {
          pitchFree(el, s);
          const go = () => {
            s.pre = 0;
            // (WK: nor one with no metadata yet: main.js would seek it once the metadata lands, by then playing; it starts once live)
            if (st.vs.get(el) !== s || st.state !== 'playing' || audio.paused || !el.paused || (WK && (!wkRunning() || el.readyState < 1))) return;
            s.seekAt = performance.now();
            if (WK) {
              const lead = nx.t0 - storyT(), late = lead < pre - W_LATE_START;
              if (late && nx.lips) return void wkCue(el, s, nx, h, storyT() + (pre + W_SEEK) * base, base, 1, pre); // (a lips clip is not started late: cued)
              s.startAt = s.began = s.seekAt; s.startLead = lead; s.startBuf = inBuf(el, el.currentTime) && !late;
            }
            // (WK: started where it is parked, never seeked in the same task as its play(): that would hold the picture
            // until the seek lands. A lips clip was parked exactly; a loose one within FAST_MAX, and starts where it is)
            h.at(pt, {play: true, rate: base, tolerance: WK ? 1e9 : .03});
          };
          const wait = (nx.t0 - t - pre) * 1000 / base;
          if (wait < 4) go(); else s.pre = setTimeout(go, wait);
        }
        continue;
      }
      // (WK: a lips clip held while the audio waits sits its start lead ahead of the story, so the play() it gets on the audio's
      // 'playing' lands it on the mix)
      if (fresh || !el.paused || now - s.last >= 250) { s.last = now; s.nudge = false; if (el.playbackRate !== 1) el.playbackRate = 1; park(el, s, a, h, pt + (WK && live && a.lips ? wkLeadOf(s) * base : 0), cold && fastOK(a, el)); }
      continue;
    }
    // (phones) a stack card out of sight: held where it is (see unseenCard)
    // (WK: and free from then on: when the deck brings it back, GRID_WAKE before it shows, it is cued onto its timeline while
    // still out of sight (one paused seek: held 0.3-1.2 s, it came back that far behind for the rest of its window), or, if
    // that frame is not in data it has, plays on from where it stopped)
    if (touchy() && unseenCard(el, t)) {
      if (!el.paused) { s.last = now; s.nudge = false; h.at(el.currentTime, {play: false}); }
      if (WK) { s.free = true; s.startAt = 0; }
      continue;
    }
    // A clip whose timeline has reached its file's end (mode play: the laugh reprise in the tail, which runs to its last
    // frame) rests there: it plays out on its own, and an ended element is never told to play again (play() would start it
    // over from 0). One stopped short of it (a jump into the tail) is set on its last frame.
    const dur = el.duration;
    if (a.p.mode === 'play' && dur > 0 && pt >= dur - .05) {
      if (el.paused && !el.ended && !el.seeking && el.currentTime < dur - .05) { s.last = now; s.nudge = false; if (el.playbackRate !== 1) el.playbackRate = 1; h.at(pt, {play: false}); }
      continue;
    }
    if (el.seeking) continue;
    // A clip the browser would not play without a tap (iOS Low Power Mode, an in-app browser; main.js marks the refusal,
    // __sgBlocked): held on its timeline, re-parked at most every BLOCKED_MS, not told to play on every frame; the next
    // press plays it inside the gesture (primeVideos) and it goes on from there.
    // (WK: a refused clip is a still, parked once on each new action's first frame and never stepped along its timeline:
    // stepped twice a second it was a slideshow, a minute of it on the phone. Oct 1)
    if (el.paused && el.__sgBlocked) {
      st.reprime = true;
      if (WK && srcOnly.has(el)) st.srcFails = true; // (a src set did not unlock it: see wkUnlock)
      if (WK ? fresh : now - s.last >= BLOCKED_MS) { s.last = now; s.nudge = false; h.at(pt, {play: false}); }
      continue;
    }
    if ((s.cut && !s.cut.timer) || s.cue != null) continue; // a cut has been seeked onto the next timeline: that action takes over on its cue (WK: or a cue is pending)
    // (WK) a clip with no metadata yet is held on its frame, not started: told to play, main.js would play it at once and seek
    // it once its metadata lands, a seek on a playing clip
    if (WK && el.paused && el.readyState < 1) { if (fresh || now - s.last >= 250) { s.last = now; s.nudge = false; h.at(pt, {play: false}); } continue; }
    pitchFree(el, s);
    // (WK: a lips clip waiting paused is parked its start lead ahead, see above; raw is how far ahead of the story its frame is;
    // dA: d against the audio's own time, what the lips are judged by)
    const raw = driftOf(el, pt, a), d = raw - (WK && el.paused && a.lips ? wkLeadOf(s) * base : 0), dA = d + ckHold, hard = tt ? TAPE_SEEK : LOOSE_SEEK;
    // (the browser's own loop: a clip sits on its last frame ~50 ms, then holds its first ~40 ms, so it comes out of the wrap
    // about 0.1 s behind; no seek for that, the rate closes it: no seek or nudge during the wrap, the harder nudge for 0.5 s)
    const wrapping = a.p.mode === 'loop' && !fresh && !el.paused && (el.currentTime > (el.duration || a.p.wrap) - .08 || el.currentTime < .04);
    if (wrapping) s.wrapUntil = now + 500;
    const backoff = !fresh && !el.paused && (now < (s.noSeekUntil || 0) || (tt && now < (s.wrapUntil || 0)));
    // A loose clip that has fallen behind is hard-seeked only into data it already has: on a slow link a seek into a range
    // still to come freezes it until the network delivers, it falls further behind, and the next seek does it again. It
    // plays on from what it has instead (the rate closing what it can), and the seek comes once its own read-ahead covers
    // the target (measured at 9 Mbps / 170 ms: the 'everywhere' grid froze 1-2.5 s at a time, over and over, before this).
    const starved = !tt && !fresh && !el.paused && Math.abs(d) > hard && !inBuf(el, pt + (s.lead ?? LEAD) * base);
    if (fresh || el.paused || (!WK && Math.abs(d) > hard && !backoff && !wrapping && !starved)) {
      // let the last seek land first (and a clip told to play that is still paused, its play() refused or not yet taken:
      // not told again on every frame; one the player parked itself is started at once)
      if (!fresh && (el.paused ? s.seekAt >= s.last && now - s.seekAt < 250 : now - s.seekAt < 400)) continue;
      if (WK && s.free && !fresh) { // a stack card comes back (see unseenCard)
        const L = wkLeadOf(s), cueT = t + (L + W_SEEK) * base;
        if (Math.abs(d) > W_CARD_OFF && inBuf(el, pageTime(a, cueT).pt)) { s.free = false; s.began = now; wkCue(el, s, a, h, cueT, base, 0, L); continue; }
        s.seekAt = now; s.last = now; s.began = now; h.at(el.currentTime, {play: true, rate: base, tolerance: 1e9}); continue;
      }
      // (WK, a clip on a tape's timeline: a lips clip, paused (waiting for the audio: where it would land, dA, outside its
      // band) or playing and taken cold outside its band; a run-out paused past .04 of its frame or playing past FAST_MAX:
      // cued, not seeked while it plays. A loose clip past FAST_MAX, paused or playing, is cued too (a fast seek lands on a
      // keyframe seconds away in the loose files); within it, it starts where it is, no seek)
      const off = wl ? (a.lips ? wkOut(a, t, dA) : Math.abs(d) > (el.paused ? .04 : FAST_MAX))
        : Math.abs(d) > (fresh || el.paused ? (tt ? .04 : LOOSE_ON) : hard);
      if (off) {
        if (WK) { s.startAt = 0; if (!wl) s.began = now; const L = wkLeadOf(s); if (wl || Math.abs(d) > FAST_MAX) wkCue(el, s, a, h, t + (L + W_SEEK) * base, base, 0, L); else catchUp(el, s, h, pt, d, base, now); continue; }
        if ((fresh || el.paused) && Math.abs(d) <= FAST_MAX && fastOK(a, el)) { catchUp(el, s, h, pt, d, base, now); continue; }
        seekPlaying(el, s, a, h, pt, base); continue;
      }
      s.seekAt = now; s.last = now; s.nudge = false;
      if (WK) { s.startAt = clockLive && el.paused ? now : 0; if (el.paused) s.began = now; s.startLead = raw + ckHold; s.startBuf = inBuf(el, el.currentTime); } // (a start to learn the lead from)
      h.at(pt, {play: true, rate: base, tolerance: 1e9});
      continue;
    }
    // (WK) a loose clip that has fallen past LOOSE_SEEK (a stack card: W_CARD_FAR) and stayed there (a network stall; no rate
    // here to close it): one cue into data it has, W_LOOSE_GAP_MS at least after its last command. Not a loop (ambient, and
    // the browser's own wrap is a seek WebKit makes on a playing clip, ~0.3 s on the phone, each time: not a drift to correct),
    // not a stack card playing on from where it stopped (s.free), not a lead-in whose cut is about to re-cue it.
    if (WK && !wl && !s.free && !wrapping && a.p.mode !== 'loop') {
      if (Math.abs(d) > (isCard(el) ? W_CARD_FAR : LOOSE_SEEK)) { if (!s.farAt) s.farAt = now; } else s.farAt = 0;
      if (s.farAt && now - s.farAt > W_LOOSE_FAR_MS && now - s.seekAt > W_LOOSE_GAP_MS) {
        const L = wkLeadOf(s), cueT = t + (L + W_SEEK) * base, nx = a.cutNext ? C.next.get(a) : null;
        if (!(nx && nx.t0 - cueT < L + W_SEEK) && inBuf(el, pageTime(a, cueT).pt)) { st.stats.fixes[a.id] = (st.stats.fixes[a.id] || 0) + 1; wkCue(el, s, a, h, cueT, base, 0, L); continue; }
      }
    }
    // an on-screen clip that will cut to a range it does not play through: that range warmed WARM_AHEAD s ahead (once the
    // audio is running, so it never competes with the mix's own start), even when the element fetched it itself earlier:
    // Chrome may have dropped that data since (Fast 4G, natural flow: T02's 0.00, in memory at 66.9, had to come off the
    // network again at the 88.12 cut)
    // (not on WebKit, iPhone fixes Sept 30: its network cache probably doesn't share 206 range responses between
    // elements, so on iOS a warm is one more AVPlayer and a duplicate range fetch, for nothing)
    if (!WEBKIT && a.warmCut && clockLive && s.warmed !== a) {
      const nx = C.next.get(a);
      if (nx.t0 - t < WARM_AHEAD && nx.t0 > t) {
        s.warmed = a;
        warmAt(el, pageTime(nx, nx.t0 + CUT_HOLD).pt, (nx.t0 - t) * 1000 / base + 1500);
      }
    }
    planCut(el, s, a, h, t, base, frameDt);
    if (!clockLive || (s.cut && !s.cut.timer) || wrapping) continue; // (a cut just issued: nothing to nudge on the old timeline)
    const ad = Math.abs(WK ? dA : d);
    let r = base;
    if (WK) wkWatch(el, s, a, h, t, dA, base, now); // (WK: no rate, no seek on a playing clip; a lips clip is watched, and re-cued rarely)
    else if (tt) {
      const boost = backoff || now - Math.max(s.seekAt, st.liveAt || 0) < BOOST_MS;
      if (!backoff && ad > TAPE_ALIGN && st.ck.moved && now - st.liveAt > 250 && now - s.seekAt > 1000) { seekPlaying(el, s, a, h, pt, base); continue; }
      if (!s.nudge && ad > TAPE_ON) s.nudge = true; else if (s.nudge && ad < TAPE_OFF) s.nudge = false;
      const g = boost ? BOOST_GAIN : TAPE_GAIN, cap = boost ? BOOST_MAX : TAPE_MAX;
      if (s.nudge) r = Math.round(base * (1 - clamp(d * g, -cap, cap)) * 200) / 200;
    } else {
      const boost = now < (s.boostUntil || 0); // (after a cut that landed late)
      if (!s.nudge && ad > LOOSE_ON) s.nudge = true; else if (s.nudge && ad < LOOSE_OFF) s.nudge = false;
      const g = boost ? BOOST_GAIN : LOOSE_GAIN, cap = boost ? BOOST_MAX : LOOSE_MAX;
      if (s.nudge) r = Math.round(base * (1 - clamp(d * g, -cap, cap)) * 200) / 200;
    }
    if (!WK && r !== el.playbackRate) el.playbackRate = r;
    // (counted once the start-up alignment has had its chance: 0.6 s after the audio is seen moving)
    if (now - s.seekAt > 300 && now - st.liveAt > 600) {
      const bump = (o, id) => { const k = o[id] || (o[id] = {n: 0, sum: 0, max: 0, at: 0, over: 0}); k.n++; k.sum += ad; if (WK) k.sd = (k.sd || 0) + dA; if (ad > k.max) { k.max = ad; k.at = +t.toFixed(3); } if (ad > 1 / 30) k.over++; };
      if (a.p.tape) bump(st.stats.tape, a.id);
      bump(st.stats.clips, a.id);
    }
  }
  // captions: only on the clips that are live on their tape at t (see "captions" below)
  const tape = new Set();
  for (const [el, {a, live}] of want) if (live && a.p.tape) tape.add(el);
  captions(tape);
}
// Captions (Josh, Sept 30: "Captions: hide them on the site", of the page's own captions showing on the muted lead-ins and
// run-outs). The page's captions are the browser-drawn VTT tracks (<track kind="captions" default>, styled by video::cue)
// on Ty's remix (mashup.vtt) and his making-of (making-of.vtt); no other page video has a text track (Carrasco's clip
// has its captions in the picture). In Play mode a clip's captions show only while its own voice is in the mix, i.e. while
// it is live on its tape action (the tape window, t_start..tail_end); on its muted lead-in and run-out, and on any other
// muted playback, its track is 'hidden' (the cues stay loaded and active, only not drawn, so they come back at once).
// Leaving Play (a pause, the end) gives every track back the mode it had: reader mode is as before.
// (iPhone fixes, Sept 30) A track the page marks default (<track default>, every caption track here) takes its mode from
// that attribute, not from the mode Play first saw it in: WebKit's automatic caption selection may not have shown it yet
// (a preload=none making-of copy), or may set it again later. So: 'showing' on its tape, 'hidden' elsewhere during
// Play, and 'showing' again on leaving Play. Any other track keeps the old rule (its own mode, saved and given back).
const capWas = new Map(); // a TextTrack without the default attribute -> its mode before Play took it
let capDefault = null;
const isDefault = tr => (capDefault ||= new Set([...document.querySelectorAll('video track[default]')].map(x => x.track))).has(tr);
function captions(tape) {
  for (const v of document.querySelectorAll('video')) for (const tr of v.textTracks) {
    if (tr.kind !== 'captions' && tr.kind !== 'subtitles') continue;
    let m;
    if (isDefault(tr)) m = tape.has(v) ? 'showing' : 'hidden';
    else {
      if (!capWas.has(tr)) capWas.set(tr, tr.mode);
      const was = capWas.get(tr);
      m = was === 'showing' && !tape.has(v) ? 'hidden' : was;
    }
    if (tr.mode !== m) tr.mode = m;
  }
}
function captionsBack() {
  for (const v of document.querySelectorAll('video')) for (const tr of v.textTracks) if (isDefault(tr) && tr.mode !== 'showing') tr.mode = 'showing';
  for (const [tr, m] of capWas) if (tr.mode !== m) tr.mode = m;
  capWas.clear();
}
function release(el) {
  const s = st.vs.get(el);
  if (s && s.pre) clearTimeout(s.pre);
  if (s && s.cut && s.cut.timer) clearTimeout(s.cut.timer);
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
  const guard = (k, f) => { try { f(t, cold, rmo); } catch (e) { warn(k, e); } }; // (a hook that throws stops nothing else)

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
  guard('monster', monster);
  guard('headless', headless);
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
  guard('hat', hat);
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
  const moved = viewportMoved();
  if (st.lastY != null && drifted(now, moved)) return pause('scroll');
  // The audio plays on without having said so ('playing' not fired again after a seek it made by itself, or a stall it
  // got over: WebKit, where the press's own seek landed 20 ms after 'playing' and left every clip parked): seen moving
  // past where it last stopped, it is live.
  if (!st.audioLive && st.audioWanted && !st.tail && !audio.paused && !audio.seeking && audio.readyState >= 3 && st.deadA != null && audio.currentTime > st.deadA + .05) audioLiveNow();
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
  if (st.phase === 'run' && !st.tail && t >= AEND()) toTail(t, now); // the mix is over; the story may run on (the tail)
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
  if (st.tail) { // a jump into the tail: no audio to start (it stays at its end); the story's clock starts here, held for
    // the PRESTART a clip told to play takes to move (measured, section "videos"), so the clips start on it
    st.tail.at = st.startedAt + PRESTART * 1000;
    syncVideos(st.tail.t0, st.startedAt);
    return;
  }
  st.startReady = audio.readyState >= 3;
  resetClock(audioT(), true); // (the time the audio was sent to, while WebKit has not taken the seek yet)
  st.deadA = st.ck.last;
  const p = audio.play();
  try { syncVideos(st.ck.last, st.startedAt); } catch (e) { warn('videos', e); } // every clip that should be moving starts with the audio, not after it
  watchAudio(st.startToken);
  if (p) p.catch(err => {
    if (!st.audioWanted || st.state !== 'playing') return;
    if (err && err.name === 'AbortError') return;
    console.warn('[play] the audio would not start:', err && err.name);
    if (err && err.name === 'NotAllowedError') st.needGesture = true; // next press: the audio starts inside it
    pause(err && err.name === 'NotAllowedError' ? 'blocked' : 'error');
  });
}
// The watchdog (iPhone fixes, Sept 30). Resume, Replay and seeks start the audio outside the press (after the glide, or
// from a fetch). Only a rejected play() was handled; after an audio interruption (a call, Siri, another app) WebKit may
// defer or drop a play() without rejecting it, and the story sat in 'playing' with no sound and a frozen clock. So
// WATCH_MS after play(): if the audio is still paused, or has all it needs and has not moved at all, the story pauses
// ('stalled') and the next press starts the audio inside itself (the needGesture path, resume()).
const WATCH_MS = 1500;
function watchAudio(token) {
  clearTimeout(st.watch);
  const a0 = audio.currentTime;
  st.watch = setTimeout(() => {
    if (st.startToken !== token || st.state !== 'playing' || !st.audioWanted || st.tail) return;
    if (!audio.paused && !(audio.readyState >= 3 && !audio.seeking && audio.currentTime === a0)) return;
    console.warn('[play] the audio did not start');
    st.needGesture = true;
    pause('stalled');
  }, WATCH_MS);
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
// A touch pause (iPhone fixes, Sept 30), at a rest or between two: snapping stays off while the finger is on the glass
// (WebKit may re-snap the page under the finger when it comes back mid-pan, or snap from a stale index left by the
// player's own scrolls). It comes back once the last finger lifts, with the first scroll after that (the pan's own
// momentum, which it then joins) or SNAP_LIFT_MS later. A tap between two rests that panned nothing keeps the hold
// above, until the reader's own next scroll input.
const SNAP_LIFT_MS = 150;
let snapUndo = null; // takes down whatever is waiting to bring snapping back
function snapHold(on, {touch = false, between = false} = {}) {
  if (snapUndo) { snapUndo(); snapUndo = null; }
  root.style.scrollSnapType = on ? 'none' : '';
  if (!on) return;
  const L = [];
  let timer = 0, panned = false;
  const listen = (ty, f) => { addEventListener(ty, f, {capture: true, passive: true}); L.push([ty, f]); };
  snapUndo = () => { for (const [ty, f] of L) removeEventListener(ty, f, true); clearTimeout(timer); };
  if (!touch) {
    const back = e => {
      if (e.type === 'keydown' && (MODS.has(e.key) || (onPlay(e) && pressKey(e)))) return;
      snapHold(false);
    };
    for (const ty of ['wheel', 'touchmove', 'keydown']) listen(ty, back);
    return;
  }
  const lift = e => {
    if (e.touches && e.touches.length) return; // a finger still down
    if (between && !panned) return snapHold(true); // a tap off every snap point: the plain hold
    snapUndo(); L.length = 0;
    listen('scroll', e => { if (e.target === document || e.target === root) snapHold(false); });
    timer = setTimeout(() => snapHold(false), SNAP_LIFT_MS);
  };
  listen('touchmove', () => { panned = true; });
  listen('touchend', lift);
  listen('touchcancel', lift);
}
function leavePlay(touch = false) {
  const T = storyT();
  const between = !!st.glide || (!!st.mv && !reduced() && T < st.mv.t1 && T >= st.mv.t0 - .05);
  st.tail = null;
  cancelAnimationFrame(st.raf); st.raf = 0;
  cancelPre();
  st.phase = null; st.glide = null; st.lastY = null; st.audioWanted = false; st.startToken = (st.startToken || 0) + 1; st.tickAt = 0;
  st.driftAt = 0; clearTimeout(st.watch);
  for (const [el, s] of st.vs) unrate(el, s);
  st.vs.clear();
  captionsBack(); // every caption track as it was before Play
  // WebKit brings snapping back to the point where the reader's LAST finger scroll ended, not the nearest one (iPhone,
  // Sept 30: a pause on a one-screen card, by a tap or the pill, threw the page back to the cold open or the cover after
  // a swipe made before Play). So on WebKit every pause keeps the hold until the reader's own next scroll input; a pan
  // that paused the story is that input (it ended where the finger left the page), so the lift path stays.
  if (touch) snapHold(true, {touch: true, between: between || WEBKIT}); else if (between || WEBKIT) snapHold(true);
  const sg = SG();
  if (sg && sg.mode() === 'play') sg.mode('reader'); // every owned video, reveal and flag back to the page, snap and sound too
  root.style.overflowAnchor = '';
  if (WK) setTimeout(wkFps, 500); // (WK: the next press's Low Power Mode evidence, if the page has none yet, measured at rest)
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
  try { // (a hook that throws never keeps the audio from starting)
    apply(t, {cold: true});
    syncVideos(t, now, {cold: true, hold: true}); // (not while hidden: see syncVideos)
  } catch (e) { warn('cold', e); }
  const m = lastMove(t);
  st.mv = m || undefined; st.mvY0 = m ? restBefore(m) : 0;
  try { stage(t, true); } catch (e) { warn('stage', e); }
  const y = targetY(t);
  st.lastY = null; // (the reader's own scroll may still be settling: the drift check starts from the player's first scroll)
  if (glide && wait && !reduced() && !document.hidden && Math.abs(y - scrollY) > 2) { st.phase = 'glide'; glideTo(y, {wait: true, t}); }
  else {
    st.phase = 'run';
    if (glide && !reduced() && !document.hidden && Math.abs(y - scrollY) > 2) glideTo(y, {wait: false}); else setScroll(y);
    // (in a press: at once, inside it. Hidden (the lock screen; iPhone fixes, Sept 30): at once too, with no clips to wait
    // for, since a deferred play() may only run once iOS wakes the page again, i.e. when the phone is unlocked)
    if (inPress || document.hidden) startAudio(); else startWhenParked();
  }
  progress(t);
  schedule();
}
function seekAudio(t) {
  t = clamp(t, 0, END());
  st.tail = t >= AEND() && END() > AEND() + .001 ? {t0: t, at: null} : null; // past the audio's end: the tail, from t
  t = Math.min(t, C.D);
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
  try { // (a hook that throws never keeps the audio from starting inside the press)
    apply(t, {cold: true});
    syncVideos(t, performance.now(), {cold: true, hold: true});
    stage(t, true);
  } catch (e) { warn('cold', e); }
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
function pause(why, touch = why === 'touch') {
  if (st.state === 'loading') { st.state = 'idle'; st.pendingSeek = null; setButton('idle'); return; }
  if (st.state !== 'playing') return;
  st.pausedAt = st.phase === 'glide' && st.glide && st.glide.wait ? st.glide.t : storyT();
  st.state = 'paused';
  st.audioWanted = false;
  audio.pause();
  st.stats.pauses.push([why, Math.round(st.pausedAt * 100) / 100]);
  leavePlay(touch);
  setButton('paused');
  session('paused');
}
function finish() {
  st.state = 'ended';
  st.audioWanted = false;
  audio.pause();
  leavePlay();
  setButton('ended');
  progress(C.E);
  session('ended');
}
// Inside a press (iPhone fixes, Sept 30): the mix is played and paused at once, so a strict browser lets the player start
// it after the press is over (a resume after its glide, the track arriving), even if the work below were to throw before
// its own play(). On a touch device (or after a clip was refused), the page videos the story is about to show are too,
// muted: iOS in Low Power Mode, and in-app browsers, refuse play() without a tap even for a muted video, and a play()
// inside a tap is what lifts that, per element (main.js's unlockSound does the same for page sound).
// Only those about to be shown, because a play() makes WebKit fetch the file: priming all 26 at once pulled 140 MB of
// clips the page had not fetched yet within 2 s of the press (iOS 18.3 Simulator, local server), every file in full, all
// at once, ahead of the mix. So: the clips the track owns from t to t + PRIME_AHEAD (which the lookahead would load a few
// seconds later anyway), those on or next to the screen (a first press before the track has arrived), and any clip that
// was refused since the last press (held meanwhile, see syncVideos). A clip refused later is primed by the next press.
// (WK, iPhone stutter fix, Oct 1) On the phone, in Low Power Mode, only the clips primed inside a press ever played: from
// 36 s to 97 s of the story every clip on screen was refused and stood still (re-parked twice a second, a slideshow) until
// the next press. So on WK every press primes what the build always primed (a clip refused since the last press first:
// the story needs it now), and, with evidence of Low Power Mode (wkLpm: a refusal seen, or rAF at a steady 30 a second on
// the page as it loaded, see wkFps), unlocks every other clip the story still needs (wkUnlock). Without that evidence nothing
// more: the first press on a phone that is not in Low Power Mode costs what it always did (0.1-5 MB), not the 39-69 MB a
// blanket prime asked for.
const PRIME_AHEAD = 20;
const primed = new WeakSet();
// (WK) Clips 'unlocked' by a src set alone. If one of them is refused anyway (st.srcFails: on this phone a src set does not
// lift the Low Power Mode restriction), none of them counts as primed any more: the next press plays them, as 'pp' would.
const srcOnly = new WeakSet();
const isPrimed = v => primed.has(v) && !(st.srcFails && srcOnly.has(v));
const srcOf = v => v.currentSrc || v.querySelector('source')?.src || v.src || '';
function primeAudio() { try { const p = audio.play(); audio.pause(); p?.catch(() => {}); } catch {} }
function primeVideos(t) {
  const lpm = WK && wkLpm(); // (WK: read before the refusal flag below is cleared: a refusal is evidence)
  st.reprime = false;
  const els = [], seen = new Set(), add = v => { if (v && !seen.has(v)) { seen.add(v); els.push(v); } }; // (in priority order)
  if (WK) for (const v of document.querySelectorAll('video')) if (v.__sgBlocked) add(v);
  if (C && t != null) { for (const a of C.videos) if (a.ok() && a.t1 > t && a.t0 < t + PRIME_AHEAD) add(elOf(a)); }
  for (const v of document.querySelectorAll('video')) {
    if (v.__sgBlocked) { add(v); continue; }
    const r = v.getBoundingClientRect();
    if (r.bottom > -innerHeight && r.top < 2 * innerHeight && r.width) add(v);
  }
  st.primed = {played: 0, of: els.length, track: !!(C && t != null)}; // (for tests: what this press primed)
  if (WK) { const f = fpsNow(); Object.assign(st.primed, {lpm, fps: f ? +f.med.toFixed(1) : 0, fps30: f ? +f.s30.toFixed(2) : 0, fpsFast: f ? +f.fast.toFixed(2) : 0, fpsN: f ? f.n : 0, fpsDone: !!fps.ev, unlock: lpm ? W_UNLOCK : null, srcFails: !!st.srcFails, unlocked: 0, whole: 0, src: 0}); }
  let n = 0; const played = []; // (WK: the clips this press plays, refused ones aside; and every one it plays, for wkUnlock's per-file rule)
  for (const v of els) {
    if (WK && v.__sgBlocked && !v.paused) { delete v.__sgBlocked; primed.add(v); srcOnly.delete(v); continue; } // (played in a gesture since: unlocked)
    if ((isPrimed(v) && !v.__sgBlocked) || !v.paused || v.ended) continue; // (play() would rewind an ended one)
    st.primed.played++;
    if (!v.__sgBlocked) n++;
    played.push(v);
    unlockOne(v, 'pp');
  }
  if (lpm) wkUnlock(t, played, n);
}
// One element, inside the press. 'pp': play() and pause() at once, muted. 'src' (WK, see wkUnlock): the element's own URL set
// as its src attribute, which runs the media element load algorithm (prepareForLoad, which in a gesture lifts the
// restriction) without preparing the element to play, so its preload attribute still holds and a preload=none element
// fetches nothing. (play() prepares it to play, and from then on WebKit's effective preload for it is 'auto' for good,
// HTMLMediaElement::effectivePreloadValue: the whole file. An explicit load() lifts the restriction too, but load() also
// prepares to play: the whole file again, 185 MB for 25 elements in the 5 s after a press in the Simulator.)
function unlockOne(v, how) {
  primed.add(v);
  delete v.__sgBlocked;
  v.muted = true;
  try {
    if (how === 'src') { srcOnly.add(v); const u = srcOf(v); if (u) v.setAttribute('src', u); return; }
    srcOnly.delete(v);
    const p = v.play();
    v.pause();
    p?.catch(e => { if (e && e.name === 'NotAllowedError') { v.__sgBlocked = performance.now(); primed.delete(v); } });
  } catch {}
}
// (WK) With Low Power Mode evidence, every other page video the story still needs is unlocked in the press too. WebKit adds
// the Low Power Mode restriction to a <video> when the element is created with the mode on, and lifts it for good on an
// element whose play() runs in a gesture, or whose media element load algorithm does (prepareForLoad(): load(), or a src
// attribute set); nothing adds it back (HTMLMediaElement.cpp). In story order: the track's clips from t on, or, before the
// track has arrived (a first press: its fetch begins with the tap's pointerdown, the click comes ~100 ms later), the page's
// videos in document order from the first on or below the top of the screen (the page is in story order). Left alone: one
// unlocked already, and one main.js's unlockSound played inside a tap (dataset.primed: unlocked, and already fetching).
// How (W_UNLOCK, ?unlock=):
//  - 'mix', the default until a phone in Low Power Mode shows whether a src set unlocks. First play()+pause() ('pp': proven,
//    and a whole-file fetch each) on at most W_PRIME_MAX clips in all, the old build's set above included (12: the phone took
//    a batch of 10 in 113 ms, the Simulator 12 never-loaded ones with a worst frame of 270 ms, inside the old press's own
//    204-406 ms; the one larger batch on the phone, 26 played unmuted by main.js's unlockSound on a tap, was followed by a
//    2.8 s frame), one element per media file (a later copy of a file this press fetches waits: with the track, a copy first
//    needed past W_PRIME_AHEAD s of t; without it, any later copy in the page: the story never needs two copies of one file
//    within 119 s of each other). Then a src set (no fetch, see unlockOne) on every other clip the story still needs that was
//    never played or positioned (srcSafe). From the cover: pp on the first reel and T03 (to 212.7 s), a src set on all the
//    rest. If a src set lifts the restriction on the phone, one press plays every clip; if it does not, the clips past the cap
//    are stills until the next press, exactly as with 'pp' alone (the src set changes nothing else on such a clip): the first
//    refusal of a src-only clip sets st.srcFails, and from then on those clips count as unprimed and every press is 'pp'.
//  - 'src': a src set on every clip that was never played or positioned, pp on the others (already loading or loaded:
//    nothing more to fetch), no cap. It rests on the same WebKit path as the phone test's 'load' row (prepareForLoad in a
//    gesture): if that row plays on a phone in Low Power Mode while the control is refused, this is the method to ship (one
//    constant, W_UNLOCK).
//  - 'pp': pp only, capped and one per file as in 'mix', no src set (the previous build's method, for A/B).
// In every method a clip that already holds its whole file (a preload=metadata copy a fast link filled at load) is played and
// paused, outside the cap: nothing to fetch, where a src set would throw the file away.
// srcSafe: never positioned or played (data-begun: main.js's data-start and video manager, the player's own seeks; a seek on a
// preload<auto element prepares it to play), not unlocked by main.js, not asked to load whole (preload none or metadata).
// WebKit's effective preload for it is then still its attribute, so a src set fetches only that again: nothing, or the
// metadata. On a clip that was played or positioned it would drop the buffer, put it back to 0 (one begun in reader mode
// would start over from 0, its data-start applied only once) and, since WebKit's effective preload stays 'auto' once an
// element was prepared to play, fetch the whole file again.
const srcSafe = v => !v.dataset.begun && !v.dataset.primed && v.preload !== 'auto';
const holdsAll = v => { const b = v.buffered; return v.readyState >= 3 && b.length > 0 && b.end(b.length - 1) >= v.duration - .5; };
function wkUnlock(t, played, n) {
  if (PRIMEQ === 'none') return;
  const srcOK = W_UNLOCK !== 'pp' && !st.srcFails; // (src sets failed on this device: from here on, 'pp')
  let left = (W_UNLOCK === 'src' && st.srcFails && PRIMEQ == null ? 12 : W_PRIME_MAX) - n; // (pp: the press's own plays count)
  const list = [], first = new Map(), perFile = PRIMEQ !== 'all', files = new Set(played.map(srcOf));
  if (C && t != null) {
    for (const a of C.videos) { if (!a.ok() || a.t1 <= t) continue; const el = elOf(a); if (el && !first.has(el)) { first.set(el, a.t0); list.push(el); } }
  } else {
    let on = false;
    for (const v of document.querySelectorAll('video')) { const r = v.getBoundingClientRect(); if (!on && r.bottom > 0 && r.width) on = true; if (on) list.push(v); }
  }
  for (const v of list) {
    if (isPrimed(v) || !v.paused || v.ended || v.error) continue;
    if (v.dataset.primed === '1' && !v.__sgBlocked) { primed.add(v); continue; } // (unlockSound's play() in a tap)
    if (holdsAll(v)) { st.primed.whole++; unlockOne(v, 'pp'); continue; }
    const f = srcOf(v), safe = srcSafe(v);
    const pp = W_UNLOCK === 'src' && srcOK ? !safe : !(perFile && files.has(f) && (!first.has(v) || first.get(v) >= t + W_PRIME_AHEAD));
    if (pp && left > 0) { left--; files.add(f); st.primed.unlocked++; unlockOne(v, 'pp'); }
    else if (safe && srcOK) { st.primed.src++; unlockOne(v, 'src'); }
  }
}
// The Play control. Every path that can start the audio does it inside this press. (ev: the control's own click, a
// gesture; the lock screen's play has none.)
function press(ev) {
  const sg = SG();
  if (!sg || sg.mode() === 'render') return;
  if (st.state === 'playing' || st.state === 'loading') return pause('button');
  if (ev) {
    primeAudio();
    // (where the story is about to go: the resume point, the top for Replay, the first press's unit)
    if (touchy() || st.reprime) primeVideos(!C ? null : st.state === 'paused' ? resumeT(st.pausedAt) : st.state === 'ended' ? 0 : firstT());
  }
  switch (st.state) {
    case 'paused': return resume();
    case 'ended': return jump(0, {glide: true});
  }
  if (C) return start(firstT());
  // The track isn't here yet: the audio was started and stopped inside the press (above; so a strict browser lets it play
  // later), and the story starts the moment the track arrives.
  if (!ev) primeAudio();
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
const onPlay = e => e.target instanceof Element && !!e.target.closest('#play-toggle,[data-sg-play]');
const pressKey = e => e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';
let touch0 = null;
function interact(e) {
  if (!e.isTrusted) return;
  if (e.type === 'touchstart' || e.pointerType === 'touch') touched = true; // (a touch device: see drifted())
  if (st.state !== 'playing' && st.state !== 'loading') return;
  // the reader's last input, for the drift check (not the control's own press)
  if (!(onPlay(e) && e.type !== 'wheel' && (e.type !== 'keydown' || pressKey(e)))) st.inputAt = performance.now();
  switch (e.type) {
    case 'keydown':
      if (MODS.has(e.key) || MEDIA_KEYS.test(e.key)) return;
      if (onPlay(e) && pressKey(e)) return; // the control's own press
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
      return pause(e.type, e.pointerType === 'touch'); // (a finger's pointerdown comes before its touchstart)
    default: // wheel (even over the control: it scrolls the page)
      return pause(e.type);
  }
}
for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'click', 'keydown']) addEventListener(type, interact, {capture: true, passive: true});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (WK && fps.on) { fps.on = false; fps.gen++; } // (WK: a rAF sample stops with the page hidden; its stale callback is ignored)
    if (st.state === 'playing' || st.state === 'loading') pause('hidden');
    return;
  }
  if (WK) wkFps(); // (WK: a page that has no complete rAF sample yet, hidden as it loaded, samples now; not while the story plays)
  // Back from the lock screen with the story still playing (resumed from the media controls): the page catches up.
  if (st.state === 'playing' && st.phase === 'run') {
    const t = storyT();
    st.c = {}; apply(t, {cold: true}); syncVideos(t, performance.now(), {cold: true});
    const m = lastMove(t); st.mv = m || undefined; st.mvY0 = m ? restBefore(m) : 0;
    stage(t, true);
    st.lastY = null;
    if (!reduced()) glideTo(targetY(t), {wait: false});
    schedule();
  }
});

/* ---------------- the audio's own events ---------------- */
// The audio is live (its own 'playing', or seen moving: see tick): its clock runs from here, and the clips move now, not a
// frame later. (Not a 'playing' queued by a press's play()+pause() prime, which lands with the audio paused.)
function audioLiveNow() {
  if (audio.paused) return;
  st.audioLive = true;
  resetClock(audioT(), true);
  if (st.state === 'playing' && st.phase === 'run' && C) {
    syncVideos(st.ck.last, performance.now());
    msPosition(); // the lock screen's scrubber runs from where the audio actually starts
  }
}
if (audio) {
  audio.addEventListener('playing', audioLiveNow);
  audio.addEventListener('waiting', () => { st.audioLive = false; st.deadA = audio.currentTime; });
  audio.addEventListener('seeking', () => { st.audioLive = false; st.deadA = audio.currentTime; });
  audio.addEventListener('ended', () => { if (st.state === 'playing') toTail(); }); // the end, or the tail (a no-op once it has begun)
  audio.addEventListener('error', () => { console.warn('[play] the mix failed to load'); if (st.state === 'playing' || st.state === 'loading') pause('error'); });
  // Paused by something else (an OS interruption, headphones pulled): the story pauses with it.
  audio.addEventListener('pause', () => {
    if (st.state !== 'playing' || !st.audioWanted || !audio.paused) return; // (a pause of ours can land after a restart)
    if (audio.ended) toTail(); else pause('audio');
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
      msSet('seekbackward', d => seekTo(storyT() - (d.seekOffset || 10)));
      msSet('seekforward', d => seekTo(storyT() + (d.seekOffset || 10)));
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
  for (const b of [btn, ...extra]) {
    for (const type of ['pointerenter', 'focus']) b.addEventListener(type, warm, {passive: true});
    for (const type of ['pointerdown', 'touchstart']) b.addEventListener(type, buffer, {passive: true});
    b.addEventListener('click', e => press(e));
  }
  // A read-only view for tests and debugging (never needed by the page).
  window.__sgPlay = {
    version: 1,
    get t() { return storyT(); }, // the story's time: the audio's, and past its end the tail's
    state: () => ({state: st.state, phase: st.phase, t: storyT(), tail: !!st.tail, pausedAt: st.pausedAt, glide: !!st.glide, lastY: st.lastY, scrollY,
      target: C && st.state === 'playing' ? restOf(st.mv || {}) : null, move: st.mv ? st.mv.a.id : null, owned: [...st.vs.keys()].map(v => (v.currentSrc || '').split('/').pop()),
      audio: {paused: audio.paused, rate: audio.playbackRate, live: st.audioLive}, stats: st.stats, env: {touch: touchy(), webkit: WEBKIT, wkPhone: WK_PHONE, wk: WK, prime: [W_PRIME_AHEAD, W_PRIME_MAX], unlock: W_UNLOCK, primed: st.primed || null, wkStart: +wk.start.toFixed(3), wkLags: wk.lags.map(x => +x.toFixed(3)), fps: +((fpsNow() || {}).med || 0).toFixed(1), fpsDone: !!fps.ev, lpm: WK && wkLpm()}, clock: st.ck.last}),
    seek: t => seekTo(Number(t)),
    rest: () => (C && st.mv ? restOf(st.mv) : null),
    storyY: t => { if (!C) return null; const m = lastMove(t); if (!m) return 0; const y1 = restOf(m); if (t >= m.t1) return y1; const y0 = restBefore(m); return y0 + (y1 - y0) * m.e((t - m.t0) / (m.t1 - m.t0)); },
    pageTime: (id, t) => { const a = C && C.track.find(x => x.id === id); return a ? pageTime(a, t).pt : null; },
    // fires the Media Session action the story has installed (what the lock screen or a media key would do)
    sessionAction: (name, details = {}) => { const f = ours[name]; if (typeof f !== 'function') return false; f({action: name, ...details}); return true; },
  };
}
