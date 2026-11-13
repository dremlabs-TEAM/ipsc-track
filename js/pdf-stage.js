// Convierte un stage de un PDF de competición en un ejercicio del Editor:
// · Ficha: reglas, salida, condición del arma, procedimiento, blancos, disparos y puntos.
// · Dibujo: posición de los blancos y del atrezo en el plano.
// · Posiciones (inventadas a partir del plano): los blancos se agrupan de izquierda a derecha y en cada
//   posición se monta el escenario 2D que se vería desde allí (lado y distancia de cada blanco, no-shoots,
//   poppers, móvil con su activador, muros y bidones), con su tiempo según los disparos.
import { detectItems, cropImage } from './pdf-import.js?v=20261113-1732';
import { newCoursePosition, defaultComp, defaultCond, defaultRandom } from './program.js?v=20261113-1732';
import { finalizeStage, layoutOf, makeStyle, normHalf, kindWidth } from './course.js?v=20261113-1732';
import { uid } from './storage.js?v=20261113-1732';

const THEME = 2;          // «Mediodía»: el aire libre de una competición
const LIM = 0.94;         // ancho útil de la pantalla (fracción normalizada)
const XK = 3.95;          // dx (m) / distancia (m) → posición horizontal normalizada en el escenario 2D
const MOVER_W = 2.5;
const seed = () => Math.floor(Math.random() * 1e9);

// condiciones a partir del texto de la ficha
export function condFromInfo(info) {
  const t = `${info.start || ''} ${info.condition || ''} ${info.procedure || ''}`.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const c = defaultCond();
  if (/SENTAD|SITTING|SILLA|CHAIR/.test(t)) c.start = 'seated';
  else if (/ESPALDA|BACK TO|FACING UPRANGE/.test(t)) c.start = 'back';
  else if (/SOBRE LA MESA|ON THE TABLE|EN LA MESA|TABLE/.test(t)) c.start = 'table';
  else if (/MANOS (?:SOBRE|POR ENCIMA|EN ALTO|ARRIBA|EN LA CABEZA)|HANDS (?:ABOVE|ON HEAD)|SURRENDER/.test(t)) c.start = 'surrender';
  else if (/SIN ALIMENTAR|DESCARGADA|CHAMBER EMPTY|UNLOADED|CONDICION 3|CONDITION 3/.test(t)) c.start = 'unloaded';
  if (/MANO DEBIL|WEAK HAND/.test(t)) c.hand = 'weak';
  else if (/MANO FUERTE|STRONG HAND/.test(t)) c.hand = 'strong';
  return c;
}

// cuántos blancos móviles indica la ficha (cantidad o «P1 activa T1», «IP-1 activates…»)
function moverCount(info) {
  if (info.counts?.mover) return info.counts.mover;
  const t = `${info.procedure || ''}`.toUpperCase();
  const ids = new Set((t.match(/\b(?:T|IT|MT)[\s.-]?\d\b/g) || []).map((s) => s.replace(/[\s.-]/g, '')));
  if (ids.size) return Math.min(3, ids.size);
  return /ACTIVA|ACTIVATES|SWINGER|DROP TURNER|MOVING TARGET|MOVIL|BALANC/.test(t) ? 1 : 0;
}

