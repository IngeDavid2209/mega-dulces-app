/**
 * 🧩 LA PLANTILLA DE UNA SUCURSAL — lo que DEBE haber contra lo que HAY
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * Hasta hoy el sistema solo conocía a la gente que existe. Nunca supo cuánta
 * DEBERÍA existir, así que no podía nombrar ni una vacante ni un excedente: si
 * en Padre Hidalgo faltan dos anaquelistas, el trabajo se reparte entre los que
 * quedan y el tablero lo muestra como bajo cumplimiento DE ESAS PERSONAS.
 *
 * La plantilla es la autorización («cuatro anaquelistas en Padre Hidalgo») y el
 * censo es la realidad («hay cinco»). Este archivo es la resta, y nada más: no
 * lee la base, no llama a ninguna API y no decide nada de acceso.
 *
 * ─── LA DISTINCIÓN QUE MÁS IMPORTA AQUÍ ───────────────────────────────────
 * «No hay plantilla capturada» y «la plantilla dice cero» NO son lo mismo, y el
 * invariante §5.2 obliga a separarlas: la ausencia de datos no puede significar
 * dos cosas distintas. Un puesto con cinco personas y sin plantilla capturada
 * NO es «excedente de cinco» —nadie ha dicho todavía cuántos debe haber— sino
 * `sin_plantilla`, que es una pregunta abierta y no un incumplimiento. Por eso
 * `autorizado` es `number | null` y el null viaja hasta la pantalla.
 *
 * ─── PUESTOS DECLARADOS ("de temporada") ──────────────────────────────────
 * Dirección puede declarar un puesto que no está en el organigrama. Su id lleva
 * SIEMPRE el prefijo `tmp-`, garantizado por un `check` en la tabla (migración
 * 057), así que no puede colisionar con uno publicado. Aquí se trata como un
 * puesto más, con dos avisos que la pantalla tiene que mostrar:
 *   · no tiene manual, así que no va a recibir tareas, y
 *   · tiene fecha de fin.
 *
 * ─── NO REIMPLEMENTA NADA ─────────────────────────────────────────────────
 * El nombre del puesto sale de `nombrePuesto()`, el manual de
 * `puestoTieneManual()` y el parecido de nombres de `normalizarNombre()`, que
 * es la MISMA función con la que `resolverPuesto` arma su índice de alias. Si
 * aquí se escribiera otra normalización, existirían dos reglas de identidad
 * libres de discrepar — que es el hallazgo 1 de este proyecto (§8.11 d).
 */
import { PuestoOrganigrama, PUESTOS_ORGANIGRAMA, puestoPorId, nombrePuesto } from './organigrama.catalogo';
import { puestoTieneManual } from './tareas-manual.catalogo';
import { normalizarNombre } from './permisos.util';

/** Prefijo obligatorio de todo puesto declarado. Espejo del `check` de la 057. */
export const PREFIJO_DECLARADO = 'tmp-';

export function esPuestoDeclarado(puestoId: string | undefined | null): boolean {
  return String(puestoId || '').startsWith(PREFIJO_DECLARADO);
}

/** Una fila de `mdtask_puestos_declarados`. */
export interface PuestoDeclarado {
  id: string;
  nombre: string;
  tipo?: string;
  unidad?: string | null;
  reportaA?: string | null;
  desde?: string | null;
  /** 'YYYY-MM-DD'. Obligatoria: una temporada sin fin es un puesto permanente. */
  hasta: string;
  vigente?: boolean;
}

/** Una fila de `mdtask_plantillas`. */
export interface RenglonPlantilla {
  puestoId: string;
  cantidad: number;
  vigente?: boolean;
}

export type EstadoRenglon = 'cuadra' | 'vacante' | 'excedente' | 'sin_plantilla';

export interface RenglonComparado {
  puestoId: string;
  nombre: string;
  /** null = nadie ha capturado cuántos debe haber. NO es cero. */
  autorizado: number | null;
  ocupado: number;
  /** 0 cuando no aplica. Solo tienen sentido con `autorizado` no nulo. */
  vacantes: number;
  excedente: number;
  declarado: boolean;
  /** Su fecha de fin, si es declarado. */
  hasta?: string | null;
  /** No hay norma escrita para este puesto: no va a recibir tareas. */
  sinManual: boolean;
  estado: EstadoRenglon;
}

/**
 * El nombre a mostrar. Para un puesto declarado sale de su propia fila, porque
 * `nombrePuesto()` solo conoce el catálogo publicado.
 */
function nombreDe(puestoId: string, declarados: PuestoDeclarado[]): string {
  if (esPuestoDeclarado(puestoId)) {
    const d = declarados.find(x => x.id === puestoId);
    return d ? d.nombre : puestoId;
  }
  return nombrePuesto(puestoId);
}

