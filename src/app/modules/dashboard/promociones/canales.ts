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
