// Who is Jean Phil? · interactions
import {parseQuote, parseHistory, selectPeriod, chartGeometry, QUOTE_URL, HISTORY_URL} from './assets/js/market-data.mjs';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Sound defaults to on, but browsers only allow it after the reader's first tap or key press (see unlockSound).
const state = {autoplay: !reduced, sound: true, unlocked: false, refused: false};
const swap = {under: document.querySelector('#swap-under'), over: document.querySelector('#swap-over'), playing: false, inView: false, userPaused: false};

/* ---------------- Play mode and render mode (window.__sg, assembled at the end of this file) ----------------
   Reader mode is the page as it has always been, and nothing here changes it until a player calls __sg.mode().
   'play' (the Play button: the finished mix drives the page) and 'render' (the frame renderer, under a virtual
   clock) take the page's own automation out of the way so it can't fight the clock: page sound stays off (the mix
   already carries every tape), Autoplay is on for the run, the videos a player owns are left alone, and the one-shot
   arrival runs (coin pile, swap hint, laugh reprise; the hat and the copy machine are told) wait for the player.
   'reader' hands everything back where it is. */
const urlFlags = new URLSearchParams(location.search);
const REVEALABLE = '.reel-card, .reach, .offspring, .poles, .four--blank, .slide--tako, .paths'; // the one-shot .in reveals
const sg = {
  mode: 'reader',
  owned: new Set(),     // <video>s a player drives: the video manager, the swap and the reprise leave them alone
  onDrive: new Map(),   // video -> callback when a player drives it (the swap's button, the reprise's once-only flag)
  reveals: new Map(),   // .in holders a player drives -> {state: 'reset'|'scrub'|'end'|'paths', anims, v}
  scenes: new Map(),    // [data-scrolly] section -> {activate, soft}
  grids: new Map(),     // grid key -> {grid, cells, focus, stack}
  readerAutoplay: null, // the reader's Autoplay setting, kept while a player runs
  notesSnap: true,      // what the notes rule wants for html.snap
  pileNoAuto: false, swapNoHint: false, repriseNoAuto: false,
  swapApi: null, repriseApi: null, wallApi: null,
  market: {snapshotOnly: urlFlags.get('snapshot') === '1' || urlFlags.get('render') === '1', drawP: 1, inspectI: undefined, impl: null},
  pile: {k: null, sel: undefined, impl: null},
};
const driven = () => sg.mode !== 'reader';
const rendering = () => sg.mode === 'render';
const ownsReveal = el => driven() && sg.reveals.has(el);

/* ---------------- Masthead: solid bar, progress, current reel ---------------- */
const masthead = $('#masthead');
const reelLinks = $$('.reels a');
const reelCards = $$('[data-reel-section]');
function onScroll() {
  const y = scrollY, h = document.documentElement.scrollHeight - innerHeight;
  masthead.classList.toggle('solid', y > innerHeight * 1.2);
  masthead.style.setProperty('--p', h > 0 ? Math.min(1, y / h) : 0);
  $('.progress i').style.setProperty('--p', h > 0 ? Math.min(1, y / h) : 0);
  let current = null;
  for (const card of reelCards) if (card.getBoundingClientRect().top < innerHeight * .5) current = card.dataset.reelSection;
  reelLinks.forEach(a => a.classList.toggle('on', a.dataset.reel === current));
}
addEventListener('scroll', onScroll, {passive: true});
addEventListener('resize', onScroll);
onScroll();

/* ---------------- Reveal-on-view helper ---------------- */
const revealIO = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) {
    if (ownsReveal(e.target)) continue; // a player is drawing this one on its words (__sg.reveal)
    e.target.classList.add('in'); revealIO.unobserve(e.target);
  }
}, {threshold: .25});
$$(REVEALABLE).forEach(el => revealIO.observe(el));

/* ---------------- Snapping: one frame per swipe for the story; the notes scroll freely ---------------- */
const root = document.documentElement;
root.classList.add('snap');
const notesSection = $('#notes');
if (notesSection) {
  new IntersectionObserver(([e]) => {
    sg.notesSnap = !e.isIntersecting && e.boundingClientRect.top > 0;
    if (!driven()) root.classList.toggle('snap', sg.notesSnap); // while a player runs, it owns html.snap
  }, {rootMargin: '0px 0px -35% 0px'}).observe(notesSection);
}

/* ---------------- Video manager ----------------
   Every stage video plays its whole file, with its own sound, and loops it (the native loop attribute).
   data-start is where it begins the first time it plays; from there it runs to the end and loops the full file.
   With page sound on, exactly one video is unmuted: the lead (the active stage video most in view; in a grid,
   the focused cell), or the swap's original while the swap plays in view, or the laugh reprise during its laugh.
   (full-result.mp4 and donkey-source.mp4 are page copies trimmed to Jeferson's 3.20-58.20 s, so they
   can't play his unverified opening line or TikTok's end card at all.) */
const autoVideos = $$('video[data-auto]');
const repriseVideo = $('video[data-reprise]');
const allVideos = () => [...autoVideos, swap.under, swap.over, repriseVideo].filter(Boolean);
const reprise = {token: null, audible: false, running: false, timer: 0};
const gridFocus = new Map(); // grid figure -> the cell video that's heard
const visible = new Map();
// After the story pauses, page sound stays off (hushed) until the reader's next tap or key: a pause is silent, even with
// sound unlocked earlier, and the gesture that paused the story is not itself a tap for sound (onFirstGesture).
let hushed = false;
const soundOn = () => state.sound && state.unlocked && !driven() && !hushed; // while a player runs, the mix is the only sound
function isActiveMedia(v) {
  const fig = v.closest('.stage-media');
  return !fig || fig.classList.contains('is-active');
}
// Every grid is a 3D stack (makeStack, below), at every width: only its front clip plays; the ones behind it are benched.
// The front clip flies around while the reader thumbs through, so it counts as seen when the stack is.
function benched(v) {
  const g = v.closest('.stage-media--grid');
  return !!g && g.classList.contains('is-stack') && gridFocus.get(g) !== v;
}
function seen(v) {
  const g = v.closest('.stage-media--grid');
  return (g && g.classList.contains('is-stack') ? visible.get(v.closest('.grid4')) : visible.get(v)) || 0;
}
function primaryVideo() {
  let best = null, bestRatio = 0;
  for (const v of autoVideos) {
    const r = seen(v);
    if (isActiveMedia(v) && !benched(v) && r > bestRatio) { best = v; bestRatio = r; }
  }
  return bestRatio > .3 ? best : null;
}
const inActiveGrid = v => !!v.closest('.stage-media--grid') && isActiveMedia(v) && !benched(v) && seen(v) > .15;
// The one video that may be heard right now.
function audibleVideo() {
  if (reprise.token && reprise.audible) return repriseVideo;
  if (swap.playing && swap.inView) return swap.under;
  const lead = primaryVideo();
  const grid = lead && lead.closest('.stage-media--grid');
  return grid ? gridFocus.get(grid) || lead : lead;
}
function applySound() {
  const target = soundOn() ? audibleVideo() : null;
  for (const v of allVideos()) {
    if (v.dataset.probing && !driven()) continue;
    v.muted = !(v === target && v.dataset.primed);
  }
}
// The first time a video plays, it begins at data-start. Setting currentTime before the metadata has loaded
// sets the default playback start position; the loadedmetadata check covers a browser that ignores it.
function applyStart(v) {
  if (v.dataset.begun) return;
  v.dataset.begun = '1';
  const t = Number(v.dataset.start);
  if (!(t > 0)) return;
  if (v.readyState < 1) v.addEventListener('loadedmetadata', () => { if (v.currentTime < t - 1) v.currentTime = t; }, {once: true});
  v.currentTime = t;
}
// iOS pauses a video that gets unmuted outside a tap, and refuses to play it unmuted.
// If that happens, fall back to muted playback instead of leaving it stopped.
// Sound is on by default. Where the browser allows sound without a tap (some in-app browsers, or a desktop
// browser the reader has used here before), the lead video simply starts with sound. Otherwise it plays
// muted, and the first tap anywhere turns sound on (see unlockSound). The probe only ever unmutes the lead.
let probed = false;
function probeSound(v) {
  probed = true;
  v.dataset.probing = '1';
  v.muted = false;
  return v.play().then(() => {
    delete v.dataset.probing;
    state.unlocked = true;
    for (const x of allVideos()) x.dataset.primed = '1';
    renderSound();
    applySound();
  }, err => {
    delete v.dataset.probing;
    v.muted = true;
    // Paused or failed to load before it could start: that isn't a refusal, so try again on the next play.
    if (err.name !== 'NotAllowedError') { probed = false; applySound(); return; }
    state.refused = true;
    renderSound();
    if (state.autoplay && !v.dataset.userPaused && (v === primaryVideo() || inActiveGrid(v))) v.play().catch(() => {});
  });
}
function playSafely(v) {
  applyStart(v);
  if (driven()) { v.muted = true; return v.play().catch(() => {}); } // never probe or unmute while a player runs
  const lead = audibleVideo();
  if (!probed && state.sound && !state.unlocked && !hushed && v === lead) return probeSound(v);
  v.muted = !(soundOn() && v === lead && v.dataset.primed);
  return v.play().catch(err => {
    if (err.name !== 'NotAllowedError' || v.muted) return;
    delete v.dataset.primed;
    v.muted = true;
    v.play().catch(() => {});
  });
}
function updateVideos() {
  if (rendering()) { // frames come from the renderer's seeks: nothing plays on its own
    for (const v of autoVideos) if (!sg.owned.has(v) && !v.paused) v.pause();
    return applySound();
  }
  const lead = primaryVideo();
  for (const v of autoVideos) {
    if (sg.owned.has(v)) continue; // a player's (__sg.video(v).at): it plays or holds where the story says
    // Every clip in an active grid plays together; elsewhere only the lead video plays.
    const inGrid = inActiveGrid(v);
    if (state.autoplay && (v === lead || inGrid)) {
      if (v.preload === 'none') v.preload = 'auto';
      if (v.paused && !v.dataset.userPaused) playSafely(v);
    } else if (!v.paused && v !== lead && !inGrid) {
      v.pause();
    }
  }
  applySound();
}
const videoIO = new IntersectionObserver(entries => {
  for (const e of entries) visible.set(e.target, e.isIntersecting ? e.intersectionRatio : 0);
  updateVideos();
}, {threshold: [0, .15, .3, .5, .75, 1]});
autoVideos.forEach(v => {
  videoIO.observe(v);
  if (v.closest('.stage-media--grid')) return; // grid cells focus instead (below)
  v.addEventListener('click', () => {
    if (justUnlocked() && !v.paused) return;
    if (v.paused) { delete v.dataset.userPaused; playSafely(v); }
    else { v.dataset.userPaused = '1'; v.pause(); }
  });
});
/* ---------------- Grids: a 3D stack you thumb through, at every width ----------------
   Each grid is a stack: one large clip in front, the others behind it in depth, their edges showing. A sideways swipe
   or mouse drag, a sideways trackpad scroll (one clip per gesture), the arrows, the arrow keys inside the stack, or a
   click on a clip behind flicks the front clip off to the left and brings the next one forward; the deck wraps around,
   and a swipe the other way brings the last one back in from the left. The front clip is the focused one (gridFocus),
   so it's the one heard. It is picked as the finger lifts, inside the gesture, so it may be unmuted there; where a
   browser still refuses, playSafely plays it muted (and once sound is unlocked, every clip is primed). The clips behind
   wait, paused on their frame, until they come forward. Vertical scrolling stays the browser's (touch-action:
   pan-y): the stack only takes a gesture once it's clearly sideways. One rAF loop moves transform and opacity,
   nothing else. Reduced motion: no depth and no flight, a short crossfade.
   Phones (under 700px) size the front clip to the room above the grid's text; tablets the same, with wider fans; on a
   desktop, where the text sits in a column beside the stage, the front clip takes the stage's height and the clips
   behind fan out further to the right, like a hand of cards, and a card sent off to the left fades before the text. */
