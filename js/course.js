// Generador de escenarios para el entrenamiento en seco.
// Medidas reales según el reglamento IPSC Handgun 2024 (Apéndices B2, C2, C3).
//
// Cada escenario: { seed, theme, items: [...], sorted: [...], act: { type } | null, popper, mover, actStart }
// Tipos de item:
//   paper  { x, d, mini, style, pasters, pasters2 }
//          style = { kind: 'normal'|'ns-side'|'ns-tilt'|'double'|'double-ns', ns: { side, angle }|null,
//                    hard: { preset, angle, amount }|null }   (cobertura negra pintada)
//   popper { x, d, mini, activator }
//   plate  { x, d }
//   wall   { x, d, w, h, style }          (barrera visual)
//   barrel { x, d, color } · tires { x, d, n } · cone { x, d }
//   mover  { x, d, mtype: 'swinger'|'drop'|'slider'|'bobber', side, dir, style, tstyle, fixedNS: { dx, angle }|null }
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

// ---------------------------------------------------------------- estilos de tarjeta
export const TARGET_KINDS = ['normal', 'ns-side', 'ns-tilt', 'double', 'double-ns'];
export const KIND_LABEL = { normal: 'Normal', 'ns-side': 'No-shoot lateral', 'ns-tilt': 'No-shoot inclinado', double: 'Doble superpuesta', 'double-ns': 'Doble con no-shoot' };
// cobertura negra: ángulo = dirección hacia la que queda la parte tapada (0° derecha, 90° abajo, -90° arriba)
export const HARD_PRESETS = {
  diag: { label: 'Diagonal', angle: 35, amount: 0.5 },
  band: { label: 'Franja diagonal', angle: 35, amount: 0.6 },
  corner: { label: 'Esquina', angle: 45, amount: 0.25 },
  side: { label: 'Lateral', angle: 0, amount: 0.4 },
  top: { label: 'Arriba', angle: -90, amount: 0.35 },
  bottom: { label: 'Abajo', angle: 90, amount: 0.35 },
};
const KIND_WIDTH = { normal: 0.5, 'ns-side': 0.76, 'ns-tilt': 0.8, double: 0.5, 'double-ns': 0.5 };
export const kindWidth = (k) => KIND_WIDTH[k] || 0.5;
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

export function makeHard(preset, r = Math.random) {
  if (preset === 'random') preset = Object.keys(HARD_PRESETS)[Math.floor(r() * 6)];
  const p = HARD_PRESETS[preset] || HARD_PRESETS.diag;
  const flip = preset !== 'top' && preset !== 'bottom' && r() < 0.5;
  return { preset, angle: Math.round(p.angle + (flip ? 180 : 0) + (r() - 0.5) * 16), amount: +clampN(p.amount + (r() - 0.5) * 0.14, 0.12, 0.85).toFixed(2) };
}
export function randomKind(r = Math.random) {
  const x = r();
  return x < 0.42 ? 'normal' : x < 0.55 ? 'ns-side' : x < 0.71 ? 'ns-tilt' : x < 0.86 ? 'double' : 'double-ns';
}
// estilo completo de una tarjeta; hard: null | 'random' | nombre de preset
export function makeStyle(kind = 'normal', r = Math.random, hard = null) {
  if (kind === 'random') kind = randomKind(r);
  const side = r() < 0.5 ? -1 : 1;
  const st = { kind, ns: null, hard: null };
  if (kind === 'ns-side' || kind === 'double-ns') st.ns = { side, angle: 0 };
  if (kind === 'ns-tilt') st.ns = { side, angle: Math.round(side * (14 + r() * 22)) };
  if (hard) st.hard = makeHard(hard, r);
  return st;
}
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
    mover = { type: 'mover', mtype, d: mtype === 'bobber' ? rand(9, 11) : rand(10.5, 12.5), style: pick(WALL_STYLES), seed: Math.floor(r() * 1e9), dir: r() < 0.5 ? -1 : 1,
      tstyle: makeStyle(r() < 0.6 ? 'normal' : randomKind(r), r, r() < 0.2 ? 'random' : null),
      fixedNS: r() < 0.25 ? { dx: +((r() - 0.5) * 0.5).toFixed(2), angle: Math.round((r() - 0.5) * 30) } : null };
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
    const style = makeStyle(randomKind(r), r, r() < 0.22 ? 'random' : null);
    const t = { type: 'paper', d, mini: d > 10.5 && r() < 0.2, style, pasters: pasters(), pasters2: pasters(), seed: Math.floor(r() * 1e9) };
    place(t, kindWidth(style.kind));
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

// =====================================================================================
// Escenarios a medida (editor de entrenamientos)
// =====================================================================================
export const DIST_RANGES = { close: [6.2, 9], mid: [7, 13], far: [10, 18], mixed: [6.5, 15] };
const ITEM_TYPES = new Set(['paper', 'popper', 'plate', 'wall', 'barrel', 'tires', 'cone', 'mover']);

