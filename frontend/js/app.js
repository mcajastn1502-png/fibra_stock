/* Fibra Stock — aplicación (SPA sin framework). */
(function () {
  'use strict';
  var cfg = window.FIBRA_CONFIG || {};
  var $app = document.getElementById('app');
  var BOOT = null, charts = [];

  /* ============================ utilidades ============================ */
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /** Números con espacio fino como separador de miles: evita la ambigüedad 3.156 / 3,156 */
  function fmt(n, dec) {
    if (n === null || n === undefined || n === '' || isNaN(+n)) return n === null || n === undefined ? '' : esc(n);
    var v = (+n).toFixed(dec || 0), parts = v.split('.'), neg = parts[0][0] === '-'; if (neg) parts[0] = parts[0].slice(1);
    return (neg ? '−' : '') + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (parts[1] && +parts[1] ? ',' + parts[1] : '');
  }
  function m(n) { return fmt(n) + ' m'; }
  var SEV = { CRITICA: 'p-CRITICA', ALTA: 'p-ALTA', MEDIA: 'p-MEDIA', BAJA: 'p-BAJA_SEV', INFO: '' };
  function pill(v, sev) { if (!v) return ''; return '<span class="pill ' + (sev ? SEV[v] || '' : 'p-' + esc(v)) + '">' + esc(String(v).replace(/_/g, ' ')) + '</span>'; }
  function can(p) { return BOOT && BOOT.user.permisos.indexOf(p) >= 0; }
  function toast(msg, kind) {
    var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    document.getElementById('toast').appendChild(t); setTimeout(function () { t.remove(); }, kind === 'err' ? 9000 : 4500);
  }
  function api(action, payload) { return Api.call(action, payload); }
  function todayISO() { return (BOOT && BOOT.hoy) || new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10); }
  function opt(list, sel, empty) { return (empty !== undefined ? '<option value="">' + esc(empty) + '</option>' : '') + list.map(function (v) { var val = typeof v === 'object' ? v.v : v, lab = typeof v === 'object' ? v.l : v; return '<option value="' + esc(val) + '"' + (String(val) === String(sel) ? ' selected' : '') + '>' + esc(lab) + '</option>'; }).join(''); }
  function formData(root) { var o = {}; root.querySelectorAll('[name]').forEach(function (el) { o[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); }); return o; }
  function busy(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = 'Procesando…'; } else if (btn.dataset.t) btn.textContent = btn.dataset.t; }
  function destroyCharts() { charts.forEach(function (c) { c.destroy(); }); charts = []; }
  function field(name, label, type, o) {
    o = o || {}; var req = o.req ? ' <span class="req">*</span>' : '', id = 'f_' + name + '_' + Math.random().toString(36).slice(2, 7);
    var ctl;
    if (type === 'select') ctl = '<select id="' + id + '" name="' + name + '">' + opt(o.options || [], o.value, o.empty === undefined ? '— seleccione —' : o.empty) + '</select>';
    else if (type === 'textarea') ctl = '<textarea id="' + id + '" name="' + name + '" placeholder="' + esc(o.ph || '') + '">' + esc(o.value || '') + '</textarea>';
    else ctl = '<input id="' + id + '" name="' + name + '" type="' + (type || 'text') + '" value="' + esc(o.value === undefined ? '' : o.value) + '"' + (o.list ? ' list="' + o.list + '"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (type === 'number' ? ' inputmode="numeric" step="any"' : '') + (o.max ? ' max="' + o.max + '"' : '') + '>';
    return '<div class="f' + (o.full ? ' full' : '') + (o.wide ? ' wide' : '') + '"><label for="' + id + '">' + esc(label) + req + '</label>' + ctl + (o.hint ? '<span class="hint">' + o.hint + '</span>' : '') + '</div>';
  }
  function datalists() {
    var c = BOOT.catalogos;
    return '<datalist id="dl-dep">' + c.departamentos.map(function (d) { return '<option value="' + esc(d) + '">'; }).join('') + '</datalist>' +
      '<datalist id="dl-con">' + c.contratistas.map(function (d) { return '<option value="' + esc(d) + '">'; }).join('') + '</datalist>' +
      '<datalist id="dl-art">' + c.articulos.map(function (a) { return '<option value="' + esc(a.codigo) + '">' + esc(a.descripcion) + '</option>'; }).join('') + '</datalist>';
  }

  /** Tabla con orden, filtro rápido y exportación a Excel */
  function table(el, opts) {
    var rows = opts.rows || [], sortK = null, dir = 1, q = '', limit = opts.limit || 300;
    function render() {
      var f = rows;
      if (q) { var k = q.toLowerCase(); f = rows.filter(function (r) { return opts.cols.some(function (c) { return String(r[c.k] === undefined ? '' : r[c.k]).toLowerCase().indexOf(k) >= 0; }); }); }
      if (sortK) f = f.slice().sort(function (a, b) { var x = a[sortK], y = b[sortK]; if (!isNaN(+x) && !isNaN(+y) && x !== '' && y !== '') return (x - y) * dir; return String(x).localeCompare(String(y)) * dir; });
      el.innerHTML = '<div class="tbl-bar"><div class="row"><input class="tq" placeholder="Filtrar tabla…" value="' + esc(q) + '" style="width:220px"><span class="muted">' + f.length + ' de ' + rows.length + ' registros' + (f.length > limit ? ' · mostrando ' + limit : '') + '</span></div>' +
        '<div class="row">' + (opts.extraBtns || '') + '<button class="btn sm xl">Excel</button></div></div>' +
        '<div class="tbl-wrap"><table><thead><tr>' + opts.cols.map(function (c) { return '<th data-k="' + c.k + '" class="' + (c.n ? 'n' : '') + '">' + esc(c.l) + (sortK === c.k ? (dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (f.length ? f.slice(0, limit).map(function (r, i) { return '<tr data-i="' + rows.indexOf(r) + '"' + (opts.onRow ? ' class="click"' : '') + '>' + opts.cols.map(function (c) { var v = r[c.k]; return '<td class="' + (c.n ? 'n' : '') + (c.n && +v < 0 ? ' neg' : '') + '">' + (c.f ? c.f(v, r) : c.n ? fmt(v) : esc(v)) + '</td>'; }).join('') + '</tr>'; }).join('')
          : '<tr><td colspan="' + opts.cols.length + '" style="text-align:center;color:var(--ink-3);padding:20px">' + (opts.empty || 'Sin registros') + '</td></tr>') + '</tbody></table></div>';
      el.querySelector('.tq').oninput = function (e) { q = e.target.value; var pos = e.target.selectionStart; render(); var n = el.querySelector('.tq'); n.focus(); n.setSelectionRange(pos, pos); };
      el.querySelectorAll('th').forEach(function (th) { th.onclick = function () { var k = th.dataset.k; dir = sortK === k ? -dir : 1; sortK = k; render(); }; });
      el.querySelector('.xl').onclick = function () { exportXlsx([{ titulo: opts.name || 'datos', filas: f.map(function (r) { var o = {}; opts.cols.forEach(function (c) { o[c.l] = r[c.k]; }); return o; }) }], opts.name || 'fibra'); };
      if (opts.onRow) el.querySelectorAll('tbody tr[data-i]').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('button,a')) return; opts.onRow(rows[+tr.dataset.i]); }; });
      if (opts.after) opts.after(el);
    }
    render();
    return { set: function (r) { rows = r; render(); } };
  }
  function exportXlsx(secciones, name) {
    if (!window.XLSX) { toast('No se pudo cargar la librería de Excel.', 'err'); return; }
    var wb = XLSX.utils.book_new();
    secciones.forEach(function (s, i) { XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.filas.length ? s.filas : [{ info: 'Sin registros' }]), (s.titulo || 'Hoja' + i).replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 31)); });
    XLSX.writeFile(wb, name.replace(/\s+/g, '_') + '_' + todayISO() + '.xlsx');
  }
  function modal(html, onReady, className) {
    var bg = document.createElement('div'); bg.className = 'modal-bg'; bg.innerHTML = '<div class="modal ' + (className || '') + '" role="dialog">' + html + '</div>';
    document.body.appendChild(bg); bg.onclick = function (e) { if (e.target === bg) bg.remove(); };
    var close = function () { bg.remove(); }; bg.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = close; });
    if (onReady) onReady(bg.querySelector('.modal'), close);
  }

  /* ============================ navegación ============================ */
  var NAV = [
    ['Operación'],
    ['dashboard', 'Inicio', 'leer', '▦'], ['inventario', 'Inventario actual', 'leer', '≡'], ['buscar', 'Buscar serie', 'leer', '⌕'], ['vida', 'Historial fibra', 'leer', '◷'],
    ['Registro'],
    ['movimiento', 'Registrar movimiento', 'registrar', '+'], ['prestamos', 'Préstamos', 'leer', '⇄'],
    ['sobrantes', 'Sobrantes', 'leer', '◔', 'oculto'], ['traslado', 'Transferencias', 'registrar', '⇢'],
    ['Control'],
    ['alertas', 'Alertas y Revisión', 'leer', '!'], ['reportes', 'Reportes', 'reportes', '▤'], ['abastecimiento', 'Abastecimiento', 'leer', '↗'],
    ['Administración'],
    ['catalogos', 'Catálogos', 'leer', '☰'], ['usuarios', 'Usuarios', 'usuarios', '☺'], ['bitacora', 'Bitácora de cambios', 'bitacora', '✎']
  ];
  var SCREENS = {};
  var LOGO = '<svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="#13293b"/><circle cx="16" cy="16" r="9" fill="none" stroke="#3fc1c9" stroke-width="3"/><circle cx="16" cy="16" r="3" fill="#3fc1c9"/></svg>';

  function shell(route) {
    var u = BOOT.user;
    $app.innerHTML = '<div class="shell"><nav class="side" id="side"><div class="brand">' + LOGO + '<span>' + esc(cfg.APP_NAME || 'Fibra Stock') + '</span></div>' +
      NAV.map(function (n) { if (n.length === 1) return '<div class="grp">' + n[0] + '</div>'; if (!can(n[2]) || n[4] === 'oculto') return ''; return '<a href="#' + n[0] + '" data-r="' + n[0] + '"><span style="width:16px;text-align:center">' + n[3] + '</span>' + n[1] + (n[0] === 'alertas' ? '<span class="cnt" id="nav-crit" hidden></span>' : '') + '</a>'; }).join('') +
      '<div class="me"><b>' + esc(u.nombre || u.email) + '</b>' + esc(u.email) + '<br>Rol: ' + esc(u.rol) + '<div class="row" style="margin-top:8px">' + (Api.demo ? '' : '<button class="btn sm" id="btn-pass">Cambiar clave</button>') + '<button class="btn sm" id="btn-out">Salir</button></div></div></nav>' +
      '<div class="main"><div class="top"><button class="btn sm menu-btn" id="btn-menu" aria-label="Menú">☰</button><h2 id="ttl"></h2><span class="sp"></span>' + (Api.demo ? '<span class="badge-demo">MODO DEMO · datos solo en este navegador</span>' : '') + '<span class="hint">Hoy ' + esc(BOOT.hoy) + '</span></div><div class="content" id="view"></div></div></div>';
    document.getElementById('btn-out').onclick = function () { Api.logout(); BOOT = null; location.hash = '#login'; route_(); };
    document.getElementById('btn-menu').onclick = function () { document.getElementById('side').classList.toggle('open'); };
    var bp = document.getElementById('btn-pass'); if (bp) bp.onclick = changePassword;
  }
  function changePassword() {
    modal('<h3>Cambiar contraseña</h3><div class="form-grid">' + field('actual', 'Contraseña actual', 'password', { req: 1 }) + field('nueva', 'Nueva contraseña (mín. 8)', 'password', { req: 1 }) + '</div><div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Guardar</button></div>', function (md, close) {
      md.querySelector('#ok').onclick = function () { var d = formData(md); api('changePassword', d).then(function () { toast('Contraseña actualizada.', 'ok'); close(); }).catch(function (e) { toast(e.message, 'err'); }); };
    });
  }

  async function route_() {
    var h = decodeURIComponent(location.hash.slice(1) || 'dashboard'), parts = h.split('/'), r = parts[0];
    if (!Api.session()) { renderLogin(); return; }
    if (!BOOT) { $app.innerHTML = '<div class="loading">Cargando catálogos…</div>'; try { BOOT = await api('bootstrap'); } catch (e) { Api.logout(); renderLogin(e.message); return; } }
    if (r === 'login') r = 'dashboard';
    if (!document.getElementById('view')) shell(r);
    var nav = NAV.filter(function (n) { return n[0] === r; })[0];
    if (!nav || !can(nav[2])) { r = 'dashboard'; nav = NAV[1]; }
    document.querySelectorAll('.side a').forEach(function (a) { a.classList.toggle('on', a.dataset.r === r); });
    document.getElementById('side').classList.remove('open');
    document.getElementById('ttl').textContent = nav[1];
    destroyCharts();
    var v = document.getElementById('view'); v.innerHTML = '<div class="loading">Cargando…</div>';
    try { await SCREENS[r](v, parts.slice(1).join('/')); } catch (e) { v.innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; }
    refreshCritCount();
  }
  function refreshCritCount() {
    api('alerts', { filtros: { estado: 'ABIERTAS', categoria: 'CRITICA', limite: 1 } }).then(function (r) { var b = document.getElementById('nav-crit'); if (b) { b.hidden = !r.total; b.textContent = r.total; } }).catch(function () {});
  }
  window.addEventListener('hashchange', route_);

  /* ============================ login ============================ */
  function renderLogin(err) {
    $app.innerHTML = '<div class="login"><div class="login-card"><div class="brand">' + LOGO + '<span>' + esc(cfg.APP_NAME || 'Fibra Stock') + '</span></div>' +
      '<h1>Inventario de fibra óptica</h1><p class="sub">' + esc(cfg.EMPRESA || '') + '</p>' + (err ? '<div class="note err">' + esc(err) + '</div>' : '') +
      (Api.demo ? demoLogin() : '<form id="lf"><div class="grid" style="gap:12px">' + field('email', 'Correo', 'email', { req: 1 }) + field('password', 'Contraseña', 'password', { req: 1 }) + '</div><div class="actions"><button class="btn pri" type="submit">Ingresar</button></div></form>') +
      '</div></div>';
    if (Api.demo) bindDemo();
    else document.getElementById('lf').onsubmit = function (e) {
      e.preventDefault(); var d = formData(e.target), b = e.target.querySelector('button'); busy(b, true);
      Api.login(d.email, d.password).then(function () { BOOT = null; location.hash = '#dashboard'; route_(); }).catch(function (x) { busy(b, false); renderLogin(x.message); });
    };
  }
  function demoLogin() {
    var roles = ['ADMIN', 'SUPERVISOR', 'BODEGA', 'ANALISTA', 'CONSULTA'];
    return '<div class="note warn">No hay API configurada (<code>js/config.js</code>). Puede probar la aplicación completa en <b>modo demo</b>: los datos se procesan solo en este navegador y no se envían a ningún servidor.</div>' +
      '<div class="grid" style="gap:12px">' + field('rol', 'Rol a simular', 'select', { options: roles, value: 'ADMIN', empty: undefined }) +
      (Api.hasDemoData() ? '<button class="btn pri" id="resume">Continuar con los datos cargados</button>' : '') +
      '<div class="demo-box"><h3>Cargar matriz</h3><p>Seleccione la matriz en formato CSV, XLSX o XLS, con encabezados en la primera fila. Se aplicarán las mismas reglas que en Apps Script.</p><input type="file" id="matrix-file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>' +
      '<div class="demo-box"><h3>Cargar desde Google Sheets</h3><p>Pegue el enlace de la hoja con la pestaña de la matriz abierta. La hoja debe estar compartida como <b>“Cualquier persona con el enlace”</b> (lector).</p>' +
      '<div class="grid" style="gap:8px">' + field('sheet_url', 'Enlace de Google Sheets', 'url', { value: lastSheetUrl(), ph: 'https://docs.google.com/spreadsheets/d/…/edit#gid=…' }) +
      '<button class="btn" id="sheet-load" type="button">Cargar desde el enlace</button></div></div>' +
      (Api.hasDemoData() ? '<button class="btn sm danger" id="reset">Borrar datos de la demo</button>' : '') + '</div>';
  }
  var SHEET_URL_KEY = 'fibra_demo_sheet_url';
  function lastSheetUrl() { try { return localStorage.getItem(SHEET_URL_KEY) || ''; } catch (e) { return ''; } }
  /** Enlace de Google Sheets → URL de exportación CSV de esa pestaña (valores tal como se ven en la hoja). */
  function sheetCsvUrl(url) {
    var id = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(url), gid = /[#?&]gid=(\d+)/.exec(url);
    if (!id) throw new Error('El enlace no es de Google Sheets.');
    return 'https://docs.google.com/spreadsheets/d/' + id[1] + '/export?format=csv' + (gid ? '&gid=' + gid[1] : '');
  }
  function bindDemo() {
    var rolSel = document.querySelector('select[name=rol]');
    var r = document.getElementById('resume'); if (r) r.onclick = function () { Api.resumeDemo(rolSel.value); BOOT = null; location.hash = '#dashboard'; route_(); };
    var x = document.getElementById('reset'); if (x) x.onclick = function () { Api.resetDemo(); renderLogin(); };
    var sl = document.getElementById('sheet-load');
    sl.onclick = function () {
      var url = document.querySelector('input[name=sheet_url]').value.trim();
      if (!url) { toast('Pegue el enlace de Google Sheets.', 'err'); return; }
      busy(sl, true);
      Promise.resolve().then(function () { return fetch(sheetCsvUrl(url), { redirect: 'follow' }); }).then(function (res) {
        if (!res.ok) throw new Error('Google respondió ' + res.status + '. Verifique que la hoja esté compartida como “Cualquier persona con el enlace”.');
        return res.text();
      }).then(function (csv) {
        if (/^\s*<(!doctype|html)/i.test(csv)) throw new Error('Google pidió iniciar sesión: la hoja no está compartida como “Cualquier persona con el enlace”.');
        try { localStorage.setItem(SHEET_URL_KEY, url); } catch (e) { /* sin almacenamiento */ }
        return Api.startDemo(csv, rolSel.value);
      }).then(function () { BOOT = null; location.hash = '#dashboard'; route_(); })
        .catch(function (err) { renderLogin('No se pudo cargar la hoja: ' + (err instanceof TypeError ? 'el navegador bloqueó la descarga (la hoja no es pública o no hay conexión).' : err.message)); });
    };
    document.getElementById('matrix-file').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      var excel = /\.(xlsx|xls)$/i.test(f.name), csv = /\.csv$/i.test(f.name);
      var rd = new FileReader(); rd.onload = function () {
        try {
          var content = rd.result;
          if (excel) {
            if (!window.XLSX) throw new Error('No se pudo cargar la librería de Excel.');
            var wb = window.XLSX.read(content, { type: 'array' }), sheetName = wb.SheetNames.filter(function (name) { return String(name).trim().toUpperCase() === 'MATRIZ'; })[0] || wb.SheetNames[0];
            if (!sheetName) throw new Error('El archivo Excel no contiene hojas.');
            content = window.XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
          } else if (!csv) throw new Error('Use un archivo CSV, XLSX o XLS.');
          Api.startDemo(content, rolSel.value).then(function () { BOOT = null; location.hash = '#dashboard'; route_(); }).catch(function (err) { renderLogin('No se pudo procesar el archivo: ' + err.message); });
        } catch (err) { renderLogin('No se pudo procesar el archivo: ' + err.message); }
      };
      rd.onerror = function () { renderLogin('No se pudo leer el archivo.'); };
      if (excel) rd.readAsArrayBuffer(f); else rd.readAsText(f, 'utf-8');
    };
  }

  /* ============================ 1. dashboard ============================ */
  var dashFilters = {};
  function filterBar(f, withFlows) {
    var c = BOOT.catalogos;
    return '<div class="card"><form class="filters" id="flt">' +
      (withFlows ? field('desde', 'Desde', 'date', { value: f.desde }) + field('hasta', 'Hasta', 'date', { value: f.hasta }) : '') +
      field('bodega', 'Bodega', 'select', { options: c.bodegas, value: f.bodega, empty: 'Todas' }) +
      field('codigo', 'Código / familia', 'text', { value: f.codigo, list: 'dl-art' }) + field('descripcion', 'Descripción', 'text', { value: f.descripcion }) +
      field('hilos', 'Hilos', 'select', { options: c.hilos.map(function (h) { return { v: h, l: h + 'H' }; }), value: f.hilos, empty: 'Todos' }) +
      field('span', 'Span', 'select', { options: [80, 120, 200, 250, 600], value: f.span, empty: 'Todos' }) +
      field('estado', 'Estado', 'select', { options: c.estados, value: f.estado, empty: 'Todos' }) +
      (withFlows ? field('departamento', 'Departamento', 'select', { options: c.departamentos, value: f.departamento, empty: 'Todos' }) +
        field('contratista', 'Contratista', 'select', { options: c.contratistas, value: f.contratista, empty: 'Todos' }) + field('ruta', 'Ruta / proyecto', 'text', { value: f.ruta }) : '') +
      '<div class="row"><button class="btn pri" type="submit">Aplicar</button><button class="btn" type="button" id="clr">Limpiar</button></div></form>' + datalists() + '</div>';
  }
  /** Descripción del artículo para un código exacto o, si es una familia, la del primer artículo de esa familia. */
  function artDesc(codigo) {
    var k = String(codigo || '').trim().toUpperCase(), arts = BOOT.catalogos.articulos || []; if (!k) return '';
    var a = arts.filter(function (x) { return String(x.codigo).toUpperCase() === k; })[0] || arts.filter(function (x) { return String(x.familia).toUpperCase() === k; })[0];
    return a ? a.descripcion || '' : '';
  }
  /** Código de artículo + Descripción (solo lectura, sale del catálogo). Editable solo para series nuevas; si no, el código es el de la serie. */
  function codigoFields(editable, codigo) {
    return field('codigo', 'Código de artículo', 'text', editable ? { list: 'dl-art', req: 1, value: codigo } : { value: codigo || '', ph: 'Consulte la serie' }) +
      field('descripcion_art', 'Descripción', 'text', { value: artDesc(codigo), wide: 1 });
  }
  function bindCodigoFields(root, editable) {
    var cod = root.querySelector('[name=codigo]'), desc = root.querySelector('[name=descripcion_art]'); if (!cod || !desc) return;
    desc.readOnly = true; cod.readOnly = !editable;
    var sync = function () { desc.value = artDesc(cod.value); };
    cod.addEventListener('input', sync); cod.addEventListener('change', sync); sync();
  }
  /** Pone el código de la serie consultada (o lo limpia) y actualiza su descripción. */
  function setCodigo(root, s) {
    var cod = root.querySelector('[name=codigo]'); if (!cod) return;
    cod.value = s ? s.codigo || '' : ''; cod.dispatchEvent(new Event('change'));
  }
  /** Al elegir un código, llena Descripción. Ese texto es informativo: no se envía como filtro mientras el usuario no lo edite. */
  function bindCodigoDesc(form) {
    var cod = form.querySelector('[name=codigo]'), desc = form.querySelector('[name=descripcion]');
    if (!cod || !desc) return;
    var sync = function () { if (desc.value && !desc.dataset.auto) return; var d = artDesc(cod.value); desc.value = d; if (d) desc.dataset.auto = d; else delete desc.dataset.auto; };
    cod.addEventListener('input', sync); cod.addEventListener('change', sync);
    desc.addEventListener('input', function () { delete desc.dataset.auto; });
    sync();
  }
  function bindFilters(v, f, cb) {
    var form = v.querySelector('#flt'); bindCodigoDesc(form);
    form.onsubmit = function (e) {
      e.preventDefault(); var d = formData(e.target), desc = e.target.querySelector('[name=descripcion]');
      if (desc && desc.dataset.auto && d.descripcion === desc.dataset.auto) delete d.descripcion;
      Object.keys(f).forEach(function (k) { delete f[k]; }); Object.keys(d).forEach(function (k) { if (d[k]) f[k] = d[k]; }); cb();
    };
    v.querySelector('#clr').onclick = function () { Object.keys(f).forEach(function (k) { delete f[k]; }); cb(); };
  }
  function chart(id, type, labels, datasets, o) {
    if (!window.Chart) return; o = o || {};
    var el = document.getElementById(id); if (!el) return;
    var c = new Chart(el, { type: type, data: { labels: labels, datasets: datasets }, options: {
      responsive: true, maintainAspectRatio: false, indexAxis: o.h ? 'y' : 'x', animation: false,
      plugins: { legend: { display: datasets.length > 1 || type === 'doughnut', position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: function (ctx) { var v = ctx.parsed && typeof ctx.parsed === 'object' ? (o.h ? ctx.parsed.x : ctx.parsed.y) : ctx.parsed; return (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + fmt(v) + ' m'; } } } },
      scales: type === 'doughnut' ? {} : (function () {
        var numT = { font: { size: 11 }, callback: function (v) { return fmt(v); } }, catT = { font: { size: 11 } };
        return { x: { stacked: !!o.stack, ticks: o.h ? numT : catT }, y: { stacked: !!o.stack, ticks: o.h ? catT : numT } };
      })()
    } });
    charts.push(c);
  }
  var C = { a: '#0b7a83', b: '#e3a008', c: '#3a6ea5', d: '#b4232c', e: '#7c8a97', f: '#2f7d32' };
  SCREENS.dashboard = async function (v) {
    var d = await api('dashboard', { filtros: dashFilters }), k = d.kpi;
    var K = function (l, val, cls, unit, action) {
      var tag = action ? 'button' : 'div';
      return '<' + tag + ' class="kpi ' + (cls || '') + (action ? ' kpi-action' : '') + '"' + (action ? ' type="button" data-kpi-action="' + action + '"' : '') + '><div class="l">' + l + '</div><div class="v">' + fmt(val) + (unit === false ? '' : '<small>m</small>') + '</div></' + tag + '>';
    };
    var serieCols = [
      { k: 'bodega', l: 'Bodega' }, { k: 'codigo', l: 'Código' }, { k: 'descripcion', l: 'Descripción' },
      { k: 'serie', l: 'Serie' }, { k: 'cantidad', l: 'Saldo (m)', n: 1 }, { k: 'estado', l: 'Estado' },
      { k: 'tipo_saldo', l: 'Tipo de saldo' }, { k: 'alertas', l: 'Alertas', n: 1 }
    ];
    var movimientoCols = [
      { k: 'fecha', l: 'Fecha' }, { k: 'tipo', l: 'Movimiento' }, { k: 'serie', l: 'Serie' },
      { k: 'codigo', l: 'Código' }, { k: 'descripcion', l: 'Descripción' }, { k: 'cantidad', l: 'Metraje (m)', n: 1 },
      { k: 'departamento', l: 'Departamento' }, { k: 'contratista', l: 'Contratista' },
      { k: 'ruta', l: 'Ruta' }, { k: 'documento', l: 'Documento' }
    ];
    var prestamoCols = [
      { k: 'prestamo', l: 'Préstamo' }, { k: 'serie', l: 'Serie' }, { k: 'codigo', l: 'Código' },
      { k: 'descripcion', l: 'Descripción' }, { k: 'responsable', l: 'Responsable' }, { k: 'departamento', l: 'Departamento' },
      { k: 'ruta', l: 'Ruta / proyecto' }, { k: 'prestado', l: 'Prestado (m)', n: 1 }, { k: 'devuelto', l: 'Devuelto (m)', n: 1 },
      { k: 'pendiente', l: 'Pendiente (m)', n: 1 }, { k: 'fecha_limite', l: 'Fecha límite' }, { k: 'estado', l: 'Estado' }
    ];
    var detailDefs = {
      disponible_confirmado: { title: 'Disponible confirmado', rows: 'disponible_confirmado', cols: serieCols },
      disponible_revisar: { title: 'Disponible por revisar', rows: 'disponible_revisar', cols: serieCols },
      despachado_periodo: { title: 'Despachado en el período', rows: 'despachado_periodo', cols: movimientoCols },
      devuelto_periodo: { title: 'Devuelto en el período', rows: 'devuelto_periodo', cols: movimientoCols },
      prestado_pendiente: { title: 'Préstamo pendiente', rows: 'prestado_pendiente', cols: prestamoCols },
      reservado: { title: 'Reservado', rows: 'reservado', cols: [
        { k: 'departamento', l: 'Departamento' }, { k: 'codigo', l: 'Código' }, { k: 'descripcion', l: 'Descripción' },
        { k: 'serie', l: 'Serie' }, { k: 'cantidad', l: 'Cantidad de la serie (m)', n: 1 }, { k: 'ruta', l: 'Ruta' }
      ] },
      mal_estado: { title: 'En mal estado', rows: 'mal_estado', cols: serieCols },
      rollos_activos: { title: 'Rollos activos', rows: 'rollos_activos', cols: serieCols },
      series_negativas: { title: 'Series con saldo negativo', rows: 'series_negativas', cols: serieCols },
      series_revisar: { title: 'Series por revisar', rows: 'series_revisar', cols: serieCols },
      prestamos_vencidos: { title: 'Préstamos vencidos', rows: 'prestamos_vencidos', cols: prestamoCols },
      prestamos_sin_fecha: { title: 'Préstamos sin fecha límite', rows: 'prestamos_sin_fecha', cols: prestamoCols },
      saldo_bajo: { title: 'Rollos con saldo bajo', rows: 'saldo_bajo', cols: serieCols }
    };
    v.innerHTML = filterBar(dashFilters, true) +
      '<div class="kpis">' + K('Disponible confirmado', k.metros_disponibles, 'good', undefined, 'disponible_confirmado') + K('Disponible por revisar', k.metros_disponibles_por_revisar, 'warn', undefined, 'disponible_revisar') +
      K('Despachado (periodo)', k.metros_despachados, '', undefined, 'despachado_periodo') + K('Devuelto (periodo)', k.metros_devueltos, '', undefined, 'devuelto_periodo') + K('Prestado pendiente', k.metros_prestados, '', undefined, 'prestado_pendiente') +
      K('Reservado', k.metros_reservados, '', undefined, 'reservado') + K('En mal estado', k.metros_mal_estado, 'warn', undefined, 'mal_estado') + K('Rollos activos', k.rollos_activos, '', false, 'rollos_activos') +
      K('Series con saldo negativo', k.series_saldo_negativo, k.series_saldo_negativo ? 'crit' : '', false, 'series_negativas') + K('Series por revisar', k.series_pendientes_REVISION, 'warn', false, 'series_revisar') +
      K('Préstamos vencidos', k.prestamos_vencidos, k.prestamos_vencidos ? 'crit' : '', false, 'prestamos_vencidos') + K('Préstamos sin fecha límite', k.prestamos_sin_fecha, k.prestamos_sin_fecha ? 'warn' : '', false, 'prestamos_sin_fecha') +
      K('Rollos con saldo bajo', k.rollos_saldo_bajo, '', false, 'saldo_bajo') + '</div>' +
      '<div class="grid g2"><div class="card"><h3>Stock disponible por bodega<small>confirmado vs. por revisar</small></h3><div class="chart-box"><canvas id="c1"></canvas></div></div>' +
      '<div class="card"><h3>Stock disponible por número de hilos</h3><div class="chart-box"><canvas id="c2"></canvas></div></div></div>' +
      '<div class="card"><h3>Tendencia mensual<small>despachos, devoluciones y consumo efectivo (despachado − devuelto)</small></h3><div class="chart-box tall"><canvas id="c3"></canvas></div></div>' +
      '<div class="grid g2"><div class="card"><h3>Stock por código de artículo</h3><div class="chart-box tall"><canvas id="c4"></canvas></div></div>' +
      '<div class="card"><h3>Saldo por estado</h3><div class="chart-box tall"><canvas id="c5"></canvas></div></div></div>' +
      '<div class="grid g3"><div class="card"><h3>Consumo por departamento</h3><div class="chart-box tall"><canvas id="c6"></canvas></div></div>' +
      '<div class="card"><h3>Consumo por contratista</h3><div class="chart-box tall"><canvas id="c7"></canvas></div></div>' +
      '<div class="card"><h3>Top proyectos por consumo</h3><div class="chart-box tall"><canvas id="c8"></canvas></div></div></div>' +
      '<div class="grid g3"><div class="card"><h3>Saldos negativos</h3><div id="t1"></div></div><div class="card"><h3>Material en mal estado</h3><div id="t2"></div></div><div class="card"><h3>Rollos con saldo bajo</h3><div id="t3"></div></div></div>';
    bindFilters(v, dashFilters, route_);
    v.querySelectorAll('[data-kpi-action]').forEach(function (btn) {
      btn.onclick = function () {
        var def = detailDefs[btn.dataset.kpiAction], rows = d.detalles && d.detalles[def.rows] || [];
        modal('<h3>' + esc(def.title) + '</h3><div id="kpi-detail-table"></div><div class="actions"><button class="btn" data-close>Cerrar</button></div>', function (md) {
          table(md.querySelector('#kpi-detail-table'), { rows: rows, name: def.rows, limit: 500, cols: def.cols });
        }, 'modal-wide');
      };
    });
    var L = function (a) { return a.map(function (x) { return x.k; }); }, V = function (a, f) { return a.map(function (x) { return x[f || 'v']; }); };
    chart('c1', 'bar', L(d.stock_bodega), [{ label: 'Confirmado', data: V(d.stock_bodega), backgroundColor: C.a }, { label: 'Por revisar', data: V(d.stock_bodega, 'p'), backgroundColor: C.b }], { stack: 1 });
    chart('c2', 'bar', L(d.stock_hilos), [{ label: 'Confirmado', data: V(d.stock_hilos), backgroundColor: C.a }, { label: 'Por revisar', data: V(d.stock_hilos, 'p'), backgroundColor: C.b }], { stack: 1 });
    var tl = d.tendencia.slice(-18);
    chart('c3', 'line', tl.map(function (x) { return x.mes; }), [{ label: 'Despachos', data: tl.map(function (x) { return x.despachos; }), borderColor: C.c, backgroundColor: C.c, tension: .25 },
      { label: 'Devoluciones', data: tl.map(function (x) { return x.devoluciones; }), borderColor: C.b, backgroundColor: C.b, tension: .25 },
      { label: 'Consumo efectivo', data: tl.map(function (x) { return x.consumo; }), borderColor: C.a, backgroundColor: C.a, borderDash: [5, 4], tension: .25 }]);
    chart('c4', 'bar', L(d.stock_codigo), [{ label: 'Confirmado', data: V(d.stock_codigo), backgroundColor: C.a }, { label: 'Por revisar', data: V(d.stock_codigo, 'p'), backgroundColor: C.b }], { h: 1, stack: 1 });
    chart('c5', 'bar', L(d.stock_estado), [{ data: V(d.stock_estado), backgroundColor: d.stock_estado.map(function (x) { return x.v < 0 ? C.d : x.k === 'DISPONIBLE' ? C.a : x.k === 'MAL_ESTADO' ? C.d : x.k === 'RESERVADA' ? C.b : C.c; }) }], { h: 1 });
    chart('c6', 'bar', L(d.consumo_departamento), [{ data: V(d.consumo_departamento), backgroundColor: C.c }], { h: 1 });
    chart('c7', 'bar', L(d.consumo_contratista), [{ data: V(d.consumo_contratista), backgroundColor: C.c }], { h: 1 });
    chart('c8', 'bar', L(d.top_proyectos).map(function (s) { return s.length > 38 ? s.slice(0, 36) + '…' : s; }), [{ data: V(d.top_proyectos), backgroundColor: C.c }], { h: 1 });
    var small = [{ k: 'serie', l: 'Serie', f: function (x) { return '<a href="#vida/' + encodeURIComponent(x) + '">' + esc(x) + '</a>'; } }, { k: 'bodega', l: 'Bodega' }, { k: 'saldo', l: 'Saldo', n: 1 }];
    table(document.getElementById('t1'), { rows: d.negativos, cols: small, name: 'saldos_negativos', limit: 50 });
    table(document.getElementById('t2'), { rows: d.mal_estado, cols: small, name: 'mal_estado', limit: 50 });
    table(document.getElementById('t3'), { rows: d.saldo_bajo, cols: small, name: 'saldo_bajo', limit: 50 });
  };

  /* ============================ 2. inventario ============================ */
  var invFilters = { solo_con_saldo: '' };
  function serieCols() {
    return [
      { k: 'id_serie', l: 'Serie', f: function (x, r) { return '<a href="#vida/' + encodeURIComponent(x) + '">' + esc(x) + '</a>' + (r.serie_madre ? '<span class="sub">madre ' + esc(r.serie_madre) + '</span>' : ''); } },
      { k: 'codigo', l: 'Código', f: function (x, r) { return esc(x) + '<span class="sub">' + esc((r.descripcion || '').slice(0, 48)) + '</span>'; } },
      { k: 'hilos', l: 'Hilos', n: 1 }, { k: 'span', l: 'Span', n: 1 }, { k: 'bodega_actual', l: 'Bodega' },
      { k: 'estado_actual', l: 'Estado', f: function (x) { return pill(x); } }, { k: 'saldo_actual', l: 'Saldo (m)', n: 1 },
      { k: 'estado_saldo', l: 'Tipo de saldo', f: function (x) { return pill(x); } }, { k: 'alertas_abiertas', l: 'Alertas', n: 1 },
      { k: 'reservado_para', l: 'Reservado para' }, { k: 'fecha_ultimo_mov', l: 'Último mov.' }
    ];
  }
  SCREENS.inventario = async function (v) {
    var r = await api('inventory', { filtros: invFilters });
    v.innerHTML = filterBar(invFilters, false).replace('</form>', field('estado_saldo', 'Tipo de saldo', 'select', { options: ['COMPLETO', 'ESTIMADO', 'PENDIENTE_REVISION', 'NEGATIVO', 'SIN_INGRESO_REGISTRADO'], value: invFilters.estado_saldo, empty: 'Todos' }) +
      field('texto', 'Texto libre', 'text', { value: invFilters.texto }) + '<div class="f" style="min-width:auto;flex:0"><label>Solo con saldo</label><input type="checkbox" name="solo_con_saldo"' + (invFilters.solo_con_saldo ? ' checked' : '') + ' style="width:auto"></div></form>') +
      '<div class="card"><div class="note">El saldo se calcula por serie desde el historial de movimientos. <b>Tipo de saldo</b> indica si está confirmado (COMPLETO), inferido (ESTIMADO), pendiente de Revisión, negativo o sin ingreso registrado. Los negativos nunca se convierten en cero.</div><div id="tb"></div></div>';
    bindFilters(v, invFilters, route_);
    table(document.getElementById('tb'), { rows: r.filas, cols: serieCols(), name: 'inventario', onRow: function (s) { location.hash = '#vida/' + encodeURIComponent(s.id_serie); } });
  };

  /* ============================ 3. buscar ============================ */
  SCREENS.buscar = async function (v, q) {
    v.innerHTML = '<div class="card"><form id="sf" class="row"><input name="q" value="' + esc(q || '') + '" placeholder="Serie, código, descripción, hilos (48H), bodega, documento, proyecto o contratista" style="flex:1;min-width:240px"><button class="btn pri">Buscar</button></form><p class="hint">La búsqueda por documento, proyecto o contratista revisa todos los movimientos de cada serie.</p></div><div class="card"><div id="res"></div></div>';
    v.querySelector('#sf').onsubmit = function (e) { e.preventDefault(); location.hash = '#buscar/' + encodeURIComponent(formData(e.target).q); };
    if (!q) { document.getElementById('res').innerHTML = '<p class="hint">Ingrese un término de búsqueda.</p>'; return; }
    var r = await api('searchSeries', { q: q });
    if (r.length === 1) { location.hash = '#vida/' + encodeURIComponent(r[0].id_serie); return; }
    table(document.getElementById('res'), { rows: r, cols: serieCols(), name: 'busqueda', empty: 'No se encontraron series para "' + esc(q) + '"', onRow: function (s) { location.hash = '#vida/' + encodeURIComponent(s.id_serie); } });
  };

  /* ============================ 4. historial fibra ============================ */
  var TIPO_LBL = { INGRESO_INICIAL: 'Ingreso inicial', INGRESO_ADICIONAL: 'Ingreso adicional', INVENTARIO_INICIAL_DE_APERTURA: 'Inventario de apertura', DESPACHO: 'Despacho', DEVOLUCION: 'Devolución',
    PRESTAMO: 'Préstamo', DEVOLUCION_DE_PRESTAMO: 'Devolución de préstamo', TRASLADO_ENTRE_BODEGAS: 'Traslado', CORTE_O_FRACCIONAMIENTO: 'Corte / fraccionamiento', SOBRANTE_DE_OBRA: 'Sobrante de obra',
    BAJA_POR_MAL_ESTADO: 'Baja por mal estado', AJUSTE_MANUAL_AUTORIZADO: 'Ajuste autorizado', CAMBIO_DE_ESTADO: 'Cambio de estado / registro posterior' };
  /** En la app, CAMBIO_DE_ESTADO se presenta como "Reservar"; los importados de la matriz conservan su nombre original. */
  function tipoLbl(t) { return t.tipo === 'CAMBIO_DE_ESTADO' && t.origen === 'APP' ? 'Reservar' : TIPO_LBL[t.tipo] || t.tipo; }
  SCREENS.vida = async function (v, serie) {
    v.innerHTML = '<div class="card"><form id="sf" class="row"><input name="q" value="' + esc(serie || '') + '" placeholder="Serie del rollo (o busque por documento/proyecto en Buscar serie)" style="flex:1;min-width:220px"><button class="btn pri">Ver historial fibra</button></form></div><div id="life"></div>';
    v.querySelector('#sf').onsubmit = function (e) { e.preventDefault(); var q = formData(e.target).q; if (q) location.hash = '#vida/' + encodeURIComponent(q.toUpperCase().replace(/\s+/g, '')); };
    if (!serie) return;
    var L;
    try { L = await api('rollLife', { serie: serie }); } catch (e) { document.getElementById('life').innerHTML = '<div class="note err">' + esc(e.message) + ' <a href="#buscar/' + encodeURIComponent(serie) + '">Buscar coincidencias</a></div>'; return; }
    var s = L.serie, box = document.getElementById('life');
    var M = function (l, x, raw) { return '<div class="m"><div class="l">' + l + '</div><div class="v' + (+x < 0 ? ' neg' : '') + '">' + (raw ? x : m(x)) + '</div></div>'; };
    box.innerHTML = '<div class="card"><div class="row" style="justify-content:space-between"><div><h3 style="margin:0">' + esc(s.id_serie) + ' ' + pill(s.estado_actual) + ' ' + pill(s.estado_saldo) + '</h3><div class="hint">' + esc(s.codigo) + ' · ' + esc(s.descripcion) + ' · ' + esc(s.hilos) + 'H · span ' + esc(s.span) + (s.serie_madre ? ' · serie madre <a href="#vida/' + encodeURIComponent(s.serie_madre) + '">' + esc(s.serie_madre) + '</a>' : '') + '</div></div>' +
      '<div class="row">' + (can('registrar') ? '<a class="btn sm" href="#movimiento/' + encodeURIComponent(s.id_serie) + '">Registrar movimiento</a><a class="btn sm" href="#devolucion/' + encodeURIComponent(s.id_serie) + '">Devolución</a>' : '') + '<button class="btn sm" onclick="window.print()">PDF</button></div></div>' +
      '<div class="life-head" style="margin-top:14px">' + M('Metraje inicial conocido', s.metraje_inicial) + M('Total despachado', s.total_despachado) + M('Total devuelto', s.total_devuelto) +
      M('Consumo calculado', s.consumo_calculado) + M('Prestado', s.total_prestado - s.total_dev_prestamo) + M('Dado de baja', s.total_baja) + M('Saldo actual', s.saldo_actual) +
      M('Bodega actual', esc(s.bodega_actual || '—') + '<div class="hint" style="font-family:var(--sans);font-weight:400">' + esc(s.ubicacion_actual || '') + '</div>', 1) + M('Confiabilidad', esc(s.nivel_confiabilidad), 1) + '</div></div>' +
      '<div class="card"><h3>Registros originales en la matriz<small>valores originales y normalizados</small></h3><div id="orig"></div></div>' +
      '<div class="grid g2"><div class="card"><h3>Historial cronológico<small>saldo acumulado después de cada movimiento</small></h3><ul class="timeline">' +
      L.timeline.map(function (t) {
        var cls = !t.vigente ? 'void' : t.delta < 0 ? 'out' : t.delta === 0 ? 'zero' : '';
        return '<li class="' + cls + '"><div><span class="d">' + esc(t.fecha) + '</span><span class="t">' + esc(tipoLbl(t)) + '</span> ' +
          (t.delta ? '<span class="delta ' + (t.delta > 0 ? 'pos' : 'negv') + '">' + (t.delta > 0 ? '+' : '') + fmt(t.delta) + ' m</span>' : (+t.metraje ? '<span class="delta">' + m(t.metraje) + '</span>' : '')) +
          ' → saldo <b class="num' + (t.saldo_despues < 0 ? ' neg' : '') + '">' + m(t.saldo_despues) + '</b> ' + pill(t.estado_resultante) + (t.aprobacion === 'PENDIENTE' ? ' ' + pill('PENDIENTE') : '') + (t.estado_registro === 'ANULADO' ? ' ' + pill('ANULADO') : '') + '</div>' +
          '<div class="meta">' + [t.bodega_origen && t.bodega_destino ? t.bodega_origen + ' → ' + t.bodega_destino : (t.bodega_destino || t.bodega_origen), t.proyecto_ruta, t.departamento, t.contratista, t.responsable && 'Resp. ' + t.responsable,
            t.documento && 'Doc. ' + t.documento, t.documento_ref && 'Ref. ' + t.documento_ref, t.certificado_por && 'Certificado por ' + t.certificado_por].filter(Boolean).map(esc).join(' · ') + '</div>' +
          '<div class="meta hint">' + esc(t.id_movimiento) + ' · ' + esc(t.origen) + (t.fila_origen ? ' fila ' + esc(t.fila_origen) : '') + ' · regla ' + esc(t.regla_aplicada) + ' · confianza ' + esc(t.confianza) + ' · ' + esc(t.usuario) + (t.observacion_original ? '<br>Obs: ' + esc(t.observacion_original) : '') + '</div></li>';
      }).join('') + '</ul></div>' +
      '<div><div class="card"><h3>Consumo por despacho<small>despachado − devoluciones vinculadas</small></h3><div id="cons"></div></div>' +
      '<div class="card"><h3>Alertas de Revisión</h3><div id="al"></div></div>' +
      '<div class="card"><h3>Rutas y proyectos</h3><div class="chips">' + (L.rutas.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('') || '<span class="hint">—</span>') + '</div>' +
      '<h3 style="margin-top:14px">Documentos asociados</h3><div class="chips">' + (L.documentos.map(function (x) { return '<a class="chip" href="#buscar/' + encodeURIComponent(x) + '">' + esc(x) + '</a>'; }).join('') || '<span class="hint">—</span>') + '</div>' +
      '<h3 style="margin-top:14px">Observaciones</h3>' + (L.observaciones.map(function (x) { return '<div class="hint" style="margin-bottom:4px">• ' + esc(x) + '</div>'; }).join('') || '<span class="hint">—</span>') + '</div>' +
      '<div class="card"><h3>Familia del rollo<small>series relacionadas (no se fusionan automáticamente)</small></h3><div id="fam"></div></div>' +
      (L.prestamos.length || L.sobrantes.length ? '<div class="card"><h3>Préstamos y sobrantes</h3><div id="ps"></div></div>' : '') + '</div></div>';
    table(document.getElementById('cons'), { rows: L.consumo_por_despacho, cols: [{ k: 'fecha', l: 'Fecha' }, { k: 'documento', l: 'Doc.' }, { k: 'despachado', l: 'Despachado', n: 1 }, { k: 'devuelto', l: 'Devuelto', n: 1 }, { k: 'consumo', l: 'Consumo', n: 1 }, { k: 'ruta', l: 'Ruta' }], name: 'consumo_' + s.id_serie });
    table(document.getElementById('al'), { rows: L.alertas, cols: [{ k: 'severidad', l: 'Sev.', f: function (x) { return pill(x, 1); } }, { k: 'tipo', l: 'Tipo', f: function (x, r) { return esc(x.replace(/_/g, ' ')) + '<span class="sub">' + esc(r.valor_encontrado) + ' · esperado: ' + esc(r.valor_esperado) + '</span>'; } }, { k: 'estado', l: 'Estado', f: function (x) { return pill(x); } }], name: 'alertas_' + s.id_serie, onRow: alertModal });
    var famEl = document.getElementById('fam');
    famEl.innerHTML = (L.familia.length ? L.familia.map(function (f) { return '<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line-2);padding:4px 0"><a href="#vida/' + encodeURIComponent(f.serie) + '">' + esc(f.serie) + '</a><span class="num">' + m(f.saldo) + '</span>' + pill(f.estado) + '</div>'; }).join('') : '<p class="hint">Sin series relacionadas detectadas.</p>') +
      L.relaciones.map(function (r) { return '<div class="hint" style="margin-top:6px">Relación ' + esc(r.serie) + ' → madre ' + esc(r.serie_madre) + ': ' + pill(r.estado) + ' (' + esc(r.tipo_relacion) + ')</div>'; }).join('') +
      (can('relaciones') ? '<div class="row" style="margin-top:10px"><input id="madre" placeholder="Serie madre" value="' + esc((L.relaciones.filter(function (r) { return r.serie === s.id_serie; })[0] || {}).serie_madre || '') + '" style="max-width:200px"><button class="btn sm" id="lk">Confirmar relación</button><button class="btn sm" id="rj">Rechazar sugerencia</button></div>' : '');
    if (can('relaciones')) {
      var link = function (dec) { api('linkFamily', { serie: s.id_serie, serie_madre: document.getElementById('madre').value, decision: dec }).then(function () { toast('Relación actualizada.', 'ok'); route_(); }).catch(function (e) { toast(e.message, 'err'); }); };
      document.getElementById('lk').onclick = function () { link('CONFIRMAR'); }; document.getElementById('rj').onclick = function () { link('RECHAZAR'); };
    }
    if (document.getElementById('ps')) document.getElementById('ps').innerHTML = L.prestamos.map(function (p) { return '<div>Préstamo ' + esc(p.id_prestamo) + ': ' + m(p.metraje_prestado) + ' a ' + esc(p.responsable || 'sin responsable') + ' ' + pill(p.estado) + '</div>'; }).join('') + L.sobrantes.map(function (p) { return '<div>Sobrante ' + esc(p.id_sobrante) + ': ' + (p.metraje_sobrante === '' ? 'sin cuantificar' : m(p.metraje_sobrante)) + ' ' + pill(p.estado) + '</div>'; }).join('');
    table(document.getElementById('orig'), { rows: L.origen_matriz, name: 'origen_' + s.id_serie, cols: [{ k: 'fila', l: 'Fila', n: 1 }, { k: 'fecha_original', l: 'Fecha orig.', f: function (x, r) { return esc(x) + '<span class="sub">' + esc(r.fecha) + ' · ' + esc(r.regla_fecha) + '</span>'; } },
      { k: 'bodega', l: 'Bodega' }, { k: 'estado_original', l: 'Estado orig.' }, { k: 'mts_ingreso_original', l: 'Ingreso orig.', f: function (x, r) { return esc(x) + (String(x) !== String(r.mts_ingreso) && x !== '' ? '<span class="sub">→ ' + fmt(r.mts_ingreso) + '</span>' : ''); } },
      { k: 'mts_salida_original', l: 'Salida orig.', f: function (x, r) { return esc(x) + (String(x) !== String(r.mts_salida) && x !== '' ? '<span class="sub">→ ' + fmt(r.mts_salida) + ' (' + esc(r.confianza_metraje) + ')</span>' : ''); } },
      { k: 'departamento_original', l: 'Depto. orig.', f: function (x, r) { return esc(x) + (r.departamento !== x ? '<span class="sub">→ ' + esc(r.departamento || '(vacío)') + ' · ' + esc(r.clase_departamento) + '</span>' : ''); } },
      { k: 'contratista_original', l: 'Contratista orig.', f: function (x, r) { return esc(x) + (r.contratista !== x ? '<span class="sub">→ ' + esc(r.contratista || '(vacío)') + ' · ' + esc(r.clase_contratista) + '</span>' : ''); } },
      { k: 'documento', l: 'Doc.' }, { k: 'clasificacion_repeticion', l: 'Clasificación', f: function (x, r) { return esc(x) + (r.riesgo_duplicado !== '' ? '<span class="sub">riesgo duplicado ' + esc(r.riesgo_duplicado) + '%</span>' : ''); } }, { k: 'observacion', l: 'Observación' }] });
  };

  /* ============================ 5. registrar movimiento ============================ */
  function seriePicker(container, onPick, initial) {
    container.innerHTML = '<div class="f wide"><label>Serie <span class="req">*</span></label><div class="row"><input id="sp-in" name="serie" value="' + esc(initial || '') + '" placeholder="Serie del rollo" style="flex:1"><button type="button" class="btn sm" id="sp-go">Consultar</button></div><span class="hint" id="sp-info"></span></div>';
    var inp = container.querySelector('#sp-in'), info = container.querySelector('#sp-info');
    var go = function () {
      var q = inp.value.trim(); if (!q) return;
      api('inventory', { filtros: { texto: q } }).then(function (r) {
        var s = r.filas.filter(function (x) { return x.id_serie === q.toUpperCase().replace(/\s+/g, ''); })[0];
        if (!s) { info.innerHTML = 'Serie no registrada.' + (r.filas.length ? ' Coincidencias: ' + r.filas.slice(0, 5).map(function (x) { return '<a href="#" data-s="' + esc(x.id_serie) + '">' + esc(x.id_serie) + '</a>'; }).join(', ') : ''); info.querySelectorAll('a[data-s]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); inp.value = a.dataset.s; go(); }; }); onPick(null); return; }
        info.innerHTML = 'Saldo <b class="num' + (s.saldo_actual < 0 ? ' neg' : '') + '">' + m(s.saldo_actual) + '</b> · ' + esc(s.bodega_actual) + ' · ' + pill(s.estado_actual) + ' ' + (s.reservado_departamento ? '<span class="pill">' + esc(s.reservado_departamento) + '</span> ' : '') + pill(s.estado_saldo) + ' · ' + esc(s.codigo) + ' ' + esc(s.hilos) + 'H';
        onPick(s);
      }).catch(function (e) { info.textContent = e.message; });
    };
    container.querySelector('#sp-go').onclick = go; inp.onchange = go; if (initial) go();
  }
  SCREENS.movimiento = async function (v, serie) {
    // Ingreso inicial, Ingreso adicional y Corte se retiraron del formulario; sus ramas en draw() se conservan para reactivarlos agregándolos aquí.
    var c = BOOT.catalogos, tipos = ['DESPACHO', 'DEVOLUCION', 'INVENTARIO_INICIAL_DE_APERTURA', 'CAMBIO_DE_ESTADO', 'BAJA_POR_MAL_ESTADO', 'AJUSTE_MANUAL_AUTORIZADO'];
    var prefijos = { DESPACHO: 'DS', DEVOLUCION: 'DV', PRESTAMO: 'PR', DEVOLUCION_DE_PRESTAMO: 'DV', INGRESO_INICIAL: 'IN', INGRESO_ADICIONAL: 'IN', INVENTARIO_INICIAL_DE_APERTURA: 'IN', BAJA_POR_MAL_ESTADO: 'BA', AJUSTE_MANUAL_AUTORIZADO: 'AJ', CAMBIO_DE_ESTADO: 'RE', CORTE_O_FRACCIONAMIENTO: 'CO', SOBRANTE_DE_OBRA: 'SO', TRASLADO_ENTRE_BODEGAS: 'TR' };
    var docGen = field('documento_generado', 'Documento generado', 'text', { value: (prefijos['DESPACHO'] || 'MO') + '-' + '001', readonly: 1, disabled: 1, hint: 'Generado automáticamente por el sistema.' });
    v.innerHTML = '<div class="card"><h3>Registrar movimiento</h3><div class="note">Devoluciones, préstamos y traslados se registran como tipo de movimiento. Las devoluciones requieren seleccionar el despacho original. Bajas y ajustes quedan <b>pendientes de aprobación</b> del supervisor.</div>' +
      '<form id="mf"><div class="form-grid">' + docGen + field('tipo', 'Tipo de movimiento', 'select', { options: tipos.map(function (t) { return { v: t, l: tipoLbl({ tipo: t, origen: 'APP' }) }; }), value: 'DESPACHO', empty: undefined, req: 1 }) + '<div id="sp" class="full"></div><div id="dyn" class="full form-grid"></div></div>' +
      '<div class="actions"><button class="btn pri" type="submit">Registrar</button></div></form>' + datalists() + '</div>';
    var sel = v.querySelector('select[name=tipo]'), dyn = v.querySelector('#dyn'), cur = null;
    seriePicker(v.querySelector('#sp'), function (s) { cur = s; draw(); }, serie);
    function draw() {
      var t = sel.value, b = cur ? cur.bodega_actual : '';
      var bod = field('bodega', t.indexOf('INGRESO') === 0 || t === 'INVENTARIO_INICIAL_DE_APERTURA' ? 'Bodega destino' : 'Bodega origen', 'select', { options: c.bodegas, value: b, req: 1 });
      var common = field('fecha', 'Fecha', 'date', { value: todayISO(), max: todayISO(), req: 1 });
      var obs = field('observacion', 'Observaciones', 'textarea', { full: 1, req: ['INGRESO_ADICIONAL', 'BAJA_POR_MAL_ESTADO', 'AJUSTE_MANUAL_AUTORIZADO'].indexOf(t) >= 0 });
      var met = field('metraje', 'Metraje (m)', 'number', { req: 1, hint: 'Solo números, sin separador de miles.' });
      var prefijos = { DESPACHO: 'DS', DEVOLUCION: 'DV', PRESTAMO: 'PR', DEVOLUCION_DE_PRESTAMO: 'DV', INGRESO_INICIAL: 'IN', INGRESO_ADICIONAL: 'IN', INVENTARIO_INICIAL_DE_APERTURA: 'IN', BAJA_POR_MAL_ESTADO: 'BA', AJUSTE_MANUAL_AUTORIZADO: 'AJ', CAMBIO_DE_ESTADO: 'RE', CORTE_O_FRACCIONAMIENTO: 'CO', SOBRANTE_DE_OBRA: 'SO', TRASLADO_ENTRE_BODEGAS: 'TR' };
      var docGenField = v.querySelector('[name=documento_generado]');
      if (docGenField) docGenField.value = (prefijos[t] || 'MO') + '-' + '001';
      var h = '';
      if (t === 'DESPACHO') h = met + bod + common + field('documento', 'N° documento de despacho (opcional)', 'text', { hint: 'Si se deja vacío, se genera automáticamente.' }) + field('departamento', 'Departamento', 'text', { list: 'dl-dep', req: 1 }) + field('contratista', 'Contratista', 'text', { list: 'dl-con' }) + field('proyecto', 'Ruta / proyecto', 'text', { req: 1, wide: 1 }) + field('responsable', 'Responsable que retira', 'text') + field('justificacion', 'Justificación (solo si repite documento y metraje)', 'text', { wide: 1 }) + obs;
      else if (t === 'INGRESO_INICIAL' || t === 'INVENTARIO_INICIAL_DE_APERTURA') h = codigoFields(true) + met + bod + field('ubicacion', 'Ubicación', 'select', { options: c.ubicaciones, empty: '—' }) + field('estado', 'Estado inicial', 'select', { options: ['DISPONIBLE', 'RESERVADA', 'MAL_ESTADO'], value: 'DISPONIBLE', empty: undefined }) + common + field('documento', 'Documento de ingreso (opcional)', 'text', { hint: 'Si se deja vacío, se genera automáticamente.' }) +
        (t === 'INVENTARIO_INICIAL_DE_APERTURA' ? field('certificado_por', 'Certificado por', 'text') : '') + obs;
      else if (t === 'INGRESO_ADICIONAL') h = met + bod + common + field('documento', 'Documento (opcional)', 'text', { hint: 'Si se deja vacío, se genera automáticamente.' }) + obs;
      else if (t === 'CAMBIO_DE_ESTADO') h = field('estado', 'Nuevo estado', 'select', { options: ['RESERVADA', 'DISPONIBLE', 'MAL_ESTADO', 'EN_REVISION'], value: 'RESERVADA', empty: undefined, req: 1, hint: 'DISPONIBLE libera la reserva.' }) +
        field('proyecto', 'Proyecto / ruta', 'text', { wide: 1, hint: 'Obligatorio al reservar.' }) + field('departamento', 'Departamento', 'text', { list: 'dl-dep' }) + field('contratista', 'Contratista', 'text', { list: 'dl-con' }) +
        field('responsable', 'Solicitado por', 'text') + field('documento', 'N° de solicitud / documento', 'text') + common + obs;
      else if (t === 'CORTE_O_FRACCIONAMIENTO') h = met + field('serie_derivada', 'Serie derivada', 'text', { hint: 'Vacío = se genera SERIE-1-001, -002…' }) + common + obs;
      else if (t === 'DEVOLUCION') h = met + bod + common + field('id_despacho', 'Despacho original', 'select', { options: [], req: 1, hint: 'Seleccione el despacho relacionado con esta devolución.' }) + field('certificado_por', 'Certificado por', 'text') +
        field('metraje', 'Metraje devuelto (m)', 'number', { req: 1 }) + field('fecha', 'Fecha de devolución', 'date', { value: todayISO(), max: todayISO(), req: 1 }) +
        field('bodega', 'Bodega receptora', 'select', { options: c.bodegas, req: 1 }) + field('estado_material', 'Estado del material', 'select', { options: ['DISPONIBLE', 'MAL_ESTADO'], value: 'DISPONIBLE', empty: undefined }) +
        field('motivo', 'Motivo de devolución', 'text', { req: 1, wide: 1 }) + field('documento', 'Documento de devolución', 'text') + field('observacion', 'Observaciones', 'textarea', { full: 1 }) +
        '<div class="full note" id="calc" hidden></div>';
      else if (t === 'BAJA_POR_MAL_ESTADO') h = met + bod + common + field('documento', 'Acta / informe (opcional)', 'text', { hint: 'Si se deja vacío, se genera automáticamente.' }) + obs;
      else if (t === 'AJUSTE_MANUAL_AUTORIZADO') h = field('metraje', 'Ajuste (m)', 'number', { req: 1, hint: 'Positivo suma, negativo resta. Requiere aprobación.' }) + common + field('documento', 'Documento de respaldo (opcional)', 'text', { req: 1, hint: 'Si se deja vacío, se genera automáticamente.' }) + obs;
      var nueva = t === 'INGRESO_INICIAL' || t === 'INVENTARIO_INICIAL_DE_APERTURA';
      if (!nueva) h = codigoFields(false, cur && cur.codigo) + h;
      else h = h;
      dyn.innerHTML = h;
      bindCodigoFields(dyn, nueva);
      var j = dyn.querySelector('[name=justificacion]'); if (j) j.closest('.f').hidden = true; // solo se muestra si el servidor la pide (documento y metraje repetidos)
    }
    sel.onchange = draw; draw();
    v.querySelector('#mf').onsubmit = function (e) {
      e.preventDefault(); var d = formData(e.target), btn = e.target.querySelector('[type=submit]'); busy(btn, true);
      var action = d.tipo === 'CORTE_O_FRACCIONAMIENTO' ? 'cut' : d.tipo === 'DEVOLUCION' ? 'registerReturn' : 'registerMovement';
      api(action, d).then(function (r) { var docMsg = r.documento ? ' · Doc: ' + r.documento : ''; toast('Registrado ' + r.movimientos.join(', ') + docMsg + '. Saldo de ' + r.serie.id_serie + ': ' + fmt(r.serie.saldo_actual) + ' m', 'ok'); location.hash = '#vida/' + encodeURIComponent(d.tipo === 'CORTE_O_FRACCIONAMIENTO' ? d.serie.toUpperCase() : r.serie.id_serie); })
        .catch(function (x) {
          busy(btn, false); toast(x.message, 'err');
          var j = dyn.querySelector('[name=justificacion]'); if (j && /justificaci/i.test(x.message)) { j.closest('.f').hidden = false; j.focus(); }
        });
    };
  };

  /* ============================ 6. devolución ============================ */
  SCREENS.devolucion = async function (v, serie) {
    var c = BOOT.catalogos;
    v.innerHTML = '<div class="card"><h3>Registrar devolución</h3><div class="note">Seleccione el despacho original. La diferencia entre lo despachado y lo devuelto se considera <b>consumo efectivo</b> del proyecto. Una devolución mayor a lo despachado se rechaza y genera alerta crítica.</div>' +
      '<form id="df"><div class="form-grid"><div id="sp" class="full"></div><div class="f full"><label>Despacho original <span class="req">*</span></label><select name="id_despacho" id="desp"><option value="">— consulte la serie —</option></select><span class="hint" id="dinfo"></span></div>' +
      codigoFields(false) + field('certificado_por', 'Certificado por', 'text') +
      field('metraje', 'Metraje devuelto (m)', 'number', { req: 1 }) + field('fecha', 'Fecha de devolución', 'date', { value: todayISO(), max: todayISO(), req: 1 }) +
      field('bodega', 'Bodega receptora', 'select', { options: c.bodegas, req: 1 }) + field('estado_material', 'Estado del material', 'select', { options: ['DISPONIBLE', 'MAL_ESTADO'], value: 'DISPONIBLE', empty: undefined }) +
      field('motivo', 'Motivo de devolución', 'text', { req: 1, wide: 1 }) + field('documento', 'Documento de devolución', 'text') + field('observacion', 'Observaciones', 'textarea', { full: 1 }) +
      '<div class="full note" id="calc" hidden></div></div><div class="actions"><button class="btn pri" type="submit">Registrar devolución</button></div></form></div>';
    var desp = v.querySelector('#desp'), list = [], calc = v.querySelector('#calc'), met = v.querySelector('input[name=metraje]');
    bindCodigoFields(v, false);
    seriePicker(v.querySelector('#sp'), function (s) {
      setCodigo(v, s);
      if (!s) { desp.innerHTML = '<option value="">— serie no válida —</option>'; return; }
      v.querySelector('select[name=bodega]').value = s.bodega_actual || '';
      api('dispatchesOf', { serie: s.id_serie }).then(function (r) {
        list = r; desp.innerHTML = r.map(function (x) { return '<option value="' + x.id_movimiento + '">' + esc(x.fecha + ' · doc ' + (x.documento || 's/d') + ' · despachado ' + fmt(x.despachado) + ' m · pendiente ' + fmt(x.consumo) + ' m · ' + x.ruta) + '</option>'; }).join('') + '<option value="SIN_REFERENCIA">Sin despacho relacionado (irá a Revisión)</option>';
        upd();
      });
    }, serie);
    function upd() {
      var d = list.filter(function (x) { return x.id_movimiento === desp.value; })[0], q = +met.value;
      if (desp.value === 'SIN_REFERENCIA') { calc.hidden = false; calc.className = 'full note warn'; calc.textContent = 'Devolución sin referencia: se registrará y se abrirá una alerta de Revisión.'; return; }
      if (!d || !q) { calc.hidden = true; return; }
      calc.hidden = false;
      if (q > d.consumo) { calc.className = 'full note err'; calc.textContent = 'La devolución (' + fmt(q) + ' m) supera lo pendiente del despacho (' + fmt(d.consumo) + ' m). Se rechazará.'; }
      else { calc.className = 'full note'; calc.innerHTML = 'Despachado ' + m(d.despachado) + ' · devuelto antes ' + m(d.devuelto) + ' · ahora ' + m(q) + ' → <b>consumo efectivo preliminar ' + m(d.despachado - d.devuelto - q) + '</b>' + (q === d.consumo ? ' (devolución completa)' : ''); }
    }
    desp.onchange = upd; met.oninput = upd;
    v.querySelector('#df').onsubmit = function (e) {
      e.preventDefault(); var d = formData(e.target), btn = e.target.querySelector('[type=submit]'); busy(btn, true);
      api('registerReturn', d).then(function (r) { toast('Devolución registrada.' + (r.resumen.consumo_preliminar !== undefined ? ' Consumo preliminar: ' + fmt(r.resumen.consumo_preliminar) + ' m' : ''), 'ok'); location.hash = '#vida/' + encodeURIComponent(r.serie.id_serie); })
        .catch(function (x) { busy(btn, false); toast(x.message, 'err'); });
    };
  };

  /* ============================ 7. préstamos ============================ */
  SCREENS.prestamos = async function (v) {
    var c = BOOT.catalogos, loans = await api('loans');
    v.innerHTML = (can('registrar') ? '<div class="card"><h3>Registrar préstamo</h3><form id="pf"><div class="form-grid"><div id="sp" class="full"></div>' +
      field('documento_generado', 'Documento generado', 'text', { value: 'PR-001', readonly: 1, hint: 'Generado automáticamente por el sistema.' }) +
      codigoFields(false) + field('metraje', 'Metraje prestado (m)', 'number', { req: 1 }) +
      field('responsable', 'Persona responsable', 'text', { req: 1 }) + field('fecha', 'Fecha de préstamo', 'date', { value: todayISO(), max: todayISO(), req: 1 }) +
      field('fecha_limite', 'Fecha límite de devolución', 'date', { req: 1, value: addDays(todayISO(), +(BOOT.params.DIAS_PRESTAMO_DEFECTO || 15)) }) + field('bodega', 'Bodega', 'select', { options: c.bodegas, req: 1 }) +
      field('contratista', 'Contratista', 'text', { list: 'dl-con' }) + field('departamento', 'Departamento', 'text', { list: 'dl-dep' }) + field('proyecto', 'Proyecto', 'text', { wide: 1 }) +
      field('documento', 'Documento de respaldo', 'text') + field('observacion', 'Observaciones', 'textarea', { full: 1 }) + '</div><div class="actions"><button class="btn pri" type="submit">Registrar préstamo</button></div></form>' + datalists() + '</div>' : '') +
      '<div class="card"><h3>Préstamos</h3><div class="note warn">Los préstamos importados de la matriz no tienen fecha límite: quedan <b>PENDIENTE DE Revisión</b> hasta que se complete el dato. Las observaciones de texto libre ("prestada a…", "hay que devolver") se convirtieron en tareas en Alertas, no en devoluciones.</div><div id="lt"></div></div>';
    if (can('registrar')) {
      var pf = v.querySelector('#pf'); bindCodigoFields(pf, false);
      seriePicker(v.querySelector('#sp'), function (s) { setCodigo(pf, s); if (s) pf.querySelector('select[name=bodega]').value = s.bodega_actual; });
      v.querySelector('#pf').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target), b = e.target.querySelector('[type=submit]'); busy(b, true); api('registerLoan', d).then(function (r) { toast('Préstamo ' + r.prestamo + ' registrado.', 'ok'); route_(); }).catch(function (x) { busy(b, false); toast(x.message, 'err'); }); };
    }
    table(document.getElementById('lt'), { rows: loans, name: 'prestamos', cols: [{ k: 'id_prestamo', l: 'ID' }, { k: 'serie', l: 'Serie', f: function (x, r) { return '<a href="#vida/' + encodeURIComponent(r.id_serie) + '">' + esc(x) + '</a>'; } },
      { k: 'metraje_prestado', l: 'Prestado', n: 1 }, { k: 'metraje_devuelto', l: 'Devuelto', n: 1 }, { k: 'diferencia', l: 'Dif.', n: 1 }, { k: 'responsable', l: 'Responsable' }, { k: 'proyecto', l: 'Proyecto' },
      { k: 'fecha_prestamo', l: 'Fecha' }, { k: 'fecha_limite', l: 'Límite' }, { k: 'estado', l: 'Estado', f: function (x) { return pill(x); } },
      { k: 'id_mov_prestamo', l: '', f: function (x, r) { var open = ['ACTIVO', 'VENCIDO', 'PENDIENTE_DE_REVISION', 'DEVUELTO_PARCIAL'].indexOf(r.estado) >= 0; return (open && can('registrar') ? '<button class="btn sm" data-dev="' + esc(r.id_prestamo) + '">Devolver</button> ' : '') + (can('aprobar') && open ? '<button class="btn sm" data-st="' + esc(r.id_prestamo) + '">Estado</button>' : ''); } }],
      after: function (el) {
        el.querySelectorAll('[data-dev]').forEach(function (b) { b.onclick = function () { var p = loans.filter(function (x) { return x.id_prestamo === b.dataset.dev; })[0]; modal('<h3>Devolver préstamo ' + esc(p.id_prestamo) + '</h3><p class="hint">Prestado ' + m(p.metraje_prestado) + ' a ' + esc(p.responsable) + (p.metraje_devuelto ? ' · ya devuelto ' + m(p.metraje_devuelto) : '') + '</p><div class="form-grid">' + codigoFields(false, p.codigo) + field('metraje', 'Metraje devuelto (m)', 'number', { req: 1 }) + field('fecha', 'Fecha', 'date', { value: todayISO(), max: todayISO() }) + field('bodega', 'Bodega receptora', 'select', { options: BOOT.catalogos.bodegas }) + field('estado_material', 'Estado del material', 'select', { options: ['DISPONIBLE', 'MAL_ESTADO'], value: 'DISPONIBLE', empty: undefined }) + field('observacion', 'Observaciones', 'textarea', { full: 1 }) + '</div><div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Registrar</button></div>', function (md, close) { bindCodigoFields(md, false); md.querySelector('#ok').onclick = function () { var d = formData(md); d.id_prestamo = p.id_prestamo; api('returnLoan', d).then(function () { toast('Devolución de préstamo registrada.', 'ok'); close(); route_(); }).catch(function (x) { toast(x.message, 'err'); }); }; }); }; });
        el.querySelectorAll('[data-st]').forEach(function (b) { b.onclick = function () { modal('<h3>Estado manual del préstamo</h3><div class="form-grid">' + field('estado', 'Estado', 'select', { options: ['PERDIDO', 'CONSUMIDO_EN_OBRA'], req: 1 }) + field('comentario', 'Comentario', 'textarea', { full: 1, req: 1 }) + '</div><div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Guardar</button></div>', function (md, close) { md.querySelector('#ok').onclick = function () { var d = formData(md); d.id_prestamo = b.dataset.st; api('setLoanState', d).then(function () { toast('Estado actualizado.', 'ok'); close(); route_(); }).catch(function (x) { toast(x.message, 'err'); }); }; }); }; });
      } });
  };
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  /* ============================ 8. sobrantes ============================ */
  SCREENS.sobrantes = async function (v) {
    var c = BOOT.catalogos, rows = await api('surpluses');
    v.innerHTML = (can('registrar') ? '<div class="card"><h3>Declarar sobrante de obra</h3><div class="note">El sobrante declarado <b>no entra al stock</b> hasta confirmar su recepción física y condición.</div><form id="sf"><div class="form-grid"><div id="sp" class="full"></div><div class="f full"><label>Despacho de origen <span class="req">*</span></label><select name="id_despacho" id="desp"></select></div>' + codigoFields(false) +
      field('metraje_sobrante', 'Metraje sobrante (m)', 'number', { req: 1 }) + field('metraje_utilizado', 'Metraje utilizado (m)', 'number', { hint: 'Vacío = despachado − sobrante' }) + field('bodega', 'Bodega receptora', 'select', { options: c.bodegas }) +
      field('nuevo_proyecto', 'Nuevo proyecto asignado', 'text', { wide: 1 }) + field('observacion', 'Observaciones', 'textarea', { full: 1 }) + '</div><div class="actions"><button class="btn pri" type="submit">Declarar</button></div></form></div>' : '') +
      '<div class="card"><h3>Sobrantes</h3><div id="st"></div></div>';
    if (can('registrar')) {
      var desp = v.querySelector('#desp'), sf = v.querySelector('#sf'); bindCodigoFields(sf, false);
      seriePicker(v.querySelector('#sp'), function (s) { setCodigo(sf, s); if (!s) return; api('dispatchesOf', { serie: s.id_serie }).then(function (r) { desp.innerHTML = r.map(function (x) { return '<option value="' + x.id_movimiento + '">' + esc(x.fecha + ' · doc ' + (x.documento || 's/d') + ' · ' + fmt(x.despachado) + ' m · ' + x.ruta) + '</option>'; }).join('') || '<option value="">Sin despachos pendientes</option>'; }); });
      v.querySelector('#sf').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target), b = e.target.querySelector('[type=submit]'); busy(b, true); api('registerSurplus', d).then(function (r) { toast('Sobrante declarado. Consumo preliminar ' + fmt(r.consumo_preliminar) + ' m.', 'ok'); route_(); }).catch(function (x) { busy(b, false); toast(x.message, 'err'); }); };
    }
    table(document.getElementById('st'), { rows: rows, name: 'sobrantes', cols: [{ k: 'id_sobrante', l: 'ID' }, { k: 'serie', l: 'Serie', f: function (x, r) { return '<a href="#vida/' + encodeURIComponent(r.id_serie) + '">' + esc(x) + '</a>'; } }, { k: 'proyecto_original', l: 'Proyecto original' },
      { k: 'metraje_despachado', l: 'Despachado', n: 1 }, { k: 'metraje_sobrante', l: 'Sobrante', n: 1 }, { k: 'metraje_devuelto', l: 'Recibido', n: 1 }, { k: 'condicion', l: 'Condición' }, { k: 'estado', l: 'Estado', f: function (x) { return pill(x); } },
      { k: 'observaciones', l: 'Obs.' }, { k: 'id_movimiento', l: '', f: function (x, r) { return can('registrar') && r.estado !== 'RECIBIDO' && r.estado !== 'RECHAZADO' && r.id_movimiento ? '<button class="btn sm" data-c="' + esc(r.id_sobrante) + '">Confirmar recepción</button>' : ''; } }],
      after: function (el) { el.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { var r = rows.filter(function (x) { return x.id_sobrante === b.dataset.c; })[0];
        modal('<h3>Recepción física de sobrante ' + esc(r.id_sobrante) + '</h3><div class="form-grid">' + field('metraje_devuelto', 'Metraje recibido (m)', 'number', { req: 1, value: r.metraje_sobrante }) + field('condicion', 'Condición', 'select', { options: ['BUENA', 'DAÑADA', 'REQUIERE_INSPECCION'], req: 1 }) + field('bodega', 'Bodega receptora', 'select', { options: BOOT.catalogos.bodegas, value: r.bodega_receptora }) + field('fecha', 'Fecha', 'date', { value: todayISO(), max: todayISO() }) + field('documento', 'Documento', 'text') + field('observacion', 'Observaciones', 'textarea', { full: 1 }) + '</div><div class="actions"><button class="btn danger" id="rej">Rechazar</button><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Confirmar</button></div>', function (md, close) {
          md.querySelector('#ok').onclick = function () { var d = formData(md); d.id_sobrante = r.id_sobrante; api('confirmSurplus', d).then(function () { toast('Sobrante recibido e ingresado al stock.', 'ok'); close(); route_(); }).catch(function (x) { toast(x.message, 'err'); }); };
          md.querySelector('#rej').onclick = function () { var d = formData(md); d.id_sobrante = r.id_sobrante; d.rechazar = true; api('confirmSurplus', d).then(function () { toast('Sobrante rechazado.', 'ok'); close(); route_(); }).catch(function (x) { toast(x.message, 'err'); }); };
        }); }; }); } });
  };

  /* ============================ 9. traslado ============================ */
  SCREENS.traslado = async function (v, serie) {
    var c = BOOT.catalogos;
    v.innerHTML = '<div class="card"><h3>Trasladar entre bodegas</h3><div class="note">Se traslada el saldo completo de la serie. El saldo de la serie no cambia; cambia su bodega actual.</div><form id="tf"><div class="form-grid"><div id="sp" class="full"></div>' +
      field('documento_generado', 'Documento generado', 'text', { value: 'TR-001', readonly: 1, hint: 'Generado automáticamente por el sistema.' }) +
      codigoFields(false) +
      field('bodega_destino', 'Bodega destino', 'select', { options: c.bodegas, req: 1 }) + field('ubicacion', 'Ubicación destino', 'select', { options: c.ubicaciones, empty: '—' }) + field('fecha', 'Fecha', 'date', { value: todayISO(), max: todayISO(), req: 1 }) +
      field('documento', 'Documento de traslado', 'text', { req: 1 }) + field('responsable', 'Responsable del transporte', 'text') + field('observacion', 'Observaciones', 'textarea', { full: 1 }) + '</div><div class="actions"><button class="btn pri" type="submit">Trasladar</button></div></form></div>';
    var tf = v.querySelector('#tf'); bindCodigoFields(tf, false);
    seriePicker(v.querySelector('#sp'), function (s) { setCodigo(tf, s); }, serie);
    v.querySelector('#tf').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target), b = e.target.querySelector('[type=submit]'); busy(b, true); api('transfer', d).then(function (r) { toast('Traslado registrado. Ahora en ' + r.serie.bodega_actual, 'ok'); location.hash = '#vida/' + encodeURIComponent(r.serie.id_serie); }).catch(function (x) { busy(b, false); toast(x.message, 'err'); }); };
  };

  /* ============================ 10. alertas ============================ */
  var alFilters = { estado: 'ABIERTAS' };
  function alertModal(a) {
    var canClose = can('alertas_cerrar') && (a.categoria !== 'CRITICA' || can('aprobar'));
    var estados = ['ABIERTA', 'EN_REVISION'].concat(canClose ? ['RESUELTA', 'DESCARTADA'] : []);
    modal('<h3>' + pill(a.severidad, 1) + ' ' + esc(a.tipo.replace(/_/g, ' ')) + '</h3><dl class="kv"><dt>ID</dt><dd>' + esc(a.id_alerta) + '</dd><dt>Categoría</dt><dd>' + esc(a.categoria) + '</dd><dt>Serie</dt><dd><a href="#vida/' + encodeURIComponent(a.id_serie) + '">' + esc(a.id_serie) + '</a></dd><dt>Movimiento</dt><dd>' + esc(a.id_movimiento) + '</dd><dt>Fila matriz</dt><dd>' + esc(a.fila_origen) + '</dd><dt>Campo</dt><dd>' + esc(a.campo) + '</dd><dt>Valor encontrado</dt><dd>' + esc(a.valor_encontrado) + '</dd><dt>Valor esperado</dt><dd>' + esc(a.valor_esperado) + '</dd><dt>Descripción</dt><dd>' + esc(a.descripcion) + '</dd><dt>Estado</dt><dd>' + pill(a.estado) + '</dd><dt>Creada</dt><dd>' + esc(a.creada_en) + '</dd>' + (a.comentario_resolucion ? '<dt>Comentario</dt><dd>' + esc(a.comentario_resolucion) + ' (' + esc(a.resuelta_por) + ' ' + esc(a.fecha_resolucion) + ')</dd>' : '') + '</dl>' +
      (can('alertas_revisar') ? '<div class="form-grid" style="margin-top:14px">' + field('estado', 'Nuevo estado', 'select', { options: estados, value: a.estado, empty: undefined }) + field('responsable', 'Responsable', 'text', { value: a.responsable }) + field('comentario', 'Comentario de resolución', 'textarea', { full: 1 }) + '</div>' + (!canClose ? '<p class="hint">Su rol puede revisar pero no cerrar esta alerta.</p>' : '') : '') +
      '<div class="actions"><button class="btn" data-close>Cerrar</button>' + (can('alertas_revisar') ? '<button class="btn pri" id="ok">Guardar</button>' : '') + '</div>', function (md, close) {
      var ok = md.querySelector('#ok'); if (ok) ok.onclick = function () { var d = formData(md); d.id_alerta = a.id_alerta; api('updateAlert', d).then(function () { toast('Alerta actualizada.', 'ok'); close(); route_(); }).catch(function (x) { toast(x.message, 'err'); }); };
    });
  }
  SCREENS.alertas = async function (v) {
    var r = await api('alerts', { filtros: alFilters }), pend = can('aprobar') ? await api('pendingApprovals') : [];
    v.innerHTML = (pend.length ? '<div class="card"><h3>Movimientos pendientes de aprobación<small>bajas y ajustes</small></h3><div id="ap"></div></div>' : '') +
      '<div class="card"><form class="filters" id="flt">' + field('estado', 'Estado', 'select', { options: ['ABIERTAS', 'ABIERTA', 'EN_REVISION', 'RESUELTA', 'DESCARTADA', 'RESUELTA_AUTO'], value: alFilters.estado, empty: 'Todas' }) +
      field('categoria', 'Categoría', 'select', { options: ['CRITICA', 'REVISION', 'FORMATO', 'PRESTAMO', 'TAREA'], value: alFilters.categoria, empty: 'Todas' }) +
      field('severidad', 'Severidad', 'select', { options: ['CRITICA', 'ALTA', 'MEDIA', 'BAJA', 'INFO'], value: alFilters.severidad, empty: 'Todas' }) +
      field('tipo', 'Tipo', 'select', { options: BOOT.catalogos.tipos_alerta, value: alFilters.tipo, empty: 'Todos' }) + field('serie', 'Serie', 'text', { value: alFilters.serie }) +
      '<div class="row"><button class="btn pri" type="submit">Aplicar</button><button class="btn" type="button" id="clr">Limpiar</button></div></form></div><div class="card"><div id="at"></div></div>';
    bindFilters(v, alFilters, route_);
    if (pend.length) table(document.getElementById('ap'), { rows: pend, name: 'pendientes', cols: [{ k: 'id_movimiento', l: 'ID' }, { k: 'id_serie', l: 'Serie' }, { k: 'tipo', l: 'Tipo' }, { k: 'metraje', l: 'Metraje', n: 1, f: function (x, r) { return (r.signo < 0 ? '−' : '') + fmt(x); } }, { k: 'usuario', l: 'Solicitado por' }, { k: 'observacion_original', l: 'Motivo' },
      { k: 'aprobacion', l: '', f: function (x, r) { return '<button class="btn sm pri" data-a="' + esc(r.id_movimiento) + '">Aprobar</button> <button class="btn sm danger" data-r="' + esc(r.id_movimiento) + '">Rechazar</button>'; } }],
      after: function (el) { el.querySelectorAll('[data-a],[data-r]').forEach(function (b) { b.onclick = function () { api('approve', { id_movimiento: b.dataset.a || b.dataset.r, decision: b.dataset.a ? 'APROBAR' : 'RECHAZAR' }).then(function () { toast('Decisión registrada.', 'ok'); route_(); }).catch(function (x) { toast(x.message, 'err'); }); }; }); } });
    table(document.getElementById('at'), { rows: r.filas, name: 'alertas', onRow: alertModal, limit: 500, cols: [{ k: 'severidad', l: 'Sev.', f: function (x) { return pill(x, 1); } }, { k: 'categoria', l: 'Categoría' },
      { k: 'tipo', l: 'Tipo', f: function (x, a) { return esc(x.replace(/_/g, ' ')) + '<span class="sub">' + esc(a.descripcion.slice(0, 110)) + '</span>'; } },
      { k: 'id_serie', l: 'Serie', f: function (x) { return '<a href="#vida/' + encodeURIComponent(x) + '">' + esc(x) + '</a>'; } }, { k: 'fila_origen', l: 'Fila', n: 1 }, { k: 'campo', l: 'Campo' },
      { k: 'valor_encontrado', l: 'Encontrado' }, { k: 'valor_esperado', l: 'Esperado' }, { k: 'estado', l: 'Estado', f: function (x) { return pill(x); } }, { k: 'responsable', l: 'Responsable' }] });
  };

  /* ============================ 11. reportes ============================ */
  var REP = { inventario: 'Inventario', consumo: 'Consumo', excepciones: 'Excepciones', no_utilizable: 'Material no utilizable' };
  var repState = { tipo: 'inventario', f: {} };
  SCREENS.reportes = async function (v) {
    var r = await api('report', { tipo: repState.tipo, filtros: repState.f });
    v.innerHTML = '<div class="card"><div class="tabs">' + Object.keys(REP).map(function (k) { return '<button data-t="' + k + '" class="' + (k === repState.tipo ? 'on' : '') + '">' + REP[k] + '</button>'; }).join('') + '</div>' +
      '<form class="filters" id="flt">' + (repState.tipo === 'consumo' ? field('desde', 'Desde', 'date', { value: repState.f.desde }) + field('hasta', 'Hasta', 'date', { value: repState.f.hasta }) : '') +
      field('bodega', 'Bodega', 'select', { options: BOOT.catalogos.bodegas, value: repState.f.bodega, empty: 'Todas' }) + field('hilos', 'Hilos', 'select', { options: BOOT.catalogos.hilos, value: repState.f.hilos, empty: 'Todos' }) + field('codigo', 'Código / familia', 'text', { value: repState.f.codigo, list: 'dl-art' }) + field('descripcion', 'Descripción', 'text', { value: repState.f.descripcion }) +
      '<div class="row"><button class="btn pri" type="submit">Aplicar</button><button class="btn" type="button" id="clr">Limpiar</button></div></form>' + datalists() +
      '<div class="actions"><button class="btn" id="xl">Exportar Excel</button><button class="btn" id="pdf">PDF / imprimir</button>' + (Api.demo ? '' : '<button class="btn" id="gs">Crear en Google Sheets</button>') + '</div></div>' +
      r.secciones.map(function (s, i) { return '<div class="card"><h3>' + esc(s.titulo) + '<small>' + s.filas.length + ' filas</small></h3><div id="rs' + i + '"></div></div>'; }).join('');
    v.querySelectorAll('.tabs button').forEach(function (b) { b.onclick = function () { repState.tipo = b.dataset.t; route_(); }; });
    bindFilters(v, repState.f, route_);
    r.secciones.forEach(function (s, i) {
      var keys = s.filas.length ? Object.keys(s.filas[0]) : ['info'];
      table(document.getElementById('rs' + i), { rows: s.filas, name: s.titulo, limit: 400, cols: keys.map(function (k) { var isN = s.filas.some(function (x) { return typeof x[k] === 'number'; }) && k !== 'fila' && k !== 'hilos'; return { k: k, l: k.replace(/_/g, ' '), n: isN, f: k === 'serie' ? function (x) { return '<a href="#vida/' + encodeURIComponent(x) + '">' + esc(x) + '</a>'; } : k === 'severidad' ? function (x) { return pill(x, 1); } : undefined }; }) });
    });
    v.querySelector('#xl').onclick = function () { exportXlsx(r.secciones, 'reporte_' + repState.tipo); };
    v.querySelector('#pdf').onclick = function () { window.print(); };
    var gs = v.querySelector('#gs'); if (gs) gs.onclick = function () { busy(gs, true); api('exportReport', { tipo: repState.tipo, filtros: repState.f }).then(function (x) { busy(gs, false); toast('Reporte creado en Google Sheets.', 'ok'); window.open(x.url, '_blank', 'noopener'); }).catch(function (x) { busy(gs, false); toast(x.message, 'err'); }); };
  };

  /* ============================ 12. abastecimiento ============================ */
  SCREENS.abastecimiento = async function (v) {
    var p = await api('projection');
    v.innerHTML = '<div class="card"><div class="note">Proyección por familia de artículo (código sin prefijo de bodega). Consumo = despachado − devuelto. <b>Días de cobertura</b> = disponible ÷ consumo diario promedio (últimos 3 meses × factor de temporada). Es una <b>recomendación que requiere aprobación</b>: el sistema no genera órdenes de compra.</div><div id="pt"></div></div>';
    table(document.getElementById('pt'), { rows: p, name: 'proyeccion', onRow: can('parametros') ? editSupply : null, cols: [
      { k: 'familia', l: 'Familia', f: function (x, r) { return esc(x) + '<span class="sub">' + esc((r.descripcion || '').slice(0, 50)) + '</span>'; } }, { k: 'hilos', l: 'Hilos', n: 1 },
      { k: 'consumo_prom_mensual_12m', l: 'Prom. mensual 12m', n: 1 }, { k: 'consumo_prom_3m', l: 'Prom. 3m', n: 1 }, { k: 'consumo_prom_6m', l: 'Prom. 6m', n: 1 },
      { k: 'stock_disponible', l: 'Disponible', n: 1 }, { k: 'stock_comprometido', l: 'Reservado', n: 1 }, { k: 'stock_minimo', l: 'Mínimo', n: 1 },
      { k: 'dias_cobertura', l: 'Días cobertura', n: 1, f: function (x) { return x === null ? '<span class="hint">sin consumo</span>' : '<span class="' + (x < 30 ? 'neg' : '') + '">' + fmt(x) + '</span>'; } },
      { k: 'fecha_agotamiento', l: 'Agotamiento est.' }, { k: 'punto_reorden', l: 'Punto de reorden', n: 1 }, { k: 'cantidad_sugerida', l: 'Compra sugerida', n: 1 },
      { k: 'bajo_reorden', l: '', f: function (x) { return x ? '<span class="pill p-ALTA">BAJO REORDEN</span>' : ''; } }] });
  };
  function editSupply(r) {
    modal('<h3>Parámetros de abastecimiento · ' + esc(r.familia) + '</h3><div class="form-grid">' + field('stock_minimo', 'Stock mínimo (m)', 'number', { value: r.stock_minimo }) + field('lead_time_dias', 'Tiempo de reposición (días)', 'number', { value: r.lead_time_dias }) +
      field('dias_seguridad', 'Nivel de seguridad (días)', 'number', { value: r.dias_seguridad }) + field('factor_temporada', 'Factor de temporada', 'number', { value: r.factor_temporada, hint: '1 = normal; 1.3 = temporada alta' }) + field('prioridad', 'Prioridad', 'select', { options: ['ALTA', 'MEDIA', 'BAJA'], value: r.prioridad }) + '</div>' +
      '<div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Guardar</button></div>', function (md, close) {
      md.querySelector('#ok').onclick = function () { var d = formData(md); d.familia = r.familia; d.descripcion = r.descripcion; api('saveSupplyParam', { fila: d }).then(function () { toast('Parámetros guardados.', 'ok'); close(); route_(); }).catch(function (x) { toast(x.message, 'err'); }); };
    });
  }

  /* ============================ 13. catálogos ============================ */
  var catTab = 'CATALOGOS';
  SCREENS.catalogos = async function (v) {
    var d = await api('catalogs');
    v.innerHTML = '<div class="card"><div class="tabs">' + [['CATALOGOS', 'Normalización'], ['PARAMETROS', 'Parámetros y umbrales'], ['ARTICULOS', 'Artículos']].map(function (t) { return '<button data-t="' + t[0] + '" class="' + (catTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      (catTab === 'CATALOGOS' ? '<div class="note">Cada valor escrito en la matriz se traduce a un valor normalizado. La <b>clase</b> indica qué es realmente el valor (por ejemplo, una persona escrita en DEPARTAMENTO). El dato original nunca se sobrescribe.</div>' : '') +
      (can('catalogos') && catTab !== 'PARAMETROS' ? '<div class="actions" style="margin-top:0;margin-bottom:10px"><button class="btn pri" id="add">Agregar</button></div>' : '') + '<div id="ct"></div></div>';
    v.querySelectorAll('.tabs button').forEach(function (b) { b.onclick = function () { catTab = b.dataset.t; route_(); }; });
    var el = document.getElementById('ct');
    if (catTab === 'CATALOGOS') {
      var edit = function (r) { if (!can('catalogos')) return; r = r || {}; modal('<h3>Regla de normalización</h3><div class="form-grid">' + field('catalogo', 'Catálogo', 'select', { options: ['ESTADO', 'BODEGA', 'DEPARTAMENTO', 'CONTRATISTA'], value: r.catalogo, req: 1 }) + field('valor_original', 'Valor original', 'text', { value: r.valor_original, req: 1 }) + field('valor_normalizado', 'Valor normalizado', 'text', { value: r.valor_normalizado }) + field('clase', 'Clase real', 'select', { options: ['DEPARTAMENTO', 'CONTRATISTA', 'AREA_INTERNA', 'BODEGA_REGIONAL', 'BODEGA_DESTINO', 'DESTINO', 'PERSONA', 'OBSERVACION', 'RUTA', 'VENTA', 'ESTADO', 'BODEGA'], value: r.clase }) + field('nota', 'Nota', 'text', { value: r.nota, wide: 1 }) + '<div class="f"><label>Activo</label><input type="checkbox" name="activo" ' + (r.activo === 'NO' ? '' : 'checked') + ' style="width:auto"></div></div><div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Guardar</button></div>', function (md, close) { md.querySelector('#ok').onclick = function () { api('saveCatalog', { fila: formData(md) }).then(function () { toast('Guardado. Ejecute "Recalcular" o reimporte para aplicarlo al histórico.', 'ok'); close(); BOOT = null; route_(); }).catch(function (x) { toast(x.message, 'err'); }); }; }); };
      table(el, { rows: d.catalogos, name: 'catalogos', onRow: edit, cols: [{ k: 'catalogo', l: 'Catálogo' }, { k: 'valor_original', l: 'Valor original' }, { k: 'valor_normalizado', l: 'Normalizado' }, { k: 'clase', l: 'Clase' }, { k: 'activo', l: 'Activo' }, { k: 'nota', l: 'Nota' }] });
      var a = document.getElementById('add'); if (a) a.onclick = function () { edit(); };
    } else if (catTab === 'PARAMETROS') {
      table(el, { rows: d.parametros, name: 'parametros', onRow: can('parametros') ? function (r) { modal('<h3>' + esc(r.clave) + '</h3><p class="hint">' + esc(r.descripcion) + '</p>' + field('valor', 'Valor', 'text', { value: r.valor }) + '<div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Guardar</button></div>', function (md, close) { md.querySelector('#ok').onclick = function () { api('saveParam', { clave: r.clave, valor: formData(md).valor }).then(function () { toast('Parámetro guardado.', 'ok'); close(); BOOT = null; route_(); }).catch(function (x) { toast(x.message, 'err'); }); }; }); } : null, cols: [{ k: 'clave', l: 'Parámetro' }, { k: 'valor', l: 'Valor' }, { k: 'descripcion', l: 'Descripción' }] });
    } else {
      var ed = function (r) { if (!can('catalogos')) return; r = r || {}; modal('<h3>Artículo</h3><div class="form-grid">' + field('codigo', 'Código', 'text', { value: r.codigo, req: 1 }) + field('descripcion', 'Descripción', 'text', { value: r.descripcion_original, full: 1 }) + field('hilos', 'Hilos', 'number', { value: r.hilos }) + field('span', 'Span', 'number', { value: r.span }) + field('tipo_cable', 'Tipo de cable', 'select', { options: ['ADSS', 'DUCTO', 'FIGURA 8', 'DROP', 'OTRO'], value: r.tipo_cable }) + field('fabricante', 'Fabricante', 'text', { value: r.fabricante }) + field('stock_minimo', 'Stock mínimo (m)', 'number', { value: r.stock_minimo }) + '</div><div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Guardar</button></div>', function (md, close) { md.querySelector('#ok').onclick = function () { api('saveArticle', { fila: formData(md) }).then(function () { toast('Artículo guardado.', 'ok'); close(); BOOT = null; route_(); }).catch(function (x) { toast(x.message, 'err'); }); }; }); };
      table(el, { rows: d.articulos, name: 'articulos', onRow: ed, cols: [{ k: 'codigo', l: 'Código' }, { k: 'familia', l: 'Familia' }, { k: 'prefijo_bodega', l: 'Prefijo' }, { k: 'descripcion_original', l: 'Descripción' }, { k: 'hilos', l: 'Hilos', n: 1 }, { k: 'span', l: 'Span', n: 1 }, { k: 'tipo_cable', l: 'Tipo' }, { k: 'stock_minimo', l: 'Mínimo', n: 1 }] });
      var a2 = document.getElementById('add'); if (a2) a2.onclick = function () { ed(); };
    }
  };

  /* ============================ 14. usuarios ============================ */
  SCREENS.usuarios = async function (v) {
    var u = await api('listUsers');
    v.innerHTML = '<div class="card"><div class="grid g2"><div><h3>Roles</h3><dl class="kv"><dt>ADMIN</dt><dd>Configura catálogos, corrige (anula) registros, cierra alertas y administra usuarios.</dd><dt>SUPERVISOR</dt><dd>Aprueba ajustes y bajas, valida saldos negativos, cierra alertas críticas.</dd><dt>BODEGA</dt><dd>Registra ingresos, despachos, devoluciones, préstamos, sobrantes y traslados.</dd><dt>ANALISTA</dt><dd>Revisa alertas, concilia, relaciona series y genera reportes.</dd><dt>CONSULTA</dt><dd>Consulta inventario, historial y reportes sin modificar.</dd></dl></div>' +
      '<div><h3>Crear o editar usuario</h3><form id="uf"><div class="form-grid">' + field('email', 'Correo', 'email', { req: 1 }) + field('nombre', 'Nombre', 'text') + field('rol', 'Rol', 'select', { options: Object.keys({ ADMIN: 1, SUPERVISOR: 1, BODEGA: 1, ANALISTA: 1, CONSULTA: 1 }), req: 1 }) + field('password', 'Contraseña (vacía = no cambia)', 'password') + '<div class="f"><label>Activo</label><input type="checkbox" name="activo" checked style="width:auto"></div></div><div class="actions"><button class="btn pri" type="submit">Guardar</button></div></form></div></div></div>' +
      '<div class="card"><div id="ut"></div></div>';
    var f = v.querySelector('#uf');
    f.onsubmit = function (e) { e.preventDefault(); var d = formData(f); api('saveUser', d).then(function () { toast('Usuario guardado.', 'ok'); route_(); }).catch(function (x) { toast(x.message, 'err'); }); };
    table(document.getElementById('ut'), { rows: u, name: 'usuarios', onRow: function (r) { f.email.value = r.email; f.nombre.value = r.nombre; f.rol.value = r.rol; f.activo.checked = r.activo === 'SI'; f.scrollIntoView(); }, cols: [{ k: 'email', l: 'Correo' }, { k: 'nombre', l: 'Nombre' }, { k: 'rol', l: 'Rol' }, { k: 'activo', l: 'Activo' }, { k: 'ultimo_acceso', l: 'Último acceso' }] });
  };

  /* ============================ 15. bitácora ============================ */
  var bitF = {};
  SCREENS.bitacora = async function (v) {
    var b = await api('audit', { filtros: bitF });
    v.innerHTML = '<div class="card"><form class="filters" id="flt">' + field('usuario', 'Usuario', 'text', { value: bitF.usuario }) + field('texto', 'Texto (acción, ID, detalle)', 'text', { value: bitF.texto, wide: 1 }) + '<div class="row"><button class="btn pri" type="submit">Aplicar</button><button class="btn" type="button" id="clr">Limpiar</button></div></form></div><div class="card"><div class="note">Registro inmutable de cada alta, aprobación, anulación, cambio de catálogo y edición manual en la hoja. Los movimientos cerrados no se editan: se anulan y se registra uno nuevo.</div><div id="bt"></div></div>';
    bindFilters(v, bitF, route_);
    table(document.getElementById('bt'), { rows: b, name: 'bitacora', cols: [{ k: 'fecha_hora', l: 'Fecha y hora' }, { k: 'usuario', l: 'Usuario' }, { k: 'accion', l: 'Acción' }, { k: 'tabla', l: 'Tabla' }, { k: 'id_registro', l: 'Registro' }, { k: 'campo', l: 'Campo' }, { k: 'valor_anterior', l: 'Antes', f: function (x) { return esc(String(x).slice(0, 80)); } }, { k: 'valor_nuevo', l: 'Después', f: function (x) { return esc(String(x).slice(0, 80)); } }, { k: 'detalle', l: 'Detalle' }] });
  };

  route_();
})();
