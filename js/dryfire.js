// Entrenamiento en seco: reproductor de entrenamientos.
//
// · Entrenamiento rápido (escenarios aleatorios con desplazamientos) o entrenamientos creados en el Editor.
// · Ejercicio «recorrido»: escenario → beep → al segundo aparece la dirección → al desplazarte cambia el escenario.
// · Ejercicio «escenario con tiempo»: beep inicial → tiempo máximo → beep final → descanso → siguiente repetición.
//   El popper activador cae en el segundo elegido y pone en marcha el móvil.
import { randomStage, composeStage, stageFromLayout, lobbyStage, layoutOf } from './course.js?v=20261110-2249';
import { StageRenderer, THEMES, ACT, fallAtReal, moverAtReal } from './scene.js?v=20261110-2249';
import { Analyzer } from './pose.js?v=20261110-2249';
import { beep, audioCtx } from './timer.js?v=20261110-2249';
import * as store from './storage.js?v=20261110-2249';
import { blockSummary, programDuration, fmtDuration, migrateProgram, randomPort, WALL_RATE, condText } from './program.js?v=20261110-2249';
import { DRILLS, DRILL_CATS, drillById, buildDrill, setPar, parFor, instructions, CLASSES, classOf, fmtPct, statOf, recordRound, recordSession, resetDrill, overall, advice, LEVELS, LEVEL_REQ, levelName, PROVISIONAL } from './coach.js?v=20261110-2249';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
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
  const view = { stage: randomStage(Date.now(), { activators: 'never' }), big: 'ENTRENAMIENTO EN SECO', sub: 'Elige un entrenamiento y pulsa «Empezar»' };

  // ---------------- selección de entrenamiento ----------------
  const progSel = $('#dryProgram');
  // «Desafíos»: entrenador personal. Ejercicios clásicos (drills) con rondas y condiciones; el tiempo límite
  // sale de tu rendimiento (% respecto a un tirador de élite) y se ajusta ronda a ronda.
  let chCache = null;
  const fmtS1 = (v) => String(v).replace('.', ',');
  function challengeProgram() {
    const d = P(), drill = drillById(d.challenge), reps = d.chReps || 5, key = `${drill.id}|${reps}|${statOf(d, drill.id)?.rounds ?? 0}`;
    if (chCache?.key === key) return chCache.prog;
    const prog = buildDrill(drill, d, reps);
    chCache = { key, prog };
    return prog;
  }
  const instrText = (b) => instructions(b).join(' · ') || 'Dos manos, desde la funda';
  const roundLabel = (b) => `${instrText(b)} · ${fmtS1(b.par)} s`;
  // clase (D…GM) de un % con su color
  const CLS_COL = { GM: '#ff6b9a', M: '#c08bff', A: '#5fd3ff', B: '#d4ff3a', C: '#ffc53d', D: '#9aa6b2' };
  const clsBadge = (pct, big = '') => { const c = classOf(pct); return `<span class="cl-badge ${big}" style="--c:${CLS_COL[c[0]]}">${c[0]}</span>`; };
  // «Varios escenarios con desplazamientos»: cámara (por defecto) o automático; sin opción de teclado
  const movesAuto = () => P().advance === 'auto';
  function freeProgram() {
    const d = P();
    if (d.quickStyle === 'repeat') return challengeProgram();
    return { free: true, name: 'Entrenamiento rápido', blocks: [{ type: 'course', name: 'Entrenamiento rápido', positions: [], reps: 1, rest: 0, startMode: 'fixed', restAfter: 0, startMove: false, maxTime: 0,
      random: { on: true, count: d.moves ? d.moves + 1 : 0, time: d.delay ?? 1, activators: d.activators || 'sometimes', advance: movesAuto() ? 'auto' : 'camera', moveDelay: d.moveDelay ?? 3, walls: d.walls ?? true, portDelay: d.portDelay ?? 0 } }] };
  }
  function fillPrograms(selectId) {
    const list = store.loadPrograms(), cur = selectId ?? progSel.value;
    progSel.innerHTML = '<option value="">Entrenamiento rápido</option>' + list.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    progSel.value = list.some((p) => p.id === cur) ? cur : '';
    describe();
  }
  function selectedProgram() {
    const id = progSel.value;
    const found = id && store.loadPrograms().find((p) => p.id === id);
    return found ? migrateProgram(structuredClone(found)) : freeProgram();
  }
  // ¿qué necesita detectar del cuerpo este entrenamiento? (desplazarse / agacharse)
  const camMove = (b) => (b.type === 'arena' && b.advance !== 'auto') || (b.type === 'stage' && b.withMove)
    || (b.type === 'course' && (b.random?.on ? b.random.advance !== 'auto'
      : (b.positions || []).some((ps, i) => (i > 0 || b.startMove) && ps.advance !== 'auto')));
  const camPort = (b) => [b, ...(b.positions || [])].some((sc) => sc.port?.on && sc.port.open !== 'auto');
  const bodyNeeds = (program) => program.blocks.some((b) => camMove(b) || camPort(b));
  const modeOf = () => (progSel.value ? 'program' : P().quickStyle === 'repeat' ? 'repeat' : 'moves');

  // ---------------- pantallas: elegir entrenamiento · sesión ----------------
  const pickScreen = $('#dryPickScreen'), session = $('#drySession');
  function showPicker() {
    if (run && run.phase !== 'done') stop('DETENIDO');
    renderPick();
    pickScreen.classList.remove('hidden'); session.classList.add('hidden');
    window.scrollTo({ top: 0 });
  }
  function showSession() {
    pickScreen.classList.add('hidden'); session.classList.remove('hidden');
    renderSettings(); describe(); scene.checkSize(true);
  }
  const svgI = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    moves: svgI('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>'),
    repeat: svgI('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'),
    program: svgI('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>'),
    plus: svgI('<path d="M12 5v14M5 12h14"/>'),
    cam: svgI('<path d="M4 7h3l1.6-2h6.8L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/>'),
    target: svgI('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
    trophy: svgI('<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/>'),
    sound: svgI('<path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16 9a4 4 0 0 1 0 6"/>'),
    sliders: svgI('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  };
  function renderPick() {
    const list = store.loadPrograms();
    $('#dryPickCount').textContent = list.length ? `Entrenamiento rápido o uno de tus ${list.length} ${list.length === 1 ? 'entrenamiento' : 'entrenamientos'}` : 'Empieza con un entrenamiento rápido o crea el tuyo en el Editor';
    $('#dryPickGrid').innerHTML = `
      <div class="pick-h"><span>⚡</span>Entrenamiento rápido<small>sin preparar nada</small></div>
      <div class="pick-quick">
      <button class="pick-card featured" data-pick="" data-quick="moves">
        <span class="pick-ic" aria-hidden="true">${ICONS.moves}</span>
        <span class="pick-txt"><small class="pick-tag">Entrenamiento rápido</small><b>Varios escenarios con desplazamientos</b>
          <small>Escenarios aleatorios al instante. Sale el escenario, suena el beep y una flecha te indica hacia dónde desplazarte; a veces, tras un muro con ventana.</small></span>
        <span class="pick-go">Elegir →</span>
      </button>
      <button class="pick-card featured alt" data-pick="" data-quick="repeat">
        <span class="pick-ic" aria-hidden="true">${ICONS.repeat}</span>
        <span class="pick-txt"><small class="pick-tag">Entrenador personal · ${DRILLS.length} desafíos</small><b>Desafíos</b>
          <small>Desenfundes, móviles, salidas con desplazamiento, mano débil, recargas, El Presidente… Mide tu % respecto a un tirador de élite y sube de clase (D → GM).</small>
          ${(() => { const o = overall(P()); return o ? `<span class="pick-cls">${clsBadge(o.pct)} Tu clase: <b>${classOf(o.pct)[2]}</b> · ${fmtPct(o.pct)}</span>` : ''; })()}</span>
        <span class="pick-go">Elegir →</span>
      </button>
      </div>
      <div class="pick-h"><span>☰</span>Mis entrenamientos<small>${list.length ? `${list.length} creados en el Editor` : 'aún no tienes ninguno'}</small></div>
      <div class="pick-grid">
      ${list.map((p) => {
        const n = p.blocks.length;
        return `<button class="pick-card" data-pick="${p.id}">
          <span class="pick-ic" aria-hidden="true">${ICONS.program}</span>
          <span class="pick-txt"><small class="pick-tag mine">Mi entrenamiento</small><b>${esc(p.name)}</b>
            <small>${n} ${n === 1 ? 'ejercicio' : 'ejercicios'} · ≈ ${fmtDuration(programDuration(p))}</small>
            <span class="pick-ex">${p.blocks.slice(0, 3).map((b, i) => `<i>${i + 1}. ${esc(b.name)}</i>`).join('')}${n > 3 ? `<i>+${n - 3} más</i>` : ''}</span></span>
          <span class="pick-go">Elegir →</span>
        </button>`;
      }).join('')}
      <button class="pick-card add" data-newtrain="1">
        <span class="pick-ic" aria-hidden="true">${ICONS.plus}</span>
        <span class="pick-txt"><b>Crear un entrenamiento</b><small>Diseña tus propios ejercicios, escenarios y desplazamientos en el Editor.</small></span>
      </button>
      </div>`;
  }
  $('#dryPickGrid').addEventListener('click', (e) => {
    if (e.target.closest('[data-newtrain]')) { app.newTraining?.(); return; }
    const c = e.target.closest('[data-pick]'); if (!c) return;
    select(c.dataset.pick || null, c.dataset.quick);
  });
  $('#dryBack').onclick = showPicker;
  function select(id, quick) {
    if (quick) {
      const d = P(); d.quickStyle = quick;
      if (quick === 'moves' && d.advance !== 'auto') d.camera = true; // aquí no hay teclado: la cámara por defecto
      saveProfile(); chCache = null;
    }
    fillPrograms(id || '');
    showSession();
  }

  // ---------------- barra del modo (arriba) y detalles (debajo del escenario) ----------------
  let idleProg = null;
  function describe() {
    const p = selectedProgram(), mode = p.challenge ? 'repeat' : p.free ? 'moves' : 'program';
    idleProg = p; hudT = 0;
    if (!run || run.phase === 'done') {
      // antes de empezar se ve el escenario que toca (en los retos, el que se va a repetir)
      const first = p.blocks[0]?.positions?.[0];
      if (mode !== 'moves' && first?.layout) view.stage = stageFromLayout(first.layout);
      view.info = null; // sin datos de la sesión anterior
      if (!run) Object.assign(view, { big: mode === 'repeat' ? 'RETO' : mode === 'program' ? 'MI ENTRENAMIENTO' : 'ENTRENAMIENTO EN SECO', sub: 'Pulsa «▶ Empezar» cuando estés listo', bigColor: '#d4ff3a', port: null, transition: null, arrow: null });
    }
    $('#dryModeIc').innerHTML = ICONS[mode];
    session.dataset.mode = mode;
    $('#dryEdit').classList.toggle('hidden', mode !== 'program');
    let how = [];
    if (mode === 'repeat') {
      const drill = drillById(p.challenge.id), st = statOf(P(), drill.id);
      $('#dryModeKicker').textContent = `Desafíos · ${(DRILL_CATS.find(([k]) => k === drill.cat) || [, ''])[1]}`;
      $('#dryModeTitle').innerHTML = `${esc(drill.name)} <span class="dry-lv lvl">NV ${st?.level ?? 1}</span><span class="dry-lv" style="--c:${st ? CLS_COL[classOf(st.skill)[0]] : '#9aa6b2'}">${st ? `CLASE ${classOf(st.skill)[0]} · ${fmtPct(st.skill)}` : 'SIN CLASIFICAR'}</span>`;
      $('#dryDesc').textContent = `${drill.desc} ${p.blocks.length} rondas de ${p.blocks[0].reps} repeticiones con el mismo escenario.`;
      $('#dryBlocks').innerHTML = p.blocks.map((b) => `<li><b>${esc(b.name)} · ${b.reps}×</b><span>${esc(instrText(b))}</span><em>${fmtS1(b.par)} s</em></li>`).join('');
      how = ['Colócate frente a la pantalla como indique la salida (por defecto, arma enfundada y manos a los costados). <b>Arma descargada y sin munición en la sala.</b>',
        'Antes de cada ronda verás sus <b>instrucciones en grande</b>: salida, mano, desplazamiento, recarga…',
        'Cada repetición: «PREPARADO», beep aleatorio, tiempo límite desde el beep (barra arriba) y beep final. No necesita cámara: los desplazamientos y las ventanas son automáticos.',
        'Durante la ronda no tocas nada. Al acabarla, di <b>cuántos segundos te han sobrado</b> de media (o «No llegué»). La siguiente ronda se ajusta a tu tiempo con un pequeño margen y sigue apretando.',
        'Tu umbral se compara con el de un tirador de élite en seco: tu <b>%</b> y tu clase (D, C, B, A, M, GM).',
        'Para subir de <b>nivel</b> (1–10) termina la sesión completa con el umbral que pide el siguiente nivel. Como mucho, un nivel por sesión.'];
    } else if (mode === 'moves') {
      const d = P();
      $('#dryModeKicker').textContent = 'Entrenamiento rápido';
      $('#dryModeTitle').textContent = 'Varios escenarios con desplazamientos';
      $('#dryDesc').textContent = `Escenarios aleatorios${d.walls ? ', algunos tras un muro con ventana' : ''}. ${d.moves ? `${d.moves} desplazamientos` : 'Desplazamientos sin fin'} · flecha a los ${fmtS1(d.delay)} s · ${movesAuto() ? `cambio automático a los ${fmtS1(d.moveDelay ?? 3)} s, sin cámara` : 'detección con cámara'}.`;
      $('#dryBlocks').innerHTML = '';
      how = movesAuto()
        ? ['Pulsa «Empezar». Sale el escenario y suena el beep: resuélvelo en seco.', 'Sale una flecha y el escenario cambia solo a los segundos indicados.', 'Los muros con ventana se abren solos: la ventana se acerca hasta enmarcar el escenario.']
        : ['Coloca la cámara a 3–4 m, a la altura del pecho, y sal de cuerpo entero. <b>Arma descargada y sin munición en la sala.</b>',
          'Pulsa «Empezar» y quédate quieto en el centro mientras te calibra.', 'Sale el escenario y suena el beep. Al poco aparece una flecha: desplázate a ese lado y cambia el escenario.',
          'Si aparece un muro con ventana, agáchate para ver el escenario.', 'Sin cámara a mano: cambia la detección a «Automático» y el escenario cambiará solo.'];
    } else {
      $('#dryModeKicker').textContent = 'Mi entrenamiento';
      $('#dryModeTitle').textContent = p.name;
      $('#dryDesc').textContent = `${p.blocks.length} ${p.blocks.length === 1 ? 'ejercicio' : 'ejercicios'} · duración aproximada ${fmtDuration(programDuration(p))}${p.notes ? ' · ' + p.notes : ''}`;
      $('#dryBlocks').innerHTML = p.blocks.map((b, i) => `<li><b>${i + 1}. ${esc(b.name)}</b><span>${esc(blockSummary(b))}</span></li>`).join('');
      how = ['En cada repetición suena el beep inicial, corre el tiempo (barra arriba) y suena el beep final.', 'Entre repeticiones hay un descanso con cuenta atrás; los últimos segundos avisan «PREPARADO».',
        bodyNeeds(p) ? 'Este entrenamiento tiene desplazamientos o muros que se activan con el cuerpo: usa la cámara o el teclado.' : 'No necesita cámara: todo es automático.'];
    }
    $('#dryHowList').innerHTML = how.map((t) => `<li>${t}</li>`).join('');
  }
  progSel.onchange = () => { describe(); renderSettings(); };
  $('#dryEdit').onclick = () => app.openEditor?.(progSel.value || null);

  // ---------------- ajustes de cada modo ----------------
  const gsec = (icon, title, body, cls = '') => `<section class="gx-sec ${cls}"><h4><span class="gx-ic">${ICONS[icon]}</span>${title}</h4>${body}</section>`;
  const gseg = (key, val, opts) => `<div class="gx-seg" data-set="${key}" role="radiogroup">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${String(v) === String(val)}" class="${String(v) === String(val) ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const gtog = (key, on, label, desc = '') => `<button type="button" class="gx-tog ${on ? 'on' : ''}" data-toggle="${key}" role="switch" aria-checked="${!!on}"><span class="gx-tog-txt"><b>${label}</b>${desc ? `<small>${desc}</small>` : ''}</span><i></i></button>`;
  const gstep = (key, val, min, max, step, fmt) => `<div class="gx-step" data-step="${key}" data-min="${min}" data-max="${max}" data-st="${step}"><button type="button" data-d="-1" ${val <= min ? 'disabled' : ''} aria-label="Menos">−</button><b>${fmt(val)}</b><button type="button" data-d="1" ${val >= max ? 'disabled' : ''} aria-label="Más">+</button></div>`;
  const grow = (label, ctl, hint = '') => `<div class="gx-row"><span class="gx-lbl">${label}</span>${ctl}${hint ? `<small class="gx-hint">${hint}</small>` : ''}</div>`;
  const secs = (v) => `${fmtS1(v)} s`;
  function detectionSec(withAuto) {
    const d = P(), det = withAuto ? (movesAuto() ? 'auto' : 'camera') : d.camera ? 'camera' : 'keys';
    // en «Varios escenarios» solo cámara o automático; en «Mis entrenamientos», cámara o teclado
    const opts = withAuto ? [['camera', '📷 Cámara'], ['auto', '⏱ Automático']] : [['camera', '📷 Cámara'], ['keys', '⌨ Teclado']];
    const hint = det === 'auto' ? 'Sin cámara: el escenario cambia solo y las ventanas se abren solas.'
      : det === 'camera' ? 'La cámara detecta cuándo te desplazas y cuándo te agachas.' : 'Mantén ← o → para desplazarte y ↓ para agacharte.';
    let body = gseg('detect', det, opts) + `<small class="gx-hint">${hint}</small>`;
    if (det === 'camera') body += grow('Desplazamiento necesario', gseg('moveFactor', d.moveFactor, [[1, 'Corto'], [2, 'Medio'], [3, 'Largo']]));
    if (det !== 'auto') body += grow('Espacio a cada lado', gseg('range', d.range, [[1, '1 paso'], [2, '2 pasos'], [0, 'Libre']]), 'Para que la flecha no te saque de tu zona.');
    if (det === 'auto') {
      body += grow('Cambio de escenario', gstep('moveDelay', d.moveDelay ?? 3, 0.5, 5, 0.5, (v) => `${fmtS1(v)} s tras la flecha`));
      if (d.walls) body += grow('Ventana del muro', gstep('portDelay', d.portDelay ?? 0, 0, 3, 0.5, (v) => (v ? `se abre a los ${fmtS1(v)} s` : 'al aparecer')));
    }
    return gsec('cam', 'Detección', body);
  }
  function renderSettings() {
    const d = P(), mode = modeOf();
    let html = `<div class="gx-head"><span>Ajustes</span><em>${mode === 'repeat' ? 'Reto' : mode === 'moves' ? 'Rápido' : 'Mi entrenamiento'}</em></div>`;
    if (mode === 'moves') {
      html += detectionSec(true);
      html += gsec('target', 'Escenarios',
        grow('Desplazamientos', gseg('moves', d.moves, [[10, '10'], [20, '20'], [40, '40'], [0, '∞']]))
        + grow('Flecha a los', gstep('delay', d.delay, 0.5, 3, 0.5, secs))
        + grow('Poppers activadores', gseg('activators', d.activators, [['never', 'Nunca'], ['sometimes', 'A veces'], ['always', 'Siempre']]))
        + gtog('walls', d.walls, 'Muros con ventana', 'Algunos escenarios empiezan tras un muro: agáchate para verlos.'));
      html += gsec('sound', 'Avisos', gtog('voice', d.voice, 'Dirección por voz', 'Dice «izquierda» o «derecha» al salir la flecha.'));
    } else if (mode === 'repeat') {
      html += coachPanel(d);
      html += gsec('repeat', 'Rondas', grow('Repeticiones por ronda', gseg('chReps', d.chReps || 5, [[3, '3'], [5, '5'], [8, '8']]))
        + '<small class="gx-hint">El mismo escenario en todas las rondas. No necesita cámara: los desplazamientos y las ventanas son automáticos.</small>');
    } else {
      const p = selectedProgram();
      if (bodyNeeds(p)) html += detectionSec(false) + gsec('sound', 'Avisos', gtog('voice', d.voice, 'Dirección por voz', 'Dice «izquierda» o «derecha» al salir la flecha.'));
      else html += gsec('cam', 'Detección', '<div class="gx-note">✓ Este entrenamiento no necesita cámara: todo es automático.</div>');
      html += gsec('program', 'Entrenamiento', `<div class="gx-note">${p.blocks.length} ${p.blocks.length === 1 ? 'ejercicio' : 'ejercicios'} · ≈ ${fmtDuration(programDuration(p))}</div>
        <small class="gx-hint">Tiempos, repeticiones y condiciones se ajustan en el Editor.</small>`);
    }
    $('#drySettings').innerHTML = html;
  }
  // ---- panel del entrenador: tu clase, el desafío elegido (progreso) y el catálogo ----
  const zoneBar = (marks) => `<div class="cl-gauge">${[...CLASSES].reverse().map(([c, min], i, a) => {
      const max = i + 1 < a.length ? a[i + 1][1] : 100;
      return `<i style="--c:${CLS_COL[c]};flex:${max - min}"><b>${c}</b></i>`; }).join('')}
    ${marks.map(([v, cls, t]) => `<em class="${cls}" style="left:${Math.max(0, Math.min(100, v))}%" title="${t}"></em>`).join('')}</div>`;
  function spark(sessions) {
    if (!sessions?.length) return '';
    if (sessions.length < 2) return '<small class="gx-hint">Tu evolución sesión a sesión aparecerá aquí a partir de la segunda sesión.</small>';
    const v = sessions.slice(-12).map((s) => s.avg), lo = Math.max(0, Math.min(...v) - 5), hi = Math.min(110, Math.max(...v) + 5), W = 220, H = 46;
    const pts = v.map((y, i) => [v.length === 1 ? W / 2 : (i * W) / (v.length - 1), H - 4 - ((y - lo) / Math.max(1, hi - lo)) * (H - 8)]);
    const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    return `<svg class="cl-spark" viewBox="-4 0 ${W + 8} ${H}" preserveAspectRatio="none" aria-label="Evolución de tus sesiones">
      <path d="${path}L${pts[pts.length - 1][0]},${H}L${pts[0][0]},${H}Z" class="area"/><path d="${path}" class="line"/>
      ${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6"/>`).join('')}</svg>`;
  }
  // nivel de progresión (1–10): se gana sesión a sesión
  function levelPanel(cur, st) {
    const L = st?.level ?? 1, need = L < LEVELS ? LEVEL_REQ[L + 1] : null;
    const last = st?.sessions?.[st.sessions.length - 1];
    const okSessions = (st?.sessions || []).filter((x) => x.ok).length;
    const prog = need && last ? Math.max(0, Math.min(1, last.avg / need)) : 0;
    const nextPar = challengeProgram().blocks[0]?.par;
    return gsec('sliders', `Nivel · ${esc(cur.name)}`,
      `<div class="gx-level"><div class="gx-meter">${Array.from({ length: LEVELS }, (_, i) => `<i class="${i < L ? 'on' : ''} ${i === L ? 'next' : ''}" style="--k:${i / (LEVELS - 1)}" title="Nivel ${i + 1} · ${levelName(i + 1)}${i ? ` · media ≥ ${LEVEL_REQ[i + 1]} %` : ''}"></i>`).join('')}</div>
        <div class="gx-level-txt"><b>${L}</b><span>${levelName(L)}</span></div></div>
      ${need ? `<div class="lv-goal"><div class="lv-goal-h"><span>Para el nivel ${L + 1} · ${levelName(L + 1)}</span><b>media ≥ ${need} %</b></div>
          <div class="lv-bar"><i style="width:${(prog * 100).toFixed(0)}%"></i></div>
          <small>${!last ? 'Requisito: sesión completa, sin ningún «No llegué» y con esa media.'
            : last.avg >= need ? `Tu última sesión (${fmtPct(last.avg)}) ya da esa media: repítela completa y sin ningún «No llegué» para subir.`
            : `Última sesión: ${fmtPct(last.avg)} · te faltan ${fmtS1(Math.ceil((need - last.avg) * 10) / 10)} puntos. Requisito: sesión completa y sin ningún «No llegué».`}</small></div>`
        : '<div class="gx-note">🏆 Nivel máximo: eres una leyenda en este desafío.</div>'}
      <div class="lv-stats"><span><b>${st?.sessions?.length ?? 0}</b>sesiones</span><span><b>${okSessions}</b>completas</span><span><b>${fmtS1(nextPar)} s</b>1.ª ronda</span></div>
      <small class="gx-hint">${esc(cur.desc)} Como mucho se sube un nivel por sesión.</small>`);
  }
  function coachPanel(d) {
    const cur = drillById(d.challenge), st = statOf(d, cur.id), o = overall(d), tip = advice(d);
    let html = '';
    // tu clasificación general
    html += gsec('trophy', 'Tu clasificación', o
      ? `<div class="cl-me">${clsBadge(o.pct, 'xl')}<div><b>${classOf(o.pct)[2]}</b><span>${fmtPct(o.pct)} de media en ${o.n} ${o.n === 1 ? 'desafío' : 'desafíos'}</span><small>${o.levels} ${o.levels === 1 ? 'nivel conseguido' : 'niveles conseguidos'} de ${DRILLS.length * (LEVELS - 1)} · ${o.rounds} rondas</small></div></div>`
      : '<div class="gx-note">Aún sin clasificar: haz una sesión de cualquier desafío para obtener tu clase.</div>')
      + (tip ? `<button type="button" class="cl-tip" data-ch="${tip.id}"><span>🎯 Te recomiendo</span><b>${esc(drillById(tip.id).name)}</b><small>${esc(tip.why)}</small></button>` : '');
    // el desafío elegido
    const nextPar = challengeProgram().blocks[0]?.par;
    html += levelPanel(cur, st);
    const prov = st && st.rounds < PROVISIONAL;
    html += gsec('target', `Rendimiento · ${esc(cur.name)}`, (st
      ? `<div class="cl-cur"><div class="cl-big">${clsBadge(st.skill, 'lg')}<div><b>${fmtPct(st.skill)}</b><span>${classOf(st.skill)[2]}${prov ? ' · <i class="cl-prov">provisional</i>' : ''}</span>
            <small>${prov ? `Clase definitiva tras ${PROVISIONAL} rondas (llevas ${st.rounds})` : `${st.rounds} rondas`}</small></div></div>
          ${zoneBar([[st.skill, 'now', 'Tu media'], [st.best, 'best', 'Tu mejor ronda']])}
          <div class="cl-legend"><span><i class="now"></i>Tu media</span><span><i class="best"></i>Mejor ronda ${fmtPct(st.best)}</span></div>
          ${spark(st.sessions)}</div>`
      : `<div class="gx-note">Nuevo: la primera ronda empieza holgada y se ajusta a ti en cuanto respondas.</div>${zoneBar([])}`)
      + `<small class="gx-hint">Tu % respecto a un tirador de élite en seco, como las clases de IPSC (GM ≥ 95 %, M ≥ 85, A ≥ 75, B ≥ 60, C ≥ 40, D). La media cambia poco a poco: una buena sesión suelta no te sube arriba.</small>`
      + (st ? '<button type="button" class="btn small gx-reset" id="dryChReset">↺ Borrar mi historial de este desafío</button>' : ''));
    // catálogo
    html += gsec('target', 'Desafíos', DRILL_CATS.map(([cat, label]) => `<div class="cl-cat"><h5>${label}</h5><div class="gx-chs">${DRILLS.filter((x) => x.cat === cat).map((x) => {
      const s = statOf(d, x.id);
      return `<button type="button" class="gx-ch ${x.id === cur.id ? 'on' : ''}" data-ch="${x.id}"><span><b>${esc(x.name)}</b><small>${esc(x.desc)}</small></span>
        <em>${s ? `<span class="cl-row"><u>NV ${s.level}</u>${clsBadge(s.skill)}</span><i>${fmtPct(s.skill)}</i>` : 'NUEVO'}</em></button>`;
    }).join('')}</div></div>`).join(''));
    return html;
  }
  function setPref(k, v) {
    const d = P();
    if (k === 'detect') { if (v === 'auto') { if (d.advance !== 'auto') d.moveDelay = 3; d.advance = 'auto'; } else { d.advance = 'camera'; d.camera = v === 'camera'; } }
    else d[k] = v;
    saveProfile();
    if (['challenge', 'chReps'].includes(k)) chCache = null;
    renderSettings(); describe();
  }
  $('#drySettings').addEventListener('click', (e) => {
    const t = e.target;
    const segBtn = t.closest('.gx-seg [data-v]');
    if (segBtn) { const k = segBtn.parentElement.dataset.set, raw = segBtn.dataset.v; setPref(k, ['detect', 'activators'].includes(k) ? raw : Number(raw)); return; }
    const tog = t.closest('[data-toggle]'); if (tog) { setPref(tog.dataset.toggle, !P()[tog.dataset.toggle]); return; }
    const stepBtn = t.closest('.gx-step [data-d]');
    if (stepBtn) {
      const box = stepBtn.parentElement, k = box.dataset.step, st = +box.dataset.st;
      const v = Math.min(+box.dataset.max, Math.max(+box.dataset.min, Math.round(((P()[k] ?? 0) + st * +stepBtn.dataset.d) * 100) / 100));
      setPref(k, v); return;
    }
    const ch = t.closest('[data-ch]'); if (ch) { setPref('challenge', ch.dataset.ch); return; }
    if (t.closest('#dryChReset')) {
      const d = P(); resetDrill(d, d.challenge); saveProfile(); chCache = null; renderSettings(); describe();
      toast('Historial de este desafío borrado: vuelve a empezar sin clasificar');
    }
  });

  // ---------------- teclado (modo sin cámara) ----------------
  const tabActive = () => $('#tab-dry').classList.contains('active');
  window.addEventListener('keydown', (e) => {
    if (!tabActive() || e.target?.matches?.('input, textarea, select') || !$('#modal').classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') { keyHeld.left = true; e.preventDefault(); }
    if (e.key === 'ArrowRight') { keyHeld.right = true; e.preventDefault(); }
    if (e.key === 'ArrowDown') { keyHeld.down = true; e.preventDefault(); }
    if (run?.phase === 'ask' && /^[0-9nN]$/.test(e.key)) {
      const btn = /n/i.test(e.key) ? $('#dryAskBtns [data-left="-1"]') : $$('#dryAskBtns [data-left]:not(.fail)')[Number(e.key)];
      if (btn) rate(Number(btn.dataset.left)); e.preventDefault(); return;
    }
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
        an = new Analyzer({ video, canvas: camCanvas, getProfile, onUpdate: null, model: 'lite', maxFps: 15, useWorker: true });
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
    const needsMove = bodyNeeds(program);
    if (needsMove && P().camera && !(await ensureCamera())) return;
    clearTimers();
    run = {
      program, needsMove, phase: 'setup', phaseAt: performance.now(), samples: [], simX: 0.5,
      bi: 0, rep: 0, moves: 0, totalMoves: 0, repsDone: 0, moveTimes: [], startAt: null, n: 1, lastTick: null,
    };
    $('#dryAsk').classList.add('hidden');
    if (program.challenge) {
      const ch = program.challenge;
      Object.assign(ch, { pcts: [], fails: 0, curPace: ch.pace });
      program.blocks.forEach((bk) => setPar(bk, parFor(bk.elite, ch.pace, bk.tight)));
    }
    prepareBlock(performance.now());
    view.transition = null; view.arrow = null; view.warn = null; view.timer = null; view.dim = 0;
    $('#dryStart').textContent = '↻ Reiniciar';
    if (needsMove) say(P().camera ? 'Colócate en el centro' : 'Preparado');
  }
  function stop(text) {
    if (!run) return;
    clearTimers(); run.phase = 'done'; run.endAt = performance.now();
    $('#dryAsk').classList.add('hidden'); view.cond = null; view.instr = null;
    if (run.program.challenge) chCache = null;
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
    // etiqueta tras el beep: corta (la nota ya sale grande en la tarjeta de instrucciones)
    view.cond = condText(b.cond ? { ...b.cond, note: '' } : null) || (b.cond?.note?.length <= 28 ? b.cond.note : '') || null;
    const ins = b.type === 'course' || b.cond ? instructions(b) : [];
    view.instr = ins.length ? { lines: ins, title: run.program.challenge ? b.name.toUpperCase() : 'INSTRUCCIONES' } : null;
    run.rep = 0; run.moves = 0; view.port = null; view.portHint = false;
    if (b.type === 'arena') {
      run.stage = randomStage(Date.now(), { activators: b.activators, prevTheme: run.stage?.theme ?? -1 });
      view.stage = run.stage;
    } else if (b.type === 'course') {
      buildCourse(b);
      run.posIdx = 0;
      view.stage = b.startMove ? run.lobby : run.posStages[0];
      warm(...run.posStages.slice(0, 2), run.lobby);
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
    Object.assign(view, { big: 'PREPARADO', sub: run.program.challenge ? `Espera el beep · tiempo ${fmtS1(blk().par)} s` : view.instr ? 'Espera el beep' : `Espera el beep${view.cond ? ` · ${view.cond}` : ''}`, bigColor: '#d4ff3a', dim: 0 });
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
    const port = R.walls && run.posStages.length && Math.random() < WALL_RATE ? randomPort(R.advance, R.portDelay ?? 0) : null; // nunca en el primero
    run.posList.push({ dir: 'random', time: R.time, advance: R.advance, moveDelay: R.moveDelay, activatorAt: 1, port });
    run.posStages.push(randomStage((Date.now() + run.posStages.length * 7919) >>> 0, { activators: R.activators, prevTheme: prev?.theme ?? -1 }));
  }
  function startCourseRep(now) {
    const b = blk();
    run.lastDir = 0; // cada repetición empieza hacia un lado al azar
    startBeep();
    run.startAt ??= now;
    run.beepAt = now; view.condAt = now;
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
    const b = blk();
    // aleatorio sin fin: siempre hay dos escenarios preparados por delante
    if (b.random?.on && !b.random.count) while (run.posList.length < run.posIdx + 3) addRandomPos(b);
    // se preparan solo los dos siguientes y se libera la memoria de los ya usados (móvil)
    warm(run.posStages[run.posIdx + 1], run.posStages[run.posIdx + 2]);
    if (run.posIdx >= 1) scene.forget(run.posStages[run.posIdx - 1]);
    view.stage = run.posStages[run.posIdx]; view.transition = null; view.arrow = null;
    run.posShownAt = now; run.actFired = false;
    setPort(run.posList[run.posIdx]?.port, now);
    setPhase('course-pos', now);
  }
  function endCourseRep(now) {
    const b = blk();
    endBeep();
    run.repsDone++;
    if (run.program.challenge) {
    }
    view.timer = null; view.arrow = null; view.transition = null;
    if (run.rep + 1 < b.reps) {
      run.rep++;
      buildCourse(b); run.posIdx = 0;
      run.restUntil = now + b.rest * 1000; run.lastTick = null;
      view.stage = b.startMove ? run.lobby : run.posStages[0]; setPort(b.startMove ? null : run.posList[0]?.port, now);
      warm(...run.posStages.slice(0, 2));
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
    const k = clamp((now - run.portStart) / (cfg.open === 'auto' ? 1100 : 700), 0, 1);
    view.portHint = cfg.open === 'auto' && k < 1 ? { progress: k } : false;
    view.port.p = k; // el marco se queda en pantalla con el escenario (sin «pop»)
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
  const warm = (...stages) => stages.forEach((st) => scene.prewarmSoon(st));

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

  // ---- Desafíos: al acabar cada ronda, ¿cuántos segundos te han sobrado? ----
  // botones según la duración de la ronda (décimas en las cortas)
  function leftSteps(par) {
    const base = par < 3 ? [0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1, 1.5] : par < 6 ? [0.2, 0.4, 0.6, 0.8, 1, 1.5, 2, 3] : par < 10 ? [0.5, 1, 1.5, 2, 2.5, 3, 4, 5] : [0.5, 1, 2, 3, 4, 5, 6, 8];
    return [0, ...base.filter((v) => v < par * 0.8)];
  }
  function askRound(now) {
    const b = blk();
    setPhase('ask', now);
    Object.assign(view, { big: null, sub: null, timer: null, dim: 0.55, instr: null });
    $('#dryAskSub').textContent = `${b.name} · tenías ${fmtS1(b.par)} s · ${instrText(b)}`;
    const steps = leftSteps(b.par);
    $('#dryAskBtns').innerHTML = '<button data-left="-1" class="fail">No llegué <kbd>N</kbd></button>'
      + steps.map((v, i) => `<button data-left="${v}">${fmtS1(v)}${i === steps.length - 1 ? '+' : ''}${i < 10 ? `<kbd>${i}</kbd>` : ''}</button>`).join('');
    $('#dryAsk').classList.remove('hidden');
  }
  // left: segundos que han sobrado (−1 = no llegó). Con tu tiempo se calcula tu % respecto a élite;
  // las rondas siguientes se ajustan a ese ritmo (tu tiempo + un pequeño margen) y siguen apretando.
  function rate(left) {
    if (run?.phase !== 'ask') return;
    const ch = run.program.challenge, b = blk(), d = P(), par = b.par;
    const yours = left < 0 ? par * 1.15 : Math.max(par * 0.2, par - left);   // tu tiempo (aprox. si no llegaste)
    const pct = Math.min(100, (b.elite * 100) / yours);
    if (left < 0) ch.fails++;
    const prevSkill = statOf(d, ch.id)?.skill, prevCls = prevSkill != null ? classOf(prevSkill)[0] : null;
    ch.pcts.push(pct);
    const s = recordRound(d, ch.id, pct);
    // ritmo base: tu ritmo deshaciendo el apretón de esta ronda; las siguientes aprietan en proporción
    ch.curPace = Math.max(0.12, Math.min(1.2, (pct / 100) * (b.tight || 1)));
    saveProfile(); chCache = null;
    run.program.blocks.forEach((bk, k) => { if (k > run.bi) setPar(bk, parFor(bk.elite, ch.curPace, bk.tight)); });
    $('#dryAsk').classList.add('hidden'); view.dim = 0;
    const c = classOf(pct), nowCls = classOf(s.skill)[0];
    run.lastResult = { pct, cls: c[0] };
    const nx = run.program.blocks[run.bi + 1];
    if (prevCls && nowCls !== prevCls) {
      const up = CLASSES.findIndex(([k]) => k === nowCls) < CLASSES.findIndex(([k]) => k === prevCls);
      toast(up ? `🏆 ¡Subes a ${classOf(s.skill)[2]}! Tu media: ${fmtPct(s.skill)}` : `Bajas a ${classOf(s.skill)[2]} (${fmtPct(s.skill)}). ¡A recuperarla!`, 5000);
      if (up) { sfx.tick(990, 0.1); timers.push(setTimeout(() => sfx.tick(1320, 0.14), 140)); }
    } else toast(`${left < 0 ? `No llegaste en ${fmtS1(par)} s` : `Tu tiempo ≈ ${fmtS1(+yours.toFixed(2))} s`} · ${fmtPct(pct)} (${c[2]})${nx ? ` → siguiente ronda: ${fmtS1(nx.par)} s` : ''}`, 4200);
    run.answered = run.bi;
    endBlock(performance.now());
  }
  $('#dryAsk').addEventListener('click', (e) => { const x = e.target.closest('[data-left]'); if (x) rate(Number(x.dataset.left)); });



  function endBlock(now) {
    const prog = run.program;
    if (prog.challenge && run.answered !== run.bi) { askRound(now); return; }
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
    if (run.lastDir) return -run.lastDir; // siempre de un lado a otro: izquierda, derecha, izquierda…
    if (!run.T) return Math.random() < 0.5 ? -1 : 1; // sin cámara: la primera, al azar
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
    run.lastDir = dir;
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
    if (prog.challenge) return `RONDA ${run.bi + 1}/${prog.blocks.length} · REP ${Math.min(run.rep + 1, b.reps)}/${b.reps} · ${fmtS1(b.par)} s`;
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
        // si el siguiente cambio es al desplazarte, la flecha sale enseguida (a los ~1 s): el tirador tarda
        // lo que tarde en resolver y ya sabe hacia dónde ir. El tiempo del escenario solo cuenta en automático
        // (sin cámara) y en el último escenario (hasta el beep final).
        const nextPos = run.posList[run.posIdx + 1];
        const byMove = !!nextPos && !b.random?.on && nextPos.advance !== 'auto';
        const wait = byMove ? (pos.arrowAt ?? 1) : pos.time;
        view.timer = b.maxTime ? { elapsed: (now - run.beepAt) / 1000, par: b.maxTime } : byMove ? null : { elapsed: (now - run.posShownAt) / 1000, par: pos.time };
        if (now >= run.posShownAt + wait * 1000) {
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
        if (countdown(now, run.restUntil, run.program.challenge ? `DESCANSO · siguiente: repetición ${run.rep + 1} de ${b.reps} · ${fmtS1(b.par)} s`
          : `DESCANSO · siguiente: repetición ${run.rep + 1} de ${b.reps}${view.cond ? ` · ${view.cond}` : ''}`)) {
          view.dim = 0;
          if (b.startMode === 'random') goStandby(now, 'rep'); else if (b.type === 'course') startCourseRep(now); else startRep(now);
        }
        return;
      case 'between':
        if (countdown(now, run.betweenUntil, run.program.challenge
          ? `${run.lastResult ? `Ronda anterior: ${fmtPct(run.lastResult.pct)} · clase ${run.lastResult.cls}  —  ` : ''}SIGUIENTE: ${b.name} · ${fmtS1(b.par)} s`
          : `SIGUIENTE: ${b.name} · ${blockSummary(b)}`)) goStandby(now, 'block');
        return;
    }
  }

  function intro(now) {
    if (run.program.free) return goStandby(now, 'block');
    const b = blk();
    const ch = run.program.challenge;
    Object.assign(view, { big: run.program.name.toUpperCase(), bigColor: '#d4ff3a', sub: ch
      ? `Nivel ${ch.startLevel} · ${levelName(ch.startLevel)} · ${ch.startSkill != null ? `${classOf(ch.startSkill)[2]} · ${fmtPct(ch.startSkill)}` : 'sin clasificar'} · ${run.program.blocks.length} rondas de ${b.reps} repeticiones`
      : `Ejercicio 1 de ${run.program.blocks.length}: ${b.name} · ${blockSummary(b)}` });
    run.introUntil = now + (view.instr ? 4200 : 2800);
    setPhase('intro', now);
  }

  function finish(now) {
    run.phase = 'done'; run.endAt = now;
    const total = (now - (run.startAt ?? now)) / 1000;
    const parts = [];
    if (!run.program.free) parts.push(`${run.program.blocks.length} ${run.program.challenge ? 'rondas' : run.program.blocks.length === 1 ? 'ejercicio' : 'ejercicios'}`);
    if (run.repsDone) parts.push(`${run.repsDone} repeticiones`);
    if (run.totalMoves) parts.push(`${run.totalMoves} desplazamientos`);
    parts.push(`${total.toFixed(1)} s`);
    if (run.moveTimes.length) parts.push(`reacción media ${(run.moveTimes.reduce((a, b) => a + b, 0) / run.moveTimes.length).toFixed(2)} s`);
    const ch = run.program.challenge;
    let big = run.program.free ? 'COMPLETADO' : 'ENTRENAMIENTO COMPLETADO', color = '#d4ff3a';
    if (ch) {
      chCache = null;
      const d = P();
      const res = recordSession(d, ch.id, ch.pcts, { fails: ch.fails, complete: ch.pcts.length === run.program.blocks.length, pace: ch.curPace }), s = statOf(d, ch.id);
      saveProfile();
      if (res) {
        const c = classOf(res.avg);
        parts.length = 0;
        if (res.levelUp) {
          big = `¡NIVEL ${res.level} · ${levelName(res.level).toUpperCase()}!`;
          parts.push(`Media de la sesión ${fmtPct(res.avg)} (${c[2]})`);
          sfx.tick(990, 0.1); timers.push(setTimeout(() => sfx.tick(1320, 0.12), 150), setTimeout(() => sfx.tick(1760, 0.16), 300));
        } else {
          big = `${c[2].toUpperCase()} · ${fmtPct(res.avg)}`; color = CLS_COL[c[0]];
          if (res.need != null) parts.push(!res.complete ? `Nivel ${res.level + 1}: termina la sesión completa` : res.fails ? `Nivel ${res.level + 1}: necesitas una sesión sin «No llegué»` : `Nivel ${res.level + 1}: necesitas media ≥ ${res.need} %`);
        }
        parts.push(`mejor ronda ${fmtPct(Math.max(...ch.pcts))}`);
        if (s) parts.push(ch.startSkill != null ? `tu media ${fmtPct(ch.startSkill)} → ${fmtPct(s.skill)} (${s.skill >= ch.startSkill ? '▲' : '▼'})` : `tu media: ${fmtPct(s.skill)}`);
      } else big = 'RETO TERMINADO';
    }
    view.cond = null; view.instr = null;
    Object.assign(view, { arrow: null, timer: null, dim: 0, big, bigColor: color, sub: parts.join(' · ') });
    if (ch) { describe(); renderSettings(); }
    say('Completado');
    $('#dryStart').textContent = '▶ Empezar';
  }

  let hudT = 0;
  const clsCell = (id) => { const s = statOf(P(), id); return s ? `<i style="color:${CLS_COL[classOf(s.skill)[0]]}">${classOf(s.skill)[0]}</i> · ${fmtPct(s.skill)}` : '—'; };
  function updateHud(now) {
    if (now - hudT < 100) return; hudT = now;
    const time = run?.startAt ? ((run.phase === 'done' ? run.endAt : now) - run.startAt) / 1000 : 0;
    const cell = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    let html;
    const idle = idleProg;
    if (!run && idle && !idle.free) {
      html = idle.challenge
        ? cell('RONDA', `– / ${idle.blocks.length}`) + cell('REPETICIÓN', `– / ${idle.blocks[0].reps}`) + cell('NIVEL', String(statOf(P(), idle.challenge.id)?.level ?? 1)) + cell('CLASE', clsCell(idle.challenge.id))
        : cell('EJERCICIOS', String(idle.blocks.length)) + cell('DURACIÓN', `≈ ${fmtDuration(programDuration(idle))}`) + cell('TIEMPO TOTAL', '0.0 s');
    } else if (!run || run.program.free) {
      const goal = P().moves;
      html = cell('DESPLAZAMIENTOS', `${run?.totalMoves ?? 0}${goal ? ` / ${goal}` : ''}`) + cell('TIEMPO', `${time.toFixed(1)} s`);
    } else {
      const b = blk(), n = run.program.blocks.length;
      if (run.program.challenge) html = cell('RONDA', `${run.bi + 1} / ${n}`) + cell('REPETICIÓN', `${Math.min(run.rep + 1, b.reps)} / ${b.reps}`)
        + cell('NIVEL', String(statOf(P(), run.program.challenge.id)?.level ?? 1)) + cell('CLASE', clsCell(run.program.challenge.id));
      else html = cell('EJERCICIO', `${run.bi + 1} / ${n}`)
        + (b.type === 'stage' ? cell('REPETICIÓN', `${Math.min(run.rep + 1, b.reps)} / ${b.reps}`)
          : b.type === 'course' ? cell('REPETICIÓN', `${Math.min(run.rep + 1, b.reps)} / ${b.reps}`) + cell('POSICIÓN', `${Math.max(0, run.posIdx ?? 0) + 1} / ${b.random?.on && !b.random.count ? '∞' : run.posList?.length ?? b.positions.length}`)
          : cell('DESPLAZAMIENTOS', `${run.moves}${b.moves ? ` / ${b.moves}` : ''}`))
        + cell('TIEMPO TOTAL', `${time.toFixed(1)} s`);
    }
    const hud = $('#dryHud'); hud.innerHTML = html; hud.dataset.cols = (html.match(/<div>/g) || []).length;
    const st = !P().camera ? 'key' : !stream ? 'off' : lastPose && now - lastPose.t < 600 ? 'ok' : 'lost';
    const tb = $('#dryCamToggle'); if (tb.dataset.status !== st) tb.dataset.status = st;
  }

  let lastIdleDraw = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    if (!tabActive() && !(run && run.phase !== 'done')) return; // no gastar GPU fuera de la pestaña
    const active = run && run.phase !== 'done';
    if (active) step(now);
    // parado (antes de empezar o al terminar) no hace falta dibujar a 60 fps: ahorra batería y calor en el móvil
    if (!active && now - lastIdleDraw < 100) return;
    lastIdleDraw = now;
    scene.render(view, now);
    updateHud(now);
  }

  fillPrograms(''); renderPick();
  requestAnimationFrame(tick);
  return {
    onShow: () => { fillPrograms(); if (!session.classList.contains('hidden')) renderSettings(); else renderPick(); scene.checkSize(); },
    // Inicio → «Entrenamiento en seco»: abre el selector
    showPicker,
    // deja elegido un entrenamiento sin empezarlo
    select,
    // arranca un entrenamiento concreto (desde el Editor)
    startProgram: (program, selectId) => { fillPrograms(selectId ?? ''); showSession(); start(program); },
    debug: () => ({ run, lastPose, view }),
    // avance manual de un fotograma (pruebas con la pestaña en segundo plano)
    stepOnce: (now = performance.now()) => { if (run && run.phase !== 'done') step(now); scene.render(view, now); hudT = 0; updateHud(now); },
    // previsualiza un escenario concreto (pruebas)
    preview: (stage, actAt = null) => { view.stage = stage; view.big = null; view.sub = null; view.arrow = null; stage.actStart = actAt; },
  };
}
