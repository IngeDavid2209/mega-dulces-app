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
import { tareasAutomaticasDePuesto } from './tareas-manual.catalogo';
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
    const conEscrito = Object.keys(EVIDENCIA_MANUAL)
      .reduce((n, k) => n + EVIDENCIA_MANUAL[k].filter((e: any) => e.escrito).length, 0);
    expect(conEscrito).withContext('¿se declararon puntos escritos de más?').toBe(2);
  });
});

describe('El Auxiliar de Encargado recibe el manual del Encargado', () => {
  it('pasa de CERO tareas a las tres del Encargado', () => {
    const aux = tareasAutomaticasDePuesto('auxiliar-encargado');
    const enc = tareasAutomaticasDePuesto('encargado-sucursal');
    expect(aux.length).toBe(3);
    expect(aux.map((t: any) => t.id).sort()).toEqual(enc.map((t: any) => t.id).sort());
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
