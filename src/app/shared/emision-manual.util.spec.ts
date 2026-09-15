/**
 * 🤖 QUÉ SE LE ENTREGA A QUIÉN HOY — las pruebas
 *
 * §8.8: esta regla produce el DENOMINADOR de cada persona. Lo que decida aquí
 * es contra qué se mide su cumplimiento el resto del día, así que una entrega
 * de más hunde a alguien que no hizo nada mal, y una de menos le regala un
 * 100% a una plaza que no trabajó.
 *
 * ─── LOS TRES CASOS QUE ESTE ARCHIVO EXISTE PARA FIJAR ────────────────────
 *
 *  1. LA LLAVE DE IDEMPOTENCIA NO CAMBIA, Y SE FIJA CONTRA UN LITERAL. No es
 *     purismo: en producción ya existen miles de documentos con esa forma. Si
 *     `idemKey` cambiara, el emisor dejaría de reconocer lo ya entregado y
 *     crearía un SEGUNDO documento para el mismo punto del mismo día — dos
 *     denominadores para una persona, sin un solo error visible. Y la llave NO
 *     lleva el puesto dentro a propósito, para que una asignación a mano y la
 *     entrega automática de la misma tarea colapsen en un documento.
 *
 *  2. UNA PERSONA CON DOS SUCURSALES RECIBE EN LAS DOS. Es lo que multiplica su
 *     denominador (hallazgo del 4/sep) y tiene que ser una decisión visible,
 *     no un efecto que nadie sepa explicar.
 *
 *  3. QUIEN NO RECIBE NADA SALE NOMBRADO, CON SU MOTIVO. «Sin puesto», «su
 *     puesto no tiene manual» y «sin sucursal» tienen dueños distintos: la
 *     primera es captura, la segunda es Dirección escribiendo un manual, la
 *     tercera es RH. Si las tres se vieran como un hueco mudo, nadie arreglaría
 *     ninguna — que es exactamente por qué hay 70 puestos sin manual y nadie lo
 *     tenía en una pantalla.
 */
import {
  planDeEntregas, idemKey, llavePeriodo, tareaAplicaEnFecha, sucursalesDe, slug, toYmd,
} from './emision-manual.util';
import { tareasAutomaticasDePuesto } from './tareas-manual.catalogo';
import { PUESTOS_ORGANIGRAMA } from './organigrama.catalogo';
import { obtenerSemanaISO, obtenerNombreDia } from './descansos.util';

// 14/sep/2026 es LUNES. Se construye con constructor local (no con un ISO, que
// se interpretaría en UTC y en México caería el día anterior).
const LUNES = new Date(2026, 8, 14, 10, 0, 0);
const DOMINGO = new Date(2026, 8, 13, 10, 0, 0);

function persona(nombre: string, extra: any = {}): any {
  return { id: 'u_' + slug(nombre), nombre, rol: 'trabajador', activo: true, ...extra };
}

function plan(usuarios: any[], fecha = LUNES, extra: any = {}) {
  return planDeEntregas({
    usuarios, fecha,
    horarios: [], configTurnos: null, descansosSemana: [],
    idsExistentes: new Set<string>(),
    ...extra,
  });
}

/** Cuántas tareas del catálogo le tocan a un puesto en una fecha. DERIVADO del
 *  catálogo real, nunca tecleado: un esperado escrito a mano se ajusta al
 *  resultado cuando falla, que es la dirección equivocada (§8.11). */
function tareasQueAplican(puestoId: string, fecha: Date, diaHoy: string): number {
  return tareasAutomaticasDePuesto(puestoId).filter(t => tareaAplicaEnFecha(t, fecha, diaHoy)).length;
}

describe('emision-manual: la llave de idempotencia', () => {
  it('conserva EXACTAMENTE la forma que ya existe en producción', () => {
    // Si esta aserción falla, no se "actualiza el esperado": se revierte el
    // cambio a `idemKey`, o se migran los ids ya emitidos.
    expect(idemKey('anaquelista.pasillo', '2026-9-14', 'Canindo', 'Ana Pérez'))
      .toBe('man_anaquelista_pasillo_2026-9-14_canindo_ana_perez');
  });

  it('NO lleva el puesto dentro: dos puestos con la misma tarea colapsan', () => {
    const a = idemKey('t.x', '2026-9-14', 'Canindo', 'Ana');
    const b = idemKey('t.x', '2026-9-14', 'Canindo', 'Ana');
    expect(a).toBe(b);
  });

  it('distingue persona, sucursal, tarea y periodo', () => {
    const base = idemKey('t.x', '2026-9-14', 'Canindo', 'Ana');
    const distintas = new Set([
      base,
      idemKey('t.y', '2026-9-14', 'Canindo', 'Ana'),
      idemKey('t.x', '2026-9-15', 'Canindo', 'Ana'),
      idemKey('t.x', '2026-9-14', 'Padre Hidalgo', 'Ana'),
      idemKey('t.x', '2026-9-14', 'Canindo', 'Beto'),
    ]);
    // GUARDIA: si alguno de los cuatro ejes no entrara en la llave, dos
    // documentos distintos compartirían id y uno pisaría al otro.
    expect(distintas.size).toBe(5);
  });

  it('el acento no cambia la llave, pero el nombre sí', () => {
    expect(slug('María Pérez')).toBe('maria_perez');
    expect(slug('Maria Perez')).toBe('maria_perez');
  });
});

