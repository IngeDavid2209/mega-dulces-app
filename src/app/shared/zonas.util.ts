/**
 * 🗺️ ZONAS · a qué gerencia pertenece cada sucursal
 *
 * Son CINCO: Morelia, Zamora, La Piedad, Padre Hidalgo y Yurécuaro.
 *
 * ─── OJO: EL ORGANIGRAMA DICE TRES, Y ESTÁ INCOMPLETO ───────────────────────
 * El comentario de su nivel `'zona'` dice «Gerencias de Zona (La Piedad,
 * Morelia, Zamora)», y de ahí salió la primera versión de este archivo. David
 * corrigió el 2026-08-31: Padre Hidalgo y Yurécuaro también son zonas, no
 * sucursales que cuelguen de otra.
 *
 * Tiene sentido visto de cerca — Padre Hidalgo son 39 personas, más grande que
 * varias zonas completas— pero no se podía deducir del documento. Queda anotado
 * aquí para que el siguiente que lo lea no repita el error: ese comentario del
 * organigrama hay que actualizarlo.
 *
 * Y vale la pena decir cómo se resolvió: la primera versión dejó esas dos
 * plazas SIN zona en vez de ponerlas donde "se veía que iban". Si las hubiera
 * metido en La Piedad por cercanía geográfica, hoy su Gerente estaría leyendo
 * números de gente que no es suya, y nadie lo habría notado. El pendiente
 * visible es lo que hizo que David lo corrigiera en un mensaje.
 *
 * El corporativo y el CEDIS no son zona: no cuelgan de una Gerencia de Zona
 * sino de Dirección. Tienen su propio grupo para que no ensucien la
 * comparación entre plazas, que es para lo que sirve este filtro.
 */

export type ClaveZona =
  | 'morelia' | 'zamora' | 'la-piedad' | 'padre-hidalgo' | 'yurecuaro'
  | 'corporativo' | null;

export interface Zona {
  clave: Exclude<ClaveZona, null>;
  nombre: string;
}

export const ZONAS: Zona[] = [
  { clave: 'morelia',     nombre: 'Zona Morelia' },
  { clave: 'zamora',      nombre: 'Zona Zamora' },
  { clave: 'la-piedad',   nombre: 'Zona La Piedad' },
  { clave: 'padre-hidalgo', nombre: 'Zona Padre Hidalgo' },
  { clave: 'yurecuaro',   nombre: 'Zona Yurécuaro' },
  { clave: 'corporativo', nombre: 'Corporativo y CEDIS' },
];

/** Sucursal de MDTask → zona. Ausente = todavía no se le asignó ninguna. */
const POR_SUCURSAL: Record<string, Exclude<ClaveZona, null>> = {
  // ── Por ciudad, sin ambigüedad ─────────────────────────────────────────
  'Morelia Madero':    'morelia',
  'Morelia Abastos':   'morelia',
  'Canindo':           'zamora',
  'Zamora Centro':     'zamora',
  'La Piedad Abastos': 'la-piedad',
  '8 Esquinas':        'la-piedad',

  // ── Zonas de una sola plaza (David, 2026-08-31) ───────────────────────
  'Padre Hidalgo':     'padre-hidalgo',
  'Yurécuaro':         'yurecuaro',

  // ── No cuelgan de una Gerencia de Zona, sino de Dirección ─────────────
  'CEDIS':                 'corporativo',
  'OFICINAS CORPORATIVAS': 'corporativo',
  'General (Acceso Total)': 'corporativo',
  'RH':            'corporativo',
  'FINANZAS':      'corporativo',
  'CONTABILIDAD':  'corporativo',
  'SISTEMAS':      'corporativo',
  'COMPRAS':       'corporativo',
  'MKT':           'corporativo',
  'MANTENIMIENTO': 'corporativo',
};

/** La zona de una sucursal, o null si nadie se la ha asignado. */
export function zonaDeSucursal(sucursal: string): ClaveZona {
  return POR_SUCURSAL[(sucursal || '').trim()] || null;
}

/** Nombre para mostrar. */
export function nombreZona(z: ClaveZona): string {
  if (!z) return 'Sin zona asignada';
  return ZONAS.find(x => x.clave === z)?.nombre || 'Sin zona asignada';
}

/**
 * Todas las sucursales de una zona.
 *
 * Se DERIVA del mismo `POR_SUCURSAL` de arriba, invirtiéndolo. Escribir aparte
 * una lista «las de La Piedad son 8 Esquinas y La Piedad Abastos» sería la lista
 * local que el §4 prohíbe: el día que se abra una sucursal habría que acordarse
 * de tocar dos sitios, y el que se olvide deja a una Gerente sin ver su tienda
 * nueva —en silencio, que es el modo de fallo que más cuesta encontrar—.
 *
 * `null` devuelve vacío a propósito: «no sé de qué zona es» no puede querer
 * decir «de todas» (§5.2).
 */
export function sucursalesDeZona(z: ClaveZona): string[] {
  if (!z) return [];
  return Object.keys(POR_SUCURSAL).filter(s => POR_SUCURSAL[s] === z).sort();
}

/** Las sucursales de una lista que todavía no tienen zona. */
export function sucursalesSinZona(sucursales: string[]): string[] {
  const out = new Set<string>();
  for (const s of sucursales) {
    const n = (s || '').trim();
    if (n && !POR_SUCURSAL[n]) out.add(n);
  }
  return [...out].sort();
}
