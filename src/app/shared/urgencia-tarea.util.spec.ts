/**
 * ⏰ «VENCE EN 30 MIN» — la cuenta que va a leer alguien corriendo en el piso
 *
 * §8.8: toda regla que produzca un número de una persona lleva prueba. Ésta
 * produce el número que decide si alguien deja lo que está haciendo y corre.
 *
 * ─── LO QUE MÁS IMPORTA AQUÍ NO ES EL CÁLCULO, ES EL `null` ────────────────
 * «No hay hora límite» y «le sobra tiempo» son cosas distintas y el tipo las
 * distingue: `minutos: null` contra un número. Si se colapsaran —si «sin hora»
 * devolviera `a_tiempo` con minutos 0— la tarjeta de un punto sin horario
 * diría «Vence en 0 min» y mandaría a correr a alguien que no tiene prisa. Es
 * el §5.2 en una pastilla de la tarjeta: la ausencia de dato no puede
 * significar dos cosas.
 */
import {
  limiteDeItem,
  urgenciaDeItem,
  urgenciaDeChecklist,
  textoUrgencia,
  MINUTOS_AVISO,
} from './urgencia-tarea.util';

const FECHA = '2026-09-18';
/** 2026-09-18 08:00:00 local. Se construye con `new Date(...)` y no con un
 *  literal ISO a propósito: el literal con `Z` es UTC y la regla es local, así
 *  que la prueba pasaría o fallaría según el huso de quien la corra. */
const a = (h: number, m: number) => new Date(2026, 8, 18, h, m, 0).getTime();

const HECHO = (i: any) => !!i.listo;

describe('urgencia-tarea: el límite de un punto', () => {
  it('usa horaLimite cuando está', () => {
    expect(limiteDeItem({ horaLimite: '09:00' }, FECHA)).toBe(a(9, 0) + 59000);
  });

  it('cae a `time` (legacy) si no hay horaLimite', () => {
    expect(limiteDeItem({ time: '14:30' }, FECHA)).toBe(a(14, 30) + 59000);
  });

  it('horaLimite MANDA sobre time: son los campos desincronizados del comentario', () => {
    expect(limiteDeItem({ horaLimite: '09:00', time: '23:00' }, FECHA)).toBe(a(9, 0) + 59000);
  });

  it('sin hora propia toma la del checklist', () => {
    expect(limiteDeItem({}, FECHA, '20:00')).toBe(a(20, 0) + 59000);
  });

  it('sin ninguna hora, el día entero: 23:59', () => {
    expect(limiteDeItem({}, FECHA)).toBe(a(23, 59) + 59000);
  });

  it('sin fecha no hay límite que calcular', () => {
    expect(limiteDeItem({ horaLimite: '09:00' }, '')).toBeNull();
  });
});

describe('urgencia-tarea: en qué punto del reloj está', () => {
  const item = { horaLimite: '09:00' };

  it('con horas por delante, a tiempo y SIN aviso', () => {
    const u = urgenciaDeItem(item, FECHA, undefined, a(7, 0));
    expect(u.clase).toBe('a_tiempo');
    expect(u.minutos).toBe(120);
  });

  it('a 30 minutos exactos YA avisa: el borde entra', () => {
    expect(urgenciaDeItem(item, FECHA, undefined, a(8, 30)).clase).toBe('por_vencer');
  });

  it('a 31 minutos todavía no avisa', () => {
    expect(urgenciaDeItem(item, FECHA, undefined, a(8, 29)).clase).toBe('a_tiempo');
  });

  it('a 12 minutos avisa y dice 12', () => {
    const u = urgenciaDeItem(item, FECHA, undefined, a(8, 48));
    expect(u.clase).toBe('por_vencer');
    expect(u.minutos).toBe(12);
  });

  it('EL MINUTO DE LA HORA LÍMITE TODAVÍA CUENTA COMO DENTRO', () => {
    // El límite cae en el segundo :59, igual que `isTareaVencida`. A las 09:00
    // en punto la persona llega; si esto se volviera `>=` perdería el minuto
    // completo y se le cobraría un retraso que no tuvo.
    expect(urgenciaDeItem(item, FECHA, undefined, a(9, 0)).clase).toBe('por_vencer');
    expect(urgenciaDeItem(item, FECHA, undefined, a(9, 1)).clase).toBe('vencida');
  });

  it('vencida cuenta los minutos que PASARON, en positivo', () => {
    const u = urgenciaDeItem(item, FECHA, undefined, a(10, 13));
    expect(u.clase).toBe('vencida');
    expect(u.minutos).toBe(72);
  });

  it('sin fecha: `minutos` es null y NO es «vence en 0»', () => {
    const u = urgenciaDeItem(item, '', undefined, a(10, 0));
    expect(u.minutos).toBeNull();
    expect(u.limite).toBeNull();
  });

  it('la ventana de aviso es parámetro, no constante enterrada', () => {
    expect(urgenciaDeItem(item, FECHA, undefined, a(7, 30), 120).clase).toBe('por_vencer');
    expect(MINUTOS_AVISO).toBe(30);
  });
});

