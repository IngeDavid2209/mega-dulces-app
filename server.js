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
// La subida de respaldo manda el archivo en base64 dentro del JSON, y eso no
// cabe en los 2 MB del parseo general. Se monta ANTES, con su propio limite: si
// se montara despues, el parser global ya habria rechazado el cuerpo.
app.all('/api/subir-archivo',
  express.json({ limit: '20mb' }),
  require('./api/subir-archivo'));

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
app.all('/api/horarios-sucursal', require('./api/horarios-sucursal'));
// Etapa 1 FERROCARRIL: usuarios + agenda (endpoints listos; el frontend aún usa Firestore hasta el cutover).
app.all('/api/usuarios', require('./api/usuarios'));
app.all('/api/usuarios-agenda', require('./api/usuarios-agenda'));
// Etapa 3 FERROCARRIL: checklists (el mayor lector). Frontend con dual-write.
app.all('/api/checklists', require('./api/checklists'));
// Fase 3 · paso 3.1b: la plantilla autorizada de cada sucursal y los puestos
// que Direccion declara ("de temporada"). Tablas de la migracion 057.
app.all('/api/plantillas', require('./api/plantillas'));
app.all('/api/puestos-declarados', require('./api/puestos-declarados'));
// La plaza y quien la cubre (tablas de la migracion 056, hasta hoy sin lector).
app.all('/api/plazas', require('./api/plazas'));
app.all('/api/coberturas', require('./api/coberturas'));

// Etapas 4-8 FERROCARRIL: resto de colecciones (CRUD generado por api/_crud.js).
app.all('/api/catalogo-rutinas', require('./api/catalogo-rutinas'));
app.all('/api/asignaciones-rutinas', require('./api/asignaciones-rutinas'));
app.all('/api/moldes-checklists', require('./api/moldes-checklists'));
app.all('/api/descansos-semanales', require('./api/descansos-semanales'));
app.all('/api/tareas-equipo', require('./api/tareas-equipo'));
app.all('/api/rutinas-personales', require('./api/rutinas-personales'));
// Etapa 9 FERROCARRIL: config (turnos, recomendaciones).
app.all('/api/config', require('./api/config'));
// Etapa 10 FERROCARRIL: tokens FCM (el envio sigue siendo FCM; el dato en Postgres).
app.all('/api/usuarios-tokens', require('./api/usuarios-tokens'));
app.all('/api/login-usuario', require('./api/login-usuario')); // público (resuelve usuario->correo en el login)
app.all('/api/login', require('./api/login')); // público (auth propia: valida contraseña y emite JWT)
app.all('/api/cambiar-password', require('./api/cambiar-password')); // cambio de contraseña (bcrypt)
app.all('/api/tec-notas', require('./api/tec-notas'));
app.all('/api/areas', require('./api/areas'));
app.all('/api/areas-operativas', require('./api/areas-operativas'));
app.all('/api/tec-conversaciones', require('./api/tec-conversaciones'));
app.all('/api/tec-grupos', require('./api/tec-grupos'));
app.all('/api/tec-tareas', require('./api/tec-tareas'));
app.all('/api/notificaciones', require('./api/notificaciones'));
app.all('/api/cloudinary-cleanup', require('./api/cloudinary-cleanup'));
// --- Modulo FLOTILLA: catalogo de vehiculos + reservas/itinerario ---
app.all('/api/vehiculos', require('./api/vehiculos'));
app.all('/api/reservas-vehiculos', require('./api/reservas-vehiculos'));

// 🏷️ Activación de promociones (formato MKTN001)
app.all('/api/promociones', require('./api/promociones'));
app.all('/api/promo-proveedores', require('./api/promo-proveedores'));
// Seguimiento de la promocion: el expediente de cada canal y la lectura de los
// tickets de venta con la IA.
app.all('/api/promo-expedientes', require('./api/promo-expedientes'));
app.all('/api/promo-leer-ticket', require('./api/promo-leer-ticket'));

// 🟢 VENTA DE PROMOS: el piso de venta en vivo. Nada que ver con el MKTN001 de
// arriba (aquello es la negociación con el proveedor); esto es la promo tal como
// la vende el vendedor, la cobra la caja y la vigila quien monitorea.
app.all('/api/promos-venta', require('./api/promos-venta'));

// 🧾 PAGOS DE SERVICIOS: catálogo de servicios contratados (luz, agua, internet)
// y el pago de cada periodo. Los recordatorios y la captura del comprobante van
// por WhatsApp (api/pagos-notificar.js).
app.all('/api/servicios', require('./api/servicios'));
app.all('/api/pagos-servicios', require('./api/pagos-servicios'));

// 🎫 TICKETS: vale de servicio operativo (solicitudes de servicio entre areas,
// con su folio, el detalle de lo realizado y las tres firmas del formato).
app.all('/api/tickets', require('./api/tickets'));

