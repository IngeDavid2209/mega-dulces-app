// ============================================================================
//  Copia UNA SOLA VEZ la colección `config` (turnos, recomendaciones, ...) de
//  Firestore -> Postgres (Etapa 9 FERROCARRIL). Idempotente (upsert por id).
//
//  Uso (necesita cuota de Firestore disponible para leer):
//    railway run bash -c "DATABASE_URL='<publica>' node scripts/migrar-config.js"
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
  const snap = await admin.firestore().collection('config').get();
  console.log('[migrar-config] docs en Firestore:', snap.size);
  let n = 0;
  for (const doc of snap.docs) {
    const datos = doc.data() || {};
    delete datos.id;
    await query(
      `insert into mdtask_config (id, datos) values ($1, $2)
       on conflict (id) do update set datos = excluded.datos`,
      [String(doc.id), JSON.stringify(datos)]
    );
    n++;
    console.log('[migrar-config]  copiado:', doc.id);
  }
  console.log('[migrar-config] LISTO. config copiados:', n);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[migrar-config] ERROR:', e.message); process.exit(1); });
