// Detección de pose (MediaPipe) + analizador en tiempo real con overlay del esqueleto.
import { FilesetResolver, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { VERSION } from './version.js?v=20261109-2347';
import { METRICS, computeFrame, median, POINTS, mid } from './metrics.js?v=20261109-2347';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODELS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};

let filesetP = null;
export async function createLandmarker(model = 'full') {
  filesetP ??= FilesetResolver.forVisionTasks(WASM);
  const fs = await filesetP;
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODELS[model] || MODELS.full, delegate },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { return await PoseLandmarker.createFromOptions(fs, opts('GPU')); }
  catch (e) { console.warn('GPU no disponible, usando CPU', e); return PoseLandmarker.createFromOptions(fs, opts('CPU')); }
}

export const COLORS = { good: '#35d07f', warn: '#ffc53d', bad: '#ff4d4f', idle: '#8b97a6' };

// Huesos dibujados. Cada uno toma el peor estado de las métricas que lo cubren.
const BONES = [
  ['LS', 'RS'], ['LS', 'LE'], ['RS', 'RE'], ['LE', 'LW'], ['RE', 'RW'], ['LW', 'RW'],
  ['NECK', 'PELVIS'], ['LS', 'LH'], ['RS', 'RH'], ['LH', 'RH'],
  ['LH', 'LK'], ['LK', 'LA'], ['RH', 'RK'], ['RK', 'RA'], ['LA', 'LFI'], ['RA', 'RFI'],
  ['NOSE', 'NECK'],
];
const JOINTS = ['NOSE', 'NECK', 'LS', 'RS', 'LE', 'RE', 'LW', 'RW', 'LH', 'RH', 'LK', 'RK', 'LA', 'RA', 'PELVIS'];
const RANK = { idle: 0, good: 1, warn: 2, bad: 3 };
const boneKey = (a, b) => [a, b].sort().join('-');
const BONE_METRICS = {};
for (const m of METRICS) for (const [a, b] of m.segs) (BONE_METRICS[boneKey(a, b)] ??= []).push(m.key);

function smooth(prev, next, alpha = 0.55) {
  if (!prev) return next.map((p) => ({ ...p }));
  return next.map((p, i) => ({
    x: prev[i].x + alpha * (p.x - prev[i].x),
    y: prev[i].y + alpha * (p.y - prev[i].y),
    z: prev[i].z + alpha * (p.z - prev[i].z),
    visibility: p.visibility,
  }));
}

function emptyStats() {
  return Object.fromEntries(METRICS.map((m) => [m.key, { n: 0, ss: 0, sv: 0, sv2: 0 }]));
}

export class Analyzer {
  // model: fuerza un modelo (p. ej. 'lite' en el entrenamiento en seco) · maxFps: limita las detecciones por segundo
  // useWorker: detecta en un hilo aparte (el dibujo no se bloquea); si no se puede, vuelve al hilo principal
  constructor({ video, canvas, getProfile, onUpdate, live = false, model = null, maxFps = 0, useWorker = false }) {
    this.video = video; this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.useWorker = useWorker && typeof Worker !== 'undefined' && typeof createImageBitmap === 'function';
    this.worker = null; this.busy = false;
    this.getProfile = getProfile; this.onUpdate = onUpdate; this.live = live;
    this.fixedModel = model; this.maxFps = maxFps; this.lastDetect = 0;
    this.noDraw = false; // true = solo detecta, no pinta la imagen (ahorra CPU si no se muestra)
    this.collectors = new Set();
    this.accumulate = false; this.lastTs = 0; this.lastVT = -1; this.lastUpdate = 0;
    this.fps = 0; this._fpsT = performance.now(); this._fpsN = 0;
    this.overlayText = null;
    this.reset();
  }

  async init() {
    const model = this.fixedModel || this.getProfile().model;
    if (this.useWorker && await this._startWorker(model)) this.model = model;
    else { this.lm = await createLandmarker(model); this.model = model; }
    if (!this.running) { this.running = true; this._loop(); }
  }

