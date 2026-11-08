// Persistencia local (localStorage) de perfil, sesiones y tiempos del timer.
import { STYLE_DEFAULTS, DEFAULT_TOLS } from './metrics.js?v=20261108-2153';

const K = { profile: 'ipsctrack.profile', sessions: 'ipsctrack.sessions', timer: 'ipsctrack.timer' };

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
    dry: { camera: true, moveFactor: 2, range: 1, delay: 1, moves: 20, voice: true, activators: 'sometimes' },
  };
}

export function loadProfile() {
  const d = defaultProfile(); const p = read(K.profile, null);
  if (!p) return d;
  return { ...d, ...p, refs: { ...d.refs, ...p.refs }, tols: { ...d.tols, ...p.tols }, timer: { ...d.timer, ...p.timer }, dry: { ...d.dry, ...p.dry } };
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

export function exportAll() {
  const data = { app: 'ipsc-track', version: 1, exported: new Date().toISOString(), profile: loadProfile(), sessions: loadSessions(), timer: loadTimerRuns() };
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
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
