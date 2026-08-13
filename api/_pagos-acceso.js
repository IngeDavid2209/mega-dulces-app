// ============================================================================
//  Candado del modulo de PAGOS DE SERVICIOS.
//
//  El acceso NO se decide solo en el navegador: el guard de Angular esconde el
//  menu, pero cualquiera con el token podria pegarle al endpoint a mano. Aqui se
//  vuelve a preguntar contra la base, que es la unica fuente de verdad.
//
//  Quien entra:
//    - `grupoPagos: true` en su perfil (la bandera que se prende desde Personal), o
//    - rol 'admin'.
//
//  El rol admin entra A PROPOSITO. Ya nos paso una vez (commit 0023b34) que un
//  candado dejo fuera al administrador general y nadie podia arreglar nada; el
//  administrador siempre debe poder entrar a destrabar el modulo.
// ============================================================================
const { query } = require('./db');

/**
 * ¿Este usuario puede ver/tocar el modulo de pagos?
 * Devuelve { ok, admin, motivo }.
 */
async function puedeVerPagos(usuario) {
  const uid = usuario && usuario.uid;
  if (!uid) return { ok: false, admin: false, motivo: 'sin_uid' };

  // El rol del token ya alcanza para el admin (no hace falta ir a la base).
  if (String(usuario.rol || '') === 'admin') return { ok: true, admin: true, motivo: 'admin' };

  try {
    const r = await query(
      `select rol, coalesce(datos->>'grupoPagos','') as grupo_pagos
         from mdtask_usuarios where id = $1 limit 1`,
      [String(uid)]
    );
    const u = r.rows[0];
    if (!u) return { ok: false, admin: false, motivo: 'usuario_no_existe' };
    if (String(u.rol || '') === 'admin') return { ok: true, admin: true, motivo: 'admin' };
    if (String(u.grupo_pagos) === 'true') return { ok: true, admin: false, motivo: 'grupoPagos' };
    return { ok: false, admin: false, motivo: 'sin_permiso' };
  } catch (e) {
    console.error('[pagos-acceso] no se pudo consultar el permiso:', e && e.message);
    // Si la base falla, se NIEGA. Es un modulo de dinero: preferimos que se
    // queje "no tengo acceso" a abrirlo de par en par por un hipo de la base.
    return { ok: false, admin: false, motivo: 'error_base' };
  }
}

/**
 * Igual que arriba pero para usar directo en un endpoint: si no puede, ya
 * responde el 403 y devuelve null. Si puede, devuelve el permiso.
 */
async function exigirAccesoPagos(usuario, res) {
  const permiso = await puedeVerPagos(usuario);
  if (!permiso.ok) {
    res.status(403).json({ error: 'No tienes acceso al módulo de pagos de servicios.' });
    return null;
  }
  return permiso;
}

module.exports = { puedeVerPagos, exigirAccesoPagos };
