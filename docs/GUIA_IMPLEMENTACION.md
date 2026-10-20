# Fibra Stock — Propuesta técnica y guía de implementación

Inventario de cable de fibra óptica por **serie de rollo** para las bodegas BQUS, BQEF y BQZ3.
Backend en **Google Apps Script**, base de datos en **Google Sheets**, interfaz en **GitHub Pages**.

Fecha de análisis: 13-10-2026 · Fuente: `FIBRA MATRIZ.csv` (386 filas, 17 columnas, 359 series distintas).

---

## 0. Resultado del análisis de la matriz

Al pasar la matriz por el motor de reglas (el mismo código que corre en Apps Script):

| Concepto | Resultado |
|---|---|
| Filas leídas | 386 (1 fila vacía de datos, 2 sin serie) |
| Series (rollos) | 361 (359 + 2 identificadores temporales `SIN-SERIE-F4`, `SIN-SERIE-F9`) |
| Movimientos generados | 621 → 349 ingresos iniciales, 240 despachos, 15 devoluciones inferidas, 7 préstamos, 10 cambios de estado / registros posteriores |
| Series repetidas | 24 filas: 15 por devolución, 6 con cambio de bodega, 2 registros posteriores, 1 por movimiento; **0 duplicados exactos** |
| Saldo de las series | 182 COMPLETO · 165 PENDIENTE DE CONCILIACIÓN · 4 NEGATIVO · 10 SIN INGRESO REGISTRADO |
| Alertas | 359 → 32 críticas, 254 de conciliación, 56 de formato, 7 de préstamos, 10 tareas de validación |
| Disponible confirmado | 78 403 m (BQZ3 72 684 · BQUS 3 714 · BQEF 2 005) |
| Disponible por conciliar | 22 209 m |
| Reservado | 91 769 m · En mal estado: 18 548 m |

Hallazgos que condicionan el diseño:

1. **Cada fila es una “foto” del rollo, no un movimiento.** `MTS INGRESO` es el metraje con el que el rollo estaba en bodega y `MTS SALIDA` lo que salió en esa fecha. Por eso el motor convierte cada fila en 1 o 2 movimientos (ingreso/devolución + despacho/préstamo).
2. **El mismo artículo tiene código distinto por bodega**: `10-08-01-180` (BQEF) y `US-08-01-180` (BQUS/BQZ3). Se agrupa por **familia** = código sin prefijo (`08-01-180`).
3. **La columna `CERTICACION` no contiene fechas**: tiene el usuario que certificó (JQUISPE 87, JRRODRIGUEZ 25…) y a veces texto (“SOBRANTE”, “DEVUELVE 3340 Y SALE 3340”). Las fechas de certificación aparecen en `OBSERVACION` o `CONTRATISTA` (9 casos). Se separan en `certificado_por` y `fecha_certificacion`.
4. **`CONTRATISTA` mezcla contratistas reales con códigos de bodega destino** (BQZ2 43 filas, BPRG, BCUE, BOIM…), ciudades, personas y fechas. Se clasifican por **clase** sin perder el valor original; los despachos a otra bodega generan alerta “posible traslado” (61).
5. **`DEPARTAMETO` contiene personas** (CRISTIAN CATOTA 23, DIEGO SUQUI 10, IVAN CHAVEZ…), observaciones (“FIBRA EN MAL ESTADO”, “ATORIZO 1000 MTRS”) y variantes (PANTA/PLAMTA EXTERNA, SOTERAMIENTO). 91 filas vacías.
6. **33 filas con estado DESPACHADA sin metraje de salida**: su saldo no se puede afirmar → quedan como `PENDIENTE_CONCILIACION` (no se asume que salió todo).
7. **24 filas con hilos distintos a la descripción** (p. ej. A232689 dice 48 H pero el código describe 144 F.O.) y 22 con span distinto.

---

## 1. Arquitectura recomendada

```
 Navegador (GitHub Pages)                 Google Apps Script (Web App)              Google Sheets
 ┌──────────────────────────┐  HTTPS POST ┌──────────────────────────────┐          ┌──────────────────┐
 │ index.html + app.js      │ ──────────▶ │ 04_Api.gs  doPost(action)    │          │ MATRIZ_ORIGINAL  │
 │ Chart.js · SheetJS       │ text/plain  │   ├ sesión (token 6 h)       │          │ MATRIZ_NORMALIZ. │
 │ 14 pantallas por rol     │ ◀────────── │   ├ LockService (escrituras) │  lee /   │ MOVIMIENTOS  ◀── fuente única
 │ modo demo (sin servidor) │   JSON      │ 02_Service.gs (reglas negocio)│ escribe  │ SERIES (calculada)│
 └──────────────────────────┘             │ 01_Engine.gs (cálculo puro)  │ ───────▶ │ PRESTAMOS …      │
                                          │ 03_SheetStore.gs (adaptador) │          │ ALERTAS BITACORA │
                                          │ 05_Setup.gs (menú, triggers) │          └──────────────────┘
                                          └──────────────────────────────┘
```

