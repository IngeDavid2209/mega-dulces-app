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
import { clasificarDestino } from './unidad-servida.util';

/** Lo mínimo que se necesita de una plaza para sacar su lugar. */
export interface ConLugar { lugar?: string | null; }

/** Se nombra UNA vez, con su razón. Ver `tieneCuadrilla`. */
const CEDIS = 'CEDIS';

/**
 * ¿Este lugar tiene cuadrilla a la que pasar lista?
 *
 * Decisión de David (13/sep/2026) sobre la captura del selector: «en el pase de
 * lista, quítale esas dos» —MANTENIMIENTO y SISTEMAS—, y la regla que eligió al
 * plantearla: sucursales y CEDIS sí; las áreas administrativas no.
 *
 * ─── POR QUÉ NO ES UNA LISTA DE NOMBRES ───────────────────────────────────
 * Porque el §4 lo prohíbe: una lista local se queda atrás el día que abra una
 * sucursal o se cree un área. Se apoya en `clasificarDestino()`, que ya es la
 * única fuente — el mismo mapa de `zonas.util.ts` que usa el resto de la app.
 *
 * ─── LA EXCEPCIÓN DE CEDIS, Y POR QUÉ SE NOMBRA ───────────────────────────
 * En el mapa de zonas CEDIS está como `corporativo`, igual que RH o FINANZAS.
 * Pero no se parece en nada a ellas: tiene CUADRILLA OPERATIVA —16 personas,
 * seis choferes en el censo del 9/sep— y su gente ficha turnos. Filtrar por
 * tipo a secas la habría dejado sin pase de lista.
 *
 * Es un nombre a mano, y por eso lleva su motivo escrito: el día que el mapa
 * distinga «corporativo operativo» de «corporativo administrativo», esta
 * excepción sobra y se borra.
 *
 * (Nota: el CLAUDE.md deja registrado que `Canindo` y `CEDIS` pueden ser el
 * mismo sitio con dos nombres. Mientras eso no se resuelva, los dos aparecen —
 * que es lo correcto: esconder uno decidiría por adelantado cuál sobra.)
 */
export function tieneCuadrilla(lugar: string): boolean {
  const d = clasificarDestino(lugar);
  if (d.tipo === 'sucursal') return true;
  return String(lugar || '').trim().toUpperCase() === CEDIS;
}

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
  // El filtro va en los DOS caminos, no solo en el del admin: si la ficha de
  // alguien trae «MANTENIMIENTO» en `sucursales` —y las hay—, tampoco debe
  // salirle a esa persona como sitio donde pasar lista.
  if (permitidas) return limpiar(permitidas).filter(tieneCuadrilla);

  const de: any[] = [];
  for (const p of plazas || []) de.push(p?.lugar);
  for (const u of usuarios || []) {
    for (const s of (u?.datos?.sucursales || u?.sucursales || [])) de.push(s);
  }
  return limpiar(de).filter(tieneCuadrilla);
}
