/**
 * FIBRA STOCK — Motor de reglas (JavaScript puro, sin APIs de Google).
 * - Normalización con trazabilidad (valor original, normalizado, regla, confianza)
 * - Conversión de la matriz histórica a movimientos por serie
 * - Cálculo de saldos por serie, alertas, préstamos, consumo, dashboard, reportes y proyección
 * Se usa igual en Apps Script y en el modo demo del navegador.
 */
var FS = (typeof FS !== 'undefined') ? FS : {};

/* ================================================================== */
/*  UTILIDADES                                                        */
/* ================================================================== */
FS.util = (function () {
  function str(v) { return (v === null || v === undefined) ? '' : String(v); }
  function stripAccents(s) { return str(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function key(s) { return stripAccents(s).toUpperCase().replace(/\s+/g, ' ').trim(); }
  function isEmpty(v) { return v === null || v === undefined || str(v).trim() === '' || str(v).trim().toUpperCase() === 'NAN'; }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function isoFromYMD(y, m, d) { return pad(y, 4) + '-' + pad(m, 2) + '-' + pad(d, 2); }
  function validYMD(y, m, d) {
    if (m < 1 || m > 12 || d < 1) return false;
    var dim = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= dim[m - 1];
  }
  function isoToDate(iso) { var p = iso.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function dateToIso(dt) { return isoFromYMD(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
  function addDays(iso, n) { var d = isoToDate(iso); d.setUTCDate(d.getUTCDate() + n); return dateToIso(d); }
  function diffDays(a, b) { return Math.round((isoToDate(a) - isoToDate(b)) / 86400000); } // a - b
  function round(n, dec) { var f = Math.pow(10, dec || 0); return Math.round(n * f) / f; }
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

  /** Interpreta un metraje conservando trazabilidad. Nunca adivina en silencio. */
  function parseMetraje(raw) {
    var out = { original: raw, value: null, regla: '', confianza: '', revision: false, texto: false, ambiguo: false };
    if (isEmpty(raw)) { out.regla = 'VACIO'; return out; }
    if (typeof raw === 'number') {
      if (raw % 1 !== 0 && raw < 100 && /^\d+\.\d{3}$/.test(String(raw))) {
        out.value = Math.round(raw * 1000); out.regla = 'NUMERO_CON_3_DECIMALES_COMO_MILES'; out.confianza = 'MEDIA';
        out.revision = true; out.ambiguo = true; return out;
      }
      out.value = raw; out.regla = 'NUMERO'; out.confianza = 'ALTA'; return out;
    }
    var s = str(raw).trim().toUpperCase();
    var unidad = /\s*(M|MT|MTS|MTRS|METROS)\.?$/.test(s);
    if (unidad) { s = s.replace(/\s*(M|MT|MTS|MTRS|METROS)\.?$/, ''); out.texto = true; }
    if (/^\d+$/.test(s)) { out.value = +s; out.regla = unidad ? 'TEXTO_CON_UNIDAD' : 'ENTERO'; out.confianza = unidad ? 'MEDIA' : 'ALTA'; out.revision = unidad; return out; }
    if (/^\d+\.0+$/.test(s)) { out.value = parseInt(s, 10); out.regla = 'DECIMAL_CERO'; out.confianza = 'ALTA'; return out; }
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      out.value = +s.replace(/\./g, ''); out.regla = 'PUNTO_COMO_SEPARADOR_DE_MILES'; out.confianza = 'MEDIA';
      out.revision = true; out.ambiguo = true; return out;
    }
    if (/^\d{1,3}(,\d{3})+$/.test(s)) {
      out.value = +s.replace(/,/g, ''); out.regla = 'COMA_COMO_SEPARADOR_DE_MILES'; out.confianza = 'MEDIA';
      out.revision = true; out.ambiguo = true; return out;
    }
    if (/^\d+[.,]\d{1,2}$/.test(s)) {
      out.value = +s.replace(',', '.'); out.regla = 'DECIMAL'; out.confianza = 'MEDIA'; out.revision = true; out.ambiguo = true; return out;
    }
    var m = s.match(/\d+/);
    if (m) { out.value = +m[0]; out.regla = 'NUMERO_EXTRAIDO_DE_TEXTO'; out.confianza = 'BAJA'; out.revision = true; out.texto = true; return out; }
    out.regla = 'NO_INTERPRETABLE'; out.confianza = 'BAJA'; out.revision = true; out.texto = true; return out;
  }

  /** Interpreta una fecha. Formato esperado DD-MM-AAAA (o DD/MM/AAAA). */
  function parseFecha(raw) {
    var out = { original: raw, iso: '', regla: '', formato: '', valida: false, confianza: '' };
    if (isEmpty(raw)) { out.regla = 'VACIO'; return out; }
    if (Object.prototype.toString.call(raw) === '[object Date]') {
      if (isNaN(raw.getTime())) { out.regla = 'FECHA_NATIVA_INVALIDA'; return out; }
      out.iso = isoFromYMD(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
      out.regla = 'FECHA_NATIVA'; out.formato = 'DATE'; out.valida = true; out.confianza = 'MEDIA'; return out;
    }
    if (typeof raw === 'number' && raw > 20000 && raw < 80000) { // serial de hoja de cálculo
      var d0 = new Date(Date.UTC(1899, 11, 30)); d0.setUTCDate(d0.getUTCDate() + Math.floor(raw));
      out.iso = dateToIso(d0); out.regla = 'SERIAL_HOJA_CALCULO'; out.formato = 'SERIAL'; out.valida = true; out.confianza = 'MEDIA'; return out;
    }
    var s = str(raw).trim(), m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
      out.formato = 'AAAA-MM-DD';
      if (validYMD(+m[1], +m[2], +m[3])) { out.iso = isoFromYMD(+m[1], +m[2], +m[3]); out.valida = true; out.regla = 'ISO'; out.confianza = 'ALTA'; }
      else out.regla = 'FECHA_IMPOSIBLE';
      return out;
    }
    if ((m = s.match(/^(\d{1,2})([-\/.])(\d{1,2})\2(\d{2,4})$/))) {
      var d = +m[1], mo = +m[3], y = +m[4]; if (y < 100) y += 2000;
      out.formato = (m[2] === '-' ? 'DD-MM-AAAA' : m[2] === '/' ? 'DD/MM/AAAA' : 'DD.MM.AAAA');
      if (validYMD(y, mo, d)) { out.iso = isoFromYMD(y, mo, d); out.valida = true; out.regla = 'DIA_MES_ANIO'; out.confianza = 'ALTA'; }
      else if (validYMD(y, d, mo)) { out.iso = isoFromYMD(y, d, mo); out.valida = true; out.regla = 'MES_DIA_ANIO_INVERTIDO'; out.confianza = 'BAJA'; }
      else out.regla = 'FECHA_IMPOSIBLE';
      return out;
    }
    out.regla = 'FORMATO_DESCONOCIDO'; out.formato = 'OTRO'; return out;
  }

  function hilosFrom(raw) { var m = str(raw).match(/(\d+)/); return m ? +m[1] : null; }
  /** Hilos declarados dentro de la descripción del artículo (144 F.O., 48H, 6B1.3, 048FO...) */
  function hilosFromDesc(desc) {
    var s = key(desc), m;
    if ((m = s.match(/(\d{1,3})\s*(?:H\b|HILOS|F\.?\s?O\b|F\.O\.|F\.0|FO\b|B1\.3)/))) return +m[1];
    if ((m = s.match(/(?:^|\s|-)0?(\d{2,3})F[O0]\b/))) return +m[1];
    return null;
  }
  function spanFromDesc(desc) { var m = key(desc).match(/SPA[NM]\s*(\d{2,3})/); return m ? +m[1] : null; }
  function serieNorm(raw) { return key(raw).replace(/\s+/g, ''); }
  /** Raíz de familia: B250459-1-001 → B250459, C220370TN01 → C220370. Las series 10-SEG-... son su propia raíz. */
  function serieRaiz(norm) { var m = str(norm).match(/^([A-Z]\d{5,6})/); return m ? m[1] : norm; }
  function familiaCodigo(codigo) {
    var c = key(codigo); var m = c.match(/^(10|US|[A-Z]{2,3}\d?)-(.+)$/);
    return m ? { prefijo: m[1], familia: m[2] } : { prefijo: '', familia: c };
  }
  function levenshtein(a, b) {
    if (a === b) return 0; var al = a.length, bl = b.length; if (!al) return bl; if (!bl) return al;
    var v0 = [], v1 = [], i, j; for (i = 0; i <= bl; i++) v0[i] = i;
    for (i = 0; i < al; i++) { v1[0] = i + 1; for (j = 0; j < bl; j++) v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + (a[i] === b[j] ? 0 : 1)); var t = v0; v0 = v1; v1 = t; }
    return v0[bl];
  }
  function findDates(text) {
    var out = [], re = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, m;
    while ((m = re.exec(str(text)))) out.push(m[0]);
    return out;
  }
  function groupSum(arr, keyFn, valFn) {
    var o = {}; arr.forEach(function (x) { var k = keyFn(x); if (k === null || k === undefined || k === '') k = '(sin dato)'; o[k] = (o[k] || 0) + valFn(x); }); return o;
  }
  function topN(obj, n) {
    return Object.keys(obj).map(function (k) { return { k: k, v: round(obj[k], 1) }; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, n || 9999);
  }
  return { str: str, key: key, isEmpty: isEmpty, pad: pad, addDays: addDays, diffDays: diffDays, round: round, num: num,
    parseMetraje: parseMetraje, parseFecha: parseFecha, hilosFrom: hilosFrom, hilosFromDesc: hilosFromDesc,
    spanFromDesc: spanFromDesc, serieNorm: serieNorm, serieRaiz: serieRaiz, familiaCodigo: familiaCodigo,
    levenshtein: levenshtein, findDates: findDates, groupSum: groupSum, topN: topN, stripAccents: stripAccents };
})();

/* ================================================================== */
/*  CATÁLOGO / NORMALIZACIÓN                                          */
/* ================================================================== */
FS.Catalog = function (rows) {
  var U = FS.util, map = {}, canon = {};
  (rows || []).forEach(function (r) {
    if (r.activo === false || U.key(r.activo) === 'FALSE' || U.key(r.activo) === 'NO') return;
    var cat = U.key(r.catalogo);
    map[cat + '|' + U.key(r.valor_original)] = r;
    if (r.valor_normalizado && (r.clase === cat || r.clase === 'DEPARTAMENTO' || r.clase === 'CONTRATISTA')) {
      (canon[cat] = canon[cat] || {})[U.key(r.valor_normalizado)] = r;
    }
  });
  /** Devuelve {original, normalizado, clase, regla, confianza} sin perder el valor original */
  this.normalize = function (catalogo, value) {
    var cat = U.key(catalogo), k = U.key(value).replace(/\s*[.;,]+$/, '');
    var res = { original: value === undefined ? '' : value, normalizado: '', clase: '', regla: '', confianza: '' };
    if (U.isEmpty(value)) { res.regla = 'VACIO'; return res; }
    var hit = map[cat + '|' + k] || map[cat + '|' + U.key(value)];
    if (hit) { res.normalizado = hit.valor_normalizado; res.clase = hit.clase; res.regla = 'CATALOGO_EXACTO'; res.confianza = 'ALTA'; return res; }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(k)) { res.clase = 'FECHA'; res.regla = 'FECHA_EN_CAMPO_TEXTO'; res.confianza = 'ALTA'; return res; }
    if (/^[A-D]\d{5,6}/.test(k)) { res.clase = 'SERIE'; res.regla = 'SERIE_EN_CAMPO_TEXTO'; res.confianza = 'MEDIA'; return res; }
    var best = null, bestD = 99;
    Object.keys(canon[cat] || {}).forEach(function (c) { var d = U.levenshtein(k, c); if (d < bestD) { bestD = d; best = canon[cat][c]; } });
    if (best && bestD <= 2 && k.length >= 5) {
      res.normalizado = best.valor_normalizado; res.clase = best.clase; res.regla = 'APROXIMADO_LEVENSHTEIN_' + bestD; res.confianza = 'MEDIA'; return res;
    }
    res.clase = 'NO_CATALOGADO'; res.regla = 'SIN_COINCIDENCIA'; res.confianza = 'BAJA'; return res;
  };
};

/* ================================================================== */
/*  ALERTAS                                                           */
/* ================================================================== */
FS.mkAlert = function (tipo, o) {
  var def = FS.ALERTAS[tipo] || ['CONCILIACION', 'MEDIA', tipo];
  o = o || {};
  var clave = [tipo, o.id_serie || '', o.id_movimiento || '', o.fila_origen || '', o.campo || '', o.claveExtra || ''].join('|');
  return {
    id_alerta: '', clave: clave, tipo: tipo, categoria: def[0], severidad: o.severidad || def[1], id_serie: o.id_serie || '',
    id_movimiento: o.id_movimiento || '', fila_origen: o.fila_origen || '', campo: o.campo || '',
    valor_encontrado: FS.util.str(o.encontrado), valor_esperado: FS.util.str(o.esperado),
    descripcion: def[2] + (o.detalle ? ' — ' + o.detalle : ''), estado: 'ABIERTA', responsable: o.responsable || '',
    creada_en: o.creada_en || '', fecha_resolucion: '', comentario_resolucion: '', resuelta_por: '', dinamica: o.dinamica ? 'SI' : 'NO'
  };
};

/* ================================================================== */
/*  IMPORTACIÓN DE LA MATRIZ HISTÓRICA                                */
/* ================================================================== */
/**
 * @param {Array<Object>} rows  filas de la matriz original como objetos {encabezado: valor}
 * @param {Object} opts {catalogRows, params, today(ISO), user, now, idGen(prefix)}
 */
FS.processMatrix = function (rows, opts) {
  var U = FS.util, cat = new FS.Catalog(opts.catalogRows || FS.CATALOGO_SEMILLA.map(function (r) {
    return { catalogo: r[0], valor_original: r[1], valor_normalizado: r[2], clase: r[3], activo: true };
  }));
  var today = opts.today, user = opts.user || 'IMPORTACION', now = opts.now || today;
  var anioMin = +(opts.params && opts.params.ANIO_MINIMO_VALIDO) || 2018;
  var seq = {}; var idGen = opts.idGen || function (p) { seq[p] = (seq[p] || 0) + 1; return p + '-' + U.pad(seq[p], 6); };

  // --- 1. mapear encabezados
  var colMap = {};
  if (rows.length) {
    var heads = Object.keys(rows[0]);
    Object.keys(FS.MATRIZ_COLS).forEach(function (f) {
      var wanted = FS.MATRIZ_COLS[f].map(U.key);
      heads.forEach(function (h) { if (!colMap[f] && wanted.indexOf(U.key(h)) >= 0) colMap[f] = h; });
    });
  }
  function g(r, f) { return colMap[f] ? r[colMap[f]] : ''; }

  var staging = [], movs = [], alertas = [], prestamos = [], sobrantes = [], relaciones = [], articulos = {};
  function alert(tipo, o) { o.creada_en = now; alertas.push(FS.mkAlert(tipo, o)); }

  // --- 2. normalizar cada fila
  var fmtCount = {};
  rows.forEach(function (r, i) {
    var fila = i + 2; // fila en la hoja (1 = encabezado)
    var f = U.parseFecha(g(r, 'fecha'));
    var pin = U.parseMetraje(g(r, 'ingreso')), pout = U.parseMetraje(g(r, 'salida'));
    var est = cat.normalize('ESTADO', g(r, 'estado')), bod = cat.normalize('BODEGA', g(r, 'bodega'));
    var dep = cat.normalize('DEPARTAMENTO', g(r, 'departamento')), con = cat.normalize('CONTRATISTA', g(r, 'contratista'));
    var cod = U.key(g(r, 'codigo')), fam = U.familiaCodigo(cod);
    var serieN = U.serieNorm(g(r, 'serie'));
    var cert = U.str(g(r, 'certificacion')).trim(), certK = U.key(cert), certPor = '', certFecha = '', certObs = '';
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cert)) certFecha = U.parseFecha(cert).iso;
    else if (/SOBRANTE|DEVUEL|DEVOLV|SALE|PARA |PRESTA/.test(certK)) certObs = cert;
    else certPor = cert;
    var obs = U.str(g(r, 'observacion')).trim();
    if (!certFecha && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(obs)) certFecha = U.parseFecha(obs).iso; // fecha suelta en observación
    var desc = U.str(g(r, 'descripcion')).trim();
    var hil = U.hilosFrom(g(r, 'hilos')), hilD = U.hilosFromDesc(desc);
    var spanN = U.isEmpty(g(r, 'span')) ? null : U.parseMetraje(g(r, 'span')).value;
    if (f.formato) fmtCount[f.formato] = (fmtCount[f.formato] || 0) + 1;
    staging.push({
      fila: fila, fecha_original: U.str(g(r, 'fecha')), fecha: f.iso, regla_fecha: f.regla, _f: f,
      bodega_original: U.str(g(r, 'bodega')), bodega: bod.normalizado || U.key(g(r, 'bodega')),
      codigo: cod, familia: fam.familia, _prefijo: fam.prefijo, descripcion: desc,
      serie_original: U.str(g(r, 'serie')), serie_normalizada: serieN, serie_raiz: serieN ? U.serieRaiz(serieN) : '',
      hilos_original: U.str(g(r, 'hilos')), hilos: hil, hilos_descripcion: hilD,
      span_original: U.str(g(r, 'span')), span: spanN,
      estado_original: U.str(g(r, 'estado')), estado: est.normalizado || U.key(g(r, 'estado')),
      ubicacion: U.key(g(r, 'ubicacion')),
      mts_ingreso_original: U.str(g(r, 'ingreso')), mts_ingreso: pin.value, mts_salida_original: U.str(g(r, 'salida')),
      mts_salida: pout.value, _pin: pin, _pout: pout,
      regla_metraje: [pin.regla, pout.regla].join(' / '),
      confianza_metraje: (pin.confianza === 'BAJA' || pout.confianza === 'BAJA') ? 'BAJA' : (pin.confianza === 'MEDIA' || pout.confianza === 'MEDIA') ? 'MEDIA' : 'ALTA',
      revision_manual: (pin.revision || pout.revision) ? 'SI' : 'NO',
      ruta: U.str(g(r, 'ruta')).trim(), departamento_original: U.str(g(r, 'departamento')),
      departamento: dep.clase === 'DEPARTAMENTO' || dep.clase === 'BODEGA_REGIONAL' ? dep.normalizado : '',
      clase_departamento: dep.clase, _dep: dep,
      documento: U.str(g(r, 'documento')).replace(/\.0$/, '').trim(),
      contratista_original: U.str(g(r, 'contratista')),
      contratista: (con.clase === 'CONTRATISTA' || con.clase === 'AREA_INTERNA' || con.clase === 'BODEGA_DESTINO' || con.clase === 'DESTINO' || con.clase === 'VENTA') ? con.normalizado : '',
      clase_contratista: con.clase, _con: con,
      certificacion_original: cert, certificado_por: certPor, fecha_certificacion: certFecha, _certObs: certObs,
      observacion: obs, clasificacion_repeticion: '', riesgo_duplicado: '', movimientos_generados: ''
    });
  });
  var fmtPred = Object.keys(fmtCount).sort(function (a, b) { return fmtCount[b] - fmtCount[a]; })[0];

  // --- 3. alertas de formato por fila
  staging.forEach(function (s) {
    var base = { id_serie: s.serie_normalizada, fila_origen: s.fila };
    if (!s._f.valida) alert('FECHA_INVALIDA', mix(base, { campo: 'FECHA', encontrado: s.fecha_original, esperado: 'DD-MM-AAAA válida' }));
    else {
      if (s.fecha > today) alert('FECHA_FUTURA', mix(base, { campo: 'FECHA', encontrado: s.fecha_original, esperado: '<= ' + today }));
      if (+s.fecha.slice(0, 4) < anioMin) alert('FECHA_INVALIDA', mix(base, { campo: 'FECHA', encontrado: s.fecha_original, esperado: 'Año >= ' + anioMin, detalle: 'Año fuera de rango operativo', severidad: 'MEDIA' }));
      if (s._f.regla === 'MES_DIA_ANIO_INVERTIDO') alert('FECHA_INVALIDA', mix(base, { campo: 'FECHA', encontrado: s.fecha_original, esperado: s.fecha, detalle: 'Se interpretó con día y mes invertidos', severidad: 'MEDIA' }));
      if (s._f.formato !== fmtPred) alert('FECHA_FORMATO_MIXTO', mix(base, { campo: 'FECHA', encontrado: s.fecha_original, esperado: fmtPred }));
    }
    [['_pin', 'MTS INGRESO'], ['_pout', 'MTS SALIDA']].forEach(function (p) {
      var x = s[p[0]];
      if (x.ambiguo) alert('METRAJE_AMBIGUO', mix(base, { campo: p[1], encontrado: x.original, esperado: x.value + ' m (' + x.regla + ', confianza ' + x.confianza + ')', detalle: 'Requiere revisión manual' }));
      else if (x.texto) alert('METRAJE_TEXTO', mix(base, { campo: p[1], encontrado: x.original, esperado: x.value === null ? 'número' : x.value + ' m', detalle: x.regla }));
    });
    if (s.hilos && s.hilos_descripcion && s.hilos !== s.hilos_descripcion)
      alert('HILOS_NO_COINCIDE', mix(base, { campo: 'N° HILOS', encontrado: s.hilos_original, esperado: s.hilos_descripcion + ' H según descripción', detalle: s.codigo + ' ' + s.descripcion }));
    var spD = U.spanFromDesc(s.descripcion);
    if (s.span && spD && s.span !== spD)
      alert('SPAN_NO_COINCIDE', mix(base, { campo: 'SPAN', encontrado: s.span, esperado: spD + ' según descripción' }));
    ['contratista_original', 'observacion', 'certificacion_original'].forEach(function (fld) {
      U.findDates(s[fld]).forEach(function (d) {
        var pf = U.parseFecha(d);
        alert('FECHA_EN_TEXTO', mix(base, { campo: fld.toUpperCase(), encontrado: s[fld], esperado: 'Fecha en campo propio (' + pf.iso + ')', claveExtra: d }));
        if (pf.iso > today) alert('CERTIFICACION_FUTURA', mix(base, { campo: fld.toUpperCase(), encontrado: d, esperado: '<= ' + today, claveExtra: d }));
      });
    });
    // artículo
    if (s.codigo && !articulos[s.codigo]) {
      articulos[s.codigo] = { id_articulo: 'ART-' + s.codigo, codigo: s.codigo, familia: s.familia, prefijo_bodega: s._prefijo,
        descripcion_original: s.descripcion, descripcion_normalizada: U.key(s.descripcion),
        hilos: s.hilos_descripcion || s.hilos || '', span: U.spanFromDesc(s.descripcion) || s.span || '',
        tipo_cable: /DUCT|DUCTO/.test(U.key(s.descripcion)) ? 'DUCTO' : /FIG(URE)?\s*8|FG8/.test(U.key(s.descripcion)) ? 'FIGURA 8' : /DROP/.test(U.key(s.descripcion)) ? 'DROP' : /ADSS/.test(U.key(s.descripcion)) ? 'ADSS' : 'OTRO',
        fabricante: '', unidad: 'm', stock_minimo: '', activo: 'SI' };
    }
  });

  // --- 4. agrupar por serie y generar movimientos en orden cronológico
  var bySerie = {}, order = [];
  staging.forEach(function (s, idx) {
    var k = s.serie_normalizada || ('SIN-SERIE-F' + s.fila);
    if (!s.serie_normalizada) {
      if (!s.codigo && s.mts_ingreso === null && s.mts_salida === null) {
        alert('REGISTRO_INCOMPLETO', { fila_origen: s.fila, campo: 'FILA', encontrado: s.ruta || '(vacía)', esperado: 'Serie, código y metraje' });
        s.clasificacion_repeticion = 'REGISTRO_INCOMPLETO'; s.movimientos_generados = '0'; return;
      }
      alert('SERIE_VACIA', { id_serie: k, fila_origen: s.fila, campo: 'SERIE', encontrado: '(vacío)', esperado: 'Serie del rollo', detalle: 'Se asignó identificador temporal ' + k });
    }
    s._key = k; s._idx = idx;
    if (!bySerie[k]) { bySerie[k] = []; order.push(k); }
    bySerie[k].push(s);
  });

  var COMPARE = ['fecha', 'codigo', 'mts_ingreso', 'mts_salida', 'estado', 'documento', 'ruta', 'contratista_original', 'observacion', 'bodega'];
  order.forEach(function (k) {
    var list = bySerie[k].slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a._idx - b._idx; });
    var st = { saldo: 0, tuvoIngreso: false, ultimoDesp: null, bodega: '', ultimoEstado: '', desp: [], ultimoTipo: '', prestamoAbierto: null };
    var prev = [];
    list.forEach(function (s, pos) {
      var base = { id_serie: k, fila_origen: s.fila };
      var generated = [];
      // 4.1 clasificación de repetición
      if (pos === 0) s.clasificacion_repeticion = 'PRIMERA_APARICION';
      else {
        var best = 0, bestRow = null;
        prev.forEach(function (p) {
          var eq = COMPARE.filter(function (c) { return U.str(p[c]) === U.str(s[c]); }).length;
          if (eq > best) { best = eq; bestRow = p; }
        });
        var riesgo = Math.round(best / COMPARE.length * 100);
        s.riesgo_duplicado = riesgo;
        if (riesgo === 100) {
          s.clasificacion_repeticion = 'DUPLICADO_ACCIDENTAL'; s.movimientos_generados = '0';
          alert('DUPLICADO_ACCIDENTAL', mix(base, { campo: 'FILA', encontrado: 'Fila ' + s.fila, esperado: 'Distinta de fila ' + bestRow.fila }));
          prev.push(s); return;
        }
        var swapped = bestRow && bestRow.fecha && s.fecha && bestRow.fecha.slice(0, 4) === s.fecha.slice(0, 4) &&
          bestRow.fecha.slice(5, 7) === s.fecha.slice(8, 10) && bestRow.fecha.slice(8, 10) === s.fecha.slice(5, 7);
        if (riesgo >= 70 || swapped) {
          alert('POSIBLE_DUPLICADO', mix(base, { campo: 'FILA', encontrado: 'Fila ' + s.fila + ' (riesgo ' + riesgo + '%)', esperado: 'Revisar contra fila ' + bestRow.fila,
            detalle: swapped ? 'Las fechas parecen tener día y mes invertidos (' + bestRow.fecha_original + ' vs ' + s.fecha_original + ')' : 'Coinciden ' + best + ' de ' + COMPARE.length + ' campos' }));
        }
        s.clasificacion_repeticion = (s.bodega !== st.bodega && st.bodega) ? 'REPETICION_CON_CAMBIO_DE_BODEGA' : 'REPETICION_POR_MOVIMIENTO';
      }
      var common = {
        id_serie: k, codigo: s.codigo, serie_original: s.serie_original, serie_derivada: '', fecha: s.fecha, ubicacion: s.ubicacion,
        proyecto_ruta: s.ruta, departamento_original: s.departamento_original, departamento: s.departamento,
        contratista_original: s.contratista_original, contratista: s.contratista, responsable: '', documento: s.documento,
        documento_ref: '', usuario: user, creado_en: now, observacion_original: s.observacion,
        observacion_normalizada: U.key([s.observacion, s._certObs].filter(Boolean).join(' | ')), evidencia_url: '',
        origen: 'IMPORTACION', fila_origen: s.fila, estado_registro: 'CERRADO', aprobacion: 'NO_REQUIERE', aprobado_por: '', id_vinculado: ''
      };
      function addMov(o) {
        var m = mix(common, o); m.id_movimiento = idGen('MOV');
        if (m.signo === undefined) m.signo = FS.TIPOS_MOV[m.tipo].signo;
        movs.push(m); generated.push(m); return m;
      }
      var estadoFila = s.estado;
      var IN = s.mts_ingreso, OUT = s.mts_salida;

      // 4.2 parte de ingreso
      if (IN !== null && IN !== undefined) {
        if (!st.tuvoIngreso && pos === 0) {
          addMov({ tipo: 'INGRESO_INICIAL', metraje: IN, bodega_origen: '', bodega_destino: s.bodega,
            estado_resultante: OUT ? estadoFila : (estadoFila === 'DESPACHADA' ? 'EN_CONCILIACION' : estadoFila),
            regla_aplicada: 'PRIMERA_APARICION_CON_INGRESO', confianza: s.confianza_metraje });
          st.saldo += IN; st.tuvoIngreso = true;
        } else if (st.saldo <= 0 && (st.ultimoTipo === 'DESPACHO' || st.ultimoTipo === 'PRESTAMO')) {
          var esPrest = st.ultimoTipo === 'PRESTAMO', ref = st.ultimoDesp;
          var dm = addMov({ tipo: esPrest ? 'DEVOLUCION_DE_PRESTAMO' : 'DEVOLUCION', metraje: IN, bodega_origen: ref ? ref.bodega_destino : '',
            bodega_destino: s.bodega, estado_resultante: OUT ? estadoFila : (estadoFila === 'DESPACHADA' ? 'EN_CONCILIACION' : estadoFila),
            documento_ref: ref ? ref.documento : '', id_vinculado: ref ? ref.id_movimiento : '',
            regla_aplicada: 'REAPARICION_CON_INGRESO_TRAS_SALIDA', confianza: 'MEDIA' });
          st.saldo += IN; s.clasificacion_repeticion = 'REPETICION_POR_DEVOLUCION';
          if (ref) {
            var devueltoAntes = movs.filter(function (m) { return m.id_vinculado === ref.id_movimiento && m !== dm; }).reduce(function (a, m) { return a + m.metraje; }, 0);
            var cons = ref.metraje - devueltoAntes - IN;
            alert('DEVOLUCION_INFERIDA', mix(base, { id_movimiento: dm.id_movimiento, campo: 'MTS INGRESO', encontrado: IN + ' m devueltos en ' + s.bodega,
              esperado: '<= ' + ref.metraje + ' m despachados (doc ' + (ref.documento || 's/d') + ')',
              detalle: 'Consumo preliminar ' + cons + ' m' + (ref.bodega_destino && ref.bodega_destino !== s.bodega ? '. Recibida en otra bodega (' + (ref.bodega_destino || '') + ' → ' + s.bodega + ')' : '') }));
            if (IN > ref.metraje - devueltoAntes)
              alert('DEVOLUCION_MAYOR_DESPACHO', mix(base, { id_movimiento: dm.id_movimiento, campo: 'MTS INGRESO', encontrado: IN, esperado: '<= ' + (ref.metraje - devueltoAntes) }));
            if (esPrest && st.prestamoAbierto) {
              st.prestamoAbierto.fecha_devolucion = s.fecha; st.prestamoAbierto.metraje_devuelto = IN;
              st.prestamoAbierto.id_mov_devolucion = dm.id_movimiento; st.prestamoAbierto = null;
            }
          } else alert('DEVOLUCION_SIN_REFERENCIA', mix(base, { id_movimiento: dm.id_movimiento, campo: 'MTS INGRESO', encontrado: IN }));
        } else {
          if (st.saldo > 0 && IN === st.saldo) {
            // mismo metraje que el saldo calculado: registro posterior (misma bodega) o traslado (otra bodega)
            var esTras = st.bodega && s.bodega && s.bodega !== st.bodega;
            var tm = addMov({ tipo: esTras ? 'TRASLADO_ENTRE_BODEGAS' : 'CAMBIO_DE_ESTADO', metraje: esTras ? IN : 0, signo: 0,
              bodega_origen: st.bodega, bodega_destino: s.bodega,
              estado_resultante: OUT ? estadoFila : (estadoFila === 'DESPACHADA' ? 'EN_CONCILIACION' : estadoFila),
              regla_aplicada: esTras ? 'REAPARICION_MISMO_SALDO_OTRA_BODEGA' : 'REGISTRO_POSTERIOR_MISMO_SALDO', confianza: esTras ? 'MEDIA' : 'ALTA' });
            if (esTras) alert('TRASLADO_INFERIDO', mix(base, { id_movimiento: tm.id_movimiento, campo: 'BODEGA', encontrado: st.bodega + ' → ' + s.bodega, esperado: 'Documento de traslado' }));
            if (esTras) s.clasificacion_repeticion = 'REPETICION_POR_TRASLADO';
            else s.clasificacion_repeticion = 'REGISTRO_POSTERIOR';
          } else {
          // la serie reaparece con ingreso pero aún tenía saldo (o nunca tuvo ingreso): no se inventa movimiento
          var cm = addMov({ tipo: 'CAMBIO_DE_ESTADO', metraje: 0, signo: 0, bodega_origen: st.bodega, bodega_destino: s.bodega,
            estado_resultante: OUT ? estadoFila : (estadoFila === 'DESPACHADA' ? 'EN_CONCILIACION' : estadoFila),
            regla_aplicada: 'REAPARICION_SIN_MOVIMIENTO_DE_METRAJE', confianza: 'BAJA' });
          alert('REAPARICION_CON_SALDO', mix(base, { id_movimiento: cm.id_movimiento, campo: 'MTS INGRESO', encontrado: IN + ' m declarados en ' + s.bodega,
            esperado: 'Saldo calculado ' + st.saldo + ' m en ' + (st.bodega || 's/b'), detalle: 'Conciliar: ¿devolución, traslado o corrección del despacho anterior?' }));
          if (st.bodega && s.bodega !== st.bodega && st.saldo > 0)
            alert('SERIE_EN_DOS_BODEGAS', mix(base, { id_movimiento: cm.id_movimiento, campo: 'BODEGA', encontrado: st.bodega + ' y ' + s.bodega, esperado: 'Una sola bodega' }));
        }
        }
      }
      // 4.3 parte de salida
      if (OUT !== null && OUT !== undefined && OUT !== 0) {
        var esPrestamo = estadoFila === 'PRESTADA';
        var disponible = st.saldo;
        var sm = addMov({ tipo: esPrestamo ? 'PRESTAMO' : 'DESPACHO', metraje: OUT, bodega_origen: s.bodega,
          bodega_destino: s.contratista && s.clase_contratista === 'BODEGA_DESTINO' ? s.contratista : '',
          estado_resultante: (st.saldo - OUT) > 0 ? 'DISPONIBLE' : estadoFila,
          regla_aplicada: esPrestamo ? 'SALIDA_CON_ESTADO_PRESTADA' : 'SALIDA_REGISTRADA', confianza: s.confianza_metraje });
        st.saldo -= OUT;
        if (!st.tuvoIngreso) alert('SALIDA_SIN_INGRESO', mix(base, { id_movimiento: sm.id_movimiento, campo: 'MTS SALIDA', encontrado: OUT, esperado: 'Ingreso previo o inventario de apertura' }));
        else if (OUT > disponible) alert('SALIDA_MAYOR_INGRESO', mix(base, { id_movimiento: sm.id_movimiento, campo: 'MTS SALIDA', encontrado: OUT + ' m', esperado: '<= ' + disponible + ' m', detalle: 'Diferencia ' + (OUT - disponible) + ' m' }));
        if (!s.documento) alert('DOCUMENTO_VACIO_SALIDA', mix(base, { id_movimiento: sm.id_movimiento, campo: '# DOC DESPACHO', encontrado: '(vacío)', esperado: 'Número de documento' }));
        else if (st.desp.some(function (d) { return d.documento === s.documento && d.metraje === OUT; }))
          alert('DOC_DESPACHO_DUPLICADO', mix(base, { id_movimiento: sm.id_movimiento, campo: '# DOC DESPACHO', encontrado: s.documento + ' / ' + OUT + ' m', esperado: 'Un solo despacho por documento y serie' }));
        if (/STOCK\s*BODEGA/.test(U.key(s.ruta))) alert('DESPACHO_RUTA_STOCK', mix(base, { id_movimiento: sm.id_movimiento, campo: 'RUTA', encontrado: s.ruta, esperado: 'Ruta o proyecto de destino' }));
        if (!s.departamento) alert('DEPARTAMENTO_VACIO', mix(base, { id_movimiento: sm.id_movimiento, campo: 'DEPARTAMENTO', encontrado: s.departamento_original || '(vacío)', esperado: 'Departamento del catálogo', detalle: s.clase_departamento && s.clase_departamento !== 'NO_CATALOGADO' ? 'El valor corresponde a ' + s.clase_departamento : '' }));
        if (s.clase_contratista === 'NO_CATALOGADO') alert('CONTRATISTA_NO_REGISTRADO', mix(base, { id_movimiento: sm.id_movimiento, campo: 'CONTRATISTA', encontrado: s.contratista_original, esperado: 'Contratista del catálogo' }));
        if (s.clase_contratista === 'BODEGA_DESTINO') alert('POSIBLE_TRASLADO', mix(base, { id_movimiento: sm.id_movimiento, campo: 'CONTRATISTA', encontrado: s.contratista_original, esperado: 'Registrar como traslado si el material sigue en inventario de la empresa' }));
        st.desp.push(sm); st.ultimoDesp = sm;
        if (esPrestamo) {
          var resp = responsableDe(s);
          var p = { id_prestamo: idGen('PRE'), id_serie: k, serie: s.serie_original, codigo: s.codigo, metraje_prestado: OUT,
            responsable: resp, contratista: s.contratista, departamento: s.departamento, proyecto: s.ruta, fecha_prestamo: s.fecha,
            fecha_limite: '', fecha_devolucion: '', metraje_devuelto: '', diferencia: '', estado: '', estado_manual: '',
            documento: s.documento, observaciones: [s.observacion, s.contratista_original].filter(Boolean).join(' | '),
            id_mov_prestamo: sm.id_movimiento, id_mov_devolucion: '', origen: 'IMPORTACION' };
          sm.responsable = resp; prestamos.push(p); st.prestamoAbierto = p;
          if (!resp) alert('PRESTADA_SIN_RESPONSABLE', mix(base, { id_movimiento: sm.id_movimiento, campo: 'RESPONSABLE', encontrado: '(vacío)', esperado: 'Persona responsable' }));
        }
      } else if (estadoFila === 'DESPACHADA') {
        alert('ESTADO_DESPACHADA_SIN_SALIDA', mix(base, { id_movimiento: generated.length ? generated[generated.length - 1].id_movimiento : '', campo: 'MTS SALIDA', encontrado: '(vacío)', esperado: 'Metraje despachado', detalle: 'Saldo queda pendiente de conciliación' }));
      } else if (estadoFila === 'PRESTADA') {
        alert('ESTADO_NO_COINCIDE', mix(base, { campo: 'ESTADO', encontrado: 'PRESTADA sin metraje de salida', esperado: 'Metraje prestado' }));
      }
      if (IN === null && (OUT === null || OUT === 0) && s.estado && generated.length === 0) {
        addMov({ tipo: 'CAMBIO_DE_ESTADO', metraje: 0, signo: 0, bodega_origen: st.bodega, bodega_destino: s.bodega, estado_resultante: estadoFila, regla_aplicada: 'FILA_SIN_METRAJE', confianza: 'BAJA' });
      }
      // 4.4 observaciones de texto libre → tareas, nunca movimientos automáticos
      textTasks(s, base, generated);
      if (s.bodega) st.bodega = s.bodega;
      if (generated.length) st.ultimoTipo = generated[generated.length - 1].tipo === 'CAMBIO_DE_ESTADO' ? st.ultimoTipo : generated[generated.length - 1].tipo;
      s.movimientos_generados = generated.map(function (m) { return m.id_movimiento + ':' + m.tipo; }).join(', ') || '0';
      prev.push(s);
    });
  });

  // --- 5. series derivadas / familias (sugerencias, no fusiones)
  var raices = {};
  order.forEach(function (k) { var r = U.serieRaiz(k); (raices[r] = raices[r] || []).push(k); });
  Object.keys(raices).forEach(function (r) {
    var fam = raices[r]; if (fam.length < 2 && fam[0] === r) return;
    if (fam.length < 2) return;
    var madre = fam.indexOf(r) >= 0 ? r : fam.slice().sort(function (a, b) { return a.length - b.length; })[0];
    fam.forEach(function (s) {
      if (s === madre) return;
      relaciones.push({ serie: s, serie_madre: madre, tipo_relacion: 'POSIBLE_DERIVADA', estado: 'SUGERIDA', sugerida_por: 'REGLA_RAIZ_' + r, confirmada_por: '', fecha: today });
      alert('SERIE_DERIVADA_POSIBLE', { id_serie: s, campo: 'SERIE', encontrado: s, esperado: 'Familia ' + madre, detalle: 'Confirmar en "Historial fibra" si es corte del rollo ' + madre, creada_en: now });
    });
  });

  function responsableDe(s) {
    var t = U.key([s.observacion, s.ruta, s._certObs].join(' ')), m;
    if ((m = t.match(/PREST[A-Z]*\s+(?:A|AL|HA)\s+(?:ING\.?\s+)?([A-Z]+(?:\s+[A-Z]+)?)/)) && !/^(BODEGA|PROYECTO)/.test(m[1])) return m[1];
    if ((m = t.match(/([A-Z]{3,}\s+[A-Z]{3,})\s+PRESTA\b/)) && !/\b(POR|PARA|UIO|FIBRA)\b/.test(m[1])) return m[1];
    if (s._con.clase === 'PERSONA') return U.key(s.contratista_original);
    if (s._dep.clase === 'PERSONA') return U.key(s.departamento_original);
    return '';
  }
  function textTasks(s, base, generated) {
    var mid = generated.length ? generated[generated.length - 1].id_movimiento : '';
    var txt = U.key([s.observacion, s._certObs, s.clase_departamento === 'OBSERVACION' ? s.departamento_original : '',
      s.clase_contratista === 'OBSERVACION' ? s.contratista_original : '', s.ruta].filter(Boolean).join(' | '));
    if (!txt) return;
    var qty = (txt.match(/(\d{3,5})\s*(?:M\b|MTS|MTRS|METROS)/) || txt.match(/(?:DEVUELVE|SACA|SALE)\s+(\d{3,5})/) || [])[1];
    var b = mix(base, { id_movimiento: mid, campo: 'OBSERVACION', encontrado: txt.slice(0, 180) });
    if (/PREST/.test(txt)) alert('TAREA_PRESTAMO_TEXTO', mix(b, { esperado: 'Registro en módulo de préstamos' + (qty ? ' (' + qty + ' m mencionados)' : '') }));
    if (/DEVUEL|DEVOLV|DEVULT|DELUEN|DEVOLUC/.test(txt)) {
      if (qty) alert('TAREA_DEVOLUCION_TEXTO', mix(b, { esperado: 'Devolución documentada de ' + qty + ' m' }));
      else alert('OBS_DEVOLUCION_SIN_METRAJE', mix(b, { esperado: 'Metraje devuelto' }));
    }
    if (/SOBRANTE/.test(txt)) {
      if (!qty) alert('SOBRANTE_SIN_CANTIDAD', mix(b, { esperado: 'Metraje sobrante' }));
      var desp = generated.filter(function (m) { return m.tipo === 'DESPACHO'; })[0];
      sobrantes.push({ id_sobrante: idGen('SOB'), id_serie: s._key, serie: s.serie_original, proyecto_original: s.ruta,
        documento_despacho: s.documento, metraje_despachado: desp ? desp.metraje : '', metraje_utilizado: '', metraje_sobrante: qty ? +qty : '',
        metraje_devuelto: '', fecha_devolucion: '', condicion: '', bodega_receptora: '', nuevo_proyecto: '',
        estado: qty ? 'DECLARADO' : 'PENDIENTE_CUANTIFICAR', id_movimiento: '', registrado_por: user, confirmado_por: '',
        observaciones: 'Generado desde texto: ' + txt.slice(0, 120), origen: 'IMPORTACION' });
    }
    if (/\bSACA\b|\bSALE\b/.test(txt) && qty && (s.mts_salida === null || s.mts_salida === undefined))
      alert('TAREA_SALIDA_TEXTO', mix(b, { esperado: 'Salida de ' + qty + ' m registrada como movimiento' }));
  }

  staging.forEach(function (s) { Object.keys(s).forEach(function (k) { if (k[0] === '_') delete s[k]; }); });
  return { staging: staging, articulos: Object.keys(articulos).map(function (k) { return articulos[k]; }), movimientos: movs,
    prestamos: prestamos, sobrantes: sobrantes, alertas: dedupeAlerts(alertas), relaciones: relaciones, columnas: colMap };

  function mix(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  function dedupeAlerts(arr) { var seen = {}; return arr.filter(function (a) { if (seen[a.clave]) return false; seen[a.clave] = 1; return true; }); }
};

