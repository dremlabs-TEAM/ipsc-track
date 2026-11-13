// Entrenamientos personalizados: modelo de datos, valores por defecto, resúmenes y enlaces para compartir.
//
// program = { id, name, notes, created, updated, blocks: [block] }
// block (escenario con tiempo) = { id, type: 'stage', name, comp, activatorAt, par, reps, rest, startMode, vary, withMove, restAfter, layout }
//   comp = { paper, ns, nsTilt, double, doubleNs, styleRandom, hard, hardPreset, poppers, popSize: 'full'|'mini'|'mixed', plates,
//            mover: 'none'|'random'|'swinger'|'drop'|'slider'|'bobber', moverStyle, moverHard, moverNS, dist, theme }
// block (recorrido aleatorio) = { id, type: 'arena', name, moves, delay, activators, restAfter }
// block (recorrido personalizado) = { id, type: 'course', name, positions: [pos], reps, rest, startMode, restAfter }
//   pos = { id, dir: 'none'|'left'|'right'|'random' (desplazamiento para llegar), time (s en la posición), activatorAt, comp, layout }
import { uid } from './storage.js?v=20261113-1732';

// ---- condiciones de un ejercicio: con qué mano, desde qué posición, recarga obligatoria ----
export const HAND_LABEL = { free: 'Libre (dos manos)', strong: 'Solo mano fuerte', weak: 'Solo mano débil' };
export const START_LABEL = {
  holster: 'Arma enfundada, manos a los costados',
  surrender: 'Manos por encima de los hombros',
  unloaded: 'Arma enfundada descargada (recámara vacía): carga a la señal',
  table: 'Arma descargada sobre la mesa, cargadores en el cinturón',
  back: 'De espaldas a los blancos',
  seated: 'Sentado, manos sobre las rodillas',
};
const START_SHORT = { surrender: 'Manos arriba', unloaded: 'Arma descargada', table: 'Arma en la mesa', back: 'De espaldas', seated: 'Sentado' };
const START_EXTRA = { holster: 0, surrender: 0.3, unloaded: 1.4, table: 1.2, back: 0.9, seated: 0.7 }; // segundos extra que suele costar cada salida
export const defaultCond = () => ({ hand: 'free', start: 'holster', reload: false, note: '' });
export function condParts(c) {
  if (!c) return [];
  const out = [];
  if (c.hand === 'strong') out.push('Mano fuerte');
  if (c.hand === 'weak') out.push('Mano débil');
  if (c.start && c.start !== 'holster') out.push(START_SHORT[c.start] || c.start);
  if (c.reload) out.push('Recarga obligatoria');
  if (c.note) out.push(c.note);
  return out;
}
export const condText = (c) => condParts(c).join(' · ');

