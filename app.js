'use strict';
// Track-it: videoanálisis en el navegador.
// Coordenadas internas en píxeles de la imagen (y hacia abajo); las del usuario,
// en el sistema de ejes calibrado (y hacia arriba).

const $ = (id) => document.getElementById(id);
const video = $('video');
const view = $('view');
const vctx = view.getContext('2d');
const grab = document.createElement('canvas');
const gctx = grab.getContext('2d', { willReadFrequently: true });

const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#a66bd6', '#e05252'];
const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 120, 240, 480, 960];

const S = {
  loaded: false,
  file: null,
  W: 0, H: 0, duration: 0,
  fps: 30, fpsReal: 30, nFrames: 0,
  frame: 0,
  range: { start: 0, end: 0, step: 1 },
  calib: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, length: 1, unit: 'm', on: true },
  axes: { ox: 0, oy: 0, angle: 0 },
  tracks: [],
  sel: null,
  tool: 'move',
  show: { calib: true, axes: true, trails: true },
  view: { s: 1, tx: 0, ty: 0 },
  playing: false,
  auto: false,
};

let nextTrackId = 1;

/* ---------- utilidades ---------- */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { t.hidden = true; }, ms);
}

function busy(msg) {
  const b = $('busy');
  b.hidden = !msg;
  if (msg) b.textContent = msg;
}

function fmt(v) {
  if (v === null || v === undefined || !isFinite(v)) return '';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(3);
  return String(+v.toPrecision(4));
}

const sleepFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/* ---------- calibración y ejes ---------- */

function scale() {
  if (!S.calib.on) return 1;
  const d = dist(S.calib.a, S.calib.b);
  return d > 0 && S.calib.length > 0 ? S.calib.length / d : 1;
}
const unit = () => (S.calib.on ? S.calib.unit || 'm' : 'px');

function toWorld(p) {
  const s = scale();
  const dx = p.x - S.axes.ox, dy = -(p.y - S.axes.oy);
  const c = Math.cos(S.axes.angle), sn = Math.sin(S.axes.angle);
  return { x: (dx * c + dy * sn) * s, y: (-dx * sn + dy * c) * s };
}

const timeOf = (n) => (n - S.range.start) / S.fpsReal;

/* ---------- vídeo ---------- */

function loadVideo(file) {
  if (S.playing) togglePlay();
  S.auto = false;
  S.file = file;
  S.loaded = false;
  busy('Cargando vídeo…');
  if (video.src) URL.revokeObjectURL(video.src);
  video.src = URL.createObjectURL(file);
  video.load();
}

video.addEventListener('error', () => {
  busy(null);
  toast('El navegador no puede abrir este vídeo. Conviértelo a MP4 (H.264) o WebM y vuelve a probar.', 7000);
});

video.addEventListener('loadedmetadata', async () => {
  S.W = video.videoWidth;
  S.H = video.videoHeight;
  S.duration = video.duration;
  grab.width = S.W;
  grab.height = S.H;
  busy('Detectando fps…');
  const fps = await detectFps();
  setFps(fps, true);
  S.frame = 0;
  S.range = { start: 0, end: S.nFrames - 1, step: 1 };
  const L = Math.min(S.W, S.H);
  S.calib = { a: { x: S.W / 2 - L / 4, y: S.H * 0.85 }, b: { x: S.W / 2 + L / 4, y: S.H * 0.85 }, length: 1, unit: 'm', on: true };
  S.axes = { ox: S.W * 0.15, oy: S.H * 0.85, angle: 0 };
  S.tracks = [];
  nextTrackId = 1;
  addTrack(false);
  S.loaded = true;
  $('dropHint').hidden = true;
  ['btnSaveProject', 'btnCsv'].forEach((id) => { $(id).disabled = false; });
  fitView();
  await seekFrame(0);
  busy(null);
  hist.reset();
  restoreAutosave();
  syncAll();
});

// Los navegadores no dan los fps; se miden reproduciendo unos fotogramas.
function detectFps() {
  return new Promise((resolve) => {
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) { resolve(30); return; }
    const times = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.pause();
      const d = [];
      for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) d.push(times[i] - times[i - 1]);
      if (d.length < 3) { resolve(30); return; }
      d.sort((a, b) => a - b);
      // El menor intervalo frecuente es un fotograma (los saltos son caídas).
      const base = d[Math.floor(d.length * 0.25)];
      let fps = 1 / base;
      const near = COMMON_FPS.filter((c) => Math.abs(c - fps) / c < 0.02)
        .sort((a, b) => Math.abs(a - fps) - Math.abs(b - fps))[0];
      resolve(near || Math.round(fps * 100) / 100);
    };
    const cb = (now, meta) => {
      times.push(meta.mediaTime);
      if (times.length >= 16) finish();
      else video.requestVideoFrameCallback(cb);
    };
    video.muted = true;
    video.currentTime = 0;
    video.requestVideoFrameCallback(cb);
    const p = video.play();
    if (p) p.catch(() => finish());
    setTimeout(finish, 2500);
  });
}

function setFps(fps, alsoReal) {
  const prevReal = S.fpsReal, prevFps = S.fps;
  S.fps = fps;
  if (alsoReal || prevReal === prevFps) S.fpsReal = fps;
  S.nFrames = Math.max(1, Math.floor(S.duration * S.fps + 1e-6));
  S.range.end = Math.min(S.range.end || S.nFrames - 1, S.nFrames - 1);
  S.range.start = Math.min(S.range.start, S.range.end);
}

// Búsqueda serializada: si se piden fotogramas muy rápido, solo se atiende el último.
let seeking = null, wanted = null;
function seekFrame(n) {
  wanted = clamp(Math.round(n), 0, S.nFrames - 1);
  S.frame = wanted;
  if (!seeking) seeking = runSeek();
  return seeking;
}
async function runSeek() {
  while (wanted !== null) {
    const n = wanted;
    wanted = null;
    await seekRaw(n);
  }
  seeking = null;
  render();
  syncFrameUI();
}
function seekRaw(n) {
  return new Promise((resolve) => {
    const t = Math.min((n + 0.5) / S.fps, Math.max(0, S.duration - 1e-4));
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const onSeeked = () => done();
    video.addEventListener('seeked', onSeeked);
    setTimeout(done, 3000);
    video.currentTime = t;
  });
}

