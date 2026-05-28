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
 * Es "supervisor / encargado": trabajador con sucursales asignadas.
 * En el dashboard ve el avance de SUS sucursales (igual que un admin limitado),
 * no solo sus tareas personales. En el checklist personal sigue viendo sus
 * propias tareas para completarlas.
 *
 * Nota: antes se exigían flags de admin (puedeVerEstadisticas, etc.) además de
 * sucursales. Se simplificó a solo sucursales porque las "encargadas" muchas
 * veces no tienen flags configurados pero sí su sucursal.
 */
export function esSupervisor(user: any): boolean {
  if (!user || user.rol !== 'trabajador') return false;
  const sucursales: string[] = user.sucursales || (user.sucursal ? [user.sucursal] : []);
  return sucursales.length > 0;
}

/** ¿Debe ver el panel como gestor de sucursales? (admin global, admin limitado o supervisor). */
export function tieneVistaDeGestion(user: any): boolean {
  return esAdmin(user) || esSupervisor(user);
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

/**
 * Normaliza un nombre para comparación tolerante: sin tildes, lowercase, sin espacios extra.
 * Útil cuando se compara `currentUser.nombre` contra otros nombres en la base de datos
 * que pueden tener pequeñas variaciones de acento, mayúsculas o espacios.
 */
export function normalizarNombre(n: string | undefined | null): string {
  if (!n) return '';
  return n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')                          // quita tildes
    .replace(/[​-‍﻿  ]/g, ' ') // espacios "invisibles" (NBSP, ZWSP, BOM, etc.) → espacio normal
    .replace(/[^\p{L}\p{N}\s]/gu, '')                // quita puntuación y símbolos
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');                           // colapsa espacios múltiples
}

/** ¿Es el mismo trabajador? Compara `currentUser.nombre` contra otro nombre con normalización. */
export function esMismoTrabajador(currentUser: any, otroNombre: string | undefined | null): boolean {
  if (!currentUser?.nombre || !otroNombre) return false;
  return normalizarNombre(currentUser.nombre) === normalizarNombre(otroNombre);
}