/* ================================================================== */
/*  CÁLCULO DE SALDOS POR SERIE                                       */
/* ================================================================== */
FS.isMovVigente = function (m) {
  return m.estado_registro !== 'ANULADO' && (m.aprobacion === 'NO_REQUIERE' || m.aprobacion === 'APROBADO' || !m.aprobacion);
};

/** Calcula la tabla SERIES desde MOVIMIENTOS (fuente única de verdad). */
FS.computeSeries = function (data) {
  var U = FS.util, art = {}, rel = {}, openAlerts = {}, loansOpen = {};
  (data.articulos || []).forEach(function (a) { art[a.codigo] = a; });
  (data.relaciones || []).forEach(function (r) { if (r.estado === 'CONFIRMADA') rel[r.serie] = r.serie_madre; });
  (data.alertas || []).forEach(function (a) {
    if (a.estado === 'ABIERTA' || a.estado === 'EN_REVISION') {
      var o = openAlerts[a.id_serie] = openAlerts[a.id_serie] || { n: 0, conc: 0, crit: 0 };
      o.n++; if (a.categoria === 'CRITICA') o.crit++; if (a.categoria === 'CONCILIACION' || a.categoria === 'CRITICA') o.conc++;
    }
  });
  (data.prestamos || []).forEach(function (p) { if (['ACTIVO', 'VENCIDO', 'DEVUELTO_PARCIAL', 'PENDIENTE_DE_CONCILIACION', ''].indexOf(p.estado) >= 0 && !p.id_mov_devolucion) loansOpen[p.id_serie] = p; });
  var staging = {}; (data.staging || []).forEach(function (s) { if (s.serie_normalizada) staging[s.serie_normalizada] = s; });

  var groups = {};
  (data.movimientos || []).forEach(function (m) { (groups[m.id_serie] = groups[m.id_serie] || []).push(m); });
  return Object.keys(groups).map(function (k) {
    var all = groups[k].slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.id_movimiento < b.id_movimiento ? -1 : 1); });
    var ms = all.filter(FS.isMovVigente);
    var t = { ingresado: 0, despachado: 0, devuelto: 0, prestado: 0, dev_prestamo: 0, baja: 0, corte: 0, ajuste: 0 };
    var inicial = '', bodega = '', ubic = '', estado = '', reservado = '', conf = 'ALTA', serieOrig = '', codigo = '', ultimo = '';
    ms.forEach(function (m) {
      var g = (FS.TIPOS_MOV[m.tipo] || {}).grupo, mt = U.num(m.metraje), sg = U.num(m.signo);
      if (g === 'ingresado') { t.ingresado += mt; if (inicial === '') inicial = mt; }
      else if (g === 'despachado') t.despachado += mt;
      else if (g === 'devuelto') t.devuelto += mt;
      else if (g === 'prestado') t.prestado += mt;
      else if (g === 'dev_prestamo') t.dev_prestamo += mt;
      else if (g === 'baja') t.baja += mt;
      else if (g === 'corte') { t.corte += sg * mt; if (sg > 0 && inicial === '') inicial = mt; }
      else if (g === 'ajuste') t.ajuste += sg * mt;
      if (['DESPACHO', 'PRESTAMO', 'BAJA_POR_MAL_ESTADO'].indexOf(m.tipo) >= 0) { if (m.bodega_origen) bodega = m.bodega_origen; }
      else if (m.bodega_destino && FS.BODEGAS.indexOf(m.bodega_destino) >= 0) bodega = m.bodega_destino;
      else if (!bodega && m.bodega_origen) bodega = m.bodega_origen;
      if (m.ubicacion) ubic = m.ubicacion;
      if (m.estado_resultante) {
        estado = m.estado_resultante;
        reservado = m.estado_resultante === 'RESERVADA' ? [m.proyecto_ruta, m.departamento].filter(Boolean).join(' / ') : '';
      }
      if (m.confianza === 'BAJA') conf = 'BAJA'; else if (m.confianza === 'MEDIA' && conf === 'ALTA') conf = 'MEDIA';
      if (!serieOrig) serieOrig = m.serie_original; if (m.fecha > ultimo) ultimo = m.fecha;
      if (m.codigo) codigo = m.codigo;
    });
    var st = staging[k] || {};
    codigo = codigo || st.codigo || '';
    var saldo = t.ingresado + t.devuelto + t.dev_prestamo - t.despachado - t.prestado - t.baja + t.corte + t.ajuste;
    saldo = U.round(saldo, 2);
    var oa = openAlerts[k] || { n: 0, conc: 0, crit: 0 };
    var tieneIngreso = t.ingresado > 0 || t.corte > 0;
    var salidas = t.despachado + t.prestado;
    var estadoSaldo;
    if (!tieneIngreso && salidas > 0) estadoSaldo = 'SIN_INGRESO_REGISTRADO';
    else if (saldo < 0) estadoSaldo = 'NEGATIVO';
    else if (oa.conc > 0) estadoSaldo = 'PENDIENTE_CONCILIACION';
    else if (conf !== 'ALTA') estadoSaldo = 'ESTIMADO';
    else estadoSaldo = 'COMPLETO';
    // estado actual derivado (nunca oculta negativos)
    var e = estado || 'DISPONIBLE';
    if (saldo < 0) e = 'EN_CONCILIACION';
    else if (loansOpen[k] && saldo <= 0) e = 'PRESTADA';
    else if (t.baja > 0 && saldo === 0) e = 'BAJA';
    else if (saldo === 0 && (e === 'DISPONIBLE' || e === 'RESERVADA' || e === 'DEVUELTA')) e = 'AGOTADA';
    else if (saldo > 0 && (e === 'DESPACHADA' || e === 'PRESTADA')) e = 'DISPONIBLE';
    if (e !== 'RESERVADA') reservado = '';
    var a = art[codigo] || {};
    return {
      id_serie: k, serie_original: serieOrig || k, serie_normalizada: k, serie_madre: rel[k] || '', codigo: codigo,
      familia: a.familia || U.familiaCodigo(codigo).familia, descripcion: a.descripcion_original || st.descripcion || '',
      hilos: st.hilos || a.hilos || '', span: st.span || a.span || '', metraje_inicial: inicial,
      total_ingresado: t.ingresado, total_despachado: t.despachado, total_devuelto: t.devuelto, total_prestado: t.prestado,
      total_dev_prestamo: t.dev_prestamo, total_baja: t.baja, total_corte: t.corte, total_ajuste: t.ajuste,
      consumo_calculado: U.round(t.despachado - t.devuelto, 2), saldo_actual: saldo, estado_actual: e,
      bodega_actual: bodega, ubicacion_actual: ubic, reservado_para: reservado, fecha_ultimo_mov: ultimo,
      num_movimientos: all.length, nivel_confiabilidad: conf, estado_saldo: estadoSaldo,
      estado_conciliacion: oa.conc ? 'PENDIENTE' : 'CONCILIADA', alertas_abiertas: oa.n
    };
  }).sort(function (a, b) { return a.id_serie < b.id_serie ? -1 : 1; });
};

