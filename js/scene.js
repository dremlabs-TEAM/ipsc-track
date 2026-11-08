// Render 2.5D de escenarios IPSC (canvas 2D, todo procedural).
// Diana IPSC (sin cabeza), poppers y placas con medidas del reglamento IPSC Handgun 2024.
import { rng, PERSPECTIVE } from './course.js?v=20261108-2328';

const { F, HOR, CAMH, SPREAD } = PERSPECTIVE;

// ---------------------------------------------------------------- temas de luz
export const THEMES = [
  { name: 'Atardecer', outdoor: true, sky: ['#18213f', '#6b4567', '#f2915a'], sun: { x: 0.8, color: '#ffd79a' }, haze: '#e7a57a', hazeAmt: 0.42,
    berm: ['#6a4c35', '#4a3527'], grass: '#7a6f3d', ground: ['#9a7656', '#5e4532'], shadow: [20, 10, 5, 0.42], shadowX: -0.6, warm: 'rgba(255,150,80,0.16)' },
  { name: 'Galería cubierta', outdoor: false, wall: ['#474d55', '#30353b'], ceiling: '#17191d', haze: '#aeb8c2', hazeAmt: 0.22,
    ground: ['#6a655d', '#3b3732'], shadow: [0, 0, 0, 0.45], shadowX: 0 },
  { name: 'Mediodía', outdoor: true, sky: ['#2c6fc4', '#6aa6e2', '#d4e6f4'], clouds: 'light', haze: '#d3e2ee', hazeAmt: 0.32,
    berm: ['#86704b', '#5f5036'], grass: '#6f8c3b', ground: ['#cdb289', '#9d8360'], shadow: [40, 30, 15, 0.38], shadowX: 0.25 },
  { name: 'Noche con focos', outdoor: true, sky: ['#03050b', '#0a1222', '#16223a'], stars: true, floods: true, haze: '#1d2b44', hazeAmt: 0.45,
    berm: ['#3a332c', '#231f1b'], grass: '#3a4128', ground: ['#5a5046', '#2a2520'], shadow: [0, 0, 0, 0.5], shadowX: 0 },
  { name: 'Nublado', outdoor: true, sky: ['#69737d', '#99a2aa', '#c6cbcf'], clouds: 'heavy', haze: '#bcc3c9', hazeAmt: 0.45,
    berm: ['#62594a', '#463f35'], grass: '#5b6b46', ground: ['#908676', '#5d564b'], shadow: [20, 20, 20, 0.25], shadowX: 0.1 },
];

// ---------------------------------------------------------------- activación popper → móvil (ms)
export const ACT = { ringStart: 0, ringDur: 1150, ringGap: 260, glowStart: 1050, glowPeak: 1500, fallStart: 1560, fallDur: 560, cableStart: 1720, cableDur: 420, moverStart: 2150 };
export const MOVER_DUR = { swinger: 4300, drop: 3000, slider: 2400, bobber: 4200 };
export const activationTotal = (stage) => (stage?.act ? ACT.moverStart + MOVER_DUR[stage.act.type] : 0);
// Reloj de la activación. Con actSpeed > 1 la onda, el brillo y la caída se aceleran
// (para que el popper caiga al segundo elegido en el editor); el móvil va siempre a velocidad real.
export function actClock(stage, now) {
  if (stage?.actStart == null) return -1;
  const real = now - stage.actStart, sp = stage.actSpeed || 1, pre = ACT.moverStart / sp;
  return real < pre ? real * sp : ACT.moverStart + (real - pre);
}
// Momento (ms desde actStart, tiempo real) en que el popper empieza a caer y en que arranca el móvil
export const fallAtReal = (speed = 1) => ACT.fallStart / speed;
export const moverAtReal = (speed = 1) => ACT.moverStart / speed;

// ---------------------------------------------------------------- utilidades
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

