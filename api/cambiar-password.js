// ============================================================================
//  Cambio de contraseña sobre Postgres (reemplazo de updatePassword de Firebase).
//    POST/PATCH /api/cambiar-password  { password }          -> la PROPIA
//    POST/PATCH /api/cambiar-password  { id, password }      -> otra (solo admin)
//  Guarda un hash bcrypt (password_algo='bcrypt') y limpia el salt de Firebase.
//  Autenticado con el JWT propio (Bearer).
// ============================================================================
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('./db');
const { verificarToken, initAdmin } = require('./_auth');
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

    // ------------------------------------------------------------------
    // 1) Firebase Auth: HOY es quien valida el login (ver components/login).
    //    Si esto no se cambia, la persona sigue entrando con la de antes por
    //    mas que la base diga otra cosa. Va primero y, si falla, no se toca
    //    nada mas y se avisa: el bug que se arreglo aqui era justamente que
    //    todo decia "guardado" sin haber cambiado la contrasena de acceso.
    // ------------------------------------------------------------------
    try {
      initAdmin();
      await admin.auth().updateUser(String(objetivo), { password });
    } catch (e) {
      const codigo = String((e && e.code) || '');
      console.error('[cambiar-password] Firebase:', codigo, e && e.message);
      if (codigo.includes('user-not-found')) {
        return res.status(404).json({
          error: 'Ese usuario no tiene cuenta de acceso, solo ficha en el directorio. Hay que crearsela de nuevo para que pueda entrar.'
        });
      }
      return res.status(502).json({
        error: 'No se pudo cambiar la contrasena de acceso, asi que no se cambio nada. Intentalo de nuevo.'
      });
    }

    // ------------------------------------------------------------------
    // 2) Hash propio en Postgres, para el login nuevo (/api/login). Hoy no hay
    //    ni una fila con hash, asi que este paso es el que lo va sembrando.
    // ------------------------------------------------------------------
    const hash = await hashBcrypt(password);
    const upd = await query(
      `update mdtask_usuarios set password_hash = $2, password_algo = 'bcrypt', password_salt = null, actualizado_en = $3
         where id = $1`,
      [objetivo, hash, Date.now()]
    );
    // La contrasena de acceso YA cambio arriba; si no hay fila que actualizar es
    // un descuadre entre Firebase y la base, y hay que decirlo tal cual.
    if (!upd.rowCount) {
      return res.status(200).json({
        ok: true,
        aviso: 'La contrasena de acceso si cambio, pero no encontre a ese usuario en la base para guardar su respaldo.'
      });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[cambiar-password] error:', e && e.message);
    return res.status(500).json({ error: 'Error interno' });
  }
};
