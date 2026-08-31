/**
 * 🗺️ ZONAS · a qué gerencia pertenece cada sucursal
 *
 * Las zonas no las invento: el propio organigrama las nombra en el comentario
 * de su nivel `'zona'` — «Gerencias de Zona (La Piedad, Morelia, Zamora)».
 * Son tres, y cada una tiene su Gerente.
 *
 * ─── LO QUE NO SE ASIGNÓ, Y POR QUÉ ─────────────────────────────────────────
 * Seis sucursales caen solas por ciudad. Dos NO:
 *
 *   · Padre Hidalgo está en Santa Ana Pacueco, GUANAJUATO. Geográficamente
 *     pega con La Piedad, pero es otro estado y nadie ha dicho de qué gerencia
 *     cuelga. Son 39 personas, la plaza más grande de la empresa.
 *   · Yurécuaro no cae obvio: queda entre La Piedad y Zamora.
 *
 * Podría ponerlas donde "se ve que van" y nadie lo notaría hasta que un Gerente
 * de Zona lea un número que no es el suyo, tome una decisión con él, y el error
 * salga a la luz meses después sin dejar rastro de dónde vino. Así que se
 * quedan en `null` y la pantalla las muestra como "sin zona asignada", que es
 * un pendiente visible en vez de una mentira invisible.
 *
 * El corporativo y el CEDIS no son zona: no cuelgan de una Gerencia de Zona
 * sino de Dirección. Tienen su propio grupo para que no ensucien la
 * comparación entre plazas, que es para lo que sirve este filtro.
 */

export type ClaveZona = 'morelia' | 'zamora' | 'la-piedad' | 'corporativo' | null;

export interface Zona {
  clave: Exclude<ClaveZona, null>;
  nombre: string;
}

export const ZONAS: Zona[] = [
  { clave: 'morelia',     nombre: 'Zona Morelia' },
  { clave: 'zamora',      nombre: 'Zona Zamora' },
  { clave: 'la-piedad',   nombre: 'Zona La Piedad' },
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

  // ── SIN ASIGNAR A PROPÓSITO ───────────────────────────────────────────
  // 'Padre Hidalgo' → Santa Ana Pacueco, Guanajuato. 39 personas.
  // 'Yurécuaro'     → entre La Piedad y Zamora.
  // Ver la cabecera: se quedan fuera hasta que alguien lo confirme.
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

/** Las sucursales de una lista que todavía no tienen zona. */
export function sucursalesSinZona(sucursales: string[]): string[] {
  const out = new Set<string>();
  for (const s of sucursales) {
    const n = (s || '').trim();
    if (n && !POR_SUCURSAL[n]) out.add(n);
  }
  return [...out].sort();
}
