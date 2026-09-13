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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EL DUEÑO DE LA APLICACIÓN
 * ═══════════════════════════════════════════════════════════════════════════
 * Instrucción de David (13/sep/2026): «es el super admin, dale a él acceso a
 * todo, no debe tener límites, es quien creará las plantillas y todo».
 *
 * ─── POR QUÉ SE RECONOCE POR CORREO Y NO POR UNA BANDERA DE SU FICHA ──────
 * Porque las banderas se pierden. Todo el sistema de permisos cuelga de
 * `user.rol === 'admin'` y de una veintena de `puedeXxx` que viven en el
 * `datos` jsonb de la ficha; el 13/sep esta misma pantalla le dijo a un
 * administrador «no tienes esta sucursal en tu alcance». Si el día que se
 * apaguen las cuentas de persona (parte C) su ficha queda con un campo mal,
 * NO HAY OTRA FORMA DE ENTRAR: es la única cuenta nominal que va a quedar.
 *
 * Reconocerlo por correo hace que su acceso no dependa de ningún dato que
 * alguien pueda editar por error. El correo lo confirmó él POR ESCRITO antes de
 * escribir esto, justo porque equivocarlo dejaría la app sin administrador.
 *
 * ─── Y EL RIESGO, dicho ───────────────────────────────────────────────────
 * Quien controle una ficha con este correo tiene acceso total. Es aceptable
 * porque la cuenta es suya y él administra las fichas — pero por eso mismo el
 * correo NO se compara a la ligera: se normaliza (minúsculas y sin espacios),
 * y se mira `correo` Y `email` porque el perfil viaja con los dos nombres según
 * de dónde venga.
 */
export const CORREO_DUENO = 'davidcisneros2209@outlook.es';

/** ¿Es la cuenta dueña de la aplicación? */
export function esDueno(user: any): boolean {
  const c = String(user?.correo ?? user?.email ?? '').trim().toLowerCase();
  return c.length > 0 && c === CORREO_DUENO;
}

/** Es admin (cualquier alcance). El dueño lo es siempre. */
export function esAdmin(user: any): boolean {
  return esDueno(user) || user?.rol === 'admin';
}

/** Es admin con acceso global a todas las sucursales. El dueño, siempre. */
export function esAdminGlobal(user: any): boolean {
  if (esDueno(user)) return true;
  if (!esAdmin(user)) return false;
  return (user?.alcance ?? 'global') === 'global';
}

/**
 * Deja el perfil del dueño con TODO encendido, antes de guardarlo en la sesión.
 *
 * `esAdmin` cubre la mayoría de las condiciones —casi todas son
 * `esAdmin(u) || u?.puedeXxx`— pero NO todas: quedan pantallas que miran la
 * bandera a secas. En vez de perseguir esas condiciones una por una (y que la
 * próxima que alguien escriba vuelva a dejarlo fuera), el perfil se normaliza
 * UNA vez, al entrar, y toda la app lo lee ya completo.
 *
 * No toca a nadie más: si no es el dueño, devuelve el perfil intacto.
 */
