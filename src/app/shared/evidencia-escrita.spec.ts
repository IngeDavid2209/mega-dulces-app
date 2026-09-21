/**
 * 📝 LOS PUNTOS CUYA PRUEBA ES LO ESCRITO — las pruebas
 *
 * 21/sep/2026. Instruccion de David: los puntos «Pendientes del turno anterior»
 * y «Ausencias cubiertas…» dejan de pedir foto y piden lo escrito, y —textual—
 * «cuando en comentarios te manden una justificacion debes tomarlos como las
 * tareas en parte del porcentaje».
 *
 * §8.8: esto produce un numero de una persona. Un punto que se cierre vacio le
 * regala cumplimiento a quien no escribio nada; uno que no se cierre nunca deja
 * a la Encargada sin poder cerrar su turno. Las dos direcciones se fijan aqui.
 *
 * ─── LA ASERCION QUE MAS IMPORTA NO ES NINGUNA DE LAS DE ARRIBA ────────────
 * Es la del HISTORICO. `tieneEvidencia` se aplica AL LEER, asi que una rama mal
 * puesta no rompe nada visible: reescribe en silencio el cumplimiento de meses
 * pasados, y los tableros dejan de cuadrar contra lo que ya se reporto. Por eso
 * hay un bloque entero que solo comprueba que los documentos SIN el campo nuevo
 * —o sea, absolutamente todo lo emitido antes de hoy— se leen exactamente igual
 * que ayer.
 */
import { armarChecklist } from './emision-manual.util';
import { tieneEvidencia, estadoItem, completadoEn } from './item-completado.util';
import { tareasAutomaticasDePuesto, MANUALES_POR_PUESTO } from './tareas-manual.catalogo';
import { EVIDENCIA_MANUAL } from './evidencia-manual';

function operacionDelEncargado(): any {
  const tareas = tareasAutomaticasDePuesto('encargado-sucursal');
  const t = tareas.find((x: any) => x.id === 'encargado-sucursal.operacion');
  if (!t) throw new Error('no existe encargado-sucursal.operacion en el catalogo');
  return armarChecklist({
    checklistId: 'man_prueba', tarea: t, puestoId: 'encargado-sucursal',
    sucursal: 'Canindo', destinatario: 'Ana Prueba', destinatarioUid: 'u_ana',
    fechaYmd: '2026-09-22',
  }, []);
}

describe('La norma: «Operación de sucursal del turno» reescrita', () => {
  const ck = operacionDelEncargado();

  it('son 5 puntos, con los textos que pidió David', () => {
    expect(ck.items.map((i: any) => i.text)).toEqual([
      'Pendientes del turno anterior',
      'Disponibilidad de mercancía en piso',
      'Objetivo de venta del día',
      'Revisión de retiros durante el turno',
      'Ausencias cubiertas sin dejar Caja, Recepción, Piso ni Bodega desatendidos',
    ]);
  });

  it('los tres puntos retirados NO sobreviven por ningún camino', () => {
    const todo = ck.items.map((i: any) => i.text).join(' | ');
    for (const ido of ['Seguridad, acceso', 'Descarga, acomodo', 'Caducidades']) {
      expect(todo).withContext(ido + ' debia haberse retirado').not.toContain(ido);
    }
  });

  it('«Pendientes del turno anterior revisados» ya no está en la apertura', () => {
    // Estar en las dos seria pedir dos veces el mismo hecho, y eso infla el
    // denominador de quien lo cumple.
    const ap: any = tareasAutomaticasDePuesto('encargado-sucursal')
      .find((x: any) => x.id === 'encargado-sucursal.apertura');
    const textos = ap.items.map((i: any) => i.texto);
    expect(textos.some((t: string) => t.indexOf('Pendientes del turno anterior') >= 0)).toBe(false);
    expect(textos.length).toBe(7);
    // Y la evidencia de apertura sigue cayendo donde debe: el punto retirado
    // era el 6 y los declarados son 0, 4 y 5, asi que ninguno se corrio. Si
    // alguien quita uno de ARRIBA, esta asercion lo caza.
    for (const ev of EVIDENCIA_MANUAL['encargado-sucursal.apertura']) {
      expect(ap.items[ev.i].texto).withContext('desfase en apertura i=' + ev.i).toBe(ev.texto);
    }
  });

  it('la evidencia escrita apunta a los puntos que dice, no a los de al lado', () => {
    // El amarre es por indice + texto: si el catalogo se reordena y nadie mueve
    // estos `i`, la evidencia NO se aplica y los dos puntos volverian a pedir
    // fotos EN SILENCIO. Esto lo convierte en un fallo ruidoso.
    for (const ev of EVIDENCIA_MANUAL['encargado-sucursal.operacion']) {
      expect(ck.items[ev.i].text).withContext('desfase en operacion i=' + ev.i).toBe(ev.texto);
    }
  });

  it('la versión del manual subió: la norma se versiona, no se edita (§5.4)', () => {
    expect(ck._manualVersion).toBe('1.1 · Septiembre 2026');
  });
});

