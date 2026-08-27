/**
 * Los canales del formato MKTN001, en un solo lugar.
 *
 * Estaban dentro del componente de promociones, pero el seguimiento (los
 * expedientes) tambien necesita la lista para poder elegir en que sucursales
 * aplica la promocion, y dos copias de esto se desincronizan solas.
 */

/** Los 11 canales del formato, tal como estan impresos.
 *  Fijos a proposito: Mayoreo, Ruta Diaria y Ruta Vecinal NO son sucursales del
 *  sistema, y los nombres del papel (PH, ALP, Zam. Centro) no coinciden con los
 *  del catalogo. Amarrarlos a las sucursales solo traeria confusion. */
export const CANALES = [
  'PH', '8 Esquinas', 'ALP', 'Yurécuaro', 'Morelia A.', 'Morelia M.',
  'Canindo', 'Zam. Centro', 'Mayoreo', 'Ruta Diaria', 'Ruta Vecinal'
] as const;

/** Las tres rutas en que se reparten Ruta Diaria y Mayoreo. */
export const RUTAS = ['LP', 'ZAM', 'MOR'] as const;

/** Canales que NO se capturan en un solo renglon, sino por ruta. El valor es el
 *  prefijo con el que se guarda cada ruta en la base (rutaDiariaLP, mayoreoLP...). */
export const CANALES_POR_RUTA: Record<string, string> = {
  'Ruta Diaria': 'rutaDiaria',
  'Mayoreo': 'mayoreo',
};

/**
 * A que sucursal del catalogo pertenece cada canal del formato.
 *
 * Los nombres del papel no son los del sistema (PH, ALP, Zam. Centro), asi que
 * la equivalencia se escribe aqui UNA vez y de aqui la leen el navegador y el
 * servidor. Es lo que decide quien puede subirle evidencia a que expediente:
 * el de Padre Hidalgo sube lo de PH, y nada mas.
 *
 * Los canales que NO aparecen en esta tabla (Mayoreo, Ruta Diaria, Ruta
 * Vecinal) no son de nadie: no son sucursales, son formas de vender. Quedan
 * ABIERTOS a proposito, para que cualquier sucursal les suba evidencia; si se
 * los amarrara a alguien se quedarian sin quien los llene.
 */
export const SUCURSAL_POR_CANAL: Record<string, string> = {
  'PH': 'Padre Hidalgo',
  '8 Esquinas': '8 Esquinas',
  'ALP': 'La Piedad Abastos',
  'Yurécuaro': 'Yurécuaro',
  'Morelia A.': 'Morelia Abastos',
  'Morelia M.': 'Morelia Madero',
  'Canindo': 'Canindo',
  'Zam. Centro': 'Zamora Centro',
};

/** Marca de acceso total, tal como se guarda en `sucursales` del usuario. */
export const ACCESO_TOTAL = 'General (Acceso Total)';

/** Compara nombres de sucursal sin que acentos ni mayusculas estorben. */
function clave(s: string): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/** ¿Este usuario alcanza TODAS las sucursales? (acceso total o ninguna asignada) */
export function alcanzaTodasLasSucursales(sucursales: string[] | null | undefined): boolean {
  const mias = Array.isArray(sucursales) ? sucursales : [];
  if (!mias.length) return true;
  return mias.some(s => clave(s) === clave(ACCESO_TOTAL));
}

/**
 * ¿Este usuario puede subirle evidencia a este canal?
 *
 * Manda `true` si alcanza todas, si el canal no es de ninguna sucursal (las
 * rutas y el mayoreo) o si la sucursal del canal es una de las suyas.
 */
export function puedeEnCanal(canal: string, sucursales: string[] | null | undefined): boolean {
  if (alcanzaTodasLasSucursales(sucursales)) return true;
  const suya = SUCURSAL_POR_CANAL[canal];
  if (!suya) return true;                     // Mayoreo / Ruta Diaria / Ruta Vecinal
  const mias = (sucursales || []).map(clave);
  return mias.includes(clave(suya));
}
