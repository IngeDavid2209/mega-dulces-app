/**
 * 🏛️ TABLERO DE DIRECCIÓN — el modelo, separado de la pantalla
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PROPIEDAD QUE ESTE TABLERO TIENE Y EL ANTERIOR NO: SABE CALLARSE
 * ═══════════════════════════════════════════════════════════════════════════
 * El tablero viejo publicaba «1 % de cumplimiento» y «Crítico» en todo. Ese
 * número no estaba mal calculado: estaba mal PREGUNTADO. Contestaba «¿cuánto se
 * cumplió?» cuando la pregunta de Dirección es «¿de qué me puedo fiar, y de
 * quién es lo que falta?».
 *
 * Aquí cada cifra declara SU PROCEDENCIA, y las que no se pueden calcular se
 * muestran como ausencia con motivo — nunca como cero. Un cero afirma que se
 * midió; un guion dice que no hay con qué.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DOS LÍMITES DEL MODELO, ESCRITOS PARA QUE NADIE LOS CONFUNDA CON DISEÑO
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. EL EJE DE UNIDAD ES HÍBRIDO, y no por gusto. Las cinco Gerencias de Zona
 *    son INSTANCIAS de la unidad `zona` del organigrama y viven en
 *    `zonas.util.ts`; CEDIS, Administración, Capital Humano y Sistemas SÍ son
 *    unidades de `UnidadOrganigrama`. Son dos fuentes distintas, así que cada
 *    tarjeta declara de cuál sale en `fuente`. Cuando exista la tabla de
 *    unidades (Fase 3.1) esto se colapsa en una sola consulta.
 *
 * 2. MANTENIMIENTO NO ES UNA UNIDAD. Es el puesto `jefe-mantenimiento`, de la
 *    unidad `administrativa`. Aparece como tarjeta porque «unidad servida» es
 *    un concepto del modelo —su rojo no es de la sucursal donde aterriza— pero
 *    va rotulado como puesto. No se asciende un puesto a unidad para que el
 *    tablero se vea completo (§8.5).
 *
 * Todo esto se organiza por PUESTO y por texto de sucursal porque es lo que
 * hay. La unidad de asignación buena es la PLAZA (puesto × sub-unidad × ámbito
 * × turno) y llega en la Fase 3.
 */

import { Indicador, sinDato } from './indicador.util';

// ============================================================================
//  PROCEDENCIA — de dónde sale cada cifra, como DATO y no como nota al pie
// ============================================================================
/**
 * Un tablero que no dice de dónde salen sus números obliga a creerle. Esto lo
 * vuelve auditable: cada cifra trae su origen y su grado de confianza, y la
 * pantalla los pinta distinto.
 *
 *   leido    → se lee de la base ahora mismo
 *   medido   → salió de una migración o script, CON FECHA: no es de hoy
 *   estimado → reparto aproximado; el exacto necesita correr algo
 *   ausente  → no existe como dato. Se muestra como ausencia, no como cero
 *   contado  → contado de un catálogo del código
 */
export type Confianza = 'leido' | 'medido' | 'estimado' | 'ausente' | 'contado';

export interface Procedencia {
  cifra: string;
  origen: string;
  confianza: Confianza;
}

export const ETIQUETA_CONFIANZA: Record<Confianza, string> = {
  leido: 'leído',
  medido: 'medido',
  estimado: 'estimado',
  ausente: 'ausente',
  contado: 'contado',
};

// ============================================================================
//  EL SILENCIO — medido, con fecha, y por eso NO se presenta como de hoy
// ============================================================================
/**
 * De 97 fichas activas CON PUESTO, 60 llevan más de 30 días sin abrir la app y
 * 33 nunca entraron. Fuente: migración 050.
 *
 * Va con fecha a propósito. Es la cifra que cambia la lectura de todas las
 * demás —el «1 %» deja de ser una acusación y pasa a ser una descripción del
 * sistema— pero es de una medición puntual, no de un cálculo en vivo. Pasarla
 * por dato de hoy sería el mismo error que publicar un cero sin denominador.
 */