// ---- retos de «Desafíos»: rondas con condiciones y tiempos que se aprietan ----
// tight = cuánto se aprieta el tiempo en esa ronda (1 = normal; 0,8 = 20 % menos)
export const CHALLENGES = [
  { id: 'auto', name: 'Reto aleatorio progresivo', desc: 'Condiciones al azar en cada ronda y tiempos que se van apretando.' },
  { id: 'weak', name: 'Mano débil progresiva', desc: 'De mano fuerte a mano débil, cada vez con menos tiempo.',
    rounds: [{ hand: 'strong', tight: 1 }, { hand: 'weak', tight: 1 }, { hand: 'weak', tight: 0.86 }, { hand: 'weak', tight: 0.74 }] },
  { id: 'switch', name: 'Mano fuerte / débil alternas', desc: 'Alterna manos y aprieta el tiempo en la segunda vuelta.',
    rounds: [{ hand: 'strong', tight: 1 }, { hand: 'weak', tight: 1 }, { hand: 'strong', tight: 0.8 }, { hand: 'weak', tight: 0.85 }] },
  { id: 'reload', name: 'Recarga bajo presión', desc: 'Cambio de cargador obligatorio en cada repetición.',
    rounds: [{ reload: true, tight: 1 }, { reload: true, tight: 0.88 }, { reload: true, hand: 'strong', tight: 1 }, { reload: true, tight: 0.76 }] },
  { id: 'unloaded', name: 'Desde arma descargada', desc: 'Salidas con el arma descargada en la funda o sobre la mesa.',
    rounds: [{ start: 'unloaded', tight: 1 }, { start: 'table', tight: 1 }, { start: 'unloaded', tight: 0.85 }, { start: 'table', reload: true, tight: 0.9 }] },
  { id: 'starts', name: 'Salidas exigentes', desc: 'Manos arriba, de espaldas y sentado.',
    rounds: [{ start: 'surrender', tight: 1 }, { start: 'back', tight: 1 }, { start: 'seated', tight: 1 }, { start: 'surrender', tight: 0.8 }] },
  { id: 'match', name: 'Reto de competición', desc: 'Todo mezclado, como en una competición: salidas, recarga y mano débil.',
    rounds: [{ tight: 1 }, { start: 'surrender', tight: 0.92 }, { reload: true, tight: 0.9 }, { hand: 'weak', tight: 1 }, { start: 'unloaded', reload: true, tight: 0.85 }] },
];
export function autoRounds(r = Math.random) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const tights = [1, 0.92, 0.84, 0.76];
  return tights.map((tight, i) => {
    const c = { tight };
    if (i > 0 && r() < 0.45) c.hand = pick(['strong', 'weak']);
    if (r() < 0.45) c.start = pick(['surrender', 'unloaded', 'table', 'back', 'seated']);
    if (r() < 0.35) c.reload = true;
    return c;
  });
}
// niveles de dificultad (tiempo): 1 = iniciación, muy holgado · 10 = élite, muy justo
export const LEVELS = 10;
export const levelFactor = (L) => 1.55 - 0.1 * (Math.min(LEVELS, Math.max(1, L)) - 1);
export const levelName = (L) => (L <= 2 ? 'Iniciación' : L <= 4 ? 'Básico' : L <= 6 ? 'Intermedio' : L <= 8 ? 'Avanzado' : 'Élite');
// tiempo «normal» para resolver un escenario con dos manos desde la funda
export function stageBaseTime(stage) {
  let shots = 0;
  for (const it of stage?.items || []) {
    if (it.type === 'paper') shots += String(it.style?.kind || '').startsWith('double') ? 4 : 2;
    else if (it.type === 'popper' || it.type === 'plate') shots += 1;
    else if (it.type === 'mover') shots += 2;
  }
  return 1.3 + Math.max(2, shots) * 0.42;
}
// tiempo «de referencia» de una ronda (factor 1): escenario + salida + recarga + mano, con su ajuste de la progresión
export function roundRaw(base, cond, tight) {
  const c = cond || {};
  return (base + (START_EXTRA[c.start] || 0) + (c.reload ? 2.2 : 0)) * (c.hand && c.hand !== 'free' ? 1.35 : 1) * (tight || 1);
}
export const roundTimeF = (base, cond, tight, F) => Math.max(1.5, Math.round(roundRaw(base, cond, tight) * F * 2) / 2);
export function roundTime(base, cond, tight, level) { return roundTimeF(base, cond, tight, levelFactor(level)); }
// nivel equivalente a un ritmo (factor de tiempo): 1,55 → nivel 1 · 0,65 → nivel 10
export const levelFromFactor = (F) => Math.min(LEVELS, Math.max(1, Math.round((1.55 - F) / 0.1 + 1)));

export const MOVER_LABEL = { none: 'Sin móvil', random: 'Móvil aleatorio', swinger: 'Balancín', drop: 'Drop turner', slider: 'Deslizante', bobber: 'Emergente' };
export const DIST_LABEL = { close: 'Cerca (6–9 m)', mid: 'Media (7–13 m)', far: 'Lejos (10–18 m)', mixed: 'Mixta' };

