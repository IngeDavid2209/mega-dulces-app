/**
 * Ubicaciones REALES de las sucursales, para el mapa del Centro de Mando.
 *
 * REGLA IMPORTANTE: aqui NO se inventan coordenadas. Una sucursal sin
 * direccion confirmada se queda con lat/lng en null y el mapa simplemente no
 * la pinta (aparece en la lista de "pendientes de ubicar"). Un pin en el lugar
 * equivocado es peor que no tener pin: el director lo lee como un dato real.
 *
 * Para dar de alta una sucursal: pon su direccion tal como esta en la
 * escritura o el recibo de luz, y sus coordenadas exactas. La forma mas
 * confiable de sacarlas es abrir Google Maps, click derecho sobre el local y
 * copiar el par de numeros que aparece arriba (primero latitud, luego
 * longitud).
 *
 * Latitud y longitud en grados decimales. Michoacan cae alrededor de
 * lat 19-20 y lng -100 a -102 (longitud NEGATIVA por estar al oeste de
 * Greenwich); si un valor sale de ese rango, casi siempre es que se
 * invirtieron los dos numeros.
 */

/**
 * Que tan fino es el pin. Se muestra en el popup del mapa: nadie debe leer un
 * pin aproximado como si alguien hubiera ido a pararse en la puerta.
 *   exacta    = el geocodificador encontro el numero de la casa
 *   calle     = cayo en la calle correcta de la ciudad correcta (puede estar a
 *               una cuadra o dos del local)
 *   localidad = solo el centro de la colonia o del pueblo
 *   pendiente = sin coordenadas; no se pinta
 */
export type PrecisionUbicacion = 'exacta' | 'calle' | 'localidad' | 'pendiente';

export interface UbicacionSucursal {
  /** Debe coincidir EXACTO con el nombre en areas_operativas y en checklist.store. */
  nombre: string;
  /** Direccion completa, para el popup del mapa. Vacio si aun no se confirma. */
  direccion: string;
  /** Ciudad, para agrupar y para el popup. */
  ciudad: string;
  lat: number | null;
  lng: number | null;
  precision: PrecisionUbicacion;
}

/**
 * Catalogo de ubicaciones. El orden es el mismo que el de los catalogos de
 * sucursales que ya usan checklist/areas/estadisticas.
 *
 * Direcciones: las dio David el 2026-07-30.
 * Coordenadas: geocodificadas con Nominatim (OpenStreetMap) el 2026-07-30. Tres
 * direcciones NO se pudieron resolver de forma confiable y quedan en pendiente:
 * el geocodificador devolvia otra ciudad o candidatos a kilometros de distancia.
 * Para completarlas: Google Maps, click derecho sobre el local, copiar el par de
 * numeros, pegarlo aqui y cambiar precision a 'exacta'.
 *
 * OJO con el amarre nombre-direccion: cuatro se confirmaron por el propio texto
 * de la direccion (Padre Hidalgo, Abastos de La Piedad, Canindo y Madero). Las
 * otras cuatro las deduje y estan marcadas abajo; David tiene que confirmarlas.
 */
