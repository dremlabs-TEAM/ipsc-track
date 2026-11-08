// Entrenamientos personalizados: modelo de datos, valores por defecto, resúmenes y enlaces para compartir.
//
// program = { id, name, notes, created, updated, blocks: [block] }
// block (escenario con tiempo) = { id, type: 'stage', name, comp, activatorAt, par, reps, rest, startMode, vary, withMove, restAfter, layout }
//   comp = { paper, ns, hard, poppers, popSize: 'full'|'mini'|'mixed', plates, mover: 'none'|'random'|'swinger'|'drop'|'slider'|'bobber', dist, theme }
// block (recorrido) = { id, type: 'arena', name, moves, delay, activators, restAfter }
import { uid } from './storage.js?v=20261108-2239';

export const MOVER_LABEL = { none: 'Sin móvil', random: 'Móvil aleatorio', swinger: 'Balancín', drop: 'Drop turner', slider: 'Deslizante', bobber: 'Emergente' };
export const DIST_LABEL = { close: 'Cerca (6–9 m)', mid: 'Media (7–13 m)', far: 'Lejos (10–18 m)', mixed: 'Mixta' };

export function newStageBlock() {
  return {
    id: uid(), type: 'stage', name: 'Poppers + móvil',
    comp: { paper: 2, ns: 0, hard: 0, poppers: 3, popSize: 'full', plates: 0, mover: 'random', dist: 'mixed', theme: -1 },
    activatorAt: 1.0, par: 3, reps: 10, rest: 5, startMode: 'fixed', vary: false, withMove: false, restAfter: 10, layout: null,
  };
}
export function newArenaBlock() {
  return { id: uid(), type: 'arena', name: 'Recorrido con desplazamientos', moves: 10, delay: 1, activators: 'sometimes', restAfter: 10 };
}
export function newProgram(name = 'Nuevo entrenamiento') {
  const now = Date.now();
  return { id: uid(), name, notes: '', created: now, updated: now, blocks: [newStageBlock()] };
}
export function exampleProgram() {
  const p = newProgram('Ejemplo · Poppers, móvil y recorrido');
  const b2 = newArenaBlock(); b2.moves = 8;
  p.blocks.push(b2);
  return p;
}

const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
export function compSummary(c) {
  const parts = [];
  if (c.paper) parts.push(plural(c.paper, 'tarjeta', 'tarjetas') + (c.ns ? ` (${c.ns} NS)` : '') + (c.hard ? ` (${c.hard} cob.)` : ''));
  if (c.poppers) parts.push(plural(c.poppers, c.popSize === 'mini' ? 'mini popper' : 'popper', c.popSize === 'mini' ? 'mini poppers' : 'poppers'));
  if (c.plates) parts.push(plural(c.plates, 'placa', 'placas'));
  if (c.mover && c.mover !== 'none') parts.push(MOVER_LABEL[c.mover].toLowerCase());
  return parts.join(' · ') || 'Escenario vacío';
}
const fmtS = (s) => `${(+s).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`;
export function blockSummary(b) {
  if (b.type === 'arena') return `${b.moves ? plural(b.moves, 'desplazamiento', 'desplazamientos') : 'Desplazamientos sin fin'} · flecha a ${fmtS(b.delay)}`;
  return `${compSummary(b.comp)} · ${fmtS(b.par)} máx. · ${b.reps}× · descanso ${fmtS(b.rest)}${b.withMove ? ' · con desplazamiento' : ''}`;
}
// duración aproximada en segundos
export function blockDuration(b, isLast = false) {
  const tail = isLast ? 0 : Math.max(3, b.restAfter || 0);
  if (b.type === 'arena') return (b.moves || 20) * ((b.delay || 1) + 1.6) + 3 + tail;
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
      return { id: uid(), type: 'arena', name: String(b.name || 'Recorrido').slice(0, 60), moves: num(b.moves, 10, 0, 200), delay: num(b.delay, 1, 0.3, 10), activators: oneOf(b.activators, ['never', 'sometimes', 'always'], 'sometimes'), restAfter: num(b.restAfter, 10, 0, 600) };
    }
    const c = b?.comp || {};
    const paper = num(c.paper, 2, 0, 8);
    return {
      id: uid(), type: 'stage', name: String(b?.name || 'Escenario').slice(0, 60),
      comp: { paper, ns: num(c.ns, 0, 0, paper), hard: num(c.hard, 0, 0, paper), poppers: num(c.poppers, 3, 0, 6), popSize: oneOf(c.popSize, ['full', 'mini', 'mixed'], 'full'), plates: num(c.plates, 0, 0, 6), mover: oneOf(c.mover, Object.keys(MOVER_LABEL), 'none'), dist: oneOf(c.dist, Object.keys(DIST_LABEL), 'mixed'), theme: num(c.theme, -1, -1, 4) },
      activatorAt: num(b?.activatorAt, 1, 0.5, 10), par: num(b?.par, 3, 0.5, 120), reps: num(b?.reps, 10, 1, 100), rest: num(b?.rest, 5, 0, 600),
      startMode: oneOf(b?.startMode, ['fixed', 'random'], 'fixed'), vary: !!b?.vary, withMove: !!b?.withMove, restAfter: num(b?.restAfter, 10, 0, 600),
      layout: b?.layout && Array.isArray(b.layout.items) ? b.layout : null,
    };
  });
  return { id: uid(), name: String(d.name || 'Entrenamiento compartido').slice(0, 80), notes: String(d.notes || '').slice(0, 500), created: now, updated: now, blocks };
}
