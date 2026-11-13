// Entrenador de Desafíos: catálogo de ejercicios (drills), modelo de rendimiento y seguimiento del tirador.
//
// Rendimiento como en la clasificación IPSC/USPSA: % respecto a un tiempo de referencia de élite para ese
// ejercicio y esas condiciones (escenario, disparos, salida, desplazamiento, muro, recarga, mano).
// Clases: D < 40 % · C 40–60 · B 60–75 · A 75–85 · M 85–95 · GM ≥ 95. Nivel 1–100 = tu media (lenta).
import { composeStage, layoutOf } from './course.js?v=20261113-1732';
import { ACT } from './scene.js?v=20261113-1732';
import { defaultCond, defaultRandom, randomPort, START_LABEL } from './program.js?v=20261113-1732';

// ---------------- catálogo ----------------
// scene: composición del escenario (siempre el mismo en todo el desafío) · shots: disparos por repetición
// rounds: [{ hand, start, reload, move (salida con desplazamiento), port (muro con ventana), tight, note }]
// tight < 1 aprieta el tiempo en esa ronda (progresión dentro del desafío)
export const DRILL_CATS = [['basic', 'Básicos'], ['starts', 'Salidas'], ['tech', 'Técnica'], ['match', 'Competición']];
const T4 = [1, 0.94, 0.88, 0.82];
const rep = (base, tights = T4) => tights.map((tight) => ({ ...base, tight }));
export const DRILLS = [
  { id: 'draw', cat: 'basic', name: 'Desenfunde rápido', desc: 'Desenfunde y dos disparos a una tarjeta cercana. La base de todo.',
    scene: { paper: 1, dist: 'close' }, shots: 2, rounds: rep({ note: 'Desenfunde y 2 disparos' }) },
  { id: 'draw-mover', cat: 'basic', name: 'Desenfunde al móvil', desc: 'Desenfunde, tumba el popper activador y resuelve el móvil y la tarjeta.',
    scene: { paper: 1, poppers: 1, mover: 'random', dist: 'mid' }, shots: 5, rounds: rep({ note: 'Popper primero: activa el móvil' }) },
  { id: 'nearfar', cat: 'basic', name: 'Cerca y lejos', desc: 'Una tarjeta cercana y otra lejana: cambia el ritmo, rápido cerca y preciso lejos.',
    scene: { paper: 2, dist: 'mid', props: false }, shots: 4, extra: 0.4, place: placeNearFar,
    rounds: [{ note: '2 a la cercana → 2 a la lejana', tight: 1 }, { note: '2 a la lejana → 2 a la cercana', tight: 0.94 }, { note: '2 a la cercana → 2 a la lejana', tight: 0.88 }, { note: '2 a la lejana → 2 a la cercana', tight: 0.82 }] },
  { id: 'transition', cat: 'basic', name: 'Transición rápida a plato', desc: 'Tarjeta con no‑shoot a un lado y plato al otro, bien separados: entrena la transición larga y frenar en el plato.',
    scene: { paper: 1, ns: 1, plates: 1, dist: 'mid', props: false }, shots: 3, extra: 0.35, place: placeTransition,
    rounds: [{ note: '2 a la tarjeta → plato', tight: 1 }, { note: 'Plato → 2 a la tarjeta', tight: 0.94 }, { note: '2 a la tarjeta → plato', tight: 0.88 }, { note: 'Plato → 2 a la tarjeta', tight: 0.82 }] },
  { id: 'blake', cat: 'basic', name: 'Blake Drill', desc: 'Tres tarjetas, dos disparos a cada una: transiciones limpias.',
    scene: { paper: 3, dist: 'close' }, shots: 6, rounds: rep({ note: '2 disparos a cada tarjeta' }) },

  { id: 'move', cat: 'starts', name: 'Salida con desplazamiento', desc: 'A la señal te desplazas hacia la flecha y resuelves al llegar.',
    scene: { paper: 3, dist: 'mid' }, shots: 6, rounds: rep({ move: true, note: 'Resuelve al llegar' }) },
  { id: 'move-mover', cat: 'starts', name: 'Desplazamiento y móvil', desc: 'Salida con desplazamiento a un escenario con popper activador y móvil.',
    scene: { paper: 2, poppers: 1, mover: 'random', dist: 'mid' }, shots: 7, rounds: rep({ move: true, note: 'Popper primero: activa el móvil' }) },
  { id: 'port', cat: 'starts', name: 'Muro con ventana', desc: 'El escenario solo se ve por una ventana baja: agáchate y dispara.',
    scene: { paper: 3, poppers: 1, dist: 'mid' }, shots: 7, rounds: rep({ port: true, note: 'Agáchate y dispara por la ventana' }) },
  { id: 'unloaded', cat: 'starts', name: 'Desde arma descargada', desc: 'Salidas con el arma descargada en la funda o sobre la mesa.',
    scene: { paper: 2, poppers: 1, dist: 'mid' }, shots: 5,
    rounds: [{ start: 'unloaded', tight: 1 }, { start: 'table', tight: 1 }, { start: 'unloaded', tight: 0.88 }, { start: 'table', reload: true, tight: 0.9 }] },
  { id: 'starts', cat: 'starts', name: 'Salidas exigentes', desc: 'Manos arriba, de espaldas, sentado y con desplazamiento.',
    scene: { paper: 3, dist: 'mid' }, shots: 6,
    rounds: [{ start: 'surrender', tight: 1 }, { start: 'back', tight: 1 }, { start: 'seated', tight: 1 }, { start: 'surrender', move: true, tight: 0.92 }] },

  { id: 'weak', cat: 'tech', name: 'Mano débil progresiva', desc: 'De mano fuerte a mano débil, cada vez con menos tiempo.',
    scene: { paper: 2, poppers: 1, dist: 'close' }, shots: 5,
    rounds: [{ hand: 'strong', tight: 1 }, { hand: 'weak', tight: 1 }, { hand: 'weak', tight: 0.9 }, { hand: 'weak', tight: 0.82 }] },
  { id: 'switch', cat: 'tech', name: 'Fuerte / débil alternas', desc: 'Alterna manos y aprieta el tiempo en la segunda vuelta.',
    scene: { paper: 2, poppers: 1, dist: 'close' }, shots: 5,
    rounds: [{ hand: 'strong', tight: 1 }, { hand: 'weak', tight: 1 }, { hand: 'strong', tight: 0.86 }, { hand: 'weak', tight: 0.88 }] },
  { id: 'reload', cat: 'tech', name: 'Recarga bajo presión', desc: 'Cambio de cargador obligatorio entre las tarjetas.',
    scene: { paper: 3, dist: 'mid' }, shots: 6,
    rounds: [{ reload: true, tight: 1 }, { reload: true, tight: 0.92 }, { reload: true, hand: 'strong', tight: 1 }, { reload: true, tight: 0.84 }].map((r) => ({ ...r, note: 'Recarga entre tarjetas' })) },
  { id: 'steel', cat: 'tech', name: 'Metal rápido', desc: 'Solo poppers y platos: velocidad pura y transiciones cortas.',
    scene: { paper: 0, poppers: 3, plates: 3, popSize: 'mixed', dist: 'mid' }, shots: 6, rounds: rep({ note: 'Un disparo a cada metal' }) },
  { id: 'precision', cat: 'tech', name: 'Precisión con no‑shoots', desc: 'Tarjetas con no‑shoots y coberturas a media distancia: solo zona A.',
    scene: { paper: 3, ns: 1, nsTilt: 1, hard: 1, dist: 'mid' }, shots: 6, rounds: rep({ note: 'Solo zona A · cuidado con los no‑shoots' }, [1, 0.95, 0.9, 0.86]) },
  { id: 'long', cat: 'tech', name: 'Larga distancia', desc: 'Tarjetas lejanas: alineación de miras y control del disparo.',
    scene: { paper: 3, dist: 'far' }, shots: 6, rounds: rep({ note: 'Tarjetas lejanas: aprieta limpio' }, [1, 0.95, 0.9, 0.86]) },

  { id: 'presidente', cat: 'match', name: 'El Presidente', desc: 'De espaldas: gira, 2 a cada tarjeta, recarga y otros 2 a cada una.',
    scene: { paper: 3, dist: 'close' }, shots: 12, rounds: rep({ start: 'back', reload: true, note: 'Gira · 2 a cada una · recarga · 2 a cada una' }) },
  { id: 'match', cat: 'match', name: 'Reto de competición', desc: 'Como en una competición: salidas, desplazamiento, recarga y mano débil.',
    scene: { paper: 3, poppers: 1, plates: 1, mover: 'random', dist: 'mixed', styleRandom: true }, shots: 10,
    rounds: [{ tight: 1 }, { start: 'surrender', move: true, tight: 0.94 }, { reload: true, tight: 0.92 }, { hand: 'weak', tight: 1 }, { start: 'unloaded', reload: true, tight: 0.88 }] },
  { id: 'auto', cat: 'match', name: 'Reto aleatorio progresivo', desc: 'Escenario y condiciones al azar, cada vez con menos tiempo.', random: true },
];
export const drillById = (id) => DRILLS.find((d) => d.id === id) || DRILLS[0];

