// ============================================================================
//  Copia UNA SOLA VEZ la colección `checklists` de Firestore -> Postgres
//  (Etapa 3 FERROCARRIL). Idempotente (upsert por id).
//
//  IMPORTANTE: leer de Firestore consume cuota. Correr cuando haya cupo
//  (tras el reset diario) o con la app en horas de bajo uso.
//
//  Cómo correrlo (inyecta DATABASE_URL + FIREBASE_SERVICE_ACCOUNT del servicio):
//      railway run node scripts/migrar-checklists.js
// ============================================================================
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('../api/db');

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT.');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

// Campo del doc (estilo Firestore) -> columna Postgres. Igual que api/checklists.js.
const MAP = {
  name: 'name', assigned: 'assigned', assignedUid: 'assigned_uid', store: 'store',
  date: 'fecha', time: 'hora', status: 'status',
  enviado: 'enviado', eliminado: 'eliminado', archivado: 'archivado',
  origenTec: 'origen_tec', entregaConRetraso: 'entrega_con_retraso',
  createdBy: 'created_by', timestampCreacion: 'timestamp_creacion',
  _asignacionId: 'asignacion_id', _catalogoRutinaId: 'catalogo_rutina_id',
};
const BOOL_COLS = new Set(['enviado', 'eliminado', 'archivado', 'origen_tec', 'entrega_con_retraso']);
const COL_LIST = ['name', 'assigned', 'assigned_uid', 'store', 'fecha', 'hora', 'status',
  'enviado', 'eliminado', 'archivado', 'origen_tec', 'entrega_con_retraso',
  'created_by', 'timestamp_creacion', 'asignacion_id', 'catalogo_rutina_id'];

function desglosar(obj) {
  const cols = {}, datos = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === 'id') continue;
    const col = MAP[k];
    if (col) cols[col] = v; else datos[k] = v;
  }
  return { cols, datos };
}

function valorCol(col, v) {
  if (v === undefined || v === null) return null;
  if (BOOL_COLS.has(col)) return !!v;
  if (col === 'timestamp_creacion') return Number(v);
  return String(v);
}

async function main() {
  if (!dbConfigurada()) {
    throw new Error('DATABASE_URL no configurada. Usa: railway run node scripts/migrar-checklists.js');
  }
  initAdmin();
  const db = admin.firestore();

  const snap = await db.collection('checklists').get();
  console.log('[migrar-checklists] docs en Firestore:', snap.size);

  const sets = COL_LIST.map(c => `${c}=excluded.${c}`).concat('datos=excluded.datos').join(', ');
  let n = 0;
  for (const doc of snap.docs) {
    const { cols, datos } = desglosar(doc.data() || {});
    const valores = [String(doc.id), ...COL_LIST.map(c => valorCol(c, cols[c])), JSON.stringify(datos)];
    const placeholders = valores.map((_, i) => `$${i + 1}`).join(',');
    await query(
      `insert into mdtask_checklists (id, ${COL_LIST.join(', ')}, datos)
       values (${placeholders})
       on conflict (id) do update set ${sets}`,
      valores
    );
    n++;
    if (n % 200 === 0) console.log('[migrar-checklists]  ...', n);
  }

  console.log('[migrar-checklists] LISTO. checklists copiados:', n);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[migrar-checklists] ERROR:', e.message); process.exit(1); });
