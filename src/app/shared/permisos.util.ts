/**
 * Utilidades de permisos compartidas.
 *
 * Modelo:
 *   user.rol      = 'admin' | 'trabajador'
 *   user.alcance  = 'global' | 'sucursales'   (solo aplica a rol === 'admin')
 *   user.sucursales = string[]                 (sucursales asignadas)
 *
 * Si user.alcance === 'sucursales', el admin tiene los mismos permisos que un admin
 * global PERO restringidos a las sucursales en user.sucursales.
 * Si user.alcance es undefined o 'global', el admin ve TODO (retro-compatible).
 */

export type AlcanceAdmin = 'global' | 'sucursales';

/** Es admin (cualquier alcance). */
export function esAdmin(user: any): boolean {
  return user?.rol === 'admin';
}

/** Es admin con acceso global a todas las sucursales. */
export function esAdminGlobal(user: any): boolean {
  if (!esAdmin(user)) return false;
  return (user?.alcance ?? 'global') === 'global';
}

/** Es admin con acceso restringido a sucursales asignadas. */
export function esAdminLimitado(user: any): boolean {
  return esAdmin(user) && user?.alcance === 'sucursales';
}

/**
 * Sucursales en las que el usuario tiene permiso de operar.
 * Devuelve null para "todas" (admin global), o un array de nombres.
 * Para no-admin devuelve sus sucursales asignadas.
 */
export function sucursalesPermitidas(user: any): string[] | null {
  if (!user) return [];
  if (esAdminGlobal(user)) return null; // null = todas
  const lista: string[] = user.sucursales || (user.sucursal ? [user.sucursal] : []);
  if (lista.includes('General (Acceso Total)')) return null;
  return lista;
}

/** Verifica si el usuario puede operar en una sucursal específica. */
export function tieneAccesoASucursal(user: any, sucursal: string): boolean {
  const permitidas = sucursalesPermitidas(user);
  if (permitidas === null) return true;
  return permitidas.includes(sucursal);
}

/** Filtra un array de items (con campo `store` o `sucursal`) a las sucursales permitidas. */
export function filtrarPorSucursalPermitida<T>(
  user: any,
  items: T[],
  getSucursal: (item: T) => string
): T[] {
  const permitidas = sucursalesPermitidas(user);
  if (permitidas === null) return items;
  return items.filter(it => permitidas.includes(getSucursal(it)));
}