/**
 * Compara la plantilla autorizada contra el censo de una sucursal.
 *
 * `censo` es el conteo de personas por puestoId, y tiene que venir YA resuelto
 * por `resolverPuesto()` — no se calcula aquí, para que no exista una segunda
 * versión de esa regla.
 *
 * Devuelve un renglón por cada puesto que aparezca en CUALQUIERA de los dos
 * lados: los autorizados sin gente (vacantes puras) y la gente en puestos sin
 * plantilla salen los dos, porque esconder cualquiera de los dos lados es
 * justo lo que hace invisible el problema.
 */
export function compararPlantilla(
  plantilla: RenglonPlantilla[],
  censo: Map<string, number> | Record<string, number>,
  declarados: PuestoDeclarado[] = [],
): RenglonComparado[] {
  const cuenta: Map<string, number> = censo instanceof Map
    ? censo
    : new Map(Object.entries(censo || {}));

  const autorizados = new Map<string, number>();
  for (const r of plantilla) {
    if (r && r.vigente === false) continue;
    if (!r || !r.puestoId) continue;
    autorizados.set(r.puestoId, Number(r.cantidad) || 0);
  }

  const ids = new Set<string>([...autorizados.keys(), ...cuenta.keys()]);
  const filas: RenglonComparado[] = [];

  for (const puestoId of ids) {
    const autorizado = autorizados.has(puestoId) ? autorizados.get(puestoId)! : null;
    const ocupado = Number(cuenta.get(puestoId)) || 0;
    const declarado = esPuestoDeclarado(puestoId);
    const d = declarado ? declarados.find(x => x.id === puestoId) : undefined;

    let estado: EstadoRenglon;
    let vacantes = 0;
    let excedente = 0;
    if (autorizado == null) {
      // Hay gente y nadie ha dicho cuántos debe haber. Es una pregunta abierta,
      // no un incumplimiento: no se cuenta como excedente (§5.2).
      estado = 'sin_plantilla';
    } else if (ocupado < autorizado) {
      vacantes = autorizado - ocupado;
      estado = 'vacante';
    } else if (ocupado > autorizado) {
      excedente = ocupado - autorizado;
      estado = 'excedente';
    } else {
      estado = 'cuadra';
    }

    filas.push({
      puestoId,
      nombre: nombreDe(puestoId, declarados),
      autorizado, ocupado, vacantes, excedente,
      declarado,
      hasta: d ? d.hasta : null,
      // Un puesto declarado NUNCA tiene manual: el catálogo de manuales solo
      // conoce los publicados. Se dice explícito en vez de dejarlo salir de
      // un `false` accidental de la otra función.
      sinManual: declarado ? true : !puestoTieneManual(puestoId),
      estado,
    });
  }

  return filas.sort(ordenarRenglones);
}

/**
 * Orden: primero lo que pide acción (vacantes y excedentes), luego lo que
 * cuadra, y al final lo que nadie ha capturado. Dentro de cada grupo, por el
 * orden del organigrama —no alfabético— para que la Encargada aparezca arriba
 * de sus anaquelistas. Los declarados van al final de su grupo: no están en el
 * organigrama y ordenarlos por parecido sería inventarles un lugar.
 */
function ordenarRenglones(a: RenglonComparado, b: RenglonComparado): number {
  const peso = (r: RenglonComparado) =>
    r.estado === 'vacante' ? 0 : r.estado === 'excedente' ? 1 : r.estado === 'cuadra' ? 2 : 3;
  if (peso(a) !== peso(b)) return peso(a) - peso(b);

  const pos = (r: RenglonComparado) => {
    if (r.declarado) return Number.MAX_SAFE_INTEGER;
    const i = PUESTOS_ORGANIGRAMA.findIndex(p => p.id === r.puestoId);
    return i < 0 ? Number.MAX_SAFE_INTEGER - 1 : i;
  };
  if (pos(a) !== pos(b)) return pos(a) - pos(b);
  return a.nombre.localeCompare(b.nombre);
}

export interface ResumenPlantilla {
  autorizados: number;
  ocupados: number;
  vacantes: number;
  excedente: number;
  /** Puestos con gente y sin plantilla capturada. La pregunta abierta. */
  sinPlantilla: number;
  /** Puestos de la plantilla que no van a recibir tareas por no tener manual. */
  sinManual: number;
}

/**
 * Los totales. `autorizados` suma SOLO los renglones con plantilla capturada:
 * mezclar ahí a los `sin_plantilla` daría un total que parece completo y no lo
 * es, que es la clase de cifra que este proyecto ya persiguió una vez.
 */
export function resumenPlantilla(filas: RenglonComparado[]): ResumenPlantilla {
  const r: ResumenPlantilla = {
    autorizados: 0, ocupados: 0, vacantes: 0, excedente: 0, sinPlantilla: 0, sinManual: 0,
  };
  for (const f of filas) {
    if (f.autorizado != null) r.autorizados += f.autorizado; else r.sinPlantilla++;
    r.ocupados += f.ocupado;
    r.vacantes += f.vacantes;
    r.excedente += f.excedente;
    if (f.sinManual) r.sinManual++;
  }
  return r;
}

