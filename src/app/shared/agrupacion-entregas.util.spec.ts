/**
 * 🏪 AGRUPAR LA LISTA POR SUCURSAL — las pruebas
 *
 * Instrucción de David (17/sep/2026): «el agrupador de los usuarios para que
 * los tengas por sucursal».
 *
 * Lo que estas pruebas fijan no es el orden de los bloques: es que NADIE
 * DESAPAREZCA al agrupar. Una entrega sin `store` es el caso peligroso —el
 * hallazgo 1 del proyecto entrando por esta puerta— y la tentación de
 * descartarla es justo lo que dejaría gente fuera de la pantalla sin un solo
 * error.
 */
import {
  agruparEntregas, mostrarEncabezadoSucursal, mostrarEncabezadoPersona,
  CLAVE_SIN_SUCURSAL, ETIQUETA_SIN_SUCURSAL
} from './agrupacion-entregas.util';

const ENTREGAS = [
  { name: 'Apertura',  assigned: 'Cynthia Judith Lopez Galvan', store: 'Padre Hidalgo' },
  { name: 'Pasillo',   assigned: 'Carolina Guzman Ruiz',        store: 'Padre Hidalgo' },
  { name: 'Pasillo 2', assigned: 'Carolina Guzman Ruiz',        store: 'Padre Hidalgo' },
  { name: 'Apertura',  assigned: 'Veronica Magaña',             store: 'La Piedad Abastos' },
  { name: 'Andén',     assigned: 'Luis Ramírez',                store: '' },
];

// Cynthia es Encargada; el resto, operativos.
const NIVEL = (n: string): 'mando' | 'operativo' =>
  n.startsWith('Cynthia') ? 'mando' : 'operativo';

describe('agrupación de entregas', () => {

  it('POR SUCURSAL: un bloque por sucursal, y NADIE se pierde', () => {
    const g = agruparEntregas(ENTREGAS, 'sucursal', NIVEL);
    expect(g.map(x => x.sucursal)).toEqual(['La Piedad Abastos', 'Padre Hidalgo', ETIQUETA_SIN_SUCURSAL]);
    // La guardia que importa: la suma de los bloques es la lista entera.
    expect(g.reduce((a, x) => a + x.total, 0)).toBe(ENTREGAS.length);
  });

  it('SUCURSAL → PERSONA → TAREAS, que es lo que se pidió', () => {
    const ph = agruparEntregas(ENTREGAS, 'sucursal', NIVEL).find(x => x.sucursal === 'Padre Hidalgo')!;
    expect(ph.personas.length).toBe(2);
    // El mando primero, igual que en la lista de hoy.
    expect(ph.personas[0].nombre).toBe('Cynthia Judith Lopez Galvan');
    // Y las dos tareas de Carolina caen juntas, no en dos bloques.
    expect(ph.personas[1].entregas.length).toBe(2);
  });

  it('LA SUCURSAL SIN CAPTURAR ES UN BLOQUE VISIBLE, AL FINAL — nunca un descarte', () => {
    const g = agruparEntregas(ENTREGAS, 'sucursal', NIVEL);
    const ultimo = g[g.length - 1];
    expect(ultimo.clave).toBe(CLAVE_SIN_SUCURSAL);
    expect(ultimo.total).toBe(1);
    expect(ultimo.personas[0].nombre).toBe('Luis Ramírez');
  });

  it('EL MISMO NOMBRE CON OTRA TILDE O ESPACIO ES UN SOLO BLOQUE', () => {
    // El hallazgo 1 contenido: si esto fallara, la pantalla enseñaría dos
    // encabezados con el mismo texto y se leería como sucursal duplicada.
    const sucias = [
      { assigned: 'A', store: 'Yurécuaro' },
      { assigned: 'B', store: 'yurecuaro ' },
      { assigned: 'C', store: ' YURECUARO' },
    ];
    const g = agruparEntregas(sucias, 'sucursal');
    expect(g.length).toBe(1);
    expect(g[0].total).toBe(3);
    // Se pinta el texto ORIGINAL de la primera, no una versión reescrita.
    expect(g[0].sucursal).toBe('Yurécuaro');
  });

  it('POR PERSONA: un solo bloque sin sucursal, con las personas dentro', () => {
    const g = agruparEntregas(ENTREGAS, 'persona', NIVEL);
    expect(g.length).toBe(1);
    expect(g[0].sucursal).toBe('');
    expect(g[0].personas.length).toBe(4);
    expect(g[0].personas[0].nombre).toBe('Cynthia Judith Lopez Galvan');
  });

  it('PLANA: la lista de siempre, sin un solo encabezado', () => {
    const g = agruparEntregas(ENTREGAS, 'plana', NIVEL);
    expect(g.length).toBe(1);
    expect(g[0].personas.length).toBe(1);
    expect(g[0].personas[0].entregas.length).toBe(ENTREGAS.length);
    expect(mostrarEncabezadoSucursal(g)).toBe(false);
    expect(mostrarEncabezadoPersona(g[0])).toBe(false);
  });

  it('CON UNA SOLA SUCURSAL NO SE PINTA EL ENCABEZADO: diría siempre lo mismo', () => {
    const unaSola = ENTREGAS.filter(c => c.store === 'Padre Hidalgo');
    expect(mostrarEncabezadoSucursal(agruparEntregas(unaSola, 'sucursal'))).toBe(false);
    // …pero con dos, sí. La muestra discrimina.
    expect(mostrarEncabezadoSucursal(agruparEntregas(ENTREGAS, 'sucursal'))).toBe(true);
  });

  it('LA EXCEPCIÓN: si el único bloque es «sin sucursal», SÍ se dice', () => {
    // Un dato que falta callado es un dato que nadie arregla (§5.2).
    const soloSin = [{ assigned: 'Luis Ramírez', store: '' }];
    const g = agruparEntregas(soloSin, 'sucursal');
    expect(mostrarEncabezadoSucursal(g)).toBe(true);
  });

  it('una lista vacía da cero bloques, no un bloque vacío', () => {
    expect(agruparEntregas([], 'sucursal').length).toBe(0);
    expect(agruparEntregas([], 'plana').length).toBe(0);
  });

  it('sin persona asignada tampoco se pierde: cae en «Sin asignar»', () => {
    const g = agruparEntregas([{ store: 'Canindo' }], 'sucursal');
    expect(g[0].personas[0].nombre).toBe('Sin asignar');
    expect(g[0].total).toBe(1);
  });
});
