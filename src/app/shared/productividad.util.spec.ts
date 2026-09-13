/**
 * ⏱️ PRODUCTIVIDAD Y TURNO — la primera prueba de la deuda §8.8
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * `productividad.util.ts` calcula, de una PERSONA con nombre y apellido:
 * cuánto cumplió, cuánto hizo dentro de su turno, cuánto entregó tarde y en
 * cuántos minutos palomeó su día. Son cuatro números que pueden acabar en una
 * conversación con su Gerente. El CLAUDE.md lo registró el 31/ago como deuda
 * —«sin pruebas, calcula cumplimiento, puntualidad, turno y ritmo»— y lo marcó
 * como «2.2 · primera prueba a escribir». Esto es eso.
 *
 * ─── NACIÓ FIJANDO UN DEFECTO, Y EL DEFECTO SE CORRIGIÓ ────────────────────
 * Escrita el 13/sep/2026 con un bloque que afirmaba el defecto de entonces: una
 * nota cerraba los tres puntos sin una sola foto (`hechos: 3`). La Fase 2.1 se
 * aplicó ese mismo día y puso ese bloque en rojo —que era exactamente el
 * mecanismo buscado— así que se cambió a mano, en el mismo commit que cambió la
 * regla. Hoy `medir()` usa `estadoItem` y los puntos sin prueba caen en
 * `justificados` o se quedan fuera, pero ninguno cuenta como cumplimiento.
 * Una deuda que rompe una prueba es una deuda que se ve.
 *
 * ─── POR QUÉ LAS FECHAS NO SE ESCRIBEN A OJO ───────────────────────────────
 * `ventanaDeTurno` filtra por día de la semana (`h.dias.includes(dia)`). Fijar
 * «el 14 de septiembre es lunes» en una prueba la vuelve un acertijo de
 * calendario: el día se DERIVA de la fecha con el mismo `getDay()` que usa la
 * función, y el caso «sin horario ese día» se construye pidiendo el día
 * siguiente. Así la prueba no puede fallar por un error de almanaque mío.
 *
 * ─── Y UNA GUARDIA, porque una muestra que no discrimina no discrimina ─────
 * Al final hay un caso que exige que la muestra produzca al menos un valor de
 * cada lado (dentro y fuera de turno, a tiempo y tarde). Sin eso, una función
 * que devolviera siempre lo mismo pasaría todos los casos de arriba. Es la
 * lección del 31/ago: el control correcto sobre una muestra que no discrimina
 * no prueba nada.
 */
import { ventanaDeTurno, medir, pct } from './productividad.util';
import { HorarioSucursal } from './horarios-sucursal.util';

// ───────────────────────────────────────────────────────────────────────────
//  Andamio
// ───────────────────────────────────────────────────────────────────────────

/** Canindo, que es la sucursal que SÍ está en SUCURSAL_A_TALENTO. */
const SUCURSAL = 'Canindo';
const TALENTO_ID = 'zamora-canindo';
const FECHA = '2026-09-14';

/** El día de la semana de una fecha, con el mismo cálculo que la función. */
function diaDe(fechaYmd: string): number {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaYmd)!;
  return new Date(Number(f[1]), Number(f[2]) - 1, Number(f[3])).getDay();
}

/** Epoch de una hora del día de FECHA, en hora local (como hace la función). */
function aEpoch(hhmm: string, fechaYmd: string = FECHA): number {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaYmd)!;
  const t = /^(\d{1,2}):(\d{2})$/.exec(hhmm)!;
  return new Date(Number(f[1]), Number(f[2]) - 1, Number(f[3]),
                  Number(t[1]), Number(t[2]), 0).getTime();
}

function horario(extra: Partial<HorarioSucursal> = {}): HorarioSucursal {
  return {
    sucursal_id: TALENTO_ID, area_id: null, nombre: 'General',
    dias: [diaDe(FECHA)], entrada: '08:00', salida: '18:00',
    inicio_comida: null, fin_comida: null, tolerancia_min: 10,
    ...extra,
  };
}

/**
 * Un punto del manual tal como lo emite el robot desde el 3/sep: pide varias
 * fotos. Sin `photos[]` no tiene evidencia y tampoco sello de tiempo.
 */
