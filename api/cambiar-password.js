// ============================================================================
//  Cambio de contraseña sobre Postgres (reemplazo de updatePassword de Firebase).
//    POST/PATCH /api/cambiar-password  { password }          -> la PROPIA
//    POST/PATCH /api/cambiar-password  { id, password }      -> otra (solo admin)
//  Guarda un hash bcrypt (password_algo='bcrypt') y limpia el salt de Firebase.
//  Autenticado con el JWT propio (Bearer).
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');
const { hashBcrypt } = require('./_password');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).json({ error: 'Use POST' });

  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  let user;
  try { user = await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  try {
    const b = req.body || {};
    const password = String(b.password || '');
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });

    let objetivo = user.uid;
    if (b.id && String(b.id) !== String(user.uid)) {
      // Cambiar la de OTRO usuario: solo admins.
      const me = await query('select rol from mdtask_usuarios where id = $1', [String(user.uid)]);
      if (!me.rows[0] || me.rows[0].rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede cambiar la contraseña de otro usuario.' });
      objetivo = String(b.id);
    }

    const hash = await hashBcrypt(password);
    const upd = await query(
      `update mdtask_usuarios set password_hash = $2, password_algo = 'bcrypt', password_salt = null, actualizado_en = $3
         where id = $1`,
      [objetivo, hash, Date.now()]
    );
    if (!upd.rowCount) return res.status(404).json({ error: 'Usuario no encontrado.' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[cambiar-password] error:', e && e.message);
    return res.status(500).json({ error: 'Error interno' });
  }
};
