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
 * Es "supervisor / encargado": trabajador con sucursales asignadas Y al menos
 * un permiso de gestión (puedeAdministrarPersonal, puedeVerEstadisticas, etc.).
 * En el dashboard y checklist ve TODO lo de su sucursal (igual que admin limitado).
 *
 * Una trabajadora SIN ningún flag de gestión es trabajadora pura: solo ve sus
 * propias tareas (filtro por nombre).
 */
export function esSupervisor(user: any): boolean {
  if (!user || user.rol !== 'trabajador') return false;
  const sucursales: string[] = user.sucursales || (user.sucursal ? [user.sucursal] : []);
  if (sucursales.length === 0) return false;
  return !!(
    user.puedeAdministrarPersonal || user.puedeVerEstadisticas ||
    user.puedeVerCheckstore || user.puedeVerCalendario || user.puedeVerHistorial ||
    user.puedeCrearChecklists || user.puedeCrearRutinas || user.puedeCrearTareasUnicas ||
    user.puedeAdministrarAreas
  );
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

/**
 * Comparación tolerante de nombres: considera "la misma persona" si:
 *   - Son idénticos tras normalizar, O
 *   - Uno es prefijo exacto del otro (terminando en frontera de palabra) y
 *     comparten al menos 2 palabras (nombre + apellido).
 *
 * Esto cubre los casos de perfiles desincronizados con las tareas:
 *   - Perfil "Carolina Guzman"        vs assigned "Carolina Guzman Ruiz"     → match
 *   - Perfil "Jorge Alberto Duarte V" vs assigned "Jorge Alberto Duarte"     → match
 *   - Perfil "Carolina Lopez"         vs assigned "Carolina Guzman"          → NO match
 *   - Perfil "Brenda Oceguera"        vs assigned "Benda Margarita"          → NO match
 *
 * Úsalo solo para FILTRADO/CONTEO (Mis tareas, lista del trabajador puro).
 * Para guardar/asignar usa siempre el `nombre` exacto del perfil.
 */
export function mismoEmpleadoNombre(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = normalizarNombre(a);
  const nb = normalizarNombre(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const corto = na.length < nb.length ? na : nb;
  const largo = na.length < nb.length ? nb : na;
  if (!largo.startsWith(corto + ' ')) return false;
  return corto.split(' ').filter(Boolean).length >= 2;
}

/**
 * ¿Esta persona puede ser ASIGNADA a tareas/rutinas en alguna de las sucursales
 * objetivo? Sirve para los selectores de "a quién asignar".
 *
 * Incluye tanto trabajadores como ADMINISTRADORES (algunos cargos operativos
 * tienen cuenta admin y aun asi necesitan recibir tareas):
 *   - Admin global, o cualquiera con 'General (Acceso Total)' → asignable en
 *     cualquier sucursal (comodin).
 *   - Resto (trabajador o admin limitado) → si alguna de sus sucursales coincide
 *     (normalizada: tildes/mayusculas/espacios) con las objetivo.
 *   - `sucursalesObjetivo` vacio = sin filtro de sucursal → asignable.
 */
export function puedeSerAsignado(persona: any, sucursalesObjetivo: string[]): boolean {
  if (!persona) return false;
  const susSuc: string[] = (persona.sucursales && persona.sucursales.length)
    ? persona.sucursales
    : (persona.sucursal ? [persona.sucursal] : []);
  const comodin = normalizarNombre('General (Acceso Total)');
  if (esAdminGlobal(persona) || susSuc.some(s => normalizarNombre(s) === comodin)) return true;
  if (!sucursalesObjetivo || sucursalesObjetivo.length === 0) return true;
  const objNorm = new Set(sucursalesObjetivo.map(s => normalizarNombre(s)));
  return susSuc.some(s => objNorm.has(normalizarNombre(s)));
}
