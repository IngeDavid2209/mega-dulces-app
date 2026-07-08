// ============================================================================
//  Copia UNA SOLA VEZ las 6 colecciones de las Etapas 4-8 (FERROCARRIL) de
//  Firestore -> Postgres. Idempotente (upsert por id).
//
//  IMPORTANTE: leer de Firestore consume cuota; correr con cupo disponible.
//  Cómo correrlo (inyecta DATABASE_URL + FIREBASE_SERVICE_ACCOUNT):
//      railway run node scripts/migrar-rutinas.js
// ============================================================================
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('../api/db');

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT.');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

// Mismos map/boolCols/numCols que los endpoints (api/*.js) para que columnas y
// `datos` queden idénticos al CRUD.
const CONFIGS = [
  { coleccion: 'catalogo_rutinas', tabla: 'mdtask_catalogo_rutinas',
    map: { nombre: 'nombre', tipo: 'tipo', frecuencia: 'frecuencia', activa: 'activa', creadoPor: 'creado_por', creadoEn: 'creado_en' },
    boolCols: ['activa'], numCols: ['creado_en'] },
  { coleccion: 'asignaciones_rutinas', tabla: 'mdtask_asignaciones_rutinas',
    map: { catalogoRutinaId: 'catalogo_rutina_id', nombreRutina: 'nombre_rutina', modoAsignacion: 'modo_asignacion', activa: 'activa', creadoEn: 'creado_en' },
    boolCols: ['activa'], numCols: ['creado_en'] },
  { coleccion: 'moldes_checklists', tabla: 'mdtask_moldes_checklists',
    map: { name: 'name', assigned: 'assigned', store: 'store', frecuencia: 'frecuencia', timestampCreacion: 'timestamp_creacion', createdBy: 'created_by' },
    boolCols: [], numCols: ['timestamp_creacion'] },
  { coleccion: 'descansos_semanales', tabla: 'mdtask_descansos_semanales',
    map: { userId: 'user_id', userNombre: 'user_nombre', semanaISO: 'semana_iso', actualizadoEn: 'actualizado_en' },
    boolCols: [], numCols: ['actualizado_en'] },
  { coleccion: 'tareas_equipo', tabla: 'mdtask_tareas_equipo',
    map: { name: 'name', store: 'store', jefeEquipo: 'jefe_equipo', cerrado: 'cerrado', timestampCreacion: 'timestamp_creacion' },
    boolCols: ['cerrado'], numCols: ['timestamp_creacion'] },
  { coleccion: 'rutinas_personales', tabla: 'mdtask_rutinas_personales',
    map: { uid: 'uid', nombre: 'nombre', frecuencia: 'frecuencia', activa: 'activa', creadoEn: 'creado_en' },
    boolCols: ['activa'], numCols: ['creado_en'] },
];

function hazDesglose(cfg) {
  const bool = new Set(cfg.boolCols), num = new Set(cfg.numCols);
  const COL_LIST = Object.values(cfg.map);
  const valorCol = (col, v) => {
    if (v === undefined || v === null) return null;
    if (bool.has(col)) return !!v;
    if (num.has(col)) return Number(v);
    return String(v);
  };
  const desglosar = (obj) => {
    const cols = {}, datos = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (k === 'id') continue;
      const col = cfg.map[k];
      if (col) cols[col] = v; else datos[k] = v;
    }
    return { cols, datos };
  };
  return { COL_LIST, valorCol, desglosar };
}

async function migrarColeccion(db, cfg) {
  const { COL_LIST, valorCol, desglosar } = hazDesglose(cfg);
  const sets = COL_LIST.map(c => `${c}=excluded.${c}`).concat('datos=excluded.datos').join(', ');
  const snap = await db.collection(cfg.coleccion).get();
  let n = 0;
  for (const doc of snap.docs) {
    const { cols, datos } = desglosar(doc.data() || {});
    const valores = [String(doc.id), ...COL_LIST.map(c => valorCol(c, cols[c])), JSON.stringify(datos)];
    const placeholders = valores.map((_, i) => `$${i + 1}`).join(',');
    await query(
      `insert into ${cfg.tabla} (id, ${COL_LIST.join(', ')}, datos)
       values (${placeholders})
       on conflict (id) do update set ${sets}`,
      valores
    );
    n++;
  }
  console.log(`[migrar-rutinas] ${cfg.coleccion} -> ${cfg.tabla}: ${n}`);
}

async function main() {
  if (!dbConfigurada()) {
    throw new Error('DATABASE_URL no configurada. Usa: railway run node scripts/migrar-rutinas.js');
  }
  initAdmin();
  const db = admin.firestore();
  for (const cfg of CONFIGS) await migrarColeccion(db, cfg);
  console.log('[migrar-rutinas] LISTO.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('[migrar-rutinas] ERROR:', e.message); process.exit(1); });
