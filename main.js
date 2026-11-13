// Creatuchat (escritorio): abre WhatsApp Web en su propia ventana, con el mismo panel de la extensión de Chrome.
// Este proceso hace lo que en la extensión hacía el service worker: guarda los datos, llama a la API y se actualiza.
const { app, BrowserWindow, ipcMain, Menu, shell, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { autoUpdater } = require('electron-updater');

const API = 'https://agendaconmigo-api.vercel.app/api/';
const WA_URL = 'https://web.whatsapp.com/';
const SELFTEST = process.argv.includes('--selftest');
const OUT = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6);

if (SELFTEST) {
  const tmp = path.join(os.tmpdir(), 'creatuchat-selftest');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} // perfil limpio en cada prueba
  app.setPath('userData', tmp);
}

// WhatsApp Web solo funciona con navegadores reconocidos: se presenta como Chrome
const chromeVer = process.versions.chrome;
const UA = process.platform === 'darwin'
  ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`
  : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;

let win = null;
const netlog = [];

// ---------- datos guardados (equivale a chrome.storage.local) ----------
let store = {};
let saveT = null;
const storeFile = () => path.join(app.getPath('userData'), 'store.json');
const loadStore = () => { try { store = JSON.parse(fs.readFileSync(storeFile(), 'utf8')); } catch { store = {}; } };
const flushStore = () => {
  clearTimeout(saveT);
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    const tmp = storeFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, storeFile());
  } catch (e) { console.error('No se pudo guardar:', e.message); }
};
const persist = () => { clearTimeout(saveT); saveT = setTimeout(flushStore, 300); };
ipcMain.handle('store:get', (_e, keys) => {
  if (keys == null) return { ...store };
  const isObj = typeof keys === 'object' && !Array.isArray(keys);
  const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
  const out = {};
  list.forEach((k) => { if (k in store) out[k] = store[k]; else if (isObj) out[k] = keys[k]; });
  return out;
});
ipcMain.handle('store:set', (_e, obj) => { Object.assign(store, obj || {}); persist(); });
ipcMain.handle('store:remove', (_e, keys) => { [].concat(keys || []).forEach((k) => delete store[k]); persist(); });

// ---------- llamadas a la API (equivale a background.js) ----------
const post = async (endpoint, body) => {
  try {
    const r = await net.fetch(API + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  } catch (e) { return { error: e.message }; }
};

// ---------- actualizaciones automáticas (electron-updater + GitHub Releases) ----------
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
// En Mac la app no está firmada con una cuenta de Apple: no puede instalarse sola, así que se ofrece abrir la página de descarga
const MAC_SIN_FIRMA = process.platform === 'darwin';
let updateInfo = {}; // versión nueva encontrada (la lee el panel para mostrar «Nueva actualización»)
let manualCheck = false;
const msg = (opts) => dialog.showMessageBox(win || undefined, { type: 'info', ...opts });
autoUpdater.on('update-available', async (info) => {
  updateInfo = info || {};
  if (!manualCheck) return; // la revisión automática solo avisa en el panel
  manualCheck = false;
  if (MAC_SIN_FIRMA) {
    const m = await msg({ message: 'Hay una nueva versión de Creatuchat (' + info.version + ').', detail: 'En Mac descárgala desde GitHub e instálala sobre la actual (tu sesión y tu configuración se conservan).', buttons: ['Abrir la descarga', 'Más tarde'], defaultId: 0, cancelId: 1 });
    if (m.response === 0) shell.openExternal('https://github.com/dirlant/creatuchat-desktop/releases/latest');
    return;
  }
  const r = await msg({ message: 'Hay una nueva versión de Creatuchat (' + info.version + ').', detail: '¿Quieres descargarla e instalarla ahora?', buttons: ['Descargar e instalar', 'Más tarde'], defaultId: 0, cancelId: 1 });
  if (r.response === 0) autoUpdater.downloadUpdate().catch((e) => dialog.showErrorBox('Actualización', e.message));
});
autoUpdater.on('update-not-available', () => {
  updateInfo = {};
  if (manualCheck) { manualCheck = false; msg({ message: 'Ya tienes la última versión de Creatuchat (' + app.getVersion() + ').' }); }
});
autoUpdater.on('download-progress', (p) => { if (win) win.setProgressBar(p.percent / 100); });
autoUpdater.on('update-downloaded', async () => {
  if (win) win.setProgressBar(-1);
  const r = await msg({ message: 'La actualización está lista.', detail: 'Creatuchat se reiniciará para instalarla.', buttons: ['Reiniciar ahora', 'Al cerrar'], defaultId: 0, cancelId: 1 });
  if (r.response === 0) autoUpdater.quitAndInstall();
});
autoUpdater.on('error', (e) => {
  if (win) win.setProgressBar(-1);
  if (manualCheck) { manualCheck = false; dialog.showErrorBox('No se pudo buscar actualizaciones', (e && e.message) || String(e)); }
});
// consulta GitHub Releases y devuelve la versión nueva ('' si no hay); se reutiliza el resultado durante 1 minuto
let ultimaConsulta = { t: 0, p: null };
const consultarActualizacion = () => {
  if (!app.isPackaged) return Promise.resolve('');
  if (ultimaConsulta.p && Date.now() - ultimaConsulta.t < 60000) return ultimaConsulta.p;
  ultimaConsulta.t = Date.now();
  ultimaConsulta.p = autoUpdater.checkForUpdates()
    .then((r) => { const v = r && r.isUpdateAvailable && r.updateInfo ? r.updateInfo.version : ''; updateInfo = v ? r.updateInfo : {}; return v; })
    .catch(() => '');
  return ultimaConsulta.p;
};
const buscarActualizaciones = (manual) => {
  if (!app.isPackaged) {
    if (manual) msg({ message: 'Las actualizaciones funcionan en la app instalada.', detail: 'Estás en modo desarrollo.' });
    return;
  }
  manualCheck = !!manual;
  autoUpdater.checkForUpdates().catch(() => {});
};

// tras escanear el QR, el preload pide recargar WhatsApp para inyectar la librería con la sesión ya iniciada
ipcMain.on('wa:reload', () => { if (win) win.webContents.reload(); });

// mensajes del panel (mismos nombres que en la extensión)
ipcMain.handle('bg:message', async (_e, m) => {
  switch (m && m.type) {
    case 'wam-license': return post('licencia-whatsapp', { token: m.token, numero: m.numero });
    case 'wam-notifs': return post('notificaciones-whatsapp', { token: m.token, numero: m.numero, ...(m.leida ? { leida: String(m.leida) } : {}) });
    case 'wam-ia': return post('ia-whatsapp', m.payload || {});
    case 'wam-update': return { status: 200, version: await consultarActualizacion() };
    case 'wam-badge': try { app.setBadgeCount(Math.min(m.count || 0, 99)); } catch {} return;
    case 'wam-open-sync': buscarActualizaciones(true); return;
    default: return;
  }
});

// ---------- ventana ----------
const crearMenu = () => {
  const toggle = () => win && win.webContents.send('toggle-panel');
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Creatuchat',
      submenu: [
        { label: 'Mostrar / ocultar panel', accelerator: 'CmdOrCtrl+Shift+P', click: toggle },
        { label: 'Buscar actualizaciones', click: () => buscarActualizaciones(true) },
        { type: 'separator' },
        { label: 'Recargar WhatsApp', accelerator: 'CmdOrCtrl+R', click: () => win && win.webContents.reload() },
        { label: 'Herramientas de desarrollo', accelerator: 'F12', click: () => win && win.webContents.toggleDevTools() },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
    { label: 'Edición', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Ver', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
  ]));
};

const crearVentana = () => {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Creatuchat',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#111b21',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // igual que la extensión: el panel vive en un mundo aislado y WhatsApp no ve su código
      nodeIntegration: false,
      sandbox: false, // el preload necesita leer los archivos de ext/
      partition: 'persist:whatsapp', // la sesión de WhatsApp queda guardada: el QR se escanea una sola vez
      spellcheck: false,
    },
  });
  win.webContents.setUserAgent(UA);
  win.webContents.session.setUserAgent(UA);

  // permisos: solo los que WhatsApp Web necesita, y solo para WhatsApp
  win.webContents.session.setPermissionRequestHandler((wc, permission, cb) => {
    const ok = new URL(wc.getURL()).hostname === 'web.whatsapp.com' && ['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission);
    cb(ok);
  });

  // los enlaces externos (de los chats) se abren en el navegador, no dentro de la app
  const externo = (url) => { try { const u = new URL(url); if (/^https?:$/.test(u.protocol)) shell.openExternal(url); } catch {} };
  win.webContents.setWindowOpenHandler(({ url }) => { externo(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).hostname !== 'web.whatsapp.com') { e.preventDefault(); externo(url); }
  });

  if (SELFTEST) {
    const ses = win.webContents.session;
    ses.webRequest.onErrorOccurred((d) => { if (netlog.length < 40) netlog.push('ERR ' + d.error + ' ' + d.url.slice(0, 120)); });
    ses.webRequest.onCompleted((d) => { if (d.statusCode >= 400 && netlog.length < 40) netlog.push(d.statusCode + ' ' + d.url.slice(0, 120)); });
    ses.webRequest.onBeforeRequest({ urls: ['wss://*/*', 'ws://*/*'] }, (d, cb) => { if (netlog.length < 40) netlog.push('WS ' + d.url.slice(0, 120)); cb({}); });
  }
  win.loadURL(WA_URL, { userAgent: UA });
  win.on('closed', () => { win = null; });
  return win;
};

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
if (!SELFTEST && !app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(() => {
    loadStore();
    crearMenu();
    crearVentana();
    app.on('before-quit', flushStore);
    if (SELFTEST) return selftest();
    consultarActualizacion(); // al abrir la app: se verifica enseguida (el panel vuelve a preguntar cada hora)
  });
  app.on('window-all-closed', () => app.quit());
}

// ---------- prueba automática (npm run selftest): comprueba que WhatsApp carga y que el panel se inyecta ----------
async function selftest() {
  const wc = win.webContents;
  const diag = {};
  const logs = [];
  wc.on('console-message', (_e, level, message, line, source) => { if (level >= 2 && logs.length < 40) logs.push(String(message).slice(0, 300) + ' @' + String(source).split('/').pop() + ':' + line); });
  wc.on('preload-error', (_e, p, err) => logs.push('PRELOAD-ERROR ' + err.message));
  diag.logs = logs;
  diag.red = netlog;
  await new Promise((r) => setTimeout(r, Number((process.argv.find((a) => a.startsWith('--wait=')) || '--wait=25').slice(7)) * 1000));
  for (let intento = 1; intento <= 4; intento++) {
    try {
      delete diag.error;
      Object.assign(diag, await wc.executeJavaScript(`({
        url: location.href,
        title: document.title,
        wpp: typeof window.WPP,
        wppReady: !!(window.WPP && window.WPP.isFullReady),
        panelEnDOM: !!document.getElementById('wam-root'),
        botonLateral: !!document.getElementById('creatuchat-fab'),
      })`));
      if (process.argv.includes('--simular-login')) { // comprueba la recarga automática: se simula la clave de sesión
        diag.antes = diag.wpp;
        await wc.executeJavaScript(`localStorage.setItem('ct-test', '1')`);
        await new Promise((r) => setTimeout(r, 12000));
        diag.despues = await wc.executeJavaScript(`typeof window.WPP`);
        await wc.executeJavaScript(`localStorage.removeItem('ct-test')`);
      }
      wc.send('toggle-panel');
      await new Promise((r) => setTimeout(r, 2500));
      diag.panelVisible = await wc.executeJavaScript(`(() => { const p = document.getElementById('wam-panel'); return !!p && !p.hidden; })()`);
      diag.licenciaVisible = await wc.executeJavaScript(`(() => { const g = document.getElementById('wam-gate'); return !!g && !g.hidden; })()`);
      const img = await wc.capturePage();
      if (OUT) fs.writeFileSync(OUT + '.png', img.toPNG());
      break;
    } catch (e) { diag.error = e.message; await new Promise((r) => setTimeout(r, 4000)); }
  }
  if (OUT) fs.writeFileSync(OUT + '.json', JSON.stringify(diag, null, 2));
  console.log(JSON.stringify(diag));
  app.exit(0);
}
