// Editor de entrenamientos: crea secuencias de ejercicios (escenarios con tiempo, recorridos aleatorios y
// recorridos personalizados por posiciones) con un editor de escenarios libre: añadir, arrastrar,
// duplicar, eliminar y configurar cada elemento (tarjetas, poppers, placas, móviles, muros, bidones…).
import {
  composeStage, stageFromLayout, layoutOf, finalizeStage, PERSPECTIVE, makeStyle, randomKind, TARGET_KINDS, KIND_LABEL, HARD_PRESETS, kindWidth,
} from './course.js?v=20261108-2328';
import { StageRenderer, THEMES, ACT, styleOf, stackHeight } from './scene.js?v=20261108-2328';
import * as store from './storage.js?v=20261108-2328';
import {
  newProgram, newStageBlock, newArenaBlock, newCourseBlock, newCoursePosition, exampleProgram, blockSummary, blockDuration, programDuration, fmtDuration,
  shareUrl, sanitizeProgram, MOVER_LABEL, DIST_LABEL, DIR_LABEL, DIR_ARROW,
} from './program.js?v=20261108-2328';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const { F, HOR, CAMH, SPREAD } = PERSPECTIVE;

// tamaño aproximado (ancho, alto en metros) para seleccionar y arrastrar en la vista previa
const MOVER_SIZE = { swinger: [2.5, 2.4], drop: [2.5, 2.4], slider: [2.7, 2.2], bobber: [1.7, 1.8] };
function itemSize(it) {
  switch (it.type) {
    case 'paper': { const st = styleOf(it); return [kindWidth(st.kind) + 0.05, 0.6 + stackHeight(st, it.mini)]; }
    case 'popper': return [0.45, it.mini ? 0.66 : 0.95];
    case 'plate': return [0.35, 1.15];
    case 'wall': return [it.w, it.h];
    case 'barrel': return [0.6, 0.9];
    case 'tires': return [0.7, 0.22 * (it.n || 2) + 0.1];
    case 'cone': return [0.36, 0.5];
    case 'mover': return MOVER_SIZE[it.mtype] || [2.4, 2.3];
    default: return [0.5, 1];
  }
}
const ITEM_NAME = { paper: 'Tarjeta', popper: 'Popper', plate: 'Placa', wall: 'Muro', barrel: 'Bidón', tires: 'Neumáticos', cone: 'Cono', mover: 'Móvil' };
const WALL_STYLE_LABEL = { ply: 'Madera pintada', mesh: 'Malla oscura', banner: 'Con cartel' };
const BARREL_COLORS = { '#2f5f9e': 'Azul', '#1f2a36': 'Negro', '#8e2d2a': 'Rojo', '#3f6b3a': 'Verde', '#c9a227': 'Amarillo' };
const MOVER_TYPES = ['swinger', 'drop', 'slider', 'bobber'];
const MAIN_TYPES = ['paper', 'popper', 'plate', 'mover'];