  // arranca el detector en un Web Worker; false si el navegador no lo admite (se usará el hilo principal)
  async _startWorker(model) {
    try {
      const w = new Worker(new URL(`./pose-worker.js?v=${encodeURIComponent(VERSION)}`, import.meta.url));
      const ok = await new Promise((res) => {
        const t = setTimeout(() => res(false), 45000);
        w.onmessage = (e) => { if (e.data.type === 'ready') { clearTimeout(t); res(true); } else if (e.data.type === 'error') { clearTimeout(t); res(false); } };
        w.onerror = () => { clearTimeout(t); res(false); };
        w.postMessage({ type: 'init', model });
      });
      if (!ok) { w.terminate(); return false; }
      w.onmessage = (e) => { if (e.data.type === 'result') { this.busy = false; this._onResult(e.data.landmarks, e.data.world); } };
      w.onerror = () => { this.busy = false; };
      this.worker = w;
      return true;
    } catch { return false; }
  }

  async ensureModel() {
    const model = this.fixedModel || this.getProfile().model;
    if ((this.lm || this.worker) && this.model === model) return;
    if (this.worker) { this.worker.terminate(); this.worker = null; if (await this._startWorker(model)) { this.model = model; this.img = this.world = null; return; } }
    const old = this.lm; this.lm = null;
    old?.close();
    this.lm = await createLandmarker(model); this.model = model;
    this.img = this.world = null;
  }

  destroy() { this.running = false; this.lm?.close(); this.lm = null; this.worker?.terminate(); this.worker = null; }

  reset() {
    this.stats = emptyStats();
    this.frames = 0; this.aimFrames = 0; this.activeMs = 0; this._lastAccT = null;
  }

  _loop = () => {
    if (!this.running) return;
    try { if (!this.offline) this._tick(); } catch (e) { console.error(e); }
    requestAnimationFrame(this._loop);
  };

