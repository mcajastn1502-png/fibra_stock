/** Cliente de la API: Apps Script (producción) o servicio local en memoria (modo demo). */
window.Api = (function () {
  var cfg = window.FIBRA_CONFIG || {}, DEMO_KEY = 'fibra_demo_tablas', SESS = 'fibra_sesion';
  var demo = !cfg.API_URL;
  var demoStore = null, demoUser = null;

  function session() { try { return JSON.parse(sessionStorage.getItem(SESS) || 'null'); } catch (e) { return null; } }
  function setSession(s) { try { s ? sessionStorage.setItem(SESS, JSON.stringify(s)) : sessionStorage.removeItem(SESS); } catch (e) { /* modo privado */ } }

  function loadDemoStore() {
    if (demoStore) return demoStore;
    var raw = null; try { raw = localStorage.getItem(DEMO_KEY); } catch (e) { /* sin almacenamiento */ }
    if (!raw) return null;
    demoStore = new FS.MemStore(JSON.parse(raw), { persistKey: DEMO_KEY });
    return demoStore;
  }

  async function call(action, payload) {
    if (demo) return callDemo(action, payload || {});
    var s = session();
    var res = await fetch(cfg.API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, token: s && s.token, payload: payload || {} }) });
    if (!res.ok) throw new Error('Error de red (' + res.status + ').');
    var j = await res.json();
    if (!j.ok) { if (j.error === 'SESION_EXPIRADA') { setSession(null); location.hash = '#login'; throw new Error('Su sesión expiró. Ingrese nuevamente.'); } throw new Error(j.error); }
    return j.data;
  }

  async function callDemo(action, p) {
    await new Promise(function (r) { setTimeout(r, 30); });
    var st = loadDemoStore(); if (!st) throw new Error('Cargue la matriz CSV, XLSX o XLS para iniciar la demo.');
    var s = session(); demoUser = s && s.user; if (!demoUser) throw new Error('SESION_EXPIRADA');
    var svc = new FS.Service(st, demoUser);
    if (action === 'listUsers') { if (demoUser.rol !== 'ADMIN') throw new Error('Permiso denegado: solo el administrador gestiona usuarios.'); return [{ email: demoUser.email, nombre: demoUser.nombre, rol: demoUser.rol, activo: 'SI', ultimo_acceso: st.now() }]; }
    if (action === 'saveUser') throw new Error('En modo demo los usuarios se simulan eligiendo el rol al ingresar.');
    if (action === 'changePassword') throw new Error('No disponible en modo demo.');
    if (action === 'exportReport') throw new Error('La exportación a Google Sheets requiere el backend de Apps Script. Use Excel o PDF en la demo.');
    if (action === 'resetPassword') return svc.resetPassword(p);
    if (action === 'logout') return true;
    if (typeof svc[action] !== 'function') throw new Error('Acción desconocida: ' + action);
    return svc[action](p);
  }

  return {
    demo: demo, call: call, session: session,
    async login(email, password) { var d = await call('login', { email: email, password: password }); setSession(d); return d; },
    async startDemo(csvText, rol, email) {
      var st = FS.buildFromCSV(csvText);
      try { localStorage.setItem(DEMO_KEY, JSON.stringify(st.dump())); } catch (e) { /* demasiado grande o bloqueado */ }
      demoStore = new FS.MemStore(st.dump(), { persistKey: DEMO_KEY });
      setSession({ token: 'demo', user: { email: email || 'demo@local', nombre: 'Usuario demo', rol: rol } });
    },
    resumeDemo(rol) { if (!loadDemoStore()) return false; setSession({ token: 'demo', user: { email: 'demo@local', nombre: 'Usuario demo', rol: rol } }); return true; },
    hasDemoData() { return !!loadDemoStore(); },
    resetDemo() { try { localStorage.removeItem(DEMO_KEY); } catch (e) { /* nada */ } demoStore = null; },
    logout() { if (!demo) call('logout').catch(function () {}); setSession(null); }
  };
})();