// colocación fija de algunos desafíos (sobre la disposición ya generada). Se quita el atrezo central
// para que nada tape ni estorbe la transición; se mantiene el de los laterales.
const keepSides = (items) => items.filter((i) => ['paper', 'plate', 'popper', 'mover'].includes(i.type) || Math.abs(i.x) > 1);
function placeTransition(items, r) {
  const side = r() < 0.5 ? -1 : 1, paper = items.find((i) => i.type === 'paper'), plate = items.find((i) => i.type === 'plate');
  if (paper) { Object.assign(paper, { x: side * (0.52 + r() * 0.1), d: 7.5 + r() * 1.5 }); if (paper.style?.ns) paper.style.ns.side = -side; } // no-shoot hacia el centro
  if (plate) Object.assign(plate, { x: -side * (0.58 + r() * 0.1), d: 8 + r() * 2 });
  return keepSides(items);
}
function placeNearFar(items, r) {
  const side = r() < 0.5 ? -1 : 1, [a, b] = items.filter((i) => i.type === 'paper');
  if (a) Object.assign(a, { x: side * (0.4 + r() * 0.12), d: 6.3 + r() * 0.8 });
  if (b) Object.assign(b, { x: -side * (0.3 + r() * 0.15), d: 16 + r() * 2.5 });
  return keepSides(items);
}

