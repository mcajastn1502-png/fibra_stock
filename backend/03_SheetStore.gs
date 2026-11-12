/**
 * FIBRA STOCK — Adaptador Google Sheets (cada tabla = una hoja, fila 1 = encabezados).
 * Implementa la misma interfaz que FS.MemStore.
 */
function FS_getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/* ---------------- Caché de tablas (CacheService) ----------------
 * Cada consulta leía todas las hojas. Ahora las tablas se guardan en la caché de Apps Script bajo una
 * "versión de datos" (propiedad DATA_VER). Toda escritura cambia la versión y la caché anterior deja de usarse.
 * No se guardan USUARIOS (contraseñas) ni BITACORA. Si la caché falla, se lee la hoja como antes. */
var FS_CACHE_TABLAS_ = { ARTICULOS: 1, MOVIMIENTOS: 1, SOBRANTES: 1, ALERTAS: 1, RELACIONES: 1, SERIES: 1, ABASTECIMIENTO_PARAM: 1,
  PRESTAMOS: 1, CATALOGOS: 1, PARAMETROS: 1, MATRIZ_NORMALIZADA: 1 };
var FS_CACHE_TROZO_ = 40000, FS_CACHE_SEG_ = 21600; // trozos < 100 KB; 6 h (máximo de CacheService)

/** Cambia la versión de datos: invalida la caché de todas las tablas. */
function FS_bumpDataVersion_() {
  try { PropertiesService.getScriptProperties().setProperty('DATA_VER', Date.now().toString(36) + Math.random().toString(36).slice(2, 6)); } catch (e) { /* sin propiedades: la caché expira sola */ }
}
function FS_cacheKey_(t) {
  var v = PropertiesService.getScriptProperties().getProperty('DATA_VER');
  if (!v) { FS_bumpDataVersion_(); v = PropertiesService.getScriptProperties().getProperty('DATA_VER'); }
  return 'tbl_' + v + '_' + t;
}
function FS_cacheGet_(t) {
  try {
    var c = CacheService.getScriptCache(), k = FS_cacheKey_(t), n = +(c.get(k + '_n') || 0); if (!n) return null;
    var keys = []; for (var i = 0; i < n; i++) keys.push(k + '_' + i);
    var parts = c.getAll(keys), txt = '';
    for (var j = 0; j < n; j++) { if (parts[keys[j]] == null) return null; txt += parts[keys[j]]; }
    return JSON.parse(txt);
  } catch (e) { return null; }
}
function FS_cachePut_(t, obj) {
  try {
    var c = CacheService.getScriptCache(), k = FS_cacheKey_(t), txt = JSON.stringify(obj), vals = {}, n = 0;
    for (var i = 0; i < txt.length; i += FS_CACHE_TROZO_) vals[k + '_' + (n++)] = txt.slice(i, i + FS_CACHE_TROZO_);
    c.putAll(vals, FS_CACHE_SEG_); c.put(k + '_n', String(n), FS_CACHE_SEG_); // el contador al final: sin él la entrada no se usa
  } catch (e) { /* tabla demasiado grande para la caché: se seguirá leyendo de la hoja */ }
}

