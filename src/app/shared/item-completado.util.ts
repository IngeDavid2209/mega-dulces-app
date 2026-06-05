/**
 * Criterio unificado para considerar un item como "hecho" en toda la app.
 *
 * Reglas:
 *   1) Si el item tiene su evidencia real (foto, antes/después, varias fotos)
 *      o quedó palomeado cuando no pedía evidencia → HECHO.
 *   2) Si el checklist completo trae justificación del colaborador
 *      (notaEmpleado con texto o entregaConRetraso === true), TODOS sus items
 *      cuentan como hechos para los KPIs. La idea es que cuando el trabajador
 *      explica por qué no pudo completar, esa entrega justificada se considera
 *      "buena" para el cumplimiento, aunque el badge visual siga marcando
 *      Vencido/Parcial.
 *
 * Esto centraliza la lógica que antes estaba repetida (y a veces
 * inconsistente) en Dashboard, Auditoría, Checkstore, Estadísticas y Ranking.
 */

/** ¿El item por sí solo tiene evidencia válida? */
export function tieneEvidencia(item: any): boolean {
  if (!item) return false;
  if (item.requiresAntesDespues) {
    return !!item.photoAntes && item.photoAntes !== 'subiendo...' &&
           !!item.photoDespues && item.photoDespues !== 'subiendo...';
  }
  if (item.requiresVariasFotos) {
    return Array.isArray(item.photos) && item.photos.length > 0;
  }
  if (item.requiresPhoto) {
    return !!item.photo && item.photo !== 'subiendo...';
  }
  return item.checked === true;
}

/** ¿El checklist trae alguna justificación que tape la falta de evidencia? */
export function tieneJustificacionChecklist(checklist: any): boolean {
  if (!checklist) return false;
  const nota = (checklist.notaEmpleado || '').toString().trim();
  if (nota.length > 0) return true;
  if (checklist.entregaConRetraso === true) return true;
  return false;
}

/** Criterio final unificado: ¿este item cuenta como hecho? */
export function esItemHecho(item: any, checklist?: any): boolean {
  if (tieneEvidencia(item)) return true;
  return tieneJustificacionChecklist(checklist);
}
