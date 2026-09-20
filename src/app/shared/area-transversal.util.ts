/**
 * 🔀 LAS ÁREAS TRANSVERSALES — quién ve una tarea de MANTENIMIENTO o SISTEMAS
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA INSTRUCCIÓN (David, 20/sep/2026)
 * ═══════════════════════════════════════════════════════════════════════════
 * «Encargadas, jefes de zona, auxiliares de encargadas y todo lo que tenga que
 *  ver con esos puestos en el organigrama […] no pueden ver las tareas que
 *  tienen asignadas el departamento de Sistemas y Mantenimiento, a menos de que
 *  su sucursal las haya asignado; solo así pueden ver las que asignaron.»
 *
 * ─── POR QUÉ HOY LAS VEN TODAS ────────────────────────────────────────────
 * El filtro de visibilidad tiene UN SOLO EJE: `alcanceCubre(permitidas, store)`.
 * Y `store` hace **dos trabajos a la vez** —dónde ocurre el trabajo y de qué
 * departamento es— que es el hallazgo del 4/sep («unidad responsable contra
 * unidad servida», §5 del CLAUDE.md).
 *
 * El detonante concreto está medido y escrito desde el 15/sep: la ficha de una
 * Encargada lleva `8 Esquinas`, `MANTENIMIENTO` y `SISTEMAS`, y esas dos
 * últimas **están ahí para que pueda levantar un ticket, no porque trabaje
 * ahí**. Como `sucursalesPermitidas` las devuelve igual que su tienda, el
 * filtro le enseña TODAS las órdenes de mantenimiento de la empresa —incluidas
 * las de las otras siete sucursales—.
 *
 * ─── LA REGLA ES DE RECORTE, QUE ES LA DIRECCIÓN SEGURA ───────────────────
 * Nadie gana visibilidad con este archivo; unos cuantos dejan de ver lo que no
 * es suyo. Ensanchar es la única dirección de verdad peligrosa (11/sep).
 *
 * ─── PERO ESCONDER TAMBIÉN HACE DAÑO, Y POR ESO SE IDENTIFICA EN POSITIVO ──
 * El error caro aquí no es «una Encargada ve de más»: es **esconderle su
 * trabajo a quien tiene que hacerlo**. Un técnico de mantenimiento que deja de
 * ver sus órdenes no las hace, y eso no se reporta como bug: se reporta como
 * que no sirve la app.
 *
 * Así que la restricción NO se aplica «a todo el que no sea de Sistemas». Se
 * aplica solo a quien se puede identificar POSITIVAMENTE como operación de
 * sucursal o zona. Quien no resuelva puesto —y el 15/sep se midieron 44 fichas
 * activas así— conserva lo que ve hoy. Es la misma red que `esJefatura`.
 */

import { puestoPorId, PUESTOS_ORGANIGRAMA, UnidadOrganigrama } from './organigrama.catalogo';
import { resolverPuesto } from './puesto.util';
import { esAdminGlobal, normalizarNombre, mismoEmpleadoNombre, alcanceCubre } from './permisos.util';

/**
 * Las áreas cuyo trabajo NO es de la sucursal aunque ocurra en ella.
 *
 * Es una lista corta y explícita porque **la nombró David**, no porque se haya
 * deducido por parecido: «el departamento de sistemas y mantenimiento». No se
 * deriva de `clasificarDestino` porque ahí MANTENIMIENTO es 'canal' y SISTEMAS
 * es 'corporativo' —dos etiquetas distintas para lo mismo a estos efectos— y
 * tomar 'corporativo' entero se llevaría RH, FINANZAS, COMPRAS y CONTABILIDAD,
 * que él no mencionó. Extenderla es añadir un renglón aquí.
 */
export const AREAS_TRANSVERSALES = ['MANTENIMIENTO', 'SISTEMAS'];

const AREAS_NORM = new Set(AREAS_TRANSVERSALES.map(a => normalizarNombre(a)));

/** ¿El `store` de esta tarea es un área transversal y no un lugar de trabajo? */
export function esAreaTransversal(store: string | null | undefined): boolean {
  return AREAS_NORM.has(normalizarNombre(store || ''));
}

/**
 * Las unidades del organigrama que cuelgan de una Gerencia de Zona, más la
 * suya. Es exactamente «encargadas, jefes de zona, auxiliares y todo lo que
 * tenga que ver con esos puestos».
 *
 * ─── SE DERIVA, NO SE ESCRIBE ─────────────────────────────────────────────
 * Salen de recorrer `reportaA` desde `gerencia-zona`, igual que la pirámide.
 * Una lista a mano —«sucursal, zona, staff-zona, operaciones-zona, ventas»—
 * hay que acordarse de actualizarla el día que el organigrama cambie, y el que
 * se olvide deja a alguien viendo lo que no debe sin que nada falle.
 * Medido hoy: 40 puestos en esa rama, 5 unidades.
 */
export const UNIDADES_DE_ZONA: ReadonlySet<UnidadOrganigrama> = (() => {
  const u = new Set<UnidadOrganigrama>(['zona']);
  const vistos = new Set<string>();
  const vigentes = PUESTOS_ORGANIGRAMA.filter(p => p.vigente !== false);
  (function bajar(id: string) {
    for (const h of vigentes.filter(x => x.reportaA === id)) {
      if (vistos.has(h.id)) continue;      // el catálogo no tiene ciclos, pero
      vistos.add(h.id);                    // un recorrido sin memoria no se cuelga
      u.add(h.unidad);                     // por accidente, se cuelga por descuido
      bajar(h.id);
    }
  })('gerencia-zona');
  return u;
})();

