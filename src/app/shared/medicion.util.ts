/**
 * 📏 QUÉ CUENTA COMO TRABAJO OPERATIVO
 *
 * Regla única de qué checklists entran en las mediciones de la operación:
 * Dashboard, Estadísticas, Ranking Semanal, Sucursales y Auditoría.
 *
 * ─── POR QUÉ EXISTE ESTE ARCHIVO ────────────────────────────────────────────
 * La condición vivía copiada en siete lugares distintos, y basta que una copia
 * se quede atrás para que dos pantallas midan cosas distintas y nadie sepa
 * cuál creer. Aquí se decide una vez.
 *
 * ─── QUÉ SE EXCLUYE, Y POR QUÉ ──────────────────────────────────────────────
 *
 *  · eliminado / archivado — lo de siempre: borrado o cerrado en el mes.
 *
 *  · origenTec — las tareas que reparte el ESPACIO TEC.
 *
 *    Esta es la que se agregó el 2026-08-28, y vale la pena explicarla. El
 *    Espacio TEC es un programa aparte: un grupo de estudiantes que asigna sus
 *    propias tareas a personal de la empresa, con su propio apartado. Su trabajo
 *    es real, pero NO es la operación de las sucursales.
 *
 *    Mezclarlo distorsionaba la medición de forma grave. Tras el corte que
 *    olvidó las tareas anteriores —que conservó las del TEC a propósito—, lo
 *    único que quedó con volumen fueron ellas: el tablero mostraba a dos
 *    personas con 0/57 y 0/27 hundiendo el ranking, mientras la operación real
 *    aparecía con 1/1. El tablero decía que la empresa iba mal cuando lo que
 *    medía era otra cosa.
 *
 *    Las tareas del TEC NO se borran ni se ocultan: siguen intactas, y su
 *    apartado las sigue mostrando. Simplemente dejan de contarse donde se mide
 *    la operación.
 */

/**
 * ─── EXCLUSIÓN DOCUMENTADA (agregado el 2026-08-31) ─────────────────────────
 *
 * `_excluidoKpi` saca un checklist de las mediciones SIN BORRARLO. Nace de un
 * problema que no se resuelve desactivando una ficha duplicada:
 *
 * Morelia Abastos acumuló 698 puntos asignados porque tenía DOS fichas de
 * Encargada y recibía dos juegos de apertura y cierre. Apagar la ficha fantasma
 * detiene la sangría, pero los puntos ya contados se quedan en el denominador:
 * el cumplimiento histórico de esa sucursal quedaría hundido para siempre, y en
 * tres meses nadie recordaría por qué.
 *
 * Por el invariante «nada se borra ni se sobrescribe», el checklist se conserva
 * intacto y se le agregan cinco campos que dicen quién lo excluyó, cuándo, por
 * qué y con qué evento (`_excluidoEvento`), para que la exclusión se pueda
 * auditar y revertir con exactitud. Lo que cambia no es el dato: es que deja de
 * contarse como trabajo que alguien no hizo.
 *
 * Se compara contra `true` estricto a propósito: un `_excluidoKpi` ausente,
 * nulo o con cualquier otro valor NO excluye nada. Una exclusión tiene que ser
 * deliberada, nunca el efecto de un campo a medio escribir.
 */

/** ¿Este checklist cuenta para las mediciones de la operación? */
export function cuentaEnOperacion(c: any): boolean {
  if (!c) return false;
  if (c.eliminado === true) return false;
  if (c.archivado === true) return false;
  if (c.origenTec === true) return false;   // el Espacio TEC se mide aparte
  if (c._excluidoKpi === true) return false;  // exclusión documentada, ver arriba
  return true;
}

/** El motivo por el que un checklist quedó fuera del KPI, o '' si sí cuenta. */
export function motivoExclusion(c: any): string {
  return c && c._excluidoKpi === true ? String(c._excluidoMotivo || 'sin motivo registrado') : '';
}

/** El negativo, para los `if (...) return;` que ya existen en las pantallas. */
export function fueraDeOperacion(c: any): boolean {
  return !cuentaEnOperacion(c);
}
