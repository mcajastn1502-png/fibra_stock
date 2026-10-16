/**
 * FIBRA STOCK — API web (Apps Script Web App) consumida por el frontend en GitHub Pages.
 *
 * Petición:  POST  {action, token, payload}  con Content-Type: text/plain (evita preflight CORS)
 * Respuesta: JSON  {ok:true, data} | {ok:false, error}
 */
var FS_READ_ACTIONS = {
  bootstrap: 'bootstrap', dashboard: 'dashboard', inventory: 'inventory', searchSeries: 'searchSeries', rollLife: 'rollLife',
  alerts: 'alerts', loans: 'loans', surpluses: 'surpluses', report: 'report', projection: 'projection', audit: 'audit',
  pendingApprovals: 'pendingApprovals', catalogs: 'catalogs', dispatchesOf: 'dispatchesOf'
};
var FS_WRITE_ACTIONS = {
  registerMovement: 'registerMovement', registerReturn: 'registerReturn', registerLoan: 'registerLoan', returnLoan: 'returnLoan',
  setLoanState: 'setLoanState', registerSurplus: 'registerSurplus', confirmSurplus: 'confirmSurplus', transfer: 'transfer', cut: 'cut',
  approve: 'approve', annulMovement: 'annulMovement', updateAlert: 'updateAlert', linkFamily: 'linkFamily', saveCatalog: 'saveCatalog',
  saveParam: 'saveParam', saveSupplyParam: 'saveSupplyParam', saveArticle: 'saveArticle', recalc: 'recalc'
};

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'ping') return FS_json_({ ok: true, data: { servicio: 'Fibra Stock API', version: FS.VERSION, hora: new Date().toISOString() } });
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">API de Fibra Stock activa (v' + FS.VERSION + '). Use la aplicación web.</p>');
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return FS_json_({ ok: false, error: 'Solicitud inválida.' }); }
  try {
    var a = req.action, p = req.payload || {};
    if (a === 'ping') return FS_json_({ ok: true, data: { version: FS.VERSION } });
    if (a === 'login') return FS_json_({ ok: true, data: FS_login_(p.email, p.password) });
    var user = FS_session_(req.token);
    if (a === 'logout') { CacheService.getScriptCache().remove('tok_' + req.token); return FS_json_({ ok: true, data: true }); }
    if (a === 'changePassword') return FS_json_({ ok: true, data: FS_changePassword_(user, p) });
    if (a === 'listUsers' || a === 'saveUser') return FS_json_({ ok: true, data: FS_users_(user, a, p) });
    if (a === 'exportReport') return FS_json_({ ok: true, data: FS_exportReport_(user, p) });
    if (FS_READ_ACTIONS[a]) {
      var svc = new FS.Service(new FS.SheetStore(), user);
      return FS_json_({ ok: true, data: svc[FS_READ_ACTIONS[a]](p) });
    }
    if (FS_WRITE_ACTIONS[a]) {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) throw new Error('El sistema está ocupado registrando otro movimiento. Intente nuevamente en unos segundos.');
      try {
        var svc2 = new FS.Service(new FS.SheetStore(), user);
        if (a === 'recalc' && (FS.ROLES[user.rol] || []).indexOf('aprobar') < 0) throw new Error('Permiso denegado.');
        var out = svc2[FS_WRITE_ACTIONS[a]](p);
        SpreadsheetApp.flush();
        return FS_json_({ ok: true, data: out });
      } finally { lock.releaseLock(); }
    }
    throw new Error('Acción desconocida: ' + a);
  } catch (err) {
    return FS_json_({ ok: false, error: String(err && err.message || err) });
  }
}

function FS_json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* --------------------------- Autenticación --------------------------- */
function FS_hash_(salt, password) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + password, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function FS_login_(email, password) {
  email = String(email || '').trim().toLowerCase();
  var cache = CacheService.getScriptCache(), fk = 'fail_' + email, fails = +(cache.get(fk) || 0);
  if (fails >= 5) throw new Error('Demasiados intentos fallidos. Espere 15 minutos.');
  var store = new FS.SheetStore();
  var u = store.all('USUARIOS').filter(function (x) { return String(x.email).toLowerCase() === email; })[0];
  if (!u || String(u.activo).toUpperCase() !== 'SI' || FS_hash_(u.salt, password) !== u.hash) {
    cache.put(fk, String(fails + 1), 900);
    throw new Error('Usuario o contraseña incorrectos.');
  }
  cache.remove(fk);
  var token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  var sess = { email: u.email, nombre: u.nombre, rol: u.rol };
  cache.put('tok_' + token, JSON.stringify(sess), 21600); // 6 horas
  store.update('USUARIOS', 'email', u.email, { ultimo_acceso: store.now() });
  return { token: token, user: sess, expira_horas: 6 };
}

