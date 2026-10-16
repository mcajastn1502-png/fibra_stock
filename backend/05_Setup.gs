/**
 * FIBRA STOCK — Configuración inicial, importación, activadores, auditoría y correos.
 * Se usa desde el menú "Fibra Stock" que aparece en la hoja de cálculo.
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Fibra Stock')
    .addItem('1. Crear estructura', 'setupEstructura')
    .addItem('2. Crear / restablecer administrador', 'crearAdministrador')
    .addItem('3. Importar matriz histórica', 'importarMatriz')
    .addItem('Configurar origen de la matriz (Google Sheets)', 'configurarOrigenMatriz')
    .addItem('4. Instalar activadores (correo diario, auditoría)', 'instalarActivadores')
    .addItem('5. Proteger hojas', 'protegerHojas')
    .addSeparator()
    .addItem('Recalcular saldos y alertas', 'recalcularTodo')
    .addItem('Enviar resumen de alertas ahora', 'enviarResumenAlertas')
    .addItem('Generar reporte semanal en Sheets', 'reporteSemanal')
    .addToUi();
}

var FS_ADMIN_USER_ = { email: 'sistema', nombre: 'Sistema', rol: 'ADMIN' };

function setupEstructura() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone('America/Guayaquil');
  if (!ss.getSheetByName('MATRIZ_ORIGINAL')) ss.insertSheet('MATRIZ_ORIGINAL');
  Object.keys(FS.SCHEMA).forEach(function (t) {
    var head = FS.SCHEMA[t]; if (!head) return;
    var sh = ss.getSheetByName(t) || ss.insertSheet(t);
    var cur = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    if (cur.join('') === '') {
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f3b57').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      // Texto plano en columnas de texto/fechas/documentos (evita que Sheets convierta "05-12-2022" o "484318905");
      // las columnas de metraje y saldos conservan el formato automático (número).
      head.forEach(function (h, j) { if (!FS.NUMERIC_COL_RE.test(h)) sh.getRange(1, j + 1, sh.getMaxRows(), 1).setNumberFormat('@'); });
    } else {
      var faltan = head.filter(function (h) { return cur.indexOf(h) < 0; });
      if (faltan.length) sh.getRange(1, cur.length + 1, 1, faltan.length).setValues([faltan]).setFontWeight('bold');
    }
  });
  var store = new FS.SheetStore();
  if (!store.all('PARAMETROS').length) store.append('PARAMETROS', FS.PARAMS_DEFAULT.concat([['URL_APP', '', 'URL de la aplicación en GitHub Pages (para correos)'], FS_PARAM_MATRIZ_URL_]).map(function (p) { return { clave: p[0], valor: p[1], descripcion: p[2] }; }));
  if (!store.all('CATALOGOS').length) store.append('CATALOGOS', FS.CATALOGO_SEMILLA.map(function (r) { return { catalogo: r[0], valor_original: r[1], valor_normalizado: r[2], clase: r[3], activo: 'SI', nota: 'semilla' }; }));
  var hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && hoja1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(hoja1);
  FS_toast_('Estructura creada. Pegue la matriz en MATRIZ_ORIGINAL y ejecute "Importar matriz histórica".');
}

function crearAdministrador() {
  var ui = SpreadsheetApp.getUi();
  var r1 = ui.prompt('Administrador', 'Correo del administrador:', ui.ButtonSet.OK_CANCEL); if (r1.getSelectedButton() !== ui.Button.OK) return;
  var r2 = ui.prompt('Administrador', 'Contraseña inicial (mínimo 8 caracteres):', ui.ButtonSet.OK_CANCEL); if (r2.getSelectedButton() !== ui.Button.OK) return;
  var email = r1.getResponseText().trim().toLowerCase(), pass = r2.getResponseText();
  if (pass.length < 8) { ui.alert('La contraseña debe tener al menos 8 caracteres.'); return; }
  var store = new FS.SheetStore(), salt = Utilities.getUuid();
  var row = { email: email, nombre: 'Administrador', rol: 'ADMIN', activo: 'SI', salt: salt, hash: FS_hash_(salt, pass), creado_en: store.now() };
  if (!store.update('USUARIOS', 'email', email, row)) store.append('USUARIOS', [row]);
  store.append('BITACORA', [{ id: store.nextId('LOG'), fecha_hora: store.now(), usuario: Session.getEffectiveUser().getEmail(), accion: 'CREAR_ADMIN', tabla: 'USUARIOS', id_registro: email }]);
  ui.alert('Administrador ' + email + ' listo. Cambie la contraseña desde la aplicación tras el primer ingreso.');
}

var FS_PARAM_MATRIZ_URL_ = ['MATRIZ_URL', '', 'Enlace de Google Sheets con la matriz (incluya #gid=… de la pestaña). Vacío = usar la hoja MATRIZ_ORIGINAL'];

/** Extrae { id, gid } de un enlace de Google Sheets; gid es null si el enlace no indica pestaña. */
function FS_parseSheetUrl_(url) {
  var id = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(url || ''), gid = /[#?&]gid=(\d+)/.exec(url || '');
  if (!id) throw new Error('El enlace de la matriz no es un enlace válido de Google Sheets: ' + url);
  return { id: id[1], gid: gid ? Number(gid[1]) : null };
}

/** Lee la matriz desde el enlace MATRIZ_URL (como texto visible) y la copia en MATRIZ_ORIGINAL como respaldo. */
function FS_leerMatrizRemota_(ss, url) {
  var ref = FS_parseSheetUrl_(url), remote;
  try { remote = SpreadsheetApp.openById(ref.id); } catch (e) { throw new Error('No se pudo abrir la hoja de la matriz. Verifique que la cuenta que ejecuta el script tenga acceso. (' + e.message + ')'); }
  var sh = ref.gid === null ? remote.getSheets()[0] : remote.getSheets().filter(function (s) { return s.getSheetId() === ref.gid; })[0];
  if (!sh) throw new Error('La hoja de la matriz no tiene una pestaña con gid=' + ref.gid + '.');
  var vals = sh.getDataRange().getDisplayValues();
  var dest = ss.getSheetByName('MATRIZ_ORIGINAL') || ss.insertSheet('MATRIZ_ORIGINAL');
  dest.clearContents();
  if (vals.length && vals[0].length) dest.getRange(1, 1, vals.length, vals[0].length).setNumberFormat('@').setValues(vals);
  return vals;
}

function configurarOrigenMatriz() {
  var ui = SpreadsheetApp.getUi(), store = new FS.SheetStore();
  var actual = store.params().MATRIZ_URL || '';
  var r = ui.prompt('Origen de la matriz', 'Enlace de Google Sheets con la matriz (copie la URL con la pestaña abierta).\nDéjelo vacío para usar la hoja MATRIZ_ORIGINAL.' + (actual ? '\n\nActual: ' + actual : ''), ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var url = r.getResponseText().trim();
  if (url) FS_parseSheetUrl_(url);
  if (!store.update('PARAMETROS', 'clave', 'MATRIZ_URL', { valor: url })) store.append('PARAMETROS', [{ clave: FS_PARAM_MATRIZ_URL_[0], valor: url, descripcion: FS_PARAM_MATRIZ_URL_[2] }]);
  ui.alert(url ? 'Listo. "Importar matriz histórica" leerá la matriz desde el enlace configurado.' : 'Listo. "Importar matriz histórica" usará la hoja MATRIZ_ORIGINAL.');
}

/**
 * Importa la matriz → MATRIZ_NORMALIZADA, ARTICULOS, MOVIMIENTOS, PRESTAMOS, SOBRANTES, ALERTAS, RELACIONES, SERIES.
 * Si el parámetro MATRIZ_URL tiene un enlace de Google Sheets, lee la matriz de allí y la copia en MATRIZ_ORIGINAL;
 * si no, lee MATRIZ_ORIGINAL sin modificarla. Si ya hay movimientos importados, pide confirmación para reemplazarlos.
 */
function importarMatriz() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { /* ejecución desde el editor */ }
  var url = String(new FS.SheetStore().params().MATRIZ_URL || '').trim();
  var vals = url ? FS_leerMatrizRemota_(ss, url) // texto tal como se ve: preserva "3.156", "05-12-2022", etc.
    : ss.getSheetByName('MATRIZ_ORIGINAL').getDataRange().getDisplayValues();
  if (vals.length < 2) throw new Error(url ? 'La hoja del enlace MATRIZ_URL está vacía.' : 'MATRIZ_ORIGINAL está vacía.');
  var head = vals.shift();
  var rows = vals.filter(function (r) { return r.join('') !== ''; }).map(function (r) { var o = {}; head.forEach(function (h, j) { o[h] = r[j]; }); return o; });
  var store = new FS.SheetStore();
  var existentes = store.all('MOVIMIENTOS').filter(function (m) { return m.origen === 'IMPORTACION'; }).length;
  var manuales = store.all('MOVIMIENTOS').filter(function (m) { return m.origen !== 'IMPORTACION'; });
  if (existentes && ui) {
    var b = ui.alert('Reimportar', 'Ya existen ' + existentes + ' movimientos importados. ¿Reemplazarlos? (los ' + manuales.length + ' movimientos registrados desde la app se conservan)', ui.ButtonSet.YES_NO);
    if (b !== ui.Button.YES) return;
  }
  var props = PropertiesService.getScriptProperties();
  if (!existentes) ['MOV', 'ALE', 'PRE', 'SOB'].forEach(function (p) { props.deleteProperty('SEQ_' + p); });
  var r = FS.processMatrix(rows, { today: store.today(), now: store.now(), params: store.params(), catalogRows: store.all('CATALOGOS'),
    user: Session.getEffectiveUser().getEmail() || 'IMPORTACION', idGen: function (p) { return store.nextId(p); } });
  r.alertas.forEach(function (a) { a.id_alerta = store.nextId('ALE'); });
  var keepAlerts = store.all('ALERTAS').filter(function (a) { return manuales.some(function (m) { return m.id_movimiento === a.id_movimiento; }); });
  store.replace('MATRIZ_NORMALIZADA', r.staging);
  var artsPrev = {}; store.all('ARTICULOS').forEach(function (a) { artsPrev[a.codigo] = a; });
  store.replace('ARTICULOS', r.articulos.map(function (a) { return artsPrev[a.codigo] ? Object.assign({}, a, { stock_minimo: artsPrev[a.codigo].stock_minimo, fabricante: artsPrev[a.codigo].fabricante }) : a; }));
  store.replace('MOVIMIENTOS', r.movimientos.concat(manuales));
  store.replace('PRESTAMOS', r.prestamos.concat(store.all('PRESTAMOS').filter(function (p) { return p.origen === 'APP'; })));
  store.replace('SOBRANTES', r.sobrantes.concat(store.all('SOBRANTES').filter(function (p) { return p.origen === 'APP'; })));
  store.replace('ALERTAS', r.alertas.concat(keepAlerts));
  var relConf = store.all('RELACIONES').filter(function (x) { return x.estado !== 'SUGERIDA'; });
  store.replace('RELACIONES', relConf.concat(r.relaciones.filter(function (x) { return !relConf.some(function (c) { return c.serie === x.serie; }); })));
  var res = new FS.Service(store, FS_ADMIN_USER_).recalc();
  store.append('BITACORA', [{ id: store.nextId('LOG'), fecha_hora: store.now(), usuario: Session.getEffectiveUser().getEmail(), accion: 'IMPORTAR_MATRIZ', tabla: 'MOVIMIENTOS',
    detalle: rows.length + ' filas → ' + r.movimientos.length + ' movimientos, ' + res.series + ' series, ' + r.alertas.length + ' alertas' }]);
  FS_toast_('Importación lista: ' + rows.length + ' filas → ' + r.movimientos.length + ' movimientos, ' + res.series + ' series, ' + r.alertas.length + ' alertas.');
}

function recalcularTodo() {
  var res = new FS.Service(new FS.SheetStore(), FS_ADMIN_USER_).recalc();
  FS_toast_('Recalculado: ' + res.series + ' series, ' + res.alertas_nuevas + ' alertas nuevas, ' + res.alertas_auto_resueltas + ' resueltas automáticamente.');
  return res;
}

function instalarActivadores() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tareaDiaria').timeBased().everyDays(1).atHour(6).nearMinute(45).create();
  ScriptApp.newTrigger('reporteSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
  ScriptApp.newTrigger('auditarEdicion').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  FS_toast_('Activadores instalados: tarea diaria 06:45, reporte semanal lunes 07:00 y auditoría de ediciones.');
}

/** Diario: recalcula (vencimientos de préstamos, saldos bajos) y envía resumen por correo. */
function tareaDiaria() {
  var lock = LockService.getScriptLock(); lock.waitLock(60000);
  try { recalcularTodo(); } finally { lock.releaseLock(); }
  enviarResumenAlertas();
}

function enviarResumenAlertas() {
  var store = new FS.SheetStore(), p = store.params();
  var dest = String(p.CORREOS_ALERTAS || '').trim(); if (!dest) return;
  var abiertas = store.all('ALERTAS').filter(function (a) { return a.estado === 'ABIERTA' || a.estado === 'EN_REVISION'; });
  var ayer = FS.util.addDays(store.today(), -1);
  var nuevas = abiertas.filter(function (a) { return String(a.creada_en).slice(0, 10) >= ayer; });
  var series = store.all('SERIES');
  var cnt = function (f) { return abiertas.filter(f).length; };
  var filas = abiertas.filter(function (a) { return a.severidad === 'CRITICA' || a.tipo === 'PRESTAMO_VENCIDO' || a.tipo === 'PRESTAMO_POR_VENCER'; }).slice(0, 40)
    .map(function (a) { return '<tr><td>' + a.severidad + '</td><td>' + a.tipo + '</td><td>' + a.id_serie + '</td><td>' + a.valor_encontrado + '</td><td>' + a.valor_esperado + '</td></tr>'; }).join('');
  var html = '<div style="font-family:Arial,sans-serif;font-size:13px">' +
    '<h2 style="color:#1f3b57">Fibra Stock — resumen ' + store.today() + '</h2>' +
    '<p><b>' + cnt(function (a) { return a.categoria === 'CRITICA'; }) + '</b> alertas críticas abiertas · <b>' + series.filter(function (s) { return +s.saldo_actual < 0; }).length + '</b> series con saldo negativo · <b>' +
    cnt(function (a) { return a.tipo === 'PRESTAMO_VENCIDO'; }) + '</b> préstamos vencidos · <b>' + cnt(function (a) { return a.tipo === 'PRESTAMO_POR_VENCER'; }) + '</b> por vencer · <b>' + nuevas.length + '</b> alertas nuevas desde ayer.</p>' +
    (filas ? '<table border="1" cellpadding="4" style="border-collapse:collapse"><tr style="background:#e8eef5"><th>Severidad</th><th>Tipo</th><th>Serie</th><th>Encontrado</th><th>Esperado</th></tr>' + filas + '</table>' : '') +
    (p.URL_APP ? '<p><a href="' + p.URL_APP + '#alertas">Abrir alertas en la aplicación</a></p>' : '') + '</div>';
  MailApp.sendEmail({ to: dest, subject: 'Fibra Stock: ' + cnt(function (a) { return a.categoria === 'CRITICA'; }) + ' críticas, ' + nuevas.length + ' nuevas', htmlBody: html });
}

function reporteSemanal() {
  var store = new FS.SheetStore(), svc = new FS.Service(store, FS_ADMIN_USER_);
  var inv = svc.report({ tipo: 'inventario' }), exc = svc.report({ tipo: 'excepciones' }), con = svc.report({ tipo: 'consumo' });
  var rep = { secciones: inv.secciones.concat(con.secciones).concat(exc.secciones.filter(function (s) { return s.filas.length; })).concat([{ titulo: 'Proyección', filas: svc.projection() }]) };
  var r = FS_writeReportSpreadsheet_('Fibra Stock - semanal - ' + store.today(), rep, '');
  var dest = String(store.params().CORREOS_ALERTAS || '').trim();
  if (dest) MailApp.sendEmail(dest, 'Fibra Stock: reporte semanal ' + store.today(), 'Reporte generado: ' + r.url);
  return r;
}

/**
 * Activador instalable onEdit: registra en BITACORA cualquier edición manual en las hojas del sistema
 * y revierte cambios sobre movimientos CERRADOS (las correcciones se hacen por anulación + nuevo movimiento).
 */
function auditarEdicion(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet(), name = sh.getName();
  if (!FS.SCHEMA.hasOwnProperty(name)) return;
  var store = new FS.SheetStore(), user = (e.user && e.user.getEmail && e.user.getEmail()) || Session.getActiveUser().getEmail() || 'desconocido';
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], campo = head[e.range.getColumn() - 1] || '';
  var revertido = false;
  if (name === 'MOVIMIENTOS' && e.range.getRow() > 1) {
    var colEstado = head.indexOf('estado_registro') + 1;
    var estado = sh.getRange(e.range.getRow(), colEstado).getValue();
    if (estado === 'CERRADO' || estado === 'ANULADO' || (campo === 'estado_registro' && e.oldValue === 'CERRADO')) {
      if (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1) { e.range.setValue(e.oldValue === undefined ? '' : e.oldValue); revertido = true; }
    }
  }
  if (name === 'MATRIZ_ORIGINAL' && e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 && e.oldValue !== undefined) { e.range.setValue(e.oldValue); revertido = true; }
  store.append('BITACORA', [{ id: store.nextId('LOG'), fecha_hora: store.now(), usuario: user, accion: revertido ? 'EDICION_REVERTIDA' : 'EDICION_MANUAL_HOJA', tabla: name,
    id_registro: 'fila ' + e.range.getRow(), campo: campo, valor_anterior: e.oldValue === undefined ? '' : e.oldValue, valor_nuevo: e.value === undefined ? '(rango/múltiple)' : e.value,
    detalle: revertido ? 'Los registros cerrados no se editan: anule y registre un movimiento nuevo.' : '' }]);
}

/** Protege todas las hojas: solo el propietario (con quien corre la API) puede editarlas. */
function protegerHojas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), me = Session.getEffectiveUser();
  ss.getSheets().forEach(function (sh) {
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
    var p = sh.protect().setDescription('Fibra Stock: editar solo desde la aplicación');
    p.addEditor(me); p.removeEditors(p.getEditors().filter(function (u) { return u.getEmail() !== me.getEmail(); }));
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });
  FS_toast_('Hojas protegidas. Los usuarios operan desde la aplicación web.');
}

function FS_toast_(msg) { try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Fibra Stock', 8); } catch (e) { Logger.log(msg); } }
