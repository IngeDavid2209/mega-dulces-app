/**
 * 🏪 QUÉ SUCURSALES PUEDE ELEGIR QUIEN ENTRÓ
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ EXISTE COMO FUNCIÓN Y NO DENTRO DE CADA PANTALLA
 * ═══════════════════════════════════════════════════════════════════════════
 * Porque estaba escrita dos veces —Plantilla y Pase de lista— y el MISMO bug se
 * arregló dos veces sin quedar arreglado. El 13/sep/2026 David reportó el
 * selector de sucursal vacío; se corrigió en una pantalla, y volvió a aparecer
 * en la otra. Dos copias de una regla es una copia que se queda atrás (§2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA REGLA: MANDA LA FICHA, NO LOS DATOS
 * ═══════════════════════════════════════════════════════════════════════════
 * Instrucción de David: «esto lo tienes que sacar de acuerdo al usuario de cada
 * encargado, solo de la sucursal en la que son encargados».
 *
 * Las dos versiones anteriores derivaban la lista de los DATOS —las plazas
 * existentes, luego plazas + fichas— y después la recortaban con lo que la
 * persona tiene permitido. Eso falla exactamente el primer día: **si los datos
 * vienen vacíos, la intersección es vacía** aunque la Encargada tenga su
 * sucursal escrita en su ficha. El selector salía en blanco y, sin sucursal
 * elegida, la pantalla se bloqueaba a sí misma.
 *
 *   · `sucursalesPermitidas()` devuelve UNA LISTA → esa es, tal cual. Su
 *     sucursal aparece exista o no una plaza todavía.
 *   · devuelve NULL (admin global, sin techo declarado) → ahí sí se derivan de
 *     los datos, porque no hay lista propia que usar; así una sucursal nueva
 *     aparece sola en vez de esperar a que alguien la escriba a mano.
 *
 * No se ensancha nada: el recorte sigue saliendo de `sucursalesPermitidas()`,
 * la misma función que usa el resto de la app. Lo que cambia es que ya no se
 * pierde la suya.
 */
import { sucursalesPermitidas } from './permisos.util';

/** Lo mínimo que se necesita de una plaza para sacar su lugar. */
export interface ConLugar { lugar?: string | null; }

function limpiar(lista: any[]): string[] {
  const vistas = new Set<string>();
  for (const s of lista) {
    const n = String(s ?? '').trim();
    if (n) vistas.add(n);
  }
  return [...vistas].sort((a, b) => a.localeCompare(b));
}

/**
 * Las sucursales que esta persona puede elegir en una pantalla de estructura.
 *
 * `plazas` y `usuarios` solo se miran cuando no hay techo declarado; para todos
 * los demás son irrelevantes, y ESO es lo que arregla el bug.
 */
export function sucursalesElegibles(
  usuario: any,
  plazas: ConLugar[] = [],
  usuarios: any[] = [],
): string[] {
  const permitidas = sucursalesPermitidas(usuario);
  if (permitidas) return limpiar(permitidas);

  const de: any[] = [];
  for (const p of plazas || []) de.push(p?.lugar);
  for (const u of usuarios || []) {
    for (const s of (u?.datos?.sucursales || u?.sucursales || [])) de.push(s);
  }
  return limpiar(de);
}
