/**
 * 📏 INDICADOR — la regla del guion
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  UN NÚMERO QUE NO SE PUEDE SOSTENER NO SE PUBLICA
 * ═══════════════════════════════════════════════════════════════════════════
 * Un cero afirma «se midió y salió cero». Eso se lee como «nadie trabajó», y
 * lleva a una conversación con la gente equivocada. La verdad de hoy en varias
 * columnas del tablero es otra: «no hay con qué medir esto todavía» — y ésa es
 * una conversación con el mando, no con quien barre un pasillo.
 *
 * Son dos frases distintas y un `number | null` no las distingue: obliga a que
 * cada pantalla decida por su cuenta qué hacer con el null, y el motivo —que es
 * lo único que convierte un guion en información— se pierde en el camino.
 *
 * Por eso esto es un tipo con tres estados y no un número anulable:
 *
 *   medido      → hay base. Trae `valor` Y `de`, porque una cifra sin su
 *                 denominador no se puede defender ante nadie.
 *   sin_dato    → todavía no existe la maquinaria para calcularlo. Trae el
 *                 porqué y la fase del plan que lo va a llenar.
 *   sin_muestra → hubo emisión, pero tan poca que el porcentaje no dice nada.
 *                 Un día con dos tareas al 100% no es un buen día.
 *
 * `de` es OBLIGATORIO en 'medido'. Eso es lo que hace imposible el «87%» sin
 * denominador que el tablero publicaba: el tipo no compila sin él.
 *
 * LÍMITE CONOCIDO, escrito aquí para que nadie lo confunda con una decisión:
 * los indicadores de hoy se organizan por PUESTO y por texto de sucursal,
 * porque es lo que hay. La unidad buena es la PLAZA (puesto × sub-unidad ×
 * ámbito × turno) y llega en la Fase 3. Que un número esté agrupado por puesto
 * no significa que el puesto sea el eje correcto.
 */

export type Indicador =
  | { estado: 'medido'; valor: number; de: number }
  | { estado: 'sin_dato'; porque: string; fase: string }
  | { estado: 'sin_muestra'; emitidos: number; minimo: number };

/**
 * Construye un 'medido', o 'sin_muestra' si el denominador no llega al mínimo.
 *
 * Sin `minimo` el comportamiento es el de siempre menos el cero falso: con
 * denominador 0 devuelve 'sin_muestra' con `emitidos: 0`, que es literalmente
 * «no se emitió nada», y NO un 0%.
 */
export function medir(parte: number, de: number, minimo = 1): Indicador {
  if (de < minimo) return { estado: 'sin_muestra', emitidos: de, minimo };
  return { estado: 'medido', valor: Math.round((parte / de) * 100), de };
}

/** Un indicador que todavía no tiene maquinaria. Exige el porqué y la fase. */
export function sinDato(porque: string, fase: string): Indicador {
  return { estado: 'sin_dato', porque, fase };
}

/**
 * El número para pintar, o null.
 *
 * Devuelve null en los DOS estados sin base. La plantilla nunca debe imprimir
 * `0` a partir de esto: un `valor` de 0 con estado 'medido' SÍ se pinta —cero
 * medido y sin dato tienen que verse distinto— y para eso está `esMedido()`.
 */
export function valorDe(i: Indicador): number | null {
  return i.estado === 'medido' ? i.valor : null;
}

/** ¿Se puede pintar una cifra? Un 'medido' con valor 0 devuelve true. */
export function esMedido(i: Indicador): boolean {
  return i.estado === 'medido';
}

/**
 * El texto que acompaña al número o al guion. Nunca vacío: un guion solo, sin
 * explicación, es lo mismo que un cero mentiroso pero más confuso.
 */
export function leyendaDe(i: Indicador, unidad = 'puntos'): string {
  switch (i.estado) {
    case 'medido':
      return `${Math.round((i.valor / 100) * i.de)} de ${i.de} ${unidad}`;
    case 'sin_muestra':
      return i.emitidos === 0
        ? `No se emitió nada que medir`
        : `Solo ${i.emitidos} ${unidad}: muestra insuficiente (mínimo ${i.minimo})`;
    case 'sin_dato':
      return `${i.porque} · llega en la ${i.fase}`;
  }
}

// ============================================================================
//  LOS DOS NÚMEROS QUE DIRECCIÓN NECESITA, Y QUE HOY NO EXISTEN
// ============================================================================
/**
 * Los dos indicadores de primera línea del tablero. Los dos salen 'sin_dato' a
 * propósito, y eso NO es un tablero incompleto: es el único valor honesto.
 *
 * El invariante del modelo dice que un cumplimiento sin fidelidad no se
 * reporta. Hoy no hay verificación con muestra en ninguna emisión ni auditoría
 * física, así que la operación no está comprobada. Publicar un porcentaje aquí
 * sería afirmar algo que el sistema no puede sostener.
 *
 * Cada uno trae qué falta y en qué fase llega, porque un tablero que calla y
 * uno que explica su silencio no son lo mismo.
 */
export const OPERACION_COMPROBADA: Indicador = sinDato(
  'Requiere fidelidad medida, y no hay verificación con muestra en ninguna emisión',
  'Fase 5',
);

export const FIDELIDAD_DEL_REGISTRO: Indicador = sinDato(
  'Nadie compara el piso contra el sistema',
  'Fase 8',
);
