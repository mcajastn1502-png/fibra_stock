/**
 * FIBRA STOCK — Configuración, esquema de tablas, catálogos semilla y permisos.
 * Este archivo es JavaScript puro (sin APIs de Google) y se comparte con el modo demo del frontend.
 */
var FS = (typeof FS !== 'undefined') ? FS : {};

FS.VERSION = '1.0.0';
/** Columnas que se guardan como número en Sheets (el resto como texto plano) */
FS.NUMERIC_COL_RE = /^(metraje|saldo|total_|consumo|mts_ingreso$|mts_salida$|num_|alertas_abiertas|hilos$|hilos_descripcion|span$|signo|diferencia|stock_|lead_time|dias_|factor_|riesgo|fila$|fila_origen|valor$)/;

/* ------------------------------------------------------------------ */
/*  Esquema: una hoja de Google Sheets por tabla. Fila 1 = encabezados */
/* ------------------------------------------------------------------ */
FS.SCHEMA = {
  MATRIZ_ORIGINAL: null, // la matriz pegada tal cual; nunca se modifica
  MATRIZ_NORMALIZADA: ['fila', 'fecha_original', 'fecha', 'regla_fecha', 'bodega_original', 'bodega', 'codigo', 'familia',
    'descripcion', 'serie_original', 'serie_normalizada', 'serie_raiz', 'hilos_original', 'hilos', 'hilos_descripcion',
    'span_original', 'span', 'estado_original', 'estado', 'ubicacion', 'mts_ingreso_original', 'mts_ingreso',
    'mts_salida_original', 'mts_salida', 'regla_metraje', 'confianza_metraje', 'revision_manual', 'ruta',
    'departamento_original', 'departamento', 'clase_departamento', 'documento', 'contratista_original', 'contratista',
    'clase_contratista', 'certificacion_original', 'certificado_por', 'fecha_certificacion', 'observacion',
    'clasificacion_repeticion', 'riesgo_duplicado', 'movimientos_generados'],
  ARTICULOS: ['id_articulo', 'codigo', 'familia', 'prefijo_bodega', 'descripcion_original', 'descripcion_normalizada',
    'hilos', 'span', 'tipo_cable', 'fabricante', 'unidad', 'stock_minimo', 'activo'],
  SERIES: ['id_serie', 'serie_original', 'serie_normalizada', 'serie_madre', 'codigo', 'familia', 'descripcion', 'hilos',
    'span', 'metraje_inicial', 'total_ingresado', 'total_despachado', 'total_devuelto', 'total_prestado',
    'total_dev_prestamo', 'total_baja', 'total_corte', 'total_ajuste', 'consumo_calculado', 'saldo_actual',
    'estado_actual', 'bodega_actual', 'ubicacion_actual', 'reservado_para', 'fecha_ultimo_mov', 'num_movimientos',
    'nivel_confiabilidad', 'estado_saldo', 'estado_conciliacion', 'alertas_abiertas'],
  MOVIMIENTOS: ['id_movimiento', 'id_serie', 'codigo', 'serie_original', 'serie_derivada', 'fecha', 'tipo', 'metraje', 'signo',
    'bodega_origen', 'bodega_destino', 'ubicacion', 'estado_resultante', 'proyecto_ruta', 'departamento_original',
    'departamento', 'contratista_original', 'contratista', 'responsable', 'documento', 'documento_ref', 'usuario',
    'creado_en', 'observacion_original', 'observacion_normalizada', 'evidencia_url', 'origen', 'fila_origen',
    'regla_aplicada', 'confianza', 'estado_registro', 'aprobacion', 'aprobado_por', 'id_vinculado', 'certificado_por'],
  PRESTAMOS: ['id_prestamo', 'id_serie', 'serie', 'codigo', 'metraje_prestado', 'responsable', 'contratista',
    'departamento', 'proyecto', 'fecha_prestamo', 'fecha_limite', 'fecha_devolucion', 'metraje_devuelto', 'diferencia',
    'estado', 'estado_manual', 'documento', 'observaciones', 'id_mov_prestamo', 'id_mov_devolucion', 'origen'],
  SOBRANTES: ['id_sobrante', 'id_serie', 'serie', 'proyecto_original', 'documento_despacho', 'metraje_despachado',
    'metraje_utilizado', 'metraje_sobrante', 'metraje_devuelto', 'fecha_devolucion', 'condicion', 'bodega_receptora',
    'nuevo_proyecto', 'estado', 'id_movimiento', 'registrado_por', 'confirmado_por', 'observaciones', 'origen'],
  ALERTAS: ['id_alerta', 'clave', 'tipo', 'categoria', 'severidad', 'id_serie', 'id_movimiento', 'fila_origen', 'campo',
    'valor_encontrado', 'valor_esperado', 'descripcion', 'estado', 'responsable', 'creada_en', 'fecha_resolucion',
    'comentario_resolucion', 'resuelta_por', 'dinamica'],
  RELACIONES: ['serie', 'serie_madre', 'tipo_relacion', 'estado', 'sugerida_por', 'confirmada_por', 'fecha'],
  CATALOGOS: ['catalogo', 'valor_original', 'valor_normalizado', 'clase', 'activo', 'nota'],
  PARAMETROS: ['clave', 'valor', 'descripcion'],
  ABASTECIMIENTO_PARAM: ['familia', 'descripcion', 'stock_minimo', 'lead_time_dias', 'dias_seguridad',
    'factor_temporada', 'prioridad'],
  USUARIOS: ['email', 'nombre', 'rol', 'activo', 'salt', 'hash', 'creado_en', 'ultimo_acceso'],
  BITACORA: ['id', 'fecha_hora', 'usuario', 'accion', 'tabla', 'id_registro', 'campo', 'valor_anterior', 'valor_nuevo',
    'detalle']
};