/** Estado calculado de cada préstamo (respeta estados manuales PERDIDO / CONSUMIDO_EN_OBRA). */
FS.computeLoans = function (prestamos, movs, today) {
  var U = FS.util, byLink = {};
  (movs || []).filter(FS.isMovVigente).forEach(function (m) {
    if (m.tipo === 'DEVOLUCION_DE_PRESTAMO' && m.id_vinculado) (byLink[m.id_vinculado] = byLink[m.id_vinculado] || []).push(m);
  });
  return (prestamos || []).map(function (p) {
    var q = {}; Object.keys(p).forEach(function (k) { q[k] = p[k]; });
    var devs = byLink[p.id_mov_prestamo] || [];
    if (devs.length) {
      q.metraje_devuelto = devs.reduce(function (a, m) { return a + U.num(m.metraje); }, 0);
      q.fecha_devolucion = devs[devs.length - 1].fecha; q.id_mov_devolucion = devs[devs.length - 1].id_movimiento;
    }
    var dev = U.num(q.metraje_devuelto), pr = U.num(q.metraje_prestado);
    q.diferencia = q.metraje_devuelto === '' ? '' : pr - dev;
    if (q.estado_manual) q.estado = q.estado_manual;
    else if (dev > 0 && dev >= pr) q.estado = 'DEVUELTO_COMPLETO';
    else if (dev > 0) q.estado = 'DEVUELTO_PARCIAL';
    else if (!q.fecha_limite || !q.responsable) q.estado = 'PENDIENTE_DE_CONCILIACION';
    else if (q.fecha_limite < today) q.estado = 'VENCIDO';
    else q.estado = 'ACTIVO';
    return q;
  });
};

