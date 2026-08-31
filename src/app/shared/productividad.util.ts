/**
 * 📈 PRODUCTIVIDAD CONTRA EL HORARIO DE TRABAJO
 *
 * Cruza lo que se hizo (checklists) con cuándo se debía estar trabajando
 * (`horarios_sucursal` de Mega Talento). Eso es lo que permite distinguir tres
 * cosas que hasta ahora se veían iguales en el tablero:
 *
 *   · una persona que hizo sus 20 puntos a lo largo de su turno,
 *   · una que hizo los mismos 20 palomeándolos todos en dos minutos al final,
 *   · y una que los marcó a las 23:40 en una sucursal que cierra a las 18:00.
 *
 * Las tres salen "100% cumplido" si solo se cuenta cuántos puntos hay hechos.
 *
 * ─── LO QUE ESTE ARCHIVO NO HACE ────────────────────────────────────────────
 *
 * NO llama tramposo a nadie. Marcar todo al final del turno puede ser
 * exactamente lo que pide el trabajo —una cajera no va a sacar el teléfono entre
 * dos clientes— y trabajar fuera de horario puede ser un turno cubierto o una
 * urgencia. Lo que hace es SEPARAR los casos para que alguien los mire, no
 * repartir culpas por su cuenta.
 *
 * NO compara cuántos puntos hizo cada quien. Una Cajera tiene 23 tareas y un
 * Anaquelista 18: quien hizo más puntos puede simplemente tener más puesto
 * encima. Todo se mide como PROPORCIÓN de lo que a cada uno le tocaba.
 *
 * NO inventa cuando falta el dato. Un punto hecho sin sello de tiempo no se
 * cuenta como puntual ni como tardío: se cuenta como SIN SELLO y se muestra
 * aparte. Igual una sucursal sin horario capturado en Mega Talento: no se le
 * calcula "dentro de turno", se dice que no se sabe. Hoy eso son Padre Hidalgo
 * y Morelia Abastos, que juntas son el 41% de la plantilla.
 */

import { esItemHecho, completadoEn } from './item-completado.util';
import { HorarioSucursal, SUCURSAL_A_TALENTO } from './horarios-sucursal.util';
import { cuentaEnOperacion } from './medicion.util';

/** Ventana de trabajo de un día, en epoch. */
export interface VentanaTurno {
  entrada: number;
  salida: number;
  /** 'HH:mm' original, para mostrarlo. */
  textoEntrada: string;
  textoSalida: string;
}

/**
 * La ventana de turno de una sucursal en una fecha, o null si no hay horario
 * capturado. El null es una respuesta legítima, no un error.
 */
export function ventanaDeTurno(
  sucursal: string,
  fechaYmd: string,
  horarios: HorarioSucursal[],
): VentanaTurno | null {
  const id = SUCURSAL_A_TALENTO[(sucursal || '').trim()];
  if (!id || !fechaYmd) return null;

  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaYmd);
  if (!f) return null;
  const dia = new Date(Number(f[1]), Number(f[2]) - 1, Number(f[3])).getDay();

  const filas = horarios.filter(h => h.sucursal_id === id
    && Array.isArray(h.dias) && h.dias.includes(dia));
  if (!filas.length) return null;

  // Con varios turnos, la ventana va del que entra más temprano al que sale más
  // tarde: la sucursal estuvo abierta todo ese rango.
  const entradas = filas.map(h => h.entrada).filter(Boolean).sort();
  const salidas = filas.map(h => h.salida).filter(Boolean).sort();
  if (!entradas.length || !salidas.length) return null;

  const aEpoch = (hhmm: string) => {
    const t = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
    if (!t) return null;
    return new Date(Number(f[1]), Number(f[2]) - 1, Number(f[3]), Number(t[1]), Number(t[2]), 0).getTime();
  };
  const e = aEpoch(entradas[0]);
  const s = aEpoch(salidas[salidas.length - 1]);
  if (e == null || s == null) return null;

  return { entrada: e, salida: s, textoEntrada: entradas[0], textoSalida: salidas[salidas.length - 1] };
}

/** Lo medido de una persona o de una sucursal. */
export interface Medicion {
  clave: string;
  puesto?: string;
  sucursal?: string;

  asignados: number;
  hechos: number;

  /** De los hechos: cuántos se pueden situar en el tiempo. */
  conSello: number;
  sinSello: number;

  /** De los que tienen sello. */
  dentroTurno: number;
  fueraTurno: number;
  aTiempo: number;
  tarde: number;

  /** Minutos entre el primer y el último sello del día. */
  minutosActividad: number | null;

  /** Cuántos días de esta persona no tenían horario capturado. */
  diasSinHorario: number;
  dias: number;
}