/* ------------------------------------------------------------------ */
/*  Columnas de la matriz original (se aceptan variaciones)           */
/* ------------------------------------------------------------------ */
FS.MATRIZ_COLS = {
  fecha: ['FECHA'], bodega: ['BODEGA'], codigo: ['CODIGO', 'CÓDIGO'], descripcion: ['DESCRIPCION', 'DESCRIPCIÓN'],
  serie: ['SERIE'], hilos: ['N° HILOS', 'Nº HILOS', 'NO HILOS', 'HILOS'], span: ['SPAM', 'SPAN'], estado: ['ESTADO'],
  ubicacion: ['UBICACION', 'UBICACIÓN'], ingreso: ['MTS INGRESO', 'MTS  INGRESO', 'MTS\nINGRESO'],
  salida: ['MTS SALIDA', 'MTS  SALIDA', 'MTS\nSALIDA'], ruta: ['RUTA'], departamento: ['DEPARTAMETO', 'DEPARTAMENTO'],
  documento: ['# DOC DESPACHO', 'DOC DESPACHO', 'DOCUMENTO'], contratista: ['CONTRATISTA'],
  certificacion: ['CERTICACION', 'CERTIFICACION', 'CERTIFICACIÓN'], observacion: ['OBSERVACION', 'OBSERVACIÓN']
};

/* ------------------------------------------------------------------ */
/*  Tipos de movimiento y su efecto en el saldo de la serie            */
/* ------------------------------------------------------------------ */
FS.TIPOS_MOV = {
  INGRESO_INICIAL:               { signo: +1, grupo: 'ingresado',   requiereDoc: false },
  INGRESO_ADICIONAL:             { signo: +1, grupo: 'ingresado',   requiereDoc: false },
  INVENTARIO_INICIAL_DE_APERTURA:{ signo: +1, grupo: 'ingresado',   requiereDoc: false },
  DESPACHO:                      { signo: -1, grupo: 'despachado',  requiereDoc: true },
  DEVOLUCION:                    { signo: +1, grupo: 'devuelto',    requiereDoc: false },
  PRESTAMO:                      { signo: -1, grupo: 'prestado',    requiereDoc: false },
  DEVOLUCION_DE_PRESTAMO:        { signo: +1, grupo: 'dev_prestamo',requiereDoc: false },
  TRASLADO_ENTRE_BODEGAS:        { signo: 0,  grupo: 'traslado',    requiereDoc: false },
  CORTE_O_FRACCIONAMIENTO:       { signo: 0,  grupo: 'corte',       requiereDoc: false }, // signo real en la fila (+ derivada / - madre)
  SOBRANTE_DE_OBRA:              { signo: +1, grupo: 'devuelto',    requiereDoc: false },
  BAJA_POR_MAL_ESTADO:           { signo: -1, grupo: 'baja',        requiereDoc: false, requiereAprobacion: true },
  AJUSTE_MANUAL_AUTORIZADO:      { signo: 0,  grupo: 'ajuste',      requiereDoc: false, requiereAprobacion: true }, // signo en la fila
  CAMBIO_DE_ESTADO:              { signo: 0,  grupo: 'estado',      requiereDoc: false }  // reservar, liberar, marcar mal estado
};