/** Alertas que dependen del estado actual (se recalculan; conservan su estado si ya existían). */
FS.dynamicAlerts = function (data, today, params) {
  var U = FS.util, out = [], umbral = +params.UMBRAL_SALDO_BAJO_M || 300, aviso = +params.DIAS_AVISO_PRESTAMO || 3;
  function add(tipo, o) { o.dinamica = true; o.creada_en = today; out.push(FS.mkAlert(tipo, o)); }
  var bajas = {};
  (data.movimientos || []).filter(FS.isMovVigente).forEach(function (m) { if (m.tipo === 'BAJA_POR_MAL_ESTADO') bajas[m.id_serie] = 1; });
  (data.series || []).forEach(function (s) {
    if (s.saldo_actual < 0) add('SALDO_NEGATIVO', { id_serie: s.id_serie, campo: 'SALDO', encontrado: s.saldo_actual + ' m', esperado: '>= 0 m', detalle: 'Ingresado ' + s.total_ingresado + ' m, despachado ' + s.total_despachado + ' m, devuelto ' + s.total_devuelto + ' m' });
    if (s.saldo_actual > 0 && s.saldo_actual < umbral && s.estado_actual === 'DISPONIBLE') add('SALDO_BAJO', { id_serie: s.id_serie, campo: 'SALDO', encontrado: s.saldo_actual + ' m', esperado: '>= ' + umbral + ' m' });
    if (bajas[s.id_serie] && s.estado_actual === 'DISPONIBLE' && s.saldo_actual > 0) add('DISPONIBLE_Y_BAJA', { id_serie: s.id_serie, campo: 'ESTADO', encontrado: 'DISPONIBLE con baja registrada', esperado: 'BAJA o saldo 0' });
  });
  var lastMov = {};
  (data.movimientos || []).filter(FS.isMovVigente).forEach(function (m) { if (!lastMov[m.id_serie] || m.fecha >= lastMov[m.id_serie].fecha) lastMov[m.id_serie] = m; });
  (data.prestamos || []).forEach(function (p) {
    var b = { id_serie: p.id_serie, id_movimiento: p.id_mov_prestamo, claveExtra: p.id_prestamo };
    var abierto = ['ACTIVO', 'VENCIDO', 'PENDIENTE_DE_CONCILIACION'].indexOf(p.estado) >= 0;
    if (abierto && !p.fecha_limite) add('PRESTAMO_SIN_FECHA_LIMITE', mixin(b, { campo: 'FECHA LIMITE', encontrado: '(vacío)', esperado: 'Fecha límite', detalle: 'Préstamo ' + p.id_prestamo + ' de ' + p.metraje_prestado + ' m' }));
    if (abierto && !p.responsable) add('PRESTADA_SIN_RESPONSABLE', mixin(b, { campo: 'RESPONSABLE', encontrado: '(vacío)', esperado: 'Responsable' }));
    if (p.estado === 'VENCIDO') add('PRESTAMO_VENCIDO', mixin(b, { campo: 'FECHA LIMITE', encontrado: p.fecha_limite, esperado: 'Devolución antes de ' + p.fecha_limite, detalle: U.diffDays(today, p.fecha_limite) + ' días de retraso — ' + p.responsable }));
    if (p.estado === 'ACTIVO' && p.fecha_limite && U.diffDays(p.fecha_limite, today) <= aviso) add('PRESTAMO_POR_VENCER', mixin(b, { campo: 'FECHA LIMITE', encontrado: p.fecha_limite, esperado: 'Vence en ' + U.diffDays(p.fecha_limite, today) + ' días' }));
    if ((p.estado === 'DEVUELTO_PARCIAL') && U.num(p.diferencia) > 0) add('PRESTAMO_DIFERENCIA', mixin(b, { campo: 'METRAJE', encontrado: p.metraje_devuelto + ' m devueltos', esperado: p.metraje_prestado + ' m prestados', detalle: 'Diferencia ' + p.diferencia + ' m' }));
    var lm = lastMov[p.id_serie];
    if (abierto && lm && lm.fecha > p.fecha_prestamo && lm.estado_resultante === 'DISPONIBLE' && lm.tipo !== 'DEVOLUCION_DE_PRESTAMO')
      add('PRESTADA_REAPARECE_DISPONIBLE', mixin(b, { campo: 'ESTADO', encontrado: 'DISPONIBLE el ' + lm.fecha, esperado: 'Devolución de préstamo documentada' }));
  });
  return out;
  function mixin(a, c) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in c) o[k] = c[k]; return o; }
};

