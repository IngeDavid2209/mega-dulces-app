/**
 * Motor de DETECCIÓN DE CONFLICTOS de rutinas (puro, sin Firestore).
 *
 * Cruza, para un rango de fechas:
 *   asignaciones × personas × días de descanso × turnos
 * y devuelve los conflictos: alguien al que le tocaría una rutina pero ese día
 * descansa, está fuera de turno, o nadie cumple la asignación (sin asignar).
 *
 * Reusa la lógica que ya existe en la app:
 *   - asignacionAplicaEnFecha (programacion.util)
 *   - esDiaDescansoEnFecha (descansos.util)
 *   - rutinaPermitidaEnTurno (turnos.util)
 */

import { AsignacionRutina } from './asignaciones.types';
import { RutinaMaestra } from './rutinas.types';
import { asignacionAplicaEnFecha, fechaToYmd, nombreDiaSemana } from './programacion.util';
import { esDiaDescansoEnFecha } from './descansos.util';
import { ConfigTurnos, rutinaPermitidaEnTurno } from './turnos.util';
import { normalizarNombre } from './permisos.util';

export type TipoConflicto = 'descanso' | 'turno' | 'sin_asignar';

export interface ConflictoRutina {
  asignacionId: string;
  nombreRutina: string;
  sucursal: string;
  fecha: string;          // YYYY-MM-DD
  diaNombre: string;
  hora: string;
  persona: string;        // nombre (vacío si sin_asignar)
  uid: string;
  tipo: TipoConflicto;
  razon: string;
  sugeridos: string[];    // nombres disponibles ese día/hora en la sucursal
}

export interface AnalizarConflictosOpts {
  asignaciones: AsignacionRutina[];
  catalogo: RutinaMaestra[];
  usuarios: any[];
  descansos: any[];                 // docs de descansos_semanales
  configTurnos: ConfigTurnos | null;
  rango: Date[];                    // fechas a evaluar (ej. la semana)
}

function sucursalesDe(u: any): string[] {
  return (u?.sucursales && u.sucursales.length) ? u.sucursales : (u?.sucursal ? [u.sucursal] : []);
}
function uidDe(u: any): string { return u?.id || u?.uid || ''; }
function perteneceASucursal(u: any, sucursal: string): boolean {
  const objetivo = normalizarNombre(sucursal);
  const comodin = normalizarNombre('General (Acceso Total)');
  return sucursalesDe(u).some(s => { const n = normalizarNombre(s); return n === objetivo || n === comodin; });
}

/** Usuarios que recibirían esta asignación en la sucursal dada. */
function destinatarios(asig: AsignacionRutina, usuarios: any[], sucursal: string): any[] {
  if (asig.modoAsignacion === 'porPersonas') {
    const nombres = (asig.empleadosNombres || []).map(n => normalizarNombre(n));
    return usuarios.filter(u => nombres.includes(normalizarNombre(u.nombre)));
  }
  const rol = normalizarNombre(asig.rolObjetivo || '');
  if (!rol) return [];
  return usuarios.filter(u =>
    (u.rol === 'trabajador' || u.rol === 'admin') &&
    normalizarNombre(u.cargo || '').includes(rol) &&
    perteneceASucursal(u, sucursal)
  );
}

/** ¿Hay una excepción que ya resuelve este (fecha, persona)? */
function yaResuelto(asig: AsignacionRutina, fechaYmd: string, personaOriginal: string): boolean {
  return (asig.excepciones || []).some(e =>
    e.fecha === fechaYmd &&
    normalizarNombre(e.personaOriginal || '') === normalizarNombre(personaOriginal || '')
  );
}

/** ¿Esta persona está disponible (no descansa, no fuera de turno) ese día/hora? */
function disponible(u: any, fecha: Date, fechaYmd: string, hora: string, descansos: any[], cfg: ConfigTurnos | null): boolean {
  const uid = uidDe(u);
  const desc = descansos.filter(d => d.userId === uid);
  if (esDiaDescansoEnFecha(fecha, desc)) return false;
  if (cfg && uid && !rutinaPermitidaEnTurno(cfg, uid, fechaYmd, hora)) return false;
  return true;
}