/**
 * ¿A esta persona le aplica el recorte? Es decir: ¿es operación de sucursal o
 * de zona, según el ORGANIGRAMA?
 *
 * Se mira el PUESTO y no `sucursales[]` a propósito: ese campo es justo el que
 * hace dos trabajos y el que causa el problema —lleva MANTENIMIENTO porque la
 * persona puede levantar tickets ahí, no porque sea de Mantenimiento—.
 *
 * Un admin global no se restringe: ve la empresa por definición.
 * Un puesto que no resuelve tampoco: ver la nota de la cabecera.
 */
export function esOperacionDeZona(usuario: any): boolean {
  if (!usuario) return false;
  if (esAdminGlobal(usuario)) return false;
  const r = resolverPuesto(usuario);
  if (!r.puestoId) return false;            // sin puesto NO se recorta (la red)
  const p = puestoPorId(r.puestoId);
  return !!p && UNIDADES_DE_ZONA.has(p.unidad);
}

/**
 * ¿Esta persona TRABAJA en el área de la tarea? Entonces la ve toda.
 *
 * Sale del puesto, no de `sucursales[]`:
 *   · SISTEMAS       → los puestos de la unidad `sistemas`.
 *   · MANTENIMIENTO  → los puestos cuyo id nombra mantenimiento. Hoy el
 *     organigrama solo declara `jefe-mantenimiento`, y su cuadrilla no está
 *     capturada: por eso la restricción se aplica solo a quien se identifica
 *     POSITIVAMENTE como de zona, y un técnico sin puesto conserva su vista.
 */
export function perteneceAlArea(usuario: any, store: string | null | undefined): boolean {
  const r = resolverPuesto(usuario);
  if (!r.puestoId) return false;
  const p = puestoPorId(r.puestoId);
  if (!p) return false;
  const area = normalizarNombre(store || '');
  if (area === normalizarNombre('SISTEMAS')) return p.unidad === 'sistemas';
  if (area === normalizarNombre('MANTENIMIENTO')) return /mantenimiento/i.test(p.id);
  return false;
}

/**
 * De qué sucursal salió esta orden, si lo dice.
 *
 * `checklist.ts:4889` guarda `mantenimiento.sucursalOrigen` cuando la tarea se
 * crea con `store = 'MANTENIMIENTO'`. Hasta hoy ese campo **solo se pintaba en
 * el detalle**: no lo leía ningún filtro. Es la «unidad servida» del §5, ya
 * capturada y sin usar.
 *
 * ⚠ SISTEMAS NO TIENE EQUIVALENTE. El formulario solo pide origen para
 * MANTENIMIENTO, así que de una tarea de Sistemas no se puede saber de qué
 * tienda salió. Para esas, lo único que queda es «la creé yo», que es
 * literalmente lo que pidió David («solo así pueden ver las que asignaron»).
 * Queda anotado como dato que falta, no rellenado por parecido (§8.5).
 */
export function origenDeTarea(c: any): string | null {
  const s = c?.mantenimiento?.sucursalOrigen;
  const t = String(s ?? '').trim();
  return t ? t : null;
}

/**
 * ¿Puede ver ESTA tarea de área transversal?
 *
 * Se llama solo cuando `esAreaTransversal(c.store)` y `esOperacionDeZona(u)`.
 * Cinco puertas, y cada una responde a una frase de la instrucción:
 *
 *   1. pertenece al área          → es su trabajo
 *   2. está asignada a ella       → es su trabajo, aunque el área sea otra
 *   3. la creó ella               → «las que asignaron»
 *   4. el origen es su sucursal   → «a menos de que su sucursal las haya asignado»
 *   5. si no                      → no la ve
 *
 * La 2 no es un adorno: sin ella, el día que a alguien de sucursal le toque
 * apoyar en una orden de mantenimiento, la tarea le desaparecería de la lista
 * y nadie sabría por qué.
 */
export function veTareaTransversal(usuario: any, c: any, permitidas: string[] | null): boolean {
  if (perteneceAlArea(usuario, c?.store)) return true;
  if (mismoEmpleadoNombre(usuario?.nombre, c?.assigned)) return true;
  if (mismoEmpleadoNombre(usuario?.nombre, c?.createdBy)) return true;
  const origen = origenDeTarea(c);
  if (origen && alcanceCubre(permitidas, origen)) return true;
  // `alcanceCubre` con una lista que trae el área no sirve aquí —MANTENIMIENTO
  // está en `permitidas` y casaría consigo mismo—, así que se compara el ORIGEN,
  // que siempre es una sucursal de verdad.
  return false;
}

/**
 * El recorte completo, para usarlo en un `filter`.
 *
 * Devuelve `true` si la tarea debe seguir viéndose. Todo lo que no sea de un
 * área transversal pasa intacto, y quien no sea operación de zona también:
 * este archivo no puede esconder nada más de lo que dice su nombre.
 */
export function pasaFiltroTransversal(usuario: any, c: any, permitidas: string[] | null): boolean {
  if (!esAreaTransversal(c?.store)) return true;
  if (!esOperacionDeZona(usuario)) return true;
  return veTareaTransversal(usuario, c, permitidas);
}