/** Fusiona alertas dinámicas con las existentes. Devuelve {nuevas, autoResueltas(claves)} */
FS.mergeDynamicAlerts = function (existing, dyn) {
  var byKey = {}, dynKeys = {};
  existing.forEach(function (a) { byKey[a.clave] = a; });
  var nuevas = dyn.filter(function (a) { dynKeys[a.clave] = 1; var e = byKey[a.clave]; return !e || e.estado === 'RESUELTA_AUTO'; });
  var auto = existing.filter(function (a) { return a.dinamica === 'SI' && (a.estado === 'ABIERTA' || a.estado === 'EN_REVISION') && !dynKeys[a.clave]; })
    .map(function (a) { return a.clave; });
  return { nuevas: nuevas, autoResueltas: auto };
};

/* ================================================================== */
/*  CONSUMO, DASHBOARD, HISTORIAL FIBRA, REPORTES, PROYECCIÓN          */
/* ================================================================== */
/** Consumo efectivo por despacho = despachado − devoluciones vinculadas (se imputa a la fecha del despacho). */
FS.consumptionLines = function (movs) {
  var U = FS.util, vig = movs.filter(FS.isMovVigente), ret = {};
  vig.forEach(function (m) { if ((m.tipo === 'DEVOLUCION' || m.tipo === 'SOBRANTE_DE_OBRA') && m.id_vinculado) ret[m.id_vinculado] = (ret[m.id_vinculado] || 0) + U.num(m.metraje); });
  return vig.filter(function (m) { return m.tipo === 'DESPACHO'; }).map(function (m) {
    var dv = ret[m.id_movimiento] || 0;
    return { id_movimiento: m.id_movimiento, id_serie: m.id_serie, fecha: m.fecha, mes: (m.fecha || '').slice(0, 7), anio: (m.fecha || '').slice(0, 4),
      despachado: U.num(m.metraje), devuelto: dv, consumo: U.num(m.metraje) - dv, departamento: m.departamento || '(sin dato)',
      contratista: m.contratista || '(sin dato)', ruta: m.proyecto_ruta || '(sin dato)', documento: m.documento, bodega: m.bodega_origen };
  });
};