// Cantidades exactas según la ficha. Los móviles cuentan como tarjetas (2 disparos).
// Si la ficha no desglosa el metal, se deduce de los disparos mínimos: 2 por tarjeta + 1 por metal.
export function sheetCounts(info, detected = []) {
  const c = info.counts || {};
  const mover = moverCount(info);
  const hasSheet = c.paper != null || c.rounds != null || c.popper != null || c.plate != null || c.metal != null;
  if (!hasSheet) {
    // sin ficha: lo que se vea en el dibujo (o algo que disparar)
    const n = (t) => detected.filter((i) => i.type === t).length;
    return { paper: n('paper') || 4, ns: 0, popper: n('popper'), plate: n('plate'), mover: 0, rounds: null, exact: false };
  }
  const paperAll = c.paper ?? (c.rounds != null ? Math.floor(c.rounds / 2) : 0);
  let popper = c.popper, plate = c.plate;
  if (popper == null && plate == null) {
    // sin desglose: los poppers que nombra el procedimiento (P1, P.2, IP-1…) son poppers seguro; el resto, según el dibujo
    const metal = c.metal ?? (c.rounds != null ? Math.max(0, c.rounds - 2 * paperAll) : 0);
    const proc = String(info.procedure || '').toUpperCase();
    const named = new Set((proc.match(/\b(?:I?P|POPPER)[\s.,-]?\d\b/g) || []).map((x) => x.replace(/\D/g, ''))).size;
    const detPop = detected.filter((i) => i.type === 'popper').length, detPlates = detected.filter((i) => i.type === 'plate').length;
    popper = Math.min(metal, Math.max(named, detPop, metal - detPlates));
    plate = metal - popper;
  }
  popper = popper || 0; plate = plate || 0;
  const mv = Math.min(mover, paperAll);
  return { paper: Math.max(0, paperAll - mv), ns: c.ns || 0, popper, plate, mover: mv, rounds: c.rounds ?? (2 * paperAll + popper + plate), exact: true };
}

// 1D k-medias sobre la posición lateral (agrupa blancos que se disparan desde un mismo sitio)
function clusterX(list, k) {
  if (k <= 1 || list.length <= 1) return [list];
  const xs = list.map((t) => t.x).sort((a, b) => a - b);
  let cs = Array.from({ length: k }, (_, i) => xs[Math.min(xs.length - 1, Math.floor(((i + 0.5) / k) * xs.length))]);
  let groups = [];
  for (let it = 0; it < 12; it++) {
    groups = cs.map(() => []);
    for (const t of list) { let bi = 0; cs.forEach((c, i) => { if (Math.abs(t.x - c) < Math.abs(t.x - cs[bi])) bi = i; }); groups[bi].push(t); }
    cs = groups.map((g, i) => (g.length ? g.reduce((a, t) => a + t.x, 0) / g.length : cs[i]));
  }
  return groups.filter((g) => g.length);
}

// ancho (m) de cada elemento en el escenario 2D
const widthOf = (it) => (it.type === 'paper' ? kindWidth(it.style?.kind) : it.type === 'mover' ? MOVER_W : it.type === 'plate' ? 0.35 : it.type === 'wall' ? it.w : it.type === 'barrel' ? 0.62 : it.type === 'tires' ? 0.7 : 0.5);

// coloca los blancos sin que se pisen y dentro de la pantalla (si no caben, se alejan un poco)
function fit(items) {
  const main = items.filter((i) => ['paper', 'popper', 'plate', 'mover'].includes(i.type));
  for (let guard = 0; guard < 80; guard++) {
    main.sort((a, b) => a.x - b.x);
    const half = main.map((i) => normHalf(widthOf(i), i.d));
    const need = half.reduce((t, h) => t + 2 * h, 0) + 0.025 * Math.max(0, main.length - 1);
    if (need <= 2 * LIM) break;
    const near = main.filter((i) => i.d < (i.type === 'mover' ? 15 : 18)).sort((a, b) => normHalf(widthOf(b), b.d) - normHalf(widthOf(a), a.d))[0];
    if (!near) break;
    near.d = Math.min(near.type === 'mover' ? 15 : 18, near.d + 0.6);
  }
  // separa los que se solapan conservando el orden de izquierda a derecha
  main.sort((a, b) => a.x - b.x);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < main.length; i++) {
      const a = main[i - 1], b = main[i], gap = normHalf(widthOf(a), a.d) + normHalf(widthOf(b), b.d) + 0.025;
      if (b.x - a.x < gap) b.x = a.x + gap;
    }
    // vuelve a centrar y encoger si se sale
    if (!main.length) break;
    const lo = main[0].x - normHalf(widthOf(main[0]), main[0].d), last = main[main.length - 1], hi = last.x + normHalf(widthOf(last), last.d);
    const shift = -(lo + hi) / 2, span = hi - lo;
    const k = span > 2 * LIM ? (2 * LIM) / span : 1;
    for (const it of main) it.x = (it.x + shift) * k;
  }
}