// ===========================================================================
// MATRIZ SEMANAL (para la vista de Programación: rutinas × días)
// ===========================================================================

export type EstadoPersona = 'ok' | 'descanso' | 'turno' | 'reasignado';
export type EstadoCelda = 'na' | 'ok' | 'conflicto' | 'sin_asignar';

export interface PersonaCelda { nombre: string; estado: EstadoPersona; }
export interface CeldaProg {
  fecha: string;
  estado: EstadoCelda;
  personas: PersonaCelda[];
}
export interface FilaProg {
  asignacionId: string;
  nombreRutina: string;
  frecuencia: string;
  hora: string;
  sucursal: string;
  reasignacionAuto: boolean;
  celdas: CeldaProg[];          // una por día del rango
}

export interface MatrizOpts {
  asignaciones: AsignacionRutina[];
  catalogo: RutinaMaestra[];
  usuarios: any[];
  descansos: any[];
  configTurnos: ConfigTurnos | null;
  dias: Date[];                 // normalmente 7 (la semana)
}

/** Aplica las excepciones de una fecha a la lista base de destinatarios. */
function aplicarExcepciones(asig: AsignacionRutina, fechaYmd: string, base: any[]): string[] {
  const exc = (asig.excepciones || []).filter(e => e.fecha === fechaYmd);
  let nombres = base.flatMap(u => {
    const ex = exc.find(e => normalizarNombre(e.personaOriginal || '') === normalizarNombre(u.nombre));
    if (!ex) return [u.nombre];
    if (ex.reemplazo == null) return [];
    return [ex.reemplazo];
  });
  for (const e of exc) {
    if (!(e.personaOriginal || '') && e.reemplazo &&
        !nombres.some(n => normalizarNombre(n) === normalizarNombre(e.reemplazo!))) {
      nombres.push(e.reemplazo);
    }
  }
  return nombres;
}

/** Construye la matriz rutina×día para la vista semanal de Programación. */
export function construirMatrizSemana(o: MatrizOpts): FilaProg[] {
  const filas: FilaProg[] = [];
  const catById = new Map(o.catalogo.map(c => [c.id, c]));
  const usuariosByNombre = new Map(o.usuarios.map(u => [normalizarNombre(u.nombre || ''), u]));

  for (const asig of o.asignaciones) {
    if (!asig.activa) continue;
    const rutina = catById.get(asig.catalogoRutinaId);
    const hora = asig.horaLimite || asig.horaInicio || rutina?.horaLimite || rutina?.horaInicio || '';

    for (const sucursal of (asig.sucursales || [])) {
      const celdas: CeldaProg[] = o.dias.map(fecha => {
        const fechaYmd = fechaToYmd(fecha);
        if (!asignacionAplicaEnFecha(asig, fecha)) {
          return { fecha: fechaYmd, estado: 'na' as EstadoCelda, personas: [] };
        }
        const base = destinatarios(asig, o.usuarios, sucursal);
        let nombres = aplicarExcepciones(asig, fechaYmd, base);
        if (nombres.length === 0) {
          return { fecha: fechaYmd, estado: 'sin_asignar' as EstadoCelda, personas: [] };
        }

        const yaUsados = new Set(nombres.map(n => normalizarNombre(n)));
        const personas: PersonaCelda[] = nombres.map(nombre => {
          const u = usuariosByNombre.get(normalizarNombre(nombre));
          if (u && disponible(u, fecha, fechaYmd, hora, o.descansos, o.configTurnos)) {
            return { nombre, estado: 'ok' as EstadoPersona };
          }
          // No disponible: si la asignación reasigna sola, busca reemplazo.
          if (asig.reasignacionAuto) {
            const rep = o.usuarios.find(c =>
              !yaUsados.has(normalizarNombre(c.nombre || '')) &&
              (c.rol === 'trabajador' || c.rol === 'admin') &&
              perteneceASucursal(c, sucursal) &&
              disponible(c, fecha, fechaYmd, hora, o.descansos, o.configTurnos));
            if (rep) { yaUsados.add(normalizarNombre(rep.nombre)); return { nombre: rep.nombre, estado: 'reasignado' as EstadoPersona }; }
          }
          const esDesc = u ? esDiaDescansoEnFecha(fecha, o.descansos.filter(d => d.userId === uidDe(u))) : false;
          return { nombre, estado: (esDesc ? 'descanso' : 'turno') as EstadoPersona };
        });

        const hayConflicto = personas.some(p => p.estado === 'descanso' || p.estado === 'turno');
        return { fecha: fechaYmd, estado: (hayConflicto ? 'conflicto' : 'ok') as EstadoCelda, personas };
      });

      // Si ningún día aplica, no agregamos la fila (no ensucia la tabla).
      if (celdas.every(c => c.estado === 'na')) continue;

      filas.push({
        asignacionId: asig.id, nombreRutina: asig.nombreRutina,
        frecuencia: asig.frecuencia, hora, sucursal,
        reasignacionAuto: !!asig.reasignacionAuto, celdas
      });
    }
  }
  return filas;
}

