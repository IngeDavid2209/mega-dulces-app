// ============================================================================
//  Copia UNA SOLA VEZ la colección `usuarios_tokens` de Firestore -> Postgres
//  (Etapa 10 FERROCARRIL). Idempotente (upsert por id). Necesita cuota de lectura.
//    railway run bash -c "DATABASE_URL='<publica>' node scripts/migrar-tokens.js"
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
  const snap = await admin.firestore().collection('usuarios_tokens').get();
  console.log('[migrar-tokens] docs en Firestore:', snap.size);
  let n = 0;
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const datos = { ...d };
    ['uid', 'usuario', 'token', 'id'].forEach(k => delete datos[k]);
    await query(
      `insert into mdtask_usuarios_tokens (id, uid, usuario, token, datos)
       values ($1,$2,$3,$4,$5)
       on conflict (id) do update set uid=excluded.uid, usuario=excluded.usuario,
         token=excluded.token, datos=excluded.datos`,
      [String(doc.id), d.uid ? String(d.uid) : null, d.usuario ? String(d.usuario) : null,
       d.token ? String(d.token) : null, JSON.stringify(datos)]
    );
    n++;
  }
  console.log('[migrar-tokens] LISTO. tokens copiados:', n);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[migrar-tokens] ERROR:', e.message); process.exit(1); });
