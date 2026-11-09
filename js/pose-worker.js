// Detección de pose en un hilo aparte (Web Worker «clásico»): el dibujo del escenario no se bloquea
// mientras la IA analiza la imagen. Se carga MediaPipe con import() dinámico; si el navegador no lo
// permite, la página vuelve a detectar en el hilo principal (como antes).
const BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODELS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};
let lm = null;

async function init(model) {
  const { FilesetResolver, PoseLandmarker } = await import(BUNDLE);
  const fs = await FilesetResolver.forVisionTasks(WASM);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODELS[model] || MODELS.lite, delegate },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { lm = await PoseLandmarker.createFromOptions(fs, opts('GPU')); }
  catch { lm = await PoseLandmarker.createFromOptions(fs, opts('CPU')); }
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try { await init(m.model); self.postMessage({ type: 'ready' }); }
    catch (err) { self.postMessage({ type: 'error', message: String(err?.message || err) }); }
    return;
  }
  if (m.type === 'frame') {
    let res = null;
    try {
      const r = lm.detectForVideo(m.bitmap, m.ts);
      res = { landmarks: r.landmarks?.[0] || null, world: r.worldLandmarks?.[0] || null };
    } catch (err) { res = { landmarks: null, world: null, error: String(err?.message || err) }; }
    m.bitmap.close?.();
    self.postMessage({ type: 'result', id: m.id, ...res });
  }
};