export function newStageBlock() {
  return {
    id: uid(), type: 'stage', name: 'Poppers + móvil',
    comp: {
      paper: 2, ns: 0, nsTilt: 0, double: 0, doubleNs: 0, styleRandom: false, hard: 0, hardPreset: 'random',
      poppers: 3, popSize: 'full', plates: 0, mover: 'random', moverStyle: 'normal', moverHard: 'none', moverNS: 'none', dist: 'mixed', theme: -1,
    },
    activatorAt: 1.0, par: 3, reps: 10, rest: 5, startMode: 'fixed', vary: false, withMove: false, restAfter: 10, layout: null, port: null,
  };
}
export const defaultComp = () => ({
  paper: 2, ns: 0, nsTilt: 0, double: 0, doubleNs: 0, styleRandom: false, hard: 0, hardPreset: 'random',
  poppers: 1, popSize: 'full', plates: 0, mover: 'none', moverStyle: 'normal', moverHard: 'none', moverNS: 'none', dist: 'mixed', theme: -1,
});
export function newCoursePosition(dir = 'right') {
  return { id: uid(), dir, time: 3, advance: 'camera', moveDelay: 1, activatorAt: 1.0, comp: defaultComp(), layout: null, port: null };
}
export function newCourseBlock() {
  return {
    id: uid(), type: 'course', name: 'Recorrido personalizado',
    positions: [newCoursePosition('none'), newCoursePosition('right'), newCoursePosition('left')],
    reps: 3, rest: 15, startMode: 'fixed', restAfter: 10,
  };
}
// ---- ejercicio único: secuencia de posiciones (con modo aleatorio global opcional) ----
export const defaultRandom = () => ({ on: false, count: 6, time: 1, activators: 'sometimes', advance: 'camera', moveDelay: 1, walls: true, portDelay: 0 });
// muro con ventana aleatorio (escenarios aleatorios): con cámara se abre al agacharte; en automático, solo a los `at` s
export const WALL_RATE = 0.3; // proporción de escenarios aleatorios que empiezan tras un muro
export function randomPort(advance = 'camera', at = 1, r = Math.random) {
  return { on: true, w: Math.round((0.4 + r() * 0.2) * 100) / 100, h: Math.round((0.26 + r() * 0.1) * 100) / 100, x: Math.round((r() - 0.5) * 50) / 100,
    style: ['ply', 'wood', 'dark'][Math.floor(r() * 3)], open: advance === 'auto' ? 'auto' : 'camera', at };
}
export function newExercise() {
  const p = newCoursePosition('random');
  p.comp = { ...p.comp, poppers: 2, mover: 'none' };
  return { id: uid(), type: 'course', name: 'Ejercicio', positions: [p], reps: 5, rest: 10, startMode: 'fixed', restAfter: 10, startMove: false, maxTime: 0, random: defaultRandom(), cond: defaultCond() };
}
// Convierte los tipos antiguos (escenario con tiempo / recorrido aleatorio) al ejercicio único
export function migrateBlock(b) {
  if (!b) return b;
  if (b.type === 'stage') {
    const pos = newCoursePosition(b.withMove ? 'random' : 'none');
    Object.assign(pos, { time: b.par ?? 3, activatorAt: b.activatorAt ?? 1, comp: b.comp, layout: b.layout, port: b.port || null, randomScene: !!b.vary });
    return { id: b.id, type: 'course', name: b.name, positions: [pos], reps: b.reps ?? 5, rest: b.rest ?? 5, startMode: b.startMode || 'fixed', restAfter: b.restAfter ?? 10, startMove: !!b.withMove, maxTime: 0, random: defaultRandom() };
  }
  if (b.type === 'arena') {
    return { id: b.id, type: 'course', name: b.name, positions: [newCoursePosition('none')], reps: 1, rest: 10, startMode: 'fixed', restAfter: b.restAfter ?? 10, startMove: false, maxTime: 0,
      random: { on: true, count: b.moves ? b.moves + 1 : 0, time: b.delay ?? 1, activators: b.activators || 'sometimes', advance: b.advance || 'camera', moveDelay: b.moveDelay ?? 1 } };
  }
  if (b.type === 'course') {
    b.cond = { ...defaultCond(), ...(b.cond || {}) };
    b.startMove ??= false; b.maxTime ??= 0; b.random = { ...defaultRandom(), ...(b.random ? { walls: false } : {}), ...(b.random || {}) }; // los aleatorios ya guardados siguen sin muros
    b.positions.forEach((pp) => { pp.randomScene ??= false; pp.port ??= null; });
  }
  return b;
}
export function migrateProgram(p) { if (p?.blocks) p.blocks = p.blocks.map(migrateBlock); return p; }

