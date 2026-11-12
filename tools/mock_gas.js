// Simulación mínima de servicios de Google para probar Apps Script en Node (setup → import → API).
const fs=require('fs'),vm=require('vm'),path=require('path'),crypto=require('crypto');
function Sheet(name){ this.name=name; this.data=[]; }
Sheet.prototype={
  getName(){return this.name}, getLastRow(){return this.data.length}, getLastColumn(){return this.data.reduce((m,r)=>Math.max(m,r.length),0)},
  getMaxRows(){return 1000}, setFrozenRows(){}, getProtections(){return []},
  getRange(r,c,nr,nc){ return new Range(this,r,c,nr||1,nc||1); },
  clearContents(){ this.data=[]; return this; },
  getDataRange(){ lecturas[this.name]=(lecturas[this.name]||0)+1; return new Range(this,1,1,Math.max(1,this.data.length),Math.max(1,this.getLastColumn())); },
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
const props={}, cache={}, lecturas={}, correos=[];
const g={ console, Object, JSON, Math, Date, String, Number, Array, RegExp, Error,
  SpreadsheetApp:{ getActiveSpreadsheet:()=>SS, openById:()=>SS, flush(){}, getUi(){ throw new Error('sin UI'); }, create:(t)=>{ const o={sh:[],getSheets(){return [this.ins()]},ins(){const s=new Sheet('x');s.setName=function(n){this.name=n};this.sh.push(s);return s},insertSheet(){return this.ins()},getUrl:()=> 'https://docs.google.com/spreadsheets/d/FAKE',addViewer(){}}; return o; } },
  PropertiesService:{ getScriptProperties:()=>({ getProperty:k=>props[k]||null, setProperty:(k,v)=>props[k]=v, deleteProperty:k=>delete props[k] }) },
  CacheService:{ getScriptCache:()=>({ get:k=>cache[k]||null, put:(k,v)=>{ if(String(v).length>100000) throw new Error('valor > 100KB'); cache[k]=v; }, remove:k=>delete cache[k],
    getAll:ks=>{ const o={}; ks.forEach(k=>{ if(k in cache) o[k]=cache[k]; }); return o; }, putAll:(o)=>{ Object.keys(o).forEach(k=>{ if(String(o[k]).length>100000) throw new Error('valor > 100KB'); cache[k]=o[k]; }); } }) },
  LockService:{ getScriptLock:()=>({ tryLock:()=>true, waitLock(){}, releaseLock(){} }) },
  Utilities:{ formatDate:(d,tz,f)=>{ const s=new Date(d.getTime()-5*3600e3).toISOString(); return f.includes('HH')? s.slice(0,19).replace('T',' '):s.slice(0,10); },
    getUuid:()=>crypto.randomUUID(), computeDigest:(a,s)=>[...crypto.createHash('sha256').update(s).digest()].map(b=>b>127?b-256:b), base64Encode:b=>Buffer.from(b.map(x=>x&255)).toString("base64"), DigestAlgorithm:{SHA_256:1}, Charset:{UTF_8:1} },
  ContentService:{ createTextOutput:t=>({ t, setMimeType(){return this} }), MimeType:{JSON:1} },
  HtmlService:{ createHtmlOutput:h=>h }, Session:{ getEffectiveUser:()=>({getEmail:()=> 'owner@telconet.ec'}), getActiveUser:()=>({getEmail:()=> 'owner@telconet.ec'}) },
  MailApp:{ sendEmail:(o)=>{ correos.push(o); console.log('[mail]', typeof o==='string'?o:o.to+' | '+o.subject); } }, Logger:{log:console.log},
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
  { // importación automática: sin cambios no reimporta; con una fila nueva sí
    const st=new g.FS.SheetStore(), u='https://docs.google.com/spreadsheets/d/X/edit#gid=1'; if(!st.update('PARAMETROS','clave','MATRIZ_URL',{valor:u})) st.append('PARAMETROS',[{clave:'MATRIZ_URL',valor:u}]);
    const base=g.FS_getSpreadsheet_().getSheetByName('MATRIZ_ORIGINAL').getDataRange().getDisplayValues(); let remota=base.map(r=>r.slice());
    g.FS_valoresMatrizRemota_=()=>remota.map(r=>r.slice());
    const logs=()=>new g.FS.SheetStore().all('BITACORA').filter(x=>x.accion==='IMPORTAR_MATRIZ_AUTO').length;
    g.importarMatrizAuto(); console.log('auto sin cambios → importaciones:',logs());
    const nueva=remota[remota.length-1].slice(); remota.push(nueva); g.importarMatrizAuto(); console.log('auto con fila nueva → importaciones:',logs());
    g.importarMatrizAuto(); console.log('auto repetida sin cambios → importaciones:',logs());
    new g.FS.SheetStore().update('PARAMETROS','clave','MATRIZ_URL',{valor:''}); remota.push(nueva); g.importarMatrizAuto(); console.log('auto con enlace vacío → importaciones:',logs());
    const movs=()=>new g.FS.SheetStore().all('MOVIMIENTOS').length;
    new g.FS.SheetStore().update('PARAMETROS','clave','MATRIZ_URL',{valor:u}); const antes=movs();
    remota=[['RESUMEN','TOTAL'],['FIBRA 48H','1200'],['FIBRA 96H','800']]; // pestaña equivocada (sin SERIE / MTS)
    try { g.importarMatriz(); console.log('FALLO: pestaña equivocada importada'); } catch(e){ console.log('pestaña equivocada → rechazada; movimientos intactos:', movs()===antes); }
    try { g.importarMatrizAuto(); console.log('FALLO: auto importó pestaña equivocada'); } catch(e){ console.log('auto pestaña equivocada → rechazada; movimientos intactos:', movs()===antes); }
    remota=base.slice(0,40).map(r=>r.slice()); // matriz recortada: caída drástica
    try { g.importarMatrizAuto(); console.log('FALLO: auto aceptó caída drástica'); } catch(e){ console.log('auto con caída drástica → cancelada; movimientos intactos:', movs()===antes); }
    new g.FS.SheetStore().update('PARAMETROS','clave','MATRIZ_URL',{valor:''});
  }
  { // IDs: reimportar con 0 importados pero con movimientos de la app no debe repetir IDs
    let st=new g.FS.SheetStore(); const todos=st.all('MOVIMIENTOS');
    const app=[Object.assign({}, todos.find(m=>m.origen==='IMPORTACION'), { origen:'APP', id_movimiento:'MOV-000005' })]; // movimiento de la app con un ID bajo
    st.replace('MOVIMIENTOS', app); // como en producción tras la importación equivocada: solo quedan los de la app
    g.importarMatriz(); st=new g.FS.SheetStore(); const ids=st.all('MOVIMIENTOS').map(m=>m.id_movimiento);
    console.log('reimport con '+app.length+' mov. de la app y 0 importados → IDs únicos:', new Set(ids).size===ids.length, '· mov. app conservados:', app.every(m=>ids.includes(m.id_movimiento)));
  }
  // admin directo
  const st=new g.FS.SheetStore(); const salt='s1'; st.append('USUARIOS',[{email:'admin@telconet.ec',nombre:'Admin',rol:'ADMIN',activo:'SI',salt,hash:g.FS_hash_(salt,'Clave12345')}]);
  const call=(action,payload,token)=>JSON.parse(g.doPost({postData:{contents:JSON.stringify({action,payload,token})}}).t);
  console.log('bad login',call('login',{email:'admin@telconet.ec',password:'x'}));
  const L=call('login',{email:'admin@telconet.ec',password:'Clave12345'}); console.log('login ok',L.ok); const tk=L.data.token;
  console.log('no token',call('dashboard',{}).error);
  const b=call('bootstrap',{},tk); console.log('bootstrap',b.ok,b.data.catalogos.departamentos.length,'deps',b.data.catalogos.articulos.length,'arts');
  const d=call('dashboard',{filtros:{}},tk); console.log('kpi',JSON.stringify(d.data.kpi));
  console.log('user',call('saveUser',{email:'bodega@telconet.ec',usuario:'Bodega1',rol:'BODEGA',password:'Bodega1234'},tk));
  { // ingreso con usuario y recuperación de contraseña por correo
    const ok=(c,msg)=>console.log((c?'usuario ok: ':'FALLO usuario: ')+msg);
    ok(call('login',{usuario:'bodega1',password:'Bodega1234'}).ok, 'ingresa con su usuario (sin importar mayúsculas)');
    ok(!call('login',{usuario:'bodega@telconet.ec',password:'Bodega1234'}).ok, 'con usuario asignado ya no ingresa con el correo');
    ok(call('login',{email:'admin@telconet.ec',password:'Clave12345'}).ok, 'sin usuario asignado ingresa con el correo (transición)');
    ok(/ya está asignado/.test(call('saveUser',{email:'otro@telconet.ec',usuario:'bodega1',rol:'CONSULTA',password:'Otro12345'},tk).error||''), 'usuario repetido rechazado');
    ok(/Usuario inválido/.test(call('saveUser',{email:'otro@telconet.ec',usuario:'con espacio',rol:'CONSULTA',password:'Otro12345'},tk).error||''), 'usuario con espacios rechazado');
    ok((call('listUsers',{},tk).data.find(u=>u.email==='bodega@telconet.ec')||{}).usuario==='bodega1', 'listUsers devuelve el usuario');
    const n0=correos.length, r1=call('resetPassword',{usuario:'noexiste'}), r2=call('resetPassword',{usuario:'bodega1'});
    ok(r1.ok && r2.ok && r1.data.mensaje===r2.data.mensaje, 'misma respuesta exista o no el usuario');
    ok(correos.length===n0+1 && correos[correos.length-1].to==='bodega@telconet.ec', 'correo enviado solo al usuario existente, a su correo registrado');
    const temp=/<b style="font-size:16px;letter-spacing:1px">([a-z0-9]{10})</.exec(correos[correos.length-1].htmlBody)[1];
    ok(!JSON.stringify(r2).includes(temp), 'la respuesta no revela la contraseña temporal');
    ok(call('login',{usuario:'bodega1',password:'Bodega1234'}).ok, 'la contraseña anterior sigue valiendo');
    const lt=call('login',{usuario:'bodega1',password:temp}); ok(lt.ok && lt.data.user.debe_cambiar===true, 'ingresa con la temporal y se le pide cambiarla');
    ok(call('bootstrap',{},lt.data.token).data.user.debe_cambiar===true, 'bootstrap informa el cambio pendiente');
    ok(call('changePassword',{actual:temp,nueva:'Nueva12345'},lt.data.token).ok, 'cambia la contraseña usando la temporal');
    ok(call('bootstrap',{},lt.data.token).data.user.debe_cambiar===false, 'tras cambiarla la sesión ya no la pide');
    ok(!call('login',{usuario:'bodega1',password:temp}).ok && !call('login',{usuario:'bodega1',password:'Bodega1234'}).ok && call('login',{usuario:'bodega1',password:'Nueva12345'}).ok, 'la temporal y la anterior dejan de valer; vale la nueva');
    call('resetPassword',{usuario:'bodega1'}); const t2=/letter-spacing:1px">([a-z0-9]{10})</.exec(correos[correos.length-1].htmlBody)[1];
    new g.FS.SheetStore().update('USUARIOS','email','bodega@telconet.ec',{temp_expira:'2020-01-01 00:00:00'});
    ok(!call('login',{usuario:'bodega1',password:t2}).ok, 'la temporal vencida no sirve');
    const n1=correos.length; call('resetPassword',{usuario:'bodega1'}); call('resetPassword',{usuario:'bodega1'}); call('resetPassword',{usuario:'bodega1'});
    ok(correos.length===n1+1, 'máximo 3 pedidos por hora (el 4.º no envía correo)');
    call('saveUser',{email:'bodega@telconet.ec',usuario:'bodega1',rol:'BODEGA',password:'Bodega1234'},tk);
  }
  const tb=call('login',{usuario:'bodega1',password:'Bodega1234'}).data.token;
  const S=call('inventory',{filtros:{estado:'DISPONIBLE',estado_saldo:'COMPLETO'}},tb).data.filas.find(s=>s.saldo_actual>1000);
  const r=call('registerMovement',{tipo:'DESPACHO',serie:S.id_serie,metraje:500,bodega:S.bodega_actual,documento:'DOC-1',departamento:'GIS',proyecto:'RUTA X',fecha:'2026-10-13'},tb);
  console.log('despacho',r.ok, r.ok?r.data.serie.saldo_actual:r.error, 'antes',S.saldo_actual);
  console.log('neg',call('registerMovement',{tipo:'DESPACHO',serie:S.id_serie,metraje:99999,bodega:S.bodega_actual,documento:'DOC-2',departamento:'GIS',proyecto:'RUTA X'},tb).error);
  console.log('vida',call('rollLife',{serie:'C260219'},tb).data.timeline.length);
  { // caché de tablas: la segunda consulta no lee las hojas; una escritura o una edición manual la invalidan
    const leidas=()=>Object.values(lecturas).reduce((a,b)=>a+b,0), dash=()=>call('dashboard',{filtros:{}},tb).data;
    dash(); let n0=leidas(); const k1=JSON.stringify(dash().kpi); console.log('caché: 2ª consulta lee hojas:', leidas()-n0, '· mismo resultado:', k1===JSON.stringify(dash().kpi));
    const S2=call('inventory',{filtros:{estado:'DISPONIBLE'}},tb).data.filas.find(s=>s.saldo_actual>600 && s.id_serie!==S.id_serie);
    const w=call('registerDispatchBatch',{fecha:'2026-10-13',departamento:'GIS',proyecto:'RUTA CACHE',items:[{serie:S2.id_serie,metraje:100}]},tb);
    const S2b=call('inventory',{filtros:{texto:S2.id_serie}},tb).data.filas.find(s=>s.id_serie===S2.id_serie);
    console.log('caché: tras escribir ve el dato nuevo:', w.ok && S2b.saldo_actual===S2.saldo_actual-100, S2.saldo_actual,'→',S2b.saldo_actual);
    n0=leidas(); dash(); const tras=leidas()-n0; n0=leidas(); dash(); console.log('caché: tras escribir relee una vez:', tras>0, '· y luego usa caché:', leidas()-n0===0);
    const par=sheets.PARAMETROS, pc=par.data[0].indexOf('valor'), fila=par.data.findIndex(r=>r[0]==='UMBRAL_SALDO_BAJO_M');
    par.data[fila][pc]=123; g.auditarEdicion({range:par.getRange(fila+1,pc+1),oldValue:'300',value:123});
    console.log('caché: edición manual en la hoja se ve:', call('bootstrap',{},tb).data.params.UMBRAL_SALDO_BAJO_M==123);
    par.data[fila][pc]=300; g.auditarEdicion({range:par.getRange(fila+1,pc+1),oldValue:'123',value:300});
    const claves=Object.keys(cache).filter(k=>k.startsWith('tbl_')); console.log('caché: sin USUARIOS ni BITACORA:', !claves.some(k=>/_(USUARIOS|BITACORA)(_|$)/.test(k)), '· trozos:', claves.length);
  }
  console.log('export',JSON.stringify(call('exportReport',{tipo:'inventario'},tk).data));
  console.log('users by bodega',call('listUsers',{},tb).error);
  // auditoría: editar un movimiento cerrado debe revertirse
  const mv=sheets.MOVIMIENTOS; const col=mv.data[0].indexOf('metraje')+1; const old=mv.data[2][col-1];
  mv.data[2][col-1]=1; g.auditarEdicion({range:mv.getRange(3,col),oldValue:old,value:1}); console.log('revertido',mv.data[2][col-1]===old);
  g.tareaDiaria(); g.props=props; new g.FS.SheetStore().update('PARAMETROS','clave','CORREOS_ALERTAS',{valor:'x@telconet.ec'}); g.FS_bumpDataVersion_(); g.enviarResumenAlertas();
  console.log('sheets',Object.keys(sheets).map(k=>k+':'+(sheets[k].data.length-1)).join(' '));
}
