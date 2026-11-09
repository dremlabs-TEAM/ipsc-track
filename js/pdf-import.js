// Lectura de PDFs de ejercicios de competición (una página = un stage).
// · Datos del texto: stage, posición de salida, procedimiento, condición del arma, blancos, disparos y puntos.
// · Dibujo: en muchos PDFs los blancos, bidones y muros son iconos (imágenes sueltas). Se localiza cada icono
//   en la página y se clasifica por su color; así se colocan en el plano. Si el dibujo es una sola imagen
//   (un render 3D, por ejemplo), solo se usan las cantidades del texto.
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build';
let libP = null;
async function lib() {
  libP ??= import(`${PDFJS}/pdf.min.mjs`).then((m) => { m.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`; return m; });
  return libP;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/�/g, '').toUpperCase();
const SCALE = 1.6; // resolución de trabajo de cada página

export async function openPdf(buffer) {
  const pdfjs = await lib();
  return pdfjs.getDocument({ data: buffer, isEvalSupported: false }).promise;
}

// Lee una página: render, texto, datos y elementos detectados (con el recorte del dibujo por defecto)
export async function readPage(doc, n) {
  const pdfjs = await lib();
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;

  // ---- texto con su posición ----
  const tc = await page.getTextContent();
  const items = tc.items.filter((t) => t.str && t.str.trim()).map((t) => {
    const [x, y] = vp.convertToViewportPoint(t.transform[4], t.transform[5]);
    const h = Math.abs(t.transform[3]) * SCALE || 10;
    return { s: t.str, n: norm(t.str), x, y: y - h, w: (t.width || 0) * SCALE, h };
  });
  const info = parseInfo(items);

  // ---- imágenes (iconos) con su rectángulo en la página ----
  const ops = await page.getOperatorList();
  const O = pdfjs.OPS, mul = pdfjs.Util.transform;
  const boxes = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm.slice());
    else if (fn === O.restore) ctm = stack.pop() || ctm;
    else if (fn === O.transform) ctm = mul(ctm, a);
    else if (fn === O.paintFormXObjectBegin) { stack.push(ctm.slice()); if (Array.isArray(a?.[0]) && a[0].length === 6) ctm = mul(ctm, a[0]); }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageMaskXObject || fn === O.paintImageXObjectRepeat) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => vp.convertToViewportPoint(ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const b = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      if (b.w >= 5 && b.h >= 5) boxes.push(b);
    }
  }
  const crop = defaultCrop(items, canvas.width, canvas.height);
  return { n, canvas, info, items, boxes, crop, W: canvas.width, H: canvas.height };
}

// ---------------- datos del texto ----------------
const LABELS = {
  start: /START POSITION|POSICION INICIAL|POSICION DE SALIDA|POSICION DE INICIO/,
  procedure: /STAGE PROCEDURE|PROCEDIMIENTO|PROCEDURE/,
  condition: /READY CONDITION|CONDICION DEL ARMA|CONDICION ARMA|CONDICION/,
};
const ALL_KEYS = /START POSITION|START SIGNAL|AUDIBLE|POSICION INICIAL|STAGE PROCEDURE|PROCEDIMIENTO|READY CONDITION|CONDICION|SCORING|TARGETS|TARJETAS|METALES|NON SHOOT|NO-SHOOT|DISPAROS|PUNTOS|ROUNDS|POINTS|TYPE OF|TIPO DE|START SIGNAL|SEÑAL|START-STOP|SCORED HITS|PENALTIES|SETUP NOTES|RO NOTES|COURSE DESIGNER|RULES/;
const KEY_START = new RegExp(`^\s*(?:${ALL_KEYS.source})`);

function lines(items) {
  // agrupa en líneas (misma altura) y ordena de arriba abajo, izquierda a derecha
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x), out = [];
  for (const it of sorted) {
    const ln = out.find((l) => Math.abs(l.y - it.y) < Math.max(4, it.h * 0.5));
    if (ln) ln.items.push(it); else out.push({ y: it.y, items: [it] });
  }
  return out.map((l) => { l.items.sort((a, b) => a.x - b.x); return { y: l.y, s: l.items.map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim() }; });
}
// bloques: trozos de una línea separados por un hueco grande (columnas de la ficha)
function chunks(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x), rows = [];
  for (const it of sorted) {
    const r = rows.find((l) => Math.abs(l.y - it.y) < Math.max(4, it.h * 0.5));
    if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  const out = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const it of r.items) {
      if (cur && it.x - (cur.x1) < Math.max(18, it.h * 1.6)) { cur.s += (it.x - cur.x1 > it.h * 0.15 ? ' ' : '') + it.s; cur.x1 = it.x + it.w; }
      else { cur = { x: it.x, x1: it.x + it.w, y: r.y, h: it.h, s: it.s }; out.push(cur); }
    }
  }
  return out.map((c) => ({ ...c, s: c.s.replace(/\s+/g, ' ').trim(), n: norm(c.s) }));
}

function parseInfo(items) {
  const L = lines(items), C = chunks(items), text = L.map((l) => l.s).join('\n'), T = norm(text);
  const info = { event: '', stage: '', start: '', procedure: '', condition: '', counts: {} };
  info.event = L.find((l) => !/STAGE|EJERCICIO\s*\d/.test(norm(l.s)) && l.s.length > 6)?.s.slice(0, 80) || '';
  const st = T.match(/STAGE\s*(?:N[ºO°.]?\s*)?0?([0-9]+|[IVX]+)\b/) || T.match(/EJERCICIO\s*(?:N[ºO°.]?\s*)?0?([0-9]+)\b/);
  if (st) info.stage = st[1];
  const LABEL_TXT = /^.*?(?:START POSITION|POSICI[ÓO]N INICIAL|POSICI[ÓO]N DE SALIDA|POSICI[ÓO]N DE INICIO|STAGE PROCEDURE|PROCEDIMIENTO|PROCEDURE|HANDGUN READY CONDITION|READY CONDITION|CONDICI[ÓO]N DEL ARMA|CONDICI[ÓO]N)\s*:?\s*/i;
  // campo: el valor sigue a la etiqueta en su bloque y continúa en los bloques de debajo de la misma columna
  const field = (re) => {
    const lab = C.find((c) => re.test(c.n));
    if (!lab) return '';
    const cut = (t) => t.split(/\s+(?=(?:TIPO DE EJERCICIO|METALES|TARJETAS|NON SHOOTS?|PUNTOS|DISPAROS|IPSC TARGET|MINIMUM|AUDIBLE|SCORING|START SIGNAL)\b)/i)[0];
    let out = cut(lab.s.replace(LABEL_TXT, '').trim()), valueX = lab.x, last = lab;
    if (!out) {
      // tabla: el valor está en la celda de la derecha
      const right = C.filter((c) => Math.abs(c.y - lab.y) < lab.h * 0.9 && c.x > lab.x1 && c.x - lab.x1 < 320 && !ALL_KEYS.test(c.n)).sort((a, b) => a.x - b.x)[0];
      if (right) {
        out = right.s; valueX = right.x; last = right;
        // en celdas de dos líneas la primera queda por encima de la etiqueta (centrada en vertical)
        const above = C.find((c) => c.y < right.y - 2 && right.y - c.y < lab.h * 1.7 && Math.abs(c.x - right.x) < 30 && !KEY_START.test(c.n) && !C.some((k) => k !== c && Math.abs(k.y - c.y) < lab.h * 0.7 && k.x < c.x && KEY_START.test(k.n)));
        if (above) out = `${above.s} ${out}`;
      }
    }
    // ¿empieza otra fila de la tabla (con su propia etiqueta a la izquierda)?
    const rowLabel = (c) => C.some((k) => k !== c && Math.abs(k.y - c.y) < lab.h * 0.7 && k.x < c.x - 10 && KEY_START.test(k.n));
    const below = C.filter((c) => c.y > last.y + 1 && c.y - lab.y < lab.h * 9 && c.x < valueX + 70 && c.x1 > valueX - 20 && c !== last).sort((a, b) => a.y - b.y || a.x - b.x);
    let prevY = last.y;
    for (const c of below) {
      if (KEY_START.test(c.n) || rowLabel(c) || out.length > 190 || c.y - prevY > lab.h * 2.6) break; // otra etiqueta empieza aquí
      if (Math.abs(c.y - prevY) < 2) continue;
      out += ' ' + cut(c.s); prevY = c.y;
    }
    return out.replace(/\s+/g, ' ').trim().slice(0, 220);
  };
  info.start = field(LABELS.start);
  info.procedure = field(LABELS.procedure);
  info.condition = field(LABELS.condition);
  if (!info.condition) {
    const ch = C.find((c) => /CARGADA|DESCARGADA|SIN ALIMENTAR|CHAMBER|LOADED/.test(c.n) && !ALL_KEYS.test(c.n.replace(/CARGADA.*/, '')));
    if (ch) {
      // el recuadro de la condición puede ocupar varias líneas sin etiqueta («CARGADA Y / ASEGURADA EN SU / FUNDA»)
      let out = ch.s, prevY = ch.y;
      for (const c of C.filter((k) => k.y > ch.y + 1 && k.y - ch.y < ch.h * 5 && Math.abs(k.x - ch.x) < 40).sort((a, b) => a.y - b.y)) {
        if (KEY_START.test(c.n) || c.y - prevY > ch.h * 2.2) break;
        out += ' ' + c.s; prevY = c.y;
      }
      info.condition = out.replace(/\s*SCORING.*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 120);
    }
  }

  // cantidades escritas en línea («TARJETAS: 13», «14 IPSC, 3 NS», «28 rounds»…)
  const c = info.counts, num = (re) => { const m = T.match(re); return m ? Number(m[1]) : null; };
  const set = (k, v) => { if (v != null && c[k] == null) c[k] = v; };
  const ipscNs = T.match(/(\d+)\s*IPSC\s*,?\s*(\d+)\s*NS/);
  if (ipscNs) { set('paper', +ipscNs[1]); set('ns', +ipscNs[2]); }
  set('paper', num(/TARJETAS\s*:?\s*(\d+)/));
  set('ns', num(/NON?[\s-]*SHOOTS?\s*:?\s*(\d+)/));
  set('popper', num(/POPPERS?\s*:\s*(\d+)/));
  set('plate', num(/(?:PLATOS?|PLATES?)\s*:\s*(\d+)/));
  const metals = num(/METALES\s*:?\s*(\d+)/);
  set('rounds', num(/(\d+)\s*ROUNDS/) ?? num(/DISPAROS\s*(?:MINIMOS)?\s*:?\s*(\d+)/));
  set('points', num(/(\d+)\s*POINTS/) ?? num(/PUNTOS\s*(?:MAXIMOS)?\s*:?\s*(\d+)/));

  // cantidades en tabla: el número debajo de cada cabecera.
  // Antes se juntan los trozos de una misma palabra o número («NO» «-» «SHOOT», «1» «2» → «12»).
  const toks = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = toks[toks.length - 1];
    const sameRow = last && Math.abs(last.y - it.y) < Math.max(3, it.h * 0.4);
    const bothNum = last && /^\d+$/.test(last.s) && /^\d+$/.test(it.s.trim());
    if (sameRow && it.x - last.x1 <= (bothNum ? it.h * 0.45 : it.h * 0.5) && it.x >= last.x - 1) {
      last.s += (bothNum || /-$/.test(last.s) || it.s.trim() === '-' ? '' : ' ') + it.s.trim(); last.x1 = it.x + it.w;
    } else toks.push({ s: it.s.trim(), x: it.x, x1: it.x + it.w, y: it.y, h: it.h });
  }
  toks.forEach((t) => { t.n = norm(t.s); t.w = t.x1 - t.x; });
  const COLS = [['paper', /^IPSC TARGETS?$|^IPSC TARGET|^TARGETS?$|^TARJETAS?$/], ['ns', /^NO.?SHOOTS?|^NON.?SHOOTS?/], ['popper', /POPPER/], ['plate', /PLATE|PLATO/],
    ['mover', /^SWINGER|^MOVIL|^MOVER/], ['rounds', /ROUNDS|MINIMUM|DISPAROS/], ['points', /POINTS|PUNTOS/]];
  const numToks = toks.filter((t) => /^(\d+|--?|-)$/.test(t.s));
  for (const [k, re] of COLS) {
    if (c[k] != null) continue;
    const head = toks.find((t) => re.test(t.n) && !/:\s*\d/.test(t.n));
    if (!head) continue;
    const cx = head.x + head.w / 2;
    const below = numToks.filter((v) => v.y > head.y + 2 && v.y - head.y < 260 && Math.abs(v.x + v.w / 2 - cx) < Math.max(40, head.w * 0.75))
      .sort((a, b) => a.y - b.y || Math.abs(a.x + a.w / 2 - cx) - Math.abs(b.x + b.w / 2 - cx))[0];
    if (below) c[k] = /\d/.test(below.s) ? Number(below.s) : 0;
  }
  // «METALES: 3» sin desglose: se reparte después entre poppers y platos según el dibujo
  if (metals != null && c.popper == null && c.plate == null) c.metal = metals;
  return info;
}

// zona del dibujo por defecto: entre el bloque de texto de arriba y el pie de página
function defaultCrop(items, W, H) {
  // solo textos «de ficha» (las etiquetas cortas tipo «T 1», «P2» forman parte del dibujo)
  const top = items.filter((i) => i.y < H * 0.62 && i.s.replace(/\s/g, '').length >= 5).reduce((m, i) => Math.max(m, i.y + i.h), H * 0.12);
  const bottom = items.filter((i) => i.y > H * 0.8).reduce((m, i) => Math.min(m, i.y), H * 0.97);
  const y = Math.min(H * 0.7, top + 6), h = Math.max(H * 0.2, bottom - y - 6);
  return { x: W * 0.03, y, w: W * 0.94, h };
}

// ---------------- detección por colores del dibujo ----------------
// Se pinta el recorte en una rejilla pequeña, se clasifica cada píxel por color y se buscan manchas
// conectadas: tarjeta (marrón/beige), popper o plato (amarillo), bidón o neumáticos (negro/azul),
// muro de malla (naranja), muro (gris/verde/salmón claro) y líneas de falta o zona de salida (rojo).
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
}
const NONE = 0, TAN = 1, YEL = 2, DARK = 3, BLUE = 4, ORANGE = 5, RED = 6, GREEN = 7, GRAY = 8, PALE = 9;
function pxClass(r, g, b) {
  const [h, s, v] = hsv(r, g, b);
  if (v > 0.9 && s < 0.1) return NONE;
  if (v < 0.3) return DARK;
  if (s < 0.12) return v < 0.82 ? GRAY : NONE;
  if (h >= 45 && h < 72 && s > 0.45 && v > 0.5) return YEL;
  if (h >= 12 && h < 45) {
    if (s < 0.32 && v > 0.85) return PALE;
    if (s > 0.62 && v > 0.82 && h < 34) return ORANGE;
    return TAN;
  }
  if (h < 12 || h >= 330) return s > 0.5 ? RED : TAN;
  if (h >= 180 && h < 255 && s > 0.25) return BLUE;
  if (h >= 72 && h < 175 && s > 0.25) return GREEN;
  return NONE;
}

export function detectItems(pg, crop, widthM, counts = {}) {
  const G = 260, gw = G, gh = Math.max(1, Math.round((crop.h * G) / crop.w));
  const c = document.createElement('canvas'); c.width = gw; c.height = gh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(pg.canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, gw, gh);
  const data = g.getImageData(0, 0, gw, gh).data, cls = new Uint8Array(gw * gh);
  for (let k = 0; k < gw * gh; k++) cls[k] = pxClass(data[k * 4], data[k * 4 + 1], data[k * 4 + 2]);
  // manchas conectadas de un mismo color
  const seen = new Uint8Array(gw * gh), blobs = [];
  for (let k = 0; k < gw * gh; k++) {
    if (!cls[k] || seen[k]) continue;
    const t = cls[k], stack = [k]; seen[k] = 1;
    let n = 0, x0 = gw, y0 = gh, x1 = 0, y1 = 0;
    while (stack.length) {
      const q = stack.pop(), x = q % gw, y = (q / gw) | 0;
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const nb of [q - 1, q + 1, q - gw, q + gw]) {
        if (nb < 0 || nb >= gw * gh || seen[nb] || cls[nb] !== t) continue;
        if ((nb === q - 1 && x === 0) || (nb === q + 1 && x === gw - 1)) continue;
        seen[nb] = 1; stack.push(nb);
      }
    }
    blobs.push({ t, n, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  const depthM = (widthM * crop.h) / crop.w, mPerCell = widthM / gw;
  const toM = (cx, cy) => ({ x: +((cx / gw - 0.5) * widthM).toFixed(2), d: +Math.max(0.4, (1 - cy / gh) * depthM).toFixed(2) });
  const big = gw * gh * 0.2;
  // tarjetas candidatas: manchas marrones con forma de blanco (ni muros ni palés ni el suelo)
  let tans = blobs.filter((b) => b.t === TAN && b.n >= 14 && b.n < big && b.n / (b.w * b.h) > 0.4 && Math.max(b.w, b.h) / Math.min(b.w, b.h) < 3.2);
  const wantPaper = counts.paper || 0; // los no-shoots de la ficha se añaden aparte
  if (wantPaper && tans.length > wantPaper) {
    // se quedan las de tamaño más típico (las tarjetas de un dibujo miden todas parecido)
    const sizes = tans.map((b) => b.n).sort((a, b) => a - b), med = sizes[Math.floor(sizes.length / 2)];
    tans = tans.sort((a, b) => Math.abs(Math.log(a.n / med)) - Math.abs(Math.log(b.n / med))).slice(0, wantPaper);
  }
  const unit = tans.length ? tans.map((b) => b.n).sort((a, b) => a - b)[Math.floor(tans.length / 3)] : 40;
  const tanSet = new Set(tans);
  const overlaps = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
  const items = [];
  const wallOf = (b, type) => {
    const wide = b.w >= b.h, p = toM(b.x0 + b.w / 2, b.y0 + b.h / 2);
    items.push({ type, ...p, rot: wide ? 0 : 90, w: +Math.max(0.6, (wide ? b.w : b.h) * mPerCell).toFixed(2), h: 2 });
  };
  for (const b of blobs) {
    const long = Math.max(b.w, b.h), short = Math.min(b.w, b.h), fill = b.n / (b.w * b.h);
    if (b.n >= big) continue;
    if (b.t === TAN) {
      if (!tanSet.has(b)) continue;
      // varias tarjetas pegadas forman una sola mancha: se reparten a lo largo (si faltan tarjetas)
      const k = !wantPaper || tans.length < wantPaper ? Math.max(1, Math.min(5, Math.round(b.n / unit))) : 1;
      for (let i = 0; i < k; i++) {
        const f = (i + 0.5) / k, cx = b.w >= b.h ? b.x0 + b.w * f : b.x0 + b.w / 2, cy = b.w >= b.h ? b.y0 + b.h / 2 : b.y0 + b.h * f;
        items.push({ type: 'paper', ...toM(cx, cy), rot: 0 });
      }
    } else if (b.t === YEL && b.n >= 6) items.push({ type: b.h > b.w * 1.3 ? 'popper' : 'plate', ...toM(b.x0 + b.w / 2, b.y0 + b.h / 2), rot: 0 });
    else if (b.t === DARK && b.n >= 25 && fill > 0.35 && !tans.some((tb) => overlaps(tb, b))) items.push({ type: long > short * 1.8 ? 'tires' : 'barrel', ...toM(b.x0 + b.w / 2, b.y0 + b.h / 2), rot: 0, color: '#1f2a36' });
    else if (b.t === BLUE && b.n >= 10) items.push(b.n >= 30 ? { type: 'barrel', ...toM(b.x0 + b.w / 2, b.y0 + b.h / 2), rot: 0, color: '#2f5f9e' } : { type: 'plate', ...toM(b.x0 + b.w / 2, b.y0 + b.h / 2), rot: 0 });
    else if (b.t === ORANGE && b.n >= 30) wallOf(b, 'mesh');
    else if ((b.t === GRAY || b.t === GREEN || b.t === PALE) && b.n >= 30 && long > short * 2.2) wallOf(b, 'wall');
    else if (b.t === RED && b.n >= 12) {
      if (fill < 0.35 && short > 6) items.push({ type: 'box', ...toM(b.x0 + b.w / 2, b.y0 + b.h / 2), rot: 0, w: +(b.w * mPerCell).toFixed(2), h: +(b.h * mPerCell).toFixed(2) });
      else if (long > short * 4) wallOf(b, 'fault');
    }
  }
  for (const it of items) if (it.type === 'fault') delete it.h;
  // une los trozos de muro alineados (una valla dibujada a tramos) en muros continuos
  const lin = items.filter((it) => ['wall', 'mesh', 'fault'].includes(it.type));
  for (let changed = true; changed;) {
    changed = false;
    for (const a of lin) for (const b of lin) {
      if (a === b || a.type !== b.type || a.rot !== b.rot || a.dead || b.dead) continue;
      const along = a.rot === 0 ? 'x' : 'd', across = a.rot === 0 ? 'd' : 'x';
      if (Math.abs(a[across] - b[across]) > 0.45) continue;
      const a0 = a[along] - a.w / 2, a1 = a[along] + a.w / 2, b0 = b[along] - b.w / 2, b1 = b[along] + b.w / 2;
      if (b0 - a1 > 0.6 || a0 - b1 > 0.6) continue;
      const lo = Math.min(a0, b0), hi = Math.max(a1, b1);
      a[along] = +((lo + hi) / 2).toFixed(2); a.w = +(hi - lo).toFixed(2); a[across] = +((a[across] + b[across]) / 2).toFixed(2);
      b.dead = true; changed = true;
    }
  }
  for (let i = items.length - 1; i >= 0; i--) if (items[i].dead) items.splice(i, 1);
  // no más tarjetas, poppers ni platos de los que dice la ficha
  const cap = (types, n) => {
    if (!n && n !== 0) return;
    let k = 0;
    for (let i = 0; i < items.length; i++) if (types.includes(items[i].type) && ++k > n) { items.splice(i, 1); i--; }
  };
  if (wantPaper) cap(['paper'], wantPaper);
  if (counts.popper != null || counts.plate != null) cap(['popper', 'plate'], (counts.popper || 0) + (counts.plate || 0));
  return { depthM, items };
}

// imagen del recorte (plantilla del suelo), comprimida
export function cropImage(pg, crop, maxW = 1100) {
  const s = Math.min(1, maxW / crop.w), c = document.createElement('canvas');
  c.width = Math.round(crop.w * s); c.height = Math.round(crop.h * s);
  c.getContext('2d').drawImage(pg.canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}
