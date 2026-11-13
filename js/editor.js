// Editor de entrenamientos: secuencias de ejercicios. Cada ejercicio es una serie de posiciones (1 o más),
// cada una con su escenario (diseñado a mano o aleatorio), desplazamiento de llegada, tiempo y muro con
// ventana; o un modo aleatorio global. Editor de escenarios libre: añadir, arrastrar, duplicar, eliminar y
// configurar cada elemento (tarjetas, poppers, placas, móviles, muros, bidones…).
import {
  composeStage, stageFromLayout, layoutOf, finalizeStage, PERSPECTIVE, makeStyle, randomKind, TARGET_KINDS, KIND_LABEL, HARD_PRESETS, kindWidth,
} from './course.js?v=20261113-1732';
import { StageRenderer, THEMES, ACT, styleOf, stackHeight } from './scene.js?v=20261113-1732';
import { openPdf, readPage } from './pdf-import.js?v=20261113-1732';
import { stageToExercise } from './pdf-stage.js?v=20261113-1732';
import * as store from './storage.js?v=20261113-1732';
import {
  newProgram, newExercise, migrateBlock, newCoursePosition, defaultComp, exampleProgram, defaultCond, condText, HAND_LABEL, START_LABEL, blockSummary, blockDuration, programDuration, fmtDuration,
  shareUrl, sanitizeProgram, MOVER_LABEL, DIST_LABEL, DIR_LABEL, DIR_ARROW, defaultPort,
} from './program.js?v=20261113-1732';

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
const ITEM_NAME = { paper: 'Tarjeta', popper: 'Popper', plate: 'Plato', wall: 'Muro', barrel: 'Bidón', tires: 'Neumáticos', cone: 'Cono', mover: 'Móvil' };
const WALL_STYLE_LABEL = { ply: 'Madera pintada', mesh: 'Malla oscura', banner: 'Con cartel' };
// colores del metal (poppers y platos): blanco por defecto
const STEEL_COLORS = { white: 'Blanco', blue: 'Azul', red: 'Rojo', yellow: 'Amarillo', green: 'Verde' };
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
    const b = block(); if (!b || b.random?.on) return null;
    return b.positions.find((p) => p.id === selPosId) || b.positions[0] || null;
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

  // ------------------------------------------------------------ importar ejercicios desde un PDF
  const pdfDlg = $('#pdfDlg');
  let pdfPages = [], pdfFile = '', pdfSel = new Set();
  const pdfCounts = (c) => [c.paper ? `${c.paper} tarjetas` : '', c.ns ? `${c.ns} NS` : '', c.popper ? `${c.popper} poppers` : '', c.plate ? `${c.plate} platos` : '', c.rounds ? `${c.rounds} disparos` : ''].filter(Boolean).join(' · ');
  const isStage = (pg) => !!(pg.info.stage || pg.info.counts.paper || pg.info.counts.rounds);
  function pdfRender() {
    $('#pdfBody').innerHTML = `<div class="pdf-pages">${pdfPages.map((pg, k) => `
      <button class="pdf-page ${pdfSel.has(k) ? 'on' : ''} ${isStage(pg) ? '' : 'dim'}" data-pg="${k}" aria-pressed="${pdfSel.has(k)}">
        <span class="pdf-check">${pdfSel.has(k) ? '✓' : ''}</span>
        <img src="${pg.thumb}" alt="">
        <b>${pg.info.stage ? `Stage ${esc(pg.info.stage)}` : `Página ${pg.n}`}</b>
        <small>${esc(pdfCounts(pg.info.counts) || (isStage(pg) ? '' : 'Sin datos de ejercicio'))}</small>
        ${pg.info.start ? `<em>${esc(pg.info.start.slice(0, 70))}</em>` : ''}
      </button>`).join('')}</div>`;
    const n = pdfSel.size;
    $('#pdfCount').textContent = n ? `${n} ${n === 1 ? 'ejercicio seleccionado' : 'ejercicios seleccionados'}` : 'Toca los ejercicios que quieres importar';
    $('#pdfGo').disabled = !n;
    $('#pdfGo').textContent = n ? `Crear entrenamiento con ${n} ${n === 1 ? 'ejercicio' : 'ejercicios'}` : 'Crear entrenamiento';
  }
  $('#edPdf').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    pdfFile = f.name; pdfPages = []; pdfSel = new Set();
    pdfDlg.classList.remove('hidden'); $('#pdfFoot').classList.add('hidden');
    $('#pdfTitle').textContent = 'Leyendo el PDF…'; $('#pdfSub').textContent = f.name;
    $('#pdfBody').innerHTML = '<div class="pdf-loading"><span class="spinner"></span> Abriendo el PDF…</div>';
    try {
      const doc = await openPdf(await f.arrayBuffer());
      for (let n = 1; n <= doc.numPages; n++) {
        $('#pdfBody').innerHTML = `<div class="pdf-loading"><span class="spinner"></span> Leyendo el ejercicio ${n} de ${doc.numPages}…</div>`;
        const pg = await readPage(doc, n);
        pg.thumb = pg.canvas.toDataURL('image/jpeg', 0.55);
        pdfPages.push(pg);
      }
      $('#pdfTitle').textContent = 'Elige los ejercicios';
      $('#pdfSub').textContent = `${f.name} · se creará un entrenamiento con los que elijas, con sus posiciones y escenarios`;
      $('#pdfFoot').classList.remove('hidden');
      pdfRender();
    } catch (err) {
      console.error(err);
      $('#pdfBody').innerHTML = `<p class="ed-warn">No se ha podido leer el PDF: ${esc(err.message || err)}</p>`;
    }
  };
  $('#pdfClose').onclick = () => pdfDlg.classList.add('hidden');
  $('#pdfBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pg]'); if (!b) return;
    const k = +b.dataset.pg; if (pdfSel.has(k)) pdfSel.delete(k); else pdfSel.add(k);
    pdfRender();
  });
  $('#pdfAll').onclick = () => { const all = pdfPages.map((pg, k) => (isStage(pg) ? k : -1)).filter((k) => k >= 0); pdfSel = pdfSel.size === all.length ? new Set() : new Set(all); pdfRender(); };
  $('#pdfGo').onclick = async () => {
    const ks = [...pdfSel].sort((a, b) => a - b); if (!ks.length) return;
    $('#pdfFoot').classList.add('hidden');
    const blocks = [];
    for (const k of ks) {
      $('#pdfBody').innerHTML = `<div class="pdf-loading"><span class="spinner"></span> Montando ${pdfPages[k].info.stage ? `el stage ${esc(pdfPages[k].info.stage)}` : `la página ${pdfPages[k].n}`}…</div>`;
      await new Promise((r) => setTimeout(r, 20));
      try { blocks.push(stageToExercise(pdfPages[k], { file: pdfFile })); } catch (err) { console.error(err); }
    }
    const ev = pdfPages[ks[0]].info.event;
    const p = newProgram((ev || pdfFile.replace(/\.pdf$/i, '')).slice(0, 70));
    p.notes = `Importado de «${pdfFile}». Las posiciones se han creado a partir del dibujo de cada ejercicio.`.slice(0, 500);
    p.blocks = blocks;
    ensureLayouts(p);
    store.saveProgram(p);
    pdfDlg.classList.add('hidden');
    open(p.id);
    selBlockId = p.blocks[0]?.id || null; renderBlocks(); renderBlock();
    toast(`Entrenamiento creado con ${blocks.length} ${blocks.length === 1 ? 'ejercicio' : 'ejercicios'} desde el PDF`, 4000);
  };

  // completa composiciones antiguas y genera las disposiciones que falten
  function ensureLayouts(p) {
    const defComp = defaultComp();
    const fix = (s) => { s.comp = { ...defComp, ...s.comp }; if (!s.layout) s.layout = layoutOf(composeStage(s.comp, Date.now() + Math.floor(Math.random() * 1e6))); };
    p.blocks = p.blocks.map(migrateBlock); // tipos antiguos → ejercicio único
    for (const b of p.blocks) {
      if (!b.positions.length) b.positions.push(newCoursePosition('none'));
      b.positions.forEach((pos, i) => { fix(pos); if (i > 0 && pos.dir === 'none') pos.dir = 'right'; });
    }
  }

  function open(id) {
    flush();
    curId = id; prog = cur() ? clone(cur()) : null;
    if (prog) { ensureLayouts(prog); store.saveProgram(prog); }
    selBlockId = null; selPosId = null; // se elige en la columna izquierda
    renderList(); renderMain();
  }

  // ------------------------------------------------------------ entrenamiento abierto
  let insTab = 'elem'; // pestaña activa del inspector del escenario
  // secciones plegables del ejercicio (se recuerda cuáles has cerrado)
  let secClosed = {};
  try { secClosed = JSON.parse(localStorage.getItem('ipsctrack.edClosed') || '{}') || {}; } catch { secClosed = {}; }
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const CAM_NOTE = '«Al desplazarte» usa la cámara para detectar tu movimiento. «Automático» no necesita cámara: el escenario cambia solo a los segundos indicados.';
  function sec(key, n, title, sub, body) {
    return `<details class="ed-sec" data-sec="${key}" ${secClosed[key] ? '' : 'open'}>
      <summary><span class="ed-sec-n">${n}</span><span class="ed-sec-t"><b>${title}</b><small>${sub}</small></span><span class="ed-sec-caret" aria-hidden="true"><svg viewBox="0 0 12 12" width="13" height="13"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></span></summary>
      <div class="ed-sec-body">${body}</div></details>`;
  }
  // selector compacto de opciones: [valor, etiqueta, descripción]; debajo se explica la elegida
  function seg(k, curV, opts) {
    const on = opts.find(([v]) => String(v) === String(curV)) || opts[0];
    return `<div class="ed-seg-wrap"><div class="ed-seg" role="radiogroup">${opts.map(([v, label]) => `<label class="${String(v) === String(on[0]) ? 'on' : ''}">
        <input type="radio" name="sg-${k}" data-k="${k}" value="${v}" ${String(v) === String(on[0]) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
      <p class="ed-seg-desc">${on[2]}</p></div>`;
  }
  $('#edMain').addEventListener('toggle', (e) => {
    const d = e.target; if (!d.matches?.('details.ed-sec')) return;
    secClosed[d.dataset.sec] = !d.open;
    try { localStorage.setItem('ipsctrack.edClosed', JSON.stringify(secClosed)); } catch { /* sin almacenamiento */ }
    if (d.open && d.contains(canvas)) renderer.checkSize(true);
  }, true);

  function renderMain() {
    const main = $('#edMain');
    park.appendChild(canvas);
    if (!prog) {
      main.innerHTML = `<div class="ed-empty"><div class="ed-empty-icon">◎</div><h2>Editor de entrenamientos</h2>
        <p class="muted">Crea secuencias de ejercicios a tu gusto: una o varias posiciones encadenadas con desplazamientos, escenarios diseñados por ti o aleatorios, muros con ventana, tiempos y repeticiones. Después entrénalos en «En seco» o compártelos con tu equipo.</p>
        <button class="btn primary" id="edNew2">＋ Crear entrenamiento</button></div>`;
      $('#edNew2').onclick = () => $('#edNew').click();
      $('#edExSide').classList.add('hidden');
      return;
    }
    main.innerHTML = `
      <header class="ed-top">
        <div class="ed-title">
          <input class="ed-name" id="edName" value="${esc(prog.name)}" maxlength="80" aria-label="Nombre del entrenamiento" placeholder="Nombre del entrenamiento">
          <div class="ed-meta" id="edChips"></div>
        </div>
        <div class="ed-actions">
          <button class="btn" id="edShare">🔗 Compartir</button>
          <details class="ed-dd">
            <summary class="btn ed-icon-btn" title="Más acciones" aria-label="Más acciones">⋯</summary>
            <div class="ed-menu">
              <button id="edExport">⬇ Exportar archivo</button>
              <button id="edDup">⧉ Duplicar entrenamiento</button>
              <hr>
              <button id="edDel" class="danger">🗑 Borrar entrenamiento</button>
            </div>
          </details>
        </div>
      </header>
      <textarea id="edNotes" class="ed-notes" rows="1" placeholder="Notas: objetivo, material, indicaciones para el equipo…" maxlength="500">${esc(prog.notes || '')}</textarea>
      <section id="edBlock"></section>`;
    $('#edName').oninput = (e) => { prog.name = e.target.value || 'Sin nombre'; persist(); };
    $('#edNotes').oninput = (e) => { prog.notes = e.target.value; persist(false); };
    $('#edShare').onclick = share;
    $('#edExport').onclick = () => { closeMenus(); exportProgram(); };
    $('#edDup').onclick = () => { closeMenus(); const p = clone(prog); p.id = store.uid(); p.name = `${prog.name} (copia)`; p.blocks.forEach((b) => (b.id = store.uid())); store.saveProgram(p); open(p.id); toast('Duplicado'); };
    $('#edDel').onclick = () => {
      closeMenus();
      if (!confirm(`¿Borrar el entrenamiento «${prog.name}»?`)) return;
      clearTimeout(saveT); saveT = null; // un guardado pendiente no debe resucitar el entrenamiento borrado
      store.deleteProgram(prog.id); curId = null; prog = null; renderList(); renderMain(); toast('Entrenamiento borrado');
    };
    renderBlocks(); renderBlock();
  }
  const closeMenus = () => document.querySelectorAll('#edMain details.ed-dd[open]').forEach((d) => d.removeAttribute('open'));
  document.addEventListener('click', (e) => { if (!e.target.closest('details.ed-dd')) closeMenus(); });

  function addBlock(b) {
    ensureLayouts({ blocks: [b] });
    b.name = `Ejercicio ${prog.blocks.length + 1}`;
    prog.blocks.push(b); selBlockId = b.id; selPosId = null; insTab = 'elem'; persist(); renderBlocks(); renderBlock();
    toast(`«${b.name}» creado: configúralo abajo`);
    if (window.innerWidth <= 1000) $('#edBlock').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('#edAddEx').onclick = () => { if (prog) addBlock(newExercise()); };

  // lista de ejercicios (columna izquierda): cambiar, ordenar, duplicar o eliminar
  function renderBlocks() {
    const n = prog.blocks.length;
    $('#edChips').innerHTML = `<span>${n} ${n === 1 ? 'ejercicio' : 'ejercicios'}</span><span>≈ ${fmtDuration(programDuration(prog))}</span>`;
    $('#edExSide').classList.remove('hidden');
    $('#edExSideSub').textContent = `de «${prog.name}» · toca uno para editarlo`;
    $('#edBlocks').innerHTML = prog.blocks.map((x, i) => `<li class="ed-bl ${x.id === selBlockId ? 'active' : ''}" data-id="${x.id}">
        <span class="ed-num">${i + 1}</span>
        <div class="ed-bl-txt"><b>${esc(x.name)}</b><small>${esc(blockSummary(x))}</small></div>
        <span class="ed-bl-dur">${fmtDuration(blockDuration(x, i === n - 1))}</span>
        <div class="ed-bl-act">
          <button class="ed-ic" data-act="up" title="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="ed-ic" data-act="down" title="Bajar" ${i === n - 1 ? 'disabled' : ''}>↓</button>
          <button class="ed-ic" data-act="dup" title="Duplicar">⧉</button>
          <button class="ed-ic danger" data-act="del" title="Eliminar" ${n <= 1 ? 'disabled' : ''}>✕</button>
        </div>
      </li>`).join('') || '<li class="ed-bl-empty">Todavía no hay ejercicios.</li>';
  }

  // ------------------------------------------------------------ formularios
  const opt = (v, label, curV) => `<option value="${v}" ${String(v) === String(curV) ? 'selected' : ''}>${label}</option>`;
  const numField = (k, label, v, min, max, step = 1, suffix = '') => `<label>${label}<span class="ed-num-in"><input type="number" data-k="${k}" value="${v}" min="${min}" max="${max}" step="${step}">${suffix ? `<em>${suffix}</em>` : ''}</span></label>`;
  const range = (key, label, v, min, max, step, unit) =>
    `<label>${label}<span class="ed-range"><input type="range" data-st="${key}" min="${min}" max="${max}" step="${step}" value="${v}"><output data-unit="${unit}">${v}${unit}</output></span></label>`;
  const group = (title, body, note = '') => `<div class="ed-group"><div class="ed-group-t">${title}</div>${body}${note ? `<p class="ed-note">${note}</p>` : ''}</div>`;

  // composición automática (punto de partida; luego se puede editar a mano)
  function compHTML(s) {
    const c = s.comp;
    return `<p class="ed-note">Genera el escenario con estas cantidades al pulsar «🎲 Generar» (o al cambiar un valor). Después puedes ajustarlo a mano.</p>
      ${group('Tarjetas', `<div class="ed-grid">
        ${numField('comp.paper', 'Nº de tarjetas', c.paper, 0, 8)}
        <label class="switch ed-full"><input type="checkbox" data-k="comp.styleRandom" ${c.styleRandom ? 'checked' : ''}> Estilos aleatorios</label>
        <span class="${c.styleRandom ? 'hidden' : ''}">
          ${numField('comp.ns', 'No‑shoot lateral', c.ns, 0, c.paper)}
          ${numField('comp.nsTilt', 'No‑shoot inclinado', c.nsTilt, 0, c.paper)}
          ${numField('comp.double', 'Nº de tarjetas dobles', c.double, 0, c.paper)}
          ${numField('comp.doubleNs', 'Nº de tarjetas dobles con NS', c.doubleNs, 0, c.paper)}
          ${numField('comp.hard', 'Nº de tarjetas con cobertura', c.hard, 0, c.paper)}
          <label>Tipo de cobertura (hard cover)<select data-k="comp.hardPreset">${opt('random', 'Aleatoria', c.hardPreset)}${Object.entries(HARD_PRESETS).map(([k, p]) => opt(k, p.label, c.hardPreset)).join('')}</select></label>
        </span></div>`)}
      ${group('Metal', `<div class="ed-grid">
        ${numField('comp.poppers', 'Nº de poppers', c.poppers, 0, 6)}
        <label>Tamaño<select data-k="comp.popSize">${opt('full', 'Normal (85 cm)', c.popSize)}${opt('mini', 'Mini (56 cm)', c.popSize)}${opt('mixed', 'Mezclados', c.popSize)}</select></label>
        ${numField('comp.plates', 'Nº de platos', c.plates, 0, 6)}</div>`)}
      ${group('Móvil', `<div class="ed-grid">
        <label class="ed-full">Tipo<select data-k="comp.mover">${Object.entries(MOVER_LABEL).map(([k, l]) => opt(k, l, c.mover)).join('')}</select></label>
        <span class="${c.mover === 'none' ? 'hidden' : ''}">
          <label>Tarjeta<select data-k="comp.moverStyle">${opt('random', 'Aleatoria', c.moverStyle)}${TARGET_KINDS.map((k) => opt(k, KIND_LABEL[k], c.moverStyle)).join('')}</select></label>
          <label>Cobertura<select data-k="comp.moverHard">${opt('none', 'Ninguna', c.moverHard)}${opt('random', 'Aleatoria', c.moverHard)}${Object.entries(HARD_PRESETS).map(([k, p]) => opt(k, p.label, c.moverHard)).join('')}</select></label>
          <label class="ed-full">No‑shoot fijo delante<select data-k="comp.moverNS">${opt('none', 'No', c.moverNS)}${opt('yes', 'Sí', c.moverNS)}${opt('random', 'Aleatorio', c.moverNS)}</select></label>
        </span></div>`)}
      ${group('Distribución', `<div class="ed-grid"><label class="ed-full">Distancias<select data-k="comp.dist">${Object.entries(DIST_LABEL).map(([k, l]) => opt(k, l, c.dist)).join('')}</select></label></div>`)}`;
  }

  // muro con ventana baja al principio del escenario (hay que agacharse)
  function portHTML(s) {
    const pt = s.port?.on ? s.port : null, d = s.port || defaultPort();
    return `<label class="switch ed-switch-card"><input type="checkbox" data-k="port.on" ${pt ? 'checked' : ''}>
        <span><b>Añadir un muro con ventana baja</b><small>El escenario solo se ve por la ventana al agacharte.</small></span></label>
      ${pt ? group('Ventana', `<div class="ed-grid">
        ${numField('port.w', 'Ancho', Math.round(d.w * 100), 15, 95, 1, '%')}
        ${numField('port.h', 'Alto', Math.round(d.h * 100), 8, 70, 1, '%')}
        ${numField('port.x', 'Posición', Math.round(d.x * 100), -45, 45, 1, '%')}
        <label>Acabado<select data-k="port.style">${opt('ply', 'Madera pintada', d.style)}${opt('wood', 'Madera', d.style)}${opt('dark', 'Oscuro', d.style)}</select></label></div>`)
        + group('Apertura', `<div class="ed-grid">
        <label class="ed-full">Se abre<select data-k="port.open">${opt('camera', 'Al agacharte (cámara; ↓ sin cámara)', d.open)}${opt('auto', 'Automático (sin cámara)', d.open)}</select></label>
        ${numField('port.at', d.open === 'auto' ? 'A los' : 'Sin cámara, a los', d.at, 0.2, 60, 0.1, 's')}</div>`, '«Al agacharte» usa la cámara para detectar que te agachas (sin cámara: flecha ↓ del teclado). «Automático» no necesita cámara. El tiempo del escenario empieza a contar cuando se ve por la ventana.') : ''}`;
  }

  // zona de trabajo: escenario (izquierda) + inspector con pestañas (derecha)
  function workHTML(s) {
    const theme = s.layout?.theme ?? 0;
    const tabs = [['elem', 'Elemento'], ['comp', 'Composición'], ['port', 'Muro con ventana']];
    return `<div class="ed-work">
      <div class="ed-canvas-col">
        <div class="ed-toolbar">
          <label class="ed-inline">Ambiente <select id="edTheme">${THEMES.map((t, i) => opt(i, t.name, theme)).join('')}</select></label>
          <span class="ed-tb-sep"></span>
          <button class="btn small" id="edRegen" title="Generar con la composición automática">🎲 Generar</button>
          <button class="btn small" id="edClear" title="Quitar todos los elementos">Vaciar</button>
          <button class="btn small" id="edAct" title="Ver la onda, la caída del popper y el móvil">▶ Activación</button>
        </div>
        <canvas id="edCanvasHost"></canvas>
        <div class="ed-palette">
          <div class="ed-pal-group"><span>Blancos</span>
            <button data-add="paper">Tarjeta</button><button data-add="popper">Popper</button><button data-add="popper-mini">Mini popper</button>
            <button data-add="plate">Plato</button><button data-add="mover">Móvil</button></div>
          <div class="ed-pal-group"><span>Atrezo</span>
            <button data-add="wall">Muro</button><button data-add="barricade">Barricada</button><button data-add="barrel">Bidón</button>
            <button data-add="tires">Neumáticos</button><button data-add="cone">Cono</button></div>
        </div>
        <p class="ed-note">Arrastra los elementos: lateral para moverlos de lado, vertical para alejarlos o acercarlos. Tócalos para editarlos · Supr elimina.</p>
        <p class="ed-warn hidden" id="edWarn"></p>
      </div>
      <aside class="ed-inspector"><div class="ed-ins-in">
        <div class="ed-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-ins="${k}" class="${insTab === k ? 'active' : ''}">${l}${k === 'port' && s.port?.on ? ' •' : ''}</button>`).join('')}</div>
        <div class="ed-pane ${insTab === 'elem' ? 'active' : ''}" data-pane="elem"><div class="ed-item" id="edItem"></div></div>
        <div class="ed-pane ${insTab === 'comp' ? 'active' : ''}" data-pane="comp">${compHTML(s)}</div>
        <div class="ed-pane ${insTab === 'port' ? 'active' : ''}" data-pane="port">${portHTML(s)}</div>
      </div></aside>
    </div>`;
  }
  function setTab(t) {
    insTab = t;
    document.querySelectorAll('#edBlock [data-ins]').forEach((b) => b.classList.toggle('active', b.dataset.ins === t));
    document.querySelectorAll('#edBlock [data-pane]').forEach((p) => p.classList.toggle('active', p.dataset.pane === t));
  }

  // rehacer el panel sin mover la página: se conserva el desplazamiento de la ventana y del inspector
  function renderBlock() {
    const y = window.scrollY, paneY = document.querySelector('#edBlock .ed-pane.active')?.scrollTop || 0;
    renderBlockInner();
    const pane = document.querySelector('#edBlock .ed-pane.active'); if (pane) pane.scrollTop = paneY;
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  }
  function renderBlockInner() {
    const host = $('#edBlock'), b = block();
    park.appendChild(canvas); // el canvas se reutiliza: se aparca antes de rehacer el formulario
    if (!host) return;
    if (!b) {
      preview = null;
      host.innerHTML = `<div class="ed-pick">
        <div class="ed-pick-icon">◎</div>
        <h3>Selecciona un ejercicio o crea uno nuevo</h3>
        <p class="muted">${window.innerWidth <= 1000 ? 'Arriba' : 'En la columna de la izquierda'} tienes tus ejercicios: toca uno para editarlo o usa «＋ Crear nuevo ejercicio».</p>
      </div>`;
      return;
    }
    const R = b.random, rnd = !!R?.on;
    const bi = prog.blocks.indexOf(b), nPos = b.positions.length;
    const head = `<div class="ed-panel-head">
      <div class="ed-panel-title"><small>Editando el ejercicio ${bi + 1} de ${prog.blocks.length}</small>
        <input class="ed-bname" data-k="name" value="${esc(b.name)}" maxlength="60" aria-label="Nombre del ejercicio" title="Toca para cambiar el nombre"></div>
      <button class="btn primary" id="edTry">▶ Probar ejercicio</button>
    </div>`;
    const desc = (t) => `<p class="ed-sec-desc">${t}</p>`;
    // ajustes de un desplazamiento: el que lleva a la posición idx
    const moveFields = (idx) => {
      const m = b.positions[idx];
      return `<div class="ed-grid">
        <label>Dirección<select data-k="mv.${idx}.dir">${['left', 'right', 'random'].map((d) => opt(d, DIR_LABEL[d], m.dir)).join('')}</select></label>
        <label>Cambio de escenario<select data-k="mv.${idx}.advance">${opt('camera', 'Al desplazarte (usa la cámara)', m.advance || 'camera')}${opt('auto', 'Automático (sin cámara)', m.advance)}</select></label>
        ${m.advance === 'auto' ? numField(`mv.${idx}.moveDelay`, 'Cambia tras la flecha a los', m.moveDelay ?? 1, 0.2, 30, 0.1, 's') : ''}</div>
        <p class="ed-note">${CAM_NOTE}</p>`;
    };
    // ficha del PDF del que se importó el ejercicio (referencia)
    const S = b.sheet;
    // lo que hay realmente en el ejercicio, para compararlo con la ficha
    const rec = { paper: 0, ns: 0, popper: 0, plate: 0 };
    if (S) for (const q of b.positions) for (const it of q.layout?.items || []) {
      if (it.type === 'paper' || it.type === 'mover') {
        const kind = (it.type === 'mover' ? it.tstyle?.kind : it.style?.kind) || 'normal';
        rec.paper += kind.startsWith('double') ? 2 : 1;
        if (/ns/.test(kind) || it.fixedNS) rec.ns++;
      } else if (it.type === 'popper') rec.popper++;
      else if (it.type === 'plate') rec.plate++;
    }
    const W = S?.want, want = W ? { paper: W.paper + W.mover, ns: W.ns, popper: W.popper, plate: W.plate } : null;
    const recRow = want ? [['paper', 'tarjeta', 'tarjetas'], ['ns', 'no‑shoot', 'no‑shoots'], ['popper', 'popper', 'poppers'], ['plate', 'plato', 'platos']]
      .map(([k, one, many]) => `<span class="${rec[k] === want[k] ? 'ok' : 'bad'}">${rec[k]}${rec[k] === want[k] ? '' : ` de ${want[k]}`} ${(rec[k] === want[k] ? rec[k] : want[k]) === 1 ? one : many}</span>`).join('') : '';
    const recOk = want && Object.keys(want).every((k) => rec[k] === want[k]);
    const secSheet = S ? sec('sheet', '📄', 'Ficha del PDF', `${S.stage ? `Stage ${esc(S.stage)} · ` : ''}${esc(S.summary || '')}${S.counts?.rounds ? ` · ${S.counts.rounds} disparos` : ''}${S.counts?.points ? ` · ${S.counts.points} puntos` : ''}`,
      `<div class="pdf-sheet">
        ${S.img ? `<a class="pdf-sheet-img" href="${S.img}" target="_blank" rel="noopener" title="Ver el dibujo en grande"><img src="${S.img}" alt="Dibujo del ejercicio en el PDF"></a>` : ''}
        <dl>
          ${S.event ? `<dt>Competición</dt><dd>${esc(S.event)}</dd>` : ''}
          <dt>Posición de salida</dt><dd>${esc(S.start || '—')}</dd>
          <dt>Procedimiento</dt><dd>${esc(S.procedure || '—')}</dd>
          <dt>Condición del arma</dt><dd>${esc(S.condition || '—')}</dd>
          <dt>Blancos</dt><dd>${esc(S.summary || '—')}</dd>
          ${S.counts?.rounds ? `<dt>Disparos mínimos</dt><dd>${S.counts.rounds}</dd>` : ''}
          ${S.counts?.points ? `<dt>Puntuación máxima</dt><dd>${S.counts.points} puntos</dd>` : ''}
          <dt>Origen</dt><dd>${esc(S.file || 'PDF')}${S.page ? ` · página ${S.page}` : ''}</dd>
          ${want ? `<dt>En el ejercicio</dt><dd class="pdf-rec">${recRow}<b class="${recOk ? 'ok' : 'bad'}">${recOk ? '✓ Igual que la ficha' : '⚠ No coincide con la ficha'}</b></dd>` : ''}
        </dl>
      </div>
      <p class="ed-note">Las posiciones se han creado a partir del dibujo: cada una muestra los blancos que se verían desde allí. Ajústalas a tu gusto en las secciones 5 y 6.</p>`) : '';
    const sec1 = sec('type', 1, 'Tipo de ejercicio',
      rnd ? `Aleatorio · ${R.count ? pl(R.count, 'escenario', 'escenarios') : 'escenarios sin fin'}` : `Diseñado por ti · ${pl(nPos, 'escenario', 'escenarios')}`,
      seg('mode', rnd ? 'random' : 'design', [
        ['design', '✎ Diseñado por ti', 'Tú eliges cada escenario, cada desplazamiento y su tiempo.'],
        ['random', '🎲 Aleatorio', 'Escenarios y desplazamientos al azar, distintos en cada repetición. Solo eliges cuántos y su ritmo.']]));
    const p0 = b.positions[0];
    const sec2 = sec('start', 2, 'Inicio parado o con desplazamiento',
      `${b.startMove ? `Con desplazamiento${!rnd && p0 ? ` ${DIR_ARROW[p0.dir]}` : ''}` : 'Parado'} · beep ${b.startMode === 'random' ? 'aleatorio' : 'fijo'}`,
      seg('startMove', String(!!b.startMove), [
        ['false', 'Parado', 'A la señal, resuelve el escenario.'],
        ['true', '→ Con desplazamiento', 'A la señal, desplázate en la dirección de la flecha para ver el escenario.']])
      + (b.startMove ? (rnd ? '<p class="ed-note">En el modo aleatorio la dirección del primer desplazamiento también es al azar.</p>'
        : `<div class="ed-sub"><div class="ed-group-t">Primer desplazamiento</div>${moveFields(0)}</div>`) : '')
      + `<div class="ed-grid"><label class="ed-full">Beep de salida (tras la cuenta atrás)<select data-k="startMode">${opt('fixed', 'Fijo', b.startMode)}${opt('random', 'Aleatorio (entre 1,5 y 2,8 s después)', b.startMode)}</select></label></div>`);
    const C = { ...defaultCond(), ...(b.cond || {}) };
    const secC = sec('cond', 3, 'Condiciones',
      condText(C) || 'Dos manos, desde la funda · sin condiciones especiales',
      desc('Condiciones de salida y de tiro para todas las repeticiones de este ejercicio. Se muestran en pantalla durante el entrenamiento.') +
      `<div class="ed-grid">
        <label>Mano<select data-k="cond.hand">${Object.entries(HAND_LABEL).map(([k, l]) => opt(k, l, C.hand)).join('')}</select></label>
        <label class="ed-full">Posición de salida<select data-k="cond.start">${Object.entries(START_LABEL).map(([k, l]) => opt(k, l, C.start)).join('')}</select></label>
      </div>
      <label class="switch"><input type="checkbox" data-k="cond.reload" ${C.reload ? 'checked' : ''}> Cambio de cargador obligatorio</label>
      <div class="ed-grid"><label class="ed-full">Otra condición (opcional)<input type="text" data-k="cond.note" value="${esc(C.note)}" maxlength="60" placeholder="Ej.: solo un impacto por tarjeta"></label></div>`);
    const sec3 = sec('reps', 4, 'Repeticiones y descansos',
      `${b.reps}× · descanso ${b.rest} s${b.maxTime ? ` · límite total ${String(b.maxTime).replace('.', ',')} s` : ''}`,
      desc('Cuántas veces repites el ejercicio, los descansos entre repeticiones y antes del siguiente ejercicio y, si quieres, un tiempo límite total.') +
      `<div class="ed-grid ed-grid-4">
        ${numField('reps', 'Repeticiones', b.reps, 1, 100)}
        ${numField('rest', 'Descanso entre repeticiones', b.rest, 0, 600, 1, 's')}
        ${numField('restAfter', 'Descanso antes del siguiente ejercicio', b.restAfter, 0, 600, 1, 's')}
      </div>
      <div class="ed-sub">
        <label class="switch"><input type="checkbox" data-k="limitOn" ${b.maxTime ? 'checked' : ''}> Límite de tiempo total por repetición (opcional)</label>
        ${b.maxTime ? `<div class="ed-grid">${numField('maxTime', 'Tiempo total máximo', b.maxTime, 0.5, 600, 0.5, 's')}</div>` : ''}
        <p class="ed-note">${b.maxTime ? 'Cuenta desde la señal. Al llegar a ese tiempo suena el beep final y la repetición termina aunque queden escenarios.' : 'Desactivado: cada repetición dura lo que sumen los tiempos de sus escenarios (sección 5).'}</p>
      </div>`);
    if (rnd) {
      preview = null;
      const sec4 = sec('random', 5, 'Desplazamientos / Escenarios aleatorios',
        `${R.count ? pl(R.count, 'escenario', 'escenarios') : 'Sin fin'} · ${String(R.time).replace('.', ',')} s en cada uno · cambio ${R.advance === 'auto' ? 'automático (sin cámara)' : 'al desplazarte (cámara)'}`,
        desc('Cuántos escenarios aleatorios salen, cuánto tiempo tienes en cada uno y cómo se cambia de uno a otro.') +
        `<div class="ed-sec-cols">
          ${group('Escenarios', `<div class="ed-grid">
            ${numField('random.count', 'Cuántos (0 = sin fin)', R.count, 0, 200)}
            ${numField('random.time', 'Tiempo para resolver cada uno', R.time, 0.3, 60, 0.1, 's')}
            <label class="ed-full">Poppers que activan móviles<select data-k="random.activators">${opt('never', 'Nunca', R.activators)}${opt('sometimes', 'A veces', R.activators)}${opt('always', 'Siempre', R.activators)}</select></label></div>`,
            'Pasado ese tiempo sale la flecha hacia un lado al azar.')}
          ${group('Cambio de escenario', `<div class="ed-grid">
            <label class="ed-full">Cuándo cambia<select data-k="random.advance">${opt('camera', 'Al desplazarte (usa la cámara)', R.advance)}${opt('auto', 'Automático (sin cámara)', R.advance)}</select></label>
            ${R.advance === 'auto' ? numField('random.moveDelay', 'Cambia tras la flecha a los', R.moveDelay ?? 1, 0.2, 30, 0.1, 's') : ''}</div>`, CAM_NOTE)}
          ${group('Muros con ventana', `<label class="switch"><input type="checkbox" data-k="random.walls" ${R.walls ? 'checked' : ''}> Incluir muros con ventana (agacharse)</label>
            ${R.walls && R.advance === 'auto' ? `<div class="ed-grid">${numField('random.portDelay', 'La ventana se abre sola a los (0 = nada más aparecer)', R.portDelay ?? 0, 0, 30, 0.1, 's')}</div>` : ''}`,
            R.advance === 'auto' ? 'En automático la ventana se abre sola: no hace falta agacharse delante de la cámara.' : 'Algunos escenarios empiezan tras un muro: agáchate para verlos por la ventana.')}
        </div>`);
      host.innerHTML = `<div class="ed-panel">${head}<div class="ed-secs">${secSheet}${sec1}${sec2}${secC}${sec3}${sec4}</div></div>`;
      $('#edTry').onclick = () => tryBlock(b);
      return;
    }
    // ---- escenarios diseñados ----
    if (!b.positions.some((p) => p.id === selPosId)) selPosId = b.positions[0]?.id;
    const pi = b.positions.findIndex((p) => p.id === selPosId), pos = b.positions[pi];
    const n = nPos;
    const startChip = b.startMove ? `<span class="ed-step start" title="Galería vacía con la señal"><b>▶</b><small>salida</small></span>` : '';
    const posSettings = `<div class="ed-pos-box">
      <div class="ed-pos-tools">
        <b class="ed-pos-title">Ajustes de la posición ${pi + 1} <small>de ${n}</small></b>
        <div class="row">
          <button class="btn small" data-pos="left" ${pi <= 0 ? 'disabled' : ''}>◀ Antes</button>
          <button class="btn small" data-pos="right" ${pi >= n - 1 ? 'disabled' : ''}>Después ▶</button>
          <button class="btn small" data-pos="dup">⧉ Duplicar</button>
          <button class="btn small danger" data-pos="del" ${n <= 1 ? 'disabled' : ''}>✕ Eliminar</button>
        </div>
      </div>
      <div class="ed-sec-cols">
      ${pi < n - 1 && b.positions[pi + 1].advance !== 'auto'
        ? group('Flecha del siguiente desplazamiento', `<div class="ed-grid">
          ${numField('pos.arrowAt', 'La flecha sale a los', pos.arrowAt ?? 1, 0.3, 10, 0.1, 's')}
          ${numField('activatorAt', 'El popper activador cae a', pos.activatorAt, 0.5, 10, 0.1, 's')}</div>`,
          'Sin límite de tiempo: resuelve el escenario a tu ritmo; la flecha ya te indica hacia dónde ir y el escenario cambia cuando te desplazas. El popper activador es el que pone en marcha el móvil (si hay).')
        : group(pi < n - 1 ? 'Tiempo para resolver este escenario (automático)' : 'Tiempo para resolver el último escenario', `<div class="ed-grid">
          ${numField('pos.time', 'Segundos', pos.time, 0.5, 60, 0.1, 's')}
          ${numField('activatorAt', 'El popper activador cae a', pos.activatorAt, 0.5, 10, 0.1, 's')}</div>`,
          pi < n - 1 ? 'El siguiente cambio es automático (sin cámara): al acabar este tiempo sale la flecha y el escenario cambia solo.' : 'Cuenta desde que ves el escenario. Al acabar suena el beep final.')}
      ${pi < n - 1 ? group(`Siguiente desplazamiento → P${pi + 2}`, moveFields(pi + 1))
        : group('Siguiente desplazamiento', '<p class="ed-note">Es el último escenario: al acabar su tiempo suena el beep final. Pulsa «＋ Desplazamiento» para añadir otro.</p>')}
      </div></div>`;
    const sec4 = sec('course', 5, 'Desplazamientos / Escenarios',
      `${b.startMove ? '▶ ' : ''}${b.positions.map((p, i) => `${i || b.startMove ? `${DIR_ARROW[p.dir]} ` : ''}P${i + 1}${p.randomScene ? '🎲' : ''}`).join(' ')}`,
      desc('Añade desplazamientos para cambiar de escenarios. Toca una posición (P1, P2…) para ajustarla y diseñar su escenario (sección 6).') +
      `<div class="ed-steps" id="edPosBar">
          ${startChip}
          ${b.positions.map((p, i) => `${i || b.startMove ? `<span class="ed-step-link ${p.dir}" title="${DIR_LABEL[p.dir]}">${DIR_ARROW[p.dir]}</span>` : ''}
            <span class="ed-step-wrap"><button class="ed-step ${p.id === selPosId ? 'active' : ''}" data-pos-id="${p.id}"><b>P${i + 1}</b><small>${b.positions[i + 1] && b.positions[i + 1].advance !== 'auto' ? `flecha ${String(p.arrowAt ?? 1).replace('.', ',')} s` : `${(+p.time).toLocaleString('es-ES')} s`}${p.port?.on ? ' · muro' : ''}${(i || b.startMove) && p.advance === 'auto' ? ' · auto' : ''}</small></button>
            <button class="ed-step-rnd ${p.randomScene ? 'on' : ''}" data-pos-rnd="${p.id}" title="${p.randomScene ? 'Escenario aleatorio en cada repetición (activado)' : 'Hacer que el escenario sea aleatorio en cada repetición'}" aria-pressed="${!!p.randomScene}">🎲</button>${n > 1 ? `<button class="ed-step-del" data-pos-del="${p.id}" title="Eliminar posición ${i + 1}" aria-label="Eliminar posición ${i + 1}">✕</button>` : ''}</span>`).join('')}
          <button class="ed-step add" data-pos="add" title="Añade un desplazamiento y un escenario nuevo">＋ Desplazamiento</button>
        </div>
        <p class="ed-note" id="edCourseInfo">${courseInfo(b)}</p>
        <p class="ed-note">🎲 en una posición = escenario aleatorio en cada repetición (generado con su «Composición» de la sección 6). ✕ la elimina.</p>
        ${posSettings}`);
    const sec5 = sec('scene', 6, `Escenario de la posición ${pi + 1}`,
      `${pos.randomScene ? '🎲 Aleatorio en cada repetición' : pos.layout?.manual ? 'Diseñado a mano' : 'Generado automáticamente'}${pos.port?.on ? ' · con muro y ventana' : ''}`,
      (pos.randomScene ? `<p class="ed-sec-desc ed-sec-desc-pad">🎲 Este escenario es aleatorio: en cada repetición se genera uno nuevo con las cantidades de «Composición». Lo que ves es solo un ejemplo.</p>` : '') + workHTML(pos));
    host.innerHTML = `<div class="ed-panel">${head}<div class="ed-secs">${secSheet}${sec1}${sec2}${secC}${sec3}${sec4}${sec5}</div></div>`;
    mountPreview();
    $('#edTry').onclick = () => tryBlock(b);
  }

  // dónde acabas respecto al punto de salida (para comprobar que hay sitio)
  function courseInfo(b) {
    let off = 0, lo = 0, hi = 0, rnd = 0;
    b.positions.slice(b.startMove ? 0 : 1).forEach((p) => { if (p.dir === 'left') off--; else if (p.dir === 'right') off++; else rnd++; lo = Math.min(lo, off); hi = Math.max(hi, off); });
    const parts = [];
    if (lo < 0) parts.push(`${-lo} a la izquierda`); if (hi > 0) parts.push(`${hi} a la derecha`);
    const moves = b.positions.length - (b.startMove ? 0 : 1);
    if (!moves) return 'Una sola posición sin desplazamiento: el escenario aparece con el beep. Añade desplazamientos (＋) o elige «Con desplazamiento» en la sección 2.';
    return `${moves} ${moves === 1 ? 'desplazamiento' : 'desplazamientos'} · te alejas como máximo ${parts.length ? parts.join(' y ') : '0'} del punto de salida${rnd ? ` (+${rnd} aleatorios, según el espacio)` : ''}. Comprueba que tienes sitio y que la cámara te ve en todo el recorrido.`;
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
  $('#edBlocks').addEventListener('click', (e) => {
    const li = e.target.closest('.ed-bl'); if (!li || !prog) return;
    const i = prog.blocks.findIndex((b) => b.id === li.dataset.id), act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) {
      selBlockId = li.dataset.id; selPosId = null; insTab = 'elem'; renderBlocks(); renderBlock();
      if (window.innerWidth <= 1000) $('#edBlock').scrollIntoView({ behavior: 'smooth', block: 'start' }); // en el móvil el editor queda debajo
      return;
    }
    if (act === 'up' && i > 0) [prog.blocks[i - 1], prog.blocks[i]] = [prog.blocks[i], prog.blocks[i - 1]];
    if (act === 'down' && i < prog.blocks.length - 1) [prog.blocks[i + 1], prog.blocks[i]] = [prog.blocks[i], prog.blocks[i + 1]];
    if (act === 'dup') { const c = clone(prog.blocks[i]); c.id = store.uid(); c.name += ' (copia)'; c.positions?.forEach((p) => (p.id = store.uid())); prog.blocks.splice(i + 1, 0, c); selBlockId = c.id; selPosId = null; }
    if (act === 'del') {
      if (prog.blocks.length <= 1) return;
      if (!confirm(`¿Eliminar el ejercicio «${prog.blocks[i].name}»?`)) return;
      prog.blocks.splice(i, 1); if (selBlockId === li.dataset.id) selBlockId = prog.blocks[Math.max(0, i - 1)]?.id || null;
    }
    persist(); renderBlocks(); renderBlock();
  });
  function onField(e) {
    const el = e.target, k = el.dataset?.k, b = block();
    if (!k || !b) return;
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
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
    if (k.startsWith('port.')) {
      const s = scen(); if (!s) return;
      const pk = k.slice(5); s.port = s.port || defaultPort();
      s.port[pk] = ['w', 'h', 'x'].includes(pk) ? v / 100 : v;
      persist(); renderBlocks();
      if (pk === 'on' || pk === 'open') renderBlock();
      return;
    }
    if (k === 'activatorAt') { const s = scen(); if (s) s.activatorAt = v; persist(); renderBlocks(); if (preview?.actStart != null) playActivation(); return; }
    if (k.startsWith('cond.')) {
      b.cond = { ...defaultCond(), ...(b.cond || {}) }; b.cond[k.slice(5)] = k === 'cond.note' ? String(v).slice(0, 60) : v;
      persist(); renderBlocks(); renderBlock(); return;
    }
    if (k.startsWith('mv.')) {
      const [, idx, f] = k.split('.'), ps = b.positions[+idx];
      if (ps) ps[f] = v;
      persist(); renderBlocks(); renderBlock(); return;
    }
    if (k === 'limitOn') { b.maxTime = v ? (b.maxTime || 30) : 0; persist(); renderBlocks(); renderBlock(); return; }
    if (k.startsWith('pos.')) { const s = scen(); if (s) s[k.slice(4)] = v; persist(); renderBlocks(); renderBlock(); return; }
    if (k.startsWith('random.')) {
      const rk = k.slice(7); b.random[rk] = v;
      persist(); renderBlocks();
      if (rk === 'on' || rk === 'advance' || rk === 'walls') renderBlock();
      return;
    }
    if (k === 'mode') { b.random.on = v === 'random'; persist(); renderBlocks(); renderBlock(); return; }
    if (k === 'startMove') v = v === true || v === 'true';
    b[k] = v;
    if (k === 'startMove' && v && b.positions[0]?.dir === 'none') b.positions[0].dir = 'random';
    persist(); renderBlocks();
    if (['startMove', 'reps', 'rest', 'maxTime', 'startMode', 'restAfter'].includes(k)) renderBlock();
    if ($('#edCourseInfo')) $('#edCourseInfo').textContent = courseInfo(b);
  }

  // clics: lista de ejercicios, posiciones del recorrido y paleta de elementos
  $('#edMain').addEventListener('click', (e) => {
    const addb = e.target.closest('[data-addblock]')?.dataset.addblock;
    if (addb) { closeMenus(); addBlock(newExercise()); return; }
    const ins = e.target.closest('[data-ins]')?.dataset.ins;
    if (ins) { setTab(ins); return; }
    const posRnd = e.target.closest('[data-pos-rnd]')?.dataset.posRnd;
    if (posRnd) {
      const bl = block(), ps = bl?.positions.find((x) => x.id === posRnd); if (!ps) return;
      ps.randomScene = !ps.randomScene; selPosId = posRnd;
      toast(ps.randomScene ? 'Escenario aleatorio en cada repetición' : 'Escenario fijo: se usará el que diseñes');
      persist(); renderBlocks(); renderBlock(); return;
    }
    const posDel = e.target.closest('[data-pos-del]')?.dataset.posDel;
    if (posDel) { selPosId = posDel; positionAction('del'); return; }
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
    // las posiciones a las que se llega desplazándose necesitan dirección
    b.positions.forEach((p, k) => { if ((k > 0 || b.startMove) && p.dir === 'none') p.dir = k ? 'right' : 'random'; });
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
    if (manual && s.randomScene) { s.randomScene = false; renderBlock(); toast('Has ajustado el escenario a mano: se usará el mismo en todas las repeticiones'); }
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
      <label>Hard cover<select data-st="hard">${opt('none', 'Ninguna', h?.preset || 'none')}${Object.entries(HARD_PRESETS).map(([k, p]) => opt(k, p.label, h?.preset || 'none')).join('')}</select></label>
      ${h ? range('hardAngle', 'Ángulo del hard cover', Math.round(h.angle), -180, 180, 1, '°') + range('hardAmount', 'Cuánto tapa', Math.round(h.amount * 100), 5, 90, 1, '%') : ''}
      ${h ? '<label>&nbsp;<button class="btn small" data-st="flip">↔ Invertir hard cover</button></label>' : ''}`;
  }

  function renderItemPanel() {
    const host = $('#edItem'); if (!host) return;
    const it = selItem;
    if (!it || !preview?.items.includes(it)) {
      host.innerHTML = '<div class="ed-empty-item"><b>Ningún elemento seleccionado</b><span>Toca una tarjeta, un popper, un muro… en el escenario para editarlo, duplicarlo o eliminarlo.</span></div>';
      return;
    }
    if (insTab !== 'elem') setTab('elem');
    let title = ITEM_NAME[it.type] || 'Elemento', fields = '', extraBtn = '';
    switch (it.type) {
      case 'paper':
        title = 'Tarjeta'; extraBtn = '<button class="ed-ic" data-st="random" title="Estilo aleatorio">🎲</button>';
        fields = styleFields(styleOf(it), false) + `<label>Tamaño<select data-st="mini">${opt('false', 'Normal', String(!!it.mini))}${opt('true', 'Mini (2/3)', String(!!it.mini))}</select></label>`;
        break;
      case 'mover': {
        title = `Móvil · ${MOVER_LABEL[it.mtype]}`; extraBtn = '<button class="ed-ic" data-st="random" title="Estilo aleatorio">🎲</button>';
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
          <label>Color<select data-st="steelColor">${Object.entries(STEEL_COLORS).map(([k, l]) => opt(k, l, it.color || 'white')).join('')}</select></label>
          <label class="switch ed-full"><input type="checkbox" data-st="activator" ${it.activator ? 'checked' : ''} ${hasMover ? '' : 'disabled'}> Activa el móvil (onda, brillo y caída)${hasMover ? '' : ' — añade antes un móvil'}</label>`;
        break;
      }
      case 'wall':
        title = it.h <= 1.3 ? 'Barricada baja' : 'Muro';
        fields = range('wallW', 'Ancho', Math.round(it.w * 10) / 10, 0.4, 4, 0.1, ' m') + range('wallH', 'Alto', Math.round(it.h * 100) / 100, 0.6, 2.6, 0.05, ' m')
          + `<label>Acabado<select data-st="wallStyle">${Object.entries(WALL_STYLE_LABEL).map(([k, l]) => opt(k, l, it.style)).join('')}</select></label>`;
        break;
      case 'plate':
        fields = `<label>Forma<select data-st="plateShape">${opt('round', 'Redondo', it.shape || 'round')}${opt('square', 'Cuadrado', it.shape || 'round')}</select></label>
          <label>Color<select data-st="steelColor">${Object.entries(STEEL_COLORS).map(([k, l]) => opt(k, l, it.color || 'white')).join('')}</select></label>`;
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
      <div class="ed-item-head"><div><b>${title}</b><small>a ${it.d.toFixed(1)} m</small></div>
        <div class="row">${extraBtn}<button class="ed-ic" data-st="dup" title="Duplicar">⧉</button><button class="ed-ic danger" data-st="del" title="Eliminar (Supr)">🗑</button></div></div>
      <div class="ed-grid">${fields}</div>`;
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
      case 'hard': st.hard = el.value === 'none' || !HARD_PRESETS[el.value] ? null : { preset: el.value, angle: HARD_PRESETS[el.value].angle, amount: HARD_PRESETS[el.value].amount }; rerender = true; break;
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
      case 'steelColor': if (el.value === 'white') delete it.color; else it.color = el.value; break;
      case 'plateShape': if (el.value === 'round') delete it.shape; else it.shape = el.value; break;
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
    renderer.render({ stage: preview, port: s?.port?.on ? { cfg: s.port, p: 1 } : null, info: `${where}${THEMES[preview.theme].name.toUpperCase()} · ${preview.items.filter((i) => MAIN_TYPES.includes(i.type)).length} BLANCOS` }, now);
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