FS.ESTADOS = ['DISPONIBLE', 'DESPACHADA', 'PRESTADA', 'RESERVADA', 'DEVUELTA', 'MAL_ESTADO', 'BAJA', 'EN_CONCILIACION',
  'TRASLADADA', 'AGOTADA'];
FS.BODEGAS = ['BQUS', 'BQEF', 'BQZ3'];
FS.UBICACIONES = ['EXT 02 BODEGA', 'EXT 03 BODEGA', 'SAN FERNANDO'];
FS.ESTADOS_PRESTAMO = ['ACTIVO', 'DEVUELTO_COMPLETO', 'DEVUELTO_PARCIAL', 'VENCIDO', 'PENDIENTE_DE_CONCILIACION',
  'PERDIDO', 'CONSUMIDO_EN_OBRA'];
FS.HILOS_STD = [2, 6, 12, 24, 48, 96, 144];

/* ------------------------------------------------------------------ */
/*  Catálogo de alertas                                               */
/* ------------------------------------------------------------------ */
FS.ALERTAS = {
  // Críticas
  SALIDA_MAYOR_INGRESO:      ['CRITICA', 'CRITICA', 'La salida supera el metraje disponible conocido de la serie'],
  SALDO_NEGATIVO:            ['CRITICA', 'CRITICA', 'La serie tiene saldo negativo'],
  SALIDA_SIN_INGRESO:        ['CRITICA', 'CRITICA', 'Salida sin ingreso previo ni inventario de apertura'],
  DEVOLUCION_MAYOR_DESPACHO: ['CRITICA', 'CRITICA', 'La devolución supera el metraje despachado relacionado'],
  DOC_DESPACHO_DUPLICADO:    ['CRITICA', 'CRITICA', 'El mismo documento despacha dos veces la misma serie y metraje'],
  DISPONIBLE_Y_BAJA:         ['CRITICA', 'CRITICA', 'Serie disponible y dada de baja al mismo tiempo'],
  INTENTO_SALDO_NEGATIVO:    ['CRITICA', 'CRITICA', 'Se intentó registrar un movimiento que dejaba saldo negativo'],
  // Conciliación
  DUPLICADO_ACCIDENTAL:      ['CONCILIACION', 'ALTA', 'Registro idéntico a otro de la misma serie (no se generó movimiento)'],
  POSIBLE_DUPLICADO:         ['CONCILIACION', 'MEDIA', 'Registro muy similar a otro de la misma serie'],
  SERIE_EN_DOS_BODEGAS:      ['CONCILIACION', 'ALTA', 'La serie aparece en otra bodega mientras conserva saldo en la anterior'],
  REAPARICION_CON_SALDO:     ['CONCILIACION', 'ALTA', 'La serie reaparece con ingreso mientras aún tenía saldo; no se generó ingreso'],
  TRASLADO_INFERIDO:         ['CONCILIACION', 'BAJA', 'La serie reaparece con el mismo saldo en otra bodega: se registró traslado inferido'],
  DEVOLUCION_INFERIDA:       ['CONCILIACION', 'MEDIA', 'Reingreso posterior a un despacho interpretado como devolución'],
  DEVOLUCION_SIN_REFERENCIA: ['CONCILIACION', 'ALTA', 'Devolución sin despacho relacionado'],
  ESTADO_DESPACHADA_SIN_SALIDA: ['CONCILIACION', 'ALTA', 'Estado DESPACHADA sin metraje de salida'],
  DESPACHO_RUTA_STOCK:       ['CONCILIACION', 'MEDIA', 'Serie despachada con ruta "STOCK BODEGA"'],
  PRESTADA_SIN_RESPONSABLE:  ['CONCILIACION', 'ALTA', 'Préstamo sin responsable identificado'],
  PRESTAMO_SIN_FECHA_LIMITE: ['PRESTAMO', 'MEDIA', 'Préstamo sin fecha límite de devolución'],
  PRESTAMO_VENCIDO:          ['PRESTAMO', 'ALTA', 'Préstamo vencido'],
  PRESTAMO_POR_VENCER:       ['PRESTAMO', 'BAJA', 'Préstamo próximo a vencer'],
  PRESTAMO_DIFERENCIA:       ['PRESTAMO', 'MEDIA', 'Diferencia entre metraje prestado y devuelto'],
  PRESTADA_REAPARECE_DISPONIBLE: ['PRESTAMO', 'ALTA', 'Serie prestada aparece disponible sin devolución documentada'],
  OBS_DEVOLUCION_SIN_METRAJE:['CONCILIACION', 'MEDIA', 'Observación de devolución sin metraje'],
  SOBRANTE_SIN_CANTIDAD:     ['CONCILIACION', 'MEDIA', 'Sobrante declarado sin cantidad'],
  DOCUMENTO_VACIO_SALIDA:    ['CONCILIACION', 'MEDIA', 'Movimiento de salida sin documento'],
  CONTRATISTA_NO_REGISTRADO: ['CONCILIACION', 'BAJA', 'Contratista no registrado en catálogo'],
  DEPARTAMENTO_VACIO:        ['CONCILIACION', 'BAJA', 'Departamento vacío o no válido'],
  ESTADO_NO_COINCIDE:        ['CONCILIACION', 'MEDIA', 'El estado no coincide con el tipo de movimiento'],
  POSIBLE_TRASLADO:          ['CONCILIACION', 'BAJA', 'El destino es otra bodega: posible traslado registrado como despacho'],
  SERIE_DERIVADA_POSIBLE:    ['CONCILIACION', 'INFO', 'Posible serie derivada / familia de rollo (no fusionada)'],
  SERIE_VACIA:               ['CONCILIACION', 'ALTA', 'Registro sin serie'],
  REGISTRO_INCOMPLETO:       ['CONCILIACION', 'ALTA', 'Registro sin datos suficientes para generar movimientos'],
  SALDO_BAJO:                ['CONCILIACION', 'BAJA', 'Rollo con saldo menor al umbral configurado'],
  // Formato
  METRAJE_AMBIGUO:           ['FORMATO', 'MEDIA', 'Metraje con separador ambiguo'],
  METRAJE_TEXTO:             ['FORMATO', 'BAJA', 'Metraje almacenado como texto'],
  FECHA_INVALIDA:            ['FORMATO', 'ALTA', 'Fecha inválida o imposible'],
  FECHA_FUTURA:              ['FORMATO', 'ALTA', 'Fecha posterior a la fecha actual'],
  FECHA_FORMATO_MIXTO:       ['FORMATO', 'BAJA', 'Fecha con formato distinto al predominante'],
  FECHA_EN_TEXTO:            ['FORMATO', 'BAJA', 'Fecha guardada como texto en un campo no destinado a fechas'],
  CERTIFICACION_FUTURA:      ['FORMATO', 'MEDIA', 'Fecha de certificación posterior a hoy'],
  HILOS_NO_COINCIDE:         ['FORMATO', 'MEDIA', 'Número de hilos no coincide con la descripción del artículo'],
  SPAN_NO_COINCIDE:          ['FORMATO', 'BAJA', 'Span no coincide con la descripción del artículo'],
  // Tareas de validación (texto libre)
  TAREA_PRESTAMO_TEXTO:      ['TAREA', 'MEDIA', 'Observación indica préstamo: validar y registrar en módulo de préstamos'],
  TAREA_DEVOLUCION_TEXTO:    ['TAREA', 'MEDIA', 'Observación indica devolución: validar físicamente antes de registrar'],
  TAREA_SALIDA_TEXTO:        ['TAREA', 'MEDIA', 'Observación indica una salida/corte no registrada en metraje']
};

