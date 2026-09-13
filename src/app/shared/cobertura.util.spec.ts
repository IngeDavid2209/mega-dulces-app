/**
 * 👥 QUIÉN CUBRE QUÉ PLAZA — las pruebas
 *
 * §8.8. Esta regla decide **de quién es cada evidencia**: el día que el acceso
 * sea por plaza, lo que diga `coberturaDelDia` es el nombre que va a quedar
 * detrás de cada foto. Equivocarse aquí no produce un número feo — produce un
 * registro que dice que trabajó alguien que no estuvo.
 *
 * ─── LOS DOS CASOS QUE ESTE ARCHIVO EXISTE PARA FIJAR ─────────────────────
 *  1. LA SUPLENCIA GANA AL TITULAR. Si mandara el titular, la evidencia de un
 *     día de suplencia quedaría firmada por quien no fue. Eso es
 *     `verificado_falso` (§4) fabricado por el propio software.
 *  2. `hueco` NO ES `sin_asignar`. Una sucursal que declara sus huecos hace el
 *     trabajo bien; una que nunca pasa lista, no. Si se pintaran igual, la
 *     primera saldría peor que la segunda.
 */
import {
  coberturaVigenteEn, coberturaDelDia, pasarLista, resumenDelDia,
  planDePlazas, idPlaza, nombrePlaza, plazaDeTemporada,
  planDeAsignacion, diaAnterior,
  Plaza, Cobertura,
} from './cobertura.util';

const LUGAR = 'Padre Hidalgo';

function plaza(puestoId: string, numero: number | null, extra: Partial<Plaza> = {}): Plaza {
  return {
    id: numero == null ? `${LUGAR}::${puestoId}::x` : idPlaza(LUGAR, puestoId, numero),
    puestoId, lugar: LUGAR, numero, vigente: true, ...extra,
  };
}

