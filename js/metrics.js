// Métricas biomecánicas de postura de tiro (IPSC) a partir de los landmarks de MediaPipe Pose.

export const POINTS = {
  NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8,
  LS: 11, RS: 12, LE: 13, RE: 14, LW: 15, RW: 16,
  LH: 23, RH: 24, LK: 25, RK: 26, LA: 27, RA: 28, LFI: 31, RFI: 32,
};

// ---------- vector helpers ----------
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (v) => Math.hypot(v.x, v.y, v.z);
const norm = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dist = (a, b) => len(sub(a, b));
const DEG = 180 / Math.PI;
export function mid(a, b) {
  return {
    x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}
function angle(a, b, c) {
  const u = sub(a, b), w = sub(c, b);
  const d = dot(u, w) / ((len(u) * len(w)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d))) * DEG;
}

export function buildPoints(lm, profile) {
  const p = {};
  for (const [k, i] of Object.entries(POINTS)) p[k] = lm[i];
  p.NECK = mid(p.LS, p.RS);
  p.PELVIS = mid(p.LH, p.RH);
  p.GRIP = mid(p.LW, p.RW);
  p.EYE = profile?.eye === 'left' ? p.L_EYE : profile?.eye === 'right' ? p.R_EYE : mid(p.L_EYE, p.R_EYE);
  return p;
}

// ---------- definición de métricas ----------
// aim: solo se evalúa cuando el tirador está en posición de disparo (arma arriba).
// segs: huesos del esqueleto que se colorean según esta métrica.
export const METRICS = [
  {
    key: 'shoulder', label: 'Hombros', unit: '°', aim: true, req: ['LS', 'RS', 'LE', 'RE', 'LH', 'RH'],
    desc: 'Elevación de los brazos (ángulo cadera‑hombro‑codo).',
    tip: 'Mantén los hombros relajados y a la misma altura; empuja el arma hacia el blanco sin encoger el cuello.',
    segs: [['LS', 'RS'], ['LS', 'LE'], ['RS', 'RE']],
    fn: (p) => (angle(p.LH, p.LS, p.LE) + angle(p.RH, p.RS, p.RE)) / 2,
  },
  {
    key: 'elbow', label: 'Codos', unit: '°', aim: true, req: ['LS', 'RS', 'LE', 'RE', 'LW', 'RW'],
    desc: 'Extensión de los brazos (ángulo hombro‑codo‑muñeca).',
    tip: 'Busca la misma extensión en cada presentación: brazos firmes sin bloquear del todo los codos.',
    segs: [['LE', 'LW'], ['RE', 'RW']],
    fn: (p) => (angle(p.LS, p.LE, p.LW) + angle(p.RS, p.RE, p.RW)) / 2,
  },
  {
    key: 'knee', label: 'Rodillas', unit: '°', aim: false, req: ['LH', 'RH', 'LK', 'RK', 'LA', 'RA'],
    desc: 'Flexión de rodillas (ángulo cadera‑rodilla‑tobillo).',
    tip: 'Rodillas ligeramente flexionadas y estables: base atlética lista para moverte.',
    segs: [['LH', 'LK'], ['LK', 'LA'], ['RH', 'RK'], ['RK', 'RA']],
    fn: (p) => (angle(p.LH, p.LK, p.LA) + angle(p.RH, p.RK, p.RA)) / 2,
  },
  {
    key: 'headTilt', label: 'Inclinación cabeza', unit: '°', aim: false, req: ['L_EAR', 'R_EAR'],
    desc: 'Inclinación lateral de la cabeza (línea entre orejas).',
    tip: 'Lleva el arma a los ojos, no los ojos al arma: cabeza recta y estable.',
    segs: [['NOSE', 'NECK']],
    fn: (p) => Math.atan2(p.R_EAR.y - p.L_EAR.y, Math.hypot(p.R_EAR.x - p.L_EAR.x, p.R_EAR.z - p.L_EAR.z)) * DEG,
  },
  {
    key: 'headWrist', label: 'Distancia cabeza‑muñecas', unit: '×', aim: true, req: ['LS', 'RS', 'LW', 'RW', 'NOSE'],
    desc: 'Distancia ojo → empuñadura, relativa al ancho de hombros.',
    tip: 'La distancia del arma a la cara debe repetirse siempre igual para encontrar las miras al instante.',
    segs: [['EYE', 'GRIP']],
    fn: (p) => dist(p.EYE, p.GRIP) / (dist(p.LS, p.RS) || 1),
  },
  {
    key: 'headWeapon', label: 'Posición arma vs ojo', unit: '×', aim: true, req: ['LS', 'RS', 'LW', 'RW', 'NOSE'],
    desc: 'Altura de la empuñadura respecto al ojo dominante.',
    tip: 'Presenta el arma en la línea de visión; evita bajar la cabeza para buscar las miras.',
    segs: [['LW', 'RW']],
    fn: (p) => (p.GRIP.y - p.EYE.y) / (dist(p.LS, p.RS) || 1),
  },
  {
    key: 'feetRatio', label: 'Ratio pies/hombros', unit: '×', aim: false, req: ['LS', 'RS', 'LA', 'RA'],
    desc: 'Apertura lateral de los pies relativa al ancho de hombros.',
    tip: 'Pies a la anchura de hombros o algo más para absorber el retroceso.',
    segs: [['LA', 'RA']],
    fn: (p) => {
      const s = sub(p.RS, p.LS); const sh = norm({ x: s.x, y: 0, z: s.z });
      return Math.abs(dot(sub(p.RA, p.LA), sh)) / (dist(p.LS, p.RS) || 1);
    },
  },
  {
    key: 'stagger', label: 'Escalonado pies', unit: '×', aim: false, req: ['LS', 'RS', 'LA', 'RA'],
    desc: 'Adelantamiento de un pie respecto al otro (hacia el blanco).',
    tip: 'El pie del lado fuerte ligeramente retrasado da estabilidad sin perder movilidad.',
    segs: [['LA', 'LFI'], ['RA', 'RFI']],
    fn: (p) => {
      const s = norm(sub(p.RS, p.LS)); const fwd = norm(cross(s, { x: 0, y: -1, z: 0 }));
      return Math.abs(dot(sub(p.RA, p.LA), fwd)) / (dist(p.LS, p.RS) || 1);
    },
  },
  {
    key: 'torso', label: 'Torso', unit: '°', aim: false, req: ['LS', 'RS', 'LH', 'RH'],
    desc: 'Inclinación del torso respecto a la vertical.',
    tip: 'Peso ligeramente adelantado (nariz sobre los pies), sin echar los hombros hacia atrás.',
    segs: [['NECK', 'PELVIS'], ['LS', 'LH'], ['RS', 'RH'], ['LH', 'RH']],
    fn: (p) => angle(sub(p.NECK, p.PELVIS), { x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }),
  },
];
export const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m]));

