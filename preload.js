// Se ejecuta dentro de la página de WhatsApp Web, antes que sus propios scripts.
// Hace lo que hacía el manifest de la extensión: mete wa-js + el puente en el mundo de la página (MAIN) y el panel en un
// mundo aislado, y le da al panel una versión mínima de la API «chrome.*» que espera.
const { ipcRenderer, webFrame } = require('electron');
const fs = require('fs');
const path = require('path');

if (location.hostname === 'web.whatsapp.com') {
  const ext = (p) => path.join(__dirname, 'ext', p);
  const leer = (p) => fs.readFileSync(ext(p), 'utf8');
  const pkg = require('./package.json');

  // 1) mundo de la página: la librería wa-js y el puente (bridge.js). Debe correr antes que los scripts de WhatsApp.
  // Con la sesión iniciada se inyecta desde el principio (como la extensión). En la pantalla del QR NO se inyecta: la librería
  // interfiere con la conexión y el QR no llega a aparecer. Cuando se escanea el QR y la sesión queda iniciada, la app
  // recarga WhatsApp una vez y ya con la sesión se inyecta.
  const CLAVES = ['last-wid-md', 'last-wid'].concat(process.env.CT_TESTKEY || []); // CT_TESTKEY: solo para la prueba automática
  const sesionIniciada = () => { try { return CLAVES.some((k) => !!localStorage.getItem(k)); } catch { return false; } };
  if (sesionIniciada()) {
    try { webFrame.executeJavaScript(leer('lib/wppconnect-wa.js') + '\n;\n' + leer('bridge.js')); } catch (e) { console.error('No se pudo cargar wa-js:', e); }
  } else {
    const t = setInterval(() => {
      if (!sesionIniciada()) return;
      clearInterval(t);
      setTimeout(() => ipcRenderer.send('wa:reload'), 3000);
    }, 1500);
  }

  // 2) API mínima «chrome.*» para el panel (ui.js), apoyada en el proceso principal
  const iconos = {};
  const dataUrl = (p) => {
    if (!iconos[p]) { try { iconos[p] = 'data:image/png;base64,' + fs.readFileSync(ext(p)).toString('base64'); } catch { iconos[p] = ''; } }
    return iconos[p];
  };
  const oyentes = [];
  window.chrome = {
    runtime: {
      lastError: undefined,
      getURL: (p) => dataUrl(p),
      getManifest: () => ({ name: 'Creatuchat', version: pkg.version, desktop: true }),
      sendMessage: (m, cb) => {
        const p = ipcRenderer.invoke('bg:message', m);
        if (typeof cb === 'function') { p.then((r) => cb(r), (e) => cb({ error: e.message })); return; }
        return p;
      },
      onMessage: { addListener: (fn) => oyentes.push(fn) },
    },
    storage: {
      local: {
        get: (k) => ipcRenderer.invoke('store:get', k),
        set: (o) => ipcRenderer.invoke('store:set', o),
        remove: (k) => ipcRenderer.invoke('store:remove', k),
      },
    },
  };
  const alternarPanel = () => oyentes.forEach((fn) => { try { fn({ type: 'wam-toggle' }); } catch {} });
  ipcRenderer.on('toggle-panel', alternarPanel);

  // 3) panel: estilos, librería de Excel y el propio ui.js
  window.addEventListener('DOMContentLoaded', () => {
    try {
      const st = document.createElement('style');
      st.textContent = leer('ui.css');
      document.head.appendChild(st);
      // se cargan como módulos de Node (la página no permite eval); ui.js busca XLSX y chrome en el ámbito global
      window.XLSX = require(ext('lib/xlsx.core.min.js'));
      require(ext('ui.js'));
    } catch (e) { console.error('No se pudo cargar el panel:', e); }

    // pestaña lateral para abrir/cerrar el panel (en la extensión era el icono de la barra de Chrome)
    const fab = document.createElement('button');
    fab.id = 'creatuchat-fab';
    fab.title = 'Abrir / cerrar Creatuchat (Ctrl+Shift+P)';
    fab.style.cssText = 'position:fixed;right:0;top:46%;width:34px;height:58px;z-index:99990;border:1px solid #e6177a;border-right:0;border-radius:14px 0 0 14px;background:#fff;box-shadow:0 2px 10px #0004;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center';
    const im = document.createElement('img');
    im.src = dataUrl('icons/mark.png');
    im.style.cssText = 'width:24px;height:24px;object-fit:contain';
    fab.appendChild(im);
    fab.onclick = alternarPanel;
    document.body.appendChild(fab);
  });
}
