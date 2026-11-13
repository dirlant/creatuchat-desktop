# Creatuchat (escritorio)

WhatsApp Web en su propia ventana, con el mismo panel de la extensión de Chrome (envío automático, IA, licencias, avisos).

- `npm install` y, si no se descarga Electron, `node node_modules/electron/install.js`
- `npm start` — abre la app. El código del panel vive en `ext/` (ya no se copia de la extensión de Chrome, que dejó de mantenerse)
- `npm run selftest` — prueba automática (carga WhatsApp, inyecta el panel, guarda captura con `--out=ruta`)
- `npm run dist` — genera el instalador de Windows en `dist/`
- Publicar una versión: subir `version` en package.json, `git tag vX.Y.Z` y `git push origin vX.Y.Z` (GitHub Actions compila Windows y Mac y publica el Release)

Notas:
- En este entorno hay que quitar `ELECTRON_RUN_AS_NODE` (`env -u ELECTRON_RUN_AS_NODE ...`), si no Electron corre como Node.
- wa-js NO se inyecta en la pantalla del QR (impide que aparezca); se inyecta cuando hay sesión y la app recarga una vez tras escanear.
- Actualizaciones: `electron-updater` con GitHub Releases (`build.publish` en package.json). Falta crear el repositorio y publicar un release.