export const DIR_LABEL = { none: 'Inicio', left: '← Izquierda', right: 'Derecha →', random: '↔ Aleatoria' };
export const DIR_ARROW = { none: '●', left: '←', right: '→', random: '↔' };
export function newArenaBlock() {
  return { id: uid(), type: 'arena', name: 'Recorrido con desplazamientos', moves: 10, delay: 1, activators: 'sometimes', advance: 'camera', moveDelay: 1, restAfter: 10 };
}
export function newProgram(name = 'Nuevo entrenamiento') {
  const now = Date.now();
  return { id: uid(), name, notes: '', created: now, updated: now, blocks: [newExercise()] };
}
export function exampleProgram() {
  const p = newProgram('Ejemplo · Poppers, móvil y recorrido');
  p.blocks[0].name = 'Poppers + móvil'; p.blocks[0].positions[0].comp.mover = 'random'; p.blocks[0].positions[0].time = 3;
  const course = migrateBlock(newCourseBlock()); course.name = 'Recorrido de 3 posiciones';
  course.positions[1].comp.mover = 'swinger';
  p.blocks.push(course);
  const rnd = newExercise(); rnd.name = 'Desplazamientos aleatorios'; rnd.reps = 1; rnd.random = { ...defaultRandom(), on: true, count: 9 };
  p.blocks.push(rnd);
  return p;
}

const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
export function compSummary(c) {
  const parts = [];
  if (c.paper) {
    const st = c.styleRandom ? ['estilos aleatorios'] : [
      c.ns && `${c.ns} NS`, c.nsTilt && `${c.nsTilt} NS incl.`, c.double && `${c.double} dobles`, c.doubleNs && `${c.doubleNs} dobles NS`, c.hard && `${c.hard} cob.`,
    ].filter(Boolean);
    parts.push(plural(c.paper, 'tarjeta', 'tarjetas') + (st.length ? ` (${st.join(', ')})` : ''));
  }
  if (c.poppers) parts.push(plural(c.poppers, c.popSize === 'mini' ? 'mini popper' : 'popper', c.popSize === 'mini' ? 'mini poppers' : 'poppers'));
  if (c.plates) parts.push(plural(c.plates, 'plato', 'platos'));
  if (c.mover && c.mover !== 'none') parts.push(MOVER_LABEL[c.mover].toLowerCase());
  return parts.join(' · ') || 'Escenario vacío';
}
const fmtS = (s) => `${(+s).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`;
export function blockSummary(b) {
  if (b.type === 'course') {
    const ct = condText(b.cond);
    const extra = `${b.startMove ? ' · empieza desplazándote' : ''}${b.maxTime ? ` · máx. ${fmtS(b.maxTime)}` : ''}${ct ? ` · ${ct}` : ''}`;
    if (b.random?.on) return `Aleatorio · ${b.random.count ? plural(b.random.count, 'posición', 'posiciones') : 'posiciones sin fin'} · ${b.reps}×${b.reps > 1 ? ` · descanso ${fmtS(b.rest)}` : ''}${extra}`;
    const n = b.positions.length;
    const head = n === 1 ? `${compSummary(b.positions[0].comp)} · ${fmtS(b.positions[0].time)}` : `${plural(n, 'posición', 'posiciones')}`;
    return `${head} · ${b.reps}×${b.reps > 1 ? ` · descanso ${fmtS(b.rest)}` : ''}${extra}`;
  }
  if (b.type === 'arena') return `${b.moves ? plural(b.moves, 'desplazamiento', 'desplazamientos') : 'Desplazamientos sin fin'} · flecha a ${fmtS(b.delay)}`;
  return `${compSummary(b.comp)} · ${fmtS(b.par)} máx. · ${b.reps}× · descanso ${fmtS(b.rest)}${b.withMove ? ' · con desplazamiento' : ''}`;
}
// duración aproximada en segundos
export function blockDuration(b, isLast = false) {
  const tail = isLast ? 0 : Math.max(3, b.restAfter || 0);
  if (b.type === 'arena') return (b.moves || 20) * ((b.delay || 1) + 1.6) + 3 + tail;
  if (b.type === 'course') {
    let one = b.random?.on ? (b.random.count || 20) * ((b.random.time || 1) + 1.6)
      : b.positions.reduce((t, p) => t + (p.time || 0), 0) + Math.max(0, b.positions.length - 1) * 1.5;
    if (b.startMove) one += 1.5;
    if (b.maxTime) one = Math.min(one, b.maxTime);
    return b.reps * one + Math.max(0, b.reps - 1) * b.rest + 3 + tail;
  }
  return b.reps * b.par + Math.max(0, b.reps - 1) * b.rest + (b.withMove ? b.reps * 1.5 : 0) + 3 + tail;
}
export function programDuration(p) {
  return p.blocks.reduce((t, b, i) => t + blockDuration(b, i === p.blocks.length - 1), 0);
}
export function fmtDuration(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}

