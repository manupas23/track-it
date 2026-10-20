'use strict';
// Track.It: videoanálisis en el navegador.
// (Los identificadores internos, como la clave del autoguardado o el campo app de los
// proyectos, siguen siendo 'track-it' para no perder lo guardado con versiones anteriores.)
// Coordenadas internas en píxeles de la imagen (y hacia abajo); las del usuario,
// en el sistema de ejes calibrado (y hacia arriba).

const $ = (id) => document.getElementById(id);
const video = $('video');
const view = $('view');
const vctx = view.getContext('2d', { alpha: false });
// Capa de marcas encima del vídeo: se repinta sola cuando no cambia el fotograma.
const over = $('overlay');
const octx = over.getContext('2d');
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
  // Paso entre fotogramas analizados y fotograma de t = 0, comunes a todos los objetos.
  // Cada objeto tiene además su propio tramo (tr.range).
  range: { step: 1 },
  t0: 0,
  calib: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, length: 1, unit: 'm', on: true },
  axes: { ox: 0, oy: 0, angle: 0 },
  tracks: [],
  sel: null,
  tool: 'move',
  show: { calib: true, axes: true, trails: true, search: true },
  view: { s: 1, tx: 0, ty: 0 },
  playing: false,
  auto: false,
};

let nextTrackId = 1;
let pendingProject = null;

// Versión de los datos: sube con cualquier cambio de puntos, calibración, ejes, tiempo
// o rango, y con ella caducan las cachés de filas, gráfica y tabla.
let dataVersion = 0;
const touch = () => { dataVersion++; };
// Fotograma mostrado: sube en cada salto o fotograma nuevo de la reproducción.
let frameToken = 0;

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

// Diálogo de confirmación con el estilo de la app. Devuelve el `value` del botón pulsado,
// o null si se cierra con Esc o haciendo clic fuera.
function ask({ title, text = '', detail = '', buttons }) {
  const dlg = $('ask');
  $('askTitle').textContent = title;
  $('askText').textContent = text;
  $('askDetail').textContent = detail;
  const box = $('askActions');
  box.innerHTML = '';
  return new Promise((resolve) => {
    const finish = (v) => {
      dlg.removeEventListener('close', onClose);
      dlg.removeEventListener('click', onBackdrop);
      if (dlg.open) dlg.close();
      resolve(v);
    };
    const onClose = () => finish(null);
    // Clic fuera del recuadro (en el fondo oscuro) = cancelar.
    const onBackdrop = (e) => {
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) finish(null);
    };
    let focus = null;
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'btn' + (b.kind ? ' ' + b.kind : '');
      el.textContent = b.label;
      el.addEventListener('click', () => finish(b.value));
      box.appendChild(el);
      if (b.focus) focus = el;
    }
    dlg.addEventListener('close', onClose);
    dlg.addEventListener('click', onBackdrop);
    dlg.showModal();
    (focus || box.lastChild).focus();
  });
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

const timeOf = (n) => (n - S.t0) / S.fpsReal;
// Tramo de análisis de un objeto (por defecto, el seleccionado; sin objeto, todo el vídeo).
// Solo se marca y se sigue dentro de él.
const fullRange = () => ({ start: 0, end: Math.max(0, S.nFrames - 1) });
const rangeOf = (tr = selTrack()) => (tr && tr.range) || fullRange();
const inRange = (n, tr) => { const r = rangeOf(tr); return n >= r.start && n <= r.end; };

/* ---------- vídeo ---------- */

function loadVideo(file) {
  flushSave();
  if (S.playing) togglePlay();
  recovery = null;
  recentErrors.length = 0;
  S.auto = false;
  S.file = file;
  S.loaded = false;
  busy(t('loading_video'));
  if (video.src) URL.revokeObjectURL(video.src);
  video.src = URL.createObjectURL(file);
  video.load();
}

const errInfo = () => {
  const e = video.error;
  return e ? t('err_of', { what: [1, 2, 3, 4].includes(e.code) ? t('media_' + e.code) : e.code }) + (e.message ? `: ${e.message}` : '') : t('err_unknown');
};

// Recuperación de errores a mitad de uso (un fotograma que el decodificador no digiere,
// fallo del driver gráfico…): se recarga el mismo archivo y se vuelve al fotograma, sin
// tocar el análisis.
let recovery = null;
const recentErrors = [];

video.addEventListener('error', () => {
  busy(null);
  if (!S.loaded && !recovery) {
    toast(t('err_open', { info: errInfo() }), 8000);
    return;
  }
  const now = Date.now();
  recentErrors.push(now);
  while (recentErrors.length && now - recentErrors[0] > 20000) recentErrors.shift();
  S.playing = false;
  S.auto = false;
  $('btnPlay').textContent = '▶';
  if (recentErrors.length > 3) {
    recovery = null;
    S.loaded = true;
    console.warn('Track.It: the video keeps failing', video.error);
    toast(t('err_repeat', { frame: S.frame, info: errInfo() }), 12000);
    return;
  }
  console.warn('Track.It: video error, reloading', video.error);
  recovery = { frame: S.frame };
  S.loaded = false;
  busy(t('err_reloading'));
  video.load();
});

video.addEventListener('loadedmetadata', async () => {
  if (recovery) {
    const { frame } = recovery;
    recovery = null;
    S.loaded = true;
    await seekFrame(frame);
    busy(null);
    toast(t('err_recovered', { frame }), 6000);
    return;
  }
  S.W = video.videoWidth;
  S.H = video.videoHeight;
  S.duration = video.duration;
  grab.width = S.W;
  grab.height = S.H;
  grabToken = -1;
  busy(t('detecting_fps'));
  const fps = await detectFps();
  setFps(fps, true);
  S.frame = 0;
  S.range = { step: 1 };
  S.t0 = 0;
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
  syncAll(); // que la interfaz esté completa mientras se pregunta si recuperar
  if (pendingProject) {
    const d = pendingProject;
    pendingProject = null;
    if (!(d.video && d.video.name && d.video.name !== S.file.name) || await askOtherVideo(d.video.name)) {
      applySnapshot(d);
      hist.reset();
      autosave(snapshot());
      resumeAtLast();
      toast(t('project_resumed'));
    }
  } else await restoreAutosave();
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
  S.t0 = Math.min(S.t0, S.nFrames - 1);
  S.tracks.forEach(fitRange);
}
// Ajusta el tramo de un objeto a la duración del vídeo (o lo crea si no lo tiene).
function fitRange(tr) {
  const last = Math.max(0, S.nFrames - 1);
  const r = tr.range || fullRange();
  const end = clamp(r.end | 0, 0, last);
  tr.range = { start: clamp(r.start | 0, 0, end), end };
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
  frameToken++;
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
    const r = rangeOf();
    if (S.frame >= r.end) seekFrame(r.start);
    S.playing = true;
    video.play();
    // Se pinta solo cuando el vídeo presenta un fotograma nuevo (no a 60 Hz fijos).
    const rvfc = 'requestVideoFrameCallback' in video;
    const next = () => (rvfc ? video.requestVideoFrameCallback(onFrame) : requestAnimationFrame(onFrame));
    const onFrame = (now, meta) => {
      if (!S.playing) return;
      const f = clamp(meta && meta.mediaTime !== undefined ? Math.round(meta.mediaTime * S.fps) : Math.floor(video.currentTime * S.fps), 0, S.nFrames - 1);
      if (f >= r.end || video.ended) { togglePlay(); return; }
      if (f !== S.frame) {
        S.frame = f;
        frameToken++;
        render();
        syncFrameUI();
      }
      next();
    };
    next();
  }
  $('btnPlay').textContent = S.playing ? '❚❚' : '▶';
}
// Con requestVideoFrameCallback no llega aviso al acabar el vídeo: se escucha aparte.
video.addEventListener('ended', () => { if (S.playing) togglePlay(); });

