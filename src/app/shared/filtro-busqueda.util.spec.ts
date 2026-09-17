/**
 * 🔍 EL BUSCADOR DE TAREAS — las pruebas
 *
 * El caso que estas pruebas existen para fijar es el que David reportó el
 * 17/sep/2026 con una captura: en «Enviadas del equipo» tecleó
 * «la piedad abastos» y siguió viendo tarjetas de **Padre Hidalgo**, con el
 * contador en (94). La regla estaba bien escrita —y probada a mano en
 * Pendientes—; lo que fallaba es que el historial no la llamaba.
 *
 * Por eso la primera prueba de abajo es EXACTAMENTE ese término contra
 * EXACTAMENTE esa mezcla de sucursales: si algún día alguien vuelve a dejar
 * una lista sin filtrar, este caso lo nombra con las palabras de la captura.
 */
import { coincideConBusqueda, filtrarPorBusqueda, normalizarTerminoBusqueda } from './filtro-busqueda.util';

// La mezcla de la captura: dos sucursales, y el término nombra a una de ellas.
const ENTREGAS = [
  { name: 'Checklist de apertura de sucursal', assigned: 'Cynthia Judith Lopez Galvan', store: 'Padre Hidalgo' },
  { name: 'Checklist diario de pasillo',       assigned: 'Carolina Guzman Ruiz',        store: 'Padre Hidalgo' },
  { name: 'Operación de pasillo del turno',    assigned: 'Mónica Mendez Zambrano',      store: 'Padre Hidalgo' },
  { name: 'Checklist de apertura de sucursal', assigned: 'Veronica Magaña',             store: 'La Piedad Abastos' },
  { name: 'Arqueo de caja',                    assigned: 'Ana Pérez',                   store: 'Yurécuaro' },
  { name: 'Revisión de andén',                 assigned: 'Luis Ramírez',                store: '' },
];

describe('filtro de búsqueda de tareas', () => {

  it('EL CASO DE LA CAPTURA: buscar una sucursal deja SOLO esa sucursal', () => {
    const r = filtrarPorBusqueda(ENTREGAS, 'la piedad abastos');
    expect(r.length).toBe(1);
    expect(r[0].assigned).toBe('Veronica Magaña');
    // La afirmación que de verdad importa: ninguna de Padre Hidalgo sobrevive.
    expect(r.some(c => c.store === 'Padre Hidalgo')).toBe(false);
  });

  it('LA MUESTRA DISCRIMINA: el mismo filtro con otra sucursal da otro conjunto', () => {
    // Sin esto, un filtro que devolviera siempre 1 pasaría la prueba de arriba.
    expect(filtrarPorBusqueda(ENTREGAS, 'padre hidalgo').length).toBe(3);
    expect(filtrarPorBusqueda(ENTREGAS, 'la piedad abastos').length).toBe(1);
  });

  it('un término vacío NO filtra: «no estoy buscando» no es «no hay nada»', () => {
    expect(filtrarPorBusqueda(ENTREGAS, '').length).toBe(ENTREGAS.length);
    expect(filtrarPorBusqueda(ENTREGAS, '   ').length).toBe(ENTREGAS.length);
    expect(filtrarPorBusqueda(ENTREGAS, null).length).toBe(ENTREGAS.length);
  });

  it('busca por nombre de tarea y por persona, no solo por sucursal', () => {
    expect(filtrarPorBusqueda(ENTREGAS, 'arqueo').length).toBe(1);
    expect(filtrarPorBusqueda(ENTREGAS, 'carolina').length).toBe(1);
    // «Checklist de apertura» está en dos sucursales distintas: las trae las dos.
    expect(filtrarPorBusqueda(ENTREGAS, 'apertura').length).toBe(2);
  });

  it('SIN ACENTOS TAMBIÉN ENCUENTRA — en un teléfono nadie los escribe', () => {
    // Antes «yurecuaro» no encontraba «Yurécuaro» y la pantalla no decía por qué.
    expect(filtrarPorBusqueda(ENTREGAS, 'yurecuaro').length).toBe(1);
    expect(filtrarPorBusqueda(ENTREGAS, 'monica').length).toBe(1);
    expect(filtrarPorBusqueda(ENTREGAS, 'MAGAÑA').length).toBe(1);
  });

  it('una entrega sin sucursal no revienta ni se cuela en cualquier búsqueda', () => {
    const sinStore = ENTREGAS[5];
    expect(coincideConBusqueda(sinStore, normalizarTerminoBusqueda('anden'))).toBe(true);
    expect(coincideConBusqueda(sinStore, normalizarTerminoBusqueda('padre hidalgo'))).toBe(false);
    expect(coincideConBusqueda({}, normalizarTerminoBusqueda('lo que sea'))).toBe(false);
  });

  it('el término se normaliza igual que el dato, o la comparación no sirve', () => {
    expect(normalizarTerminoBusqueda('  LA   Piedad,  Abastos ')).toBe('la piedad abastos');
    expect(filtrarPorBusqueda(ENTREGAS, '  LA   Piedad  Abastos ').length).toBe(1);
  });
});