const stillMQ = matchMedia('(prefers-reduced-motion: reduce)');
const coarseMQ = matchMedia('(hover: none) and (pointer: coarse)');
function makeStack(grid, cells, pick, onChange) {
  const box = $('.grid4', grid), tag = $('.grid-tag', grid), n = cells.length;
  // The grid's beats. On a phone build_v5.py gives each grid two, its heading alone first, so the stack is sized to
  // the room above that heading; the paragraph that follows scrolls up over the stack.
  const scene = grid.closest('[data-scrolly]');
  const beats = scene ? $$(`.beat[data-show="${grid.dataset.key}"]`, scene) : [];
  const wrap = a => ((a % n) + n) % n;
  // Each step behind the front clip: sideways (share of its width, but never under STEP_MIN px, so a narrow clip still
  // shows real edges), back (px), turned (deg), darker. (Phones; wider screens fan further, see measure().)
  const STEP = {x: .12, z: 70, turn: 4, shade: .28}, STEP_MIN = 18;
  const BTN = 40, BTN_GAP = 4, PEEK = 2 * STEP.x; // two edges show; the last clip waits unseen at the back
  const GAP_W = 12; // the arrows' distance from the clips at 700px and up
  let on = false, built = false, pos = 0, front = 0, anim = null, drag = null, raf = 0, sized = '', dragEnd = -1e9, wh = null;
  let geo = {W: 200, H: 356, D: 400, dx: 24, z: STEP.z, turn: STEP.turn, shade: STEP.shade, toss: false, side: false, gap: 0}, count, how, live, prev, next;
  const last = cells.map(() => ({}));
  const active = () => grid.classList.contains('is-active');
  const name = c => (c.btn?.getAttribute('aria-label') || '').replace(/^Hear /, '');

  function build() {
    built = true;
    const hint = document.createElement('span');
    hint.className = 'stack-hint';
    hint.innerHTML = '<span class="stack-count"></span> · swipe for more';
    tag.append(hint);
    count = $('.stack-count', hint);
    how = hint.lastChild; // the text after the count: how to move through the stack (set in measure())
    const arrow = (cls, label, d, k) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = `stack-btn ${cls}`; b.setAttribute('aria-label', label);
      b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
      b.addEventListener('click', () => step(k));
      box.append(b);
      return b;
    };
    prev = arrow('stack-btn--prev', 'Previous clip', 'M10 3.5 5.5 8l4.5 4.5', -1);
    next = arrow('stack-btn--next', 'Next clip', 'M6 3.5l4.5 4.5L6 12.5', 1);
    live = document.createElement('span');
    live.className = 'stack-live sr-only';
    live.setAttribute('aria-live', 'polite');
    box.append(live);
    for (const c of cells) { c.shade = document.createElement('span'); c.shade.className = 'stack-shade'; c.fig.append(c.shade); }

    // The thumb (or the mouse). Nothing is claimed until the pointer has clearly gone sideways; a vertical start is the
    // page's scroll. It may start anywhere across the stack's band, the side gutters included (the whole grid figure
    // listens, and there the browser only pans vertically), but not on the tag above it or below the clips, nor, on a
    // desktop, left of the stage's stack area (beside the text column).
    grid.addEventListener('pointerdown', e => {
      dragEnd = -1e9; // a new press is never the tail of the last drag, so a quick tap right after a swipe counts
      if (!on || !active() || !e.isPrimary || e.button > 0 || e.target.closest('.stack-btn, .grid-tag a')) return;
      if (e.clientY < tag.getBoundingClientRect().bottom || e.clientY > box.getBoundingClientRect().bottom) return;
      if (geo.side && e.clientX < grid.getBoundingClientRect().left + geo.padL) return;
      drag = {id: e.pointerId, x: e.clientX, x0: e.clientX, y: e.clientY, live: false, pts: []};
    });
    grid.addEventListener('pointermove', e => {
      const d = drag;
      if (!d || e.pointerId !== d.id) return;
      // A mouse button that came up without a pointerup reaching the page (an app switch or an OS gesture mid-drag) ends
      // the drag where it is; the deck never follows a hovering pointer.
      if (d.live && e.pointerType === 'mouse' && !(e.buttons & 1)) return end(e, true);
      if (!d.live) {
        if (e.pointerType === 'mouse' && !(e.buttons & 1)) { drag = null; return; } // released outside the stack
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { drag = null; return; }
        // More across than down is sideways: the browser, which only pans vertically here, draws the line there too.
        if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return;
        // Take it from here, so the clip doesn't jump by the slop. A grab mid-flight catches the deck where it is,
        // and remembers which way it was flying.
        d.live = true; d.x = e.clientX;
        d.caught = !!anim; d.dir = anim ? Math.sign(anim.target - pos) : 0;
        d.anchor = anim ? anim.target : Math.round(pos); d.from = pos; anim = null;
        try { grid.setPointerCapture(e.pointerId); } catch {}
        grid.classList.add('is-dragging');
      }
      pos = Math.max(d.anchor - 1, Math.min(d.anchor + 1, d.from - (e.clientX - d.x) / geo.D));
      // A turn of direction starts the speed reading afresh, so a flick back isn't averaged with the drag before it.
      const dir = d.pts.length ? Math.sign(e.clientX - d.pts.at(-1)[1]) : 0;
      if (dir && d.vdir && dir !== d.vdir) d.pts = d.pts.slice(-1);
      if (dir) d.vdir = dir;
      d.pts.push([e.timeStamp, e.clientX]);
      if (d.pts.length > 6) d.pts.shift();
      schedule();
    });
    // (A cancel, a lost capture or a lost pointerup settles on the nearest clip, where the deck is.)
    function end(e, cancel = e.type === 'pointercancel' || e.type === 'lostpointercapture') {
      const d = drag;
      if (!d || e.pointerId !== d.id) return;
      drag = null;
      if (!d.live) return;
      // (a drag ended without its pointerup still holds the capture: let it go, so the next click lands where it points)
      try { if (grid.hasPointerCapture(e.pointerId)) grid.releasePointerCapture(e.pointerId); } catch {}
      grid.classList.remove('is-dragging');
      dragEnd = performance.now();
      // Release: a flick goes by its direction (one that catches the deck still flying that way sends it one further
      // than it was headed); a slow drag goes if the finger got far enough from where it landed, else it springs back.
      const pts = d.pts.filter(p => e.timeStamp - p[0] < 100);
      const v = pts.length > 1 ? (pts.at(-1)[1] - pts[0][1]) / Math.max(1, pts.at(-1)[0] - pts[0][0]) : 0; // px/ms
      const moved = d.caught ? Math.abs(pos - d.anchor) * geo.D : Math.abs(e.clientX - d.x0);
      let target = d.anchor;
      if (cancel) target = Math.round(pos);
      else if (Math.abs(v) > .3) target = d.caught && Math.sign(-v) === d.dir ? d.anchor + d.dir : v < 0 ? Math.floor(pos + 1e-6) + 1 : Math.ceil(pos - 1e-6) - 1;
      else if (moved > Math.min(geo.W * .3, 80)) target = d.anchor + Math.sign(pos - d.anchor);
      settle(Math.max(d.anchor - 1, Math.min(d.anchor + 1, target)), cancel ? 0 : -v / geo.D);
    }
    grid.addEventListener('pointerup', e => end(e));
    grid.addEventListener('pointercancel', e => end(e));
    // The grid losing the capture it took (after a normal pointerup the drag is already over: a no-op). Only the grid's
    // own: taking it fires lostpointercapture on the touched element (a touch's implicit capture), which bubbles here.
    grid.addEventListener('lostpointercapture', e => { if (e.target === grid) end(e); });
    // A drag that ends over the credit link or a clip is not a tap on it. (The arrows never end a drag.)
    grid.addEventListener('click', e => {
      if (performance.now() - dragEnd < 400 && !e.target.closest('.stack-btn')) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    box.addEventListener('dragstart', e => { if (on) e.preventDefault(); });
    box.addEventListener('keydown', e => {
      const k = on && !e.altKey && !e.ctrlKey && !e.metaKey && {ArrowRight: 1, ArrowLeft: -1}[e.key];
      if (!k) return;
      e.preventDefault();
      step(k);
    });
    // A sideways trackpad scroll (or a mouse's sideways wheel) moves one clip per gesture, its momentum included. Like
    // the browser's own scrolling, a gesture's first move decides its axis: an up-or-down one stays the page's, and a
    // sideways one is the stack's (so it never turns into the browser's back/forward swipe). A clearly vertical move
    // hands a sideways gesture back to the page: a scroll whose first event leaned sideways by a pixel, or one begun
    // inside a swipe's momentum tail, still scrolls (sideways momentum has no vertical part, so it never trips this),
    // and a clip only moves once the gesture has gone further across than down. A new push inside a gesture's tail (the
    // deltas fell away, then rose again) counts as a new gesture; a pause of 200ms ends one. The whole scene listens,
    // so a swipe over the text column beside the stack moves it too; only the grid on screen reacts.
    (scene || grid).addEventListener('wheel', e => {
      if (!on || !active() || e.ctrlKey || drag?.live) return;
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? geo.W : 1, dx = e.deltaX * k, dy = e.deltaY * k, now = e.timeStamp;
      if (!wh || now - wh.t > 200) {
        if (!dx && !dy) return;
        wh = {t: now, x: Math.abs(dx) > Math.abs(dy), acc: 0, sy: 0, done: false, peak: 0, low: Infinity, at: 0};
      }
      wh.t = now;
      if (wh.x && Math.abs(dy) >= 4 && Math.abs(dy) > 2 * Math.abs(dx)) wh.x = false;
      if (!wh.x) return;
      e.preventDefault();
      const a = Math.abs(dx);
      if (wh.done) {
        wh.peak = Math.max(wh.peak, a);
        if (a < wh.peak * .5) wh.low = Math.min(wh.low, a);
        if (!(a > Math.max(10, wh.low * 3) && now - wh.at > 250)) return;
        wh.done = false; wh.acc = 0; wh.sy = 0; wh.peak = 0; wh.low = Infinity;
      }
      wh.acc += dx; wh.sy += Math.abs(dy);
      if (Math.abs(wh.acc) >= 30 && Math.abs(wh.acc) > wh.sy) { wh.done = true; wh.at = now; wh.peak = a; step(Math.sign(wh.acc)); }
    }, {passive: false});
  }

  // s: where a clip sits, 0 = in front, 1 and 2 behind it, 3 waiting unseen at the back; between 3 and 4 it is
  // flying off to the left (4 - s of the way to the front, so a swipe back brings it in from the left). On a desktop it is
  // tossed aside instead of flying off the screen: a shorter flight that fades out as it passes under the text column,
  // from full while it is clear of the column to gone once half its width would be under it. (Its leading corner is the
  // top-left one, which the 9deg turn about 50% 75% carries a further .75 H sin(turn) to the left; geo.gap is the room
  // between the stack and the column. Never above 1 - u^2, so it is gone by u = 1, where the clip waits at the back.)
  function paint() {
    const {W, H, D, dx, toss} = geo, still = stillMQ.matches;
    const fade = u => Math.min(1 - u * u, Math.max(0, Math.min(1, 1 - (u * D + .75 * H * Math.sin(u * 9 * Math.PI / 180) - geo.gap) / (W * .5))));
    for (let i = 0; i < n; i++) {
      const s = wrap(i - pos);
      let t = 'none', o = 1, sh = 0, z;
      if (still) { // a crossfade: the nearer clip underneath, the farther one fading out over it
        const d = Math.min(s, n - s);
        o = d >= 1 ? 0 : d > .5 ? 1 - d : 1; z = d > .5 ? 3 : 2;
      } else if (s > n - 1) {
        const u = n - s;
        t = `translate3d(${(-u * D).toFixed(1)}px,${(u * .03 * H).toFixed(1)}px,0) rotate(${(-u * 9).toFixed(2)}deg)`;
        if (toss) o = fade(u);
        z = 9;
      } else {
        t = `translate3d(${(s * dx).toFixed(1)}px,0,${(-s * geo.z).toFixed(1)}px) rotateY(${(s * geo.turn).toFixed(2)}deg)`;
        o = Math.min(1, n - 1 - s); sh = s * geo.shade; z = 8 - Math.round(s * 2);
      }
      const c = cells[i], l = last[i], st = c.fig.style;
      o = Math.round(o * 1000) / 1000; sh = Math.round(sh * 1000) / 1000;
      if (l.t !== t) st.transform = l.t = t;
      if (l.o !== o) { st.opacity = l.o = o; st.pointerEvents = o < .5 ? 'none' : ''; }
      if (l.z !== z) st.zIndex = l.z = z;
      if (l.sh !== sh) c.shade.style.opacity = l.sh = sh;
    }
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (!on) return;
    if (anim) {
      // A critically damped spring that starts at the release speed and never overshoots (see glide).
      const a = anim, t = Math.max(0, now - a.t0);
      let x = stillMQ.matches ? (t >= 200 ? 0 : a.x0 * (1 - t / 200) ** 3)
        : (a.x0 + (a.v0 + a.w * a.x0) * t) * Math.exp(-a.w * t);
      if (Math.abs(x) < .002 || x * a.x0 < 0) x = 0;
      pos = a.target + x;
      if (!x) { anim = null; pos = wrap(a.target); }
    }
    paint();
    if (anim) schedule();
  }
  // v0 in clips per ms. A fast flick stiffens the spring instead of carrying the deck past its stop.
  function glide(target, v0 = 0) {
    const x0 = pos - target;
    let w = .019;
    if (v0 * x0 < 0) {
      w = Math.min(.05, Math.max(w, -v0 / x0));
      v0 = Math.sign(v0) * Math.min(Math.abs(v0), w * Math.abs(x0));
    }
    anim = {t0: performance.now(), x0, v0, w, target};
    schedule();
  }
  // The new front clip is picked (focused, so heard) the moment the gesture ends, not when the deck lands.
  function settle(target, v0, play) {
    const f = wrap(target);
    if (f !== front) {
      const was = !cells[front].video.paused;
      front = f;
      mark();
      live.textContent = `${f + 1} of ${n}: ${name(cells[f])}`;
      pick(cells[f], play || state.autoplay || was);
    }
    glide(target, v0);
  }
  const base = () => anim ? anim.target : Math.round(pos);
  function step(k) { if (on) settle(base() + k, 0, false); }
  // The front clip changes the way settle() changes it, without the glide (for the play-mode hooks below).
  function setFront(f) {
    if (f === front) return;
    const was = !cells[front].video.paused;
    front = f;
    mark();
    live.textContent = `${f + 1} of ${n}: ${name(cells[f])}`;
    pick(cells[f], state.autoplay || was);
  }
  // Keyboard focus on a clip that just went behind (its own button, or its credit) follows the clip that came forward,
  // so it is never left on a hidden clip, and Enter/Space then plays the clip in front.
  function mark() {
    const stray = cells.some((c, i) => i !== front && c.fig.contains(document.activeElement)), act = active();
    count.textContent = `${front + 1} / ${n}`;
    cells.forEach((c, i) => {
      if (i === front) c.fig.removeAttribute('aria-hidden'); else c.fig.setAttribute('aria-hidden', 'true');
      const a = $('.cell-chip a', c.fig);
      if (a) a.tabIndex = i === front && act ? 0 : -1;
    });
    if (stray && act) (cells[front].btn || box).focus({preventScroll: true});
    onChange();
  }
  // Size the front clip. Phones and tablets (the text below the stage): to the room between the tag and the text of the
  // grid's first beat on screen (where it sits once that beat snaps), and to the width left beside the arrows for the
  // clip and the edges showing behind it. Desktops (the text in a column beside the stage, is-side): to the stage's
  // height below the tag, in the stage area right of the text; the arrows sit either side of the stack, or, where
  // that area is narrow and a bigger clip fits with them underneath it (is-btns-low), below the front clip.
  function measure(again = true) {
    const stage = grid.parentElement, vh = stage.clientHeight, vw = stage.clientWidth;
    if (!vh || !vw) return;
    const tagH = tag.offsetHeight;
    const cs = getComputedStyle(grid), gut = parseFloat(cs.paddingLeft) || 16, still = stillMQ.matches, wide = vw >= 700;
    how.data = ` · ${wide && !coarseMQ.matches ? 'drag, scroll sideways or use the arrows' : 'swipe for more'}`;
    const beat = beats.find(b => b.offsetHeight), first = beat?.firstElementChild;
    let W, H, pk, lift = 0, x = 0, low = false, side = false, persp = 0;
    if (!wide) {
      const top = tag.offsetTop + tag.offsetHeight + 10;
      const floor = first ? (vh - beat.offsetHeight) / 2 + first.offsetTop - beat.offsetTop : vh * .62;
      const room = floor - 12 - top, avail = vw - 2 * gut - 2 * (BTN + BTN_GAP);
      W = Math.round(Math.max(90, Math.min(room * 9 / 16, still ? avail : Math.min(avail / (1 + PEEK), avail - 2 * STEP_MIN))));
      H = Math.round(W * 16 / 9); pk = still ? 0 : Math.max(PEEK * W, 2 * STEP_MIN);
      lift = Math.max(0, Math.round((room - H) / 2));
      geo = {W, H, D: vw / 2 - pk / 2 + W * .75 + 24, dx: Math.max(STEP.x * W, STEP_MIN), z: STEP.z, turn: STEP.turn, shade: STEP.shade, toss: false, side, padL: gut};
    } else {
      // The fan: the two clips behind show between F0 and F1 of the front clip's width together, as much as the room
      // allows once the front clip has its size. Depth (a fifth of the clip), turn (6deg a step) and the perspective
      // grow with the clip. The edges are measured as the perspective draws them (proj), so the next arrow sits just
      // past the last edge that shows, and dx is the step that shows that much.
      side = !!first && first.getBoundingClientRect().right - stage.getBoundingClientRect().left <= gut + 1;
      const F0 = .2, F1 = side ? .5 : .36, TURN = 6, arrows = 2 * (BTN + GAP_W), rad = TURN * Math.PI / 180;
      const persOf = w => Math.max(900, Math.round(w * 3.6));
      const fit = (room, span) => {
        const w = Math.round(Math.max(90, Math.min(room * 9 / 16, still ? span : span / (1 + F0))));
        if (still) return {w, dx: 0, pk: 0};
        const P = Math.max(F0 * w, Math.min(F1 * w, span - w)), p = persOf(w), h = w / 2;
        const dx = ((P + h) * (p + 2 * w * .2 + h * Math.sin(2 * rad)) / p - h * Math.cos(2 * rad)) / 2;
        return {w, dx: Math.round(dx * 10) / 10, pk: Math.round(P)};
      };
      let f;
      if (side) {
        // the fan may reach into the page's right margin when the stage area is narrow; the stack is centred in it
        const span = vw - gut - 16, inner = vw - gut - (parseFloat(cs.paddingRight) || 16);
        const room = vh - (parseFloat(cs.paddingTop) || 0) - tag.offsetHeight - 10 - 2 * 22;
        const a = fit(room, span - arrows), b = fit(room - BTN - 14, span);
        low = b.w > a.w + 8;
        f = low ? b : a;
        x = Math.round(Math.max(0, (inner - f.w - f.pk - (low ? 0 : arrows)) / 2) + (low ? 0 : BTN + GAP_W));
      } else {
        const top = tag.offsetTop + tag.offsetHeight + 10;
        const floor = first ? (vh - beat.offsetHeight) / 2 + first.offsetTop - beat.offsetTop : vh * .62;
        const room = floor - 12 - top;
        f = fit(room, vw - 2 * gut - arrows);
        lift = Math.max(0, Math.round((room - Math.round(f.w * 16 / 9)) / 2));
      }
      W = f.w; H = Math.round(W * 16 / 9); pk = f.pk; persp = persOf(W);
      geo = {W, H, dx: f.dx, z: Math.round(W * .2), turn: TURN, shade: .24, toss: side, side, padL: gut,
        D: side ? W + pk / 2 + 40 : vw / 2 - pk / 2 + W * .75 + 24, gap: 0};
      // the tossed clip's fade (paint): the room between the stack's left edge (gut + x in the stage, which the grid
      // fills) and the text column's right edge
      if (side) geo.gap = gut + x - (first.getBoundingClientRect().right - stage.getBoundingClientRect().left);
    }
    const key = [W, H, lift, Math.round(pk), x, +low, +side, persp].join();
    if (key === sized) return;
    sized = key;
    const [, , , peek] = key.split(',');
    grid.style.setProperty('--stack-w', W + 'px');
    grid.style.setProperty('--stack-h', H + 'px');
    grid.style.setProperty('--stack-lift', lift + 'px');
    grid.style.setProperty('--stack-peek', peek + 'px');
    const opt = (k, v) => v ? grid.style.setProperty(k, v) : grid.style.removeProperty(k);
    opt('--stack-x', x && x + 'px');
    opt('--stack-persp', persp && persp + 'px');
    grid.classList.toggle('is-compact', W < 150); // a short phone: smaller credit chip and speaker badge
    grid.classList.toggle('is-wide', wide);
    grid.classList.toggle('is-side', side);
    grid.classList.toggle('is-btns-low', low);
    // the tag lines up with the front clip on a desktop; if that rewraps it, the room above the clip changed
    if (again && tag.offsetHeight !== tagH) { sized = ''; measure(false); }
  }
  function enable() {
    if (!built) build();
    on = true;
    grid.classList.add('is-stack');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-roledescription', 'carousel');
    box.setAttribute('aria-label', (tag.firstChild?.textContent || 'Clips').replace(/[\s·]+$/, ''));
    front = Math.max(0, cells.findIndex(c => c.video === gridFocus.get(grid)));
    pos = front; anim = null; sized = '';
    videoIO.observe(box);
    measure(); paint(); mark();
    updateVideos();
  }
  // Every width has the stack (the 2x2 grid is only the no-script layout), so it's switched on once and never off.
  function sync() {
    if (n > 1 && !on) enable();
    else if (on) { measure(); paint(); }
  }
  stillMQ.addEventListener('change', () => { if (!on) return; anim = null; pos = wrap(Math.round(pos)); sized = ''; measure(); paint(); });
  coarseMQ.addEventListener('change', () => { if (on) { sized = ''; measure(); paint(); } });
  let pending = 0;
  addEventListener('resize', () => { if (on && !pending) pending = requestAnimationFrame(() => { pending = 0; if (on) { measure(); paint(); } }); });
  document.fonts?.ready.then(() => { if (on) { measure(); paint(); } });
  return {
    sync,
    // The arrows, the front clip's credit and the account link in the tag join the tab order with the stack on screen
    // (an inactive grid is invisible); the next clip starts loading then.
    reach(isOn) {
      if (!built) return;
      const r = on && isOn;
      prev.tabIndex = next.tabIndex = r ? 0 : -1;
      cells.forEach((c, i) => { const a = $('.cell-chip a', c.fig); if (a) a.tabIndex = r && i === front ? 0 : -1; });
      for (const a of $$('a', tag)) { if (r) a.removeAttribute('tabindex'); else a.tabIndex = -1; }
      const nb = r && cells[wrap(front + 1)].video;
      if (nb && nb.preload !== 'auto') nb.preload = 'auto';
    },
    reachable: c => !on || c === cells[front],
    // A tap on a clip behind the front one brings it forward (and plays it, as a tap on a grid cell would).
    bring(c) {
      if (!on) return false;
      const b = base(), d = wrap(cells.indexOf(c) - b);
      if (!d) return false;
      settle(b + d, 0, true);
      return true;
    },
    // Play-mode hooks (__sg.grid(key).front / .at). front(i) springs clip i forward the way a swipe does (always
    // forward, wrapping), or puts it there at once ({instant: true}). at(x) sets the deck position directly: x in clips,
    // fractional mid-flight (2.5 = halfway from clip 2 to clip 3), a pure function of x for frame-stepped renders.
    get on() { return on; },
    get index() { return front; },
    front(i, {instant = false} = {}) {
      if (!on) return false;
      const f = wrap(Math.round(i));
      if (instant) {
        drag = null; anim = null; grid.classList.remove('is-dragging');
        setFront(f); pos = f; paint();
        return true;
      }
      const b = base(), d = wrap(f - b);
      if (d) settle(b + d, 0, false);
      return true;
    },
    at(x) {
      if (!on || !Number.isFinite(x)) return false;
      drag = null; anim = null; grid.classList.remove('is-dragging');
      setFront(wrap(Math.round(x))); pos = wrap(x); paint();
      return true;
    },
  };
}
// Grids: each is a stack (makeStack, above) at every width; its front clip is the focused one (the first, until the
// reader brings another forward), the one that plays and is heard. A tap or click on a clip behind brings it forward;
// on the front clip, or Enter/Space on it, it plays it if it was paused. It never pauses it.
for (const grid of $$('.stage-media--grid')) {
  const cells = $$('.grid4 > figure', grid).map(fig => ({fig, video: $('video', fig), btn: $('.cell-hear', fig)})).filter(c => c.video);
  const focus = c => {
    gridFocus.set(grid, c.video);
    for (const x of cells) { x.fig.classList.toggle('is-heard', x === c); x.btn?.setAttribute('aria-pressed', x === c); }
  };
  if (cells.length) focus(cells[0]);
  // Picking a cell focuses it and, when asked (always for a tap), plays it if it was paused.
  const pick = (c, play) => {
    focus(c);
    // A tap also lifts a pause from the OS media controls on the whole grid; updateVideos restarts the others.
    if (state.autoplay) for (const x of cells) delete x.video.dataset.userPaused;
    if (play && c.video.paused && !sg.owned.has(c.video)) { delete c.video.dataset.userPaused; playSafely(c.video); }
    updateVideos(); // also calls applySound
  };
  const stack = makeStack(grid, cells, pick, () => reach());
  sg.grids.set(grid.dataset.key, {grid, cells, focus, stack});
  // Keyboard: only the grid on screen takes focus (the scrolly scene below keeps this in step).
  // When the grid leaves the stage, a cell button that still has focus lets go of it, so Space scrolls again.
  const reach = () => {
    const on = grid.classList.contains('is-active');
    cells.forEach(c => { if (c.btn) c.btn.tabIndex = on && stack.reachable(c) ? 0 : -1; });
    stack.reach(on);
    if (!on && grid.contains(document.activeElement)) document.activeElement.blur();
  };
  grid.addEventListener('stage:active', reach);
  stack.sync(); // the stack, at every width (resizes re-measure it)
  reach();
  for (const c of cells) {
    (c.btn || c.video).addEventListener('click', e => {
      if (!stack.bring(c)) pick(c, true);
      if (e.detail) e.currentTarget.blur(); // pointer taps don't keep keyboard focus; Enter/Space (detail 0) do
    });
  }
}
// Warm up videos shortly before they're needed.
const preloadIO = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting && e.target.preload === 'none') e.target.preload = 'metadata';
}, {rootMargin: '150% 0px'});
[...autoVideos, repriseVideo].filter(Boolean).forEach(v => preloadIO.observe(v));

