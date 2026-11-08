// Shot timer: beep de salida con retardo aleatorio + detección de disparos por micrófono.

let ctx = null;
export function audioCtx() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Programa un beep; devuelve el instante (ctx.currentTime) en que suena.
export function beep({ freq = 2800, dur = 0.3, at = 0, vol = 0.6 } = {}) {
  const ac = audioCtx();
  const t = Math.max(ac.currentTime + 0.01, at || 0);
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'square'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.setValueAtTime(vol, t + dur - 0.02); g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  return t;
}

// Detector de disparos/clics por micrófono con marcas de tiempo en performance.now() (ms).
export class ShotDetector {
  constructor({ onShot, onLevel }) { this.onShot = onShot; this.onLevel = onLevel; this.threshold = 0.35; this.refractory = 90; this.ignoreUntil = 0; this.last = 0; }
  get active() { return !!this.analyser; }
  async start() {
    if (this.analyser) return;
    const ac = audioCtx();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const src = ac.createMediaStreamSource(this.stream);
    this.analyser = ac.createAnalyser(); this.analyser.fftSize = 1024;
    src.connect(this.analyser); this.buf = new Float32Array(this.analyser.fftSize);
    this._loop();
  }
  ignore(ms) { this.ignoreUntil = Math.max(this.ignoreUntil, performance.now() + ms); }
  _loop = () => {
    if (!this.analyser) return;
    const ac = audioCtx();
    this.analyser.getFloatTimeDomainData(this.buf);
    let peak = 0, idx = 0;
    for (let i = 0; i < this.buf.length; i++) { const a = Math.abs(this.buf[i]); if (a > peak) { peak = a; idx = i; } }
    this.onLevel?.(peak);
    if (peak >= this.threshold) {
      const t = performance.now() - ((this.buf.length - idx) / ac.sampleRate) * 1000;
      if (t > this.ignoreUntil && t - this.last > this.refractory) { this.last = t; this.onShot?.(t, 'mic'); }
    }
    this.raf = requestAnimationFrame(this._loop);
  };
  stop() { cancelAnimationFrame(this.raf); this.stream?.getTracks().forEach((t) => t.stop()); this.analyser = null; this.stream = null; }
}

// Convierte un instante del AudioContext a performance.now()
export function ctxToPerf(t) { const ac = audioCtx(); return performance.now() + (t - ac.currentTime) * 1000; }

export class ShotTimer {
  constructor({ onShot, onLevel, onState }) {
    this.onShot = onShot; this.onLevel = onLevel; this.onState = onState;
    this.state = 'idle'; this.shots = []; this.refractory = 0.08;
  }

  async ensureMic() {
    if (this.analyser) return;
    const ac = audioCtx();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const src = ac.createMediaStreamSource(this.stream);
    this.analyser = ac.createAnalyser(); this.analyser.fftSize = 2048;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this._lastShot = 0;
    this._monitor();
  }

  _monitor = () => {
    if (!this.analyser) return;
    const ac = audioCtx();
    this.analyser.getFloatTimeDomainData(this.buf);
    let peak = 0, idx = 0;
    for (let i = 0; i < this.buf.length; i++) { const a = Math.abs(this.buf[i]); if (a > peak) { peak = a; idx = i; } }
    this.onLevel?.(peak);
    if (this.state === 'listening' && peak >= this.threshold) {
      const t = ac.currentTime - (this.buf.length - idx) / ac.sampleRate;
      if (t > this.ignoreUntil && t - this._lastShot > this.refractory) {
        this._lastShot = t;
        const time = t - this.beepAt;
        const prev = this.shots.length ? this.shots[this.shots.length - 1].time : 0;
        const shot = { time, split: time - prev };
        this.shots.push(shot); this.onShot?.(shot, this.shots);
      }
    }
    this.raf = requestAnimationFrame(this._monitor);
  };

  async start({ delayMin = 1.5, delayMax = 4, par = 0, threshold = 0.35, freq = 2800, maxTime = 30 }) {
    await this.ensureMic();
    this.stop(true);
    const ac = audioCtx();
    this.threshold = threshold; this.shots = []; this._lastShot = 0;
    const delay = delayMin + Math.random() * Math.max(0, delayMax - delayMin);
    this.beepAt = beep({ freq, at: ac.currentTime + delay });
    this.ignoreUntil = this.beepAt + 0.32; // no contar el propio beep
    if (par > 0) beep({ freq: freq * 0.8, at: this.beepAt + par, dur: 0.25 });
    this.state = 'standby'; this.onState?.('standby');
    this._t1 = setTimeout(() => { this.state = 'listening'; this.onState?.('listening'); }, delay * 1000);
    this._t2 = setTimeout(() => this.stop(), (delay + maxTime) * 1000);
    return { delay, beepAt: this.beepAt };
  }

  elapsed() { return this.state === 'listening' ? audioCtx().currentTime - this.beepAt : null; }

  stop(silent = false) {
    clearTimeout(this._t1); clearTimeout(this._t2);
    const was = this.state; this.state = 'idle';
    if (!silent && was !== 'idle') this.onState?.('done', this.shots);
  }

  release() {
    this.stop(true); cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop()); this.analyser = null; this.stream = null;
  }
}
