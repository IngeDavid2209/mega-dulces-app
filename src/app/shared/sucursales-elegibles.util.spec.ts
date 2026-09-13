/**
 * 🏪 QUÉ SUCURSALES PUEDE ELEGIR CADA QUIEN — las pruebas
 *
 * El caso que estas pruebas existen para fijar es el que David reportó DOS
 * VECES el 13/sep/2026: el selector de sucursal salía vacío, y sin sucursal
 * elegida la pantalla entera se bloqueaba —incluido un aviso de «solo lectura»
 * que le salía a un administrador—.
 *
 * La causa era el orden: se derivaba la lista de los DATOS y luego se recortaba
 * con lo permitido. Con los datos vacíos —el estado del primer día, cuando
 * nadie ha capturado una plantilla— la intersección daba vacío aunque la
 * Encargada tuviera su sucursal escrita en la ficha.
 *
 * Por eso el primer caso de abajo es «sin plazas y sin fichas»: es el estado en
 * que TODO EL MUNDO va a abrir esta pantalla la primera vez.
 */
import { sucursalesElegibles } from './sucursales-elegibles.util';

const ENCARGADA = { rol: 'trabajador', sucursales: ['Padre Hidalgo'], puedeVerEstadisticas: true };
const GERENTE = { rol: 'trabajador', sucursales: ['8 Esquinas', 'La Piedad Abastos'], puedeVerEstadisticas: true };
const ADMIN_GLOBAL = { rol: 'admin' };
const ADMIN_LIMITADO = { rol: 'admin', alcance: 'sucursales', sucursales: ['Canindo'] };

describe('sucursales elegibles', () => {

  it('LA ENCARGADA VE LA SUYA AUNQUE NO HAYA NI UNA PLAZA NI UNA FICHA', () => {
    // El bug, fijado. Este es el estado del primer día y es justo donde fallaba.
    expect(sucursalesElegibles(ENCARGADA, [], [])).toEqual(['Padre Hidalgo']);
  });

  it('y ve LAS SUYAS, no las de al lado', () => {
    expect(sucursalesElegibles(GERENTE, [], [])).toEqual(['8 Esquinas', 'La Piedad Abastos']);
  });

  it('los datos NO le añaden sucursales que no le tocan', () => {
    // La mitad peligrosa: si las plazas de otra sucursal se colaran, una
    // Encargada empezaría a ver la operación de una tienda que no es suya.
    const plazas = [{ lugar: 'Canindo' }, { lugar: 'Morelia Abastos' }];
    const fichas = [{ sucursales: ['Yurécuaro'] }];
    expect(sucursalesElegibles(ENCARGADA, plazas, fichas)).toEqual(['Padre Hidalgo']);
  });

  it('un admin LIMITADO se comporta como la Encargada: solo su lista', () => {
    expect(sucursalesElegibles(ADMIN_LIMITADO, [{ lugar: 'Padre Hidalgo' }], [])).toEqual(['Canindo']);
  });

  it('el admin GLOBAL sí las deriva de los datos, porque no tiene lista propia', () => {
    const plazas = [{ lugar: 'Canindo' }, { lugar: 'Padre Hidalgo' }];
    const fichas = [{ datos: { sucursales: ['Yurécuaro'] } }, { sucursales: ['Canindo'] }];
    expect(sucursalesElegibles(ADMIN_GLOBAL, plazas, fichas))
      .toEqual(['Canindo', 'Padre Hidalgo', 'Yurécuaro']);
  });

  it('el admin global SIN datos se queda sin lista, y eso es correcto', () => {
    // No se inventa ninguna: si no hay plazas ni fichas, no hay sucursales que
    // ofrecer. La pantalla lo dice; no se rellena por parecido (§8.5).
    expect(sucursalesElegibles(ADMIN_GLOBAL, [], [])).toEqual([]);
  });

  it('limpia espacios y no repite', () => {
    // «Canindo» y «Canindo » son la misma tienda escrita dos veces, y en esta
    // base eso pasa: hay nombres con espacio final (marcador de identidad, §9).
    const fichas = [{ sucursales: ['Canindo', ' Canindo ', ''] }];
    expect(sucursalesElegibles(ADMIN_GLOBAL, [], fichas)).toEqual(['Canindo']);
  });

  it('aguanta datos rotos sin reventar', () => {
    expect(sucursalesElegibles(ADMIN_GLOBAL, [{ lugar: null }], [{ sucursales: null }])).toEqual([]);
    expect(sucursalesElegibles(ADMIN_GLOBAL)).toEqual([]);
  });

  it('sin usuario no se ofrece nada', () => {
    // `sucursalesPermitidas(null)` devuelve [], así que no hay que elegir nada.
    // Importa que sea vacío y no «todas»: un fallo aquí abriría la operación
    // entera a una sesión sin identificar.
    expect(sucursalesElegibles(null, [{ lugar: 'Canindo' }], [])).toEqual([]);
  });

  it('GUARDIA: la función DISCRIMINA entre perfiles', () => {
    // Sin esto, una version que devolviera siempre lo mismo pasaria la mitad de
    // los casos de arriba.
    const plazas = [{ lugar: 'Canindo' }, { lugar: 'Padre Hidalgo' }];
    const enc = sucursalesElegibles(ENCARGADA, plazas, []);
    const glob = sucursalesElegibles(ADMIN_GLOBAL, plazas, []);
    expect(enc).not.toEqual(glob);
    expect(enc.length).toBe(1);
    expect(glob.length).toBe(2);
  });
});