function step(k) {
  if (!S.loaded || S.auto) return;
  if (S.playing) togglePlay();
  // Dentro del tramo, los pasos no se salen de él.
  const r = inRange(S.frame) ? rangeOf() : fullRange();
  seekFrame(clamp(S.frame + k * S.range.step, r.start, r.end));
}

/* ---------- objetos ---------- */

function addTrack(select = true) {
  const id = nextTrackId++;
  const used = new Set(S.tracks.map((t) => t.color));
  const color = COLORS.find((c) => !used.has(c)) || COLORS[(id - 1) % COLORS.length];
  const tr = { id, name: t('track_name', { n: id }), color, visible: true, points: {}, range: fullRange() };
  S.tracks.push(tr);
  if (select || !S.sel) S.sel = id;
  return tr;
}
const selTrack = () => S.tracks.find((t) => t.id === S.sel) || null;

function setPoint(tr, n, p) {
  tr.points[n] = { x: clamp(p.x, 0, S.W), y: clamp(p.y, 0, S.H) };
  touch();
}

// Caché por objeto de los fotogramas ordenados y de las filas de datos (WeakMap, para que
// no acabe dentro de los proyectos guardados). Caduca al cambiar dataVersion.
const trackCache = new WeakMap();
function cacheOf(tr) {
  let c = trackCache.get(tr);
  if (!c || c.v !== dataVersion) {
    c = { v: dataVersion, frames: Object.keys(tr.points).map(Number).sort((a, b) => a - b), rows: null };
    trackCache.set(tr, c);
  }
  return c;
}
const sortedFrames = (tr) => cacheOf(tr).frames;
function trackRows(tr) {
  const c = cacheOf(tr);
  if (!c.rows) c.rows = computeRows(tr, c.frames);
  return c.rows;
}

// Filas de datos con derivadas por diferencias centradas (admite huecos).
function computeRows(tr, frames) {
  const fr = frames.filter((n) => inRange(n, tr));
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
  { k: 'frame', get label() { return t('var_frame'); }, u: () => '' },
];
const varOf = (k) => VARS.find((v) => v.k === k);
const varLabel = (k) => { const v = varOf(k); const u = v.u(); return u ? `${v.label} (${u})` : v.label; };

/* ---------- autotracking por correlación de plantilla ---------- */

// Lado mínimo de la plantilla en el nivel más reducido de la pirámide.
const PYR_MIN = 10;

// Copia del fotograma entero en `grab`, una vez por fotograma. Los recortes se sacan de aquí
// y no del <video>: con vídeos de móvil girados por metadatos (MOV con rotate 90),
// drawImage(video, sx, sy, sw, sh, …) recorta en algunos navegadores sobre el fotograma sin
// girar, y la plantilla salía de otra zona y girada. Pintado entero sí respeta el giro.
let grabToken = -1;
function grabFrame() {
  if (grabToken === frameToken) return;
  gctx.drawImage(video, 0, 0, S.W, S.H);
  grabToken = frameToken;
}

function grayRegion(x0, y0, w, h) {
  // Solo la región que se busca: convertir a gris el fotograma entero (1080×1920) cuesta más
  // que convertir dos o tres regiones pequeñas por paso.
  grabFrame();
  const img = gctx.getImageData(x0, y0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * img[j] + 0.587 * img[j + 1] + 0.114 * img[j + 2];
  return g;
}

// Imagen a la mitad de tamaño (media de bloques 2×2).
function halve(img) {
  const w = img.w >> 1, h = img.h >> 1, W = img.w, s = img.g;
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = 2 * y * W + 2 * x;
      g[y * w + x] = 0.25 * (s[i] + s[i + 1] + s[i + W] + s[i + W + 1]);
    }
  }
  return { g, w, h };
}

function zeroMean(img) {
  const n = img.g.length;
  let m = 0;
  for (let i = 0; i < n; i++) m += img.g[i];
  m /= n;
  const z = new Float32Array(n);
  let ss = 0;
  for (let i = 0; i < n; i++) { z[i] = img.g[i] - m; ss += z[i] * z[i]; }
  return { ...img, z, norm: Math.sqrt(ss) };
}

function makeTemplate(raw, size) {
  const levels = [zeroMean({ g: raw, w: size, h: size })];
  while (levels[levels.length - 1].w / 2 >= PYR_MIN) levels.push(zeroMean(halve(levels[levels.length - 1])));
  return { raw, z: levels[0].z, norm: levels[0].norm, size, half: (size - 1) / 2, levels };
}

function extractTemplate(p, size) {
  const h = (size - 1) / 2;
  const cx = Math.round(p.x), cy = Math.round(p.y);
  if (cx - h < 0 || cy - h < 0 || cx + h >= S.W || cy + h >= S.H) return null;
  return makeTemplate(grayRegion(cx - h, cy - h, size, size), size);
}

// Imágenes integrales de los valores y de sus cuadrados: suma de cualquier ventana en O(1).
function integral(img) {
  const { g, w, h } = img, W = w + 1;
  const s = new Float64Array(W * (h + 1)), s2 = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rs2 = 0;
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x];
      rs += v; rs2 += v * v;
      s[(y + 1) * W + x + 1] = s[y * W + x + 1] + rs;
      s2[(y + 1) * W + x + 1] = s2[y * W + x + 1] + rs2;
    }
  }
  return { s, s2, W };
}

// Correlación cruzada normalizada de la plantilla t con la imagen en (u, v), esquina superior izquierda.
function nccAt(img, ii, t, u, v) {
  const W = ii.W, tw = t.w, th = t.h;
  const a = v * W + u, b = a + tw, c = (v + th) * W + u, d = c + tw;
  const s = ii.s[d] - ii.s[b] - ii.s[c] + ii.s[a];
  const s2 = ii.s2[d] - ii.s2[b] - ii.s2[c] + ii.s2[a];
  const vr = s2 - (s * s) / (tw * th);
  if (vr <= 1e-6 || t.norm <= 0) return 0;
  const g = img.g, w = img.w, z = t.z;
  let cr = 0, k = 0;
  for (let j = 0; j < th; j++) {
    let idx = (v + j) * w + u;
    for (let i = 0; i < tw; i++) cr += g[idx++] * z[k++];
  }
  return cr / (Math.sqrt(vr) * t.norm);
}

// Búsqueda piramidal: barrido completo con imagen y plantilla reducidas, y los mejores
// candidatos se refinan nivel a nivel hasta la resolución original.
function matchTemplate(tpl, center, R) {
  const { size, half: h } = tpl;
  const cx = Math.round(center.x), cy = Math.round(center.y);
  const x0 = Math.max(0, cx - R - h), y0 = Math.max(0, cy - R - h);
  const x1 = Math.min(S.W, cx + R + h + 1), y1 = Math.min(S.H, cy + R + h + 1);
  const rw = x1 - x0, rh = y1 - y0;
  if (rw < size || rh < size) return null;
  const imgs = [{ g: grayRegion(x0, y0, rw, rh), w: rw, h: rh }];
  let L = 0;
  while (L + 1 < tpl.levels.length) {
    const next = halve(imgs[L]), t = tpl.levels[L + 1];
    if (next.w < t.w || next.h < t.h) break;
    imgs.push(next);
    L++;
  }
  const iis = imgs.map(integral);

  const top = imgs[L], tt = tpl.levels[L];
  const nu = top.w - tt.w + 1, nv = top.h - tt.h + 1;
  const sc = new Float32Array(nu * nv);
  for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) sc[v * nu + u] = nccAt(top, iis[L], tt, u, v);
  const cand = [];
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      const s = sc[v * nu + u];
      let isMax = true;
      for (let dv = -1; dv <= 1 && isMax; dv++) {
        for (let du = -1; du <= 1; du++) {
          const uu = u + du, vv = v + dv;
          if ((du || dv) && uu >= 0 && vv >= 0 && uu < nu && vv < nv && sc[vv * nu + uu] > s) { isMax = false; break; }
        }
      }
      if (isMax) cand.push({ u, v, s });
    }
  }
  cand.sort((a, b) => b.s - a.s);

  let best = null;
  for (const c0 of cand.slice(0, 3)) {
    let { u, v, s } = c0;
    for (let l = L - 1; l >= 0; l--) {
      const im = imgs[l], t = tpl.levels[l];
      const mu = im.w - t.w, mv = im.h - t.h;
      let bs = -2, bu = 0, bv = 0;
      for (let dv = -2; dv <= 2; dv++) {
        for (let du = -2; du <= 2; du++) {
          const uu = clamp(2 * u + du, 0, mu), vv = clamp(2 * v + dv, 0, mv);
          const sv = nccAt(im, iis[l], t, uu, vv);
          if (sv > bs) { bs = sv; bu = uu; bv = vv; }
        }
      }
      u = bu; v = bv; s = bs;
    }
    if (!best || s > best.s) best = { u, v, s };
  }

  // Ajuste parabólico para precisión de subpíxel.
  const t0 = tpl.levels[0], f = (u, v) => nccAt(imgs[0], iis[0], t0, u, v);
  const { u, v, s: m } = best;
  let du = 0, dv = 0;
  if (u > 0 && u < rw - size) {
    const l = f(u - 1, v), r = f(u + 1, v), den = l - 2 * m + r;
    if (den < 0) du = clamp(0.5 * (l - r) / den, -0.5, 0.5);
  }
  if (v > 0 && v < rh - size) {
    const l = f(u, v - 1), r = f(u, v + 1), den = l - 2 * m + r;
    if (den < 0) dv = clamp(0.5 * (l - r) / den, -0.5, 0.5);
  }
  return { x: x0 + u + h + du, y: y0 + v + h + dv, score: m };
}