export function conPermisosDeDueno<T extends Record<string, any>>(perfil: T): T {
  if (!esDueno(perfil)) return perfil;
  return {
    ...perfil,
    rol: 'admin',
    alcance: 'global',
    activo: true,
    // Las banderas de ficha que la app consulta hoy. Si mañana aparece otra,
    // `esAdmin` ya cubre las condiciones que la combinan con el rol.
    puedeAdministrarPersonal: true, puedeAdministrarAreas: true,
    puedeCrearChecklists: true, puedeCrearRutinas: true, puedeCrearTareasUnicas: true,
    puedeVerCalendario: true, puedeVerCheckstore: true,
    puedeVerEstadisticas: true, puedeVerHistorial: true,
    grupoTec: true, grupoTickets: true, grupoPagos: true,
    grupoFlotilla: true, grupoPromociones: true,
    promocionesFormato: true, promocionesExpediente: true,
    ventaPromosCaja: true, ventaPromosVendedor: true, ventaPromosMonitor: true,
  } as T;
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

/**
 * ¿Es admin de la sucursal Canindo? (admin global, o admin limitado con Canindo
 * en su lista de sucursales). Solo estos pueden configurar los TURNOS de Canindo.
 */
export function esAdminDeCanindo(user: any): boolean {
  if (!esAdmin(user)) return false;
  if (esAdminGlobal(user)) return true;
  const lista: string[] = user.sucursales || (user.sucursal ? [user.sucursal] : []);
  const canindo = normalizarNombre('Canindo');
  return lista.some(s => normalizarNombre(s) === canindo) ||
         lista.includes('General (Acceso Total)');
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
 *   - Todas las palabras del nombre más corto están dentro del más largo
 *     (en cualquier orden) y comparten al menos 2 palabras (nombre + apellido).
 *
 * Esto cubre los casos de perfiles desincronizados con las tareas:
 *   - Perfil "Carolina Guzman"        vs assigned "Carolina Guzman Ruiz"      → match
 *   - Perfil "Jorge Alberto Duarte V" vs assigned "Jorge Alberto Duarte"      → match
 *   - Perfil "Ventura Parienti Cadrugo" vs assigned "Ventura Cadrugo Parienti" → match (orden distinto)
 *   - Perfil "Carolina Lopez"         vs assigned "Carolina Guzman"           → NO match
 *   - Perfil "Brenda Oceguera"        vs assigned "Benda Margarita"           → NO match
 *
 * Úsalo solo para FILTRADO/CONTEO (Mis tareas, lista del trabajador puro).
 * Para guardar/asignar usa siempre el `nombre` exacto del perfil.
 */
export function mismoEmpleadoNombre(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = normalizarNombre(a);
  const nb = normalizarNombre(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(' ').filter(Boolean);
  const tb = nb.split(' ').filter(Boolean);
  const corto = ta.length <= tb.length ? ta : tb;
  const largo = ta.length <= tb.length ? tb : ta;
  // Necesitamos al menos 2 palabras en común para no confundir personas distintas.
  if (corto.length < 2) return false;
  // Todas las palabras del nombre corto deben aparecer en el largo (orden libre).
  // Cubre apellidos en distinto orden y segundo nombre/apellido de más o de menos.
  const setLargo = new Set(largo);
  return corto.every(t => setLargo.has(t));
}

/**
 * ¿Esta persona (por nombre) SIGUE EXISTIENDO en la lista de usuarios?
 *
 * Comparación TOLERANTE pensada solo para filtros de "dado de baja" (el robot
 * que decide si genera la tarea, o la limpieza de huérfanos). Es más laxa que
 * `mismoEmpleadoNombre`: además del match exacto y el de 2+ palabras, acepta un
 * nombre de UNA sola palabra si coincide con el PRIMER nombre del perfil.
 *
 * Motivo: una asignación pudo quedar guardada con el nombre corto o ligeramente
 * distinto al del perfil (p. ej. perfil "María López" vs asignación "María").
 * `mismoEmpleadoNombre` exige 2 palabras y devolvía `false`, así que el robot
 * dejaba de generar tareas a personas reales y el botón "Limpiar bajas" las
 * borraba. Aquí erramos hacia "sí existe": NO generar/NO borrar de menos.
 */
export function pareceLaMismaPersona(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = normalizarNombre(a);
  const nb = normalizarNombre(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(' ').filter(Boolean);
  const tb = nb.split(' ').filter(Boolean);
  const corto = ta.length <= tb.length ? ta : tb;
  const largo = ta.length <= tb.length ? tb : ta;
  if (corto.length >= 2) {
    const setLargo = new Set(largo);
    return corto.every(t => setLargo.has(t));
  }
  // Nombre de una sola palabra: lo damos por la misma persona si es el primer
  // nombre del otro (evita confundir un apellido suelto con el nombre).
  return corto.length === 1 && corto[0] === largo[0];
}

/**
 * ¿Existe en `usuarios` alguien que parezca ser esta persona (por nombre)?
 * Azúcar sobre `pareceLaMismaPersona` para los filtros de baja.
 */
export function existeEmpleadoEnUsuarios(nombre: string | undefined | null, usuarios: any[]): boolean {
  return !!nombre && (usuarios || []).some(u => pareceLaMismaPersona(u?.nombre, nombre));
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