export const UBICACIONES_SUCURSALES: UbicacionSucursal[] = [
  {
    nombre: 'Canindo',
    direccion: 'Block P Bodega 6, Canindo, 59757 Zamora de Hidalgo, Mich.',
    ciudad: 'Zamora de Hidalgo',
    lat: 19.940424, lng: -102.243942, precision: 'localidad'
  },
  {
    // PENDIENTE de coordenadas: el geocodificador mandaba esta calle a San Luis Potosi.
    nombre: 'La Piedad Abastos',
    direccion: 'Abastos, Av. Mariano Jiménez 1582, Peña, 59389 La Piedad de Cabadas, Mich.',
    ciudad: 'La Piedad de Cabadas',
    lat: null, lng: null, precision: 'pendiente'
  },
  {
    // DEDUCIDA: la unica direccion del centro de La Piedad. Confirmar con David.
    nombre: '8 Esquinas',
    direccion: 'Pino Suárez 259, Centro, 59300 La Piedad de Cabadas, Mich.',
    ciudad: 'La Piedad de Cabadas',
    lat: 20.343058, lng: -102.024619, precision: 'calle'
  },
  {
    nombre: 'Padre Hidalgo',
    direccion: 'Av Padre Hidalgo 322, Sta Ana Pacueco, 36910 Santa Ana Pacueco, Gto.',
    ciudad: 'Santa Ana Pacueco',
    lat: 20.346363, lng: -102.018444, precision: 'exacta'
  },
  {
    // PENDIENTE: Madero Poniente es larguisima; los candidatos quedaban a 13 km
    // uno del otro y ninguno en el CP 58189 de la colonia Vicente Guerrero.
    nombre: 'Morelia Madero',
    direccion: 'Av Francisco I. Madero Pte 3600, Vicente Guerrero, 58189 Morelia, Mich.',
    ciudad: 'Morelia',
    lat: null, lng: null, precision: 'pendiente'
  },
  {
    // DEDUCIDA por eliminacion (la otra direccion de Morelia es la de Madero).
    nombre: 'Morelia Abastos',
    direccion: 'Soledad Gutiérrez de Figaredo 510, 58218 Morelia, Mich.',
    ciudad: 'Morelia',
    lat: 19.716158, lng: -101.162958, precision: 'calle'
  },
  {
    // DEDUCIDA por el CP 59250. PENDIENTE de coordenadas: la calle "Miguel
    // Hidalgo" de Yurecuaro aparecia a 6 km del centro del pueblo.
    nombre: 'Yurécuaro',
    direccion: 'Sr. Cura Don Miguel Hidalgo 22, Centro, 59250 Centro, Mich.',
    ciudad: 'Yurécuaro',
    lat: null, lng: null, precision: 'pendiente'
  },
  {
    // DEDUCIDA: es la direccion de Zamora que no es la bodega de Canindo.
    nombre: 'Zamora Centro',
    direccion: 'C. Dámaso Cárdenas 7, Jardines de Catedral, 59670 Zamora de Hidalgo, Mich.',
    ciudad: 'Zamora de Hidalgo',
    lat: 19.977305, lng: -102.286743, precision: 'calle'
  },
  {
    nombre: 'OFICINAS CORPORATIVAS',
    direccion: '', ciudad: '', lat: null, lng: null, precision: 'pendiente'
  },
  {
    nombre: 'CEDIS',
    direccion: '', ciudad: '', lat: null, lng: null, precision: 'pendiente'
  }
];

/**
 * Sucursales comerciales (tiendas al publico). Se usa para el filtro
 * "Sucursales" del panel de rendimiento, que deja fuera areas
 * administrativas como CONTABILIDAD o SISTEMAS. Mismo catalogo que ya viven
 * en checklist/areas/estadisticas.
 */
export const SUCURSALES_COMERCIALES: string[] = [
  'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
  'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro'
];

/** Normaliza para comparar nombres sin pelearse por acentos ni mayusculas. */
function clave(nombre: string): string {
  return (nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

const PORINDICE = new Map<string, UbicacionSucursal>(
  UBICACIONES_SUCURSALES.map(u => [clave(u.nombre), u])
);

const COMERCIALES = new Set(SUCURSALES_COMERCIALES.map(clave));

/** ¿Es una sucursal comercial (tienda) y no un area administrativa? */
export function esSucursalComercial(nombre: string): boolean {
  return COMERCIALES.has(clave(nombre));
}

/** Devuelve la ubicacion de una sucursal, o undefined si no esta en el catalogo. */
export function ubicacionDe(nombre: string): UbicacionSucursal | undefined {
  return PORINDICE.get(clave(nombre));
}

/** ¿Esta sucursal ya tiene coordenadas usables? */
export function tieneCoordenadas(u?: UbicacionSucursal | null): boolean {
  if (!u) return false;
  return typeof u.lat === 'number' && typeof u.lng === 'number' &&
         Number.isFinite(u.lat) && Number.isFinite(u.lng);
}

/** Sucursales del catalogo que todavia no tienen coordenadas confirmadas. */
export function sucursalesSinUbicar(): string[] {
  return UBICACIONES_SUCURSALES.filter(u => !tieneCoordenadas(u)).map(u => u.nombre);
}

/** ¿Hay al menos una sucursal ubicada? Si no, el mapa no tiene nada que pintar. */
export function hayAlgunaUbicacion(): boolean {
  return UBICACIONES_SUCURSALES.some(u => tieneCoordenadas(u));
}