async function autotrack() {
  if (S.auto) { S.auto = false; return; }
  const tr = selTrack();
  if (!tr) return;
  const r = rangeOf(tr);
  if (!inRange(S.frame, tr)) { toast(t('out_of_range', { name: tr.name }), 5000); return; }
  // Arranca en el fotograma actual o, si no está marcado, en el último marcado antes de él
  // (después de marcar, la app ya ha avanzado al siguiente paso).
  let start = S.frame;
  if (!tr.points[start]) {
    const before = sortedFrames(tr).filter((n) => n < S.frame && n >= r.start);
    if (!before.length) { toast(t('auto_need_point')); return; }
    start = before[before.length - 1];
  }
  if (S.playing) togglePlay();
  let size = parseInt($('tplSize').value, 10) || 21;
  if (size % 2 === 0) size++;
  const R = parseInt($('searchR').value, 10) || 30;
  const minScore = parseFloat($('matchMin').value) || 0;
  const evolve = $('tplEvolve').checked;

  await seekFrame(start);
  let tpl = extractTemplate(tr.points[start], size);
  if (!tpl) { toast(t('tpl_edge')); return; }
  if (tpl.norm < 1e-3 * size) { toast(t('tpl_flat')); return; }
  const base = tpl;

  S.auto = true;
  syncAutoBtn();
  const k = S.range.step;
  let prev = tr.points[start], prev2 = tr.points[start - k] || null;
  let count = 0, stopMsg = null;
  for (let n = start + k; n <= r.end; n += k) {
    if (!S.auto) { stopMsg = t('auto_cancelled'); break; }
    const pred = prev2 ? { x: 2 * prev.x - prev2.x, y: 2 * prev.y - prev2.y } : prev;
    await seekFrame(n);
    let m = matchTemplate(tpl, pred, R);
    // Si la predicción falla (choque, bote), se reintenta centrado en la última posición.
    if ((!m || m.score < minScore) && prev2) {
      const m2 = matchTemplate(tpl, prev, R);
      if (m2 && (!m || m2.score > m.score)) m = m2;
    }
    // Último intento antes de parar: zona tres veces mayor (un bote invierte la velocidad).
    if (!m || m.score < minScore) {
      const m3 = matchTemplate(tpl, prev, 3 * R);
      if (m3 && (!m || m3.score > m.score)) m = m3;
    }
    if (!m || m.score < minScore) {
      stopMsg = t('auto_stopped', { frame: n, score: m ? m.score.toFixed(2) : '–', min: minScore });
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
    drawPlot();
    if (count % 4 === 0) await sleepFrame();
  }
  S.auto = false;
  syncAutoBtn();
  hist.commit();
  syncAll();
  toast(stopMsg ? `${stopMsg} (${t('auto_new', { n: count })})` : t('auto_done', { pts: t('auto_new', { n: count }) }), stopMsg ? 6000 : 3200);
}

/* ---------- vista: zoom, desplazamiento y dibujo ---------- */

let dpr = 1;
function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  const r = view.getBoundingClientRect();
  view.width = over.width = Math.round(r.width * dpr);
  view.height = over.height = Math.round(r.height * dpr);
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

// Repintado agrupado: como mucho uno por refresco de pantalla. render() repinta el vídeo y
// las marcas; render(false), solo las marcas (pasar el ratón, arrastrar, marcar…).
let needBase = false, needOver = false, renderQueued = false;
function render(base = true) {
  if (base) needBase = true;
  needOver = true;
  if (!renderQueued) {
    renderQueued = true;
    requestAnimationFrame(flushRender);
  }
}
function flushRender() {
  renderQueued = false;
  if (needBase) drawBase();
  if (needOver) drawOverlay();
  needBase = needOver = false;
}

function drawBase() {
  const ctx = vctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0b0a';
  ctx.fillRect(0, 0, view.width, view.height);
  if (!S.loaded && !S.W) return;
  const { s, tx, ty } = S.view;
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);
  ctx.imageSmoothingEnabled = s < 2.5;
  try { ctx.drawImage(video, 0, 0, S.W, S.H); } catch (e) { /* aún sin fotograma */ }
}

function drawOverlay() {
  const ctx = octx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, over.width, over.height);
  if (S.loaded || S.W) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S.show.axes) drawAxes(ctx);
    if (S.show.calib) drawCalib(ctx);
    for (const tr of S.tracks) if (tr.visible) drawTrack(ctx, tr);
  }
  drawTplPreview();
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
  const frames = sortedFrames(tr).filter((n) => inRange(n, tr));
  const isSel = tr.id === S.sel;
  if (S.show.trails && frames.length > 1) {
    const pts = frames.filter((n) => n <= S.frame || isSel).map((n) => toScreen(tr.points[n]));
    ctx.globalAlpha = isSel ? 0.85 : 0.55;
    outlinedLine(ctx, pts, tr.color, 1.2);
    ctx.globalAlpha = 1;
  }
  if (S.show.trails && frames.length) {
    // Todos los puntos en un solo trazo. Primero los contornos y luego los rellenos, para que
    // el contorno de un punto no tape a sus vecinos cuando están muy juntos.
    const rad = isSel ? 3 : 2.2;
    ctx.beginPath();
    for (const n of frames) {
      if (n === S.frame) continue;
      const p = toScreen(tr.points[n]);
      ctx.moveTo(p.x + rad, p.y);
      ctx.arc(p.x, p.y, rad, 0, 2 * Math.PI);
    }
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = tr.color; ctx.fill();
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
    if (isSel) drawSearchZone(ctx);
    label(ctx, tr.name, p.x + 11, p.y - 9, tr.color);
  }
}

function tplParams() {
  let size = parseInt($('tplSize').value, 10) || 21;
  if (size % 2 === 0) size++;
  return { size, R: parseInt($('searchR').value, 10) || 30 };
}

// Plantilla (sólida) sobre el punto y zona de búsqueda (discontinua) centrada en la
// posición prevista para el siguiente paso, igual que la usa el autotracking.
// Geometría en pantalla de la plantilla y la zona de búsqueda del objeto seleccionado.
function searchGeom() {
  const tr = selTrack();
  const cur = tr && tr.visible && tr.points[S.frame];
  if (!cur || !S.show.search || S.playing) return null;
  const { size, R } = tplParams();
  const s = S.view.s;
  const before = tr.points[S.frame - S.range.step] || null;
  const pred = before ? { x: 2 * cur.x - before.x, y: 2 * cur.y - before.y } : cur;
  const p = toScreen({ x: Math.round(cur.x), y: Math.round(cur.y) });
  const c = toScreen({ x: Math.round(pred.x), y: Math.round(pred.y) });
  return { tr, cur, pred, before, p, c, ht: (size / 2) * s, hs: (R + size / 2) * s };
}