- **Una sola fuente de verdad: `MOVIMIENTOS`.** `SERIES` se recalcula a partir de ella después de cada escritura; el dashboard y los reportes nunca calculan sobre la matriz original.
- **El motor (`01_Engine`) y el servicio (`02_Service`) son JavaScript puro**: el mismo archivo corre en Apps Script y en el navegador (modo demo), y se prueba en Node. Lo específico de Google está aislado en `03_SheetStore`, `04_Api` y `05_Setup`.
- **Seguridad**: la Web App se ejecuta como el propietario; los usuarios no editan la hoja (protegida) sino que operan por la API con usuario y contraseña propios (hash SHA-256 con sal, token en `CacheService`, bloqueo tras 5 intentos).
- **CORS**: el frontend envía `POST` con `Content-Type: text/plain`, que Apps Script acepta sin preflight.

Límites a tener en cuenta (Apps Script, cuentas Workspace): 6 min por ejecución, ~30 ejecuciones simultáneas, 10 M celdas por hoja. Con ~600 movimientos/año el recálculo completo tarda segundos; si se superan ~50 000 movimientos conviene migrar a BigQuery o a una base SQL manteniendo el mismo motor.

---

## 2. Modelo de datos (hojas)

| Hoja | Clave | Contenido |
|---|---|---|
| `MATRIZ_ORIGINAL` | fila | La matriz pegada tal cual. Nunca se modifica (ediciones manuales se revierten). |
| `MATRIZ_NORMALIZADA` | fila | Cada fila con **valor original, valor normalizado, regla aplicada y confianza** (fecha, metraje, depto, contratista, certificación), clasificación de repetición y riesgo de duplicado, y los movimientos que generó. |
| `ARTICULOS` | codigo | código, familia, prefijo de bodega, descripción original/normalizada, hilos, span, tipo de cable, fabricante, unidad, stock mínimo, activo. |
| `SERIES` | id_serie | **Calculada**: serie original/normalizada, serie madre, código, metraje inicial, totales por tipo, consumo, saldo, estado, bodega y ubicación actual, reservado para, último movimiento, confiabilidad, tipo de saldo, estado de conciliación, alertas abiertas. |
| `MOVIMIENTOS` | id_movimiento | id, serie, código, serie derivada, fecha, tipo, metraje, signo, bodega origen/destino, ubicación, estado resultante, proyecto/ruta, depto (orig/norm), contratista (orig/norm), responsable, documento, documento de referencia, usuario, creado en, observación (orig/norm), evidencia, origen (IMPORTACION/APP), fila de origen, regla aplicada, confianza, estado de registro (ABIERTO/CERRADO/ANULADO), aprobación, aprobado por, id vinculado. |
| `PRESTAMOS` | id_prestamo | serie, código, metraje prestado/devuelto, diferencia, responsable, contratista, depto, proyecto, fechas (préstamo, límite, devolución), estado calculado, estado manual, documento, observaciones, movimientos vinculados. |
| `SOBRANTES` | id_sobrante | serie, proyecto original, documento de despacho, despachado/utilizado/sobrante/devuelto, fecha, condición, bodega receptora, nuevo proyecto, estado (PENDIENTE_CUANTIFICAR/DECLARADO/RECIBIDO/RECHAZADO). |
| `ALERTAS` | id_alerta (+ clave única) | tipo, categoría, severidad, serie, movimiento, fila, campo, valor encontrado/esperado, descripción, estado, responsable, fechas y comentario de resolución, dinámica (SI/NO). |
| `RELACIONES` | serie | serie → serie madre, tipo (POSIBLE_DERIVADA/CORTE/MANUAL), estado (SUGERIDA/CONFIRMADA/RECHAZADA). |
| `CATALOGOS` | catálogo + valor original | valor normalizado y **clase real** (DEPARTAMENTO, PERSONA, BODEGA_DESTINO, DESTINO, OBSERVACION…). |
| `PARAMETROS` | clave | umbral de saldo bajo, días de aviso de préstamo, correos, lead time, días de seguridad, cobertura objetivo, URL de la app. |
| `ABASTECIMIENTO_PARAM` | familia | stock mínimo, tiempo de reposición, días de seguridad, factor de temporada, prioridad. |
| `USUARIOS` | email | nombre, rol, activo, sal, hash, fechas. |
| `BITACORA` | id | fecha-hora, usuario, acción, tabla, registro, campo, antes, después, detalle. |

Formato: las columnas de texto, fechas y documentos se escriben como **texto plano** (evita que Sheets convierta `05-12-2022` o `484318905`); metrajes y saldos como número. Fechas internas en ISO `AAAA-MM-DD`.

---

## 3. Reglas de cálculo de inventario

**Saldo por serie** (solo movimientos vigentes: no anulados y aprobados o que no requieren aprobación):

```
Saldo = Ingresado (inicial + adicional + apertura + corte recibido)
      + Devuelto (devoluciones + sobrantes recibidos)
      + Devuelto de préstamo
      − Despachado − Prestado − Baja − Corte entregado ± Ajuste autorizado
```

Los traslados no cambian el saldo de la serie: cambian su **bodega actual** (el stock por bodega se calcula con la bodega actual de cada serie).

**Consumo efectivo** = despachado − devoluciones vinculadas a ese despacho (se imputa a la fecha, departamento, contratista y ruta del despacho).

**Tipo de saldo** (nunca se convierte un negativo en cero):

| Tipo | Condición |
|---|---|
| `SIN_INGRESO_REGISTRADO` | tiene salidas pero ningún ingreso |
| `NEGATIVO` | saldo < 0 |
| `PENDIENTE_CONCILIACION` | tiene alertas críticas o de conciliación abiertas |
| `ESTIMADO` | algún movimiento fue inferido (confianza media/baja) |
| `COMPLETO` | todo lo anterior en falso |