/* ------------------------------------------------------------------ */
/*  Roles y permisos                                                  */
/* ------------------------------------------------------------------ */
FS.ROLES = {
  ADMIN:      ['leer', 'registrar', 'aprobar', 'alertas_revisar', 'alertas_cerrar', 'catalogos', 'usuarios', 'bitacora', 'reportes', 'parametros', 'relaciones', 'anular'],
  SUPERVISOR: ['leer', 'registrar', 'aprobar', 'alertas_revisar', 'alertas_cerrar', 'bitacora', 'reportes', 'parametros', 'relaciones'],
  BODEGA:     ['leer', 'registrar', 'alertas_revisar', 'reportes'],
  ANALISTA:   ['leer', 'alertas_revisar', 'reportes', 'relaciones', 'bitacora'],
  CONSULTA:   ['leer', 'reportes', 'bitacora']
};

/* ------------------------------------------------------------------ */
/*  Parámetros por defecto                                            */
/* ------------------------------------------------------------------ */
FS.PARAMS_DEFAULT = [
  ['UMBRAL_SALDO_BAJO_M', 300, 'Saldo (m) por debajo del cual un rollo disponible se considera saldo bajo'],
  ['DIAS_AVISO_PRESTAMO', 3, 'Días antes del vencimiento para alertar préstamo próximo a vencer'],
  ['DIAS_PRESTAMO_DEFECTO', 15, 'Días sugeridos de préstamo cuando no se indica fecha límite (solo sugerencia)'],
  ['CORREOS_ALERTAS', '', 'Correos separados por coma que reciben el resumen diario de alertas'],
  ['ZONA_HORARIA', 'America/Guayaquil', 'Zona horaria de la operación'],
  ['LEAD_TIME_DEFECTO', 45, 'Días de reposición por defecto (proyección)'],
  ['DIAS_SEGURIDAD_DEFECTO', 15, 'Días de stock de seguridad por defecto'],
  ['DIAS_COBERTURA_OBJETIVO', 60, 'Días de cobertura objetivo para la cantidad sugerida de compra'],
  ['ANIO_MINIMO_VALIDO', 2018, 'Fechas anteriores a este año se marcan para revisión']
];

