// Entrenamiento en seco «Arena».
// Secuencia: escenario → beep (solo al empezar) → al segundo aparece la dirección arriba →
// cuando la cámara detecta que te has desplazado hacia ese lado, el escenario cambia al siguiente.
// Si el escenario tiene popper activador: anillos que convergen → brillo → cae → el móvil se activa,
// a la vez que aparece la dirección (no hay que esperar al móvil para cambiar de escenario).
import { randomStage } from './course.js?v=20261108-2153';
import { StageRenderer, THEMES, ACT } from './scene.js?v=20261108-2153';
import { Analyzer } from './pose.js?v=20261108-2153';
import { beep, audioCtx } from './timer.js?v=20261108-2153';

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------- efectos de sonido sutiles ----------------
function noiseBuffer(ac, dur) {
  const b = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
const sfx = {
  whoosh() {
    const ac = audioCtx(), t = ac.currentTime, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuffer(ac, 0.5); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(350, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.35);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.12); g.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    src.connect(f).connect(g).connect(ac.destination); src.start(t); src.stop(t + 0.5);
  },
  clang() {
    const ac = audioCtx(), t = ac.currentTime;
    for (const [fr, v] of [[1280, 0.16], [2140, 0.09], [3390, 0.05]]) {
      const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = fr; o.type = 'sine';
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.7);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.72);
    }
    const src = ac.createBufferSource(), g = ac.createGain(); src.buffer = noiseBuffer(ac, 0.05);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); src.connect(g).connect(ac.destination); src.start(t);
  },
  clack() {
    const ac = audioCtx(), t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.16);
  },
  tick() {
    const ac = audioCtx(), t = ac.currentTime;
    [[880, 0], [1320, 0.06]].forEach(([fr, dt]) => {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = fr;
      g.gain.setValueAtTime(0, t + dt); g.gain.linearRampToValueAtTime(0.09, t + dt + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.12);
      o.connect(g).connect(ac.destination); o.start(t + dt); o.stop(t + dt + 0.13);
    });
  },
};