El dashboard separa **Disponible confirmado** (COMPLETO/ESTIMADO) de **Disponible por conciliar**.

**Estado actual** = estado resultante del último movimiento, corregido por el saldo: saldo < 0 → EN_CONCILIACION; préstamo abierto y saldo 0 → PRESTADA; baja y saldo 0 → BAJA; saldo 0 con estado disponible/reservado → AGOTADA; saldo > 0 tras un despacho parcial → DISPONIBLE.

---

## 4. Flujos de ingreso, despacho y devolución

**Importación histórica (cada fila de la matriz, en orden cronológico por serie):**

1. Si es la primera aparición y tiene `MTS INGRESO` → `INGRESO_INICIAL`.
2. Si reaparece con ingreso **después de un despacho/préstamo que dejó saldo 0** → `DEVOLUCION` (o `DEVOLUCION_DE_PRESTAMO`) vinculada al último despacho; consumo preliminar = despachado − devuelto; alerta “devolución inferida” para validar.
3. Si reaparece con el **mismo saldo**: en la misma bodega → registro posterior; en otra bodega → `TRASLADO_ENTRE_BODEGAS` inferido.
4. Si reaparece con **otro metraje mientras aún tenía saldo** → no se inventa movimiento; alerta “reaparición con saldo” (y “serie en dos bodegas” si cambió de bodega).
5. Si tiene `MTS SALIDA` → `DESPACHO` (o `PRESTAMO` si el estado es PRESTADA), validando saldo, documento, departamento, ruta y contratista.
6. Estado DESPACHADA sin salida → alerta y saldo pendiente de conciliación.
7. Observaciones de texto libre → tareas de validación (nunca movimientos automáticos).
8. Filas idénticas → no generan movimiento y se marcan como duplicado accidental.

**Operación diaria (pantallas):**

- **Ingreso**: serie nueva + código existente + metraje + bodega. Si la serie ya existe se rechaza y se sugiere INGRESO_ADICIONAL, DEVOLUCIÓN o SOBRANTE.
- **Despacho**: obligatorio documento, departamento y ruta (no puede ser “STOCK BODEGA”); la serie debe estar en la bodega de origen, no en MAL_ESTADO/BAJA/AGOTADA, sin saldo negativo; si el metraje supera el saldo se **rechaza y se crea alerta crítica**.
- **Devolución**: se elige el despacho original (o “sin referencia” → alerta de conciliación). Si la devolución supera lo pendiente del despacho se rechaza con alerta crítica. Se muestra en vivo: *despachado 1 000 m · devuelto 376 m → consumo efectivo 624 m*.
- **Baja y ajuste**: quedan `PENDIENTE` hasta que un supervisor (distinto de quien registró) los aprueba; al aprobar se vuelve a validar el saldo.
- **Correcciones**: un movimiento cerrado no se edita; el administrador lo **anula** con motivo y se registra uno nuevo. Todo queda en la bitácora.

---

## 5. Tratamiento de series repetidas

Para cada fila repetida se calcula un **riesgo de duplicado** = % de campos iguales entre 10 (fecha, código, ingreso, salida, estado, documento, ruta, contratista, observación, bodega) contra la fila más parecida previa de la misma serie.

| Clasificación | Regla | Casos en la matriz |
|---|---|---|
| Duplicado accidental | 100 % igual → no genera movimiento | 0 |
| Posible duplicado | ≥ 70 % o fechas con día/mes invertidos → alerta para revisar | 2 (C220370TN01, A221663-415-001) |
| Repetición por devolución | reaparece tras quedar en saldo 0 | 15 |
| Repetición por traslado / cambio de bodega | otra bodega | 6 |
| Registro posterior | mismo saldo, misma bodega | 2 |
| Serie derivada (familia) | misma raíz (`B250459` → `B250459-1-001`) → **sugerencia**, no fusión | 21 sugerencias |

La regla de raíz: letra + 5–6 dígitos al inicio (`C220370TN01` → `C220370`; `C200430-TN02` → familia de `C200430-TN01`). Las series `10-SEG-…` son su propia raíz. Un analista confirma o rechaza la relación en *Historial fibra*; los cortes registrados desde la app crean la relación confirmada automáticamente.

En la operación diaria **no se bloquea una serie repetida** si el usuario elige el tipo de movimiento correcto; solo se bloquea el duplicado exacto (misma serie, tipo, metraje, documento y fecha, o el mismo documento despachando dos veces el mismo metraje), salvo que se escriba una justificación (que queda registrada y genera alerta crítica para revisión).

---

## 6. Dashboard

Filtros: rango de fechas, bodega, código/familia, descripción, hilos, span, estado, departamento, contratista, ruta. Los filtros de serie (bodega, código, hilos, span, estado) afectan stock y flujos; los de movimiento (fechas, depto, contratista, ruta) afectan flujos y consumo.

Indicadores: disponible confirmado, disponible por conciliar, despachado y devuelto del periodo, prestado pendiente, reservado, mal estado, rollos activos, series con saldo negativo, series por conciliar, préstamos vencidos, préstamos sin fecha límite, rollos con saldo bajo.