// Completa un escenario: orden de dibujo y referencias al popper activador y al móvil.
export function finalizeStage(st) {
  st.sorted = [...st.items].sort((a, b) => b.d - a.d);
  st.popper = st.items.find((i) => i.type === 'popper' && i.activator) || null;
  st.mover = st.items.find((i) => i.type === 'mover') || null;
  st.act = st.popper && st.mover ? { type: st.mover.mtype } : null;
  st.actStart = null; st.actSpeed = 1;
  return st;
}
// Disposición guardable (sin datos de render)
export function layoutOf(stage) {
  return { seed: stage.seed, theme: stage.theme, items: stage.items.map(({ _screen, ...i }) => ({ ...i })) };
}
export function stageFromLayout(layout) {
  const items = (layout.items || [])
    .filter((i) => i && ITEM_TYPES.has(i.type) && Number.isFinite(i.x) && Number.isFinite(i.d))
    .map((i) => ({ ...i, d: Math.min(25, Math.max(5.5, i.d)), x: Math.min(1.6, Math.max(-1.6, i.x)) }));
  return finalizeStage({ seed: layout.seed || 1, theme: Math.min(THEME_COUNT - 1, Math.max(0, layout.theme | 0)), items });
}

// Crea un escenario con la composición pedida (cantidades) colocada automáticamente.
export function composeStage(comp = {}, seed = Date.now()) {
  const c = {
    paper: 2, ns: 0, nsTilt: 0, double: 0, doubleNs: 0, styleRandom: false, hard: 0, hardPreset: 'random',
    poppers: 3, popSize: 'full', plates: 0, mover: 'none', moverStyle: 'normal', moverHard: 'none', moverNS: 'none',
    dist: 'mixed', theme: -1, props: true, ...comp,
  };
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const rand = (a, b) => a + r() * (b - a);
  const [dMin, dMax] = DIST_RANGES[c.dist] || DIST_RANGES.mixed;
  const theme = c.theme >= 0 ? c.theme : Math.floor(r() * THEME_COUNT);
  const items = [], occ = [], LIM = 0.97, GAP = 0.025;
  let missing = 0;
  const free = (a, b) => occ.every(([s, e]) => b + GAP < s || a - GAP > e);
  // intenta colocar; si no cabe, lo aleja (más lejos ocupa menos ancho en pantalla)
  function place(item, widthM, range = [-LIM, LIM], { required = true, maxD = 19 } = {}) {
    for (let round = 0; round < 5; round++) {
      const hw = normHalf(widthM, item.d);
      const lo = Math.max(range[0], -LIM + hw), hi = Math.min(range[1], LIM - hw);
      if (hi >= lo) {
        for (let i = 0; i < 60; i++) {
          const x = rand(lo, hi);
          if (free(x - hw, x + hw)) { item.x = x; occ.push([x - hw, x + hw]); items.push(item); return true; }
        }
      }
      if (item.d >= maxD) break;
      item.d = Math.min(maxD, item.d + 2.2);
    }
    if (required) missing++;
    return false;
  }
  const seedOf = () => Math.floor(r() * 1e9);
  const pasters = () => Array.from({ length: Math.floor(r() * 4) }, () => ({ u: rand(8, 37), v: rand(6, 50), r: rand(-0.3, 0.3) }));
  const mini = () => c.popSize === 'mini' || (c.popSize === 'mixed' && r() < 0.5);

  // --- elementos principales: se reparten en fila (izquierda → derecha) con huecos aleatorios.
  // Si no caben, se alejan primero los más cercanos (de lejos ocupan menos ancho en pantalla).
  const row = [];
  let mover = null, activator = null;
  let nPoppers = c.poppers;
  if (c.mover && c.mover !== 'none') {
    const mtype = c.mover === 'random' ? pick(MOVER_TYPES) : c.mover;
    const moverHard = c.moverHard === 'none' ? null : c.moverHard === 'random' ? (r() < 0.5 ? 'random' : null) : c.moverHard;
    const fixedNS = c.moverNS === 'yes' || (c.moverNS === 'random' && r() < 0.5) ? { dx: +((r() - 0.5) * 0.5).toFixed(2), angle: Math.round((r() - 0.5) * 30) } : null;
    mover = { item: { type: 'mover', mtype, d: mtype === 'bobber' ? rand(9, 11) : rand(10.5, 12.5), style: pick(WALL_STYLES), seed: seedOf(), dir: r() < 0.5 ? -1 : 1, tstyle: makeStyle(c.moverStyle || 'normal', r, moverHard), fixedNS }, w: MOVER_W[mtype], maxD: 15 };
    activator = { item: { type: 'popper', d: rand(Math.max(6.5, dMin), Math.min(11, dMax)), mini: mini(), activator: true, seed: seedOf() }, w: 0.5, maxD: 14 };
    nPoppers = Math.max(0, nPoppers - 1);
  }
  for (let i = 0; i < nPoppers; i++) row.push({ item: { type: 'popper', d: rand(dMin, dMax), mini: mini(), activator: false, seed: seedOf() }, w: 0.5, maxD: 19 });
  for (let i = 0; i < c.plates; i++) row.push({ item: { type: 'plate', d: rand(dMin, dMax), seed: seedOf() }, w: 0.35, maxD: 19 });
  // tarjetas: reparte no-shoots y coberturas entre ellas
  // estilos: por cantidades (el resto normales) o aleatorios; la cobertura se suma a cualquier estilo
  let kinds = [];
  if (c.styleRandom) kinds = Array.from({ length: c.paper }, () => randomKind(r));
  else {
    for (const [k, n] of [['ns-side', c.ns], ['ns-tilt', c.nsTilt], ['double', c.double], ['double-ns', c.doubleNs]]) for (let i = 0; i < n; i++) kinds.push(k);
    kinds = kinds.slice(0, c.paper);
    while (kinds.length < c.paper) kinds.push('normal');
  }
  kinds.sort(() => r() - 0.5);
  const hardIdx = new Set(Array.from({ length: c.paper }, (_, i) => i).sort(() => r() - 0.5).slice(0, c.styleRandom ? Math.round(c.paper * 0.25 * r() * 2) : Math.min(c.hard, c.paper)));
  for (let i = 0; i < c.paper; i++) {
    const style = makeStyle(kinds[i], r, hardIdx.has(i) ? (c.hardPreset || 'random') : null);
    row.push({ item: { type: 'paper', d: rand(dMin, dMax), mini: false, style, pasters: pasters(), pasters2: pasters(), seed: seedOf() }, w: kindWidth(style.kind), maxD: 19 });
  }
  row.sort(() => r() - 0.5);
  if (mover) {
    // el móvil en una mitad y su popper activador en la otra
    const n = row.length, mi = Math.floor(r() * (n + 1));
    row.splice(mi, 0, mover);
    const ai = mi <= n / 2 ? Math.floor(rand(Math.ceil((n + 1) * 0.6), n + 2)) : Math.floor(rand(0, Math.max(1, Math.floor((n + 1) * 0.4))));
    row.splice(Math.min(ai, row.length), 0, activator);
  }
  const span = 2 * LIM, gapMin = 0.03;
  const widthOf = () => row.reduce((t, e) => t + 2 * normHalf(e.w, e.item.d), 0) + gapMin * Math.max(0, row.length - 1);
  for (let guard = 0; guard < 400 && widthOf() > span; guard++) {
    const near = row.filter((e) => e.item.d < e.maxD).sort((a, b) => 2 * normHalf(b.w, b.item.d) - 2 * normHalf(a.w, a.item.d))[0];
    if (!near) break;
    near.item.d = Math.min(near.maxD, near.item.d + 0.6);
  }
  while (row.length && widthOf() > span) {
    // no caben ni alejándolos: se descarta el último (el activador y el móvil se descartan juntos)
    const e = row.pop(); missing++;
    if (e === mover || e === activator) { const o = e === mover ? activator : mover; const k = row.indexOf(o); if (k >= 0) { row.splice(k, 1); missing++; } mover = activator = null; }
  }
  const extra = Math.max(0, span - widthOf()), weights = Array.from({ length: row.length + 1 }, () => 0.4 + r());
  const wsum = weights.reduce((a, b) => a + b, 0);
  let cursor = -LIM + (extra * weights[0]) / wsum;
  row.forEach((e, i) => {
    const hw = normHalf(e.w, e.item.d);
    e.item.x = cursor + hw; items.push(e.item); occ.push([cursor, cursor + 2 * hw]);
    cursor += 2 * hw + gapMin + (extra * weights[i + 1]) / wsum;
  });
  if (mover) mover.item.side = mover.item.x <= 0 ? 1 : -1;
  // atrezo (solo donde quede hueco)
  if (c.props) {
    for (let i = 0, n = Math.floor(r() * 3); i < n; i++) place({ type: 'barrel', d: rand(7, 14), color: pick(BARREL_COLORS), seed: seedOf() }, 0.62, undefined, { required: false, maxD: 15 });
    if (r() < 0.3) place({ type: 'tires', d: rand(7, 12), n: 2 + Math.floor(r() * 2) }, 0.7, undefined, { required: false, maxD: 13 });
    if (r() < 0.5) place({ type: 'wall', d: rand(16, 19), w: rand(1.2, 2.2), h: 2, style: pick(WALL_STYLES), seed: seedOf() }, 2.2, undefined, { required: false, maxD: 20 });
    for (const side of [-1, 1]) {
      if (r() < 0.5) items.push({ type: 'wall', x: side * rand(1.32, 1.5), d: rand(7.5, 9.5), w: rand(1.2, 1.6), h: 2.1, style: pick(WALL_STYLES), seed: seedOf() });
      else if (r() < 0.4) items.push({ type: 'barrel', x: side * rand(1.08, 1.2), d: rand(7, 9), color: pick(BARREL_COLORS), seed: seedOf() });
    }
  }
  const st = finalizeStage({ seed, theme, items });
  st.missing = missing;
  return st;
}

// Escenario «de paso» (sin blancos) para mostrar mientras te desplazas a la posición
export function lobbyStage(theme = 0, seed = Date.now()) {
  return composeStage({ paper: 0, poppers: 0, plates: 0, mover: 'none', theme, props: true }, seed);
}
