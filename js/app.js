import { METRICS, METRIC_BY_KEY, STYLE_DEFAULTS, DEFAULT_TOLS, STATUS_LABEL, scoreStatus, fmtValue } from './metrics.js?v=20261108-2153';
import { Analyzer, ClipRecorder, COLORS } from './pose.js?v=20261108-2153';
import * as store from './storage.js?v=20261108-2153';
import { ShotTimer, beep, audioCtx } from './timer.js?v=20261108-2153';
import { lineChart } from './charts.js?v=20261108-2153';
import { initDryFire } from './dryfire.js?v=20261108-2153';
import { VERSION } from './version.js?v=20261108-2153';

// ---------------- utilidades ----------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let profile = store.loadProfile();
const getProfile = () => profile;
function saveProfile() { store.saveProfile(profile); renderHello(); }

let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
function loading(on) { $('#modelLoading').classList.toggle('hidden', !on); }

function ask({ title, html = '', fields = [], ok = 'Guardar', cancel = 'Cancelar' }) {
  return new Promise((resolve) => {
    const box = $('#modalBox'), modal = $('#modal');
    const field = (f) => {
      const v = esc(f.value ?? '');
      if (f.type === 'textarea') return `<label>${f.label}<textarea data-f="${f.id}" rows="3">${v}</textarea></label>`;
      if (f.type === 'select') return `<label>${f.label}<select data-f="${f.id}">${f.options.map(([val, l]) => `<option value="${esc(val)}" ${val === f.value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
      return `<label>${f.label}<input data-f="${f.id}" value="${v}" ${f.list ? `list="${f.list}"` : ''} placeholder="${esc(f.placeholder || '')}"></label>`;
    };
    box.innerHTML = `<h3>${title}</h3>${html}${fields.map(field).join('')}
      <div class="row end">${cancel ? `<button class="btn" data-x>${cancel}</button>` : ''}<button class="btn primary" data-ok>${ok}</button></div>`;
    modal.classList.remove('hidden');
    const close = (val) => { modal.classList.add('hidden'); resolve(val); };
    $('[data-ok]', box).onclick = () => {
      const out = {}; $$('[data-f]', box).forEach((el) => (out[el.dataset.f] = el.value.trim())); close(out);
    };
    const x = $('[data-x]', box); if (x) x.onclick = () => close(null);
    $('[data-f]', box)?.focus();
  });
}

// ---------------- cabecera / pestañas ----------------
function renderHello() {
  const hand = profile.hand === 'left' ? 'Zurdo' : 'Diestro';
  $('#hello').textContent = profile.name ? `Hola, ${profile.name} · ${profile.division} · ${hand}` : 'Configura tu perfil';
}
const tabHooks = {};
$$('#tabs button').forEach((b) => (b.onclick = () => {
  $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${b.dataset.tab}`));
  tabHooks[b.dataset.tab]?.();
}));

// ---------------- tarjetas de métricas ----------------
function bar(score) {
  const n = score == null ? 0 : Math.round(score / 10);
  return `<div class="segbar">${Array.from({ length: 10 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>`;
}
function renderCards(el, summary, cur = null, refs = profile.refs) {
  el.innerHTML = METRICS.map((m) => {
    const s = summary?.metrics?.[m.key];
    const score = s?.score ?? null;
    const st = scoreStatus(score);
    const liveVal = cur?.values?.[m.key];
    const liveSt = cur?.devs?.[m.key]?.status;
    const val = liveVal ?? s?.mean;
    return `<div class="mcard ${st}" title="${esc(m.desc + ' ' + m.tip)}">
      <div class="mlabel">${m.label}${liveSt ? `<span class="dot" style="background:${COLORS[liveSt]}"></span>` : ''}</div>
      <div class="mscore">${score != null ? score + '%' : '—'}</div>
      <div class="mstatus">${STATUS_LABEL[st]}</div>${bar(score)}
      <div class="mval">${fmtValue(m.key, val)} <span>ref ${fmtValue(m.key, refs?.[m.key])}</span></div>
    </div>`;
  }).join('');
}
function renderOverall(el, summary) {
  const sc = summary?.overall ?? null; const st = scoreStatus(sc);
  if (sc == null) { el.innerHTML = `<div class="ov none"><span>Consistencia global</span><b>—</b><small>Empieza una serie para puntuar</small></div>`; return; }
  const diff = sc - profile.goal;
  el.innerHTML = `<div class="ov ${st}"><span>Consistencia global</span><b>${sc}%</b>
    <small>${STATUS_LABEL[st]} · objetivo ${profile.goal}% (${diff >= 0 ? '+' : ''}${diff}) · ${summary.frames} frames, ${summary.aimFrames} apuntando</small></div>`;
}
function weakest(summary, n = 2) {
  return Object.entries(summary.metrics).sort((a, b) => a[1].score - b[1].score).slice(0, n).filter(([, v]) => v.score < 80);
}
function tipsHTML(summary) {
  const w = weakest(summary);
  if (!w.length) return '<p class="tip good">Todo en verde. ¡Sigue así y sube la exigencia (tolerancias más bajas)!</p>';
  return w.map(([k, v]) => `<p class="tip"><b>${METRIC_BY_KEY[k].label} (${v.score}%):</b> ${METRIC_BY_KEY[k].tip}</p>`).join('');
}

// ---------------- guardar sesión / calibrar ----------------
async function saveSession(an, source, drill = '') {
  const sum = an.summary();
  if (!sum.frames || sum.overall == null) { toast('No hay datos que guardar: empieza una serie primero'); return; }
  const r = await ask({
    title: `Guardar sesión · ${sum.overall}%`,
    html: tipsHTML(sum),
    fields: [{ id: 'drill', label: 'Drill', list: 'drillList', value: drill }, { id: 'notes', label: 'Notas', type: 'textarea', placeholder: 'Sensaciones, munición, arma…' }],
  });
  if (!r) return;
  const ok = store.addSession({
    id: store.uid(), date: Date.now(), source, drill: r.drill || 'Sin nombre', notes: r.notes,
    ...sum, thumb: an.thumbnail(), refs: { ...profile.refs }, tols: { ...profile.tols },
  });
  if (ok) toast('Sesión guardada en tu historial ✔');
}

async function calibrate(an) {
  for (const t of ['3', '2', '1']) { an.overlayText = t; await sleep(800); }
  an.overlayText = '¡POSICIÓN!';
  const res = await an.collect(3000);
  an.overlayText = null;
  if (res.frames < 10) { toast('No se detectó tu cuerpo durante la calibración. Ponte de cuerpo entero en el encuadre.'); return; }
  const rows = METRICS.map((m) => {
    const nv = res.refs[m.key];
    return `<tr><td>${m.label}</td><td>${fmtValue(m.key, profile.refs[m.key])}</td><td><b>${nv == null ? '— (sin datos)' : fmtValue(m.key, nv)}</b></td></tr>`;
  }).join('');
  const warn = res.aimFrames < 5 ? '<p class="tip">No estabas apuntando: las métricas de brazos y cabeza no se han capturado. Repite con el arma (o réplica) presentada al blanco.</p>' : '';
  const r = await ask({ title: 'Nueva referencia personal', html: `${warn}<table class="refs"><tr><th>Métrica</th><th>Actual</th><th>Nueva</th></tr>${rows}</table>`, ok: 'Usar como mi referencia' });
  if (!r) return;
  for (const m of METRICS) if (res.refs[m.key] != null) profile.refs[m.key] = +res.refs[m.key].toFixed(3);
  profile.refSource = 'calibrated'; profile.refDate = Date.now(); saveProfile(); renderProfile();
  toast('Referencia calibrada con tu postura ✔');
}

// ================= CÁMARA EN DIRECTO =================
const liveVideo = $('#liveVideo'), liveCanvas = $('#liveCanvas');
let liveAn = null, liveStream = null; const liveRec = new ClipRecorder(liveCanvas);

async function listCams() {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const sel = $('#camSelect'), cur = sel.value;
  sel.innerHTML = devs.map((d, i) => `<option value="${d.deviceId}">${esc(d.label || `Cámara ${i + 1}`)}</option>`).join('');
  if (cur && devs.some((d) => d.deviceId === cur)) sel.value = cur;
}

async function startCam() {
  try {
    stopCam(false);
    const id = $('#camSelect').value;
    const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
    liveStream = await navigator.mediaDevices.getUserMedia({ video: id ? { ...base, deviceId: { exact: id } } : base, audio: false });
    liveVideo.srcObject = liveStream; await liveVideo.play();
    await listCams();
    $('#liveEmpty').classList.add('hidden');
    if (!liveAn) {
      liveAn = new Analyzer({ video: liveVideo, canvas: liveCanvas, getProfile, live: true, onUpdate: updateLive });
      loading(true); await liveAn.init(); loading(false);
    } else { loading(true); await liveAn.ensureModel(); loading(false); }
    $('#liveState').textContent = 'Cámara activa';
  } catch (e) {
    loading(false); console.error(e);
    toast(e.name === 'NotAllowedError' ? 'Permiso de cámara denegado' : `No se pudo iniciar la cámara: ${e.message}`, 4000);
  }
}
function stopCam(showEmpty = true) {
  liveStream?.getTracks().forEach((t) => t.stop()); liveStream = null;
  if (liveAn) liveAn.accumulate = false;
  setToggle();
  if (showEmpty) { $('#liveEmpty').classList.remove('hidden'); $('#liveState').textContent = 'Inactivo'; }
}
function updateLive(an) {
  const sum = an.summary();
  renderCards($('#liveCards'), sum, an.cur);
  renderOverall($('#liveOverall'), sum);
  $('#liveFps').textContent = `${an.fps} fps`;
  $('#liveFrames').textContent = `${sum.frames} frames · ${sum.duration.toFixed(1)} s`;
  $('#liveState').textContent = !an.cur ? 'Sin detección' : an.cur.aiming ? 'Apuntando' : 'En guardia';
  $('#liveState').className = `chip ${!an.cur ? 'bad' : an.cur.aiming ? 'good' : ''}`;
}
function setToggle() { $('#liveToggle').textContent = liveAn?.accumulate ? '❚❚ Pausar serie' : '▶ Empezar serie'; }
const needCam = () => { if (!liveStream || !liveAn) { toast('Inicia primero la cámara'); return false; } return true; };

$('#camStart').onclick = startCam; $('#camStart2').onclick = startCam; $('#camStop').onclick = () => stopCam();
$('#camSelect').onchange = () => liveStream && startCam();
$('#liveToggle').onclick = () => { if (!needCam()) return; liveAn.accumulate = !liveAn.accumulate; setToggle(); };
$('#liveReset').onclick = () => { liveAn?.reset(); liveAn && updateLive(liveAn); toast('Serie reiniciada'); };
$('#liveCalib').onclick = async () => { if (!needCam()) return; const acc = liveAn.accumulate; liveAn.accumulate = false; await calibrate(liveAn); liveAn.accumulate = acc; };
$('#liveSave').onclick = () => liveAn ? saveSession(liveAn, 'cámara') : toast('No hay sesión activa');
$('#liveRec').onclick = async () => {
  if (!needCam()) return;
  if (liveRec.active) { await liveRec.stop(`ipsc-track-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`); $('#liveRec').textContent = '● Grabar clip'; $('#liveRec').classList.remove('rec'); }
  else { liveRec.start(); $('#liveRec').textContent = '■ Parar y descargar'; $('#liveRec').classList.add('rec'); }
};
let drillRunning = false;
$('#liveDrill').onclick = async () => {
  if (!needCam() || drillRunning) return;
  drillRunning = true; audioCtx();
  const secs = Math.max(2, +$('#drillSecs').value || 5);
  liveAn.reset(); liveAn.accumulate = false; setToggle();
  liveAn.overlayText = 'LISTO';
  const { delayMin, delayMax, freq } = profile.timer;
  const delay = delayMin + Math.random() * Math.max(0, delayMax - delayMin);
  await sleep(delay * 1000);
  liveAn.overlayText = null; beep({ freq });
  liveAn.accumulate = true; setToggle();
  await sleep(secs * 1000);
  liveAn.accumulate = false; setToggle(); beep({ freq: freq * 0.8, dur: 0.15 });
  drillRunning = false;
  saveSession(liveAn, 'cámara', 'Drill con beep');
};

// ================= ANÁLISIS DE VÍDEO =================
const slots = {};
function createSlot(id) {
  const el = document.createElement('div'); el.className = 'slot'; el.id = `slot-${id}`;
  el.innerHTML = `
    <div class="row between slot-head"><b class="slot-id">${id}</b><span class="fname muted">Sin vídeo</span>
      <label class="btn small primary">Cargar vídeo<input type="file" accept="video/*" hidden></label></div>
    <div class="stage drop"><canvas></canvas><video playsinline muted class="hidden"></video>
      <div class="stage-empty"><p>Arrastra aquí un vídeo<br><small>MP4 / MOV / WEBM</small></p></div></div>
    <div class="vcontrols"><button class="btn small" data-play>▶</button><input type="range" class="seek" min="0" max="1000" value="0"><span class="time">0:00 / 0:00</span></div>
    <div class="overall"></div><div class="cards"></div><div class="tips"></div>
    <div class="row"><button class="btn small accent" data-full>⚡ Analizar completo</button><button class="btn small" data-calib>🎯 Usar 3 s como referencia</button><button class="btn small" data-reset>↺ Reiniciar</button><button class="btn small primary" data-save>💾 Guardar</button></div>`;
  $('#slots').appendChild(el);
  const s = { id, el, video: $('video', el), canvas: $('canvas', el), an: null, name: '' };
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const load = async (file) => {
    if (!file || !file.type.startsWith('video')) return toast('Selecciona un archivo de vídeo');
    s.name = file.name; $('.fname', el).textContent = file.name;
    if (s.url) URL.revokeObjectURL(s.url);
    s.url = URL.createObjectURL(file); s.video.src = s.url; s.video.playbackRate = +$('#vidRate').value;
    await new Promise((r) => (s.video.onloadeddata = r));
    $('.stage-empty', el).classList.add('hidden');
    if (!s.an) {
      s.an = new Analyzer({ video: s.video, canvas: s.canvas, getProfile, onUpdate: () => updateSlot(s) });
      loading(true); try { await s.an.init(); } finally { loading(false); }
    } else { loading(true); try { await s.an.ensureModel(); } finally { loading(false); } }
    s.an.reset(); s.video.currentTime = 0; updateSlot(s);
    toast('Vídeo cargado: pulsa ▶ para analizarlo');
  };
  $('input[type=file]', el).onchange = (e) => load(e.target.files[0]);
  const stage = $('.stage', el);
  stage.ondragover = (e) => { e.preventDefault(); stage.classList.add('over'); };
  stage.ondragleave = () => stage.classList.remove('over');
  stage.ondrop = (e) => { e.preventDefault(); stage.classList.remove('over'); load(e.dataTransfer.files[0]); };
  const v = s.video;
  v.onplay = () => { if (s.an) s.an.accumulate = true; $('[data-play]', el).textContent = '❚❚'; };
  v.onpause = () => { if (s.an) s.an.accumulate = false; $('[data-play]', el).textContent = '▶'; };
  v.onended = () => { toast(`Vídeo ${id} analizado: ${s.an?.summary().overall ?? '—'}% · ya puedes guardarlo`); };
  v.ontimeupdate = () => { if (v.duration) { $('.seek', el).value = (v.currentTime / v.duration) * 1000; $('.time', el).textContent = `${fmt(v.currentTime)} / ${fmt(v.duration)}`; } };
  $('[data-play]', el).onclick = () => { if (!s.an) return toast('Carga un vídeo primero'); v.paused ? v.play() : v.pause(); };
  $('.seek', el).oninput = (e) => { if (v.duration) v.currentTime = (e.target.value / 1000) * v.duration; };
  $('[data-reset]', el).onclick = () => { s.an?.reset(); updateSlot(s); };
  $('[data-full]', el).onclick = async (e) => {
    if (!s.an) return toast('Carga un vídeo primero');
    const b = e.currentTarget;
    if (s.an.offline) { s.an.abort = true; return; }
    b.textContent = '■ Cancelar 0%';
    await s.an.analyzeAll(15, (p) => (b.textContent = `■ Cancelar ${Math.round(p * 100)}%`));
    b.textContent = '⚡ Analizar completo'; updateSlot(s); $('.tips', el).innerHTML = tipsHTML(s.an.summary());
    toast(`Análisis completo: ${s.an.summary().overall ?? '—'}% · ya puedes guardarlo`);
  };
  $('[data-save]', el).onclick = () => s.an ? saveSession(s.an, `vídeo: ${s.name}`) : toast('Carga un vídeo primero');
  $('[data-calib]', el).onclick = async () => {
    if (!s.an) return toast('Carga un vídeo primero');
    const wasPaused = v.paused; const acc = s.an.accumulate;
    if (wasPaused) v.play();
    await calibrate(s.an);
    if (wasPaused) v.pause(); s.an.accumulate = !v.paused && acc;
  };
  renderCards($('.cards', el), null); renderOverall($('.overall', el), null);
  slots[id] = s; return s;
}
function updateSlot(s) {
  const sum = s.an.summary();
  renderCards($('.cards', s.el), sum, s.an.cur); renderOverall($('.overall', s.el), sum);
  $('.tips', s.el).innerHTML = sum.overall != null && s.video.paused ? tipsHTML(sum) : '';
}
createSlot('A');
window.ipscTrack = { slots, get live() { return liveAn; } }; // acceso de depuración desde la consola
$('#vidCompare').onchange = (e) => {
  if (e.target.checked) { slots.B ? slots.B.el.classList.remove('hidden') : createSlot('B'); }
  else if (slots.B) { slots.B.video.pause(); slots.B.el.classList.add('hidden'); }
  $('#slots').classList.toggle('two', e.target.checked);
};
const activeSlots = () => Object.values(slots).filter((s) => s.an && !s.el.classList.contains('hidden'));
$('#vidPlayAll').onclick = () => activeSlots().forEach((s) => s.video.play());
$('#vidPauseAll').onclick = () => activeSlots().forEach((s) => s.video.pause());
$('#vidRate').onchange = (e) => Object.values(slots).forEach((s) => (s.video.playbackRate = +e.target.value));

// grabación de la comparativa (vídeos + paneles de métricas en un solo clip)
const comp = $('#compositeCanvas'); const compRec = new ClipRecorder(comp); let compRaf = null;
function drawComposite() {
  const list = activeSlots(); if (!list.length) return;
  const H = 960, panel = 330, ctx = comp.getContext('2d');
  const widths = list.map((s) => Math.round((s.canvas.width / s.canvas.height) * H) || 540);
  const W = widths.reduce((a, b) => a + b, 0);
  if (comp.width !== W || comp.height !== H + panel) { comp.width = W; comp.height = H + panel; }
  ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, comp.width, comp.height);
  let x = 0;
  list.forEach((s, i) => {
    const w = widths[i];
    if (s.canvas.width) ctx.drawImage(s.canvas, x, 0, w, H);
    const sum = s.an.summary();
    ctx.fillStyle = '#fff'; ctx.font = '700 26px Rajdhani, sans-serif'; ctx.textBaseline = 'top';
    ctx.fillText(`${s.id} · ${sum.overall != null ? sum.overall + '%' : '—'}`, x + 18, H + 12);
    METRICS.forEach((m, j) => {
      const col = j % 2, row = Math.floor(j / 2);
      const cx = x + 18 + col * (w / 2 - 6), cy = H + 52 + row * 54, cw = w / 2 - 30;
      const sc = sum.metrics[m.key]?.score; const st = scoreStatus(sc);
      ctx.fillStyle = '#9aa6b4'; ctx.font = '600 15px Rajdhani, sans-serif'; ctx.fillText(m.label.toUpperCase(), cx, cy);
      ctx.fillStyle = st === 'none' ? '#9aa6b4' : COLORS[st]; ctx.font = '700 20px Rajdhani, sans-serif';
      ctx.textAlign = 'right'; ctx.fillText(sc != null ? `${sc}%` : '—', cx + cw, cy - 2); ctx.textAlign = 'left';
      for (let k = 0; k < 10; k++) {
        ctx.fillStyle = sc != null && k < Math.round(sc / 10) ? COLORS[st] : '#2a313a';
        ctx.fillRect(cx + k * (cw / 10), cy + 24, cw / 10 - 4, 5);
      }
    });
    x += w;
  });
  compRaf = requestAnimationFrame(drawComposite);
}
$('#vidRec').onclick = async () => {
  if (compRec.active) {
    cancelAnimationFrame(compRaf); await compRec.stop('ipsc-track-comparativa');
    $('#vidRec').textContent = '● Grabar comparativa'; $('#vidRec').classList.remove('rec'); return;
  }
  if (!activeSlots().length) return toast('Carga al menos un vídeo');
  drawComposite(); compRec.start();
  activeSlots().forEach((s) => s.video.play());
  $('#vidRec').textContent = '■ Parar y descargar'; $('#vidRec').classList.add('rec');
};

// ================= HISTORIAL =================
const histMetric = $('#histMetric');
histMetric.innerHTML = `<option value="overall">Consistencia global</option>` + METRICS.map((m) => `<option value="${m.key}">${m.label}</option>`).join('');
histMetric.onchange = renderHistory; $('#histSearch').oninput = renderHistory;
const dfmt = (t) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

function renderHistory() {
  const all = store.loadSessions();
  const q = $('#histSearch').value.toLowerCase();
  const list = all.filter((s) => !q || `${s.drill} ${s.notes} ${s.source}`.toLowerCase().includes(q));
  const key = histMetric.value;
  const chron = [...list].reverse().filter((s) => (key === 'overall' ? s.overall : s.metrics?.[key]?.score) != null);
  lineChart($('#histChart'), {
    color: '#d4ff3a',
    points: chron.map((s) => ({ x: new Date(s.date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }), y: key === 'overall' ? s.overall : s.metrics[key].score })),
  }, { goal: profile.goal });

  // estadísticas
  const last = all.filter((s) => s.overall != null).slice(0, 5); const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const best = all.filter((s) => s.overall != null).reduce((b, s) => (s.overall > (b?.overall ?? -1) ? s : b), null);
  const bestHF = all.filter((s) => s.dry).reduce((b, s) => Math.max(b, s.dry.hf), 0);
  const totalMin = all.reduce((t, s) => t + (s.duration || 0), 0) / 60;
  const mAvg = METRICS.map((m) => [m, avg(all.slice(0, 10).map((s) => s.metrics?.[m.key]?.score).filter((v) => v != null))]).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]);
  const scored = all.filter((s) => s.overall != null);
  const trend = scored.length >= 6 ? avg(scored.slice(0, 3).map((s) => s.overall)) - avg(scored.slice(3, 6).map((s) => s.overall)) : null;
  $('#histStats').innerHTML = `
    <div class="stat"><span>Sesiones</span><b>${all.length}</b></div>
    <div class="stat"><span>Media últimas 5</span><b>${avg(last.map((s) => s.overall)) ?? '—'}${all.length ? '%' : ''}</b></div>
    <div class="stat"><span>Mejor sesión</span><b>${best ? best.overall + '%' : '—'}</b></div>
    <div class="stat"><span>Tendencia</span><b class="${trend > 0 ? 'up' : trend < 0 ? 'down' : ''}">${trend == null ? '—' : (trend > 0 ? '▲ +' : trend < 0 ? '▼ ' : '') + trend}</b></div>
    <div class="stat"><span>Tiempo analizado</span><b>${totalMin.toFixed(1)} min</b></div>
    <div class="stat"><span>Mejor HF en seco</span><b>${bestHF ? bestHF.toFixed(2) : '—'}</b></div>
    <div class="stat wide"><span>Punto a trabajar</span><b>${mAvg.length ? `${mAvg[0][0].label} (${mAvg[0][1]}%)` : '—'}</b>${mAvg.length ? `<small>${mAvg[0][0].tip}</small>` : ''}</div>`;

  $('#histList').innerHTML = list.length ? list.map((s) => `
    <div class="hitem" data-id="${s.id}">
      ${s.thumb ? `<img src="${s.thumb}" alt="">` : '<div class="noimg"></div>'}
      <div class="hinfo">
        <div class="row between"><b>${esc(s.drill)}</b><span class="row">${s.dry ? `<span class="badge acc">HF ${s.dry.hf.toFixed(2)}</span>` : ''}${s.overall != null ? `<span class="badge ${scoreStatus(s.overall)}">${s.overall}%</span>` : ''}</span></div>
        <small class="muted">${dfmt(s.date)} · ${esc(s.source)} · ${(s.duration || 0).toFixed(1)} s · ${s.frames} frames</small>
        ${s.dry ? `<small class="dry-tag">EN SECO · ${s.dry.time.toFixed(2)} s · ${s.dry.points} pts · desenfunde ${s.dry.draw?.toFixed(2) ?? '—'} · A${s.dry.zones.A} C${s.dry.zones.C} D${s.dry.zones.D} M${s.dry.zones.M}</small>` : ''}
        ${s.notes ? `<p class="note">${esc(s.notes)}</p>` : ''}
        <div class="minibars">${METRICS.map((m) => { const sc = s.metrics?.[m.key]?.score; return `<span title="${m.label}: ${sc ?? '—'}%" style="--h:${sc ?? 0}%;--c:${sc == null ? '#3a424d' : COLORS[scoreStatus(sc)]}"></span>`; }).join('')}</div>
        <div class="row">
          <button class="btn small" data-act="detail">Detalle</button>
          <button class="btn small" data-act="ref">Usar como referencia</button>
          <button class="btn small danger" data-act="del">Borrar</button>
        </div>
        <div class="hdetail hidden"></div>
      </div>
    </div>`).join('') : '<p class="muted center">Todavía no hay sesiones. Analiza con la cámara o un vídeo y pulsa «Guardar sesión».</p>';
}
$('#histList').onclick = async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const item = b.closest('.hitem'); const s = store.loadSessions().find((x) => x.id === item.dataset.id); if (!s) return;
  if (b.dataset.act === 'detail') {
    const d = $('.hdetail', item); d.classList.toggle('hidden');
    if (!d.innerHTML) { d.innerHTML = `<div class="cards"></div>${tipsHTML(s)}`; renderCards($('.cards', d), s, null, s.refs); }
  } else if (b.dataset.act === 'ref') {
    if (!confirm('¿Usar los valores medios de esta sesión como tu postura de referencia?')) return;
    for (const m of METRICS) if (s.metrics?.[m.key]) profile.refs[m.key] = +s.metrics[m.key].mean.toFixed(3);
    profile.refSource = `sesión ${dfmt(s.date)}`; profile.refDate = Date.now(); saveProfile(); renderProfile(); toast('Referencia actualizada ✔');
  } else if (b.dataset.act === 'del') {
    if (!confirm(`¿Borrar la sesión «${s.drill}» del ${dfmt(s.date)}?`)) return;
    store.deleteSession(s.id); renderHistory();
  }
};
$('#exportBtn').onclick = store.exportAll;
$('#importFile').onchange = async (e) => {
  try { await store.importAll(e.target.files[0]); profile = store.loadProfile(); renderAll(); toast('Copia importada ✔'); }
  catch (err) { toast(`Error al importar: ${err.message}`, 4000); }
  e.target.value = '';
};
tabHooks.history = renderHistory;

// ================= COMPARAR =================
function renderCompareSelects() {
  const all = store.loadSessions();
  const opts = all.map((s) => `<option value="${s.id}">${dfmt(s.date)} · ${esc(s.drill)} · ${s.dry ? `HF ${s.dry.hf.toFixed(2)}` : `${s.overall}%`}</option>`).join('');
  const a = $('#cmpA'), b = $('#cmpB'); const va = a.value, vb = b.value;
  a.innerHTML = b.innerHTML = opts || '<option value="">Sin sesiones</option>';
  // por defecto: A = sesión anterior, B = la más reciente (para ver el progreso)
  if (all.some((s) => s.id === va)) a.value = va; else if (all[1]) a.value = all[1].id; else if (all[0]) a.value = all[0].id;
  if (all.some((s) => s.id === vb)) b.value = vb; else if (all[0]) b.value = all[0].id;
  renderCompare();
}
function renderCompare() {
  const all = store.loadSessions();
  const A = all.find((s) => s.id === $('#cmpA').value), B = all.find((s) => s.id === $('#cmpB').value);
  if (!A || !B) { $('#cmpView').innerHTML = '<p class="muted center">Guarda al menos una sesión para comparar.</p>'; return; }
  const col = (s, tag) => `<div class="cmp-col"><div class="cmp-head"><span class="tag">${tag}</span>${s.thumb ? `<img src="${s.thumb}">` : ''}
    <div><b>${esc(s.drill)}</b><small class="muted">${dfmt(s.date)}</small><div class="big ${scoreStatus(s.overall)}">${s.overall != null ? s.overall + '%' : '—'}</div>
    ${s.dry ? `<small class="dry-tag">HF ${s.dry.hf.toFixed(2)} · ${s.dry.time.toFixed(2)} s · ${s.dry.points} pts</small>` : ''}</div></div></div>`;
  const rows = METRICS.map((m) => {
    const a = A.metrics?.[m.key]?.score, b = B.metrics?.[m.key]?.score;
    const d = a != null && b != null ? b - a : null;
    const cell = (v) => `<div class="cbar"><i style="width:${v ?? 0}%;background:${v == null ? '#3a424d' : COLORS[scoreStatus(v)]}"></i><span>${v ?? '—'}${v != null ? '%' : ''}</span></div>`;
    return `<tr><td>${m.label}</td><td>${cell(a)}</td><td>${cell(b)}</td><td class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d == null ? '—' : (d > 0 ? '+' : '') + d}</td></tr>`;
  }).join('');
  const d = A.overall != null && B.overall != null ? B.overall - A.overall : null;
  const dh = A.dry && B.dry ? B.dry.hf - A.dry.hf : null;
  $('#cmpView').innerHTML = `<div class="cmp-cols">${col(A, 'A')}${col(B, 'B')}</div>
    ${d != null ? `<p class="cmp-sum">B respecto a A: <b class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d} puntos</b> de consistencia global.</p>` : ''}
    ${dh != null ? `<p class="cmp-sum">Hit factor en seco: <b class="${dh > 0 ? 'up' : dh < 0 ? 'down' : ''}">${dh > 0 ? '+' : ''}${dh.toFixed(2)}</b> (tiempo ${A.dry.time.toFixed(2)} → ${B.dry.time.toFixed(2)} s).</p>` : ''}
    <table class="cmp-table"><thead><tr><th>Métrica</th><th>A</th><th>B</th><th>Δ</th></tr></thead><tbody>${rows}</tbody></table>`;
}
$('#cmpA').onchange = renderCompare; $('#cmpB').onchange = renderCompare;
tabHooks.compare = renderCompareSelects;

// ================= TIMER =================
const tset = profile.timer;
const tInputs = { tMin: 'delayMin', tMax: 'delayMax', tPar: 'par', tThr: 'threshold', tFreq: 'freq' };
function loadTimerInputs() { for (const [id, k] of Object.entries(tInputs)) $(`#${id}`).value = profile.timer[k]; $('#tThrMark').style.left = `${profile.timer.threshold * 100}%`; }
for (const [id, k] of Object.entries(tInputs)) $(`#${id}`).oninput = (e) => {
  profile.timer[k] = +e.target.value; saveProfile(); $('#tThrMark').style.left = `${profile.timer.threshold * 100}%`;
};
let tRaf = null;
const timer = new ShotTimer({
  onLevel: (lv) => { $('#tLevel').style.width = `${Math.min(100, lv * 100)}%`; $('#tLevel').classList.toggle('hot', lv >= profile.timer.threshold); },
  onShot: (shot, shots) => {
    $('#tShots').insertAdjacentHTML('beforeend', `<li><b>${shot.time.toFixed(2)}</b><span>${shots.length === 1 ? 'reacción / 1er disparo' : `split ${shot.split.toFixed(2)}`}</span></li>`);
  },
  onState: (st, shots) => {
    if (st === 'standby') { $('#tState').textContent = 'Preparado… espera el beep'; $('#tDisplay').classList.add('standby'); }
    if (st === 'listening') { $('#tState').textContent = '¡FUEGO! Escuchando disparos…'; $('#tDisplay').classList.remove('standby'); tickTimer(); }
    if (st === 'done') {
      cancelAnimationFrame(tRaf); $('#tDisplay').classList.remove('standby');
      const last = shots.at(-1);
      $('#tDisplay').textContent = last ? last.time.toFixed(2) : '0.00';
      $('#tState').textContent = shots.length ? `${shots.length} disparos · 1º ${shots[0].time.toFixed(2)} s · total ${last.time.toFixed(2)} s` : 'Sin disparos detectados';
      if (shots.length) {
        store.addTimerRun({ id: store.uid(), date: Date.now(), drill: $('#tDrill').value || 'Sin nombre', shots: shots.map((s) => +s.time.toFixed(3)), par: profile.timer.par });
        renderTimerHistory();
      }
    }
  },
});
function tickTimer() { const e = timer.elapsed(); if (e != null) { $('#tDisplay').textContent = e.toFixed(2); tRaf = requestAnimationFrame(tickTimer); } }
$('#tStart').onclick = async () => {
  try {
    $('#tShots').innerHTML = ''; $('#tDisplay').textContent = '0.00';
    await timer.start({ ...profile.timer, maxTime: 30 });
  } catch (e) { toast(e.name === 'NotAllowedError' ? 'Permiso de micrófono denegado' : e.message, 4000); }
};
$('#tStop').onclick = () => timer.stop();
function renderTimerHistory() {
  const runs = store.loadTimerRuns().slice(0, 15);
  $('#tHistory').innerHTML = runs.length ? runs.map((r) => `<div class="trun"><div><b>${esc(r.drill)}</b><small class="muted">${dfmt(r.date)}</small></div>
    <div class="tnums"><span>1º ${r.shots[0].toFixed(2)}</span><span>${r.shots.length} disp.</span><b>${r.shots.at(-1).toFixed(2)} s</b></div>
    <button class="btn small danger" data-tdel="${r.id}">✕</button></div>`).join('') : '<p class="muted small">Sin registros todavía.</p>';
}
$('#tHistory').onclick = (e) => { const b = e.target.closest('[data-tdel]'); if (b) { store.deleteTimerRun(b.dataset.tdel); renderTimerHistory(); } };
tabHooks.timer = () => timer.ensureMic().catch(() => toast('Necesito permiso de micrófono para detectar disparos'));

// ================= PERFIL =================
const pf = { pName: 'name', pAlias: 'alias', pDivision: 'division', pHand: 'hand', pEye: 'eye', pStyle: 'style', pGoal: 'goal', pModel: 'model' };
function renderProfile() {
  for (const [id, k] of Object.entries(pf)) $(`#${id}`).value = profile[k];
  $('#pRefSource').textContent = profile.refSource === 'default'
    ? `Usando valores genéricos del estilo ${$('#pStyle').selectedOptions[0]?.text}. Calibra tu propia postura para resultados personalizados.`
    : `Referencia personal: ${profile.refSource === 'calibrated' ? 'calibrada' : profile.refSource}${profile.refDate ? ' · ' + dfmt(profile.refDate) : ''}.`;
  $('#pRefs').innerHTML = METRICS.map((m) => {
    const step = m.unit === '°' ? 1 : 0.01;
    return `<tr><td title="${esc(m.desc)}">${m.label}<small>${m.desc}</small></td>
      <td><input type="number" step="${step}" data-ref="${m.key}" value="${+(+profile.refs[m.key]).toFixed(m.unit === '°' ? 1 : 3)}"> ${m.unit}</td>
      <td>± <input type="number" step="${step}" min="${step}" data-tol="${m.key}" value="${profile.tols[m.key]}"> ${m.unit}</td></tr>`;
  }).join('');
}
for (const [id, k] of Object.entries(pf)) $(`#${id}`).onchange = (e) => {
  const old = profile[k];
  profile[k] = k === 'goal' ? Math.max(50, Math.min(100, +e.target.value || 85)) : e.target.value;
  if (k === 'style' && old !== profile[k]) {
    if (profile.refSource === 'default' || confirm('¿Cambiar también tu referencia a los valores típicos de este estilo? (Perderás la calibración actual)')) {
      profile.refs = { ...STYLE_DEFAULTS[profile.style] }; profile.refSource = 'default'; profile.refDate = null;
    }
  }
  saveProfile(); renderProfile();
  if (k === 'model') toast('El nuevo modelo se cargará al iniciar cámara / cargar vídeo');
};
$('#pRefs').oninput = (e) => {
  const t = e.target; const v = +t.value; if (!Number.isFinite(v)) return;
  if (t.dataset.ref) { profile.refs[t.dataset.ref] = v; profile.refSource = 'manual'; profile.refDate = Date.now(); }
  if (t.dataset.tol && v > 0) profile.tols[t.dataset.tol] = v;
  store.saveProfile(profile);
};
$('#pResetRefs').onclick = () => {
  if (!confirm('¿Restablecer referencias y tolerancias a los valores típicos de tu estilo?')) return;
  profile.refs = { ...STYLE_DEFAULTS[profile.style] }; profile.tols = { ...DEFAULT_TOLS }; profile.refSource = 'default'; profile.refDate = null;
  saveProfile(); renderProfile();
};
tabHooks.profile = renderProfile;

// ================= ENTRENAMIENTO EN SECO =================
const dry = initDryFire({ toast, ask, renderCards, renderOverall, tipsHTML, getProfile, saveProfile });
tabHooks.dry = dry.onShow;
window.ipscTrack.dry = dry;

// ================= ACTUALIZACIONES =================
// Al abrir la app (y al volver a la pestaña) se consulta version.json sin caché. Si hay una versión
// más nueva publicada: al abrir se recarga sola una vez; con la app ya en uso se ofrece un aviso.
const reloadTo = (v) => location.replace(`${location.pathname}?v=${encodeURIComponent(v)}${location.hash}`);
async function checkForUpdate(auto) {
  if (VERSION === 'dev') return;
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const { version } = await r.json();
    if (!version || version === VERSION) return;
    let already = null;
    try { already = sessionStorage.getItem('ipsctrack.reloadedFor'); } catch { /* sin almacenamiento */ }
    if (auto && already !== version) {
      try { sessionStorage.setItem('ipsctrack.reloadedFor', version); } catch { /* sin almacenamiento */ }
      reloadTo(version); return;
    }
    const bar = $('#updateBar');
    bar.classList.remove('hidden');
    $('#updateBtn').onclick = () => reloadTo(version);
  } catch { /* sin conexión: se sigue con la versión actual */ }
}
checkForUpdate(true);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(false); });
$('#appVersion').textContent = `Versión ${VERSION}`;

// ================= INICIO =================
function renderAll() { renderHello(); renderProfile(); loadTimerInputs(); renderTimerHistory(); renderCards($('#liveCards'), null); renderOverall($('#liveOverall'), null); }
renderAll();
navigator.mediaDevices?.enumerateDevices && listCams().catch(() => {});
window.addEventListener('resize', () => $('#tab-history').classList.contains('active') && renderHistory());

if (!localStorage.getItem('ipsctrack.profile')) {
  (async () => {
    const r = await ask({
      title: 'Bienvenido a IPSC Track 🎯',
      html: '<p class="muted">Personaliza la app para ti. Puedes cambiarlo todo después en «Perfil».</p>',
      fields: [
        { id: 'name', label: 'Tu nombre', placeholder: 'Nombre' },
        { id: 'alias', label: 'Usuario / Instagram (aparece en tus vídeos)', placeholder: '@usuario' },
        { id: 'division', label: 'División', type: 'select', value: 'Production', options: ['Production', 'Production Optics', 'Standard', 'Open', 'Classic', 'Revolver', 'Carry Optics', 'PCC'].map((d) => [d, d]) },
        { id: 'hand', label: 'Mano dominante', type: 'select', value: 'right', options: [['right', 'Diestro'], ['left', 'Zurdo']] },
        { id: 'eye', label: 'Ojo dominante', type: 'select', value: 'right', options: [['right', 'Derecho'], ['left', 'Izquierdo'], ['both', 'Ambos / centrado']] },
        { id: 'style', label: 'Estilo de guardia', type: 'select', value: 'isosceles', options: [['isosceles', 'Isósceles'], ['weaver', 'Weaver'], ['chapman', 'Chapman / Weaver modificado']] },
      ],
      ok: 'Empezar', cancel: null,
    });
    Object.assign(profile, r, { refs: { ...STYLE_DEFAULTS[r.style] } });
    saveProfile(); renderAll();
    toast('Perfil creado. Siguiente paso: calibra tu postura en «Cámara» 🎯', 4500);
  })();
}