const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

function drawSearchZone(ctx) {
  const G = searchGeom();
  if (!G) return;
  const { tr, before, p, c, ht, hs } = G;

  const box = (x, y, h, dash, w, hot) => {
    ctx.setLineDash(dash);
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = w + 2;
    ctx.strokeRect(x - h, y - h, 2 * h, 2 * h);
    ctx.strokeStyle = tr.color; ctx.lineWidth = w;
    ctx.strokeRect(x - h, y - h, 2 * h, 2 * h);
    ctx.setLineDash([]);
    // Asas en las esquinas para cambiar el tamaño arrastrando.
    for (const [sx, sy] of CORNERS) {
      const hx = x + sx * h, hy = y + sy * h;
      ctx.fillStyle = hot ? '#fff' : tr.color;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.fillRect(hx - 3.5, hy - 3.5, 7, 7);
      ctx.strokeRect(hx - 3.5, hy - 3.5, 7, 7);
    }
  };
  const hk = hover && hover.kind;
  box(c.x, c.y, hs, [6, 4], 1.2, hk === 'searchCorner' || (drag && drag.kind === 'searchCorner'));
  box(p.x, p.y, ht, [], 1.5, hk === 'tplCorner' || (drag && drag.kind === 'tplCorner'));
  if (before && dist(p, c) > 3) {
    ctx.setLineDash([2, 3]);
    outlinedLine(ctx, [p, c], tr.color, 1);
    ctx.setLineDash([]);
    outlinedLine(ctx, [{ x: c.x - 4, y: c.y }, { x: c.x + 4, y: c.y }], tr.color, 1);
    outlinedLine(ctx, [{ x: c.x, y: c.y - 4 }, { x: c.x, y: c.y + 4 }], tr.color, 1);
  }
  if (hs > 30) label(ctx, t('search_label'), c.x - hs + 3, c.y - hs - 5, tr.color);
}

// Vista ampliada de la plantilla en el panel de autotracking.
let previewKey = null;
function drawTplPreview() {
  const tr = selTrack();
  const cur = tr && tr.points[S.frame];
  const { size } = tplParams();
  // Solo se redibuja si cambia algo de lo que muestra.
  const key = S.loaded && cur ? `${frameToken}|${cur.x}|${cur.y}|${size}|${tr.color}` : `vacío|${theme.muted}`;
  if (key === previewKey) return;
  previewKey = key;
  const cv = $('tplPreview');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!S.loaded || !cur) {
    ctx.fillStyle = theme.muted;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t('no_point'), cv.width / 2, cv.height / 2 + 4);
    ctx.textAlign = 'left';
    return;
  }
  const h = (size - 1) / 2;
  ctx.imageSmoothingEnabled = false;
  try { grabFrame(); ctx.drawImage(grab, Math.round(cur.x) - h, Math.round(cur.y) - h, size, size, 0, 0, cv.width, cv.height); } catch (e) { /* sin fotograma */ }
  const m = cv.width / 2;
  ctx.strokeStyle = tr.color; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(m - 6, m + 0.5); ctx.lineTo(m + 6, m + 0.5); ctx.moveTo(m + 0.5, m - 6); ctx.lineTo(m + 0.5, m + 6); ctx.stroke();
}

/* ---------- ratón sobre el vídeo ---------- */

function hitTest(sp) {
  const R = 9;
  // Punto y asas de las esquinas pueden solaparse con plantillas pequeñas: gana el más cercano.
  let best = null, bd = Infinity;
  for (const tr of [selTrack(), ...S.tracks].filter(Boolean)) {
    const p = tr.visible && tr.points[S.frame];
    const d = p ? dist(toScreen(p), sp) : Infinity;
    if (d < R && d < bd) { best = { kind: 'pt', tr }; bd = d; }
  }
  const G = searchGeom();
  if (G) {
    for (const [kind, o, h] of [['tplCorner', G.p, G.ht], ['searchCorner', G.c, G.hs]]) {
      for (const [sx, sy] of CORNERS) {
        const q = { x: o.x + sx * h, y: o.y + sy * h };
        const d = dist(q, sp);
        if (Math.abs(sp.x - q.x) < 7 && Math.abs(sp.y - q.y) < 7 && d < bd) {
          best = { kind, cursor: sx * sy > 0 ? 'nwse-resize' : 'nesw-resize' };
          bd = d;
        }
      }
    }
  }
  if (best) return best;
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
// offsetX/Y ya vienen relativos al lienzo: sin getBoundingClientRect (que fuerza maquetar) en cada evento.
const evPos = (e) => ({ x: e.offsetX, y: e.offsetY });

view.addEventListener('contextmenu', (e) => e.preventDefault());

view.addEventListener('pointerdown', (e) => {
  if (!S.loaded || S.auto) return;
  const sp = evPos(e);
  view.setPointerCapture(e.pointerId);
  if (e.button === 1 || e.button === 2) { drag = { kind: 'pan', sp, v: { ...S.view } }; return; }
  if (e.button !== 0) return;
  if (S.playing) togglePlay();
  if ((S.tool !== 'move' || e.shiftKey) && selTrack() && !inRange(S.frame)) { toast(t('out_of_range', { name: selTrack().name }), 5000); return; }
  // Herramienta Auto: un clic marca el objeto aquí y lo sigue solo en los fotogramas siguientes.
  if (S.tool === 'auto' && !e.shiftKey) {
    const tr = selTrack() || addTrack();
    setPoint(tr, S.frame, toImage(sp));
    hist.commit();
    syncData();
    render(false);
    autotrack();
    return;
  }
  const marking = S.tool === 'mark' || e.shiftKey;
  if (marking) {
    let tr = selTrack();
    if (!tr) { tr = addTrack(); }
    setPoint(tr, S.frame, toImage(sp));
    hist.commit();
    syncData();
    render(false);
    const nx = S.frame + S.range.step;
    if (nx <= rangeOf(tr).end) seekFrame(nx);
    return;
  }
  const h = hitTest(sp);
  if (h) {
    if (h.kind === 'pt') { S.sel = h.tr.id; syncTracks(); syncInputs(); syncFrameUI(); }
    drag = { ...h, sp, moved: false };
  } else {
    drag = { kind: 'pan', sp, v: { ...S.view } };
  }
});

// Escrituras al DOM solo si cambian (cada una invalida estilos o maquetación).
let lastCursor = '', lastReadout = '';
function setCursor(c) { if (c !== lastCursor) { lastCursor = c; view.style.cursor = c; } }
function setReadout(t) { if (t !== lastReadout) { lastReadout = t; $('cursorReadout').textContent = t; } }

// Los movimientos del ratón se atienden como mucho una vez por refresco de pantalla.
let moveEv = null, moveRaf = 0;
view.addEventListener('pointermove', (e) => {
  moveEv = e;
  if (!moveRaf) moveRaf = requestAnimationFrame(flushMove);
});
function flushMove() {
  moveRaf = 0;
  const e = moveEv;
  moveEv = null;
  if (e) handleMove(e);
}

function handleMove(e) {
  if (!S.loaded) return;
  const sp = evPos(e);
  const ip = toImage(sp);
  const inside = ip.x >= 0 && ip.y >= 0 && ip.x <= S.W && ip.y <= S.H;
  if (inside) {
    const w = toWorld(ip);
    setReadout(`x = ${fmt(w.x)}  y = ${fmt(w.y)} ${unit()}`);
  } else setReadout('');

  if (!drag) {
    const h = S.auto ? null : hitTest(sp);
    const changed = (h && h.kind) !== (hover && hover.kind) || (h && hover && h.tr !== hover.tr);
    hover = h;
    setCursor(h ? (h.cursor || (h.kind === 'pt' || h.kind === 'origin' ? 'move' : 'grab')) : (S.tool !== 'move' || e.shiftKey ? 'crosshair' : 'default'));
    if (changed) render(false);
    return;
  }
  if (drag.kind === 'pan') {
    S.view.tx = drag.v.tx + sp.x - drag.sp.x;
    S.view.ty = drag.v.ty + sp.y - drag.sp.y;
    setCursor('grabbing');
    render();
    return;
  }
  drag.moved = true;
  const p = { x: clamp(ip.x, 0, S.W), y: clamp(ip.y, 0, S.H) };
  if (drag.kind === 'tplCorner' || drag.kind === 'searchCorner') {
    // Redimensionar como una imagen: el recuadro crece o mengua alrededor de su centro.
    const G = searchGeom();
    if (G) {
      const o = drag.kind === 'tplCorner' ? G.cur : G.pred;
      const d = Math.max(Math.abs(ip.x - o.x), Math.abs(ip.y - o.y));
      if (drag.kind === 'tplCorner') {
        $('tplSize').value = clamp(2 * Math.round(d) + 1, 5, 801);
      } else {
        $('searchR').value = clamp(Math.round(d - tplParams().size / 2), 3, 1500);
      }
      setCursor(drag.cursor);
    }
    render(false);
    return;
  }
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
  render(false);
}

view.addEventListener('pointerup', () => {
  // Aplicar el último movimiento pendiente antes de soltar.
  if (moveRaf) { cancelAnimationFrame(moveRaf); flushMove(); }
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

// Colores del tema, leídos una vez (getComputedStyle en cada dibujo obliga a recalcular estilos).
const theme = {};
function readTheme() {
  Object.assign(theme, {
    ink: cssVar('--text-secondary'), muted: cssVar('--text-muted'), grid: cssVar('--grid'),
    surf: cssVar('--surface-1'), primary: cssVar('--text-primary'),
  });
}
readTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); plotKey = null; drawPlot(); render(false); });

