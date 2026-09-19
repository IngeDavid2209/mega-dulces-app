/**
 * 📋 EL MOTIVO NO CIERRA NADA — y ésa es la única prueba que de verdad importa
 *
 * Se agrega un campo nuevo al item (`motivoSinPrueba`) justo en el flujo que
 * decide el cumplimiento de 154 personas. El riesgo no es que el catálogo esté
 * mal escrito: es que el motivo acabe contando como trabajo hecho, que es
 * exactamente lo que la Fase 2.1 vino a cerrar el 13/sep («UN SOLO CARÁCTER
 * escrito en la nota cerraba los 377 puntos del manual sin una sola foto»).
 *
 * Por eso los dos primeros casos no prueban este archivo: prueban que este
 * archivo NO PUEDE mover `item-completado.util`, que es el que manda.
 */
import { tieneEvidencia, estadoItem, tieneJustificacionChecklist } from './item-completado.util';
import {
  MOTIVOS_SIN_PRUEBA,
  MINIMO_NOTA,
  motivoPorCodigo,
  motivoCompleto,
  sellarMotivo,
} from './motivo-sin-prueba.util';

describe('motivo-sin-prueba: NO puede cerrar un punto (§5.3)', () => {
  it('un punto con motivo y sin foto sigue SIN evidencia', () => {
    const item: any = { requiresPhoto: true };
    item.motivoSinPrueba = sellarMotivo({ codigo: 'sin_tiempo' }, 'Claudia', 1);
    expect(item.motivoSinPrueba).toBeTruthy();
    expect(tieneEvidencia(item)).toBe(false);
    expect(estadoItem(item, {})).toBe('no_ejecutado');
  });

  it('EL MOTIVO NO VA EN notaEmpleado, y aquí está por qué', () => {
    // Si el motivo se guardara en el checklist en vez de en el item, este
    // `tieneJustificacionChecklist` pasaría a true y TODOS los puntos del
    // checklist —incluidos los que nadie justificó— cambiarían de causa:
    // `no_ejecutado` (operación) se volvería `justificado`, que tiene otro
    // dueño en el §4. Un dato guardado en el campo de al lado mueve a quién se
    // le cuenta la falta.
    const checklist: any = { items: [{ requiresPhoto: true }] };
    checklist.items[0].motivoSinPrueba = sellarMotivo({ codigo: 'sin_tiempo' }, 'Claudia', 1);
    expect(tieneJustificacionChecklist(checklist)).toBe(false);
    expect(estadoItem(checklist.items[0], checklist)).toBe('no_ejecutado');
  });

  it('con foto Y motivo, la foto manda: el punto está hecho', () => {
    const item: any = { requiresPhoto: true, photo: 'https://x/1.jpg' };
    item.motivoSinPrueba = sellarMotivo({ codigo: 'ya_hecho' }, 'Claudia', 1);
    expect(tieneEvidencia(item)).toBe(true);
  });
});

describe('motivo-sin-prueba: cuándo está completo', () => {
  it('sin nada elegido, no', () => {
    expect(motivoCompleto(null)).toBe(false);
    expect(motivoCompleto({})).toBe(false);
    expect(motivoCompleto({ codigo: '' })).toBe(false);
  });

  it('un código que NO está en el catálogo no vale', () => {
    // Sin esto, cualquier cadena de una versión vieja de la pantalla pasaría
    // como motivo válido y quedaría escrita sin causa que la respalde.
    expect(motivoCompleto({ codigo: 'porque_si' })).toBe(false);
  });

  it('un código del catálogo sin nota vale', () => {
    expect(motivoCompleto({ codigo: 'no_aplica' })).toBe(true);
  });

  it('«Otro» EXIGE escribir, y con el mismo mínimo que el justificante', () => {
    expect(motivoCompleto({ codigo: 'otro' })).toBe(false);
    expect(motivoCompleto({ codigo: 'otro', nota: 'abcd' })).toBe(false);
    expect(motivoCompleto({ codigo: 'otro', nota: 'abcde' })).toBe(true);
    expect(MINIMO_NOTA).toBe(5);
  });

  it('espacios en blanco no son una nota', () => {
    expect(motivoCompleto({ codigo: 'otro', nota: '        ' })).toBe(false);
  });
});

describe('motivo-sin-prueba: lo que queda escrito', () => {
  it('guarda CÓDIGO y causa, no solo la causa deducida', () => {
    // La Fase 5 es la dueña del mapeo. Conservando el código elegido por la
    // persona, puede reinterpretarlo sin volver a preguntarle a nadie.
    const sello: any = sellarMotivo({ codigo: 'falla_equipo', nota: ' se apagó ' }, 'Claudia', 1234);
    expect(sello.codigo).toBe('falla_equipo');
    expect(sello.causa).toBe('sin_prueba');
    expect(sello.nota).toBe('se apagó');
    expect(sello.por).toBe('Claudia');
    expect(sello.en).toBe(1234);
  });

  it('un código inventado no se sella', () => {
    expect(sellarMotivo({ codigo: 'porque_si' }, 'Claudia', 1)).toBeNull();
  });

  it('«no había qué fotografiar» queda SIN causa, no colgado de no_ejecutado', () => {
    // §8.5: no se rellena por parecido. Hacer lo correcto no puede producir
    // una falta, y forzarlo a `no_ejecutado` se la colgaría a la operación.
    expect(motivoPorCodigo('no_aplica')!.causa).toBeNull();
  });
});

describe('motivo-sin-prueba: el catálogo se sostiene solo', () => {
  it('ningún código repetido: dos motivos con el mismo código se pisan al leer', () => {
    const codigos = MOTIVOS_SIN_PRUEBA.map((m) => m.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('toda causa declarada es una de las CINCO del §4', () => {
    const CINCO = ['no_asignado', 'no_ejecutado', 'sin_prueba', 'no_verificado', 'verificado_falso'];
    const fuera = MOTIVOS_SIN_PRUEBA
      .filter((m) => m.causa !== null && !CINCO.includes(m.causa));
    expect(fuera.map((m) => m.codigo)).toEqual([]);
  });

  it('hay exactamente una salida de escape, y pide escribir', () => {
    const conNota = MOTIVOS_SIN_PRUEBA.filter((m) => m.pideNota);
    expect(conNota.length).toBe(1);
    expect(conNota[0].codigo).toBe('otro');
  });

  it('LA MUESTRA DISCRIMINA: hay motivos con causa y sin causa', () => {
    // Sin esta guardia, un catálogo entero con `causa: null` pasaría el caso de
    // «toda causa es una de las cinco» por vacuidad.
    expect(MOTIVOS_SIN_PRUEBA.some((m) => m.causa !== null)).toBe(true);
    expect(MOTIVOS_SIN_PRUEBA.some((m) => m.causa === null)).toBe(true);
  });
});