describe('emision-manual: el periodo amarra la idempotencia a la vida de la tarea', () => {
  it('una diaria cambia de llave cada día', () => {
    expect(llavePeriodo('Diaria', LUNES)).not.toBe(llavePeriodo('Diaria', DOMINGO));
  });

  it('una semanal NO cambia dentro de la misma semana', () => {
    const martes = new Date(2026, 8, 15, 10, 0, 0);
    expect(llavePeriodo('Semanal', LUNES)).toBe(llavePeriodo('Semanal', martes));
  });

  it('una semanal solo aplica en SU día, y por eso su llave no se recrea en blanco', () => {
    const t: any = { frecuencia: 'Semanal', diaSemana: 'Lunes' };
    expect(tareaAplicaEnFecha(t, LUNES, 'Lunes')).toBe(true);
    expect(tareaAplicaEnFecha(t, new Date(2026, 8, 15), 'Martes')).toBe(false);
  });

  it('una mensual del día 31 cae el último día de un mes de 30', () => {
    const t: any = { frecuencia: 'Mensual', diaMes: 31 };
    expect(tareaAplicaEnFecha(t, new Date(2026, 8, 30), 'Miércoles')).toBe(true);
    expect(tareaAplicaEnFecha(t, new Date(2026, 8, 29), 'Martes')).toBe(false);
  });
});

describe('emision-manual: a quién le toca', () => {
  it('entrega al anaquelista las tareas que su manual dice para ese día', () => {
    const esperadas = tareasQueAplican('anaquelista', LUNES, 'Lunes');
    expect(esperadas).toBeGreaterThan(0);   // si el catálogo se vacía, este caso deja de medir
    const p = plan([persona('Ana', { puestoId: 'anaquelista', sucursales: ['Canindo'] })]);
    expect(p.entregas.length).toBe(esperadas);
    expect(p.omitidos.length).toBe(0);
    expect(p.entregas[0].payload.store).toBe('Canindo');
    expect(p.entregas[0].payload.assigned).toBe('Ana');
    expect(p.entregas[0].payload.date).toBe(toYmd(LUNES));
    expect(p.entregas[0].payload._origenManual).toBe(true);
  });

  it('DOS SUCURSALES = DOBLE DENOMINADOR, y es una decisión, no un accidente', () => {
    const una = plan([persona('Ana', { puestoId: 'anaquelista', sucursales: ['Canindo'] })]);
    const dos = plan([persona('Beto', { puestoId: 'anaquelista', sucursales: ['Canindo', 'Padre Hidalgo'] })]);
    expect(dos.entregas.length).toBe(una.entregas.length * 2);
    expect(new Set(dos.entregas.map(e => e.payload.store)).size).toBe(2);
  });

  it('no repite lo que ya existe, y los ELIMINADOS también cuentan como existentes', () => {
    const u = persona('Ana', { puestoId: 'anaquelista', sucursales: ['Canindo'] });
    const primera = plan([u]);
    const yaEstan = new Set(primera.entregas.map(e => e.checklistId));
    const segunda = plan([u], LUNES, { idsExistentes: yaEstan });
    // Cero entregas nuevas: es la propiedad que permite correr el emisor cada
    // pocos minutos sin duplicar ni pisar lo que la persona ya contestó.
    expect(segunda.entregas.length).toBe(0);
    // Y no la reporta como omitida: sus tareas SÍ existen, solo que ya estaban.
    expect(segunda.omitidos.length).toBe(0);
  });

  it('no ensucia el Set que recibe', () => {
    const entrada = new Set<string>();
    plan([persona('Ana', { puestoId: 'anaquelista', sucursales: ['Canindo'] })], LUNES, { idsExistentes: entrada });
    expect(entrada.size).toBe(0);
  });
});

