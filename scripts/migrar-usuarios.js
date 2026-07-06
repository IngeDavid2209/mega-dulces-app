// ============================================================================
//  Copia UNA SOLA VEZ la colección `usuarios` y sus subcolecciones `agenda`
//  de Firestore -> Postgres. Idempotente (upsert por id).
//
//  Cómo correrlo (inyecta DATABASE_URL + FIREBASE_SERVICE_ACCOUNT del servicio):
//      railway run node scripts/migrar-usuarios.js
//  (Requiere que DATABASE_URL sea alcanzable desde donde se corre; si es la URL
//   interna de Railway, córrelo dentro de Railway o usa la URL pública.)
// ============================================================================
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('../api/db');

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT.');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

const COLS = ['usuario', 'correo', 'nombre', 'rol', 'telefono', 'alcance', 'cargo', 'activo'];
const IGN_U = new Set(['id', 'uid', 'creadoEn', 'actualizadoEn']);
function desglosarUsuario(u) {
  const cols = {}, datos = {};
  for (const [k, v] of Object.entries(u || {})) {
    if (IGN_U.has(k)) continue;
    if (COLS.includes(k)) cols[k] = v; else datos[k] = v;
  }
  return { cols, datos };
}

async function main() {
  if (!dbConfigurada()) {
    throw new Error('DATABASE_URL no configurada. Usa: railway run node scripts/migrar-usuarios.js');
  }
  initAdmin();
  const db = admin.firestore();

  const snap = await db.collection('usuarios').get();
  console.log('[migrar] usuarios en Firestore:', snap.size);
  let nUsers = 0, nTareas = 0;

  for (const doc of snap.docs) {
    const u = doc.data() || {};
    const { cols, datos } = desglosarUsuario(u);
    const ahora = Date.now();
    await query(
      `insert into mdtask_usuarios (id, usuario, correo, nombre, rol, telefono, alcance, cargo, activo, creado_en, actualizado_en, datos)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11)
       on conflict (id) do update set
         usuario=excluded.usuario, correo=excluded.correo, nombre=excluded.nombre,
         rol=excluded.rol, telefono=excluded.telefono, alcance=excluded.alcance,
         cargo=excluded.cargo, activo=excluded.activo,
         actualizado_en=excluded.actualizado_en, datos=excluded.datos`,
      [doc.id, cols.usuario ?? null, cols.correo ?? null, cols.nombre ?? null, cols.rol ?? null,
       cols.telefono ?? null, cols.alcance ?? null, cols.cargo ?? null,
       cols.activo !== false, ahora, JSON.stringify(datos)]
    );
    nUsers++;

    // Subcolección agenda del usuario.
    const ag = await doc.ref.collection('agenda').get();
    for (const t of ag.docs) {
      const d = t.data() || {};
      const tDatos = { ...d };
      ['texto', 'completada', 'fecha', 'prioridad', 'fechaCreacion', 'completadaEn', 'id'].forEach(k => delete tDatos[k]);
      await query(
        `insert into mdtask_agenda (id, uid, texto, completada, fecha, prioridad, fecha_creacion, completada_en, datos)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (id) do update set
           uid=excluded.uid, texto=excluded.texto, completada=excluded.completada,
           fecha=excluded.fecha, prioridad=excluded.prioridad,
           fecha_creacion=excluded.fecha_creacion, completada_en=excluded.completada_en, datos=excluded.datos`,
        [t.id, doc.id, String(d.texto || ''), !!d.completada, String(d.fecha || ''),
         String(d.prioridad || ''), d.fechaCreacion != null ? Number(d.fechaCreacion) : null,
         d.completadaEn != null ? Number(d.completadaEn) : null, JSON.stringify(tDatos)]
      );
      nTareas++;
    }
    if (nUsers % 20 === 0) console.log('[migrar]  ...', nUsers, 'usuarios');
  }

  console.log('[migrar] LISTO. usuarios:', nUsers, '| tareas de agenda:', nTareas);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[migrar] ERROR:', e.message); process.exit(1); });