Gráficos: stock por bodega e hilos (apilado confirmado/por conciliar), tendencia mensual de despachos, devoluciones y consumo efectivo, stock por código, saldo por estado, consumo por departamento, contratista y top 10 proyectos; tablas de saldos negativos, mal estado y saldo bajo. Agrupación por código → serie → hilos → span → estado normalizado, nunca solo por texto de descripción.

---

## 7. Historial fibra

Búsqueda por serie, código, descripción, hilos, bodega, documento, proyecto o contratista (la búsqueda por documento recorre todos los movimientos). Muestra: datos actuales, metraje inicial, total despachado, devuelto, consumo calculado, prestado, baja, saldo, estado, bodega, confiabilidad; **línea de tiempo con el saldo acumulado tras cada movimiento** (con regla aplicada, confianza, usuario y fila de origen); consumo por despacho; rutas, documentos y observaciones; alertas; préstamos y sobrantes; familia del rollo con botón para confirmar/rechazar la relación; y las filas originales de la matriz con su valor original y normalizado.

---

## 8. Sistema de alertas

Cada alerta guarda: tipo, categoría, severidad, serie, movimiento, fila, campo, valor encontrado, valor esperado, descripción, estado (ABIERTA → EN_REVISION → RESUELTA / DESCARTADA; RESUELTA_AUTO cuando una alerta dinámica deja de cumplirse), responsable, fecha y comentario de resolución.

- **Críticas**: salida mayor al ingreso, saldo negativo, salida sin ingreso, devolución mayor al despacho, mismo documento despachando dos veces la misma serie y metraje, disponible y dado de baja, intento de dejar saldo negativo.
- **Conciliación**: serie en dos bodegas, reaparición con saldo, devolución inferida o sin referencia, DESPACHADA sin salida, despacho con ruta STOCK BODEGA, préstamo sin responsable, observación de devolución sin metraje, sobrante sin cantidad, documento vacío, contratista no registrado, departamento vacío, estado que no coincide, posible traslado, posible serie derivada, serie vacía, registro incompleto, saldo bajo.
- **Formato**: metraje ambiguo o como texto, fecha inválida/imposible/futura/formato mixto, fecha guardada en campo de texto, certificación futura, hilos o span distintos a la descripción.
- **Préstamos**: sin fecha límite, vencido, por vencer, diferencia prestado/devuelto, prestada que reaparece disponible.
- **Tareas**: textos libres que mencionan préstamo, devolución o salida.

Permisos: el analista revisa (EN_REVISION) pero no cierra; administrador y supervisor cierran; las **críticas solo las cierra un supervisor o administrador** con comentario obligatorio. Las alertas dinámicas (saldo negativo, préstamos, saldo bajo) se recalculan tras cada escritura y cada mañana.

---

## 9. Validaciones de calidad de datos

| Dato | Regla | Se guarda |
|---|---|---|
| Metraje `4009` | entero | valor, regla ENTERO, confianza ALTA |
| Metraje `3.156` (C261362) | punto con 3 dígitos = separador de miles → 3 156 | original `3.156`, interpretado 3156, regla PUNTO_COMO_SEPARADOR_DE_MILES, confianza MEDIA, **revisión manual** |
| Metraje `500 m` | número + unidad | regla TEXTO_CON_UNIDAD, confianza MEDIA |
| Fecha `12-05-2022` | DD-MM-AAAA | ISO 2022-05-12, confianza ALTA |
| Fecha `13-25-2026` | imposible como DD-MM → se prueba MM-DD | regla MES_DIA_ANIO_INVERTIDO, confianza BAJA, alerta |
| Fecha posterior a hoy | — | alerta FECHA_FUTURA |
| Departamento `PLAMTA EXTERNA` | catálogo exacto | original PLAMTA EXTERNA → PLANTA EXTERNA |
| Contratista `QRTELCOOM` | catálogo / Levenshtein ≤ 2 | → QRTELCOM, regla y confianza |
| Departamento `CRISTIAN CATOTA` | clase PERSONA | departamento vacío + alerta; la persona se usa como responsable sugerido |

En la app, los metrajes ambiguos se rechazan (“ingréselo sin separadores de miles”) y las fechas futuras también. Los números se muestran con espacio fino como separador de miles (`3 156 m`) para no reintroducir la ambigüedad de punto/coma.

---

## 10. Préstamos y sobrantes

**Préstamos**: responsable y fecha límite obligatorios (se sugiere +15 días). Estados calculados: ACTIVO, DEVUELTO_COMPLETO, DEVUELTO_PARCIAL, VENCIDO, PENDIENTE_DE_CONCILIACION (sin fecha límite o sin responsable); el supervisor puede fijar PERDIDO o CONSUMIDO_EN_OBRA. Devolución de préstamo vinculada al préstamo; no se acepta devolver más de lo prestado.
Los 7 préstamos de la matriz quedaron en PENDIENTE_DE_CONCILIACION (ninguno tiene fecha límite). Responsables extraídos: CRISTIAN CATOTA (A260177), IVAN CHAVEZ (C261107, C261390), LUIS MORENO (C260931, de “PRESTAMO AL LUIS MORENO”), JUAN YEPEZ (C261384); sin responsable: B260094 y A261001 (“PARA IBARRA”).