function togglePlay() {
  if (!S.loaded) return;
  if (S.playing) {
    video.pause();
    S.playing = false;
    seekFrame(Math.floor(video.currentTime * S.fps));
  } else {
    if (S.frame >= S.range.end) seekFrame(S.range.start);
    S.playing = true;
    video.play();
    const loop = () => {
      if (!S.playing) return;
      S.frame = clamp(Math.floor(video.currentTime * S.fps), 0, S.nFrames - 1);
      if (S.frame >= S.range.end || video.ended) { togglePlay(); return; }
      render();
      syncFrameUI();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  $('btnPlay').textContent = S.playing ? '❚❚' : '▶';
}

function step(k) {
  if (!S.loaded || S.auto) return;
  if (S.playing) togglePlay();
  seekFrame(clamp(S.frame + k * S.range.step, 0, S.nFrames - 1));
}

/* ---------- objetos ---------- */

function addTrack(select = true) {
  const id = nextTrackId++;
  const used = new Set(S.tracks.map((t) => t.color));
  const color = COLORS.find((c) => !used.has(c)) || COLORS[(id - 1) % COLORS.length];
  const tr = { id, name: 'Objeto ' + id, color, visible: true, points: {} };
  S.tracks.push(tr);
  if (select || !S.sel) S.sel = id;
  return tr;
}
const selTrack = () => S.tracks.find((t) => t.id === S.sel) || null;

function setPoint(tr, n, p) {
  tr.points[n] = { x: clamp(p.x, 0, S.W), y: clamp(p.y, 0, S.H) };
}

function sortedFrames(tr) {
  return Object.keys(tr.points).map(Number).sort((a, b) => a - b);
}

// Filas de datos con derivadas por diferencias centradas (admite huecos).
function trackRows(tr) {
  const fr = sortedFrames(tr).filter((n) => n >= S.range.start && n <= S.range.end);
  const rows = fr.map((n) => {
    const w = toWorld(tr.points[n]);
    return { frame: n, t: timeOf(n), x: w.x, y: w.y, r: Math.hypot(w.x, w.y) };
  });
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    r.vx = r.vy = r.v = r.ax = r.ay = r.a = NaN;
    if (i === 0 || i === rows.length - 1) continue;
    const p = rows[i - 1], q = rows[i + 1];
    const h1 = r.t - p.t, h2 = q.t - r.t;
    r.vx = (q.x - p.x) / (h1 + h2);
    r.vy = (q.y - p.y) / (h1 + h2);
    r.v = Math.hypot(r.vx, r.vy);
    r.ax = 2 * ((q.x - r.x) / h2 - (r.x - p.x) / h1) / (h1 + h2);
    r.ay = 2 * ((q.y - r.y) / h2 - (r.y - p.y) / h1) / (h1 + h2);
    r.a = Math.hypot(r.ax, r.ay);
  }
  return rows;
}

const VARS = [
  { k: 't', label: 't', u: () => 's' },
  { k: 'x', label: 'x', u: () => unit() },
  { k: 'y', label: 'y', u: () => unit() },
  { k: 'r', label: '|r|', u: () => unit() },
  { k: 'vx', label: 'vx', u: () => unit() + '/s' },
  { k: 'vy', label: 'vy', u: () => unit() + '/s' },
  { k: 'v', label: '|v|', u: () => unit() + '/s' },
  { k: 'ax', label: 'ax', u: () => unit() + '/s²' },
  { k: 'ay', label: 'ay', u: () => unit() + '/s²' },
  { k: 'a', label: '|a|', u: () => unit() + '/s²' },
  { k: 'frame', label: 'fotograma', u: () => '' },
];
const varOf = (k) => VARS.find((v) => v.k === k);
const varLabel = (k) => { const v = varOf(k); const u = v.u(); return u ? `${v.label} (${u})` : v.label; };

/* ---------- autotracking por correlación de plantilla ---------- */

function grayRegion(x0, y0, w, h) {
  const img = gctx.getImageData(x0, y0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * img[j] + 0.587 * img[j + 1] + 0.114 * img[j + 2];
  return g;
}

function grabFrame() { gctx.drawImage(video, 0, 0, S.W, S.H); }

function makeTemplate(raw, size) {
  const n = raw.length;
  let m = 0;
  for (let i = 0; i < n; i++) m += raw[i];
  m /= n;
  const z = new Float32Array(n);
  let ss = 0;
  for (let i = 0; i < n; i++) { z[i] = raw[i] - m; ss += z[i] * z[i]; }
  return { raw, z, norm: Math.sqrt(ss), size, half: (size - 1) / 2 };
}

function extractTemplate(p, size) {
  const h = (size - 1) / 2;
  const cx = Math.round(p.x), cy = Math.round(p.y);
  if (cx - h < 0 || cy - h < 0 || cx + h >= S.W || cy + h >= S.H) return null;
  return makeTemplate(grayRegion(cx - h, cy - h, size, size), size);
}

// Correlación cruzada normalizada (NCC) en una ventana alrededor de la predicción.
function matchTemplate(tpl, center, R) {
  const { size, half: h } = tpl;
  const cx = Math.round(center.x), cy = Math.round(center.y);
  const x0 = Math.max(0, cx - R - h), y0 = Math.max(0, cy - R - h);
  const x1 = Math.min(S.W, cx + R + h + 1), y1 = Math.min(S.H, cy + R + h + 1);
  const rw = x1 - x0, rh = y1 - y0;
  if (rw < size || rh < size) return null;
  const g = grayRegion(x0, y0, rw, rh);
  const nu = rw - size + 1, nv = rh - size + 1;
  const sc = new Float32Array(nu * nv);
  const N = size * size;
  let best = -2, bu = 0, bv = 0;
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      let s = 0, s2 = 0, c = 0, k = 0;
      for (let j = 0; j < size; j++) {
        let idx = (v + j) * rw + u;
        for (let i = 0; i < size; i++, idx++, k++) {
          const val = g[idx];
          s += val; s2 += val * val; c += val * tpl.z[k];
        }
      }
      const vr = s2 - (s * s) / N;
      const ncc = vr > 1e-6 && tpl.norm > 0 ? c / (Math.sqrt(vr) * tpl.norm) : 0;
      sc[v * nu + u] = ncc;
      if (ncc > best) { best = ncc; bu = u; bv = v; }
    }
  }
  // Ajuste parabólico para precisión de subpíxel.
  const at = (u, v) => sc[v * nu + u];
  let du = 0, dv = 0;
  if (bu > 0 && bu < nu - 1) {
    const l = at(bu - 1, bv), m = at(bu, bv), r = at(bu + 1, bv), den = l - 2 * m + r;
    if (den < 0) du = clamp(0.5 * (l - r) / den, -0.5, 0.5);
  }
  if (bv > 0 && bv < nv - 1) {
    const l = at(bu, bv - 1), m = at(bu, bv), r = at(bu, bv + 1), den = l - 2 * m + r;
    if (den < 0) dv = clamp(0.5 * (l - r) / den, -0.5, 0.5);
  }
  return { x: x0 + bu + h + du, y: y0 + bv + h + dv, score: best };
}

