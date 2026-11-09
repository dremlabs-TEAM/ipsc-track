// Entrenamiento en seco: reproductor de entrenamientos.
//
// · Arena libre (un único ejercicio de desplazamientos) o entrenamientos creados en el Editor.
// · Ejercicio «recorrido»: escenario → beep → al segundo aparece la dirección → al desplazarte cambia el escenario.
// · Ejercicio «escenario con tiempo»: beep inicial → tiempo máximo → beep final → descanso → siguiente repetición.
//   El popper activador cae en el segundo elegido y pone en marcha el móvil.
import { randomStage, composeStage, stageFromLayout, lobbyStage } from './course.js?v=20261109-1754';
import { StageRenderer, THEMES, ACT, fallAtReal, moverAtReal } from './scene.js?v=20261109-1754';
import { Analyzer } from './pose.js?v=20261109-1754';
import { beep, audioCtx } from './timer.js?v=20261109-1754';
import * as store from './storage.js?v=20261109-1754';
import { blockSummary, programDuration, fmtDuration, migrateProgram } from './program.js?v=20261109-1754';

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  tick(freq = 880, vol = 0.09) {
    const ac = audioCtx(), t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.13);
  },
  arrow() { sfx.tick(880); setTimeout(() => sfx.tick(1320), 60); },
};

// desplazamiento necesario (fracción del ancho de la imagen) según «Corto / Medio / Largo»
const MOVE_STEP = { 1: 0.05, 2: 0.08, 3: 0.12 };
let mirrorVotes = 0;
const topHist = []; // altura de cabeza/hombros reciente (para saber cuándo te agachas)