FS.applySeriesFilters = function (series, f) {
  var U = FS.util; f = f || {};
  return series.filter(function (s) {
    if (f.bodega && s.bodega_actual !== f.bodega) return false;
    if (f.codigo && U.key(s.codigo).indexOf(U.key(f.codigo)) < 0 && U.key(s.familia).indexOf(U.key(f.codigo)) < 0) return false;
    if (f.descripcion && U.key(s.descripcion).indexOf(U.key(f.descripcion)) < 0) return false;
    if (f.hilos && +s.hilos !== +f.hilos) return false;
    if (f.span && +s.span !== +f.span) return false;
    if (f.estado && s.estado_actual !== f.estado) return false;
    return true;
  });
};

/** Orden de toda consulta de stock: primero las filas en estado DISPONIBLE; el resto conserva su orden. */
FS.disponiblesPrimero = function (rows, campo) {
  campo = campo || 'estado_actual';
  var disp = function (r) { return r[campo] === 'DISPONIBLE'; };
  return rows.filter(disp).concat(rows.filter(function (r) { return !disp(r); }));
};

/** Por serie, el último movimiento vigente que fijó su estado (de él salen el departamento y la ruta de una reserva). */
FS.ultimoMovEstado = function (movs) {
  var out = {};
  movs.filter(FS.isMovVigente).forEach(function (m) {
    if (!m.estado_resultante) return;
    var prev = out[m.id_serie];
    if (!prev || m.fecha > prev.fecha || (m.fecha === prev.fecha && m.id_movimiento > prev.id_movimiento)) out[m.id_serie] = m;
  });
  return out;
};

