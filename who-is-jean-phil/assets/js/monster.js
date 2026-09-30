// The many-eyed monster: a floating body in Jean Phil's bob and mustache, some eyes swapped for
// JEANPHIL coins. Drawn in 3D on a canvas so it can turn all the way round. It spins on its own;
// a horizontal swipe or drag (or a sideways trackpad scroll) spins it by hand. No UI, on purpose.

const canvas = typeof document !== 'undefined' ? document.querySelector('canvas.monster') : null;
if (canvas) init(canvas);

// A blink as a pure function of time (0 open .. 1 shut), for frame-stepped drawing: one 0.22 s blink in every 4.5 s,
// at a different point in each (golden-ratio steps), none before t = 2.5. The page's own loop keeps its running schedule.
export function blinkAt(t) {
  if (!(t >= 2.5)) return 0;
  const i = Math.floor((t - 2.5) / 4.5), start = 2.5 + i * 4.5 + ((i * .618034) % 1) * 3.6 + .3;
  const k = (t - start) / .22;
  return k < 0 || k > 1 ? 0 : 1 - Math.abs(k * 2 - 1);
}

// The drawing on its own, so other scenes can use the monster too.
// makeMonster(ctx) returns render({cx, cy, S, LW, yaw, t, open, gaze, blink, shadow: {y, bob}}).
// blink (0..1) given = that lid, drawn as is (deterministic); left out = the monster's own running blink schedule.
export function makeMonster(ctx, reduced = false) {
  const D = Math.PI / 180;
  const C = {
    red: '#fd0001', shade: '#c9000c', bump: '#d4000b', hair: '#e8cd8c', hairLine: '#b8975a',
    ink: '#141312', mouth: '#1c0b0b', tongue: '#a30016', bone: '#f6efdf', tent: '#9c0a1c',
    gold: '#e8cd8c', gold2: '#b8975a', shadow: 'rgba(20,19,18,.13)',
  };

  // The Jean Phil symbol, in its 100 x 100 box, for the coins.
  const FACE = new Path2D('M31,38 L69,38 L69,76 C69,88 60,94 50,94 C40,94 31,88 31,76 Z');
  const HAIR = new Path2D('M50,6 C65,6 75,15 79,30 C83,45 89,62 95,77 C87,81 76,80 69,74 C70,62 70,50 69,39 C61,35 39,35 31,39 C30,50 30,62 31,74 C24,80 13,81 5,77 C11,62 17,45 21,30 C25,15 35,6 50,6 Z');
  const STACHE_D = 'M38.6,64.6 C36.2,62.6 33.4,64.4 34.6,67.2 C35.8,70 40,71.2 43.6,70.2 C46.4,69.4 48.4,68.2 50,67.4 C51.6,68.2 53.6,69.4 56.4,70.2 C60,71.2 64.2,70 65.4,67.2 C66.6,64.4 63.8,62.6 61.4,64.6';
  const STACHE = new Path2D(STACHE_D);
  const NOSE = new Path2D('M51,51 L48.5,62 L52,62.5');

  // ---- geometry helpers (world: y up, z toward the viewer at rest) ----
  const sph = (lat, lon) => [Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D), Math.cos(lat * D) * Math.cos(lon * D)];
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  // A point on the sphere at an offset (east e, north n, in degrees) from a centre (lat, lon).
  function offs(lat, lon, e, n) {
    const c = sph(lat, lon), east = [Math.cos(lon * D), 0, -Math.sin(lon * D)], north = cross(c, east);
    return norm(add(add(c, east, Math.tan(e * D)), north, Math.tan(n * D)));
  }
  // Keep polygons counter-clockwise as seen from outside, so the limb arcs close on the right side.
  function ccw(pts, lat, lon) {
    const c = sph(lat, lon), east = [Math.cos(lon * D), 0, -Math.sin(lon * D)], north = cross(c, east);
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += dot(p, east) * dot(q, north) - dot(q, east) * dot(p, north);
    }
    return a < 0 ? pts.slice().reverse() : pts;
  }
  const ring = (lat, lon, re, rn, n = 22, rot = 0) => {
    const pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; pts.push(offs(lat, lon, re * Math.cos(a + rot), rn * Math.sin(a + rot))); }
    return pts;
  };
  // Flatten an SVG path of M/C/L commands into points.
  function flatten(d, steps = 8) {
    const t = d.match(/[MLC]|-?[\d.]+/g), out = [];
    let i = 0, cmd = '', x = 0, y = 0;
    const num = () => +t[i++];
    while (i < t.length) {
      if (/[MLC]/.test(t[i])) cmd = t[i++];
      if (cmd === 'M' || cmd === 'L') { x = num(); y = num(); out.push([x, y]); }
      else if (cmd === 'C') {
        const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num();
        for (let s = 1; s <= steps; s++) {
          const u = s / steps, v = 1 - u;
          out.push([v * v * v * x + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3, v * v * v * y + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3]);
        }
        x = x3; y = y3;
      }
    }
    return out;
  }

  // ---- the monster, built once ----
  const HAIRLINE = lon => { // pageboy: straight fringe in front, down to the jaw at the sides and back
    const a = Math.abs(((lon + 540) % 360) - 180) ; // 0 at the front .. 180 at the back
    if (a < 46) return 40;
    if (a > 100) return -6 + 3 * Math.cos((a - 100) * 4.5 * D);
    const u = (a - 46) / 54; return 40 - 46 * (u * u * (3 - 2 * u));
  };
  const hairCap = []; for (let lon = -180; lon < 180; lon += 3) hairCap.push(sph(HAIRLINE(lon), lon));

  const EYE = {lat: 23, lon: 0, r: 12};
  const eyeRing = ccw(ring(EYE.lat, EYE.lon, EYE.r, EYE.r, 28), EYE.lat, EYE.lon);
  const slit = ccw(ring(EYE.lat, EYE.lon, 2.2, 9.5, 18), EYE.lat, EYE.lon);

  const stache = flatten(STACHE_D, 10).map(([x, y]) => sph(1 - (y - 66.5) * 1.75, (x - 50) * 1.9));

  const MOUTH_W = 64;
  const upper = lon => -13 + 3.5 * (1 - (lon / MOUTH_W) ** 2);
  const lower = (lon, open) => -13 - 41 * open * Math.pow(Math.cos(lon / MOUTH_W * Math.PI / 2), 0.75);
  function mouthPoly(open) {
    const pts = [];
    for (let lon = -MOUTH_W; lon <= MOUTH_W; lon += 4) pts.push(sph(lower(lon, open), lon));
    for (let lon = MOUTH_W; lon >= -MOUTH_W; lon -= 4) pts.push(sph(upper(lon), lon));
    return pts;
  }
  function teeth(open) {
    const out = [];
    for (let i = 0; i < 9; i++) {
      const lon = -50 + i * 12.5, len = (i % 2 ? 8 : 12) * Math.min(1, open + .15), w = 4.6;
      out.push(ccw([sph(upper(lon - w), lon - w), sph(upper(lon) - len, lon), sph(upper(lon + w), lon + w)], upper(lon) - 4, lon));
    }
    for (let i = 0; i < 8; i++) {
      const lon = -44 + i * 12.6, base = lower(lon, open), len = (i % 2 ? 11 : 7) * Math.min(1, open + .1), w = 4.4;
      out.push(ccw([sph(lower(lon - w, open), lon - w), sph(base + len, lon), sph(lower(lon + w, open), lon + w)], base + 3, lon));
    }
    return out;
  }

  // Skin bumps, kept off the hair, the face and the mouth.
  const bumps = [];
  for (let i = 0; i < 90 && bumps.length < 46; i++) {
    const y = 1 - (i + .5) / 90 * 2, lat = Math.asin(y) / D, lon = ((i * 137.508) % 360) - 180;
    if (lat > HAIRLINE(lon) - 6) continue;
    if (Math.abs(lon) < 78 && lat > -62 && lat < 42) continue;
    if (lat < -80) continue;
    bumps.push(ccw(ring(lat, lon, 4 + (i % 3), 3.4 + (i % 2), 12), lat, lon));
  }

  // Small eyes and flush coins on the body; stalk eyes and stalk coins on top.
  const bodyBits = [
    {lat: 2, lon: 92, kind: 'eye'}, {lat: -30, lon: 86, kind: 'coin'}, {lat: -8, lon: 128, kind: 'eye'},
    {lat: 4, lon: -94, kind: 'coin'}, {lat: -28, lon: -88, kind: 'eye'}, {lat: -10, lon: -130, kind: 'eye'},
    {lat: -6, lon: 180, kind: 'coin'}, {lat: -36, lon: 150, kind: 'eye'}, {lat: -34, lon: -156, kind: 'eye'},
  ];
  const stalks = [
    {lat: 64, lon: 6, len: .92, coin: true}, {lat: 52, lon: 58, len: .72}, {lat: 54, lon: -52, len: .78},
    {lat: 40, lon: 112, len: .66, coin: true}, {lat: 42, lon: -116, len: .62, coin: true}, {lat: 58, lon: 160, len: .8},
    {lat: 74, lon: -110, len: .6}, {lat: 26, lon: 78, len: .5}, {lat: 28, lon: -80, len: .55, coin: true},
  ].map((s, i) => ({...s, phase: i * 1.7, side: i % 2 ? 1 : -1}));
  const tentacles = [];
  for (let i = 0; i < 7; i++) tentacles.push({lat: -60 - (i % 3) * 7, lon: -180 + i * 51.4 + 20, len: .5 + (i % 3) * .14, phase: i * 2.1, curl: i % 2 ? 1 : -1});

  // ---- camera ----
  let S = 0, cx = 0, cy = 0, LW = 2, gaze = 0, blinkAt = 2.5, cyaw = 1, syaw = 0;
  const pitch = 0.2, cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cam = p => { // world -> camera (unit sphere); y up, z toward the viewer
    const x1 = p[0] * cyaw + p[2] * syaw, z1 = -p[0] * syaw + p[2] * cyaw, y1 = p[1];
    return [x1, y1 * cp - z1 * sp, z1 * cp + y1 * sp];
  };
  const scr = q => [cx + q[0] * S, cy - q[1] * S];

  // Draw the part of a sphere-surface polygon that faces us, closing along the rim where it wraps round.
  function surf(poly, fill, stroke, lw) {
    const cp3 = poly.map(cam), out = [];
    const n = cp3.length;
    for (let i = 0; i < n; i++) {
      const a = cp3[i], b = cp3[(i + 1) % n];
      if (a[2] >= 0) out.push({p: a});
      if ((a[2] >= 0) !== (b[2] >= 0)) {
        const t = a[2] / (a[2] - b[2]);
        let x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t; const l = Math.hypot(x, y) || 1;
        out.push({p: [x / l, y / l, 0], exit: a[2] >= 0});
      }
    }
    if (!out.length) return false;
    ctx.beginPath();
    out.forEach((o, i) => {
      const [X, Y] = scr(o.p);
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      if (o.exit) { // follow the rim, counter-clockwise, to where the outline comes back
        const nx = out[(i + 1) % out.length].p;
        let a0 = Math.atan2(o.p[1], o.p[0]), a1 = Math.atan2(nx[1], nx[0]);
        while (a1 < a0) a1 += 2 * Math.PI;
        for (let a = a0 + .08; a < a1; a += .08) ctx.lineTo(cx + Math.cos(a) * S, cy - Math.sin(a) * S);
      }
    });
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) line(cp3, true, stroke, lw);
    return true;
  }
  // Stroke only the visible stretches of a surface line.
  function line(cp3, closed, color, lw) {
    ctx.beginPath();
    const n = cp3.length, m = closed ? n : n - 1;
    let pen = false;
    for (let i = 0; i < m; i++) {
      const a = cp3[i], b = cp3[(i + 1) % n];
      if (a[2] < 0 && b[2] < 0) { pen = false; continue; }
      let A = a, B = b;
      if (a[2] < 0 || b[2] < 0) {
        const t = a[2] / (a[2] - b[2]), X = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0];
        if (a[2] < 0) { A = X; pen = false; } else B = X;
      }
      if (!pen) { const [x, y] = scr(A); ctx.moveTo(x, y); pen = true; }
      const [x, y] = scr(B); ctx.lineTo(x, y);
      if (b[2] < 0) pen = false;
    }
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }

  // A JEANPHIL coin: centre c, facing n (world), radius r (world units).
  function coin(c, n, r) {
    const up = Math.abs(n[1]) > .95 ? [0, 0, -1] : [0, 1, 0];
    const v = norm(add(up, n, -dot(up, n))), u = cross(v, n);
    const back = add(c, n, -r * .16);
    const C0 = cam(c), U = cam(u), V = cam(v), N = cam(n), B0 = cam(back);
    const k = S * r / 50;
    const mat = o => [k * U[0], -k * U[1], -k * V[0], k * V[1], cx + o[0] * S - 50 * k * U[0] + 50 * k * V[0], cy - o[1] * S + 50 * k * U[1] - 50 * k * V[1]];
    const disc = (o, fill) => {
      ctx.save(); ctx.transform(...mat(o)); ctx.beginPath(); ctx.arc(50, 50, 50, 0, 2 * Math.PI); ctx.restore();
      ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = LW * .8; ctx.stroke();
    };
    const facing = N[2] > 0;
    // Nearer disc last: the edge shows behind the face, or the plain back shows in front of it.
    if (facing) { disc(B0, C.gold2); disc(C0, C.gold); } else { disc(C0, C.gold2); disc(B0, C.gold); }
    ctx.save(); ctx.transform(...mat(facing ? C0 : B0));
    ctx.beginPath(); ctx.arc(50, 50, 38, 0, 2 * Math.PI);
    ctx.fillStyle = facing ? C.red : C.gold2; ctx.fill();
    if (facing) { // the face side
      ctx.clip();
      ctx.translate(50, 50); ctx.scale(.74, .74); ctx.translate(-50, -46);
      ctx.fillStyle = C.red; ctx.fill(FACE); ctx.fillStyle = C.hair; ctx.fill(HAIR);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = C.hair; ctx.lineWidth = 4.2; ctx.stroke(STACHE); // blond, to match the hair
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2.8; ctx.stroke(NOSE);
    }
    ctx.restore();
  }

  function eyeball(c, dir, r, gaze) {
    const C0 = cam(c), [X, Y] = scr(C0), R = r * S * (1 + C0[2] * .08);
    let d = cam(dir); d = norm([d[0] * (1 - gaze), d[1] * (1 - gaze), d[2] * (1 - gaze) + gaze]);
    ctx.beginPath(); ctx.arc(X, Y, R, 0, 2 * Math.PI);
    ctx.fillStyle = C.bone; ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = LW * .8; ctx.stroke();
    if (d[2] > -.25) {
      const px = X + d[0] * R * .5, py = Y - d[1] * R * .5, pr = R * .42 * (.55 + .45 * Math.max(0, d[2]));
      ctx.beginPath(); ctx.ellipse(px, py, pr, pr * 1.05, 0, 0, 2 * Math.PI); ctx.fillStyle = C.ink; ctx.fill();
      ctx.beginPath(); ctx.arc(px - pr * .35, py - pr * .35, pr * .28, 0, 2 * Math.PI); ctx.fillStyle = C.bone; ctx.fill();
    }
  }

  // Stalks: a bent tube from the body with an eye or a coin on the end.
  function stalkGeom(s, t) {
    const b = sph(s.lat, s.lon), d = norm(add(b, [0, 1, 0], .7));
    const east = [Math.cos(s.lon * D), 0, -Math.sin(s.lon * D)];
    const sway = reduced ? 0 : Math.sin(t * 1.1 + s.phase) * .08;
    const p1 = add(add(b, d, s.len * .55), east, s.side * .3 + sway);
    const p2 = add(add(add(b, d, s.len), east, -s.side * .06 + sway * 1.6), [0, 1, 0], .05 * (reduced ? 0 : Math.sin(t * .9 + s.phase)));
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10, v = 1 - u;
      pts.push([v * v * b[0] * .96 + 2 * v * u * p1[0] + u * u * p2[0], v * v * b[1] * .96 + 2 * v * u * p1[1] + u * u * p2[1], v * v * b[2] * .96 + 2 * v * u * p1[2] + u * u * p2[2]]);
    }
    const tip = pts[10], dir = norm([tip[0] - pts[8][0], tip[1] - pts[8][1], tip[2] - pts[8][2]]);
    return {pts, tip, dir, depth: cam(b)[2]};
  }
  function tube(pts, w0, w1, fill) {
    const P = pts.map(p => scr(cam(p)));
    const seg = (w, col) => {
      for (let i = 0; i < P.length - 1; i++) {
        ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[i + 1][0], P[i + 1][1]);
        ctx.lineWidth = w(i / (P.length - 1)); ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.stroke();
      }
    };
    seg(u => (w0 + (w1 - w0) * u) * S + LW * 1.6, C.ink);
    seg(u => (w0 + (w1 - w0) * u) * S, fill);
  }
  function drawStalk(s, g, t) {
    tube(g.pts, .1, .065, C.red);
    if (s.coin) coin(add(g.tip, g.dir, .06), g.dir, .2);
    else eyeball(add(g.tip, g.dir, .06), g.dir, .15, gaze);
  }
  function drawTentacle(tn, t) {
    const b = sph(tn.lat, tn.lon), out = norm([b[0], 0, b[2]]);
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12, sw = reduced ? 0 : Math.sin(t * 1.4 + tn.phase + u * 3) * .09 * u;
      pts.push(add(add(add(b, out, u * .3 + sw + .12 * u * u * u), [0, -1, 0], u * tn.len - .1 * u ** 4), [out[2], 0, -out[0]], sw * .8 + tn.curl * .14 * u ** 3));
    }
    tube(pts, .1, .02, C.tent);
  }

  function render(o) {
    S = o.S; cx = o.cx; cy = o.cy; LW = o.LW; gaze = o.gaze || 0; cyaw = Math.cos(o.yaw); syaw = Math.sin(o.yaw);
    const t = o.t, open = o.open ?? .95;
    if (o.shadow) {
      ctx.beginPath(); ctx.ellipse(cx, o.shadow.y, S * (.78 - (o.shadow.bob || 0) * 1.2), S * .1, 0, 0, 2 * Math.PI);
      ctx.fillStyle = C.shadow; ctx.fill();
    }
    const gs = stalks.map(s => ({s, g: stalkGeom(s, t)}));
    tentacles.forEach(tn => drawTentacle(tn, t));
    gs.filter(o => o.g.depth < 0).sort((a, b) => a.g.depth - b.g.depth).forEach(o => drawStalk(o.s, o.g, t));

    // body, shaded like the flat two-tone symbol
    ctx.beginPath(); ctx.arc(cx, cy, S, 0, 2 * Math.PI); ctx.fillStyle = C.red; ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, S, 0, 2 * Math.PI); ctx.clip();
    ctx.beginPath(); ctx.arc(cx, cy, S * 1.02, 0, 2 * Math.PI); ctx.arc(cx - S * .16, cy - S * .2, S * 1.02, 0, 2 * Math.PI);
    ctx.fillStyle = C.shade; ctx.fill('evenodd');
    bumps.forEach(b => surf(b, null, C.bump, LW * .7));
    surf(hairCap, C.hair, C.ink, LW);

    // mouth, tongue, teeth
    const mp = mouthPoly(open);
    if (surf(mp, C.mouth, null)) {
      ctx.save(); ctx.clip();
      surf(ccw(ring(-13 - 34 * open, 0, 24, 9, 24), -13 - 34 * open, 0), C.tongue, null);
      teeth(open).forEach(tp => surf(tp, C.bone, C.ink, LW * .7));
      ctx.restore();
      line(mp.map(cam), true, C.ink, LW * 1.1);
    }
    // the big eye, with a blink now and then
    if (surf(eyeRing, C.bone, null)) {
      surf(slit, C.ink, null);
      if (o.blink != null) { if (!reduced && o.blink > 0) lid(Math.min(1, o.blink)); }
      else if (!reduced && t > blinkAt) { const k = (t - blinkAt) / .22; if (k > 1) blinkAt = t + 2.5 + ((t * 7.3) % 4); else lid(1 - Math.abs(k * 2 - 1)); }
      line(eyeRing.map(cam), true, C.ink, LW);
    }
    const sc = stache.map(cam); // blond, like the hair, outlined in ink
    line(sc, false, C.ink, S * .075 + LW * 1.8);
    line(sc, false, C.hair, S * .075);
    bodyBits.forEach(b => {
      const n = sph(b.lat, b.lon);
      if (cam(n)[2] < .08) return;
      if (b.kind === 'coin') coin(add(n, n, .01), n, .15);
      else {
        const rr = ccw(ring(b.lat, b.lon, 7, 7, 18), b.lat, b.lon);
        surf(rr, C.bone, C.ink, LW * .7);
        surf(ccw(ring(b.lat, b.lon, 2.8, 3.2, 12), b.lat, b.lon), C.ink, null);
      }
    });
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, S, 0, 2 * Math.PI); ctx.strokeStyle = C.ink; ctx.lineWidth = LW * 1.2; ctx.stroke();

    gs.filter(o => o.g.depth >= 0).sort((a, b) => a.g.depth - b.g.depth).forEach(o => drawStalk(o.s, o.g, t));
  }
  // Eyelid: the top of the big eye, closed by k (0..1).
  function lid(k) {
    const pts = [], r = EYE.r, cut = r - 2 * r * k;
    const a0 = Math.asin(Math.max(-1, Math.min(1, cut / r)));
    for (let a = a0; a <= Math.PI - a0 + 1e-6; a += (Math.PI - 2 * a0) / 16 || 1) pts.push(offs(EYE.lat, EYE.lon, r * Math.cos(a), r * Math.sin(a)));
    surf(ccw(pts, EYE.lat, EYE.lon), C.red, C.ink, LW * .8);
  }

  return render;
}

