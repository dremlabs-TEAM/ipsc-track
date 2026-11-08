// Editor de entrenamientos: crea secuencias de ejercicios (escenarios con tiempo y recorridos),
// con vista previa del escenario en la que se puede arrastrar cada elemento.
import { composeStage, stageFromLayout, layoutOf, PERSPECTIVE, makeStyle, randomKind, TARGET_KINDS, KIND_LABEL, HARD_PRESETS, kindWidth } from './course.js?v=20261108-2301';
import { StageRenderer, THEMES, ACT, styleOf, stackHeight } from './scene.js?v=20261108-2301';
import * as store from './storage.js?v=20261108-2301';
import {
  newProgram, newStageBlock, newArenaBlock, exampleProgram, blockSummary, blockDuration, programDuration, fmtDuration,
  shareUrl, sanitizeProgram, MOVER_LABEL, DIST_LABEL,
} from './program.js?v=20261108-2301';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
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
const ITEM_NAME = { paper: 'Tarjeta', popper: 'Popper', plate: 'Placa', wall: 'Barrera', barrel: 'Bidón', tires: 'Neumáticos', cone: 'Cono', mover: 'Móvil' };

export function initEditor(app) {
  const { toast, ask } = app;
  const canvas = $('#edCanvas'), park = $('#edPark');
  const renderer = new StageRenderer(canvas);
  renderer.cacheItems = false; // en el editor los elementos se arrastran: se dibujan siempre en vivo
  let curId = null, selBlockId = null, preview = null, selItem = null, drag = null, saveT = null;

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

  function ensureLayouts(p) {
    const defComp = newStageBlock().comp;
    for (const b of p.blocks) if (b.type === 'stage') b.comp = { ...defComp, ...b.comp };
    for (const b of p.blocks) if (b.type === 'stage' && !b.layout) b.layout = layoutOf(composeStage(b.comp, Date.now() + Math.floor(Math.random() * 1e6)));
  }

  function open(id) {
    flush();
    curId = id; prog = cur() ? clone(cur()) : null;
    if (prog) { ensureLayouts(prog); store.saveProgram(prog); }
    selBlockId = prog?.blocks[0]?.id || null;
    renderList(); renderMain();
  }

  // ------------------------------------------------------------ entrenamiento abierto
  function renderMain() {
    const main = $('#edMain');
    if (!prog) {
      main.innerHTML = `<div class="ed-empty"><h2>Editor de entrenamientos</h2>
        <p class="muted">Crea secuencias de ejercicios: escenarios con tiempo máximo, repeticiones y descansos, o recorridos con desplazamientos. Después entrénalos en «En seco» o compártelos con tu equipo.</p>
        <button class="btn primary" id="edNew2">+ Crear entrenamiento</button></div>`;
      $('#edNew2').onclick = () => $('#edNew').click();
      return;
    }
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
        <button class="btn" id="edAddArena">+ Recorrido con desplazamientos</button>
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
    $('#edAddArena').onclick = () => addBlock(newArenaBlock());
    renderBlocks(); renderBlock();
  }

  function addBlock(b) {
    if (b.type === 'stage') b.layout = layoutOf(composeStage(b.comp, Date.now()));
    prog.blocks.push(b); selBlockId = b.id; persist(); renderBlocks(); renderBlock();
    $('#edBlock').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderBlocks() {
    $('#edChips').innerHTML = `<span class="chip">${prog.blocks.length} ${prog.blocks.length === 1 ? 'ejercicio' : 'ejercicios'}</span><span class="chip">Duración aprox. ${fmtDuration(programDuration(prog))}</span>`;
    $('#edBlocks').innerHTML = prog.blocks.map((b, i) => `
      <li class="ed-bl ${b.id === selBlockId ? 'active' : ''}" data-id="${b.id}">
        <span class="ed-num">${i + 1}</span>
        <div class="ed-bl-txt"><b>${b.type === 'arena' ? '↔ ' : '◎ '}${esc(b.name)}</b><small>${esc(blockSummary(b))} · ~${fmtDuration(blockDuration(b, i === prog.blocks.length - 1))}</small></div>
        <div class="ed-bl-act">
          <button class="btn small" data-act="up" title="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn small" data-act="down" title="Bajar" ${i === prog.blocks.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn small" data-act="dup" title="Duplicar">⧉</button>
          <button class="btn small danger" data-act="del" title="Eliminar">✕</button>
        </div>
      </li>`).join('') || '<p class="muted small">Añade un ejercicio para empezar.</p>';
  }
  $('#edMain').addEventListener('click', (e) => {
    const li = e.target.closest('.ed-bl'); if (!li) return;
    const i = prog.blocks.findIndex((b) => b.id === li.dataset.id), act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) { selBlockId = li.dataset.id; renderBlocks(); renderBlock(); return; }
    if (act === 'up' && i > 0) [prog.blocks[i - 1], prog.blocks[i]] = [prog.blocks[i], prog.blocks[i - 1]];
    if (act === 'down' && i < prog.blocks.length - 1) [prog.blocks[i + 1], prog.blocks[i]] = [prog.blocks[i], prog.blocks[i + 1]];
    if (act === 'dup') { const c = clone(prog.blocks[i]); c.id = store.uid(); c.name += ' (copia)'; prog.blocks.splice(i + 1, 0, c); selBlockId = c.id; }
    if (act === 'del') {
      if (!confirm(`¿Eliminar el ejercicio «${prog.blocks[i].name}»?`)) return;
      prog.blocks.splice(i, 1); if (selBlockId === li.dataset.id) selBlockId = prog.blocks[Math.max(0, i - 1)]?.id || null;
    }
    persist(); renderBlocks(); renderBlock();
  });

  // ------------------------------------------------------------ formulario del ejercicio
  const opt = (v, label, curV) => `<option value="${v}" ${String(v) === String(curV) ? 'selected' : ''}>${label}</option>`;
  const numField = (k, label, v, min, max, step = 1, suffix = '') => `<label>${label}<span class="ed-num-in"><input type="number" data-k="${k}" value="${v}" min="${min}" max="${max}" step="${step}">${suffix ? `<em>${suffix}</em>` : ''}</span></label>`;

  function renderBlock() {
    const host = $('#edBlock'), b = block();
    park.appendChild(canvas); // el canvas se reutiliza: se aparca antes de rehacer el formulario
    if (!host) return;
    if (!b) { host.innerHTML = ''; preview = null; return; }
    if (b.type === 'arena') {
      preview = null;
      host.innerHTML = `<div class="card-box ed-form">
        <h3>↔ Recorrido con desplazamientos</h3>
        <label>Nombre<input data-k="name" value="${esc(b.name)}" maxlength="60"></label>
        <div class="ed-grid">
          ${numField('moves', 'Desplazamientos', b.moves, 1, 200)}
          ${numField('delay', 'La flecha aparece a los', b.delay, 0.3, 10, 0.1, 's')}
          <label>Poppers con móvil<select data-k="activators">${opt('never', 'Nunca', b.activators)}${opt('sometimes', 'A veces', b.activators)}${opt('always', 'Siempre', b.activators)}</select></label>
          ${numField('restAfter', 'Descanso al terminar', b.restAfter, 0, 600, 1, 's')}
        </div>
        <p class="muted small">Escenarios aleatorios: suena el beep y, al tiempo indicado, aparece la dirección. Al desplazarte cambia al siguiente. Termina con un beep final.</p>
        <div class="row end"><button class="btn" id="edTry">▶ Probar este ejercicio</button></div>
      </div>`;
    } else {
      const c = b.comp;
      host.innerHTML = `<div class="ed-stage">
        <div class="card-box ed-form">
          <h3>◎ Escenario con tiempo</h3>
          <label>Nombre<input data-k="name" value="${esc(b.name)}" maxlength="60"></label>
          <h4>Composición</h4>
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
            <span class="${c.mover === 'none' ? 'hidden' : ''}" id="edActWrap">${numField('activatorAt', 'Popper activador cae a los', b.activatorAt, 0.5, 10, 0.1, 's')}
              <label>Tarjeta del móvil<select data-k="comp.moverStyle">${opt('random', 'Aleatoria', c.moverStyle)}${TARGET_KINDS.map((k) => opt(k, KIND_LABEL[k], c.moverStyle)).join('')}</select></label>
              <label>Cobertura en el móvil<select data-k="comp.moverHard">${opt('none', 'Ninguna', c.moverHard)}${opt('random', 'Aleatoria', c.moverHard)}${Object.entries(HARD_PRESETS).map(([k, p]) => opt(k, p.label, c.moverHard)).join('')}</select></label>
              <label>No‑shoot fijo delante<select data-k="comp.moverNS">${opt('none', 'No', c.moverNS)}${opt('yes', 'Sí', c.moverNS)}${opt('random', 'Aleatorio', c.moverNS)}</select></label>
            </span>
            <label>Distancias<select data-k="comp.dist">${Object.entries(DIST_LABEL).map(([k, l]) => opt(k, l, c.dist)).join('')}</select></label>
            <label>Ambiente<select data-k="comp.theme">${opt(-1, 'Aleatorio', c.theme)}${THEMES.map((t, i) => opt(i, t.name, c.theme)).join('')}</select></label>
          </div>
          <h4>Ejercicio</h4>
          <div class="ed-grid">
            ${numField('par', 'Tiempo máximo', b.par, 0.5, 120, 0.1, 's')}
            ${numField('reps', 'Repeticiones', b.reps, 1, 100)}
            ${numField('rest', 'Descanso entre repeticiones', b.rest, 0, 600, 1, 's')}
            <label>Salida tras el descanso<select data-k="startMode">${opt('fixed', 'Al acabar la cuenta atrás', b.startMode)}${opt('random', 'Aleatoria (1,5–2,8 s)', b.startMode)}</select></label>
            <label>Escenario en cada repetición<select data-k="vary">${opt('false', 'Siempre el mismo', String(b.vary))}${opt('true', 'Cambia la colocación', String(b.vary))}</select></label>
            ${numField('restAfter', 'Descanso al terminar el ejercicio', b.restAfter, 0, 600, 1, 's')}
          </div>
          <label class="switch"><input type="checkbox" data-k="withMove" ${b.withMove ? 'checked' : ''}> Empezar con desplazamiento (la flecha sale con el beep y el escenario aparece al llegar)</label>
          <p class="muted small">Cada repetición: beep inicial → tiempo máximo → beep final → descanso con cuenta atrás (los últimos 3 s avisan «PREPARADO») → siguiente.</p>
        </div>
        <div class="card-box ed-prev">
          <div class="row between"><h3>Vista previa</h3>
            <div class="row"><button class="btn small" id="edRegen">🎲 Otra disposición</button><button class="btn small" id="edAct" ${c.mover === 'none' ? 'disabled' : ''}>▶ Ver activación</button></div></div>
          <canvas id="edCanvasHost"></canvas>
          <p class="muted small" id="edHint">Arrastra cualquier elemento: izquierda/derecha para moverlo de lado, arriba/abajo para alejarlo o acercarlo. Toca una tarjeta o un móvil para cambiar su estilo.</p>
          <p class="ed-warn hidden" id="edWarn"></p>
          <div class="ed-item hidden" id="edItem"></div>
          <div class="row end"><button class="btn" id="edTry">▶ Probar este ejercicio</button></div>
        </div>
      </div>`;
      // reutiliza el canvas del renderer (se mueve al hueco de la vista previa)
      $('#edCanvasHost').replaceWith(canvas);
      renderer.checkSize(true);
      loadPreview();
      $('#edRegen').onclick = () => { b.layout = layoutOf(composeStage(b.comp, Date.now())); persist(); loadPreview(); };
      $('#edAct').onclick = () => playActivation();
    }
    $('#edTry').onclick = () => {
      flush();
      const t = clone(b); t.restAfter = 0;
      app.startProgram({ name: `Prueba · ${b.name}`, blocks: [t] }, prog.id);
    };
  }

  // cambios en el formulario (delegado)
  $('#edMain').addEventListener('change', onField);
  $('#edMain').addEventListener('input', (e) => { if (e.target.matches('input[data-k="name"]')) onField(e); });
  function onField(e) {
    const el = e.target, k = el.dataset?.k, b = block();
    if (!k || !b) return;
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    if (k === 'vary') v = v === 'true';
    if (k === 'comp.theme') v = Number(v);
    if (el.type === 'number') {
      if (!Number.isFinite(v)) return;
      v = Math.min(Number(el.max || Infinity), Math.max(Number(el.min || 0), v));
      if (el.step === '1' || !el.step) v = Math.round(v);
    }
    if (k.startsWith('comp.')) {
      const ck = k.slice(5); b.comp[ck] = v;
      const styleKeys = ['ns', 'nsTilt', 'double', 'doubleNs'];
      if (styleKeys.includes(ck)) { const others = styleKeys.filter((x) => x !== ck).reduce((t, x) => t + (b.comp[x] || 0), 0); b.comp[ck] = Math.max(0, Math.min(v, b.comp.paper - others)); }
      if (ck === 'paper') {
        let room = v;
        for (const x of styleKeys) { b.comp[x] = Math.min(b.comp[x] || 0, room); room -= b.comp[x]; }
        b.comp.hard = Math.min(b.comp.hard, v);
      }
      if (ck === 'mover' && v !== 'none' && b.comp.poppers < 1) b.comp.poppers = 1;
      if (ck === 'poppers' && v < 1 && b.comp.mover !== 'none') b.comp.poppers = 1;
      b.layout = layoutOf(composeStage(b.comp, Date.now()));
      persist(); renderBlocks(); renderBlock();
      return;
    }
    b[k] = v;
    persist(); renderBlocks();
    if (k === 'activatorAt' && preview?.actStart != null) playActivation();
  }

  // ------------------------------------------------------------ vista previa + arrastrar
  function loadPreview() {
    const b = block(); if (!b?.layout) return;
    preview = stageFromLayout(b.layout); selItem = null; renderItemPanel();
    const missing = composeCheck(b);
    const w = $('#edWarn'); if (w) { w.classList.toggle('hidden', !missing); w.textContent = missing ? `⚠ No caben todos los elementos (${missing} sin colocar). Reduce cantidades o usa distancias mayores.` : ''; }
  }
  function composeCheck(b) {
    const want = b.comp.paper + Math.max(b.comp.poppers, b.comp.mover !== 'none' ? 1 : 0) + b.comp.plates + (b.comp.mover !== 'none' ? 1 : 0);
    const have = preview.items.filter((i) => ['paper', 'popper', 'plate', 'mover'].includes(i.type)).length;
    return Math.max(0, want - have);
  }
  function playActivation() {
    const b = block(); if (!preview?.act || !b) return;
    const atMs = b.activatorAt * 1000;
    preview = stageFromLayout(b.layout);
    preview.actSpeed = atMs < ACT.fallStart ? ACT.fallStart / Math.max(300, atMs) : 1;
    preview.actStart = performance.now() + 400 + Math.max(0, atMs - ACT.fallStart);
    preview._t0 = performance.now() + 400;
  }

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
    const dMin = it.type === 'mover' ? 8 : 5.8, dMax = it.type === 'mover' ? 16 : 20;
    it.d = Math.min(dMax, Math.max(dMin, k > 0 ? (F * H) / k : dMax));
    it.x = Math.min(1.45, Math.max(-1.45, (sx - W / 2) / (SPREAD * W)));
    if (it.type === 'mover') it.side = it.x <= 0 ? 1 : -1;
    preview.sorted = [...preview.items].sort((a, b) => b.d - a.d);
    drag.moved = true;
  });
  const endDrag = () => {
    if (!drag) return;
    const b = block();
    if (drag.moved && b) { commitLayout(); renderItemPanel(); }
    drag = null; canvas.style.cursor = 'default';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ------------------------------------------------------------ estilo de la tarjeta seleccionada
  const range = (key, label, v, min, max, step, unit) =>
    `<label>${label}<span class="ed-range"><input type="range" data-st="${key}" min="${min}" max="${max}" step="${step}" value="${v}"><output data-unit="${unit}">${v}${unit}</output></span></label>`;
  const cloneStyle = (st) => ({ kind: st.kind, ns: st.ns ? { ...st.ns } : null, hard: st.hard ? { ...st.hard } : null });
  const moverStyle = (it) => (it.tstyle?.kind ? it.tstyle : { kind: 'normal', ns: null, hard: null });

  function renderItemPanel() {
    const host = $('#edItem'); if (!host) return;
    const it = selItem;
    if (!it || !preview?.items.includes(it) || (it.type !== 'paper' && it.type !== 'mover')) { host.classList.add('hidden'); host.innerHTML = ''; return; }
    const isMover = it.type === 'mover', st = isMover ? moverStyle(it) : styleOf(it), h = st.hard;
    host.innerHTML = `
      <div class="row between"><b>${isMover ? `Móvil · ${MOVER_LABEL[it.mtype]}` : 'Tarjeta seleccionada'} <span class="muted">· ${it.d.toFixed(1)} m</span></b>
        <button class="btn small" data-st="random">🎲 Estilo aleatorio</button></div>
      <div class="ed-grid">
        <label>${isMover ? 'Tarjeta del móvil' : 'Estilo'}<select data-st="kind">${TARGET_KINDS.map((k) => opt(k, KIND_LABEL[k], st.kind)).join('')}</select></label>
        ${st.ns ? `<label>Lado del no‑shoot<select data-st="nsSide">${opt(-1, 'Izquierda', st.ns.side)}${opt(1, 'Derecha', st.ns.side)}</select></label>` : ''}
        ${st.kind === 'ns-tilt' ? range('nsAngle', 'Inclinación del no‑shoot', st.ns.angle, -45, 45, 1, '°') : ''}
        ${isMover ? '' : `<label>Tamaño<select data-st="mini">${opt('false', 'Normal', String(!!it.mini))}${opt('true', 'Mini (2/3)', String(!!it.mini))}</select></label>`}
        <label>Cobertura negra<select data-st="hard">${opt('none', 'Ninguna', h?.preset || 'none')}${Object.entries(HARD_PRESETS).map(([k, p]) => opt(k, p.label, h?.preset || 'none')).join('')}</select></label>
        ${h ? range('hardAngle', 'Ángulo de la cobertura', Math.round(h.angle), -180, 180, 1, '°') + range('hardAmount', 'Cuánto tapa', Math.round(h.amount * 100), 5, 90, 1, '%') : ''}
        ${h ? '<label>&nbsp;<button class="btn small" data-st="flip">↔ Invertir cobertura</button></label>' : ''}
        ${isMover ? `<label class="switch ed-full"><input type="checkbox" data-st="fixedNS" ${it.fixedNS ? 'checked' : ''}> No‑shoot fijo delante del recorrido</label>` : ''}
        ${isMover && it.fixedNS ? range('nsDx', 'Posición del no‑shoot', Math.round(it.fixedNS.dx * 100), -60, 60, 1, ' cm') + range('nsFixAngle', 'Inclinación', it.fixedNS.angle, -45, 45, 1, '°') : ''}
      </div>`;
    host.classList.remove('hidden');
  }

  function onStyle(e) {
    const el = e.target.closest?.('[data-st]'); if (!el || !selItem || !preview) return;
    const key = el.dataset.st, it = selItem, isMover = it.type === 'mover';
    let st = cloneStyle(isMover ? moverStyle(it) : styleOf(it)), rerender = false;
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
      default: return;
    }
    if (isMover) it.tstyle = st; else { it.style = st; delete it.ns; delete it.hard; }
    const out = el.parentElement?.querySelector('output'); if (out) out.textContent = `${el.value}${out.dataset.unit}`;
    commitLayout();
    if (rerender) renderItemPanel();
  }
  // guarda la disposición tras un cambio manual (arrastre o estilo)
  function commitLayout() {
    const b = block(); if (!b || !preview) return;
    b.layout = layoutOf(preview);
    if (b.vary) { b.vary = false; const s = $('[data-k="vary"]'); if (s) s.value = 'false'; toast('Has ajustado el escenario a mano: se usará el mismo en todas las repeticiones'); }
    persist(); renderBlocks();
  }
  $('#edMain').addEventListener('input', (e) => { if (e.target.dataset?.st && e.target.type === 'range') onStyle(e); });
  $('#edMain').addEventListener('change', (e) => { if (e.target.dataset?.st && e.target.type !== 'range') onStyle(e); });
  $('#edMain').addEventListener('click', (e) => { const b = e.target.closest?.('button[data-st]'); if (b) onStyle(e); });

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
    renderer.render({ stage: preview, info: `${THEMES[preview.theme].name.toUpperCase()} · ${preview.items.filter((i) => ['paper', 'popper', 'plate', 'mover'].includes(i.type)).length} ELEMENTOS` }, now);
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
    debug: () => ({ prog, preview, selItem, renderer }),
  };
}