**Sobrantes**: se declaran contra un despacho (sobrante, utilizado, nuevo proyecto) **sin afectar el stock**; entran al stock solo al **confirmar la recepción física** con condición (BUENA → DISPONIBLE; DAÑADA/REQUIERE_INSPECCION → MAL_ESTADO). Despachado 4 000 m y sobrante 1 600 m → consumo preliminar 2 400 m. Sobrante mayor al despacho → rechazo + alerta crítica. Los 3 “SOBRANTE” sin cantidad de la matriz (B251889, B252089, B251464) se crearon como PENDIENTE_CUANTIFICAR.

---

## 11. Reportes automáticos

En la pantalla Reportes, exportables a **Excel** (SheetJS), **PDF** (impresión con estilos de impresión) y **Google Sheets** (crea una hoja nueva compartida con el usuario):

- **Inventario**: por bodega, código, estado y serie, con disponible, reservado, prestado, comprometido (reservado + prestado), mal estado, en conciliación y negativo.
- **Consumo**: por mes (despachado, devuelto, consumo), año, hilos, departamento, contratista y ruta.
- **Excepciones**: saldos negativos, salidas sin ingreso, salidas mayores, devoluciones mayores, documentos duplicados, posibles duplicados, estados contradictorios, fechas inválidas, metrajes ambiguos, préstamos vencidos/sin fecha, sobrantes sin cuantificar, saldo bajo.
- **Material no utilizable**: serie, código, descripción, bodega, metraje, estado, motivo, fecha, responsable y acción recomendada (≥ 1 500 m inspección/reparación, ≥ 300 m inspección, menor → baja; ajustable).

Automáticos: **resumen diario por correo** (06:45) con críticas, negativos, préstamos vencidos y por vencer; **reporte semanal** (lunes 07:00) en una hoja nueva con inventario, consumo, excepciones y proyección.

---

## 12. Proyección de abastecimiento

Por familia de artículo: consumo promedio mensual (12 m), últimos 3 y 6 meses, consumo diario = prom. 3 m ÷ 30 × factor de temporada, stock disponible, reservado, mínimo,

```
Días de cobertura  = disponible ÷ consumo diario
Fecha de agotamiento = hoy + días de cobertura
Punto de reorden   = consumo diario × (tiempo de reposición + días de seguridad) + stock mínimo
Compra sugerida    = máx(0, punto de reorden + consumo diario × días de cobertura objetivo − disponible), redondeada a 100 m
```

Ajustables por familia: stock mínimo, tiempo de reposición, nivel de seguridad, factor de temporada y prioridad. **No genera órdenes de compra**: muestra una recomendación “requiere aprobación”.

Con los datos actuales (lead time 45 d, seguridad 15 d, cobertura objetivo 60 d):

| Familia | Consumo prom. 3 m | Disponible | Reservado | Cobertura | Punto de reorden | Sugerido |
|---|---|---|---|---|---|---|
| 08-01-180 (ADSS 144H span 120) | 25 944 m/mes | 2 297 m | 50 622 m | **3 días** | 51 888 m | 101 500 m |
| 08-01-050 (ADSS 6H span 120) | 8 598 m/mes | 2 005 m | 15 294 m | **7 días** | 17 197 m | 32 400 m |
| 105-220-003 (ADSS 48H span 250) | 4 911 m/mes | 13 300 m | 20 083 m | 81 días | 9 822 m | 6 400 m |

Lectura: el 144H y el 6H están casi todo **reservado**; el disponible libre no cubre una semana. Esto es una alerta operativa a validar con compras, no una orden.

---

## 13. Automatizaciones en Google Sheets / Apps Script

| Requisito | Implementación |
|---|---|
| Campos obligatorios, listas desplegables | validación en el servicio + selects/datalists en la app desde `CATALOGOS` |
| Normalizar estados, bodegas, deptos, contratistas | `FS.Catalog` (exacto + Levenshtein ≤ 2), conserva original y regla |
| Usuario y timestamp | `usuario`, `creado_en` en cada movimiento; `BITACORA` |
| ID único | `MOV-000001`… con secuencia en `PropertiesService` dentro de `LockService` |
| Saldos por serie | `recalc()` tras cada escritura y diario |
| Alertas automáticas | importación + validación + alertas dinámicas |
| Proteger fórmulas / hojas | no hay fórmulas: todo se calcula en script; `protegerHojas()` deja solo al propietario |
| Impedir modificar movimientos cerrados | activador `auditarEdicion` revierte la edición y la registra; correcciones por anulación |
| Bitácora | `BITACORA` (API + ediciones manuales) |
| Correo de alertas | `tareaDiaria` → `enviarResumenAlertas` |
| Reportes periódicos | `reporteSemanal` |
| Vista Historial fibra | pantalla + `rollLife` |
| Marcar conciliación | `estado_saldo` / `estado_conciliacion` en SERIES |
| Evitar duplicados exactos / permitir repeticiones justificadas | `duplicateCheck` con campo justificación |

---

## 14. Roles y permisos

