/**
 * 🧩 LA PLANTILLA CONTRA EL CENSO
 *
 * §8.8: toda regla que produzca un número de una persona lleva prueba. Ésta
 * produce dos que nadie había podido calcular nunca —VACANTES y EXCEDENTE— y
 * los dos tienen consecuencias inmediatas sobre gente real: una vacante es una
 * contratación, y un excedente es una conversación incómoda. Equivocarse aquí
 * no produce un tablero feo: produce una decisión de personal equivocada.
 *
 * ─── EL CASO CENTRAL ES EL DE DAVID, LITERAL ──────────────────────────────
 * «la sucursal de Padre Hidalgo debe tener cuatro anaquelistas, dos bodegueros,
 * dos surtidores, una encargada, una auxiliar de encargada» (13/sep/2026),
 * cruzado con lo que el guardián de duplicados midió el 31/ago en esa misma
 * sucursal: anaquelista × 5, cajero × 3, surtidor-ventas × 2.
 *
 * De ese cruce sale el primer hallazgo de la sección antes de existir: él dice
 * CUATRO anaquelistas y hay CINCO, y de los tres cajeros no dijo nada.
 *
 * ─── LA DISTINCIÓN QUE ESTA PRUEBA DEFIENDE ───────────────────────────────
 * `sin_plantilla` NO es `excedente`. Los tres cajeros de Padre Hidalgo no
 * sobran: nadie ha dicho todavía cuántos debe haber. Si el código los contara
 * como excedente, la pantalla estaría acusando a tres personas de sobrar por un
 * dato que falta. Es el invariante §5.2 en su forma más cara.
 *
 * ─── LOS VALORES DE MANUAL NO SE ESCRIBIERON A OJO ────────────────────────
 * `anaquelista`, `encargado-sucursal`, `bodeguero-sucursal` y
 * `almacenista-sucursal` SÍ tienen manual; `auxiliar-encargado`,
 * `surtidor-ventas` y `surtidor-sucursal` NO. Verificado contra
 * `MANUALES_POR_PUESTO` antes de escribir las aserciones (19 puestos con manual
 * de los 89 del organigrama).
 */
import {
  compararPlantilla, resumenPlantilla, revisarDeclaracion, idDeclarado,
  declaracionVigente, esPuestoDeclarado, PREFIJO_DECLARADO,
  RenglonPlantilla, PuestoDeclarado,
} from './plantilla.util';

// ───────────────────────────────────────────────────────────────────────────
//  El caso de Padre Hidalgo, tal como lo dictó David y como lo midió el 31/ago
// ───────────────────────────────────────────────────────────────────────────
const PLANTILLA_PADRE_HIDALGO: RenglonPlantilla[] = [
  { puestoId: 'anaquelista',         cantidad: 4 },
  { puestoId: 'bodeguero-sucursal',  cantidad: 2 },
  { puestoId: 'surtidor-ventas',     cantidad: 2 },
  { puestoId: 'encargado-sucursal',  cantidad: 1 },
  { puestoId: 'auxiliar-encargado',  cantidad: 1 },
];

const CENSO_PADRE_HIDALGO = new Map<string, number>([
  ['anaquelista',        5],   // uno MÁS de los autorizados
  ['bodeguero-sucursal', 2],   // cuadra
  ['surtidor-ventas',    2],   // cuadra
  ['encargado-sucursal', 1],   // cuadra
  ['auxiliar-encargado', 0],   // vacante
  ['cajero-sucursal',    3],   // nadie dijo cuántos debe haber
]);

function fila(filas: any[], puestoId: string) {
  return filas.find(f => f.puestoId === puestoId);
}

