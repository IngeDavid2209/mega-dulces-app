import { normalizarNombre } from './permisos.util';

/**
 * ══════════ QUÉ ENTRA EN LA LISTA CUANDO ALGUIEN ESCRIBE EN EL BUSCADOR ══════════
 *
 * Existe porque esta regla vivía SUELTA dentro de `checklistsFiltrados`
 * (checklist.ts:1367), y por eso solo la tenía la mitad de la pantalla: el
 * historial —«Enviadas del equipo» y «Mis tareas enviadas»— se pinta desde
 * `enviadasFiltradas`, que recorta por DE QUIÉN es la tarea y nunca miró el
 * término escrito.
 *
 * Reportado por David el 17/sep/2026 con la captura que lo prueba: tecleó
 * «la piedad abastos» y las cuatro tarjetas en pantalla eran de **Padre
 * Hidalgo**, con el contador intacto en (94). El input escribía en la
 * variable; la lista no la leía. Y el modo de fallo es de los malos: no da
 * error, no se queda vacío — devuelve una lista COMPLETA que se lee como «no
 * hay más resultados», así que quien busca concluye que esas tareas no
 * existen.
 *
 * ⚠ UNA SOLA DEFINICIÓN, Y ES LA MITAD DEL ARREGLO. Copiar el `filter` al
 * historial habría dejado dos reglas libres de discrepar: el día que alguien
 * agregue un campo buscable en una, la otra se queda atrás y la misma
 * búsqueda devuelve dos listas distintas según la bandeja en la que estés —
 * que es exactamente el defecto de hoy, reintroducido por la puerta de al
 * lado.
 */

/**
 * Normaliza el término tecleado. Devuelve '' cuando no hay búsqueda activa,
 * y ese '' es el que las listas usan para NO filtrar nada.
 *
 * Reusa `normalizarNombre`, la misma función con la que la app cruza
 * identidades: quita tildes, espacios invisibles y puntuación, y colapsa
 * espacios. No es purismo — en un teléfono nadie escribe «Yurécuaro» con
 * acento, y hasta hoy esa búsqueda no encontraba nada sin que la pantalla
 * dijera por qué. Se normalizan LOS DOS lados o no sirve de nada.
 */
export function normalizarTerminoBusqueda(termino: string | null | undefined): string {
  return normalizarNombre(termino);
}

/**
 * ¿Esta entrega casa con lo que se escribió?
 *
 * Los tres campos son los mismos que la pantalla ya buscaba —nombre de la
 * tarea, persona y sucursal— y NO se ensancha la lista aquí: ampliar qué se
 * busca cambia qué encuentra la gente sin que nadie lo haya pedido, y eso se
 * decide aparte. Lo único que cambia hoy es DÓNDE rige la regla.
 *
 * Un término vacío devuelve `true` a propósito: «no estoy buscando» no puede
 * significar «no hay nada».
 */
export function coincideConBusqueda(c: any, terminoNormalizado: string): boolean {
  if (!terminoNormalizado) return true;
  return normalizarNombre(c?.name).includes(terminoNormalizado)
      || normalizarNombre(c?.assigned).includes(terminoNormalizado)
      || normalizarNombre(c?.store).includes(terminoNormalizado);
}

/** Recorta una lista de entregas con el término ya tecleado (sin normalizar). */
export function filtrarPorBusqueda<T>(lista: T[], termino: string | null | undefined): T[] {
  const t = normalizarTerminoBusqueda(termino);
  if (!t) return lista;
  return lista.filter(c => coincideConBusqueda(c, t));
}