// rondas al azar para el reto aleatorio
function randomDrill(r = Math.random) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const scene = { paper: 2 + Math.floor(r() * 3), poppers: Math.floor(r() * 3), plates: Math.floor(r() * 2), mover: r() < 0.35 ? 'random' : 'none', dist: pick(['close', 'mid', 'mixed']), styleRandom: true };
  if (scene.mover !== 'none' && !scene.poppers) scene.poppers = 1;
  const rounds = [1, 0.94, 0.88, 0.82].map((tight, i) => {
    const c = { tight };
    if (i > 0 && r() < 0.4) c.hand = pick(['strong', 'weak']);
    if (r() < 0.4) c.start = pick(['surrender', 'unloaded', 'table', 'back', 'seated']);
    if (r() < 0.3) c.reload = true;
    if (r() < 0.25) c.move = true; else if (r() < 0.2) c.port = true;
    return c;
  });
  return { scene, rounds, shots: scene.paper * 2 + scene.poppers + scene.plates + (scene.mover !== 'none' ? 2 : 0) };
}

// ---------------- modelo de tiempos ----------------
const START_EXTRA = { holster: 0, surrender: 0.3, unloaded: 1.4, table: 1.2, back: 0.9, seated: 0.7 };
// referencia de élite EN SECO (sin retroceso se va más rápido que con fuego real): un GM hace el ejercicio
// en el 42 % del tiempo «normal» (p. ej. desenfunde + 2 a 7 m en 0,9 s). Así un buen tirador no llega arriba de inicio.
const ELITE = 0.42;
// tiempo «normal» de una ronda (sin la presión de la progresión)
export function roundRef(shots, r, extra = 0) {
  const t = 1.3 + extra + shots * 0.42 + (START_EXTRA[r.start] || 0) + (r.reload ? 2.2 : 0) + (r.move ? 1.1 : 0) + (r.port ? 0.8 : 0);
  return t * (r.hand && r.hand !== 'free' ? 1.35 : 1);
}
export const eliteTime = (shots, r, extra = 0) => roundRef(shots, r, extra) * ELITE;

