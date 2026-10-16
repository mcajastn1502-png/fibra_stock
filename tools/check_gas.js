const fs=require('fs'),vm=require('vm'),path=require('path');
const dir=path.join(__dirname,'../backend'); const ctx={console}; vm.createContext(ctx);
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.gs')).sort()){ vm.runInContext(fs.readFileSync(path.join(dir,f),'utf8'),ctx,{filename:f}); console.log('ok',f); }
console.log(typeof ctx.doPost, typeof ctx.importarMatriz, typeof ctx.FS.SheetStore);
