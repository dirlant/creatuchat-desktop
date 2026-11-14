// Puente de las ventanas propias de la app (registro y actualización obligatoria) con el proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ct', {
  info: () => ipcRenderer.invoke('modal:info'),
  registrar: (datos) => ipcRenderer.invoke('registro:enviar', datos),
  soporte: (datos) => ipcRenderer.invoke('registro:soporte', datos),
  actualizar: () => ipcRenderer.invoke('forzar:actualizar'),
  salir: () => ipcRenderer.send('modal:salir'),
  onEstado: (cb) => ipcRenderer.on('forzar:estado', (_e, s) => cb(s)),
});
