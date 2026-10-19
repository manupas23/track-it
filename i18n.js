'use strict';
// Textos de la interfaz en español e inglés. t('clave', { var }) devuelve el texto del idioma
// activo; los valores pueden ser funciones (plurales). En el HTML, los elementos llevan
// data-i18n (texto), data-i18n-html (con marcado), data-i18n-title y data-i18n-aria.

const I18N = {
  es: {
    meta_desc: 'Videoanálisis para física: calibra, sigue objetos fotograma a fotograma y obtén posiciones, velocidades y aceleraciones.',
    lang_t: 'Idioma',
    open_video: 'Abrir vídeo',
    open_project: 'Abrir proyecto',
    save_project: 'Guardar proyecto',
    export_csv: 'Exportar CSV',
    undo_t: 'Deshacer (Ctrl+Z)',
    redo_t: 'Rehacer (Ctrl+Y)',
    help_t: 'Ayuda (?)',
    tool_group: 'Herramienta',
    tool_move: 'Mover',
    tool_move_t: 'Mover y editar (V)',
    tool_mark: 'Marcar',
    tool_mark_t: 'Marcar puntos a mano (M). Con Mayús+clic marcas en cualquier modo',
    tool_auto: 'Auto',
    tool_auto_t: 'Autotracking (A): haz clic sobre el objeto y se sigue solo desde este fotograma',
    show_calib: 'Vara',
    show_axes: 'Ejes',
    show_trails: 'Trayectorias',
    show_search: 'Búsqueda',
    show_search_t: 'Plantilla y zona de búsqueda del autotracking sobre el objeto seleccionado',
    fit: 'Ajustar',
    fit_t: 'Ajustar a la ventana (F)',
    drop_big: 'Arrastra aquí un vídeo',
    drop_html: 'o pulsa <b>Abrir vídeo</b>. Mejor MP4 (H.264) o WebM.',
    drop_private: 'El vídeo no sale de tu ordenador: se analiza en el navegador.',
    t_start: 'Inicio del rango (Inicio)',
    t_prev: 'Anterior (←)',
    t_play: 'Reproducir (Espacio)',
    t_next: 'Siguiente (→)',
    t_end: 'Final del rango (Fin)',
    p_video: 'Vídeo y tiempo',
    fps_file: 'fps del archivo',
    fps_real: 'fps reales',
    fps_real_t: 'Si el vídeo es a cámara lenta, pon aquí los fps a los que se grabó',
    range_start: 'Fotograma inicial',
    range_end: 'Fotograma final',
    range_step: 'Paso',
    dt_step: 'Δt por paso',
    hint_time_html: 'El tiempo <code>t = 0</code> es el fotograma inicial. Los fps se detectan solos; si no cuadran, corrígelos.',
    p_calib: 'Calibración y ejes',
    calib_len: 'Longitud de la vara',
    calib_unit: 'Unidad',
    axes_angle: 'Ángulo de los ejes (°)',
    scale: 'Escala',
    calib_on: 'Usar calibración (si no, todo en píxeles)',
    hint_calib: 'Arrastra los extremos de la vara azul sobre algo de longitud conocida. Arrastra el origen de los ejes y su asa para girarlos.',
    p_objs: 'Objetos',
    add_track: '+ Nuevo objeto',
    auto_head: 'Autotracking',
    tpl_size: 'Plantilla (px)',
    tpl_size_t: 'Lado del recuadro que se busca (px). También se cambia arrastrando las esquinas del recuadro sólido en el vídeo',
    search_r: 'Radio de búsqueda',
    search_r_t: 'Cuánto se puede mover el objeto entre pasos (px). También se cambia arrastrando las esquinas del recuadro discontinuo en el vídeo',
    threshold: 'Umbral',
    threshold_t: 'Correlación mínima (0 a 1). Por debajo se detiene',
    evolve: 'Plantilla evolutiva',
    evolve_t: 'La plantilla se va actualizando: ayuda si el objeto cambia de aspecto, pero puede derivar',
    tpl_preview_t: 'Plantilla: lo que se va a buscar',
    hint_tpl: 'Esto es lo que se busca. En el vídeo, el recuadro sólido es la plantilla y el discontinuo, la zona donde se buscará en el siguiente paso.',
    btn_auto: 'Autotrack desde aquí',
    btn_auto_stop: 'Detener autotrack',
    hint_auto_html: 'Lo más rápido: herramienta <b>Auto</b> (<kbd>A</kbd>) y clic sobre el objeto. El botón sigue desde el último punto marcado; <kbd>Esc</kbd> lo detiene.',
    p_plot: 'Gráfica',
    plot_y_aria: 'Eje vertical',
    plot_vs: 'frente a',
    plot_x_aria: 'Eje horizontal',
    fit_aria: 'Ajuste',
    fit0: 'Sin ajuste',
    fit1: 'Lineal',
    fit2: 'Parabólico',
    fit3: 'Cúbico',
    p_table: 'Tabla',
    help_title: 'Cómo se usa',
    help_html: `<ol>
    <li><b>Abre un vídeo</b> (o arrástralo). Comprueba los fps y, si es cámara lenta, pon los fps reales.</li>
    <li><b>Calibra</b>: coloca la vara azul sobre algo de longitud conocida y escribe esa longitud.</li>
    <li><b>Coloca los ejes</b>: arrastra el origen y gíralos con el asa.</li>
    <li><b>Sigue el objeto</b>: con <i>Auto</i> (<kbd>A</kbd>), un clic sobre él lo sigue solo en los fotogramas siguientes. Con <i>Marcar</i> (<kbd>M</kbd>) lo marcas a mano y avanza solo al siguiente paso.</li>
    <li>Mira la gráfica y la tabla, ajusta curvas y <b>exporta a CSV</b>.</li>
  </ol>
  <h3>Atajos</h3>
  <table class="keys">
    <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Paso anterior / siguiente (con <kbd>Mayús</kbd>, de 10 en 10)</td></tr>
    <tr><td><kbd>Inicio</kbd> <kbd>Fin</kbd></td><td>Principio / final del rango</td></tr>
    <tr><td><kbd>Espacio</kbd></td><td>Reproducir / pausar</td></tr>
    <tr><td><kbd>A</kbd> <kbd>M</kbd> <kbd>V</kbd></td><td>Herramienta Auto / Marcar / Mover</td></tr>
    <tr><td><kbd>Mayús</kbd>+clic</td><td>Marcar punto en cualquier herramienta</td></tr>
    <tr><td><kbd>Supr</kbd></td><td>Borrar el punto de este fotograma</td></tr>
    <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd></td><td>Deshacer / rehacer</td></tr>
    <tr><td>Rueda</td><td>Zoom; arrastrar con botón derecho o central (o en vacío con Mover) para desplazar</td></tr>
    <tr><td><kbd>F</kbd></td><td>Ajustar el vídeo a la ventana</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>Detener el autotracking</td></tr>
  </table>
  <h3>Cálculo</h3>
  <p>Las velocidades y aceleraciones se calculan con diferencias centradas entre puntos vecinos, así que el primer y el último punto no tienen velocidad ni aceleración. El análisis se guarda solo en este navegador; usa <i>Guardar proyecto</i> para llevártelo.</p>`,
    help_ok: 'Entendido',

    loading_video: 'Cargando vídeo…',
    detecting_fps: 'Detectando fps…',
    media_1: 'abortado', media_2: 'red', media_3: 'decodificación', media_4: 'formato no soportado',
    err_of: 'error de {what}',
    err_unknown: 'error desconocido',
    err_open: 'El navegador no puede abrir este vídeo ({info}). Conviértelo a MP4 (H.264) o WebM y vuelve a probar.',
    err_repeat: 'El navegador no consigue decodificar este vídeo en el fotograma {frame} ({info}). Prueba con otro navegador, desactiva la aceleración por hardware o conviértelo a MP4 (H.264). El análisis no se ha perdido.',
    err_reloading: 'El vídeo ha fallado; recargando…',
    err_recovered: 'El navegador tuvo un fallo al decodificar el vídeo y se ha recargado en el fotograma {frame}. El análisis está intacto.',
    project_resumed: 'Proyecto cargado: puedes seguir donde lo dejaste.',
    track_name: 'Objeto {n}',
    var_frame: 'fotograma',
    auto_need_point: 'Haz clic sobre el objeto con la herramienta Auto (A), o márcalo primero.',
    tpl_edge: 'El punto está demasiado cerca del borde para esa plantilla.',
    tpl_flat: 'La plantilla es uniforme (sin contraste): elige un punto con más detalle.',
    auto_cancelled: 'Autotrack detenido.',
    auto_stopped: 'Autotrack parado en el fotograma {frame}: coincidencia {score} < {min}. Márcalo a mano y sigue.',
    auto_new: (v) => `${v.n} ${v.n === 1 ? 'punto nuevo' : 'puntos nuevos'}`,
    auto_done: 'Autotrack terminado: {pts}.',
    search_label: 'búsqueda',
    no_point: 'sin punto',
    plot_no_data: 'Sin datos todavía: marca puntos del objeto',
    plot_no_track: 'Crea un objeto',
    fit_need: 'Hacen falta al menos {n} puntos para este ajuste.',
    tip_frame: 'Fotograma {frame}',
    table_empty: 'Sin puntos',
    table_frame: 'fot.',
    readout_frame: 'fot. {frame} / {last}',
    tr_show: 'Mostrar', tr_color: 'Color', tr_name: 'Nombre', tr_count: 'Puntos marcados', tr_delete: 'Borrar objeto',
    del_title: '¿Borrar "{name}"?',
    del_text: (v) => `Se borrarán sus ${v.n} ${v.n === 1 ? 'punto' : 'puntos'}.`,
    del_detail: 'Puedes recuperarlo con Deshacer (Ctrl+Z).',
    cancel: 'Cancelar',
    delete: 'Borrar',
    resume_title: '¿Seguir donde lo dejaste?',
    resume_text: (v) => `Hay un análisis guardado de este vídeo: ${v.t} ${v.t === 1 ? 'objeto' : 'objetos'} y ${v.n} puntos.`,
    resume_detail: 'Si empiezas de cero, el guardado anterior se sustituirá en cuanto marques algo.',
    start_fresh: 'Empezar de cero',
    recover: 'Recuperar',
    other_title: 'El proyecto es de otro vídeo',
    other_text: 'Se guardó con "{saved}" y tienes abierto "{open}".',
    other_detail: 'Si es el mismo vídeo con otro nombre, puedes cargarlo sin problema.',
    load_anyway: 'Cargar igualmente',
    proj_invalid: 'El archivo no es un proyecto válido.',
    proj_not_trackit: 'El archivo no es un proyecto de TrackIt.',
    proj_ready: 'Proyecto listo. Ahora abre el vídeo{name}.',
    proj_loaded: 'Proyecto cargado.',
    no_points_export: 'No hay puntos que exportar.',
    csv_title: 'Exportar CSV',
    csv_text: '¿Dónde vas a abrir los datos?',
    csv_detail: 'Excel en español usa ";" como separador y coma decimal. El estándar (Python, Origin, LibreOffice en inglés…) usa "," y punto decimal.',
    csv_std: 'CSV estándar',
    csv_excel: 'Excel en español',
    csv_object: 'objeto',
    csv_frame: 'fotograma',
  },

  en: {
    meta_desc: 'Video analysis for physics: calibrate, track objects frame by frame and get positions, velocities and accelerations.',
    lang_t: 'Language',
    open_video: 'Open video',
    open_project: 'Open project',
    save_project: 'Save project',
    export_csv: 'Export CSV',
    undo_t: 'Undo (Ctrl+Z)',
    redo_t: 'Redo (Ctrl+Y)',
    help_t: 'Help (?)',
    tool_group: 'Tool',
    tool_move: 'Move',
    tool_move_t: 'Move and edit (V)',
    tool_mark: 'Mark',
    tool_mark_t: 'Mark points by hand (M). Shift+click marks with any tool',
    tool_auto: 'Auto',
    tool_auto_t: 'Autotracking (A): click on the object and it is followed automatically from this frame',
    show_calib: 'Stick',
    show_axes: 'Axes',
    show_trails: 'Trails',
    show_search: 'Search',
    show_search_t: 'Autotracking template and search area on the selected object',
    fit: 'Fit',
    fit_t: 'Fit to window (F)',
    drop_big: 'Drop a video here',
    drop_html: 'or click <b>Open video</b>. MP4 (H.264) or WebM work best.',
    drop_private: 'Your video never leaves your computer: it is analysed in the browser.',
    t_start: 'Start of range (Home)',
    t_prev: 'Previous (←)',
    t_play: 'Play (Space)',
    t_next: 'Next (→)',
    t_end: 'End of range (End)',
    p_video: 'Video and time',
    fps_file: 'File fps',
    fps_real: 'Real fps',
    fps_real_t: 'For slow-motion videos, enter the fps it was recorded at',
    range_start: 'First frame',
    range_end: 'Last frame',
    range_step: 'Step',
    dt_step: 'Δt per step',
    hint_time_html: 'Time <code>t = 0</code> is the first frame. The fps are detected automatically; correct them if they look wrong.',
    p_calib: 'Calibration and axes',
    calib_len: 'Stick length',
    calib_unit: 'Unit',
    axes_angle: 'Axes angle (°)',
    scale: 'Scale',
    calib_on: 'Use calibration (otherwise everything in pixels)',
    hint_calib: 'Drag the ends of the blue stick onto something of known length. Drag the axes origin, and its handle to rotate them.',
    p_objs: 'Objects',
    add_track: '+ New object',
    auto_head: 'Autotracking',
    tpl_size: 'Template (px)',
    tpl_size_t: 'Side of the box that is searched for (px). You can also drag the corners of the solid box on the video',
    search_r: 'Search radius',
    search_r_t: 'How far the object can move between steps (px). You can also drag the corners of the dashed box on the video',
    threshold: 'Threshold',
    threshold_t: 'Minimum correlation (0 to 1). Tracking stops below it',
    evolve: 'Evolving template',
    evolve_t: 'The template is updated as it goes: helps if the object changes appearance, but it can drift',
    tpl_preview_t: 'Template: what will be searched for',
    hint_tpl: 'This is what is searched for. On the video, the solid box is the template and the dashed one is where it will be searched for in the next step.',
    btn_auto: 'Autotrack from here',
    btn_auto_stop: 'Stop autotrack',
    hint_auto_html: 'Quickest: <b>Auto</b> tool (<kbd>A</kbd>) and click on the object. The button continues from the last marked point; <kbd>Esc</kbd> stops it.',
    p_plot: 'Plot',
    plot_y_aria: 'Vertical axis',
    plot_vs: 'vs',
    plot_x_aria: 'Horizontal axis',
    fit_aria: 'Fit',
    fit0: 'No fit',
    fit1: 'Linear',
    fit2: 'Quadratic',
    fit3: 'Cubic',
    p_table: 'Table',
    help_title: 'How to use it',
    help_html: `<ol>
    <li><b>Open a video</b> (or drop it). Check the fps and, for slow motion, enter the real fps.</li>
    <li><b>Calibrate</b>: place the blue stick over something of known length and type that length.</li>
    <li><b>Place the axes</b>: drag the origin and rotate them with the handle.</li>
    <li><b>Track the object</b>: with <i>Auto</i> (<kbd>A</kbd>), one click on it follows it through the next frames. With <i>Mark</i> (<kbd>M</kbd>) you mark it by hand and it moves on to the next step.</li>
    <li>Check the plot and the table, fit curves and <b>export to CSV</b>.</li>
  </ol>
  <h3>Shortcuts</h3>
  <table class="keys">
    <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Previous / next step (with <kbd>Shift</kbd>, 10 at a time)</td></tr>
    <tr><td><kbd>Home</kbd> <kbd>End</kbd></td><td>Start / end of range</td></tr>
    <tr><td><kbd>Space</kbd></td><td>Play / pause</td></tr>
    <tr><td><kbd>A</kbd> <kbd>M</kbd> <kbd>V</kbd></td><td>Auto / Mark / Move tool</td></tr>
    <tr><td><kbd>Shift</kbd>+click</td><td>Mark a point with any tool</td></tr>
    <tr><td><kbd>Del</kbd></td><td>Delete the point on this frame</td></tr>
    <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd></td><td>Undo / redo</td></tr>
    <tr><td>Wheel</td><td>Zoom; drag with the right or middle button (or on empty space with Move) to pan</td></tr>
    <tr><td><kbd>F</kbd></td><td>Fit the video to the window</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>Stop autotracking</td></tr>
  </table>
  <h3>Calculations</h3>
  <p>Velocities and accelerations use centred differences between neighbouring points, so the first and last points have no velocity or acceleration. Your analysis is only stored in this browser; use <i>Save project</i> to take it elsewhere.</p>`,
    help_ok: 'Got it',

    loading_video: 'Loading video…',
    detecting_fps: 'Detecting fps…',
    media_1: 'aborted', media_2: 'network', media_3: 'decoding', media_4: 'unsupported format',
    err_of: '{what} error',
    err_unknown: 'unknown error',
    err_open: 'The browser cannot open this video ({info}). Convert it to MP4 (H.264) or WebM and try again.',
    err_repeat: 'The browser keeps failing to decode this video at frame {frame} ({info}). Try another browser, turn off hardware acceleration or convert it to MP4 (H.264). Your analysis is safe.',
    err_reloading: 'The video failed; reloading…',
    err_recovered: 'The browser failed to decode the video and it was reloaded at frame {frame}. Your analysis is intact.',
    project_resumed: 'Project loaded: you can carry on where you left off.',
    track_name: 'Object {n}',
    var_frame: 'frame',
    auto_need_point: 'Click on the object with the Auto tool (A), or mark it first.',
    tpl_edge: 'The point is too close to the edge for that template size.',
    tpl_flat: 'The template is flat (no contrast): pick a point with more detail.',
    auto_cancelled: 'Autotrack stopped.',
    auto_stopped: 'Autotrack stopped at frame {frame}: match {score} < {min}. Mark it by hand and continue.',
    auto_new: (v) => `${v.n} new ${v.n === 1 ? 'point' : 'points'}`,
    auto_done: 'Autotrack finished: {pts}.',
    search_label: 'search',
    no_point: 'no point',
    plot_no_data: 'No data yet: mark points of the object',
    plot_no_track: 'Create an object',
    fit_need: 'This fit needs at least {n} points.',
    tip_frame: 'Frame {frame}',
    table_empty: 'No points',
    table_frame: 'fr.',
    readout_frame: 'fr. {frame} / {last}',
    tr_show: 'Show', tr_color: 'Colour', tr_name: 'Name', tr_count: 'Marked points', tr_delete: 'Delete object',
    del_title: 'Delete "{name}"?',
    del_text: (v) => `Its ${v.n} ${v.n === 1 ? 'point' : 'points'} will be deleted.`,
    del_detail: 'You can get it back with Undo (Ctrl+Z).',
    cancel: 'Cancel',
    delete: 'Delete',
    resume_title: 'Carry on where you left off?',
    resume_text: (v) => `There is a saved analysis of this video: ${v.t} ${v.t === 1 ? 'object' : 'objects'} and ${v.n} points.`,
    resume_detail: 'If you start over, the previous save will be replaced as soon as you mark something.',
    start_fresh: 'Start over',
    recover: 'Restore',
    other_title: 'The project belongs to another video',
    other_text: 'It was saved with "{saved}" and you have "{open}" open.',
    other_detail: 'If it is the same video with a different name, you can load it safely.',
    load_anyway: 'Load anyway',
    proj_invalid: 'The file is not a valid project.',
    proj_not_trackit: 'The file is not a TrackIt project.',
    proj_ready: 'Project ready. Now open the video{name}.',
    proj_loaded: 'Project loaded.',
    no_points_export: 'There are no points to export.',
    csv_title: 'Export CSV',
    csv_text: 'Where will you open the data?',
    csv_detail: 'Standard CSV uses "," as separator and a decimal point (Python, Origin, English Excel…). The other option uses ";" and a decimal comma, as Excel does in Spanish and other European locales.',
    csv_std: 'Standard CSV',
    csv_excel: 'Excel with decimal comma',
    csv_object: 'object',
    csv_frame: 'frame',
  },
};

const LANG_KEY = 'trackit-lang';
let LANG = (() => {
  try { const s = localStorage.getItem(LANG_KEY); if (s === 'es' || s === 'en') return s; } catch (e) { /* sin almacenamiento */ }
  return /^es\b/i.test(navigator.language || '') ? 'es' : 'en';
})();

function t(key, vars = {}) {
  const v = (I18N[LANG] && I18N[LANG][key]) ?? I18N.es[key] ?? key;
  if (typeof v === 'function') return v(vars);
  return v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

// Aplica el idioma a los textos fijos del HTML.
function applyStaticLang() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = t('meta_desc');
  document.querySelectorAll('.lang-btn').forEach((b) => b.classList.toggle('active', b.dataset.lang === LANG));
}

function setLang(lang) {
  if (lang === LANG || !I18N[lang]) return;
  LANG = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* sin almacenamiento */ }
  applyStaticLang();
  document.dispatchEvent(new Event('langchange'));
}

applyStaticLang();