export function analizarConflictos(o: AnalizarConflictosOpts): ConflictoRutina[] {
  const out: ConflictoRutina[] = [];
  const catById = new Map(o.catalogo.map(c => [c.id, c]));

  for (const asig of o.asignaciones) {
    if (!asig.activa) continue;
    const rutina = catById.get(asig.catalogoRutinaId);
    const hora = asig.horaLimite || asig.horaInicio || rutina?.horaLimite || rutina?.horaInicio || '';

    for (const fecha of o.rango) {
      if (!asignacionAplicaEnFecha(asig, fecha)) continue;
      const fechaYmd = fechaToYmd(fecha);
      const diaNombre = nombreDiaSemana(fecha);

      for (const sucursal of (asig.sucursales || [])) {
        const dest = destinatarios(asig, o.usuarios, sucursal);

        if (dest.length === 0) {
          if (yaResuelto(asig, fechaYmd, '')) continue;     // omitido/asignado a mano
          out.push({
            asignacionId: asig.id, nombreRutina: asig.nombreRutina, sucursal,
            fecha: fechaYmd, diaNombre, hora, persona: '', uid: '',
            tipo: 'sin_asignar', razon: 'Nadie cumple esta asignación en la sucursal ese día.',
            sugeridos: []
          });
          continue;
        }

        for (const u of dest) {
          if (yaResuelto(asig, fechaYmd, u.nombre)) continue;  // ya reasignado/omitido
          const uid = uidDe(u);
          const desc = o.descansos.filter(d => d.userId === uid);
          let tipo: TipoConflicto | null = null;
          let razon = '';
          if (esDiaDescansoEnFecha(fecha, desc)) {
            tipo = 'descanso';
            razon = `${u.nombre} descansa el ${diaNombre}.`;
          } else if (o.configTurnos && uid && !rutinaPermitidaEnTurno(o.configTurnos, uid, fechaYmd, hora)) {
            tipo = 'turno';
            razon = `${u.nombre} está fuera de su turno${hora ? ' a las ' + hora : ''} ese día.`;
          }
          if (!tipo) continue;

          const sugeridos = o.usuarios
            .filter(c => uidDe(c) !== uid &&
              (c.rol === 'trabajador' || c.rol === 'admin') &&
              perteneceASucursal(c, sucursal) &&
              disponible(c, fecha, fechaYmd, hora, o.descansos, o.configTurnos))
            .map(c => c.nombre)
            .slice(0, 4);

          // Si la asignación reasigna sola y hay alguien disponible, el robot lo
          // cubre: no es un conflicto que el admin deba atender.
          if (asig.reasignacionAuto && sugeridos.length > 0) continue;

          out.push({
            asignacionId: asig.id, nombreRutina: asig.nombreRutina, sucursal,
            fecha: fechaYmd, diaNombre, hora, persona: u.nombre, uid, tipo, razon, sugeridos
          });
        }
      }
    }
  }
  return out;
}
