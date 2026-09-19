/**
 * 🎟️ QUIÉN VE CADA PANTALLA — una definición, dos llamadores
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ EXISTE ESTE ARCHIVO
 * ═══════════════════════════════════════════════════════════════════════════
 * El 13/sep se cerró `/personal` con `usuariosGuard` y quedó escrita la lección:
 * **el menú no es un permiso**. Hasta esa fecha bastaba escribir la URL.
 *
 * Medido el 19/sep, esa lección se había aplicado a UNA ruta de seis:
 *
 *     ruta                el menú exige                     el router exigía
 *     /reportes           esAdmin || puedeVerHistorial       authGuard
 *     /cierre-mensual     esAdmin && alcance global          authGuard
 *     /manual-puestos     esAdmin || puedeCrearRutinas       authGuard
 *     /descansos          esAdmin || puedeAdministrarPersonal authGuard
 *     /tareas-asignadas   esAdmin                            authGuard
 *
 * O sea: cualquiera con sesión entraba escribiendo la dirección. `/reportes` es
 * el peor de los cinco —1 492 líneas sin UNA sola comprobación de permiso—: una
 * anaquelista que solo ve sus tareas en `/tareas` veía ahí la auditoría
 * completa de su sucursal, porque la pantalla recorta por sucursal pero no
 * pregunta quién eres.
 *
 * ─── Y POR QUÉ NO SE ESCRIBIÓ LA CONDICIÓN EN CADA GUARD ──────────────────
 * Porque eso es lo que produjo el hueco. `/descansos` ya tenía su regla escrita
 * a mano DENTRO del componente (`descansos.ts:71`), distinta en la forma de la
 * del menú aunque diga lo mismo: dos copias son una copia que se queda atrás.
 * Con tres sitios —menú, guard, componente— el día que alguien afloje uno, los
 * otros dos siguen diciendo que está cerrado.
 *
 * Aquí la condición se escribe UNA vez. El menú la importa para decidir si
 * pinta la entrada, y el guard la importa para decidir si deja pasar. **No
 * pueden desalinearse porque no hay dos cosas que alinear.**
 *
 * ─── ESTE ARCHIVO NO CAMBIA LA AUDIENCIA DE NADIE ─────────────────────────
 * Las condiciones son las que ya estaban en `nav.config.ts`, movidas tal cual.
 * `scripts/prueba-menu-audiencias.js` lo comprueba: los 15 perfiles tienen que
 * ver EXACTAMENTE las mismas rutas que antes. Lo que cambia no es quién ve la
 * entrada: es que ahora la URL también pregunta.
 *
 * ─── NO IMPORTA `@angular/router`, Y ES A PROPÓSITO ───────────────────────
 * Es la lección de `alcance.util.ts`: cuando el predicado vivía en un guard, el
 * menú acababa dependiendo del router y la prueba de audiencias —que compila
 * `nav.config.ts` sola con tsc— no podía cargarlo. El predicado es DATO. El
 * guard lo usa; el menú lo usa; ninguno de los dos es su casa.
 */

import { esAdmin } from './permisos.util';

/**
 * ⚠️ `esAdmin` DE AQUÍ RECONOCE AL DUEÑO, Y EL DE `nav.config.ts` NO LO HACÍA.
 *
 * `nav.config.ts` tenía su propio `const esAdmin = (u) => u?.rol === 'admin'`,
 * que sombrea al de `permisos.util.ts` (`esDueno(u) || rol === 'admin'`).
 *
 * Hoy no hay diferencia real: la sesión del dueño SIEMPRE trae `rol: 'admin'`,
 * forzado en dos sitios independientes —`conPermisosDeDueno()` al entrar y
 * `api/login.js:101` al firmar el token—. Pero estos predicados ya no solo
 * pintan un menú: ahora CIERRAN PUERTAS. Y el archivo de permisos dice, con
 * todas sus letras, que la suya es la única cuenta nominal que va a quedar y
 * que «NO HAY OTRA FORMA DE ENTRAR» si un dato de su ficha sale mal.
 *
 * Así que se usa el canónico. La diferencia solo puede afectar a un correo —el
 * suyo— así que no ensancha el acceso de nadie más, que es la única dirección
 * peligrosa al mover visibilidad (11/sep).
 */
const admin = (u: any) => esAdmin(u);

/** Auditoría (`/reportes`): el histórico de entregas con sus fotos. */
export function veAuditoria(u: any): boolean {
  return admin(u) || u?.puedeVerHistorial === true;
}

/**
 * Cierre Mensual (`/cierre-mensual`): el PDF de la empresa.
 *
 * Es el único de los cinco que pide alcance GLOBAL además del rol. Un admin
 * limitado a sus sucursales no cierra el mes de la compañía.
 */
export function veCierreMensual(u: any): boolean {
  return admin(u) && (u?.alcance === 'global' || !u?.alcance);
}

/** Manual por Puesto (`/manual-puestos`): dónde se captura la norma. */
export function veManualPuestos(u: any): boolean {
  return admin(u) || u?.puedeCrearRutinas === true;
}

/** Días de Descanso (`/descansos`). */
export function veDescansos(u: any): boolean {
  return admin(u) || u?.puedeAdministrarPersonal === true;
}

/**
 * Tareas asignadas (`/tareas-asignadas`): huérfana, sin entrada de menú.
 *
 * Que no tenga entrada NO es un permiso —es justo el hueco que esto cierra—,
 * así que conserva la condición con la que está declarada en el NAV.
 */
export function veTareasAsignadas(u: any): boolean {
  return admin(u);
}
