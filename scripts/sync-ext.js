// Copia el código compartido de la extensión de Chrome (panel, puente con WhatsApp, librerías e imágenes)
// a ./ext, para que la app de escritorio use exactamente el mismo código.
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'whatsapp-regestion');
const DST = path.resolve(__dirname, '..', 'ext');
const FILES = [
  'ui.js',
  'ui.css',
  'bridge.js',
  'lib/wppconnect-wa.js',
  'lib/xlsx.core.min.js',
  'icons/mark.png',
  'icons/mark-dark.png',
  'icons/logo.png',
  'icons/wordmark.png',
  'icons/wordmark-dark.png',
];

if (!fs.existsSync(SRC)) {
  if (fs.existsSync(path.join(DST, 'ui.js'))) {
    console.log('sync-ext: no está la carpeta de la extensión; se usan los archivos ya copiados en ./ext');
    process.exit(0);
  }
  console.error('sync-ext: no se encontró ' + SRC);
  process.exit(1);
}
let cambiados = 0;
for (const f of FILES) {
  const from = path.join(SRC, f);
  const to = path.join(DST, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const nuevo = fs.readFileSync(from);
  let igual = false;
  try { igual = Buffer.compare(nuevo, fs.readFileSync(to)) === 0; } catch {}
  if (!igual) { fs.writeFileSync(to, nuevo); cambiados++; }
}
console.log('sync-ext: ' + cambiados + ' archivo(s) actualizados de ' + FILES.length);
