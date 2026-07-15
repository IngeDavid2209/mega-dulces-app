// ============================================================================
//  Empuja un push SILENCIOSO "actualizacion" a TODOS los dispositivos, para que
//  cada app haga checkForUpdate() y se recargue con la version nueva ya desplegada.
//  Misma logica que api/notify-update.js, pero como script one-off (sin token de
//  admin): usa DATABASE_URL (tokens) + FIREBASE_SERVICE_ACCOUNT (FCM).
//
//  Uso: railway run bash -c "DATABASE_URL='<publica>' node scripts/forzar-actualizacion.js"
//       (o exportando DATABASE_URL y FIREBASE_SERVICE_ACCOUNT antes)
// ============================================================================
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('../api/db');

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT.');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

async function main() {
  if (!dbConfigurada()) throw new Error('DATABASE_URL no configurada.');
  initAdmin();

  const tokensRes = await query('select id, token from mdtask_usuarios_tokens');
  const tokens = [];
  const idsPorToken = new Map();
  for (const row of tokensRes.rows) {
    const t = row.token;
    if (typeof t === 'string' && t.length > 20) { tokens.push(t); idsPorToken.set(t, String(row.id)); }
  }
  console.log(`[actualizacion] dispositivos con token: ${tokens.length}`);
  if (tokens.length === 0) { console.log('[actualizacion] No hay dispositivos registrados.'); return; }

  let exitosos = 0, fallidos = 0;
  const invalidos = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const r = await admin.messaging().sendEachForMulticast({
      tokens: chunk,
      data: { tipo: 'actualizacion', timestamp: String(Date.now()) }
    });
    exitosos += r.successCount; fallidos += r.failureCount;
    r.responses.forEach((res, idx) => {
      if (!res.success) {
        const c = (res.error && res.error.code) || '';
        if (c.indexOf('registration-token-not-registered') >= 0 || c.indexOf('invalid-registration-token') >= 0) {
          invalidos.push(chunk[idx]);
        }
      }
    });
  }

  // Limpieza de tokens muertos (igual que el endpoint).
  for (const t of invalidos) {
    const id = idsPorToken.get(t);
    if (id) await query('delete from mdtask_usuarios_tokens where id = $1', [String(id)]).catch(() => {});
  }

  console.log(`[actualizacion] enviados: ${exitosos} | fallidos: ${fallidos} | tokens muertos limpiados: ${invalidos.length}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[actualizacion] ERROR:', e.message); process.exit(1); });
