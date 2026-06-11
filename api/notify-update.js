// Endpoint serverless de Vercel para empujar "actualización disponible" a
// todos los dispositivos vía Firebase Cloud Messaging (FCM).
//
// Variables de entorno requeridas (Vercel → Settings → Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT = JSON completo del service account de Firebase
//                              (solo para enviar el push via firebase-admin).
//   BACKEND_URL              = URL base del backend Node + Postgres
//                              (ej. https://mega-dulces-backend.vercel.app).
//   SERVICE_SECRET           = secret compartido con el backend para llamar
//                              al endpoint /api/internal/tokens.
//
// Cambio importante (Fase 5-H): los TOKENS FCM ya NO viven en Firestore.
// Ahora viven en Postgres (tabla `tokens_fcm`). Este handler:
//   1. Verifica que el llamador es un admin haciendo fetch a /api/auth/me con
//      su JWT (Bearer).
//   2. Pide al backend la lista de tokens activos (/api/internal/tokens).
//   3. Envia el push via firebase-admin (FCM sigue siendo el transporte).
//   4. Reporta los tokens muertos al backend para que los borre.

const admin = require('firebase-admin');

let inicializado = false;
function inicializar() {
  if (inicializado) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta variable FIREBASE_SERVICE_ACCOUNT en Vercel.');
  const sa = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  inicializado = true;
}

async function verificarAdmin(jwtBearer) {
  const url = `${process.env.BACKEND_URL}/api/auth/me`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${jwtBearer}` } });
  if (!r.ok) throw new Error(`auth/me devolvio ${r.status}`);
  const { user } = await r.json();
  if (!user || user.rol !== 'admin') {
    const err = new Error('Solo administradores pueden enviar push de actualización.');
    err.status = 403;
    throw err;
  }
  return user;
}

async function pedirTokensAlBackend() {
  const url = `${process.env.BACKEND_URL}/api/internal/tokens`;
  const r = await fetch(url, {
    headers: { 'x-service-secret': process.env.SERVICE_SECRET || '' },
  });
  if (!r.ok) throw new Error(`internal/tokens devolvio ${r.status}`);
  const { tokens } = await r.json();
  // Filtrar solo los validos (>= 20 caracteres)
  return (tokens || [])
    .map(t => t.token)
    .filter(t => typeof t === 'string' && t.length > 20);
}

async function borrarTokensMuertosBackend(tokensMuertos) {
  if (!tokensMuertos.length) return;
  // Best-effort: si falla no rompemos el flujo principal.
  await Promise.allSettled(tokensMuertos.map(t =>
    fetch(`${process.env.BACKEND_URL}/api/notificaciones/tokens/${encodeURIComponent(t)}`, {
      method: 'DELETE',
      headers: { 'x-service-secret': process.env.SERVICE_SECRET || '' },
    })
  ));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    inicializar();

    // 1) Validar que sea un admin autenticado.
    const authHeader = String(req.headers['authorization'] || '');
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!jwt) return res.status(401).json({ error: 'Falta Authorization Bearer token' });
    await verificarAdmin(jwt);

    // 2) Cargar todos los tokens FCM activos desde el backend.
    const tokens = await pedirTokensAlBackend();
    if (tokens.length === 0) {
      return res.json({ ok: true, enviados: 0, mensaje: 'No hay dispositivos registrados.' });
    }

    // 3) Enviar push SILENCIOSO (solo data, sin notification visible).
    let exitosos = 0;
    let fallidos = 0;
    const tokensInvalidos = [];
    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      const respuesta = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        data: { tipo: 'actualizacion', timestamp: String(Date.now()) },
      });
      exitosos += respuesta.successCount;
      fallidos += respuesta.failureCount;
      respuesta.responses.forEach((r, idx) => {
        if (!r.success) {
          const codigo = (r.error && r.error.code) || '';
          if (codigo.indexOf('registration-token-not-registered') >= 0 ||
              codigo.indexOf('invalid-registration-token') >= 0) {
            tokensInvalidos.push(chunk[idx]);
          }
        }
      });
    }

    // 4) Limpiar tokens muertos en el backend (no bloqueante).
    if (tokensInvalidos.length > 0) {
      borrarTokensMuertosBackend(tokensInvalidos).catch(() => {});
    }

    return res.json({
      ok: true,
      enviados: exitosos,
      fallidos,
      tokensLimpiados: tokensInvalidos.length,
    });
  } catch (e) {
    console.error('[notify-update] error:', e);
    const status = e && e.status ? e.status : 500;
    return res.status(status).json({ error: (e && e.message) || 'Error interno' });
  }
};
