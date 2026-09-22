/**
 * ⏰ LA VENTANA DE ENTREGA: 06:00 → 23:00, LA MISMA PARA TODAS — las pruebas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Instrucción de David (22/sep/2026), con la tabla de lo que había enfrente
 * —NUEVE horas distintas sobre 9 949 puntos emitidos en una semana—: «no las
 * quiero así, las quiero de 6:00 am a 11:00 pm».
 *
 * §8.8: la hora límite decide si una persona sale «a tiempo» o «vencida». Es
 * un número de una persona, y por eso lleva pruebas.
 *
 * ─── LO QUE ESTE ARCHIVO EXISTE PARA IMPEDIR ──────────────────────────────
 *
 *  1. QUE UNA TAREA SE QUEDE CON SU HORA VIEJA. Son 50 en el catálogo; basta
 *     que una conserve las 18:00 para que esa plaza tenga un reloj distinto
 *     al de la de al lado, sin que nadie lo vea hasta que alguien reclame.
 *     Por eso la aserción recorre el catálogo entero y NOMBRA a la que se
 *     salga, en vez de contar cuántas hay.
 *
 *  2. QUE LA APERTURA SIGA SALIÉNDOSE POR SU PUERTA. Hasta hoy NO usaba la
 *     hora del catálogo: `armarChecklist` la sobreescribía con la hora real a
 *     la que abre cada tienda. Eran 1 087 de los 1 477 puntos de apertura de
 *     la semana. El caso de abajo usa un fixture que SÍ ejerce esa rama —y lo
 *     comprueba llamando a `limiteAperturaDe` directamente— porque una
 *     sucursal sin horario capturado daría 23:00 por el camino equivocado y
 *     la prueba pasaría sin tocar el mecanismo (§8.11 c).
 *
 *  3. QUE EL DÍA QUE ALGUIEN ENCIENDA LOS TURNOS SE APAGUE LA EMISIÓN ENTERA.
 *     `rutinaPermitidaEnTurno` deja pasar de balde a las tareas que valen
 *     EXACTAMENTE '23:59'; con 23:00 ese escape ya no aplica, y 23:00 cae
 *     fuera de los dos turnos configurados (06:00-14:30 y 09:00-17:30). Sin
 *     la guarda del emisor, encender el interruptor dejaría a todo el mundo
 *     en cero — sin error y sin log, igual que un día sin trabajo (§5.2).
 */
import { MANUALES_POR_PUESTO, VENTANA_MANUAL } from './tareas-manual.catalogo';
import { armarChecklist, planDeEntregas } from './emision-manual.util';
import { HorarioSucursal, limiteAperturaDe } from './horarios-sucursal.util';
import { TareaDePuesto } from './tareas-puesto.util';

// 14/sep/2026 es LUNES. Constructor local, no un ISO: un ISO se interpreta en
// UTC y en México caería el día anterior.
const LUNES = new Date(2026, 8, 14, 10, 0, 0);

/** Un horario de RH real para Canindo: entrada 08:30, o sea que la regla vieja
 *  habría fijado la apertura cerca de las 09:00, NO a las 23:00. */
const HORARIOS_CANINDO: HorarioSucursal[] = [{
  sucursal_id: 'zamora-canindo', area_id: null, nombre: 'General',
  dias: [1, 2, 3, 4, 5, 6], entrada: '08:30',
  inicio_comida: null, fin_comida: null, salida: '17:30', tolerancia_min: 10,
}];

function tareaDe(puestoId: string, momento: string) {
  const m = MANUALES_POR_PUESTO.find(x => x.puestoIds.includes(puestoId));
  return m?.tareas.find(t => t.momento === momento);
}

describe('la ventana del manual: 06:00 a 23:00', () => {

  it('es 06:00 a 23:00, fijado contra el literal que pidió David', () => {
    // Si esto falla no se "actualiza el esperado": es la instrucción.
    expect(VENTANA_MANUAL.inicio).toBe('06:00');
    expect(VENTANA_MANUAL.fin).toBe('23:00');
  });

  it('TODAS las tareas del catálogo vencen a la misma hora', () => {
    const tareas = MANUALES_POR_PUESTO.flatMap(m => m.tareas);

    // El cero de abajo no vale sin su denominador (§8.11 a): con el catálogo
    // vacío, «0 tareas con otra hora» sería verdad y no probaría nada.
    expect(tareas.length).toBeGreaterThan(40);

    const fuera = tareas
      .filter(t => t.horaLimite !== VENTANA_MANUAL.fin)
      .map(t => t.id + ' -> ' + t.horaLimite);
    expect(fuera).toEqual([]);
  });

  it('ninguna conserva las cinco horas viejas (12:00, 18:00, 19:00, 23:59)', () => {
    const viejas = ['12:00', '18:00', '19:00', '23:59'];
    const restos = MANUALES_POR_PUESTO.flatMap(m => m.tareas)
      .filter(t => viejas.includes(t.horaLimite))
      .map(t => t.id + ' -> ' + t.horaLimite);
    expect(restos).toEqual([]);
  });
});

