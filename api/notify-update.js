// Endpoint serverless de Vercel para empujar "actualización disponible" a
// todos los dispositivos vía Firebase Cloud Messaging (FCM).
//
// Variables de entorno requeridas (Vercel → Settings → Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT = JSON completo del service account de Firebase.

const admin = require('firebase-admin');
const { query } = require('./db'); // FERROCARRIL Etapa 10: usuarios/tokens desde Postgres

let inicializado = false;
function inicializar() {
  if (inicializado) return;
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Falta variable FIREBASE_SERVICE_ACCOUNT en las variables de entorno.');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  inicializado = true;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    inicializar();

    // 1) Validar que sea un admin autenticado
    const authHeader = String(req.headers['authorization'] || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Falta Authorization Bearer token' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const pr = await query('select rol from mdtask_usuarios where id = $1', [decoded.uid]);
    const perfilRol = pr.rows[0] ? pr.rows[0].rol : null;
    if (perfilRol !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden enviar push de actualización.' });
    }

    // 2) Cargar todos los tokens FCM (desde Postgres)
    const tokensRes = await query('select id, token from mdtask_usuarios_tokens');
    const tokens = [];
    const idsPorToken = new Map();
    tokensRes.rows.forEach(row => {
      const t = row.token;
      if (typeof t === 'string' && t.length > 20) {
        tokens.push(t);
        idsPorToken.set(t, String(row.id));
      }
    });

    if (tokens.length === 0) {
      return res.json({ ok: true, enviados: 0, mensaje: 'No hay dispositivos registrados.' });
    }

    // 3) Enviar push SILENCIOSO (solo data, sin notification visible)
    let exitosos = 0;
    let fallidos = 0;
    const tokensInvalidos = [];

    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      const respuesta = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        data: { tipo: 'actualizacion', timestamp: String(Date.now()) }
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

    // 4) Limpiar tokens muertos (no bloqueante)
    if (tokensInvalidos.length > 0) {
      for (const t of tokensInvalidos) {
        const id = idsPorToken.get(t);
        if (id) await query('delete from mdtask_usuarios_tokens where id = $1', [String(id)]).catch(() => {});
      }
    }

    return res.json({
      ok: true,
      enviados: exitosos,
      fallidos,
      tokensLimpiados: tokensInvalidos.length
    });
  } catch (e) {
    console.error('[notify-update] error:', e);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