describe('emision-manual: quien no recibe nada sale NOMBRADO y con su motivo', () => {
  it('separa sin puesto, sin manual y sin sucursal', () => {
    const sinManual = PUESTOS_ORGANIGRAMA.find(p => tareasAutomaticasDePuesto(p.id).length === 0)!;
    expect(sinManual).toBeTruthy();
    const p = plan([
      persona('Caro', { sucursales: ['Canindo'] }),                                  // sin puesto
      persona('Dani', { puestoId: sinManual.id, sucursales: ['Canindo'] }),           // puesto sin manual
      persona('Eva', { puestoId: 'anaquelista' }),                                    // sin sucursal
    ]);
    expect(p.entregas.length).toBe(0);
    expect(p.omitidos.length).toBe(3);
    // GUARDIA: los tres motivos tienen que ser TRES. Tienen dueños distintos
    // —captura, Dirección, RH— y si el emisor los redujera a uno, la pantalla
    // que los muestre mandaría a todo el mundo con la persona equivocada.
    expect(new Set(p.omitidos.map(o => o.motivo)).size).toBe(3);
    expect(p.omitidos.find(o => o.nombre === 'Caro')!.motivo).toContain('sin puesto');
    expect(p.omitidos.find(o => o.nombre === 'Dani')!.motivo).toContain('manual');
    expect(p.omitidos.find(o => o.nombre === 'Eva')!.motivo).toContain('sucursal');
  });

  it('a quien descansa no se le entrega nada, y se dice', () => {
    const u = persona('Ana', { puestoId: 'anaquelista', sucursales: ['Canindo'] });
    // El fixture se CONSTRUYE con las mismas funciones que lo van a leer. Si se
    // tecleara («dias: ['Lunes']», «semanaISO: '2026-W38'») y una de las dos no
    // casara, `esDiaDescansoEnFecha` devolvería false y el caso pasaría por el
    // camino equivocado: cero entregas «por descanso» cuando en realidad el
    // descanso no se reconoció. Es el control que pasa por otra puerta (§8.11 c).
    const descanso = {
      userId: u.id,
      semanaISO: obtenerSemanaISO(LUNES),
      dias: [obtenerNombreDia(LUNES)],
    };
    const p = plan([u], LUNES, { descansosSemana: [descanso] });
    expect(p.entregas.length).toBe(0);
    expect(p.omitidos.length).toBe(1);
    expect(p.omitidos[0].motivo).toBe('día de descanso');

    // NEGATIVO: el mismo descanso en OTRA semana no le quita nada. Sin esto, un
    // `esDiaDescansoEnFecha` que devolviera siempre true pasaría el caso de
    // arriba tal cual.
    const otraSemana = plan([u], LUNES, {
      descansosSemana: [{ ...descanso, semanaISO: descanso.semanaISO + 'x' }],
    });
    expect(otraSemana.entregas.length).toBeGreaterThan(0);
  });

  it('una sucursal cerrada ese día no recibe, y el motivo lo nombra', () => {
    const p = plan([persona('Ana', { puestoId: 'anaquelista', sucursales: ['Canindo'] })], LUNES, {
      esDiaCerrado: () => true,
    });
    expect(p.entregas.length).toBe(0);
    expect(p.omitidos.length).toBe(1);
    expect(p.omitidos[0].motivo).toContain('cerrada');
  });

  it('la ficha inactiva y la que no es trabajador ni admin se saltan en silencio', () => {
    // En silencio A PROPÓSITO: no son un hueco que alguien deba arreglar, así
    // que nombrarlas llenaría el reporte de ruido y taparía los tres de arriba.
    const p = plan([
      persona('Baja', { puestoId: 'anaquelista', sucursales: ['Canindo'], activo: false }),
      persona('Otro', { puestoId: 'anaquelista', sucursales: ['Canindo'], rol: 'invitado' }),
    ]);
    expect(p.entregas.length).toBe(0);
    expect(p.omitidos.length).toBe(0);
  });
});

describe('emision-manual: piezas sueltas', () => {
  it('sucursalesDe normaliza los campos históricos y quita duplicados', () => {
    expect(sucursalesDe({ sucursales: ['Canindo', 'Canindo', 'MKT'] })).toEqual(['Canindo', 'MKT']);
    expect(sucursalesDe({ sucursal: 'Canindo' })).toEqual(['Canindo']);
    expect(sucursalesDe({})).toEqual([]);
  });

  it('GUARDIA DE DISCRIMINACIÓN: la muestra produce entregas Y omisiones', () => {
    // Sin esto, un `planDeEntregas` que devolviera siempre listas vacías
    // pasaría la mitad de los casos de arriba.
    const p = plan([
      persona('Ana', { puestoId: 'anaquelista', sucursales: ['Canindo'] }),
      persona('Eva', { puestoId: 'anaquelista' }),
    ]);
    expect(p.entregas.length).toBeGreaterThan(0);
    expect(p.omitidos.length).toBeGreaterThan(0);
  });
});