function cob(plazaId: string, uid: string | null, tipo: Cobertura['tipo'],
             desde: string, hasta: string | null = null, extra: Partial<Cobertura> = {}): Cobertura {
  return { id: `${plazaId}|${tipo}|${desde}`, plazaId, uid, tipo, desde, hasta, ...extra };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('vigencia de una cobertura', () => {

  const c = cob('p1', 'u1', 'titular', '2026-09-01', '2026-09-30');

  it('dentro de su ventana, vigente; fuera, no', () => {
    expect(coberturaVigenteEn(c, '2026-09-15')).toBe(true);
    expect(coberturaVigenteEn(c, '2026-09-01')).toBe(true);   // el día de inicio cuenta
    expect(coberturaVigenteEn(c, '2026-09-30')).toBe(true);   // y el de fin también
    expect(coberturaVigenteEn(c, '2026-08-31')).toBe(false);
    expect(coberturaVigenteEn(c, '2026-10-01')).toBe(false);
  });

  it('sin `hasta` sigue abierta hacia el futuro', () => {
    const abierta = cob('p1', 'u1', 'titular', '2026-09-01', null);
    expect(coberturaVigenteEn(abierta, '2027-05-01')).toBe(true);
    expect(coberturaVigenteEn(abierta, '2026-08-31')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('quién cubre la plaza hoy', () => {

  it('LA SUPLENCIA GANA AL TITULAR: la evidencia de ese día NO se firma con quien no fue', () => {
    const cs = [
      cob('p1', 'titu', 'titular', '2026-01-01', null),
      cob('p1', 'supl', 'suplencia', '2026-09-13', '2026-09-13'),
    ];
    expect(coberturaDelDia(cs, 'p1', '2026-09-13')!.uid).toBe('supl');
    // Y al día siguiente vuelve el titular, sin que nadie tenga que cerrar nada.
    expect(coberturaDelDia(cs, 'p1', '2026-09-14')!.uid).toBe('titu');
  });

  it('entre dos del mismo tipo gana la que empezó después', () => {
    const cs = [
      cob('p1', 'vieja', 'titular', '2026-01-01', null),
      cob('p1', 'nueva', 'titular', '2026-06-01', null),
    ];
    expect(coberturaDelDia(cs, 'p1', '2026-09-13')!.uid).toBe('nueva');
  });

  it('con mismo tipo y misma fecha el resultado es ESTABLE: dos corridas dan lo mismo', () => {
    // No importa cuál gane; importa que no cambie entre corridas. Es la lección
    // del `limit 1` sin `order by` de api/login.js, que hacía entrar a una
    // persona a dos cuentas distintas según el día.
    //
    // OJO CON EL FIXTURE, que en el primer intento estaba mal y la prueba lo
    // cazó: el helper `cob` arma el id con plaza+tipo+desde, así que estas dos
    // salían con EL MISMO id —imposible en la base, donde `id` es primary key—
    // y el desempate se quedaba sin nada por lo que desempatar. El caso real es
    // éste: dos filas distintas, con ids distintos, empatadas en todo lo demás.
    const a = { ...cob('p1', 'aaa', 'titular', '2026-06-01', null), id: 'cob-a' };
    const b = { ...cob('p1', 'bbb', 'titular', '2026-06-01', null), id: 'cob-b' };
    const r1 = coberturaDelDia([a, b], 'p1', '2026-09-13')!.uid;
    const r2 = coberturaDelDia([b, a], 'p1', '2026-09-13')!.uid;
    expect(r1).toBe(r2);
  });

  it('no mezcla plazas', () => {
    const cs = [cob('p1', 'u1', 'titular', '2026-01-01', null)];
    expect(coberturaDelDia(cs, 'p2', '2026-09-13')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('el pase de lista del día', () => {

  const plazas = [
    plaza('anaquelista', 1), plaza('anaquelista', 2),
    plaza('anaquelista', 3), plaza('anaquelista', 4),
    plaza('encargado-sucursal', 1),
  ];
  const HOY = '2026-09-13';
  const coberturas = [
    cob(idPlaza(LUGAR, 'anaquelista', 1), 'ana', 'titular', '2026-01-01', null),
    cob(idPlaza(LUGAR, 'anaquelista', 2), 'beto', 'titular', '2026-01-01', null),
    cob(idPlaza(LUGAR, 'anaquelista', 3), null, 'hueco', HOY, HOY, { motivo: 'incapacidad' }),
    cob(idPlaza(LUGAR, 'encargado-sucursal', 1), 'claudia', 'titular', '2026-01-01', null),
    // La plaza 4 no tiene nada: nadie ha dicho nada de ella.
  ];

  const lista = pasarLista(plazas, coberturas, HOY);

  it('devuelve TODAS las plazas, incluidas las que nadie ha tocado', () => {
    expect(lista.length).toBe(5);
  });

  it('EL HUECO Y EL SIN ASIGNAR NO SE CONFUNDEN', () => {
    // El caso central. Declarar un hueco es hacer el trabajo; no pasar lista no
    // lo es. Si los dos se vieran igual, la sucursal que lo hace bien saldría
    // peor que la que no hace nada.
    const tres = lista.find(x => x.plaza.numero === 3 && x.plaza.puestoId === 'anaquelista')!;
    const cuatro = lista.find(x => x.plaza.numero === 4)!;
    expect(tres.estado).toBe('hueco');
    expect(tres.motivo).toBe('incapacidad');
    expect(cuatro.estado).toBe('sin_asignar');
    expect(cuatro.cobertura).toBeNull();
  });

  it('una suplencia se ve como suplencia, no como cobertura normal', () => {
    const conSupl = pasarLista(plazas, [
      ...coberturas,
      cob(idPlaza(LUGAR, 'anaquelista', 1), 'supl', 'suplencia', HOY, HOY),
    ], HOY);
    const p1 = conSupl.find(x => x.plaza.numero === 1 && x.plaza.puestoId === 'anaquelista')!;
    expect(p1.estado).toBe('suplencia');
    expect(p1.uid).toBe('supl');
  });

  it('una cobertura de persona SIN uid no cuenta como cubierta', () => {
    // Un dato a medio capturar no puede parecer un dato completo.
    const rota = pasarLista([plaza('cajero-sucursal', 1)],
      [cob(idPlaza(LUGAR, 'cajero-sucursal', 1), null, 'titular', '2026-01-01', null)], HOY);
    expect(rota[0].estado).toBe('sin_asignar');
  });

  it('las plazas retiradas no aparecen', () => {
    const conRetirada = pasarLista(
      [...plazas, plaza('vigilancia', 1, { vigente: false })], coberturas, HOY);
    expect(conRetirada.length).toBe(5);
  });

  it('ordena por puesto y luego por número: el orden de la cuadrilla', () => {
    const anaq = lista.filter(x => x.plaza.puestoId === 'anaquelista').map(x => x.plaza.numero);
    expect(anaq).toEqual([1, 2, 3, 4]);
  });

  it('el resumen cuadra y separa los cuatro estados', () => {
    const r = resumenDelDia(lista);
    expect(r.plazas).toBe(5);
    expect(r.cubiertas).toBe(3);
    expect(r.huecos).toBe(1);
    expect(r.sinAsignar).toBe(1);
    expect(r.cubiertas + r.suplencias + r.huecos + r.sinAsignar).toBe(r.plazas);
  });

  it('DETECTA a una persona puesta en dos plazas el mismo día', () => {
    // Su evidencia contaría dos veces y una de las dos plazas está sola en
    // realidad: es el defecto que la plaza vino a romper, entrando por la
    // puerta de la cobertura.
    const dobles = pasarLista(plazas, [
      cob(idPlaza(LUGAR, 'anaquelista', 1), 'ana', 'titular', '2026-01-01', null),
      cob(idPlaza(LUGAR, 'anaquelista', 2), 'ana', 'titular', '2026-01-01', null),
    ], HOY);
    expect(resumenDelDia(dobles).duplicadas).toEqual(['ana']);
  });

  it('GUARDIA: la muestra discrimina los cuatro estados', () => {
    const conSupl = pasarLista(plazas, [
      ...coberturas, cob(idPlaza(LUGAR, 'anaquelista', 2), 'supl', 'suplencia', HOY, HOY),
    ], HOY);
    const estados = new Set(conSupl.map(x => x.estado));
    expect(estados.size).withContext('la muestra dejó de discriminar').toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('generar las plazas desde la plantilla', () => {

  it('con la plantilla de David y cero plazas, crea las cuatro numeradas', () => {
    const plan = planDePlazas(LUGAR, [{ puestoId: 'anaquelista', cantidad: 4 }], []);
    expect(plan.crear.length).toBe(4);
    expect(plan.crear.map(p => p.numero)).toEqual([1, 2, 3, 4]);
    expect(plan.crear[0].id).toBe('Padre Hidalgo::anaquelista::1');
    expect(plan.retirar.length).toBe(0);
  });

  it('EL NÚMERO SALE DE LA AUTORIZACIÓN, NO DE LA GENTE', () => {
    // Las cuatro plazas existen antes de que haya una sola persona. Quién es el
    // Anaquelista 1 lo decide la Encargada al asignar. Por eso aquí no entra
    // ningún usuario: si esta función necesitara la nómina, estaría inventando
    // la cuadrilla (§8.5).
    const plan = planDePlazas(LUGAR, [{ puestoId: 'anaquelista', cantidad: 2 }], []);
    expect(plan.crear.every(p => p.numero != null)).toBe(true);
    expect(plan.crear.every(p => p.ambito == null && p.turno == null)).toBe(true);
  });

  it('RELLENA EL HUECO en vez de continuar la serie', () => {
    // Con 1, 2 y 4 existentes y plantilla de cuatro, falta LA 3. Continuar la
    // serie dejaría 1, 2, 4, 5 tras una sola baja, y a los dos meses los
    // números no significarían nada.
    const actuales = [plaza('anaquelista', 1), plaza('anaquelista', 2), plaza('anaquelista', 4)];
    const plan = planDePlazas(LUGAR, [{ puestoId: 'anaquelista', cantidad: 4 }], actuales);
    expect(plan.crear.length).toBe(1);
    expect(plan.crear[0].numero).toBe(3);
  });

  it('cuando sobran, las PROPONE para retirar y no borra nada', () => {
    const actuales = [plaza('anaquelista', 1), plaza('anaquelista', 2), plaza('anaquelista', 3)];
    const plan = planDePlazas(LUGAR, [{ puestoId: 'anaquelista', cantidad: 2 }], actuales);
    expect(plan.crear.length).toBe(0);
    expect(plan.retirar.map(p => p.numero)).toEqual([3]);
  });

  it('un puesto con plazas y SIN plantilla no se toca: ni se crea ni se retira', () => {
    // Nadie ha autorizado un número. Retirarlas por eso dejaría gente sin sitio
    // por un dato que falta (§5.2).
    const actuales = [plaza('cajero-sucursal', 1), plaza('cajero-sucursal', 2)];
    const plan = planDePlazas(LUGAR, [{ puestoId: 'anaquelista', cantidad: 1 }], actuales);
    expect(plan.retirar.length).toBe(0);
    expect(plan.sinPlantilla).toEqual(['cajero-sucursal']);
    expect(plan.crear.length).toBe(1);
  });

  it('una plantilla en CERO sí retira: es una decisión, no un hueco de datos', () => {
    const plan = planDePlazas(LUGAR, [{ puestoId: 'vigilancia', cantidad: 0 }],
      [plaza('vigilancia', 1)]);
    expect(plan.retirar.length).toBe(1);
  });

  it('cuando ya cuadra, no propone nada', () => {
    const actuales = [plaza('anaquelista', 1), plaza('anaquelista', 2)];
    const plan = planDePlazas(LUGAR, [{ puestoId: 'anaquelista', cantidad: 2 }], actuales);
    expect(plan.crear.length).toBe(0);
    expect(plan.retirar.length).toBe(0);
  });

  it('ignora las plazas de OTRO lugar', () => {
    const ajena = { ...plaza('anaquelista', 1), lugar: 'Canindo', id: 'Canindo::anaquelista::1' };
    const plan = planDePlazas(LUGAR, [{ puestoId: 'anaquelista', cantidad: 1 }], [ajena]);
    expect(plan.crear.length).toBe(1);
  });

  it('y las retiradas: una plaza retirada deja su número libre', () => {
    const actuales = [plaza('anaquelista', 1), plaza('anaquelista', 2, { vigente: false })];
    const plan = planDePlazas(LUGAR, [{ puestoId: 'anaquelista', cantidad: 2 }], actuales);
    expect(plan.crear.map(p => p.numero)).toEqual([2]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('cómo se llama una plaza', () => {

  it('«Anaquelista 2», que es lo que David pidió', () => {
    expect(nombrePlaza('Anaquelista de Sucursal', 2)).toBe('Anaquelista de Sucursal 2');
  });

  it('SIN número no inventa un 1', () => {
    // Ponerle uno aquí sería fabricar la cuadrilla en la capa de presentación,
    // que es el peor sitio para inventar un dato: nadie lo audita.
    expect(nombrePlaza('Anaquelista de Sucursal', null)).toBe('Anaquelista de Sucursal');
  });

  it('reconoce una plaza de temporada por su puesto', () => {
    expect(plazaDeTemporada(plaza('tmp-edecan-abc', 1))).toBe(true);
    expect(plazaDeTemporada(plaza('anaquelista', 1))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('el día anterior', () => {

  it('resta un día', () => {
    expect(diaAnterior('2026-09-13')).toBe('2026-09-12');
  });

  it('cruza el cambio de mes y el de año', () => {
    expect(diaAnterior('2026-09-01')).toBe('2026-08-31');
    expect(diaAnterior('2026-01-01')).toBe('2025-12-31');
  });

  it('cruza un 1 de marzo de año bisiesto', () => {
    // 2028 es bisiesto. Escrito a mano esto sale mal la mitad de las veces.
    expect(diaAnterior('2028-03-01')).toBe('2028-02-29');
    expect(diaAnterior('2026-03-01')).toBe('2026-02-28');
  });

  it('una fecha que no es fecha se devuelve tal cual, sin inventar', () => {
    expect(diaAnterior('13/09/2026')).toBe('13/09/2026');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('asignar: qué se escribe', () => {

  const P = idPlaza(LUGAR, 'anaquelista', 1);
  const HOY = '2026-09-13';

  it('un TITULAR nuevo cierra al anterior EL DÍA ANTES, no el mismo', () => {
    // Si las dos cubrieran el 13, ese día tendría dos responsables — el §5.2 lo
    // prohíbe, y además el índice único de la 056 solo impide dos ABIERTAS.
    const previa = cob(P, 'vieja', 'titular', '2026-01-01', null);
    const plan = planDeAsignacion(P, 'nueva', 'titular', HOY, [previa], { ahora: 1000 });
    expect(plan.cerrar).toEqual([{ id: previa.id, hasta: '2026-09-12' }]);
    expect(plan.crear.length).toBe(1);
    expect(plan.crear[0].uid).toBe('nueva');
    expect(plan.crear[0].hasta).toBeNull();   // queda abierta
  });

  it('y el resultado NO deja dos coberturas vivas el mismo día', () => {
    // La comprobación de verdad: se aplica el plan y se vuelve a preguntar.
    const previa = cob(P, 'vieja', 'titular', '2026-01-01', null);
    const plan = planDeAsignacion(P, 'nueva', 'titular', HOY, [previa], { ahora: 1000 });
    const aplicado = [
      { ...previa, hasta: plan.cerrar[0].hasta },
      ...plan.crear,
    ];
    expect(coberturaDelDia(aplicado, P, '2026-09-12')!.uid).toBe('vieja');
    expect(coberturaDelDia(aplicado, P, HOY)!.uid).toBe('nueva');
  });

  it('asignar a quien YA es titular no escribe nada (un doble clic no parte su historia)', () => {
    const previa = cob(P, 'ana', 'titular', '2026-01-01', null);
    const plan = planDeAsignacion(P, 'ana', 'titular', HOY, [previa]);
    expect(plan.crear.length).toBe(0);
    expect(plan.cerrar.length).toBe(0);
    expect(plan.sinCambios).toContain('ya es la titular');
  });

  it('una SUPLENCIA no cierra al titular: al día siguiente vuelve solo', () => {
    const titular = cob(P, 'ana', 'titular', '2026-01-01', null);
    const plan = planDeAsignacion(P, 'supl', 'suplencia', HOY, [titular], { ahora: 1000 });
    expect(plan.cerrar.length).toBe(0);
    const aplicado = [titular, ...plan.crear];
    expect(coberturaDelDia(aplicado, P, HOY)!.uid).toBe('supl');
    expect(coberturaDelDia(aplicado, P, '2026-09-14')!.uid).toBe('ana');
  });

  it('un HUECO es un dato con motivo, y tampoco cierra al titular', () => {
    const titular = cob(P, 'ana', 'titular', '2026-01-01', null);
    const plan = planDeAsignacion(P, null, 'hueco', HOY, [titular],
      { motivo: 'incapacidad', ahora: 1000 });
    expect(plan.crear[0].uid).toBeNull();
    expect(plan.crear[0].motivo).toBe('incapacidad');
    const aplicado = [titular, ...plan.crear];
    expect(pasarLista([plaza('anaquelista', 1)], aplicado, HOY)[0].estado).toBe('hueco');
    expect(pasarLista([plaza('anaquelista', 1)], aplicado, '2026-09-14')[0].estado).toBe('cubierta');
  });

  it('CORREGIR ES UN EVENTO NUEVO: la segunda suplencia del día gana a la primera', () => {
    // §5.5: nada se sobrescribe. Si mandara la primera, para corregir habría que
    // BORRAR la fila mala, que es justo lo prohibido.
    const primera = { ...cob(P, 'equivocada', 'suplencia', HOY, HOY), creadaEn: 1000 };
    const plan = planDeAsignacion(P, 'correcta', 'suplencia', HOY, [primera], { ahora: 2000 });
    expect(plan.crear.length).toBe(1);
    const aplicado = [primera, ...plan.crear];
    expect(coberturaDelDia(aplicado, P, HOY)!.uid).toBe('correcta');
  });

  it('la misma suplencia dos veces no se duplica', () => {
    const ya = { ...cob(P, 'supl', 'suplencia', HOY, HOY), creadaEn: 1000 };
    const plan = planDeAsignacion(P, 'supl', 'suplencia', HOY, [ya]);
    expect(plan.crear.length).toBe(0);
    expect(plan.sinCambios).toContain('ya está puesta');
  });

  it('sin persona y sin ser hueco, no escribe nada y lo DICE', () => {
    const plan = planDeAsignacion(P, null, 'titular', HOY, []);
    expect(plan.crear.length).toBe(0);
    expect(plan.sinCambios).toContain('Falta elegir');
  });

  it('sobre una plaza sin historia, el titular se abre sin cerrar nada', () => {
    const plan = planDeAsignacion(P, 'ana', 'titular', HOY, [], { ahora: 1000 });
    expect(plan.cerrar.length).toBe(0);
    expect(plan.crear.length).toBe(1);
  });

  it('GUARDIA: los tres tipos producen escrituras DISTINTAS', () => {
    // Si los tres devolvieran lo mismo, la mitad de los casos de arriba pasaría
    // igual y nadie lo notaría.
    const t = planDeAsignacion(P, 'u', 'titular', HOY, [], { ahora: 1 }).crear[0];
    const s = planDeAsignacion(P, 'u', 'suplencia', HOY, [], { ahora: 1 }).crear[0];
    const h = planDeAsignacion(P, null, 'hueco', HOY, [], { ahora: 1 }).crear[0];
    expect(new Set([t.tipo, s.tipo, h.tipo]).size).toBe(3);
    expect(t.hasta).toBeNull();
    expect(s.hasta).toBe(HOY);
    expect(h.uid).toBeNull();
  });
});
