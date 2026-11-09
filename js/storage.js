// Persistencia local (localStorage) de perfil, sesiones y tiempos del timer.
import { STYLE_DEFAULTS, DEFAULT_TOLS } from './metrics.js?v=20261109-2144';

const K = { profile: 'ipsctrack.profile', sessions: 'ipsctrack.sessions', timer: 'ipsctrack.timer', programs: 'ipsctrack.programs' };

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch (e) { alert('No se pudo guardar (almacenamiento lleno). Exporta una copia y borra sesiones antiguas.'); return false; }
}

export function defaultProfile() {
  return {
    name: '', alias: '', division: 'Production', hand: 'right', eye: 'right', style: 'isosceles',
    model: 'full', goal: 85,
    refs: { ...STYLE_DEFAULTS.isosceles }, tols: { ...DEFAULT_TOLS },
    refSource: 'default', refDate: null,
    timer: { delayMin: 1.5, delayMax: 4, par: 0, threshold: 0.35, freq: 2800 },
    dry: { camera: true, moveFactor: 2, range: 1, delay: 1, moves: 20, voice: false, activators: 'sometimes', showCam: null, advance: 'camera', moveDelay: 1, walls: true, portDelay: 0, prefs: 2, quickStyle: 'moves', challenge: 'auto', chReps: 5, chLevels: {}, chBest: {} },
  };
}

export function loadProfile() {
  const d = defaultProfile(); const p = read(K.profile, null);
  if (!p) return d;
  const out = { ...d, ...p, refs: { ...d.refs, ...p.refs }, tols: { ...d.tols, ...p.tols }, timer: { ...d.timer, ...p.timer }, dry: { ...d.dry, ...p.dry } };
  // v2: la voz pasa a estar desactivada por defecto (antes venía activada)
  if ((p.dry?.prefs ?? 1) < 2) { out.dry.voice = false; out.dry.prefs = 2; }
  return out;
}
export const saveProfile = (p) => write(K.profile, p);

export const loadSessions = () => read(K.sessions, []);
export function addSession(s) { const all = loadSessions(); all.unshift(s); return write(K.sessions, all); }
export function updateSession(id, patch) {
  const all = loadSessions(); const i = all.findIndex((s) => s.id === id);
  if (i >= 0) { all[i] = { ...all[i], ...patch }; write(K.sessions, all); }
}
export function deleteSession(id) { write(K.sessions, loadSessions().filter((s) => s.id !== id)); }

export const loadTimerRuns = () => read(K.timer, []);
export function addTimerRun(r) { const all = loadTimerRuns(); all.unshift(r); write(K.timer, all.slice(0, 300)); }
export function deleteTimerRun(id) { write(K.timer, loadTimerRuns().filter((r) => r.id !== id)); }

// --- entrenamientos personalizados (editor) ---
export const loadPrograms = () => read(K.programs, []);
export function saveProgram(p) {
  const all = loadPrograms(); const i = all.findIndex((x) => x.id === p.id);
  p.updated = Date.now();
  if (i >= 0) all[i] = p; else all.unshift(p);
  return write(K.programs, all);
}
export function deleteProgram(id) { write(K.programs, loadPrograms().filter((p) => p.id !== id)); }

export function exportAll() {
  const data = { app: 'ipsc-track', version: 1, exported: new Date().toISOString(), profile: loadProfile(), sessions: loadSessions(), timer: loadTimerRuns(), programs: loadPrograms() };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `ipsc-track-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function importAll(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'ipsc-track') throw new Error('El archivo no es una copia de IPSC Track');
  if (data.profile) saveProfile(data.profile);
  const ids = new Set(loadSessions().map((s) => s.id));
  write(K.sessions, [...loadSessions(), ...(data.sessions || []).filter((s) => !ids.has(s.id))].sort((a, b) => b.date - a.date));
  const tids = new Set(loadTimerRuns().map((s) => s.id));
  write(K.timer, [...loadTimerRuns(), ...(data.timer || []).filter((s) => !tids.has(s.id))].sort((a, b) => b.date - a.date));
  const pids = new Set(loadPrograms().map((p) => p.id));
  write(K.programs, [...loadPrograms(), ...(data.programs || []).filter((p) => p && Array.isArray(p.blocks) && !pids.has(p.id))]);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