/* ---------------- Laugh reprise: the cold open's laugh, once, then the labeled face held ----------------
   Its own tape: data-cue="in,out" plays once (with sound when page sound is on) when the section is half in
   view, then the picture holds on data-hold. It never loops. */
const MARGIN = .04; // stop this long before the out point
const span = s => { if (!s) return null; const [a, b] = s.split(',').map(Number); return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null; };
function whenMeta(v) {
  if (v.readyState >= 1) return Promise.resolve();
  return new Promise(r => { v.addEventListener('loadedmetadata', r, {once: true}); if (v.preload === 'none') { v.preload = 'auto'; v.load(); } });
}
function seekTo(v, t) {
  return new Promise(r => {
    if (Math.abs(v.currentTime - t) < .01) return r();
    v.addEventListener('seeked', r, {once: true});
    v.currentTime = t;
  });
}
function holdReprise(v) {
  v.pause(); v.muted = true;
  const hold = Number(v.dataset.hold);
  if (Number.isFinite(hold)) seekTo(v, hold);
}
function repriseTick() {
  const v = repriseVideo;
  if (!reprise.token || v.paused) return;
  reprise.running = true;
  const cue = span(v.dataset.cue);
  const left = (cue[1] - MARGIN - v.currentTime) * 1000 / (v.playbackRate || 1);
  clearTimeout(reprise.timer);
  if (left <= 0) return endReprise(true);
  reprise.timer = setTimeout(() => endReprise(true), left);
}
function endReprise(hold) {
  if (!reprise.token) return;
  clearTimeout(reprise.timer);
  reprise.token = null; reprise.audible = false; reprise.running = false;
  repriseVideo.muted = true;
  if (hold) holdReprise(repriseVideo);
  applySound();
}
function playReprise() {
  const v = repriseVideo, cue = span(v.dataset.cue);
  if (!cue || reprise.token) return;
  const token = reprise.token = {};
  whenMeta(v).then(() => seekTo(v, cue[0])).then(() => {
    if (reprise.token !== token) return;
    reprise.audible = soundOn() && !!v.dataset.primed;
    applySound(); // unmutes the reprise, if it's to be heard, and mutes everything else
    return v.play().catch(err => {
      if (err.name !== 'NotAllowedError' || v.muted) throw err;
      // iOS may refuse an unmuted play: laugh muted instead.
      delete v.dataset.primed; reprise.audible = false; v.muted = true; applySound();
      return v.play();
    });
  }).then(() => { if (reprise.token === token) repriseTick(); }, () => {
    if (reprise.token !== token) return;
    reprise.token = null; reprise.audible = false; reprise.running = false;
    v.muted = true; applySound();
  });
}
if (repriseVideo) {
  const v = repriseVideo;
  v.addEventListener('playing', repriseTick);
  v.addEventListener('timeupdate', repriseTick);
  v.addEventListener('waiting', () => clearTimeout(reprise.timer));
  v.addEventListener('pause', () => { if (reprise.running) endReprise(true); });
  let played = false;
  new IntersectionObserver(([e]) => {
    if (played || !e.isIntersecting || e.intersectionRatio < .5) return;
    if (!state.autoplay) return; // leave the poster: the same face, mid-laugh
    if (driven() || sg.repriseNoAuto) return; // a player cues the laugh on the mix's own laugh
    played = true;
    playReprise();
  }, {threshold: [0, .5, .75]}).observe(v);
  v.addEventListener('click', () => {
    if (driven() || !v.paused || reprise.token) return;
    played = true;
    playReprise();
  });
  // Driven by a player (either here or through __sg.video(v)): the page's own once-only laugh counts as spent.
  sg.onDrive.set(v, play => { if (reprise.token) endReprise(false); if (play) played = true; });
  sg.repriseApi = {
    noAuto(on = true) { sg.repriseNoAuto = !!on; },
    at: (t, o) => videoAt(v, t, o),
    hold(t = Number(v.dataset.hold), o = {}) { played = true; return videoAt(v, t, {...o, play: false}); },
    get played() { return played; },
  };
}