// La gráfica se dibuja en dos partes: una base en caché (ejes, puntos, ajuste), que solo se
// rehace si cambian los datos, el tamaño o las variables, y encima el punto del fotograma actual.
const plotBase = document.createElement('canvas');
let plotKey = null, plotQueued = false;
function drawPlot() {
  if (plotQueued) return;
  plotQueued = true;
  requestAnimationFrame(drawPlotNow);
}
function drawPlotNow() {
  plotQueued = false;
  const W = plot.clientWidth, H = plot.clientHeight;
  if (!W || !H) return; // panel plegado
  const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
  if (plot.width !== pw || plot.height !== ph) { plot.width = pw; plot.height = ph; }
  const key = [dataVersion, S.sel, $('plotX').value, $('plotY').value, $('fitType').value, pw, ph, theme.ink].join('|');
  if (key !== plotKey) {
    plotKey = key;
    plotBase.width = pw; plotBase.height = ph;
    const bctx = plotBase.getContext('2d');
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildPlotBase(bctx, W, H);
  }
  const ctx = pctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  ctx.drawImage(plotBase, 0, 0);
  const cur = plotState && plotState.byFrame.get(S.frame);
  if (cur) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath(); ctx.arc(cur.px, cur.py, 5.5, 0, 2 * Math.PI);
    ctx.fillStyle = plotState.tr.color; ctx.fill();
    ctx.strokeStyle = theme.primary; ctx.lineWidth = 2; ctx.stroke();
  }
}