FS.dashboard = function (data, f, today, params) {
  var U = FS.util; f = f || {};
  var series = FS.applySeriesFilters(data.series || [], f), ids = {};
  series.forEach(function (s) { ids[s.id_serie] = s; });
  var desde = f.desde || '0000-00-00', hasta = f.hasta || '9999-99-99';
  // Filtros de destino (departamento, contratista, ruta): aplican a todo lo que tiene destino (movimientos, préstamos, reservas).
  var destinoOk = function (dep, con, ruta) {
    if (f.departamento && dep !== f.departamento) return false;
    if (f.contratista && con !== f.contratista) return false;
    if (f.ruta && U.key(ruta).indexOf(U.key(f.ruta)) < 0) return false;
    return true;
  };
  var movs = (data.movimientos || []).filter(function (m) {
    if (!ids[m.id_serie] || !FS.isMovVigente(m)) return false;
    if (m.fecha < desde || m.fecha > hasta) return false;
    return destinoOk(m.departamento, m.contratista, m.proyecto_ruta);
  });
  var movIds = {}; movs.forEach(function (m) { movIds[m.id_movimiento] = 1; });
  var cons = FS.consumptionLines(data.movimientos || []).filter(function (c) { return movIds[c.id_movimiento]; });
  var sum = function (arr, fn) { return arr.reduce(function (a, x) { return a + fn(x); }, 0); };
  var pos = function (s) { return Math.max(0, s.saldo_actual); };
  var disp = series.filter(function (s) { return s.estado_actual === 'DISPONIBLE' && s.saldo_actual > 0; });
  var confirmado = function (s) { return s.estado_saldo === 'COMPLETO' || s.estado_saldo === 'ESTIMADO'; };
  var dispOk = disp.filter(confirmado), dispPend = disp.filter(function (s) { return !confirmado(s); });
  var split = function (fn, n) {
    var a = U.groupSum(dispOk, fn, pos), b = U.groupSum(dispPend, fn, pos), keys = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) { keys[k] = 1; });
    return Object.keys(keys).map(function (k) { return { k: k, v: U.round(a[k] || 0, 1), p: U.round(b[k] || 0, 1) }; })
      .sort(function (x, y) { return (y.v + y.p) - (x.v + x.p); }).slice(0, n || 9999);
  };
  var loans = (data.prestamos || []).filter(function (p) { return ids[p.id_serie] && destinoOk(p.departamento, p.contratista, p.proyecto); });
  var umbral = +params.UMBRAL_SALDO_BAJO_M || 300;
  var despachos = movs.filter(function (m) { return m.tipo === 'DESPACHO'; });
  var devoluciones = movs.filter(function (m) { return ['DEVOLUCION', 'DEVOLUCION_DE_PRESTAMO', 'SOBRANTE_DE_OBRA'].indexOf(m.tipo) >= 0; });
  var prestamosPendientes = loans.filter(function (p) { return ['ACTIVO', 'VENCIDO', 'PENDIENTE_DE_CONCILIACION', 'DEVUELTO_PARCIAL'].indexOf(p.estado) >= 0; });
  var malEstado = series.filter(function (s) { return s.estado_actual === 'MAL_ESTADO'; });
  var activos = series.filter(function (s) { return s.saldo_actual > 0; });
  var negativos = series.filter(function (s) { return s.saldo_actual < 0; });
  var porConciliar = series.filter(function (s) { return s.estado_conciliacion === 'PENDIENTE'; });
  var vencidos = loans.filter(function (p) { return p.estado === 'VENCIDO'; });
  var sinFecha = loans.filter(function (p) { return p.estado === 'PENDIENTE_DE_CONCILIACION'; });
  var saldoBajo = disp.filter(function (s) { return s.saldo_actual < umbral; });
  var reservaMovs = FS.ultimoMovEstado(data.movimientos || []);
  var reservadasDestino = series.filter(function (s) {
    var m = reservaMovs[s.id_serie] || {};
    return s.estado_actual === 'RESERVADA' && destinoOk(m.departamento, m.contratista, m.proyecto_ruta);
  });
  var reservas = reservadasDestino.filter(function (s) { return s.saldo_actual > 0; }).map(function (s) {
    var m = reservaMovs[s.id_serie] || {};
    return { departamento: m.departamento || '', codigo: s.codigo, descripcion: s.descripcion, serie: s.id_serie,
      cantidad: s.saldo_actual, ruta: m.proyecto_ruta || '' };
  });
  var kpi = {
    metros_disponibles: sum(dispOk, pos),
    metros_disponibles_por_conciliar: sum(dispPend, pos),
    metros_despachados: sum(despachos, function (m) { return U.num(m.metraje); }),
    metros_devueltos: sum(devoluciones, function (m) { return U.num(m.metraje); }),
    metros_prestados: sum(prestamosPendientes, function (p) { return U.num(p.metraje_prestado) - U.num(p.metraje_devuelto); }),
    metros_mal_estado: sum(malEstado, pos),
    metros_reservados: sum(reservadasDestino, pos),
    metros_en_conciliacion: sum(series.filter(function (s) { return s.estado_saldo === 'PENDIENTE_CONCILIACION' && s.saldo_actual > 0; }), pos),
    rollos_activos: activos.length,
    series_saldo_negativo: negativos.length,
    series_pendientes_conciliacion: porConciliar.length,
    prestamos_vencidos: vencidos.length,
    prestamos_sin_fecha: sinFecha.length,
    rollos_saldo_bajo: saldoBajo.length,
    total_series: series.length
  };
  var detalleSerie = function (s) {
    return { bodega: s.bodega_actual, codigo: s.codigo, descripcion: s.descripcion, serie: s.id_serie,
      cantidad: s.saldo_actual, estado: s.estado_actual, tipo_saldo: s.estado_saldo, alertas: s.alertas_abiertas };
  };
  var detalleMovimiento = function (m) {
    var s = ids[m.id_serie] || {};
    return { fecha: m.fecha, tipo: String(m.tipo || '').replace(/_/g, ' '), serie: m.id_serie,
      codigo: m.codigo || s.codigo, descripcion: s.descripcion || '', cantidad: U.num(m.metraje), departamento: m.departamento || '',
      contratista: m.contratista || '', ruta: m.proyecto_ruta || '', documento: m.documento || '' };
  };
  var detallePrestamo = function (p) {
    var s = ids[p.id_serie] || {};
    return { prestamo: p.id_prestamo, serie: p.id_serie, codigo: s.codigo || '', descripcion: s.descripcion || '',
      responsable: p.responsable || '', departamento: p.departamento || '', ruta: p.proyecto || '',
      prestado: U.num(p.metraje_prestado), devuelto: U.num(p.metraje_devuelto), pendiente: U.num(p.metraje_prestado) - U.num(p.metraje_devuelto),
      fecha_prestamo: p.fecha_prestamo || '', fecha_limite: p.fecha_limite || '', estado: p.estado || '' };
  };
  var detalles = {
    disponible_confirmado: dispOk.map(detalleSerie), disponible_conciliar: dispPend.map(detalleSerie),
    despachado_periodo: despachos.map(detalleMovimiento), devuelto_periodo: devoluciones.map(detalleMovimiento),
    prestado_pendiente: prestamosPendientes.map(detallePrestamo), reservado: reservas,
    mal_estado: malEstado.map(detalleSerie), rollos_activos: activos.map(detalleSerie), series_negativas: negativos.map(detalleSerie),
    series_conciliar: porConciliar.map(detalleSerie), prestamos_vencidos: vencidos.map(detallePrestamo),
    prestamos_sin_fecha: sinFecha.map(detallePrestamo), saldo_bajo: saldoBajo.map(detalleSerie)
  };
  var hilosBucket = function (s) { var h = +s.hilos; return FS.HILOS_STD.indexOf(h) >= 0 ? h + 'H' : (h ? h + 'H' : 'S/D'); };
  var meses = {};
  movs.forEach(function (m) {
    var k = (m.fecha || '').slice(0, 7); if (!k) return; var o = meses[k] = meses[k] || { despachos: 0, devoluciones: 0, consumo: 0 };
    if (m.tipo === 'DESPACHO') o.despachos += U.num(m.metraje);
    if (['DEVOLUCION', 'DEVOLUCION_DE_PRESTAMO', 'SOBRANTE_DE_OBRA'].indexOf(m.tipo) >= 0) o.devoluciones += U.num(m.metraje);
  });
  cons.forEach(function (c) { if (meses[c.mes]) meses[c.mes].consumo += c.consumo; });
  return {
    kpi: kpi,
    reservas: reservas,
    detalles: detalles,
    stock_bodega: split(function (s) { return s.bodega_actual; }),
    stock_hilos: split(hilosBucket),
    stock_codigo: split(function (s) { return s.codigo; }, 15),
    stock_estado: FS.disponiblesPrimero(U.topN(U.groupSum(series.filter(function (s) { return s.saldo_actual !== 0; }), function (s) { return s.estado_actual; }, function (s) { return s.saldo_actual; })), 'k'),
    tendencia: Object.keys(meses).sort().map(function (k) { return { mes: k, despachos: meses[k].despachos, devoluciones: meses[k].devoluciones, consumo: meses[k].consumo }; }),
    consumo_departamento: U.topN(U.groupSum(cons, function (c) { return c.departamento; }, function (c) { return c.consumo; }), 10),
    consumo_contratista: U.topN(U.groupSum(cons, function (c) { return c.contratista; }, function (c) { return c.consumo; }), 10),
    top_proyectos: U.topN(U.groupSum(cons, function (c) { return c.ruta; }, function (c) { return c.consumo; }), 10),
    mal_estado: series.filter(function (s) { return s.estado_actual === 'MAL_ESTADO'; }).map(pick),
    saldo_bajo: disp.filter(function (s) { return s.saldo_actual < umbral; }).sort(function (a, b) { return a.saldo_actual - b.saldo_actual; }).map(pick),
    negativos: series.filter(function (s) { return s.saldo_actual < 0; }).map(pick)
  };
  function pick(s) { return { serie: s.id_serie, codigo: s.codigo, hilos: s.hilos, bodega: s.bodega_actual, saldo: s.saldo_actual, estado: s.estado_actual }; }
};

FS.rollLife = function (data, serieId) {
  var U = FS.util, s = (data.series || []).filter(function (x) { return x.id_serie === serieId; })[0];
  if (!s) return null;
  var famRoot = s.serie_madre || U.serieRaiz(serieId);
  var movs = (data.movimientos || []).filter(function (m) { return m.id_serie === serieId; })
    .sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.id_movimiento < b.id_movimiento ? -1 : 1); });
  var saldo = 0;
  var timeline = movs.map(function (m) {
    var vig = FS.isMovVigente(m), g = (FS.TIPOS_MOV[m.tipo] || {}).grupo, mt = U.num(m.metraje), d = 0;
    if (vig) {
      if (['ingresado', 'devuelto', 'dev_prestamo'].indexOf(g) >= 0) d = mt;
      else if (['despachado', 'prestado', 'baja'].indexOf(g) >= 0) d = -mt;
      else if (g === 'corte' || g === 'ajuste') d = U.num(m.signo) * mt;
    }
    saldo += d;
    var o = {}; Object.keys(m).forEach(function (k) { o[k] = m[k]; }); o.delta = d; o.saldo_despues = U.round(saldo, 2); o.vigente = vig;
    return o;
  });
  var cons = FS.consumptionLines(movs);
  return {
    serie: s, timeline: timeline,
    consumo_por_despacho: cons,
    rutas: uniq(movs.map(function (m) { return m.proyecto_ruta; })),
    documentos: uniq(movs.map(function (m) { return m.documento; }).concat(movs.map(function (m) { return m.documento_ref; }))),
    observaciones: uniq(movs.map(function (m) { return m.observacion_original; })),
    alertas: (data.alertas || []).filter(function (a) { return a.id_serie === serieId; }),
    prestamos: (data.prestamos || []).filter(function (p) { return p.id_serie === serieId; }),
    sobrantes: (data.sobrantes || []).filter(function (p) { return p.id_serie === serieId; }),
    familia: FS.disponiblesPrimero((data.series || []).filter(function (x) { return x.id_serie !== serieId && (U.serieRaiz(x.id_serie) === famRoot || x.serie_madre === serieId || x.serie_madre === famRoot); }))
      .map(function (x) { return { serie: x.id_serie, saldo: x.saldo_actual, estado: x.estado_actual, madre: x.serie_madre }; }),
    relaciones: (data.relaciones || []).filter(function (r) { return r.serie === serieId || r.serie_madre === serieId; }),
    origen_matriz: (data.staging || []).filter(function (r) { return r.serie_normalizada === serieId; })
  };
  function uniq(a) { var o = {}; return a.filter(function (x) { if (!x || o[x]) return false; o[x] = 1; return true; }); }
};

FS.searchSeries = function (data, q) {
  var U = FS.util, k = U.key(q); if (!k) return [];
  var bySerieMov = {};
  (data.movimientos || []).forEach(function (m) {
    var t = U.key([m.documento, m.documento_ref, m.proyecto_ruta, m.contratista, m.contratista_original, m.responsable].join(' '));
    if (t.indexOf(k) >= 0) bySerieMov[m.id_serie] = 1;
  });
  return FS.disponiblesPrimero((data.series || []).filter(function (s) {
    return bySerieMov[s.id_serie] || U.key([s.id_serie, s.serie_original, s.codigo, s.descripcion, s.hilos + 'H', s.bodega_actual].join(' ')).indexOf(k) >= 0;
  })).slice(0, 200);
};