describe('Qué evidencia pide cada punto', () => {
  const ck = operacionDelEncargado();
  const pendientes = ck.items[0];
  const ausencias = ck.items[4];
  const conFoto = ck.items[1];

  it('los dos puntos escritos NO piden cámara', () => {
    for (const it of [pendientes, ausencias]) {
      expect(it.requiresVariasFotos).withContext(it.text).toBe(false);
      expect(it.requiresPhoto).withContext(it.text).toBe(false);
      expect(it.requiresAntesDespues).withContext(it.text).toBe(false);
    }
  });

  it('GUARDIA: los otros tres SÍ la piden — si no, esto no discrimina nada', () => {
    // Sin esta asercion, un cambio que apagara la camara en los 377 puntos
    // pasaria la prueba de arriba en verde.
    for (const it of [ck.items[1], ck.items[2], ck.items[3]]) {
      expect(it.requiresVariasFotos).withContext(it.text).toBe(true);
      expect(it.evidenciaEscrita).withContext(it.text).toBe(null);
    }
  });

  it('nacen vacíos y con el tipo que les toca', () => {
    expect(pendientes.evidenciaEscrita).toBe('listado');
    expect(pendientes.listado).toEqual([]);
    expect(ausencias.evidenciaEscrita).toBe('comentario');
    expect(ausencias.comentario).toBe('');
    expect(conFoto.listado).toBe(null);
    expect(conFoto.comentario).toBe(null);
  });
});

describe('Lo escrito cuenta en el porcentaje, y lo vacío no', () => {
  const ck = operacionDelEncargado();

  it('el cuadro de texto vacío NO cierra el punto', () => {
    const it = { ...ck.items[4] };
    expect(tieneEvidencia(it)).toBe(false);
    expect(estadoItem(it, {})).toBe('no_ejecutado');
  });

  it('un cuadro con SOLO espacios tampoco', () => {
    // El borde barato de saltarse: tres espacios se ven como texto escrito.
    expect(tieneEvidencia({ ...ck.items[4], comentario: '   \n  ' })).toBe(false);
  });

  it('escrito el motivo, el punto está HECHO y suma al porcentaje', () => {
    const it = { ...ck.items[4], comentario: 'Faltó Ana (anaquelista) por incapacidad; cubrió Luis.' };
    expect(tieneEvidencia(it)).toBe(true);
    expect(estadoItem(it, {})).toBe('hecho');
  });

  it('el listado vacío, y el de renglones en blanco, NO cierran el punto', () => {
    expect(tieneEvidencia({ ...ck.items[0], listado: [] })).toBe(false);
    expect(tieneEvidencia({ ...ck.items[0], listado: ['', '  '] })).toBe(false);
  });

  it('un solo renglón escrito basta, aunque los otros estén en blanco', () => {
    expect(tieneEvidencia({ ...ck.items[0], listado: ['', 'Faltó surtir el pasillo 3'] })).toBe(true);
  });

  it('PALOMEARLOS NO LOS CIERRA: la palomita no es la prueba', () => {
    // Es la puerta por la que se colaria un 100% sin una sola linea escrita.
    expect(tieneEvidencia({ ...ck.items[4], checked: true, comentario: '' })).toBe(false);
    expect(tieneEvidencia({ ...ck.items[0], checked: true, listado: [] })).toBe(false);
  });

  it('la nota del CHECKLIST no los cierra (la Fase 2.1 sigue en pie)', () => {
    // `notaEmpleado` habla por los 5 puntos a la vez, incluidos los que nadie
    // justificó. Lo escrito que cuenta es lo del PUNTO, no lo del checklist.
    const conNota = { notaEmpleado: 'hoy hubo mucha gente' };
    expect(tieneEvidencia({ ...ck.items[4] })).toBe(false);
    expect(estadoItem({ ...ck.items[4] }, conNota)).toBe('justificado');
  });

  it('lo escrito se puede situar en el tiempo', () => {
    const t = new Date(2026, 8, 22, 15, 30).getTime();
    const it = { ...ck.items[4], comentario: 'cubierto', escritoEn: t };
    expect(completadoEn(it, '2026-09-22')).toBe(t);
    // Sin sello, `null` y no una hora inventada: «hecho» y «cuándo» son dos
    // preguntas, y la segunda puede no tener respuesta.
    expect(completadoEn({ ...it, escritoEn: null }, '2026-09-22')).toBe(null);
  });
});

