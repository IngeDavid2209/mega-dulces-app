/**
 * Utilidades de TURNOS (manana / tarde) para la sucursal Canindo.
 *
 * Modelo de negocio:
 *   - Hay un grupo de personas que SOLO pueden recibir tareas dentro de su
 *     turno (horario). Fuera de turno NO se les puede asignar (bloqueo), salvo
 *     que un admin de Canindo registre una EXCEPCION temporal.
 *   - Cada lunes los dos grupos INTERCAMBIAN turno automaticamente. No hace
 *     falta un cron: la rotacion se calcula por la PARIDAD de la semana respecto
 *     a una semana base (semanasEntre % 2). Asi "cambia solo" cada lunes.
 *   - Una EXCEPCION cambia el turno efectivo de una persona durante un rango de
 *     fechas (cuando por necesidad de la empresa entra en el otro turno).
 *
 * La misma logica vive replicada (en JS) en api/asistente-chat.js para que el
 * asistente aplique exactamente las mismas reglas. Si cambias una, cambia la otra.
 */

export type Turno = 'manana' | 'tarde';

export interface HorarioTurno {
  inicio: string; // 'HH:MM'
  fin: string;    // 'HH:MM'
}

export interface MiembroTurno {
  uid: string;
  nombre: string;
}

export interface ExcepcionTurno {
  uid: string;
  nombre?: string;
  turno: Turno;     // turno que cubre durante la excepcion
  desde: string;    // 'YYYY-MM-DD' (inclusive)
  hasta: string;    // 'YYYY-MM-DD' (inclusive)
  motivo?: string;
  creadoPor?: string;
}

export interface ConfigTurnos {
  habilitado: boolean;
  sucursal: string;                  // 'Canindo'
  horarios: { manana: HorarioTurno; tarde: HorarioTurno };
  rotacionAutomatica: boolean;
  semanaBase: string;                // 'YYYY-MM-DD' (lunes base)
  grupoManana: MiembroTurno[];       // grupo que en la semana base trabaja en MANANA
  grupoTarde: MiembroTurno[];        // grupo que en la semana base trabaja en TARDE
  excepciones: ExcepcionTurno[];
  actualizadoPor?: string;
  actualizadoEn?: number;
}

/** Config por defecto (valores iniciales para la pantalla de Turnos). */
export function configTurnosPorDefecto(): ConfigTurnos {
  return {
    habilitado: false,
    sucursal: 'Canindo',
    horarios: {
      manana: { inicio: '06:00', fin: '14:30' },
      tarde: { inicio: '09:00', fin: '17:30' },
    },
    rotacionAutomatica: true,
    semanaBase: lunesISO(new Date()),
    grupoManana: [],
    grupoTarde: [],
    excepciones: [],
  };
}

/** 'HH:MM' -> minutos desde medianoche. Devuelve NaN si no parsea. */
export function aMinutos(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Fecha (local) -> 'YYYY-MM-DD'. */
export function fechaISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}

/**
 * Lunes de la semana de una fecha, como 'YYYY-MM-DD'.
 * Calculo en UTC a partir de la fecha calendario para evitar lios de zona horaria.
 */
export function lunesISO(d: Date | string): string {
  const iso = typeof d === 'string' ? d : fechaISO(d);
  const [y, m, dia] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dia));
  const dow = dt.getUTCDay();            // 0=domingo .. 6=sabado
  const diff = dow === 0 ? 6 : dow - 1;  // dias transcurridos desde el lunes
  dt.setUTCDate(dt.getUTCDate() - diff);
  return dt.toISOString().split('T')[0];
}

/** Numero de semanas (lunes a lunes) entre dos fechas ISO. */
export function semanasEntre(aISO: string, bISO: string): number {
  const a = new Date(lunesISO(aISO) + 'T00:00:00Z').getTime();
  const b = new Date(lunesISO(bISO) + 'T00:00:00Z').getTime();
  return Math.round((b - a) / (7 * 24 * 3600 * 1000));
}

/** En que grupo BASE esta la persona (segun config). null = no esta en el sistema de turnos. */
export function grupoBaseDeUsuario(config: ConfigTurnos, uid: string): Turno | null {
  if (!config || !uid) return null;
  if ((config.grupoManana || []).some(m => m.uid === uid)) return 'manana';
  if ((config.grupoTarde || []).some(m => m.uid === uid)) return 'tarde';
  return null;
}

/** ¿La persona forma parte del sistema de turnos? */
export function usuarioTieneTurno(config: ConfigTurnos, uid: string): boolean {
  return grupoBaseDeUsuario(config, uid) !== null;
}

