// ============================================================================
//  Resolución PÚBLICA usuario -> correo (para el login) sobre Postgres.
//
//  Reemplaza la lectura pública del índice Firestore `indice_login/{usuario}`.
//  Es el ÚNICO endpoint sin token: al iniciar sesión, el usuario todavía no está
//  autenticado, y necesita resolver su correo para pasarlo a Firebase Auth.
//  Solo devuelve el CORREO (dato no sensible); nunca contraseñas ni perfil.
//    GET /api/login-usuario?usuario=<usuario o correo>  -> { correo }
// ============================================================================
const { query, dbConfigurada } = require('./db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });

  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  try {
    const entrada = String(req.query?.usuario || '').trim().toLowerCase();
    if (!entrada) return res.status(400).json({ error: 'Falta usuario.' });
    const r = await query(
      'select correo from usuarios where lower(usuario) = $1 or lower(correo) = $1 limit 1',
      [entrada]
    );
    return res.json({ correo: (r.rows[0] && r.rows[0].correo) || '' });
  } catch (e) {
    console.error('[login-usuario] error:', e && e.message);
    return res.status(500).json({ error: 'Error interno' });
  }
};