const soundBtn = $('#sound-toggle'), motionBtn = $('#motion-toggle');
function renderSound() {
  if (driven()) { // page sound is off while a player runs; the button keeps the reader's own setting for later
    document.documentElement.dataset.sound = 'off';
    soundBtn.classList.remove('waiting'); // no pulsing "Tap for sound" inviting a tap that would pause the story
    const cta = $('#sound-cta'); if (cta) cta.hidden = true;
    return;
  }
  soundBtn.setAttribute('aria-pressed', soundOn());
  soundBtn.classList.toggle('waiting', state.sound && (!state.unlocked || hushed));
  $('.label', soundBtn).textContent = !state.sound ? 'Sound off' : state.unlocked && !hushed ? 'Sound on' : 'Tap for sound';
  document.documentElement.dataset.sound = soundOn() ? 'on' : 'off';
  const cta = $('#sound-cta');
  if (cta) cta.hidden = !(state.sound && !state.unlocked && (state.refused || !state.autoplay));
}
// Called inside a tap or key press. Playing each video once, unmuted, while the gesture is live
// is what lets it play with sound later, when scrolling brings it on screen. Each one is paused and
// re-muted in the same instant, so nothing is heard. Then the lead is unmuted where it is.
let unlockedAt = -Infinity;
const justUnlocked = () => performance.now() - unlockedAt < 700;
function unlockSound() {
  if (state.unlocked || driven()) return;
  const tries = allVideos().map(v => {
    const wasPaused = v.paused, wasMuted = v.muted;
    v.dataset.primed = '1';
    v.muted = false;
    const p = v.play();
    if (wasPaused) v.pause();
    v.muted = wasMuted;
    return p.then(() => true, err => err.name !== 'NotAllowedError').then(ok => { if (!ok) delete v.dataset.primed; return ok; });
  });
  state.unlocked = true;
  unlockedAt = performance.now();
  // A reprise laugh already under way (muted) is heard from where it is.
  if (reprise.running) reprise.audible = true;
  renderSound();
  // Start whatever should be playing now, while the gesture is still live (Low Power Mode blocks even muted autoplay).
  updateVideos();
  swap.resume?.();
  Promise.all(tries).then(results => {
    if (results.some(Boolean)) return;
    state.unlocked = false;
    renderSound();
    applySound();
  });
}
const NOT_GESTURES = ['Tab', 'Escape', 'Shift', 'Alt', 'AltGraph', 'Control', 'Meta', 'CapsLock', 'Fn', 'NumLock', 'ScrollLock'];
// When the story last paused (__sg.mode('play' -> 'reader')), and when the latest press began: the gesture that paused
// the story (its keydown, or the click / pointerup of a press that began before the pause) is not a tap for page sound.
let storyPausedAt = -Infinity, downAt = -Infinity;
const evTime = e => (e.timeStamp > 0 && e.timeStamp <= performance.now() + 50 ? e.timeStamp : performance.now());
addEventListener('pointerdown', e => { downAt = evTime(e); }, {capture: true, passive: true});
function onFirstGesture(e) {
  // The Play button starts the story's own audio: pressing it is not a tap for page sound (nor is anything while it plays).
  if (driven() || (e.target instanceof Element && e.target.closest('#play-toggle'))) return;
  if ((e.type === 'keydown' ? evTime(e) : downAt) <= storyPausedAt) return;
  if (e.type === 'keydown') {
    if (soundBtn.contains(e.target) || NOT_GESTURES.includes(e.key) || e.metaKey || e.ctrlKey) return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
  }
  if (hushed) { // the reader's first tap or key after a story pause: page sound as they had it
    hushed = false;
    if (state.unlocked) { unlockedAt = performance.now(); renderSound(); updateVideos(); swap.resume?.(); return; }
    renderSound();
  }
  if (state.sound) unlockSound();
}
// iOS only sends taps on plain text to listeners attached below <body>, so listen on the page's regions too.
for (const target of [document, $('main'), masthead]) {
  target.addEventListener('click', onFirstGesture, {capture: true});
}
document.addEventListener('keydown', onFirstGesture, {capture: true});
for (const target of [document, $('main'), masthead]) {
  target.addEventListener('pointerup', e => {
    if (e.pointerType !== 'mouse' && navigator.userActivation?.isActive) onFirstGesture(e);
  }, {capture: true});
}
soundBtn.addEventListener('click', () => {
  if (justUnlocked()) return;
  state.sound = !(state.sound && state.unlocked);
  if (state.sound && !state.unlocked) { unlockSound(); return; }
  renderSound();
  if (state.sound) {
    const lead = audibleVideo();
    if (lead && lead.paused && autoVideos.includes(lead)) playSafely(lead);
  }
  updateVideos();
});
// "Tap for sound" on the cold open: the tap itself turns sound on (onFirstGesture), which unmutes the
// video where it is. This only starts it if it was stopped.
$('#sound-cta')?.addEventListener('click', () => {
  const v = primaryVideo();
  if (v && v.paused) { delete v.dataset.userPaused; playSafely(v); }
});
renderSound();
function renderMotion(on) {
  motionBtn.setAttribute('aria-pressed', on);
  $('.label', motionBtn).textContent = on ? 'Autoplay on' : 'Autoplay off';
}
function setAutoplay(on) {
  // While a player runs, the page keeps moving (Autoplay is on for the run); the switch records the reader's choice,
  // which applies the moment the story pauses (__sg.mode('reader')).
  if (driven()) { sg.readerAutoplay = on; renderMotion(on); return; }
  state.autoplay = on;
  document.documentElement.dataset.autoplay = on ? 'on' : 'off';
  renderMotion(on);
  if (!on) { autoVideos.forEach(v => v.pause()); swap.stop?.(); }
  updateVideos();
  renderSound();
}
motionBtn.addEventListener('click', () => setAutoplay(!(driven() ? sg.readerAutoplay : state.autoplay)));
setAutoplay(state.autoplay);
// Tab hidden: pause everything (a reprise laugh under way holds its face). Back: resume where each one was.
document.addEventListener('visibilitychange', () => {
  if (rendering()) return; // the renderer's clock, not the tab, decides
  if (document.hidden) {
    endReprise(true);
    for (const v of autoVideos) if (!v.paused) v.pause();
    swap.stop?.(); return;
  }
  updateVideos();
  swap.resume?.();
});
// Hardware media keys and the OS media controls pause for real, instead of being undone by the next tick.
// (The story player points them at the story while it plays; __sg.mode('reader') puts these back.)
function installMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler('pause', () => {
      autoVideos.forEach(v => { if (!v.paused) { v.dataset.userPaused = '1'; v.pause(); } });
      if (swap.playing) { swap.userPaused = true; swap.stop?.(); }
    });
    // Play resumes the lead, or every cell of a leading grid (so the focused cell is heard again; a stack's front clip
    // only), and the swap.
    navigator.mediaSession.setActionHandler('play', () => {
      const l = primaryVideo(), grid = l?.closest('.stage-media--grid');
      for (const v of grid ? $$('video', grid).filter(x => !benched(x)) : [l]) if (v && v.paused) { delete v.dataset.userPaused; playSafely(v); }
      if (swap.userPaused && swap.inView) { swap.userPaused = false; swap.resume?.(); }
      applySound();
    });
  } catch {}
}
installMediaSession();
setInterval(() => { if (!document.hidden) updateVideos(); }, 2500);

/* ---------------- Captions (Ty's remix and tutorial) ----------------
   On a phone the beats cover the bottom of the video, so the captions move to the top of the frame. */
const cuesUp = matchMedia('(max-width: 860px)');
function placeCaptions(track) {
  for (const c of [...(track.cues || [])]) {
    if (cuesUp.matches) { c.snapToLines = false; c.line = 12; } else { c.snapToLines = true; c.line = 'auto'; }
  }
}
for (const el of $$('video track')) {
  el.addEventListener('load', () => placeCaptions(el.track));
  if (el.readyState === 2) placeCaptions(el.track);
}
cuesUp.addEventListener('change', () => $$('video track').forEach(el => placeCaptions(el.track)));

/* ---------------- Scrolly scenes ---------------- */
for (const scene of $$('[data-scrolly]')) {
  const stage = $('.stage', scene);
  const medias = $$('.stage-media', stage);
  const beats = $$('.beat', scene);
  const isLadder = scene.id === 'ladder';
  const activate = key => {
    if (isLadder) return setLevel(scene, Number(key));
    let changed = false;
    for (const m of medias) {
      const on = m.dataset.key === key;
      if (on === m.classList.contains('is-active')) continue;
      changed = true;
      m.classList.toggle('is-active', on);
      m.dispatchEvent(new Event('stage:active'));
    }
    if (changed) {
      const active = medias.find(m => m.dataset.key === key);
      const bg = $('.stage-bg', stage), poster = active && $('video', active)?.getAttribute('poster');
      if (bg && poster) bg.style.setProperty('--poster', `url('${poster}')`);
      updateVideos();
    }
  };
  // (A beat whose text a player is revealing on its words, __sg.reveal(beat, ms), keeps its .in to the player.)
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { if (!ownsReveal(e.target)) e.target.classList.add('in'); activate(e.target.dataset.show); }
  }, {rootMargin: '-42% 0px -42% 0px'});
  beats.forEach(b => io.observe(b));
  // Fade beats in slightly earlier than they take control.
  const soft = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting && !ownsReveal(e.target)) e.target.classList.add('in');
  }, {rootMargin: '0px 0px -20% 0px'});
  beats.forEach(b => soft.observe(b));
  sg.scenes.set(scene, {activate, soft});
  if (isLadder) setLevel(scene, 1);
}

function setLevel(scene, level) {
  const rungs = $$('.rung', scene);
  for (const r of rungs) {
    const l = Number(r.dataset.level);
    r.classList.toggle('on', l === level);
    r.classList.toggle('past', l < level);
  }
  const bob = $('.ladder-bob', scene), stage = $('.stage', scene), rung = rungs.find(r => Number(r.dataset.level) === level);
  if (bob && rung && getComputedStyle(bob).display !== 'none') {
    const sr = stage.getBoundingClientRect(), rr = rung.getBoundingClientRect();
    bob.style.top = '0px';
    bob.style.transform = `translateY(${rr.top - sr.top + rr.height / 2 - 28}px)`;
  }
}

/* ---------------- Evidence dialog ---------------- */
const dialog = $('#exhibit');
$$('[data-exhibit]').forEach(btn => btn.addEventListener('click', e => {
  e.preventDefault();
  $('#exhibit-img').src = btn.dataset.exhibit;
  $('#exhibit-img').alt = btn.dataset.caption || 'Evidence';
  $('#exhibit-cap').textContent = btn.dataset.caption || '';
  dialog.showModal();
}));
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

/* ---------------- Comment wall: two lenses ---------------- */
(function wall() {
  const data = (window.SG && window.SG.comments) || [];
  const grid = $('#wall-grid'); if (!grid || !data.length) return;
  const filtersEl = $('#wall-filters');
  const LENSES = {
    x: {key: 'x', order: {f: 0, q: 1, w: 2, m: 3, o: 4}, zero: 'p', cats: [['f', 'Laughed, tagged, passed it on', 'x-f'], ['q', 'Real or AI?', 'x-q'], ['w', 'Worried what\u2019s real', 'x-w'], ['m', 'Followed the money', 'x-m'], ['o', 'Everything else', 'x-o'], ['p', 'Asked who\u2019s behind him', 'x-p']]},
    r: {key: 'r', order: {d: 0, a: 1, n: 2}, cats: [['d', 'Delight', 'r-d'], ['a', 'Alarm', 'r-a'], ['n', 'Neither', 'r-n']]},
    s: {key: 's', order: {a: 0, r: 1, m: 2, q: 3, n: 4}, cats: [['a', 'Said AI', 's-a'], ['r', 'Said real', 's-r'], ['m', 'Remake or wig', 's-m'], ['q', 'Just asked', 's-q'], ['n', "Didn't say", 's-n']]},
  };
  const didLabel = {f: 'passed it on', q: 'real or AI?', w: 'worried what\u2019s real', m: 'followed the money', o: ''};
  let firstWorried = true;
  const stanceLabel = {a: 'said it was AI', r: 'said it was real', m: 'called it a remake, a skit or a wig', q: 'just asked', n: 'took no position'};
  const modeLabel = {qu: 'quoted the video', re: 'a remark', im: 'posted an image', em: 'emoji', ta: 'tagged someone', cl: ''};
  let lens = LENSES.x, filter = 'all', items = [], selected = null;
  function build() {
    items = data.map((c, i) => ({...c, i})).sort((x, y) => (lens.order[x[lens.key]] ?? 9) - (lens.order[y[lens.key]] ?? 9) || x.i - y.i);
    const cls = Object.fromEntries(lens.cats.map(([k, , c]) => [k, c]));
    grid.replaceChildren(...items.map((c, k) => { const el = document.createElement('i'); el.className = cls[c[lens.key]] || ''; el.dataset.k = k; return el; }));
    if (lens.zero) { const z = document.createElement('i'); z.className = 'x-p'; z.dataset.zero = '1'; z.title = 'Asked who\u2019s behind him: nobody'; grid.append(z); }
    const counts = {}; items.forEach(c => counts[c[lens.key]] = (counts[c[lens.key]] || 0) + 1);
    filtersEl.replaceChildren();
    const mk = (k, label, c, n) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.wall = k; b.setAttribute('aria-pressed', 'false');
      b.innerHTML = (c ? `<i class="sw ${c}"></i>` : '') + `${label} <b>${n}</b>`; b.addEventListener('click', () => setFilter(k)); filtersEl.append(b); };
    mk('all', 'All', '', items.length);
    lens.cats.forEach(([k, label, c]) => mk(k, label, c, counts[k] || 0));
    setFilter('all', true);
  }
  function setFilter(k, quiet) {
    filter = k;
    $$('[data-wall]', filtersEl).forEach(b => b.setAttribute('aria-pressed', b.dataset.wall === k));
    grid.classList.toggle('filtering', k !== 'all');
    [...grid.children].forEach((el, i) => el.classList.toggle('hit', el.dataset.zero ? (k === 'all' || k === lens.zero) : (k === 'all' || items[i][lens.key] === k)));
    $('#wall-random').hidden = k === lens.zero;
    if (k === lens.zero) return showZero();
    if (!quiet && k === 'w' && firstWorried) { firstWorried = false; const j = items.findIndex(c => /more it learns/.test(c.t)); if (j >= 0) return show(j); }
    if (!quiet) randomPick();
  }
  function show(k) {
    const c = items[k]; if (!c) return;
    selected?.classList.remove('sel');
    selected = grid.children[k]; selected?.classList.add('sel');
    const bits = lens.key === 'x' ? [didLabel[c.x] || ''] : [stanceLabel[c.s] || ''];
    if (lens.key === 's' && c.s === 'a' && c.c === 'i') bits[0] += ' (implied)';
    if (modeLabel[c.m]) bits.push(modeLabel[c.m]);
    bits.push(c.l === 'r' ? 'a reply' : 'a comment');
    if (c.g) bits.push(`${c.g} before capture`);
    $('#wall-meta').textContent = bits.filter(Boolean).join(' · ');
    $('#wall-text').textContent = c.t || '(no text)';
  }
  function showZero() {
    selected?.classList.remove('sel'); selected = null;
    $('#wall-meta').textContent = 'asked who\u2019s behind him';
    $('#wall-text').textContent = 'Nobody. Not one of the 475 we captured.';
  }
  function randomPick() {
    const pool = items.map((c, k) => k).filter(k => (filter === 'all' || items[k][lens.key] === filter) && items[k].t && !/^\[/.test(items[k].t));
    if (pool.length) show(pool[Math.floor(Math.random() * pool.length)]);
  }
  grid.addEventListener('pointerover', e => { if (e.target.dataset.zero) return showZero(); if (!e.target.dataset.k || filter === lens.zero) return; show(Number(e.target.dataset.k)); });
  grid.addEventListener('click', e => { if (e.target.dataset.zero) return setFilter(lens.zero); if (!e.target.dataset.k) return; if (filter === lens.zero) setFilter('all', true); show(Number(e.target.dataset.k)); });
  $('#wall-random').addEventListener('click', randomPick);
  const tabs = $$('.wall-lens [data-lens]');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.setAttribute('aria-selected', x === t));
    lens = LENSES[t.dataset.lens]; build(); randomPick();
  }));
  build();
  const start = items.findIndex(c => /^The original guy/.test(c.t));
  show(start >= 0 ? start : 0);

  // Play-mode hooks (__sg.wall). Every comment is addressed by its original index in window.SG.comments (data-k
  // changes with the lens), and nothing here is random: a filter without a chosen comment shows that filter's
  // default (All: the page's opening comment; Worried: the "more it learns" one; otherwise the first in lens order).
  const kOf = orig => items.findIndex(c => c.i === orig);
  function showDefault() {
    if (filter === lens.zero) return showZero();
    let j = filter === 'all' ? items.findIndex(c => /^The original guy/.test(c.t)) : filter === 'w' ? items.findIndex(c => /more it learns/.test(c.t)) : -1;
    if (j < 0) j = items.findIndex(c => (filter === 'all' || c[lens.key] === filter) && c.t && !/^\[/.test(c.t));
    if (j >= 0) show(j);
  }
  function setLens(key) {
    const L = LENSES[key];
    if (!L || L === lens) return false;
    tabs.forEach(x => x.setAttribute('aria-selected', x.dataset.lens === key));
    lens = L; build();
    return true;
  }
  const known = k => k === 'all' || lens.cats.some(([c]) => c === k);
  sg.wallApi = {
    reset() { firstWorried = true; setLens('x'); setFilter('all', true); showDefault(); return this.state; },
    lens(key) { if (setLens(key)) showDefault(); return this.state; },
    filter(k, {show: orig = null} = {}) {
      if (!known(k)) return this.state;
      setFilter(k, true);
      if (k !== lens.zero) { const j = orig == null ? -1 : kOf(orig); if (j >= 0) show(j); else showDefault(); }
      return this.state;
    },
    show(orig) {
      const j = kOf(orig); if (j < 0) return false;
      if (filter === lens.zero) setFilter('all', true);
      show(j);
      return true;
    },
    zero() { if (!lens.zero) setLens('x'); setFilter(lens.zero, true); return this.state; },
    get state() {
      const k = selected ? Number(selected.dataset.k) : -1;
      return {lens: lens.key, filter, zero: filter === lens.zero, shown: k >= 0 && items[k] ? items[k].i : null};
    },
  };
})();