describe('EL HISTÓRICO NO SE MUEVE — la aserción que protege meses de datos', () => {
  it('un punto emitido ANTES de hoy se lee exactamente igual que ayer', () => {
    // Todo lo emitido hasta el 20/sep no trae `evidenciaEscrita`. Estas cuatro
    // formas son las que hay en la base, y ninguna puede cambiar de estado.
    const viejoConFoto = { requiresVariasFotos: true, photos: [{ time: '09:00' }] };
    const viejoSinFoto = { requiresVariasFotos: true, photos: [] };
    const viejoPalomeado = { checked: true };
    const viejoSinPalomear = { checked: false };

    expect(tieneEvidencia(viejoConFoto)).toBe(true);
    expect(tieneEvidencia(viejoSinFoto)).toBe(false);
    expect(tieneEvidencia(viejoPalomeado)).toBe(true);
    expect(tieneEvidencia(viejoSinPalomear)).toBe(false);
  });

  it('los 28 puntos con `comentario: true` CONSERVAN su cámara', () => {
    // Es el error que estuve a punto de cometer: colgar la evidencia escrita de
    // `requiereComentario` en vez de un campo nuevo. Esos 28 llevan meses
    // emitidos pidiendo foto; si el texto los cerrara, un punto de agosto
    // cerrado con su foto pasaria a exigir un texto que nadie escribio ese dia.
    const viejo = { requiresVariasFotos: true, photos: [] as any[], requiereComentario: true, comentario: 'algo' };
    expect(tieneEvidencia(viejo)).withContext('el comentario NO puede sustituir a la foto aquí').toBe(false);
    expect(tieneEvidencia({ ...viejo, photos: [{ time: '09:00' }] })).toBe(true);
  });

  it('GUARDIA: solo están declarados los puntos escritos que se pidieron', () => {
    // Si algun dia alguien declara `escrito` a bulto, esta cifra lo dice antes
    // de que 377 puntos dejen de pedir foto sin que nadie lo haya decidido.
    //
    // 21/sep: 2 -> 8. La guardia DISPARO sola al agregar los puestos nuevos, que
    // es exactamente su trabajo, y se sube a mano en el mismo commit que lo
    // provoca. El desglose va por tarea y no como un total pelado: un «8» no
    // dice de donde salio, y el dia que suba a 9 hay que poder ver cual crecio.
    const porTarea: Record<string, number> = {};
    for (const k of Object.keys(EVIDENCIA_MANUAL)) {
      const n = EVIDENCIA_MANUAL[k].filter((e: any) => e.escrito).length;
      if (n) porTarea[k] = n;
    }
    expect(porTarea).withContext('¿se declararon puntos escritos de más?').toEqual({
      'encargado-sucursal.operacion': 2,
      'auxiliar-encargado.operacion': 4,
      'surtidor-sucursal.operacion': 2,
    });
  });
});

