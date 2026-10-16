# Fibra Stock — inventario de fibra óptica por serie

Backend: Google Apps Script · Base de datos: Google Sheets · Frontend: GitHub Pages.

```
backend/      Archivos .gs para Apps Script (copiar en este orden: 00…05) + appsscript.json
frontend/     Sitio estático para GitHub Pages (index.html, css, js). Configure js/config.js
docs/         GUIA_IMPLEMENTACION.md — propuesta completa y paso a paso
tools/        Pruebas en Node (motor, servicio y simulación de Apps Script) y sync_core.sh
data/         FIBRA_MATRIZ.csv (solo para pruebas locales — NO subir al repositorio público)
```

Inicio rápido: siga `docs/GUIA_IMPLEMENTACION.md`, sección 15.

Pruebas locales (Node 18+):
```
node tools/test_service.js     # 34 escenarios de negocio sobre la matriz real
node tools/mock_gas.js         # setup → importación → API → auditoría con servicios de Google simulados
```

Si modifica `backend/00_Config.gs`, `01_Engine.gs` o `02_Service.gs`, ejecute `tools/sync_core.sh` para actualizar el modo demo del frontend.
