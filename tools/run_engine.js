// Ejecuta el motor completo sobre la matriz CSV (Node) — misma lógica que Apps Script.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { console }; vm.createContext(ctx);
for (const f of ['00_Config.gs', '01_Engine.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../backend', f), 'utf8'), ctx);
const FS = ctx.FS;
const csv = fs.readFileSync(process.env.CSV || process.argv[2] || path.join(__dirname,'../data/FIBRA_MATRIZ.csv'), 'utf8');
const today = process.argv[3] || '2026-10-13';
const rows = FS.parseCSV(csv);
const params = {}; FS.PARAMS_DEFAULT.forEach(p => params[p[0]] = p[1]);
const r = FS.processMatrix(rows, { today, params, now: today + 'T00:00:00' });
let seq = 0; r.alertas.forEach(a => a.id_alerta = 'ALE-' + String(++seq).padStart(6, '0'));
const data = { staging: r.staging, articulos: r.articulos, movimientos: r.movimientos, relaciones: r.relaciones, alertas: r.alertas, sobrantes: r.sobrantes };
data.prestamos = FS.computeLoans(r.prestamos, data.movimientos, today);
data.series = FS.computeSeries(data);
const dyn = FS.dynamicAlerts(data, today, params);
const mg = FS.mergeDynamicAlerts(data.alertas, dyn);
mg.nuevas.forEach(a => { a.id_alerta = 'ALE-' + String(++seq).padStart(6, '0'); data.alertas.push(a); });
data.series = FS.computeSeries(data);
module.exports = { FS, data, params, today, rows, colMap: r.columnas };
if (require.main === module) {
  const out = process.argv[4];
  if (out) fs.writeFileSync(out, JSON.stringify(data));
  console.log('filas', rows.length, 'columnas mapeadas', Object.keys(r.columnas).length);
}