describe('El Auxiliar de Encargado recibe el manual del Encargado', () => {
  it('apertura y cierre compartidos, y su PROPIA operación', () => {
    // ⚠ CAMBIADA A MANO EL 21/sep. Antes exigia que las tres tareas fueran las
    // MISMAS que las del Encargado; hoy su operacion es propia, porque la de
    // ella lleva puntos de MANDO y el Auxiliar cubre, no manda (David, 19/sep).
    // Estaba en rojo al aplicar el cambio: es su control positivo.
    const aux = tareasAutomaticasDePuesto('auxiliar-encargado').map((t: any) => t.id);
    const enc = tareasAutomaticasDePuesto('encargado-sucursal').map((t: any) => t.id);
    expect(aux.slice().sort()).toEqual([
      'auxiliar-encargado.operacion',
      'encargado-sucursal.apertura',
      'encargado-sucursal.cierre',
    ]);
    // LAS DOS DIRECCIONES. Solo con la de arriba, un `soloPuestos` que se
    // aplicara al reves -dandole al Encargado la del Auxiliar- pasaria en verde.
    expect(enc.slice().sort()).toEqual([
      'encargado-sucursal.apertura',
      'encargado-sucursal.cierre',
      'encargado-sucursal.operacion',
    ]);
    expect(aux).not.toContain('encargado-sucursal.operacion');
    expect(enc).not.toContain('auxiliar-encargado.operacion');
  });

  it('comparten el documento, no una copia: son la MISMA norma', () => {
    // Dos documentos con los mismos puntos serian dos normas libres de
    // discrepar, y la que se quedara atras juzgaria a una de las dos
    // poblaciones con una regla vieja.
    const aux = tareasAutomaticasDePuesto('auxiliar-encargado');
    const enc = tareasAutomaticasDePuesto('encargado-sucursal');
    expect(aux[0]).toBe(enc[0]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  LAS DOS NORMAS NUEVAS DEL 21/sep/2026 (tarde)
// ══════════════════════════════════════════════════════════════════════════

function operacionDe(puestoId: string, tareaId: string): any {
  const t = tareasAutomaticasDePuesto(puestoId).find((x: any) => x.id === tareaId);
  if (!t) throw new Error('no existe ' + tareaId + ' para ' + puestoId);
  return armarChecklist({
    checklistId: 'man_prueba_' + puestoId, tarea: t, puestoId,
    sucursal: 'Canindo', destinatario: 'Persona Prueba', destinatarioUid: 'u_x',
    fechaYmd: '2026-09-22',
  }, []);
}

describe('La operación propia del Auxiliar de Encargado', () => {
  const ck = operacionDe('auxiliar-encargado', 'auxiliar-encargado.operacion');

  it('son los 8 puntos, en primera persona del pasado', () => {
    expect(ck.items.map((i: any) => i.text)).toEqual([
      'Recibí el turno y anoté lo que quedó pendiente del anterior',
      'Cubrí el puesto que quedó sin gente y anoté cuál y por cuánto tiempo',
      'Recorrí piso y bodega al menos una vez y levanté los faltantes con código',
      'Apoyé en Caja cobrando siempre con mi usuario propio',
      'Entregué a la Encargada los retiros que recibí, sin dejarlos expuestos',
      'Revisé los cambios de precio del día antes de que llegaran a Caja',
      'Escalé a la Encargada lo que no me toca decidir: mermas, descuentos, bajas y diferencias',
      'Dejé por escrito lo que la Encargada tiene que retomar al volver',
    ]);
  });

  it('NO lleva ninguno de los tres puntos de mando de la Encargada', () => {
    // Es el motivo entero de que esta tarea exista. Sin esta asercion, alguien
    // podria copiar los puntos de ella aqui y la prueba de arriba seguiria en
    // verde mientras el Auxiliar vuelve a recibir obligaciones que no le tocan.
    const todo = ck.items.map((i: any) => i.text).join(' | ');
    for (const mando of ['Tareas del día asignadas', 'Ausencias cubiertas', 'Diferencias de Caja']) {
      expect(todo).withContext(mando + ' es de MANDO: el Auxiliar cubre, no manda').not.toContain(mando);
    }
  });

  it('el par del relevo (1 y 8) son listados, y los dos de decisión son texto', () => {
    expect(ck.items[0].evidenciaEscrita).toBe('listado');
    expect(ck.items[7].evidenciaEscrita).toBe('listado');
    expect(ck.items[1].evidenciaEscrita).toBe('comentario');
    expect(ck.items[6].evidenciaEscrita).toBe('comentario');
  });

  it('GUARDIA: los otros cuatro SÍ piden cámara', () => {
    // Sin esto, un cambio que apagara la camara en toda la tarea pasaria la
    // asercion de arriba en verde.
    for (const i of [2, 3, 4, 5]) {
      expect(ck.items[i].requiresVariasFotos).withContext(ck.items[i].text).toBe(true);
      expect(ck.items[i].evidenciaEscrita).withContext(ck.items[i].text).toBe(null);
    }
  });

  it('⚠ SE SELLA CON SU DOCUMENTO PROPIO, no con el de la Encargada', () => {
    // Estos 8 puntos NO estan en el manual de ella. Sellarlos con «Encargada de
    // Sucursal PH» afirmaria que salen de un documento donde no estan, y con
    // eso la hoja de auditoria de un dia pasado seria falsa (§5.4).
    expect(ck._manualDocumento).toBe(
      'Operación del Auxiliar de Encargado — derivado, pendiente de manual propio');
    expect(ck._manualVersion).toBe('0.1 · Septiembre 2026');
    // Y el CONTRASTE: su apertura, que sí es de ella, se sella con el de ella.
    const ap = operacionDe('auxiliar-encargado', 'encargado-sucursal.apertura');
    expect(ap._manualDocumento).toBe('Manual Corporativo de Operación — Encargada de Sucursal PH');
    expect(ap._manualVersion).toBe('1.1 · Septiembre 2026');
  });
});

describe('El Surtidor de Sucursal: surte LISTAS DE PASILLO', () => {
  const ck = operacionDe('surtidor-sucursal', 'surtidor-sucursal.operacion');

  it('son los 9 puntos', () => {
    expect(ck.items.length).toBe(9);
    expect(ck.items[0].text).toBe('Surtí las listas de pasillo que recibí');
  });

  it('el vocabulario es de LISTAS, nunca de pedidos ni tickets', () => {
    // Correccion de David: «lo que el surtidor surte son las listas de
    // pasillos». Mi primera version venia del Checador de CEDIS y hablaba de
    // pedidos, tickets y tarimas — en un pasillo eso no significa nada.
    const todo = ck.items.map((i: any) => i.text).join(' | ').toLowerCase();
    for (const ajeno of ['ticket', 'pedido', 'carreta', 'tarima', 'checado']) {
      expect(todo).withContext('«' + ajeno + '» es vocabulario de CEDIS').not.toContain(ajeno);
    }
    expect(todo).toContain('lista');
  });

  it('lo que no había se enumera, y lo que quedó sin surtir se explica', () => {
    expect(ck.items[4].evidenciaEscrita).toBe('listado');
    expect(ck.items[8].evidenciaEscrita).toBe('comentario');
  });

  it('el punto 1 pide varias fotos: una de cada lista y del pasillo', () => {
    expect(ck.items[0].requiresVariasFotos).toBe(true);
    expect(ck.items[0].evidenciaEscrita).toBe(null);
  });

  it('el manual es SUYO, y no se lo llevan los otros tres surtidores', () => {
    // Medido y decidido con las cifras enfrente: los 4 de zona estan en centros
    // `Tlmkt` y `Rutas` -otra cadena- y la unidad `ventas` entera no tiene un
    // solo manual del que derivar. Darselo a los cuatro les entregaria
    // obligaciones que no les tocan (§8.5).
    expect(tareasAutomaticasDePuesto('surtidor-sucursal').length).toBe(1);
    expect(tareasAutomaticasDePuesto('surtidor-zona').length).toBe(0);
    expect(tareasAutomaticasDePuesto('surtidor-ventas').length).toBe(0);
    expect(tareasAutomaticasDePuesto('surtidor-cedis').length).toBe(0);
  });
});

describe('`soloPuestos`: una tarea del manual que no le toca a todos', () => {
  it('no afecta a ningún manual que no lo declare', () => {
    // La guardia de no-regresion: 20 manuales comparten documento entre varios
    // puestos (el Checador son dos). Si `tareasDelManualPara` filtrara de mas,
    // alguno se quedaria sin tareas y nadie lo notaria hasta que esa persona
    // abriera la app y no viera nada.
    expect(tareasAutomaticasDePuesto('checador').map((t: any) => t.id))
      .toEqual(tareasAutomaticasDePuesto('checador-cedis').map((t: any) => t.id));
    expect(tareasAutomaticasDePuesto('checador').length).toBeGreaterThan(0);
  });

  it('GUARDIA: nadie con manual se quedó en cero', () => {
    // El modo de fallo silencioso de este cambio es dejar un puesto sin tareas.
    // Se recorren TODOS los puestos con manual, no una muestra.
    const sinTareas: string[] = [];
    for (const m of MANUALES_POR_PUESTO) {
      for (const pid of m.puestoIds) {
        if (tareasAutomaticasDePuesto(pid).length === 0) sinTareas.push(pid);
      }
    }
    expect(sinTareas).withContext('estos puestos tienen manual y CERO tareas').toEqual([]);
  });
});
