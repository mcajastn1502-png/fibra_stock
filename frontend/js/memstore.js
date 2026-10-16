/**
 * Store en memoria (modo demo y pruebas). Misma interfaz que SheetStore en Apps Script.
 * En el navegador conserva los cambios en localStorage para que la demo "recuerde" lo registrado.
 */
var FS = (typeof FS !== 'undefined') ? FS : {};
FS.MemStore = function (tables, opts) {
  opts = opts || {};
  var T = tables || {}, seq = {}, self = this;
  Object.keys(FS.SCHEMA).forEach(function (t) { if (FS.SCHEMA[t] && !T[t]) T[t] = []; });
  Object.keys(T).forEach(function (t) {
    T[t].forEach(function (r) { Object.keys(r).forEach(function (k) {
      var m = /^([A-Z]{3})-(\d+)$/.exec(String(r[k] || '')); if (m && /^id/.test(k)) seq[m[1]] = Math.max(seq[m[1]] || 0, +m[2]);
    }); });
  });
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  this.all = function (t) { return clone(T[t] || []); };
  this.append = function (t, rows) { T[t] = (T[t] || []).concat(clone(rows)); persist(); };
  this.update = function (t, key, val, patch) {
    var row = (T[t] || []).filter(function (r) { return String(r[key]) === String(val); })[0];
    if (!row) return null; var old = clone(row); Object.keys(patch).forEach(function (k) { row[k] = patch[k]; }); persist(); return old;
  };
  this.updateWhere = function (t, pred, patch) {
    var n = 0; (T[t] || []).forEach(function (r) { if (pred(clone(r)) || pred(r)) { Object.keys(patch).forEach(function (k) { r[k] = patch[k]; }); n++; } }); persist(); return n;
  };
  this.replace = function (t, rows) { T[t] = clone(rows); persist(); };
  this.nextId = function (p) { seq[p] = (seq[p] || 0) + 1; return p + '-' + String(seq[p]).padStart(6, '0'); };
  this.params = function () { var o = {}; (T.PARAMETROS || []).forEach(function (r) { o[r.clave] = r.valor; }); return o; };
  this.today = function () { return opts.today || new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10); };
  this.now = function () { return opts.now || new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 19).replace('T', ' '); };
  this.dump = function () { return T; };
  function persist() { if (opts.persistKey && typeof localStorage !== 'undefined') { try { localStorage.setItem(opts.persistKey, JSON.stringify(T)); } catch (e) { /* cuota o modo privado */ } } }
};

/** Construye todas las tablas a partir del CSV de la matriz (igual que importarMatriz() en Apps Script). */
FS.buildFromCSV = function (csvText, today, now) {
  var rows = FS.parseCSV(csvText);
  var params = {}; FS.PARAMS_DEFAULT.forEach(function (p) { params[p[0]] = p[1]; });
  var T = {
    PARAMETROS: FS.PARAMS_DEFAULT.map(function (p) { return { clave: p[0], valor: p[1], descripcion: p[2] }; }),
    CATALOGOS: FS.CATALOGO_SEMILLA.map(function (r) { return { catalogo: r[0], valor_original: r[1], valor_normalizado: r[2], clase: r[3], activo: 'SI', nota: '' }; })
  };
  var store = new FS.MemStore(T, { today: today, now: now });
  var r = FS.processMatrix(rows, { today: store.today(), now: store.now(), params: params, catalogRows: store.all('CATALOGOS'), user: 'IMPORTACION', idGen: store.nextId });
  r.alertas.forEach(function (a) { a.id_alerta = store.nextId('ALE'); });
  store.replace('MATRIZ_NORMALIZADA', r.staging); store.replace('ARTICULOS', r.articulos); store.replace('MOVIMIENTOS', r.movimientos);
  store.replace('PRESTAMOS', r.prestamos); store.replace('SOBRANTES', r.sobrantes); store.replace('ALERTAS', r.alertas); store.replace('RELACIONES', r.relaciones);
  store.replace('ABASTECIMIENTO_PARAM', []);
  var svc = new FS.Service(store, { email: 'importacion', rol: 'ADMIN' });
  svc.recalc();
  return store;
};
