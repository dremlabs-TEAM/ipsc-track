// Generador de escenarios para el entrenamiento en seco.
// Medidas reales según el reglamento IPSC Handgun 2024 (Apéndices B2, C2, C3).
//
// Cada escenario: { seed, theme, items: [...], sorted: [...], act: { type } | null, popper, mover, actStart }
// Tipos de item:
//   paper  { x, d, mini, ns: {side}|null, hard: {side, frac}|null, pasters }
//   popper { x, d, mini, activator }
//   plate  { x, d }
//   wall   { x, d, w, h, style }          (barrera visual)
//   barrel { x, d, color } · tires { x, d, n } · cone { x, d }
//   mover  { x, d, mtype: 'swinger'|'drop'|'slider'|'bobber', side, dir, style }
// x es la posición lateral normalizada en pantalla (-1..1), d la distancia en metros.

export const PERSPECTIVE = { F: 2.6, HOR: 0.36, CAMH: 1.25, SPREAD: 0.37 };
export const THEME_COUNT = 5;
export const MOVER_TYPES = ['swinger', 'drop', 'slider', 'bobber'];

// RNG con semilla
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// medio ancho normalizado en pantalla de un objeto de `widthM` metros a `d` metros
export function normHalf(widthM, d) {
  const { F, SPREAD } = PERSPECTIVE;
  return ((widthM / 2) * F * 0.5625) / (d * SPREAD);
}

const MOVER_W = { swinger: 2.5, drop: 2.5, slider: 2.7, bobber: 1.7 };
const WALL_STYLES = ['ply', 'mesh', 'banner', 'ply', 'mesh'];
const BARREL_COLORS = ['#2f5f9e', '#2f5f9e', '#1f2a36', '#8e2d2a', '#3f6b3a'];

export function randomStage(seed = Date.now(), opts = {}) {
  const { activators = 'sometimes', prevTheme = -1 } = opts;
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const rand = (a, b) => a + r() * (b - a);

  let theme = Math.floor(r() * THEME_COUNT);
  if (theme === prevTheme) theme = (theme + 1) % THEME_COUNT;

  const items = [];
  const occ = []; // intervalos ocupados [a, b]
  const LIM = 0.96, GAP = 0.035;
  const free = (a, b) => occ.every(([c, e]) => b + GAP < c || a - GAP > e);
  function place(item, widthM, range = [-LIM, LIM], tries = 50) {
    const hw = normHalf(widthM, item.d);
    const lo = Math.max(range[0], -LIM + hw), hi = Math.min(range[1], LIM - hw);
    if (hi < lo) return false;
    for (let i = 0; i < tries; i++) {
      const x = rand(lo, hi);
      if (free(x - hw, x + hw)) { item.x = x; occ.push([x - hw, x + hw]); items.push(item); return true; }
    }
    return false;
  }
  const pasters = () => Array.from({ length: Math.floor(r() * 5) }, () => ({ u: rand(8, 37), v: rand(6, 50), r: rand(-0.3, 0.3) }));

  // --- popper activador + móvil ---
  const hasAct = activators === 'always' || (activators === 'sometimes' && r() < 0.6);
  let act = null, popper = null, mover = null;
  if (hasAct) {
    const mtype = pick(MOVER_TYPES);
    mover = { type: 'mover', mtype, d: mtype === 'bobber' ? rand(9, 11) : rand(10.5, 12.5), style: pick(WALL_STYLES), seed: Math.floor(r() * 1e9), dir: r() < 0.5 ? -1 : 1 };
    if (place(mover, MOVER_W[mtype], [-0.62, 0.62])) {
      mover.side = mover.x <= 0 ? 1 : -1; // el balancín sale hacia el centro
      popper = { type: 'popper', d: rand(7, 9.5), mini: r() < 0.35, activator: true, seed: Math.floor(r() * 1e9) };
      const opp = mover.x <= 0 ? [0.05, LIM] : [-LIM, -0.05];
      if (!place(popper, 0.5, opp) && !place(popper, 0.5)) { popper = null; }
      if (popper) act = { type: mtype };
      else { items.splice(items.indexOf(mover), 1); occ.pop(); mover = null; }
    } else mover = null;
  }

  // --- blancos de papel ---
  const nPaper = act ? 2 + Math.floor(r() * 2) : 2 + Math.floor(r() * 3);
  for (let i = 0; i < nPaper; i++) {
    const d = rand(6.6, 14);
    const ns = r() < 0.22 ? { side: r() < 0.5 ? -1 : 1 } : null;
    const hard = r() < 0.18 ? { side: r() < 0.5 ? -1 : 1, frac: rand(0.28, 0.5) } : null;
    const t = { type: 'paper', d, mini: d > 10.5 && r() < 0.2, ns, hard, pasters: pasters(), seed: Math.floor(r() * 1e9) };
    place(t, 0.5 + (ns ? 0.26 : 0));
  }
  // --- metal suelto ---
  if (r() < (act ? 0.2 : 0.4)) place({ type: 'plate', d: rand(7, 11), seed: Math.floor(r() * 1e9) }, 0.35);
  if (r() < 0.18) place({ type: 'popper', d: rand(7.5, 11), mini: r() < 0.5, activator: false, seed: Math.floor(r() * 1e9) }, 0.5);

  // --- atrezo en huecos ---
  for (let i = 0, n = Math.floor(r() * 3); i < n; i++) place({ type: 'barrel', d: rand(6.5, 13), color: pick(BARREL_COLORS), seed: Math.floor(r() * 1e9) }, 0.62, undefined, 15);
  if (r() < 0.35) place({ type: 'tires', d: rand(6.5, 12), n: 2 + Math.floor(r() * 2) }, 0.7, undefined, 15);
  if (r() < 0.3) place({ type: 'cone', d: rand(6.2, 9) }, 0.35, undefined, 15);
  if (r() < 0.5) place({ type: 'wall', d: rand(15, 19), w: rand(1.2, 2.4), h: rand(1.8, 2.2), style: pick(WALL_STYLES), seed: Math.floor(r() * 1e9) }, 2.4, undefined, 12);

  // --- barreras laterales en primer plano (enmarcan el escenario) ---
  for (const side of [-1, 1]) {
    if (r() < 0.5) items.push({ type: 'wall', x: side * rand(1.32, 1.5), d: rand(7.5, 9.5), w: rand(1.2, 1.6), h: 2.1, style: pick(WALL_STYLES), seed: Math.floor(r() * 1e9) });
    else if (r() < 0.5) items.push({ type: 'barrel', x: side * rand(1.08, 1.2), d: rand(7, 9), color: pick(BARREL_COLORS), seed: Math.floor(r() * 1e9) });
  }

  const sorted = [...items].sort((a, b) => b.d - a.d);
  return { seed, theme, items, sorted, act, popper, mover, actStart: null };
}
