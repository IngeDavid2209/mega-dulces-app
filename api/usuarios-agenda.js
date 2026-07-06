// ============================================================================
//  API CRUD de la AGENDA personal sobre Postgres — Etapa 1 (FERROCARRIL).
//
//  Reemplaza la subcolección Firestore usuarios/{uid}/agenda.
//  Protegido con el idToken de Firebase.
//    GET    /api/usuarios-agenda?uid=..   -> tareas de ese usuario
//    POST   /api/usuarios-agenda          -> crea { uid, texto, ... }
//    PATCH  /api/usuarios-agenda          -> edita parcial { id, ...campos }
//    DELETE /api/usuarios-agenda?id=..    -> elimina (o body { id })
// ============================================================================
const crypto = require('crypto');
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

const COLS = ['texto', 'completada', 'fecha', 'prioridad'];
const IGNORAR = new Set(['id', 'uid', 'fechaCreacion', 'completadaEn', 'fecha_creacion', 'completada_en']);

function fila(r) {
  const datos = r.datos || {};
  return {
    id: r.id, uid: r.uid,
    texto: r.texto || '', completada: !!r.completada,
    fecha: r.fecha || '', prioridad: r.prioridad || '',
    fechaCreacion: r.fecha_creacion != null ? Number(r.fecha_creacion) : null,
    completadaEn: r.completada_en != null ? Number(r.completada_en) : null,
    ...datos,
  };
}

function desglosar(obj) {
  const cols = {}, datos = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (IGNORAR.has(k)) continue;
    if (COLS.includes(k)) cols[k] = v;
    else datos[k] = v;
  }
  return { cols, datos };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  let user;
  try { user = await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  try {
    if (req.method === 'GET') {
      const uid = req.query?.uid || user.uid; // por defecto, las del propio usuario
      const r = await query('select * from mdtask_agenda where uid = $1 order by fecha_creacion asc', [String(uid)]);
      return res.json({ tareas: r.rows.map(fila) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const uid = String(b.uid || user.uid || '').trim();
      if (!uid) return res.status(400).json({ error: 'Falta uid.' });
      const { cols, datos } = desglosar(b);
      if (!String(cols.texto || '').trim()) return res.status(400).json({ error: 'Falta el texto de la tarea.' });
      const id = String(b.id || crypto.randomUUID());
      const ahora = b.fechaCreacion != null ? Number(b.fechaCreacion) : Date.now();
      const r = await query(
        `insert into mdtask_agenda (id, uid, texto, completada, fecha, prioridad, fecha_creacion, completada_en, datos)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [id, uid, String(cols.texto), !!cols.completada, String(cols.fecha || ''),
         String(cols.prioridad || ''), ahora, (b.completadaEn != null ? Number(b.completadaEn) : null),
         JSON.stringify(datos)]
      );
      return res.json({ tarea: fila(r.rows[0]) });
    }

    if (req.method === 'PATCH') {
      const b = req.body || {};
      const id = String(b.id || '').trim();
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      const cur = await query('select * from mdtask_agenda where id = $1', [id]);
      if (cur.rowCount === 0) return res.status(404).json({ error: 'Tarea no encontrada.' });
      const actual = cur.rows[0];
      const { cols, datos } = desglosar(b);
      const val = (k) => (k in cols ? cols[k] : actual[k]);
      const mergedDatos = { ...(actual.datos || {}), ...datos };
      const r = await query(
        `update mdtask_agenda set texto=$2, completada=$3, fecha=$4, prioridad=$5,
           completada_en=$6, datos=$7 where id=$1 returning *`,
        [id, String(val('texto') || ''), ('completada' in cols ? !!cols.completada : actual.completada),
         String(val('fecha') || ''), String(val('prioridad') || ''),
         (b.completadaEn != null ? Number(b.completadaEn) : actual.completada_en),
         JSON.stringify(mergedDatos)]
      );
      return res.json({ tarea: fila(r.rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id || (req.body || {}).id;
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      await query('delete from mdtask_agenda where id = $1', [String(id)]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('[usuarios-agenda] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
