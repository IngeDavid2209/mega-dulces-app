/**
 * 🎯 LA LÍNEA QUE CONTESTA LA PREGUNTA DE LAS 8 DE LA MAÑANA
 *
 * §8.8: toda regla que produzca un número de una persona lleva prueba. Ésta
 * produce los tres números que una Encargada va a mirar antes que nada, y sobre
 * los que va a decidir a quién le habla primero.
 *
 * ─── EL CASO QUE MÁS PESA ES QUE LOS TRES CUADREN ─────────────────────────
 * Tres números juntos se leen como partes de un todo. Si `vencidas + aTiempo`
 * no diera `pendientes`, la línea mentiría sin dar un solo error, y el modo de
 * fallo sería que alguien reste mal y crea que hay una entrega que no existe.
 */
import { resumenPendientes, textoResumen } from './resumen-pendientes.util';
import { tieneEvidencia } from './item-completado.util';
import { urgenciaDeChecklist } from './urgencia-tarea.util';

/**
 * La regla de vencimiento que se INYECTA en las pruebas.
 *
 * Se usa la del punto pendiente mas proximo —la misma que ve quien trabaja— y
 * no la del arbol, porque lo que este util tiene que garantizar es el CONTEO y
 * la particion, sea cual sea la regla. Que en produccion se le pase la del
 * arbol es decision de quien lo monta, y esta explicado en la cabecera del util.
 */
const reglaDe = (ahora: number) => (c: any) =>
  urgenciaDeChecklist(c.items || [], c.date, c.time, tieneEvidencia, ahora).clase === 'vencida';

const FECHA = '2026-09-18';
/** Epoch local. Con un literal ISO + Z la prueba pasaría o no según el huso. */
const a = (h: number, m: number) => new Date(2026, 8, 18, h, m, 0).getTime();

/** Un checklist con N puntos sin foto, con la hora límite dada. */
const pendiente = (id: string, horaLimite: string, puntos = 2) => ({
  id, date: FECHA, enviado: false,
  items: Array.from({ length: puntos }, (_, k) => ({
    id: id + k, text: 'Punto ' + k, requiresPhoto: true, horaLimite,
  })),
});
const conFoto = (c: any) => ({
  ...c,
  items: c.items.map((i: any) => ({ ...i, photo: 'https://x/' + i.id + '.jpg' })),
});

describe('resumen-pendientes: lo que cuenta', () => {
  it('sin lista, todo en cero y sin reventar', () => {
    expect(resumenPendientes([], reglaDe(a(9, 0))))
      .toEqual({ pendientes: 0, vencidas: 0, aTiempo: 0 });
    expect(resumenPendientes(null as any, reglaDe(a(9, 0))).pendientes).toBe(0);
  });

  it('las ENVIADAS no cuentan como pendientes', () => {
    const lista = [pendiente('a', '23:59'), { ...pendiente('b', '23:59'), enviado: true }];
    expect(resumenPendientes(lista, reglaDe(a(9, 0))).pendientes).toBe(1);
  });

  it('`enviado` SIN VALOR cuenta como pendiente, que es el lado seguro', () => {
    // El campo viene de dos bases distintas a lo largo de la historia del repo.
    // Si un `undefined` contara como enviada, la Encargada vería menos trabajo
    // del que hay: el error tiene que caer del lado de enseñar de más.
    const sinCampo: any = pendiente('a', '23:59');
    delete sinCampo.enviado;
    expect(resumenPendientes([sinCampo], reglaDe(a(9, 0))).pendientes).toBe(1);
  });

  it('separa vencidas de a tiempo por la hora', () => {
    const lista = [pendiente('tarde', '09:00'), pendiente('luego', '18:00')];
    const r = resumenPendientes(lista, reglaDe(a(10, 0)));
    expect(r.pendientes).toBe(2);
    expect(r.vencidas).toBe(1);
    expect(r.aTiempo).toBe(1);
  });

  it('una entrega con TODAS sus fotos ya no tiene hora que se le pase', () => {
    // Consecuencia de reusar `urgenciaDeChecklist`, que salta los puntos hechos.
    // Queda escrito para que sea una decisión y no un accidente: sigue contando
    // como PENDIENTE —no se ha enviado— pero no como vencida, porque el trabajo
    // está y lo único que falta es pulsar enviar. Si algún día se quiere
    // distinguir ese caso («lista sin enviar»), es un cuarto número y hay que
    // decidirlo, no deducirlo de aquí.
    const r = resumenPendientes([conFoto(pendiente('lista', '09:00'))], reglaDe(a(10, 0)));
    expect(r.pendientes).toBe(1);
    expect(r.vencidas).toBe(0);
    expect(r.aTiempo).toBe(1);
  });

  it('un checklist a medias con un punto vencido SÍ cuenta vencido', () => {
    const medias: any = pendiente('medias', '09:00');
    medias.items[0].photo = 'https://x/1.jpg';      // uno hecho, otro no
    expect(resumenPendientes([medias], reglaDe(a(10, 0))).vencidas).toBe(1);
  });
});

