/**
 * FIBRA STOCK — Adaptador Google Sheets (cada tabla = una hoja, fila 1 = encabezados).
 * Implementa la misma interfaz que FS.MemStore.
 */
function FS_getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

FS.SheetStore = function () {
  var ss = FS_getSpreadsheet_(), cache = {}, props = PropertiesService.getScriptProperties();
  var tz = ss.getSpreadsheetTimeZone() || 'America/Guayaquil';
  var paramsCache = null;

  function sheet(t) {
    var sh = ss.getSheetByName(t);
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
    var sh = sheet(t), vals = sh.getDataRange().getValues(), head = vals.shift() || [];
    var rows = vals.filter(function (r) { return r.join('') !== ''; }).map(function (r, i) {
      var o = {}; head.forEach(function (h, j) { if (h) o[h] = cell(r[j]); }); o.__row = i + 2; return o;
    });
    cache[t] = { sh: sh, head: head, rows: rows };
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
    var c = load(t), start = c.sh.getLastRow() + 1;
    var data = objs.map(function (o) { return toRow(c.head, o); });
    c.sh.getRange(start, 1, data.length, c.head.length).setNumberFormats(fmts(c.head, data.length)).setValues(data);
    objs.forEach(function (o, i) { var r = {}; c.head.forEach(function (h) { r[h] = o[h] === undefined ? '' : o[h]; }); r.__row = start + i; c.rows.push(r); });
  };
  this.update = function (t, key, val, patch) {
    var c = load(t), r = c.rows.filter(function (x) { return String(x[key]) === String(val); })[0];
    if (!r) return null;
    var old = strip(r); Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
    c.sh.getRange(r.__row, 1, 1, c.head.length).setValues([toRow(c.head, r)]);
    return old;
  };
  this.updateWhere = function (t, pred, patch) {
    var c = load(t), n = 0;
    c.rows.forEach(function (r) {
      if (pred(strip(r))) { Object.keys(patch).forEach(function (k) { r[k] = patch[k]; }); c.sh.getRange(r.__row, 1, 1, c.head.length).setValues([toRow(c.head, r)]); n++; }
    });
    return n;
  };
  this.replace = function (t, objs) {
    var c = load(t), last = c.sh.getLastRow();
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
  this.today = function () { return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'); };
  this.now = function () { return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss'); };
  this.spreadsheet = function () { return ss; };
  this.flush = function () { SpreadsheetApp.flush(); };
};
