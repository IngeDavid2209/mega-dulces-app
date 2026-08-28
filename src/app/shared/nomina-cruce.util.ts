/**
 * 🔗 CRUCE NÓMINA ↔ PLANTILLA DE LA APP
 *
 * El problema: la nómina escribe `APELLIDOS NOMBRES` ("CARRILLO CONTRERAS
 * MIRIAM JAZMIN") y la app escribe `Nombre Apellidos` ("Miriam Carrillo").
 * No hay texto igual que comparar, y además la app suele traer el nombre corto.
 *
 * La solución: comparar CONJUNTOS DE PALABRAS. "Miriam Carrillo" comparte
 * {miriam, carrillo} con la fila de la nómina, y eso alcanza para reconocerla
 * sin importar el orden ni los apellidos que falten.
 *
 * ─── POR QUÉ NO SE ARRIESGA A ADIVINAR ──────────────────────────────────────
 * Dos palabras en común pueden ser coincidencia: "MARTINEZ LOPEZ JOSE" contra
 * "Jose Martinez" y "Jose Martinez Lopez" da empate, y elegir al azar le
 * cambiaría el puesto —y por lo tanto las tareas— a la persona equivocada.
 * Por eso el resultado se clasifica en tres, y solo el primero se aplica solo:
 *
 *   claro         un único candidato gana con ventaja
 *   duda          empate entre varios, o dos filas de nómina apuntan al mismo
 *                 usuario: lo decide una persona
 *   noEncontrado  nadie en la app se parece
 *
 * Nada de esto escribe: devuelve el veredicto para que la pantalla lo muestre
 * y alguien lo apruebe.
 */

import { FilaNomina } from './nomina-puestos';
import { resolverPuesto } from './puesto.util';
import { nombrePuesto } from './organigrama.catalogo';
import { tareasAutomaticasDePuesto } from './tareas-manual.catalogo';

/** Palabras que no distinguen a nadie y solo generan coincidencias falsas. */
const PARTICULAS = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'da', 'san', 'santa',
]);

