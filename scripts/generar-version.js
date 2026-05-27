/**
 * Genera src/app/shared/version.ts con la fecha y hora del build.
 *
 * Se ejecuta automáticamente antes de cada `npm run build` / `npm start`
 * (ver scripts en package.json). El sello cambia en cada compilación, así que
 * sirve para confirmar a simple vista si la PWA instalada ya tomó la última versión.
 */
const fs = require('fs');
const path = require('path');

const ahora = new Date();
const pad = (n) => String(n).padStart(2, '0');

const fecha = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
const hora = `${pad(ahora.getHours())}:${pad(ahora.getMinutes())}`;

let version = '0.0.0';
try {
  version = require('../package.json').version || '0.0.0';
} catch (_) { /* ignore */ }

const contenido = `// ⚠️ ARCHIVO GENERADO AUTOMÁTICAMENTE EN CADA BUILD — no editar a mano.
// Lo escribe scripts/generar-version.js antes de compilar.
export const APP_VERSION = '${version}';
export const APP_BUILD_FECHA = '${fecha}';
export const APP_BUILD_HORA = '${hora}';
export const APP_BUILD_SELLO = '${fecha} ${hora}';
`;

const destino = path.join(__dirname, '..', 'src', 'app', 'shared', 'version.ts');
fs.writeFileSync(destino, contenido, 'utf8');
console.log(`🏷️  version.ts generado → ${fecha} ${hora}`);
