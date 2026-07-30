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

export interface UbicacionSucursal {
  /** Debe coincidir EXACTO con el nombre en areas_operativas y en checklist.store. */
  nombre: string;
  /** Direccion completa, para el popup del mapa. Vacio si aun no se confirma. */
  direccion: string;
  /** Ciudad, para agrupar y para el popup. */
  ciudad: string;
  lat: number | null;
  lng: number | null;
}

/**
 * Catalogo de ubicaciones. El orden es el mismo que el de los catalogos de
 * sucursales que ya usan checklist/areas/estadisticas.
 */
export const UBICACIONES_SUCURSALES: UbicacionSucursal[] = [
  { nombre: 'Canindo',              direccion: '', ciudad: '', lat: null, lng: null },
  { nombre: 'La Piedad Abastos',    direccion: '', ciudad: '', lat: null, lng: null },
  { nombre: '8 Esquinas',           direccion: '', ciudad: '', lat: null, lng: null },
  { nombre: 'Padre Hidalgo',        direccion: '', ciudad: '', lat: null, lng: null },
  { nombre: 'Morelia Madero',       direccion: '', ciudad: '', lat: null, lng: null },
  { nombre: 'Morelia Abastos',      direccion: '', ciudad: '', lat: null, lng: null },
  { nombre: 'Yurécuaro',            direccion: '', ciudad: '', lat: null, lng: null },
  { nombre: 'Zamora Centro',        direccion: '', ciudad: '', lat: null, lng: null },
  { nombre: 'OFICINAS CORPORATIVAS', direccion: '', ciudad: '', lat: null, lng: null },
  { nombre: 'CEDIS',                direccion: '', ciudad: '', lat: null, lng: null }
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