/* ------------------------------------------------------------------ */
/*  Catálogos semilla: [catalogo, valor_original, valor_normalizado, clase] */
/*  clase indica qué es realmente el valor (no siempre coincide con la columna) */
/* ------------------------------------------------------------------ */
FS.CATALOGO_SEMILLA = [
  // Estados
  ['ESTADO', 'DESPACHADA', 'DESPACHADA', 'ESTADO'], ['ESTADO', 'DESPACHADO', 'DESPACHADA', 'ESTADO'],
  ['ESTADO', 'DISPONIBLE', 'DISPONIBLE', 'ESTADO'], ['ESTADO', 'RESERVADA', 'RESERVADA', 'ESTADO'],
  ['ESTADO', 'RESERVADO', 'RESERVADA', 'ESTADO'], ['ESTADO', 'PRESTADA', 'PRESTADA', 'ESTADO'],
  ['ESTADO', 'PRESTADO', 'PRESTADA', 'ESTADO'], ['ESTADO', 'MAL ESTADO', 'MAL_ESTADO', 'ESTADO'],
  ['ESTADO', 'MAL_ESTADO', 'MAL_ESTADO', 'ESTADO'], ['ESTADO', 'DEVUELTA', 'DEVUELTA', 'ESTADO'],
  ['ESTADO', 'BAJA', 'BAJA', 'ESTADO'], ['ESTADO', 'AGOTADA', 'AGOTADA', 'ESTADO'],
  // Bodegas
  ['BODEGA', 'BQUS', 'BQUS', 'BODEGA'], ['BODEGA', 'BQEF', 'BQEF', 'BODEGA'], ['BODEGA', 'BQZ3', 'BQZ3', 'BODEGA'],
  // Departamentos
  ['DEPARTAMENTO', 'SOPORTE TN', 'SOPORTE TN', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'PARA UIO INSTALACIONES TN', 'SOPORTE TN', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'GIS', 'GIS', 'DEPARTAMENTO'], ['DEPARTAMENTO', 'PARA GIS UIO', 'GIS', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'PARA GIS UIO 2KM', 'GIS', 'DEPARTAMENTO'], ['DEPARTAMENTO', 'DEPARTAMENTO DE GIS', 'GIS', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'TENICOS DE GIS', 'GIS', 'DEPARTAMENTO'], ['DEPARTAMENTO', 'GIS OSCAR PINZON', 'GIS', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'OPU UIO', 'OPU UIO', 'DEPARTAMENTO'], ['DEPARTAMENTO', 'OPU', 'OPU UIO', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'PARA OPU', 'OPU UIO', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'PLANTA EXTERNA', 'PLANTA EXTERNA', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'PANTA EXTERNA', 'PLANTA EXTERNA', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'PLAMTA EXTERNA', 'PLANTA EXTERNA', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'PLANTA EXTERNA DIEGO PACHECO', 'PLANTA EXTERNA', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'SOTERRAMIENTO', 'SOTERRAMIENTO', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'SOTERAMIENTO', 'SOTERRAMIENTO', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'INTERURBANA', 'INTERURBANA', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'SOPORTE INTERURBANO', 'INTERURBANA', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'OERACIONES URBANA', 'OPERACIONES URBANA', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'OPERACIONES URBANA', 'OPERACIONES URBANA', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'FIBRA UIO', 'FIBRA UIO', 'DEPARTAMENTO'], ['DEPARTAMENTO', 'FIBRA UIUO', 'FIBRA UIO', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'LAN', 'LAN', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'BQZ2', 'BQZ2', 'BODEGA_REGIONAL'], ['DEPARTAMENTO', 'BQZ5', 'BQZ5', 'BODEGA_REGIONAL'],
  ['DEPARTAMENTO', 'BQZ6', 'BQZ6', 'BODEGA_REGIONAL'], ['DEPARTAMENTO', 'BOSD', 'BOSD', 'BODEGA_REGIONAL'],
  ['DEPARTAMENTO', 'BOES', 'BOES', 'BODEGA_REGIONAL'],
  ['DEPARTAMENTO', 'BODEGA', 'BODEGA', 'DEPARTAMENTO'], ['DEPARTAMENTO', 'BODEGA UIO', 'BODEGA', 'DEPARTAMENTO'],
  ['DEPARTAMENTO', 'BODEGA SANFERNANDO', 'BODEGA', 'DEPARTAMENTO'],
  // Valores que aparecen en DEPARTAMENTO pero no son departamentos
  ['DEPARTAMENTO', 'CRISTIAN CATOTA', '', 'PERSONA'], ['DEPARTAMENTO', 'DIEGO SUQUI', '', 'PERSONA'],
  ['DEPARTAMENTO', 'IVAN CHAVEZ', '', 'PERSONA'], ['DEPARTAMENTO', 'JOEL GONZALES', '', 'PERSONA'],
  ['DEPARTAMENTO', 'FIBRA EN MAL ESTADO', '', 'OBSERVACION'], ['DEPARTAMENTO', 'ATORIZO 1000 MTRS', '', 'OBSERVACION'],
  ['DEPARTAMENTO', 'NETCOMMERCE', '', 'CONTRATISTA'], ['DEPARTAMENTO', 'UIO-COACA', '', 'RUTA'],
  // Contratistas
  ['CONTRATISTA', 'QRTELCOM', 'QRTELCOM', 'CONTRATISTA'], ['CONTRATISTA', 'QRTELECOM', 'QRTELCOM', 'CONTRATISTA'],
  ['CONTRATISTA', 'QRTELCOOM', 'QRTELCOM', 'CONTRATISTA'], ['CONTRATISTA', 'QR TELECOM S.A.', 'QRTELCOM', 'CONTRATISTA'],
  ['CONTRATISTA', 'QR TELECOM', 'QRTELCOM', 'CONTRATISTA'],
  ['CONTRATISTA', 'ASTUREG', 'ASTUREG', 'CONTRATISTA'], ['CONTRATISTA', 'ASTURE', 'ASTUREG', 'CONTRATISTA'],
  ['CONTRATISTA', 'NETCOMMERCE', 'NETCOMMERCE', 'CONTRATISTA'], ['CONTRATISTA', 'NETCOMERCE', 'NETCOMMERCE', 'CONTRATISTA'],
  ['CONTRATISTA', 'FIBRA UIO', 'FIBRA UIO', 'AREA_INTERNA'], ['CONTRATISTA', 'OPU', 'OPU UIO', 'AREA_INTERNA'],
  ['CONTRATISTA', 'SOPORTE INTERURBANO', 'INTERURBANA', 'AREA_INTERNA'],
  ['CONTRATISTA', 'DEPARTAMENTO DE GIS', 'GIS', 'AREA_INTERNA'], ['CONTRATISTA', 'TENICOS DE GIS', 'GIS', 'AREA_INTERNA'],
  ['CONTRATISTA', 'GIS OSCAR PINZON', 'GIS', 'AREA_INTERNA'],
  ['CONTRATISTA', 'BQZ2', 'BQZ2', 'BODEGA_DESTINO'], ['CONTRATISTA', 'BQZ5', 'BQZ5', 'BODEGA_DESTINO'],
  ['CONTRATISTA', 'BPRG', 'BPRG', 'BODEGA_DESTINO'], ['CONTRATISTA', 'BCUE', 'BCUE', 'BODEGA_DESTINO'],
  ['CONTRATISTA', 'BOIM', 'BOIM', 'BODEGA_DESTINO'], ['CONTRATISTA', 'BOSD', 'BOSD', 'BODEGA_DESTINO'],
  ['CONTRATISTA', 'BOCO', 'BOCO', 'BODEGA_DESTINO'], ['CONTRATISTA', 'BORI', 'BORI', 'BODEGA_DESTINO'],
  ['CONTRATISTA', 'BPYU', 'BPYU', 'BODEGA_DESTINO'], ['CONTRATISTA', 'BOAM', 'BOAM', 'BODEGA_DESTINO'],
  ['CONTRATISTA', 'BOZ6', 'BQZ6', 'BODEGA_DESTINO'], ['CONTRATISTA', 'BODEGA', 'BODEGA', 'BODEGA_DESTINO'],
  ['CONTRATISTA', 'BODEGA ESMERALDAS', 'BOES', 'BODEGA_DESTINO'],
  ['CONTRATISTA', 'SANTO DOMINGO', 'SANTO DOMINGO', 'DESTINO'], ['CONTRATISTA', 'MANTA', 'MANTA', 'DESTINO'],
  ['CONTRATISTA', 'MACHALA', 'MACHALA', 'DESTINO'], ['CONTRATISTA', 'A LAGO AGRIO', 'LAGO AGRIO', 'DESTINO'],
  ['CONTRATISTA', 'PARA IBARRA', 'IBARRA', 'DESTINO'],
  ['CONTRATISTA', 'CRISTIAN CATOTA', '', 'PERSONA'], ['CONTRATISTA', 'VALDIVIESO ANDRES', '', 'PERSONA'],
  ['CONTRATISTA', 'VENTA JAN TOPIC', 'VENTA', 'VENTA'],
  ['CONTRATISTA', 'LIBERACION DE EDIFICOS MARCO SEVILLA', '', 'OBSERVACION'],
  ['CONTRATISTA', 'LIBERACION DE EDIFICIOS DANIEL HUILCA', '', 'OBSERVACION'],
  ['CONTRATISTA', 'NUEVAS RUTAS POR SATURACION.', '', 'OBSERVACION'], ['CONTRATISTA', 'ARIA DE FIBRA', '', 'OBSERVACION']
];