function vacia(clave: string): Medicion {
  return {
    clave, asignados: 0, hechos: 0, conSello: 0, sinSello: 0,
    dentroTurno: 0, fueraTurno: 0, aTiempo: 0, tarde: 0,
    minutosActividad: null, diasSinHorario: 0, dias: 0,
  };
}

/** El límite de un punto: el suyo si lo trae, si no el del checklist. */
function limiteDe(item: any, checklist: any): string {
  return (item?.horaLimite || checklist?.time || checklist?.hora || '') as string;
}

/**
 * Mide un conjunto de checklists, agrupando por la llave que devuelva `llaveDe`
 * (el nombre para medir personas, la sucursal para medir plazas).
 */
export function medir(
  checklists: any[],
  horarios: HorarioSucursal[],
  llaveDe: (c: any) => string,
  puestoDe?: (c: any) => string,
): Medicion[] {
  const mapa = new Map<string, Medicion>();
  const sellosPorLlaveDia = new Map<string, number[]>();
  const diasVistos = new Map<string, Set<string>>();
  const diasSinHorarioVistos = new Map<string, Set<string>>();

  for (const c of checklists) {
    // Misma regla de medición que el resto de la app: el Espacio TEC y lo
    // archivado no cuentan para la operación.
    if (!cuentaEnOperacion(c)) continue;

    const clave = (llaveDe(c) || '').trim();
    if (!clave) continue;

    const fecha: string = c.date || c.fecha || '';
    const m = mapa.get(clave) || vacia(clave);
    if (!m.sucursal && c.store) m.sucursal = c.store;
    if (puestoDe && !m.puesto) { const p = puestoDe(c); if (p) m.puesto = p; }

    const ventana = ventanaDeTurno(c.store || '', fecha, horarios);
    if (fecha) {
      const dv = diasVistos.get(clave) || new Set<string>();
      dv.add(fecha); diasVistos.set(clave, dv);
      if (!ventana) {
        const sh = diasSinHorarioVistos.get(clave) || new Set<string>();
        sh.add(fecha); diasSinHorarioVistos.set(clave, sh);
      }
    }

    for (const it of (c.items || [])) {
      m.asignados++;
      if (!esItemHecho(it, c)) continue;
      m.hechos++;

      const cuando = completadoEn(it, fecha);
      if (cuando == null) { m.sinSello++; continue; }
      m.conSello++;

      const k = clave + '|' + fecha;
      const arr = sellosPorLlaveDia.get(k) || [];
      arr.push(cuando); sellosPorLlaveDia.set(k, arr);

      if (ventana) {
        if (cuando >= ventana.entrada && cuando <= ventana.salida) m.dentroTurno++;
        else m.fueraTurno++;
      }

      const lim = limiteDe(it, c);
      const limEpoch = lim ? horaLimiteAEpoch(fecha, lim) : null;
      if (limEpoch != null) {
        if (cuando <= limEpoch) m.aTiempo++; else m.tarde++;
      }
    }

    mapa.set(clave, m);
  }

  // Minutos de actividad: el promedio del rango diario. Un promedio de 3 minutos
  // en 20 puntos es la firma de haber palomeado todo de una sentada.
  const rangos = new Map<string, number[]>();
  for (const [k, sellos] of sellosPorLlaveDia) {
    if (sellos.length < 2) continue;
    const clave = k.split('|')[0];
    const min = (Math.max(...sellos) - Math.min(...sellos)) / 60000;
    const arr = rangos.get(clave) || [];
    arr.push(min); rangos.set(clave, arr);
  }

  for (const [clave, m] of mapa) {
    m.dias = (diasVistos.get(clave) || new Set()).size;
    m.diasSinHorario = (diasSinHorarioVistos.get(clave) || new Set()).size;
    const r = rangos.get(clave);
    m.minutosActividad = r && r.length
      ? Math.round(r.reduce((a, b) => a + b, 0) / r.length)
      : null;
  }

  return [...mapa.values()];
}

/** 'HH:mm' o 'h:mm AM/PM' a epoch del día. */
function horaLimiteAEpoch(fechaYmd: string, hora: string): number | null {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaYmd);
  const t = /^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/.exec(String(hora).trim());
  if (!f || !t) return null;
  let h = Number(t[1]);
  const suf = (t[3] || '').toUpperCase();
  if (suf === 'PM' && h < 12) h += 12;
  if (suf === 'AM' && h === 12) h = 0;
  return new Date(Number(f[1]), Number(f[2]) - 1, Number(f[3]), h, Number(t[2]), 0).getTime();
}

/** Porcentaje entero, o null cuando el denominador es 0 (no es "0%", es "no se sabe"). */
export function pct(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 100) : null;
}
