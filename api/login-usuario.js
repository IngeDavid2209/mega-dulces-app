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
    // Mismo orden estable que api/login.js, y por el mismo motivo: con dos
    // fichas que comparten usuario o correo, un `limit 1` suelto devolvia una u
    // otra segun el plan de consulta. Este endpoint solo resuelve usuario→correo
    // para el camino viejo de Firebase, pero si devuelve un correo distinto al
    // que login.js elige, la persona acaba autenticandose contra otra ficha.
    // Los dos tienen que ordenar IGUAL o la incoherencia sigue viva.
    const r = await query(
      `select u.correo, u.id, u.nombre, u.activo from mdtask_usuarios u
        where lower(u.usuario) = $1 or lower(u.correo) = $1
     order by (u.activo is not false) desc,
              (coalesce(u.datos->>'puestoId', '') <> '') desc,
              case when u.datos->>'ultimoLatido' ~ '^[0-9]+$'
                   then (u.datos->>'ultimoLatido')::bigint else 0 end desc,
              u.id
        limit 3`,
      [entrada]
    );
    if (r.rows.length > 1) {
      console.error('[login-usuario] COLISION DE IDENTIDAD para "%s": %d fichas -> %s',
        entrada, r.rows.length,
        r.rows.map(x => `${x.id}:${x.nombre}${x.activo === false ? '(inactiva)' : ''}`).join(' | '));
    }
    return res.json({ correo: (r.rows[0] && r.rows[0].correo) || '' });
  } catch (e) {
    console.error('[login-usuario] error:', e && e.message);
    return res.status(500).json({ error: 'Error interno' });
  }
};
