// API de la colección `areas` (áreas dinámicas) sobre Postgres.
// Solo lectura por ahora (nada en el código escribe esta colección).
// Protegido con idToken de Firebase.
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  try { await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const r = await query('select id, nombre, datos from areas order by nombre nulls last');
    const areas = r.rows.map(x => ({ id: x.id, nombre: x.nombre, ...(x.datos || {}) }));
    return res.json({ areas });
  } catch (e) {
    console.error('[areas] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