// ---------------- límites físicos del escenario ----------------
// El tiempo de élite nunca puede ser menor que lo que el propio escenario tarda en dejarte disparar:
// el desplazamiento de salida, la ventana del muro abriéndose o el móvil apareciendo tras el popper activador.
export const ACTIVATOR_AT = 1.3; // el popper activador (el primer disparo, al que activa el móvil) cae a los 1,3 s
const MOVE_SHOW = 0.7 + 0.7;     // salida con desplazamiento: flecha 0,7 s + transición 0,7 s
const PORT_OPEN = 1.1;           // la ventana del muro tarda 1,1 s en abrirse
function moverAppearsAt(at = ACTIVATOR_AT) { // segundos desde que se ve el escenario hasta que el móvil empieza a moverse
  const ms = at * 1000;
  if (ms < ACT.fallStart) return (ACT.moverStart / (ACT.fallStart / ms)) / 1000;
  return (ms - ACT.fallStart + ACT.moverStart) / 1000;
}
function physicalFloor(scene, rd, shots) {
  const shown = rd.move ? MOVE_SHOW : rd.port ? PORT_OPEN : 0;
  let floor = shown + 0.25 + shots * 0.15;
  if (scene?.mover && scene.mover !== 'none') floor = Math.max(floor, shown + moverAppearsAt() + 0.2 + 2 * 0.15);
  return floor;
}
// redondeo según la duración (5 centésimas en los muy cortos, décimas en los cortos)
export const roundPar = (t) => (t < 3 ? Math.round(t * 20) / 20 : t < 6 ? Math.round(t * 10) / 10 : Math.round(t * 2) / 2);
// margen tras tu tiempo: +1 s en ejercicios largos, unas décimas en los cortos
export const marginFor = (t) => Math.max(0.25, Math.min(1, t * 0.12));
// tiempo para una ronda con un ritmo dado (pace = % de élite / 100)

export function parFor(elite, pace, tight) {
  const t = (elite / Math.max(0.15, pace)) * (tight || 1);
  return roundPar(t + marginFor(t));
}

// ---------------- clases ----------------
export const CLASSES = [['GM', 95, 'Grand Master'], ['M', 85, 'Master'], ['A', 75, 'Clase A'], ['B', 60, 'Clase B'], ['C', 40, 'Clase C'], ['D', 0, 'Clase D']];
export const classOf = (pct) => (CLASSES.find(([, min]) => pct >= min) || CLASSES[CLASSES.length - 1]);
export const fmtPct = (p) => `${(Math.round(p * 10) / 10).toString().replace('.', ',')} %`;

// ---------------- niveles de progresión (1–10, por desafío) ----------------
// Se ganan, no se miden: para subir al nivel N hace falta una sesión COMPLETA (todas las rondas)
// con un umbral ≥ LEVEL_REQ[N]. Como mucho se sube un nivel por sesión.
export const LEVELS = 10;
export const LEVEL_NAMES = ['', 'Iniciación', 'Novato', 'Básico', 'Intermedio', 'Competidor', 'Avanzado', 'Experto', 'Maestro', 'Élite', 'Leyenda'];
export const LEVEL_REQ = [0, 0, 28, 36, 44, 52, 60, 68, 76, 85, 93];
export const levelName = (L) => LEVEL_NAMES[Math.max(1, Math.min(LEVELS, L))];

// ---------------- historial del tirador (en el perfil) ----------------
// d.coach = { [drillId]: { v, skill (media lenta, %), best (%), rounds, level, pace, sessions: [{ t, avg, best, ok }] } }
// La media parte del 25 % y se mueve un 12 % por ronda: hacen falta varias sesiones para subir de clase.
const PRIOR = 25, ALPHA = 0.12;
export const PROVISIONAL = 12; // rondas antes de que la clase sea definitiva
export function statOf(d, id) {
  const s = d.coach?.[id];
  if (s && s.v !== 2) { delete d.coach[id]; return null; } // datos del sistema anterior (pruebas): se descartan
  return s || null;
}
export function recordRound(d, id, pct) {
  d.coach ??= {};
  const s = statOf(d, id) || (d.coach[id] = { v: 2, skill: PRIOR, best: 0, rounds: 0, level: 1, pace: null, sessions: [] });
  s.skill = s.skill * (1 - ALPHA) + pct * ALPHA;
  s.best = Math.max(s.best || 0, pct);
  s.rounds++;
  return s;
}
// fin de sesión: guarda la media y comprueba si sube de nivel
// fin de sesión: sube de nivel si la sesión está completa, sin ningún «No llegué» y con la media pedida
export function recordSession(d, id, pcts, { fails = 0, complete = false, pace = null, result = null, shots = [] } = {}) {
  if (!pcts.length) return null;
  const s = statOf(d, id); if (!s) return null;
  const avg = result ?? pcts.reduce((a, b) => a + b, 0) / pcts.length;
  const need = s.level < LEVELS ? LEVEL_REQ[s.level + 1] : null;
  const ok = complete && !fails && need != null && avg >= need;
  if (ok) s.level++;
  if (pace) s.pace = +pace.toFixed(3);
  if (shots.length) { // primer disparo medido con el micrófono
    const all = [...(s.shots || []), ...shots].slice(-40);
    s.shots = all.map((x) => +x.toFixed(3));
    s.shotBest = Math.min(s.shotBest ?? Infinity, ...shots);
  }
  s.sessions = [...(s.sessions || []), { t: Date.now(), avg: +avg.toFixed(1), best: +Math.max(...pcts).toFixed(1), ok: complete && !fails }].slice(-30);
  return { avg, levelUp: ok, level: s.level, need, complete, fails };
}
export function resetDrill(d, id) { if (d.coach) delete d.coach[id]; }
// clasificación general: media de los desafíos con al menos 4 rondas
export function overall(d) {
  const list = DRILLS.map((x) => [x.id, statOf(d, x.id)]).filter(([, s]) => s && s.rounds >= 4);
  if (!list.length) return null;
  return { pct: list.reduce((a, [, s]) => a + s.skill, 0) / list.length, n: list.length, levels: list.reduce((a, [, s]) => a + s.level - 1, 0),
    rounds: list.reduce((a, [, s]) => a + s.rounds, 0) };
}
// consejo: lo más flojo de lo que ya haces, o un básico que aún no has probado
export function advice(d) {
  const played = DRILLS.map((x) => [x.id, statOf(d, x.id)]).filter(([, s]) => s);
  const basicNew = DRILLS.find((x) => x.cat === 'basic' && !statOf(d, x.id));
  if (played.length < 3 && basicNew) return { id: basicNew.id, why: 'Empieza por los básicos para medir tu nivel' };
  if (!played.length) return null;
  const [id, s] = played.sort((a, b) => a[1].skill - b[1].skill)[0];
  return { id, why: `Es tu punto más flojo (${fmtPct(s.skill)})` };
}