// Referencias por defecto según estilo de guardia (se recomienda calibrar la propia).
// Valores ajustados con medidas reales de tiradores IPSC (landmarks 3D de MediaPipe).
export const STYLE_DEFAULTS = {
  isosceles: { shoulder: 90, elbow: 135, knee: 162, headTilt: 0, headWrist: 0.92, headWeapon: 0.25, feetRatio: 1.3, stagger: 0.35, torso: 6 },
  weaver:    { shoulder: 84, elbow: 118, knee: 164, headTilt: 4, headWrist: 0.82, headWeapon: 0.25, feetRatio: 1.2, stagger: 0.6, torso: 5 },
  chapman:   { shoulder: 87, elbow: 126, knee: 163, headTilt: 3, headWrist: 0.87, headWeapon: 0.25, feetRatio: 1.25, stagger: 0.5, torso: 6 },
};
export const DEFAULT_TOLS = { shoulder: 8, elbow: 10, knee: 6, headTilt: 5, headWrist: 0.12, headWeapon: 0.12, feetRatio: 0.18, stagger: 0.2, torso: 4 };

// ---------- puntuación ----------
// desviación = |valor - referencia| / tolerancia.  dev 1 ≈ 85 pts, dev 2 ≈ 52 pts.
export function frameScore(dev) { return 100 * Math.exp(-0.1625 * dev * dev); }
export function devStatus(dev) { return dev < 1 ? 'good' : dev < 2 ? 'warn' : 'bad'; }
export function scoreStatus(s) { return s == null ? 'none' : s >= 80 ? 'good' : s >= 60 ? 'warn' : 'bad'; }
export const STATUS_LABEL = { good: 'Consistente', warn: 'Mejorable', bad: 'Corregir', none: 'Sin datos' };

const visible = (p, keys, thr = 0.5) => keys.every((k) => (p[k]?.visibility ?? 0) >= thr);

// Detecta si el tirador está en posición de disparo (arma presentada).
export function isAiming(w, img) {
  if (!visible(img, ['LW', 'RW', 'LS', 'RS'], 0.4)) return false;
  const sw = dist(w.LS, w.RS) || 1;
  const gripHigh = w.GRIP.y < w.NECK.y + 0.35 * sw;
  const extended = dist(w.NECK, w.GRIP) > 0.9 * sw;
  const together = dist(w.LW, w.RW) < 0.9 * sw;
  return gripHigh && extended && together;
}

export function computeFrame(worldLm, imgLm, profile) {
  const w = buildPoints(worldLm, profile);
  const img = buildPoints(imgLm, profile);
  const aiming = isAiming(w, img);
  const refs = profile.refs, tols = profile.tols;
  const values = {}, devs = {};
  for (const m of METRICS) {
    if (!visible(img, m.req)) { values[m.key] = null; continue; }
    const v = m.fn(w);
    if (!Number.isFinite(v)) { values[m.key] = null; continue; }
    values[m.key] = v;
    const active = !m.aim || aiming;
    if (active) {
      const dev = Math.abs(v - refs[m.key]) / (tols[m.key] || 1);
      devs[m.key] = { dev, status: devStatus(dev), score: frameScore(dev) };
    }
  }
  return { values, devs, aiming };
}

export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function fmtValue(key, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const m = METRIC_BY_KEY[key];
  return m.unit === '°' ? `${v.toFixed(0)}°` : `${v.toFixed(2)}×`;
}