  // Analiza el vídeo completo fotograma a fotograma (independiente de la velocidad del equipo).
  async analyzeAll(fps = 15, onProgress) {
    const v = this.video; if (!v.duration) return;
    v.pause(); this.reset(); this.img = this.world = null; this.abort = false;
    this.offline = true; this.accumulate = true; this._dtOverride = 1000 / fps;
    try {
      for (let t = 0; t < v.duration && !this.abort; t += 1 / fps) {
        await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = t; });
        this._tick();
        onProgress?.(t / v.duration);
      }
    } finally { this.offline = false; this.accumulate = false; this._dtOverride = null; onProgress?.(1); }
  }

  _tick() {
    const v = this.video, c = this.canvas;
    if (v.readyState < 2 || !v.videoWidth) return;
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) { c.width = v.videoWidth; c.height = v.videoHeight; }
    const isNew = v.currentTime !== this.lastVT;
    const due = !this.maxFps || this.offline || performance.now() - this.lastDetect >= 1000 / this.maxFps - 2;
    if (isNew && this.worker && !this.offline && due && !this.busy) {
      // hilo aparte: se envía una copia reducida del fotograma y el resultado llega después (_onResult)
      this.busy = true; this.lastDetect = performance.now(); this.lastVT = v.currentTime;
      let ts = performance.now(); if (ts <= this.lastTs) ts = this.lastTs + 1; this.lastTs = ts;
      const rw = Math.min(v.videoWidth, 384), rh = Math.round((rw * v.videoHeight) / v.videoWidth);
      createImageBitmap(v, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'low' })
        .then((bitmap) => this.worker ? this.worker.postMessage({ type: 'frame', bitmap, ts }, [bitmap]) : (this.busy = false))
        .catch(() => { this.busy = false; });
    } else if (isNew && this.lm && due) {
      this.lastDetect = performance.now();
      if (Math.abs(v.currentTime - this.lastVT) > 0.6) { this.img = this.world = null; } // salto (seek): no suavizar
      let ts = performance.now(); if (ts <= this.lastTs) ts = this.lastTs + 1; this.lastTs = ts;
      const r = this.lm.detectForVideo(v, ts);
      this.lastVT = v.currentTime;
      this._onResult(r.landmarks?.[0] || null, r.worldLandmarks?.[0] || null);
    }
    if (!this.noDraw) this._draw();
    const now = performance.now();
    if (now - this.lastUpdate > 250) { this.lastUpdate = now; this.onUpdate?.(this); }
  }

  // resultado de una detección (del hilo principal o del worker)
  _onResult(landmarks, world) {
    this._fpsN++;
    const now = performance.now();
    if (now - this._fpsT > 1000) { this.fps = Math.round(this._fpsN * 1000 / (now - this._fpsT)); this._fpsN = 0; this._fpsT = now; }
    if (landmarks && world) {
      this.img = smooth(this.img, landmarks);
      this.world = smooth(this.world, world);
      this.cur = computeFrame(this.world, this.img, this.getProfile());
    } else { this.img = this.world = null; this.cur = null; }
    if (this.accumulate) this._accumulate(this.cur, now);
    else this._lastAccT = null;
    for (const col of this.collectors) col(this.cur);
  }

  _accumulate(cur, now) {
    if (this._dtOverride) this.activeMs += this._dtOverride;
    else if (this._lastAccT != null) this.activeMs += Math.min(now - this._lastAccT, 200);
    this._lastAccT = now;
    if (!cur) return;
    this.frames++;
    if (cur.aiming) this.aimFrames++;
    for (const [k, d] of Object.entries(cur.devs)) {
      const s = this.stats[k], v = cur.values[k];
      s.n++; s.ss += d.score; s.sv += v; s.sv2 += v * v;
    }
  }

  summary() {
    const metrics = {}; let tot = 0, c = 0;
    for (const m of METRICS) {
      const s = this.stats[m.key];
      if (!s.n) continue;
      const mean = s.sv / s.n;
      const std = Math.sqrt(Math.max(0, s.sv2 / s.n - mean * mean));
      const score = Math.round(s.ss / s.n);
      metrics[m.key] = { score, mean, std, n: s.n };
      tot += score; c++;
    }
    return { metrics, overall: c ? Math.round(tot / c) : null, frames: this.frames, aimFrames: this.aimFrames, duration: this.activeMs / 1000 };
  }

  // Recoge valores durante `ms` milisegundos y devuelve la mediana de cada métrica (calibración).
  collect(ms) {
    return new Promise((resolve) => {
      const vals = Object.fromEntries(METRICS.map((m) => [m.key, []]));
      let aim = 0, total = 0;
      const col = (cur) => {
        if (!cur) return;
        total++; if (cur.aiming) aim++;
        for (const m of METRICS) {
          const v = cur.values[m.key];
          if (v == null) continue;
          if (m.aim && !cur.aiming) continue;
          vals[m.key].push(v);
        }
      };
      this.collectors.add(col);
      setTimeout(() => {
        this.collectors.delete(col);
        const out = {};
        for (const m of METRICS) out[m.key] = median(vals[m.key]);
        resolve({ refs: out, frames: total, aimFrames: aim });
      }, ms);
    });
  }

  thumbnail(maxW = 240) {
    const c = this.canvas; if (!c.width) return null;
    const s = maxW / c.width; const t = document.createElement('canvas');
    t.width = Math.round(c.width * s); t.height = Math.round(c.height * s);
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.7);
  }

  _draw() {
    const { ctx, canvas: c, video: v } = this;
    const prof = this.getProfile();
    ctx.save();
    if (this.mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    if (this.img && this.cur) drawSkeleton(ctx, this.img, this.cur, c.width, c.height, prof);
    ctx.restore();
    if (!this.noHud) drawHud(ctx, c.width, c.height, this, prof);
  }
}

function boneStatus(a, b, cur) {
  const keys = BONE_METRICS[boneKey(a, b)];
  if (!keys) return 'idle';
  let worst = 'idle';
  for (const k of keys) { const d = cur.devs[k]; if (d && RANK[d.status] > RANK[worst]) worst = d.status; }
  return worst;
}