async function autotrack() {
  if (S.auto) { S.auto = false; return; }
  const tr = selTrack();
  if (!tr) return;
  const start = S.frame;
  if (!tr.points[start]) { toast('Marca primero el objeto en este fotograma (Mayús+clic).'); return; }
  if (S.playing) togglePlay();
  let size = parseInt($('tplSize').value, 10) || 21;
  if (size % 2 === 0) size++;
  const R = parseInt($('searchR').value, 10) || 30;
  const minScore = parseFloat($('matchMin').value) || 0;
  const evolve = $('tplEvolve').checked;

  await seekFrame(start);
  grabFrame();
  let tpl = extractTemplate(tr.points[start], size);
  if (!tpl) { toast('El punto está demasiado cerca del borde para esa plantilla.'); return; }
  if (tpl.norm < 1e-3 * size) { toast('La plantilla es uniforme (sin contraste): elige un punto con más detalle.'); return; }
  const base = tpl;

  S.auto = true;
  syncAutoBtn();
  const k = S.range.step;
  let prev = tr.points[start], prev2 = tr.points[start - k] || null;
  let count = 0, stopMsg = null;
  for (let n = start + k; n <= S.range.end; n += k) {
    if (!S.auto) { stopMsg = 'Autotrack detenido.'; break; }
    const pred = prev2 ? { x: 2 * prev.x - prev2.x, y: 2 * prev.y - prev2.y } : prev;
    await seekFrame(n);
    grabFrame();
    let m = matchTemplate(tpl, pred, R);
    // Si la predicción falla (choque, cambio brusco), se reintenta centrado en la última posición.
    if ((!m || m.score < minScore) && prev2) {
      const m2 = matchTemplate(tpl, prev, R);
      if (m2 && (!m || m2.score > m.score)) m = m2;
    }
    if (!m || m.score < minScore) {
      stopMsg = `Autotrack parado en el fotograma ${n}: coincidencia ${m ? m.score.toFixed(2) : '–'} < ${minScore}. Márcalo a mano y sigue.`;
      break;
    }
    setPoint(tr, n, m);
    prev2 = prev;
    prev = tr.points[n];
    count++;
    if (evolve) {
      const cur = extractTemplate(prev, size);
      if (cur) {
        const mix = new Float32Array(cur.raw.length);
        for (let i = 0; i < mix.length; i++) mix[i] = 0.7 * tpl.raw[i] + 0.2 * cur.raw[i] + 0.1 * base.raw[i];
        tpl = makeTemplate(mix, size);
      }
    }
    render();
    syncFrameUI();
    if (count % 4 === 0) { syncData(); await sleepFrame(); }
  }
  S.auto = false;
  syncAutoBtn();
  hist.commit();
  syncAll();
  toast(stopMsg ? `${stopMsg} (${count} puntos nuevos)` : `Autotrack terminado: ${count} puntos nuevos.`, stopMsg ? 6000 : 3200);
}

/* ---------- vista: zoom, desplazamiento y dibujo ---------- */

let dpr = 1;
function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  const r = view.getBoundingClientRect();
  view.width = Math.round(r.width * dpr);
  view.height = Math.round(r.height * dpr);
  render();
}

function fitView() {
  const r = view.getBoundingClientRect();
  if (!S.W) return;
  const s = Math.min(r.width / S.W, r.height / S.H) * 0.96;
  S.view = { s, tx: (r.width - S.W * s) / 2, ty: (r.height - S.H * s) / 2 };
  render();
}

const toScreen = (p) => ({ x: p.x * S.view.s + S.view.tx, y: p.y * S.view.s + S.view.ty });
const toImage = (p) => ({ x: (p.x - S.view.tx) / S.view.s, y: (p.y - S.view.ty) / S.view.s });

function axisDirs() {
  const c = Math.cos(S.axes.angle), s = Math.sin(S.axes.angle);
  return { ex: { x: c, y: -s }, ey: { x: -s, y: -c } };
}
function axisHandle() {
  const o = toScreen({ x: S.axes.ox, y: S.axes.oy });
  const { ex } = axisDirs();
  return { x: o.x + ex.x * 70, y: o.y + ex.y * 70 };
}

let hover = null;

function render() {
  const ctx = vctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0b0a';
  ctx.fillRect(0, 0, view.width, view.height);
  if (!S.loaded && !S.W) return;
  const { s, tx, ty } = S.view;
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);
  ctx.imageSmoothingEnabled = s < 2.5;
  try { ctx.drawImage(video, 0, 0, S.W, S.H); } catch (e) { /* aún sin fotograma */ }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (S.show.axes) drawAxes(ctx);
  if (S.show.calib) drawCalib(ctx);
  for (const tr of S.tracks) if (tr.visible) drawTrack(ctx, tr);
}

