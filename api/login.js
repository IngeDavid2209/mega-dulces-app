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

    // ── POR QUE ESTE `order by` EXISTE ──────────────────────────────────
    // Aqui decia `limit 1` a secas. Con dos fichas que comparten `usuario` o
    // `correo` -y el 31/ago/2026 se midieron TRES usuarios y DOS correos
    // repetidos- Postgres devolvia la que encontrara primero, y eso puede
    // cambiar entre planes de consulta. Consecuencias reales, no teoricas:
    //
    //   · La persona SE CONVIERTE en la ficha que gane el sorteo, y su
    //     contrasena se valida contra el hash de ESA fila. Yadira Campero
    //     tenia latidos en las dos, en dias distintos.
    //   · Peor: la comprobacion de `activo === false` esta MAS ABAJO, despues
    //     de validar la contrasena. Si la ficha desactivada gana, la persona
    //     queda FUERA de la app aunque exista una activa con el mismo usuario.
    //
    // EL ARREGLO ES DETERMINISMO, NO NEGATIVA. La tentacion era devolver error
    // ante la ambiguedad -"no adivinar"- pero esa regla es para ESCRIBIR datos,
    // no para dejar entrar a alguien: dejaria a una Encargada sin poder
    // trabajar hoy. Con un orden estable deja de brincar entre fichas, entra
    // siempre a la misma, y la colision queda gritada en el log.
    //
    // El orden: activas primero, luego las que tienen puesto, luego el latido
    // mas reciente, y `id` como desempate para que sea estable de verdad.
    // El `~ '^[0-9]+$'` evita que un ultimoLatido no numerico truene el cast.
    const r = await query(
      `select * from mdtask_usuarios u
        where lower(u.usuario) = $1 or lower(u.correo) = $1
     order by (u.activo is not false) desc,
              (coalesce(u.datos->>'puestoId', '') <> '') desc,
              case when u.datos->>'ultimoLatido' ~ '^[0-9]+$'
                   then (u.datos->>'ultimoLatido')::bigint else 0 end desc,
              u.id
        limit 3`,
      [entrada]
    );

    // La colision no se calla: si hay mas de una ficha para la misma entrada,
    // queda en el log con nombre e id para poder resolverla. No se imprime
    // ninguna contrasena ni hash.
    if (r.rows.length > 1) {
      console.error('[login] COLISION DE IDENTIDAD para "%s": %d fichas -> %s',
        entrada, r.rows.length,
        r.rows.map(x => `${x.id}:${x.nombre}${x.activo === false ? '(inactiva)' : ''}`).join(' | '));
    }

    const row = r.rows[0];
    const ok = row && (await verificarPassword(row, password));
    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    if (row.activo === false) return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta a tu administrador.' });

    // ── EL DUEÑO ENTRA SIEMPRE COMO ADMIN ──────────────────────────────────
    // El JWT lleva el rol, y los endpoints deciden con EL, no con la ficha. Si
    // la de David quedara sin `rol: admin` -un campo que se edita desde la
    // pantalla de Usuarios- sus propios endpoints le devolverian 403 y no
    // tendria forma de arreglarlo desde dentro de la app. Es la unica cuenta
    // nominal que va a quedar tras la parte C, asi que su acceso no puede
    // depender de un dato editable. Espejo de `esDueno()` en permisos.util.ts.
    const esDuenoDeLaApp =
      String(row.correo || '').trim().toLowerCase() === 'davidcisneros2209@outlook.es';
    const token = firmarToken({ uid: row.id, rol: esDuenoDeLaApp ? 'admin' : row.rol });
    return res.json({ token, usuario: fila(row) });
  } catch (e) {
    console.error('[login] error:', e && e.message);
    return res.status(500).json({ error: 'Error interno' });
  }
};
