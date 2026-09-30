// The two futures: two aged playing cards, face down. Each turns over on its own click, Enter or Space, and turns back
// the same way round: a click anywhere on its front that is not a link (and does not end a text selection), or its
// "Turn back" button. One card is cued at a time and never while a card is turning: the first face-down card in view that
// has not been turned yet (red first when both are); a card turned back is cued again only when it is the only one face
// down. A turned card's front becomes readable (its links reachable) and takes focus, and its back goes inert; turned
// back, its back button takes focus again. The fronts are inert from here, not in the markup, so without JavaScript the
// cards lie face up (styles.css, @media (scripting:none)).
// Smoothness: only transform and opacity animate and the art is pre-baked; the art is decoded and every layer a turn will
// show is rasterised before a card can be turned (warm(), below); while a card turns nothing in the page is read or
// written, the hover tilt holds still, and the hover glint, the table shadow and the cue's glow go on from where they are.
// Reduced motion (or ?motion=reduce, for review): a short crossfade both ways, no rotation, no tilt, no breathing.

const deck = document.querySelector('.square--futures .tarot');
if (deck) init(deck);

function init(deck) {
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const fineMQ = matchMedia('(hover: hover) and (pointer: fine)');
  const forceRM = new URLSearchParams(location.search).get('motion') === 'reduce';
  let reduce = forceRM || reduceMQ.matches;
  const syncRM = () => { reduce = forceRM || reduceMQ.matches; deck.classList.toggle('rm', reduce); };
  syncRM();
  reduceMQ.addEventListener?.('change', syncRM);
  const hasIO = 'IntersectionObserver' in window;

  // The cue starts when the deck comes into view (main.js adds .in to .poles too; either is enough).
  if (hasIO) {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { deck.classList.add('in'); io.disconnect(); } }, {threshold: .25});
    io.observe(deck);
  } else deck.classList.add('in');

  // Fetch the art well ahead (about six screens) rather than at the lazy-loading distance (about two), so a
  // reader on a slow connection does not arrive at half-painted backs. Until a face's art is in, it reads as stock.
  const imgs = [...deck.querySelectorAll('.face > img')];
  imgs.forEach((img) => {
    if (img.complete && img.naturalWidth) return;
    img.parentElement.classList.add('is-loading');
    img.addEventListener('load', () => img.parentElement.classList.remove('is-loading'), {once: true});
  });
  if (hasIO) {
    const eager = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      deck.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; });
      eager.disconnect();
    }, {rootMargin: '600% 0px'});
    eager.observe(deck);
  }

  const slots = [...deck.querySelectorAll('.slot')];
  const P = new Map(slots.map((slot) => {
    const q = (s) => slot.querySelector(s);
    const face = (el) => ({el, shade: el.querySelector('.shade'), sheen: el.querySelector('.sheen')});
    return [slot, {
      stage: q('.tarot-stage'), tilt: q('.tilt'), card: q('.card'), soft: q('.shadow--soft'), tight: q('.shadow--tight'),
      glow: q('.glow'), cue: q('.cue'), back: face(q('.face--back')), front: face(q('.face--front')), heading: q('.face--front h3'),
      turnBack: q('.turn-back'), glintX: 0, left: false, warmth: 0,
      anims: null, timer: 0, scrub: null, waiters: [], extra: null, // the turn running now, a scrubbed turn (hooks), who waits to land
    }];
  }));

  // Before a card can be turned, decode its art and rasterise every layer the turn will show. The compositor paints
  // only what is on screen and only the side of a card that faces the reader, so the face turned away (with its shade
  // and glint) used to be painted mid-turn, the moment it came round, and that frame was dropped (about 0.5s into every
  // turn). So the art is decoded as the deck nears the screen, and each time a card comes into view (and again once it
  // is wholly on screen) its hidden face turns toward the reader for a moment, just behind the visible one, and it, the
  // shades and the glints show at 0.4% (styles.css, .is-warming): everything the turn will show gets painted, and
  // nothing visible changes.
  const ready = (img) => (img.complete ? Promise.resolve()
    : new Promise((r) => { img.addEventListener('load', r, {once: true}); img.addEventListener('error', r, {once: true}); }));
  let artReady = null;
  const decodeArt = () => (artReady ||= Promise.all(imgs.map((img) => ready(img).then(() => img.decode?.()).catch(() => {}))));
  if (hasIO) {
    const near = new IntersectionObserver(([e]) => { if (e.isIntersecting) { decodeArt(); near.disconnect(); } }, {rootMargin: '100% 0px'});
    near.observe(deck);
  }
  function warm(slot) {
    if (reduce || slot.dataset.busy) return;
    const p = P.get(slot), n = ++p.warmth;
    slot.classList.add('is-warming');
    // two frames for the change to reach the compositor, then time to rasterise
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
      if (n === p.warmth) slot.classList.remove('is-warming');
    }, 300)));
  }

  // Which cards are in view (at least 60% on screen): on phones the cards are stacked, and a quick swipe can pass the
  // red card's stop, so the cue goes to the first face-down card the reader can actually see. A card coming into view
  // (and again once it is wholly on screen) is warmed, as above.
  const inView = new Set();
  if (hasIO) {
    const vio = new IntersectionObserver((es) => {
      es.forEach((e) => {
        const s = e.target.closest('.slot');
        if (e.isIntersecting && e.intersectionRatio >= .6) { inView.add(s); decodeArt().then(() => warm(s)); } else inView.delete(s);
      });
      updateCue();
    }, {threshold: [.6, .98]});
    slots.forEach((s) => vio.observe(P.get(s).stage));
  } else decodeArt();

  function settle(slot, turned) {
    const p = P.get(slot);
    slot.classList.toggle('is-turned', turned);
    p.front.el.inert = !turned;
    p.back.el.inert = turned;
    if (turned) p.back.el.setAttribute('aria-hidden', 'true'); else p.back.el.removeAttribute('aria-hidden');
  }

  // One cue at a time, and none while a card is turning (the next one is cued when it lands). Cards not yet turned
  // come first; a card that has been turned and turned back is cued only when it is the only card face down.
  const seen = new Set();
  function updateCue() {
    const down = slots.filter((s) => !s.classList.contains('is-turned'));
    const open = down.filter((s) => !seen.has(s) || down.length === 1);
    const next = slots.some((s) => s.dataset.busy) ? null : (open.find((s) => inView.has(s)) || open[0]);
    uncue(slots.filter((s) => s !== next));
    if (next) next.classList.add('is-cued');
  }
  // Taking the cue from a card: its breathing glow fades out from where it is. (Removing .is-cued stops the CSS
  // animation, and the glow's own transition does not start from an animated value, so it would vanish in one frame.
  // With reduced motion the glow does not breathe, it rests at a set value, and that transition fades it.)
  // Every value is read before anything is written. Fades that start from a value the element does not rest at fill
  // backwards: Chrome can date a composited animation's start a fraction of a millisecond after the frame that first
  // shows it, and without the fill that frame would show the resting value (here, no glow at all).
  function uncue(list) {
    const cued = list.filter((s) => s.classList.contains('is-cued'));
    const glows = cued.map((s) => +getComputedStyle(P.get(s).glow).opacity);
    cued.forEach((s, i) => {
      if (!reduce && glows[i] > .005) P.get(s).glow.animate([{opacity: glows[i]}, {opacity: 0}], {duration: 300, easing: 'ease-out', fill: 'backwards'});
      s.classList.remove('is-cued');
    });
  }

  // Focus follows the card, but only from where the turn began (a keyboard user who has moved on keeps their place).
  // The face that takes focus opens before the other goes inert, so focus never falls to <body>.
  // Turns driven by the hooks (quiet) move focus only when it would otherwise be left on a face going inert.
  function focusFront(p, quiet) {
    const ae = document.activeElement;
    const take = quiet ? !!ae && p.back.el.contains(ae) : !ae || ae === document.body || ae === p.back.el;
    p.front.el.inert = false;
    if (take) p.heading.focus({preventScroll: true});
  }
  function focusBack(p, quiet) {
    const ae = document.activeElement;
    const take = quiet ? !!ae && (ae === p.turnBack || p.front.el.contains(ae)) : !ae || ae === document.body || ae === p.turnBack || p.front.el.contains(ae);
    p.back.el.inert = false;
    p.back.el.removeAttribute('aria-hidden');
    if (take) p.back.el.focus({preventScroll: true});
  }
  function resetHover(p) {
    p.tilt.style.transition = '';
    p.tilt.style.transform = '';
    [p.back.sheen, p.front.sheen].forEach((sh) => { sh.style.opacity = ''; sh.style.transform = ''; });
  }

  // The turn: lift from the right edge, roll over to the left, overshoot a touch and settle back onto the table.
  // Turning back is the same turn mirrored: the edge that lifted first (now on the left) lifts again and the card rolls
  // back to the right. In the card's own terms rotateY runs from -180deg back to 0 (each angle a becomes -180 - a);
  // the lift, the tilt (rotateZ), the timing and the easing are the same.
  const D = 1250;
  const UP = [
    {offset: 0, transform: 'translate3d(0,0,0) rotateY(0deg) rotateZ(0deg)', easing: 'cubic-bezier(.4,0,.6,1)'},
    {offset: .16, transform: 'translate3d(0,-.6%,20px) rotateY(-9deg) rotateZ(-1deg)', easing: 'cubic-bezier(.35,0,.3,1)'},
    {offset: .56, transform: 'translate3d(0,-1.2%,52px) rotateY(-112deg) rotateZ(-2.2deg)', easing: 'cubic-bezier(.25,.1,.35,1)'},
    {offset: .84, transform: 'translate3d(0,-.5%,12px) rotateY(-176deg) rotateZ(-.5deg)', easing: 'cubic-bezier(.3,.2,.4,1)'},
    {offset: .93, transform: 'translate3d(0,.15%,-2px) rotateY(-181deg) rotateZ(.1deg)', easing: 'ease-out'},
    {offset: 1, transform: 'translate3d(0,0,0) rotateY(-180deg) rotateZ(0deg)'},
  ];
  const DOWN = [
    {offset: 0, transform: 'translate3d(0,0,0) rotateY(-180deg) rotateZ(0deg)', easing: 'cubic-bezier(.4,0,.6,1)'},
    {offset: .16, transform: 'translate3d(0,-.6%,20px) rotateY(-171deg) rotateZ(-1deg)', easing: 'cubic-bezier(.35,0,.3,1)'},
    {offset: .56, transform: 'translate3d(0,-1.2%,52px) rotateY(-68deg) rotateZ(-2.2deg)', easing: 'cubic-bezier(.25,.1,.35,1)'},
    {offset: .84, transform: 'translate3d(0,-.5%,12px) rotateY(-4deg) rotateZ(-.5deg)', easing: 'cubic-bezier(.3,.2,.4,1)'},
    {offset: .93, transform: 'translate3d(0,.15%,-2px) rotateY(1deg) rotateZ(.1deg)', easing: 'ease-out'},
    {offset: 1, transform: 'translate3d(0,0,0) rotateY(0deg) rotateZ(0deg)'},
  ];
  // A glint's position mirrored across the card (the glint is 70% of the card wide and starts 70% to its left).
  const mirror = (x) => Math.round((242.9 - x) * 10) / 10;

  function flip(slot, up, quiet = false) {
    const p = P.get(slot);
    // A turn the hooks hold part-way (a scrub) carries on by itself from there (or rests where asked, the other way).
    if (p.scrub) { if (p.scrub.up === up) release(slot, quiet); else restAt(slot, up, false); return; }
    if (slot.dataset.busy || slot.classList.contains('is-turned') === up) return;
    // Read the few values the turn starts from, before anything is written: the hover glint on the face going away
    // (how bright it is and where its easing has got to, as the pointer may still be moving), the table shadow (darker
    // under a hovered card) and, in uncue(), the breathing glow of whichever card is cued.
    const away = up ? p.back : p.front;
    const ss = getComputedStyle(away.sheen);
    const glint = +ss.opacity;
    const gm = glint > .01 && ss.transform !== 'none' ? new DOMMatrixReadOnly(ss.transform) : null;
    const gx = gm && parseFloat(ss.width) ? gm.m41 / parseFloat(ss.width) * 100 : p.glintX;   // % of the glint's width
    const shadow = +getComputedStyle(p.soft).opacity;
    uncue(slots);   // no cue while a card turns: the cued card's glow fades, whichever card it is
    slot.dataset.busy = '1';
    slot.classList.remove('is-warming');
    [p.back.sheen, p.front.sheen].forEach((sh) => { sh.style.transition = 'none'; sh.style.opacity = ''; sh.style.transform = ''; });
    // The hover tilt is left exactly where it is: pointermove is ignored until the card lands.

    // Reduced motion: .is-turned alone runs the crossfade. Turning over, the back keeps focus until the front is ready;
    // turning back, the back takes focus at once (the "Turn back" button it came from is hidden with .is-turned).
    if (reduce) {
      if (up) { slot.classList.add('is-turned'); p.timer = setTimeout(() => landed(slot, up, quiet), 360); return; }
      focusBack(p, quiet);
      settle(slot, false);
      p.timer = setTimeout(() => { p.timer = 0; delete slot.dataset.busy; updateCue(); p.waiters.splice(0).forEach((w) => w()); }, 360);
      return;
    }

    const {a, soft, all} = turnAnims(slot, up, glint, gx, shadow);
    p.anims = all;
    whenDone(slot, up, a, soft, quiet);
  }

  // The seven animations of a turn (face up, or back down), from the hover glint (glint, at gx% of its width) and the
  // table shadow's opacity (shadow) it starts from. A reader's turn and the hooks' scrubbed turn are the same seven.
  function turnAnims(slot, up, glint, gx, shadow) {
    const p = P.get(slot);
    const away = up ? p.back : p.front, rise = up ? p.front : p.back;
    const a = p.card.animate(up ? UP : DOWN, {duration: D, fill: 'forwards'});
    // The shadow slides out and narrows as the card stands on its edge, then lands (the same either way: it falls
    // away from the light, not in the direction of the roll). It starts from where it is and holds its last frame
    // until the card has landed, so it cannot flash between the end of the turn and the page's own resting value.
    const soft = p.soft.animate([
      {offset: 0, transform: 'translate(1.2%,3.2%) scale(1.02,1.02)', opacity: shadow},
      {offset: .16, transform: 'translate(2.6%,4%) scale(1.02,1.03)', opacity: .28},
      {offset: .56, transform: 'translate(8%,5%) scale(.42,1)', opacity: .18},
      {offset: .84, transform: 'translate(2%,4%) scale(1,1.03)', opacity: .30},
      {offset: 1, transform: 'translate(1.2%,3.2%) scale(1.02,1.02)', opacity: .30},
    ], {duration: D, easing: 'cubic-bezier(.33,0,.3,1)', fill: 'forwards'});
    const tight = p.tight.animate([{offset: 0, opacity: .42}, {offset: .12, opacity: 0}, {offset: .88, opacity: 0}, {offset: 1, opacity: .42}], {duration: D});
    // Light: the face going away darkens and a glint crosses it toward the lifting edge (from the hover glint, if one
    // is showing); then the face coming up rises into the light and its own glint crosses back. Turning back, every
    // glint position is mirrored across the card, so each one still runs toward the lifting edge.
    const shadeAway = away.shade.animate([{offset: 0, opacity: 0}, {offset: .5, opacity: .75}, {offset: 1, opacity: .75}], {duration: D, easing: 'ease-in'});
    const shadeRise = rise.shade.animate([{offset: 0, opacity: .75}, {offset: .5, opacity: .7}, {offset: .9, opacity: 0}, {offset: 1, opacity: 0}], {duration: D, easing: 'ease-out'});
    const f = up ? (x) => x : mirror;
    const x0 = glint > .01 ? f(gx) : 0;   // where the glint starts, in the terms of a turn face up
    const sheenAway = away.sheen.animate([
      {offset: 0, opacity: glint > .01 ? glint : 0, transform: `translateX(${f(x0)}%)`},
      {offset: .2, opacity: 1, transform: `translateX(${f(Math.max(90, x0))}%)`},
      {offset: .46, opacity: 0, transform: `translateX(${f(230)}%)`},
      {offset: 1, opacity: 0, transform: `translateX(${f(230)}%)`},
    ], {duration: D, easing: 'ease-in-out', fill: 'backwards'});
    const sheenRise = rise.sheen.animate([
      {offset: 0, opacity: 0, transform: `translateX(${f(240)}%)`},
      {offset: .56, opacity: 0, transform: `translateX(${f(240)}%)`},
      {offset: .74, opacity: .9, transform: `translateX(${f(120)}%)`},
      {offset: 1, opacity: 0, transform: `translateX(${f(-10)}%)`},
    ], {duration: D, easing: 'ease-in-out'});
    return {a, soft, all: [a, soft, tight, shadeAway, shadeRise, sheenAway, sheenRise]};
  }

  function whenDone(slot, up, a, soft, quiet) {
    const p = P.get(slot);
    a.onfinish = () => {
      slot.classList.toggle('is-turned', up); // the resting transform comes from the CSS
      a.cancel();
      soft.cancel();
      // a card turned back under the pointer rests on a darker shadow (styles.css): ease into it, don't step
      const rest = +getComputedStyle(p.soft).opacity;
      if (Math.abs(rest - .3) > .005) p.soft.animate([{opacity: .3}, {opacity: rest}], {duration: 250, easing: 'ease-out', fill: 'backwards'});
      landed(slot, up, quiet);
    };
  }

  function landed(slot, up, quiet) {
    const p = P.get(slot);
    p.anims = null; p.timer = 0;
    if (p.extra) { dropFades(p.extra); p.extra = null; }
    if (up) { focusFront(p, quiet); seen.add(slot); } else focusBack(p, quiet);
    settle(slot, up);
    delete slot.dataset.busy;
    if (p.left) { p.left = false; resetHover(p); }
    updateCue();
    p.waiters.splice(0).forEach((w) => w());
  }

  // ---- hooks for Play mode and the frame renderer (docs: scratchpad/autoplay/hooks-api.md) ----
  // deck.__cards.set(color, x, {back}): the card part-way through its turn, x 0..1 along the same seven animations a
  //   click runs (held paused at x * 1250 ms, from a still glint and the resting shadow, so a pure function of x). x = 1
  //   rests it face up (.is-turned), x = 0 face down as if never turned. {back: true} scrubs the turn back instead
  //   (0 face up .. 1 face down). Any order, any number of times.
  // turn(color) / unturn(color): the reader's own turn and turn back, run by the browser clock (a promise that
  //   resolves when the card lands). release(color?): a scrubbed card carries on turning by itself and lands.
  // Hook-driven turns move focus only when it would otherwise be left on a face going inert.
  const slotOf = (c) => (typeof c === 'number' ? slots[c] : slots.includes(c) ? c
    : slots.find((s) => s.dataset.card === c || s.classList.contains('slot--' + c))) || null;
  function stopLive(slot) {   // a turn running by itself stops where it is and never lands
    const p = P.get(slot);
    if (p.timer) { clearTimeout(p.timer); p.timer = 0; }
    if (p.anims) { p.anims.forEach((x) => { x.onfinish = null; x.cancel(); }); p.anims = null; }
    if (p.extra) { dropFades(p.extra); p.extra = null; }
  }
  function endScrub(slot) { const p = P.get(slot); if (p.scrub) { p.scrub.anims.forEach((x) => x.cancel()); dropFades(p.scrub.fades); p.scrub = null; } }
  // The cue a turn takes away (its label and breathing glow), faded by paused animations that the scrub moves with the
  // card (the label over the first 600 ms, the glow over 300 ms, as uncue() and the CSS would), so a held turn shows
  // the same cue at the same x however it got there. The CSS transitions are held off meanwhile.
  function cueFades() {
    const cued = slots.filter((s) => s.classList.contains('is-cued'));
    const from = cued.map((s) => { const p = P.get(s), g = getComputedStyle(p.glow), c = getComputedStyle(p.cue); return {p, g: +g.opacity, c: +c.opacity, ct: c.transform}; });
    const out = [];
    from.forEach(({p, g, c, ct}, i) => {
      [p.glow, p.cue].forEach((el) => { el.style.transition = 'none'; });
      cued[i].classList.remove('is-cued');
      out.push({el: p.glow, a: p.glow.animate([{opacity: g}, {opacity: 0}], {duration: 300, easing: 'ease-out', fill: 'both'})});
      out.push({el: p.cue, a: p.cue.animate([{opacity: c, transform: ct === 'none' ? 'translateY(0)' : ct}, {opacity: 0, transform: 'translateY(-4px)'}], {duration: 600, easing: 'ease', fill: 'both'})});
    });
    return out;
  }
  function dropFades(list) { (list || []).forEach(({el, a}) => { a.cancel(); el.style.transition = ''; }); }
  // Rest a card face up or face down at once. fresh: face down as if it had never been turned (the cue treats it so).
  function restAt(slot, turned, fresh) {
    const p = P.get(slot);
    stopLive(slot); endScrub(slot);
    if (turned) { focusFront(p, true); seen.add(slot); } else { focusBack(p, true); if (fresh) seen.delete(slot); }
    settle(slot, turned);
    delete slot.dataset.busy;
    updateCue();
    p.waiters.splice(0).forEach((w) => w());
  }
  function scrub(slot, x, back) {
    const p = P.get(slot), up = !back;
    x = Math.min(1, Math.max(0, Number(x) || 0));
    if (reduce ? x > 0 : x >= 1) { restAt(slot, up, false); return; }   // reduced motion: the end state from the start
    if (x <= 0) { restAt(slot, !up, up); return; }
    if (!p.scrub || p.scrub.up !== up) {
      stopLive(slot); endScrub(slot);
      const fades = cueFades();     // no cue while a card turns (as uncue(), but held with the card)
      settle(slot, !up);            // the side it starts from, as a reader's turn keeps it until it lands
      slot.dataset.busy = '1';
      slot.classList.remove('is-warming');
      [p.back.sheen, p.front.sheen].forEach((sh) => { sh.style.transition = 'none'; sh.style.opacity = ''; sh.style.transform = ''; });
      const {all} = turnAnims(slot, up, 0, 0, .3);
      all.forEach((a) => a.pause());
      fades.forEach((f) => f.a.pause());
      p.scrub = {up, anims: all, fades, x: 0};
    }
    p.scrub.x = x;
    p.scrub.anims.forEach((a) => { a.currentTime = x * D; });
    p.scrub.fades.forEach((f) => { f.a.currentTime = x * D; });
  }
  function release(slot, quiet = true) {
    const p = P.get(slot), s = p.scrub;
    if (!s) return;
    p.scrub = null;
    p.anims = s.anims;
    p.extra = s.fades;
    whenDone(slot, s.up, s.anims[0], s.anims[1], quiet);
    s.anims.forEach((a) => a.play());
    s.fades.forEach((f) => f.a.play());
  }
  const landing = (slot) => new Promise((r) => { if (slot.dataset.busy) P.get(slot).waiters.push(r); else r(); });
  const api = {
    set(color, x, opts = {}) { const s = slotOf(color); if (s) scrub(s, x, !!(opts && opts.back)); return api; },
    turn(color) { const s = slotOf(color); if (!s) return Promise.resolve(); flip(s, true, true); return landing(s); },
    unturn(color) { const s = slotOf(color); if (!s) return Promise.resolve(); flip(s, false, true); return landing(s); },
    release(color) { (color == null ? slots : [slotOf(color)]).forEach((s) => s && release(s)); return api; },
    get state() {
      return Object.fromEntries(slots.map((s) => {
        const p = P.get(s), live = p.anims && p.anims[0];
        return [s.dataset.card, {turned: s.classList.contains('is-turned'), busy: !!s.dataset.busy, cued: s.classList.contains('is-cued'),
          scrub: p.scrub ? {dir: p.scrub.up ? 'up' : 'back', x: p.scrub.x} : null, live: live ? (live.currentTime || 0) / D : null}];
      }));
    },
  };
  deck.__cards = api;

  slots.forEach((slot) => {
    const p = P.get(slot);
    p.back.el.addEventListener('click', () => flip(slot, true));
    p.turnBack.addEventListener('click', () => flip(slot, false));
    // Enter held down repeats clicks; one turn per press.
    [p.back.el, p.turnBack].forEach((b) => b.addEventListener('keydown', (e) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault(); }));

    // A click anywhere on a turned card's front turns it back, unless it is on a link (the link opens) or it ends a
    // drag, such as selecting a line of the quote. A mouse or pen that moved more than 8px dragged; a finger that
    // drags scrolls instead (no click follows), so a tap counts wherever the finger lifts. A selection on the front
    // that the click made or changed means the reader was selecting; one that was already there, untouched, does not.
    let down = null;
    p.front.el.addEventListener('pointerdown', (e) => {
      const s = getSelection();
      down = {x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch', sel: s && s.rangeCount && !s.isCollapsed ? s.getRangeAt(0).cloneRange() : null};
    });
    p.front.el.addEventListener('click', (e) => {
      const d = down;
      down = null;
      if (e.button !== 0 || e.target.closest('a, button')) return;
      if (d && !d.touch && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
      const s = getSelection();
      if (s && s.rangeCount && !s.isCollapsed && p.front.el.contains(s.anchorNode)) {
        const r = s.getRangeAt(0), o = d && d.sel;
        if (!o || r.compareBoundaryPoints(Range.START_TO_START, o) || r.compareBoundaryPoints(Range.END_TO_END, o)) return;
      }
      flip(slot, false);
    });

    // a slight tilt toward the pointer on hover (fine pointers only); it holds still while the card turns
    let raf = 0, pending = null;
    p.stage.addEventListener('pointermove', (e) => {
      p.left = false;
      if (reduce || !fineMQ.matches || slot.dataset.busy) return;
      pending = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (slot.dataset.busy) return;
        const r = p.stage.getBoundingClientRect();
        const x = (pending.clientX - r.left) / r.width - .5, y = (pending.clientY - r.top) / r.height - .5;
        p.tilt.style.transition = 'transform .25s cubic-bezier(.2,.7,.2,1)';
        p.tilt.style.transform = `rotateX(${(-y * 10).toFixed(2)}deg) rotateY(${(x * 13).toFixed(2)}deg) translateZ(8px)`;
        // a faint glint rides across the upturned face with the pointer
        const sh = slot.classList.contains('is-turned') ? p.front.sheen : p.back.sheen;
        p.glintX = Math.round((40 + (x + .5) * 140) * 10) / 10;
        sh.style.transition = 'transform .25s ease-out, opacity .4s ease';
        sh.style.opacity = '.5';
        sh.style.transform = `translateX(${p.glintX}%)`;
      });
    });
    // leaving mid-turn: the tilt eases back to flat once the card has landed
    p.stage.addEventListener('pointerleave', () => { if (slot.dataset.busy) p.left = true; else resetHover(p); });

    settle(slot, false);
  });
  updateCue();
}