function outlinedLine(ctx, pts, color, w) {
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.strokeStyle = 'rgba(0,0,0,.65)';
  ctx.lineWidth = w + 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function label(ctx, text, x, y, color = '#fff') {
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,.8)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawAxes(ctx) {
  const o = toScreen({ x: S.axes.ox, y: S.axes.oy });
  const { ex, ey } = axisDirs();
  const L = 4000;
  const col = '#f0c419';
  outlinedLine(ctx, [{ x: o.x - ex.x * L, y: o.y - ex.y * L }, { x: o.x + ex.x * L, y: o.y + ex.y * L }], col, 1.5);
  outlinedLine(ctx, [{ x: o.x - ey.x * L, y: o.y - ey.y * L }, { x: o.x + ey.x * L, y: o.y + ey.y * L }], col, 1.5);
  label(ctx, 'x', o.x + ex.x * 90 + 4, o.y + ex.y * 90 + 14, col);
  label(ctx, 'y', o.x + ey.x * 90 + 6, o.y + ey.y * 90, col);
  const h = axisHandle();
  ctx.beginPath(); ctx.arc(h.x, h.y, 5, 0, 7);
  ctx.fillStyle = hover && hover.kind === 'angle' ? '#fff' : col; ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(o.x, o.y, 6, 0, 7);
  ctx.fillStyle = hover && hover.kind === 'origin' ? '#fff' : col; ctx.fill(); ctx.stroke();
}

function drawCalib(ctx) {
  const a = toScreen(S.calib.a), b = toScreen(S.calib.b);
  const col = '#4aa3ff';
  outlinedLine(ctx, [a, b], col, 2);
  const ang = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(ang) * 8, ny = Math.cos(ang) * 8;
  for (const p of [a, b]) outlinedLine(ctx, [{ x: p.x - nx, y: p.y - ny }, { x: p.x + nx, y: p.y + ny }], col, 2);
  for (const [p, k] of [[a, 'ca'], [b, 'cb']]) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7);
    ctx.fillStyle = hover && hover.kind === k ? '#fff' : col; ctx.fill();
  }
  const txt = S.calib.on ? `${fmt(S.calib.length)} ${S.calib.unit}` : `${fmt(dist(S.calib.a, S.calib.b))} px`;
  label(ctx, txt, (a.x + b.x) / 2 + nx * 1.6 - 14, (a.y + b.y) / 2 + ny * 1.6 + 4, col);
}

function drawTrack(ctx, tr) {
  const frames = sortedFrames(tr);
  const isSel = tr.id === S.sel;
  if (S.show.trails && frames.length > 1) {
    const pts = frames.filter((n) => n <= S.frame || isSel).map((n) => toScreen(tr.points[n]));
    ctx.globalAlpha = isSel ? 0.85 : 0.55;
    outlinedLine(ctx, pts, tr.color, 1.2);
    ctx.globalAlpha = 1;
  }
  if (S.show.trails) {
    for (const n of frames) {
      if (n === S.frame) continue;
      const p = toScreen(tr.points[n]);
      ctx.beginPath(); ctx.arc(p.x, p.y, isSel ? 3 : 2.2, 0, 7);
      ctx.fillStyle = tr.color; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  const cur = tr.points[S.frame];
  if (cur) {
    const p = toScreen(cur);
    const hot = hover && hover.kind === 'pt' && hover.tr === tr;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, 7); ctx.stroke();
    ctx.strokeStyle = hot ? '#fff' : tr.color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.stroke();
    outlinedLine(ctx, [{ x: p.x - 3, y: p.y }, { x: p.x + 3, y: p.y }], tr.color, 1);
    outlinedLine(ctx, [{ x: p.x, y: p.y - 3 }, { x: p.x, y: p.y + 3 }], tr.color, 1);
    if (isSel && S.auto) {
      const h = (parseInt($('tplSize').value, 10) || 21) / 2 * S.view.s;
      ctx.strokeStyle = tr.color; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.strokeRect(p.x - h, p.y - h, 2 * h, 2 * h);
      ctx.setLineDash([]);
    }
    label(ctx, tr.name, p.x + 11, p.y - 9, tr.color);
  }
}

/* ---------- ratón sobre el vídeo ---------- */

function hitTest(sp) {
  const R = 9;
  for (const tr of [selTrack(), ...S.tracks].filter(Boolean)) {
    const p = tr.visible && tr.points[S.frame];
    if (p && dist(toScreen(p), sp) < R) return { kind: 'pt', tr };
  }
  if (S.show.calib) {
    if (dist(toScreen(S.calib.a), sp) < R) return { kind: 'ca' };
    if (dist(toScreen(S.calib.b), sp) < R) return { kind: 'cb' };
  }
  if (S.show.axes) {
    if (dist(axisHandle(), sp) < R) return { kind: 'angle' };
    if (dist(toScreen({ x: S.axes.ox, y: S.axes.oy }), sp) < R) return { kind: 'origin' };
  }
  return null;
}

let drag = null;
const evPos = (e) => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

view.addEventListener('contextmenu', (e) => e.preventDefault());

view.addEventListener('pointerdown', (e) => {
  if (!S.loaded || S.auto) return;
  const sp = evPos(e);
  view.setPointerCapture(e.pointerId);
  if (e.button === 1 || e.button === 2) { drag = { kind: 'pan', sp, v: { ...S.view } }; return; }
  if (e.button !== 0) return;
  if (S.playing) togglePlay();
  const marking = S.tool === 'mark' || e.shiftKey;
  if (marking) {
    let tr = selTrack();
    if (!tr) { tr = addTrack(); }
    setPoint(tr, S.frame, toImage(sp));
    hist.commit();
    syncData();
    render();
    const nx = S.frame + S.range.step;
    if (nx <= S.range.end) seekFrame(nx);
    return;
  }
  const h = hitTest(sp);
  if (h) {
    if (h.kind === 'pt') { S.sel = h.tr.id; syncTracks(); }
    drag = { ...h, sp, moved: false };
  } else {
    drag = { kind: 'pan', sp, v: { ...S.view } };
  }
});

view.addEventListener('pointermove', (e) => {
  if (!S.loaded) return;
  const sp = evPos(e);
  const ip = toImage(sp);
  const inside = ip.x >= 0 && ip.y >= 0 && ip.x <= S.W && ip.y <= S.H;
  if (inside) {
    const w = toWorld(ip);
    $('cursorReadout').textContent = `x = ${fmt(w.x)}  y = ${fmt(w.y)} ${unit()}`;
  } else $('cursorReadout').textContent = '';

  if (!drag) {
    const h = S.auto ? null : hitTest(sp);
    const changed = (h && h.kind) !== (hover && hover.kind) || (h && hover && h.tr !== hover.tr);
    hover = h;
    view.style.cursor = h ? (h.kind === 'pt' || h.kind === 'origin' ? 'move' : 'grab') : (S.tool === 'mark' || e.shiftKey ? 'crosshair' : 'default');
    if (changed) render();
    return;
  }
  if (drag.kind === 'pan') {
    S.view.tx = drag.v.tx + sp.x - drag.sp.x;
    S.view.ty = drag.v.ty + sp.y - drag.sp.y;
    view.style.cursor = 'grabbing';
  } else {
    drag.moved = true;
    const p = { x: clamp(ip.x, 0, S.W), y: clamp(ip.y, 0, S.H) };
    if (drag.kind === 'pt') setPoint(drag.tr, S.frame, p);
    else if (drag.kind === 'ca') S.calib.a = p;
    else if (drag.kind === 'cb') S.calib.b = p;
    else if (drag.kind === 'origin') { S.axes.ox = p.x; S.axes.oy = p.y; }
    else if (drag.kind === 'angle') {
      const o = toScreen({ x: S.axes.ox, y: S.axes.oy });
      let a = Math.atan2(-(sp.y - o.y), sp.x - o.x);
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      S.axes.angle = a;
    }
    syncCalibUI();
    syncData();
  }
  render();
});

view.addEventListener('pointerup', () => {
  if (drag && drag.moved) hist.commit();
  drag = null;
});

view.addEventListener('wheel', (e) => {
  if (!S.loaded) return;
  e.preventDefault();
  const sp = evPos(e);
  const f = Math.exp(-e.deltaY * 0.0015);
  const s = clamp(S.view.s * f, 0.05, 40);
  const k = s / S.view.s;
  S.view.tx = sp.x - (sp.x - S.view.tx) * k;
  S.view.ty = sp.y - (sp.y - S.view.ty) * k;
  S.view.s = s;
  render();
}, { passive: false });

/* ---------- gráfica ---------- */

const plot = $('plot');
const pctx = plot.getContext('2d');
let plotState = null;

function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) { const d = Math.abs(lo) || 1; lo -= d * 0.5; hi += d * 0.5; }
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const st = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw);
  const a = Math.floor(lo / st) * st, b = Math.ceil(hi / st) * st;
  const ticks = [];
  for (let v = a; v <= b + st * 1e-9; v += st) ticks.push(+v.toPrecision(12));
  return { lo: a, hi: b, ticks };
}