/** Nombre → conjunto de palabras comparables (sin tildes, sin partículas). */
export function palabrasDe(nombre: string): Set<string> {
  const limpio = (nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ');
  const out = new Set<string>();
  for (const t of limpio.split(/\s+/)) {
    if (t.length < 3) continue;          // iniciales y ruido
    if (PARTICULAS.has(t)) continue;
    out.add(t);
  }
  return out;
}

export type Veredicto = 'claro' | 'duda' | 'noEncontrado';

export interface Candidato {
  usuario: any;
  /** Cuántas palabras comparte con la fila de la nómina. */
  comunes: number;
}

export interface Cruce {
  fila: FilaNomina;
  veredicto: Veredicto;
  /** El usuario elegido (en 'claro') o el que la persona seleccione (en 'duda'). */
  elegido: any | null;
  candidatos: Candidato[];

  // ── Lo que cambiaría, ya calculado para poder mostrarlo ────────────────
  /** Puesto que tiene hoy en la app (resuelto), '' si ninguno. */
  puestoActual: string;
  /** Nombre del puesto que quedaría. */
  puestoNuevo: string;
  /** true si el puesto cambia de uno válido a otro distinto: hay que mirarlo. */
  cambiaPuesto: boolean;
  /** Cuántas tareas de manual recibiría con el puesto nuevo. */
  tareas: number;
  /** Sucursal que se llenaría, solo si hoy no tiene ninguna. */
  sucursalAllenar: string | null;
}

export interface ResumenCruce {
  cruces: Cruce[];
  claros: Cruce[];
  dudas: Cruce[];
  noEncontrados: Cruce[];
  /** Filas de la nómina sin puesto de organigrama: no se aplican nunca. */
  sinPuesto: Cruce[];
  /** Usuarios de la app que no aparecen en la nómina. */
  usuariosFueraDeNomina: any[];
}

/**
 * Cruza la nómina contra la plantilla.
 *
 * @param nomina   filas ya traducidas al organigrama
 * @param usuarios plantilla de la app (activos e inactivos; se filtran los de baja)
 */
export function cruzarNomina(nomina: FilaNomina[], usuarios: any[]): ResumenCruce {
  const activos = (usuarios || []).filter(u => u.activo !== false && u.nombre);

  // Palabras de cada usuario, una sola vez.
  const palabrasUsuario = new Map<any, Set<string>>();
  for (const u of activos) palabrasUsuario.set(u, palabrasDe(u.nombre));

  const cruces: Cruce[] = [];

  for (const fila of nomina) {
    const pn = palabrasDe(fila.nombre);
    const candidatos: Candidato[] = [];
    for (const u of activos) {
      const pu = palabrasUsuario.get(u)!;
      let comunes = 0;
      for (const t of pu) if (pn.has(t)) comunes++;
      if (comunes >= 2) candidatos.push({ usuario: u, comunes });
    }
    candidatos.sort((a, b) => b.comunes - a.comunes);

    let veredicto: Veredicto;
    let elegido: any | null = null;
    if (candidatos.length === 0) {
      veredicto = 'noEncontrado';
    } else if (candidatos.length === 1 || candidatos[0].comunes > candidatos[1].comunes) {
      // Gana con ventaja: un solo candidato, o el mejor comparte más palabras
      // que el segundo. Un empate NO se resuelve solo.
      veredicto = 'claro';
      elegido = candidatos[0].usuario;
    } else {
      veredicto = 'duda';
    }

    cruces.push(armar(fila, veredicto, elegido, candidatos));
  }

  // ── Dos filas de nómina apuntando al MISMO usuario ──────────────────────
  // Pasa con homónimos. Ninguna de las dos se aplica sola: si se aplicaran, la
  // segunda pisaría a la primera y una de las dos personas quedaría con el
  // puesto de la otra.
  const porUsuario = new Map<any, Cruce[]>();
  for (const c of cruces) {
    if (c.veredicto !== 'claro' || !c.elegido) continue;
    porUsuario.set(c.elegido, [...(porUsuario.get(c.elegido) || []), c]);
  }
  for (const [, lista] of porUsuario) {
    if (lista.length < 2) continue;
    for (const c of lista) { c.veredicto = 'duda'; c.elegido = null; }
  }

  const conPuesto = (c: Cruce) => !!c.fila.puestoId;
  const claros = cruces.filter(c => c.veredicto === 'claro' && conPuesto(c));
  const dudas = cruces.filter(c => c.veredicto === 'duda' && conPuesto(c));
  const noEncontrados = cruces.filter(c => c.veredicto === 'noEncontrado' && conPuesto(c));
  const sinPuesto = cruces.filter(c => !conPuesto(c));

  // Quién de la app no salió en la nómina: conserva lo que tenga.
  const usados = new Set(cruces.map(c => c.elegido).filter(Boolean));
  const usuariosFueraDeNomina = activos.filter(u => !usados.has(u));

  return { cruces, claros, dudas, noEncontrados, sinPuesto, usuariosFueraDeNomina };
}

/** Calcula lo que cambiaría para un cruce dado. */
function armar(fila: FilaNomina, veredicto: Veredicto, elegido: any | null, candidatos: Candidato[]): Cruce {
  const c: Cruce = {
    fila, veredicto, elegido, candidatos,
    puestoActual: '', puestoNuevo: '', cambiaPuesto: false,
    tareas: 0, sucursalAllenar: null,
  };
  recalcular(c);
  return c;
}

/**
 * Vuelve a calcular el efecto de un cruce. Se llama también cuando una persona
 * resuelve una duda eligiendo candidato, para que la fila muestre la verdad.
 */
export function recalcular(c: Cruce): void {
  c.puestoNuevo = c.fila.puestoId ? nombrePuesto(c.fila.puestoId) : '';
  c.tareas = c.fila.puestoId ? tareasAutomaticasDePuesto(c.fila.puestoId).length : 0;

  if (!c.elegido) {
    c.puestoActual = '';
    c.cambiaPuesto = false;
    c.sucursalAllenar = null;
    return;
  }

  const actual = resolverPuesto(c.elegido);
  c.puestoActual = actual.puesto ? actual.puesto.nombre : '';
  c.cambiaPuesto = !!actual.puestoId && actual.puestoId !== c.fila.puestoId;

  // La sucursal SOLO se propone cuando la persona no tiene ninguna.
  //
  // Es a propósito: `sucursales` decide qué ve y qué puede tocar cada quien, y
  // el centro de costo de la nómina no es lo mismo que su sucursal operativa
  // (a un vendedor de "RD Padre Hidalgo" la nómina lo cuelga de ahí, pero puede
  // estar operando en otra). Llenar un hueco ayuda; sobrescribir lo que un
  // admin ya capturó le cambiaría los permisos a alguien sin que nadie lo pida.
  const tiene = (c.elegido.sucursales && c.elegido.sucursales.length)
    || !!c.elegido.sucursal;
  c.sucursalAllenar = (!tiene && c.fila.sucursal) ? c.fila.sucursal : null;
}