// ============================================================================
//  DECLARAR UN PUESTO NUEVO, sin crear un duplicado por el camino
// ============================================================================

export interface ProblemaDeclaracion {
  campo: 'nombre' | 'hasta';
  /** `bloquea` impide guardar; `avisa` deja decidir a quien captura. */
  gravedad: 'bloquea' | 'avisa';
  mensaje: string;
  /** El puesto del catálogo al que se parece, si lo hay. */
  pareceA?: PuestoOrganigrama;
}

/**
 * Revisa una declaración ANTES de guardarla.
 *
 * El aviso de parecido es el que importa, y sale del hallazgo 1: en este
 * sistema la identidad se cruza por texto, así que un puesto tecleado a mano es
 * exactamente cómo nace un duplicado —«Surtidor» contra «Surtidor de Ventas»—.
 * NO bloquea: puede existir una razón real para tener los dos. Solo obliga a
 * que quien captura vea el que ya existe antes de crear otro.
 */
export function revisarDeclaracion(nombre: string, hasta: string): ProblemaDeclaracion[] {
  const problemas: ProblemaDeclaracion[] = [];
  const limpio = String(nombre || '').trim();

  if (!limpio) {
    problemas.push({ campo: 'nombre', gravedad: 'bloquea', mensaje: 'El puesto necesita un nombre.' });
  } else {
    const k = normalizarNombre(limpio);
    const pareceA = PUESTOS_ORGANIGRAMA.find(p => {
      if (normalizarNombre(p.nombre) === k) return true;
      return (p.aliasCargos || []).some(a => normalizarNombre(a) === k);
    });
    if (pareceA) {
      problemas.push({
        campo: 'nombre', gravedad: 'avisa', pareceA,
        mensaje: `Ya existe «${pareceA.nombre}» en el organigrama. Si es ese puesto, úsalo en vez de ` +
                 `declarar uno nuevo: dos puestos con el mismo nombre parten el cumplimiento en dos.`,
      });
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(hasta || ''))) {
    problemas.push({
      campo: 'hasta', gravedad: 'bloquea',
      mensaje: 'Falta la fecha de fin. Una temporada sin fecha de fin es un puesto permanente, ' +
               'y en tres meses nadie va a saber por qué existe.',
    });
  }

  return problemas;
}

/**
 * El id de un puesto declarado, a partir de su nombre. Siempre con prefijo, y
 * con un sufijo de tiempo para que dos temporadas con el mismo nombre en años
 * distintos no colisionen (la de 2026 no es la misma que la de 2027, y los
 * checklists viejos tienen que seguir apuntando a la suya).
 *
 * EL SUFIJO ES EL EPOCH COMPLETO EN BASE 36, y la primera versión estaba mal:
 * usaba `String(ahora).slice(-6)`, los últimos seis dígitos en milisegundos.
 * Eso colisiona por dos caminos, y la prueba lo cazó antes de que existiera la
 * pantalla — dos epoch redondos (…000000) daban el MISMO id, y aun sin serlo,
 * seis dígitos de ms solo distinguen dentro de una ventana de ~16 minutos. Dos
 * temporadas con el mismo nombre habrían compartido id, y los checklists de la
 * vieja habrían empezado a apuntar al puesto de la nueva: historia reescrita,
 * en silencio, que es lo que el §5.5 prohíbe.
 */
export function idDeclarado(nombre: string, ahora: number = Date.now()): string {
  const base = normalizarNombre(String(nombre || ''))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return PREFIJO_DECLARADO + (base || 'puesto') + '-' + Math.trunc(ahora).toString(36);
}

/** ¿Sigue vigente esta declaración en la fecha dada? */
export function declaracionVigente(d: PuestoDeclarado, hoyYmd: string): boolean {
  if (!d || d.vigente === false) return false;
  if (d.desde && hoyYmd < d.desde) return false;
  if (d.hasta && hoyYmd > d.hasta) return false;
  return true;
}

/** Convierte una declaración a la forma del catálogo, para pintarla junto. */
export function comoPuestoDeCatalogo(d: PuestoDeclarado): PuestoOrganigrama {
  return {
    id: d.id,
    nombre: d.nombre,
    // Si Dirección no dijo la unidad, NO se adivina: se deja sin ella y sale
    // visible como pendiente (§8.5). `puestoPorId` del jefe se usa solo para
    // validar que exista, nunca para heredarle nada por parecido.
    unidad: (d.unidad || 'sucursal') as any,
    nivel: 'operativo' as any,
    reportaA: d.reportaA && puestoPorId(d.reportaA) ? d.reportaA : null,
  };
}
