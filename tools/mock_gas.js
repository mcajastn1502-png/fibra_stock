// Simulación mínima de servicios de Google para probar Apps Script en Node (setup → import → API).
const fs=require('fs'),vm=require('vm'),path=require('path'),crypto=require('crypto');
function Sheet(name){ this.name=name; this.data=[]; }
Sheet.prototype={
  getName(){return this.name}, getLastRow(){return this.data.length}, getLastColumn(){return this.data.reduce((m,r)=>Math.max(m,r.length),0)},
  getMaxRows(){return 1000}, setFrozenRows(){}, getProtections(){return []},
  getRange(r,c,nr,nc){ return new Range(this,r,c,nr||1,nc||1); },
  getDataRange(){ return new Range(this,1,1,Math.max(1,this.data.length),Math.max(1,this.getLastColumn())); },
};
function Range(sh,r,c,nr,nc){Object.assign(this,{sh,r,c,nr,nc});}
Range.prototype={
  getValues(){const o=[];for(let i=0;i<this.nr;i++){const row=[];for(let j=0;j<this.nc;j++){const v=(this.sh.data[this.r-1+i]||[])[this.c-1+j];row.push(v===undefined?'':v);}o.push(row);}return o;},
  getDisplayValues(){return this.getValues().map(r=>r.map(String));},
  getValue(){return this.getValues()[0][0]},
  setValues(v){ if(v.length!==this.nr||v[0].length!==this.nc) throw new Error('setValues dims '+v.length+'x'+v[0].length+' vs '+this.nr+'x'+this.nc);
    v.forEach((row,i)=>{const R=this.sh.data[this.r-1+i]=this.sh.data[this.r-1+i]||[]; row.forEach((x,j)=>R[this.c-1+j]=x);}); return this;},
  setValue(x){return this.setValues([[x]])}, clearContent(){for(let i=0;i<this.nr;i++){const R=this.sh.data[this.r-1+i];if(R)for(let j=0;j<this.nc;j++)R[this.c-1+j]='';} while(this.sh.data.length&&this.sh.data[this.sh.data.length-1].join('')==='')this.sh.data.pop(); return this;},
  setFontWeight(){return this}, setBackground(){return this}, setFontColor(){return this}, setNumberFormat(){return this}, setNumberFormats(){return this},
  getRow(){return this.r}, getColumn(){return this.c}, getNumRows(){return this.nr}, getNumColumns(){return this.nc}, getSheet(){return this.sh}
};
const sheets={}; const SS={ getId:()=> 'SSID', setSpreadsheetTimeZone(){}, getSpreadsheetTimeZone:()=> 'America/Guayaquil',
  getSheetByName:n=>sheets[n]||null, insertSheet:n=>(sheets[n]=new Sheet(n)), getSheets:()=>Object.values(sheets), deleteSheet(s){delete sheets[s.name]}, toast(m){console.log('[toast]',m)} };
const props={}, cache={};
const g={ console, Object, JSON, Math, Date, String, Number, Array, RegExp, Error,
  SpreadsheetApp:{ getActiveSpreadsheet:()=>SS, openById:()=>SS, flush(){}, getUi(){ throw new Error('sin UI'); }, create:(t)=>{ const o={sh:[],getSheets(){return [this.ins()]},ins(){const s=new Sheet('x');s.setName=function(n){this.name=n};this.sh.push(s);return s},insertSheet(){return this.ins()},getUrl:()=> 'https://docs.google.com/spreadsheets/d/FAKE',addViewer(){}}; return o; } },
  PropertiesService:{ getScriptProperties:()=>({ getProperty:k=>props[k]||null, setProperty:(k,v)=>props[k]=v, deleteProperty:k=>delete props[k] }) },
  CacheService:{ getScriptCache:()=>({ get:k=>cache[k]||null, put:(k,v)=>cache[k]=v, remove:k=>delete cache[k] }) },
  LockService:{ getScriptLock:()=>({ tryLock:()=>true, waitLock(){}, releaseLock(){} }) },
  Utilities:{ formatDate:(d,tz,f)=>{ const s=new Date(d.getTime()-5*3600e3).toISOString(); return f.includes('HH')? s.slice(0,19).replace('T',' '):s.slice(0,10); },
    getUuid:()=>crypto.randomUUID(), computeDigest:(a,s)=>[...crypto.createHash('sha256').update(s).digest()].map(b=>b>127?b-256:b), DigestAlgorithm:{SHA_256:1}, Charset:{UTF_8:1} },
  ContentService:{ createTextOutput:t=>({ t, setMimeType(){return this} }), MimeType:{JSON:1} },
  HtmlService:{ createHtmlOutput:h=>h }, Session:{ getEffectiveUser:()=>({getEmail:()=> 'owner@telconet.ec'}), getActiveUser:()=>({getEmail:()=> 'owner@telconet.ec'}) },
  MailApp:{ sendEmail:(o)=>console.log('[mail]', typeof o==='string'?o:o.to+' | '+o.subject) }, Logger:{log:console.log},
  ScriptApp:{ getProjectTriggers:()=>[] }
};
vm.createContext(g);
const dir=path.join(__dirname,'../backend');
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.gs')).sort()) vm.runInContext(fs.readFileSync(path.join(dir,f),'utf8'),g,{filename:f});
module.exports={g,sheets,SS,props};

