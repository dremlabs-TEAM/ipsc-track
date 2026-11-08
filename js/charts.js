// Gráfico de evolución (canvas puro, sin dependencias).

export function lineChart(canvas, series, { goal = null, yMin = 0, yMax = 100 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue('--muted').trim() || '#8b97a6';
  const grid = css.getPropertyValue('--line').trim() || '#2a313a';
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const y = (v) => pad.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
  ctx.clearRect(0, 0, W, H);
  ctx.font = '11px Inter, sans-serif'; ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = yMin; v <= yMax; v += 20) {
    ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(W - pad.r, y(v)); ctx.stroke();
    ctx.fillText(v, pad.l - 6, y(v));
  }
  if (goal != null) {
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#d4ff3a'; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(pad.l, y(goal)); ctx.lineTo(W - pad.r, y(goal)); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#d4ff3a'; ctx.textAlign = 'left'; ctx.fillText(`objetivo ${goal}`, pad.l + 4, y(goal) - 8);
  }
  const pts = series.points;
  if (!pts.length) {
    ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.fillText('Aún no hay sesiones guardadas', W / 2, H / 2); return;
  }
  const x = (i) => pad.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  ctx.strokeStyle = series.color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.y)) : ctx.moveTo(x(i), y(p.y)))); ctx.stroke();
  for (let i = 0; i < pts.length; i++) {
    const v = pts[i].y; ctx.fillStyle = v >= 80 ? '#35d07f' : v >= 60 ? '#ffc53d' : '#ff4d4f';
    ctx.beginPath(); ctx.arc(x(i), y(v), 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const step = Math.ceil(pts.length / 8);
  pts.forEach((p, i) => { if (i % step === 0 || i === pts.length - 1) ctx.fillText(p.x, x(i), H - pad.b + 8); });
}
