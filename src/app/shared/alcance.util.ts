/**
 * 🎚️ ALCANCE POR RANGO DEL ORGANIGRAMA — paso 1: se calcula, NO se aplica
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ESTE ARCHIVO TODAVÍA NO CAMBIA LO QUE VE NADIE
 * ═══════════════════════════════════════════════════════════════════════════
 * Hoy el alcance sale de banderas: `rol`, `alcance`, `sucursales[]` y 34
 * `puedeXxx`. Eso funciona pero no dice nada de la estructura: un Gerente de
 * Zona ve su zona porque alguien le puso las sucursales a mano en su ficha, no
 * porque su puesto esté arriba de ellas. El día que abren una sucursal, hay que
 * acordarse de editar fichas.
 *
 * La regla que se quiere es la del modelo: **el alcance se deriva del rango en
 * el organigrama**. Y el rango YA EXISTE — `nivel` en cada uno de los 89
 * puestos: direccion · gerencia · jefatura · coordinacion · supervision ·
 * operativo · practicante.
 *
 * Pero cambiar quién ve qué para 186 personas de un golpe es exactamente cómo
 * se deja a una zona entera sin menú un lunes a las siete de la mañana. Así que
 * este paso solo CALCULA el alcance propuesto, en paralelo al de las banderas,
 * para poder comparar los dos y decidir con la tabla enfrente.
 *
 * `scripts/prueba-alcance-por-nivel.js` imprime esa comparación. Nada de este
 * archivo está enganchado a un guard, a un menú ni a una consulta.
 */

import { NivelPuesto, puestoPorId } from './organigrama.catalogo';
import { resolverPuesto } from './puesto.util';
import { esAdmin, esAdminGlobal, esSupervisor, sucursalesPermitidas } from './permisos.util';

/**
 * Qué tanto ve alguien. Es una escala ordenada a propósito: comparar dos
 * alcances es comparar dos números, y eso hace trivial detectar una escalada
 * -alguien que pasa a ver MÁS- que es el único cambio verdaderamente peligroso.
 */
export type Amplitud =
  | 'empresa'    // todas las unidades
  | 'unidad'     // su bloque del organigrama (CEDIS, Administración…)
  | 'zona'       // su gerencia de zona y las sucursales que cuelgan
  | 'sucursal'   // su tienda
  | 'propio'     // solo lo suyo
  | 'ninguno';   // sin puesto: no se le adivina alcance

/** Orden de amplitud, de más a menos. Sirve para detectar escaladas. */
export const ORDEN_AMPLITUD: Amplitud[] = [
  'empresa', 'unidad', 'zona', 'sucursal', 'propio', 'ninguno',
];

export function indiceAmplitud(a: Amplitud): number {
  const i = ORDEN_AMPLITUD.indexOf(a);
  return i === -1 ? ORDEN_AMPLITUD.length : i;
}

/** ¿`a` ve MÁS que `b`? Es la pregunta que importa en una revisión. */
export function veMasQue(a: Amplitud, b: Amplitud): boolean {
  return indiceAmplitud(a) < indiceAmplitud(b);
}

/**
 * El rango de una persona, leído de su puesto en el organigrama.
 *
 * Devuelve null cuando el puesto no se puede resolver. NO se le asigna un nivel
 * por parecido de cargo: un rango inventado le da a alguien visibilidad que no
 * le toca, y eso es peor que no darle ninguna (§8.5). Quien caiga en null se
 * queda con el alcance de sus banderas, que es el de hoy.
 */
export function nivelDePersona(usuario: any): NivelPuesto | null {
  const r = resolverPuesto(usuario);
  if (!r.puestoId) return null;
  const p = puestoPorId(r.puestoId);
  return p ? p.nivel : null;
}

