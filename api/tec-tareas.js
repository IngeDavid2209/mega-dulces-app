// API de `tec_tareas` (tablero Kanban del Espacio TEC) sobre Postgres.
//   GET    /api/tec-tareas        -> lista (el cliente agrupa por columna y orden)
//   POST   /api/tec-tareas        -> upsert (tarjeta completa) { id?, ... }
//   DELETE /api/tec-tareas?id=..   -> elimina
const crypto = require('crypto');
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

function fila(r) { return { id: r.id, ...(r.datos || {}) }; }

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
      const r = await query('select id, datos from tec_tareas');
      return res.json({ tareas: r.rows.map(fila) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const id = String(b.id || crypto.randomUUID());
      const datos = { ...b }; delete datos.id;
      const r = await query(
        `insert into tec_tareas (id, datos) values ($1, $2)
         on conflict (id) do update set datos = excluded.datos returning *`,
        [id, JSON.stringify(datos)]
      );
      return res.json({ tarea: fila(r.rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id || (req.body || {}).id;
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      await query('delete from tec_tareas where id = $1', [String(id)]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('[tec-tareas] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