// Mínimos cuadrados polinómicos con la variable centrada y escalada (estable).
function polyfit(xs, ys, deg) {
  const n = xs.length;
  if (n <= deg) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const sx = Math.max(...xs.map((x) => Math.abs(x - mx))) || 1;
  const u = xs.map((x) => (x - mx) / sx);
  const m = deg + 1;
  const A = Array.from({ length: m }, () => new Array(m + 1).fill(0));
  for (let i = 0; i < n; i++) {
    const pw = [1];
    for (let k = 1; k < 2 * m; k++) pw[k] = pw[k - 1] * u[i];
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) A[r][c] += pw[r + c];
      A[r][m] += pw[r] * ys[i];
    }
  }
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-14) return null;
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k];
    }
  }
  const b = A.map((row, i) => row[m] / row[i]); // coeficientes en u
  // Pasar a coeficientes en x: y = Σ b_k ((x - mx)/sx)^k
  const coef = new Array(m).fill(0);
  for (let k = 0; k < m; k++) {
    const bk = b[k] / Math.pow(sx, k);
    for (let j = 0; j <= k; j++) coef[j] += bk * binom(k, j) * Math.pow(-mx, k - j);
  }
  const f = (x) => coef.reduce((acc, c, k) => acc + c * Math.pow(x, k), 0);
  const my = ys.reduce((a, b2) => a + b2, 0) / n;
  let ssr = 0, sst = 0;
  for (let i = 0; i < n; i++) { ssr += (ys[i] - f(xs[i])) ** 2; sst += (ys[i] - my) ** 2; }
  return { coef, f, r2: sst > 0 ? 1 - ssr / sst : 1 };
}
function binom(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }

function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

