/**
 * Criterio unificado para considerar un item como "hecho" en toda la app.
 *
 * Reglas:
 *   1) Si el item tiene su evidencia real (foto, antes/después, varias fotos,
 *      o lo ESCRITO cuando la norma dice que la prueba es lo escrito) o quedó
 *      palomeado cuando no pedía evidencia → HECHO.
 *   2) Si no la tiene, el punto NO está hecho. Si el checklist trae
 *      justificación del colaborador, el punto queda `justificado`; si no,
 *      `no_ejecutado`. Los dos son estados PROPIOS y ninguno cuenta como
 *      cumplimiento.
 *
 * Esto centraliza la lógica que antes estaba repetida (y a veces
 * inconsistente) en Dashboard, Auditoría, Checkstore, Estadísticas y Ranking.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  FASE 2.1 — 13/sep/2026. LA REGLA 2 ANTERIOR QUEDA DEROGADA
 * ═══════════════════════════════════════════════════════════════════════════
 * Hasta hoy la regla 2 decía, literalmente:
 *
 *   «Si el checklist completo trae justificación del colaborador (notaEmpleado
 *    con texto o entregaConRetraso === true), TODOS sus items cuentan como
 *    hechos para los KPIs. La idea es que cuando el trabajador explica por qué
 *    no pudo completar, esa entrega justificada se considera "buena" para el
 *    cumplimiento, aunque el badge visual siga marcando Vencido/Parcial.»
 *
 * Se deroga porque rompe el invariante §5.3 del CLAUDE.md: «"Hecho" exige
 * evidencia válida. `justificado` y `no_ejecutado` son estados propios.
 * Ninguna nota, retraso ni excepción convierte un punto sin prueba en
 * cumplido.» Con la regla vieja, UN SOLO CARÁCTER escrito en la nota cerraba
 * los 377 puntos del manual sin una sola foto, en silencio, y los tableros
 * salían preciosos.
 *
 * ─── POR QUÉ ESTO NO ABRE UNA DIVERGENCIA: LA CIERRA ───────────────────────
 * El bot de WhatsApp lleva meses siendo estricto. `itemHecho` de
 * `api/asistente-chat.js:569` es espejo de `tieneEvidencia` y su cuerpo NO
 * consulta la justificación: el bot la ESCRIBE al enviar, pero nunca cierra un
 * punto con ella. Así que hasta hoy la misma persona, el mismo punto y el mismo
 * día se contaban DISTINTO según quién preguntara —el tablero o el bot—. Esto
 * los pone de acuerdo.
 *
 * ─── LO QUE ESTE CAMBIO SÍ MUEVE, dicho para que nadie se sorprenda ────────
 * La regla se aplica AL LEER, no al capturar. O sea que también cambia el
 * HISTÓRICO: un checklist entregado en agosto con una nota y sin fotos deja de
 * contar como cumplido. Es exactamente lo que se busca (que no se reporte
 * cumplimiento sin prueba), pero hace que los tableros NO cuadren contra
 * reportes impresos antes de hoy. Esa comparación hay que hacerla con el
 * diagnóstico, no a ojo.
 *
 * ─── LO QUE NO TOCA ────────────────────────────────────────────────────────
 * El ENVÍO. `checklist.ts:3039` gatea la entrega con `tieneEvidencia`, que ya
 * era la estricta, así que nadie pierde la capacidad de cerrar su turno por
 * este cambio. Y `tieneJustificacionChecklist` se conserva: la justificación
 * no desaparece, deja de contar como cumplimiento y pasa a ser su propio
 * estado, que es lo que la Fase 5 necesita para tipificar la causa.
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
  // ── EVIDENCIA ESCRITA (21/sep/2026) ──────────────────────────────────────
  // Instruccion de David: «cuando en comentarios te manden una justificacion
  // debes tomarlos como las tareas en parte del porcentaje». Aplicada a los
  // puntos cuya prueba ES lo escrito, declarados uno por uno en
  // `evidencia-manual.ts`: una ausencia cubierta no tiene objeto que
  // fotografiar, asi que ahi el texto no TAPA la falta de evidencia — es la
  // evidencia. Por eso cuenta como `hecho` y suma al porcentaje.
  //
  // ⚠ ESTO NO REABRE LO QUE LA FASE 2.1 CERRO, y la diferencia es el campo del
  // que cuelga. `notaEmpleado` es la nota del CHECKLIST: una sola frase que
  // hablaria por los 5 puntos, incluidos los que nadie justifico, y eso es lo
  // que se derogo arriba. Esto cuelga de `evidenciaEscrita`, que va PUNTO POR
  // PUNTO y solo en los que la norma declara — el mismo motivo por el que el
  // motivo sin prueba se guarda en el item y jamas en `notaEmpleado`.
  //
  // Y ESTAS DOS RAMAS NO PUEDEN MOVER UN NUMERO DEL PASADO: `evidenciaEscrita`
  // no existe en ningun documento emitido antes de hoy, asi que para todo el
  // historico esta condicion es falsa y se sigue cayendo al `checked` de abajo,
  // exactamente como ayer.
  if (item.evidenciaEscrita === 'listado') {
    return Array.isArray(item.listado)
        && item.listado.some((r: any) => String(r ?? '').trim().length > 0);
  }
  if (item.evidenciaEscrita === 'comentario') {
    return String(item.comentario ?? '').trim().length > 0;
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

/**
 * Los tres estados de un punto. Son excluyentes y cubren todos los casos: un
 * punto siempre está en uno y solo uno.
 *
 * `justificado` NO es una variante de hecho: es la constancia de que alguien
 * explicó por qué no se pudo. Separarlos es lo que permite que la Fase 5
 * tipifique la causa (no_ejecutado, sin_prueba, no_verificado…) en vez de
 * interpretarla después.
 */
export type EstadoItem = 'hecho' | 'justificado' | 'no_ejecutado';

/** En qué estado está este punto. Nunca devuelve nada fuera de los tres. */
export function estadoItem(item: any, checklist?: any): EstadoItem {
  if (tieneEvidencia(item)) return 'hecho';
  if (tieneJustificacionChecklist(checklist)) return 'justificado';
  return 'no_ejecutado';
}

/**
 * Criterio final unificado: ¿este item cuenta como hecho?
 *
 * Desde la Fase 2.1 (13/sep/2026) esto es EXACTAMENTE `tieneEvidencia`: la
 * justificación ya no cierra un punto. Se conserva la firma con `checklist`
 * —que ahora no se usa para decidir— porque la llaman 9 archivos y cambiarla
 * obligaría a tocarlos todos en el mismo paso; el parámetro sigue sirviendo
 * para `estadoItem`, que es a donde deben migrar los que quieran distinguir.
 */
export function esItemHecho(item: any, checklist?: any): boolean {
  return estadoItem(item, checklist) === 'hecho';
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
  } else if (item.evidenciaEscrita) {
    // Lo escrito tambien se situa en el tiempo. Sin este sello el punto saldria
    // hecho y sin hora, y `productividad.util.ts` lo contaria como «no se sabe
    // cuando» — o sea, un punto cumplido que no puede decir si fue a tiempo.
    push(item.escritoEn);
  } else {
    push(item.checkedEn);
  }
  return sellos.length ? Math.max(...sellos) : null;
}
