// API de `tec_conversaciones` (mensajes del Espacio TEC) sobre Postgres.
//   GET    /api/tec-conversaciones        -> lista (creado_en desc)
//   POST   /api/tec-conversaciones        -> crea { texto }
//   PATCH  /api/tec-conversaciones        -> { id, texto? , respuestas? } (parcial)
//   DELETE /api/tec-conversaciones?id=..   -> elimina
const crypto = require('crypto');
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

function fila(r) {
  return {
    id: r.id, texto: r.texto, autor: r.autor, autorUid: r.autor_uid,
    creadoEn: r.creado_en != null ? Number(r.creado_en) : null,
    editadoEn: r.editado_en != null ? Number(r.editado_en) : undefined,
    respuestas: Array.isArray(r.respuestas) ? r.respuestas : [],
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
      const r = await query('select * from tec_conversaciones order by creado_en desc');
      return res.json({ posts: r.rows.map(fila) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const texto = String(b.texto || '').trim();
      if (!texto) return res.status(400).json({ error: 'Mensaje vacío.' });
      const id = crypto.randomUUID();
      const r = await query(
        `insert into tec_conversaciones (id, texto, autor, autor_uid, creado_en, respuestas)
         values ($1,$2,$3,$4,$5,'[]'::jsonb) returning *`,
        [id, texto, b.autor || null, user.uid, Date.now()]
      );
      return res.json({ post: fila(r.rows[0]) });
    }

    if (req.method === 'PATCH') {
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ error: 'Falta id.' });
      const texto = (typeof b.texto === 'string') ? b.texto.trim() : null;
      const respuestas = Array.isArray(b.respuestas) ? JSON.stringify(b.respuestas) : null;
      const r = await query(
        `update tec_conversaciones set
           texto = coalesce($2, texto),
           editado_en = case when $2 is not null then $3 else editado_en end,
           respuestas = coalesce($4::jsonb, respuestas)
         where id = $1 returning *`,
        [String(b.id), texto, Date.now(), respuestas]
      );
      if (r.rowCount === 0) return res.status(404).json({ error: 'Mensaje no encontrado.' });
      return res.json({ post: fila(r.rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id || (req.body || {}).id;
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      await query('delete from tec_conversaciones where id = $1', [String(id)]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('[tec-conversaciones] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