function init(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const monster = makeMonster(ctx, reduced);
  let W = 0, H = 0, S = 0, cx = 0, cy = 0, dpr = 1, yaw = 0.5, LW = 2;

  // ---- state and input ----
  const IDLE = reduced ? 0 : .42; // radians a second, about one turn every 15 s
  let vel = IDLE, dir = 1, dragging = false, lastX = 0, lastT = 0, sample = 0, wheelUntil = 0, gaze = 0;
  // Hooks (canvas.__monster, below): frozen = the loop is off and only set() draws, at the time it was given (fT).
  // tOff shifts the loop's clock so a set({t}) without freeze carries on from that t (0 for a reader: unchanged).
  let frozen = false, fT = 0, tOff = 0;
  const clock = () => performance.now() / 1000 + tOff;
  // A reader who grabs a frozen monster gets it back (the player pauses on that same touch).
  const reclaim = e => { if (frozen && e.isTrusted) api.freeze(false); };
  canvas.style.touchAction = 'pan-y';
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    reclaim(e);
    dragging = true; lastX = e.clientX; lastT = e.timeStamp; sample = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    wake();
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dt = Math.max(1, e.timeStamp - lastT) / 1000;
    yaw += dx * .011;
    sample = sample * .4 + (dx * .011 / dt) * .6;
    lastX = e.clientX; lastT = e.timeStamp;
    if (frozen) paint();
  });
  const release = e => {
    if (!dragging) return;
    dragging = false;
    if (e && e.timeStamp - lastT > 80) sample = 0; // held still before lifting: no fling
    const cap = reduced ? 3 : 14;
    vel = Math.max(-cap, Math.min(cap, sample));
    if (Math.abs(vel) > .05) dir = Math.sign(vel);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical scrolling stays the page's
    e.preventDefault();
    reclaim(e);
    yaw -= e.deltaX * .006;
    dir = e.deltaX > 0 ? -1 : 1; vel = 0; wheelUntil = performance.now() + 160;
    if (frozen) paint();
    wake();
  }, {passive: false});

  // ---- sizing and the loop ----
  function size() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.round(r.width * dpr); H = Math.round(r.height * dpr);
    if (!W || !H) return;
    canvas.width = W; canvas.height = H;
    S = Math.min(W / 3, H / 4.1); cx = W / 2; cy = H * .49;
    LW = Math.max(1.5 * dpr, S * .018);
    if (frozen) paint(); else draw(clock());
  }
  let raf = 0, visible = false, last = 0;
  function frame(now) {
    raf = 0;
    if (frozen) return;
    const t = now / 1000 + tOff, dt = last ? Math.min(.05, t - last) : 0; last = t;
    if (!dragging) {
      if (now < wheelUntil) vel = 0;
      else { vel += (dir * IDLE - vel) * (1 - Math.exp(-dt / .9)); yaw += vel * dt; }
    }
    gaze += ((dragging || Math.abs(vel) > 1.2 ? 1 : 0) - gaze) * (1 - Math.exp(-dt / .25));
    draw(t);
    // With reduced motion it rests once it stops; a drag or a sideways scroll wakes it again.
    if (reduced && !dragging && Math.abs(vel) < .01 && gaze < .01) { vel = 0; return; }
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!frozen && !raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
  new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) wake(); }, {rootMargin: '80px'}).observe(canvas);
  document.addEventListener('visibilitychange', wake);
  new ResizeObserver(size).observe(canvas);

  // pure = drawn only from (t, yaw, vel, gaze): the blink comes from blinkAt(t) instead of the running schedule.
  // Frozen draws are coalesced to one per task (a microtask): Chrome rasterises a canvas redrawn twice in one frame a
  // hair differently from one drawn once, and a frame-stepped render must get the same pixels however it got there.
  let paintQueued = false;
  function paint() {
    if (paintQueued) return;
    paintQueued = true;
    queueMicrotask(() => { paintQueued = false; if (frozen) draw(fT, true); });
  }
  function draw(t, pure = false) {
    if (!W) return;
    const bob = reduced ? 0 : Math.sin(t * 1.3) * .045;
    const open = (reduced ? .95 : .9 + .07 * Math.sin(t * .8)) + Math.min(.22, Math.abs(vel) * .025);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    monster({cx, cy: H * .49 - bob * S, S, LW, yaw, t, open, gaze, blink: pure ? blinkAt(t) : undefined, shadow: {y: H * .49 + S * 1.93, bob}});
  }

  // ---- hooks for Play mode and the frame renderer (docs: scratchpad/autoplay/hooks-api.md) ----
  // set({yaw, vel, t, gaze}): yaw in radians (0 = facing the camera), vel in rad/s (opens the mouth with speed),
  //   t in seconds (bob, stalk sway, mouth breathing, blink), gaze 0..1 (default: from |vel|, as the loop would settle).
  //   Frozen: that is the whole state (a pure function of the arguments; t left out keeps the last t), painted once at
  //   the end of the task.
  //   Not frozen: drawn at once, and the loop carries on from there (same clock, same spin direction).
  // freeze(true): the loop stops and only set() draws; freeze(false) hands it back to the loop from the frozen state.
  const gazeFor = v => { const q = Math.min(1, Math.max(0, (Math.abs(v) - .6) / 1.2)); return q * q * (3 - 2 * q); };
  const api = {
    set(o = {}) {
      if (Number.isFinite(o.yaw)) yaw = o.yaw;
      if (Number.isFinite(o.vel)) { vel = o.vel; if (Math.abs(vel) > .05) dir = Math.sign(vel); }
      gaze = Number.isFinite(o.gaze) ? Math.min(1, Math.max(0, o.gaze)) : gazeFor(vel);
      if (frozen) { if (Number.isFinite(o.t)) fT = o.t; paint(); return api; }
      if (Number.isFinite(o.t)) tOff = o.t - performance.now() / 1000;
      last = 0;
      draw(clock());
      wake();
      return api;
    },
    freeze(on = true) {
      on = !!on;
      if (on === frozen) return api;
      if (on) { fT = clock(); frozen = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } dragging = false; paint(); }
      else { frozen = false; tOff = fT - performance.now() / 1000; last = 0; wake(); }
      return api;
    },
    spin(a) { yaw = a; if (frozen) paint(); else draw(clock()); return api; },
    get yaw() { return yaw; },
    get frozen() { return frozen; },
    get state() { return {yaw, vel, gaze, t: frozen ? fT : clock(), frozen}; },
  };
  canvas.__monster = api;
}
