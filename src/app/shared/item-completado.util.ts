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

// ============================================================================
//  CUANDO se hizo, no solo si se hizo
//
//  Extraido de checklist.ts, donde vivia como metodo privado. Se saca porque la
//  seccion de productividad necesita el mismo criterio y, en este proyecto, una
//  condicion copiada en dos lugares ya salio caro dos veces: basta que una copia
//  se quede atras para que dos pantallas midan distinto y nadie sepa cual creer.
//
//  El sello es el mas TARDIO de lo que el punto exigia: la foto de DESPUES manda
//  sobre la de ANTES, y la ultima de "varias" sobre las anteriores. Un punto que
//  pedia dos fotos no esta hecho cuando se subio la primera.
// ============================================================================

/** 'HH:mm' o 'h:mm AM/PM' del dia `fechaYmd`, a epoch. null si no se entiende. */
export function horaDelDiaAEpoch(fechaYmd: string, hora: string | null | undefined): number | null {
  if (!fechaYmd || !hora) return null;
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaYmd);
  const t = /^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/.exec(String(hora).trim());
  if (!f || !t) return null;
  let h = Number(t[1]);
  const sufijo = (t[3] || '').toUpperCase();
  if (sufijo === 'PM' && h < 12) h += 12;
  if (sufijo === 'AM' && h === 12) h = 0;
  return new Date(Number(f[1]), Number(f[2]) - 1, Number(f[3]), h, Number(t[2]), 0).getTime();
}

/**
 * Momento en que el punto quedo listo (epoch), o null si NO HAY SELLO.
 *
 * El null importa tanto como el numero. Los datos de antes de que se guardara
 * `checkedEn` estan hechos pero no se pueden situar en el tiempo, y tratarlos
 * como si se hubieran hecho a buena hora inventaria un dato que no existe. Quien
 * llame tiene que contarlos aparte.
 */
export function completadoEn(item: any, fechaYmd: string): number | null {
  if (!item || !fechaYmd) return null;
  const sellos: number[] = [];
  const push = (v: any) => { const n = Number(v); if (n > 0) sellos.push(n); };

  if (item.requiresAntesDespues) {
    push(item.photoDespuesTimestamp);
    push(horaDelDiaAEpoch(fechaYmd, item.photoDespuesTime));
    if (!sellos.length) {
      push(item.photoAntesTimestamp);
      push(horaDelDiaAEpoch(fechaYmd, item.photoAntesTime));
    }
  } else if (item.requiresVariasFotos) {
    for (const f of (Array.isArray(item.photos) ? item.photos : [])) {
      push(f?.timestamp);
      push(horaDelDiaAEpoch(fechaYmd, f?.time));
    }
  } else if (item.requiresPhoto) {
    push(item.photoTimestamp);
    push(horaDelDiaAEpoch(fechaYmd, item.photoTime));
  } else {
    push(item.checkedEn);
  }
  return sellos.length ? Math.max(...sellos) : null;
}
