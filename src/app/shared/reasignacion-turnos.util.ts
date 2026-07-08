/**
 * Reasignacion automatica de TAREAS por turno/descanso.
 *
 * Replica el criterio del Robot V2 (robot-rutinas-v2.service.ts: `disponible` +
 * la rama "primer disponible de la sucursal" de `primerDisponible`) para poder
 * aplicarlo tambien a las tareas que se asignan a mano (wizard de Checklist y
 * Espacio TEC), que NO pasan por el robot.
 *
 * Diferencia con rutinas: las tareas no tienen `reasignacionAuto` ni
 * `ordenReemplazo`, asi que el reemplazo es siempre el primer trabajador
 * disponible de la misma sucursal.
 *
 * (El robot conserva su propia copia de esta logica; unificarlos queda como
 * follow-up para no arriesgar codigo recien desplegado.)
 */
import { ConfigTurnos, fechaISO, rutinaPermitidaEnTurno } from './turnos.util';
import { esDiaDescansoEnFecha } from './descansos.util';
import { normalizarNombre } from './permisos.util';

/** Fn de disponibilidad: ¿esta persona puede tomar una tarea ese dia/hora? */
export type DisponibleFn = (nombre: string, fecha: Date, hora?: string | null) => boolean;

/**
 * Construye la fn de disponibilidad con el MISMO criterio que el Robot V2:
 *  - descansa ese dia (descansos_semanales) -> no disponible.
 *  - fuera de su turno efectivo a esa hora (config/turnos) -> no disponible.
 * Quien no esta en el sistema de turnos no se restringe por turno; sin hora real
 * (vacia o 23:59) tampoco (igual que `rutinaPermitidaEnTurno`).
 */
export function crearDisponibilidad(
  configTurnos: ConfigTurnos | null,
  descansosSemana: any[],
  nombreAUid: Map<string, string>
): DisponibleFn {
  return (nombre: string, fecha: Date, hora?: string | null): boolean => {
    const uid = nombreAUid.get(normalizarNombre(nombre));
    if (uid && esDiaDescansoEnFecha(fecha, descansosSemana.filter((d: any) => d.userId === uid))) return false;
    if (configTurnos?.habilitado && uid && !rutinaPermitidaEnTurno(configTurnos, uid, fechaISO(fecha), hora)) return false;
    return true;
  };
}

/**
 * Primer trabajador/admin de la sucursal (no usado aun ese dia) que este
 * disponible. Sin filtro de rol ni backups (las tareas no los tienen). Mismo
 * match de sucursal + comodin 'General (Acceso Total)' que usa el robot.
 */
export function primerDisponibleSucursal(
  usuarios: any[],
  sucursal: string,
  disponible: DisponibleFn,
  yaUsados: Set<string>,
  fecha: Date,
  hora?: string | null
): string | null {
  const objetivo = normalizarNombre(sucursal);
  const comodin = normalizarNombre('General (Acceso Total)');
  for (const u of usuarios) {
    if (u.rol !== 'trabajador' && u.rol !== 'admin') continue;
    const sucs = (u.sucursales && u.sucursales.length) ? u.sucursales : (u.sucursal ? [u.sucursal] : []);
    const enSuc = sucs.some((s: string) => { const n = normalizarNombre(s); return n === objetivo || n === comodin; });
    if (!enSuc) continue;
    const clave = normalizarNombre(u.nombre || '');
    if (!clave || yaUsados.has(clave)) continue;
    if (!disponible(u.nombre, fecha, hora)) continue;
    return u.nombre;
  }
  return null;
}

export interface ResolucionAsignado {
  /** Nombre que finalmente recibe la tarea. */
  nombreFinal: string;
  /** true si hubo cambio respecto al asignado pedido. */
  reasignado: boolean;
  /** Nombre originalmente pedido. */
  original: string;
  /** true si el original NO estaba disponible y NO se encontro reemplazo. */
  sinReemplazo: boolean;
}

/**
 * Resuelve a quien se le asigna una tarea considerando turno/descanso.
 * Marca `yaUsados` con el nombre final para que, al asignar varias a la vez,
 * no caigan todas en la misma persona.
 */
export function resolverAsignadoTarea(args: {
  nombre: string;
  sucursal: string;
  fecha: Date;
  hora?: string | null;
  usuarios: any[];
  configTurnos: ConfigTurnos | null;
  descansosSemana: any[];
  nombreAUid: Map<string, string>;
  yaUsados: Set<string>;
}): ResolucionAsignado {
  const { nombre, sucursal, fecha, hora, usuarios, configTurnos, descansosSemana, nombreAUid, yaUsados } = args;
  const disponible = crearDisponibilidad(configTurnos, descansosSemana, nombreAUid);

  if (disponible(nombre, fecha, hora)) {
    yaUsados.add(normalizarNombre(nombre));
    return { nombreFinal: nombre, reasignado: false, original: nombre, sinReemplazo: false };
  }

  const reemplazo = primerDisponibleSucursal(usuarios, sucursal, disponible, yaUsados, fecha, hora);
  if (!reemplazo) {
    yaUsados.add(normalizarNombre(nombre));
    return { nombreFinal: nombre, reasignado: false, original: nombre, sinReemplazo: true };
  }
  yaUsados.add(normalizarNombre(reemplazo));
  return { nombreFinal: reemplazo, reasignado: true, original: nombre, sinReemplazo: false };
}

/** Construye el mapa nombre-normalizado -> uid a partir de la lista de usuarios. */
export function mapaNombreAUid(usuarios: any[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const u of usuarios) {
    const id = u.id || u.uid;
    if (id && u.nombre) m.set(normalizarNombre(u.nombre), id);
  }
  return m;
}