export const SILENCIO = {
  fichasEnSilencio: 60,
  fichasConPuesto: 97,
  nuncaEntraron: 33,
  medidoEl: '31/ago/2026',
  fuente: 'migración 050',
  get porcentaje(): number {
    return Math.round((this.fichasEnSilencio / this.fichasConPuesto) * 100);
  },
};

// ============================================================================
//  LAS CINCO CAUSAS — cada una con dueño distinto
// ============================================================================
/**
 * `no_verificado` NO SUMA con las demás y eso no es un detalle: es una CAPA
 * APARTE. Aplica a TODO lo emitido, incluido lo que sí se ejecutó bien. Un
 * punto puede estar ejecutado y no verificado a la vez. Si una tabla suma las
 * cinco y le cuadra con el total, está mal hecha.
 */
export interface Causa {
  clave: 'no_asignado' | 'no_ejecutado' | 'sin_prueba' | 'no_verificado' | 'verificado_falso';
  nombre: string;
  deQuien: string;
  lectura: string;
  /** true = es una capa sobre el total, no una porción de él. */
  esCapa: boolean;
  /** Cómo se obtiene hoy. `estimado` se pinta con ~. */
  confianza: Confianza;
  /** Por qué no se puede calcular, cuando aplica. */
  porque?: string;
}

export const CAUSAS: Causa[] = [
  {
    clave: 'no_asignado', nombre: 'No asignado',
    deQuien: 'Coordinador · Encargado', lectura: 'Mando',
    esCapa: false, confianza: 'estimado',
    porque: 'el reparto exacto sale de diagnostico-silencio-por-unidad.js, sin correr',
  },
  {
    clave: 'no_ejecutado', nombre: 'No ejecutado',
    deQuien: 'Colaborador', lectura: 'Operación',
    esCapa: false, confianza: 'estimado',
    porque: 'no se puede separar de no_asignado sin el campo de causa (Fase 5)',
  },
  {
    clave: 'sin_prueba', nombre: 'Ejecutado sin prueba',
    deQuien: 'Encargado — formación', lectura: 'Capacitación',
    esCapa: false, confianza: 'leido',
  },
  {
    clave: 'no_verificado', nombre: 'No verificado',
    deQuien: 'Encargado de sucursal', lectura: 'Supervisión · todo',
    esCapa: true, confianza: 'leido',
  },
  {
    clave: 'verificado_falso', nombre: 'Verificado falso',
    deQuien: '—', lectura: 'Sin auditoría',
    esCapa: false, confianza: 'ausente',
    porque: 'requiere auditoría física (Fase 8)',
  },
];

// ============================================================================
//  EL EJE DE UNIDAD
// ============================================================================
export interface UnidadTablero {
  nombre: string;
  /** De dónde sale esta tarjeta. Ver el límite 1 de la cabecera. */
  fuente: 'zona' | 'unidad-organigrama' | 'puesto';
  /** El identificador en su fuente, para poder rastrearlo. */
  clave: string;
  /** Etiqueta del estado cuando no hay número: qué le falta a ESTA unidad. */
  etiqueta: 'no comprob.' | 'sin muestra' | 'sin ámbito' | 'unidad servida';
  /** La nota que explica la etiqueta. Nunca vacía. */
  nota: string;
}

/**
 * Las diez tarjetas. Cinco zonas + cuatro unidades + un puesto rotulado.
 *
 * Solo 14 de 89 puestos son de sucursal, así que un tablero organizado por
 * sucursal deja fuera el 84 % de la empresa. Por eso el eje es la unidad de
 * control y no la tienda.
 */
