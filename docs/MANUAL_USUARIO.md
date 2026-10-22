# Manual de usuario — Fibra Stock

Guía para consultar y operar el inventario de fibra óptica por serie. La organización de este manual sigue las pantallas, rutas y relaciones de llamadas identificadas por Graphify en `frontend/js/app.js`, `frontend/js/api.js` y el núcleo compartido. Los procedimientos se contrastaron con las reglas funcionales documentadas en `GUIA_IMPLEMENTACION.md`.

## 1. Acceso

### Aplicación de producción

1. Abra la URL de Fibra Stock que le proporcionó su administrador.
2. Ingrese el correo y la contraseña asignados.
3. Si aparece un mensaje de sesión vencida, vuelva a iniciar sesión.
4. Use **Cambiar contraseña** para actualizar su clave cuando sea necesario.

Las opciones disponibles dependen de su rol. Si una pantalla o acción no aparece, solicite al administrador que revise sus permisos.

### Modo demo

El modo demo se habilita cuando la aplicación no tiene configurada una API de producción. Permite cargar una matriz CSV, elegir un rol de prueba y recorrer las pantallas; los datos quedan en el almacenamiento local del navegador y no se envían a Google Sheets.

Use únicamente archivos autorizados para pruebas. No trate la demo como un registro oficial ni use el navegador compartido para datos de inventario reales. **Borrar datos de la demo** elimina la copia local de ese navegador.

## 2. Navegación

El menú lateral organiza las tareas. Algunas opciones solo aparecen para roles autorizados.

| Pantalla | Para qué sirve |
|---|---|
| **Dashboard** | Consultar indicadores y gráficos de stock, movimientos, consumo y excepciones; filtrar los resultados. |
| **Inventario actual** | Filtrar series por datos de inventario y abrir la ficha de una serie. |
| **Buscar** | Localizar una serie y abrir su información o historial. |
| **Historial fibra** | Revisar datos actuales, movimientos, saldo acumulado, alertas, préstamos, sobrantes y posibles relaciones con otras series. |
| **Movimiento** | Registrar ingresos, despachos, bajas, ajustes o cambios de estado permitidos. |
| **Devolución** | Registrar el retorno de material y, cuando corresponda, relacionarlo con el despacho original. |
| **Préstamos** | Registrar préstamos, consultar su estado y registrar devoluciones. |
| **Sobrantes** | Declarar material sobrante de un despacho y confirmar su recepción física. |
| **Traslados** | Cambiar la bodega de una serie sin alterar su saldo total. |
| **Alertas** | Filtrar alertas, revisar excepciones y realizar las acciones permitidas por el rol. |
| **Reportes** | Consultar reportes de inventario, consumo, excepciones y material no utilizable; exportarlos cuando estén disponibles. |
| **Abastecimiento** | Consultar proyecciones y parámetros de reposición por familia. Una sugerencia no es una orden de compra. |
| **Catálogos** | Mantener valores normalizados de operación; disponible para administración autorizada. |
| **Usuarios** | Crear o actualizar cuentas y roles; disponible para ADMIN. |
| **Bitácora** | Consultar acciones y cambios registrados; requiere permiso. |

## 3. Consultar inventario y una serie

1. Abra **Inventario actual** o **Buscar**.
2. Aplique los filtros disponibles, por ejemplo bodega, código, estado o texto de búsqueda.
3. Seleccione la serie para abrir **Historial fibra**.
4. Revise el saldo, estado, bodega actual, alertas y la línea de tiempo antes de registrar otro movimiento.

El saldo se calcula a partir de los movimientos vigentes. Una serie marcada como pendiente de Revisión requiere revisión; no asuma que su saldo es definitivo.

## 4. Registrar operaciones

Los formularios pueden variar según el tipo de operación. Complete los campos obligatorios y verifique la serie, metraje, fecha, bodega y documento antes de confirmar.

### Ingreso

En **Movimiento**, elija el tipo de ingreso, indique la serie, código de artículo, metraje y bodega. Un ingreso inicial corresponde a una serie nueva. Si la serie ya existe, no la vuelva a ingresar como inicial: el sistema rechazará la operación y deberá elegir el tipo correcto, como ingreso adicional o devolución.

### Despacho

En **Movimiento**, elija **Despacho** y complete serie, metraje, bodega de origen, documento, departamento y proyecto o ruta. El despacho se rechaza si la serie no está en esa bodega, no tiene saldo suficiente o el documento requerido está vacío. No registre un despacho con ruta **STOCK BODEGA**; para cambiar de bodega use **Traslados**.

Si el metraje supera el saldo, el sistema rechaza la operación y registra una alerta crítica. No intente corregir el saldo editando la hoja.

### Devolución

1. Abra **Devolución** y seleccione la serie.
2. Elija el despacho de referencia si está disponible; use “sin referencia” únicamente cuando no pueda asociar la devolución.
3. Ingrese el metraje, la bodega receptora y el motivo.
4. Verifique el resumen antes de confirmar.

