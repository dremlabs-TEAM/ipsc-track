// Inicio: presentación, selector de modo de entrenamiento (con los entrenamientos de «En seco») y acceso al manual.
import { composeStage, finalizeStage, normHalf, kindWidth, THEME_COUNT } from './course.js?v=20261109-2144';
import { StageRenderer } from './scene.js?v=20261109-2144';
// (el selector de entrenamientos vive en «En seco»)
import * as store from './storage.js?v=20261109-2144';
import { programDuration, fmtDuration, blockSummary, randomPort } from './program.js?v=20261109-2144';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------- escenarios «de escaparate» para la portada ----------------
// Composiciones variadas y completas: tarjetas con no-shoot, dobles y hard cover, poppers y platos de colores,
// móviles con su activador, barricadas bajas, muros al fondo y atrezo.
const SHOWCASE = [
  { paper: 4, styleRandom: true, poppers: 2, popSize: 'mixed', plates: 2, mover: 'random', moverNS: 'random', dist: 'mid' },
  { paper: 3, ns: 1, double: 1, hard: 1, poppers: 3, popSize: 'mixed', plates: 3, mover: 'none', dist: 'close' },
  { paper: 4, ns: 1, nsTilt: 1, double: 1, doubleNs: 1, hard: 2, poppers: 1, plates: 1, mover: 'swinger', dist: 'mid' },
  { paper: 3, styleRandom: true, poppers: 2, popSize: 'mini', plates: 2, mover: 'random', moverHard: 'random', dist: 'mid' },
  { paper: 4, nsTilt: 1, doubleNs: 1, hard: 1, poppers: 2, popSize: 'full', plates: 1, mover: 'slider', dist: 'mid' },
];
const MAIN_W = { popper: 0.5, plate: 0.35, mover: 2.5 };
let showIdx = Math.floor(Math.random() * SHOWCASE.length);
function showcaseStage(prevTheme = -1) {
  const r = Math.random, pick = (a) => a[Math.floor(r() * a.length)], rand = (a, b) => a + r() * (b - a);
  let theme = Math.floor(r() * THEME_COUNT); if (theme === prevTheme) theme = (theme + 1) % THEME_COUNT;
  const st = composeStage({ ...SHOWCASE[showIdx++ % SHOWCASE.length], theme, props: true }, (Date.now() ^ Math.floor(r() * 1e9)) >>> 0);
  // metal blanco (por defecto); solo varía la forma de algunos platos
  for (const it of st.items) if (it.type === 'plate' && r() < 0.35) it.shape = 'square';
  // barricadas bajas en los huecos entre blancos (sin tapar ninguno)
  const occ = st.items.filter((i) => MAIN_W[i.type] || i.type === 'paper')
    .map((i) => { const hw = normHalf(i.type === 'paper' ? kindWidth(i.style?.kind) : MAIN_W[i.type], i.d); return [i.x - hw, i.x + hw]; })
    .sort((a, b) => a[0] - b[0]);
  const bd = rand(6.4, 7.2), bhw = normHalf(1.0, bd);
  let added = 0;
  for (let k = 0; k + 1 < occ.length && added < 2; k++) {
    const a = occ[k][1], b = occ[k + 1][0];
    if (b - a > 2 * bhw + 0.04 && r() < 0.7) { st.items.push({ type: 'wall', x: (a + b) / 2, d: bd, w: 1.0, h: rand(0.95, 1.15), style: pick(['ply', 'ply', 'banner']), seed: Math.floor(r() * 1e9) }); added++; }
  }
  // muros al fondo, a los lados, que cierran el escenario sin tapar el centro
  for (const side of [-1, 1]) {
    if (r() < 0.45) st.items.push({ type: 'wall', x: side * rand(0.62, 0.88), d: rand(18, 20), w: rand(1.3, 1.9), h: rand(1.6, 1.9), style: pick(['ply', 'mesh']), seed: Math.floor(r() * 1e9) });
  }
  return finalizeStage(st);
}

export function initHome({ showTab, openDry }) {
  const tab = $('#tab-home');

  // ---------------- escenario animado de la portada ----------------
  // muestra escenarios aleatorios: flecha → malla verde → siguiente escenario, en bucle.
  // Uno de cada dos llega tras un muro con ventana: se ve la barra de «agáchate» y la ventana se abre.
  const canvas = $('#homeScene');
  const scene = new StageRenderer(canvas);
  const view = { stage: showcaseStage() };
  let raf = 0, last = 0, cycleAt = performance.now(), dir = 1, n = 0, wall = null;
  const visible = () => tab.classList.contains('active') && document.visibilityState === 'visible';
  function frame(now) {
    raf = 0;
    if (!visible()) return;
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return; // ~30 fps es suficiente para la portada
    last = now;
    tick(now);
  }
  function tick(now) {
    // muro con ventana (automático): nada más aparecer, la ventana se centra y se acerca hasta enmarcar el escenario
    if (wall) {
      const k = Math.min(1, Math.max(0, (now - wall.start - 250) / 1100));
      view.port.p = k;
      if (k >= 1) { wall = null; cycleAt = now; view.stage.actStart = now + 600; } // el marco se queda en pantalla
    }
    const t = now - cycleAt;
    if (!wall && !view.arrow && !view.transition && t > 3200) view.arrow = { dir, since: now };
    if (view.arrow && t > 4600) {
      const to = showcaseStage(view.stage.theme);
      const port = ++n % 2 ? randomPort('auto', 0) : null;
      view.transition = { from: view.stage, to, dir, start: now, dur: 700, fromPort: view.port ? { cfg: view.port.cfg, p: view.port.p } : null, toPort: port ? { cfg: port, p: 0 } : null };
      view.arrow = null; view.next = to; view.nextPort = port;
    }
    if (view.transition && now - view.transition.start >= view.transition.dur) {
      view.stage = view.next; view.transition = null; view.next = null;
      dir = Math.random() < 0.5 ? -1 : 1; cycleAt = now;
      view.port = view.nextPort ? { cfg: view.nextPort, p: 0 } : null;
      if (view.nextPort) { wall = { start: now }; view.stage.actStart = null; }
      else view.stage.actStart = now + 600; // el popper activador cae poco después de aparecer
      view.nextPort = null;
    }
    scene.checkSize();
    scene.render(view, now);
  }
  const play = () => { if (!raf && visible()) raf = requestAnimationFrame(frame); };
  document.addEventListener('visibilitychange', play);

  // ---------------- ¿qué quieres hacer? ----------------
  tab.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-mode]')?.dataset.mode;
    if (mode === 'dry') { openDry(); return; }
    if (mode) { showTab(mode); return; }
    const go = e.target.closest('[data-goto]')?.dataset.goto;
    if (go) { $(go)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  return {
    onShow() { requestAnimationFrame(play); },
    // pruebas: estado y avance manual de la vista previa
    debug: () => ({ view, wall }),
    stepPreview: (now = performance.now()) => tick(now),
  };
}