function punto(extra: any = {}) {
  return {
    id: 'p', text: 'Punto del manual', checked: false,
    photos: [], requiresVariasFotos: true, requiresPhoto: false,
    requiresAntesDespues: false,
    ...extra,
  };
}

/** El mismo punto, ya cumplido con una foto sellada a esa hora. */
function puntoConFoto(hhmm: string, extra: any = {}) {
  return punto({ photos: [{ url: 'x', timestamp: aEpoch(hhmm) }], ...extra });
}

function checklist(items: any[], extra: any = {}) {
  return {
    id: 'c1', name: 'Apertura', assigned: 'Ana Ruiz', store: SUCURSAL,
    date: FECHA, items, ...extra,
  };
}

const porPersona = (c: any) => c.assigned;

// ═══════════════════════════════════════════════════════════════════════════
describe('ventana de turno', () => {

  it('una sucursal que no está en el mapa de Talento devuelve null, no una ventana inventada', () => {
    expect(ventanaDeTurno('Sucursal Que No Existe', FECHA, [horario()])).toBeNull();
  });

  it('sin horario capturado para ese día devuelve null (es respuesta legítima, no error)', () => {
    const otroDia = (diaDe(FECHA) + 1) % 7;
    expect(ventanaDeTurno(SUCURSAL, FECHA, [horario({ dias: [otroDia] })])).toBeNull();
  });

  it('con un turno, la ventana va de su entrada a su salida', () => {
    const v = ventanaDeTurno(SUCURSAL, FECHA, [horario()])!;
    expect(v).not.toBeNull();
    expect(v.textoEntrada).toBe('08:00');
    expect(v.textoSalida).toBe('18:00');
    expect(v.entrada).toBe(aEpoch('08:00'));
    expect(v.salida).toBe(aEpoch('18:00'));
  });

  it('CON VARIOS TURNOS toma el más temprano y el más tardío: la sucursal estuvo abierta todo ese rango', () => {
    const v = ventanaDeTurno(SUCURSAL, FECHA, [
      horario({ nombre: 'Vespertino', entrada: '14:00', salida: '22:00' }),
      horario({ nombre: 'Matutino', entrada: '07:00', salida: '15:00' }),
    ])!;
    expect(v.textoEntrada).toBe('07:00');
    expect(v.textoSalida).toBe('22:00');
  });

  it('una hora malformada no produce una ventana a medias: devuelve null', () => {
    expect(ventanaDeTurno(SUCURSAL, FECHA, [horario({ entrada: 'ocho' })])).toBeNull();
  });

  it('una fecha malformada devuelve null', () => {
    expect(ventanaDeTurno(SUCURSAL, '14/09/2026', [horario()])).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('medir: qué entra en la operación y qué no', () => {

  it('el Espacio TEC no cuenta (se mide aparte)', () => {
    const m = medir([checklist([punto()], { origenTec: true })], [], porPersona);
    expect(m.length).toBe(0);
  });

  it('lo archivado y lo eliminado no cuentan', () => {
    expect(medir([checklist([punto()], { archivado: true })], [], porPersona).length).toBe(0);
    expect(medir([checklist([punto()], { eliminado: true })], [], porPersona).length).toBe(0);
  });

  it('excluido del KPI CON motivo sale del conteo', () => {
    const c = checklist([punto()], { _excluidoKpi: true, _excluidoMotivo: 'ficha duplicada' });
    expect(medir([c], [], porPersona).length).toBe(0);
  });

  it('excluido del KPI SIN motivo SIGUE CONTANDO: una bandera a medio escribir no saca a nadie', () => {
    const c = checklist([punto()], { _excluidoKpi: true });
    const m = medir([c], [], porPersona);
    expect(m.length).toBe(1);
    expect(m[0].asignados).toBe(1);
  });

  it('un checklist sin llave (sin asignado) no crea una fila fantasma', () => {
    expect(medir([checklist([punto()], { assigned: '   ' })], [], porPersona).length).toBe(0);
  });

  it('agrupa por la llave y suma los días distintos', () => {
    const m = medir([
      checklist([punto(), punto()]),
      checklist([punto()], { id: 'c2', date: '2026-09-15' }),
      checklist([punto()], { id: 'c3', assigned: 'Beto Gil' }),
    ], [], porPersona);
    const ana = m.find(x => x.clave === 'Ana Ruiz')!;
    expect(m.length).toBe(2);
    expect(ana.asignados).toBe(3);
    expect(ana.dias).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('medir: el tiempo, que es lo que se le cuenta a una persona', () => {

  const hs = [horario()];   // 08:00 a 18:00

  it('un punto cumplido DENTRO del turno cuenta dentro, y trae sello', () => {
    const m = medir([checklist([puntoConFoto('09:30')])], hs, porPersona)[0];
    expect(m.hechos).toBe(1);
    expect(m.conSello).toBe(1);
    expect(m.sinSello).toBe(0);
    expect(m.dentroTurno).toBe(1);
    expect(m.fueraTurno).toBe(0);
  });

  it('un punto cumplido FUERA del turno cuenta fuera (no se le regala la hora)', () => {
    const m = medir([checklist([puntoConFoto('21:00')])], hs, porPersona)[0];
    expect(m.dentroTurno).toBe(0);
    expect(m.fueraTurno).toBe(1);
  });

  it('SIN HORARIO capturado no se clasifica ni dentro ni fuera, y el día se reporta', () => {
    const m = medir([checklist([puntoConFoto('09:30')])], [], porPersona)[0];
    expect(m.conSello).toBe(1);
    expect(m.dentroTurno).toBe(0);
    expect(m.fueraTurno).toBe(0);
    expect(m.diasSinHorario).toBe(1);
    expect(m.dias).toBe(1);
  });

  it('un punto hecho SIN sello se cuenta aparte, no se le inventa una hora', () => {
    const sinSello = punto({ photos: [{ url: 'x' }] });   // foto sin timestamp
    const m = medir([checklist([sinSello])], hs, porPersona)[0];
    expect(m.hechos).toBe(1);
    expect(m.conSello).toBe(0);
    expect(m.sinSello).toBe(1);
  });

  it('a tiempo y tarde salen del límite del punto', () => {
    const m = medir([checklist([
      puntoConFoto('09:00', { horaLimite: '10:00' }),
      puntoConFoto('11:00', { horaLimite: '10:00' }),
    ])], hs, porPersona)[0];
    expect(m.aTiempo).toBe(1);
    expect(m.tarde).toBe(1);
  });

  it('el límite del CHECKLIST aplica cuando el punto no trae el suyo', () => {
    const m = medir([checklist([puntoConFoto('11:00')], { time: '10:00' })], hs, porPersona)[0];
    expect(m.tarde).toBe(1);
    expect(m.aTiempo).toBe(0);
  });

  it('un límite en formato PM se interpreta bien (5:00 PM son las 17:00, no las 5)', () => {
    const m = medir([checklist([puntoConFoto('16:00', { horaLimite: '5:00 PM' })])], hs, porPersona)[0];
    expect(m.aTiempo).toBe(1);
    expect(m.tarde).toBe(0);
  });

  it('sin límite no se clasifica: ni a tiempo ni tarde', () => {
    const m = medir([checklist([puntoConFoto('09:00')])], hs, porPersona)[0];
    expect(m.aTiempo).toBe(0);
    expect(m.tarde).toBe(0);
  });

  it('MINUTOS DE ACTIVIDAD: tres minutos en dos puntos es la firma de palomear de una sentada', () => {
    const m = medir([checklist([puntoConFoto('09:00'), puntoConFoto('09:03')])], hs, porPersona)[0];
    expect(m.minutosActividad).toBe(3);
  });

  it('con UN SOLO sello no hay rango: es null, no cero', () => {
    const m = medir([checklist([puntoConFoto('09:00')])], hs, porPersona)[0];
    expect(m.minutosActividad).toBeNull();
  });

  it('los minutos son el PROMEDIO de los días, no la suma', () => {
    const m = medir([
      checklist([puntoConFoto('09:00'), puntoConFoto('09:10')]),
      checklist([
        punto({ photos: [{ url: 'x', timestamp: aEpoch('09:00', '2026-09-15') }] }),
        punto({ photos: [{ url: 'x', timestamp: aEpoch('09:30', '2026-09-15') }] }),
      ], { id: 'c2', date: '2026-09-15' }),
    ], hs, porPersona)[0];
    // día 1: 10 min · día 2: 30 min → promedio 20. Los sellos del día 2 llevan
    // su propia fecha a propósito: el rango se calcula por día, y sellar el día
    // 2 con horas del día 1 habría dado el mismo 30 por accidente.
    expect(m.minutosActividad).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('FASE 2.1: la justificación deja de contar como cumplimiento', () => {

  // Este bloque se llamaba «MAL Y A PROPÓSITO: el defecto que la Fase 2.1 tiene
  // que venir a romper» y afirmaba `hechos: 3`. La fase vino el 13/sep/2026 y
  // lo rompió, que era justo el mecanismo: los casos se cambiaron a mano, en el
  // mismo commit que cambió la regla.

  it('una nota del colaborador YA NO cierra los puntos sin foto', () => {
    const c = checklist([punto(), punto(), punto()], { notaEmpleado: 'no hubo producto' });
    const m = medir([c], [horario()], porPersona)[0];

    expect(m.asignados).toBe(3);
    expect(m.hechos).toBe(0);
    // Pero no se pierden: quedan contados como justificados, que es un estado
    // con dueño propio en el modelo de causas.
    expect(m.justificados).toBe(3);
    expect(m.conSello).toBe(0);
    expect(m.minutosActividad).toBeNull();
  });

  it('la entrega con retraso tampoco los cierra, y también se cuenta aparte', () => {
    const c = checklist([punto(), punto()], { entregaConRetraso: true });
    const m = medir([c], [horario()], porPersona)[0];
    expect(m.hechos).toBe(0);
    expect(m.justificados).toBe(2);
  });

  it('sin justificación los puntos sin prueba NO engordan `justificados`', () => {
    // La diferencia entre «no se pudo y lo dijo» y «no se hizo y nadie dijo
    // nada». Si las dos cayeran en el mismo contador, la Fase 5 no podría
    // repartir la causa.
    const m = medir([checklist([punto(), punto()])], [horario()], porPersona)[0];
    expect(m.hechos).toBe(0);
    expect(m.justificados).toBe(0);
  });

  it('una nota en blanco no justifica: los espacios no cuentan', () => {
    const c = checklist([punto(), punto()], { notaEmpleado: '   ' });
    const m = medir([c], [horario()], porPersona)[0];
    expect(m.hechos).toBe(0);
    expect(m.justificados).toBe(0);
  });

  it('un punto CON foto se cierra por su prueba aunque el checklist traiga nota', () => {
    const c = checklist([puntoConFoto('09:00'), punto()], { notaEmpleado: 'faltó material' });
    const m = medir([c], [horario()], porPersona)[0];
    expect(m.hechos).toBe(1);
    expect(m.justificados).toBe(1);
    expect(m.asignados).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('pct: un porcentaje sin denominador no es cero', () => {

  it('con denominador 0 devuelve null, que es «no se sabe»', () => {
    expect(pct(0, 0)).toBeNull();
  });

  it('redondea al entero', () => {
    expect(pct(1, 3)).toBe(33);
    expect(pct(2, 3)).toBe(67);
    expect(pct(7, 7)).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GUARDIA: la muestra discrimina', () => {

  /**
   * Sin esto, una `medir()` que devolviera siempre el mismo objeto pasaría
   * todos los casos de arriba. Aquí se exige que la misma muestra produzca
   * valores de LOS DOS lados de cada eje. Si algún día deja de hacerlo, el
   * mensaje dice que la prueba dejó de medir — no que el código esté bien.
   */
  it('la misma muestra produce dentro Y fuera de turno, a tiempo Y tarde', () => {
    const m = medir([checklist([
      puntoConFoto('09:00', { horaLimite: '10:00' }),   // dentro · a tiempo
      puntoConFoto('21:00', { horaLimite: '10:00' }),   // fuera  · tarde
      punto(),                                          // ni hecho
    ])], [horario()], porPersona)[0];

    expect(m.asignados).toBe(3);
    expect(m.hechos).toBe(2);
    expect(m.dentroTurno).withContext('el eje dentro/fuera dejó de discriminar').toBe(1);
    expect(m.fueraTurno).withContext('el eje dentro/fuera dejó de discriminar').toBe(1);
    expect(m.aTiempo).withContext('el eje puntualidad dejó de discriminar').toBe(1);
    expect(m.tarde).withContext('el eje puntualidad dejó de discriminar').toBe(1);
  });
});