FS.SheetStore = function () {
  var ss = null, cache = {}, props = PropertiesService.getScriptProperties(), sucio = false;
  var tz = props.getProperty('TZ');
  var paramsCache = null;

  /** La hoja de cálculo se abre solo cuando hace falta (con la caché, las consultas no la abren). */
  function book() {
    if (!ss) { ss = FS_getSpreadsheet_(); if (!tz) { tz = ss.getSpreadsheetTimeZone() || 'America/Guayaquil'; props.setProperty('TZ', tz); } }
    return ss;
  }
  /** Antes de la primera escritura: invalida la caché (la API vuelve a invalidarla al terminar). */
  function escribe() { if (!sucio) { sucio = true; FS_bumpDataVersion_(); } }
  function hojaDe(c) { return c.sh || (c.sh = sheet(c.t)); }
  function sheet(t) {
    var sh = book().getSheetByName(t);
    if (!sh) throw new Error('No existe la hoja ' + t + '. Ejecute "Fibra Stock › 1. Crear estructura".');
    return sh;
  }
  function cell(v) {
    if (Object.prototype.toString.call(v) === '[object Date]') {
      var hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
      return Utilities.formatDate(v, tz, hasTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
    }
    return v;
  }
  function load(t) {
    if (cache[t]) return cache[t];
    if (FS_CACHE_TABLAS_[t] && !sucio) {
      var hit = FS_cacheGet_(t);
      if (hit) {
        cache[t] = { t: t, sh: null, head: hit.head, rows: hit.rows.map(function (r) { var o = {}; hit.head.forEach(function (h, j) { if (h) o[h] = r[j]; }); o.__row = r[r.length - 1]; return o; }) };
        return cache[t];
      }
    }
    var sh = sheet(t), vals = sh.getDataRange().getValues(), head = vals.shift() || [];
    // Columnas nuevas del esquema que la hoja aún no tiene: se agregan al final del encabezado.
    var faltan = (FS.SCHEMA[t] || []).filter(function (h) { return head.indexOf(h) < 0; });
    if (faltan.length) { sh.getRange(1, head.length + 1, 1, faltan.length).setValues([faltan]).setFontWeight('bold'); head = head.concat(faltan); }
    var rows = vals.filter(function (r) { return r.join('') !== ''; }).map(function (r, i) {
      var o = {}; head.forEach(function (h, j) { if (h) o[h] = cell(r[j]); }); o.__row = i + 2; return o;
    });
    cache[t] = { t: t, sh: sh, head: head, rows: rows };
    if (FS_CACHE_TABLAS_[t] && !sucio) FS_cachePut_(t, { head: head, rows: rows.map(function (o) { return head.map(function (h) { return h ? o[h] : ''; }).concat([o.__row]); }) });
    return cache[t];
  }
  function strip(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== '__row') c[k] = o[k]; }); return c; }
  function fmts(head, n) { var row = head.map(function (h) { return FS.NUMERIC_COL_RE.test(h) ? '0' : '@'; }); var o = []; for (var i = 0; i < n; i++) o.push(row); return o; }
  function toRow(head, o) {
    return head.map(function (h) {
      var v = o[h];
      if (v === undefined || v === null) return '';
      if (typeof v === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(v) &&
          !(FS.NUMERIC_COL_RE.test(h) && /^-?(?:\d+\.?\d*|\.\d+)$/.test(v.trim()))) return "'" + v;
      return v;
    });
  }

  this.all = function (t) { return load(t).rows.map(strip); };
  this.append = function (t, objs) {
    if (!objs || !objs.length) return;
    escribe(); var c = load(t), start = hojaDe(c).getLastRow() + 1;
    var data = objs.map(function (o) { return toRow(c.head, o); });
    c.sh.getRange(start, 1, data.length, c.head.length).setNumberFormats(fmts(c.head, data.length)).setValues(data);
    objs.forEach(function (o, i) { var r = {}; c.head.forEach(function (h) { r[h] = o[h] === undefined ? '' : o[h]; }); r.__row = start + i; c.rows.push(r); });
  };
  this.update = function (t, key, val, patch) {
    var c = load(t), r = c.rows.filter(function (x) { return String(x[key]) === String(val); })[0];
    if (!r) return null;
    escribe(); var old = strip(r); Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
    hojaDe(c).getRange(r.__row, 1, 1, c.head.length).setValues([toRow(c.head, r)]);
    return old;
  };
  this.updateWhere = function (t, pred, patch) {
    var c = load(t), n = 0;
    c.rows.forEach(function (r) {
      if (pred(strip(r))) { escribe(); Object.keys(patch).forEach(function (k) { r[k] = patch[k]; }); hojaDe(c).getRange(r.__row, 1, 1, c.head.length).setValues([toRow(c.head, r)]); n++; }
    });
    return n;
  };
  this.replace = function (t, objs) {
    escribe(); var c = load(t), last = hojaDe(c).getLastRow();
    if (last > 1) c.sh.getRange(2, 1, last - 1, c.sh.getLastColumn()).clearContent();
    if (objs.length) c.sh.getRange(2, 1, objs.length, c.head.length).setNumberFormats(fmts(c.head, objs.length)).setValues(objs.map(function (o) { return toRow(c.head, o); }));
    c.rows = objs.map(function (o, i) { var r = {}; c.head.forEach(function (h) { r[h] = o[h] === undefined ? '' : o[h]; }); r.__row = i + 2; return r; });
  };
  this.nextId = function (p) {
    var k = 'SEQ_' + p, n = +(props.getProperty(k) || 0) + 1; props.setProperty(k, String(n));
    return p + '-' + FS.util.pad(n, 6);
  };
  this.params = function () {
    if (paramsCache) return paramsCache;
    var o = {}; this.all('PARAMETROS').forEach(function (r) { o[r.clave] = r.valor; }); paramsCache = o; return o;
  };
  this.today = function () { if (!tz) book(); return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'); };
  this.now = function () { if (!tz) book(); return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss'); };
  this.spreadsheet = function () { return book(); };
  this.flush = function () { SpreadsheetApp.flush(); };
};