describe('urgencia-tarea: la del checklist entero', () => {
  const items = [
    { id: 'a', horaLimite: '18:00' },
    { id: 'b', horaLimite: '09:00' },   // el más próximo
    { id: 'c', horaLimite: '13:00' },
  ];

  it('manda el pendiente MÁS PRÓXIMO, no el primero del arreglo', () => {
    const u = urgenciaDeChecklist(items, FECHA, undefined, HECHO, a(8, 45));
    expect(u.clase).toBe('por_vencer');
    expect(u.minutos).toBe(15);   // 09:00, no 18:00
  });

  it('SALTA LOS YA HECHOS: avisar de un límite cumplido manda a rehacer trabajo', () => {
    const conHecho = [{ ...items[1], listo: true }, items[0], items[2]];
    const u = urgenciaDeChecklist(conHecho, FECHA, undefined, HECHO, a(8, 45));
    expect(u.minutos).toBe(255);          // pasa a mandar el de 13:00
    expect(u.clase).toBe('a_tiempo');
  });

  it('una vencida gana a una por vencer, porque se ordena por RELOJ', () => {
    const u = urgenciaDeChecklist(items, FECHA, undefined, HECHO, a(12, 50));
    expect(u.clase).toBe('vencida');      // la de 09:00 sigue pendiente
  });

  it('TODO HECHO no es «a tiempo con 0 minutos»: es que ya no aplica', () => {
    const todos = items.map((i) => ({ ...i, listo: true }));
    const u = urgenciaDeChecklist(todos, FECHA, undefined, HECHO, a(23, 0));
    expect(u.minutos).toBeNull();
    expect(u.limite).toBeNull();
  });

  it('lista vacía o sin fecha no inventa urgencia', () => {
    expect(urgenciaDeChecklist([], FECHA, undefined, HECHO, a(9, 0)).minutos).toBeNull();
    expect(urgenciaDeChecklist(items, '', undefined, HECHO, a(9, 0)).minutos).toBeNull();
  });
});

describe('urgencia-tarea: la frase', () => {
  it('a tiempo no dice nada: una pastilla que siempre está deja de leerse', () => {
    expect(textoUrgencia({ clase: 'a_tiempo', minutos: 200, limite: 1 })).toBe('');
  });

  it('por vencer dice los minutos', () => {
    expect(textoUrgencia({ clase: 'por_vencer', minutos: 12, limite: 1 })).toBe('Vence en 12 min');
  });

  it('con un minuto o menos NO dice «Vence en 1 min» y luego «en 0»', () => {
    expect(textoUrgencia({ clase: 'por_vencer', minutos: 1, limite: 1 })).toBe('Vence en menos de 1 min');
  });

  it('vencida nombra la hora cuando se le pasa, para que no haya que adivinarla', () => {
    expect(textoUrgencia({ clase: 'vencida', minutos: 72, limite: 1 }, '09:00 AM'))
      .toBe('Se pasó la hora (era a las 09:00 AM)');
    expect(textoUrgencia({ clase: 'vencida', minutos: 72, limite: 1 })).toBe('Se pasó la hora');
  });

  it('sin minutos no hay frase', () => {
    expect(textoUrgencia({ clase: 'a_tiempo', minutos: null, limite: null })).toBe('');
  });
});

/**
 * GUARDIA DE DISCRIMINACIÓN (§8.11 c). Sin esto, una `urgenciaDeItem` que
 * devolviera SIEMPRE `a_tiempo` pasaría media suite de arriba. La muestra
 * tiene que producir las tres clases.
 */
describe('urgencia-tarea: la muestra discrimina', () => {
  it('las tres clases salen de la misma función con el mismo punto', () => {
    const item = { horaLimite: '09:00' };
    const clases = [a(6, 0), a(8, 50), a(10, 0)]
      .map((t) => urgenciaDeItem(item, FECHA, undefined, t).clase);
    expect(clases).toEqual(['a_tiempo', 'por_vencer', 'vencida']);
  });
});

