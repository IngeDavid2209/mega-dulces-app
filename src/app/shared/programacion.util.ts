/**
 * Utilidades de programación: dado una asignación + una fecha,
 * ¿esa asignación aplica ese día?
 *
 * Este helper es usado por:
 *  - Fase 3 (vista de "próximos días" en el panel de programación)
 *  - Fase 4 (el robot que genera los checklists del día lo va a reutilizar)
 *
 * Convención de fechas: trabajamos siempre con YYYY-MM-DD (string) en zona local
 * para evitar líos de timezones.
 */

import { AsignacionRutina } from './asignaciones.types';

/** Devuelve YYYY-MM-DD de una Date en hora local. */
export function fechaToYmd(d: Date): string {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().split('T')[0];
}

/** Convierte un YYYY-MM-DD a Date local (00:00). */
export function ymdToFecha(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(n => parseInt(n, 10));
  return new Date(y, m - 1, d);
}

/** Nombre del día en español. Coincide con los valores de AsignacionRutina.diaSemana. */
export function nombreDiaSemana(d: Date): string {
  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return dias[d.getDay()];
}

/** Diferencia en semanas enteras entre dos fechas (a partir de la primera). */
function semanasEntre(desde: Date, hasta: Date): number {
  const ms = hasta.getTime() - desde.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 7));
}

/** Diferencia en meses entre dos fechas. */
function mesesEntre(desde: Date, hasta: Date): number {
  return (hasta.getFullYear() - desde.getFullYear()) * 12 + (hasta.getMonth() - desde.getMonth());
}

/**
 * ¿La asignación aplica en `fecha` (Date local)?
 *
 * Reglas:
 *  - debe estar activa
 *  - la fecha debe estar dentro de la vigencia
 *  - debe matchear la frecuencia (día de la semana, día del mes, etc.)
 */
export function asignacionAplicaEnFecha(asig: AsignacionRutina, fecha: Date): boolean {
  if (!asig.activa) return false;

  const fechaYmd = fechaToYmd(fecha);
  if (asig.fechaInicio && fechaYmd < asig.fechaInicio) return false;
  if (asig.fechaFin && fechaYmd > asig.fechaFin) return false;

  const inicio = asig.fechaInicio ? ymdToFecha(asig.fechaInicio) : fecha;

  switch (asig.frecuencia) {
    case 'Diaria':
      return true;

    case 'Semanal':
      return nombreDiaSemana(fecha) === (asig.diaSemana || 'Lunes');

    case 'Catorcenal': {
      // mismo día de la semana + paridad de semanas desde inicio
      if (nombreDiaSemana(fecha) !== (asig.diaSemana || 'Lunes')) return false;
      const ws = semanasEntre(inicio, fecha);
      return ws >= 0 && ws % 2 === 0;
    }

    case 'Mensual':
      return fecha.getDate() === (asig.diaMes || 1);

    case 'Trimestral': {
      if (fecha.getDate() !== (asig.diaMes || 1)) return false;
      const ms = mesesEntre(inicio, fecha);
      return ms >= 0 && ms % 3 === 0;
    }

    case 'PorEvento':
      // Se genera manualmente — nunca aparece en programación automática
      return false;

    default:
      return false;
  }
}

/**
 * Genera un rango de N días a partir de una fecha de inicio (inclusive).
 * Devuelve Dates locales a las 00:00.
 */
export function rangoDias(inicio: Date, cuantos: number): Date[] {
  const arr: Date[] = [];
  const base = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  for (let i = 0; i < cuantos; i++) {
    arr.push(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i));
  }
  return arr;
}

/** Etiqueta humanizada: Hoy / Mañana / Lunes 25 may. */
export function etiquetaDiaRelativa(fecha: Date, hoy: Date = new Date()): string {
  const fYmd = fechaToYmd(fecha);
  const hYmd = fechaToYmd(hoy);
  if (fYmd === hYmd) return 'Hoy';

  const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
  if (fYmd === fechaToYmd(manana)) return 'Mañana';

  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${nombreDiaSemana(fecha)} ${fecha.getDate()} ${meses[fecha.getMonth()]}`;
}
