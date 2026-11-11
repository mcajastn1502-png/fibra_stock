const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { console, JSON, Date, Math }; vm.createContext(ctx);
for (const f of ['../backend/00_Config.gs', '../backend/01_Engine.gs', '../backend/02_Service.gs', '../frontend/js/memstore.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx);
const FS = ctx.FS;
const t0 = Date.now();
const store = FS.buildFromCSV(fs.readFileSync(path.join(__dirname, '../data/FIBRA_MATRIZ.csv'), 'utf8'), '2026-10-13', '2026-10-13 16:30:00');
console.log('build ms', Date.now() - t0);
const U = (rol, email) => new FS.Service(store, { email: email || rol.toLowerCase() + '@telconet.ec', nombre: rol, rol });
const bod = U('BODEGA'), sup = U('SUPERVISOR'), ana = U('ANALISTA'), con = U('CONSULTA'), adm = U('ADMIN');
let pass = 0, failn = 0;
function ok(name, fn) { try { const r = fn(); console.log('✓', name, r !== undefined ? JSON.stringify(r).slice(0, 160) : ''); pass++; return r; } catch (e) { console.log('✗', name, e.message); failn++; } }
function err(name, fn, re) { try { fn(); console.log('✗ (debía fallar)', name); failn++; } catch (e) { if (re && !re.test(e.message)) { console.log('✗', name, 'mensaje inesperado:', e.message); failn++; } else { console.log('✓', name, '→', e.message.slice(0, 140)); pass++; } } }

const disp = store.all('SERIES').filter(s => s.estado_actual === 'DISPONIBLE' && s.estado_saldo === 'COMPLETO' && s.saldo_actual > 1500);
const S = disp[0]; console.log('serie de prueba', S.id_serie, S.saldo_actual, S.bodega_actual, S.codigo);
const base = { serie: S.id_serie, fecha: '2026-10-13', bodega: S.bodega_actual, departamento: 'PLANTA EXTERNA', contratista: 'QRTELECOM', proyecto: 'RUTA PRUEBA F01' };

err('consulta no registra', () => con.registerMovement({ ...base, tipo: 'DESPACHO', metraje: 100, documento: 'D1' }), /Permiso/);
err('despacho sin documento', () => bod.registerMovement({ ...base, tipo: 'DESPACHO', metraje: 100 }), /documento/);
err('despacho a STOCK BODEGA', () => bod.registerMovement({ ...base, tipo: 'DESPACHO', metraje: 100, documento: 'D1', proyecto: 'STOCK BODEGA' }), /STOCK/);
err('despacho mayor al saldo', () => bod.registerMovement({ ...base, tipo: 'DESPACHO', metraje: S.saldo_actual + 50, documento: 'D1' }), /saldo negativo/);
err('metraje ambiguo', () => bod.registerMovement({ ...base, tipo: 'DESPACHO', metraje: '1.200', documento: 'D1' }), /ambiguo/);
err('fecha futura', () => bod.registerMovement({ ...base, tipo: 'DESPACHO', metraje: 100, documento: 'D1', fecha: '2026-12-01' }), /posterior/);
const d1 = ok('despacho 1000 m', () => bod.registerMovement({ ...base, tipo: 'DESPACHO', metraje: 1000, documento: 'DOC-900001' }));
console.log('   contratista normalizado:', store.all('MOVIMIENTOS').find(m => m.id_movimiento === d1.movimientos[0]).contratista);
err('despacho duplicado mismo doc', () => bod.registerMovement({ ...base, tipo: 'DESPACHO', metraje: 1000, documento: 'DOC-900001' }), /Ya existe/);
const desp = bod.dispatchesOf({ serie: S.id_serie }).find(c => c.documento === 'DOC-900001');
err('devolución mayor al despacho', () => bod.registerReturn({ serie: S.id_serie, id_despacho: desp.id_movimiento, metraje: 1200, bodega: S.bodega_actual, motivo: 'sobra' }), /supera/);
ok('devolución parcial 376 m', () => bod.registerReturn({ serie: S.id_serie, id_despacho: desp.id_movimiento, metraje: 376, bodega: S.bodega_actual, motivo: 'Fin de obra', fecha: '2026-10-13' }).resumen);
ok('devolución sin referencia', () => bod.registerReturn({ serie: S.id_serie, id_despacho: 'SIN_REFERENCIA', metraje: 10, bodega: S.bodega_actual, motivo: 'encontrado' }).resumen);
err('préstamo sin fecha límite', () => bod.registerLoan({ ...base, metraje: 200, responsable: 'JUAN PEREZ' }), /fecha límite/);
const pr = ok('préstamo 200 m', () => bod.registerLoan({ ...base, metraje: 200, responsable: 'Juan Perez', fecha_limite: '2026-10-15' }));
ok('devolver préstamo 150 m (parcial)', () => bod.returnLoan({ id_prestamo: pr.prestamo, metraje: 150, fecha: '2026-10-13' }).serie.saldo_actual);
console.log('   préstamo:', JSON.stringify(bod.loans().find(p => p.id_prestamo === pr.prestamo)));
const sob = ok('declarar sobrante 300 m', () => bod.registerSurplus({ serie: S.id_serie, id_despacho: desp.id_movimiento, metraje_sobrante: 300 }));
const saldoAntes = store.all('SERIES').find(s => s.id_serie === S.id_serie).saldo_actual;
ok('confirmar recepción sobrante 300 (condición BUENA)', () => { const r = bod.confirmSurplus({ id_sobrante: sob.sobrante.id_sobrante, metraje_devuelto: 300, condicion: 'BUENA', bodega: S.bodega_actual }); return [saldoAntes, r.serie.saldo_actual]; });
const otra = FS.BODEGAS.find(b => b !== S.bodega_actual);
err('traslado sin documento', () => bod.transfer({ serie: S.id_serie, bodega_destino: otra }), /documento/);
ok('traslado a ' + otra, () => bod.transfer({ serie: S.id_serie, bodega_destino: otra, documento: 'TR-1' }).serie.bodega_actual);
err('despacho desde bodega anterior', () => bod.registerMovement({ ...base, tipo: 'DESPACHO', metraje: 10, documento: 'D2' }), /está en/);
ok('corte 100 m', () => bod.cut({ serie: S.id_serie, metraje: 100 }).movimientos);
const der = store.all('SERIES').filter(s => s.id_serie.startsWith(S.id_serie + '-1-'));
console.log('   derivada', der.map(s => s.id_serie + ' ' + s.saldo_actual + ' madre=' + s.serie_madre));
const baja = ok('solicitar baja 50 m (queda pendiente)', () => bod.registerMovement({ serie: S.id_serie, tipo: 'BAJA_POR_MAL_ESTADO', metraje: 50, bodega: otra, observacion: 'Chaqueta rota' }));
err('bodega no aprueba', () => bod.approve({ id_movimiento: baja.movimientos[0], decision: 'APROBAR' }), /Permiso/);
ok('supervisor aprueba baja', () => sup.approve({ id_movimiento: baja.movimientos[0], decision: 'APROBAR' }));
const life = bod.rollLife({ serie: S.id_serie });
console.log('   vida:', life.timeline.map(m => m.tipo + ':' + m.metraje + '→' + m.saldo_despues).join(' | '));
console.log('   serie:', JSON.stringify(life.serie));
const crit = store.all('ALERTAS').find(a => a.categoria === 'CRITICA' && a.estado === 'ABIERTA' && a.tipo === 'SALIDA_MAYOR_INGRESO');
err('analista no cierra', () => ana.updateAlert({ id_alerta: crit.id_alerta, estado: 'RESUELTA', comentario: 'x' }), /no cerrarlas/);
ok('analista pone EN_REVISION', () => ana.updateAlert({ id_alerta: crit.id_alerta, estado: 'EN_REVISION', comentario: 'Verificando guía' }));
ok('supervisor resuelve crítica', () => sup.updateAlert({ id_alerta: crit.id_alerta, estado: 'RESUELTA', comentario: 'Guía física confirma salida; se registrará ajuste' }));
ok('vincular familia', () => ana.linkFamily({ serie: 'B250459-1-001', serie_madre: 'B250459' }));
console.log('   madre de B250459-1-001:', store.all('SERIES').find(s => s.id_serie === 'B250459-1-001').serie_madre);
ok('reporte inventario', () => adm.report({ tipo: 'inventario' }).secciones.map(s => s.titulo + ':' + s.filas.length));
ok('reporte consumo', () => adm.report({ tipo: 'consumo' }).secciones.map(s => s.titulo.slice(0, 20) + ':' + s.filas.length));
ok('reporte excepciones', () => adm.report({ tipo: 'excepciones' }).secciones.map(s => s.titulo.slice(0, 18) + ':' + s.filas.length));
ok('reporte no utilizable', () => adm.report({ tipo: 'no_utilizable' }).secciones[0].filas.length);
ok('bitácora', () => adm.audit({}).length);
ok('búsqueda por documento', () => bod.searchSeries({ q: '518855605' }).map(s => s.id_serie));
ok('anular (admin)', () => adm.annulMovement({ id_movimiento: d1.movimientos[0], motivo: 'prueba' }));

// ---- Despacho por lotes (hasta 25 series, datos comunes, registra las válidas)
const lote = store.all('SERIES').filter(s => s.estado_actual === 'DISPONIBLE' && +s.saldo_actual > 300 && s.id_serie !== S.id_serie).slice(0, 3);
const comun = { fecha: '2026-10-13', departamento: 'PLANTA EXTERNA', contratista: 'QRTELECOM', proyecto: 'RUTA LOTE F02' };
ok('seriesInfo autocompleta código, saldo y bodega', () => { const r = bod.seriesInfo({ series: [lote[0].id_serie.toLowerCase(), 'NOEXISTE-999'] });
  if (r[0].codigo !== lote[0].codigo || +r[0].saldo_actual !== +lote[0].saldo_actual || r[0].bodega_actual !== lote[0].bodega_actual || r[1].existe) throw new Error(JSON.stringify(r)); return r.map(x => x.id_serie + ':' + x.existe); });
err('lote sin series', () => bod.registerDispatchBatch({ ...comun, items: [] }), /al menos una serie/);
err('lote de 26 series', () => bod.registerDispatchBatch({ ...comun, items: Array.from({ length: 26 }, (_, i) => ({ serie: 'X' + i, metraje: 1 })) }), /Máximo 25/);
err('lote sin departamento', () => bod.registerDispatchBatch({ ...comun, departamento: '', items: [{ serie: lote[0].id_serie, metraje: 10 }] }), /departamento/);
err('consulta no registra lote', () => con.registerDispatchBatch({ ...comun, items: [{ serie: lote[0].id_serie, metraje: 10 }] }), /Permiso/);
const rl = ok('lote: 3 válidas + inexistente + repetida + saldo excedido', () => {
  const r = bod.registerDispatchBatch({ ...comun, items: [
    { serie: lote[0].id_serie, metraje: lote[0].saldo_actual, bodega: lote[0].bodega_actual },   // saldo completo
    { serie: lote[1].id_serie, metraje: 100, bodega: lote[1].bodega_actual },                    // parcial
    { serie: 'NOEXISTE-999', metraje: 50 },
    { serie: lote[1].id_serie, metraje: 10 },                                                     // repetida
    { serie: lote[2].id_serie, metraje: +lote[2].saldo_actual + 1 } ] });                         // excede saldo
  if (r.registradas.length !== 2 || r.errores.length !== 3) throw new Error(JSON.stringify(r.errores));
  if (!/^DS-\d{6}$/.test(r.documento)) throw new Error('documento ' + r.documento);
  return { doc: r.documento, ok: r.registradas.map(x => x.serie + ' ' + x.metraje + 'm saldo ' + x.saldo_actual), err: r.errores.map(e => e.fila + ':' + e.error.slice(0, 30)) };
});
ok('lote: estados y documento común', () => {
  const s0 = store.all('SERIES').find(s => s.id_serie === lote[0].id_serie), s1 = store.all('SERIES').find(s => s.id_serie === lote[1].id_serie);
  const movs = store.all('MOVIMIENTOS').filter(m => m.documento === rl.doc);
  if (s0.estado_actual !== 'DESPACHADA' || +s0.saldo_actual !== 0 || +s1.saldo_actual !== +lote[1].saldo_actual - 100 || movs.length !== 2) throw new Error([s0.estado_actual, s0.saldo_actual, s1.saldo_actual, movs.length].join(' '));
  return [s0.estado_actual, s1.estado_actual, movs.length + ' movimientos con ' + rl.doc];
});
ok('lote: reintento con mismo documento solo de la serie corregida', () => { const r = bod.registerDispatchBatch({ ...comun, documento: rl.doc, items: [{ serie: lote[2].id_serie, metraje: 200 }] });
  if (r.registradas.length !== 1 || r.errores.length || r.documento !== rl.doc) throw new Error(JSON.stringify(r)); return r.documento; });
const libre = store.all('SERIES').find(s => s.estado_actual === 'DISPONIBLE' && +s.saldo_actual > 300 && !lote.some(x => x.id_serie === s.id_serie));
err('préstamo sin "prestado a"', () => bod.registerDispatchBatch({ ...comun, prestamo: true, responsable: 'JUAN PEREZ', fecha_limite: '2026-10-28', items: [{ serie: libre.id_serie, metraje: 50 }] }), /quién se presta/);
err('préstamo sin fecha límite', () => bod.registerDispatchBatch({ ...comun, prestamo: true, responsable: 'JUAN PEREZ', prestado_a: 'LUIS TORRES', items: [{ serie: libre.id_serie, metraje: 50 }] }), /fecha límite/);
err('préstamo con límite anterior', () => bod.registerDispatchBatch({ ...comun, prestamo: true, responsable: 'JUAN PEREZ', prestado_a: 'LUIS TORRES', fecha_limite: '2026-10-01', items: [{ serie: libre.id_serie, metraje: 50 }] }), /anterior/);
ok('despacho marcado como préstamo', () => { const r = bod.registerDispatchBatch({ ...comun, prestamo: true, responsable: 'JUAN PEREZ', prestado_a: 'Luis Torres', fecha_limite: '2026-10-28', items: [{ serie: libre.id_serie, metraje: 50 }] });
  const mv = store.all('MOVIMIENTOS').find(x => x.id_movimiento === r.movimientos[0]);
  if (mv.tipo !== 'DESPACHO' || mv.prestamo !== 'SI' || mv.prestado_a !== 'Luis Torres' || mv.fecha_limite_devolucion !== '2026-10-28' || mv.responsable !== 'JUAN PEREZ') throw new Error(JSON.stringify(mv));
  return [mv.tipo, mv.prestamo, mv.prestado_a, mv.fecha_limite_devolucion]; });
ok('despacho normal no marca préstamo', () => { const mv = store.all('MOVIMIENTOS').filter(x => x.documento === rl.doc)[0]; if (mv.prestamo || mv.prestado_a) throw new Error('marcado'); return 'ok'; });
// ---- Devolución desde Registrar movimiento: sin despacho elegido (vínculo automático), sin motivo, RESERVADA y código editable
const sd = store.all('SERIES').find(s => s.estado_actual === 'DISPONIBLE' && +s.saldo_actual > 600 && !lote.some(x => x.id_serie === s.id_serie) && s.id_serie !== libre.id_serie);
const dA = bod.registerDispatchBatch({ ...comun, fecha: '2026-10-10', documento: 'DOC-A', items: [{ serie: sd.id_serie, metraje: 100 }] });
const dB = bod.registerDispatchBatch({ ...comun, fecha: '2026-10-12', documento: 'DOC-B', items: [{ serie: sd.id_serie, metraje: 300 }] });
ok('devolución sin despacho → vincula al último con pendiente', () => { const r = bod.registerReturn({ serie: sd.id_serie, metraje: 50, bodega: sd.bodega_actual, proyecto: 'RUTA SOBRANTE X', fecha: '2026-10-13' });
  const mv = store.all('MOVIMIENTOS').find(x => x.id_movimiento === r.movimientos[0]);
  if (r.resumen.despacho !== 'DOC-B' || mv.id_vinculado !== dB.movimientos[0] || mv.proyecto_ruta !== 'RUTA SOBRANTE X') throw new Error(JSON.stringify([r.resumen, mv.id_vinculado, mv.proyecto_ruta])); return r.resumen; });
ok('devolución mayor a lo pendiente de todos los despachos → sin referencia', () => { const r = bod.registerReturn({ serie: sd.id_serie, metraje: 260, bodega: sd.bodega_actual, fecha: '2026-10-13' });
  if (r.resumen.despacho) throw new Error('vinculó a ' + r.resumen.despacho); return r.resumen; }); // B tiene 250 pendientes y A 100: ninguno alcanza → sin referencia
ok('devolución sin referencia genera alerta', () => { const a = store.all('ALERTAS').filter(x => x.id_serie === sd.id_serie && x.tipo === 'DEVOLUCION_SIN_REFERENCIA'); if (!a.length) throw new Error('sin alerta'); return a.length; });
ok('devolución con estado RESERVADA', () => { const r = bod.registerReturn({ serie: sd.id_serie, metraje: 20, bodega: sd.bodega_actual, estado_material: 'RESERVADA', fecha: '2026-10-13' });
  const mv = store.all('MOVIMIENTOS').find(x => x.id_movimiento === r.movimientos[0]); if (mv.estado_resultante !== 'RESERVADA') throw new Error(mv.estado_resultante); return mv.estado_resultante; });
err('devolución con código inexistente', () => bod.registerReturn({ serie: sd.id_serie, metraje: 5, bodega: sd.bodega_actual, codigo: 'NO-EXISTE-1', fecha: '2026-10-13' }), /no existe en el catálogo/);
ok('devolución con código editado del catálogo', () => { const otro = store.all('ARTICULOS').find(a => a.codigo !== sd.codigo);
  const r = bod.registerReturn({ serie: sd.id_serie, metraje: 5, bodega: sd.bodega_actual, codigo: otro.codigo.toLowerCase(), fecha: '2026-10-13' });
  const mv = store.all('MOVIMIENTOS').find(x => x.id_movimiento === r.movimientos[0]); if (mv.codigo !== otro.codigo) throw new Error(mv.codigo); return mv.codigo; });
ok('rutas sugeridas en bootstrap', () => { const r = bod.bootstrap().catalogos.rutas; if (r.indexOf('RUTA SOBRANTE X') < 0) throw new Error('falta'); return r.length; });
ok('lote: todas fallan → no registra nada', () => { const n = store.all('MOVIMIENTOS').length, r = bod.registerDispatchBatch({ ...comun, items: [{ serie: 'NOEXISTE-1', metraje: 5 }] });
  if (r.ok || r.registradas.length || store.all('MOVIMIENTOS').length !== n) throw new Error('registró'); return r.errores[0].error; });
console.log(`\n${pass} correctas, ${failn} fallidas`);
