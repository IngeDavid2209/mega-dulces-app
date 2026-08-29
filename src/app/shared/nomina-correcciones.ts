/**
 * ✍️ CORRECCIONES AL PUESTO QUE DICE LA NÓMINA
 *
 * La lista de raya es un documento de nómina, no un organigrama: el puesto con
 * el que alguien cobra no siempre es el puesto que ocupa. Aquí se corrigen esos
 * casos, uno por uno y con nombre de quien lo corrigió.
 *
 * ─── POR QUÉ EN ARCHIVO APARTE ──────────────────────────────────────────────
 * `nomina-puestos.ts` está GENERADO a partir del PDF. Si las correcciones
 * vivieran ahí, la próxima vez que se regenere con una nómina nueva se
 * perderían todas y nadie se daría cuenta. Separadas, sobreviven y se pueden
 * auditar: se ve qué dijo el documento y qué decidió una persona.
 *
 * ─── CÓMO SE APLICAN ────────────────────────────────────────────────────────
 * `nominaEfectiva()` en nomina-puestos.ts las encima sobre las filas del PDF.
 * El amarre es por el nombre TAL COMO LO ESCRIBE LA NÓMINA, que es la llave
 * estable del documento.
 *
 * Poner `puestoId: null` es válido y significa "no le asignes puesto": sirve
 * para sacar a alguien de la importación sin borrar su fila.
 */

export interface CorreccionNomina {
  /** Nombre exactamente como lo escribe la nómina (APELLIDOS NOMBRES). */
  nombre: string;
  /** El puesto correcto del organigrama. null = no asignarle ninguno. */
  puestoId: string | null;
  /** Quién lo corrigió y cuándo, para poder rastrearlo. */
  quien: string;
  /** Por qué. Si la nómina decía otra cosa, se anota aquí. */
  motivo: string;
}

export const CORRECCIONES_NOMINA: CorreccionNomina[] = [
  {
    nombre: 'ALATORRE RUEDA DULCE MARIA',
    puestoId: 'auxiliar-encargado',
    quien: 'David · 2026-08-28',
    motivo: 'La nómina la trae como Cajera, pero es Auxiliar de Encargada en La Piedad Abastos.',
  },
];

// ════════════════════════════════════════════════════════════════════════════
//  ALTAS MANUALES — gente que NO viene en la lista de raya
//
//  La nómina semanal no cubre a todo el mundo: Dirección, por ejemplo, no
//  aparece ahí. Estas filas se suman a las del PDF para que el organigrama
//  quede completo.
//
//  Llevan el mismo formato que una fila de nómina, con `centro: 'alta manual'`
//  para que en la pantalla se distinga de un renglón que sí salió del documento.
// ════════════════════════════════════════════════════════════════════════════

export interface AltaManual {
  /** Nombre como aparece (o aparecerá) en la app. El cruce es por palabras. */
  nombre: string;
  puestoId: string;
  /** Sucursal del catálogo de la app, o null si el puesto no cuelga de una. */
  sucursal: string | null;
  quien: string;
  motivo: string;
}

export const ALTAS_MANUALES: AltaManual[] = [
  {
    nombre: 'LUIS FRANCISCO LOPEZ GUTIERREZ',
    puestoId: 'direccion-general',
    sucursal: null,
    quien: 'David · 2026-08-28',
    motivo: 'Dirección General. No aparece en la lista de raya semanal.',
  },
  {
    nombre: 'GUILLERMO LOPEZ GUTIERREZ',
    puestoId: 'direccion-general',
    sucursal: null,
    quien: 'David · 2026-08-28',
    motivo: 'Dirección General. No aparece en la lista de raya semanal.',
  },
];

// ════════════════════════════════════════════════════════════════════════════
//  CENTRO DE COSTO → SUCURSAL DEL CATÁLOGO
//
//  La nómina nombra los centros como los nombra la nómina, y no siempre
//  coinciden con el catálogo de la app. Ocho personas de "Damaso" quedaron sin
//  sucursal, sin tareas y fuera de todos los filtros porque ese nombre no
//  existe en el catálogo — y no existía porque NO ES UNA PLAZA QUE FALTE: es
//  la calle donde está la sucursal que la app ya tenía con otro nombre.
//
//      Nómina:  "Damaso"
//      App:     "Zamora Centro"  ·  C. Dámaso Cárdenas 7, Jardines de Catedral
//      Talento: zamora-catedral  ·  misma dirección, confirmada en su catálogo
//
//  Solo se aplica cuando la fila viene SIN sucursal. Nunca pisa lo que el
//  documento ya resolvió: si el PDF y este mapa discrepan, gana el documento.
// ════════════════════════════════════════════════════════════════════════════

export const SUCURSAL_POR_CENTRO: Record<string, string> = {
  // Confirmado por David el 2026-08-29, cruzando la dirección contra el
  // catálogo de Mega Talento.
  'Damaso': 'Zamora Centro',

  // PENDIENTE · 'Promotoras Santa Ana' (2 personas) sigue sin sucursal.
  // La sospecha razonable es "Padre Hidalgo" —que está en Santa Ana Pacueco—,
  // pero nadie lo ha confirmado y mandar a dos promotoras a la sucursal
  // equivocada es peor que dejarlas sin tareas. Se queda fuera a propósito.
};

/** La sucursal que le toca a un centro sin equivalente, si alguien la mapeó. */
export function sucursalPorCentro(centro: string): string | null {
  return SUCURSAL_POR_CENTRO[(centro || '').trim()] || null;
}

/** Índice por nombre normalizado, armado una sola vez. */
const INDICE: Map<string, CorreccionNomina> = (() => {
  const m = new Map<string, CorreccionNomina>();
  for (const c of CORRECCIONES_NOMINA) {
    const k = clave(c.nombre);
    if (k) m.set(k, c);
  }
  return m;
})();

function clave(n: string): string {
  return (n || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

/** La corrección para esta persona, si alguien la corrigió. */
export function correccionDe(nombreNomina: string): CorreccionNomina | null {
  return INDICE.get(clave(nombreNomina)) || null;
}