function buildPlotBase(ctx, W, H) {
  const { ink, muted, grid } = theme;
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
    ctx.fillText(t(tr ? 'plot_no_data' : 'plot_no_track'), W / 2, H / 2);
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
  // Todos los puntos en un solo trazo (contornos primero, rellenos encima); el del fotograma
  // actual se pinta aparte, encima.
  const byFrame = new Map();
  ctx.beginPath();
  for (const p of pts) {
    const px = X(p.x), py = Y(p.y);
    byFrame.set(p.d.frame, { px, py });
    ctx.moveTo(px + 3.5, py);
    ctx.arc(px, py, 3.5, 0, 2 * Math.PI);
  }
  ctx.strokeStyle = theme.surf; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = tr.color; ctx.fill();
  ctx.restore();

  if (deg && !fit) $('fitOut').textContent = t('fit_need', { n: deg + 1 });
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
  plotState = { pts, X, Y, kx, ky, tr, byFrame };
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
  tip.innerHTML = `<b>${t('tip_frame', { frame: best.d.frame })}</b><br>${varLabel(plotState.kx)}: ${fmt(best.x)}<br>${varLabel(plotState.ky)}: ${fmt(best.y)}`;
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

// Tabla virtualizada: solo existen en la página las filas visibles y un margen; dos filas
// espaciadoras ocupan el sitio del resto. Así pesa lo mismo con 300 puntos que con 30 000,
// y seguir el fotograma actual no repinta cientos de filas.
const TABLE_COLS = ['frame', 't', 'x', 'y', 'vx', 'vy', 'ax', 'ay'];
const ROW_H = 20; // fijado también en style.css
const tableEl = $('dataTable');
const tableWrap = tableEl.closest('.tablewrap');
let tableKey = null, tableTimer = 0;
let tableData = [], tableIndex = new Map(), tableBody = null;
let tableFirst = -1, tableLast = -1, tableScroll = 0, tableWrapH = 0, tableHeadH = 0;

function scheduleTable(delay = 150) {
  clearTimeout(tableTimer);
  tableTimer = setTimeout(drawTable, delay);
}
function drawTable() {
  clearTimeout(tableTimer);
  const tr = selTrack();
  const key = `${dataVersion}|${S.sel}`;
  if (key === tableKey) return;
  tableKey = key;
  const head = `<thead><tr>${TABLE_COLS.map((k) => `<th>${k === 'frame' ? t('table_frame') : varLabel(k)}</th>`).join('')}</tr></thead>`;
  tableData = tr ? trackRows(tr) : [];
  tableIndex = new Map(tableData.map((d, i) => [d.frame, i]));
  // Otro objeto: la selección no tiene sentido. Mismo objeto con más o menos puntos: se recorta.
  if (tsel && (tselSel !== S.sel || !tableData.length)) tsel = null;
  else if (tsel) {
    const last = tableData.length - 1;
    tsel = { ...tsel, r0: Math.min(tsel.r0, last), r1: Math.min(tsel.r1, last) };
  }
  syncSelInfo();
  if (!tableData.length) {
    tableEl.innerHTML = head + `<tbody><tr><td class="empty" colspan="8">${t('table_empty')}</td></tr></tbody>`;
    tableBody = null;
    return;
  }
  tableEl.innerHTML = head + '<tbody></tbody>';
  tableBody = tableEl.tBodies[0];
  tableFirst = tableLast = -1;
  renderTableWindow();
  tableWrapH = 0; // se mide ya con las filas pintadas
  highlightTableRow(true);
}

function measureTable() {
  tableWrapH = tableWrap.clientHeight;
  tableHeadH = tableEl.tHead ? tableEl.tHead.offsetHeight : 0;
  tableScroll = tableWrap.scrollTop;
}

function renderTableWindow() {
  if (!tableBody) return;
  const n = tableData.length;
  const visible = Math.ceil(Math.max(tableWrapH, 300) / ROW_H); // 300 = max-height de .tablewrap
  const first = Math.max(0, Math.floor((tableScroll - tableHeadH) / ROW_H) - 10);
  const last = Math.min(n, first + visible + 20);
  if (first === tableFirst && last === tableLast) return;
  tableFirst = first; tableLast = last;
  let html = first ? `<tr class="spacer" style="height:${first * ROW_H}px"><td colspan="8"></td></tr>` : '';
  const b = tselBox();
  for (let i = first; i < last; i++) {
    const d = tableData[i];
    const rowSel = b && i >= b.r0 && i <= b.r1;
    html += `<tr data-f="${d.frame}"${d.frame === S.frame ? ' class="cur"' : ''}>${TABLE_COLS.map((k, c) => `<td${rowSel && c >= b.c0 && c <= b.c1 ? ' class="sel"' : ''}>${k === 'frame' ? d.frame : fmt(d[k])}</td>`).join('')}</tr>`;
  }
  if (last < n) html += `<tr class="spacer" style="height:${(n - last) * ROW_H}px"><td colspan="8"></td></tr>`;
  tableBody.innerHTML = html;
}

let tableScrollQueued = false;
tableWrap.addEventListener('scroll', () => {
  tableScroll = tableWrap.scrollTop;
  if (!tableScrollQueued) {
    tableScrollQueued = true;
    requestAnimationFrame(() => { tableScrollQueued = false; renderTableWindow(); });
  }
}, { passive: true });

// Selección de celdas, como en una hoja de cálculo: clic, Mayús+clic o arrastrar; clic en una
// cabecera, la columna entera. Se guarda por índices de fila/columna, así que sobrevive al
// repintado de la ventana virtual. Ctrl+C la copia separada por tabuladores.
let tsel = null, tselSel = null, tselDrag = null; // tsel = { r0, c0 (ancla), r1, c1 (extremo) }
const tselBox = () => tsel && {
  r0: Math.min(tsel.r0, tsel.r1), r1: Math.max(tsel.r0, tsel.r1),
  c0: Math.min(tsel.c0, tsel.c1), c1: Math.max(tsel.c0, tsel.c1),
};
const tableActive = () => tableEl.closest('.panel').classList.contains('active');

function setTableSel(s) {
  if (s && tsel && s.r0 === tsel.r0 && s.c0 === tsel.c0 && s.r1 === tsel.r1 && s.c1 === tsel.c1) return;
  tsel = s;
  tselSel = S.sel;
  tableFirst = tableLast = -1;
  renderTableWindow();
  syncSelInfo();
}

// Resumen bajo la tabla (como la barra de estado de Excel): celdas, y media y suma si es
// una sola columna.
function syncSelInfo() {
  const el = $('tableSelInfo');
  const b = tselBox();
  if (!b || (b.r0 === b.r1 && b.c0 === b.c1)) { el.hidden = true; return; }
  const rows = b.r1 - b.r0 + 1, cols = b.c1 - b.c0 + 1;
  let txt = t('sel_cells', { n: rows * cols });
  if (cols === 1 && TABLE_COLS[b.c0] !== 'frame') {
    const k = TABLE_COLS[b.c0];
    let n = 0, sum = 0;
    for (let i = b.r0; i <= b.r1; i++) { const v = tableData[i][k]; if (isFinite(v)) { n++; sum += v; } }
    if (n) txt += ` · ${t('sel_mean')} ${fmt(sum / n)} · ${t('sel_sum')} ${fmt(sum)}`;
  }
  el.textContent = `${txt} · Ctrl+C`;
  el.hidden = false;
}

function cellAt(target) {
  const td = target && target.closest && target.closest('td, th');
  if (!td || !tableEl.contains(td)) return null;
  if (td.tagName === 'TH') return { head: true, c: td.cellIndex };
  const f = td.parentElement.dataset.f;
  return f === undefined ? null : { r: tableIndex.get(+f), c: td.cellIndex };
}

tableEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !tableBody) return;
  const cell = cellAt(e.target);
  if (!cell) return;
  e.preventDefault(); // sin selección de texto del navegador
  const last = tableData.length - 1;
  if (cell.head) {
    setTableSel({ r0: 0, c0: e.shiftKey && tsel ? tsel.c0 : cell.c, r1: last, c1: cell.c });
    tselDrag = 'col';
  } else {
    if (e.shiftKey && tsel) setTableSel({ ...tsel, r1: cell.r, c1: cell.c });
    else {
      setTableSel({ r0: cell.r, c0: cell.c, r1: cell.r, c1: cell.c });
      seekFrame(tableData[cell.r].frame);
    }
    tselDrag = 'cell';
  }
});
// Arrastre: se sigue por todo el documento para poder salir por arriba o por abajo, y en ese
// caso la tabla se desplaza sola.
document.addEventListener('pointermove', (e) => {
  if (!tselDrag || !tsel) return;
  if (!e.buttons) { tselDrag = null; return; }
  if (!tableWrapH) measureTable();
  const rect = tableWrap.getBoundingClientRect();
  const x = clamp(e.clientX, rect.left + 1, rect.right - 2);
  if (tselDrag === 'col') {
    const cell = cellAt(document.elementFromPoint(x, rect.top + 2));
    if (cell) setTableSel({ ...tsel, c1: cell.c });
    return;
  }
  if (e.clientY < rect.top + tableHeadH) tableWrap.scrollTop -= ROW_H;
  else if (e.clientY > rect.bottom) tableWrap.scrollTop += ROW_H;
  const y = clamp(e.clientY, rect.top + tableHeadH + 1, rect.bottom - 2);
  const cell = cellAt(document.elementFromPoint(x, y));
  if (cell && !cell.head) setTableSel({ ...tsel, r1: cell.r, c1: cell.c });
});
document.addEventListener('pointerup', () => { tselDrag = null; });

function selectAllTable() {
  if (tableBody) setTableSel({ r0: 0, c0: 0, r1: tableData.length - 1, c1: TABLE_COLS.length - 1 });
}

// Texto para pegar en una hoja de cálculo: tabuladores, la coma decimal del sistema y la
// precisión completa (no la redondeada que se ve). Con columnas enteras va la cabecera.
function tableSelText() {
  const b = tselBox();
  const dec = (1.5).toLocaleString().includes(',') ? ',' : '.';
  const num = (v) => (isFinite(v) ? String(+v.toPrecision(8)).replace('.', dec) : '');
  const cols = TABLE_COLS.slice(b.c0, b.c1 + 1);
  const lines = [];
  if (b.r0 === 0 && b.r1 === tableData.length - 1) lines.push(cols.map((k) => (k === 'frame' ? t('csv_frame') : varLabel(k))).join('\t'));
  for (let i = b.r0; i <= b.r1; i++) {
    const d = tableData[i];
    lines.push(cols.map((k) => (k === 'frame' ? d.frame : num(d[k]))).join('\t'));
  }
  return lines.join('\r\n');
}
document.addEventListener('copy', (e) => {
  if (!tsel || !tableBody || !tableActive()) return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  const s = window.getSelection();
  if (s && !s.isCollapsed) return; // hay texto seleccionado a mano: copia normal
  e.clipboardData.setData('text/plain', tableSelText());
  e.preventDefault();
  const b = tselBox();
  toast(t('sel_copied', { n: (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1) }));
});

// Resalta la fila del fotograma actual y desplaza la tabla si se sale de la vista.
let tableCurFrame = null;
function highlightTableRow(force) {
  if (!tableBody || (!force && tableCurFrame === S.frame)) return;
  tableCurFrame = S.frame;
  const prev = tableBody.querySelector('tr.cur');
  if (prev) prev.classList.remove('cur');
  const i = tableIndex.get(S.frame);
  if (i === undefined) return;
  if (!tableWrapH) measureTable();
  if (!tableWrapH) return; // panel plegado
  const top = tableHeadH + i * ROW_H;
  if (top < tableScroll + tableHeadH || top + ROW_H > tableScroll + tableWrapH) {
    tableScroll = Math.max(0, top - tableWrapH / 2);
    tableWrap.scrollTop = tableScroll;
    renderTableWindow();
  }
  const row = tableBody.rows[i - tableFirst + (tableFirst ? 1 : 0)];
  if (row && +row.dataset.f === S.frame) row.classList.add('cur');
}

/* ---------- sincronizar interfaz ---------- */

function syncFrameUI() {
  if (!S.loaded) return;
  $('slider').max = S.nFrames - 1;
  $('slider').value = S.frame;
  $('frameReadout').textContent = `${t('readout_frame', { frame: S.frame, last: S.nFrames - 1 })}   t = ${fmt(timeOf(S.frame))} s`;
  $('frameReadout').classList.toggle('out', !inRange(S.frame));
  highlightTableRow();
  drawPlot();
}