export function stageToExercise(pg, { widthM = 20, file = '' } = {}) {
  const info = pg.info, c = info.counts || {};
  const det = detectItems(pg, pg.crop, widthM, c), depthM = det.depthM;
  const want = sheetCounts(info, det.items);
  // del dibujo se aprovechan las POSICIONES; las CANTIDADES las manda la ficha
  const items = det.items.filter((i) => !['paper', 'popper', 'plate'].includes(i.type)).map((i) => ({ ...i }));
  const spread = () => ({ x: (Math.random() - 0.5) * widthM * 0.75, d: depthM * (0.55 + Math.random() * 0.35), rot: 0, added: true });
  const take = (list, n, type) => {
    const out = list.slice(0, n).map((t) => ({ ...t, type }));
    while (out.length < n) out.push({ type, ...spread() });
    return out;
  };
  const detPaper = det.items.filter((i) => i.type === 'paper');
  const detMetal = det.items.filter((i) => i.type === 'popper' || i.type === 'plate');
  // primero los que el dibujo ya clasificó como cada tipo, luego el resto de manchas de metal
  const popFirst = [...detMetal.filter((i) => i.type === 'popper'), ...detMetal.filter((i) => i.type === 'plate')];
  const poppers = take(popFirst, want.popper, 'popper');
  const usedP = new Set(poppers.map((x) => `${x.x},${x.d}`));
  const plates = take([...detMetal.filter((i) => i.type === 'plate'), ...detMetal.filter((i) => i.type === 'popper')].filter((x) => !usedP.has(`${x.x},${x.d}`)), want.plate, 'plate');
  items.push(...take(detPaper, want.paper, 'paper'), ...poppers, ...plates);

  const start = items.find((i) => i.type === 'box') || { x: 0, d: 0 };
  const shoot = items.filter((i) => ['paper', 'popper', 'plate'].includes(i.type));
  // no-shoots de la ficha: se reparten entre las tarjetas
  const papers = shoot.filter((i) => i.type === 'paper');
  const nNS = Math.min(want.ns, papers.length);
  for (let n = 0; n < nNS; n++) papers[Math.floor(((n + 0.5) / nNS) * papers.length)].ns = n % 2 ? 'ns-tilt' : 'ns-side';

  // posiciones: grupos de ~4 blancos de izquierda a derecha, empezando por el lado de la salida
  const k = Math.max(1, Math.min(5, Math.round(shoot.length / 4)));
  let groups = clusterX(shoot, k);
  const mid = shoot.reduce((a, t) => a + t.x, 0) / Math.max(1, shoot.length);
  groups.sort((a, b) => (start.x <= mid ? 1 : -1) * (a.reduce((s, t) => s + t.x, 0) / a.length - b.reduce((s, t) => s + t.x, 0) / b.length));
  // móviles con su popper activador (en la posición que tenga poppers, o al final)
  const movers = want.mover;
  const props = items.filter((i) => ['wall', 'mesh', 'barrel', 'tires'].includes(i.type));

  const positions = groups.map((g, gi) => {
    const px = g.reduce((a, t) => a + t.x, 0) / g.length;
    const near = Math.min(...g.map((t) => t.d));
    const pd = Math.max(start.d, near - 7.5);
    const stItems = [];
    // distancia: el blanco más cercano a ~6,5 m y el resto según el plano (diferencias algo exageradas para que se note la profundidad)
    const place = (t) => {
      const dist = Math.max(6, Math.min(17, 6.5 + (t.d - near) * 1.35 + Math.random() * 1.4));
      return { d: +dist.toFixed(2), x: (XK * (t.x - px)) / Math.max(6, t.d - pd) };
    };
    for (const t of g) {
      const p = place(t);
      if (t.type === 'paper') stItems.push({ type: 'paper', ...p, mini: false, style: makeStyle(t.ns || 'normal'), pasters: [], pasters2: [], seed: seed() });
      if (t.type === 'popper') stItems.push({ type: 'popper', ...p, mini: false, activator: false, seed: seed() });
      if (t.type === 'plate') stItems.push({ type: 'plate', ...p, seed: seed() });
    }
    return { g, px, pd, stItems };
  });
  // reparte los móviles: cada uno con un popper de su posición como activador
  for (let m = 0; m < movers && positions.length; m++) {
    // la posición con menos móviles y, a igualdad, con más poppers libres para activarlo
    const free = (Q) => Q.stItems.filter((i) => i.type === 'popper' && !i.activator).length;
    const nMov = (Q) => Q.stItems.filter((i) => i.type === 'mover').length;
    const P = positions.slice().sort((a, b) => nMov(a) - nMov(b) || free(b) - free(a))[0];
    const pop = P.stItems.find((i) => i.type === 'popper' && !i.activator);
    if (pop) pop.activator = true;
    const mx = (pop && pop.x > 0 ? -0.45 : 0.45) * (nMov(P) ? -1 : 1); // un segundo móvil, al otro lado
    P.stItems.push({ type: 'mover', mtype: ['swinger', 'drop', 'slider', 'bobber'][m % 4], d: 11.5, x: mx, style: 'ply', seed: seed(), dir: mx < 0 ? 1 : -1, side: mx <= 0 ? 1 : -1, tstyle: makeStyle('normal'), fixedNS: null });
  }

  const out = positions.map((P, gi) => {
    fit(P.stItems);
    // atrezo que se vería desde aquí: muros y mallas de frente, bidones y neumáticos
    const ps = [];
    for (const it of props) {
      const dist = it.d - P.pd;
      if (dist < 4 || dist > 21) continue;
      const x = (XK * (it.x - P.px)) / dist;
      if (Math.abs(x) > 1.35) continue;
      if (it.type === 'wall' || it.type === 'mesh') {
        if (it.rot === 90) continue; // los muros que van hacia el fondo no se ven de frente
        ps.push({ type: 'wall', d: +dist.toFixed(2), x, w: Math.min(3.5, Math.max(0.8, it.w || 1.2)), h: it.type === 'mesh' ? 1.9 : 2, style: it.type === 'mesh' ? 'mesh' : 'ply', seed: seed() });
      } else if (it.type === 'barrel') ps.push({ type: 'barrel', d: +dist.toFixed(2), x, color: it.color || '#2f5f9e', seed: seed() });
      else ps.push({ type: 'tires', d: +dist.toFixed(2), x, n: 2 });
    }
    // huecos libres entre los blancos (en la pantalla) para colocar muros y atrezo sin tapar nada
    const main = P.stItems;
    const gaps = () => {
      const segs = main.map((t) => [t.x - normHalf(widthOf(t), t.d), t.x + normHalf(widthOf(t), t.d)]).sort((a, b) => a[0] - b[0]);
      const out = []; let cur = -1.3;
      for (const [a, b] of segs) { if (a - cur > 0.05) out.push([cur, a]); cur = Math.max(cur, b); }
      if (1.3 - cur > 0.05) out.push([cur, 1.3]);
      return out;
    };
    const placeInGap = (it, wM) => {
      const need = 2 * normHalf(wM, it.d) + 0.03;
      const free = gaps().filter(([a, b]) => b - a >= need).sort((g1, g2) => Math.abs((g1[0] + g1[1]) / 2 - it.x) - Math.abs((g2[0] + g2[1]) / 2 - it.x))[0];
      if (!free) return false;
      it.x = Math.min(free[1] - need / 2, Math.max(free[0] + need / 2, it.x));
      return true;
    };
    const keep = [];
    for (const w of ps.sort((a, b) => a.d - b.d)) {
      if (keep.length >= 4) break;
      if (w.type === 'wall') {
        // un muro delante de los blancos se mueve al hueco más cercano (hace de cobertura), y más estrecho si hace falta
        const blocks = main.some((t) => t.d > w.d && Math.abs(t.x - w.x) < normHalf(w.w, w.d) + normHalf(widthOf(t), t.d));
        if (blocks) {
          w.w = Math.min(w.w, 1.2);
          if (!placeInGap(w, w.w)) { w.w = 0.8; if (!placeInGap(w, 0.8)) continue; }
        }
        keep.push(w); main.push({ ...w, _prop: true });
      } else if (placeInGap(w, widthOf(w))) { keep.push(w); main.push({ ...w, _prop: true }); }
    }
    // si el escenario ha quedado sin atrezo, un par de bidones en los huecos
    if (!keep.some((k) => k.type !== 'wall')) {
      for (let n = 0; n < 2; n++) {
        const b = { type: 'barrel', d: +(7 + Math.random() * 5).toFixed(2), x: (Math.random() - 0.5) * 1.6, color: ['#2f5f9e', '#1f2a36', '#8e2d2a'][n % 3], seed: seed() };
        if (placeInGap(b, 0.62)) { keep.push(b); main.push({ ...b, _prop: true }); }
      }
    }
    for (let k = main.length - 1; k >= 0; k--) if (main[k]._prop) main.splice(k, 1);
    // muros laterales que enmarcan la posición si en el plano hay muros o vallas cerca
    const nearWalls = props.filter((w) => (w.type === 'wall' || w.type === 'mesh') && Math.abs(w.x - P.px) < 6 && w.d > P.pd - 1);
    if (nearWalls.length) {
      const style = nearWalls.some((w) => w.type === 'mesh') ? 'mesh' : 'ply';
      for (const side of [-1, 1]) keep.push({ type: 'wall', x: side * (1.36 + Math.random() * 0.1), d: +(7.6 + Math.random() * 1.6).toFixed(2), w: 1.4, h: 2.1, style, seed: seed() });
    }
    const stage = finalizeStage({ seed: seed(), theme: THEME, items: [...main, ...keep] });
    const layout = layoutOf(stage); layout.manual = true;
    const shots = main.reduce((t, i) => t + (i.type === 'paper' || i.type === 'mover' ? 2 : 1), 0);
    const pos = newCoursePosition(gi === 0 ? 'none' : P.px >= positions[gi - 1].px ? 'right' : 'left');
    Object.assign(pos, {
      time: Math.max(2, Math.round((1.3 + shots * 0.45) * 2) / 2),
      layout, port: null, randomScene: false,
      comp: { ...defaultComp(), paper: main.filter((i) => i.type === 'paper').length, poppers: main.filter((i) => i.type === 'popper').length, plates: main.filter((i) => i.type === 'plate').length, mover: main.some((i) => i.type === 'mover') ? 'random' : 'none', theme: THEME },
    });
    return pos;
  });

  const title = info.stage ? `Stage ${info.stage}` : `Página ${pg.n}`;
  const counts = [`${want.paper + want.mover} tarjetas`, want.ns ? `${want.ns} no‑shoots` : '', want.popper ? `${want.popper} poppers` : '', want.plate ? `${want.plate} platos` : '', movers ? `(${movers} ${movers === 1 ? 'móvil' : 'móviles'})` : ''].filter(Boolean).join(' · ');
  return {
    id: uid(), type: 'course', name: title, positions: out,
    reps: 3, rest: 20, startMode: 'random', restAfter: 20, startMove: false, maxTime: 0, random: defaultRandom(),
    cond: condFromInfo(info),
    // ficha del PDF (referencia; no se comparte por enlace)
    sheet: {
      file, page: pg.n, event: info.event || '', stage: info.stage || '', start: info.start || '', procedure: info.procedure || '', condition: info.condition || '',
      counts: { ...c, mover: movers }, want, summary: counts, img: cropImage(pg, pg.crop, 720),
    },
  };
}