/** Excepcion ACTIVA para una persona en una fecha dada (o null). */
export function excepcionActiva(config: ConfigTurnos, uid: string, diaISO: string): ExcepcionTurno | null {
  if (!config?.excepciones) return null;
  return config.excepciones.find(e =>
    e.uid === uid && e.desde <= diaISO && diaISO <= e.hasta
  ) || null;
}

/**
 * Turno EFECTIVO de una persona en un dia:
 *   1. Si tiene excepcion activa -> el turno de la excepcion.
 *   2. Si no, su grupo base, intercambiado si la rotacion automatica esta activa
 *      y la semana es impar respecto a la base.
 * Devuelve null si la persona no esta en el sistema de turnos.
 */
export function turnoEfectivo(config: ConfigTurnos, uid: string, diaISO: string): Turno | null {
  const base = grupoBaseDeUsuario(config, uid);
  if (base === null) return null;

  const exc = excepcionActiva(config, uid, diaISO);
  if (exc) return exc.turno;

  if (config.rotacionAutomatica) {
    const semanas = semanasEntre(config.semanaBase, diaISO);
    const impar = (((semanas % 2) + 2) % 2) === 1;
    if (impar) return base === 'manana' ? 'tarde' : 'manana';
  }
  return base;
}

export interface EvaluacionTurno {
  /** ¿La persona esta sujeta a restriccion de turno? */
  restringido: boolean;
  /** Turno efectivo en ese momento (null si no aplica). */
  turno: Turno | null;
  /** ¿La hora actual cae dentro del horario del turno? */
  dentro: boolean;
  /** ¿Se le puede asignar una tarea ahora mismo? */
  permitido: boolean;
  /** Excepcion aplicada (si la hay). */
  excepcion: ExcepcionTurno | null;
}

/**
 * Evalua si a una persona se le puede asignar una tarea en este momento.
 * `ahora` por defecto es la hora local del dispositivo (en Mexico = hora local).
 *
 * Regla: solo se permite si la hora actual cae dentro del horario de su turno
 * efectivo (considerando rotacion y excepciones). Personas que no estan en el
 * sistema de turnos NO tienen restriccion (restringido=false, permitido=true).
 */
export function evaluarAsignacion(config: ConfigTurnos | null, uid: string, ahora: Date = new Date()): EvaluacionTurno {
  const libre: EvaluacionTurno = { restringido: false, turno: null, dentro: true, permitido: true, excepcion: null };
  if (!config || !config.habilitado) return libre;

  const diaISO = fechaISO(ahora);
  const turno = turnoEfectivo(config, uid, diaISO);
  if (turno === null) return libre; // no esta en el sistema de turnos

  const h = config.horarios?.[turno];
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const ini = aMinutos(h?.inicio);
  const fin = aMinutos(h?.fin);
  const dentro = !isNaN(ini) && !isNaN(fin) && minutosAhora >= ini && minutosAhora <= fin;

  return {
    restringido: true,
    turno,
    dentro,
    permitido: dentro,
    excepcion: excepcionActiva(config, uid, diaISO),
  };
}

/**
 * ¿Se le puede GENERAR una rutina a esta persona en un dia dado, segun la hora
 * de la rutina? La usa el robot de rutinas. Reglas:
 *   - Si el control esta apagado o la persona no esta en turnos -> SI.
 *   - Si la rutina no tiene hora real (vacia o 23:59 = "todo el dia") -> SI
 *     (no se puede ubicar en un turno, asi que pasa).
 *   - Si tiene hora -> SOLO si esa hora cae dentro de su turno efectivo ese dia.
 */
export function rutinaPermitidaEnTurno(
  config: ConfigTurnos | null,
  uid: string,
  diaISO: string,
  horaRutina: string | null | undefined
): boolean {
  if (!config || !config.habilitado) return true;
  const turno = turnoEfectivo(config, uid, diaISO);
  if (turno === null) return true; // no esta en el sistema de turnos

  const min = aMinutos(horaRutina || '');
  if (isNaN(min) || (horaRutina || '').trim() === '23:59') return true; // sin hora real -> pasa

  const h = config.horarios?.[turno];
  const ini = aMinutos(h?.inicio);
  const fin = aMinutos(h?.fin);
  if (isNaN(ini) || isNaN(fin)) return true;
  return min >= ini && min <= fin;
}

/** Etiqueta legible de un turno. */
export function etiquetaTurno(t: Turno | null): string {
  if (t === 'manana') return 'Manana';
  if (t === 'tarde') return 'Tarde';
  return '';
}