// --- compartir: el entrenamiento viaja dentro del propio enlace (#prog=...) ---
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
export function shareUrl(p) {
  const { id, created, updated, ...data } = p;
  data.blocks = (data.blocks || []).map((b) => (b.sheet ? { ...b, sheet: { ...b.sheet, img: null } } : b)); // la imagen del PDF es demasiado grande para un enlace
  return `${location.origin}${location.pathname}#prog=${b64urlEncode(JSON.stringify({ v: 1, ...data }))}`;
}
export function programFromHash(hash) {
  const m = /#prog=([A-Za-z0-9_-]+)/.exec(hash || '');
  if (!m) return null;
  try {
    const d = JSON.parse(b64urlDecode(m[1]));
    return sanitizeProgram(d);
  } catch { return null; }
}

// Normaliza un entrenamiento importado (enlace o archivo) para que no rompa la app.
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const oneOf = (v, opts, d) => (opts.includes(v) ? v : d);
export function sanitizeProgram(d) {
  if (!d || !Array.isArray(d.blocks)) return null;
  const now = Date.now();
  const blocks = d.blocks.slice(0, 30).map((b) => {
    if (b?.type === 'arena') {
      return { id: uid(), type: 'arena', name: String(b.name || 'Recorrido').slice(0, 60), moves: num(b.moves, 10, 0, 200), delay: num(b.delay, 1, 0.3, 10), activators: oneOf(b.activators, ['never', 'sometimes', 'always'], 'sometimes'), advance: oneOf(b.advance, ['camera', 'auto'], 'camera'), moveDelay: num(b.moveDelay, 1, 0.2, 30), restAfter: num(b.restAfter, 10, 0, 600) };
    }
    if (b?.type === 'course' && Array.isArray(b.positions) && b.positions.length) {
      return {
        id: uid(), type: 'course', name: String(b.name || 'Recorrido').slice(0, 60),
        positions: b.positions.slice(0, 12).map((p, i) => ({
          id: uid(), dir: oneOf(p?.dir, ['none', 'left', 'right', 'random'], i === 0 ? 'none' : 'right'), time: num(p?.time, 3, 0.5, 60), arrowAt: num(p?.arrowAt, 1, 0.3, 10), randomScene: !!p?.randomScene,
          advance: oneOf(p?.advance, ['camera', 'auto'], 'camera'), moveDelay: num(p?.moveDelay, 1, 0.2, 30),
          activatorAt: num(p?.activatorAt, 1, 0.5, 10), comp: sanitizeComp(p?.comp), layout: sanitizeLayout(p?.layout), port: sanitizePort(p?.port),
        })),
        reps: num(b.reps, 3, 1, 100), rest: num(b.rest, 15, 0, 600), startMode: oneOf(b.startMode, ['fixed', 'random'], 'fixed'), restAfter: num(b.restAfter, 10, 0, 600),
        startMove: !!b.startMove, maxTime: num(b.maxTime, 0, 0, 600),
        cond: { hand: oneOf(b.cond?.hand, ['free', 'strong', 'weak'], 'free'), start: oneOf(b.cond?.start, Object.keys(START_LABEL), 'holster'), reload: !!b.cond?.reload, note: String(b.cond?.note || '').slice(0, 60) },
        random: { on: !!b.random?.on, count: num(b.random?.count, 6, 0, 200), time: num(b.random?.time, 1, 0.3, 60), activators: oneOf(b.random?.activators, ['never', 'sometimes', 'always'], 'sometimes'),
          advance: oneOf(b.random?.advance, ['camera', 'auto'], 'camera'), moveDelay: num(b.random?.moveDelay, 1, 0.2, 30), walls: !!b.random?.walls, portDelay: num(b.random?.portDelay, 0, 0, 30) },
      };
    }
    return {
      id: uid(), type: 'stage', name: String(b?.name || 'Escenario').slice(0, 60),
      comp: sanitizeComp(b?.comp),
      activatorAt: num(b?.activatorAt, 1, 0.5, 10), par: num(b?.par, 3, 0.5, 120), reps: num(b?.reps, 10, 1, 100), rest: num(b?.rest, 5, 0, 600),
      startMode: oneOf(b?.startMode, ['fixed', 'random'], 'fixed'), vary: !!b?.vary, withMove: !!b?.withMove, restAfter: num(b?.restAfter, 10, 0, 600),
      layout: sanitizeLayout(b?.layout), port: sanitizePort(b?.port),
    };
  });
  return migrateProgram({ id: uid(), name: String(d.name || 'Entrenamiento compartido').slice(0, 80), notes: String(d.notes || '').slice(0, 500), created: now, updated: now, blocks });
}

