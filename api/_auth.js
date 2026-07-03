// ============================================================================
//  Auth reutilizable para los endpoints de datos (Postgres).
//
//  Durante la migración, el LOGIN se queda en Firebase Auth. Cada endpoint de
//  Postgres se protege validando el idToken de Firebase con firebase-admin
//  (mismo patrón que ya usan api/notificar.js y api/notify-update.js).
//
//  Uso en un endpoint:
//    const { verificarToken } = require('./_auth');
//    try { const user = await verificarToken(req); ... }
//    catch (e) { return res.status(e.status || 401).json({ error: e.message }); }
// ============================================================================
const admin = require('firebase-admin');

let inicializado = false;
function initAdmin() {
  if (inicializado) return;
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Falta la variable FIREBASE_SERVICE_ACCOUNT.');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  inicializado = true;
}

/**
 * Valida el header Authorization: Bearer <idToken> y devuelve el usuario
 * decodificado (uid, etc.). Lanza un error con `.status` si falta o es inválido.
 */
async function verificarToken(req) {
  initAdmin();
  const header = String(req.headers['authorization'] || '');
  const idToken = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!idToken) {
    const e = new Error('Falta Authorization Bearer token');
    e.status = 401;
    throw e;
  }
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (_) {
    const e = new Error('Token inválido o expirado');
    e.status = 401;
    throw e;
  }
}

/**
 * Autoriza un traslado de datos de la migración. Acepta:
 *   - Header `x-migracion-secret` == process.env.MIGRACION_SECRET (para correr
 *     traslados por curl sin depender de un token de usuario), o
 *   - un idToken de Firebase de un usuario con rol 'admin'.
 * Inicializa firebase-admin en ambos casos (los traslados leen Firestore).
 */
async function autorizarMigracion(req) {
  initAdmin();
  const secreto = process.env.MIGRACION_SECRET;
  const hdr = req.headers['x-migracion-secret'];
  if (secreto && hdr && String(hdr) === String(secreto)) return { via: 'secreto' };

  const user = await verificarToken(req); // lanza 401 si falta/invalido
  const perfil = (await admin.firestore().collection('usuarios').doc(user.uid).get()).data() || {};
  if (perfil.rol !== 'admin') {
    const e = new Error('Solo administradores (o secreto de migración).');
    e.status = 403;
    throw e;
  }
  return { via: 'admin', user };
}

module.exports = { verificarToken, autorizarMigracion, initAdmin };