function syncCalibUI() {
  const s = scale();
  $('scaleOut').textContent = S.calib.on ? `${fmt(1 / s)} px/${S.calib.unit}` : '1 px';
  if (document.activeElement !== $('axesAngle')) $('axesAngle').value = +(S.axes.angle * 180 / Math.PI).toFixed(2);
}

function syncInputs() {
  $('fps').value = S.fps;
  $('fpsReal').value = S.fpsReal;
  const r = rangeOf();
  $('t0').value = S.t0;
  $('rangeStart').value = r.start;
  $('rangeEnd').value = r.end;
  $('rangeStep').value = S.range.step;
  $('t0').max = $('rangeStart').max = $('rangeEnd').max = S.nFrames - 1;
  $('rangeStart').disabled = $('rangeEnd').disabled = !selTrack();
  $('dtOut').textContent = `${fmt(S.range.step / S.fpsReal)} s`;
  syncTrim();
  $('calibLen').value = S.calib.length;
  $('calibUnit').value = S.calib.unit;
  $('calibOn').checked = S.calib.on;
  syncCalibUI();
}

// Mandos bajo la barra y banda del tramo del objeto seleccionado, en su color.
function syncTrim() {
  const last = Math.max(0, S.nFrames - 1);
  const tr = selTrack(), r = rangeOf(tr);
  const a = $('trimStart'), b = $('trimEnd'), sc = $('scrub');
  a.max = b.max = last;
  a.value = r.start;
  b.value = r.end;
  a.hidden = b.hidden = !tr;
  sc.style.setProperty('--a', last ? r.start / last : 0);
  sc.style.setProperty('--b', last ? r.end / last : 1);
  sc.style.setProperty('--band', tr ? tr.color : 'var(--accent)');
  // Con los dos mandos juntos, encima queda el que aún tiene sitio para moverse.
  a.style.zIndex = r.start > last / 2 ? 2 : '';
}

