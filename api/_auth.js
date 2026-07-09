// ============================================================================
//  Auth reutilizable para los endpoints de datos (Postgres).
//
//  Tras la migración, la app emite su PROPIO JWT (firmado con JWT_SECRET) en
//  api/login.js. `verificarToken` valida ese JWT.
//
//  TRANSICIÓN (dual-verify): mientras haya sesiones abiertas con el viejo
//  idToken de Firebase, si el JWT propio no valida se intenta `verifyIdToken`
//  de firebase-admin. Este fallback se ELIMINA en la última etapa (cuando todos
//  los usuarios ya entraron con el login nuevo).
//
//  Uso en un endpoint:
//    const { verificarToken } = require('./_auth');
//    try { const user = await verificarToken(req); ... }
//    catch (e) { return res.status(e.status || 401).json({ error: e.message }); }
// ============================================================================
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('Falta la variable JWT_SECRET.');
  return s;
}

/** Firma un JWT propio para un usuario ya autenticado. */
function firmarToken({ uid, rol }) {
  return jwt.sign({ uid, rol: rol || null }, jwtSecret(), { expiresIn: '30d' });
}

// --- Fallback Firebase (TEMPORAL, se quita en la última etapa) ---------------
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
 * Valida el header Authorization: Bearer <token> y devuelve { uid, rol }.
 * 1) JWT propio (JWT_SECRET). 2) Fallback: idToken de Firebase (transición).
 * Lanza un error con `.status` si falta o es inválido.
 */
async function verificarToken(req) {
  const header = String(req.headers['authorization'] || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    const e = new Error('Falta Authorization Bearer token');
    e.status = 401;
    throw e;
  }
  // 1) JWT propio
  try {
    const p = jwt.verify(token, jwtSecret());
    return { uid: p.uid, rol: p.rol };
  } catch (_) { /* intentar Firebase */ }
  // 2) Fallback: idToken de Firebase (sesiones viejas durante la transición)
  try {
    initAdmin();
    return await admin.auth().verifyIdToken(token);
  } catch (_) {
    const e = new Error('Token inválido o expirado');
    e.status = 401;
    throw e;
  }
}

module.exports = { verificarToken, firmarToken, initAdmin };