/**
 * El alcance que le tocaría por rango.
 *
 * ─── POR QUÉ ESTE MAPEO Y NO OTRO ─────────────────────────────────────────
 * · direccion  → la empresa. Es el único nivel que necesita el agregado de las
 *                diez unidades.
 * · gerencia   → su zona. Un Gerente de Zona responde por las sucursales que
 *                cuelgan de él, no por CEDIS ni por Sistemas.
 * · jefatura   → su unidad. Un Jefe de CEDIS responde por CEDIS completo, y no
 *                por las tiendas.
 * · coordinacion → su sucursal. Encargado(a) de Sucursal es `coordinacion`, y
 *                es quien verifica la muestra de su tienda.
 * · supervision → su zona ACOTADA a su función. Un Supervisor de Ventas Ruta
 *                Directa cubre varias tiendas pero solo su ruta; el modelo lo
 *                resolverá con el ámbito. Hoy se le da 'zona' y se marca como
 *                el caso que más hay que revisar contigo.
 * · operativo / practicante → lo suyo.
 *
 * `nivel === null` devuelve 'ninguno': sin puesto no se deriva alcance. Esa
 * persona conserva lo que le dan sus banderas hoy.
 */
export function alcanceDeNivel(nivel: NivelPuesto | null): Amplitud {
  switch (nivel) {
    case 'direccion':    return 'empresa';
    case 'gerencia':     return 'zona';
    case 'jefatura':     return 'unidad';
    case 'coordinacion': return 'sucursal';
    case 'supervision':  return 'zona';
    case 'operativo':    return 'propio';
    case 'practicante':  return 'propio';
    default:             return 'ninguno';
  }
}

/** El alcance propuesto para una persona, derivado de su rango. */
export function alcancePropuesto(usuario: any): Amplitud {
  return alcanceDeNivel(nivelDePersona(usuario));
}

/**
 * El alcance que la persona tiene HOY, traducido a la misma escala, para poder
 * compararlo con el propuesto.
 *
 * No es una reimplementación: llama a `esAdminGlobal` y `sucursalesPermitidas`,
 * que son las funciones que la app usa de verdad. Si se reescribiera la regla
 * aquí, la comparación mediría dos inventos en vez de medir el cambio.
 */
export function alcanceActual(usuario: any): Amplitud {
  if (!usuario) return 'ninguno';
  if (esAdminGlobal(usuario)) return 'empresa';
  const suc = sucursalesPermitidas(usuario);
  if (suc === null) return 'empresa';        // 'General (Acceso Total)'

  // ⚠️ TENER UNA SUCURSAL ASIGNADA NO ES VER LA SUCURSAL, y esta línea faltaba.
  //
  // La primera versión traducía `sucursales: ['8 Esquinas']` como alcance
  // 'sucursal' para cualquiera. Pero la carga de datos hace otra cosa
  // (`home.ts`, la rama `esTrabajadorPuro`): un trabajador SIN banderas de
  // supervisión ve solo lo asignado a su nombre, no lo de su tienda. Su
  // sucursal sirve para saber DÓNDE trabaja, no cuánto ve.
  //
  // Sin esta corrección la tabla comparativa inventaba una diferencia -el
  // Anaquelista "perdiendo" su sucursal- que no existe, porque nunca la tuvo.
  // Es la regla de medir la entrada que de verdad se usa, no un proxy de ella.
  if (!esAdmin(usuario) && !esSupervisor(usuario)) return 'propio';

  if (suc.length === 0) return 'propio';
  if (suc.length === 1) return 'sucursal';
  return 'zona';                              // varias tiendas ≈ alcance de zona
}

/** Qué pasaría con esta persona si el alcance saliera del rango. */
export interface Diferencia {
  actual: Amplitud;
  propuesto: Amplitud;
  /** 'igual' | 'gana' (ve más) | 'pierde' (ve menos) */
  efecto: 'igual' | 'gana' | 'pierde';
  nivel: NivelPuesto | null;
}

export function compararAlcance(usuario: any): Diferencia {
  const actual = alcanceActual(usuario);
  const propuesto = alcancePropuesto(usuario);
  let efecto: Diferencia['efecto'] = 'igual';
  if (veMasQue(propuesto, actual)) efecto = 'gana';
  else if (veMasQue(actual, propuesto)) efecto = 'pierde';
  return { actual, propuesto, efecto, nivel: nivelDePersona(usuario) };
}