function drawSkeleton(ctx, lm, cur, W, H, profile) {
  const p = {};
  for (const [k, i] of Object.entries(POINTS)) p[k] = lm[i];
  p.NECK = mid(p.LS, p.RS); p.PELVIS = mid(p.LH, p.RH); p.GRIP = mid(p.LW, p.RW);
  p.EYE = profile.eye === 'left' ? p.L_EYE : profile.eye === 'right' ? p.R_EYE : mid(p.L_EYE, p.R_EYE);
  const X = (q) => q.x * W, Y = (q) => q.y * H;
  const vis = (q) => (q?.visibility ?? 0) > 0.4;
  const lw = Math.max(3, W / 110), r = Math.max(4, W / 120);
  ctx.lineCap = 'round';

  // línea de mira (ojo → empuñadura) solo cuando apunta
  if (cur.aiming && vis(p.EYE) && vis(p.LW) && vis(p.RW)) {
    const st = cur.devs.headWrist?.status || 'idle';
    ctx.save(); ctx.setLineDash([lw * 1.5, lw * 1.5]); ctx.strokeStyle = COLORS[st]; ctx.globalAlpha = 0.85;
    ctx.lineWidth = lw * 0.6; ctx.beginPath(); ctx.moveTo(X(p.EYE), Y(p.EYE)); ctx.lineTo(X(p.GRIP), Y(p.GRIP)); ctx.stroke(); ctx.restore();
  }

  for (const [a, b] of BONES) {
    if (!vis(p[a]) || !vis(p[b])) continue;
    const st = boneStatus(a, b, cur);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = lw + 3;
    ctx.beginPath(); ctx.moveTo(X(p[a]), Y(p[a])); ctx.lineTo(X(p[b]), Y(p[b])); ctx.stroke();
    ctx.strokeStyle = COLORS[st]; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(X(p[a]), Y(p[a])); ctx.lineTo(X(p[b]), Y(p[b])); ctx.stroke();
  }
  for (const k of JOINTS) {
    if (!vis(p[k])) continue;
    let worst = 'idle';
    for (const [a, b] of BONES) if ((a === k || b === k)) { const s = boneStatus(a, b, cur); if (RANK[s] > RANK[worst]) worst = s; }
    ctx.fillStyle = '#fff'; ctx.strokeStyle = COLORS[worst]; ctx.lineWidth = Math.max(2, r / 2);
    ctx.beginPath(); ctx.arc(X(p[k]), Y(p[k]), r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

function drawHud(ctx, W, H, an, profile) {
  const s = Math.max(1, W / 720);
  ctx.save();
  // marca de agua personalizada
  ctx.font = `700 ${22 * s}px Rajdhani, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textBaseline = 'top';
  ctx.fillText('IPSC TRACK', 16 * s, 14 * s);
  if (profile.name || profile.alias) {
    ctx.font = `600 ${14 * s}px Rajdhani, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(profile.alias ? `@${profile.alias.replace(/^@/, '')}` : profile.name, 16 * s, 38 * s);
  }
  // estado
  const cur = an.cur;
  const label = !cur ? 'SIN DETECCIÓN' : cur.aiming ? 'APUNTANDO' : 'GUARDIA';
  const col = !cur ? '#ff4d4f' : cur.aiming ? '#35d07f' : '#8b97a6';
  ctx.font = `700 ${16 * s}px Rajdhani, sans-serif`;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(ctx, W - tw - 40 * s, 12 * s, tw + 26 * s, 26 * s, 6 * s); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(W - tw - 28 * s, 25 * s, 5 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(label, W - tw - 18 * s, 17 * s);
  // puntuación de la serie
  if (an.accumulate || an.frames) {
    const sum = an.summary();
    if (sum.overall != null) {
      const sc = sum.overall, c2 = sc >= 80 ? '#35d07f' : sc >= 60 ? '#ffc53d' : '#ff4d4f';
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(ctx, 16 * s, H - 70 * s, 128 * s, 54 * s, 8 * s); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `600 ${12 * s}px Rajdhani, sans-serif`;
      ctx.fillText('CONSISTENCIA', 26 * s, H - 64 * s);
      ctx.fillStyle = c2; ctx.font = `700 ${30 * s}px Rajdhani, sans-serif`;
      ctx.fillText(`${sc}%`, 26 * s, H - 50 * s);
    }
  }
  if (an.overlayText) {
    ctx.font = `700 ${Math.min(W, H) * 0.22}px Rajdhani, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(an.overlayText, W / 2 + 3, H / 2 + 3);
    ctx.fillStyle = '#d4ff3a'; ctx.fillText(an.overlayText, W / 2, H / 2);
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Graba el canvas (con overlay) a webm y lo descarga.
export class ClipRecorder {
  constructor(canvas) { this.canvas = canvas; this.rec = null; }
  get active() { return !!this.rec; }
  start() {
    const stream = this.canvas.captureStream(30);
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    this.chunks = [];
    this.rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6e6 } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
  }
  stop(filename = 'ipsc-track') {
    return new Promise((res) => {
      if (!this.rec) return res();
      this.rec.onstop = () => {
        const type = this.rec.mimeType || 'video/webm';
        const blob = new Blob(this.chunks, { type });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${filename}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        this.rec = null; res();
      };
      this.rec.stop();
    });
  }
}
