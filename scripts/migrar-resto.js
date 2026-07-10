// ============================================================================
//  Copia Firestore -> Postgres de las colecciones que quedaron SIN script de
//  re-sync: tec_notas, tec_conversaciones, tec_tareas, tec_grupos, areas,
//  areas_operativas, notificaciones y la agenda (subcoleccion usuarios/{uid}/agenda).
//  Idempotente (upsert por id). Respeta el esquema/columnas de cada endpoint.
//
//  IMPORTANTE: leer de Firestore consume cuota; correr con cupo (tras el reset).
//      railway run node scripts/migrar-resto.js
// ============================================================================
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('../api/db');

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT.');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

const asText = (v) => (v === undefined || v === null ? null : String(v));
const asNum = (v) => (v === undefined || v === null ? null : Number(v));
const asBool = (v) => !!v;
const asJson = (v, def) => JSON.stringify(v === undefined || v === null ? def : v);

// Upsert generico: cols = ['id', ...]; valores en el mismo orden. El SET del
// on-conflict actualiza todas las columnas menos id.
async function upsert(tabla, cols, valores) {
  const ph = valores.map((_, i) => `$${i + 1}`).join(',');
  const sets = cols.slice(1).map((c) => `${c}=excluded.${c}`).join(', ');
  await query(
    `insert into ${tabla} (${cols.join(', ')}) values (${ph})
     on conflict (id) do update set ${sets}`,
    valores
  );
}

// Colecciones con columnas explicitas (sin jsonb "datos").
async function migrarColumnas(db, coleccion, tabla, colDefs) {
  const snap = await db.collection(coleccion).get();
  const cols = ['id', ...colDefs.map((c) => c.col)];
  let n = 0;
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const valores = [String(doc.id), ...colDefs.map((c) => c.conv(d[c.field]))];
    await upsert(tabla, cols, valores);
    n++;
  }
  console.log(`[migrar-resto] ${coleccion} -> ${tabla}: ${n}`);
}

// Colecciones id + [nombre?] + datos(jsonb con el doc completo menos id).
async function migrarConDatos(db, coleccion, tabla, conNombre) {
  const snap = await db.collection(coleccion).get();
  const cols = conNombre ? ['id', 'nombre', 'datos'] : ['id', 'datos'];
  let n = 0;
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const datos = { ...d }; delete datos.id;
    const valores = conNombre
      ? [String(doc.id), asText(d.nombre), JSON.stringify(datos)]
      : [String(doc.id), JSON.stringify(datos)];
    await upsert(tabla, cols, valores);
    n++;
  }
  console.log(`[migrar-resto] ${coleccion} -> ${tabla}: ${n}`);
}

// Agenda: subcoleccion usuarios/{uid}/agenda -> tabla mdtask_agenda.
async function migrarAgenda(db) {
  const COLS_FRONT = ['texto', 'completada', 'fecha', 'prioridad'];
  const IGNORAR = new Set(['id', 'uid', 'fechaCreacion', 'completadaEn', 'fecha_creacion', 'completada_en']);
  const snap = await db.collectionGroup('agenda').get();
  const cols = ['id', 'uid', 'texto', 'completada', 'fecha', 'prioridad', 'fecha_creacion', 'completada_en', 'datos'];
  let n = 0;
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const uidDoc = doc.ref.parent && doc.ref.parent.parent ? doc.ref.parent.parent.id : null;
    if (!uidDoc) continue;
    const datos = {};
    for (const [k, v] of Object.entries(d)) {
      if (COLS_FRONT.includes(k) || IGNORAR.has(k)) continue;
      datos[k] = v;
    }
    const valores = [
      String(doc.id), String(uidDoc), asText(d.texto) || '', asBool(d.completada),
      asText(d.fecha) || '', asText(d.prioridad) || '',
      asNum(d.fechaCreacion), asNum(d.completadaEn), JSON.stringify(datos),
    ];
    await upsert('mdtask_agenda', cols, valores);
    n++;
  }
  console.log(`[migrar-resto] agenda (usuarios/*/agenda) -> mdtask_agenda: ${n}`);
}

async function paso(nombre, fn) {
  try { await fn(); }
  catch (e) { console.error(`[migrar-resto] ERROR en ${nombre}: ${e.message}`); }
}

async function main() {
  if (!dbConfigurada()) throw new Error('DATABASE_URL no configurada. Usa: railway run node scripts/migrar-resto.js');
  initAdmin();
  const db = admin.firestore();

  await paso('tec_notas', () => migrarColumnas(db, 'tec_notas', 'tec_notas', [
    { col: 'titulo', field: 'titulo', conv: asText },
    { col: 'texto', field: 'texto', conv: asText },
    { col: 'autor', field: 'autor', conv: asText },
    { col: 'autor_uid', field: 'autorUid', conv: asText },
    { col: 'creado_en', field: 'creadoEn', conv: asNum },
    { col: 'actualizado_en', field: 'actualizadoEn', conv: asNum },
  ]));

  await paso('tec_conversaciones', () => migrarColumnas(db, 'tec_conversaciones', 'tec_conversaciones', [
    { col: 'texto', field: 'texto', conv: asText },
    { col: 'autor', field: 'autor', conv: asText },
    { col: 'autor_uid', field: 'autorUid', conv: asText },
    { col: 'creado_en', field: 'creadoEn', conv: asNum },
    { col: 'editado_en', field: 'editadoEn', conv: asNum },
    { col: 'respuestas', field: 'respuestas', conv: (v) => asJson(v, []) },
  ]));

  await paso('notificaciones', () => migrarColumnas(db, 'notificaciones', 'notificaciones', [
    { col: 'empleado', field: 'empleado', conv: asText },
    { col: 'de', field: 'de', conv: asText },
    { col: 'mensaje', field: 'mensaje', conv: asText },
    { col: 'leido', field: 'leido', conv: asBool },
    { col: 'timestamp', field: 'timestamp', conv: asNum },
  ]));

  await paso('tec_tareas', () => migrarConDatos(db, 'tec_tareas', 'tec_tareas', false));
  await paso('tec_grupos', () => migrarConDatos(db, 'tec_grupos', 'tec_grupos', true));
  await paso('areas', () => migrarConDatos(db, 'areas', 'areas', true));
  await paso('areas_operativas', () => migrarConDatos(db, 'areas_operativas', 'areas_operativas', true));
  await paso('agenda', () => migrarAgenda(db));

  console.log('[migrar-resto] LISTO.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('[migrar-resto] ERROR:', e.message); process.exit(1); });
