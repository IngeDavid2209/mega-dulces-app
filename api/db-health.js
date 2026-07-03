// ============================================================================
//  Endpoint de SALUD de Postgres — Fase 0 de la migración.
//
//  Sirve para confirmar, sin datos sensibles, si:
//   - DATABASE_URL ya está configurada, y
//   - el servidor puede conectarse a Postgres (SELECT now()).
//
//  Antes de crear el Postgres devuelve { configured: false } (no truena).
// ============================================================================
const { query, dbConfigurada } = require('./db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!dbConfigurada()) {
    return res.json({ ok: false, configured: false, mensaje: 'DATABASE_URL no configurada todavía.' });
  }
  try {
    const r = await query('SELECT now() AS ahora, version() AS version');
    return res.json({
      ok: true,
      configured: true,
      ahora: r.rows[0].ahora,
      version: r.rows[0].version,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, configured: true, error: (e && e.message) || 'Error de conexión' });
  }
};