FS.report = function (data, tipo, f, today, params) {
  var U = FS.util, series = FS.applySeriesFilters(data.series || [], f || {}), pos = function (s) { return Math.max(0, s.saldo_actual); };
  var cons = FS.consumptionLines(data.movimientos || []).filter(function (c) { return (!f || !f.desde || c.fecha >= f.desde) && (!f || !f.hasta || c.fecha <= f.hasta); });
  function table(obj, label) { return U.topN(obj).map(function (r) { var o = {}; o[label] = r.k; o.metros = r.v; return o; }); }
  if (tipo === 'inventario') {
    var by = function (fn) {
      var o = {};
      series.forEach(function (s) {
        var k = fn(s) || '(sin dato)', r = o[k] = o[k] || { grupo: k, rollos: 0, disponible: 0, reservado: 0, prestado: 0, mal_estado: 0, en_conciliacion: 0, negativo: 0 };
        if (s.saldo_actual > 0) r.rollos++;
        if (s.estado_actual === 'DISPONIBLE') r.disponible += pos(s);
        if (s.estado_actual === 'RESERVADA') r.reservado += pos(s);
        if (s.estado_actual === 'MAL_ESTADO') r.mal_estado += pos(s);
        if (s.estado_saldo === 'PENDIENTE_CONCILIACION') r.en_conciliacion += pos(s);
        if (U.num(s.saldo_actual) < 0) r.negativo += U.num(s.saldo_actual);
        r.prestado += U.num(s.total_prestado) - U.num(s.total_dev_prestamo);
      });
      return Object.keys(o).sort().map(function (k) { var r = o[k]; r.comprometido = r.reservado + r.prestado; return r; });
    };
    return { secciones: [
      { titulo: 'Stock por bodega', filas: by(function (s) { return s.bodega_actual; }) },
      { titulo: 'Stock por código', filas: by(function (s) { return s.codigo; }) },
      { titulo: 'Stock por estado', filas: FS.disponiblesPrimero(by(function (s) { return s.estado_actual; }), 'grupo') },
      { titulo: 'Stock por serie', filas: FS.disponiblesPrimero(series).map(function (s) { return { serie: s.id_serie, codigo: s.codigo, hilos: s.hilos, span: s.span, bodega: s.bodega_actual, estado: s.estado_actual, saldo: s.saldo_actual, estado_saldo: s.estado_saldo, confiabilidad: s.nivel_confiabilidad, ultimo_mov: s.fecha_ultimo_mov }; }) }
    ] };
  }
  if (tipo === 'consumo') {
    var hil = {}; series.forEach(function (s) { hil[s.id_serie] = s.hilos ? s.hilos + 'H' : 'S/D'; });
    var c2 = cons.filter(function (c) { return hil[c.id_serie]; });
    return { secciones: [
      { titulo: 'Consumo efectivo por mes (despachado − devuelto)', filas: Object.keys(U.groupSum(c2, function (c) { return c.mes; }, function () { return 0; })).sort().map(function (k) {
        var r = c2.filter(function (c) { return c.mes === k; }); return { mes: k, despachado: sum(r, 'despachado'), devuelto: sum(r, 'devuelto'), consumo: sum(r, 'consumo') }; }) },
      { titulo: 'Consumo por año', filas: table(U.groupSum(c2, function (c) { return c.anio; }, function (c) { return c.consumo; }), 'anio') },
      { titulo: 'Consumo por número de hilos', filas: table(U.groupSum(c2, function (c) { return hil[c.id_serie]; }, function (c) { return c.consumo; }), 'hilos') },
      { titulo: 'Consumo por departamento', filas: table(U.groupSum(c2, function (c) { return c.departamento; }, function (c) { return c.consumo; }), 'departamento') },
      { titulo: 'Consumo por contratista', filas: table(U.groupSum(c2, function (c) { return c.contratista; }, function (c) { return c.consumo; }), 'contratista') },
      { titulo: 'Consumo por ruta / proyecto', filas: table(U.groupSum(c2, function (c) { return c.ruta; }, function (c) { return c.consumo; }), 'ruta') }
    ] };
  }
  if (tipo === 'excepciones') {
    var open = (data.alertas || []).filter(function (a) { return a.estado === 'ABIERTA' || a.estado === 'EN_REVISION'; });
    var grupos = [['Saldos negativos', ['SALDO_NEGATIVO']], ['Salidas sin ingreso', ['SALIDA_SIN_INGRESO']], ['Salidas superiores al ingreso', ['SALIDA_MAYOR_INGRESO']],
      ['Devoluciones superiores al despacho', ['DEVOLUCION_MAYOR_DESPACHO']], ['Documentos de despacho duplicados', ['DOC_DESPACHO_DUPLICADO']],
      ['Series posiblemente duplicadas', ['DUPLICADO_ACCIDENTAL', 'POSIBLE_DUPLICADO']], ['Estados contradictorios', ['ESTADO_DESPACHADA_SIN_SALIDA', 'ESTADO_NO_COINCIDE', 'DISPONIBLE_Y_BAJA', 'REAPARICION_CON_SALDO', 'SERIE_EN_DOS_BODEGAS']],
      ['Fechas inválidas', ['FECHA_INVALIDA', 'FECHA_FUTURA', 'CERTIFICACION_FUTURA']], ['Metrajes ambiguos', ['METRAJE_AMBIGUO', 'METRAJE_TEXTO']],
      ['Préstamos vencidos / sin fecha', ['PRESTAMO_VENCIDO', 'PRESTAMO_SIN_FECHA_LIMITE', 'PRESTADA_SIN_RESPONSABLE']], ['Sobrantes sin cuantificar', ['SOBRANTE_SIN_CANTIDAD']],
      ['Rollos con saldo bajo', ['SALDO_BAJO']]];
    return { secciones: grupos.map(function (g) {
      return { titulo: g[0], filas: open.filter(function (a) { return g[1].indexOf(a.tipo) >= 0; }).map(function (a) { return { serie: a.id_serie, tipo: a.tipo, severidad: a.severidad, fila: a.fila_origen, campo: a.campo, encontrado: a.valor_encontrado, esperado: a.valor_esperado, estado: a.estado }; }) };
    }) };
  }
  if (tipo === 'no_utilizable') {
    return { secciones: [{ titulo: 'Material no utilizable', filas: series.filter(function (s) { return s.estado_actual === 'MAL_ESTADO' || s.estado_actual === 'BAJA'; }).map(function (s) {
      var mov = (data.movimientos || []).filter(function (m) { return m.id_serie === s.id_serie && (m.estado_resultante === 'MAL_ESTADO' || m.tipo === 'BAJA_POR_MAL_ESTADO'); }).pop() || {};
      var accion = s.estado_actual === 'BAJA' ? 'BAJA (ejecutada)' : s.saldo_actual >= 1500 ? 'INSPECCIÓN / REPARACIÓN (rollo largo)' : s.saldo_actual >= 300 ? 'INSPECCIÓN' : 'BAJA';
      return { serie: s.id_serie, codigo: s.codigo, descripcion: s.descripcion, bodega: s.bodega_actual, metraje: s.saldo_actual, estado: s.estado_actual,
        motivo: mov.proyecto_ruta || mov.observacion_original || '', fecha_identificacion: mov.fecha || '', responsable: mov.usuario || '', accion_recomendada: accion };
    }) }] };
  }
  return { secciones: [] };
  function sum(arr, k) { return arr.reduce(function (a, x) { return a + x[k]; }, 0); }
};

/** Proyección de abastecimiento por familia de artículo. Solo recomienda; nunca genera órdenes. */
FS.projection = function (data, params, today) {
  var U = FS.util, P = {};
  (data.abastecimiento || []).forEach(function (r) { P[r.familia] = r; });
  var fams = {};
  (data.series || []).forEach(function (s) {
    var f = fams[s.familia] = fams[s.familia] || { familia: s.familia, descripcion: s.descripcion, hilos: s.hilos, disponible: 0, comprometido: 0, series: {} };
    f.series[s.id_serie] = 1;
    if (s.estado_actual === 'DISPONIBLE' && s.saldo_actual > 0) f.disponible += s.saldo_actual;
    if (s.estado_actual === 'RESERVADA' && s.saldo_actual > 0) f.comprometido += s.saldo_actual;
  });
  var serieFam = {}; (data.series || []).forEach(function (s) { serieFam[s.id_serie] = s.familia; });
  var cons = FS.consumptionLines(data.movimientos || []);
  function monthsBack(n) { var d = today.slice(0, 7), out = []; var y = +d.slice(0, 4), m = +d.slice(5, 7); for (var i = 1; i <= n; i++) { m--; if (m === 0) { m = 12; y--; } out.push(y + '-' + U.pad(m, 2)); } return out; }
  var m3 = monthsBack(3), m6 = monthsBack(6), m12 = monthsBack(12);
  return Object.keys(fams).map(function (k) {
    var f = fams[k], p = P[k] || {}, lines = cons.filter(function (c) { return serieFam[c.id_serie] === k; });
    var porMes = U.groupSum(lines, function (c) { return c.mes; }, function (c) { return c.consumo; });
    var avg = function (ms) { return ms.reduce(function (a, mm) { return a + (porMes[mm] || 0); }, 0) / ms.length; };
    var mesesCon = Object.keys(porMes).filter(function (x) { return x >= m12[11]; });
    var promMensual = avg(m12), prom3 = avg(m3), prom6 = avg(m6);
    var factor = U.num(p.factor_temporada) || 1;
    var base = prom3 || prom6 || promMensual;
    var diario = base / 30 * factor;
    var lead = U.num(p.lead_time_dias) || +params.LEAD_TIME_DEFECTO || 45, seg = U.num(p.dias_seguridad) || +params.DIAS_SEGURIDAD_DEFECTO || 15;
    var cob = +params.DIAS_COBERTURA_OBJETIVO || 60, smin = U.num(p.stock_minimo);
    var neto = f.disponible - 0; // el disponible ya excluye reservado
    var dias = diario > 0 ? neto / diario : null;
    var reorden = diario * (lead + seg) + smin;
    var sugerida = Math.max(0, reorden + diario * cob - neto);
    return { familia: k, descripcion: f.descripcion, hilos: f.hilos, rollos: Object.keys(f.series).length,
      consumo_prom_mensual_12m: U.round(promMensual), consumo_prom_3m: U.round(prom3), consumo_prom_6m: U.round(prom6),
      meses_con_consumo: mesesCon.length, consumo_diario: U.round(diario, 1), stock_disponible: f.disponible, stock_comprometido: f.comprometido,
      stock_minimo: smin, lead_time_dias: lead, dias_seguridad: seg, factor_temporada: factor, prioridad: p.prioridad || '',
      dias_cobertura: dias === null ? null : U.round(dias), fecha_agotamiento: dias === null ? '' : U.addDays(today, Math.floor(dias)),
      punto_reorden: U.round(reorden), cantidad_sugerida: U.round(Math.ceil(sugerida / 100) * 100),
      bajo_reorden: neto <= reorden && diario > 0, estado_recomendacion: 'REQUIERE_APROBACION' };
  }).sort(function (a, b) { return (a.dias_cobertura === null ? 1e9 : a.dias_cobertura) - (b.dias_cobertura === null ? 1e9 : b.dias_cobertura); });
};

/** Parser CSV (RFC 4180: comillas, saltos de línea dentro de comillas). Devuelve array de objetos. */
FS.parseCSV = function (text) {
  var rows = [], row = [], field = '', q = false, i, c;
  text = String(text).replace(/^﻿/, '');
  for (i = 0; i < text.length; i++) {
    c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  var head = rows.shift() || [];
  return rows.filter(function (r) { return r.some(function (v) { return v !== ''; }); }).map(function (r) {
    var o = {}; head.forEach(function (h, j) { o[h] = r[j] === undefined ? '' : r[j]; }); return o;
  });
};