Una devolución vinculada no puede superar el metraje pendiente del despacho. Una devolución sin referencia genera una alerta para Revisión.

### Préstamo y devolución de préstamo

En **Préstamos**, seleccione la serie e indique metraje, responsable y fecha límite. El sistema no permite prestar más que el saldo disponible ni devolver más de lo prestado. Consulte la pantalla para revisar vencimientos y devoluciones parciales.

### Traslado

En **Traslados**, seleccione la serie, la bodega de destino y el documento. El traslado modifica la ubicación de la serie; no suma ni resta metraje al saldo total.

### Sobrante

En **Sobrantes**, relacione el sobrante con el despacho, registre el metraje sobrante y el utilizado, y complete los datos solicitados. Declararlo no aumenta el inventario. El saldo se actualiza solo cuando se confirma la recepción física, indicando condición y bodega receptora.

### Baja o ajuste

Las bajas por mal estado y los ajustes manuales quedan pendientes de aprobación. Un supervisor o administrador debe aprobarlos; quien los registró no puede aprobar su propio movimiento, salvo ADMIN. Indique siempre un motivo claro.

## 5. Alertas y Revisión

Abra **Alertas** para filtrar por estado, categoría, severidad, tipo o serie. En **Historial fibra** puede revisar el contexto de una alerta junto al historial de esa serie.

- **EN_REVISION** indica que alguien está investigando el caso; no significa que esté resuelto.
- Para cerrar una alerta, registre un comentario que explique la verificación realizada.
- Las alertas críticas solo las puede cerrar ADMIN o SUPERVISOR.
- Las alertas dinámicas pueden actualizarse después de un movimiento o del recálculo diario.

Cuando el origen o saldo de una serie no esté claro, documente la discrepancia y solicite Revisión; no invente un movimiento para hacer coincidir la hoja con una estimación.

## 6. Reportes y abastecimiento

En **Reportes**, seleccione el tipo y los filtros disponibles. Según el reporte y el entorno, podrá exportar a Excel, PDF o Google Sheets. Revise el rango de fechas y los filtros antes de compartir un resultado.

En **Abastecimiento**, consulte stock, consumo, cobertura y compra sugerida por familia. La proyección es una referencia que requiere validación operativa; no genera órdenes de compra automáticamente.

## 7. Correcciones y buenas prácticas

- Los movimientos cerrados no se editan. Si hay un error, ADMIN debe anular el movimiento con un motivo y registrar uno nuevo.
- No modifique manualmente `MOVIMIENTOS`, `SERIES` ni las hojas del sistema. Las ediciones manuales pueden revertirse y quedar en la bitácora.
- Registre cada operación con el documento de respaldo, fecha y responsable correctos.
- Antes de guardar, confirme la serie y la bodega; los movimientos afectan el historial y los saldos calculados.
- Trate los valores de metraje marcados como ambiguos o pendientes como datos por verificar, no como saldo confirmado.
- No comparta contraseñas ni suba matrices o exportaciones a repositorios públicos.

## 8. Roles

| Rol | Uso principal |
|---|---|
| **ADMIN** | Gestión completa, usuarios, catálogos, anulaciones, aprobaciones, alertas y bitácora. |
| **SUPERVISOR** | Operación, aprobaciones, cierre de alertas críticas, reportes y revisión. |
| **BODEGA** | Consultas y registro de operaciones logísticas; no aprueba bajas ni ajustes. |
| **ANALISTA** | Análisis, reportes, bitácora y revisión de alertas; no registra movimientos. |
| **CONSULTA** | Lectura de inventario, reportes y bitácora. |

Los permisos efectivos pueden limitar acciones o pantallas. El servidor valida los permisos incluso si una opción no está visible en el menú.

## 9. Problemas frecuentes

| Mensaje o situación | Qué hacer |
|---|---|
| Sesión vencida | Inicie sesión otra vez. |
| Serie no existe | Revise la escritura o localícela por código, documento o proyecto antes de registrar un ingreso. |
| Saldo insuficiente o serie en otra bodega | Abra **Historial fibra** y confirme movimientos, saldo y bodega; solicite Revisión si hay diferencias. |
| Metraje ambiguo | Ingréselo sin separadores de miles y confirme el dato con el documento físico. |
| Acción no permitida | Solicite el rol adecuado; no use la cuenta de otra persona. |
| No aparece una opción del menú | Puede no estar habilitada para su rol. Consulte al administrador. |
| Error de conexión en producción | Verifique la conexión e informe al administrador la hora y la acción que estaba realizando. |

## Alcance del mapa

Graphify identifica la navegación, las pantallas y sus dependencias con `api()`, `field()`, `formData()`, `table()` y otras funciones comunes. El mapa no describe por sí solo cada instrucción visible ni sustituye la guía funcional; por eso este manual combina esa estructura con los flujos y permisos documentados en `GUIA_IMPLEMENTACION.md`.