// 🧱 BLOQUES DE TRABAJO: tramos de horario (Mañana, Tarde...) con sus tareas.
// El generador (api/bloques-generar.js) los materializa como checklists normales.
app.all('/api/bloques', require('./api/bloques'));

// Comprobacion de salud para Railway (healthcheckPath en railway.json).
//
// A proposito NO toca la base: si Postgres tarda o hipa, no queremos que el
// despliegue se marque como fallido. Solo dice "el servidor ya esta atendiendo".
// Con esto Railway mantiene la version anterior sirviendo hasta que la nueva
// responde aqui, y desaparece el hueco en el que mostraba "Este despliegue esta
// temporalmente en pausa" (que el service worker alcanzaba a guardar como si
// fuera la app, dejando el celular atorado en esa pantalla).
app.get('/api/salud', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true });
});

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

// Archivos que se piden por su nombre, no rutas de la app. Si uno de estos NO
// existe, la respuesta correcta es 404, nunca el index.html.
const ARCHIVO_ESTATICO = /\.(?:js|mjs|css|map|json|webmanifest|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|wasm|txt|xml)$/i;

// --- Fallback SPA: cualquier RUTA que no sea archivo ni /api -> index.html ---
// (Angular maneja el ruteo del lado del cliente.) Tambien sin cache.
app.use((req, res) => {
  if (req.method !== 'GET') return res.status(404).json({ error: 'No encontrado' });

  // ⚠️ ESTO DEJABA A LA GENTE FUERA DESPUES DE CADA DESPLIEGUE.
  //
  // Los bundles llevan hash en el nombre (main-ABC123.js) y cambian en cada
  // build, asi que los viejos desaparecen del servidor. Un navegador que
  // todavia tiene guardado el index.html anterior pide su bundle viejo... y
  // este fallback le contestaba 200 con el index.html. El navegador recibia
  // HTML donde esperaba JavaScript, tronaba con "Unexpected token '<'" y la app
  // NO ARRANCABA: pantalla en blanco o vuelta al login, sin manera de entrar.
  //
  // Con un 404 de verdad, el manejador de fallo de chunk de app.ts se entera,
  // recarga y baja el index nuevo con los hashes nuevos. La gente entra.
  if (ARCHIVO_ESTATICO.test(req.path)) {
    return res.status(404).type('text/plain').send('No encontrado');
  }

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

  // ⚠️ INTERRUPTOR DE AVISOS.
  //
  // Poner AVISOS_APAGADOS=1 arranca el servidor SIN los procesos que le escriben
  // por WhatsApp a la gente. Sirve para dos cosas:
  //   - levantar una copia de la app (otro proyecto, un ambiente de pruebas) sin
  //     que dos servidores le manden el mismo aviso a los mismos trabajadores;
  //   - probar contra la base real sin molestar a nadie.
  // El resto de la app funciona igual: se puede entrar, ver y entregar tareas.
  const avisosApagados = process.env.AVISOS_APAGADOS === '1';
  if (avisosApagados) {
    console.log('[avisos] APAGADOS por AVISOS_APAGADOS=1: no se manda WhatsApp desde esta copia.');
  }

  // FLOTILLA: poll de escalamiento de solicitudes por WhatsApp (avisa al 1er
  // aprobador, escala al 2do a los 2 min y recuerda a ambos hasta el tope).
  if (!avisosApagados) {
    try {
      require('./api/flotilla-notificar').iniciarPoll();
    } catch (e) {
      console.error('[flotilla] no se pudo iniciar el poll:', e && e.message);
    }
  }

  // TAREAS: poll de avisos por WhatsApp (resumen de la manana + recordatorio
  // antes de la hora limite). El aviso al asignar no pasa por aqui: se dispara
  // al crear el checklist.
  if (!avisosApagados) {
    try {
      require('./api/tareas-notificar').iniciarPoll();
    } catch (e) {
      console.error('[tareas-notificar] no se pudo iniciar el poll:', e && e.message);
    }
  }

  // BLOQUES DE TRABAJO: reparte los bloques del día como checklists. Arranca
  // SIEMPRE (no manda ningún mensaje; solo genera las tareas del día).
  try {
    require('./api/bloques-generar').iniciarPoll();
  } catch (e) {
    console.error('[bloques] no se pudo iniciar el generador:', e && e.message);
  }

  // PAGOS DE SERVICIOS: genera el pago de cada periodo a partir del catálogo y
  // recuerda por WhatsApp al responsable (antes, el día, y mientras no llegue el
  // comprobante).
  //
  // A diferencia de los dos de arriba, este poll arranca SIEMPRE: el módulo mira
  // `AVISOS_APAGADOS` por dentro y, cuando está encendido, se calla los WhatsApps
  // pero sigue generando los recibos de cada periodo. Si no, dar de alta un
  // servicio no mostraría nada en el tablero y parecería que el módulo no sirve.
  try {
    require('./api/pagos-notificar').iniciarPoll();
  } catch (e) {
    console.error('[pagos] no se pudo iniciar el poll:', e && e.message);
  }
});