export const UNIDADES_TABLERO: UnidadTablero[] = [
  { nombre: 'Gerencia Morelia', fuente: 'zona', clave: 'morelia',
    etiqueta: 'no comprob.', nota: 'Sin verificación con muestra' },
  { nombre: 'Gerencia Zamora', fuente: 'zona', clave: 'zamora',
    etiqueta: 'no comprob.', nota: 'Sin verificación con muestra' },
  { nombre: 'Gerencia La Piedad', fuente: 'zona', clave: 'la-piedad',
    etiqueta: 'no comprob.', nota: 'Sin verificación con muestra' },
  { nombre: 'Gerencia Padre Hidalgo', fuente: 'zona', clave: 'padre-hidalgo',
    etiqueta: 'no comprob.', nota: 'Sin verificación con muestra' },
  { nombre: 'Gerencia Yurécuaro', fuente: 'zona', clave: 'yurecuaro',
    etiqueta: 'sin muestra', nota: 'Emisiones insuficientes para un porcentaje' },
  { nombre: 'CEDIS y Logística', fuente: 'unidad-organigrama', clave: 'cedis',
    etiqueta: 'no comprob.', nota: 'Sin verificación con muestra' },
  { nombre: 'Administración', fuente: 'unidad-organigrama', clave: 'administrativa',
    etiqueta: 'no comprob.', nota: 'Sin verificación con muestra' },
  { nombre: 'Capital Humano', fuente: 'unidad-organigrama', clave: 'capital-humano',
    etiqueta: 'no comprob.', nota: 'Sin verificación con muestra' },
  { nombre: 'Sistemas', fuente: 'unidad-organigrama', clave: 'sistemas',
    etiqueta: 'sin ámbito',
    nota: 'No se les construyó ningún ámbito: 3 puestos en todo el organigrama' },
  // Rotulado como PUESTO a propósito: es `jefe-mantenimiento`, de la unidad
  // administrativa. No se asciende a unidad para que el tablero cuadre.
  { nombre: 'Mantenimiento', fuente: 'puesto', clave: 'jefe-mantenimiento',
    etiqueta: 'unidad servida',
    nota: 'Se le cuenta a Mantenimiento; en la sucursal se ve como espera, no como falla' },
];

// ============================================================================
//  LOS DOS NÚMEROS, y las cinco anclas de la evidencia
// ============================================================================
export const OPERACION_COMPROBADA = sinDato(
  'Requiere fidelidad medida, y no hay verificación con muestra en ninguna de las emisiones del día',
  'Fase 5',
);
export const FIDELIDAD_REGISTRO = sinDato(
  'Nadie compara piso contra sistema',
  'Fase 8',
);

/** Las cinco anclas. Dicen qué tan defendible es una prueba. */
export interface Ancla { nombre: string; valor: string; tiene: boolean; }

/**
 * De las cinco, hoy una evidencia típica tiene tres: le falta la etiqueta
 * física del ámbito y la inmutabilidad (se sobrescribe). Eso NO es un detalle
 * técnico: sin etiqueta, una foto está amarrada a la buena voluntad de quien la
 * subió, y sin inmutabilidad el historial se puede reescribir.
 */
export const ANCLAS_HOY: Ancla[] = [
  { nombre: 'lugar', valor: 'sin etiqueta', tiene: false },
  { nombre: 'momento', valor: '08:00–08:30', tiene: true },
  { nombre: 'identidad', valor: 'cobertura', tiene: true },
  { nombre: 'norma', valor: 'v2026.1', tiene: true },
  { nombre: 'inmutabilidad', valor: 'se sobrescribe', tiene: false },
];

// ============================================================================
//  SIETE DÍAS — la escala se declara, no se asume
// ============================================================================
/**
 * MÍNIMO PARA DIBUJAR UN VALOR.
 *
 * Por qué 10 y no 1: la gráfica anterior subía a 100 % y caía a 0 % cuatro
 * veces en siete días, y eso no era volatilidad de la operación — eran días con
 * dos o tres tareas emitidas. Un porcentaje sobre 3 puntos no describe una
 * jornada de la empresa; describe el azar. Diez es el mínimo por debajo del
 * cual preferimos un hueco visible a un número que nadie puede explicar.
 *
 * Es un parámetro con nombre a propósito: si se cambia, se cambia aquí y se
 * discute, en vez de aparecer como un literal suelto dentro de un `if`.
 */
export const MINIMO_PUNTOS_PARA_DIBUJAR = 10;

export interface DiaSerie {
  etiqueta: string;
  ind: Indicador;
}