const rgbCache = new Map();
function rgb(hex) {
  let v = rgbCache.get(hex);
  if (!v) { const n = parseInt(hex.slice(1), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; rgbCache.set(hex, v); }
  return v;
}
function mix(a, b, t, alpha = 1) {
  const A = rgb(a), B = rgb(b);
  const c = A.map((x, i) => Math.round(x + (B[i] - x) * t));
  return alpha === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
const shadeHex = (hex, f) => mix(hex, f < 0 ? '#000000' : '#ffffff', Math.abs(f));

let noiseCv = null;
function noiseCanvas() {
  if (noiseCv) return noiseCv;
  noiseCv = document.createElement('canvas'); noiseCv.width = noiseCv.height = 256;
  const c = noiseCv.getContext('2d'), img = c.createImageData(256, 256), r = rng(11);
  for (let i = 0; i < img.data.length; i += 4) { const v = 90 + r() * 165; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  c.putImageData(img, 0, 0); return noiseCv;
}
let meshCv = null;
function meshCanvas() {
  if (meshCv) return meshCv;
  meshCv = document.createElement('canvas'); meshCv.width = meshCv.height = 6;
  const c = meshCv.getContext('2d');
  c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(0, 0, 6, 1); c.fillRect(0, 0, 1, 6);
  return meshCv;
}
const patterns = new WeakMap();
function pat(ctx, which) {
  let m = patterns.get(ctx); if (!m) { m = {}; patterns.set(ctx, m); }
  if (!m[which]) m[which] = ctx.createPattern(which === 'noise' ? noiseCanvas() : meshCanvas(), 'repeat');
  return m[which];
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------------------------------------------------------------- geometría oficial (cm)
// Apéndice B2 – IPSC Target: octógono 45 × 57 cm, zonas A / C / D, sin cabeza.
const T_OUT = [[15, 0], [30, 0], [45, 19], [45, 38], [30, 57], [15, 57], [0, 38], [0, 19]];
const T_C = [[16.5, 0.5], [28.5, 0.5], [37.5, 19], [37.5, 33.5], [27.5, 45], [17.5, 45], [7.5, 33.5], [7.5, 19]];
const T_A = [[20, 2.5], [25, 2.5], [30, 19], [30, 27.5], [25, 35], [20, 35], [15, 27.5], [15, 19]];
// Apéndice C2 – IPSC Popper (85 cm, cabeza Ø30) y Mini Popper (56 cm, cabeza Ø20)
const POP = {
  full: { h: 85, r: 15, cy: 70, nh: 10, ny: 58.8, bh: 7.5 },
  mini: { h: 56, r: 10, cy: 46, nh: 6.75, ny: 38.6, bh: 5 },
};

function tPath(ctx, pts, ox, oy, s, sx) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => { const X = ox + (x - 22.5) * s * sx, Y = oy - (57 - y) * s; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
  ctx.closePath();
}

// Diana IPSC. (ox, oy) = centro del borde inferior en pantalla; k = px por metro.
function drawTarget(ctx, ox, oy, k, o) {
  const s = (k / 100) * (o.mini ? 2 / 3 : 1), sx = o.sx ?? 1, fog = o.fog;
  if (Math.abs(sx) < 0.05) { ctx.fillStyle = fog('#5d4a30'); ctx.fillRect(ox - Math.max(1, 0.4 * s), oy - 57 * s, Math.max(2, 0.8 * s), 57 * s); return; }
  tPath(ctx, T_OUT, ox, oy, s, sx);
  const g = ctx.createLinearGradient(0, oy - 57 * s, 0, oy);
  g.addColorStop(0, fog(o.white ? '#f8f7f2' : '#d3a971')); g.addColorStop(1, fog(o.white ? '#dddad1' : '#b98b55'));
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.globalAlpha = 0.18; ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = pat(ctx, 'noise'); ctx.fillRect(ox - 24 * s, oy - 58 * s, 48 * s, 59 * s);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const lg = ctx.createLinearGradient(ox - 22.5 * s, 0, ox + 22.5 * s, 0);
  lg.addColorStop(0, 'rgba(255,255,255,0.07)'); lg.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = lg; ctx.fillRect(ox - 24 * s, oy - 58 * s, 48 * s, 59 * s);
  // borde no puntuable (0,5 cm)
  tPath(ctx, T_OUT, ox, oy, s, sx); ctx.lineWidth = Math.max(1, 1.0 * s); ctx.strokeStyle = o.white ? 'rgba(0,0,0,0.07)' : 'rgba(95,62,25,0.28)'; ctx.stroke();
  // líneas de zona perforadas
  ctx.setLineDash([Math.max(1.6, 1.3 * s), Math.max(1.2, 0.9 * s)]);
  ctx.lineWidth = Math.max(0.7, 0.26 * s); ctx.strokeStyle = o.white ? 'rgba(0,0,0,0.16)' : 'rgba(80,50,20,0.55)';
  tPath(ctx, T_C, ox, oy, s, sx); ctx.stroke(); tPath(ctx, T_A, ox, oy, s, sx); ctx.stroke();
  ctx.setLineDash([]);
  // parches de partidas anteriores
  for (const p of o.pasters || []) {
    ctx.save(); ctx.translate(ox + (p.u - 22.5) * s * sx, oy - (57 - p.v) * s); ctx.rotate(p.r);
    ctx.fillStyle = o.white ? 'rgba(255,255,255,0.95)' : fog('#dcbd8b'); ctx.fillRect(-1.25 * s * sx, -1.25 * s, 2.5 * s * sx, 2.5 * s);
    ctx.restore();
  }
  // cobertura dura (pintada en negro)
  if (o.hard) hardCover(ctx, ox, oy, s, sx, o.hard);
  if (sx < 1) { ctx.fillStyle = `rgba(0,0,0,${(1 - sx) * 0.45})`; ctx.fillRect(ox - 24 * s, oy - 58 * s, 48 * s, 59 * s); }
  ctx.restore();
  tPath(ctx, T_OUT, ox, oy, s, sx); ctx.lineWidth = Math.max(0.7, 0.3 * s); ctx.strokeStyle = 'rgba(40,25,10,0.35)'; ctx.stroke();
}

// Estilo de una tarjeta (compatible con escenarios guardados antes de existir los estilos)
export function styleOf(it) {
  if (it.style?.kind) return it.style;
  const st = { kind: it.ns ? 'ns-side' : 'normal', ns: it.ns ? { side: it.ns.side || 1, angle: 0 } : null, hard: null };
  if (it.hard) st.hard = { preset: 'side', angle: it.hard.side > 0 ? -6 : 186, amount: it.hard.frac ?? 0.4 };
  return st;
}
// En las dobles, cuánto más arriba (m) está la tarjeta de atrás; en la doble con no-shoot, el no-shoot
// va de pie entre las dos y asoma una franja de NS_PEEK por encima de la tarjeta de delante.
export const DOUBLE_OFFSET = { double: 0.38, 'double-ns': 0.33 };
const NS_PEEK = 0.07;
// altura total (m) de la tarjeta o pareja de tarjetas
export function stackHeight(st, mini = false) {
  return (mini ? 2 / 3 : 1) * (0.57 + (DOUBLE_OFFSET[st?.kind] || 0));
}

// Cobertura negra: tapa la parte de la tarjeta que queda hacia `angle` (0° derecha, 90° abajo).
// amount = fracción del ancho de la tarjeta (medido en esa dirección) que queda tapada.
// preset 'band': tapa los dos extremos y deja visible una franja central.
function hardCover(ctx, ox, oy, s, sx, h) {
  const a = ((Number(h.angle) || 0) * Math.PI) / 180, amount = Math.min(0.95, Math.max(0.03, Number(h.amount) || 0.4));
  const nx = Math.cos(a), ny = Math.sin(a);
  let lo = Infinity, hi = -Infinity;
  for (const [x, y] of T_OUT) { const p = (x - 22.5) * nx + (y - 28.5) * ny; lo = Math.min(lo, p); hi = Math.max(hi, p); }
  const span = hi - lo, big = 200;
  ctx.save();
  ctx.translate(ox, oy - 28.5 * s); ctx.scale(sx, 1); ctx.rotate(a);
  ctx.fillStyle = '#121314';
  if (h.preset === 'band') {
    const half = (amount / 2) * span;
    ctx.fillRect((hi - half) * s, -big * s, big * s, 2 * big * s);
    ctx.fillRect((lo - big) * s, -big * s, (big + half) * s, 2 * big * s);
  } else {
    ctx.fillRect((hi - amount * span) * s, -big * s, big * s, 2 * big * s);
  }
  // ligero brillo de pintura mate
  ctx.globalAlpha = 0.06; ctx.fillStyle = '#ffffff';
  ctx.fillRect((hi - (h.preset === 'band' ? (amount / 2) : amount) * span) * s, -big * s, 1.2 * s, 2 * big * s);
  ctx.restore();
}

// Tarjeta con su estilo: normal, no-shoot inclinado, doble superpuesta o doble con no-shoot en medio.
// (ox, oy) = centro del borde inferior de la tarjeta de delante.
export function drawStyledTarget(ctx, ox, oy, k, st, o) {
  const m = o.mini ? 2 / 3 : 1, sx = o.sx ?? 1, fog = o.fog;
  const kind = st?.kind || 'normal';
  if (Math.abs(sx) < 0.05) { // de canto (drop turner girando)
    const hgt = stackHeight(st, o.mini) * k;
    ctx.fillStyle = fog('#5d4a30'); ctx.fillRect(ox - Math.max(1, 0.004 * k), oy - hgt, Math.max(2, 0.008 * k), hgt);
    return;
  }
  const card = (y, extra) => drawTarget(ctx, ox, y, k, { mini: o.mini, fog, sx, pasters: extra.pasters || [], hard: extra.hard || null });
  if (kind === 'double' || kind === 'double-ns') {
    card(oy - DOUBLE_OFFSET[kind] * m * k, { pasters: o.pasters2 });
    if (kind === 'double-ns') {
      // no-shoot de pie entre las dos tarjetas: tapa la parte baja de la de atrás y asoma como franja blanca
      drawTarget(ctx, ox, oy - NS_PEEK * m * k, k, { white: true, mini: o.mini, fog, sx, pasters: [] });
    }
    card(oy, { hard: st.hard, pasters: o.pasters });
    return;
  }
  card(oy, { hard: st.hard, pasters: o.pasters });
  if ((kind === 'ns-tilt' || kind === 'ns-side') && st.ns) {
    const side = st.ns.side || 1, tilt = kind === 'ns-tilt';
    const ang = (((tilt ? st.ns.angle ?? side * 22 : 0)) * Math.PI) / 180;
    const dx = (tilt ? 0.17 : 0.26) * side * m, drop = tilt ? 0.1 * m : 0;
    ctx.save();
    ctx.translate(ox + dx * k * sx, oy - 0.285 * m * k + drop * k); ctx.scale(sx, 1); ctx.rotate(ang);
    drawTarget(ctx, 0, 0.285 * m * k, k, { white: true, mini: o.mini, fog, pasters: [] });
    ctx.restore();
  }
}

function popperPath(ctx, P, s) {
  const aL = Math.atan2(P.cy - P.ny, -P.nh), aR = Math.atan2(P.cy - P.ny, P.nh);
  ctx.beginPath(); ctx.moveTo(-P.bh * s, 0); ctx.lineTo(-P.nh * s, -P.ny * s);
  ctx.arc(0, -P.cy * s, P.r * s, aL, aR + Math.PI * 2, false);
  ctx.lineTo(P.bh * s, 0); ctx.closePath();
}

// ángulo de caída del popper (0 = de pie, ~88° = abatido hacia atrás)
function popperFall(t) {
  if (t <= 0) return 0;
  if (t < 0.78) { const u = t / 0.78; return 88 * u * u; }
  return 88 - 7 * Math.sin(Math.PI * clamp01((t - 0.78) / 0.22));
}

// ======================================================================= RENDERER
export class StageRenderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.bufA = document.createElement('canvas'); this.bufB = document.createElement('canvas');
    this.W = 0; this.frame = 0;
    // calidad: 2 alta (PC) · 1 media (móvil) · 0 baja. Baja sola si el dispositivo no llega a ~40 fps.
    this.quality = matchMedia('(pointer: coarse)').matches ? 1 : 2;
    this.cacheItems = true; // dibuja una sola vez por escenario lo que no se mueve
    this.dtAvg = 16; this.slowSince = null; this.lastNow = 0;
    this.checkSize(true);
  }

  checkSize(force = false) {
    const q = this.quality;
    const cw = this.canvas.clientWidth || 1280, dpr = Math.min([1, 1.5, 2][q], window.devicePixelRatio || 1);
    const maxW = [960, 1280, 1920][q];
    const W = Math.round(Math.max(640, Math.min(maxW, cw * dpr)) / 16) * 16, H = (W * 9) / 16;
    if (!force && W === this.W) return;
    this.W = W; this.H = H; this.u = H / 720;
    for (const c of [this.canvas, this.bufA, this.bufB]) { c.width = W; c.height = H; }
    this.cache = new WeakMap(); this.vig = null;
  }

  // --- proyección: lx en metros laterales, y altura en metros, d distancia
  k(d) { return (F * this.H) / d; }
  P(lx, y, d) { const k = this.k(d); return { x: this.W / 2 + lx * k, y: this.H * HOR + k * CAMH - y * k, k }; }
  lat(xn, d) { return (xn * SPREAD * this.W) / this.k(d); }
  fogFn(th, d) { const t = clamp01((d - 5) / 26) * th.hazeAmt; return (c) => mix(c, th.haze, t); }

  // ------------------------------------------------------------- fondo (cacheado)
  stageCache(stage) {
    let c = this.cache.get(stage);
    if (c) return c;
    const th = THEMES[stage.theme];
    const bg = document.createElement('canvas'); bg.width = this.W; bg.height = this.H;
    const light = document.createElement('canvas'); light.width = this.W; light.height = this.H;
    const glow = document.createElement('canvas'); glow.width = this.W; glow.height = this.H;
    if (th.outdoor) this.buildOutdoor(bg.getContext('2d'), th, stage.seed);
    else this.buildIndoor(bg.getContext('2d'), th, stage.seed);
    const hasLight = this.buildLighting(light.getContext('2d'), glow.getContext('2d'), th, stage.seed);
    c = { bg, light: hasLight.dark ? light : null, glow: hasLight.glow ? glow : null };
    this.cache.set(stage, c);
    return c;
  }

  buildOutdoor(b, th, seed) {
    const { W, H } = this, r = rng(seed + 7), hy = H * HOR;
    // cielo
    let g = b.createLinearGradient(0, 0, 0, hy + 4);
    g.addColorStop(0, th.sky[0]); g.addColorStop(0.55, th.sky[1]); g.addColorStop(1, th.sky[2]);
    b.fillStyle = g; b.fillRect(0, 0, W, hy + 4);
    if (th.sun) {
      const sx = th.sun.x * W, sy = hy - H * 0.045;
      const rg = b.createRadialGradient(sx, sy, 0, sx, sy, H * 0.6);
      rg.addColorStop(0, 'rgba(255,205,140,0.55)'); rg.addColorStop(0.25, 'rgba(255,150,90,0.22)'); rg.addColorStop(1, 'rgba(255,120,60,0)');
      b.fillStyle = rg; b.fillRect(0, 0, W, hy + 4);
      b.fillStyle = th.sun.color; b.beginPath(); b.arc(sx, sy, H * 0.032, 0, Math.PI * 2); b.fill();
    }
    if (th.stars) {
      for (let i = 0; i < 220; i++) { b.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.7})`; const s = r() < 0.08 ? 1.6 : 1; b.fillRect(r() * W, r() * hy * 0.95, s * this.u, s * this.u); }
    }
    if (th.clouds) {
      const heavy = th.clouds === 'heavy';
      b.save(); b.filter = `blur(${Math.round(H * (heavy ? 0.018 : 0.012))}px)`;
      for (let i = 0; i < (heavy ? 16 : 8); i++) {
        const cx = r() * W, cy = r() * hy * 0.7, sc = (0.6 + r()) * H * 0.07;
        b.fillStyle = heavy ? `rgba(${180 + r() * 40},${185 + r() * 40},${190 + r() * 40},0.55)` : 'rgba(255,255,255,0.65)';
        for (let j = 0; j < 6; j++) { b.beginPath(); b.ellipse(cx + (r() - 0.5) * sc * 3, cy + (r() - 0.5) * sc * 0.6, sc * (0.6 + r() * 0.6), sc * (0.3 + r() * 0.25), 0, 0, Math.PI * 2); b.fill(); }
      }
      b.restore();
    }
    // colinas y arboleda lejanas (dos capas con neblina)
    for (const [layer, amt, amp] of [[0, 0.72, 0.09], [1, 0.5, 0.06]]) {
      const ph = [r() * 6, r() * 6, r() * 6];
      b.fillStyle = mix(th.berm[1], th.haze, amt);
      b.beginPath(); b.moveTo(0, hy + 2);
      for (let x = 0; x <= W; x += W / 120) {
        const n = Math.sin(x / W * 5 + ph[0]) * 0.5 + Math.sin(x / W * 13 + ph[1]) * 0.3 + Math.sin(x / W * 31 + ph[2]) * 0.2;
        const tree = layer === 1 ? Math.abs(Math.sin(x * 0.09 + ph[1])) * 0.012 : 0;
        b.lineTo(x, hy - H * (amp * (0.6 + 0.4 * n) + tree));
      }
      b.lineTo(W, hy + 2); b.closePath(); b.fill();
    }
    // focos (noche): postes al fondo
    if (th.floods) {
      for (const side of [-1, 1]) {
        const base = this.P(side * 6.8, 0, 23), top = this.P(side * 6.8, 8, 23);
        b.strokeStyle = '#11151b'; b.lineWidth = Math.max(2, 0.12 * base.k); b.beginPath(); b.moveTo(base.x, base.y); b.lineTo(top.x, top.y); b.stroke();
        b.fillStyle = '#202630'; b.fillRect(top.x - 0.7 * top.k, top.y - 0.25 * top.k, 1.4 * top.k, 0.45 * top.k);
        b.fillStyle = '#fff7da';
        for (let i = 0; i < 3; i++) b.fillRect(top.x - 0.6 * top.k + i * 0.42 * top.k, top.y - 0.18 * top.k, 0.34 * top.k, 0.3 * top.k);
      }
    }
    // talud trasero (berm)
    const D = 24, by = this.P(0, 0, D).y, kb = this.k(D);
    g = b.createLinearGradient(0, by - 3.6 * kb, 0, by);
    g.addColorStop(0, mix(th.berm[0], th.haze, 0.2)); g.addColorStop(1, mix(th.berm[1], th.haze, 0.12));
    b.fillStyle = g; b.beginPath(); b.moveTo(0, by + 2);
    const tops = [];
    for (let x = 0; x <= W; x += W / 80) { const y = by - kb * (3.1 + 0.18 * Math.sin(x * 0.013 + seed) + 0.08 * Math.sin(x * 0.051)); tops.push([x, y]); b.lineTo(x, y); }
    b.lineTo(W, by + 2); b.closePath(); b.fill();
    b.save(); b.clip(); b.globalAlpha = 0.22; b.globalCompositeOperation = 'multiply'; b.fillStyle = pat(b, 'noise'); b.fillRect(0, 0, W, H); b.restore();
    // zona de impactos (arena más clara) y hierba en la cresta
    b.fillStyle = mix(th.ground[0], th.haze, 0.25, 0.35); b.fillRect(0, by - 0.9 * kb, W, 0.9 * kb);
    b.strokeStyle = mix(th.grass, th.haze, 0.25); b.lineWidth = Math.max(1, this.u);
    for (const [x, y] of tops) for (let j = 0; j < 4; j++) { const xx = x + r() * W / 80; b.beginPath(); b.moveTo(xx, y + 2); b.lineTo(xx + (r() - 0.5) * 4 * this.u, y - (2 + r() * 6) * this.u); b.stroke(); }
    // taludes laterales en perspectiva
    for (const side of [-1, 1]) {
      const n0 = this.P(side * 5.4, 0, 4), n1 = this.P(side * 5.4, 0, D), t0 = this.P(side * 7.2, 3.4, 4), t1 = this.P(side * 6.6, 3.2, D);
      g = b.createLinearGradient(n1.x, 0, n0.x, 0);
      g.addColorStop(0, mix(th.berm[0], th.haze, 0.18)); g.addColorStop(1, shadeHex(th.berm[1], side * th.shadowX > 0 ? -0.25 : -0.05));
      b.fillStyle = g; b.beginPath(); b.moveTo(n0.x, n0.y); b.lineTo(n1.x, n1.y); b.lineTo(t1.x, t1.y); b.lineTo(t0.x, t0.y); b.closePath(); b.fill();
      b.save(); b.clip(); b.globalAlpha = 0.25; b.globalCompositeOperation = 'multiply'; b.fillStyle = pat(b, 'noise'); b.fillRect(0, 0, W, H); b.restore();
    }
    this.buildGround(b, th, r, 5.4);
  }

  buildIndoor(b, th, seed) {
    const { W, H } = this, r = rng(seed + 3), D = 22, hgt = 4.6;
    b.fillStyle = th.ceiling; b.fillRect(0, 0, W, H);
    // pared del fondo con paneles acústicos
    const bl = this.P(-5, 0, D), tr = this.P(5, hgt, D);
    let g = b.createLinearGradient(0, tr.y, 0, bl.y); g.addColorStop(0, th.wall[1]); g.addColorStop(1, th.wall[0]);
    b.fillStyle = g; b.fillRect(bl.x, tr.y, tr.x - bl.x, bl.y - tr.y);
    const pk = this.k(D);
    for (let x = -4.8; x < 4.8; x += 1.2) for (let y = 1.3; y < hgt - 0.3; y += 1.2) {
      const p = this.P(x, y + 1.05, D);
      b.fillStyle = mix(th.wall[0], '#ffffff', 0.04 + r() * 0.03); b.fillRect(p.x + 2, p.y + 2, 1.1 * pk - 4, 1.05 * pk - 4);
      b.fillStyle = 'rgba(0,0,0,0.25)'; b.fillRect(p.x + 2, p.y + 1.05 * pk - 4, 1.1 * pk - 4, 2);
    }
    // trampa de balas (caucho granulado)
    b.fillStyle = '#1b1c1f'; b.beginPath(); b.moveTo(bl.x, bl.y);
    for (let x = -5; x <= 5.01; x += 0.25) { const p = this.P(x, 1.1 + 0.15 * Math.sin(x * 2.3 + seed) , D - 0.5); b.lineTo(p.x, p.y); }
    b.lineTo(tr.x, bl.y); b.closePath(); b.fill();
    b.save(); b.clip(); b.globalAlpha = 0.35; b.fillStyle = pat(b, 'noise'); b.fillRect(0, 0, W, H); b.restore();
    // paredes laterales
    for (const side of [-1, 1]) {
      const n0 = this.P(side * 5, 0, 4), n1 = this.P(side * 5, 0, D), t1 = this.P(side * 5, hgt, D), t0 = this.P(side * 5, hgt, 4);
      g = b.createLinearGradient(n1.x, 0, n0.x, 0); g.addColorStop(0, th.wall[0]); g.addColorStop(1, shadeHex(th.wall[1], -0.35));
      b.fillStyle = g; b.beginPath(); b.moveTo(n0.x, n0.y); b.lineTo(n1.x, n1.y); b.lineTo(t1.x, t1.y); b.lineTo(t0.x, t0.y); b.closePath(); b.fill();
      b.strokeStyle = 'rgba(0,0,0,0.25)'; b.lineWidth = Math.max(1, this.u);
      for (let d = 5; d < D; d += 1.5) { const a = this.P(side * 5, 0, d), c = this.P(side * 5, hgt, d); b.beginPath(); b.moveTo(a.x, a.y); b.lineTo(c.x, c.y); b.stroke(); }
    }
    // techo: vigas y deflectores
    for (let d = 6; d <= D; d += 3) {
      const a = this.P(-5, hgt, d), c = this.P(5, hgt, d);
      b.fillStyle = '#0f1114'; b.fillRect(a.x, a.y - 0.25 * a.k, c.x - a.x, 0.25 * a.k);
      b.fillStyle = '#24282e'; b.fillRect(a.x, a.y - 0.25 * a.k, c.x - a.x, Math.max(1, 0.03 * a.k));
    }
    // lámparas
    for (let d = 8; d <= 20; d += 5) for (const x of [-2.6, 0, 2.6]) {
      const p = this.P(x, hgt - 0.3, d);
      b.fillStyle = '#2b2f35'; b.fillRect(p.x - 0.5 * p.k, p.y - 0.06 * p.k, p.k, 0.1 * p.k);
      b.fillStyle = '#fff6dc'; b.fillRect(p.x - 0.45 * p.k, p.y + 0.02 * p.k, 0.9 * p.k, 0.04 * p.k);
    }
    this.buildGround(b, th, r, 5, true);
  }

  buildGround(b, th, r, half, indoor = false) {
    const { W, H } = this, hy = H * HOR;
    const far = this.P(0, 0, 24).y;
    let g = b.createLinearGradient(0, far, 0, H);
    g.addColorStop(0, mix(th.ground[0], th.haze, th.hazeAmt * 0.6)); g.addColorStop(1, th.ground[1]);
    b.fillStyle = g;
    // suelo entre taludes/paredes
    const l0 = this.P(-half, 0, 3.5), l1 = this.P(-half, 0, 24), r1 = this.P(half, 0, 24), r0 = this.P(half, 0, 3.5);
    b.beginPath(); b.moveTo(l0.x, l0.y); b.lineTo(l1.x, l1.y); b.lineTo(r1.x, r1.y); b.lineTo(r0.x, r0.y); b.closePath(); b.fill();
    b.save(); b.clip();
    b.globalAlpha = indoor ? 0.12 : 0.3; b.globalCompositeOperation = 'multiply'; b.fillStyle = pat(b, 'noise'); b.fillRect(0, hy, W, H - hy);
    b.globalAlpha = 1; b.globalCompositeOperation = 'source-over';
    if (indoor) {
      b.strokeStyle = 'rgba(0,0,0,0.18)'; b.lineWidth = Math.max(1, this.u);
      for (let x = -5; x <= 5; x += 2.5) { const a = this.P(x, 0, 4), c = this.P(x, 0, 22); b.beginPath(); b.moveTo(a.x, a.y); b.lineTo(c.x, c.y); b.stroke(); }
      for (let d = 6; d < 22; d += 2.5) { const a = this.P(-5, 0, d), c = this.P(5, 0, d); b.beginPath(); b.moveTo(a.x, a.y); b.lineTo(c.x, c.y); b.stroke(); }
    } else {
      // grava
      for (let i = 0; i < 2600; i++) {
        const d = 4 + Math.pow(r(), 1.6) * 20, p = this.P((r() * 2 - 1) * half, 0, d), s = Math.max(0.7, 0.018 * p.k * (0.5 + r()));
        b.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.22)'; b.fillRect(p.x, p.y, s, s * 0.6);
      }
      // huellas / zona pisada
      b.fillStyle = 'rgba(0,0,0,0.06)';
      const a = this.P(-1.6, 0, 4), c = this.P(1.6, 0, 9), e = this.P(-0.8, 0, 9);
      b.beginPath(); b.moveTo(a.x, a.y); b.lineTo(e.x, e.y); b.lineTo(c.x, c.y); b.lineTo(this.P(1.6, 0, 4).x, a.y); b.closePath(); b.fill();
    }
    // vainas de latón en el suelo
    for (let i = 0; i < 26; i++) {
      const d = 4.3 + r() * 5, p = this.P((r() * 2 - 1) * 2.4, 0, d), len = 0.02 * p.k, wid = 0.009 * p.k;
      b.save(); b.translate(p.x, p.y); b.rotate(r() * Math.PI);
      b.fillStyle = '#b8913e'; b.fillRect(-len / 2, -wid / 2, len, wid); b.fillStyle = 'rgba(255,240,180,0.7)'; b.fillRect(-len / 2, -wid / 2, len, Math.max(0.5, wid * 0.35));
      b.restore();
    }
    b.restore();
    // neblina sobre el horizonte
    g = b.createLinearGradient(0, far - H * 0.12, 0, far + H * 0.08);
    g.addColorStop(0, mix(th.haze, th.haze, 0, 0)); g.addColorStop(0.6, mix(th.haze, th.haze, 0, th.hazeAmt * 0.35)); g.addColorStop(1, mix(th.haze, th.haze, 0, 0));
    b.fillStyle = g; b.fillRect(0, far - H * 0.12, W, H * 0.2);
  }

  // luz/sombra global por tema (dark = capa de oscuridad, glow = capa aditiva)
  buildLighting(L, G, th, seed) {
    const { W, H } = this; let dark = false, glow = false;
    if (th.floods) {
      L.fillStyle = 'rgba(2,5,14,0.5)'; L.fillRect(0, 0, W, H);
      L.globalCompositeOperation = 'destination-out';
      for (const [x, y, rx, a] of [[0.5, 0.64, 0.55, 0.9], [0.3, 0.6, 0.35, 0.5], [0.7, 0.6, 0.35, 0.5]]) {
        L.save(); L.translate(W * x, H * y); L.scale(1, 0.55);
        const rg = L.createRadialGradient(0, 0, 0, 0, 0, W * rx); rg.addColorStop(0, `rgba(0,0,0,${a})`); rg.addColorStop(1, 'rgba(0,0,0,0)');
        L.fillStyle = rg; L.beginPath(); L.arc(0, 0, W * rx, 0, Math.PI * 2); L.fill(); L.restore();
      }
      L.globalCompositeOperation = 'source-over'; dark = true;
      for (const side of [-1, 1]) {
        const top = this.P(side * 6.8, 8, 23);
        const rg = G.createRadialGradient(top.x, top.y, 0, top.x, top.y, H * 0.25); rg.addColorStop(0, 'rgba(255,240,200,0.55)'); rg.addColorStop(1, 'rgba(255,220,160,0)');
        G.fillStyle = rg; G.fillRect(0, 0, W, H);
        G.fillStyle = 'rgba(255,235,190,0.05)'; G.beginPath(); G.moveTo(top.x, top.y); G.lineTo(W * 0.5 - side * W * 0.05, H); G.lineTo(W * 0.5 + side * W * 0.3, H); G.closePath(); G.fill();
      }
      glow = true;
    } else if (!th.outdoor) {
      L.fillStyle = 'rgba(0,0,0,0.22)'; L.fillRect(0, 0, W, H);
      const vg = L.createRadialGradient(W / 2, H * 0.62, H * 0.2, W / 2, H * 0.62, W * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)'); L.fillStyle = vg; L.fillRect(0, 0, W, H); dark = true;
      for (let d = 8; d <= 20; d += 5) for (const x of [-2.6, 0, 2.6]) {
        const p = this.P(x, 4.3, d), f = this.P(x, 0, d);
        const lg = G.createLinearGradient(0, p.y, 0, f.y); lg.addColorStop(0, 'rgba(255,244,220,0.10)'); lg.addColorStop(1, 'rgba(255,244,220,0)');
        G.fillStyle = lg; G.beginPath(); G.moveTo(p.x - 0.4 * p.k, p.y); G.lineTo(p.x + 0.4 * p.k, p.y); G.lineTo(f.x + 1.3 * f.k, f.y); G.lineTo(f.x - 1.3 * f.k, f.y); G.closePath(); G.fill();
        const rg = G.createRadialGradient(f.x, f.y, 0, f.x, f.y, 1.2 * f.k); rg.addColorStop(0, 'rgba(255,240,210,0.07)'); rg.addColorStop(1, 'rgba(255,240,210,0)');
        G.save(); G.translate(0, 0); G.fillStyle = rg; G.fillRect(f.x - 1.2 * f.k, f.y - 1.2 * f.k, 2.4 * f.k, 2.4 * f.k); G.restore();
      }
      glow = true;
    } else if (th.warm) {
      const lg = G.createLinearGradient(W, 0, 0, H); lg.addColorStop(0, th.warm); lg.addColorStop(1, 'rgba(255,150,80,0)');
      G.fillStyle = lg; G.fillRect(0, 0, W, H); glow = true;
    } else if (th.clouds === 'heavy') { L.fillStyle = 'rgba(40,45,50,0.08)'; L.fillRect(0, 0, W, H); dark = true; }
    return { dark, glow };
  }

  // ------------------------------------------------------------- objetos
  shadow(ctx, th, x, y, rx, ry) {
    const [r, g, b, a] = th.shadow;
    const sx = x + th.shadowX * rx * 0.6;
    const rg = ctx.createRadialGradient(sx, y, 0, sx, y, rx);
    rg.addColorStop(0, `rgba(${r},${g},${b},${a})`); rg.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.save(); ctx.translate(sx, y); ctx.scale(1, ry / rx); ctx.translate(-sx, -y);
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(sx, y, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  stand(ctx, ox, gy, ty, k, fog) {
    ctx.fillStyle = fog('#9d7a50');
    for (const dx of [-0.085, 0.085]) ctx.fillRect(ox + dx * k - 0.0125 * k, ty, 0.025 * k, gy - ty);
    ctx.fillStyle = fog('#3a3631'); ctx.fillRect(ox - 0.2 * k, gy - 0.06 * k, 0.4 * k, 0.06 * k);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(ox - 0.2 * k, gy - 0.06 * k, 0.4 * k, Math.max(1, 0.01 * k));
  }

  paperItem(ctx, it, th) {
    const lx = this.lat(it.x, it.d), g = this.P(lx, 0, it.d), k = g.k, fog = this.fogFn(th, it.d);
    const st = styleOf(it), m = it.mini ? 2 / 3 : 1, base = 0.6;
    this.shadow(ctx, th, g.x, g.y, (st.kind === 'ns-tilt' ? 0.55 : 0.45) * k, 0.07 * k);
    if (st.kind === 'ns-side') {
      // no-shoot en su propio soporte, por delante y desplazado
      const nd = it.d - 0.15, nl = lx + (st.ns?.side || 1) * 0.26, ng = this.P(nl, 0, nd);
      this.stand(ctx, g.x, g.y, g.y - base * k, k, fog);
      drawTarget(ctx, g.x, g.y - base * k, k, { mini: it.mini, hard: st.hard, pasters: it.pasters, fog });
      this.shadow(ctx, th, ng.x, ng.y, 0.4 * ng.k, 0.06 * ng.k);
      this.stand(ctx, ng.x, ng.y, ng.y - (base - 0.04) * ng.k, ng.k, this.fogFn(th, nd));
      drawTarget(ctx, ng.x, ng.y - (base - 0.03) * ng.k, ng.k, { white: true, mini: it.mini, fog: this.fogFn(th, nd), pasters: [] });
      return;
    }
    const top = base + (DOUBLE_OFFSET[st.kind] || 0) * m; // en las dobles los listones llegan a la tarjeta de atrás
    this.stand(ctx, g.x, g.y, g.y - top * k, k, fog);
    drawStyledTarget(ctx, g.x, g.y - base * k, k, st, { mini: it.mini, fog, pasters: it.pasters, pasters2: it.pasters2 });
  }

  popperItem(ctx, it, th, stage, now) {
    const lx = this.lat(it.x, it.d), g = this.P(lx, 0, it.d), k = g.k, fog = this.fogFn(th, it.d);
    const P = it.mini ? POP.mini : POP.full, s = k / 100;
    const t = it.activator ? actClock(stage, now) : -1;
    const fall = t < 0 ? 0 : clamp01((t - ACT.fallStart) / ACT.fallDur);
    const ang = (popperFall(fall) * Math.PI) / 180;
    this.shadow(ctx, th, g.x, g.y, 0.42 * k, 0.07 * k);
    // base con bisagra
    const bw = (it.mini ? 0.32 : 0.42) * k;
    ctx.fillStyle = fog('#2e3237'); ctx.fillRect(g.x - bw / 2, g.y - 0.07 * k, bw, 0.07 * k);
    ctx.fillStyle = fog('#5d646c'); ctx.fillRect(g.x - bw / 2, g.y - 0.07 * k, bw, Math.max(1, 0.012 * k));
    ctx.fillStyle = fog('#1d2024'); ctx.fillRect(g.x - P.bh * s * 1.3, g.y - 0.1 * k, P.bh * s * 2.6, 0.035 * k);
    const hx = g.x, hy = g.y - 0.085 * k;
    ctx.save(); ctx.translate(hx, hy); ctx.scale(1, Math.max(0.03, Math.cos(ang)));
    // canto (espesor de la chapa)
    ctx.save(); ctx.translate(Math.max(1, 0.012 * k), Math.max(1, 0.006 * k)); popperPath(ctx, P, s); ctx.fillStyle = fog('#7f858c'); ctx.fill(); ctx.restore();
    popperPath(ctx, P, s);
    const pg = ctx.createLinearGradient(-P.r * s, -P.h * s, P.r * s, 0);
    const paint = it.activator ? '#f1f0ea' : '#e9e7df';
    pg.addColorStop(0, fog(paint)); pg.addColorStop(1, fog(shadeHex(paint, -0.12 - ang * 0.25)));
    ctx.fillStyle = pg; ctx.fill();
    ctx.save(); ctx.clip();
    const r = rng(it.seed || 5);
    for (let i = 0; i < 26; i++) { // salpicaduras de plomo
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * P.r * 0.95;
      ctx.fillStyle = `rgba(95,98,104,${0.18 + r() * 0.3})`;
      ctx.beginPath(); ctx.ellipse(Math.cos(a) * rr * s, (-P.cy + Math.sin(a) * rr) * s, (0.3 + r()) * s, (0.3 + r() * 0.8) * s, a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 0.12; ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = pat(ctx, 'noise'); ctx.fillRect(-P.r * s, -P.h * s, P.r * 2 * s, P.h * s);
    ctx.restore();
    popperPath(ctx, P, s); ctx.lineWidth = Math.max(0.7, 0.25 * s); ctx.strokeStyle = 'rgba(30,32,36,0.45)'; ctx.stroke();
    ctx.restore();
    // polvo al caer
    if (fall > 0.7) {
      const p = clamp01((fall - 0.7) / 0.3), rr = rng(it.seed + 1);
      for (let i = 0; i < 10; i++) {
        const dx = (rr() - 0.5) * 0.8 * k * (0.4 + p), dy = -rr() * 0.12 * k * p;
        ctx.fillStyle = `rgba(200,180,150,${0.25 * (1 - p)})`; ctx.beginPath(); ctx.arc(g.x + dx, g.y + dy, (0.03 + 0.05 * p) * k, 0, Math.PI * 2); ctx.fill();
      }
    }
    it._screen = { hx, hy, s, P, ang };
  }

  plateItem(ctx, it, th) {
    const lx = this.lat(it.x, it.d), g = this.P(lx, 0, it.d), k = g.k, fog = this.fogFn(th, it.d);
    this.shadow(ctx, th, g.x, g.y, 0.25 * k, 0.05 * k);
    ctx.fillStyle = fog('#2f3338'); ctx.fillRect(g.x - 0.02 * k, g.y - 0.92 * k, 0.04 * k, 0.92 * k);
    ctx.fillRect(g.x - 0.18 * k, g.y - 0.03 * k, 0.36 * k, 0.03 * k);
    const c = this.P(lx, 1.02, it.d);
    ctx.fillStyle = fog('#6c727a'); ctx.beginPath(); ctx.arc(c.x + 0.008 * k, c.y + 0.005 * k, 0.1 * k, 0, Math.PI * 2); ctx.fill();
    const rg = ctx.createRadialGradient(c.x - 0.03 * k, c.y - 0.03 * k, 0, c.x, c.y, 0.1 * k);
    rg.addColorStop(0, fog('#ffffff')); rg.addColorStop(1, fog('#d9d7cf'));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(c.x, c.y, 0.1 * k, 0, Math.PI * 2); ctx.fill();
    it._screen = { cx: c.x, cy: c.y, r: 0.1 * k };
  }

  // barrera visual (pared de escenario)
  wall(ctx, th, lx, d, w, h, style, seed) {
    const fog = this.fogFn(th, d), a = this.P(lx - w / 2, 0, d), b = this.P(lx + w / 2, h, d), k = a.k;
    const x0 = a.x, x1 = b.x, y0 = b.y, y1 = a.y;
    this.shadow(ctx, th, (x0 + x1) / 2, y1, (x1 - x0) * 0.6, 0.12 * k);
    // canto lateral visible (hacia el centro)
    const depth = 0.09, sideX = lx > 0 ? lx - w / 2 : lx + w / 2, sa = this.P(sideX, 0, d + depth), sb = this.P(sideX, h, d + depth), fx = lx > 0 ? x0 : x1;
    ctx.fillStyle = fog('#6e5536'); ctx.beginPath(); ctx.moveTo(fx, y1); ctx.lineTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.lineTo(fx, y0); ctx.closePath(); ctx.fill();
    // panel
    const r = rng(seed || 1);
    if (style === 'banner' && w < 1.2) style = 'ply'; // el cartel solo en paredes anchas
    if (style === 'mesh') {
      ctx.fillStyle = fog('#1d2327'); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = pat(ctx, 'mesh'); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      const gg = ctx.createLinearGradient(x0, 0, x1, 0); gg.addColorStop(0, 'rgba(255,255,255,0.05)'); gg.addColorStop(1, 'rgba(0,0,0,0.15)');
      ctx.fillStyle = gg; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    } else {
      const base = style === 'banner' ? '#e9e6de' : ['#b9ad95', '#a4ad9a', '#c2b59b'][Math.floor(r() * 3)];
      const gg = ctx.createLinearGradient(0, y0, 0, y1); gg.addColorStop(0, fog(shadeHex(base, 0.06))); gg.addColorStop(1, fog(shadeHex(base, -0.1)));
      ctx.fillStyle = gg; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
      ctx.globalAlpha = 0.16; ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = pat(ctx, 'noise'); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      if (style === 'ply') {
        ctx.strokeStyle = 'rgba(80,60,30,0.18)'; ctx.lineWidth = Math.max(1, 0.006 * k);
        for (let x = 1.22; x < w; x += 1.22) { const p = this.P(lx - w / 2 + x, 0, d); ctx.beginPath(); ctx.moveTo(p.x, y0); ctx.lineTo(p.x, y1); ctx.stroke(); }
        ctx.fillStyle = 'rgba(60,50,40,0.35)';
        for (let i = 0; i < 10; i++) ctx.fillRect(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), Math.max(1, 0.008 * k), Math.max(1, 0.008 * k));
      } else if (style === 'banner') {
        const by = y0 + (y1 - y0) * 0.32, bh = (y1 - y0) * 0.2;
        ctx.fillStyle = fog('#141820'); ctx.fillRect(x0, by, x1 - x0, bh);
        ctx.fillStyle = fog('#c6f03a'); ctx.fillRect(x0, by + bh - Math.max(2, bh * 0.08), x1 - x0, Math.max(2, bh * 0.08));
        ctx.fillStyle = fog('#ffffff'); ctx.font = `700 ${bh * 0.55}px Rajdhani, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('IPSC TRACK', (x0 + x1) / 2, by + bh * 0.48);
      }
      ctx.restore();
    }
    // bastidor de madera 2×4
    const fw = Math.max(2, 0.07 * k), wood = fog('#9b7a4f'), woodD = fog('#7b5f3c');
    ctx.fillStyle = wood; ctx.fillRect(x0, y0, fw, y1 - y0); ctx.fillRect(x1 - fw, y0, fw, y1 - y0); ctx.fillRect(x0, y0, x1 - x0, fw);
    ctx.fillStyle = woodD; ctx.fillRect(x0, y1 - fw * 0.9, x1 - x0, fw * 0.9);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x0, y0, x1 - x0, Math.max(1, fw * 0.2));
    // sacos terreros en los pies
    for (const fx2 of [x0 + fw, x1 - fw]) {
      ctx.fillStyle = fog('#8c7d5c'); roundRect(ctx, fx2 - 0.18 * k, y1 - 0.12 * k, 0.36 * k, 0.13 * k, 0.05 * k); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(fx2 - 0.16 * k, y1 - 0.02 * k, 0.32 * k, 0.02 * k);
    }
  }

  barrel(ctx, it, th) {
    const lx = this.lat(it.x, it.d), g = this.P(lx, 0, it.d), k = g.k, fog = this.fogFn(th, it.d);
    const w = 0.58 * k, h = 0.88 * k, x0 = g.x - w / 2, y0 = g.y - h;
    this.shadow(ctx, th, g.x, g.y, 0.5 * k, 0.08 * k);
    const c = it.color || '#2f5f9e';
    const gr = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    gr.addColorStop(0, fog(shadeHex(c, -0.45))); gr.addColorStop(0.35, fog(shadeHex(c, 0.18))); gr.addColorStop(0.7, fog(c)); gr.addColorStop(1, fog(shadeHex(c, -0.5)));
    ctx.fillStyle = gr; roundRect(ctx, x0, y0, w, h, 0.05 * k); ctx.fill();
    for (const hh of [0.3, 0.6]) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x0, g.y - hh * k - 0.02 * k, w, 0.03 * k); ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x0, g.y - hh * k + 0.01 * k, w, 0.012 * k); }
    ctx.fillStyle = fog(shadeHex(c, 0.1)); ctx.beginPath(); ctx.ellipse(g.x, y0 + 0.01 * k, w / 2, w * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fog(shadeHex(c, -0.25)); ctx.beginPath(); ctx.ellipse(g.x - w * 0.22, y0 + 0.01 * k, w * 0.06, w * 0.025, 0, 0, Math.PI * 2); ctx.fill();
  }

  tires(ctx, it, th) {
    const lx = this.lat(it.x, it.d), g = this.P(lx, 0, it.d), k = g.k, fog = this.fogFn(th, it.d);
    this.shadow(ctx, th, g.x, g.y, 0.55 * k, 0.08 * k);
    for (let i = 0; i < it.n; i++) {
      const y = g.y - i * 0.21 * k, w = 0.66 * k;
      ctx.fillStyle = fog('#1b1c1e'); roundRect(ctx, g.x - w / 2, y - 0.21 * k, w, 0.21 * k, 0.08 * k); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = Math.max(1, 0.01 * k);
      for (let j = 1; j < 8; j++) { const x = g.x - w / 2 + (j * w) / 8; ctx.beginPath(); ctx.moveTo(x, y - 0.18 * k); ctx.lineTo(x - 0.02 * k, y - 0.03 * k); ctx.stroke(); }
    }
    const top = g.y - it.n * 0.21 * k;
    ctx.fillStyle = fog('#2a2b2e'); ctx.beginPath(); ctx.ellipse(g.x, top, 0.33 * k, 0.06 * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0d0d0e'; ctx.beginPath(); ctx.ellipse(g.x, top, 0.18 * k, 0.03 * k, 0, 0, Math.PI * 2); ctx.fill();
  }

  cone(ctx, it, th) {
    const lx = this.lat(it.x, it.d), g = this.P(lx, 0, it.d), k = g.k, fog = this.fogFn(th, it.d);
    this.shadow(ctx, th, g.x, g.y, 0.3 * k, 0.05 * k);
    ctx.fillStyle = fog('#d4501f'); ctx.fillRect(g.x - 0.18 * k, g.y - 0.03 * k, 0.36 * k, 0.03 * k);
    ctx.beginPath(); ctx.moveTo(g.x - 0.13 * k, g.y - 0.03 * k); ctx.lineTo(g.x - 0.025 * k, g.y - 0.5 * k); ctx.lineTo(g.x + 0.025 * k, g.y - 0.5 * k); ctx.lineTo(g.x + 0.13 * k, g.y - 0.03 * k); ctx.closePath();
    const cg = ctx.createLinearGradient(g.x - 0.13 * k, 0, g.x + 0.13 * k, 0); cg.addColorStop(0, fog('#ff7a3a')); cg.addColorStop(1, fog('#b9431b'));
    ctx.fillStyle = cg; ctx.fill();
    ctx.fillStyle = fog('#f2f2f2'); ctx.fillRect(g.x - 0.075 * k, g.y - 0.3 * k, 0.15 * k, 0.06 * k);
  }

  // ------------------------------------------------------------- móviles
  moverItem(ctx, it, th, stage, now) {
    const t = stage.actStart != null && stage.act ? actClock(stage, now) - ACT.moverStart : -1;
    const lx = this.lat(it.x, it.d), d = it.d, fog = this.fogFn(th, d), fogB = this.fogFn(th, d + 0.3);
    const steel = (f) => f('#3a3f45');
    const ts = it.tstyle?.kind ? it.tstyle : { kind: 'normal', ns: null, hard: null }, stack = stackHeight(ts);
    const ns = it.fixedNS; // no-shoot fijo delante del recorrido
    if (it.mtype === 'swinger') {
      const s = it.side; // la oscilación sale hacia el centro
      const wallC = lx - s * 0.6, pivotX = lx + s * 0.55, pivotH = 2.35, L = 0.72;
      // bastidor del balancín
      const pa = this.P(pivotX - 0.32, 0, d + 0.4), pb = this.P(pivotX + 0.32, 2.5, d + 0.4), pk = pa.k;
      ctx.fillStyle = steel(this.fogFn(th, d + 0.4));
      ctx.fillRect(pa.x - 0.025 * pk, pb.y, 0.05 * pk, pa.y - pb.y); ctx.fillRect(pb.x - 0.025 * pk, pb.y, 0.05 * pk, pa.y - pb.y); ctx.fillRect(pa.x, pb.y, pb.x - pa.x, 0.05 * pk);
      const th0 = s * 1.08; // ~62° retenido detrás de la pared
      const theta = t < 0 ? th0 : th0 * Math.exp(-t / 2200) * Math.cos((2 * Math.PI * t) / 1700);
      const pv = this.P(pivotX, pivotH, d + 0.3), k = pv.k;
      ctx.save(); ctx.translate(pv.x, pv.y); ctx.rotate(theta);
      ctx.fillStyle = steel(fogB); ctx.fillRect(-0.02 * k, 0, 0.04 * k, (L + 0.05) * k);
      ctx.fillRect(-0.12 * k, L * k, 0.24 * k, 0.03 * k);
      drawStyledTarget(ctx, 0, (L + 0.03 + stack) * k, k, ts, { fog: fogB });
      ctx.restore();
      ctx.fillStyle = '#16191c'; ctx.beginPath(); ctx.arc(pv.x, pv.y, 0.035 * k, 0, Math.PI * 2); ctx.fill();
      if (ns) this.fixedNoShoot(ctx, th, pivotX + ns.dx, d + 0.15, pivotH - (L + 0.03 + stack / 2), ns.angle);
      this.wall(ctx, th, wallC, d, 1.35, 2.15, it.style, it.seed);
    } else if (it.mtype === 'drop') {
      const pivotH = 2.6, L = 0.66;
      let theta, sx;
      if (t < 0) { theta = Math.PI * 0.86; sx = 0.04; }
      else if (t < 650) { const u = t / 650; theta = Math.PI * 0.86 * (1 - u * u); sx = 0.04 + 0.96 * smooth(300, 800, t); }
      else if (t < 1000) { theta = -0.14 * Math.sin(Math.PI * (t - 650) / 350) * (1 - (t - 650) / 350); sx = smooth(300, 800, t); }
      else { theta = 0; sx = t < 2600 ? 1 : Math.max(0.04, 1 - (t - 2600) / 350); }
      const pv = this.P(lx, pivotH, d + 0.3), k = pv.k;
      ctx.save(); ctx.translate(pv.x, pv.y); ctx.rotate(theta);
      ctx.fillStyle = steel(fogB); ctx.fillRect(-0.02 * k, 0, 0.04 * k, (L + 0.05) * k);
      drawStyledTarget(ctx, 0, (L + 0.03 + stack) * k, k, ts, { fog: fogB, sx });
      ctx.restore();
      if (ns) this.fixedNoShoot(ctx, th, lx + ns.dx, d + 0.15, pivotH - (L + 0.03 + stack / 2), ns.angle);
      // pórtico: dos paredes + dintel
      this.wall(ctx, th, lx - 0.85, d, 0.7, 2.2, it.style, it.seed);
      this.wall(ctx, th, lx + 0.85, d, 0.7, 2.2, it.style, it.seed + 1);
      const la = this.P(lx - 1.2, 1.97, d), lb = this.P(lx + 1.2, 3.6, d), kk = la.k;
      const lg = ctx.createLinearGradient(0, lb.y, 0, la.y); lg.addColorStop(0, fog('#5b4a34')); lg.addColorStop(1, fog('#7a6244'));
      ctx.fillStyle = lg; ctx.fillRect(la.x, lb.y, lb.x - la.x, la.y - lb.y);
      ctx.fillStyle = fog('#9b7a4f'); ctx.fillRect(la.x, la.y - 0.07 * kk, lb.x - la.x, 0.07 * kk);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(la.x, la.y, lb.x - la.x, Math.max(2, 0.04 * kk));
    } else if (it.mtype === 'slider') {
      const dir = it.dir, travel = 0.95;
      const u = t < 0 ? 0 : easeInOut(clamp01(t / MOVER_DUR.slider));
      const pos = -dir * travel + dir * 2 * travel * u;
      // carriles
      const ra = this.P(lx - 1.1, 0, d + 0.3), rb = this.P(lx + 1.1, 0, d + 0.3), rk = ra.k;
      ctx.fillStyle = steel(fogB); ctx.fillRect(ra.x, ra.y - 0.04 * rk, rb.x - ra.x, 0.03 * rk); ctx.fillRect(ra.x, ra.y - 0.01 * rk, rb.x - ra.x, 0.015 * rk);
      const cg = this.P(lx + pos, 0, d + 0.3), k = cg.k;
      const vel = t >= 0 && t < MOVER_DUR.slider ? Math.sin(Math.PI * clamp01(t / MOVER_DUR.slider)) : 0;
      ctx.fillStyle = fogB('#2a2e33'); ctx.fillRect(cg.x - 0.22 * k, cg.y - 0.13 * k, 0.44 * k, 0.1 * k);
      ctx.fillStyle = '#101214'; for (const dx of [-0.15, 0.15]) { ctx.beginPath(); ctx.arc(cg.x + dx * k, cg.y - 0.03 * k, 0.035 * k, 0, Math.PI * 2); ctx.fill(); }
      ctx.save(); ctx.translate(cg.x, cg.y - 0.13 * k); ctx.rotate(-dir * vel * 0.03);
      this.stand(ctx, 0, 0, -(0.5 + stack - 0.57) * k, k, fogB);
      drawStyledTarget(ctx, 0, -0.5 * k, k, ts, { fog: fogB });
      ctx.restore();
      if (ns) this.fixedNoShoot(ctx, th, lx + ns.dx, d + 0.15, 0.63 + stack / 2, ns.angle);
      this.wall(ctx, th, lx - 0.95, d, 0.85, 2.1, it.style, it.seed);
      this.wall(ctx, th, lx + 0.95, d, 0.85, 2.1, it.style, it.seed + 1);
    } else if (it.mtype === 'bobber') {
      let up = 0;
      if (t >= 0) {
        const c = t % 2100;
        if (t < 4200) up = c < 350 ? easeOutBack(c / 350) : c < 1350 ? 1 : c < 1650 ? 1 - Math.pow((c - 1350) / 300, 2) : 0;
      }
      const tg = this.P(lx, 0, d + 0.25), k = tg.k;
      // guías verticales
      ctx.fillStyle = steel(this.fogFn(th, d + 0.3));
      for (const dx of [-0.3, 0.3]) { const a = this.P(lx + dx, 0, d + 0.3), b = this.P(lx + dx, 1.9, d + 0.3); ctx.fillRect(a.x - 0.02 * a.k, b.y, 0.04 * a.k, a.y - b.y); }
      const bottomH = 1.08 - stack + up * (stack + 0.05); // en reposo queda entero detrás de la barricada
      drawStyledTarget(ctx, tg.x, tg.y - bottomH * k, k, ts, { fog: this.fogFn(th, d + 0.25) });
      if (ns) this.fixedNoShoot(ctx, th, lx + ns.dx, d + 0.12, 1.13 + stack / 2, ns.angle);
      // barricada baja con sacos
      this.wall(ctx, th, lx, d, 1.6, 1.1, 'ply', it.seed);
      const r = rng(it.seed + 9);
      for (let i = 0; i < 4; i++) {
        const p = this.P(lx - 0.6 + i * 0.4, 1.1, d - 0.02), kk = p.k;
        ctx.fillStyle = fog(['#8f8060', '#857655', '#998a68'][Math.floor(r() * 3)]); roundRect(ctx, p.x - 0.22 * kk, p.y - 0.13 * kk, 0.44 * kk, 0.15 * kk, 0.06 * kk); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(p.x - 0.2 * kk, p.y - 0.02 * kk, 0.4 * kk, 0.02 * kk);
      }
    }
  }

  // no-shoot fijo sobre dos postes, delante del recorrido del móvil
  fixedNoShoot(ctx, th, lx, d, centerH, angle = 0) {
    const fogN = this.fogFn(th, d), k = this.k(d), bottomH = centerH - 0.285;
    ctx.fillStyle = fogN('#3a3f45');
    for (const dx of [-0.09, 0.09]) {
      const a = this.P(lx + dx, 0, d), b = this.P(lx + dx, bottomH + 0.12, d);
      ctx.fillRect(a.x - 0.012 * k, b.y, 0.024 * k, a.y - b.y);
    }
    const c = this.P(lx, centerH, d);
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(((Number(angle) || 0) * Math.PI) / 180);
    drawTarget(ctx, 0, 0.285 * k, k, { white: true, fog: fogN, pasters: [] });
    ctx.restore();
  }

  moverAnchor(it) {
    const lx = this.lat(it.x, it.d);
    const off = it.mtype === 'swinger' ? it.side * 0.55 : it.mtype === 'drop' ? -0.85 : it.mtype === 'slider' ? -it.dir * 1.1 : 0.6;
    return { lx: lx + off, d: it.d + 0.35 };
  }

  // cable del activador (por el suelo, del popper al móvil)
  cable(ctx, stage, th) {
    const p = stage.popper, m = stage.mover; if (!p || !m) return null;
    const a = { lx: this.lat(p.x, p.d), d: p.d + 0.12 }, b = this.moverAnchor(m);
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28, lx = a.lx + (b.lx - a.lx) * t + Math.sin(t * Math.PI) * 0.25, d = a.d + (b.d - a.d) * t;
      pts.push(this.P(lx, 0.005, d));
    }
    ctx.strokeStyle = this.fogFn(th, (a.d + b.d) / 2)('#202326'); ctx.lineWidth = Math.max(1, 0.006 * pts[0].k);
    ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke();
    return pts;
  }

  item(ctx, it, th, stage, now) {
    switch (it.type) {
      case 'paper': return this.paperItem(ctx, it, th);
      case 'popper': return this.popperItem(ctx, it, th, stage, now);
      case 'plate': return this.plateItem(ctx, it, th);
      case 'wall': return this.wall(ctx, th, this.lat(it.x, it.d), it.d, it.w, it.h, it.style, it.seed);
      case 'barrel': return this.barrel(ctx, it, th);
      case 'tires': return this.tires(ctx, it, th);
      case 'cone': return this.cone(ctx, it, th);
      case 'mover': return this.moverItem(ctx, it, th, stage, now);
    }
  }

  faultLine(ctx) {
    const a = this.P(-2.6, 0, 5.45), b = this.P(2.6, 0.05, 5.45), c = this.P(-2.6, 0.05, 5.6), k = a.k;
    ctx.fillStyle = '#7d1f19'; ctx.fillRect(a.x, c.y, b.x - a.x, b.y - c.y + 1);
    const g = ctx.createLinearGradient(0, b.y, 0, a.y); g.addColorStop(0, '#d0392d'); g.addColorStop(1, '#8f251d');
    ctx.fillStyle = g; ctx.fillRect(a.x, b.y, b.x - a.x, a.y - b.y);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(a.x, b.y, b.x - a.x, Math.max(1, 0.008 * k));
  }

  // --- efectos de activación (encima de la iluminación para que brillen)
  effects(ctx, stage, now, cablePts) {
    if (stage.actStart == null || !stage.popper?._screen) return;
    const t = actClock(stage, now), sc = stage.popper._screen, P = sc.P, s = sc.s, u = this.u;
    const cx = sc.hx, cy = sc.hy - P.cy * s * Math.cos(sc.ang), R = P.r * s;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    // anillos que convergen
    for (let i = 0; i < 3; i++) {
      const p = (t - ACT.ringStart - i * ACT.ringGap) / ACT.ringDur;
      if (p <= 0 || p >= 1) continue;
      const rr = R * (1.08 + 4.6 * Math.pow(1 - p, 1.7));
      const a = 0.34 * Math.pow(Math.sin(Math.PI * p), 1.3);
      ctx.strokeStyle = `rgba(170,236,255,${a})`; ctx.lineWidth = (0.8 + 1.4 * p) * u;
      ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.98, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(120,210,255,${a * 0.25})`; ctx.lineWidth = (4 + 6 * p) * u;
      ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.98, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // partículas en espiral
    const pp = clamp01(t / (ACT.ringDur + 2 * ACT.ringGap));
    if (pp > 0 && pp < 1) {
      const r = rng(stage.seed + 3);
      for (let i = 0; i < 16; i++) {
        const a0 = r() * Math.PI * 2, delay = r() * 0.35, q = clamp01((pp - delay) / (1 - delay));
        if (q <= 0 || q >= 1) continue;
        const rad = R * (1.1 + 4.2 * Math.pow(1 - q, 1.4)), ang = a0 + (1 - q) * 1.4;
        ctx.fillStyle = `rgba(200,245,255,${0.5 * Math.sin(Math.PI * q)})`;
        ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, (0.9 + q) * u, 0, Math.PI * 2); ctx.fill();
      }
    }
    // brillo del objetivo
    const glow = smooth(ACT.glowStart, ACT.glowPeak, t) * (1 - smooth(ACT.fallStart + 120, ACT.fallStart + ACT.fallDur, t));
    if (glow > 0.01) {
      ctx.save(); ctx.translate(sc.hx, sc.hy); ctx.scale(1, Math.max(0.03, Math.cos(sc.ang)));
      popperPath(ctx, P, s);
      ctx.shadowColor = `rgba(160,235,255,${0.9 * glow})`; ctx.shadowBlur = 22 * u * glow;
      ctx.strokeStyle = `rgba(215,250,255,${0.85 * glow})`; ctx.lineWidth = 1.6 * u; ctx.stroke();
      ctx.shadowBlur = 0; ctx.fillStyle = `rgba(150,225,255,${0.16 * glow})`; ctx.fill();
      ctx.restore();
      const flash = Math.exp(-Math.pow((t - ACT.glowPeak) / 140, 2));
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 3.2);
      rg.addColorStop(0, `rgba(210,248,255,${0.32 * flash})`); rg.addColorStop(1, 'rgba(210,248,255,0)');
      ctx.fillStyle = rg; ctx.fillRect(cx - R * 3.2, cy - R * 3.2, R * 6.4, R * 6.4);
    }
    // impulso por el cable hacia el móvil
    if (cablePts && t > ACT.cableStart && t < ACT.cableStart + ACT.cableDur + 200) {
      const q = clamp01((t - ACT.cableStart) / ACT.cableDur), n = cablePts.length - 1;
      for (let j = 0; j < 7; j++) {
        const qq = q - j * 0.035; if (qq < 0 || qq > 1) continue;
        const f = qq * n, i0 = Math.floor(f), i1 = Math.min(n, i0 + 1), fr = f - i0;
        const x = cablePts[i0].x + (cablePts[i1].x - cablePts[i0].x) * fr, y = cablePts[i0].y + (cablePts[i1].y - cablePts[i0].y) * fr;
        const a = (1 - j / 7) * 0.55 * (1 - smooth(0.85, 1.05, q));
        ctx.fillStyle = `rgba(170,236,255,${a})`; ctx.beginPath(); ctx.arc(x, y, (2.4 - j * 0.25) * u, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // Agrupa en capas (canvas) los elementos que no se mueven, respetando el orden de profundidad.
  // Solo el popper activador y el móvil se redibujan en cada fotograma.
  buildParts(stage, th, c) {
    const { W, H } = this, parts = [];
    const dyn = new Set(stage.act ? [stage.popper, stage.mover].filter(Boolean) : []);
    const layer = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; return { canvas: cv, ctx: cv.getContext('2d') }; };
    // la primera capa incluye el fondo; la última, la capa de oscuridad/luz (menos imágenes a pantalla completa por fotograma)
    let cur = layer();
    cur.ctx.drawImage(c.bg, 0, 0); c.baseMerged = true;
    c.cablePts = this.cable(cur.ctx, stage, th);
    for (const it of stage.sorted) {
      if (dyn.has(it)) { if (cur) parts.push(cur); parts.push({ item: it }); cur = null; }
      else { cur ??= layer(); this.item(cur.ctx, it, th, stage, 0); }
    }
    cur ??= layer();
    this.faultLine(cur.ctx);
    if (c.light) { cur.ctx.drawImage(c.light, 0, 0); c.lightMerged = true; }
    parts.push(cur);
    return parts;
  }

  drawStage(ctx, stage, now) {
    const th = THEMES[stage.theme], c = this.stageCache(stage);
    if (this.cacheItems) c.parts ??= this.buildParts(stage, th, c);
    const cached = this.cacheItems && c.parts;
    if (!cached || !c.baseMerged) ctx.drawImage(c.bg, 0, 0);
    let pts;
    if (cached) {
      for (const part of c.parts) {
        if (part.canvas) ctx.drawImage(part.canvas, 0, 0);
        else this.item(ctx, part.item, th, stage, now);
      }
      pts = c.cablePts;
    } else {
      pts = this.cable(ctx, stage, th);
      for (const it of stage.sorted) this.item(ctx, it, th, stage, now);
      this.faultLine(ctx);
    }
    if (c.light && !(cached && c.lightMerged)) ctx.drawImage(c.light, 0, 0);
    if (c.glow) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(c.glow, 0, 0); ctx.restore(); }
    this.effects(ctx, stage, now, pts);
  }

  vignette() {
    if (this.vig) return this.vig;
    const v = document.createElement('canvas'); v.width = this.W; v.height = this.H;
    const g = v.getContext('2d'), rg = g.createRadialGradient(this.W / 2, this.H * 0.55, this.H * 0.35, this.W / 2, this.H * 0.55, this.W * 0.72);
    rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,0.42)');
    g.fillStyle = rg; g.fillRect(0, 0, this.W, this.H);
    this.vig = v; return v;
  }

  // ------------------------------------------------------------- HUD
  arrowHud(ctx, dir, since, now) {
    const { W, H, u } = this, a = clamp01((now - since) / 260), ap = easeOutBack(a);
    const w = W * 0.44, h = H * 0.135, cx = W / 2 + dir * (1 - ap) * W * 0.04, cy = H * 0.11;
    ctx.save(); ctx.globalAlpha = a;
    // brillo en el borde de pantalla hacia donde moverse
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    const eg = ctx.createLinearGradient(dir > 0 ? W : 0, 0, dir > 0 ? W - W * 0.09 : W * 0.09, 0);
    eg.addColorStop(0, `rgba(80,210,255,${0.22 + 0.16 * pulse})`); eg.addColorStop(1, 'rgba(80,210,255,0)');
    ctx.fillStyle = eg; ctx.fillRect(dir > 0 ? W - W * 0.09 : 0, 0, W * 0.09, H);
    // cápsula de cristal
    ctx.translate(cx, cy); ctx.scale(0.9 + 0.1 * ap, 0.9 + 0.1 * ap);
    roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fillStyle = 'rgba(8,13,20,0.62)'; ctx.fill();
    const bg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    bg.addColorStop(dir > 0 ? 1 : 0, 'rgba(110,225,255,0.9)'); bg.addColorStop(0.5, 'rgba(110,225,255,0.25)'); bg.addColorStop(dir > 0 ? 0 : 1, 'rgba(110,225,255,0.05)');
    ctx.strokeStyle = bg; ctx.lineWidth = 1.4 * u; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; roundRect(ctx, -w / 2 + 3 * u, -h / 2 + 2 * u, w - 6 * u, h * 0.42, h * 0.3); ctx.fill();
    // chevrons con barrido de luz
    const cs = h * 0.36, gap = cs * 0.95, base = dir * (w / 2 - h * 0.62);
    for (let i = 0; i < 3; i++) {
      const x = base - dir * i * gap;
      const wave = 0.5 + 0.5 * Math.sin(now / 150 - (2 - i) * 1.15);
      ctx.save(); ctx.translate(x, 0);
      ctx.shadowColor = 'rgba(90,215,255,0.9)'; ctx.shadowBlur = this.quality ? (6 + 14 * wave) * u : 0;
      const cg = ctx.createLinearGradient(-cs, 0, cs, 0); cg.addColorStop(0, '#e8fbff'); cg.addColorStop(1, '#5fd3ff');
      ctx.strokeStyle = cg; ctx.globalAlpha = a * (0.28 + 0.72 * wave);
      ctx.lineWidth = h * 0.13; ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(-dir * cs * 0.45, -cs * 0.75); ctx.lineTo(dir * cs * 0.45, 0); ctx.lineTo(-dir * cs * 0.45, cs * 0.75); ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = a;
    ctx.font = `700 ${h * 0.4}px Rajdhani, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${h * 0.08}px`;
    ctx.shadowColor = 'rgba(90,215,255,0.6)'; ctx.shadowBlur = this.quality ? 10 * u : 0; ctx.fillStyle = '#f2fcff';
    ctx.fillText(dir < 0 ? 'IZQUIERDA' : 'DERECHA', -dir * h * 0.55, h * 0.03);
    ctx.restore();
  }

  centerHud(ctx, big, sub, color = '#d4ff3a') {
    const { W, H, u } = this;
    ctx.save();
    let fs = H * 0.11;
    ctx.font = `700 ${fs}px Rajdhani, sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${H * 0.006}px`;
    const bw = ctx.measureText(big).width;
    if (bw > W * 0.82) { fs *= (W * 0.82) / bw; ctx.font = `700 ${fs}px Rajdhani, sans-serif`; }
    let ss = H * 0.034;
    ctx.save(); ctx.font = `600 ${ss}px Rajdhani, sans-serif`; const sw = sub ? ctx.measureText(sub).width : 0; ctx.restore();
    if (sw > W * 0.86) ss *= (W * 0.86) / sw;
    const tw = Math.min(W * 0.94, Math.max(ctx.measureText(big).width, sub ? Math.min(sw, W * 0.86) : 0, sub ? W * 0.3 : 0) + H * 0.12), th = H * (sub ? 0.24 : 0.17);
    roundRect(ctx, W / 2 - tw / 2, H * 0.5 - th / 2, tw, th, H * 0.025);
    ctx.fillStyle = 'rgba(8,12,18,0.62)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = u; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = color; ctx.shadowBlur = this.quality ? 18 * u : 0; ctx.fillStyle = color;
    ctx.fillText(big, W / 2, H * 0.5 - (sub ? H * 0.03 : 0));
    if (sub) {
      ctx.shadowBlur = 0; ctx.font = `600 ${ss}px Rajdhani, sans-serif`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(sub, W / 2, H * 0.5 + H * 0.06);
    }
    ctx.restore();
  }

  infoHud(ctx, text, warn) {
    const { H, u } = this;
    ctx.save(); ctx.font = `600 ${H * 0.026}px Rajdhani, sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${H * 0.003}px`;
    const w = ctx.measureText(text).width + H * 0.04;
    roundRect(ctx, H * 0.025, H * 0.025, w, H * 0.05, H * 0.012); ctx.fillStyle = 'rgba(8,12,18,0.5)'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textBaseline = 'middle'; ctx.fillText(text, H * 0.045, H * 0.051);
    if (warn) {
      ctx.font = `700 ${H * 0.03}px Rajdhani, sans-serif`;
      const ww = ctx.measureText(warn).width + H * 0.05;
      roundRect(ctx, this.W / 2 - ww / 2, H * 0.17, ww, H * 0.06, H * 0.03); ctx.fillStyle = 'rgba(160,20,24,0.75)'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(warn, this.W / 2, H * 0.2);
    }
    ctx.restore();
  }

  // tiempo máximo del ejercicio: barra fina arriba + cifra discreta
  timerHud(ctx, elapsed, par) {
    const { W, H, u } = this, p = clamp01(elapsed / par), left = Math.max(0, par - elapsed);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, Math.max(3, 5 * u));
    const col = p < 0.7 ? '#d4ff3a' : p < 0.9 ? '#ffc53d' : '#ff5a4f';
    ctx.shadowColor = col; ctx.shadowBlur = this.quality ? 8 * u : 0; ctx.fillStyle = col; ctx.fillRect(0, 0, W * p, Math.max(3, 5 * u));
    ctx.shadowBlur = 0;
    ctx.font = `700 ${H * 0.045}px Rajdhani, sans-serif`;
    const txt = `${left.toFixed(1)} s`, tw = ctx.measureText(txt).width + H * 0.04;
    roundRect(ctx, W - tw - H * 0.025, H * 0.025, tw, H * 0.065, H * 0.015); ctx.fillStyle = 'rgba(8,12,18,0.55)'; ctx.fill();
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, W - tw / 2 - H * 0.025, H * 0.06);
    ctx.restore();
  }

  // ------------------------------------------------------------- frame
  // view: { stage, transition: {from, to, dir, start, dur}, arrow: {dir, since}, big, sub, bigColor, info, warn }
  // Prepara (en un momento tranquilo) todo lo cacheable de un escenario que se va a mostrar pronto
  prewarm(stage) {
    if (!stage) return;
    const c = this.stageCache(stage);
    if (this.cacheItems) c.parts ??= this.buildParts(stage, THEMES[stage.theme], c);
  }

  // Si durante ~2,5 s no se llega a ~40 fps, baja la calidad un escalón (resolución y efectos).
  measure(now) {
    const dt = now - this.lastNow; this.lastNow = now;
    if (!(dt > 0 && dt < 250) || document.visibilityState !== 'visible') return;
    this.dtAvg = this.dtAvg * 0.94 + dt * 0.06;
    if (this.dtAvg > 25 && this.quality > 0) {
      this.slowSince ??= now;
      if (now - this.slowSince > 2500) { this.quality--; this.slowSince = null; this.dtAvg = 16; this.checkSize(true); }
    } else this.slowSince = null;
  }

  render(view, now = performance.now()) {
    this.measure(now);
    if (++this.frame % 30 === 0) this.checkSize();
    const { ctx, W, H } = this;
    ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const tr = view.transition;
    if (tr) {
      const p = clamp01((now - tr.start) / tr.dur), e = easeInOut(p);
      const A = this.bufA.getContext('2d'), B = this.bufB.getContext('2d');
      this.drawStage(A, tr.from, now); this.drawStage(B, tr.to, now);
      const off = -tr.dir * e * W, blur = Math.sin(Math.PI * p) * W * 0.018;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      for (const [cv, base] of [[this.bufA, off], [this.bufB, off + tr.dir * W]]) {
        ctx.globalAlpha = 1; ctx.drawImage(cv, base, 0);
        if (blur > 1 && this.quality === 2) { ctx.globalAlpha = 0.28; ctx.drawImage(cv, base - blur, 0); ctx.drawImage(cv, base + blur, 0); }
      }
      ctx.globalAlpha = 1;
      // líneas de velocidad
      const sp = Math.sin(Math.PI * p);
      if (sp > 0.05 && this.quality > 0) {
        const r = rng(Math.floor(now / 40));
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 26; i++) {
          const y = r() * H, len = (0.08 + r() * 0.25) * W * sp, x = r() * W;
          ctx.fillStyle = `rgba(190,235,255,${0.08 * sp})`; ctx.fillRect(x, y, len, Math.max(1, this.u));
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    } else if (view.stage) {
      this.drawStage(ctx, view.stage, now);
    } else { ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, W, H); }
    ctx.drawImage(this.vignette(), 0, 0);
    if (view.dim) { ctx.fillStyle = `rgba(4,6,10,${view.dim})`; ctx.fillRect(0, 0, W, H); }
    if (view.timer) this.timerHud(ctx, view.timer.elapsed, view.timer.par);
    if (view.info || view.warn) this.infoHud(ctx, view.info || '', view.warn);
    if (view.arrow) this.arrowHud(ctx, view.arrow.dir, view.arrow.since, now);
    if (view.big) this.centerHud(ctx, view.big, view.sub, view.bigColor);
    ctx.restore();
  }
}
