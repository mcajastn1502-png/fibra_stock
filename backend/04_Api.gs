/**
 * FIBRA STOCK — API web (Apps Script Web App) consumida por el frontend en GitHub Pages.
 *
 * Petición:  POST  {action, token, payload}  con Content-Type: text/plain (evita preflight CORS)
 * Respuesta: JSON  {ok:true, data} | {ok:false, error}
 */
var FS_READ_ACTIONS = {
  bootstrap: 'bootstrap', dashboard: 'dashboard', inventory: 'inventory', searchSeries: 'searchSeries', rollLife: 'rollLife',
  alerts: 'alerts', loans: 'loans', surpluses: 'surpluses', report: 'report', projection: 'projection', audit: 'audit',
  pendingApprovals: 'pendingApprovals', catalogs: 'catalogs', dispatchesOf: 'dispatchesOf', seriesInfo: 'seriesInfo'
};
var FS_WRITE_ACTIONS = {
  registerMovement: 'registerMovement', registerDispatchBatch: 'registerDispatchBatch', registerReturnBatch: 'registerReturnBatch', registerOpeningBatch: 'registerOpeningBatch', registerReturn: 'registerReturn', registerLoan: 'registerLoan', returnLoan: 'returnLoan',
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
    if (a === 'login') return FS_json_({ ok: true, data: FS_login_(p.usuario || p.email, p.password) });
    if (a === 'resetPassword') return FS_json_({ ok: true, data: FS_resetPassword_(p) });
    var user = FS_session_(req.token);
    if (a === 'logout') { CacheService.getScriptCache().remove('tok_' + req.token); return FS_json_({ ok: true, data: true }); }
    if (a === 'changePassword') {
      FS_changePassword_(user, p);
      user.debe_cambiar = false; CacheService.getScriptCache().put('tok_' + req.token, JSON.stringify(user), 21600); // la sesión deja de pedir el cambio
      return FS_json_({ ok: true, data: true });
    }
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
      } finally { FS_bumpDataVersion_(); lock.releaseLock(); } // invalida lo que una consulta haya leído a mitad de la escritura
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

/**
 * Busca al usuario por su nombre de usuario. Transición: quien aún no tiene usuario asignado puede ingresar con su correo.
 * conCorreo = true (recuperar contraseña): también acepta el correo de cualquier usuario.
 */
function FS_buscarUsuario_(users, id, conCorreo) {
  id = String(id || '').trim().toLowerCase(); if (!id) return null;
  var u = users.filter(function (x) { return String(x.usuario || '').trim().toLowerCase() === id; })[0];
  if (!u && id.indexOf('@') > 0) u = users.filter(function (x) { return String(x.email).toLowerCase() === id && (conCorreo || !String(x.usuario || '').trim()); })[0];
  return u || null;
}
function FS_ahora_(minutos) { return Utilities.formatDate(new Date(Date.now() + (minutos || 0) * 60000), 'America/Guayaquil', 'yyyy-MM-dd HH:mm:ss'); }
/** Contraseña temporal vigente (enviada por correo al recuperar la contraseña). */
function FS_tempValida_(u, password) {
  return !!(u.temp_hash && u.temp_salt && String(u.temp_expira) > FS_ahora_(0) && FS_hash_(u.temp_salt, password) === u.temp_hash);
}

function FS_login_(id, password) {
  id = String(id || '').trim().toLowerCase();
  var cache = CacheService.getScriptCache(), fk = 'fail_' + id, fails = +(cache.get(fk) || 0);
  if (fails >= 5) throw new Error('Demasiados intentos fallidos. Espere 15 minutos.');
  var store = new FS.SheetStore();
  var u = FS_buscarUsuario_(store.all('USUARIOS'), id);
  var normal = !!u && FS_hash_(u.salt, password) === u.hash, temporal = !!u && !normal && FS_tempValida_(u, password);
  if (!u || String(u.activo).toUpperCase() !== 'SI' || !(normal || temporal)) {
    cache.put(fk, String(fails + 1), 900);
    throw new Error('Usuario o contraseña incorrectos.');
  }
  cache.remove(fk);
  var token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  var sess = { email: u.email, nombre: u.nombre, usuario: u.usuario || '', rol: u.rol, debe_cambiar: temporal || String(u.debe_cambiar).toUpperCase() === 'SI' };
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
  if (!u || (FS_hash_(u.salt, p.actual) !== u.hash && !FS_tempValida_(u, p.actual))) throw new Error('La contraseña actual no es correcta.');
  var salt = Utilities.getUuid();
  store.update('USUARIOS', 'email', u.email, { salt: salt, hash: FS_hash_(salt, p.nueva), temp_salt: '', temp_hash: '', temp_expira: '', debe_cambiar: '' });
  store.append('BITACORA', [{ id: store.nextId('LOG'), fecha_hora: store.now(), usuario: user.email, accion: 'CAMBIO_CLAVE', tabla: 'USUARIOS', id_registro: user.email }]);
  return true;
}