describe('la ventana en el checklist que se emite', () => {

  it('el punto nace con hora de INICIO, que hasta hoy era null en los 377', () => {
    const tarea = tareaDe('cajero-sucursal', 'apertura')!;
    expect(tarea).toBeTruthy();

    const ck = armarChecklist({
      checklistId: 'man_x', tarea, puestoId: 'cajero-sucursal',
      sucursal: 'Canindo', destinatario: 'Ana Pérez', destinatarioUid: 'u1',
      fechaYmd: '2026-09-14',
    }, []);

    expect(ck.items.length).toBeGreaterThan(0);
    expect(ck.items.every((it: any) => it.horaInicio === '06:00')).toBe(true);
    expect(ck.items.every((it: any) => it.horaLimite === '23:00')).toBe(true);
    expect(ck.time).toBe('23:00');
  });

  it('LA APERTURA YA NO SALE DEL HORARIO DE RH — y el fixture lo ejerce', () => {
    // ⚠ El control que hace válida a la aserción de abajo. Sin él, una
    // sucursal sin horario capturado daría 23:00 porque la rama vieja devuelve
    // null, y la prueba pasaría por el camino equivocado.
    const vieja = limiteAperturaDe('Canindo', HORARIOS_CANINDO);
    expect(vieja).toBeTruthy();
    expect(vieja!.hora).not.toBe('23:00');   // la regla vieja daba otra cosa

    const tarea = tareaDe('encargado-sucursal', 'apertura')!;
    expect(tarea).toBeTruthy();

    const ck = armarChecklist({
      checklistId: 'man_y', tarea: tarea!, puestoId: 'encargado-sucursal',
      sucursal: 'Canindo', destinatario: 'Ana Pérez', destinatarioUid: 'u1',
      fechaYmd: '2026-09-14',
    }, HORARIOS_CANINDO);

    expect(ck.time).toBe('23:00');
    expect(ck.items.every((it: any) => it.horaLimite === '23:00')).toBe(true);
  });
});

describe('la guarda de turnos: encenderlos no puede apagar la emisión', () => {

  const TURNOS: any = {
    habilitado: true,
    horarios: {
      manana: { inicio: '06:00', fin: '14:30' },
      tarde: { inicio: '09:00', fin: '17:30' },
    },
    grupoManana: [{ uid: 'u_ana', nombre: 'Ana Pérez' }],
    grupoTarde: [],
    semanaBase: '2026-09-14', rotacionAutomatica: false, excepciones: [],
  };

  // ⚠ LOS CAMPOS VAN PLANOS, NO DENTRO DE `datos`. Al escribir esto los puse
  // en `datos` —que es como viven en la columna jsonb— y el plan devolvió CERO
  // entregas: `sucursalesDe` lee `u.sucursales`, así que la cajera salía «sin
  // sucursal». Ese cero se lee igual que «la guarda de turnos no funciona», y
  // es la trampa del 19 y el 20/sep otra vez: un fixture con una forma que el
  // sistema no produce no solo deja de encontrar defectos, FABRICA uno.
  function planCon(extra: any = {}) {
    return planDeEntregas({
      usuarios: [{
        id: 'u_ana', uid: 'u_ana', nombre: 'Ana Pérez',
        rol: 'trabajador', activo: true,
        puestoId: 'cajero-sucursal', sucursales: ['Canindo'],
      }],
      fecha: LUNES, horarios: [], descansosSemana: [],
      idsExistentes: new Set<string>(), configTurnos: TURNOS, ...extra,
    });
  }

  it('con los turnos ENCENDIDOS entrega LO MISMO que con ellos apagados', () => {
    // 23:00 está fuera de su turno (06:00-14:30). Sin la guarda de
    // `ventanaCompleta` esto daría CERO entregas, con el motivo «la hora de
    // esas tareas cae fuera de su turno» — para TODAS las tareas del puesto.
    //
    // La aserción compara las dos corridas en vez de exigir «> 0», y esa es la
    // diferencia entre medir el mecanismo y medir que algo salga: con turnos
    // apagados el fixture SIEMPRE entrega, así que un «> 0» a secas no
    // distinguiría la guarda funcionando de la guarda ausente (§8.11 c).
    const apagados = planCon({ configTurnos: null });
    const encendidos = planCon();

    expect(apagados.entregas.length).toBeGreaterThan(0);   // el fixture entrega
    expect(encendidos.entregas.length).toBe(apagados.entregas.length);
    expect(encendidos.omitidos.map(o => o.motivo))
      .not.toContain('la hora de esas tareas cae fuera de su turno');
  });

  it('CONTROL: la guarda no es un pase universal — una hora propia sí se filtra', () => {
    // Una tarea capturada a las 18:00 no cubre el turno de mañana, así que el
    // filtro tiene que seguir actuando sobre ella. Si esto pasara, la guarda
    // habría desactivado el filtro entero en vez de exceptuar la ventana.
    const capturada: TareaDePuesto = {
      id: 'tp-control', puestoId: 'cajero-sucursal', nombre: 'Control 18:00',
      momento: 'operacion', frecuencia: 'Diaria', horaLimite: '18:00',
      documento: 'Prueba', version: '0.1', vigente: true,
      items: [{ texto: 'punto de control' } as any],
    };
    const conTurnos = planCon({ tareasDeclaradas: [capturada] });
    const sinTurnos = planCon({ tareasDeclaradas: [capturada], configTurnos: null });

    // Sin turnos la capturada SÍ se entrega: eso prueba que el fixture la
    // produce y que su ausencia de arriba es el filtro actuando, no un dato
    // que nunca llegó.
    expect(sinTurnos.entregas.map(e => e.payload?._tareaManualId)).toContain('tp-control');
    expect(conTurnos.entregas.map(e => e.payload?._tareaManualId)).not.toContain('tp-control');
    expect(conTurnos.entregas.length).toBeGreaterThan(0);   // las del manual, dentro
  });
});