// ═══════════════════════════════════════════════════════════════════════════
describe('plantilla contra censo: el caso de Padre Hidalgo', () => {

  const filas = compararPlantilla(PLANTILLA_PADRE_HIDALGO, CENSO_PADRE_HIDALGO);

  it('el anaquelista de más sale como EXCEDENTE de uno, no como incumplimiento', () => {
    const f = fila(filas, 'anaquelista');
    expect(f.autorizado).toBe(4);
    expect(f.ocupado).toBe(5);
    expect(f.excedente).toBe(1);
    expect(f.vacantes).toBe(0);
    expect(f.estado).toBe('excedente');
  });

  it('la auxiliar de encargada que falta sale como VACANTE, aunque no haya nadie', () => {
    // Es el renglón que hoy no existe en ninguna pantalla: un puesto autorizado
    // con cero personas es invisible si solo se mira el censo.
    const f = fila(filas, 'auxiliar-encargado');
    expect(f.autorizado).toBe(1);
    expect(f.ocupado).toBe(0);
    expect(f.vacantes).toBe(1);
    expect(f.estado).toBe('vacante');
  });

  it('LOS TRES CAJEROS NO SOBRAN: nadie ha dicho cuántos debe haber', () => {
    // El caso que más importa. Si esto dijera `excedente: 3`, la pantalla
    // estaría acusando a tres personas de sobrar por un dato que falta (§5.2).
    const f = fila(filas, 'cajero-sucursal');
    expect(f.autorizado).toBeNull();
    expect(f.ocupado).toBe(3);
    expect(f.excedente).toBe(0);
    expect(f.vacantes).toBe(0);
    expect(f.estado).toBe('sin_plantilla');
  });

  it('lo que cuadra, cuadra', () => {
    for (const p of ['bodeguero-sucursal', 'surtidor-ventas', 'encargado-sucursal']) {
      expect(fila(filas, p).estado).withContext(p).toBe('cuadra');
    }
  });

  it('aparecen los dos lados: nadie se pierde por estar solo en uno', () => {
    // 5 puestos de la plantilla + el cajero que solo está en el censo.
    expect(filas.length).toBe(6);
  });

  it('marca los puestos que NO van a recibir tareas por no tener manual', () => {
    // ⚠ CAMBIADO A MANO EL 21/sep/2026, y el motivo importa: `auxiliar-encargado`
    // DEJO de estar sin manual. Por instruccion de David se le dieron las mismas
    // tareas que al Encargado, compartiendo el documento en vez de escribir uno
    // segundo. Estas dos aserciones estaban en rojo al aplicar el cambio: son el
    // control positivo de que el puesto empezo a recibir, y se corrigen aqui en
    // el mismo commit que lo provoca en vez de aflojarlas.
    expect(fila(filas, 'auxiliar-encargado').sinManual).toBe(false);
    expect(fila(filas, 'surtidor-ventas').sinManual).toBe(true);
    expect(fila(filas, 'anaquelista').sinManual).toBe(false);
    expect(fila(filas, 'encargado-sucursal').sinManual).toBe(false);
  });

  it('ordena por lo que pide acción: vacantes primero, sin_plantilla al final', () => {
    expect(filas[0].estado).toBe('vacante');
    expect(filas[1].estado).toBe('excedente');
    expect(filas[filas.length - 1].estado).toBe('sin_plantilla');
  });

  it('el resumen NO mezcla lo autorizado con lo que nadie capturó', () => {
    const r = resumenPlantilla(filas);
    expect(r.autorizados).toBe(10);      // 4+2+2+1+1, sin los 3 cajeros
    expect(r.ocupados).toBe(13);         // todas las personas, cajeros incluidos
    expect(r.vacantes).toBe(1);
    expect(r.excedente).toBe(1);
    expect(r.sinPlantilla).toBe(1);      // el renglón del cajero
    // Escribí 3 y midió 2. Antes de cambiar el esperado lo derivé del catálogo
    // (§8.11): `cajero-sucursal` SÍ tiene manual —está entre los 19—, así que
    // los únicos sin manual aquí son `auxiliar-encargado` y `surtidor-ventas`.
    // El 2 es lo correcto y mi 3 era el error.
    //
    // 21/sep/2026: BAJA A 1. `auxiliar-encargado` ya tiene manual (comparte el
    // del Encargado), así que el único sin manual de esta muestra es
    // `surtidor-ventas`. Derivado del catálogo otra vez, no ajustado al
    // resultado: el manual del Encargado declara `puestoIds: ['encargado-
    // sucursal', 'auxiliar-encargado']`.
    expect(r.sinManual).toBe(1);
  });

  it('GUARDIA: la muestra discrimina los cuatro estados', () => {
    // Sin esto, una función que devolviera siempre 'cuadra' pasaría media
    // prueba sin que nadie lo note.
    const estados = new Set(filas.map(f => f.estado));
    expect(estados.size).withContext('la muestra dejó de discriminar').toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('plantilla: los bordes', () => {

  it('una plantilla en CERO es una respuesta, no un hueco', () => {
    // «Aquí no debe haber ninguno» es una decisión legítima, distinta de «nadie
    // lo ha capturado». Con una persona encima, es excedente de uno.
    const f = compararPlantilla(
      [{ puestoId: 'vigilancia', cantidad: 0 }],
      new Map([['vigilancia', 1]]),
    )[0];
    expect(f.autorizado).toBe(0);
    expect(f.estado).toBe('excedente');
    expect(f.excedente).toBe(1);
  });

  it('un renglón retirado (vigente=false) no cuenta como autorización', () => {
    const f = compararPlantilla(
      [{ puestoId: 'anaquelista', cantidad: 4, vigente: false }],
      new Map([['anaquelista', 2]]),
    )[0];
    expect(f.autorizado).toBeNull();
    expect(f.estado).toBe('sin_plantilla');
  });

  it('sin censo, la plantilla entera sale como vacantes', () => {
    const filas = compararPlantilla(PLANTILLA_PADRE_HIDALGO, new Map());
    expect(resumenPlantilla(filas).vacantes).toBe(10);
    expect(resumenPlantilla(filas).ocupados).toBe(0);
  });

  it('acepta el censo como objeto además de como Map', () => {
    const f = compararPlantilla([{ puestoId: 'anaquelista', cantidad: 1 }], { anaquelista: 3 })[0];
    expect(f.ocupado).toBe(3);
  });

  it('sin plantilla y sin censo no inventa renglones', () => {
    expect(compararPlantilla([], new Map()).length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('puestos declarados («de temporada»)', () => {

  const NAVIDAD: PuestoDeclarado = {
    id: 'tmp-edecan-navidad-123456',
    nombre: 'Edecán de Temporada Navideña',
    tipo: 'temporada',
    desde: '2026-11-15',
    hasta: '2027-01-06',
  };

  it('un puesto declarado se compara como cualquier otro, y trae su fecha de fin', () => {
    const f = compararPlantilla(
      [{ puestoId: NAVIDAD.id, cantidad: 3 }],
      new Map([[NAVIDAD.id, 1]]),
      [NAVIDAD],
    )[0];
    expect(f.nombre).toBe('Edecán de Temporada Navideña');
    expect(f.declarado).toBe(true);
    expect(f.hasta).toBe('2027-01-06');
    expect(f.vacantes).toBe(2);
  });

  it('NUNCA tiene manual: no va a recibir una sola tarea, y se dice explícito', () => {
    const f = compararPlantilla([{ puestoId: NAVIDAD.id, cantidad: 1 }], new Map(), [NAVIDAD])[0];
    expect(f.sinManual).toBe(true);
  });

  it('sin su declaración a la mano, muestra el id en vez de inventarle un nombre', () => {
    const f = compararPlantilla([{ puestoId: NAVIDAD.id, cantidad: 1 }], new Map(), [])[0];
    expect(f.nombre).toBe(NAVIDAD.id);
  });

  it('el id SIEMPRE lleva el prefijo, que es lo que impide pisar el catálogo', () => {
    const id = idDeclarado('Edecán de Temporada Navideña', 1760000000000);
    expect(id.startsWith(PREFIJO_DECLARADO)).toBe(true);
    expect(esPuestoDeclarado(id)).toBe(true);
    expect(esPuestoDeclarado('anaquelista')).toBe(false);
  });

  it('dos temporadas con el mismo nombre en años distintos NO colisionan', () => {
    // Si colisionaran, los checklists de la temporada vieja empezarían a
    // apuntar al puesto de la nueva y la historia quedaría reescrita.
    const a = idDeclarado('Edecán Navideña', 1760000000000);
    const b = idDeclarado('Edecán Navideña', 1790000000000);
    expect(a).not.toBe(b);
  });

  it('vigencia: fuera de su ventana deja de estar vigente, y la fecha manda', () => {
    expect(declaracionVigente(NAVIDAD, '2026-12-20')).toBe(true);
    expect(declaracionVigente(NAVIDAD, '2026-11-01')).toBe(false);
    expect(declaracionVigente(NAVIDAD, '2027-02-01')).toBe(false);
    expect(declaracionVigente({ ...NAVIDAD, vigente: false }, '2026-12-20')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('declarar un puesto sin crear un duplicado', () => {

  it('AVISA cuando el nombre ya existe en el organigrama, y nombra cuál', () => {
    // El hallazgo 1 de este proyecto en su forma más barata de prevenir: la
    // identidad se cruza por texto, así que «Surtidor de Ventas» tecleado a
    // mano partiría el cumplimiento de esas personas en dos.
    const p = revisarDeclaracion('Surtidor de Ventas', '2026-12-31');
    expect(p.length).toBe(1);
    expect(p[0].gravedad).toBe('avisa');
    expect(p[0].pareceA!.id).toBe('surtidor-ventas');
  });

  it('el aviso tolera acentos, mayúsculas y espacios de más', () => {
    const p = revisarDeclaracion('  anaquelista  DE   sucursal ', '2026-12-31');
    expect(p[0]?.pareceA?.id).toBe('anaquelista');
  });

  it('también avisa por un ALIAS histórico, no solo por el nombre oficial', () => {
    // 'Anaquelista' a secas es alias de 'Anaquelista de Sucursal'. Si el aviso
    // solo mirara el nombre oficial, el duplicado más probable sería el que
    // pasara sin ruido.
    const p = revisarDeclaracion('Anaquelista', '2026-12-31');
    expect(p[0]?.pareceA?.id).toBe('anaquelista');
  });

  it('AVISA, no bloquea: puede haber una razón real para tener los dos', () => {
    expect(revisarDeclaracion('Anaquelista', '2026-12-31')
      .some(x => x.gravedad === 'bloquea')).toBe(false);
  });

  it('un nombre que no se parece a nada no molesta a nadie', () => {
    expect(revisarDeclaracion('Edecán de Temporada Navideña', '2026-12-31').length).toBe(0);
  });

  it('BLOQUEA sin fecha de fin: una temporada sin fin es un puesto permanente', () => {
    const p = revisarDeclaracion('Edecán Navideña', '');
    expect(p.length).toBe(1);
    expect(p[0].campo).toBe('hasta');
    expect(p[0].gravedad).toBe('bloquea');
  });

  it('BLOQUEA una fecha que no es una fecha', () => {
    expect(revisarDeclaracion('Edecán', '31/12/2026')[0].gravedad).toBe('bloquea');
  });

  it('BLOQUEA sin nombre, y los espacios no cuentan como nombre', () => {
    expect(revisarDeclaracion('   ', '2026-12-31')[0].campo).toBe('nombre');
    expect(revisarDeclaracion('   ', '2026-12-31')[0].gravedad).toBe('bloquea');
  });

  it('GUARDIA: la revisión discrimina — no devuelve siempre lo mismo', () => {
    const limpio = revisarDeclaracion('Edecán de Temporada Navideña', '2026-12-31').length;
    const avisado = revisarDeclaracion('Anaquelista', '2026-12-31').length;
    const roto = revisarDeclaracion('', '').length;
    expect(limpio).withContext('un caso limpio debería no tener problemas').toBe(0);
    expect(avisado).toBe(1);
    expect(roto).toBe(2);
  });
});
