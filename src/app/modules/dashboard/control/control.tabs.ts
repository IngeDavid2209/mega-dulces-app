/**
 * 🎛️ LAS PESTAÑAS DE CONTROL OPERATIVO · una sola definición del permiso
 *
 * Estadísticas, Ranking, Productividad y Sucursales son cortes de la misma
 * pregunta, así que se funden en una pantalla con pestañas. El límite del
 * documento 4 —siete entradas de menú por nivel— no se alcanza sin esta fusión.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠ EL RIESGO DE ESTA FUSIÓN NO ES ROMPER: ES ESCALAR PRIVILEGIOS
 * ═══════════════════════════════════════════════════════════════════════════
 * Las cuatro pantallas tienen condiciones DISTINTAS. Estadísticas pide
 * `esAdmin || puedeVerEstadisticas`; Sucursales pide `esAdmin ||
 * puedeVerCheckstore`. Si el cascarón se viera con la UNIÓN de las cuatro,
 * alguien que solo tenía Sucursales entraría y vería Estadísticas — un permiso
 * que nunca tuvo, regalado por una reorganización de menú.
 *
 * Por eso la regla es de dos niveles y está implementada aquí, no repartida:
 *
 *   · El CASCARÓN se ve si se ve AL MENOS UNA de sus pestañas → `veControl()`.
 *   · Cada PESTAÑA se gatea por SU PROPIO permiso → el `ve` de cada tab, que
 *     usan por igual el guard de la ruta hija y la barra de pestañas.
 *
 * Entrar al cascarón NUNCA da acceso a una pestaña.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Y LA PRUEBA DE AUDIENCIAS NO PUEDE VER ESTO
 * ═══════════════════════════════════════════════════════════════════════════
 * `scripts/prueba-menu-audiencias.js` compara rutas y verifica que NADIE PERDIÓ
 * acceso. Que nadie GANE acceso es la dirección opuesta y no está cubierta: una
 * escalada pasaría su verde sin una sola advertencia.
 *
 * Queda pendiente para el paso 2d: un caso que compare, por perfil, el conjunto
 * de pestañas visibles contra el conjunto de rutas que ese perfil veía antes. Si
 * ve una pestaña cuya pantalla original no le tocaba, es escalada.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LOS PERMISOS SON LOS DE HOY, COPIADOS TAL CUAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Salen de `nav.config.ts`, que a su vez los sacó del `sidebar.html` anterior.
 * Ni endurecidos ni relajados: mezclar reorganización con cambio de permisos
 * hace imposible saber cuál de los dos rompió algo.
 */

import { esAdmin } from '../../../shared/permisos.util';

export interface TabControl {
  /** Segmento de la URL: `/control/<ruta>`. */
  ruta: string;
  etiqueta: string;
  /** Su propio permiso. Idéntico al que tenía la pantalla suelta. */
  ve: (u: any) => boolean;
}

/**
 * El orden es el de lectura, no el de construcción: primero el detalle por
 * sucursal, luego las comparaciones, y la auditoría al final.
 *
 * Las pestañas se van agregando de a una (pasos 2b, 2c, 2d). Mientras una no
 * esté aquí, su pantalla sigue viva en su ruta propia y nadie pierde nada.
 */
export const TABS_CONTROL: TabControl[] = [
  { ruta: 'estadisticas', etiqueta: 'Estadísticas',
    ve: (u) => esAdmin(u) || u?.puedeVerEstadisticas },

  // Ranking es la PRIMERA pestaña que hace que "ver el cascaron" y "ver la
  // pestaña" dejen de ser lo mismo: su permiso es MAS ANCHO que el de
  // Estadisticas -incluye puedeVerCheckstore-, asi que hay usuarios que ven el
  // cascaron por una y no por la otra. De ahi que la prueba de audiencias
  // pregunte por la pestaña y no por /control.
  { ruta: 'ranking', etiqueta: 'Ranking Semanal',
    ve: (u) => esAdmin(u) || u?.puedeVerEstadisticas || u?.puedeVerCheckstore },
  // Productividad comparte EXACTAMENTE el permiso de Ranking, y por eso no
  // aporta ningun caso nuevo a la prueba: ningun perfil puede ver una y no la
  // otra. Se anota aqui para que nadie lo lea como un descuido.
  { ruta: 'productividad', etiqueta: 'Productividad y turno',
    ve: (u) => esAdmin(u) || u?.puedeVerEstadisticas || u?.puedeVerCheckstore },
  // 2d · Sucursales             ve: esAdmin || puedeVerCheckstore
];

/** Las pestañas que este usuario puede abrir. */
export function tabsVisibles(u: any): TabControl[] {
  return TABS_CONTROL.filter(t => t.ve(u));
}

/**
 * ¿Se ve el cascarón? Sí cuando hay al menos una pestaña que abrir.
 *
 * `nav.config.ts` importa ESTA función en vez de repetir la condición: si mañana
 * una pestaña cambia de permiso, el menú y el guard cambian juntos o no cambian.
 */
export function veControl(u: any): boolean {
  return tabsVisibles(u).length > 0;
}

/** La pestaña por defecto de este usuario, o null si no puede abrir ninguna. */
export function primeraTab(u: any): TabControl | null {
  return tabsVisibles(u)[0] || null;
}
