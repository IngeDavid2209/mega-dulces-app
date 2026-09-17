import { normalizarNombre } from './permisos.util';

/**
 * ══════════ CÓMO SE ORDENA LA LISTA DE ENTREGAS ══════════
 *
 * Instrucción de David (17/sep/2026): «el agrupador de los usuarios para que
 * los tengas por sucursal». Hasta hoy el único agrupador era POR PERSONA
 * (`agruparPorPersona`, checklist.ts) y la sucursal solo viajaba DENTRO de
 * cada tarjeta, así que no había forma de ver «La Piedad Abastos» como bloque
 * en ninguna de las cuatro bandejas.
 *
 * El árbol del organigrama NO se toca: es otra pregunta —cómo va el mismo
 * puesto entre sucursales— y sigue siendo la vista de «Pendientes del equipo»
 * para quien supervisa. Esto es la lista, que es donde David estaba.
 *
 * ⚠ LA SUCURSAL SALE DE `store`, QUE ES TEXTO LIBRE (hallazgo 1 del
 * proyecto). Dos capturas que difieran por un espacio o una tilde serían dos
 * bloques distintos con el mismo nombre en pantalla, y eso se lee como que la
 * app duplicó la sucursal. Por eso la CLAVE de agrupación va normalizada
 * —misma función con la que la app cruza identidades— y lo que se PINTA es el
 * texto original de la primera entrega del grupo: agrupar bien sin reescribir
 * el dato de nadie. Esto no arregla el hallazgo 1; lo contiene mientras la
 * unidad no exista como dato (Fase 3).
 */

export type ModoAgrupacion = 'sucursal' | 'persona' | 'plana';

/** Clave interna del grupo de las entregas sin sucursal capturada. */
export const CLAVE_SIN_SUCURSAL = '__sin_sucursal__';
export const ETIQUETA_SIN_SUCURSAL = 'Sin sucursal';

export interface GrupoPersona {
  clave: string;
  nombre: string;
  nivel: 'mando' | 'operativo';
  entregas: any[];
}

export interface GrupoSucursal {
  clave: string;
  sucursal: string;
  personas: GrupoPersona[];
  total: number;
}

/**
 * Agrupa las entregas ya filtradas.
 *
 * - `'sucursal'` → sucursal → persona → tareas (lo que pidió David).
 * - `'persona'`  → un solo bloque sin sucursal, con las personas dentro.
 * - `'plana'`    → un solo bloque con una sola "persona" vacía: la lista de
 *                  siempre. Se devuelve con la misma forma para que la
 *                  plantilla no tenga tres caminos distintos que mantener.
 *
 * `nivelDe` lo inyecta el componente (ya tiene su Map cacheado): así los
 * mandos salen primero, igual que en la lista de hoy, sin que este archivo
 * tenga que saber nada del organigrama.
 */
export function agruparEntregas(
  lista: any[],
  modo: ModoAgrupacion,
  nivelDe: (nombre: string) => 'mando' | 'operativo' = () => 'operativo'
): GrupoSucursal[] {

  if (modo === 'plana') {
    return lista.length
      ? [{ clave: '__plana__', sucursal: '', total: lista.length,
           personas: [{ clave: '__plana__', nombre: '', nivel: 'operativo', entregas: lista }] }]
      : [];
  }

  const porSucursal = new Map<string, GrupoSucursal>();

  for (const c of lista) {
    // El grupo de los que NO tienen sucursal capturada es un grupo PROPIO y
    // visible, nunca un descarte: «no tiene sucursal» y «no existe» se ven
    // idénticos si se esconde, y ahí es donde se pierde gente (§5.2).
    const textoSuc = (c?.store || '').trim();
    const claveSuc = modo === 'sucursal'
      ? (normalizarNombre(textoSuc) || CLAVE_SIN_SUCURSAL)
      : '__todas__';

    let gs = porSucursal.get(claveSuc);
    if (!gs) {
      gs = {
        clave: claveSuc,
        sucursal: modo === 'sucursal'
          ? (textoSuc || ETIQUETA_SIN_SUCURSAL)
          : '',
        personas: [], total: 0
      };
      porSucursal.set(claveSuc, gs);
    }

    const nombre = (c?.assigned || '').trim() || 'Sin asignar';
    const clavePer = normalizarNombre(nombre) || 'sin asignar';
    let gp = gs.personas.find(p => p.clave === clavePer);
    if (!gp) {
      gp = { clave: clavePer, nombre, nivel: nivelDe(nombre), entregas: [] };
      gs.personas.push(gp);
    }
    gp.entregas.push(c);
    gs.total++;
  }

  // Orden ESTABLE, y no es adorno: sin él, dos renders del mismo dato pueden
  // pintar los bloques en distinto orden y la pantalla parece moverse sola.
  // Es la lección del `order by` que le faltaba a la siembra de plazas (9/sep).
  const grupos = [...porSucursal.values()];
  for (const g of grupos) {
    g.personas.sort((a, b) =>
      a.nivel === b.nivel ? a.clave.localeCompare(b.clave) : (a.nivel === 'mando' ? -1 : 1)
    );
  }
  grupos.sort((a, b) => {
    // «Sin sucursal» siempre al final: es el pendiente, no el encabezado con
    // el que se empieza a leer.
    if (a.clave === CLAVE_SIN_SUCURSAL) return 1;
    if (b.clave === CLAVE_SIN_SUCURSAL) return -1;
    return a.clave.localeCompare(b.clave);
  });
  return grupos;
}

/**
 * ¿Vale la pena pintar el encabezado de sucursal?
 *
 * Con un solo grupo el encabezado dice siempre lo mismo y es ruido —el caso
 * de «Mis tareas», donde hay una persona y casi siempre una sucursal—. La
 * excepción es que ese único grupo sea el de las que NO tienen sucursal: eso
 * sí hay que decirlo, porque es un dato que falta y callarlo lo vuelve
 * invisible.
 */
export function mostrarEncabezadoSucursal(grupos: GrupoSucursal[]): boolean {
  if (grupos.length > 1) return true;
  return grupos.length === 1 && grupos[0].clave === CLAVE_SIN_SUCURSAL;
}

/** ¿Vale la pena pintar el encabezado de persona? Misma regla, un nivel abajo. */
export function mostrarEncabezadoPersona(grupo: GrupoSucursal): boolean {
  return grupo.personas.length > 1 || (grupo.personas[0]?.nombre || '') !== '';
}
