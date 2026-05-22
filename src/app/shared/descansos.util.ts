/**
 * Utilidades para gestionar días de descanso semanales de los trabajadores.
 *
 * Modelo en Firestore:
 *   colección "descansos_semanales"
 *   documento id: `${userId}_${semanaISO}`  (ej: "abc123_2026-21")
 *   payload: {
 *     userId: string,
 *     userNombre: string,        // duplicado para mostrar sin extra fetch
 *     semanaISO: string,         // "2026-21"
 *     dias: string[],            // ["Lunes", "Domingo"]
 *     actualizadoPor: string,
 *     actualizadoEn: number
 *   }
 */

export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;
export type DiaSemana = typeof DIAS_SEMANA[number];

/** Devuelve la semana ISO de una fecha en formato "YYYY-WW". */
export function obtenerSemanaISO(fecha: Date): string {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  // Semana ISO 8601: el jueves de cada semana define el año
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-${String(weekNum).padStart(2, '0')}`;
}

/** Devuelve el nombre del día de la semana (Lunes, Martes, ...) para una fecha. */
export function obtenerNombreDia(fecha: Date): DiaSemana {
  // getDay(): 0 = Domingo, 1 = Lunes, ...
  const idx = fecha.getDay();
  const mapeo: DiaSemana[] = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return mapeo[idx];
}

/** Calcula la fecha del Lunes de la semana ISO dada (ej: "2026-21"). */
export function fechaLunesDeSemana(semanaISO: string): Date {
  const [yearStr, weekStr] = semanaISO.split('-');
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  // ISO: el 4 de enero siempre está en la primera semana
  const enero4 = new Date(Date.UTC(year, 0, 4));
  const dow = enero4.getUTCDay() || 7; // 1=Lun .. 7=Dom
  const inicioPrimeraSemana = new Date(enero4);
  inicioPrimeraSemana.setUTCDate(enero4.getUTCDate() - (dow - 1));
  const resultado = new Date(inicioPrimeraSemana);
  resultado.setUTCDate(inicioPrimeraSemana.getUTCDate() + (week - 1) * 7);
  return resultado;
}

/** Avanza/retrocede N semanas desde una semana ISO. */
export function desplazarSemanaISO(semanaISO: string, deltaSemanas: number): string {
  const lunes = fechaLunesDeSemana(semanaISO);
  lunes.setUTCDate(lunes.getUTCDate() + deltaSemanas * 7);
  return obtenerSemanaISO(lunes);
}

/** Texto legible de la semana ISO: "Semana del 18 al 24 de mayo". */
export function semanaISOATexto(semanaISO: string): string {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const lunes = fechaLunesDeSemana(semanaISO);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);
  const diaL = lunes.getUTCDate();
  const diaD = domingo.getUTCDate();
  const mesL = meses[lunes.getUTCMonth()];
  const mesD = meses[domingo.getUTCMonth()];
  if (mesL === mesD) {
    return `${diaL} al ${diaD} de ${mesL}`;
  }
  return `${diaL} de ${mesL} al ${diaD} de ${mesD}`;
}

/** ID Firestore para descansos_semanales. */
export function idDescanso(userId: string, semanaISO: string): string {
  return `${userId}_${semanaISO}`;
}

/**
 * Dada una fecha y un array de documentos de descansos del usuario, determina
 * si esa fecha es día de descanso para ese usuario.
 *
 * @param descansosDelUsuario lista de docs descansos_semanales del usuario (todos o filtrados)
 */
export function esDiaDescansoEnFecha(fecha: Date, descansosDelUsuario: any[]): boolean {
  const semana = obtenerSemanaISO(fecha);
  const nombreDia = obtenerNombreDia(fecha);
  const doc = descansosDelUsuario.find((d: any) => d.semanaISO === semana);
  if (!doc || !doc.dias) return false;
  return doc.dias.includes(nombreDia);
}

/** Construye un mapa userId → lista de días de descanso para una fecha específica. */
export function diasDeDescansoPorUsuario(
  fecha: Date,
  descansos: any[]
): Map<string, boolean> {
  const semana = obtenerSemanaISO(fecha);
  const nombreDia = obtenerNombreDia(fecha);
  const mapa = new Map<string, boolean>();
  for (const d of descansos) {
    if (d.semanaISO === semana && d.dias?.includes(nombreDia)) {
      mapa.set(d.userId, true);
    }
  }
  return mapa;
}