function FS_session_(token) {
  if (!token) throw new Error('SESION_EXPIRADA');
  var s = CacheService.getScriptCache().get('tok_' + token);
  if (!s) throw new Error('SESION_EXPIRADA');
  CacheService.getScriptCache().put('tok_' + token, s, 21600); // renueva
  return JSON.parse(s);
}

function FS_changePassword_(user, p) {
  if (!p.nueva || String(p.nueva).length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
  var store = new FS.SheetStore();
  var u = store.all('USUARIOS').filter(function (x) { return x.email === user.email; })[0];
  if (!u || FS_hash_(u.salt, p.actual) !== u.hash) throw new Error('La contraseña actual no es correcta.');
  var salt = Utilities.getUuid();
  store.update('USUARIOS', 'email', u.email, { salt: salt, hash: FS_hash_(salt, p.nueva) });
  store.append('BITACORA', [{ id: store.nextId('LOG'), fecha_hora: store.now(), usuario: user.email, accion: 'CAMBIO_CLAVE', tabla: 'USUARIOS', id_registro: user.email }]);
  return true;
}

function FS_users_(user, action, p) {
  if ((FS.ROLES[user.rol] || []).indexOf('usuarios') < 0) throw new Error('Permiso denegado: solo el administrador gestiona usuarios.');
  var store = new FS.SheetStore();
  if (action === 'listUsers') return store.all('USUARIOS').map(function (u) { return { email: u.email, nombre: u.nombre, rol: u.rol, activo: u.activo, ultimo_acceso: u.ultimo_acceso }; });
  var email = String(p.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Correo inválido.');
  if (!FS.ROLES[p.rol]) throw new Error('Rol inválido.');
  if (email === user.email && p.rol !== 'ADMIN') throw new Error('No puede quitarse a sí mismo el rol de administrador.');
  var ex = store.all('USUARIOS').filter(function (u) { return u.email === email; })[0];
  var row = { email: email, nombre: p.nombre || email, rol: p.rol, activo: p.activo === false || p.activo === 'NO' ? 'NO' : 'SI' };
  if (p.password) { if (String(p.password).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.'); row.salt = Utilities.getUuid(); row.hash = FS_hash_(row.salt, p.password); }
  else if (!ex) throw new Error('Defina una contraseña inicial para el usuario nuevo.');
  if (ex) store.update('USUARIOS', 'email', email, row); else { row.creado_en = store.now(); store.append('USUARIOS', [row]); }
  store.append('BITACORA', [{ id: store.nextId('LOG'), fecha_hora: store.now(), usuario: user.email, accion: ex ? 'EDITAR_USUARIO' : 'CREAR_USUARIO', tabla: 'USUARIOS', id_registro: email, valor_nuevo: row.rol + ' / ' + row.activo }]);
  return true;
}

/** Crea una hoja de cálculo nueva con el reporte y devuelve su URL. */
function FS_exportReport_(user, p) {
  if ((FS.ROLES[user.rol] || []).indexOf('reportes') < 0) throw new Error('Permiso denegado.');
  var svc = new FS.Service(new FS.SheetStore(), user);
  var rep = p.tipo === 'proyeccion' ? { secciones: [{ titulo: 'Proyección de abastecimiento', filas: svc.projection() }] } : svc.report(p);
  return FS_writeReportSpreadsheet_('Fibra Stock - ' + p.tipo + ' - ' + Utilities.formatDate(new Date(), 'America/Guayaquil', 'yyyy-MM-dd HH:mm'), rep, user.email);
}

function FS_writeReportSpreadsheet_(title, rep, shareWith) {
  var out = SpreadsheetApp.create(title);
  rep.secciones.forEach(function (s, i) {
    var sh = i === 0 ? out.getSheets()[0] : out.insertSheet();
    sh.setName(s.titulo.slice(0, 90).replace(/[\[\]\*\?\/\\:]/g, ' '));
    if (!s.filas.length) { sh.getRange(1, 1).setValue('Sin registros'); return; }
    var head = Object.keys(s.filas[0]);
    var vals = [head].concat(s.filas.map(function (r) { return head.map(function (h) { return r[h] === null || r[h] === undefined ? '' : r[h]; }); }));
    sh.getRange(1, 1, vals.length, head.length).setValues(vals);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#e8eef5');
    sh.setFrozenRows(1);
  });
  try { if (shareWith) out.addViewer(shareWith); } catch (e) { /* dominio puede impedir compartir */ }
  return { url: out.getUrl(), nombre: title };
}