/* ---------------- Swap slider ---------------- */
(function swapSlider() {
  const frame = $('.swap-frame'); if (!frame) return;
  const range = $('#swap-range'), btn = $('#swap-play');
  const setPos = v => { v = Math.max(0, Math.min(100, v)); frame.style.setProperty('--pos', v + '%'); range.value = v; };
  range.addEventListener('input', () => setPos(Number(range.value)));
  // Pointer dragging anywhere on the frame; vertical swipes still scroll the page.
  let dragging = false;
  const fromEvent = e => { const r = frame.getBoundingClientRect(); setPos((e.clientX - r.left) / r.width * 100); };
  frame.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    dragging = true; frame.setPointerCapture(e.pointerId); fromEvent(e);
  });
  frame.addEventListener('pointermove', e => { if (dragging) fromEvent(e); });
  const stop = () => { dragging = false; };
  frame.addEventListener('pointerup', stop); frame.addEventListener('pointercancel', stop);
  // Gentle first-time hint: sweep the line once when it comes into view.
  let hinted = false, sweeping = false;

  let raf = 0;
  // Both files are page copies trimmed to Jeferson's 3.20-58.20 s; every seek is still clamped to the file.
  const clampT = (v, t) => Math.max(0, Math.min(t, (Number.isFinite(v.duration) ? v.duration : 55) - .05));
  function sync() {
    if (!swap.playing) return;
    const d = swap.over.currentTime - swap.under.currentTime;
    if (Math.abs(d) > .12) swap.over.currentTime = clampT(swap.over, swap.under.currentTime);
    raf = requestAnimationFrame(sync);
  }
  let starting = false;
  async function play(auto) {
    if (starting) return;
    starting = true;
    for (const v of [swap.under, swap.over]) if (v.preload === 'none') { v.preload = 'auto'; v.load(); }
    swap.over.currentTime = clampT(swap.over, swap.under.currentTime);
    try { await Promise.all([swap.under.play(), swap.over.play()]); } catch { return; } finally { starting = false; }
    if (auto && !swap.inView) { swap.under.pause(); swap.over.pause(); return; }
    swap.playing = true; btn.textContent = '❚❚ Pause'; btn.setAttribute('aria-pressed', 'true');
    applySound(); cancelAnimationFrame(raf); sync();
  }
  function pause() {
    swap.under.pause(); swap.over.pause(); swap.playing = false; cancelAnimationFrame(raf);
    btn.textContent = '▶ Play both'; btn.setAttribute('aria-pressed', 'false'); applySound();
  }
  btn.addEventListener('click', () => {
    if (swap.playing) { swap.userPaused = true; pause(); } else { swap.userPaused = false; play(); }
  });
  swap.stop = pause;
  swap.resume = () => { if (driven()) return; if (swap.inView && state.autoplay && !swap.playing && !swap.userPaused) play(true); };
  swap.under.addEventListener('seeked', () => { if (sg.owned.has(swap.over)) return; swap.over.currentTime = clampT(swap.over, swap.under.currentTime); });
  new IntersectionObserver(([e]) => {
    swap.inView = e.isIntersecting && e.intersectionRatio > .4;
    // While a player runs it owns the swap (no auto play, no hint); a swap it isn't driving still stops off screen.
    if (driven()) { if (!swap.inView && swap.playing && !sg.owned.has(swap.under)) pause(); return; }
    if (swap.inView) {
      if (state.autoplay && !swap.playing && !swap.userPaused) play(true);
      if (!hinted && !reduced && !sg.swapNoHint) {
        hinted = true; sweeping = true;
        const t0 = performance.now();
        const sweep = t => { if (!sweeping) return; const p = Math.min(1, (t - t0) / 1600); setPos(50 + Math.sin(p * Math.PI * 2) * 22); if (p < 1) requestAnimationFrame(sweep); else sweeping = false; };
        requestAnimationFrame(sweep);
      }
    } else if (swap.playing) pause();
    applySound();
  }, {threshold: [0, .4, .8]}).observe(frame);

  // Play-mode hooks (__sg.swap). The button and the over/under sync follow whoever plays the pair.
  const mark = on => {
    if (on === swap.playing) return;
    swap.playing = on; cancelAnimationFrame(raf);
    btn.textContent = on ? '❚❚ Pause' : '▶ Play both'; btn.setAttribute('aria-pressed', String(on));
    if (on && !rendering()) sync();
  };
  sg.onDrive.set(swap.under, mark);
  sg.swapApi = {
    // --pos = the line from the left: 100 = all Jeferson (#swap-under), 0 = all Jean Phil (#swap-over).
    setPos(v) { sweeping = false; hinted = true; setPos(Number(v)); return Number(range.value); },
    get pos() { return Number(range.value); },
    noHint(on = true) { sg.swapNoHint = !!on; if (on) sweeping = false; },
    at(t, o = {}) { return Promise.all([videoAt(swap.under, t, o), videoAt(swap.over, t, o)]); },
    stopHint() { sweeping = false; },
    pause,
    // Back in reader mode: what arriving (or leaving) would do now, minus the hint.
    refresh() {
      if (swap.inView) { if (state.autoplay && !swap.playing && !swap.userPaused) play(true); else if (swap.playing) { cancelAnimationFrame(raf); sync(); } }
      else if (swap.playing) pause();
      applySound();
    },
  };
})();

/* ---------------- Shared data (market snapshot + token births) ---------------- */
const snapshot = fetch('assets/data/market-snapshot.json').then(r => r.json()).catch(() => null);

/* ---------------- Timeline ---------------- */
(async function timeline() {
  const svg = $('#timeline'); if (!svg) return;
  const snap = await snapshot;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = text; svg.append(n); return n; };
  const pdt = s => Date.parse(s + '-07:00');
  const t0 = pdt('2026-09-17T00:00:00'), t1 = pdt('2026-09-28T00:00:00');
  const X0 = 150, X1 = 1080, x = t => X0 + (t - t0) / (t1 - t0) * (X1 - X0);
  const lanes = {jp: 78, copies: 168, money: 258};
  // day ticks
  for (let d = 0; d <= 11; d++) {
    const t = t0 + d * 86400000, xx = x(t);
    el('line', {class: 't-tick', x1: xx, x2: xx, y1: 30, y2: 310});
    if (d < 11) el('text', {class: 't-day', x: xx + 4, y: 24}, `Sep ${17 + d}`);
  }
  for (const [k, label] of [['jp', 'Jean Phil'], ['copies', 'Copies & reactions'], ['money', 'The money']]) {
    el('line', {class: 't-axis', x1: X0, x2: X1, y1: lanes[k], y2: lanes[k]});
    el('text', {class: 't-lane', x: 0, y: lanes[k] + 4}, label);
  }
  const events = [
    {lane: 'jp', t: pdt('2026-09-17T16:10:56'), label: 'First video', cls: 'ev-video', dy: -14},
    {lane: 'jp', t: pdt('2026-09-18T09:10:26'), label: 'Street', cls: 'ev-video', dy: 22},
    {lane: 'jp', t: pdt('2026-09-19T12:00:00'), label: 'Park clip: 5.6M views in 3 days (date only)', cls: 'ev-video', dy: -14, approx: true},
    {lane: 'jp', t: pdt('2026-09-22T09:10:07'), label: 'Oysters', cls: 'ev-video', dy: 22},
    {lane: 'copies', t: pdt('2026-09-25T13:35:15'), label: 'Ty Farrago’s remix', cls: 'ev-copy', dy: -14, anchor: 'end'},
    {lane: 'copies', t: pdt('2026-09-25T15:09:23'), label: 'Carrasco: “not real”', cls: 'ev-copy', dy: 22, anchor: 'end'},
    {lane: 'copies', t: pdt('2026-09-26T11:47:58'), label: 'The tutorial', cls: 'ev-copy', dy: -14},
    {lane: 'copies', t: pdt('2026-09-26T19:00:00'), label: 'We capture comments, make our copy', cls: 'ev-copy', dy: 42, anchor: 'end', approx: true},
    {lane: 'money', t: pdt('2026-09-19T11:15:56'), label: 'JEANPHIL launches on pump.fun', cls: 'ev-coin', dy: -14, anchor: 'end'},
    {lane: 'money', t: pdt('2026-09-20T12:00:00'), label: '“Official” token promoted (date only)', cls: 'ev-coin', dy: -14, approx: true},
  ];
  for (const e of events) {
    const xx = x(e.t), y = lanes[e.lane];
    const sq = el('rect', {class: e.cls, x: xx - 6, y: y - 6, width: 12, height: 12, rx: e.cls === 'ev-coin' ? 6 : 1});
    if (e.approx) { sq.setAttribute('fill-opacity', '.25'); sq.setAttribute('stroke', 'currentColor'); sq.setAttribute('stroke-dasharray', '2 2'); sq.style.color = 'var(--bone-2)'; }
    const end = e.anchor === 'end';
    el('text', {class: 'ev-label', x: end ? xx + 6 : xx - 6, y: y + e.dy, 'text-anchor': end ? 'end' : 'start'}, e.label);
  }
  // Token offspring as small coins on a sub-lane.
  if (snap && snap.children) {
    const seen = new Set();
    snap.children.filter(c => !c.preexisting).forEach((c, k) => {
      const xx = x(c.created), y = lanes.money + 20 + (k % 3) * 9;
      const dot = el('circle', {class: 'ev-child', cx: xx, cy: y, r: 4});
      if (!c.withheld) dot.append(Object.assign(document.createElementNS(NS, 'title'), {textContent: `${c.name || c.symbol} (${c.symbol})`}));
      seen.add(c.address || c.symbol);
    });
    el('text', {class: 'ev-label', x: x(pdt('2026-09-21T06:00:00')), y: lanes.money + 52, fill: 'var(--blond)'}, `← ${seen.size} new tokens priced in JEANPHIL, Sept 20–27`);
  }
  // "Now" marker
  const now = pdt('2026-09-27T08:40:00');
  el('line', {x1: x(now), x2: x(now), y1: 30, y2: 326, stroke: 'var(--red)', 'stroke-dasharray': '3 3'});
  el('text', {x: x(now) - 4, y: 338, 'text-anchor': 'end', fill: 'var(--red)'}, 'We checked: Sept 27, 8:40 a.m.');
})();

/* ---------------- Market panel ---------------- */
(async function market() {
  const root = $('#market'); if (!root) return;
  const snap = await snapshot; if (!snap) return;
  const POOL = '4R8CiMnJWDNoes3fQi1ccPFJygPXazaHaWpHrN3rZeNj';
  let quote = snap.quote, history = snap.history, hours = 168, nearby = false;
  const feeds = {quote: {at: snap.quoteAt, live: false, last: 0}, history: {at: snap.historyAt, live: false, last: 0}};
  const usd = (v, sig) => v == null ? '—' : new Intl.NumberFormat('en-US', sig ? {style: 'currency', currency: 'USD', maximumSignificantDigits: sig} : {style: 'currency', currency: 'USD', maximumFractionDigits: 0}).format(v);
  const when = v => new Date(v).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles', timeZoneName: 'short'});
  function renderQuote() {
    $('#m-price').textContent = usd(quote.price, 4);
    const ch = $('#m-change');
    ch.textContent = quote.change == null ? '—' : `${quote.change > 0 ? '+' : '−'}${Math.abs(quote.change).toFixed(2)}% 24h`;
    ch.dataset.dir = quote.change < 0 ? 'down' : 'up';
    $('#m-cap').textContent = usd(quote.marketCap);
    $('#m-vol').textContent = usd(quote.volume);
    $('#m-liq').textContent = usd(quote.liquidity);
    $('#m-txns').textContent = quote.buys24 == null ? '—' : `${quote.buys24.toLocaleString()} buys / ${quote.sells24.toLocaleString()} sells`;
  }
  let pts = [];
  function renderChart() {
    pts = selectPeriod(history, hours);
    const W = 900, {low, high, xy, path} = chartGeometry(pts, W);
    const svg = $('#m-chart'); svg.setAttribute('viewBox', `0 0 ${W} 280`);
    const grid = $('#m-grid'); grid.replaceChildren();
    const NS = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < 4; i++) {
      const y = 22 + i * 80;
      const l = document.createElementNS(NS, 'line'); Object.entries({x1: 82, x2: W - 28, y1: y, y2: y}).forEach(([k, v]) => l.setAttribute(k, v)); grid.append(l);
      const t = document.createElementNS(NS, 'text'); t.setAttribute('x', 72); t.setAttribute('y', y + 4); t.setAttribute('text-anchor', 'end');
      t.textContent = usd(high - (high - low) * i / 3, 3); grid.append(t);
    }
    $('#m-line').setAttribute('d', path);
    const first = xy[0], last = xy.at(-1);
    $('#m-area').setAttribute('d', `${path} L${last.x},262 L${first.x},262 Z`);
    $('#m-chart-desc').textContent = `JEANPHIL hourly closing prices, ${pts.length} hours from ${when(pts[0].time * 1000)} to ${when(pts.at(-1).time * 1000)}: first ${usd(pts[0].price, 4)}, last ${usd(pts.at(-1).price, 4)}.`;
    inspect(mk.inspectI != null ? clampI(mk.inspectI) : pts.length - 1);
    $$('[data-hours]', root).forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.hours) === hours));
    applyDraw();
  }
  // Play-mode draw-on (__sg.market.draw): the line and its area are clipped at the hour p of the way along, and the
  // dot rides the tip. p = 1 (the page's own state) takes the clip away.
  const mk = sg.market;
  const clampI = i => Math.max(0, Math.min(pts.length - 1, Math.round(i)));
  function applyDraw() {
    const p = mk.drawP, svg = $('#m-chart'), line = $('#m-line'), area = $('#m-area'), dot = $('#m-dot');
    if (!(p < 1)) { line.removeAttribute('clip-path'); area.removeAttribute('clip-path'); dot.style.removeProperty('visibility'); return; }
    const NS = 'http://www.w3.org/2000/svg';
    let rect = $('#m-draw-clip rect', svg);
    if (!rect) {
      const defs = document.createElementNS(NS, 'defs'), cp = document.createElementNS(NS, 'clipPath');
      cp.id = 'm-draw-clip'; cp.setAttribute('clipPathUnits', 'userSpaceOnUse');
      rect = document.createElementNS(NS, 'rect'); rect.setAttribute('x', -20); rect.setAttribute('y', -40); rect.setAttribute('height', 400);
      cp.append(rect); defs.append(cp); svg.prepend(defs);
    }
    const {xy} = chartGeometry(pts, 900), q = Math.max(0, p);
    rect.setAttribute('width', q > 0 ? (xy[0].x + (xy.at(-1).x - xy[0].x) * q + 20).toFixed(2) : 0);
    line.setAttribute('clip-path', 'url(#m-draw-clip)'); area.setAttribute('clip-path', 'url(#m-draw-clip)');
    if (q > 0) { dot.style.removeProperty('visibility'); inspect(clampI(q * (pts.length - 1))); } else dot.style.visibility = 'hidden';
  }
  function inspect(i) {
    const p = pts[i]; if (!p) return;
    const {xy} = chartGeometry(pts, 900);
    $('#m-dot').setAttribute('cx', xy[i].x); $('#m-dot').setAttribute('cy', xy[i].y);
    $('#m-readout').textContent = `${when(p.time * 1000)} · ${usd(p.price, 4)}`;
  }
  $('#m-chart').addEventListener('pointermove', e => {
    const r = e.currentTarget.getBoundingClientRect(), xx = (e.clientX - r.left) / r.width * 900;
    const {xy} = chartGeometry(pts, 900); let n = 0;
    for (let i = 1; i < xy.length; i++) if (Math.abs(xy[i].x - xx) < Math.abs(xy[n].x - xx)) n = i;
    inspect(n);
  });
  $('#m-chart').addEventListener('pointerleave', () => inspect(pts.length - 1));
  $$('[data-hours]', root).forEach(b => b.addEventListener('click', () => { hours = Number(b.dataset.hours); renderChart(); }));
  function renderStatus() {
    const live = feeds.quote.live && feeds.history.live;
    root.classList.toggle('live', live);
    $('#m-state').textContent = live ? 'Live' : (feeds.quote.live || feeds.history.live) ? 'Partly live' : 'Saved snapshot';
    $('#m-times').textContent = `${feeds.quote.live ? 'Price checked' : 'Saved price'} ${when(feeds.quote.at)}. ${feeds.history.live ? 'Chart checked' : 'Saved chart'} ${when(feeds.history.at)}.`;
  }
  async function pull(kind) {
    if (mk.snapshotOnly) return;
    const f = feeds[kind]; f.last = Date.now();
    try {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(kind === 'quote' ? QUOTE_URL : HISTORY_URL, {signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
      clearTimeout(timer);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (mk.snapshotOnly) return; // switched to the saved snapshot while this was in flight
      if (kind === 'quote') {
        const q = parseQuote(data), pair = data.find(p => p.pairAddress === POOL);
        quote = {...q, marketCap: pair?.marketCap ?? null, buys24: pair?.txns?.h24?.buys ?? null, sells24: pair?.txns?.h24?.sells ?? null};
        renderQuote();
      } else { history = parseHistory(data); renderChart(); }
      f.at = new Date().toISOString(); f.live = true;
    } catch { /* keep the last good data */ }
    renderStatus();
  }
  function tick() {
    if (!nearby || document.hidden || mk.snapshotOnly) return;
    if (Date.now() - feeds.quote.last > 60000) pull('quote');
    if (Date.now() - feeds.history.last > 300000) pull('history');
  }
  new IntersectionObserver(([e]) => { nearby = e.isIntersecting; tick(); }, {rootMargin: '200px'}).observe(root);
  document.addEventListener('visibilitychange', tick);
  setInterval(tick, 15000);
  renderQuote(); renderChart(); renderStatus();
  // Play-mode hooks (__sg.market), bound now that the data is here (calls made earlier were kept and apply now).
  mk.impl = {
    snapshotOnly(on) {
      if (on && (feeds.quote.live || feeds.history.live)) { // back to the saved snapshot ($0.003767, -24.19%)
        quote = snap.quote; history = snap.history;
        Object.assign(feeds.quote, {at: snap.quoteAt, live: false}); Object.assign(feeds.history, {at: snap.historyAt, live: false});
        renderQuote(); renderChart(); renderStatus();
      }
      if (!on) tick();
    },
    draw() { applyDraw(); },
    inspect() { inspect(mk.inspectI != null ? clampI(mk.inspectI) : pts.length - 1); },
    period(h) { if (h !== hours && [24, 168].includes(h)) { hours = h; renderChart(); } },
    get points() { return pts.length; },
    get readout() { return $('#m-readout').textContent; },
  };
  if (mk.snapshotOnly) mk.impl.snapshotOnly(true); // (renderChart above already applied any queued draw/inspect)
})().finally(() => sg.marketReady?.());