function drawPlot() {
  const r = plot.getBoundingClientRect();
  const W = r.width, H = r.height;
  plot.width = Math.round(W * dpr);
  plot.height = Math.round(H * dpr);
  const ctx = pctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const ink = cssVar('--text-secondary'), muted = cssVar('--text-muted'), grid = cssVar('--grid');
  const tr = selTrack();
  const kx = $('plotX').value, ky = $('plotY').value;
  const rows = tr ? trackRows(tr) : [];
  const pts = rows.filter((d) => isFinite(d[kx]) && isFinite(d[ky])).map((d) => ({ x: d[kx], y: d[ky], d }));
  $('fitOut').textContent = '';
  plotState = null;
  ctx.font = '11px system-ui, sans-serif';
  if (!pts.length) {
    ctx.fillStyle = muted;
    ctx.textAlign = 'center';
    ctx.fillText(tr ? 'Sin datos todavía: marca puntos del objeto' : 'Crea un objeto', W / 2, H / 2);
    ctx.textAlign = 'left';
    return;
  }
  const deg = +$('fitType').value;
  const fit = deg ? polyfit(pts.map((p) => p.x), pts.map((p) => p.y), deg) : null;

  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const tx = niceTicks(Math.min(...xs), Math.max(...xs));
  const ty = niceTicks(Math.min(...ys), Math.max(...ys));
  const yLabels = ty.ticks.map(fmt);
  ctx.font = '11px ui-monospace, Consolas, monospace';
  const padL = Math.max(...yLabels.map((s) => ctx.measureText(s).width)) + 14;
  const pad = { l: padL, r: 12, t: 22, b: 30 };
  const X = (v) => pad.l + ((v - tx.lo) / (tx.hi - tx.lo)) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - ((v - ty.lo) / (ty.hi - ty.lo)) * (H - pad.t - pad.b);

  ctx.strokeStyle = grid; ctx.lineWidth = 1;
  ctx.fillStyle = muted;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ty.ticks.forEach((v, i) => {
    const y = Math.round(Y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillText(yLabels[i], pad.l - 6, y);
  });
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  tx.ticks.forEach((v) => {
    const x = Math.round(X(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke();
    ctx.fillText(fmt(v), x, H - pad.b + 5);
  });
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillStyle = ink;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`${tr.name}: ${varLabel(ky)}`, 4, 4);
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(varLabel(kx), W - pad.r, H - 2);

  ctx.save();
  ctx.beginPath(); ctx.rect(pad.l, pad.t - 4, W - pad.l - pad.r, H - pad.t - pad.b + 8); ctx.clip();
  if (fit) {
    ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const xv = tx.lo + ((tx.hi - tx.lo) * i) / steps;
      const px = X(xv), py = Y(fit.f(xv));
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  if (kx === 't' || kx === 'frame') {
    ctx.strokeStyle = tr.color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const surf = cssVar('--surface-1');
  for (const p of pts) {
    const cur = p.d.frame === S.frame;
    ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), cur ? 5.5 : 3.5, 0, 7);
    ctx.fillStyle = tr.color; ctx.fill();
    ctx.strokeStyle = cur ? cssVar('--text-primary') : surf; ctx.lineWidth = cur ? 2 : 1.5; ctx.stroke();
  }
  ctx.restore();

  if (deg && !fit) $('fitOut').textContent = `Hacen falta al menos ${deg + 1} puntos para este ajuste.`;
  if (fit) {
    const names = ['', ' x', ' x²', ' x³'];
    const terms = fit.coef.map((c, k) => ({ c, k })).reverse();
    const yv = varOf(ky).label, xv = varOf(kx).label;
    let eq = `${yv} = `;
    terms.forEach(({ c, k }, i) => {
      const s = fmt(Math.abs(c));
      eq += (i === 0 ? (c < 0 ? '−' : '') : c < 0 ? ' − ' : ' + ') + s + names[k].replace('x', xv);
    });
    const letters = 'ABCD';
    const parts = fit.coef.map((c, k) => `${letters[deg - k]} = ${fmt(c)}`).reverse();
    $('fitOut').textContent = `${eq}\n${parts.join('   ')}   R² = ${fit.r2.toFixed(5)}`;
  }
  plotState = { pts, X, Y, kx, ky, tr };
}

function plotHover(e) {
  const tip = $('plotTip');
  if (!plotState) { tip.hidden = true; return null; }
  const r = plot.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  let best = null, bd = 18;
  for (const p of plotState.pts) {
    const d = Math.hypot(plotState.X(p.x) - mx, plotState.Y(p.y) - my);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) { tip.hidden = true; return null; }
  tip.hidden = false;
  tip.innerHTML = `<b>Fotograma ${best.d.frame}</b><br>${varLabel(plotState.kx)}: ${fmt(best.x)}<br>${varLabel(plotState.ky)}: ${fmt(best.y)}`;
  const px = plotState.X(best.x), py = plotState.Y(best.y);
  const tw = tip.offsetWidth;
  tip.style.left = clamp(px + 12 + tw > r.width ? px - tw - 12 : px + 12, 0, r.width - tw) + 'px';
  tip.style.top = clamp(py - 50, 0, r.height - 60) + 'px';
  return best;
}
plot.addEventListener('pointermove', plotHover);
plot.addEventListener('pointerleave', () => { $('plotTip').hidden = true; });
plot.addEventListener('click', (e) => { const p = plotHover(e); if (p) seekFrame(p.d.frame); });

/* ---------- tabla ---------- */

function drawTable() {
  const tr = selTrack();
  const tbl = $('dataTable');
  const cols = ['frame', 't', 'x', 'y', 'vx', 'vy', 'ax', 'ay'];
  const head = `<thead><tr>${cols.map((k) => `<th>${k === 'frame' ? 'fot.' : varLabel(k)}</th>`).join('')}</tr></thead>`;
  const rows = tr ? trackRows(tr) : [];
  if (!rows.length) { tbl.innerHTML = head + '<tbody><tr><td class="empty" colspan="8">Sin puntos</td></tr></tbody>'; return; }
  tbl.innerHTML = head + '<tbody>' + rows.map((d) =>
    `<tr data-f="${d.frame}"${d.frame === S.frame ? ' class="cur"' : ''}>${cols.map((k) => `<td>${k === 'frame' ? d.frame : fmt(d[k])}</td>`).join('')}</tr>`
  ).join('') + '</tbody>';
}
$('dataTable').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-f]');
  if (row) seekFrame(+row.dataset.f);
});

function highlightTableRow() {
  const tbl = $('dataTable');
  tbl.querySelectorAll('tr.cur').forEach((r) => r.classList.remove('cur'));
  const row = tbl.querySelector(`tr[data-f="${S.frame}"]`);
  if (row) {
    row.classList.add('cur');
    const wrap = tbl.parentElement;
    if (row.offsetTop < wrap.scrollTop + 24 || row.offsetTop > wrap.scrollTop + wrap.clientHeight - 24) {
      wrap.scrollTop = row.offsetTop - wrap.clientHeight / 2;
    }
  }
}

/* ---------- sincronizar interfaz ---------- */

function syncFrameUI() {
  if (!S.loaded) return;
  $('slider').max = S.nFrames - 1;
  $('slider').value = S.frame;
  $('frameReadout').textContent = `fot. ${S.frame} / ${S.nFrames - 1}   t = ${fmt(timeOf(S.frame))} s`;
  highlightTableRow();
  if (plotState) drawPlot();
}

function syncCalibUI() {
  const s = scale();
  $('scaleOut').textContent = S.calib.on ? `${fmt(1 / s)} px/${S.calib.unit}` : '1 px';
  if (document.activeElement !== $('axesAngle')) $('axesAngle').value = +(S.axes.angle * 180 / Math.PI).toFixed(2);
}

function syncInputs() {
  $('fps').value = S.fps;
  $('fpsReal').value = S.fpsReal;
  $('rangeStart').value = S.range.start;
  $('rangeEnd').value = S.range.end;
  $('rangeStep').value = S.range.step;
  $('rangeStart').max = $('rangeEnd').max = S.nFrames - 1;
  $('dtOut').textContent = `${fmt(S.range.step / S.fpsReal)} s`;
  $('calibLen').value = S.calib.length;
  $('calibUnit').value = S.calib.unit;
  $('calibOn').checked = S.calib.on;
  syncCalibUI();
}

