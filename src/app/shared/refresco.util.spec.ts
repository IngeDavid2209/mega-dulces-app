/**
 * 🔄 EL BOTÓN «BUSCAR ACTUALIZACIÓN» — cuándo recarga y cuándo NO
 *
 * Lo que estas pruebas protegen no es un número: es que la pantalla no se
 * recargue cuando no hace falta. Una recarga se lleva lo que la persona tenga a
 * medias —un motivo de retraso a medio escribir, una foto elegida sin subir— y
 * ese costo sólo se paga cuando hay una versión nueva que traer.
 *
 * Las seis ramas se ejercen aquí porque en el componente no se puede: en Chrome
 * headless `SwUpdate.isEnabled` es false, así que un arnés DOM recorrería
 * siempre la misma y daría verde sin tocar las otras cinco.
 */
import { decidirRefresco } from './refresco.util';

describe('botón de buscar actualización', () => {

  /** El caso normal: hay red, hay service worker, y no hay versión nueva. */
  function entorno(extra: any = {}) {
    return {
      enLinea: true,
      swActivo: true,
      version: '22sep-1400',
      buscar: () => Promise.resolve(false),
      activar: () => Promise.resolve(),
      topeMs: 50,
      ...extra,
    };
  }

  // ═══ LA REGLA QUE DA SENTIDO AL BOTÓN ════════════════════════════════════
  it('YA AL DÍA: no recarga, y dice qué versión tiene', async () => {
    const p = await decidirRefresco(entorno());
    expect(p.recargar).withContext('recargó sin tener nada nuevo que traer').toBe(false);
    expect(p.estado).toBe('aldia');
    // La versión va en el mensaje: «ya estás al día» a secas no se puede
    // contrastar con nada, y quien lo lee no sabe si el botón hizo algo.
    expect(p.mensaje).toContain('22sep-1400');
  });

  it('HAY VERSIÓN NUEVA: la activa y recarga', async () => {
    let activado = 0;
    const p = await decidirRefresco(entorno({
      buscar: () => Promise.resolve(true),
      activar: () => { activado++; return Promise.resolve(); },
    }));
    expect(p.recargar).toBe(true);
    expect(p.estado).toBe('aplicando');
    expect(activado).withContext('recargó SIN activar: traería la versión vieja otra vez').toBe(1);
  });

  it('SIN RED: no recarga y lo dice', async () => {
    // Recargar sin red deja la app en blanco si al service worker le falta
    // algún chunk. Es el modo de fallo que el rescate del 1/sep tuvo que
    // aprender por las malas.
    const p = await decidirRefresco(entorno({ enLinea: false }));
    expect(p.recargar).toBe(false);
    expect(p.estado).toBe('sinred');
  });

  it('SIN RED manda sobre todo lo demás: ni siquiera pregunta', async () => {
    let consultas = 0;
    await decidirRefresco(entorno({
      enLinea: false,
      buscar: () => { consultas++; return Promise.resolve(true); },
    }));
    expect(consultas).withContext('consultó al service worker estando sin red').toBe(0);
  });

  it('SIN SERVICE WORKER: recarga, que es el refresh de toda la vida', async () => {
    // Desarrollo, incógnito o un navegador sin soporte. No hay versión que
    // consultar, así que se hace lo que la persona esperaba al pulsar en vez de
    // fingir una comprobación que no se puede hacer.
    const p = await decidirRefresco(entorno({ swActivo: false }));
    expect(p.recargar).toBe(true);
    expect(p.estado).toBe('aplicando');
  });

  // ═══ EL SILENCIO, QUE ES EL FALLO CARO ═══════════════════════════════════
  it('SI EL SERVICE WORKER NO CONTESTA, el botón no se queda colgado', async () => {
    // `checkForUpdate()` NO rechaza cuando el SW no responde: deja la promesa
    // pendiente para siempre. Sin tope, el botón diría «Buscando…» hasta que
    // alguien cierre la app — el «VERIFICANDO...» del login del 1/sep.
    const p = await decidirRefresco(entorno({
      buscar: () => new Promise<boolean>(() => { /* nunca resuelve */ }),
      topeMs: 30,
    }));
    expect(p.recargar).withContext('recargó tras un tope, sin saber si había algo').toBe(false);
    expect(p.estado).toBe('error');
    // El mensaje NOMBRA EL PASO. «Se agotó el tiempo» a secas manda a revisar
    // la red entera; nombrarlo dice dónde mirar.
    expect(p.mensaje).toContain('buscar la actualización');
  });

  it('si la búsqueda falla de verdad, tampoco recarga', async () => {
    const p = await decidirRefresco(entorno({
      buscar: () => Promise.reject(new Error('el service worker se cayó')),
    }));
    expect(p.recargar).toBe(false);
    expect(p.estado).toBe('error');
    expect(p.mensaje).toContain('se cayó');
  });

  it('si ACTIVAR falla, recarga igual: la versión ya está en caché', async () => {
    // Fallar aquí y no recargar dejaría a la persona con el aviso puesto y sin
    // la versión nueva, que es el peor de los dos resultados.
    const p = await decidirRefresco(entorno({
      buscar: () => Promise.resolve(true),
      activar: () => Promise.reject(new Error('no se pudo activar')),
    }));
    expect(p.recargar).toBe(true);
    expect(p.estado).toBe('aplicando');
  });

  // ═══ GUARDIA DE LA PROPIA PRUEBA ═════════════════════════════════════════
  it('la decisión DISCRIMINA: no devuelve siempre lo mismo', async () => {
    // Sin esto, un `decidirRefresco` que siempre dijera `recargar: true` (o
    // siempre false) pasaría la mitad de los casos de arriba.
    const conNueva = await decidirRefresco(entorno({ buscar: () => Promise.resolve(true) }));
    const alDia = await decidirRefresco(entorno());
    expect(conNueva.recargar).not.toBe(alDia.recargar);
    expect(new Set([conNueva.estado, alDia.estado]).size).toBe(2);
  });
});
