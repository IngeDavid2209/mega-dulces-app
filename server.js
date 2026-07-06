/**
 * Servidor para Railway (y cualquier hosting tipo contenedor).
 *
 * A diferencia de Vercel (que corre cada archivo de /api como "funcion serverless"),
 * Railway corre UN proceso de Node. Este servidor Express hace dos cosas:
 *
 *   1. Sirve la app de Angular ya compilada (dist/mega-dulces-app/browser).
 *   2. Atiende las rutas del backend (/api/*) reutilizando exactamente las
 *      mismas funciones que ya existian para Vercel (no se reescriben).
 *
 * La base de datos sigue siendo Firebase: este servidor NO guarda datos, solo
 * sirve la app y hace las tareas que necesitan secretos (IA, Cloudinary, push).
 *
 * Variables de entorno requeridas (Railway -> Variables):
 *   ANTHROPIC_API_KEY        -> asistente de voz (IA de Claude)
 *   FIREBASE_SERVICE_ACCOUNT -> JSON del service account (push + validar sesion)
 *   CLOUDINARY_CLOUD_NAME    -> limpieza de fotos
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *   ASISTENTE_MODELO         -> opcional (por defecto claude-opus-4-8)
 *   PORT                     -> lo asigna Railway automaticamente
 */
const path = require('path');
const express = require('express');

const app = express();

// Parseo de JSON en el body (Vercel lo hacia solo; aqui hay que activarlo).
// `verify` guarda el cuerpo CRUDO en req.rawBody: lo necesita el webhook de
// WhatsApp para validar la firma (HMAC) del evento. No cambia el parseo normal.
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// --- Rutas del backend (mismas funciones que usaba Vercel) ---
// Se montan con app.all para que tambien reciban OPTIONS (las funciones ya
// manejan el metodo y el CORS internamente).
app.all('/api/asistente-voz', require('./api/asistente-voz'));
app.all('/api/asistente-chat', require('./api/asistente-chat'));
app.all('/api/whatsapp-webhook', require('./api/whatsapp-webhook'));
app.all('/api/tareas-asignadas', require('./api/tareas-asignadas'));
app.all('/api/notify-update', require('./api/notify-update'));
app.all('/api/notificar', require('./api/notificar'));
// --- API de datos en Postgres (colecciones migradas: TEC + areas + notificaciones) ---
app.all('/api/db-health', require('./api/db-health'));
// Etapa 1 FERROCARRIL: usuarios + agenda (endpoints listos; el frontend aún usa Firestore hasta el cutover).
app.all('/api/usuarios', require('./api/usuarios'));
app.all('/api/usuarios-agenda', require('./api/usuarios-agenda'));
app.all('/api/login-usuario', require('./api/login-usuario')); // público (resuelve usuario->correo en el login)
app.all('/api/tec-notas', require('./api/tec-notas'));
app.all('/api/areas', require('./api/areas'));
app.all('/api/areas-operativas', require('./api/areas-operativas'));
app.all('/api/tec-conversaciones', require('./api/tec-conversaciones'));
app.all('/api/tec-grupos', require('./api/tec-grupos'));
app.all('/api/tec-tareas', require('./api/tec-tareas'));
app.all('/api/notificaciones', require('./api/notificaciones'));
app.all('/api/cloudinary-cleanup', require('./api/cloudinary-cleanup'));

// Cualquier otra ruta /api que no exista -> 404 claro (no servir el index).
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ruta de API no encontrada: ' + req.path });
});

// --- App de Angular (archivos estaticos compilados) ---
const browserDir = path.join(__dirname, 'dist', 'mega-dulces-app', 'browser');

// Archivos que controlan la VERSION de la app: nunca se cachean, para que la PWA
// detecte y aplique la version nueva sola (sin que el usuario cierre y reabra).
// El resto (bundles con hash en el nombre) si puede cachearse: son inmutables.
const SIN_CACHE = new Set([
  'index.html', 'index.csr.html', 'ngsw.json', 'ngsw-worker.js',
  'safety-worker.js', 'worker-basic.min.js', 'firebase-messaging-sw.js', 'manifest.webmanifest'
]);
app.use(express.static(browserDir, {
  setHeaders: (res, filePath) => {
    if (SIN_CACHE.has(path.basename(filePath))) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// --- Fallback SPA: cualquier ruta que no sea archivo ni /api -> index.html ---
// (Angular maneja el ruteo del lado del cliente.) Tambien sin cache.
app.use((req, res) => {
  if (req.method !== 'GET') return res.status(404).json({ error: 'No encontrado' });
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(browserDir, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mega Dulces Task escuchando en el puerto ${PORT}`);
  // Migracion a Postgres: si hay DATABASE_URL, aplica las migraciones SQL
  // pendientes al arrancar (crea tablas nuevas). Si no, no hace nada.
  // No bloquea ni tumba el server si algo falla.
  try {
    require('./scripts/db-migrate').migrar().catch((e) =>
      console.error('[migrate] fallo al aplicar migraciones:', e && e.message));
  } catch (e) {
    console.error('[migrate] no se pudo iniciar el runner:', e && e.message);
  }
});