function syncTracks() {
  const list = $('trackList');
  list.innerHTML = '';
  for (const tr of S.tracks) {
    const row = document.createElement('div');
    row.className = 'track' + (tr.id === S.sel ? ' sel' : '');
    row.innerHTML = `<input type="checkbox" class="vis" title="Mostrar" ${tr.visible ? 'checked' : ''}>
      <input type="color" value="${tr.color}" title="Color">
      <input type="text" value="" aria-label="Nombre">
      <span class="count" title="Puntos marcados">${Object.keys(tr.points).length}</span>
      <button title="Borrar objeto">✕</button>`;
    const [vis, col, name] = row.querySelectorAll('input');
    name.value = tr.name;
    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || S.sel === tr.id) return;
      S.sel = tr.id;
      // Sin reconstruir la lista, para no quitar el foco al campo del nombre.
      list.querySelectorAll('.track').forEach((el) => el.classList.toggle('sel', el === row));
      syncData();
      render();
    });
    vis.addEventListener('change', () => { tr.visible = vis.checked; hist.commit(); render(); });
    col.addEventListener('input', () => { tr.color = col.value; render(); drawPlot(); });
    col.addEventListener('change', () => hist.commit());
    name.addEventListener('change', () => { tr.name = name.value.trim() || tr.name; hist.commit(); render(); drawPlot(); });
    row.querySelector('button').addEventListener('click', () => {
      const n = Object.keys(tr.points).length;
      if (n && !confirm(`¿Borrar "${tr.name}" y sus ${n} puntos?`)) return;
      S.tracks = S.tracks.filter((t) => t !== tr);
      if (S.sel === tr.id) S.sel = S.tracks.length ? S.tracks[0].id : null;
      hist.commit();
      syncAll();
    });
    list.appendChild(row);
  }
  syncAutoBtn();
}

function syncAutoBtn() {
  const b = $('btnAuto');
  b.disabled = !S.loaded || !selTrack();
  b.textContent = S.auto ? 'Detener autotrack' : 'Autotrack desde aquí';
  b.classList.toggle('danger', S.auto);
}

function syncData() {
  drawPlot();
  drawTable();
  highlightTableRow();
  const tr = selTrack();
  const c = $('trackList').querySelector('.track.sel .count');
  if (tr && c) c.textContent = Object.keys(tr.points).length;
}

function syncAll() {
  syncInputs();
  syncTracks();
  syncData();
  syncFrameUI();
  render();
  hist.syncButtons();
}

/* ---------- deshacer, autoguardado y proyectos ---------- */

function snapshot() {
  return JSON.stringify({
    fps: S.fps, fpsReal: S.fpsReal, range: S.range, calib: S.calib, axes: S.axes,
    tracks: S.tracks, sel: S.sel, nextTrackId,
  });
}
function applySnapshot(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  if (d.fps) setFps(d.fps, true);
  if (d.fpsReal) S.fpsReal = d.fpsReal;
  if (d.range) S.range = { start: clamp(d.range.start | 0, 0, S.nFrames - 1), end: clamp(d.range.end | 0, 0, S.nFrames - 1), step: Math.max(1, d.range.step | 0) };
  if (d.calib) S.calib = d.calib;
  if (d.axes) S.axes = d.axes;
  if (d.tracks) S.tracks = d.tracks;
  S.sel = S.tracks.some((t) => t.id === d.sel) ? d.sel : (S.tracks[0] && S.tracks[0].id) || null;
  nextTrackId = d.nextTrackId || Math.max(0, ...S.tracks.map((t) => t.id)) + 1;
}

const hist = {
  stack: [], pos: -1,
  reset() { this.stack = [snapshot()]; this.pos = 0; this.syncButtons(); },
  commit() {
    const s = snapshot();
    if (this.stack[this.pos] === s) return;
    this.stack = this.stack.slice(0, this.pos + 1);
    this.stack.push(s);
    if (this.stack.length > 200) this.stack.shift();
    this.pos = this.stack.length - 1;
    this.syncButtons();
    autosave(s);
  },
  go(k) {
    const p = this.pos + k;
    if (p < 0 || p >= this.stack.length) return;
    this.pos = p;
    applySnapshot(this.stack[p]);
    autosave(this.stack[p]);
    syncAll();
  },
  syncButtons() {
    $('btnUndo').disabled = this.pos <= 0;
    $('btnRedo').disabled = this.pos >= this.stack.length - 1;
  },
};