function sanitizeComp(c = {}) {
  c = c || {};
  const paper = num(c.paper, 2, 0, 8);
  const kindOpts = ['normal', 'ns-side', 'ns-tilt', 'double', 'double-ns', 'random'];
  const hardOpts = ['random', 'diag', 'band', 'corner', 'side', 'bottom'];
  if (c.hardPreset === 'top') c = { ...c, hardPreset: 'bottom' };
  if (c.moverHard === 'top') c = { ...c, moverHard: 'bottom' };
  return {
    paper, ns: num(c.ns, 0, 0, paper), nsTilt: num(c.nsTilt, 0, 0, paper), double: num(c.double, 0, 0, paper), doubleNs: num(c.doubleNs, 0, 0, paper),
    styleRandom: !!c.styleRandom, hard: num(c.hard, 0, 0, paper), hardPreset: oneOf(c.hardPreset, hardOpts, 'random'),
    poppers: num(c.poppers, 3, 0, 6), popSize: oneOf(c.popSize, ['full', 'mini', 'mixed'], 'full'), plates: num(c.plates, 0, 0, 6),
    mover: oneOf(c.mover, Object.keys(MOVER_LABEL), 'none'), moverStyle: oneOf(c.moverStyle, kindOpts, 'normal'),
    moverHard: oneOf(c.moverHard, ['none', ...hardOpts], 'none'), moverNS: oneOf(c.moverNS, ['none', 'yes', 'random'], 'none'),
    dist: oneOf(c.dist, Object.keys(DIST_LABEL), 'mixed'), theme: num(c.theme, -1, -1, 4),
  };
}
// La disposición se dibuja en canvas (nunca como HTML); aun así se limita el tamaño
function sanitizeLayout(l) {
  if (!l || !Array.isArray(l.items)) return null;
  return { seed: num(l.seed, 1, 0, 1e12), theme: num(l.theme, 0, 0, 4), manual: !!l.manual, items: l.items.slice(0, 60).filter((i) => i && typeof i === 'object') };
}

export const defaultPort = () => ({ on: true, w: 0.55, h: 0.32, x: 0, style: 'ply', open: 'camera', at: 2 });
function sanitizePort(pt) {
  if (!pt || typeof pt !== 'object') return null;
  return { on: !!pt.on, w: num(pt.w, 0.55, 0.15, 0.95), h: num(pt.h, 0.32, 0.08, 0.7), x: num(pt.x, 0, -0.45, 0.45),
    style: oneOf(pt.style, ['ply', 'dark', 'wood'], 'ply'), open: oneOf(pt.open, ['camera', 'auto'], 'camera'), at: num(pt.at, 2, 0.2, 60) };
}