| Permiso | ADMIN | SUPERVISOR | BODEGA | ANALISTA | CONSULTA |
|---|---|---|---|---|---|
| Consultar inventario, historial fibra, alertas | ✔ | ✔ | ✔ | ✔ | ✔ |
| Registrar ingresos, despachos, devoluciones, préstamos, sobrantes, traslados, cortes | ✔ | ✔ | ✔ | — | — |
| Solicitar baja / ajuste | ✔ | ✔ | ✔ | — | — |
| Aprobar baja / ajuste, fijar préstamo perdido/consumido | ✔ | ✔ | — | — | — |
| Revisar alertas (EN_REVISION) | ✔ | ✔ | ✔ | ✔ | — |
| Cerrar alertas (críticas: solo ADMIN/SUPERVISOR) | ✔ | ✔ | — | — | — |
| Confirmar familias de rollo | ✔ | ✔ | — | ✔ | — |
| Reportes y exportación | ✔ | ✔ | ✔ | ✔ | ✔ |
| Parámetros y abastecimiento | ✔ | ✔ | — | — | — |
| Catálogos y artículos | ✔ | — | — | — | — |
| Anular movimientos | ✔ | — | — | — | — |
| Usuarios | ✔ | — | — | — | — |
| Bitácora | ✔ | ✔ | — | ✔ | ✔ |

Nadie aprueba su propio movimiento (salvo ADMIN). Los permisos se validan en el servidor; la interfaz solo oculta lo que el rol no puede usar.

---

## 15. Paso a paso de implementación

### Paso 1 — Crear la hoja de cálculo y el script
1. En Google Drive (cuenta corporativa) cree una hoja nueva: **“Fibra Stock - BD”**.
2. Menú **Extensiones › Apps Script**. Se abre un proyecto vinculado a la hoja.
3. En el editor, borre `Código.gs` y cree 6 archivos de script con los nombres y el contenido de la carpeta `backend/`:
   `00_Config`, `01_Engine`, `02_Service`, `03_SheetStore`, `04_Api`, `05_Setup` (el orden importa: Apps Script los carga alfabéticamente).
4. En **Configuración del proyecto** marque “Mostrar el archivo de manifiesto appsscript.json” y reemplace su contenido por `backend/appsscript.json` (zona horaria America/Guayaquil, V8).
5. Guarde. *(Alternativa con terminal: `npm i -g @google/clasp`, `clasp login`, copie `.clasp.json.example` a `.clasp.json` con el ID del script y ejecute `clasp push` dentro de `backend/`.)*

### Paso 2 — Crear la estructura
1. Recargue la hoja: aparece el menú **Fibra Stock**.
2. **Fibra Stock › 1. Crear estructura**. La primera vez Google pide autorizar el script (Hojas de cálculo, enviar correo, activadores): acepte con la cuenta propietaria.
3. Se crean las 14 hojas con encabezados, catálogos semilla y parámetros.

### Paso 3 — Crear el administrador
**Fibra Stock › 2. Crear / restablecer administrador** → correo (p. ej. mcajas@telconet.ec) y contraseña inicial de 8+ caracteres.

### Paso 4 — Cargar e importar la matriz
1. Abra la hoja `MATRIZ_ORIGINAL`, celda A1.
2. **Archivo › Importar › Subir** `FIBRA MATRIZ.csv` → “Reemplazar hoja actual”, separador **coma**, y **desmarque “Convertir texto en números, fechas y fórmulas”** (esto conserva `3.156`, `05-12-2022` y los documentos tal como están).
3. **Fibra Stock › 3. Importar matriz histórica**. En segundos verá: *386 filas → 621 movimientos, 361 series, ~330 alertas* (las dinámicas se suman en el recálculo).
4. Revise `MATRIZ_NORMALIZADA`, `MOVIMIENTOS`, `SERIES` y `ALERTAS`.

**Alternativa — leer la matriz directo desde Google Sheets.** En vez de los pasos 1–2, use **Fibra Stock › Configurar origen de la matriz (Google Sheets)** y pegue el enlace de la hoja con la pestaña de la matriz abierta (debe incluir `#gid=…`). El enlace se guarda en `PARAMETROS` como `MATRIZ_URL`. Desde entonces, **3. Importar matriz histórica** lee esa pestaña (valores tal como se ven), la copia en `MATRIZ_ORIGINAL` como respaldo y la procesa. La hoja **no necesita ser pública**: basta con que la cuenta que ejecuta el script tenga acceso. La primera vez, Apps Script pedirá autorizar el acceso a otras hojas de cálculo. Para volver al flujo manual, deje el enlace vacío.

En el **modo demo**, la pantalla de ingreso también permite pegar un enlace de Google Sheets. Como lo descarga el navegador, la hoja debe estar compartida como “Cualquier persona con el enlace”.

### Paso 5 — Publicar la API
1. En el editor: **Implementar › Nueva implementación › Tipo: Aplicación web**.
2. Descripción “API v1”; **Ejecutar como: Yo**; **Quién tiene acceso: Cualquier usuario** (la API exige usuario y contraseña propios de la app). Si la política de Google Workspace de su dominio no permite esta opción, la llamada desde GitHub Pages no funcionará (Google redirige al login y el navegador bloquea la respuesta); en ese caso pida al administrador de Workspace habilitar el acceso “Cualquier usuario” para Apps Script o sirva el mismo HTML desde Apps Script con `HtmlService`.
3. Copie la **URL de la aplicación web** (termina en `/exec`). Pruébela en el navegador con `?action=ping`: debe responder `{"ok":true,…}`.
4. Cada vez que cambie el código: **Implementar › Administrar implementaciones › Editar › Versión: nueva** (la URL no cambia).