export function initEditor(app) {
  const { toast, ask } = app;
  const canvas = $('#edCanvas'), park = $('#edPark');
  const renderer = new StageRenderer(canvas);
  renderer.cacheItems = false; // en el editor los elementos se arrastran: se dibujan siempre en vivo
  let curId = null, selBlockId = null, selPosId = null, preview = null, selItem = null, drag = null, saveT = null;

  const programs = () => store.loadPrograms();
  const cur = () => programs().find((p) => p.id === curId) || null;
  let prog = null; // copia de trabajo del entrenamiento abierto

  function persist(rerenderList = true) {
    if (!prog) return;
    clearTimeout(saveT);
    const p = prog;
    saveT = setTimeout(() => { saveT = null; store.saveProgram(p); if (rerenderList) renderList(); }, 250);
  }
  function flush() { if (saveT) { clearTimeout(saveT); saveT = null; if (prog) store.saveProgram(prog); } }
  const block = () => prog?.blocks.find((b) => b.id === selBlockId) || null;
  // escenario que se está editando: el del ejercicio o el de la posición seleccionada del recorrido
  function scen() {
    const b = block(); if (!b) return null;
    if (b.type === 'stage') return b;
    if (b.type === 'course') return b.positions.find((p) => p.id === selPosId) || b.positions[0] || null;
    return null;
  }

  // ------------------------------------------------------------ lista de entrenamientos
  function renderList() {
    const list = programs();
    $('#edPrograms').innerHTML = list.length ? list.map((p) => `
      <button class="ed-prog ${p.id === curId ? 'active' : ''}" data-id="${p.id}">
        <b>${esc(p.name)}</b><small>${p.blocks.length} ${p.blocks.length === 1 ? 'ejercicio' : 'ejercicios'} · ~${fmtDuration(programDuration(p))}</small>
      </button>`).join('') : '<p class="muted small">Todavía no tienes entrenamientos.</p>';
  }
  $('#edPrograms').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) open(b.dataset.id); };
  $('#edNew').onclick = () => { const p = newProgram(); ensureLayouts(p); store.saveProgram(p); open(p.id); toast('Entrenamiento creado'); };
  $('#edImport').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const incoming = data.type === 'program' ? [data.program] : Array.isArray(data.programs) ? data.programs : [data];
      let last = null;
      for (const raw of incoming) { const p = sanitizeProgram(raw); if (p) { store.saveProgram(p); last = p; } }
      if (!last) throw new Error('no contiene entrenamientos');
      open(last.id); toast('Entrenamiento importado ✔');
    } catch (err) { toast(`No se pudo importar: ${err.message}`, 4000); }
  };

  // completa composiciones antiguas y genera las disposiciones que falten
  function ensureLayouts(p) {
    const defComp = newStageBlock().comp;
    const fix = (s) => { s.comp = { ...defComp, ...s.comp }; if (!s.layout) s.layout = layoutOf(composeStage(s.comp, Date.now() + Math.floor(Math.random() * 1e6))); };
    for (const b of p.blocks) {
      if (b.type === 'stage') fix(b);
      if (b.type === 'course') b.positions.forEach((pos, i) => { fix(pos); if (i === 0) pos.dir = 'none'; });
    }
  }

  function open(id) {
    flush();
    curId = id; prog = cur() ? clone(cur()) : null;
    if (prog) { ensureLayouts(prog); store.saveProgram(prog); }
    selBlockId = prog?.blocks[0]?.id || null; selPosId = null;
    renderList(); renderMain();
  }

  // ------------------------------------------------------------ entrenamiento abierto
  function renderMain() {
    const main = $('#edMain');
    if (!prog) {
      park.appendChild(canvas);
      main.innerHTML = `<div class="ed-empty"><h2>Editor de entrenamientos</h2>
        <p class="muted">Crea secuencias de ejercicios: escenarios con tiempo máximo, recorridos aleatorios o recorridos personalizados posición a posición, con escenarios diseñados a tu gusto. Después entrénalos en «En seco» o compártelos con tu equipo.</p>
        <button class="btn primary" id="edNew2">+ Crear entrenamiento</button></div>`;
      $('#edNew2').onclick = () => $('#edNew').click();
      return;
    }
    park.appendChild(canvas);
    main.innerHTML = `
      <div class="ed-head">
        <input class="ed-name" id="edName" value="${esc(prog.name)}" maxlength="80" aria-label="Nombre del entrenamiento">
        <div class="row">
          <button class="btn primary" id="edTrain">▶ Entrenar</button>
          <button class="btn" id="edShare">🔗 Compartir</button>
          <button class="btn" id="edExport">⬇ Exportar</button>
          <button class="btn" id="edDup">⧉ Duplicar</button>
          <button class="btn danger" id="edDel">Borrar</button>
        </div>
      </div>
      <textarea id="edNotes" rows="1" placeholder="Notas (objetivo, material, indicaciones para el equipo…)" maxlength="500">${esc(prog.notes || '')}</textarea>
      <div class="chips row" id="edChips"></div>
      <ol class="ed-blocks" id="edBlocks"></ol>
      <div class="row">
        <button class="btn accent" id="edAddStage">+ Escenario con tiempo</button>
        <button class="btn accent" id="edAddCourse">+ Recorrido personalizado</button>
        <button class="btn" id="edAddArena">+ Recorrido aleatorio</button>
      </div>
      <div id="edBlock"></div>`;
    $('#edName').oninput = (e) => { prog.name = e.target.value || 'Sin nombre'; persist(); };
    $('#edNotes').oninput = (e) => { prog.notes = e.target.value; persist(false); };
    $('#edTrain').onclick = () => { flush(); store.saveProgram(prog); app.startProgram(clone(prog), prog.id); };
    $('#edShare').onclick = share;
    $('#edExport').onclick = exportProgram;
    $('#edDup').onclick = () => { const p = clone(prog); p.id = store.uid(); p.name = `${prog.name} (copia)`; p.blocks.forEach((b) => (b.id = store.uid())); store.saveProgram(p); open(p.id); toast('Duplicado'); };
    $('#edDel').onclick = () => {
      if (!confirm(`¿Borrar el entrenamiento «${prog.name}»?`)) return;
      store.deleteProgram(prog.id); curId = null; prog = null; renderList(); renderMain(); toast('Entrenamiento borrado');
    };
    $('#edAddStage').onclick = () => addBlock(newStageBlock());
    $('#edAddCourse').onclick = () => addBlock(newCourseBlock());
    $('#edAddArena').onclick = () => addBlock(newArenaBlock());
    renderBlocks(); renderBlock();
  }

  function addBlock(b) {
    ensureLayouts({ blocks: [b] });
    prog.blocks.push(b); selBlockId = b.id; selPosId = null; persist(); renderBlocks(); renderBlock();
    $('#edBlock').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const blockIcon = (b) => (b.type === 'arena' ? '↔ ' : b.type === 'course' ? '⇄ ' : '◎ ');
  function renderBlocks() {
    $('#edChips').innerHTML = `<span class="chip">${prog.blocks.length} ${prog.blocks.length === 1 ? 'ejercicio' : 'ejercicios'}</span><span class="chip">Duración aprox. ${fmtDuration(programDuration(prog))}</span>`;
    $('#edBlocks').innerHTML = prog.blocks.map((b, i) => `
      <li class="ed-bl ${b.id === selBlockId ? 'active' : ''}" data-id="${b.id}">
        <span class="ed-num">${i + 1}</span>
        <div class="ed-bl-txt"><b>${blockIcon(b)}${esc(b.name)}</b><small>${esc(blockSummary(b))} · ~${fmtDuration(blockDuration(b, i === prog.blocks.length - 1))}</small></div>
        <div class="ed-bl-act">
          <button class="btn small" data-act="up" title="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn small" data-act="down" title="Bajar" ${i === prog.blocks.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn small" data-act="dup" title="Duplicar">⧉</button>
          <button class="btn small danger" data-act="del" title="Eliminar">✕</button>
        </div>
      </li>`).join('') || '<p class="muted small">Añade un ejercicio para empezar.</p>';
  }

  // ------------------------------------------------------------ formularios
  const opt = (v, label, curV) => `<option value="${v}" ${String(v) === String(curV) ? 'selected' : ''}>${label}</option>`;
  const numField = (k, label, v, min, max, step = 1, suffix = '') => `<label>${label}<span class="ed-num-in"><input type="number" data-k="${k}" value="${v}" min="${min}" max="${max}" step="${step}">${suffix ? `<em>${suffix}</em>` : ''}</span></label>`;
  const range = (key, label, v, min, max, step, unit) =>
    `<label>${label}<span class="ed-range"><input type="range" data-st="${key}" min="${min}" max="${max}" step="${step}" value="${v}"><output data-unit="${unit}">${v}${unit}</output></span></label>`;

  // composición automática (punto de partida; luego se puede editar a mano)
  function compHTML(s) {
    const c = s.comp;
    return `<h4>Composición automática</h4>
      <p class="muted small">Genera el escenario con estas cantidades. Después puedes añadir, quitar o mover elementos a mano en la vista previa.</p>
      <div class="ed-grid">
        ${numField('comp.paper', 'Tarjetas (puestos)', c.paper, 0, 8)}
        <label class="switch ed-full"><input type="checkbox" data-k="comp.styleRandom" ${c.styleRandom ? 'checked' : ''}> Estilos de tarjeta aleatorios</label>
        <span class="${c.styleRandom ? 'hidden' : ''}">
          ${numField('comp.ns', '…no‑shoot lateral', c.ns, 0, c.paper)}
          ${numField('comp.nsTilt', '…no‑shoot inclinado', c.nsTilt, 0, c.paper)}
          ${numField('comp.double', '…dobles superpuestas', c.double, 0, c.paper)}
          ${numField('comp.doubleNs', '…dobles con no‑shoot', c.doubleNs, 0, c.paper)}
          ${numField('comp.hard', '…con cobertura negra', c.hard, 0, c.paper)}
          <label>Tipo de cobertura<select data-k="comp.hardPreset">${opt('random', 'Aleatoria', c.hardPreset)}${Object.entries(HARD_PRESETS).map(([k, p]) => opt(k, p.label, c.hardPreset)).join('')}</select></label>
        </span>
        ${numField('comp.poppers', 'Poppers', c.poppers, 0, 6)}
        <label>Tamaño poppers<select data-k="comp.popSize">${opt('full', 'Normal (85 cm)', c.popSize)}${opt('mini', 'Mini (56 cm)', c.popSize)}${opt('mixed', 'Mezclados', c.popSize)}</select></label>
        ${numField('comp.plates', 'Placas', c.plates, 0, 6)}
        <label>Móvil<select data-k="comp.mover">${Object.entries(MOVER_LABEL).map(([k, l]) => opt(k, l, c.mover)).join('')}</select></label>
        <span class="${c.mover === 'none' ? 'hidden' : ''}">
          <label>Tarjeta del móvil<select data-k="comp.moverStyle">${opt('random', 'Aleatoria', c.moverStyle)}${TARGET_KINDS.map((k) => opt(k, KIND_LABEL[k], c.moverStyle)).join('')}</select></label>
          <label>Cobertura en el móvil<select data-k="comp.moverHard">${opt('none', 'Ninguna', c.moverHard)}${opt('random', 'Aleatoria', c.moverHard)}${Object.entries(HARD_PRESETS).map(([k, p]) => opt(k, p.label, c.moverHard)).join('')}</select></label>
          <label>No‑shoot fijo delante<select data-k="comp.moverNS">${opt('none', 'No', c.moverNS)}${opt('yes', 'Sí', c.moverNS)}${opt('random', 'Aleatorio', c.moverNS)}</select></label>
        </span>
        <label>Distancias<select data-k="comp.dist">${Object.entries(DIST_LABEL).map(([k, l]) => opt(k, l, c.dist)).join('')}</select></label>
      </div>`;
  }

  // vista previa con barra de herramientas y paleta de elementos
  function previewHTML(s, tryLabel) {
    const theme = s.layout?.theme ?? 0;
    return `<div class="card-box ed-prev">
      <div class="row between"><h3>Escenario</h3>
        <div class="row">
          <label class="ed-inline">Ambiente <select id="edTheme">${THEMES.map((t, i) => opt(i, t.name, theme)).join('')}</select></label>
          <button class="btn small" id="edRegen" title="Generar con la composición automática">🎲 Generar</button>
          <button class="btn small" id="edClear" title="Quitar todos los elementos">Vaciar</button>
          <button class="btn small" id="edAct">▶ Ver activación</button>
        </div></div>
      <canvas id="edCanvasHost"></canvas>
      <div class="ed-palette">
        <span class="muted small">Añadir:</span>
        <button class="btn small" data-add="paper">＋ Tarjeta</button>
        <button class="btn small" data-add="popper">＋ Popper</button>
        <button class="btn small" data-add="popper-mini">＋ Mini popper</button>
        <button class="btn small" data-add="plate">＋ Placa</button>
        <button class="btn small" data-add="mover">＋ Móvil</button>
        <button class="btn small" data-add="wall">＋ Muro</button>
        <button class="btn small" data-add="barricade">＋ Barricada baja</button>
        <button class="btn small" data-add="barrel">＋ Bidón</button>
        <button class="btn small" data-add="tires">＋ Neumáticos</button>
        <button class="btn small" data-add="cone">＋ Cono</button>
      </div>
      <p class="muted small">Arrastra cualquier elemento: izquierda/derecha para moverlo de lado, arriba/abajo para alejarlo o acercarlo. Tócalo para editarlo, duplicarlo o eliminarlo (tecla Supr).</p>
      <p class="ed-warn hidden" id="edWarn"></p>
      <div class="ed-item hidden" id="edItem"></div>
      <div class="row end"><button class="btn" id="edTry">${tryLabel}</button></div>
    </div>`;
  }

  function renderBlock() {
    const host = $('#edBlock'), b = block();
    park.appendChild(canvas); // el canvas se reutiliza: se aparca antes de rehacer el formulario
    if (!host) return;
    if (!b) { host.innerHTML = ''; preview = null; return; }
    if (b.type === 'arena') {
      preview = null;
      host.innerHTML = `<div class="card-box ed-form">
        <h3>↔ Recorrido aleatorio</h3>
        <label>Nombre<input data-k="name" value="${esc(b.name)}" maxlength="60"></label>
        <div class="ed-grid">
          ${numField('moves', 'Desplazamientos', b.moves, 1, 200)}
          ${numField('delay', 'La flecha aparece a los', b.delay, 0.3, 10, 0.1, 's')}
          <label>Poppers con móvil<select data-k="activators">${opt('never', 'Nunca', b.activators)}${opt('sometimes', 'A veces', b.activators)}${opt('always', 'Siempre', b.activators)}</select></label>
          ${numField('restAfter', 'Descanso al terminar', b.restAfter, 0, 600, 1, 's')}
        </div>
        <p class="muted small">Escenarios aleatorios: suena el beep y, al tiempo indicado, aparece la dirección. Al desplazarte cambia al siguiente. Termina con un beep final. Para elegir tú cada escenario y cada desplazamiento usa «Recorrido personalizado».</p>
        <div class="row end"><button class="btn" id="edTry">▶ Probar este ejercicio</button></div>
      </div>`;
      $('#edTry').onclick = () => tryBlock(b);
      return;
    }
    if (b.type === 'stage') {
      host.innerHTML = `<div class="ed-stage">
        <div class="card-box ed-form">
          <h3>◎ Escenario con tiempo</h3>
          <label>Nombre<input data-k="name" value="${esc(b.name)}" maxlength="60"></label>
          <h4>Ejercicio</h4>
          <div class="ed-grid">
            ${numField('par', 'Tiempo máximo', b.par, 0.5, 120, 0.1, 's')}
            ${numField('reps', 'Repeticiones', b.reps, 1, 100)}
            ${numField('rest', 'Descanso entre repeticiones', b.rest, 0, 600, 1, 's')}
            <label>Salida tras el descanso<select data-k="startMode">${opt('fixed', 'Al acabar la cuenta atrás', b.startMode)}${opt('random', 'Aleatoria (1,5–2,8 s)', b.startMode)}</select></label>
            <label>Escenario en cada repetición<select data-k="vary">${opt('false', 'Siempre el mismo', String(b.vary))}${opt('true', 'Cambia la colocación', String(b.vary))}</select></label>
            ${numField('restAfter', 'Descanso al terminar el ejercicio', b.restAfter, 0, 600, 1, 's')}
            ${numField('activatorAt', 'Popper activador cae a los', b.activatorAt, 0.5, 10, 0.1, 's')}
          </div>
          <label class="switch"><input type="checkbox" data-k="withMove" ${b.withMove ? 'checked' : ''}> Empezar con desplazamiento (la flecha sale con el beep y el escenario aparece al llegar)</label>
          <p class="muted small">Cada repetición: beep inicial → tiempo máximo → beep final → descanso con cuenta atrás (los últimos 3 s avisan «PREPARADO») → siguiente.</p>
          ${compHTML(b)}
        </div>
        ${previewHTML(b, '▶ Probar este ejercicio')}
      </div>`;
      mountPreview();
      $('#edTry').onclick = () => tryBlock(b);
      return;
    }
    // ---- recorrido personalizado ----
    if (!b.positions.some((p) => p.id === selPosId)) selPosId = b.positions[0]?.id;
    const pi = b.positions.findIndex((p) => p.id === selPosId), pos = b.positions[pi];
    host.innerHTML = `<div class="card-box ed-form ed-course">
        <h3>⇄ Recorrido personalizado</h3>
        <label>Nombre<input data-k="name" value="${esc(b.name)}" maxlength="60"></label>
        <div class="ed-grid">
          ${numField('reps', 'Repeticiones del recorrido', b.reps, 1, 100)}
          ${numField('rest', 'Descanso entre repeticiones', b.rest, 0, 600, 1, 's')}
          <label>Salida tras el descanso<select data-k="startMode">${opt('fixed', 'Al acabar la cuenta atrás', b.startMode)}${opt('random', 'Aleatoria (1,5–2,8 s)', b.startMode)}</select></label>
          ${numField('restAfter', 'Descanso al terminar el ejercicio', b.restAfter, 0, 600, 1, 's')}
        </div>
        <h4>Posiciones</h4>
        <div class="ed-posbar" id="edPosBar">
          ${b.positions.map((p, i) => `<button class="ed-pos ${p.id === selPosId ? 'active' : ''}" data-pos-id="${p.id}">
            <span class="ed-pos-dir">${i === 0 ? 'INICIO' : DIR_ARROW[p.dir]}</span><b>P${i + 1}</b><small>${(+p.time).toLocaleString('es-ES')} s</small></button>`).join('<span class="ed-pos-link"></span>')}
          <button class="btn small accent" data-pos="add">＋ Posición</button>
        </div>
        <p class="muted small" id="edCourseInfo">${courseInfo(b)}</p>
      </div>
      <div class="ed-stage">
        <div class="card-box ed-form">
          <div class="row between"><h3>Posición ${pi + 1}</h3>
            <div class="row">
              <button class="btn small" data-pos="left" title="Mover antes" ${pi <= 0 ? 'disabled' : ''}>◀</button>
              <button class="btn small" data-pos="right" title="Mover después" ${pi >= b.positions.length - 1 ? 'disabled' : ''}>▶</button>
              <button class="btn small" data-pos="dup" title="Duplicar posición">⧉</button>
              <button class="btn small danger" data-pos="del" title="Eliminar posición" ${b.positions.length <= 1 ? 'disabled' : ''}>✕</button>
            </div></div>
          <div class="ed-grid">
            ${pi === 0 ? '<label>Desplazamiento para llegar<input value="Posición de salida" disabled></label>'
              : `<label>Desplazamiento para llegar<select data-k="pos.dir">${['left', 'right', 'random'].map((d) => opt(d, DIR_LABEL[d], pos.dir)).join('')}</select></label>`}
            ${numField('pos.time', pi === b.positions.length - 1 ? 'Tiempo en la posición (hasta el beep final)' : 'Tiempo en la posición (hasta la flecha)', pos.time, 0.5, 60, 0.1, 's')}
            ${numField('activatorAt', 'Popper activador cae a los', pos.activatorAt, 0.5, 10, 0.1, 's')}
          </div>
          <p class="muted small">Cada repetición: beep inicial → P1 → al acabar su tiempo aparece la flecha hacia P2 → al desplazarte entra el escenario de P2 → … → tras la última posición suena el beep final y empieza el descanso.</p>
          ${compHTML(pos)}
        </div>
        ${previewHTML(pos, '▶ Probar este recorrido')}
      </div>`;
    mountPreview();
    $('#edTry').onclick = () => tryBlock(b);
  }

  // dónde acabas respecto al punto de salida (para comprobar que hay sitio)
  function courseInfo(b) {
    let off = 0, lo = 0, hi = 0, rnd = 0;
    b.positions.slice(1).forEach((p) => { if (p.dir === 'left') off--; else if (p.dir === 'right') off++; else rnd++; lo = Math.min(lo, off); hi = Math.max(hi, off); });
    const parts = [];
    if (lo < 0) parts.push(`${-lo} a la izquierda`); if (hi > 0) parts.push(`${hi} a la derecha`);
    return `${b.positions.length} posiciones · ${b.positions.length - 1} desplazamientos. Te alejas como máximo ${parts.length ? parts.join(' y ') : '0'} del punto de salida${rnd ? ` (+${rnd} aleatorios, que se eligen según el espacio)` : ''}. Comprueba que tienes sitio y que la cámara te ve en todo el recorrido.`;
  }

  function tryBlock(b) {
    flush();
    const t = clone(b); t.restAfter = 0;
    app.startProgram({ name: `Prueba · ${b.name}`, blocks: [t] }, prog.id);
  }

  function mountPreview() {
    $('#edCanvasHost').replaceWith(canvas);
    renderer.checkSize(true);
    loadPreview();
    $('#edRegen').onclick = () => {
      const s = scen(); if (!s) return;
      if (s.layout?.manual && !confirm('Generar un escenario nuevo con la composición automática sustituye tus cambios manuales. ¿Continuar?')) return;
      s.layout = layoutOf(composeStage(s.comp, Date.now())); persist(); loadPreview(); renderBlocks();
    };
    $('#edClear').onclick = () => {
      const s = scen(); if (!s || !preview) return;
      if (preview.items.length && !confirm('¿Quitar todos los elementos de este escenario?')) return;
      preview.items = []; finalizeStage(preview); selItem = null; renderItemPanel(); commitLayout();
    };
    $('#edAct').onclick = () => playActivation();
    $('#edTheme').onchange = (e) => {
      const s = scen(); if (!s || !preview) return;
      s.comp.theme = Number(e.target.value); preview.theme = Number(e.target.value);
      const keep = preview.items; preview = finalizeStage({ seed: preview.seed, theme: preview.theme, items: keep });
      commitLayout(false);
    };
  }

  // ------------------------------------------------------------ cambios en los formularios
  $('#edMain').addEventListener('change', onField);
  $('#edMain').addEventListener('input', (e) => { if (e.target.matches('input[data-k="name"]')) onField(e); });
  function onField(e) {
    const el = e.target, k = el.dataset?.k, b = block();
    if (!k || !b) return;
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    if (k === 'vary') v = v === 'true';
    if (el.type === 'number') {
      if (!Number.isFinite(v)) return;
      v = Math.min(Number(el.max || Infinity), Math.max(Number(el.min || 0), v));
      if (el.step === '1' || !el.step) v = Math.round(v);
    }
    if (k.startsWith('comp.')) {
      const s = scen(); if (!s) return;
      if (s.layout?.manual && !confirm('Cambiar la composición automática vuelve a generar el escenario y perderás tus cambios manuales. ¿Continuar?')) { renderBlock(); return; }
      const ck = k.slice(5); s.comp[ck] = v;
      const styleKeys = ['ns', 'nsTilt', 'double', 'doubleNs'];
      if (styleKeys.includes(ck)) { const others = styleKeys.filter((x) => x !== ck).reduce((t, x) => t + (s.comp[x] || 0), 0); s.comp[ck] = Math.max(0, Math.min(v, s.comp.paper - others)); }
      if (ck === 'paper') {
        let room = v;
        for (const x of styleKeys) { s.comp[x] = Math.min(s.comp[x] || 0, room); room -= s.comp[x]; }
        s.comp.hard = Math.min(s.comp.hard, v);
      }
      if (ck === 'mover' && v !== 'none' && s.comp.poppers < 1) s.comp.poppers = 1;
      if (ck === 'poppers' && v < 1 && s.comp.mover !== 'none') s.comp.poppers = 1;
      s.layout = layoutOf(composeStage(s.comp, Date.now()));
      persist(); renderBlocks(); renderBlock();
      return;
    }
    if (k === 'activatorAt') { const s = scen(); if (s) s.activatorAt = v; persist(); renderBlocks(); if (preview?.actStart != null) playActivation(); return; }
    if (k.startsWith('pos.')) { const s = scen(); if (s) s[k.slice(4)] = v; persist(); renderBlocks(); renderBlock(); return; }
    b[k] = v;
    persist(); renderBlocks();
    if (b.type === 'course' && $('#edCourseInfo')) $('#edCourseInfo').textContent = courseInfo(b);
  }

  // clics: lista de ejercicios, posiciones del recorrido y paleta de elementos
  $('#edMain').addEventListener('click', (e) => {
    const li = e.target.closest('.ed-bl');
    if (li) {
      const i = prog.blocks.findIndex((b) => b.id === li.dataset.id), act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) { selBlockId = li.dataset.id; selPosId = null; renderBlocks(); renderBlock(); return; }
      if (act === 'up' && i > 0) [prog.blocks[i - 1], prog.blocks[i]] = [prog.blocks[i], prog.blocks[i - 1]];
      if (act === 'down' && i < prog.blocks.length - 1) [prog.blocks[i + 1], prog.blocks[i]] = [prog.blocks[i], prog.blocks[i + 1]];
      if (act === 'dup') { const c = clone(prog.blocks[i]); c.id = store.uid(); c.name += ' (copia)'; c.positions?.forEach((p) => (p.id = store.uid())); prog.blocks.splice(i + 1, 0, c); selBlockId = c.id; selPosId = null; }
      if (act === 'del') {
        if (!confirm(`¿Eliminar el ejercicio «${prog.blocks[i].name}»?`)) return;
        prog.blocks.splice(i, 1); if (selBlockId === li.dataset.id) selBlockId = prog.blocks[Math.max(0, i - 1)]?.id || null;
      }
      persist(); renderBlocks(); renderBlock();
      return;
    }
    const posBtn = e.target.closest('[data-pos-id]');
    if (posBtn) { selPosId = posBtn.dataset.posId; renderBlock(); return; }
    const posAct = e.target.closest('[data-pos]')?.dataset.pos;
    if (posAct) { positionAction(posAct); return; }
    const add = e.target.closest('[data-add]')?.dataset.add;
    if (add) addItem(add);
  });

  function positionAction(act) {
    const b = block(); if (!b || b.type !== 'course') return;
    const i = b.positions.findIndex((p) => p.id === selPosId);
    if (act === 'add') {
      const last = b.positions[b.positions.length - 1];
      const p = newCoursePosition(last?.dir === 'right' ? 'left' : 'right');
      p.layout = layoutOf(composeStage(p.comp, Date.now()));
      b.positions.push(p); selPosId = p.id;
    } else if (act === 'dup' && i >= 0) {
      const c = clone(b.positions[i]); c.id = store.uid(); if (c.dir === 'none') c.dir = 'right';
      b.positions.splice(i + 1, 0, c); selPosId = c.id;
    } else if (act === 'del' && i >= 0 && b.positions.length > 1) {
      if (!confirm(`¿Eliminar la posición ${i + 1}?`)) return;
      b.positions.splice(i, 1); selPosId = b.positions[Math.max(0, i - 1)].id;
    } else if (act === 'left' && i > 0) [b.positions[i - 1], b.positions[i]] = [b.positions[i], b.positions[i - 1]];
    else if (act === 'right' && i < b.positions.length - 1) [b.positions[i + 1], b.positions[i]] = [b.positions[i], b.positions[i + 1]];
    // la primera posición es siempre la de salida
    b.positions.forEach((p, k) => { if (k === 0) p.dir = 'none'; else if (p.dir === 'none') p.dir = 'right'; });
    persist(); renderBlocks(); renderBlock();
  }

  // ------------------------------------------------------------ vista previa
  function loadPreview() {
    const s = scen(); if (!s) return;
    if (!s.layout) s.layout = layoutOf(composeStage(s.comp, Date.now()));
    preview = stageFromLayout(s.layout); selItem = null; renderItemPanel();
    const sel = $('#edTheme'); if (sel) sel.value = String(preview.theme);
    updateWarn();
  }
  function updateWarn() {
    const s = scen(), w = $('#edWarn'); if (!w || !s || !preview) return;
    let msg = '';
    if (!s.layout?.manual) {
      const c = s.comp;
      const want = c.paper + Math.max(c.poppers, c.mover !== 'none' ? 1 : 0) + c.plates + (c.mover !== 'none' ? 1 : 0);
      const have = preview.items.filter((i) => MAIN_TYPES.includes(i.type)).length;
      if (want > have) msg = `⚠ No caben todos los elementos (${want - have} sin colocar). Reduce cantidades o usa distancias mayores.`;
    }
    if (preview.mover && !preview.popper) msg = '⚠ El móvil no tiene popper activador: toca un popper y marca «Activa el móvil», o añade uno.';
    w.classList.toggle('hidden', !msg); w.textContent = msg;
  }
  function activatorAt() { return scen()?.activatorAt ?? 1; }
  function playActivation() {
    const s = scen(); if (!s || !preview) return;
    if (!preview.act) { toast('Este escenario no tiene un móvil con popper activador'); return; }
    const atMs = activatorAt() * 1000;
    preview = stageFromLayout(layoutOf(preview));
    preview.actSpeed = atMs < ACT.fallStart ? ACT.fallStart / Math.max(300, atMs) : 1;
    preview.actStart = performance.now() + 400 + Math.max(0, atMs - ACT.fallStart);
    preview._t0 = performance.now() + 400;
    selItem = null; renderItemPanel();
  }

  // guarda la disposición tras un cambio manual (arrastre, estilo, añadir o quitar)
  function commitLayout(manual = true) {
    const b = block(), s = scen(); if (!b || !s || !preview) return;
    finalizeStage(preview);
    s.layout = layoutOf(preview); if (manual || s.layout.manual) s.layout.manual = true;
    if (b.type === 'stage' && b.vary) { b.vary = false; const v = $('[data-k="vary"]'); if (v) v.value = 'false'; toast('Has ajustado el escenario a mano: se usará el mismo en todas las repeticiones'); }
    updateWarn(); persist(); renderBlocks();
  }

  // ------------------------------------------------------------ añadir / duplicar / eliminar
  function freeX(d, widthM) {
    // busca un hueco libre entre los elementos principales; si no hay, al centro
    const taken = preview.items.filter((i) => Math.abs(i.x) < 1.2).map((i) => { const [w] = itemSize(i); const hw = (w / 2) * F * 0.5625 / (i.d * SPREAD); return [i.x - hw, i.x + hw]; });
    const hw = (widthM / 2) * F * 0.5625 / (d * SPREAD);
    for (let k = 0; k < 40; k++) {
      const x = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.08;
      if (Math.abs(x) > 0.95) break;
      if (taken.every(([a, b2]) => x + hw < a || x - hw > b2)) return x;
    }
    return (Math.random() - 0.5) * 0.4;
  }
  function addItem(kind) {
    const s = scen(); if (!s || !preview) return;
    const seed = Math.floor(Math.random() * 1e9);
    let it;
    switch (kind) {
      case 'paper': it = { type: 'paper', d: 8.5, mini: false, style: makeStyle('normal'), pasters: [], pasters2: [], seed }; break;
      case 'popper': case 'popper-mini': it = { type: 'popper', d: 8.5, mini: kind === 'popper-mini', activator: false, seed }; break;
      case 'plate': it = { type: 'plate', d: 8.5, seed }; break;
      case 'mover': it = { type: 'mover', mtype: 'swinger', d: 11.5, style: 'ply', seed, dir: 1, tstyle: makeStyle('normal'), fixedNS: null }; break;
      case 'wall': it = { type: 'wall', d: 8, w: 1.4, h: 2.0, style: 'ply', seed }; break;
      case 'barricade': it = { type: 'wall', d: 7.5, w: 1.6, h: 1.1, style: 'ply', seed }; break;
      case 'barrel': it = { type: 'barrel', d: 8, color: '#2f5f9e', seed }; break;
      case 'tires': it = { type: 'tires', d: 8, n: 2, seed }; break;
      case 'cone': it = { type: 'cone', d: 7, seed }; break;
      default: return;
    }
    it.x = freeX(it.d, itemSize(it)[0]);
    if (it.type === 'mover') it.side = it.x <= 0 ? 1 : -1;
    preview.items.push(it);
    // un móvil necesita su popper activador: si no hay, se añade uno al otro lado
    if (it.type === 'mover' && !preview.items.some((i) => i.type === 'popper' && i.activator)) {
      const pop = { type: 'popper', d: 8.5, mini: false, activator: true, seed: seed + 1 };
      pop.x = it.x <= 0 ? 0.6 : -0.6; preview.items.push(pop);
      toast('Móvil añadido con su popper activador');
    }
    selItem = it; commitLayout(); renderItemPanel();
  }
  function duplicateItem(it) {
    const c = clone(it); c.seed = Math.floor(Math.random() * 1e9); c.x = Math.min(1.4, it.x + 0.18);
    if (c.type === 'popper') c.activator = false;
    if (c.type === 'mover') c.side = c.x <= 0 ? 1 : -1;
    preview.items.push(c); selItem = c; commitLayout(); renderItemPanel();
  }
  function deleteItem(it) {
    preview.items = preview.items.filter((i) => i !== it);
    selItem = null; commitLayout(); renderItemPanel();
  }
  document.addEventListener('keydown', (e) => {
    if (!$('#tab-editor').classList.contains('active') || !selItem || !preview?.items.includes(selItem)) return;
    if (e.target?.matches?.('input, textarea, select')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteItem(selItem); }
  });

  // ------------------------------------------------------------ arrastrar
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  }
  function bbox(it) {
    const g = renderer.P(renderer.lat(it.x, it.d), 0, it.d), [w, h] = itemSize(it);
    return { x0: g.x - (w * g.k) / 2, x1: g.x + (w * g.k) / 2, y0: g.y - h * g.k, y1: g.y, gx: g.x, gy: g.y };
  }
  function pick(pt) {
    if (!preview) return null;
    for (let i = preview.sorted.length - 1; i >= 0; i--) {
      const it = preview.sorted[i], bb = bbox(it);
      if (pt.x >= bb.x0 && pt.x <= bb.x1 && pt.y >= bb.y0 && pt.y <= bb.y1 + 6) return it;
    }
    return null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    const pt = toCanvas(e), it = pick(pt);
    if (it !== selItem) { selItem = it; renderItemPanel(); }
    if (!it) return;
    const bb = bbox(it);
    drag = { it, offX: pt.x - bb.gx, offY: pt.y - bb.gy, moved: false };
    canvas.setPointerCapture(e.pointerId); e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const pt = toCanvas(e);
    if (!drag) { canvas.style.cursor = pick(pt) ? 'grab' : 'default'; return; }
    canvas.style.cursor = 'grabbing';
    const { W, H } = renderer, it = drag.it;
    const sx = pt.x - drag.offX, sy = pt.y - drag.offY;
    const k = (sy - H * HOR) / CAMH;
    const dMin = it.type === 'mover' ? 8 : 5.8, dMax = it.type === 'mover' ? 16 : it.type === 'wall' ? 22 : 20;
    it.d = Math.min(dMax, Math.max(dMin, k > 0 ? (F * H) / k : dMax));
    it.x = Math.min(1.45, Math.max(-1.45, (sx - W / 2) / (SPREAD * W)));
    if (it.type === 'mover') it.side = it.x <= 0 ? 1 : -1;
    preview.sorted = [...preview.items].sort((a, b) => b.d - a.d);
    drag.moved = true;
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) { commitLayout(); renderItemPanel(); }
    drag = null; canvas.style.cursor = 'default';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ------------------------------------------------------------ panel del elemento seleccionado
  const cloneStyle = (st) => ({ kind: st.kind, ns: st.ns ? { ...st.ns } : null, hard: st.hard ? { ...st.hard } : null });
  const moverStyle = (it) => (it.tstyle?.kind ? it.tstyle : { kind: 'normal', ns: null, hard: null });

  function styleFields(st, isMover) {
    const h = st.hard;
    return `
      <label>${isMover ? 'Tarjeta del móvil' : 'Estilo'}<select data-st="kind">${TARGET_KINDS.map((k) => opt(k, KIND_LABEL[k], st.kind)).join('')}</select></label>
      ${st.ns ? `<label>Lado del no‑shoot<select data-st="nsSide">${opt(-1, 'Izquierda', st.ns.side)}${opt(1, 'Derecha', st.ns.side)}</select></label>` : ''}
      ${st.kind === 'ns-tilt' ? range('nsAngle', 'Inclinación del no‑shoot', st.ns.angle, -45, 45, 1, '°') : ''}
      <label>Cobertura negra<select data-st="hard">${opt('none', 'Ninguna', h?.preset || 'none')}${Object.entries(HARD_PRESETS).map(([k, p]) => opt(k, p.label, h?.preset || 'none')).join('')}</select></label>
      ${h ? range('hardAngle', 'Ángulo de la cobertura', Math.round(h.angle), -180, 180, 1, '°') + range('hardAmount', 'Cuánto tapa', Math.round(h.amount * 100), 5, 90, 1, '%') : ''}
      ${h ? '<label>&nbsp;<button class="btn small" data-st="flip">↔ Invertir cobertura</button></label>' : ''}`;
  }

  function renderItemPanel() {
    const host = $('#edItem'); if (!host) return;
    const it = selItem;
    if (!it || !preview?.items.includes(it)) { host.classList.add('hidden'); host.innerHTML = ''; return; }
    let title = ITEM_NAME[it.type] || 'Elemento', fields = '', extraBtn = '';
    switch (it.type) {
      case 'paper':
        title = 'Tarjeta'; extraBtn = '<button class="btn small" data-st="random">🎲 Estilo aleatorio</button>';
        fields = styleFields(styleOf(it), false) + `<label>Tamaño<select data-st="mini">${opt('false', 'Normal', String(!!it.mini))}${opt('true', 'Mini (2/3)', String(!!it.mini))}</select></label>`;
        break;
      case 'mover': {
        title = `Móvil · ${MOVER_LABEL[it.mtype]}`; extraBtn = '<button class="btn small" data-st="random">🎲 Estilo aleatorio</button>';
        fields = `<label>Tipo de móvil<select data-st="mtype">${MOVER_TYPES.map((m) => opt(m, MOVER_LABEL[m], it.mtype)).join('')}</select></label>
          ${it.mtype === 'slider' ? `<label>Sentido<select data-st="sdir">${opt(1, 'De izquierda a derecha', it.dir)}${opt(-1, 'De derecha a izquierda', it.dir)}</select></label>` : ''}
          ${it.mtype !== 'bobber' ? `<label>Paredes<select data-st="wallStyle">${Object.entries(WALL_STYLE_LABEL).map(([k, l]) => opt(k, l, it.style)).join('')}</select></label>` : ''}
          ${styleFields(moverStyle(it), true)}
          <label class="switch ed-full"><input type="checkbox" data-st="fixedNS" ${it.fixedNS ? 'checked' : ''}> No‑shoot fijo delante del recorrido</label>
          ${it.fixedNS ? range('nsDx', 'Posición del no‑shoot', Math.round(it.fixedNS.dx * 100), -60, 60, 1, ' cm') + range('nsFixAngle', 'Inclinación', it.fixedNS.angle, -45, 45, 1, '°') : ''}`;
        break;
      }
      case 'popper': {
        const hasMover = preview.items.some((i) => i.type === 'mover');
        title = it.mini ? 'Mini popper' : 'Popper';
        fields = `<label>Tamaño<select data-st="popMini">${opt('false', 'Normal (85 cm)', String(!!it.mini))}${opt('true', 'Mini (56 cm)', String(!!it.mini))}</select></label>
          <label class="switch ed-full"><input type="checkbox" data-st="activator" ${it.activator ? 'checked' : ''} ${hasMover ? '' : 'disabled'}> Activa el móvil (onda, brillo y caída)${hasMover ? '' : ' — añade antes un móvil'}</label>`;
        break;
      }
      case 'wall':
        title = it.h <= 1.3 ? 'Barricada baja' : 'Muro';
        fields = range('wallW', 'Ancho', Math.round(it.w * 10) / 10, 0.4, 4, 0.1, ' m') + range('wallH', 'Alto', Math.round(it.h * 100) / 100, 0.6, 2.6, 0.05, ' m')
          + `<label>Acabado<select data-st="wallStyle">${Object.entries(WALL_STYLE_LABEL).map(([k, l]) => opt(k, l, it.style)).join('')}</select></label>`;
        break;
      case 'barrel':
        fields = `<label>Color<select data-st="barrelColor">${Object.entries(BARREL_COLORS).map(([k, l]) => opt(k, l, it.color)).join('')}</select></label>`;
        break;
      case 'tires':
        fields = `<label>Neumáticos apilados<select data-st="tiresN">${[1, 2, 3, 4].map((n) => opt(n, String(n), it.n)).join('')}</select></label>`;
        break;
      default: fields = '<p class="muted small ed-full">Sin opciones: arrástralo para colocarlo.</p>';
    }
    host.innerHTML = `
      <div class="row between"><b>${title} <span class="muted">· ${it.d.toFixed(1)} m</span></b>
        <div class="row">${extraBtn}<button class="btn small" data-st="dup">⧉ Duplicar</button><button class="btn small danger" data-st="del">🗑 Eliminar</button></div></div>
      <div class="ed-grid">${fields}</div>`;
    host.classList.remove('hidden');
  }

  function onStyle(e) {
    const el = e.target.closest?.('[data-st]'); if (!el || !selItem || !preview) return;
    const key = el.dataset.st, it = selItem;
    if (key === 'dup') return duplicateItem(it);
    if (key === 'del') return deleteItem(it);
    const isMover = it.type === 'mover', hasStyle = it.type === 'paper' || isMover;
    let st = hasStyle ? cloneStyle(isMover ? moverStyle(it) : styleOf(it)) : null, rerender = false;
    switch (key) {
      case 'random': st = makeStyle(randomKind(), Math.random, Math.random() < 0.35 ? 'random' : null); rerender = true; break;
      case 'kind': {
        const fresh = makeStyle(el.value);
        if (fresh.ns && st.ns) { fresh.ns.side = st.ns.side; if (fresh.kind === 'ns-tilt') fresh.ns.angle = Math.abs(fresh.ns.angle) * st.ns.side; }
        st = { ...fresh, hard: st.hard }; rerender = true; break;
      }
      case 'nsSide': st.ns.side = Number(el.value); if (st.kind === 'ns-tilt') st.ns.angle = Math.abs(st.ns.angle || 22) * st.ns.side; rerender = true; break;
      case 'nsAngle': st.ns.angle = Number(el.value); break;
      case 'mini': it.mini = el.value === 'true'; break;
      case 'hard': st.hard = el.value === 'none' ? null : { preset: el.value, angle: HARD_PRESETS[el.value].angle, amount: HARD_PRESETS[el.value].amount }; rerender = true; break;
      case 'hardAngle': st.hard.angle = Number(el.value); break;
      case 'hardAmount': st.hard.amount = Number(el.value) / 100; break;
      case 'flip': st.hard.angle = ((st.hard.angle + 360) % 360) - 180; rerender = true; break;
      case 'fixedNS': it.fixedNS = el.checked ? { dx: 0, angle: 0 } : null; rerender = true; break;
      case 'nsDx': it.fixedNS.dx = Number(el.value) / 100; break;
      case 'nsFixAngle': it.fixedNS.angle = Number(el.value); break;
      case 'mtype': it.mtype = el.value; it.d = Math.min(16, Math.max(8, it.d)); rerender = true; break;
      case 'sdir': it.dir = Number(el.value); break;
      case 'wallStyle': it.style = el.value; break;
      case 'popMini': it.mini = el.value === 'true'; rerender = true; break;
      case 'activator':
        if (el.checked) preview.items.forEach((i) => { if (i.type === 'popper') i.activator = false; });
        it.activator = el.checked; break;
      case 'wallW': it.w = Number(el.value); break;
      case 'wallH': it.h = Number(el.value); rerender = (it.h <= 1.3) !== (Number(el.defaultValue) <= 1.3); break;
      case 'barrelColor': it.color = el.value; break;
      case 'tiresN': it.n = Number(el.value); break;
      default: return;
    }
    if (st) { if (isMover) it.tstyle = st; else { it.style = st; delete it.ns; delete it.hard; } }
    const out = el.parentElement?.querySelector('output'); if (out) out.textContent = `${el.value}${out.dataset.unit}`;
    commitLayout();
    if (rerender) renderItemPanel();
  }
  $('#edMain').addEventListener('input', (e) => { if (e.target.dataset?.st && e.target.type === 'range') onStyle(e); });
  $('#edMain').addEventListener('change', (e) => { if (e.target.dataset?.st && e.target.type !== 'range') onStyle(e); });
  $('#edMain').addEventListener('click', (e) => { const b = e.target.closest?.('button[data-st]'); if (b) onStyle(e); });

  // ------------------------------------------------------------ dibujo
  function overlay(now) {
    const ctx = renderer.ctx, u = renderer.u;
    if (selItem && preview?.items.includes(selItem)) {
      const bb = bbox(selItem);
      ctx.save(); ctx.setLineDash([6 * u, 4 * u]); ctx.lineWidth = 2 * u; ctx.strokeStyle = '#d4ff3a';
      ctx.strokeRect(bb.x0 - 4 * u, bb.y0 - 4 * u, bb.x1 - bb.x0 + 8 * u, bb.y1 - bb.y0 + 8 * u);
      ctx.setLineDash([]); ctx.font = `700 ${14 * u}px Rajdhani, sans-serif`; ctx.fillStyle = '#d4ff3a'; ctx.textBaseline = 'bottom';
      const name = ITEM_NAME[selItem.type] + (selItem.type === 'mover' ? ` · ${MOVER_LABEL[selItem.mtype]}` : selItem.activator ? ' activador' : '');
      ctx.fillText(`${name} · ${selItem.d.toFixed(1)} m`, bb.x0, bb.y0 - 8 * u);
      ctx.restore();
    }
    if (preview?._t0 != null) {
      const t = (now - preview._t0) / 1000;
      if (t >= 0 && t < 8) {
        ctx.save(); ctx.font = `700 ${22 * u}px Rajdhani, sans-serif`; ctx.fillStyle = 'rgba(8,12,18,0.6)';
        ctx.fillRect(renderer.W - 120 * u, 12 * u, 108 * u, 34 * u); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${t.toFixed(1)} s`, renderer.W - 66 * u, 29 * u); ctx.restore();
      }
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (!$('#tab-editor').classList.contains('active') || !preview || canvas.parentElement === park) return;
    const b = block(), s = scen();
    const where = b?.type === 'course' ? `P${b.positions.indexOf(s) + 1} · ` : '';
    renderer.render({ stage: preview, info: `${where}${THEMES[preview.theme].name.toUpperCase()} · ${preview.items.filter((i) => MAIN_TYPES.includes(i.type)).length} BLANCOS` }, now);
    overlay(now);
  }
  requestAnimationFrame(loop);

  // ------------------------------------------------------------ compartir / exportar
  async function share() {
    store.saveProgram(prog);
    const url = shareUrl(prog);
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado: envíalo a tu equipo y al abrirlo podrán importar el entrenamiento 🔗', 4500); }
    catch {
      await ask({ title: 'Compartir entrenamiento', html: '<p class="muted small">Copia este enlace y envíalo a tu equipo:</p>', fields: [{ id: 'url', label: 'Enlace', value: url }], ok: 'Cerrar', cancel: null });
    }
  }
  function exportProgram() {
    const blob = new Blob([JSON.stringify({ app: 'ipsc-track', type: 'program', program: prog }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `entrenamiento-${prog.name.toLowerCase().replace(/[^a-z0-9áéíóúñü]+/gi, '-').replace(/^-|-$/g, '') || 'ipsc'}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ------------------------------------------------------------ API
  return {
    onShow() {
      if (!programs().length && !localStorage.getItem('ipsctrack.exampleCreated')) {
        const p = exampleProgram(); ensureLayouts(p); store.saveProgram(p);
        try { localStorage.setItem('ipsctrack.exampleCreated', '1'); } catch { /* sin almacenamiento */ }
      }
      if (!curId || !cur()) curId = programs()[0]?.id || null;
      open(curId);
    },
    open,
    importShared(p) { ensureLayouts(p); store.saveProgram(p); return p.id; },
    // datos para pruebas
    debug: () => ({ prog, preview, selItem, renderer, scen: scen() }),
  };
}