function FS_users_(user, action, p) {
  if ((FS.ROLES[user.rol] || []).indexOf('usuarios') < 0) throw new Error('Permiso denegado: solo el administrador gestiona usuarios.');
  var store = new FS.SheetStore();
  if (action === 'listUsers') return store.all('USUARIOS').map(function (u) { return { email: u.email, usuario: u.usuario || '', nombre: u.nombre, rol: u.rol, activo: u.activo, ultimo_acceso: u.ultimo_acceso }; });
  var email = String(p.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Correo inválido.');
  if (!FS.ROLES[p.rol]) throw new Error('Rol inválido.');
  if (email === user.email && p.rol !== 'ADMIN') throw new Error('No puede quitarse a sí mismo el rol de administrador.');
  var usuario = String(p.usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('Usuario inválido: use de 3 a 30 letras minúsculas, números, punto, guion o guion bajo (sin espacios).');
  var todos = store.all('USUARIOS'), ex = todos.filter(function (u) { return u.email === email; })[0];
  var otro = todos.filter(function (u) { return u.email !== email && String(u.usuario || '').toLowerCase() === usuario; })[0];
  if (otro) throw new Error('El usuario "' + usuario + '" ya está asignado a ' + otro.email + '.');
  var row = { email: email, usuario: usuario, rol: p.rol, activo: p.activo === false || p.activo === 'NO' ? 'NO' : 'SI' };
  if (!ex) row.nombre = usuario;
  if (p.password) { if (String(p.password).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.'); row.salt = Utilities.getUuid(); row.hash = FS_hash_(row.salt, p.password); }
  else if (!ex) throw new Error('Defina una contraseña inicial para el usuario nuevo.');
  if (ex) store.update('USUARIOS', 'email', email, row); else { row.creado_en = store.now(); store.append('USUARIOS', [row]); }
  store.append('BITACORA', [{ id: store.nextId('LOG'), fecha_hora: store.now(), usuario: user.email, accion: ex ? 'EDITAR_USUARIO' : 'CREAR_USUARIO', tabla: 'USUARIOS', id_registro: email, valor_nuevo: usuario + ' / ' + row.rol + ' / ' + row.activo }]);
  return true;
}

/**
 * Recuperar contraseña: envía una contraseña temporal (30 min) al correo registrado. La contraseña actual sigue valiendo,
 * así nadie puede bloquear la cuenta de otro. La respuesta es la misma exista o no el usuario. Máximo 3 pedidos por hora.
 */
function FS_resetPassword_(p) {
  var id = String(p.usuario || p.email || '').trim().toLowerCase();
  if (!id) throw new Error('Ingrese su usuario.');
  var cache = CacheService.getScriptCache(), rk = 'rst_' + id, n = +(cache.get(rk) || 0);
  var resp = { ok: true, mensaje: 'Si el usuario existe y está activo, se envió una contraseña temporal a su correo registrado. Vence en 30 minutos.' };
  if (n >= 3) return resp;
  cache.put(rk, String(n + 1), 3600);
  var store = new FS.SheetStore(), u = FS_buscarUsuario_(store.all('USUARIOS'), id, true);
  if (!u || String(u.activo).toUpperCase() !== 'SI') return resp;
  var temp = Utilities.getUuid().replace(/-/g, '').slice(0, 10), salt = Utilities.getUuid(), vence = FS_ahora_(30);
  store.update('USUARIOS', 'email', u.email, { temp_salt: salt, temp_hash: FS_hash_(salt, temp), temp_expira: vence });
  var url = String(store.params().URL_APP || '').trim();
  MailApp.sendEmail({ to: u.email, subject: 'Fibra Stock: contraseña temporal',
    htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px"><p>Se solicitó recuperar la contraseña de <b>' + (u.usuario || u.email) + '</b> en Fibra Stock.</p>' +
      '<p>Contraseña temporal: <b style="font-size:16px;letter-spacing:1px">' + temp + '</b><br>Vence: ' + vence + ' (30 minutos).</p>' +
      '<p>Ingrese con su usuario y esta contraseña; la aplicación le pedirá definir una nueva. Su contraseña anterior sigue funcionando hasta que la cambie.</p>' +
      (url ? '<p><a href="' + url + '">Abrir Fibra Stock</a></p>' : '') + '<p style="color:#777">Si usted no lo pidió, ignore este correo.</p></div>' });
  store.append('BITACORA', [{ id: store.nextId('LOG'), fecha_hora: store.now(), usuario: u.email, accion: 'RECUPERAR_CLAVE', tabla: 'USUARIOS', id_registro: u.email, detalle: 'Contraseña temporal enviada por correo' }]);
  return resp;
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