/* ---------------- Simulation: λspawn vs λtakedown ---------------- */
(function sim() {
  const canvas = $('#sim-canvas'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const ui = {status: $('#sim-status'), orig: $('#sim-orig'), copies: $('#sim-copies'), spawn: $('#sim-spawn'), tick: $('#sim-tick'),
    td: $('#sim-takedown'), tdOut: $('#sim-takedown-out'), rate: $('#sim-rate'), rateOut: $('#sim-rate-out'),
    adapt: $('#sim-adapt'), run: $('#sim-run'), reset: $('#sim-reset')};
  let cols, rows, cells, fx, tickN = 0, boost = 1, running = !reduced, inView = false, adapt = false, gone = 0, faces = 1, last = 0, prevCopies = 0;
  function layout() {
    const narrow = canvas.clientWidth < 560;
    cols = narrow ? 16 : 32; rows = narrow ? 16 : 20;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientWidth * (rows / cols) * dpr);
  }
  function reset() {
    layout();
    cells = new Uint8Array(cols * rows); fx = new Float32Array(cols * rows);
    for (let k = 0; k < 3; k++) cells[Math.floor(Math.random() * cells.length)] = 1;
    tickN = 0; boost = 1; gone = 0; faces = 1; prevCopies = 3;
    draw(); stats();
  }
  const count = () => cells.reduce((a, c) => a + c, 0);
  function neighbor(i) {
    const cx = i % cols, cy = (i / cols) | 0;
    const dx = Math.floor(Math.random() * 3) - 1, dy = Math.floor(Math.random() * 3) - 1;
    const nx = (cx + dx + cols) % cols, ny = (cy + dy + rows) % rows;
    return ny * cols + nx;
  }
  function step() {
    const td = Number(ui.td.value), rate = Number(ui.rate.value);
    const n = cells.length, copies = count(), frac = copies / n;
    if (adapt) {
      if (copies > 0 && frac < .08) boost = Math.min(boost * 1.07, 4);
      else boost = Math.max(1, boost * .995);
    } else boost = 1;
    const eff = Math.min(.9, rate * boost);
    const next = cells.slice();
    for (let i = 0; i < n; i++) {
      if (cells[i] !== 1) continue;
      if (Math.random() < eff) {
        const t = Math.random() < .75 ? neighbor(i) : Math.floor(Math.random() * n);
        if (next[t] === 0) { next[t] = 1; fx[t] = 1; }
      }
      if (Math.random() < td) { next[i] = 0; fx[i] = -1; }
    }
    cells = next; tickN++;
    const now = count();
    if (now === 0) {
      gone++;
      if (adapt && gone > 16) {
        for (let k = 0; k < 2; k++) { const j = Math.floor(Math.random() * n); cells[j] = 1; fx[j] = 1; }
        faces++; gone = 0; boost = 1.6; message('New face. New coin.');
      }
    } else gone = 0;
    stats(eff, now);
  }
  let lockedMsg = 0;
  function message(t) { ui.status.textContent = t; lockedMsg = 12; }
  function stats(eff = Number(ui.rate.value), now = count()) {
    const n = cells.length, origPct = Math.round((1 - now / n) * 100);
    ui.orig.textContent = origPct + '%'; ui.copies.textContent = now; ui.tick.textContent = tickN;
    ui.spawn.textContent = eff.toFixed(2); ui.spawn.style.color = eff > 1.5 * Number(ui.td.value) ? 'var(--blond)' : 'var(--bone-2)';
    if (lockedMsg > 0) { lockedMsg--; prevCopies = now; return; }
    let msg;
    if (now === 0) msg = adapt ? 'Gone… for now.' : 'You got him. This time.';
    else if (now / n > .9) msg = 'The feed is Jean Phil now.';
    else if (faces > 1 && now > 0) msg = `Face no. ${faces}. Same haircut.`;
    else if (now > prevCopies) msg = eff > 1.5 * Number(ui.td.value) ? 'He’s loose.' : 'Spreading, barely.';
    else if (now < prevCopies) msg = 'You’re winning. Slowly.';
    else msg = ui.status.textContent;
    ui.status.textContent = msg; prevCopies = now;
  }
  function draw() {
    const W = canvas.width, H = canvas.height, cw = W / cols, ch = H / rows, pad = Math.max(1, cw * .08);
    ctx.fillStyle = '#080807'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < cells.length; i++) {
      const x = (i % cols) * cw + pad, y = ((i / cols) | 0) * ch + pad, w = cw - pad * 2, h = ch - pad * 2;
      if (cells[i] === 1) {
        ctx.fillStyle = '#e8cd8c'; ctx.fillRect(x, y, w, h);
        // a tiny bob and mustache
        ctx.fillStyle = '#8a6a2e';
        ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * .42, w * .34, h * .3, 0, Math.PI, 0); ctx.fill();
        ctx.fillRect(x + w * .16, y + h * .4, w * .14, h * .3); ctx.fillRect(x + w * .70, y + h * .4, w * .14, h * .3);
        ctx.strokeStyle = '#3b2a12'; ctx.lineWidth = Math.max(1, w * .06);
        ctx.beginPath(); ctx.moveTo(x + w * .34, y + h * .7); ctx.quadraticCurveTo(x + w * .5, y + h * .6, x + w * .66, y + h * .7); ctx.stroke();
      } else {
        ctx.fillStyle = '#1c1a16'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(242,236,225,.16)';
        ctx.beginPath(); ctx.arc(x + w / 2, y + h * .45, Math.min(w, h) * .16, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(x + w * .3, y + h * .66, w * .4, h * .12);
      }
      if (fx[i] !== 0) {
        ctx.strokeStyle = fx[i] > 0 ? 'rgba(253,0,1,' + Math.abs(fx[i]) + ')' : 'rgba(242,236,225,' + Math.abs(fx[i]) + ')';
        ctx.lineWidth = Math.max(1.5, cw * .08); ctx.strokeRect(x, y, w, h);
        fx[i] = fx[i] > 0 ? Math.max(0, fx[i] - .2) : Math.min(0, fx[i] + .2);
      }
    }
  }
  function loop(t) {
    if (running && inView && t - last > 140) { step(); last = t; }
    draw();
    if (inView) requestAnimationFrame(loop);
  }
  new IntersectionObserver(([e]) => { const was = inView; inView = e.isIntersecting; if (inView && !was) requestAnimationFrame(loop); }, {threshold: .1}).observe(canvas);
  const sync = () => { ui.tdOut.textContent = Number(ui.td.value).toFixed(2); ui.rateOut.textContent = Number(ui.rate.value).toFixed(2); stats(); };
  ui.td.addEventListener('input', sync); ui.rate.addEventListener('input', sync);
  ui.adapt.addEventListener('click', () => { adapt = !adapt; ui.adapt.setAttribute('aria-pressed', adapt); ui.adapt.textContent = adapt ? 'Adapting' : 'Let him adapt'; if (adapt) message('He’s learning.'); });
  ui.run.addEventListener('click', () => { running = !running; ui.run.setAttribute('aria-pressed', running); ui.run.textContent = running ? 'Pause' : 'Run'; });
  ui.reset.addEventListener('click', reset);
  if (!running) { ui.run.textContent = 'Run'; ui.run.setAttribute('aria-pressed', 'false'); }
  addEventListener('resize', () => { const old = cols; layout(); if (cols !== old) reset(); else draw(); });
  reset();
})();

/* ---------------- Wallet models ---------------- */
(function wallets() {
  const svg = $('#wallet-svg'); if (!svg) return;
  const NS = 'http://www.w3.org/2000/svg';
  const text = {
    independent: ['Model 1 · Independent wallets', 'Every copy keeps its own money. The developer is “detached from both control and economic benefit.” It’s the hardest version to shut down, because there’s no central account to freeze.'],
    shared: ['Model 2 · Shared wallet', 'Every copy pays into one wallet the developer set up. It’s lucrative and fragile: the developer, or anyone who can freeze that pool, can stall the whole family at once.'],
    tax: ['Model 3 · Taxation', 'Each copy runs on its own wallet but sends a cut of any surplus back to the developer, “a form of taxation.” The authors expect shared and taxed models to show up first, because they pay whoever launched them.'],
  };
  const faces = Array.from({length: 6}, (_, i) => ({x: 320, y: 40 + i * 60}));
  function node(tag, attrs, parent = svg) { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); parent.append(n); return n; }
  function draw(model) {
    svg.replaceChildren();
    const dev = {x: 48, y: 190}, hub = {x: 178, y: 190};
    node('circle', {class: 'dev', cx: dev.x, cy: dev.y, r: 16});
    node('text', {x: dev.x, y: dev.y + 36, 'text-anchor': 'middle'}).textContent = 'Developer';
    if (model === 'independent') {
      faces.forEach(f => node('path', {d: `M${dev.x + 16},${dev.y} L${f.x - 24},${f.y}`, stroke: 'rgba(242,236,225,.16)', 'stroke-dasharray': '2 6', fill: 'none'}));
      node('text', {x: dev.x, y: dev.y + 52, 'text-anchor': 'middle', fill: 'var(--mute)'}).textContent = 'walked away';
    } else {
      node('circle', {class: 'wallet', cx: hub.x, cy: hub.y, r: 22});
      node('text', {x: hub.x, y: hub.y + 4, 'text-anchor': 'middle'}).textContent = model === 'tax' ? 'tax' : 'pool';
      node('path', {class: 'flow', d: `M${hub.x - 22},${hub.y} L${dev.x + 18},${dev.y}`});
    }
    faces.forEach((f, i) => {
      if (model !== 'independent') node('path', {class: 'flow' + (model === 'tax' ? ' tax' : ''), d: `M${f.x - 24},${f.y} C${f.x - 80},${f.y} ${hub.x + 60},${hub.y} ${hub.x + 22},${hub.y}`});
      const u = node('use', {href: '#bob', x: f.x - 20, y: f.y - 20, width: 40, height: 40});
      u.style.color = 'var(--blond)';
      node('text', {x: f.x + 28, y: f.y - 10}).textContent = `Face ${i + 1}`;
      if (model !== 'shared') {
        node('path', {class: 'flow', d: `M${f.x + 26},${f.y + 6} L${f.x + 104},${f.y + 6}`});
        node('circle', {class: 'wallet', cx: f.x + 114, cy: f.y + 6, r: 9});
      }
    });
    if (model !== 'shared') node('text', {x: 434, y: 372, 'text-anchor': 'middle', fill: 'var(--mute)'}).textContent = 'own wallets';
  }
  const tabs = $$('.wallet-tabs [role=tab]');
  tabs.forEach(t => t.addEventListener('click', () => select(t)));
  tabs.forEach((t, i) => t.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); select(n); }
  }));
  function select(t) {
    tabs.forEach(x => { x.setAttribute('aria-selected', x === t); x.tabIndex = x === t ? 0 : -1; });
    $('#wallet-panel').setAttribute('aria-labelledby', t.id);
    const [k, d] = text[t.dataset.model];
    $('#wallet-kicker').textContent = k; $('#wallet-desc').textContent = d;
    draw(t.dataset.model);
  }
  select(tabs[0]);
})();