### Paso 6 — Publicar el frontend en GitHub Pages
1. Cree un repositorio (p. ej. `fibra-stock`), **privado si su plan lo permite** (GitHub Pages en repos privados requiere GitHub Pro/Team/Enterprise; en público el código es visible, los datos no).
2. Suba el proyecto completo a la rama `main` (el `.gitignore` excluye `data/`, CSV y XLSX).
3. Edite `frontend/js/config.js` y pegue la URL del paso 5 en `API_URL`.
4. **Settings › Pages › Build and deployment › Source: GitHub Actions**. El workflow `.github/workflows/pages.yml` publica la carpeta `frontend/` en cada push a `main`. En 1–2 minutos la app queda en `https://<usuario>.github.io/<repositorio>/`.
5. **No suba la matriz CSV ni exportaciones al repositorio**: los datos viven solo en Google Sheets.

### Paso 7 — Activadores, protección y usuarios
1. Hoja `PARAMETROS`: complete `CORREOS_ALERTAS` y `URL_APP`.
2. **Fibra Stock › 4. Instalar activadores** (correo diario 06:45, reporte semanal lunes, auditoría de ediciones).
3. **Fibra Stock › 5. Proteger hojas** (solo el propietario edita; los demás operan por la app).
4. Ingrese a la app como administrador › **Usuarios** y cree las cuentas por rol.

### Paso 8 — Prueba de aceptación (30 minutos)
- Buscar `B260716`, `C260219`, `10-SEG-20260624-0026` y comparar con la matriz (ver sección 16).
- Registrar un despacho de prueba con un usuario BODEGA; intentar despachar más del saldo (debe rechazar y crear alerta crítica).
- Registrar una devolución parcial y verificar el consumo calculado.
- Solicitar una baja con BODEGA y aprobarla con SUPERVISOR.
- Editar a mano una celda de `MOVIMIENTOS`: debe revertirse y aparecer en la bitácora.
- Al terminar, anular los movimientos de prueba.

**Modo demo**: si `API_URL` está vacío, la app permite cargar el CSV en el navegador y probar todas las pantallas con cualquier rol, sin servidor (los datos quedan solo en ese navegador).

### Paso 9 — Transición y corte desde la hoja de trabajo anterior
Mientras la aplicación está en evaluación, el equipo puede seguir anotando en la hoja de cálculo que usaba hasta ahora. La app se mantiene al día importando la matriz desde esa hoja. Cuando la aplicación se aprueba, se hace una importación final y, desde entonces, todo se registra en la app.

**Preparación (una sola vez)**
1. En la hoja de trabajo anterior: **Compartir** → agregue la cuenta propietaria del script como **Lector**. La hoja no necesita ser pública.
2. En la hoja de la base de datos: **Fibra Stock › Configurar origen de la matriz (Google Sheets)** → pegue el enlace de la pestaña de la matriz de la hoja anterior (con `#gid=…`).

**Durante la transición**
- Para ver los datos al día: **Fibra Stock › 3. Importar matriz histórica**. Es un solo paso y se puede repetir las veces que haga falta.
- **Registre los movimientos solo en la hoja anterior.** Use la app para consultar, revisar alertas y sacar reportes. Un movimiento anotado en ambos lados se cuenta dos veces.
- **No concilie alertas ni préstamos importados todavía.** Cada importación regenera las alertas y los préstamos que vienen de la matriz, y su estado vuelve al inicial. Los movimientos registrados desde la app sí se conservan siempre.

**Día del corte (aprobación de la app)**
1. Avise al equipo que deje de anotar en la hoja anterior.
2. Ejecute **Fibra Stock › 3. Importar matriz histórica** por última vez y confirme en **Bitácora** el resumen (*filas → movimientos, series, alertas*).
3. Deje la hoja anterior en **solo lectura** (Compartir → todos como Lector) para que nadie siga anotando ahí.
4. **Desconecte el origen:** **Fibra Stock › Configurar origen de la matriz** → deje el enlace vacío. Así nadie reimporta por error: una reimportación no borra lo registrado en la app, pero reinicia las alertas y los préstamos conciliados.
5. Desde ese momento, todos los movimientos se registran y consultan en la app. Ya puede iniciar la conciliación histórica (sección 18).

---

## 16. Ejemplos con registros reales

**B260716 — el caso 4 006 m / 2 376 m.** La fila del 08-04-2026 en BQEF dice ingreso 4 006 y salida 2 376. Lectura literal del motor: *despacho de 2 376 m, quedan 1 630 m*. El 02-06-2026 la serie aparece en BQUS con 1 530 m y salida 100 m. Resultado: saldo 1 530 m, alertas “reaparición con saldo” (1 530 declarados vs 1 630 calculados: faltan 100 m) y “serie en dos bodegas”. La lectura alternativa (“se despacharon 4 006 y regresaron 2 376”, consumo 1 630) **no se puede afirmar desde la fila**: por eso queda pendiente de conciliación con la guía física, en lugar de corregirse en silencio.

**C260219 — despacho, devolución y nuevo despacho.**
```
2025-12-18 Ingreso inicial   +4 010 m  BQEF      saldo 4 010
2025-12-18 Despacho          −4 010 m  doc 499841205 (QRTELCOM)   saldo 0
2026-05-25 Devolución        +3 320 m  recibida en BQUS, ref. 499841205   saldo 3 320
2026-05-25 Despacho          −3 320 m  doc 512761705 (CRISTIAN CATOTA)    saldo 0
Consumo del primer despacho: 4 010 − 3 320 = 690 m
```
La serie `C260219-TN01` (salida de 1 123 m el 22-08-2026 sin ingreso) queda como **salida sin ingreso** y como posible derivada de C260219.

