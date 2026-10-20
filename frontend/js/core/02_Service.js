/**
 * FIBRA STOCK — Capa de servicio (acciones de la API).
 * JavaScript puro: recibe un "store" (Google Sheets en producción, memoria en el modo demo).
 *
 * store: all(tabla) · append(tabla, filas) · update(tabla, campoClave, valor, cambios) · replace(tabla, filas)
 *        nextId(prefijo) · params() · today() · now()
 */
var FS = (typeof FS !== 'undefined') ? FS : {};

FS.Service = function (store, user) {
  var U = FS.util, self = this;
  var today = store.today(), now = store.now();
  var params = store.params();

  function can(perm) { return (FS.ROLES[user.rol] || []).indexOf(perm) >= 0; }
  function need(perm) { if (!can(perm)) throw new Error('Permiso denegado: su rol (' + user.rol + ') no permite esta acción.'); }
  function fail(msg) { throw new Error(msg); }
  function log(accion, tabla, id, campo, antes, despues, detalle) {
    store.append('BITACORA', [{ id: store.nextId('LOG'), fecha_hora: now, usuario: user.email, accion: accion, tabla: tabla,
      id_registro: id || '', campo: campo || '', valor_anterior: stringify(antes), valor_nuevo: stringify(despues), detalle: detalle || '' }]);
  }
  function stringify(v) { if (v === undefined || v === null) return ''; return typeof v === 'object' ? JSON.stringify(v).slice(0, 5000) : String(v); }

  function data(withStaging) {
    var d = {
      articulos: store.all('ARTICULOS'), movimientos: store.all('MOVIMIENTOS'), sobrantes: store.all('SOBRANTES'),
      alertas: store.all('ALERTAS'), relaciones: store.all('RELACIONES'), series: store.all('SERIES'),
      abastecimiento: store.all('ABASTECIMIENTO_PARAM')
    };
    d.prestamos = FS.computeLoans(store.all('PRESTAMOS'), d.movimientos, today);
    if (withStaging) d.staging = store.all('MATRIZ_NORMALIZADA');
    return d;
  }

  /** Recalcula SERIES, estados de préstamos y alertas dinámicas. Se ejecuta tras cada escritura. */
  self.recalc = function () {
    var d = data(true);
    // estados de préstamos
    var prevLoans = {}; store.all('PRESTAMOS').forEach(function (p) { prevLoans[p.id_prestamo] = p; });
    d.prestamos.forEach(function (p) {
      var o = prevLoans[p.id_prestamo];
      if (o && (o.estado !== p.estado || U.str(o.metraje_devuelto) !== U.str(p.metraje_devuelto)))
        store.update('PRESTAMOS', 'id_prestamo', p.id_prestamo, { estado: p.estado, metraje_devuelto: p.metraje_devuelto, diferencia: p.diferencia, fecha_devolucion: p.fecha_devolucion, id_mov_devolucion: p.id_mov_devolucion });
    });
    d.series = FS.computeSeries(d);
    var dyn = FS.dynamicAlerts(d, today, params);
    var mg = FS.mergeDynamicAlerts(d.alertas, dyn);
    mg.nuevas.forEach(function (a) { a.id_alerta = store.nextId('ALE'); a.creada_en = now; });
    if (mg.nuevas.length) store.append('ALERTAS', mg.nuevas);
    mg.autoResueltas.forEach(function (clave) {
      store.update('ALERTAS', 'clave', clave, { estado: 'RESUELTA_AUTO', fecha_resolucion: now, comentario_resolucion: 'La condición ya no se cumple', resuelta_por: 'SISTEMA' });
    });
    d.alertas = store.all('ALERTAS');
    d.series = FS.computeSeries(d);
    store.replace('SERIES', d.series);
    return { series: d.series.length, alertas_nuevas: mg.nuevas.length, alertas_auto_resueltas: mg.autoResueltas.length };
  };

  /* ---------------------------- LECTURA ---------------------------- */
  self.bootstrap = function () {
    need('leer');
    var cats = store.all('CATALOGOS'), arts = store.all('ARTICULOS');
    var vals = function (c) {
      var o = {}; cats.forEach(function (r) { if (U.key(r.catalogo) === c && r.valor_normalizado && U.key(r.activo) !== 'NO' && r.activo !== false) o[r.valor_normalizado] = 1; });
      return Object.keys(o).sort();
    };
    return {
      user: { email: user.email, nombre: user.nombre, rol: user.rol, permisos: FS.ROLES[user.rol] || [] },
      hoy: today, version: FS.VERSION, params: params,
      catalogos: {
        estados: FS.ESTADOS, bodegas: FS.BODEGAS, ubicaciones: FS.UBICACIONES, tipos_movimiento: Object.keys(FS.TIPOS_MOV),
        departamentos: vals('DEPARTAMENTO'), contratistas: vals('CONTRATISTA'), estados_prestamo: FS.ESTADOS_PRESTAMO,
        hilos: FS.HILOS_STD, tipos_alerta: Object.keys(FS.ALERTAS),
        articulos: arts.map(function (a) { return { codigo: a.codigo, familia: a.familia, descripcion: a.descripcion_original, hilos: a.hilos, span: a.span }; })
      }
    };
  };
  self.dashboard = function (p) { need('leer'); return FS.dashboard(data(), p.filtros || {}, today, params); };
  self.inventory = function (p) {
    need('leer'); var f = p.filtros || {}, s = FS.applySeriesFilters(store.all('SERIES'), f);
    if (f.texto) { var k = U.key(f.texto); s = s.filter(function (x) { return U.key([x.id_serie, x.codigo, x.descripcion, x.reservado_para].join(' ')).indexOf(k) >= 0; }); }
    if (f.estado_saldo) s = s.filter(function (x) { return x.estado_saldo === f.estado_saldo; });
    if (f.solo_con_saldo) s = s.filter(function (x) { return +x.saldo_actual !== 0; });
    return { total: s.length, filas: FS.disponiblesPrimero(s) };
  };
  self.searchSeries = function (p) { need('leer'); return FS.searchSeries(data(), p.q); };
  self.rollLife = function (p) {
    need('leer'); var r = FS.rollLife(data(true), U.serieNorm(p.serie));
    if (!r) fail('No existe la serie ' + p.serie + '. Verifique la escritura o búsquela por documento, código o proyecto.');
    return r;
  };
  self.alerts = function (p) {
    need('leer'); var f = p.filtros || {}, a = store.all('ALERTAS');
    if (f.estado) a = a.filter(function (x) { return f.estado === 'ABIERTAS' ? (x.estado === 'ABIERTA' || x.estado === 'EN_REVISION') : x.estado === f.estado; });
    if (f.categoria) a = a.filter(function (x) { return x.categoria === f.categoria; });
    if (f.severidad) a = a.filter(function (x) { return x.severidad === f.severidad; });
    if (f.tipo) a = a.filter(function (x) { return x.tipo === f.tipo; });
    if (f.serie) a = a.filter(function (x) { return U.key(x.id_serie).indexOf(U.key(f.serie)) >= 0; });
    var rank = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAJA: 3, INFO: 4 };
    a.sort(function (x, y) { return (rank[x.severidad] - rank[y.severidad]) || (x.id_alerta < y.id_alerta ? -1 : 1); });
    return { total: a.length, filas: a.slice(0, f.limite || 1000) };
  };
  self.loans = function () { need('leer'); return FS.computeLoans(store.all('PRESTAMOS'), store.all('MOVIMIENTOS'), today); };
  self.surpluses = function () { need('leer'); return store.all('SOBRANTES'); };
  self.report = function (p) { need('reportes'); return FS.report(data(), p.tipo, p.filtros || {}, today, params); };
  self.projection = function () { need('leer'); return FS.projection(data(), params, today); };
  self.audit = function (p) {
    need('bitacora'); var f = p.filtros || {}, b = store.all('BITACORA');
    if (f.usuario) b = b.filter(function (x) { return U.key(x.usuario).indexOf(U.key(f.usuario)) >= 0; });
    if (f.texto) b = b.filter(function (x) { return U.key([x.accion, x.id_registro, x.detalle, x.valor_nuevo].join(' ')).indexOf(U.key(f.texto)) >= 0; });
    return b.slice(-500).reverse();
  };
  self.pendingApprovals = function () { need('leer'); return store.all('MOVIMIENTOS').filter(function (m) { return m.aprobacion === 'PENDIENTE'; }); };
  self.catalogs = function () { need('leer'); return { catalogos: store.all('CATALOGOS'), parametros: store.all('PARAMETROS'), abastecimiento: store.all('ABASTECIMIENTO_PARAM'), articulos: store.all('ARTICULOS') }; };
  self.dispatchesOf = function (p) {
    need('leer'); var k = U.serieNorm(p.serie), movs = store.all('MOVIMIENTOS').filter(function (m) { return m.id_serie === k && FS.isMovVigente(m); });
    return FS.consumptionLines(movs).filter(function (c) { return c.consumo > 0; });
  };

  /* ---------------------------- ESCRITURA ---------------------------- */
  function getSerie(id) { var k = U.serieNorm(id); return store.all('SERIES').filter(function (s) { return s.id_serie === k; })[0]; }
  function vFecha(f) {
    var pf = U.parseFecha(f); if (!pf.valida) fail('Fecha inválida: "' + f + '". Use el selector de fecha.');
    if (pf.iso > today) fail('La fecha ' + pf.iso + ' es posterior a hoy (' + today + ').'); return pf.iso;
  }
  function vMetraje(m) {
    var pm = U.parseMetraje(m); if (pm.value === null || pm.value <= 0) fail('El metraje debe ser un número mayor que cero.');
    if (pm.ambiguo) fail('Metraje ambiguo ("' + m + '"). Ingréselo sin separadores de miles, por ejemplo 3156.');
    return pm.value;
  }
  function vBodega(b, campo) { if (FS.BODEGAS.indexOf(b) < 0) fail((campo || 'Bodega') + ' inválida: ' + b); return b; }
  function normDep(v) { var c = new FS.Catalog(store.all('CATALOGOS')).normalize('DEPARTAMENTO', v); return c; }
  function normCon(v) { var c = new FS.Catalog(store.all('CATALOGOS')).normalize('CONTRATISTA', v); return c; }
  function critical(tipo, s, detalle, enc, esp) {
    var a = FS.mkAlert(tipo, { id_serie: s, campo: 'METRAJE', encontrado: enc, esperado: esp, detalle: detalle + ' (usuario ' + user.email + ')', claveExtra: now, creada_en: now });
    a.id_alerta = store.nextId('ALE'); store.append('ALERTAS', [a]);
  }
  function checkSalida(s, metraje, bodega, tipo) {
    if (!s) fail('La serie no existe. Registre primero su ingreso o inventario de apertura.');
    if (s.bodega_actual && bodega && s.bodega_actual !== bodega) fail('La serie ' + s.id_serie + ' está en ' + s.bodega_actual + ', no en ' + bodega + '. Registre primero el traslado.');
    if (['BAJA', 'AGOTADA'].indexOf(s.estado_actual) >= 0) fail('La serie está en estado ' + s.estado_actual + ' y no admite salidas.');
    if (s.estado_actual === 'MAL_ESTADO' && tipo !== 'BAJA_POR_MAL_ESTADO') fail('La serie está en MAL_ESTADO: solo admite baja o cambio de estado tras inspección.');
    if (+s.saldo_actual < 0) fail('La serie tiene saldo negativo (' + s.saldo_actual + ' m). Concilie antes de registrar nuevas salidas.');
    if (metraje > +s.saldo_actual) {
      critical('INTENTO_SALDO_NEGATIVO', s.id_serie, tipo + ' rechazado', metraje + ' m solicitados', '<= ' + s.saldo_actual + ' m');
      fail('El movimiento dejaría saldo negativo: saldo actual ' + s.saldo_actual + ' m, solicitado ' + metraje + ' m. Se generó una alerta crítica.');
    }
  }
  function duplicateCheck(m, justif) {
    var dups = store.all('MOVIMIENTOS').filter(function (x) {
      return FS.isMovVigente(x) && x.id_serie === m.id_serie && x.tipo === m.tipo && +x.metraje === +m.metraje && U.str(x.documento) === U.str(m.documento) && (x.fecha === m.fecha || (m.tipo === 'DESPACHO' && m.documento));
    });
    if (dups.length && !justif) fail('Ya existe un movimiento ' + m.tipo + ' de ' + m.metraje + ' m con el documento ' + (m.documento || '(vacío)') + ' para esta serie (' + dups[0].id_movimiento + '). Si es correcto, indique una justificación.');
    if (dups.length && justif && m.tipo === 'DESPACHO') critical('DOC_DESPACHO_DUPLICADO', m.id_serie, 'Registrado con justificación: ' + justif, m.documento + ' / ' + m.metraje + ' m', 'Un despacho por documento');
  }
  function baseMov(p, s) {
    var dep = normDep(p.departamento), con = normCon(p.contratista);
    return {
      id_movimiento: store.nextId('MOV'), id_serie: s ? s.id_serie : U.serieNorm(p.serie), codigo: s ? s.codigo : U.key(p.codigo),
      serie_original: s ? s.serie_original : U.str(p.serie).trim(), serie_derivada: '', fecha: vFecha(p.fecha || today),
      tipo: p.tipo, metraje: 0, signo: (FS.TIPOS_MOV[p.tipo] || {}).signo || 0, bodega_origen: '', bodega_destino: '',
      ubicacion: U.key(p.ubicacion || (s && s.ubicacion_actual) || ''), estado_resultante: '', proyecto_ruta: U.str(p.proyecto).trim(),
      departamento_original: U.str(p.departamento), departamento: dep.normalizado || U.key(p.departamento),
      contratista_original: U.str(p.contratista), contratista: con.normalizado || U.key(p.contratista),
      responsable: U.key(p.responsable), documento: U.str(p.documento).trim(), documento_ref: U.str(p.documento_ref).trim(),
      usuario: user.email, creado_en: now, observacion_original: U.str(p.observacion), observacion_normalizada: U.key(p.observacion),
      evidencia_url: U.str(p.evidencia_url), origen: 'APP', fila_origen: '', regla_aplicada: 'REGISTRO_MANUAL', confianza: 'ALTA',
      estado_registro: 'CERRADO', aprobacion: 'NO_REQUIERE', aprobado_por: '', id_vinculado: U.str(p.id_vinculado), _con: con
    };
  }
  function save(movs, accion) {
    movs.forEach(function (m) {
      if (m._con && m.contratista_original && m._con.clase === 'NO_CATALOGADO') {
        var a = FS.mkAlert('CONTRATISTA_NO_REGISTRADO', { id_serie: m.id_serie, id_movimiento: m.id_movimiento, campo: 'CONTRATISTA', encontrado: m.contratista_original, esperado: 'Contratista del catálogo', creada_en: now });
        a.id_alerta = store.nextId('ALE'); store.append('ALERTAS', [a]);
      }
      delete m._con;
    });
    store.append('MOVIMIENTOS', movs);
    movs.forEach(function (m) { log(accion || 'REGISTRAR_MOVIMIENTO', 'MOVIMIENTOS', m.id_movimiento, '', '', m, m.tipo + ' ' + m.metraje + ' m serie ' + m.id_serie); });
    var r = self.recalc();
    return { ok: true, movimientos: movs.map(function (m) { return m.id_movimiento; }), serie: getSerie(movs[0].id_serie), recalculo: r };
  }

  /** Ingresos, despachos, bajas, ajustes y cambios de estado. */
  self.registerMovement = function (p) {
    need('registrar');
    var t = p.tipo, def = FS.TIPOS_MOV[t]; if (!def) fail('Tipo de movimiento inválido.');
    if (['DEVOLUCION', 'DEVOLUCION_DE_PRESTAMO', 'PRESTAMO', 'SOBRANTE_DE_OBRA', 'TRASLADO_ENTRE_BODEGAS', 'CORTE_O_FRACCIONAMIENTO'].indexOf(t) >= 0)
      fail('Use la pantalla específica para ' + t + '.');
    if (U.isEmpty(p.serie)) fail('La serie es obligatoria.');
    var s = getSerie(p.serie), m = baseMov(p, s);
    if (t === 'INGRESO_INICIAL' || t === 'INVENTARIO_INICIAL_DE_APERTURA') {
      if (s) fail('La serie ' + s.id_serie + ' ya existe (saldo ' + s.saldo_actual + ' m). Use INGRESO_ADICIONAL, DEVOLUCION o SOBRANTE según corresponda.');
      if (U.isEmpty(p.codigo)) fail('El código de artículo es obligatorio.');
      if (!store.all('ARTICULOS').some(function (a) { return a.codigo === U.key(p.codigo); })) fail('El código ' + p.codigo + ' no existe en el catálogo de artículos.');
      m.metraje = vMetraje(p.metraje); m.bodega_destino = vBodega(p.bodega); m.estado_resultante = p.estado || 'DISPONIBLE';
    } else if (t === 'INGRESO_ADICIONAL') {
      if (!s) fail('La serie no existe; use INGRESO_INICIAL.');
      m.metraje = vMetraje(p.metraje); m.bodega_destino = vBodega(p.bodega || s.bodega_actual); m.estado_resultante = s.estado_actual === 'AGOTADA' ? 'DISPONIBLE' : s.estado_actual;
      if (U.isEmpty(p.observacion)) fail('Explique en observaciones el origen del ingreso adicional.');
    } else if (t === 'DESPACHO') {
      m.metraje = vMetraje(p.metraje); m.bodega_origen = vBodega(p.bodega || (s && s.bodega_actual));
      if (U.isEmpty(p.documento)) fail('El número de documento de despacho es obligatorio.');
      if (U.isEmpty(p.departamento)) fail('El departamento es obligatorio.');
      if (U.isEmpty(p.proyecto)) fail('La ruta o proyecto es obligatorio.');
      if (/STOCK\s*BODEGA/.test(U.key(p.proyecto))) fail('Un despacho no puede tener como ruta "STOCK BODEGA".');
      checkSalida(s, m.metraje, m.bodega_origen, t);
      m.estado_resultante = (s.saldo_actual - m.metraje) > 0 ? (s.estado_actual === 'RESERVADA' ? 'RESERVADA' : 'DISPONIBLE') : 'DESPACHADA';
    } else if (t === 'BAJA_POR_MAL_ESTADO') {
      m.metraje = vMetraje(p.metraje); m.bodega_origen = vBodega(p.bodega || (s && s.bodega_actual));
      if (U.isEmpty(p.observacion)) fail('Indique el motivo de la baja.');
      checkSalida(s, m.metraje, m.bodega_origen, t);
      m.estado_resultante = (s.saldo_actual - m.metraje) > 0 ? 'MAL_ESTADO' : 'BAJA';
      m.aprobacion = 'PENDIENTE'; m.estado_registro = 'ABIERTO';
    } else if (t === 'AJUSTE_MANUAL_AUTORIZADO') {
      if (!s) fail('La serie no existe.');
      var v = +p.metraje; if (!v || isNaN(v)) fail('Indique el ajuste en metros (positivo suma, negativo resta).');
      if (U.isEmpty(p.observacion)) fail('El ajuste requiere justificación en observaciones.');
      m.metraje = Math.abs(v); m.signo = v > 0 ? 1 : -1; m.bodega_destino = s.bodega_actual; m.estado_resultante = s.estado_actual;
      m.aprobacion = 'PENDIENTE'; m.estado_registro = 'ABIERTO';
    } else if (t === 'CAMBIO_DE_ESTADO') {
      if (!s) fail('La serie no existe.');
      if (['DISPONIBLE', 'RESERVADA', 'MAL_ESTADO', 'EN_CONCILIACION'].indexOf(p.estado) < 0) fail('Estado no permitido para cambio manual: ' + p.estado);
      if (p.estado === 'RESERVADA' && U.isEmpty(p.proyecto)) fail('Indique el proyecto para el que se reserva.');
      if (p.estado === 'MAL_ESTADO' && U.isEmpty(p.observacion)) fail('Describa el daño encontrado.');
      m.metraje = 0; m.signo = 0; m.bodega_origen = s.bodega_actual; m.bodega_destino = s.bodega_actual; m.estado_resultante = p.estado;
    }
    duplicateCheck(m, p.justificacion);
    if (p.justificacion) m.observacion_original = (m.observacion_original + ' | JUSTIFICACIÓN: ' + p.justificacion).replace(/^ \| /, '');
    return save([m]);
  };

  /** Devolución relacionada con el despacho original (o sin referencia → conciliación). */
  self.registerReturn = function (p) {
    need('registrar');
    var s = getSerie(p.serie); if (!s) fail('La serie no existe.');
    var m = baseMov(p, s); m.tipo = 'DEVOLUCION'; m.signo = 1; m.metraje = vMetraje(p.metraje);
    m.bodega_destino = vBodega(p.bodega, 'Bodega receptora');
    m.estado_resultante = p.estado_material === 'MAL_ESTADO' ? 'MAL_ESTADO' : 'DISPONIBLE';
    if (U.isEmpty(p.motivo)) fail('Indique el motivo de la devolución.');
    m.observacion_original = 'MOTIVO: ' + p.motivo + (p.observacion ? ' | ' + p.observacion : '');
    var desp = null;
    if (p.id_despacho && p.id_despacho !== 'SIN_REFERENCIA') {
      desp = store.all('MOVIMIENTOS').filter(function (x) { return x.id_movimiento === p.id_despacho && x.tipo === 'DESPACHO' && FS.isMovVigente(x); })[0];
      if (!desp || desp.id_serie !== s.id_serie) fail('El despacho seleccionado no pertenece a esta serie.');
      var ya = store.all('MOVIMIENTOS').filter(function (x) { return x.id_vinculado === desp.id_movimiento && FS.isMovVigente(x) && (x.tipo === 'DEVOLUCION' || x.tipo === 'SOBRANTE_DE_OBRA'); })
        .reduce(function (a, x) { return a + +x.metraje; }, 0);
      var pendiente = +desp.metraje - ya;
      if (m.metraje > pendiente) {
        critical('DEVOLUCION_MAYOR_DESPACHO', s.id_serie, 'Devolución rechazada', m.metraje + ' m', '<= ' + pendiente + ' m pendientes del despacho ' + desp.documento);
        fail('La devolución (' + m.metraje + ' m) supera lo pendiente del despacho ' + desp.documento + ' (' + pendiente + ' m). Se generó una alerta crítica.');
      }
      m.id_vinculado = desp.id_movimiento; m.documento_ref = desp.documento; m.proyecto_ruta = m.proyecto_ruta || desp.proyecto_ruta;
      m.departamento = m.departamento || desp.departamento; m.contratista = m.contratista || desp.contratista;
    }
    var res = save([m], 'REGISTRAR_DEVOLUCION');
    if (!desp) {
      var a = FS.mkAlert('DEVOLUCION_SIN_REFERENCIA', { id_serie: s.id_serie, id_movimiento: m.id_movimiento, campo: 'DOCUMENTO', encontrado: m.metraje + ' m', esperado: 'Despacho relacionado', creada_en: now });
      a.id_alerta = store.nextId('ALE'); store.append('ALERTAS', [a]); self.recalc();
    }
    res.resumen = desp ? { despachado: +desp.metraje, devuelto: m.metraje, consumo_preliminar: +desp.metraje - m.metraje, completa: +desp.metraje === m.metraje } : { devolucion_sin_referencia: true };
    return res;
  };

  self.registerLoan = function (p) {
    need('registrar');
    var s = getSerie(p.serie); if (!s) fail('La serie no existe.');
    if (U.isEmpty(p.responsable)) fail('El responsable del préstamo es obligatorio.');
    if (U.isEmpty(p.fecha_limite)) fail('La fecha límite de devolución es obligatoria.');
    var lim = U.parseFecha(p.fecha_limite); if (!lim.valida) fail('Fecha límite inválida.');
    var m = baseMov(p, s); m.tipo = 'PRESTAMO'; m.signo = -1; m.metraje = vMetraje(p.metraje);
    if (lim.iso < m.fecha) fail('La fecha límite no puede ser anterior a la fecha del préstamo.');
    m.bodega_origen = vBodega(p.bodega || s.bodega_actual);
    checkSalida(s, m.metraje, m.bodega_origen, 'PRESTAMO');
    m.estado_resultante = (s.saldo_actual - m.metraje) > 0 ? s.estado_actual : 'PRESTADA';
    var pr = { id_prestamo: store.nextId('PRE'), id_serie: s.id_serie, serie: s.serie_original, codigo: s.codigo, metraje_prestado: m.metraje,
      responsable: U.key(p.responsable), contratista: m.contratista, departamento: m.departamento, proyecto: m.proyecto_ruta,
      fecha_prestamo: m.fecha, fecha_limite: lim.iso, fecha_devolucion: '', metraje_devuelto: '', diferencia: '', estado: 'ACTIVO', estado_manual: '',
      documento: m.documento, observaciones: U.str(p.observacion), id_mov_prestamo: m.id_movimiento, id_mov_devolucion: '', origen: 'APP' };
    store.append('PRESTAMOS', [pr]); log('REGISTRAR_PRESTAMO', 'PRESTAMOS', pr.id_prestamo, '', '', pr);
    var r = save([m], 'REGISTRAR_PRESTAMO'); r.prestamo = pr.id_prestamo; return r;
  };

  self.returnLoan = function (p) {
    need('registrar');
    var pr = store.all('PRESTAMOS').filter(function (x) { return x.id_prestamo === p.id_prestamo; })[0];
    if (!pr) fail('Préstamo no encontrado.');
    var s = getSerie(pr.id_serie);
    var m = baseMov(p, s); m.tipo = 'DEVOLUCION_DE_PRESTAMO'; m.signo = 1; m.metraje = vMetraje(p.metraje);
    var prevDev = U.num(FS.computeLoans([pr], store.all('MOVIMIENTOS'), today)[0].metraje_devuelto);
    if (m.metraje + prevDev > +pr.metraje_prestado) {
      critical('DEVOLUCION_MAYOR_DESPACHO', pr.id_serie, 'Devolución de préstamo rechazada', (m.metraje + prevDev) + ' m', '<= ' + pr.metraje_prestado + ' m prestados');
      fail('Se devolvería más de lo prestado (' + pr.metraje_prestado + ' m).');
    }
    m.bodega_destino = vBodega(p.bodega || s.bodega_actual, 'Bodega receptora'); m.id_vinculado = pr.id_mov_prestamo; m.documento_ref = pr.documento;
    m.responsable = pr.responsable; m.estado_resultante = p.estado_material === 'MAL_ESTADO' ? 'MAL_ESTADO' : 'DISPONIBLE';
    return save([m], 'DEVOLVER_PRESTAMO');
  };

  self.setLoanState = function (p) {
    need('aprobar');
    if (['PERDIDO', 'CONSUMIDO_EN_OBRA', ''].indexOf(p.estado) < 0) fail('Solo se pueden fijar manualmente PERDIDO o CONSUMIDO_EN_OBRA.');
    var old = store.update('PRESTAMOS', 'id_prestamo', p.id_prestamo, { estado_manual: p.estado, observaciones: p.comentario || '' });
    log('ESTADO_PRESTAMO', 'PRESTAMOS', p.id_prestamo, 'estado_manual', old && old.estado_manual, p.estado, p.comentario);
    return self.recalc();
  };

  /** Sobrante: se declara (sin efecto en stock) y entra al stock solo al confirmar recepción física. */
  self.registerSurplus = function (p) {
    need('registrar');
    var s = getSerie(p.serie); if (!s) fail('La serie no existe.');
    var desp = store.all('MOVIMIENTOS').filter(function (x) { return x.id_movimiento === p.id_despacho && x.tipo === 'DESPACHO'; })[0];
    if (!desp) fail('Seleccione el despacho del que proviene el sobrante.');
    var sob = vMetraje(p.metraje_sobrante);
    var usado = U.isEmpty(p.metraje_utilizado) ? +desp.metraje - sob : vMetraje(p.metraje_utilizado);
    if (sob > +desp.metraje) { critical('DEVOLUCION_MAYOR_DESPACHO', s.id_serie, 'Sobrante mayor al despacho', sob + ' m', '<= ' + desp.metraje + ' m'); fail('El sobrante supera el metraje despachado (' + desp.metraje + ' m).'); }
    var r = { id_sobrante: store.nextId('SOB'), id_serie: s.id_serie, serie: s.serie_original, proyecto_original: desp.proyecto_ruta,
      documento_despacho: desp.documento, metraje_despachado: +desp.metraje, metraje_utilizado: usado, metraje_sobrante: sob, metraje_devuelto: '',
      fecha_devolucion: '', condicion: '', bodega_receptora: U.str(p.bodega), nuevo_proyecto: U.str(p.nuevo_proyecto), estado: 'DECLARADO',
      id_movimiento: desp.id_movimiento, registrado_por: user.email, confirmado_por: '', observaciones: U.str(p.observacion), origen: 'APP' };
    store.append('SOBRANTES', [r]); log('DECLARAR_SOBRANTE', 'SOBRANTES', r.id_sobrante, '', '', r);
    return { ok: true, sobrante: r, consumo_preliminar: +desp.metraje - sob };
  };
  self.confirmSurplus = function (p) {
    need('registrar');
    var r = store.all('SOBRANTES').filter(function (x) { return x.id_sobrante === p.id_sobrante; })[0];
    if (!r) fail('Sobrante no encontrado.');
    if (r.estado === 'RECIBIDO') fail('Este sobrante ya fue recibido.');
    if (p.rechazar) { store.update('SOBRANTES', 'id_sobrante', r.id_sobrante, { estado: 'RECHAZADO', confirmado_por: user.email, observaciones: r.observaciones + ' | RECHAZO: ' + (p.observacion || '') }); log('RECHAZAR_SOBRANTE', 'SOBRANTES', r.id_sobrante); return { ok: true }; }
    if (U.isEmpty(p.condicion)) fail('Indique la condición física del material recibido.');
    var s = getSerie(r.id_serie), dev = vMetraje(p.metraje_devuelto);
    var desp = store.all('MOVIMIENTOS').filter(function (x) { return x.id_movimiento === r.id_movimiento; })[0];
    var ya = store.all('MOVIMIENTOS').filter(function (x) { return desp && x.id_vinculado === desp.id_movimiento && FS.isMovVigente(x); }).reduce(function (a, x) { return a + +x.metraje; }, 0);
    if (desp && dev > +desp.metraje - ya) { critical('DEVOLUCION_MAYOR_DESPACHO', r.id_serie, 'Recepción de sobrante rechazada', dev + ' m', '<= ' + (+desp.metraje - ya) + ' m'); fail('Se recibiría más de lo despachado pendiente (' + (+desp.metraje - ya) + ' m).'); }
    var m = baseMov({ serie: r.id_serie, fecha: p.fecha || today, proyecto: r.proyecto_original, documento: p.documento, observacion: 'SOBRANTE ' + r.id_sobrante + ' · condición ' + p.condicion + (p.observacion ? ' · ' + p.observacion : '') }, s);
    m.tipo = 'SOBRANTE_DE_OBRA'; m.signo = 1; m.metraje = dev; m.bodega_destino = vBodega(p.bodega || r.bodega_receptora, 'Bodega receptora');
    m.id_vinculado = r.id_movimiento; m.documento_ref = r.documento_despacho; m.estado_resultante = U.key(p.condicion) === 'BUENA' ? 'DISPONIBLE' : 'MAL_ESTADO';
    if (desp) { m.departamento = desp.departamento; m.contratista = desp.contratista; }
    store.update('SOBRANTES', 'id_sobrante', r.id_sobrante, { estado: 'RECIBIDO', metraje_devuelto: dev, fecha_devolucion: m.fecha, condicion: U.key(p.condicion), bodega_receptora: m.bodega_destino, confirmado_por: user.email });
    return save([m], 'RECIBIR_SOBRANTE');
  };

  self.transfer = function (p) {
    need('registrar');
    var s = getSerie(p.serie); if (!s) fail('La serie no existe.');
    var dest = vBodega(p.bodega_destino, 'Bodega destino'), orig = s.bodega_actual;
    if (orig === dest) fail('La serie ya está en ' + dest + '.');
    if (+s.saldo_actual <= 0) fail('La serie no tiene saldo para trasladar (' + s.saldo_actual + ' m).');
    if (U.isEmpty(p.documento)) fail('El documento de traslado es obligatorio.');
    var m = baseMov(p, s); m.tipo = 'TRASLADO_ENTRE_BODEGAS'; m.signo = 0; m.metraje = +s.saldo_actual;
    m.bodega_origen = orig; m.bodega_destino = dest; m.ubicacion = U.key(p.ubicacion); m.estado_resultante = s.estado_actual;
    return save([m], 'TRASLADAR');
  };

  self.cut = function (p) {
    need('registrar');
    var s = getSerie(p.serie); if (!s) fail('La serie madre no existe.');
    var met = vMetraje(p.metraje); checkSalida(s, met, s.bodega_actual, 'CORTE_O_FRACCIONAMIENTO');
    var der = U.serieNorm(p.serie_derivada);
    if (!der) { var n = 1; do { der = s.id_serie + '-1-' + U.pad(n++, 3); } while (getSerie(der)); }
    if (getSerie(der)) fail('La serie derivada ' + der + ' ya existe.');
    var a = baseMov(p, s); a.tipo = 'CORTE_O_FRACCIONAMIENTO'; a.signo = -1; a.metraje = met; a.serie_derivada = der; a.bodega_origen = s.bodega_actual;
    a.estado_resultante = s.saldo_actual - met > 0 ? s.estado_actual : 'AGOTADA';
    var b = baseMov(p, s); b.id_serie = der; b.serie_original = der; b.tipo = 'CORTE_O_FRACCIONAMIENTO'; b.signo = 1; b.metraje = met;
    b.serie_derivada = ''; b.bodega_destino = s.bodega_actual; b.estado_resultante = 'DISPONIBLE'; b.id_vinculado = a.id_movimiento; a.id_vinculado = b.id_movimiento;
    store.append('RELACIONES', [{ serie: der, serie_madre: s.id_serie, tipo_relacion: 'CORTE', estado: 'CONFIRMADA', sugerida_por: user.email, confirmada_por: user.email, fecha: today }]);
    return save([a, b], 'CORTE');
  };

  self.approve = function (p) {
    need('aprobar');
    var m = store.all('MOVIMIENTOS').filter(function (x) { return x.id_movimiento === p.id_movimiento; })[0];
    if (!m || m.aprobacion !== 'PENDIENTE') fail('No hay un movimiento pendiente con ese ID.');
    if (m.usuario === user.email && user.rol !== 'ADMIN') fail('No puede aprobar un movimiento registrado por usted mismo.');
    var ok = p.decision === 'APROBAR';
    if (ok && m.signo < 0) {
      var s = getSerie(m.id_serie);
      if (+m.metraje > +s.saldo_actual) { critical('INTENTO_SALDO_NEGATIVO', s.id_serie, 'Aprobación rechazada', m.metraje, '<= ' + s.saldo_actual); fail('Al aprobar quedaría saldo negativo (saldo ' + s.saldo_actual + ' m).'); }
    }
    store.update('MOVIMIENTOS', 'id_movimiento', m.id_movimiento, { aprobacion: ok ? 'APROBADO' : 'RECHAZADO', aprobado_por: user.email, estado_registro: ok ? 'CERRADO' : 'ANULADO' });
    log(ok ? 'APROBAR' : 'RECHAZAR', 'MOVIMIENTOS', m.id_movimiento, 'aprobacion', 'PENDIENTE', ok ? 'APROBADO' : 'RECHAZADO', p.comentario);
    return self.recalc();
  };

  self.annulMovement = function (p) {
    need('anular');
    if (U.isEmpty(p.motivo)) fail('El motivo de anulación es obligatorio.');
    var old = store.update('MOVIMIENTOS', 'id_movimiento', p.id_movimiento, { estado_registro: 'ANULADO' });
    if (!old) fail('Movimiento no encontrado.');
    log('ANULAR', 'MOVIMIENTOS', p.id_movimiento, 'estado_registro', old.estado_registro, 'ANULADO', p.motivo);
    return self.recalc();
  };

  self.updateAlert = function (p) {
    need('alertas_revisar');
    var a = store.all('ALERTAS').filter(function (x) { return x.id_alerta === p.id_alerta; })[0];
    if (!a) fail('Alerta no encontrada.');
    var cerrar = p.estado === 'RESUELTA' || p.estado === 'DESCARTADA';
    if (cerrar && !can('alertas_cerrar')) fail('Su rol puede revisar alertas pero no cerrarlas. Déjela EN_REVISION con su comentario.');
    if (cerrar && a.categoria === 'CRITICA' && !can('aprobar')) fail('Las alertas críticas solo las cierra un supervisor o administrador.');
    if (cerrar && U.isEmpty(p.comentario)) fail('El comentario de resolución es obligatorio.');
    var patch = { estado: p.estado, responsable: p.responsable || a.responsable || user.email, comentario_resolucion: p.comentario || a.comentario_resolucion };
    if (cerrar) { patch.fecha_resolucion = now; patch.resuelta_por = user.email; }
    store.update('ALERTAS', 'id_alerta', a.id_alerta, patch);
    log('ACTUALIZAR_ALERTA', 'ALERTAS', a.id_alerta, 'estado', a.estado, p.estado, p.comentario);
    return self.recalc();
  };

  self.linkFamily = function (p) {
    need('relaciones');
    var serie = U.serieNorm(p.serie), madre = U.serieNorm(p.serie_madre);
    var ex = store.all('RELACIONES').filter(function (r) { return r.serie === serie; })[0];
    var estado = p.decision === 'RECHAZAR' ? 'RECHAZADA' : 'CONFIRMADA';
    if (ex) store.update('RELACIONES', 'serie', serie, { serie_madre: madre, estado: estado, confirmada_por: user.email, fecha: today });
    else store.append('RELACIONES', [{ serie: serie, serie_madre: madre, tipo_relacion: 'MANUAL', estado: estado, sugerida_por: user.email, confirmada_por: user.email, fecha: today }]);
    log('RELACION_SERIE', 'RELACIONES', serie, 'serie_madre', ex && ex.serie_madre, madre, estado);
    return self.recalc();
  };

  self.saveCatalog = function (p) {
    need('catalogos'); var r = p.fila;
    if (U.isEmpty(r.catalogo) || U.isEmpty(r.valor_original)) fail('Catálogo y valor original son obligatorios.');
    var all = store.all('CATALOGOS'), ex = all.filter(function (x) { return U.key(x.catalogo) === U.key(r.catalogo) && U.key(x.valor_original) === U.key(r.valor_original); })[0];
    var row = { catalogo: U.key(r.catalogo), valor_original: U.key(r.valor_original), valor_normalizado: U.key(r.valor_normalizado), clase: U.key(r.clase || r.catalogo), activo: r.activo === false ? 'NO' : 'SI', nota: U.str(r.nota) };
    if (ex) store.updateWhere('CATALOGOS', function (x) { return x === ex; }, row); else store.append('CATALOGOS', [row]);
    log('CATALOGO', 'CATALOGOS', row.catalogo + ':' + row.valor_original, '', ex, row);
    return { ok: true };
  };
  self.saveParam = function (p) {
    need('parametros');
    var old = store.update('PARAMETROS', 'clave', p.clave, { valor: p.valor });
    if (!old) fail('Parámetro inexistente.');
    log('PARAMETRO', 'PARAMETROS', p.clave, 'valor', old.valor, p.valor); return { ok: true };
  };
  self.saveSupplyParam = function (p) {
    need('parametros'); var r = p.fila;
    var row = { familia: r.familia, descripcion: r.descripcion || '', stock_minimo: +r.stock_minimo || 0, lead_time_dias: +r.lead_time_dias || '', dias_seguridad: +r.dias_seguridad || '', factor_temporada: +r.factor_temporada || 1, prioridad: r.prioridad || '' };
    var old = store.update('ABASTECIMIENTO_PARAM', 'familia', r.familia, row);
    if (!old) store.append('ABASTECIMIENTO_PARAM', [row]);
    log('PARAM_ABASTECIMIENTO', 'ABASTECIMIENTO_PARAM', r.familia, '', old, row); return { ok: true };
  };
  self.saveArticle = function (p) {
    need('catalogos'); var r = p.fila, cod = U.key(r.codigo); if (!cod) fail('Código obligatorio.');
    var fam = U.familiaCodigo(cod);
    var row = { id_articulo: 'ART-' + cod, codigo: cod, familia: fam.familia, prefijo_bodega: fam.prefijo, descripcion_original: U.str(r.descripcion), descripcion_normalizada: U.key(r.descripcion),
      hilos: +r.hilos || U.hilosFromDesc(r.descripcion) || '', span: +r.span || U.spanFromDesc(r.descripcion) || '', tipo_cable: U.key(r.tipo_cable), fabricante: U.str(r.fabricante), unidad: 'm', stock_minimo: +r.stock_minimo || '', activo: r.activo === false ? 'NO' : 'SI' };
    var old = store.update('ARTICULOS', 'codigo', cod, row); if (!old) store.append('ARTICULOS', [row]);
    log('ARTICULO', 'ARTICULOS', cod, '', old, row); return { ok: true };
  };
};
