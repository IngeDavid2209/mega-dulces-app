/**
 * 📕 ¿ESTA ENTREGA SALE DEL MANUAL CORPORATIVO?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ ES UNA FUNCIÓN COMPARTIDA Y NO UN MÉTODO DEL COMPONENTE
 * ═══════════════════════════════════════════════════════════════════════════
 * Hasta el 14/sep/2026 esta regla vivía SOLO dentro de `checklist.ts`
 * (`esTareaDeManual`), y eso bastaba porque el apartado del Manual era una
 * PANTALLA aparte: ahí no había botones de editar ni de borrar, punto.
 *
 * Al unir las dos listas en una sola, el modo dejó de proteger nada y la
 * pregunta pasa a hacerse POR TARJETA — también dentro del panel de
 * responsables, que es otro componente. Dos copias de una regla es una copia
 * que se queda atrás (§2), y ésta gobierna el invariante §5.4: la norma se
 * versiona, no se edita.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ MIRA LOS DOS CAMINOS
 * ═══════════════════════════════════════════════════════════════════════════
 * El robot sella `_origenManual: true` en la raíz del documento
 * (`robot-manual.service.ts`), pero un checklist que llega por la API viene con
 * el resto del documento dentro de `datos` (§2, patrón de tabla: columnas
 * tipadas + `datos jsonb`). Mirar solo uno de los dos deja pasar la mitad de
 * las entregas como si fueran libres — o sea, EDITABLES.
 *
 * Es comparación estricta con `true` a propósito: un `'false'` de texto o un
 * `1` heredado no deben colar una entrega del manual al lado editable.
 */
export function esEntregaDeManual(checklist: any): boolean {
  return checklist?._origenManual === true || checklist?.datos?._origenManual === true;
}
