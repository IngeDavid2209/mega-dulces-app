/**
 * 🧭 QUÉ ES CADA `store`, Y A QUIÉN SE LE CUENTA LO QUE PASA AHÍ
 *
 * El eje transversal del modelo separa dos cosas que hoy viven en un solo campo
 * de texto:
 *
 *   · UNIDAD RESPONSABLE  — a quién se le cuenta. Sale del PUESTO (su `unidad`
 *                            en el organigrama). Nunca del lugar.
 *   · UNIDAD SERVIDA      — dónde aterriza el trabajo. Es el `store`.
 *
 * ─── POR QUÉ NO SE PUEDE DEDUCIR UNA DE LA OTRA ────────────────────────────
 * Medido el 4/sep/2026 cruzando las 189 filas de `nomina-puestos.ts` (184 con
 * puesto, 0 fuera del organigrama) contra la `unidad` de cada puesto:
 *
 *   Padre Hidalgo     38 personas → ventas:15  sucursal:13  operaciones-zona:6
 *                                    staff-zona:2  comercial-marketing:2
 *   Morelia Abastos   35 personas → sucursal:18 operaciones-zona:9  staff-zona:3 ...
 *   COMPRAS            3 personas → comercial-marketing:3   (NO administrativa)
 *
 * 8 de 16 stores mezclan unidades, y al revés la unidad `sucursal` aparece en 8
 * stores distintos. **Ninguno determina al otro.** Son dos ejes ortogonales:
 * lugar × departamento. Por eso esto no es un mapa `store → departamento`: ese
 * mapa no existe, y escribirlo a mano habría fallado en 2 de 9 áreas —yo iba a
 * poner COMPRAS en «administrativa» y su gente es de Comercial y Marketing—.
 * Es §8.5 en un caso concreto: el departamento NO se deduce del nombre del área.
 *
 * ─── DE DÓNDE SALE LA CLASIFICACIÓN, PARA NO INVENTAR UNA LISTA ────────────
 * De `zonas.util.ts`, que ya es la única fuente de "qué sucursales existen y de
 * qué zona son". No se copia aquí ninguna lista (§4 del contexto: nunca listas
 * locales copiadas). Un `store` que no esté en ese mapa sale como DESCONOCIDO y
 * se ve; no se acomoda por parecido.
 *
 * La única constante propia es `MANTENIMIENTO`, y no es un criterio mío: el
 * esquema lo declara literal en `scripts/sql/009_checklists.sql:11`
 * («sucursal; valor especial 'MANTENIMIENTO'») y `checklist.ts:456` lo usa como
 * canal de órdenes de trabajo. No es un lugar, y pintarlo como sucursal es lo
 * que hizo que el mismo colaborador se leyera como si estuviera en tres plazas.
 */

import { ClaveZona, zonaDeSucursal, nombreZona } from './zonas.util';
import { UnidadOrganigrama, ETIQUETAS_UNIDAD } from './organigrama.catalogo';

/**
 * Qué clase de cosa es un `store`.
 *
 * `corporativo` junta oficinas, CEDIS y las áreas administrativas porque eso es
 * exactamente lo que hoy se puede afirmar: `zonas.util.ts` los mete a todos en
 * la zona 'corporativo'. Partirlo en "área" contra "centro de trabajo" pide un
 * dato que todavía no existe, y afirmarlo aquí sería inventarlo.
 */
export type TipoDestino = 'sucursal' | 'corporativo' | 'canal' | 'desconocido';

export interface DestinoServido {
  /** El `store` tal cual, sin normalizar: es la llave con la que se agrupa. */
  nombre: string;
  tipo: TipoDestino;
  /** Solo cuando `tipo === 'sucursal'`. */
  zona: ClaveZona;
  /** Para la pastilla: corta y sin el nombre del lugar, que ya va al lado. */
  etiqueta: string;
  /** Para el `title`: la frase completa. */
  detalle: string;
}

/** El único `store` que el esquema declara como valor especial. */
export const CANAL_MANTENIMIENTO = 'MANTENIMIENTO';

/** Qué es este `store`. Nunca lanza; lo que no reconoce lo dice. */
export function clasificarDestino(store: string | null | undefined): DestinoServido {
  const nombre = (store || '').trim();

  if (!nombre) {
    return {
      nombre: 'Sin lugar', tipo: 'desconocido', zona: null,
      etiqueta: 'sin lugar',
      detalle: 'La entrega no trae lugar. No se le puede asignar unidad servida.',
    };
  }

  if (nombre.toUpperCase() === CANAL_MANTENIMIENTO) {
    return {
      nombre, tipo: 'canal', zona: null,
      etiqueta: 'canal',
      detalle: 'Canal de órdenes de mantenimiento. No es un lugar: es la vía por la que se ' +
               'levanta el trabajo, y lo que aterriza aquí se atiende para otra unidad.',
    };
  }

  const zona = zonaDeSucursal(nombre);

  if (!zona) {
    return {
      nombre, tipo: 'desconocido', zona: null,
      etiqueta: 'sin zona',
      detalle: 'Este lugar no está en el mapa de zonas. Queda pendiente y visible a propósito: ' +
               'acomodarlo por parecido le daría a una Gerencia números que no son suyos.',
    };
  }

  if (zona === 'corporativo') {
    return {
      nombre, tipo: 'corporativo', zona,
      etiqueta: 'corporativo',
      detalle: 'Corporativo y CEDIS: no cuelga de una Gerencia de Zona sino de Dirección.',
    };
  }

  return {
    nombre, tipo: 'sucursal', zona,
    etiqueta: nombreZona(zona).replace(/^Zona /, ''),
    detalle: 'Sucursal · ' + nombreZona(zona),
  };
}

/**
 * ¿Lo que pasa en este lugar se le cuenta a OTRA unidad que a la del lugar?
 *
 * La regla del modelo es que la unidad responsable siempre sale del PUESTO. El
 * caso que aquí se puede afirmar con lo que hay es uno solo, y es el que más
 * pesa: una SUCURSAL hospedando trabajo de un puesto que no es de sucursal.
 *
 * Los 15 vendedores de Padre Hidalgo son eso: hoy sus puntos se suman al número
 * de "Padre Hidalgo", o sea al de la Encargada, cuando la unidad responsable es
 * Ventas. Rojo de Ventas, espera visible de la sucursal.
 *
 * LO QUE NO SE AFIRMA, A PROPÓSITO: si un puesto de sucursal aparece en un store
 * corporativo, o si un `administrativa` aparece en FINANZAS, no se dice nada.
 * Para eso haría falta saber cuál es el "hogar natural" de cada unidad, y eso es
 * justo el dato que la medición dice que NO existe todavía (8 de 16 stores
 * mezclan). Marcar de más aquí sería inventar la mitad del modelo.
 */
export function esAtribucionCruzada(
  unidadDelPuesto: UnidadOrganigrama | null | undefined,
  destino: DestinoServido,
): boolean {
  if (!unidadDelPuesto) return false;
  return destino.tipo === 'sucursal' && unidadDelPuesto !== 'sucursal';
}

/** La frase que se le pone a una atribución cruzada. */
export function textoAtribucion(
  unidadDelPuesto: UnidadOrganigrama | null | undefined,
  destino: DestinoServido,
): string {
  if (!unidadDelPuesto || !esAtribucionCruzada(unidadDelPuesto, destino)) return '';
  return 'Se le cuenta a ' + (ETIQUETAS_UNIDAD[unidadDelPuesto] || unidadDelPuesto) +
         ', no a ' + destino.nombre + '. Aquí solo aterriza.';
}