const autosaveKey = () => S.file ? `track-it:${S.file.name}:${S.file.size}` : null;
function autosave(s) {
  const k = autosaveKey();
  if (!k) return;
  try { localStorage.setItem(k, s); } catch (e) { /* almacenamiento no disponible */ }
}
function restoreAutosave() {
  const k = autosaveKey();
  let s = null;
  try { s = localStorage.getItem(k); } catch (e) { return; }
  if (!s) return;
  try {
    const d = JSON.parse(s);
    const n = (d.tracks || []).reduce((a, t) => a + Object.keys(t.points).length, 0);
    if (n && confirm(`Hay un análisis guardado de este vídeo (${n} puntos). ¿Recuperarlo?`)) {
      applySnapshot(d);
      hist.reset();
    }
  } catch (e) { /* guardado corrupto: se ignora */ }
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const baseName = () => (S.file ? S.file.name.replace(/\.[^.]+$/, '') : 'track-it');

function saveProject() {
  const d = JSON.parse(snapshot());
  d.app = 'track-it';
  d.version = 1;
  d.video = { name: S.file && S.file.name, size: S.file && S.file.size, width: S.W, height: S.H };
  download(baseName() + '.trackit.json', JSON.stringify(d, null, 1), 'application/json');
}

function openProject(file) {
  file.text().then((txt) => {
    let d;
    try { d = JSON.parse(txt); } catch (e) { toast('El archivo no es un proyecto válido.'); return; }
    if (d.app !== 'track-it') { toast('El archivo no es un proyecto de Track-it.'); return; }
    if (!S.loaded) { toast(`Abre primero el vídeo${d.video && d.video.name ? ` (${d.video.name})` : ''} y luego el proyecto.`, 5000); return; }
    if (d.video && d.video.name && S.file && d.video.name !== S.file.name &&
        !confirm(`El proyecto es del vídeo "${d.video.name}" y tienes abierto "${S.file.name}". ¿Cargarlo igualmente?`)) return;
    applySnapshot(d);
    hist.commit();
    syncAll();
    toast('Proyecto cargado.');
  });
}

function exportCsv() {
  const excel = confirm('¿Formato para Excel en español (separador ";" y coma decimal)?\nAceptar: sí · Cancelar: CSV estándar (separador "," y punto decimal)');
  const sep = excel ? ';' : ',';
  const num = (v) => {
    if (!isFinite(v)) return '';
    const s = String(+v.toPrecision(8));
    return excel ? s.replace('.', ',') : s;
  };
  const cols = ['frame', 't', 'x', 'y', 'r', 'vx', 'vy', 'v', 'ax', 'ay', 'a'];
  const head = ['objeto', ...cols.map((k) => (k === 'frame' ? 'fotograma' : varLabel(k)))];
  const lines = [head.join(sep)];
  for (const tr of S.tracks) {
    for (const d of trackRows(tr)) {
      const name = /[;,"]/.test(tr.name) ? `"${tr.name.replace(/"/g, '""')}"` : tr.name;
      lines.push([name, d.frame, ...cols.slice(1).map((k) => num(d[k]))].join(sep));
    }
  }
  if (lines.length === 1) { toast('No hay puntos que exportar.'); return; }
  download(baseName() + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

/* ---------- controles ---------- */

$('fileVideo').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadVideo(f); e.target.value = ''; });
$('fileProject').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openProject(f); e.target.value = ''; });
$('btnSaveProject').addEventListener('click', saveProject);
$('btnCsv').addEventListener('click', exportCsv);
$('btnUndo').addEventListener('click', () => hist.go(-1));
$('btnRedo').addEventListener('click', () => hist.go(1));
$('btnHelp').addEventListener('click', () => $('help').showModal());
$('btnFit').addEventListener('click', fitView);
$('btnAddTrack').addEventListener('click', () => {
  if (!S.loaded) return;
  addTrack();
  hist.commit();
  syncAll();
});
$('btnAuto').addEventListener('click', autotrack);
$('btnPlay').addEventListener('click', togglePlay);
$('btnPrev').addEventListener('click', () => step(-1));
$('btnNext').addEventListener('click', () => step(1));
$('btnStart').addEventListener('click', () => { if (S.loaded) seekFrame(S.range.start); });
$('btnEnd').addEventListener('click', () => { if (S.loaded) seekFrame(S.range.end); });
$('slider').addEventListener('input', (e) => {
  if (S.auto) { e.target.value = S.frame; return; }
  if (S.playing) togglePlay();
  seekFrame(+e.target.value);
});
// Que Espacio no vuelva a pulsar el último botón usado.
document.addEventListener('click', (e) => { const b = e.target.closest('button, .seg-btn'); if (b) b.blur(); });

document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
function setTool(t) {
  S.tool = t;
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  view.style.cursor = t === 'mark' ? 'crosshair' : 'default';
}

for (const [id, key] of [['showCalib', 'calib'], ['showAxes', 'axes'], ['showTrails', 'trails']]) {
  $(id).addEventListener('change', (e) => { S.show[key] = e.target.checked; render(); });
}

function numInput(id, fn) {
  $(id).addEventListener('change', (e) => {
    const v = parseFloat(e.target.value);
    if (!S.loaded || !isFinite(v)) { syncInputs(); return; }
    fn(v);
    hist.commit();
    syncAll();
  });
}
numInput('fps', (v) => { if (v > 0) { setFps(v, false); seekFrame(Math.min(S.frame, S.nFrames - 1)); } });
numInput('fpsReal', (v) => { if (v > 0) S.fpsReal = v; });
numInput('rangeStart', (v) => { S.range.start = clamp(Math.round(v), 0, S.range.end); });
numInput('rangeEnd', (v) => { S.range.end = clamp(Math.round(v), S.range.start, S.nFrames - 1); });
numInput('rangeStep', (v) => { S.range.step = Math.max(1, Math.round(v)); });
numInput('calibLen', (v) => { if (v > 0) S.calib.length = v; });
numInput('axesAngle', (v) => { S.axes.angle = (v * Math.PI) / 180; });
$('calibUnit').addEventListener('change', (e) => { S.calib.unit = e.target.value.trim() || 'm'; hist.commit(); syncAll(); });
$('calibOn').addEventListener('change', (e) => { S.calib.on = e.target.checked; hist.commit(); syncAll(); });

function fillVarSelect(sel, def) {
  sel.innerHTML = VARS.map((v) => `<option value="${v.k}">${v.label}</option>`).join('');
  sel.value = def;
}
fillVarSelect($('plotX'), 't');
fillVarSelect($('plotY'), 'y');
['plotX', 'plotY', 'fitType'].forEach((id) => $(id).addEventListener('change', drawPlot));

document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if ((tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if ($('help').open) return;
  const k = e.key;
  if (S.auto) { if (k === 'Escape') S.auto = false; return; }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); hist.go(e.shiftKey ? 1 : -1); return; }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') { e.preventDefault(); hist.go(1); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 10 : 1); }
  else if (k === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -10 : -1); }
  else if (k === 'Home') { e.preventDefault(); if (S.loaded) seekFrame(S.range.start); }
  else if (k === 'End') { e.preventDefault(); if (S.loaded) seekFrame(S.range.end); }
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'm' || k === 'M') setTool('mark');
  else if (k === 'v' || k === 'V') setTool('move');
  else if (k === 'f' || k === 'F') fitView();
  else if (k === '?') $('help').showModal();
  else if (k === 'Delete' || k === 'Backspace') {
    const tr = selTrack();
    if (tr && tr.points[S.frame]) { delete tr.points[S.frame]; hist.commit(); syncData(); render(); }
  } else if (k === 'Escape' && S.auto) S.auto = false;
});

// Arrastrar y soltar vídeos o proyectos.
const stage = $('stage');
stage.addEventListener('dragover', (e) => { e.preventDefault(); $('dropHint').classList.add('over'); $('dropHint').hidden = false; });
stage.addEventListener('dragleave', () => { $('dropHint').classList.remove('over'); if (S.loaded) $('dropHint').hidden = true; });
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  $('dropHint').classList.remove('over');
  if (S.loaded) $('dropHint').hidden = true;
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (/\.json$/i.test(f.name)) openProject(f);
  else loadVideo(f);
});

window.addEventListener('resize', () => { resizeCanvas(); drawPlot(); });
window.addEventListener('beforeunload', (e) => {
  if (S.loaded && hist.pos > 0) { e.preventDefault(); e.returnValue = ''; }
});

resizeCanvas();
syncTracks();
drawPlot();
drawTable();

// Para pruebas automáticas.
window.trackit = { S, seekFrame, autotrack, trackRows, polyfit, addTrack, setPoint, hist, syncAll };
