// Entrenamiento en seco: reproductor de entrenamientos.
//
// · Arena libre (un único ejercicio de desplazamientos) o entrenamientos creados en el Editor.
// · Ejercicio «recorrido»: escenario → beep → al segundo aparece la dirección → al desplazarte cambia el escenario.
// · Ejercicio «escenario con tiempo»: beep inicial → tiempo máximo → beep final → descanso → siguiente repetición.
//   El popper activador cae en el segundo elegido y pone en marcha el móvil.
import { randomStage, composeStage, stageFromLayout, lobbyStage } from './course.js?v=20261108-2328';
import { StageRenderer, THEMES, ACT, fallAtReal, moverAtReal } from './scene.js?v=20261108-2328';
import { Analyzer } from './pose.js?v=20261108-2328';
import { beep, audioCtx } from './timer.js?v=20261108-2328';
import * as store from './storage.js?v=20261108-2328';
import { blockSummary, programDuration, fmtDuration } from './program.js?v=20261108-2328';

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
    return { free: true, name: 'Arena libre', blocks: [{ type: 'arena', name: 'Arena libre', moves: d.moves, delay: d.delay, activators: d.activators, restAfter: 0 }] };
  }
  function fillPrograms(selectId) {
    const list = store.loadPrograms(), cur = selectId ?? progSel.value;
    progSel.innerHTML = '<option value="">Arena libre (ajustes de abajo)</option>' + list.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    progSel.value = list.some((p) => p.id === cur) ? cur : '';
    describe();
  }
  function selectedProgram() {
    const id = progSel.value;
    return id ? store.loadPrograms().find((p) => p.id === id) || freeProgram() : freeProgram();
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
  const binds = { dryCamMode: 'camera', dryMove: 'moveFactor', dryRange: 'range', dryDelay: 'delay', dryMoves: 'moves', dryAct: 'activators', dryVoice: 'voice' };
  function loadSettings() {
    const d = P();
    for (const [id, k] of Object.entries(binds)) { const el = $(`#${id}`); if (el.type === 'checkbox') el.checked = !!d[k]; else el.value = String(d[k]); }
  }
  for (const [id, k] of Object.entries(binds)) $(`#${id}`).onchange = (e) => {
    const el = e.target;
    P()[k] = el.type === 'checkbox' ? el.checked : k === 'camera' ? el.value === 'true' : k === 'activators' ? el.value : +el.value;
    saveProfile(); describe();
  };

  // ---------------- teclado (modo sin cámara) ----------------
  const tabActive = () => $('#tab-dry').classList.contains('active');
  window.addEventListener('keydown', (e) => {
    if (!tabActive() || e.target?.matches?.('input, textarea, select') || !$('#modal').classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') { keyHeld.left = true; e.preventDefault(); }
    if (e.key === 'ArrowRight') { keyHeld.right = true; e.preventDefault(); }
    if (e.key === 'Escape') { if (stageBox.classList.contains('immersive')) { exitFull(); return; } if (run) stop('DETENIDO'); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft') keyHeld.left = false; if (e.key === 'ArrowRight') keyHeld.right = false; });

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
    if (Math.min(LS.visibility ?? 1, RS.visibility ?? 1, LH.visibility ?? 1, RH.visibility ?? 1) < 0.5) { lastPose = null; return; }
    lastPose = { t: performance.now(), x: 1 - (LH.x + RH.x) / 2, sw: Math.abs(LS.x - RS.x) };
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
    const needsMove = program.blocks.some((b) => b.type === 'arena' || b.withMove || (b.type === 'course' && b.positions?.length > 1));
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
    Object.assign(view, { arrow: null, transition: null, warn: null, timer: null, dim: 0, big: text, sub: '', bigColor: '#d4ff3a' });
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
    run.rep = 0; run.moves = 0;
    if (b.type === 'arena') {
      run.stage = randomStage(Date.now(), { activators: b.activators, prevTheme: run.stage?.theme ?? -1 });
      view.stage = run.stage;
    } else if (b.type === 'course') {
      run.posStages = courseStages(b);
      run.posIdx = 0;
      view.stage = run.posStages[0];
      warm(...run.posStages);
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
  const courseStages = (b) => b.positions.map((pos) => (pos.layout ? stageFromLayout(pos.layout) : composeStage(pos.comp, Date.now())));
  function startCourseRep(now) {
    startBeep();
    run.startAt ??= now;
    run.beepAt = now; run.posIdx = 0;
    view.big = null; view.sub = null; view.dim = 0;
    showPos(now);
  }
  function showPos(now) {
    view.stage = run.posStages[run.posIdx]; view.transition = null; view.arrow = null;
    run.posShownAt = now; run.actFired = false;
    setPhase('course-pos', now);
  }
  function endCourseRep(now) {
    const b = blk();
    endBeep();
    run.repsDone++;
    view.timer = null; view.arrow = null; view.transition = null;
    if (run.rep + 1 < b.reps) {
      run.rep++;
      run.posStages = courseStages(b); run.posIdx = 0;
      run.restUntil = now + b.rest * 1000; run.lastTick = null;
      view.stage = run.posStages[0];
      warm(...run.posStages);
      setPhase('rest', now);
    } else endBlock(now);
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
    if (b.withMove) { view.stage = run.lobby; setPhase('rep-move', now); showArrow(now, true); }
    else { view.stage = run.repStage; run.shownAt = now; setPhase('rep-run', now); }
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
    view.arrow = run.arrow;
    if (!quiet) sfx.arrow();
    say(dir < 0 ? 'Izquierda' : 'Derecha');
  }
  // ¿se ha desplazado ya hacia la flecha?
  function movedEnough(now, p) {
    if (!p) return false;
    const dir = run.arrow.dir;
    if (run.origin == null) run.origin = p.x;
    run.origin = dir > 0 ? Math.min(run.origin, p.x) : Math.max(run.origin, p.x);
    if ((p.x - run.origin) * dir >= run.T) { run.trigSince ??= now; return now - run.trigSince >= 80; }
    run.trigSince = null; return false;
  }
  function sweep(now, from, to, dir) {
    clearTimers();
    run.moveTimes.push((now - run.arrow.since) / 1000);
    view.arrow = null;
    view.transition = { from, to, dir, start: now, dur: 480 };
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
    if (prog.free) return run.startAt ? `ESCENARIO ${String(run.n).padStart(2, '0')} · ${THEMES[run.stage.theme].name.toUpperCase()}` : null;
    let s = `EJ. ${run.bi + 1}/${prog.blocks.length} · ${b.name.toUpperCase()}`;
    if (b.type === 'stage') s += ` · REP ${run.rep + 1}/${b.reps}`;
    else if (b.type === 'course') s += ` · REP ${run.rep + 1}/${b.reps} · POS ${run.posIdx + 1}/${b.positions.length}`;
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
    const movePhase = ['scene', 'arrow', 'rep-move', 'course-arrow'].includes(run.phase);
    view.warn = run.needsMove && P().camera && !p && movePhase ? 'NO TE VEO' : null;
    const b = blk();

    switch (run.phase) {
      case 'setup': {
        if (!run.needsMove) return intro(now);
        if (!p) { Object.assign(view, { big: 'NO TE VEO', sub: 'Ponte de cuerpo entero frente a la cámara, en el centro', bigColor: '#ff6b6b' }); run.samples = []; return; }
        run.samples.push(p);
        Object.assign(view, { big: 'CALIBRANDO', sub: 'Quieto en el centro…', bigColor: '#d4ff3a' });
        if (run.samples.length >= (p.sim ? 1 : 15)) {
          run.x0 = run.samples.reduce((a, s) => a + s.x, 0) / run.samples.length;
          const sw = run.samples.reduce((a, s) => a + s.sw, 0) / run.samples.length;
          run.T = Math.max(0.035, P().moveFactor * sw);
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
        if (movedEnough(now, p)) {
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
        if (run.phase === 'rep-move' && movedEnough(now, p)) { sweep(now, run.lobby, run.repStage, run.arrow.dir); setPhase('rep-trans', now); }
        else if (run.phase === 'rep-trans' && now - view.transition.start >= view.transition.dur) {
          view.transition = null; view.stage = run.repStage; run.shownAt = now; run.totalMoves++; setPhase('rep-run', now);
        } else if (run.phase === 'rep-run') {
          const st = run.repStage;
          if (st.act && !run.actFired) {
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
        const pos = b.positions[run.posIdx];
        maybeActivate(run.posStages[run.posIdx], run.posShownAt, pos.activatorAt, now);
        view.timer = { elapsed: (now - run.posShownAt) / 1000, par: pos.time };
        if (now >= run.posShownAt + pos.time * 1000) {
          view.timer = null;
          const next = b.positions[run.posIdx + 1];
          if (!next) return endCourseRep(now);
          showArrow(now, false, next.dir === 'left' ? -1 : next.dir === 'right' ? 1 : 0);
          setPhase('course-arrow', now);
        }
        return;
      }
      case 'course-arrow':
        if (movedEnough(now, p)) { sweep(now, run.posStages[run.posIdx], run.posStages[run.posIdx + 1], run.arrow.dir); setPhase('course-trans', now); }
        return;
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
      html = cell('DESPLAZAMIENTOS', `${run?.moves ?? 0}${goal ? ` / ${goal}` : ''}`) + cell('TIEMPO', `${time.toFixed(1)} s`);
    } else {
      const b = blk(), n = run.program.blocks.length;
      html = cell('EJERCICIO', `${run.bi + 1} / ${n}`)
        + (b.type === 'stage' ? cell('REPETICIÓN', `${Math.min(run.rep + 1, b.reps)} / ${b.reps}`)
          : b.type === 'course' ? cell('REPETICIÓN', `${Math.min(run.rep + 1, b.reps)} / ${b.reps}`) + cell('POSICIÓN', `${(run.posIdx ?? 0) + 1} / ${b.positions.length}`)
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