if(require.main===module){
  g.setupEstructura();
  const testStore=new g.FS.SheetStore(), testFormula='=IMPORTXML("https://example.invalid","//a")';
  testStore.append('CATALOGOS',[{catalogo:'__TEST__',valor_original:testFormula,valor_normalizado:'',clase:'',activo:false,nota:''}]);
  const testRow=sheets.CATALOGOS.data[sheets.CATALOGOS.data.length-1], formulaColumn=sheets.CATALOGOS.data[0].indexOf('valor_original');
  if(testRow[formulaColumn]!=="'"+testFormula) throw new Error('SheetStore permitió escribir una cadena interpretable como fórmula.');
  sheets.CATALOGOS.data.pop();
  console.log('formula input stored as literal');
  // pegar la matriz (como texto, igual que "Importar → sin convertir")
  const csv=fs.readFileSync(path.join(__dirname,'../data/FIBRA_MATRIZ.csv'),'utf8');
  const objs=g.FS.parseCSV(csv); const head=Object.keys(objs[0]);
  sheets.MATRIZ_ORIGINAL.data=[head].concat(objs.map(o=>head.map(h=>o[h])));
  let t=Date.now(); g.importarMatriz(); console.log('import ms',Date.now()-t);
  // admin directo
  const st=new g.FS.SheetStore(); const salt='s1'; st.append('USUARIOS',[{email:'admin@telconet.ec',nombre:'Admin',rol:'ADMIN',activo:'SI',salt,hash:g.FS_hash_(salt,'Clave12345')}]);
  const call=(action,payload,token)=>JSON.parse(g.doPost({postData:{contents:JSON.stringify({action,payload,token})}}).t);
  console.log('bad login',call('login',{email:'admin@telconet.ec',password:'x'}));
  const L=call('login',{email:'admin@telconet.ec',password:'Clave12345'}); console.log('login ok',L.ok); const tk=L.data.token;
  console.log('no token',call('dashboard',{}).error);
  const b=call('bootstrap',{},tk); console.log('bootstrap',b.ok,b.data.catalogos.departamentos.length,'deps',b.data.catalogos.articulos.length,'arts');
  const d=call('dashboard',{filtros:{}},tk); console.log('kpi',JSON.stringify(d.data.kpi));
  console.log('user',call('saveUser',{email:'bodega@telconet.ec',nombre:'Bodega',rol:'BODEGA',password:'Bodega1234'},tk));
  const tb=call('login',{email:'bodega@telconet.ec',password:'Bodega1234'}).data.token;
  const S=call('inventory',{filtros:{estado:'DISPONIBLE',estado_saldo:'COMPLETO'}},tb).data.filas.find(s=>s.saldo_actual>1000);
  const r=call('registerMovement',{tipo:'DESPACHO',serie:S.id_serie,metraje:500,bodega:S.bodega_actual,documento:'DOC-1',departamento:'GIS',proyecto:'RUTA X',fecha:'2026-10-13'},tb);
  console.log('despacho',r.ok, r.ok?r.data.serie.saldo_actual:r.error, 'antes',S.saldo_actual);
  console.log('neg',call('registerMovement',{tipo:'DESPACHO',serie:S.id_serie,metraje:99999,bodega:S.bodega_actual,documento:'DOC-2',departamento:'GIS',proyecto:'RUTA X'},tb).error);
  console.log('vida',call('rollLife',{serie:'C260219'},tb).data.timeline.length);
  console.log('export',JSON.stringify(call('exportReport',{tipo:'inventario'},tk).data));
  console.log('users by bodega',call('listUsers',{},tb).error);
  // auditoría: editar un movimiento cerrado debe revertirse
  const mv=sheets.MOVIMIENTOS; const col=mv.data[0].indexOf('metraje')+1; const old=mv.data[2][col-1];
  mv.data[2][col-1]=1; g.auditarEdicion({range:mv.getRange(3,col),oldValue:old,value:1}); console.log('revertido',mv.data[2][col-1]===old);
  g.tareaDiaria(); g.props=props; st.update('PARAMETROS','clave','CORREOS_ALERTAS',{valor:'x@telconet.ec'}); g.enviarResumenAlertas();
  console.log('sheets',Object.keys(sheets).map(k=>k+':'+(sheets[k].data.length-1)).join(' '));
}
