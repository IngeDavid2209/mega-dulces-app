/**
 * 📋 POR QUÉ NO HAY PRUEBA — el motivo que se pide al enviar un punto sin foto
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Decisión de David (18/sep/2026), enfrentado a las tres salidas con su precio:
 * **se deja enviar, pero con motivo obligatorio**. Las otras dos eran bloquear
 * el envío —que con 377 puntos de foto obligatoria, 62+ de ellos declaraciones
 * donde NO HAY QUÉ FOTOGRAFIAR, deja gente sin poder cerrar su turno— y avisar
 * sin preguntar nada, que es lo de hoy y no gana trazabilidad.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠ ESTO NO CIERRA NINGÚN PUNTO. ES LO ÚNICO QUE HAY QUE RECORDAR DE AQUÍ.
 * ═══════════════════════════════════════════════════════════════════════════
 * El invariante §5.3 dice que ninguna nota convierte un punto sin prueba en
 * cumplido, y la Fase 2.1 lo hizo cierto: `esItemHecho` es exactamente
 * `tieneEvidencia`. Un motivo escrito aquí NO puede moverlo, y hay una prueba
 * que lo fija.
 *
 * Por eso el motivo se guarda en `item.motivoSinPrueba` y **jamás** en
 * `checklist.notaEmpleado`. No es estilo: `tieneJustificacionChecklist()` lee
 * `notaEmpleado`, así que escribir ahí pasaría los puntos de `no_ejecutado` a
 * `justificado` — cambiaría la CAUSA de todos los puntos del checklist de golpe,
 * en silencio, y con ella el reparto de responsabilidad del §4. Guardar un dato
 * en el campo de al lado se ve inofensivo y aquí mueve a quién se le cuenta.
 *
 * ─── EL MAPEO A LAS CINCO CAUSAS ES PROVISIONAL, Y ESO SE DICE ────────────
 * El §4 tipifica cinco causas —`no_asignado`, `no_ejecutado`, `sin_prueba`,
 * `no_verificado`, `verificado_falso`— y su dueño es la **Fase 5**, que todavía
 * no está hecha. El mapeo de abajo es la mejor lectura de hoy y se guarda junto
 * al motivo para que Fase 5 pueda reinterpretarlo SIN volver a preguntarle a
 * nadie: se conserva el código elegido por la persona, no solo la causa
 * deducida. Si Fase 5 decide otro reparto, reescribe el mapa y los datos viejos
 * siguen siendo legibles.
 *
 * `no_aplica` NO está entre las cinco causas a propósito: «hoy no había qué
 * fotografiar» no es un incumplimiento de nadie, y meterlo a la fuerza en
 * `no_ejecutado` le colgaría una falta a quien hizo lo correcto. Se marca como
 * pendiente de tipificar (`null`) en vez de rellenarlo por parecido (§8.5).
 */

export interface MotivoSinPrueba {
  /** Lo que se guarda. No se renombra nunca: queda escrito en checklists. */
  codigo: string;
  /** Lo que lee quien trabaja, en su idioma. Esto sí se puede reescribir. */
  etiqueta: string;
  /** Causa del §4, o null si todavía no se puede tipificar sin inventar. */
  causa: string | null;
  /** Si exige que además escriba. */
  pideNota?: boolean;
}

/** Mínimo de caracteres de la nota, el mismo que ya exige el justificante de retraso. */
export const MINIMO_NOTA = 5;

export const MOTIVOS_SIN_PRUEBA: MotivoSinPrueba[] = [
  { codigo: 'no_aplica',    etiqueta: 'Hoy no aplica: no había qué fotografiar', causa: null },
  { codigo: 'sin_tiempo',   etiqueta: 'No me alcanzó el tiempo',                 causa: 'no_ejecutado' },
  { codigo: 'sin_acceso',   etiqueta: 'No pude entrar o estaba cerrado',         causa: 'no_ejecutado' },
  { codigo: 'falla_equipo', etiqueta: 'Falló el teléfono o la cámara',           causa: 'sin_prueba' },
  { codigo: 'ya_hecho',     etiqueta: 'Sí lo hice, se me pasó la foto',          causa: 'sin_prueba' },
  { codigo: 'otro',         etiqueta: 'Otro (lo escribo)',                       causa: null, pideNota: true },
];

export function motivoPorCodigo(codigo: string): MotivoSinPrueba | null {
  return MOTIVOS_SIN_PRUEBA.find((m) => m.codigo === codigo) || null;
}

/**
 * ¿Este motivo está completo para poder enviar?
 *
 * Un código que no existe en el catálogo NO vale. Parece obvio y no lo es: sin
 * esta comprobación, cualquier cadena guardada por una versión vieja de la
 * pantalla —o por un dedo en un `<select>` mal poblado— pasaría como motivo
 * válido y quedaría escrita en el checklist sin causa que la respalde.
 */
export function motivoCompleto(elegido: { codigo?: string; nota?: string } | null | undefined): boolean {
  if (!elegido || !elegido.codigo) return false;
  const m = motivoPorCodigo(elegido.codigo);
  if (!m) return false;
  if (m.pideNota) return (elegido.nota || '').trim().length >= MINIMO_NOTA;
  return true;
}

/** Qué se guarda en el item. Se conservan código Y causa (ver cabecera). */
export function sellarMotivo(
  elegido: { codigo: string; nota?: string },
  quien: string,
  ahora: number,
): Record<string, any> | null {
  const m = motivoPorCodigo(elegido.codigo);
  if (!m) return null;
  return {
    codigo: m.codigo,
    etiqueta: m.etiqueta,
    causa: m.causa,
    nota: (elegido.nota || '').trim(),
    por: quien || '',
    en: ahora,
  };
}