describe('resumen-pendientes: LOS TRES NÚMEROS CUADRAN', () => {
  it('vencidas + aTiempo === pendientes, sobre una muestra mezclada', () => {
    const lista = [
      pendiente('a', '07:00'),                      // vencida
      pendiente('b', '09:00'),                      // vencida
      pendiente('c', '18:00'),                      // a tiempo
      conFoto(pendiente('d', '07:00')),             // hecha, sin enviar
      { ...pendiente('e', '07:00'), enviado: true },// fuera
    ];
    const r = resumenPendientes(lista, reglaDe(a(10, 0)));
    expect(r.pendientes).toBe(4);
    expect(r.vencidas + r.aTiempo).toBe(r.pendientes);
    expect(r.vencidas).toBe(2);
  });

  it('cuadra también en los extremos: todas vencidas y ninguna vencida', () => {
    const todas = [pendiente('a', '07:00'), pendiente('b', '08:00')];
    const r1 = resumenPendientes(todas, reglaDe(a(10, 0)));
    expect(r1.vencidas).toBe(2);
    expect(r1.aTiempo).toBe(0);
    expect(r1.vencidas + r1.aTiempo).toBe(r1.pendientes);

    const r2 = resumenPendientes(todas, reglaDe(a(6, 0)));
    expect(r2.vencidas).toBe(0);
    expect(r2.aTiempo).toBe(2);
    expect(r2.vencidas + r2.aTiempo).toBe(r2.pendientes);
  });
});

describe('resumen-pendientes: la frase', () => {
  it('EL VACÍO NO DICE «todo entregado»: seria mentira', () => {
    // Con cero pendientes no se puede distinguir «todos entregaron» de «hoy no
    // se emitió nada», porque las entregadas NO están en esta lista. Afirmar lo
    // primero taparía justo el día en que el robot no corrió (§5.2).
    expect(textoResumen({ pendientes: 0, vencidas: 0, aTiempo: 0 }))
      .toBe('No hay entregas pendientes');
  });

  it('el singular no dice «Faltan 1»', () => {
    expect(textoResumen({ pendientes: 1, vencidas: 1, aTiempo: 0 })).toBe('Falta 1 entrega');
    expect(textoResumen({ pendientes: 3, vencidas: 2, aTiempo: 1 })).toBe('Faltan 3 entregas');
  });
});

/**
 * GUARDIA DE DISCRIMINACIÓN (§8.11 c). Sin esto, un `resumenPendientes` que
 * devolviera siempre ceros pasaría media suite de arriba.
 */
describe('resumen-pendientes: la muestra discrimina', () => {
  it('la misma lista da repartos distintos según la hora', () => {
    const lista = [pendiente('a', '09:00'), pendiente('b', '18:00')];
    const repartos = [a(6, 0), a(10, 0), a(20, 0)]
      .map((t) => { const r = resumenPendientes(lista, reglaDe(t)); return r.vencidas; });
    expect(repartos).toEqual([0, 1, 2]);
  });
});
