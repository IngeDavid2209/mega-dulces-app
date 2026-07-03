// API CRUD de `areas_operativas` (Panel de Áreas) sobre Postgres.
// Protegido con idToken de Firebase.
//   GET    /api/areas-operativas        -> lista (por nombre)
//   POST   /api/areas-operativas        -> upsert { id?, nombre, ...campos } (merge)
//   DELETE /api/areas-operativas?id=..  -> elimina
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

function fila(r) { return { id: r.id, nombre: r.nombre, ...(r.datos || {}) }; }

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
      const r = await query('select id, nombre, datos from areas_operativas order by nombre nulls last');
      return res.json({ areas: r.rows.map(fila) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const id = String(b.id || ('area_' + Date.now()));
      const nombre = String(b.nombre || '').trim();
      const datos = { ...b }; delete datos.id;
      // Merge (como el setDoc merge de Firestore): conserva campos previos
      // (ej. fechaCreacion) y sobreescribe los enviados.
      const r = await query(
        `insert into areas_operativas (id, nombre, datos) values ($1, $2, $3)
         on conflict (id) do update set
           nombre = excluded.nombre,
           datos = areas_operativas.datos || excluded.datos
         returning *`,
        [id, nombre, JSON.stringify(datos)]
      );
      return res.json({ area: fila(r.rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id || (req.body || {}).id;
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      await query('delete from areas_operativas where id = $1', [String(id)]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('[areas-operativas] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
