/**
 * 🔑 EL CÓDIGO DE UNA PLAZA — las pruebas
 *
 * §8.8, y aquí el «número de una persona» es su ACCESO. Si dos plazas comparten
 * código, dos personas entran a la misma cuenta y toda la trazabilidad que se
 * construyó hoy —plantilla → plaza → cobertura → evidencia con nombre— se cae
 * en el último metro.
 *
 * El caso que este archivo existe para fijar es real y está en el catálogo:
 * `surtidor-ventas` y `surtidor-sucursal` abrevian los dos a SUR.
 */
import {
  abreviarLugar, abreviarPuesto, generarCodigos, pareceCodigoDePlaza, normalizarCodigo,
  PlazaParaCodigo,
} from './codigo-plaza.util';

function plaza(lugar: string, puestoId: string, numero: number): PlazaParaCodigo {
  return { id: `${lugar}::${puestoId}::${numero}`, lugar, puestoId, numero };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('abreviar', () => {

  it('varias palabras → iniciales', () => {
    expect(abreviarLugar('Padre Hidalgo')).toBe('PH');
    expect(abreviarLugar('La Piedad Abastos')).toBe('LPA');
  });

  it('una palabra → las tres primeras letras', () => {
    expect(abreviarLugar('Canindo')).toBe('CAN');
  });

  it('los acentos no cambian el código', () => {
    // «Yurécuaro» y «Yurecuaro» tienen que dar lo MISMO: si no, la misma
    // sucursal capturada con y sin acento generaría dos códigos distintos, que
    // es el hallazgo 1 entrando por la puerta del acceso.
    expect(abreviarLugar('Yurécuaro')).toBe(abreviarLugar('Yurecuaro'));
  });

  it('un lugar con número no se rompe', () => {
    expect(abreviarLugar('8 Esquinas')).toBe('8E');
  });

  it('el puesto sale de la primera palabra de su id', () => {
    expect(abreviarPuesto('anaquelista')).toBe('ANA');
    expect(abreviarPuesto('cajero-sucursal')).toBe('CAJ');
    expect(abreviarPuesto('encargado-sucursal')).toBe('ENC');
    expect(abreviarPuesto('auxiliar-encargado')).toBe('AUX');
  });

  it('al desempatar toma del SIGUIENTE token, no más letras del primero', () => {
    // `surtidor-ventas` y `surtidor-sucursal` comparten OCHO letras iniciales:
    // alargar la primera palabra no los separaría ni con seis letras.
    expect(abreviarPuesto('surtidor-ventas', 1)).toBe('SURV');
    expect(abreviarPuesto('surtidor-sucursal', 1)).toBe('SURS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('generar los códigos de una sucursal', () => {

  it('el caso de David: tres anaquelistas de Padre Hidalgo', () => {
    const cods = generarCodigos([
      plaza('Padre Hidalgo', 'anaquelista', 1),
      plaza('Padre Hidalgo', 'anaquelista', 2),
      plaza('Padre Hidalgo', 'anaquelista', 3),
    ]);
    expect([...cods.values()]).toEqual(['PH-ANA-1', 'PH-ANA-2', 'PH-ANA-3']);
  });

  it('LOS DOS SURTIDORES NO COMPARTEN CÓDIGO', () => {
    // El caso central. Sin el desempate, los dos serían PH-SUR-1 y dos personas
    // distintas entrarían a la misma cuenta.
    const cods = generarCodigos([
      plaza('Padre Hidalgo', 'surtidor-ventas', 1),
      plaza('Padre Hidalgo', 'surtidor-sucursal', 1),
    ]);
    const lista = [...cods.values()];
    expect(new Set(lista).size).withContext('dos plazas con el mismo código').toBe(2);
    expect(lista).toContain('PH-SUR-1');
    expect(lista.some(c => c !== 'PH-SUR-1' && c.startsWith('PH-SUR'))).toBe(true);
  });

  it('NUNCA reutiliza un código ya entregado, aunque su plaza se haya retirado', () => {
    // Si se reciclara, la hoja impresa de alguien empezaría a abrir la plaza de
    // otra persona, y ninguna de las dos se enteraría.
    const cods = generarCodigos([plaza('Padre Hidalgo', 'anaquelista', 1)], ['PH-ANA-1']);
    expect([...cods.values()][0]).not.toBe('PH-ANA-1');
  });

  it('ES DETERMINISTA: el mismo conjunto en otro orden da los mismos códigos', () => {
    // Si el orden cambiara el resultado, regenerar las credenciales de una
    // sucursal le cambiaría el código a gente que ya lo tiene apuntado.
    const a = [plaza('Canindo', 'cajero-sucursal', 2), plaza('Canindo', 'anaquelista', 1)];
    const b = [plaza('Canindo', 'anaquelista', 1), plaza('Canindo', 'cajero-sucursal', 2)];
    expect(JSON.stringify([...generarCodigos(a).entries()].sort()))
      .toBe(JSON.stringify([...generarCodigos(b).entries()].sort()));
  });

  it('dos sucursales distintas no chocan entre sí', () => {
    const cods = generarCodigos([
      plaza('Padre Hidalgo', 'anaquelista', 1),
      plaza('Canindo', 'anaquelista', 1),
    ]);
    expect(new Set([...cods.values()]).size).toBe(2);
  });

  it('GUARDIA: en una sucursal completa NINGÚN código se repite', () => {
    // La plantilla que David dictó, más los cajeros que ya existen. Sin esta
    // guardia, un choque entre dos puestos que no estén en los casos de arriba
    // pasaría sin ruido.
    const puestos = ['anaquelista', 'cajero-sucursal', 'encargado-sucursal',
      'auxiliar-encargado', 'surtidor-ventas', 'surtidor-sucursal',
      'bodeguero-sucursal', 'almacenista-sucursal', 'vendedora-piso',
      'coordinador-cajas', 'coordinador-piso-ventas', 'vigilancia', 'intendencia'];
    const plazas: PlazaParaCodigo[] = [];
    for (const p of puestos) for (let n = 1; n <= 4; n++) plazas.push(plaza('Padre Hidalgo', p, n));
    const cods = generarCodigos(plazas);
    expect(cods.size).toBe(plazas.length);
    expect(new Set([...cods.values()]).size)
      .withContext('hay códigos repetidos en la misma sucursal').toBe(plazas.length);
  });

  it('ignora plazas sin lugar o sin puesto en vez de generarles basura', () => {
    const cods = generarCodigos([
      { id: 'x', lugar: '', puestoId: 'anaquelista', numero: 1 },
      plaza('Canindo', 'anaquelista', 1),
    ]);
    expect(cods.size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('lo que se teclea en el login', () => {

  it('reconoce un código bien formado', () => {
    expect(pareceCodigoDePlaza('PH-ANA-1')).toBe(true);
    expect(pareceCodigoDePlaza('LPA-SURV-12')).toBe(true);
  });

  it('y rechaza lo que no lo es', () => {
    // Importa para poder decir «ese código no existe» en vez de «usuario o
    // contraseña incorrectos», que manda a la persona a dudar de su PIN.
    expect(pareceCodigoDePlaza('ana@correo.com')).toBe(false);
    expect(pareceCodigoDePlaza('PH-ANA')).toBe(false);
    expect(pareceCodigoDePlaza('')).toBe(false);
  });

  it('normaliza lo que la gente escribe de verdad', () => {
    expect(normalizarCodigo(' ph-ana-1 ')).toBe('PH-ANA-1');
    expect(normalizarCodigo('PH - ANA - 1')).toBe('PH-ANA-1');
  });

  it('y lo normalizado pasa la validación', () => {
    expect(pareceCodigoDePlaza(normalizarCodigo(' ph - ana - 1 '))).toBe(true);
  });
});