**Casos de referencia de salida mayor al ingreso** (marcados, no corregidos):

| Serie | Ingreso | Salida | Saldo | Alertas |
|---|---|---|---|---|
| 10-SEG-20260624-0026 | 338 | 448 | −110 | SALIDA_MAYOR_INGRESO, SALDO_NEGATIVO, DESPACHO_RUTA_STOCK |
| A261645 | 2 005 | 2 025 | −20 | SALIDA_MAYOR_INGRESO, SALDO_NEGATIVO |
| C70394-TN01 | 519 | 549 | −30 | SALIDA_MAYOR_INGRESO, SALDO_NEGATIVO, DESPACHO_RUTA_STOCK |

**A221663-415-001** — despachada el 20-11-2024 y el 28-11-2024 con el **mismo documento 484318905 y 415 m** → alerta crítica DOC_DESPACHO_DUPLICADO + posible duplicado (riesgo 90 %).

**C220370TN01** — filas del 12-05-2022 y 05-12-2022 con 487/487 m: fechas con **día y mes invertidos** → posible duplicado; además sugerida como derivada de C220370.

**A232689** — despachada 438 m en 2024 desde BQEF; reaparece en 2026 en BQUS con 684 m → devolución mayor al despacho (crítica) y hilos 48 H contra descripción 144 F.O.

**C261362** — salida `3.156` interpretada como 3 156 m (confianza media, revisión manual) y sin ingreso previo: saldo −3 156.

**B260671** — en `CERTICACION` dice “DEVUELVE 3340 Y SALE 3340”: se crea una **tarea de validación** con 3 340 m; no se registra devolución automática.

**C261384** — “JUAN YEPEZ PRESTA A BODEGA 527 M HAY QUE DEVOLVER”: préstamo con responsable JUAN YEPEZ extraído del texto, tarea de validación y alerta de préstamo sin fecha límite.

**B250459 / B250459-1-001** (BQZ3, 281 m y 492 m) — sugeridos como familia, no fusionados.

---

## 17. Supuestos y limitaciones

1. `MTS INGRESO` es el metraje del rollo al momento del registro y `MTS SALIDA` lo despachado ese día; una salida menor al ingreso se toma como despacho parcial.
2. Una reaparición con ingreso después de quedar en saldo 0 se interpreta como devolución (confianza media, siempre con alerta).
3. Formato de fecha predominante DD-MM-AAAA. Un valor como `3.156` se interpreta como miles (no hay metrajes con decimales en la matriz).
4. Los códigos `10-` y `US-` con el mismo sufijo son el mismo artículo (familia).
5. Las filas de 07-01-2026 en BQZ3 (88) parecen un levantamiento físico; se importaron como ingreso inicial. Si fue un inventario de apertura formal, puede reclasificarse.
6. Los saldos de 165 series quedan **pendientes de conciliación**; el disponible confirmado es la cifra operativa hasta conciliar.
7. Sin código de barras / QR en esta versión; la evidencia se adjunta como enlace a Drive.
8. Apps Script: tiempos de respuesta de 1–3 s por operación y cuotas diarias de correo (100/día en cuentas gratuitas, 1 500 en Workspace).
9. La reimportación reemplaza los movimientos importados y conserva los creados desde la app; si un movimiento de la app quedó vinculado a uno importado, revisar el vínculo tras reimportar.
10. Si el repositorio de GitHub es público, el código y la URL de la API son visibles; la protección está en el login. Nunca publique datos en el repositorio.

---

## 18. Recomendaciones para iniciar la conciliación histórica

Orden sugerido (de mayor impacto a menor), usando *Alertas* filtrado por tipo:

1. **Saldos negativos y salidas sin ingreso** (14 + 11): buscar la guía de ingreso o el inventario de apertura; registrar `INVENTARIO_INICIAL_DE_APERTURA` o un ajuste autorizado. Un supervisor cierra la alerta con comentario.
2. **DESPACHADA sin salida** (33): confirmar con el documento si salió todo el rollo; registrar el despacho faltante o cambiar el estado.
3. **Reapariciones con saldo / serie en dos bodegas** (6 + 5): conteo físico de esas series en BQEF y BQUS.
4. **Préstamos** (7): completar responsable y fecha límite; decidir si siguen activos, fueron devueltos o se consumieron.
5. **Devoluciones mayores al despacho y documento duplicado** (2 + 1).
6. **Sobrantes sin cantidad** (3) y **tareas de texto** (10).
7. **Posibles traslados** (61 despachos a BQZ2, BPRG, BCUE…): definir con logística si esos envíos son traslados a bodegas regionales (siguen siendo inventario de la empresa) o consumo; si son traslados, crear las bodegas regionales en el catálogo.
8. **Catálogos**: completar departamentos y contratistas faltantes, y marcar personas como responsables.
9. **Familias de rollo** (21 sugerencias) y **hilos/span distintos a la descripción** (24 + 22): corregir el artículo o el dato.
10. Hacer un **conteo físico por bodega** (empezando por BQZ3, que concentra 72 684 m disponibles) y registrar las diferencias como ajustes aprobados. Desde ese día, todo movimiento entra por la app y la matriz deja de editarse.

Meta práctica: llevar “series por conciliar” de 179 a menos de 20 antes de usar la proyección de abastecimiento para compras.
