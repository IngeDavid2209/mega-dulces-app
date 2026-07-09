// ============================================================================
//  Login PÚBLICO sobre Postgres (reemplazo de Firebase Auth signIn).
//    POST /api/login  { usuario, password }
//      -> 200 { token, usuario: <perfil> }   (token = JWT propio, 30 días)
//      -> 401 si usuario/contraseña no coinciden
//
//  `usuario` puede ser el nombre de usuario o el correo. La contraseña se
//  verifica con api/_password.js (hash de Firebase exportado o bcrypt). El
//  perfil devuelto tiene el MISMO shape que GET /api/usuarios?id= (fila()).
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { firmarToken } = require('./_auth');
const { verificarPassword } = require('./_password');

// Fila de Postgres -> objeto plano estilo Firestore (idéntico a api/usuarios.js).
function fila(r) {
  const datos = r.datos || {};
  return {
    uid: r.id, id: r.id,
    usuario: r.usuario || '', correo: r.correo || '', nombre: r.nombre || '',
    rol: r.rol || '', telefono: r.telefono || '', alcance: r.alcance || '',
    cargo: r.cargo || '', activo: r.activo !== false,
    creadoEn: r.creado_en != null ? Number(r.creado_en) : null,
    actualizadoEn: r.actualizado_en != null ? Number(r.actualizado_en) : null,
    ...datos,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  try {
    const b = req.body || {};
    const entrada = String(b.usuario || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!entrada || !password) return res.status(400).json({ error: 'Falta usuario o contraseña.' });

    const r = await query(
      'select * from mdtask_usuarios where lower(usuario) = $1 or lower(correo) = $1 limit 1',
      [entrada]
    );
    const row = r.rows[0];
    const ok = row && (await verificarPassword(row, password));
    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    if (row.activo === false) return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta a tu administrador.' });

    const token = firmarToken({ uid: row.id, rol: row.rol });
    return res.json({ token, usuario: fila(row) });
  } catch (e) {
    console.error('[login] error:', e && e.message);
    return res.status(500).json({ error: 'Error interno' });
  }
};