export function initDryFire(app) {
  const { toast, getProfile, saveProfile } = app;
  const P = () => getProfile().dry;

  const sceneCanvas = $('#dryScene'), camCanvas = $('#dryCam'), video = $('#dryVideo');
  const scene = new StageRenderer(sceneCanvas);
  let an = null, stream = null, run = null, lastPose = null;
  const keyHeld = { left: false, right: false };
  const timers = [];
  const view = { stage: randomStage(Date.now(), { activators: 'never' }), big: 'ARENA EN SECO', sub: 'Elige un entrenamiento y pulsa «Empezar»' };

  // ---------------- selección de entrenamiento ----------------
  const progSel = $('#dryProgram');
  function freeProgram() {
    const d = P();
    return { free: true, name: 'Arena libre', blocks: [{ type: 'course', name: 'Arena libre', positions: [], reps: 1, rest: 0, startMode: 'fixed', restAfter: 0, startMove: false, maxTime: 0,
      random: { on: true, count: d.moves ? d.moves + 1 : 0, time: d.delay ?? 1, activators: d.activators || 'sometimes', advance: d.advance || 'camera', moveDelay: d.moveDelay ?? 1 } }] };
  }
  function fillPrograms(selectId) {
    const list = store.loadPrograms(), cur = selectId ?? progSel.value;
    progSel.innerHTML = '<option value="">Arena libre (ajustes de abajo)</option>' + list.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    progSel.value = list.some((p) => p.id === cur) ? cur : '';
    describe();
  }
  function selectedProgram() {
    const id = progSel.value;
    const found = id && store.loadPrograms().find((p) => p.id === id);
    return found ? migrateProgram(structuredClone(found)) : freeProgram();
  }
  function describe() {
    const p = selectedProgram();
    $('#dryArenaSet').classList.toggle('hidden', !p.free);
    if (p.free) {
      $('#dryDesc').textContent = 'Aparece el escenario, suena el beep y al segundo se indica arriba hacia dónde moverte. En cuanto te desplazas a ese lado, cambia al siguiente escenario.';
      $('#dryBlocks').innerHTML = '';
    } else {
      $('#dryDesc').textContent = `${p.blocks.length} ${p.blocks.length === 1 ? 'ejercicio' : 'ejercicios'} · duración aproximada ${fmtDuration(programDuration(p))}${p.notes ? ' · ' + p.notes : ''}`;
      $('#dryBlocks').innerHTML = p.blocks.map((b, i) => `<li><b>${i + 1}. ${esc(b.name)}</b><span>${esc(blockSummary(b))}</span></li>`).join('');
    }
  }
  progSel.onchange = describe;
  $('#dryEdit').onclick = () => app.openEditor?.(progSel.value || null);

  // ---------------- ajustes ----------------
  const binds = { dryCamMode: 'camera', dryMove: 'moveFactor', dryRange: 'range', dryDelay: 'delay', dryMoves: 'moves', dryAct: 'activators', dryVoice: 'voice', dryAdvance: 'advance', dryMoveDelay: 'moveDelay' };
  function loadSettings() {
    const d = P();
    for (const [id, k] of Object.entries(binds)) { const el = $(`#${id}`); if (el.type === 'checkbox') el.checked = !!d[k]; else el.value = String(d[k]); }
  }
  for (const [id, k] of Object.entries(binds)) $(`#${id}`).onchange = (e) => {
    const el = e.target;
    P()[k] = el.type === 'checkbox' ? el.checked : k === 'camera' ? el.value === 'true' : k === 'activators' || k === 'advance' ? el.value : +el.value;
    saveProfile(); describe();
  };

  // ---------------- teclado (modo sin cámara) ----------------
  const tabActive = () => $('#tab-dry').classList.contains('active');
  window.addEventListener('keydown', (e) => {
    if (!tabActive() || e.target?.matches?.('input, textarea, select') || !$('#modal').classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') { keyHeld.left = true; e.preventDefault(); }
    if (e.key === 'ArrowRight') { keyHeld.right = true; e.preventDefault(); }
    if (e.key === 'ArrowDown') { keyHeld.down = true; e.preventDefault(); }
    if (e.key === 'Escape') { if (stageBox.classList.contains('immersive')) { exitFull(); return; } if (run) stop('DETENIDO'); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft') keyHeld.left = false; if (e.key === 'ArrowRight') keyHeld.right = false; if (e.key === 'ArrowDown') keyHeld.down = false; });

  function say(text) {
    if (!P().voice || !window.speechSynthesis) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'es-ES'; u.rate = 1.3; speechSynthesis.speak(u); } catch { /* sin voz */ }
  }
  const startBeep = () => beep({ freq: getProfile().timer?.freq || 2800, dur: 0.3 });
  const endBeep = () => { beep({ freq: 2200, dur: 0.14 }); timers.push(setTimeout(() => beep({ freq: 2200, dur: 0.14 }), 190)); };

  // ---------------- cámara / pose ----------------
  // Para la arena solo hace falta saber hacia dónde te mueves: modelo rápido, 640×480 y 15 detecciones/s.
  const isMobile = () => matchMedia('(pointer: coarse)').matches || innerWidth < 760;
  const showCam = () => P().showCam ?? !isMobile();
  async function ensureCamera() {
    if (!P().camera) return true;
    try {
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } }, audio: false });
        video.srcObject = stream; await video.play();
      }
      if (!an) {
        an = new Analyzer({ video, canvas: camCanvas, getProfile, onUpdate: null, model: 'lite', maxFps: 15 });
        an.mirror = true; an.noHud = true;
        $('#modelLoading').classList.remove('hidden');
        try { await an.init(); } finally { $('#modelLoading').classList.add('hidden'); }
        an.collectors.add(onPoseFrame);
      } else await an.ensureModel();
      applyCamVisibility();
      return true;
    } catch (e) {
      console.error(e);
      toast(e.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Puedes usar «Sin cámara (teclado)» en Ajustes.' : `Cámara no disponible: ${e.message}`, 5000);
      return false;
    }
  }
  // icono de cámara sobre el escenario: muestra u oculta la imagen (el seguimiento sigue funcionando)
  function applyCamVisibility() {
    const visible = !!stream && showCam();
    $('#dryPip').classList.toggle('hidden', !visible);
    if (an) an.noDraw = !visible;
    const b = $('#dryCamToggle');
    b.classList.toggle('on', visible);
    b.title = visible ? 'Ocultar cámara' : 'Mostrar cámara';
    b.setAttribute('aria-pressed', String(visible));
  }
  $('#dryCamToggle').onclick = async () => {
    if (!P().camera) { toast('Estás en modo sin cámara (teclado). Cámbialo en Ajustes → Seguimiento.'); return; }
    if (!stream) { P().showCam = true; saveProfile(); await ensureCamera(); return; }
    P().showCam = !showCam(); saveProfile(); applyCamVisibility();
  };

  // ---------------- pantalla completa ----------------
  const stageBox = $('#dryStage');
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const isFull = () => !!fsElement() || stageBox.classList.contains('immersive');
  async function enterFull() {
    const req = stageBox.requestFullscreen || stageBox.webkitRequestFullscreen;
    if (req) {
      try {
        await req.call(stageBox, { navigationUI: 'hide' });
        try { await screen.orientation?.lock?.('landscape'); } catch { /* no todos los navegadores lo permiten */ }
        return;
      } catch { /* sin pantalla completa real: modo inmersivo */ }
    }
    stageBox.classList.add('immersive'); document.body.classList.add('no-scroll');
    if (/iPhone|iPod/.test(navigator.userAgent) && !navigator.standalone && !sessionStorage.getItem('ipsctrack.iosHint')) {
      try { sessionStorage.setItem('ipsctrack.iosHint', '1'); } catch { /* sin almacenamiento */ }
      toast('En iPhone, para quitar del todo las barras: Compartir → «Añadir a pantalla de inicio» y abre la app desde ahí', 6000);
    }
    updateFullBtn();
  }
  function exitFull() {
    if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    try { screen.orientation?.unlock?.(); } catch { /* nada */ }
    stageBox.classList.remove('immersive'); document.body.classList.remove('no-scroll');
    updateFullBtn();
  }
  function updateFullBtn() {
    const b = $('#dryFull'), full = isFull();
    b.textContent = full ? '✕' : '⛶'; b.title = full ? 'Salir de pantalla completa' : 'Pantalla completa';
    setTimeout(() => scene.checkSize(), 60);
  }
  $('#dryFull').onclick = () => (isFull() ? exitFull() : enterFull());
  document.addEventListener('fullscreenchange', updateFullBtn);
  document.addEventListener('webkitfullscreenchange', updateFullBtn);

  // posición lateral (centro de cadera) en espejo: «izquierda» = tu izquierda
  function onPoseFrame(cur) {
    const lm = an.img;
    if (!lm || !cur) { lastPose = null; return; }
    const LS = lm[11], RS = lm[12], LH = lm[23], RH = lm[24];
    const vis = (q) => (q.visibility ?? 1) >= 0.3;
    // punto central del cuerpo: media de los hombros y caderas que se vean (no hace falta verlos todos)
    const pts = [LS, RS, LH, RH].filter(vis);
    if (pts.length < 2) { lastPose = null; return; }
    const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length;
    const sy = vis(LS) && vis(RS) ? (LS.y + RS.y) / 2 : null;
    const torso = sy != null && vis(LH) && vis(RH) ? Math.max(0.02, (LH.y + RH.y) / 2 - sy) : lastPose?.torso;
    // en espejo para que «izquierda» sea tu izquierda (salvo que la cámara ya envíe la imagen invertida)
    const tops = [lm[0], LS, RS].filter(vis);
    const top = tops.length ? tops.reduce((a, q) => a + q.y, 0) / tops.length : null;
    if (top != null) { topHist.push({ t: performance.now(), top }); while (topHist.length > 120) topHist.shift(); }
    lastPose = { top, t: performance.now(), x: P().mirrored ? cx : 1 - cx, sw: vis(LS) && vis(RS) ? Math.abs(LS.x - RS.x) : lastPose?.sw ?? 0.1, y: sy ?? lastPose?.y, torso };
  }
  function pose() {
    if (P().camera) return lastPose && performance.now() - lastPose.t < 500 ? lastPose : null;
    return { t: performance.now(), x: run.simX, sw: 0.12, sim: true };
  }

  // ---------------- control ----------------
  const clearTimers = () => { while (timers.length) clearTimeout(timers.pop()); };
  const blk = () => run.program.blocks[run.bi];
  const setPhase = (ph, now = performance.now()) => { run.phase = ph; run.phaseAt = now; };

  async function start(program = selectedProgram()) {
    document.activeElement?.blur();
    if (!program?.blocks?.length) { toast('Este entrenamiento no tiene ejercicios'); return; }
    audioCtx();
    // la cámara solo hace falta si algún desplazamiento o muro con ventana se activa con el cuerpo
    const camMove = (b) => (b.type === 'arena' && b.advance !== 'auto') || (b.type === 'stage' && b.withMove)
      || (b.type === 'course' && (b.random?.on ? b.random.advance !== 'auto'
        : (b.positions || []).some((ps, i) => (i > 0 || b.startMove) && ps.advance !== 'auto')));
    const camPort = (b) => [b, ...(b.positions || [])].some((sc) => sc.port?.on && sc.port.open !== 'auto');
    const needsMove = program.blocks.some((b) => camMove(b) || camPort(b));
    if (needsMove && P().camera && !(await ensureCamera())) return;
    clearTimers();
    run = {
      program, needsMove, phase: 'setup', phaseAt: performance.now(), samples: [], simX: 0.5,
      bi: 0, rep: 0, moves: 0, totalMoves: 0, repsDone: 0, moveTimes: [], startAt: null, n: 1, lastTick: null,
    };
    prepareBlock(performance.now());
    view.transition = null; view.arrow = null; view.warn = null; view.timer = null; view.dim = 0;
    $('#dryStart').textContent = '↻ Reiniciar';
    if (needsMove) say(P().camera ? 'Colócate en el centro' : 'Preparado');
  }
  function stop(text) {
    if (!run) return;
    clearTimers(); run.phase = 'done'; run.endAt = performance.now();
    Object.assign(view, { arrow: null, transition: null, warn: null, timer: null, dim: 0, big: text, sub: '', bigColor: '#d4ff3a', port: null, portHint: false });
    $('#dryStart').textContent = '▶ Empezar';
  }
  $('#dryStart').onclick = () => start();
  $('#dryAbort').onclick = () => stop('DETENIDO');

  function stageForBlock(b, rep) {
    if (b.layout && (!b.vary || rep === 0)) return stageFromLayout(b.layout);
    return composeStage(b.comp, (Date.now() + rep * 7919) >>> 0);
  }
  // deja listo (y visible) el primer escenario del ejercicio actual
  function prepareBlock(now) {
    const b = blk();
    run.rep = 0; run.moves = 0; view.port = null; view.portHint = false;
    if (b.type === 'arena') {
      run.stage = randomStage(Date.now(), { activators: b.activators, prevTheme: run.stage?.theme ?? -1 });
      view.stage = run.stage;
    } else if (b.type === 'course') {
      buildCourse(b);
      run.posIdx = 0;
      view.stage = b.startMove ? run.lobby : run.posStages[0];
      warm(...run.posStages, run.lobby);
    } else {
      run.repStage = stageForBlock(b, 0);
      run.lobby = lobbyStage(run.repStage.theme);
      view.stage = b.withMove ? run.lobby : run.repStage;
      warm(run.repStage, run.lobby);
    }
  }

  function goStandby(now, next) {
    run.afterStandby = next;
    run.standbyUntil = now + 1500 + Math.random() * 1300;
    Object.assign(view, { big: 'PREPARADO', sub: 'Espera el beep', bigColor: '#d4ff3a', dim: 0 });
    setPhase('standby', now);
  }

  function beginBlock(now) {
    const b = blk();
    view.big = null; view.sub = null;
    run.startAt ??= now;
    if (b.type === 'arena') { startBeep(); startScene(now); }
    else if (b.type === 'course') startCourseRep(now);
    else startRep(now);
  }

  // ---- ejercicio «recorrido personalizado» ----
  // escenarios nuevos (popper levantado, móvil en reposo) para cada repetición
  function buildCourse(b) {
    run.posList = []; run.posStages = [];
    if (b.random?.on) {
      const n = b.random.count > 0 ? b.random.count : 2; // «sin fin»: se van añadiendo
      for (let i = 0; i < n; i++) addRandomPos(b);
    } else {
      run.posList = b.positions;
      run.posStages = b.positions.map((pos, i) => (pos.randomScene || !pos.layout ? composeStage(pos.comp, (Date.now() + i * 7919 + Math.floor(Math.random() * 1e6)) >>> 0) : stageFromLayout(pos.layout)));
    }
    run.lobby = lobbyStage(run.posStages[0]?.theme ?? 0);
  }
  function addRandomPos(b) {
    const R = b.random, prev = run.posStages[run.posStages.length - 1];
    run.posList.push({ dir: 'random', time: R.time, advance: R.advance, moveDelay: R.moveDelay, activatorAt: 1, port: null });
    run.posStages.push(randomStage((Date.now() + run.posStages.length * 7919) >>> 0, { activators: R.activators, prevTheme: prev?.theme ?? -1 }));
  }
  function startCourseRep(now) {
    const b = blk();
    startBeep();
    run.startAt ??= now;
    run.beepAt = now;
    view.big = null; view.sub = null; view.dim = 0;
    if (b.startMove) {
      // empieza en la galería vacía: la flecha sale con el beep y P1 entra al desplazarte
      run.posIdx = -1; view.stage = run.lobby; view.transition = null; setPort(null, now);
      const d = run.posList[0]?.dir;
      showArrow(now, false, d === 'left' ? -1 : d === 'right' ? 1 : 0);
      setPhase('course-arrow', now);
    } else { run.posIdx = 0; showPos(now); }
  }
  function showPos(now) {
    view.stage = run.posStages[run.posIdx]; view.transition = null; view.arrow = null;
    run.posShownAt = now; run.actFired = false;
    setPort(run.posList[run.posIdx]?.port, now);
    setPhase('course-pos', now);
  }
  function endCourseRep(now) {
    const b = blk();
    endBeep();
    run.repsDone++;
    view.timer = null; view.arrow = null; view.transition = null;
    if (run.rep + 1 < b.reps) {
      run.rep++;
      buildCourse(b); run.posIdx = 0;
      run.restUntil = now + b.rest * 1000; run.lastTick = null;
      view.stage = b.startMove ? run.lobby : run.posStages[0]; setPort(b.startMove ? null : run.posList[0]?.port, now);
      warm(...run.posStages);
      setPhase('rest', now);
    } else endBlock(now);
  }
  // ---- muro con ventana baja: el escenario se ve por la ventana al agacharte ----
  function setPort(cfg, now) {
    run.portCfg = cfg?.on ? cfg : null; run.portStart = null; run.portDone = !run.portCfg; run.portShownAt = now;
    view.port = run.portCfg ? { cfg: run.portCfg, p: 0 } : null; view.portHint = false;
    // altura de pie de referencia: el punto más alto de la cabeza/hombros en los últimos 2,5 s
    const recent = topHist.filter((h) => h.t >= now - 2500);
    run.standTop = recent.length ? Math.min(...recent.map((h) => h.top)) : null;
  }
  // cuánto te has agachado: 1 = suficiente (la cabeza/hombros bajan ~1/3 del largo del torso)
  function crouchAmount(p) {
    if (!p) return 0;
    if (p.sim) return keyHeld.down ? 1 : 0;
    if (p.top == null) return 0;
    if (run.standTop == null || p.top < run.standTop) run.standTop = p.top; // aún de pie: actualiza la referencia
    const torso = run.torso || p.torso || 0.22;
    return clamp((p.top - run.standTop) / (0.33 * torso), 0, 1.2);
  }
  const crouched = (p) => crouchAmount(p) >= 1;
  // true = aún tras el muro · 'opened' = acaba de verse el escenario · false = sin muro o ya abierto
  function portStep(now, p) {
    const cfg = run.portCfg; if (!cfg || run.portDone) return false;
    if (run.portStart == null) {
      const autoAt = run.portShownAt + (cfg.at ?? 2) * 1000;
      const amount = P().camera ? crouchAmount(p) : keyHeld.down ? 1 : 0;
      const open = cfg.open === 'auto' ? now >= autoAt : P().camera ? amount >= 1 : keyHeld.down || now >= autoAt;
      view.portHint = !open && cfg.open !== 'auto' ? { progress: Math.min(1, amount) } : false;
      if (!open) return true;
      run.portStart = now; sfx.tick(520, 0.08);
    }
    const k = clamp((now - run.portStart) / 450, 0, 1);
    view.port.p = 1 - Math.pow(1 - k, 3);
    if (k < 1) return true;
    run.portDone = true; return 'opened';
  }

  // caída del popper activador al segundo indicado desde que aparece el escenario
  function maybeActivate(st, shownAt, activatorAt, now) {
    if (!st?.act || run.actFired) return;
    const atMs = (activatorAt ?? 1) * 1000;
    const sp = atMs < ACT.fallStart ? ACT.fallStart / Math.max(300, atMs) : 1;
    if (now >= shownAt + Math.max(0, atMs - ACT.fallStart)) { st.actSpeed = sp; fireActivation(st, now); }
  }

  // ---- ejercicio «recorrido» ----
  // prepara en segundo plano un escenario que se va a mostrar enseguida (evita tirones al cambiar)
  const warm = (...stages) => timers.push(setTimeout(() => stages.forEach((st) => scene.prewarm(st)), 40));

  function startScene(now) {
    run.sceneAt = now; run.stage.actStart = null; run.stage.actSpeed = 1; run.actFired = false;
    view.stage = run.stage; view.transition = null; view.arrow = null;
    run.next = randomStage(Date.now(), { activators: blk().activators, prevTheme: run.stage.theme });
    warm(run.next);
    setPhase('scene', now);
  }

  // ---- ejercicio «escenario con tiempo» ----
  function startRep(now) {
    const b = blk();
    startBeep();
    run.startAt ??= now;
    run.beepAt = now; run.actFired = false;
    run.repStage ??= stageForBlock(b, run.rep);
    view.big = null; view.sub = null; view.dim = 0;
    if (b.withMove) { view.stage = run.lobby; setPort(null, now); setPhase('rep-move', now); showArrow(now, true); }
    else { view.stage = run.repStage; run.shownAt = now; setPort(b.port, now); setPhase('rep-run', now); }
  }
  function endRep(now) {
    const b = blk();
    endBeep();
    run.repsDone++;
    view.timer = null; view.arrow = null; view.transition = null;
    if (run.rep + 1 < b.reps) {
      run.rep++;
      run.repStage = stageForBlock(b, run.rep);
      run.lobby = lobbyStage(run.repStage.theme);
      run.restUntil = now + b.rest * 1000; run.lastTick = null;
      view.stage = b.withMove ? run.lobby : run.repStage;
      setPort(b.withMove ? null : b.port, now);
      warm(run.repStage, run.lobby);
      setPhase('rest', now);
    } else endBlock(now);
  }

  function endBlock(now) {
    const prog = run.program;
    if (run.bi + 1 < prog.blocks.length) {
      const restAfter = blk().restAfter ?? 10; // descanso tras el ejercicio que acaba de terminar
      run.bi++;
      prepareBlock(now);
      run.betweenUntil = now + Math.max(3, restAfter) * 1000;
      run.lastTick = null;
      setPhase('between', now);
    } else finish(now);
  }

  function fireActivation(st, now) {
    st.actStart = now; run.actFired = true;
    const sp = st.actSpeed || 1;
    timers.push(setTimeout(() => sfx.clang(), fallAtReal(sp) + (ACT.fallDur * 0.7) / Math.max(1, sp)));
    timers.push(setTimeout(() => sfx.clack(), moverAtReal(sp)));
  }

  function chooseDir(p) {
    if (!run.T) return Math.random() < 0.5 ? -1 : 1; // sin cámara: al azar
    const T = run.T, x = p ? p.x : run.lastX ?? run.x0, off = x - run.x0;
    const Rm = P().range ? P().range * T : Infinity;
    const can = (d) => Math.abs(off + d * T) <= Rm + 0.35 * T && x + d * T >= 0.03 && x + d * T <= 0.97;
    const opts = [-1, 1].filter(can);
    if (!opts.length) return off > 0 ? -1 : 1;
    if (opts.length === 1) return opts[0];
    const norm = clamp(off / (Rm === Infinity ? 0.3 : Rm), -1, 1);
    return Math.random() < 0.5 - 0.3 * norm ? 1 : -1;
  }
  function showArrow(now, quiet = false, forced = 0) {
    const p = pose();
    const dir = forced || chooseDir(p);
    run.arrow = { dir, since: now }; run.origin = p ? p.x : null; run.trigSince = null;
    if (an) an.maxFps = 30; // respuesta más rápida mientras hay que desplazarse
    view.arrow = run.arrow;
    if (!quiet) sfx.arrow();
    say(dir < 0 ? 'Izquierda' : 'Derecha');
  }
  // ¿se ha desplazado ya hacia la flecha?
  function movedEnough(now, p) {
    if (!p) return false;
    const dir = run.arrow.dir;
    if (run.origin == null) run.origin = p.x;
    const toward = (p.x - run.origin) * dir;
    if (toward >= run.T) {
      run.trigSince ??= now;
      if (now - run.trigSince >= 60) { mirrorVotes = 0; return true; }
      return false;
    }
    run.trigSince = null;
    // ¿te mueves claramente al lado contrario? Si pasa dos veces seguidas, la cámara envía la imagen en espejo
    if (!p.sim && -toward >= run.T * 1.4 && !run.arrow.oppCounted) {
      run.arrow.oppCounted = true;
      if (++mirrorVotes >= 2) {
        mirrorVotes = 0; P().mirrored = !P().mirrored; saveProfile();
        toast('Tu cámara envía la imagen en espejo: lo he corregido automáticamente', 4500);
        return true;
      }
    }
    return false;
  }
  function sweep(now, from, to, dir, toPort = null) {
    clearTimers();
    if (an) an.maxFps = 15;
    run.moveTimes.push((now - run.arrow.since) / 1000);
    const fromPort = view.port ? { cfg: view.port.cfg, p: view.port.p } : null;
    view.arrow = null; view.port = null; view.portHint = false;
    view.transition = { from, to, dir, start: now, dur: 700, fromPort, toPort: toPort?.on ? { cfg: toPort, p: 0 } : null };
    sfx.whoosh();
  }

  function countdown(now, until, label) {
    const left = Math.max(0, until - now), sec = Math.ceil(left / 1000);
    if (sec !== run.lastTick && sec > 0) { run.lastTick = sec; if (sec <= 3) sfx.tick(sec === 1 ? 1320 : 990, 0.12); }
    Object.assign(view, { big: sec > 3 ? String(sec) : sec > 0 ? `PREPARADO · ${sec}` : 'PREPARADO', sub: label, bigColor: sec > 3 ? '#d4ff3a' : '#ffc53d', dim: 0.38 });
    return left <= 0;
  }

  function info() {
    const prog = run.program, b = blk();
    if (prog.free) {
      const st = run.posStages?.[Math.max(0, run.posIdx ?? 0)] || run.stage;
      return run.startAt && st ? `ESCENARIO ${String(Math.max(0, run.posIdx ?? 0) + 1).padStart(2, '0')} · ${THEMES[st.theme].name.toUpperCase()}` : null;
    }
    let s = `EJ. ${run.bi + 1}/${prog.blocks.length} · ${b.name.toUpperCase()}`;
    if (b.type === 'stage') s += ` · REP ${run.rep + 1}/${b.reps}`;
    else if (b.type === 'course') s += ` · REP ${run.rep + 1}/${b.reps} · POS ${Math.max(0, run.posIdx) + 1}/${b.random?.on && !b.random.count ? '∞' : run.posList?.length ?? b.positions.length}`;
    else if (b.moves) s += ` · ${run.moves}/${b.moves}`;
    return s;
  }

  function step(now) {
    const p = run.needsMove ? pose() : null;
    if (p) run.lastX = p.x;
    if (!P().camera && run.T) {
      const d = (keyHeld.right ? 1 : 0) - (keyHeld.left ? 1 : 0);
      if (d) run.simX = clamp(run.simX + d * (run.T / 0.45) * Math.min(0.05, (now - (run.lastStep || now)) / 1000), 0, 1);
    }
    run.lastStep = now;
    view.info = info();
    const b = blk();
    const movePhase = ['scene', 'arrow', 'rep-move', 'course-arrow'].includes(run.phase);
    // tiempo máximo total del ejercicio
    if (b?.type === 'course' && b.maxTime > 0 && run.beepAt != null && ['course-pos', 'course-arrow', 'course-trans'].includes(run.phase)
      && now - run.beepAt >= b.maxTime * 1000) { view.transition = null; return endCourseRep(now); }
    view.warn = run.needsMove && P().camera && !p && movePhase ? 'NO TE VEO' : null;

    switch (run.phase) {
      case 'setup': {
        if (!run.needsMove) return intro(now);
        if (!p) { Object.assign(view, { big: 'NO TE VEO', sub: 'Ponte de cuerpo entero frente a la cámara, en el centro', bigColor: '#ff6b6b' }); run.samples = []; return; }
        run.samples.push(p);
        Object.assign(view, { big: 'CALIBRANDO', sub: 'Quieto en el centro…', bigColor: '#d4ff3a' });
        if (run.samples.length >= (p.sim ? 1 : 15)) {
          run.x0 = run.samples.reduce((a, s) => a + s.x, 0) / run.samples.length;
          const sw = run.samples.reduce((a, s) => a + s.sw, 0) / run.samples.length;
          run.T = MOVE_STEP[P().moveFactor] ?? 0.08; // fracción del ancho de la imagen
          run.y0 = run.samples.reduce((a, s) => a + (s.y ?? 0), 0) / run.samples.length;
          run.torso = run.samples.reduce((a, s) => a + (s.torso ?? 0.25), 0) / run.samples.length;
          intro(now);
        }
        return;
      }
      case 'intro':
        if (now >= run.introUntil) goStandby(now, 'block');
        return;
      case 'standby':
        if (now >= run.standbyUntil) {
          if (run.afterStandby === 'rep') { view.big = null; if (b.type === 'course') startCourseRep(now); else startRep(now); } else beginBlock(now);
        }
        return;

      // ---------- recorrido ----------
      case 'scene':
        if (run.stage.act && !run.actFired && now >= run.sceneAt + b.delay * 1000) fireActivation(run.stage, now);
        if (now >= run.sceneAt + b.delay * 1000) { showArrow(now); setPhase('arrow', now); }
        return;
      case 'arrow':
        if (b.advance === 'auto' ? now - run.arrow.since >= (b.moveDelay ?? 1) * 1000 : movedEnough(now, p)) {
          run.next ??= randomStage(Date.now(), { activators: b.activators, prevTheme: run.stage.theme });
          sweep(now, run.stage, run.next, run.arrow.dir);
          setPhase('transition', now);
        }
        return;
      case 'transition':
        if (now - view.transition.start >= view.transition.dur) {
          run.stage = run.next; run.next = null; run.moves++; run.totalMoves++; run.n++;
          if (b.moves && run.moves >= b.moves) { view.stage = run.stage; view.transition = null; endBeep(); endBlock(now); return; }
          startScene(now);
        }
        return;

      // ---------- escenario con tiempo ----------
      case 'rep-move':
      case 'rep-trans':
      case 'rep-run': {
        const elapsed = now - run.beepAt;
        view.timer = { elapsed: elapsed / 1000, par: b.par };
        if (run.phase === 'rep-move' && movedEnough(now, p)) { sweep(now, run.lobby, run.repStage, run.arrow.dir, b.port); setPhase('rep-trans', now); }
        else if (run.phase === 'rep-trans' && now - view.transition.start >= view.transition.dur) {
          view.transition = null; view.stage = run.repStage; run.shownAt = now; run.totalMoves++; setPort(b.port, now); setPhase('rep-run', now);
        } else if (run.phase === 'rep-run') {
          const st = run.repStage, ps = portStep(now, p);
          if (ps === 'opened') run.shownAt = now;
          if (ps !== true && st.act && !run.actFired) {
            const atMs = b.activatorAt * 1000;
            const sp = atMs < ACT.fallStart ? ACT.fallStart / Math.max(300, atMs) : 1;
            if (now >= run.shownAt + Math.max(0, atMs - ACT.fallStart)) { st.actSpeed = sp; fireActivation(st, now); }
          }
        }
        if (elapsed >= b.par * 1000) endRep(now);
        return;
      }
      // ---------- recorrido personalizado ----------
      case 'course-pos': {
        const pos = run.posList[run.posIdx];
        const ps = portStep(now, p);
        if (ps === true) { view.timer = b.maxTime ? { elapsed: (now - run.beepAt) / 1000, par: b.maxTime } : null; return; } // aún tras el muro
        if (ps === 'opened') run.posShownAt = now;
        maybeActivate(run.posStages[run.posIdx], run.posShownAt, pos.activatorAt, now);
        view.timer = b.maxTime ? { elapsed: (now - run.beepAt) / 1000, par: b.maxTime } : { elapsed: (now - run.posShownAt) / 1000, par: pos.time };
        if (now >= run.posShownAt + pos.time * 1000) {
          if (!b.maxTime) view.timer = null;
          if (b.random?.on && !b.random.count && run.posIdx + 1 >= run.posList.length) { addRandomPos(b); warm(run.posStages[run.posStages.length - 1]); }
          const next = run.posList[run.posIdx + 1];
          if (!next) return endCourseRep(now);
          showArrow(now, false, next.dir === 'left' ? -1 : next.dir === 'right' ? 1 : 0);
          setPhase('course-arrow', now);
        }
        return;
      }
      case 'course-arrow': {
        const nx = run.posList[run.posIdx + 1];
        if (b.maxTime) view.timer = { elapsed: (now - run.beepAt) / 1000, par: b.maxTime };
        const curStage = run.posIdx >= 0 ? run.posStages[run.posIdx] : run.lobby;
        if (nx.advance === 'auto' ? now - run.arrow.since >= (nx.moveDelay ?? 1) * 1000 : movedEnough(now, p)) {
          sweep(now, curStage, run.posStages[run.posIdx + 1], run.arrow.dir, nx.port); setPhase('course-trans', now);
        }
        return;
      }
      case 'course-trans':
        if (now - view.transition.start >= view.transition.dur) { run.posIdx++; run.totalMoves++; showPos(now); }
        return;

      case 'rest':
        if (countdown(now, run.restUntil, `DESCANSO · siguiente: repetición ${run.rep + 1} de ${b.reps}`)) {
          view.dim = 0;
          if (b.startMode === 'random') goStandby(now, 'rep'); else if (b.type === 'course') startCourseRep(now); else startRep(now);
        }
        return;
      case 'between':
        if (countdown(now, run.betweenUntil, `SIGUIENTE: ${b.name} · ${blockSummary(b)}`)) goStandby(now, 'block');
        return;
    }
  }

  function intro(now) {
    if (run.program.free) return goStandby(now, 'block');
    const b = blk();
    Object.assign(view, { big: run.program.name, sub: `Ejercicio 1 de ${run.program.blocks.length}: ${b.name} · ${blockSummary(b)}`, bigColor: '#d4ff3a' });
    run.introUntil = now + 2800;
    setPhase('intro', now);
  }

  function finish(now) {
    run.phase = 'done'; run.endAt = now;
    const total = (now - (run.startAt ?? now)) / 1000;
    const parts = [];
    if (!run.program.free) parts.push(`${run.program.blocks.length} ${run.program.blocks.length === 1 ? 'ejercicio' : 'ejercicios'}`);
    if (run.repsDone) parts.push(`${run.repsDone} repeticiones`);
    if (run.totalMoves) parts.push(`${run.totalMoves} desplazamientos`);
    parts.push(`${total.toFixed(1)} s`);
    if (run.moveTimes.length) parts.push(`reacción media ${(run.moveTimes.reduce((a, b) => a + b, 0) / run.moveTimes.length).toFixed(2)} s`);
    Object.assign(view, { arrow: null, timer: null, dim: 0, big: run.program.free ? 'COMPLETADO' : 'ENTRENAMIENTO COMPLETADO', bigColor: '#d4ff3a', sub: parts.join(' · ') });
    say('Completado');
    $('#dryStart').textContent = '▶ Empezar';
  }

  let hudT = 0;
  function updateHud(now) {
    if (now - hudT < 100) return; hudT = now;
    const time = run?.startAt ? ((run.phase === 'done' ? run.endAt : now) - run.startAt) / 1000 : 0;
    const cell = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    let html;
    if (!run || run.program.free) {
      const goal = P().moves;
      html = cell('DESPLAZAMIENTOS', `${run?.totalMoves ?? 0}${goal ? ` / ${goal}` : ''}`) + cell('TIEMPO', `${time.toFixed(1)} s`);
    } else {
      const b = blk(), n = run.program.blocks.length;
      html = cell('EJERCICIO', `${run.bi + 1} / ${n}`)
        + (b.type === 'stage' ? cell('REPETICIÓN', `${Math.min(run.rep + 1, b.reps)} / ${b.reps}`)
          : b.type === 'course' ? cell('REPETICIÓN', `${Math.min(run.rep + 1, b.reps)} / ${b.reps}`) + cell('POSICIÓN', `${Math.max(0, run.posIdx ?? 0) + 1} / ${b.random?.on && !b.random.count ? '∞' : run.posList?.length ?? b.positions.length}`)
          : cell('DESPLAZAMIENTOS', `${run.moves}${b.moves ? ` / ${b.moves}` : ''}`))
        + cell('TIEMPO TOTAL', `${time.toFixed(1)} s`);
    }
    const hud = $('#dryHud'); hud.innerHTML = html; hud.dataset.cols = (html.match(/<div>/g) || []).length;
    const st = !P().camera ? 'key' : !stream ? 'off' : lastPose && now - lastPose.t < 600 ? 'ok' : 'lost';
    const tb = $('#dryCamToggle'); if (tb.dataset.status !== st) tb.dataset.status = st;
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (!tabActive() && !(run && run.phase !== 'done')) return; // no gastar GPU fuera de la pestaña
    if (run && run.phase !== 'done') step(now);
    scene.render(view, now);
    updateHud(now);
  }

  loadSettings(); fillPrograms('');
  requestAnimationFrame(tick);
  return {
    onShow: () => { loadSettings(); fillPrograms(); scene.checkSize(); },
    // arranca un entrenamiento concreto (desde el Editor)
    startProgram: (program, selectId) => { fillPrograms(selectId ?? ''); start(program); },
    debug: () => ({ run, lastPose, view }),
    // avance manual de un fotograma (pruebas con la pestaña en segundo plano)
    stepOnce: (now = performance.now()) => { if (run && run.phase !== 'done') step(now); scene.render(view, now); hudT = 0; updateHud(now); },
    // previsualiza un escenario concreto (pruebas)
    preview: (stage, actAt = null) => { view.stage = stage; view.big = null; view.sub = null; view.arrow = null; stage.actStart = actAt; },
  };
}