/* ---------------- Coin pile: spin-off coins stacking up by day ---------------- */
(async function coinPile() {
  const grid = $('#pile-grid'); if (!grid) return;
  const snap = await snapshot; if (!snap) return;
  const launch = Date.parse(snap.launch.pumpfun);
  const kids = snap.children.filter(c => !c.preexisting).sort((a, b) => a.created - b.created);
  const tz = {timeZone: 'America/Los_Angeles'};
  const dayKey = ms => new Date(ms).toLocaleDateString('en-US', {...tz, month: 'short', day: 'numeric'});
  const when = ms => new Date(ms).toLocaleString('en-US', {...tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}).replace(' AM', ' a.m.').replace(' PM', ' p.m.');
  const days = [];
  for (let t = launch; t <= kids[kids.length - 1].created + 864e5; t += 864e5) { const k = dayKey(t); if (!days.includes(k)) days.push(k); }
  const cols = new Map(days.map(k => [k, []]));
  const readout = $('#pile-readout'), count = $('#pile-n');
  const coins = [], labels = [];
  let shown = 0, sel = null, timers = []; // coins on, the selected coin, the drop-in timers
  const colEls = days.map((k, di) => {
    const col = document.createElement('div'); col.className = 'pile-col';
    const stack = document.createElement('div'); stack.className = 'pile-stack';
    if (di === 0) {
      const p = document.createElement('button'); p.type = 'button'; p.className = 'pile-coin pile-coin--parent';
      p.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><use href="#jp-mark"/></svg>';
      p.setAttribute('aria-label', `JEANPHIL, launched ${when(launch)}`);
      p.addEventListener('click', () => { readout.textContent = `JEANPHIL · launched ${when(launch)}`; });
      stack.append(p);
    }
    const lab = document.createElement('span'); lab.className = 'pile-day mono'; lab.textContent = k.replace('Sep', 'Sept');
    col.append(stack, lab); grid.append(col); return stack;
  });
  kids.forEach((c, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pile-coin' + (c.name ? '' : ' pile-coin--withheld');
    b.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><use href="#jp-mark"/></svg>';
    const h = Math.round((c.created - launch) / 36e5);
    const label = `${c.name || 'Name withheld'} · ${when(c.created)} · ${h} hours after launch`;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => { readout.textContent = label; coins.forEach(x => x.classList.remove('sel')); b.classList.add('sel'); sel = i; });
    colEls[days.indexOf(dayKey(c.created))].append(b); coins.push(b); labels.push(label);
  });
  count.textContent = reduced ? kids.length : 0;
  const SUMMARY = 'At least six arrived within two hours. Tap a coin.';
  let played = false;
  // Once, on arrival: the coins drop in one by one (from wherever a player left the pile, if it did).
  function play() {
    if (played) return;
    if (driven() || sg.pileNoAuto) return; // a player drops the coins on its own words (__sg.pile.set)
    played = true;
    if (reduced) { coins.forEach(b => b.classList.add('on')); shown = coins.length; return; }
    const from = shown;
    if (from >= coins.length) return;
    coins.forEach((b, i) => { if (i >= from) timers.push(setTimeout(() => { b.classList.add('on'); count.textContent = i + 1; shown = i + 1; }, 300 + (i - from) * 190)); });
    timers.push(setTimeout(() => { readout.textContent = SUMMARY; }, 300 + (kids.length - from) * 190 + 200));
  }
  new IntersectionObserver(([e]) => { if (e.isIntersecting && e.intersectionRatio > .5) play(); }, {threshold: [0, .5, .8]}).observe(grid);

  // Play-mode hooks (__sg.pile): the pile is a pure function of (k coins on, the selected coin, and optionally how
  // long ago each coin dropped); no timers. A coin that leaves goes at once (that is only ever a seek back).
  const rest = () => shown >= coins.length ? SUMMARY : 'Tap a coin.';
  const cancel = () => { timers.forEach(clearTimeout); timers = []; };
  const DROP_MS = 450; // .pile-coin: opacity .35 s, transform .45 s (the overshoot)
  const P = sg.pile;
  P.impl = {
    // ages[i]: seconds since coin i dropped. >= .45 s: settled; less: its drop-in is there, still running (in real or
    // virtual time) from that point. Without ages a newly dropped coin starts its drop-in now.
    set(k, {ages = null} = {}) {
      cancel();
      shown = Math.max(0, Math.min(coins.length, Math.round(Number(k) || 0)));
      coins.forEach((b, i) => {
        const on = i < shown;
        if (b.classList.contains('on') === on) return;
        b.classList.toggle('on', on);
        if (!on) b.getAnimations().forEach(a => a.cancel());
      });
      if (ages) coins.forEach((b, i) => {
        const age = i < shown ? Number(ages[i]) : NaN;
        if (!Number.isFinite(age)) return;
        let an = b.getAnimations();
        if (age * 1000 >= DROP_MS) { for (const a of an) { try { a.finish(); } catch {} } return; }
        if (!an.length) { b.classList.remove('on'); b.getAnimations().forEach(a => a.cancel()); void b.offsetWidth; b.classList.add('on'); an = b.getAnimations(); }
        // play() after the seek: it runs on from there (a virtual clock records it as running, not held)
        for (const a of an) { a.currentTime = Math.max(0, age) * 1000; a.play(); }
      });
      count.textContent = shown;
      if (sel == null) readout.textContent = rest();
      return shown;
    },
    select(i) {
      sel = i == null || !(i >= 0 && i < coins.length) ? null : Math.round(i);
      coins.forEach((b, j) => b.classList.toggle('sel', j === sel));
      readout.textContent = sel == null ? rest() : labels[sel];
      return sel;
    },
    cancel,
    // Back in reader mode with the pile caught part-way (the story paused mid-drop): the rest drop in from there, now if
    // the pile is in view, else when the reader arrives.
    wake() {
      if (shown >= coins.length) return;
      played = false;
      if (sel != null) { sel = null; coins.forEach(x => x.classList.remove('sel')); readout.textContent = rest(); } // ends on its summary, as on arrival
      const r = grid.getBoundingClientRect(), vis = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      if (r.height > 0 && vis > r.height * .5) play();
    },
    get state() { return {k: shown, sel, played, n: coins.length, readout: readout.textContent}; },
  };
  if (P.k != null) P.impl.set(P.k, P.opts);
  if (P.sel !== undefined) P.impl.select(P.sel);
})().finally(() => sg.pileReady?.());

/* ---------------- The machine: try to switch it off ---------------- */
(function machine() {
  const fig = $('.mach'); if (!fig) return;
  const data = JSON.parse($('#mach-data').textContent);
  const stations = $$('.mach-st', fig), card = $('.mach-text', fig), kick = $('.mach-kick', fig);
  const back = $('.mach-toggle', fig), status = $('.mach-who', fig);
  const q = t => t.replace(/“([^”]+)”/g, '<q>$1</q>');
  let touched = false, timers = [], stopped = false;
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  function say(key) { kick.textContent = data[key].kick; card.innerHTML = q(data[key].text); }
  function setStatus(word) { status.textContent = word; }
  // Taking out any part but the audience: it goes dark, then comes back.
  function kill(b) {
    const st = b.dataset.st;
    if (st === 'attention') return lookAway(b);
    if (stopped || b.classList.contains('dead')) return;
    b.classList.remove('reborn'); b.classList.add('dead');
    say(st); setStatus('down');
    setTimeout(() => {
      if (stopped) return;
      b.classList.remove('dead'); void b.offsetWidth; b.classList.add('reborn');
      const tag = $('.mach-tag', b); if (tag) tag.textContent = data.tags[st] || '';
      b.dataset.reborn = '';
      setStatus('running');
    }, 1100);
  }
  function lookAway(b) {
    if (stopped) return;
    stopped = true; fig.dataset.state = 'stopped';
    stations.forEach(x => x.classList.remove('reborn'));
    b.classList.add('dead');
    say('attention'); setStatus('stopped.');
    back.hidden = false;
  }
  function lookBack() {
    stopped = false; fig.dataset.state = 'running';
    stations.forEach(x => x.classList.remove('dead'));
    say('back'); setStatus('running');
    back.hidden = true;
  }
  const stop = () => { touched = true; timers.forEach(clearTimeout); timers = []; };
  stations.forEach(b => b.addEventListener('click', () => { stop(); kill(b); }));
  back.addEventListener('click', () => { stop(); lookBack(); });
  say('intro');
  // Play it once on arrival (and in the screen recording): kill three parts, then look away. Any tap takes over.
  let played = false;
  function play() {
    if (played || touched || reduced || !state.autoplay) return; played = true;
    const st = k => stations.find(b => b.dataset.st === k);
    // Long enough to read each card: about 5 s for the intro, 6 s for each piece of evidence.
    ['face', 'coin', 'copies', 'attention'].forEach((k, i) => later(() => { if (!touched && state.autoplay) kill(st(k)); }, 5000 + i * 6000));
  }
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && e.intersectionRatio > .6) play();
    else if (!e.isIntersecting && !touched) { timers.forEach(clearTimeout); timers = []; played = false; } // replay on return
  }, {threshold: [0, .6, .9]}).observe(fig);
})();

/* ================= window.__sg: the hooks the story player (Play) and the renderer drive =================
   Every hook sets state as a pure function of its arguments: no Math.random, no timers, no wall clock. Calling one for
   time t and then for an earlier t leaves the page exactly as calling it for the earlier t alone. The only real-time
   pieces are a video's own playback when asked to play, a grid stack's spring (front(i) without {instant}; at(x) is
   the pure form) and a reveal asked to {play}. The API is documented in scratchpad/autoplay/hooks-api.md. */
const clamp01 = (x, d = 0) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : d));

/* ---- mode ---- */
function renderStyle() {
  if ($('#sg-render-style')) return;
  const s = document.createElement('style');
  s.id = 'sg-render-style';
  s.textContent = 'html.render header.masthead{visibility:hidden!important}';
  document.head.append(s);
}
function setMode(m, opts = {}) {
  if (m === undefined) return sg.mode;
  if (m !== 'reader' && m !== 'play' && m !== 'render') throw new TypeError(`__sg.mode(): unknown mode "${m}"`);
  const prev = sg.mode;
  if (m === 'render') { renderStyle(); root.classList.toggle('render', opts.masthead !== true); }
  if (m === prev) return m;
  sg.mode = m;
  root.dataset.sgMode = m;
  if (prev === 'play' && m === 'reader') { storyPausedAt = performance.now(); hushed = true; } // a pause is silent
  if (prev === 'reader') {
    // Out of the story's way; every component stays exactly where it is.
    sg.readerAutoplay = state.autoplay;
    state.autoplay = true; root.dataset.autoplay = 'on';
    endReprise(true);          // a laugh the page started itself stops on its held face
    sg.pile.impl?.cancel();    // coins still dropping in stop where they are
    sg.swapApi?.stopHint();
    renderSound();             // html[data-sound]="off", no "Tap for sound"
  }
  if (m === 'render') { marketApi.snapshotOnly(true); grain(0); }
  else if (prev === 'render') { root.classList.remove('render'); $('.grain')?.getAnimations().forEach(a => a.play()); }
  if (m === 'reader') restoreReader();
  else updateVideos();         // every page video muted; in render, whatever no one owns is paused
  forwardMode(m, prev);
  return m;
}
// Back to reader mode: every owned video and flag goes back to the page, components stay where they are, and the
// reader's own snap, sound and Autoplay settings apply again.
function restoreReader() {
  for (const v of [...sg.owned]) { sg.owned.delete(v); delete v.__sgWant; if (v === repriseVideo && !v.paused) v.pause(); }
  releaseReveals();
  sg.pileNoAuto = sg.swapNoHint = sg.repriseNoAuto = false;
  sg.pile.impl?.wake?.();      // coins caught mid-drop fall in from there (now if the pile is in view, else on arrival)
  sg.market.inspectI = undefined;
  if (sg.market.drawP < 1) marketApi.draw(1); // a chart caught mid-draw is shown whole
  root.classList.remove('render');
  root.classList.toggle('snap', sg.notesSnap);
  installMediaSession();
  const a = sg.readerAutoplay ?? state.autoplay;
  sg.readerAutoplay = null;
  setAutoplay(a);              // label, html[data-autoplay], the video manager takes every clip back, sound as the reader had it
  sg.swapApi?.refresh();
  if (document.hidden) { for (const v of autoVideos) if (!v.paused) v.pause(); swap.stop?.(); }
}
// The other modules' own switches (hooks-api.md, "What __sg.mode() in main.js should call"), and an event for anything
// else that wants to know. play: the hat's arrival run and the copy machine's self-run off. render: also the hat and the
// monster frozen (only the renderer's set calls move them). reader: all of it back, and a card held mid-turn lands.
function forwardMode(m, prev) {
  const reader = m === 'reader', call = (o, f, ...a) => { try { if (o && typeof o[f] === 'function') o[f](...a); } catch {} };
  call(window.__headless, 'auto', reader);
  for (const c of $$('canvas.hat-canvas')) { call(c.__hat, 'noAuto', !reader); if (m === 'render' || prev === 'render' || reader) call(c.__hat, 'freeze', m === 'render'); }
  for (const c of $$('canvas.monster')) if (m === 'render' || prev === 'render' || reader) call(c.__monster, 'freeze', m === 'render');
  if (reader) for (const d of $$('.tarot')) call(d.__cards, 'release');
  dispatchEvent(new CustomEvent('sg:mode', {detail: {mode: m, prev}}));
}

/* ---- videos ---- */
// Real timers for safety timeouts only (never for state): under the renderer's virtual clock (vt.js) its own timer
// queue only runs when the renderer advances it.
function onceOr(v, events, ms) {
  return new Promise(res => {
    const T = (window.__vt && window.__vt.real) || window;
    let timer = 0;
    const done = () => { for (const e of events) v.removeEventListener(e, done); (T.clearTimeout || clearTimeout).call(window, timer); res(); };
    for (const e of events) v.addEventListener(e, done);
    timer = (T.setTimeout || setTimeout).call(window, done, ms);
  });
}
function ensureMedia(v) {
  if (v.readyState > 0) return;
  if (v.preload !== 'auto') { const was = v.preload; v.preload = 'auto'; if (was === 'none' && v.networkState !== HTMLMediaElement.NETWORK_LOADING) v.load(); }
}
const clampMedia = (v, t) => { const d = v.duration; return Number.isFinite(d) && d > 0 ? Math.min(t, Math.max(0, d - .03)) : t; };
function seekMedia(v, t) {
  if (Math.abs(v.currentTime - t) < 1e-4) return v.seeking ? onceOr(v, ['seeked', 'error', 'emptied'], 5000) : Promise.resolve();
  const p = onceOr(v, ['seeked', 'error', 'emptied'], 5000);
  v.currentTime = t;
  return p;
}
// Take a video for the story: begun (so applyStart never jumps it), muted, at page time t; playing or held.
// play: re-seeks only past .15 s of drift (a looping clip's drift wraps); held: within .02 s; exact: always, to 0.1 ms.
// Resolves once the frame is there (after 'seeked'), with the element's currentTime.
function videoAt(v, t, {play = false, exact = false, tolerance = null, rate = 1} = {}) {
  sg.owned.add(v);
  v.dataset.begun = '1';
  if (play) delete v.dataset.userPaused;
  v.muted = true;
  if (v.playbackRate !== rate) v.playbackRate = rate;
  sg.onDrive.get(v)?.(!!play);
  const want = v.__sgWant = Math.max(0, Number(t) || 0);
  if (!play && !v.paused) v.pause();
  let ready;
  if (v.readyState < 1) {
    ensureMedia(v);
    ready = onceOr(v, ['loadedmetadata', 'error'], 10000)
      .then(() => (v.__sgWant === want && sg.owned.has(v) && v.readyState > 0 ? seekMedia(v, clampMedia(v, want)) : null));
  } else {
    const target = clampMedia(v, want), dur = v.duration;
    let d = v.currentTime - target;
    if (v.loop && Number.isFinite(dur) && dur > 0) d = ((d % dur) + dur * 1.5) % dur - dur / 2;
    const tol = tolerance != null ? tolerance : exact ? 1e-4 : play ? .15 : .02;
    ready = Math.abs(d) > tol || (exact && v.seeking) ? seekMedia(v, target) : Promise.resolve();
  }
  if (play && v.paused) v.play().catch(() => {});
  return ready.then(() => v.currentTime);
}
// Hand it back: the video manager (or the swap, or the reprise's held face) decides again.
function videoRelease(v) {
  if (!sg.owned.delete(v)) return false;
  delete v.__sgWant;
  if (v === repriseVideo || rendering() || document.hidden) { if (!v.paused) v.pause(); }
  else if (v === swap.under || v === swap.over) {
    if (!sg.owned.has(swap.under) && !sg.owned.has(swap.over)) { if (!driven()) sg.swapApi?.refresh(); else if (!swap.inView && swap.playing) sg.swapApi?.pause(); }
  } else updateVideos();
  return true;
}
function videoHandle(el) {
  const v = typeof el === 'string' ? $(el) : el;
  if (!(v instanceof HTMLMediaElement)) throw new TypeError('__sg.video(): not a <video>');
  return {
    at: (t, o) => videoAt(v, t, o),
    release: () => videoRelease(v),
    get owned() { return sg.owned.has(v); },
    get time() { return v.currentTime; },
    el: v,
  };
}