/**
 * ⏰ LA REGLA UNIFICADA — y los bordes que tenía la que se retira
 *
 * `vista-organigrama.ts:esVencida` tenía dos ramas propias («de un día
 * anterior», «programada») que la regla nueva NO escribe: las cubre calculando
 * el límite sobre `checklist.date`. Quitar una rama por «es equivalente» sin
 * probarlo es exactamente como se pierden los bordes, así que aquí están.
 */
import { esChecklistVencido } from './urgencia-tarea.util';
import { tieneEvidencia } from './item-completado.util';

describe('esChecklistVencido: la regla unica', () => {
  const HOY = '2026-09-18';
  const AYER = '2026-09-17';
  const MANANA = '2026-09-19';
  const ahora = new Date(2026, 8, 18, 10, 0, 0).getTime();   // 18/sep 10:00
  const punto = (hora: string) => ({ id: 'p', requiresPhoto: true, horaLimite: hora });

  it('pendiente con la hora pasada: vencida', () => {
    expect(esChecklistVencido({ date: HOY, items: [punto('09:00')] }, tieneEvidencia, ahora)).toBe(true);
  });

  it('pendiente con la hora por venir: no', () => {
    expect(esChecklistVencido({ date: HOY, items: [punto('18:00')] }, tieneEvidencia, ahora)).toBe(false);
  });

  it('ENVIADA no va tarde, aunque la hora haya pasado', () => {
    expect(esChecklistVencido({ date: HOY, enviado: true, items: [punto('09:00')] },
      tieneEvidencia, ahora)).toBe(false);
  });

  it('con `status: completo` tampoco', () => {
    expect(esChecklistVencido({ date: HOY, status: 'completo', items: [punto('09:00')] },
      tieneEvidencia, ahora)).toBe(false);
  });

  it('con todos sus puntos hechos, tampoco: falta enviarla, no hacerla', () => {
    const hecho = { ...punto('09:00'), photo: 'https://x/1.jpg' };
    expect(esChecklistVencido({ date: HOY, items: [hecho] }, tieneEvidencia, ahora)).toBe(false);
  });

  it('BORDE 1 — de un día ANTERIOR: vencida aunque su hora sea de noche', () => {
    // La regla vieja tenía un `if (c.date < hoy) return true`. Aquí sale de
    // calcular el límite sobre la fecha del checklist, sin rama aparte.
    expect(esChecklistVencido({ date: AYER, items: [punto('23:59')] }, tieneEvidencia, ahora)).toBe(true);
  });

  it('BORDE 2 — PROGRAMADA para mañana: no va tarde aunque su hora ya pasó hoy', () => {
    expect(esChecklistVencido({ date: MANANA, items: [punto('09:00')] }, tieneEvidencia, ahora)).toBe(false);
  });

  it('sin fecha no se inventa un retraso', () => {
    expect(esChecklistVencido({ items: [punto('09:00')] }, tieneEvidencia, ahora)).toBe(false);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EL CASO QUE JUSTIFICA TODO ESTO: donde las dos reglas SÍ discrepaban
 * ═══════════════════════════════════════════════════════════════════════════
 * Medido: en las 45 entregas que genera el robot, las dos reglas daban lo
 * MISMO a todas las horas, porque `armarChecklist` pone `time: horaLimite` y
 * le da a cada punto ese mismo valor. La divergencia estaba en las tareas
 * creadas A MANO: `checklist.ts` arma el checklist con
 * `time: tareasValidas[0].time` — LA HORA DEL PRIMER PUNTO.
 *
 * Así que un punto posterior con hora más temprana quedaba invisible para el
 * árbol. Este caso tiene exactamente esa forma.
 */
describe('esChecklistVencido: la divergencia que cierra', () => {
  it('un punto POSTERIOR con hora más temprana cuenta, aunque el checklist diga otra', () => {
    const ahora = new Date(2026, 8, 18, 10, 0, 0).getTime();
    const tarea = {
      date: '2026-09-18',
      time: '18:00',                                   // la del PRIMER punto
      items: [
        { id: 'a', requiresPhoto: true, horaLimite: '18:00' },
        { id: 'b', requiresPhoto: true, horaLimite: '09:00' },   // <- se pasó
      ],
    };
    // La regla vieja del árbol miraba `time` y decía «a tiempo» a las 10:00.
    expect(String(tarea.time) < '10:00').toBe(false);
    // La unificada mira el punto pendiente más próximo.
    expect(esChecklistVencido(tarea, tieneEvidencia, ahora)).toBe(true);
  });
});
