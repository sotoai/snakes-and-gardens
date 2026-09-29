// Who is Jean Phil? · interactions
import {parseQuote, parseHistory, selectPeriod, chartGeometry, QUOTE_URL, HISTORY_URL} from './assets/js/market-data.mjs';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Sound defaults to on, but browsers only allow it after the reader's first tap or key press (see unlockSound).
const state = {autoplay: !reduced, sound: true, unlocked: false, refused: false};
const swap = {under: document.querySelector('#swap-under'), over: document.querySelector('#swap-over'), playing: false, inView: false, userPaused: false};

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
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); }
}, {threshold: .25});
$$('.reel-card, .reach, .offspring, .poles, .four--blank, .slide--tako, .paths').forEach(el => revealIO.observe(el));

/* ---------------- Snapping: one frame per swipe for the story; the notes scroll freely ---------------- */
const root = document.documentElement;
root.classList.add('snap');
const notesSection = $('#notes');
if (notesSection) {
  new IntersectionObserver(([e]) => root.classList.toggle('snap', !e.isIntersecting && e.boundingClientRect.top > 0),
    {rootMargin: '0px 0px -35% 0px'}).observe(notesSection);
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
const soundOn = () => state.sound && state.unlocked;
function isActiveMedia(v) {
  const fig = v.closest('.stage-media');
  return !fig || fig.classList.contains('is-active');
}
function primaryVideo() {
  let best = null, bestRatio = 0;
  for (const v of autoVideos) {
    const r = visible.get(v) || 0;
    if (isActiveMedia(v) && r > bestRatio) { best = v; bestRatio = r; }
  }
  return bestRatio > .3 ? best : null;
}
const inActiveGrid = v => !!v.closest('.stage-media--grid') && isActiveMedia(v) && (visible.get(v) || 0) > .15;
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
    if (v.dataset.probing) continue;
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
  const lead = audibleVideo();
  if (!probed && state.sound && !state.unlocked && v === lead) return probeSound(v);
  v.muted = !(soundOn() && v === lead && v.dataset.primed);
  return v.play().catch(err => {
    if (err.name !== 'NotAllowedError' || v.muted) return;
    delete v.dataset.primed;
    v.muted = true;
    v.play().catch(() => {});
  });
}
function updateVideos() {
  const lead = primaryVideo();
  for (const v of autoVideos) {
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
// Grids: all four cells keep playing; the focused one (the first, until the reader picks another) is heard.
// Tapping a cell, or Enter/Space on it, focuses it and plays it if it was paused. It never pauses it.
for (const grid of $$('.stage-media--grid')) {
  const cells = $$('.grid4 > figure', grid).map(fig => ({fig, video: $('video', fig), btn: $('.cell-hear', fig)})).filter(c => c.video);
  const focus = c => {
    gridFocus.set(grid, c.video);
    for (const x of cells) { x.fig.classList.toggle('is-heard', x === c); x.btn?.setAttribute('aria-pressed', x === c); }
  };
  if (cells.length) focus(cells[0]);
  // Keyboard: only the grid on screen takes focus (the scrolly scene below keeps this in step).
  // When the grid leaves the stage, a cell button that still has focus lets go of it, so Space scrolls again.
  const reach = () => {
    const on = grid.classList.contains('is-active');
    cells.forEach(c => { if (c.btn) c.btn.tabIndex = on ? 0 : -1; });
    if (!on && grid.contains(document.activeElement)) document.activeElement.blur();
  };
  grid.addEventListener('stage:active', reach);
  reach();
  for (const c of cells) {
    (c.btn || c.video).addEventListener('click', e => {
      focus(c);
      // A tap also lifts a pause from the OS media controls on the whole grid; updateVideos restarts the others.
      if (state.autoplay) for (const x of cells) delete x.video.dataset.userPaused;
      if (c.video.paused) { delete c.video.dataset.userPaused; playSafely(c.video); }
      updateVideos(); // also calls applySound
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
    played = true;
    playReprise();
  }, {threshold: [0, .5, .75]}).observe(v);
  v.addEventListener('click', () => {
    if (!v.paused || reprise.token) return;
    played = true;
    playReprise();
  });
}

const soundBtn = $('#sound-toggle'), motionBtn = $('#motion-toggle');
function renderSound() {
  soundBtn.setAttribute('aria-pressed', soundOn());
  soundBtn.classList.toggle('waiting', state.sound && !state.unlocked);
  $('.label', soundBtn).textContent = !state.sound ? 'Sound off' : state.unlocked ? 'Sound on' : 'Tap for sound';
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
  if (state.unlocked) return;
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
function onFirstGesture(e) {
  if (e.type === 'keydown') {
    if (soundBtn.contains(e.target) || NOT_GESTURES.includes(e.key) || e.metaKey || e.ctrlKey) return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
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
function setAutoplay(on) {
  state.autoplay = on;
  document.documentElement.dataset.autoplay = on ? 'on' : 'off';
  motionBtn.setAttribute('aria-pressed', on);
  $('.label', motionBtn).textContent = on ? 'Autoplay on' : 'Autoplay off';
  if (!on) { autoVideos.forEach(v => v.pause()); swap.stop?.(); }
  updateVideos();
  renderSound();
}
motionBtn.addEventListener('click', () => setAutoplay(!state.autoplay));
setAutoplay(state.autoplay);
// Tab hidden: pause everything (a reprise laugh under way holds its face). Back: resume where each one was.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    endReprise(true);
    for (const v of autoVideos) if (!v.paused) v.pause();
    swap.stop?.(); return;
  }
  updateVideos();
  swap.resume?.();
});
// Hardware media keys and the OS media controls pause for real, instead of being undone by the next tick.
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('pause', () => {
    autoVideos.forEach(v => { if (!v.paused) { v.dataset.userPaused = '1'; v.pause(); } });
    if (swap.playing) { swap.userPaused = true; swap.stop?.(); }
  });
  // Play resumes the lead, or every cell of a leading grid (so the focused cell is heard again), and the swap.
  navigator.mediaSession.setActionHandler('play', () => {
    const l = primaryVideo(), grid = l?.closest('.stage-media--grid');
    for (const v of grid ? $$('video', grid) : [l]) if (v && v.paused) { delete v.dataset.userPaused; playSafely(v); }
    if (swap.userPaused && swap.inView) { swap.userPaused = false; swap.resume?.(); }
    applySound();
  });
}
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
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); activate(e.target.dataset.show); }
  }, {rootMargin: '-42% 0px -42% 0px'});
  beats.forEach(b => io.observe(b));
  // Fade beats in slightly earlier than they take control.
  const soft = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) e.target.classList.add('in');
  }, {rootMargin: '0px 0px -20% 0px'});
  beats.forEach(b => soft.observe(b));
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
  let hinted = false;

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
  swap.resume = () => { if (swap.inView && state.autoplay && !swap.playing && !swap.userPaused) play(true); };
  swap.under.addEventListener('seeked', () => { swap.over.currentTime = clampT(swap.over, swap.under.currentTime); });
  new IntersectionObserver(([e]) => {
    swap.inView = e.isIntersecting && e.intersectionRatio > .4;
    if (swap.inView) {
      if (state.autoplay && !swap.playing && !swap.userPaused) play(true);
      if (!hinted && !reduced) {
        hinted = true;
        const t0 = performance.now();
        const sweep = t => { const p = Math.min(1, (t - t0) / 1600); setPos(50 + Math.sin(p * Math.PI * 2) * 22); if (p < 1) requestAnimationFrame(sweep); };
        requestAnimationFrame(sweep);
      }
    } else if (swap.playing) pause();
    applySound();
  }, {threshold: [0, .4, .8]}).observe(frame);
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
    inspect(pts.length - 1);
    $$('[data-hours]', root).forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.hours) === hours));
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
    const f = feeds[kind]; f.last = Date.now();
    try {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(kind === 'quote' ? QUOTE_URL : HISTORY_URL, {signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
      clearTimeout(timer);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
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
    if (!nearby || document.hidden) return;
    if (Date.now() - feeds.quote.last > 60000) pull('quote');
    if (Date.now() - feeds.history.last > 300000) pull('history');
  }
  new IntersectionObserver(([e]) => { nearby = e.isIntersecting; tick(); }, {rootMargin: '200px'}).observe(root);
  document.addEventListener('visibilitychange', tick);
  setInterval(tick, 15000);
  renderQuote(); renderChart(); renderStatus();
})();

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
  const coins = [];
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
    b.addEventListener('click', () => { readout.textContent = label; coins.forEach(x => x.classList.remove('sel')); b.classList.add('sel'); });
    colEls[days.indexOf(dayKey(c.created))].append(b); coins.push(b);
  });
  count.textContent = reduced ? kids.length : 0;
  let played = false;
  function play() {
    if (played) return; played = true;
    if (reduced) { coins.forEach(b => b.classList.add('on')); return; }
    coins.forEach((b, i) => setTimeout(() => { b.classList.add('on'); count.textContent = i + 1; }, 300 + i * 190));
    setTimeout(() => { readout.textContent = 'The first six arrived within two hours. Tap a coin.'; }, 300 + kids.length * 190 + 200);
  }
  new IntersectionObserver(([e]) => { if (e.isIntersecting && e.intersectionRatio > .5) play(); }, {threshold: [0, .5, .8]}).observe(grid);
})();

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