/* ---- scrolly stages ---- */
// activate(section, key): the stage shows figure key, as the beat observer would. {ago}: seconds since that switch
// happened, so a cold seek lands the crossfade (.9 s opacity, 1.2 s scale) where it would be: >= 1.2 s = settled.
function activateStage(section, key, {ago = null} = {}) {
  if (typeof section === 'string') section = $(section);
  const scene = section && (sg.scenes.has(section) ? section : section.closest?.('[data-scrolly]'));
  const s = scene && sg.scenes.get(scene);
  if (!s || key == null) return false;
  s.activate(String(key));
  ageTransitions($$('.stage .stage-media', scene), ago);
  return true;
}
// The transitions a class change just started on els, put `ago` seconds in: settled if they would have ended, else
// running on from that point (play() after the seek, so a virtual clock records them as running, not held).
function ageTransitions(els, ago) {
  if (ago == null || !Number.isFinite(+ago)) return;
  const ms = Math.max(0, +ago * 1000);
  for (const el of els) for (const a of el.getAnimations()) {
    if (!finiteAnim(a)) continue;
    const end = a.effect.getComputedTiming().endTime;
    if (ms >= end) { try { a.finish(); } catch {} } else { a.currentTime = ms; a.play(); }
  }
}
// settle(el): every plain CSS transition under el (default: the page) jumps to its end, for a cold frame whose recent
// class changes should read as long done. Reveals a player owns, CSS animations and WAAPI (the cards) are left alone.
function settle(el = document) {
  if (typeof el === 'string') el = $(el);
  if (!el) return 0;
  const list = el === document ? document.getAnimations() : el.getAnimations({subtree: true});
  let n = 0;
  for (const a of list) {
    if (typeof CSSTransition === 'undefined' || !(a instanceof CSSTransition) || !finiteAnim(a)) continue;
    const tgt = a.effect && a.effect.target;
    if (tgt && [...sg.reveals.keys()].some(h => h.contains(tgt))) continue;
    try { a.finish(); n++; } catch {}
  }
  return n;
}

/* ---- reveals: the one-shot .in draw-ons (reel numerals, Tako drawings, the comment thread, the fork, text beats) ---- */
const finiteAnim = a => { try { return a.effect.getComputedTiming().endTime !== Infinity; } catch { return true; } };
const holderAnims = h => h.getAnimations({subtree: true}).filter(finiteAnim);
function revealHolder(el) {
  if (typeof el === 'string') el = $(el);
  if (!el || !el.closest) return null;
  return el.closest(REVEALABLE + ', .beat') || el.querySelector(REVEALABLE) || el;
}
// reveal(el, ms): the draw-on as it stands ms into its own (native) timeline, paused there. 0 (or false, null, a
// negative number): not revealed yet. 'end' (or true): drawn, nothing left running. {play: true} lets it run on from ms.
// el may be the holder (section.reel-card, section.slide--tako, .paths, a .beat) or anything inside or around it.
function reveal(el, ms, {play = false, rate = 1} = {}) {
  const h = revealHolder(el); if (!h) return null;
  let r = sg.reveals.get(h);
  if (!r || r.state === 'paths') { if (r) releasePaths(h, r); r = {state: null, anims: null}; sg.reveals.set(h, r); }
  if (ms === 'end' || ms === true || ms === Infinity) {
    if (!(r.state === 'end' && h.classList.contains('in'))) {
      h.classList.add('in');
      for (const a of holderAnims(h)) { try { a.finish(); } catch {} }
      r.state = 'end'; r.anims = null;
    }
    return h;
  }
  const t = Number(ms);
  if (!(t > 0)) {
    if (r.state !== 'reset' || h.classList.contains('in')) {
      h.classList.remove('in');
      for (const a of holderAnims(h)) a.cancel();
    }
    r.state = 'reset'; r.anims = null;
    if (h.matches(REVEALABLE)) revealIO.observe(h); // so it can reveal on view again once the reader has the page back
    return h;
  }
  // Chrome drops a CSS transition scrubbed past its end (its end state is then just the .in style). The ones already
  // made are reused while every one is either still live or ends before t; going back before a dropped one's end
  // replays the recipe.
  const live = a => a.playState === 'paused' || a.playState === 'running';
  let anims = r.state === 'scrub' && h.classList.contains('in') && r.anims && r.anims.every((a, i) => live(a) || t >= r.ends[i]) ? r.anims : null;
  if (!anims) { // the tested replay recipe: without the cancel the reverse transitions run and the replay is near-instant
    h.classList.remove('in');
    for (const a of holderAnims(h)) a.cancel();
    void h.offsetWidth;
    h.classList.add('in');
    anims = holderAnims(h);
    r.state = 'scrub'; r.anims = anims;
    r.ends = anims.map(a => { try { return a.effect.getComputedTiming().endTime; } catch { return Infinity; } });
  }
  // Ones that end by t are finished (static end style, whichever way t was reached); the rest are held at t.
  anims.forEach((a, i) => { if (!live(a)) return; if (t >= r.ends[i]) { try { a.finish(); } catch {} } else { a.pause(); a.currentTime = t; } });
  if (play) for (const a of anims) if (live(a)) { a.playbackRate = rate; a.play(); }
  return h;
}
function releaseReveals() {
  for (const [h, r] of sg.reveals) {
    if (r.state === 'scrub') { for (const a of r.anims || []) if (a.playState === 'paused') { a.playbackRate = 1; a.play(); } } // finishes in its own time
    else if (r.state === 'reset') {
      if (h.matches(REVEALABLE)) { revealIO.unobserve(h); revealIO.observe(h); } // reveals on view, like a first visit
      else if (h.classList.contains('beat')) { const s = sg.scenes.get(h.closest('[data-scrolly]')); if (s) { s.soft.unobserve(h); s.soft.observe(h); } }
    } else if (r.state === 'paths') releasePaths(h, r);
  }
  sg.reveals.clear();
}

/* ---- the fork (.paths): each path and label on its own words ---- */
const PATH_PARTS = [['a', '.p-a', 1, true], ['b', '.p-b', 1, true], ['c', '.p-c', 1], ['labA', '.paths-lab--a', 1], ['labB', '.paths-lab--b', 1], ['labC', '.paths-lab--c', .75]];
function pathsSet(parts = {}) {
  const fig = $('.paths'); if (!fig) return null;
  let r = sg.reveals.get(fig);
  if (!r || r.state !== 'paths') {
    for (const a of holderAnims(fig)) a.cancel();
    const was = fig.classList.contains('in') ? 1 : 0;
    r = {state: 'paths', v: Object.fromEntries(PATH_PARTS.map(([k]) => [k, was]))};
    sg.reveals.set(fig, r);
  }
  for (const [k, sel, max, draw] of PATH_PARTS) {
    if (parts[k] != null && Number.isFinite(+parts[k])) r.v[k] = clamp01(+parts[k]);
    const el = $(sel, fig); if (!el) continue;
    el.style.setProperty('transition', 'none', 'important');
    if (draw) el.style.setProperty('stroke-dashoffset', String(1 - r.v[k])); // pathLength="1": 1 = undrawn
    else el.style.setProperty('opacity', String(max * r.v[k]));
  }
  return {...r.v};
}
// Reader mode again: a fork partly drawn finishes with the page's own transitions; one never started reveals on view.
function releasePaths(fig, r) {
  const any = Object.values(r.v).some(x => x > 0);
  if (any) fig.classList.add('in');
  for (const [, sel] of PATH_PARTS) { const el = $(sel, fig); if (el) for (const p of ['transition', 'stroke-dashoffset', 'opacity']) el.style.removeProperty(p); }
  if (!any) { fig.classList.remove('in'); revealIO.unobserve(fig); revealIO.observe(fig); }
}

/* ---- rest positions: where the page snaps, computed the same way for both players ---- */
// The choreography numbers a scrolly's beats without the phone-only halves of a split grid beat (.beat--phone):
// beat n is the n-th of the others. In a layout that hides beat n (the phone hides .beat--wide) it resolves to its
// phone halves: part 0 ('head') = the heading alone, part 1 ('rest') = the rest. {frame: '9'} finds the beat by its
// data-frame instead (choreography-play.json's b): the first one rendered, or with part 'rest' the phone rest copy.
const partIndex = p => (p === 'rest' ? 1 : p === 'head' ? 0 : Math.max(0, Math.round(Number(p) || 0)));
function beatEl(section, n, {part = 0, frame = null} = {}) {
  if (typeof section === 'string') section = $(section);
  const scene = section && (section.matches('[data-scrolly]') ? section : section.closest('[data-scrolly]'));
  if (!scene) return null;
  const all = $$('.beats > .beat', scene);
  let b;
  if (frame != null || (n != null && typeof n === 'object' && n.frame != null)) {
    const f = String(frame ?? n.frame), same = all.filter(x => x.dataset.frame === f);
    b = same.find(x => x.getClientRects().length) || same[0];
    if (!b) return null;
    if (partIndex(part) === 1) return same.find(x => x.classList.contains('beat--phone') && !x.classList.contains('beat--phone-head') && x.getClientRects().length) || b;
    return b;
  }
  b = all.filter(x => !x.classList.contains('beat--phone'))[n];
  if (!b || b.getClientRects().length) return b || null;
  const halves = [];
  for (let x = b.nextElementSibling; x && x.classList.contains('beat--phone') && x.dataset.show === b.dataset.show; x = x.nextElementSibling) halves.push(x);
  return halves[Math.min(halves.length - 1, partIndex(part))] || b;
}
// restY(section): its top. restY(section, {beat: n, part}) / restY(section, {frame: '9', part}) / restY(beatEl): the
// beat's centre snap. {center: true}: any element's centre (the phone's green card). CSS px, clamped to the scroll
// range, at the current viewport.
function restY(el, {beat = null, part = 0, center = false, frame = null} = {}) {
  if (typeof el === 'string') el = $(el);
  if (!el) return null;
  let target = el, mid = !!center;
  if (frame != null) { target = beatEl(el, null, {part, frame}); mid = true; }
  else if (beat != null) { target = beat instanceof Element ? beat : beatEl(el, beat, {part}); mid = true; }
  else if (el.classList.contains('beat')) mid = true;
  if (!target) return null;
  const r = target.getBoundingClientRect(), vh = innerHeight, se = document.scrollingElement || root;
  const y = scrollY + (mid ? r.top + r.height / 2 - vh / 2 : r.top);
  return Math.max(0, Math.min(se.scrollHeight - vh, y));
}

/* ---- grids ---- */
// Every grid is a 3D stack at every width (stacked is always true). front(i, {instant}): clip i springs forward the way
// a swipe goes, or is put there at once. focus(i, {ago}) is kept as an alias of front(i) for older callers: live (no
// ago) it springs, with {ago} (a cold frame) it is put there at once. at(x): the stack's position directly.
function gridApi(key) {
  const g = sg.grids.get(key); if (!g) return null;
  const n = g.cells.length, idx = i => ((Math.round(Number(i) || 0) % n) + n) % n;
  return {
    key,
    videos: g.cells.map(c => c.video),
    get stacked() { return g.stack.on; },
    get index() { return g.stack.index; },
    front(i, o = {}) { return g.stack.front(idx(i), o); },
    focus(i, {ago = null, instant} = {}) { return this.front(i, {instant: instant ?? ago != null}); },
    at(x) { return g.stack.at(Number(x)); },
    reset() { return this.front(0, {instant: true}); },
  };
}

/* ---- market, coin pile: their data arrives async; calls made before then are kept and applied on arrival ---- */
const marketApi = {
  snapshotOnly(on = true) { sg.market.snapshotOnly = !!on; sg.market.impl?.snapshotOnly(!!on); return !!on; },
  draw(p) { sg.market.drawP = clamp01(Number(p), 1); sg.market.impl?.draw(); return sg.market.drawP; },
  inspect(i = null) { sg.market.inspectI = i == null || !Number.isFinite(Number(i)) ? null : Number(i); sg.market.impl?.inspect(); return sg.market.inspectI; },
  period(h) { sg.market.impl?.period(Number(h)); },
  get state() { const m = sg.market; return {snapshotOnly: m.snapshotOnly, drawP: m.drawP, inspect: m.inspectI ?? null, ready: !!m.impl, points: m.impl?.points, readout: m.impl?.readout}; },
};
const pileApi = {
  set(k, o) { sg.pile.k = k; sg.pile.opts = o; return sg.pile.impl?.set(k, o); },
  // at(t, keyframes): the choreography's step keys [[t, k], ...] -> set(k(t), {ages}) with each coin's age at t.
  at(t, keys) {
    let k = 0; const ages = [];
    for (const [kt, kv] of keys || []) { if (kt > t) break; for (let i = k; i < kv; i++) ages[i] = t - kt; k = kv; }
    return this.set(k, {ages});
  },
  select(i = null) { sg.pile.sel = i; return sg.pile.impl?.select(i); },
  noAuto(on = true) { sg.pileNoAuto = !!on; if (on) sg.pile.impl?.cancel(); },
  get state() { return sg.pile.impl ? sg.pile.impl.state : {k: sg.pile.k, sel: sg.pile.sel ?? null, ready: false}; },
};
const ready = Promise.all([new Promise(r => { sg.marketReady = r; }), new Promise(r => { sg.pileReady = r; })]).then(() => true);

/* ---- render: the grain as a function of the frame ---- */
function grain(n) {
  const a = $('.grain')?.getAnimations()[0]; if (!a) return false;
  a.pause();
  a.currentTime = (((Math.floor(Number(n) || 0) % 6) + 6) % 6) * (1000 / 6) + 1; // 1 s in steps(6): frame n shows step n mod 6
  return true;
}

function sgState() {
  const tail = v => (v.currentSrc || '').split('/').pop() || v.id;
  return {
    mode: sg.mode, autoplay: state.autoplay, readerAutoplay: sg.readerAutoplay, sound: state.sound, unlocked: state.unlocked, hushed, heard: soundOn(),
    snap: root.classList.contains('snap'), owned: [...sg.owned].map(tail), reveals: [...sg.reveals.values()].map(r => r.state),
    flags: {pileNoAuto: sg.pileNoAuto, swapNoHint: sg.swapNoHint, repriseNoAuto: sg.repriseNoAuto},
    market: marketApi.state, pile: pileApi.state, wall: sg.wallApi?.state ?? null, swapPos: sg.swapApi?.pos ?? null,
  };
}

window.__sg = {
  version: 1,
  mode: setMode,
  video: videoHandle,
  activate: activateStage,
  settle,
  reveal,
  restY,
  beat: beatEl,
  grid: gridApi,
  market: marketApi,
  pile: pileApi,
  swap: sg.swapApi,
  wall: sg.wallApi,
  paths: {set: pathsSet, reset: () => pathsSet({a: 0, b: 0, c: 0, labA: 0, labB: 0, labC: 0}), get state() { const r = sg.reveals.get($('.paths')); return r && r.v ? {...r.v} : null; }},
  reprise: sg.repriseApi,
  grain,
  ready,
  state: sgState,
};
if (urlFlags.get('render') === '1') setMode('render');