function syncTracks() {
  const list = $('trackList');
  list.innerHTML = '';
  for (const tr of S.tracks) {
    const row = document.createElement('div');
    row.className = 'track' + (tr.id === S.sel ? ' sel' : '');
    row.innerHTML = `<input type="checkbox" class="vis" title="${t('tr_show')}" ${tr.visible ? 'checked' : ''}>
      <input type="color" value="${tr.color}" title="${t('tr_color')}">
      <input type="text" value="" aria-label="${t('tr_name')}">
      <span class="count" title="${t('tr_count')}">${Object.keys(tr.points).length}</span>
      <button title="${t('tr_delete')}">✕</button>`;
    const [vis, col, name] = row.querySelectorAll('input');
    name.value = tr.name;
    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || S.sel === tr.id) return;
      S.sel = tr.id;
      // Sin reconstruir la lista, para no quitar el foco al campo del nombre.
      list.querySelectorAll('.track').forEach((el) => el.classList.toggle('sel', el === row));
      syncInputs(); // el tramo que se ve es el del objeto seleccionado
      syncFrameUI();
      syncData();
      render(false);
    });
    vis.addEventListener('change', () => { tr.visible = vis.checked; hist.commit(); render(false); });
    col.addEventListener('input', () => { tr.color = col.value; touch(); render(false); drawPlot(); syncTrim(); });
    col.addEventListener('change', () => hist.commit());
    name.addEventListener('change', () => { tr.name = name.value.trim() || tr.name; hist.commit(); touch(); render(false); drawPlot(); });
    row.querySelector('button').addEventListener('click', async () => {
      const n = Object.keys(tr.points).length;
      if (n && !(await ask({
        title: t('del_title', { name: tr.name }),
        text: t('del_text', { n }),
        detail: t('del_detail'),
        buttons: [{ label: t('cancel'), value: false, focus: true }, { label: t('delete'), value: true, kind: 'danger-fill' }],
      }))) return;
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
  b.textContent = t(S.auto ? 'btn_auto_stop' : 'btn_auto');
  b.classList.toggle('danger', S.auto);
}

// Tras cambiar datos: caducan las cachés, la gráfica se redibuja en el siguiente refresco
// y la tabla cuando se deja de cambiar.
function syncData() {
  touch();
  drawPlot();
  scheduleTable();
  const tr = selTrack();
  const c = $('trackList').querySelector('.track.sel .count');
  if (tr && c) c.textContent = Object.keys(tr.points).length;
}

function syncAll() {
  syncInputs();
  syncTracks();
  syncData();
  drawTable();
  syncFrameUI();
  render();
  hist.syncButtons();
}

/* ---------- deshacer, autoguardado y proyectos ---------- */

function snapshot() {
  return JSON.stringify({
    fps: S.fps, fpsReal: S.fpsReal, range: S.range, t0: S.t0, calib: S.calib, axes: S.axes,
    tracks: S.tracks, sel: S.sel, nextTrackId,
  });
}
function applySnapshot(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  if (d.fps) setFps(d.fps, true);
  if (d.fpsReal) S.fpsReal = d.fpsReal;
  if (d.range) S.range = { step: Math.max(1, d.range.step | 0) };
  if (d.calib) S.calib = d.calib;
  if (d.axes) S.axes = d.axes;
  if (d.tracks) S.tracks = d.tracks;
  // Los proyectos anteriores tenían un solo tramo para todos los objetos, con t = 0 en su
  // principio: se reparte a cada objeto y el tiempo no cambia.
  const old = d.range && d.range.end !== undefined ? { start: d.range.start, end: d.range.end } : null;
  S.t0 = clamp((d.t0 ?? (old && old.start) ?? 0) | 0, 0, Math.max(0, S.nFrames - 1));
  S.tracks.forEach((tr) => { if (!tr.range && old) tr.range = { ...old }; fitRange(tr); });
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
    if (this.stack.length > 100) this.stack.shift();
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
// Escritura agrupada: localStorage es síncrono y marcar seguido escribiría en cada clic.
let pendingSave = null, saveTimer = 0;
function autosave(s) {
  const k = autosaveKey();
  if (!k) return;
  pendingSave = { k, s };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}
function flushSave() {
  clearTimeout(saveTimer);
  if (!pendingSave) return;
  try { localStorage.setItem(pendingSave.k, pendingSave.s); } catch (e) { /* almacenamiento no disponible */ }
  pendingSave = null;
}
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
async function restoreAutosave() {
  const k = autosaveKey();
  let s = null;
  try { s = localStorage.getItem(k); } catch (e) { return; }
  if (!s) return;
  let d;
  try { d = JSON.parse(s); } catch (e) { return; /* guardado corrupto: se ignora */ }
  const tracks = d.tracks || [];
  const n = tracks.reduce((a, t) => a + Object.keys(t.points || {}).length, 0);
  if (!n) return;
  const ok = await ask({
    title: t('resume_title'),
    text: t('resume_text', { t: tracks.length, n }),
    detail: t('resume_detail'),
    buttons: [{ label: t('start_fresh'), value: false }, { label: t('recover'), value: true, kind: 'primary', focus: true }],
  });
  if (ok) {
    applySnapshot(d);
    hist.reset();
    resumeAtLast();
  }
}

function askOtherVideo(name) {
  return ask({
    title: t('other_title'),
    text: t('other_text', { saved: name, open: S.file.name }),
    detail: t('other_detail'),
    buttons: [{ label: t('cancel'), value: false }, { label: t('load_anyway'), value: true, kind: 'primary', focus: true }],
  });
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
  file.text().then(async (txt) => {
    let d;
    try { d = JSON.parse(txt); } catch (e) { toast(t('proj_invalid')); return; }
    if (d.app !== 'track-it') { toast(t('proj_not_trackit')); return; }
    if (!S.loaded) {
      // Se aplica en cuanto se abra el vídeo.
      pendingProject = d;
      toast(t('proj_ready', { name: d.video && d.video.name ? ` "${d.video.name}"` : '' }), 6000);
      return;
    }
    if (d.video && d.video.name && S.file && d.video.name !== S.file.name && !(await askOtherVideo(d.video.name))) return;
    applySnapshot(d);
    hist.commit();
    syncAll();
    toast(t('proj_loaded'));
  });
}

async function exportCsv() {
  if (!S.tracks.some((t) => Object.keys(t.points).length)) { toast(t('no_points_export')); return; }
  const fmtChoice = await ask({
    title: t('csv_title'),
    text: t('csv_text'),
    detail: t('csv_detail'),
    buttons: [
      { label: t('cancel'), value: null },
      { label: t('csv_std'), value: 'std' },
      { label: t('csv_excel'), value: 'excel', kind: 'primary', focus: true },
    ],
  });
  if (!fmtChoice) return;
  const excel = fmtChoice === 'excel';
  const sep = excel ? ';' : ',';
  const num = (v) => {
    if (!isFinite(v)) return '';
    const s = String(+v.toPrecision(8));
    return excel ? s.replace('.', ',') : s;
  };
  const cols = ['frame', 't', 'x', 'y', 'r', 'vx', 'vy', 'v', 'ax', 'ay', 'a'];
  const head = [t('csv_object'), ...cols.map((k) => (k === 'frame' ? t('csv_frame') : varLabel(k)))];
  const lines = [head.join(sep)];
  for (const tr of S.tracks) {
    for (const d of trackRows(tr)) {
      const name = /[;,"]/.test(tr.name) ? `"${tr.name.replace(/"/g, '""')}"` : tr.name;
      lines.push([name, d.frame, ...cols.slice(1).map((k) => num(d[k]))].join(sep));
    }
  }
  if (lines.length === 1) { toast(t('no_points_export')); return; }
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
$('btnStart').addEventListener('click', () => { if (S.loaded) seekFrame(rangeOf().start); });
$('btnEnd').addEventListener('click', () => { if (S.loaded) seekFrame(rangeOf().end); });
$('slider').addEventListener('input', (e) => {
  if (S.auto) { e.target.value = S.frame; return; }
  if (S.playing) togglePlay();
  seekFrame(+e.target.value);
});
// Al arrastrar un mando del tramo se ve el fotograma por el que pasa; se guarda al soltarlo.
for (const [id, isStart] of [['trimStart', true], ['trimEnd', false]]) {
  $(id).addEventListener('input', (e) => {
    const tr = selTrack();
    if (!S.loaded || S.auto || !tr) { syncTrim(); return; }
    if (S.playing) togglePlay();
    const v = +e.target.value, r = tr.range;
    if (isStart) r.start = Math.min(v, r.end);
    else r.end = Math.max(v, r.start);
    touch();
    syncTrim();
    seekFrame(isStart ? r.start : r.end);
  });
  $(id).addEventListener('change', () => { if (S.loaded && !S.auto) { hist.commit(); syncAll(); } });
}
// Fija el principio o el final del tramo del objeto seleccionado en el fotograma actual (I y O).
function setRangeEdge(isStart) {
  const tr = selTrack();
  if (!S.loaded || !tr) return;
  const r = tr.range;
  if (isStart) r.start = Math.min(S.frame, r.end);
  else r.end = Math.max(S.frame, r.start);
  hist.commit();
  syncAll();
}
// Que Espacio no vuelva a pulsar el último botón usado.
document.addEventListener('click', (e) => { const b = e.target.closest('button, .seg-btn'); if (b) b.blur(); });

document.querySelectorAll('.seg-btn[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
function setTool(tool) {
  S.tool = tool;
  document.querySelectorAll('.seg-btn[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  setCursor(tool === 'move' ? 'default' : 'crosshair');
}

for (const [id, key] of [['showCalib', 'calib'], ['showAxes', 'axes'], ['showTrails', 'trails'], ['showSearch', 'search']]) {
  $(id).addEventListener('change', (e) => { S.show[key] = e.target.checked; render(false); });
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
numInput('t0', (v) => { S.t0 = clamp(Math.round(v), 0, S.nFrames - 1); });
numInput('rangeStart', (v) => { const r = rangeOf(); if (selTrack()) r.start = clamp(Math.round(v), 0, r.end); });
numInput('rangeEnd', (v) => { const r = rangeOf(); if (selTrack()) r.end = clamp(Math.round(v), r.start, S.nFrames - 1); });
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
['tplSize', 'searchR'].forEach((id) => $(id).addEventListener('input', () => render(false)));

// Idioma: los textos fijos los cambia i18n.js; aquí se rehace lo que se genera en el código.
document.querySelectorAll('.lang-btn').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
document.addEventListener('langchange', () => {
  fillVarSelect($('plotX'), $('plotX').value);
  fillVarSelect($('plotY'), $('plotY').value);
  previewKey = null;
  syncAutoBtn();
  if (S.loaded) syncAll();
  else { syncTracks(); drawPlot(); tableKey = null; drawTable(); }
  render(false);
});

document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if ((tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (document.querySelector('dialog[open]')) return;
  const k = e.key;
  if (S.auto) { if (k === 'Escape') S.auto = false; return; }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); hist.go(e.shiftKey ? 1 : -1); return; }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') { e.preventDefault(); hist.go(1); return; }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a' && tableActive()) { e.preventDefault(); selectAllTable(); return; }
  if (k === 'Escape' && tsel && !S.auto) { setTableSel(null); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 10 : 1); }
  else if (k === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -10 : -1); }
  else if (k === 'Home') { e.preventDefault(); if (S.loaded) seekFrame(rangeOf().start); }
  else if (k === 'End') { e.preventDefault(); if (S.loaded) seekFrame(rangeOf().end); }
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'm' || k === 'M') setTool('mark');
  else if (k === 'a' || k === 'A') setTool('auto');
  else if (k === 'v' || k === 'V') setTool('move');
  else if (k === 'f' || k === 'F') fitView();
  else if (k === 'i' || k === 'I') setRangeEdge(true);
  else if (k === 'o' || k === 'O') setRangeEdge(false);
  else if (k === '?') $('help').showModal();
  else if (k === 'Delete' || k === 'Backspace') {
    const tr = selTrack();
    if (tr && tr.points[S.frame]) { delete tr.points[S.frame]; touch(); hist.commit(); syncData(); render(false); }
  } else if (k === 'Escape' && S.auto) S.auto = false;
});

// Panel activo: el último en el que se ha hecho clic o se ha entrado con el teclado.
function setActivePanel(p) {
  document.querySelectorAll('.panel').forEach((el) => el.classList.toggle('active', el === p));
}
document.querySelectorAll('.panel').forEach((p) => {
  p.addEventListener('pointerdown', () => setActivePanel(p));
  p.addEventListener('focusin', () => setActivePanel(p));
});
setActivePanel(document.querySelector('.panel'));

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

window.addEventListener('resize', () => { resizeCanvas(); drawPlot(); tableWrapH = 0; tableFirst = -1; renderTableWindow(); });
// Al desplegar un panel plegado, la gráfica y la tabla se dibujan (plegadas no se dibujan).
document.querySelectorAll('.panel').forEach((p) => p.addEventListener('toggle', () => { if (p.open) { drawPlot(); tableWrapH = 0; tableFirst = -1; renderTableWindow(); highlightTableRow(true); } }));
window.addEventListener('beforeunload', (e) => {
  if (S.loaded && hist.pos > 0) { e.preventDefault(); e.returnValue = ''; }
});

resizeCanvas();
syncTracks();
drawPlot();
drawTable();

// Para pruebas automáticas.
window.trackit = { S, seekFrame, autotrack, trackRows, polyfit, addTrack, setPoint, hist, syncAll };

// Al recuperar un análisis, ir al último fotograma marcado del objeto seleccionado.
function resumeAtLast() {
  const tr = selTrack();
  const fr = tr ? sortedFrames(tr) : [];
  if (fr.length) seekFrame(fr[fr.length - 1]);
}
