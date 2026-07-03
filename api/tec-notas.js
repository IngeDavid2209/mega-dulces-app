// ============================================================================
//  API CRUD de tec_notas (Espacio TEC) sobre Postgres — Fase 1 (piloto).
//
//  Reemplaza los accesos directos a Firestore de la colección `tec_notas`.
//  Protegido con el idToken de Firebase (el login sigue en Firebase).
//    GET    /api/tec-notas          -> lista (creado_en desc)
//    POST   /api/tec-notas          -> crea { titulo, texto, autor }
//    PATCH  /api/tec-notas          -> edita { id, titulo, texto }
//    DELETE /api/tec-notas?id=..    -> elimina (o body { id })
// ============================================================================
const crypto = require('crypto');
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

function fila(r) {
  return {
    id: r.id, titulo: r.titulo, texto: r.texto,
    autor: r.autor, autorUid: r.autor_uid,
    creadoEn: Number(r.creado_en), actualizadoEn: Number(r.actualizado_en),
  };
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
      const r = await query('select * from tec_notas order by creado_en desc');
      return res.json({ notas: r.rows.map(fila) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const titulo = String(b.titulo || '').trim();
      const texto = String(b.texto || '').trim();
      if (!titulo && !texto) return res.status(400).json({ error: 'La nota está vacía.' });
      const ahora = Date.now();
      const id = crypto.randomUUID();
      const r = await query(
        `insert into tec_notas (id, titulo, texto, autor, autor_uid, creado_en, actualizado_en)
         values ($1,$2,$3,$4,$5,$6,$6) returning *`,
        [id, titulo || '(Sin título)', texto, b.autor || null, user.uid, ahora]
      );
      return res.json({ nota: fila(r.rows[0]) });
    }

    if (req.method === 'PATCH') {
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ error: 'Falta id.' });
      const r = await query(
        `update tec_notas set titulo = $2, texto = $3, actualizado_en = $4 where id = $1 returning *`,
        [String(b.id), String(b.titulo || '').trim() || '(Sin título)', String(b.texto || '').trim(), Date.now()]
      );
      if (r.rowCount === 0) return res.status(404).json({ error: 'Nota no encontrada.' });
      return res.json({ nota: fila(r.rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id || (req.body || {}).id;
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      await query('delete from tec_notas where id = $1', [String(id)]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('[tec-notas] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