// ---------------- programa del desafío ----------------
export function buildDrill(drill, d, reps = 5) {
  const def = drill.random ? randomDrill() : drill;
  const stat = statOf(d, drill.id);
  // ritmo de partida: donde lo dejaste la última vez, algo más suave para calentar; nuevo: holgado (35 %)
  const pace = stat?.pace ? stat.pace * 0.96 : 0.35;
  const comp = { paper: 0, poppers: 0, plates: 0, mover: 'none', popSize: 'full', dist: 'mid', styleRandom: false, hard: 0, ...def.scene };
  const stage = composeStage(comp, (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
  const layout = layoutOf(stage);
  if (def.place) layout.items = def.place(layout.items, Math.random);
  const blocks = def.rounds.map((rd, i) => {
    const cond = { ...defaultCond(), hand: rd.hand || 'free', start: rd.start || 'holster', reload: !!rd.reload, note: rd.note || '' };
    const elite = Math.max(eliteTime(def.shots, rd, def.extra || 0), physicalFloor(def.scene, rd, def.shots));
    return {
      id: `r${i}`, type: 'course', name: `Ronda ${i + 1} de ${def.rounds.length}`, cond, tight: rd.tight || 1, elite, rd,
      positions: [{ id: `p${i}`, dir: rd.move ? 'random' : 'none', time: 1, advance: 'auto', moveDelay: 0.7, activatorAt: ACTIVATOR_AT,
        comp, layout, port: rd.port ? randomPort('auto', 0) : null, randomScene: false }],
      reps, rest: 6, startMode: 'random', restAfter: 12, startMove: !!rd.move, maxTime: 0, random: defaultRandom(),
    };
  });
  blocks.forEach((b) => setPar(b, parFor(b.elite, pace, b.tight)));
  return { quick: true, name: drill.name, challenge: { id: drill.id, pace, startSkill: stat?.skill ?? null, startLevel: stat?.level ?? 1, pcts: [], fails: 0 }, blocks };
}

// tiempo límite de la ronda: cuenta desde el beep (incluye el desplazamiento y la ventana del muro)
export function setPar(b, par) { b.par = par; b.maxTime = par; b.positions[0].time = par; }

// instrucciones de un ejercicio (se muestran grandes antes del beep, en cualquier entrenamiento)
const HAND_TXT = { strong: 'Solo mano fuerte', weak: 'Solo mano débil' };
export function instructions(b) {
  const c = b?.cond || {}, lines = [];
  if (c.start && c.start !== 'holster') lines.push(START_LABEL[c.start] || c.start);
  if (HAND_TXT[c.hand]) lines.push(HAND_TXT[c.hand]);
  if (b?.startMove) lines.push('A la señal, desplázate hacia la flecha');
  if (b?.positions?.[0]?.port?.on || b?.port?.on) lines.push('Muro con ventana: agáchate para ver los blancos');
  if (c.reload) lines.push('Recarga obligatoria');
  if (c.note) lines.push(c.note);
  return [...new Set(lines)].slice(0, 4);
}