export function initDryFire(app) {
  const { toast, getProfile, saveProfile } = app;
  const P = () => getProfile().dry;

  const sceneCanvas = $('#dryScene'), camCanvas = $('#dryCam'), video = $('#dryVideo');
  const scene = new StageRenderer(sceneCanvas);
  let an = null, stream = null, run = null, lastPose = null;
  const keyHeld = { left: false, right: false };
  const timers = [];
  const view = { stage: randomStage(Date.now(), { activators: 'never' }), big: 'ARENA EN SECO', sub: 'Pulsa «Empezar»' };

  // ---------------- ajustes ----------------
  const binds = { dryCamMode: 'camera', dryMove: 'moveFactor', dryRange: 'range', dryDelay: 'delay', dryMoves: 'moves', dryAct: 'activators', dryVoice: 'voice' };
  function loadSettings() {
    const d = P();
    for (const [id, k] of Object.entries(binds)) { const el = $(`#${id}`); if (el.type === 'checkbox') el.checked = !!d[k]; else el.value = String(d[k]); }
  }
  for (const [id, k] of Object.entries(binds)) $(`#${id}`).onchange = (e) => {
    const el = e.target;
    P()[k] = el.type === 'checkbox' ? el.checked : k === 'camera' ? el.value === 'true' : k === 'activators' ? el.value : +el.value;
    saveProfile();
  };

  // ---------------- teclado (modo sin cámara) ----------------
  const tabActive = () => $('#tab-dry').classList.contains('active');
  window.addEventListener('keydown', (e) => {
    if (!tabActive() || e.target?.matches?.('input, textarea, select') || !$('#modal').classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') { keyHeld.left = true; e.preventDefault(); }
    if (e.key === 'ArrowRight') { keyHeld.right = true; e.preventDefault(); }
    if (e.key === 'Escape' && run) stop('DETENIDO');
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft') keyHeld.left = false; if (e.key === 'ArrowRight') keyHeld.right = false; });

  function say(text) {
    if (!P().voice || !window.speechSynthesis) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'es-ES'; u.rate = 1.3; speechSynthesis.speak(u); } catch { /* sin voz */ }
  }

  // ---------------- cámara / pose ----------------
  async function ensureCamera() {
    if (!P().camera) return true;
    try {
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        video.srcObject = stream; await video.play();
      }
      if (!an) {
        an = new Analyzer({ video, canvas: camCanvas, getProfile, onUpdate: null });
        an.mirror = true; an.noHud = true;
        $('#modelLoading').classList.remove('hidden');
        try { await an.init(); } finally { $('#modelLoading').classList.add('hidden'); }
        an.collectors.add(onPoseFrame);
      } else await an.ensureModel();
      $('#dryPip').classList.remove('hidden');
      return true;
    } catch (e) {
      console.error(e);
      toast(e.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Puedes usar «Sin cámara (teclado)» en Ajustes.' : `Cámara no disponible: ${e.message}`, 5000);
      return false;
    }
  }
  function stopCamera() { stream?.getTracks().forEach((t) => t.stop()); stream = null; $('#dryPip').classList.add('hidden'); }
  $('#dryCamBtn').onclick = async () => { if (stream) stopCamera(); else if (P().camera) await ensureCamera(); else toast('Activa el modo cámara en Ajustes'); };

  // posición lateral (centro de cadera) en espejo: «izquierda» = tu izquierda
  function onPoseFrame(cur) {
    const lm = an.img;
    if (!lm || !cur) { lastPose = null; return; }
    const LS = lm[11], RS = lm[12], LH = lm[23], RH = lm[24];
    if (Math.min(LS.visibility ?? 1, RS.visibility ?? 1, LH.visibility ?? 1, RH.visibility ?? 1) < 0.5) { lastPose = null; return; }
    lastPose = { t: performance.now(), x: 1 - (LH.x + RH.x) / 2, sw: Math.abs(LS.x - RS.x) };
  }
  function pose() {
    if (P().camera) return lastPose && performance.now() - lastPose.t < 500 ? lastPose : null;
    return { t: performance.now(), x: run.simX, sw: 0.12, sim: true };
  }

  // ---------------- ciclo ----------------
  async function start() {
    document.activeElement?.blur();
    audioCtx();
    if (P().camera && !(await ensureCamera())) return;
    clearTimers();
    run = { phase: 'setup', phaseAt: performance.now(), samples: [], simX: 0.5, moves: 0, moveTimes: [], startAt: null, n: 1,
      stage: randomStage(Date.now(), { activators: P().activators }) };
    view.transition = null; view.arrow = null; view.warn = null;
    $('#dryStart').textContent = '↻ Reiniciar';
    say(P().camera ? 'Colócate en el centro' : 'Preparado');
  }
  function stop(text) {
    if (!run) return;
    clearTimers(); run.phase = 'done'; run.endAt = performance.now();
    view.arrow = null; view.transition = null; view.warn = null; view.big = text; view.sub = ''; view.bigColor = '#d4ff3a';
    $('#dryStart').textContent = '▶ Empezar';
  }
  const clearTimers = () => { while (timers.length) clearTimeout(timers.pop()); };
  $('#dryStart').onclick = start;
  $('#dryAbort').onclick = () => stop('DETENIDO');

  const setPhase = (ph, now = performance.now()) => { run.phase = ph; run.phaseAt = now; };

  function startScene(now) {
    run.sceneAt = now; run.stage.actStart = null; run.actFired = false;
    view.stage = run.stage; view.transition = null; view.arrow = null;
    setPhase('scene', now);
  }

  function fireActivation(now) {
    run.stage.actStart = now; run.actFired = true;
    timers.push(setTimeout(() => sfx.clang(), ACT.fallStart + ACT.fallDur * 0.7));
    timers.push(setTimeout(() => sfx.clack(), ACT.moverStart));
  }

  function chooseDir(p) {
    const T = run.T, x = p ? p.x : run.lastX ?? run.x0, off = x - run.x0;
    const Rm = P().range ? P().range * T : Infinity;
    const can = (d) => Math.abs(off + d * T) <= Rm + 0.35 * T && x + d * T >= 0.03 && x + d * T <= 0.97;
    const opts = [-1, 1].filter(can);
    if (!opts.length) return off > 0 ? -1 : 1;
    if (opts.length === 1) return opts[0];
    const norm = clamp(off / (Rm === Infinity ? 0.3 : Rm), -1, 1);
    return Math.random() < 0.5 - 0.3 * norm ? 1 : -1;
  }

  function showArrow(now) {
    const p = pose();
    const dir = chooseDir(p);
    run.arrow = { dir, since: now }; run.origin = p ? p.x : null; run.trigSince = null;
    view.arrow = run.arrow;
    setPhase('arrow', now);
    sfx.tick(); say(dir < 0 ? 'Izquierda' : 'Derecha');
  }

  function step(now) {
    const p = pose();
    if (p) run.lastX = p.x;
    if (!P().camera && run.T) {
      const d = (keyHeld.right ? 1 : 0) - (keyHeld.left ? 1 : 0);
      if (d) run.simX = clamp(run.simX + d * (run.T / 0.45) * Math.min(0.05, (now - (run.lastStep || now)) / 1000), 0, 1);
    }
    run.lastStep = now;
    view.info = run.startAt ? `ESCENARIO ${String(run.n).padStart(2, '0')} · ${THEMES[run.stage.theme].name.toUpperCase()}` : null;
    view.warn = P().camera && !p && run.phase !== 'setup' ? 'NO TE VEO' : null;

    if (run.phase === 'setup') {
      view.stage = run.stage;
      if (!p) { view.big = 'NO TE VEO'; view.sub = 'Ponte de cuerpo entero frente a la cámara, en el centro'; view.bigColor = '#ff6b6b'; run.samples = []; return; }
      run.samples.push(p);
      view.big = 'CALIBRANDO'; view.sub = 'Quieto en el centro…'; view.bigColor = '#d4ff3a';
      if (run.samples.length >= (p.sim ? 1 : 15)) {
        run.x0 = run.samples.reduce((a, s) => a + s.x, 0) / run.samples.length;
        const sw = run.samples.reduce((a, s) => a + s.sw, 0) / run.samples.length;
        run.T = Math.max(0.035, P().moveFactor * sw);
        run.standbyUntil = now + 1500 + Math.random() * 1300;
        view.big = 'PREPARADO'; view.sub = 'Espera el beep';
        setPhase('standby', now);
      }
      return;
    }
    if (run.phase === 'standby') {
      if (now >= run.standbyUntil) {
        beep({ freq: getProfile().timer?.freq || 2800, dur: 0.3 });
        run.startAt = now; view.big = null; view.sub = null;
        startScene(now);
      }
      return;
    }
    if (run.phase === 'scene') {
      // la dirección aparece siempre al mismo tiempo, haya o no móvil (no se espera a que termine)
      if (now >= run.sceneAt + P().delay * 1000) {
        if (run.stage.act && !run.actFired) fireActivation(now);
        showArrow(now);
      }
      return;
    }
    if (run.phase === 'arrow') {
      if (!p) return;
      const dir = run.arrow.dir;
      if (run.origin == null) run.origin = p.x;
      // el origen es el punto más alejado en sentido contrario (por si retrocedes antes de salir)
      run.origin = dir > 0 ? Math.min(run.origin, p.x) : Math.max(run.origin, p.x);
      const disp = (p.x - run.origin) * dir;
      if (disp >= run.T) {
        run.trigSince ??= now;
        if (now - run.trigSince >= 80) trigger(now, dir);
      } else run.trigSince = null;
      return;
    }
    if (run.phase === 'transition') {
      if (now - view.transition.start >= view.transition.dur) {
        run.stage = run.next; run.next = null; run.moves++; run.n++;
        if (P().moves && run.moves >= P().moves) return finish(now);
        startScene(now);
      }
    }
  }

  function trigger(now, dir) {
    clearTimers(); // si te vas antes de que caiga el popper, no suenan efectos del escenario anterior
    run.moveTimes.push((now - run.arrow.since) / 1000);
    run.next = randomStage(Date.now(), { activators: P().activators, prevTheme: run.stage.theme });
    view.arrow = null;
    view.transition = { from: run.stage, to: run.next, dir, start: now, dur: 480 };
    setPhase('transition', now);
    sfx.whoosh();
  }

  function finish(now) {
    view.stage = run.stage; view.transition = null; view.arrow = null;
    const total = (now - run.startAt) / 1000;
    const avg = run.moveTimes.reduce((a, b) => a + b, 0) / Math.max(1, run.moveTimes.length);
    run.phase = 'done'; run.endAt = now;
    view.big = 'COMPLETADO'; view.bigColor = '#d4ff3a';
    view.sub = `${run.moves} desplazamientos · ${total.toFixed(1)} s · reacción media ${avg.toFixed(2)} s`;
    beep({ freq: 2200, dur: 0.15 }); timers.push(setTimeout(() => beep({ freq: 2200, dur: 0.15 }), 220));
    say('Completado');
    $('#dryStart').textContent = '▶ Empezar';
  }

  let hudT = 0;
  function updateHud(now) {
    if (now - hudT < 100) return; hudT = now;
    const moves = run?.moves ?? 0, goal = P().moves;
    const time = run?.startAt ? ((run.phase === 'done' ? run.endAt : now) - run.startAt) / 1000 : 0;
    $('#dryHud').innerHTML = `<div><span>DESPLAZAMIENTOS</span><b>${moves}${goal ? ` / ${goal}` : ''}</b></div><div><span>TIEMPO</span><b>${time.toFixed(1)} s</b></div>`;
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (!tabActive() && !(run && run.phase !== 'done')) return; // no gastar GPU fuera de la pestaña
    if (run && run.phase !== 'done') step(now);
    scene.render(view, now);
    updateHud(now);
  }

  loadSettings();
  requestAnimationFrame(tick);
  return {
    onShow: () => { loadSettings(); scene.checkSize(); },
    debug: () => ({ run, lastPose, view }),
    // avance manual de un fotograma (pruebas con la pestaña en segundo plano)
    stepOnce: (now = performance.now()) => { if (run && run.phase !== 'done') step(now); scene.render(view, now); hudT = 0; updateHud(now); },
    // previsualiza un escenario concreto (pruebas)
    preview: (stage, actAt = null) => { view.stage = stage; view.big = null; view.sub = null; view.arrow = null; stage.actStart = actAt; },
  };
}
