// API de `tec_grupos` (Equipos/Proyectos del Espacio TEC) sobre Postgres.
//   GET    /api/tec-grupos        -> lista
//   POST   /api/tec-grupos        -> upsert (documento completo) { id?, nombre, ... }
//   DELETE /api/tec-grupos?id=..   -> elimina
const crypto = require('crypto');
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

function fila(r) {
  const d = r.datos || {};
  return {
    id: r.id, ...d,
    miembros: Array.isArray(d.miembros) ? d.miembros : [],
    tareas: Array.isArray(d.tareas) ? d.tareas : [],
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  try { await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  try {
    if (req.method === 'GET') {
      const r = await query('select id, nombre, datos from tec_grupos');
      return res.json({ grupos: r.rows.map(fila) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const id = String(b.id || crypto.randomUUID());
      const nombre = String(b.nombre || '').trim();
      const datos = { ...b }; delete datos.id;
      const r = await query(
        `insert into tec_grupos (id, nombre, datos) values ($1,$2,$3)
         on conflict (id) do update set nombre = excluded.nombre, datos = excluded.datos
         returning *`,
        [id, nombre, JSON.stringify(datos)]
      );
      return res.json({ grupo: fila(r.rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id || (req.body || {}).id;
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      await query('delete from tec_grupos where id = $1', [String(id)]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('[tec-grupos] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
