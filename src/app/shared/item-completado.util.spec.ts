/**
 * 📷 CUÁNDO UN PUNTO CUENTA COMO HECHO
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ EXISTE, y por qué justo hoy
 * ═══════════════════════════════════════════════════════════════════════════
 * El 3/sep/2026 Dirección pidió que TODOS los puntos del manual pidan foto
 * («a todas actívale la evidencia fotográfica», «que sea más de una foto»).
 * Esta regla pasó de gobernar 51 puntos de 377 a gobernar los 377: es la regla
 * que decide si 186 personas pueden cerrar su turno.
 *
 * §8.8 del CLAUDE.md: toda regla que produzca un número de una persona lleva
 * prueba. Esta produce el número de todas.
 *
 * ─── LA TRAMPA QUE ESTO FIJA, y casi la desplegué ──────────────────────────
 * `requiresPhoto` y `requiresVariasFotos` ENCENDIDAS A LA VEZ hacen el punto
 * IMPOSIBLE DE COMPLETAR:
 *   · `tieneEvidencia` mira `requiresVariasFotos` primero y pide `photos[]`…
 *   · …pero la plantilla ESCONDE el bloque de foto única cuando variasFotos
 *     está encendida (su `*ngIf` lleva `&& !item.requiresVariasFotos`), así que
 *     `item.photo` no se puede llenar por ningún camino de la interfaz.
 * Hoy el orden de los `if` salva la situación —variasFotos gana— pero eso es
 * un accidente del orden, no una decisión. Si alguien reordena los `if`, o el
 * día que la plantilla cambie, cada punto del manual queda bloqueado y NADIE
 * puede entregar. El caso de abajo lo deja escrito.
 *
 * ─── EL DEFECTO QUE FIJABA, YA CORREGIDO (Fase 2.1, 13/sep/2026) ───────────
 * Este archivo nació con un caso llamado «MAL Y A PROPÓSITO» que afirmaba que
 * cualquier nota cerraba un punto sin foto, para que la Fase 2.1 tuviera que
 * venir a romperlo en vez de cambiar los números de 186 personas sin que nadie
 * lo notara. Funcionó exactamente así: al aplicar la fase, ese caso se puso en
 * rojo y se cambió a mano en el mismo commit. Hoy afirma la regla correcta.
 *
 * La mecánica queda escrita porque vale más que este caso concreto: una deuda
 * que rompe una prueba es una deuda que se ve; una que no rompe nada es una que
 * se olvida.
 */
import { tieneEvidencia, tieneJustificacionChecklist, esItemHecho, estadoItem, fotoSubida } from './item-completado.util';

describe('evidencia de un punto', () => {

  /** Un punto del manual tal como lo emite el robot desde el 3/sep. */
  function puntoDelManual(extra: any = {}) {
    return {
      id: 'caja-turno_0', text: 'Inicio: Fondo contado/registrado', checked: false,
      photo: null, photoTime: null, photos: [],
      requiresPhoto: false, requiresVariasFotos: true, requiresAntesDespues: false,
      permiteFotos: false, permiteDocumentos: false,
      ...extra,
    };
  }

  // ═══ LA REGLA NUEVA ══════════════════════════════════════════════════════
  it('sin fotos NO está hecho, aunque esté palomeado', () => {
    // Lo segundo es el punto: `checked` ya no cierra un punto del manual. Si
    // esto devolviera true, la orden de Dirección sería decorativa.
    expect(tieneEvidencia(puntoDelManual())).toBe(false);
    expect(tieneEvidencia(puntoDelManual({ checked: true }))).toBe(false);
  });

  it('con una foto SÍ está hecho', () => {
    expect(tieneEvidencia(puntoDelManual({ photos: [{ url: 'u', time: '14:02' }] }))).toBe(true);
  });

  it('con varias fotos SÍ está hecho', () => {
    const tres = [{ url: 'a', time: '14:01' }, { url: 'b', time: '14:02' }, { url: 'c', time: '14:03' }];
    expect(tieneEvidencia(puntoDelManual({ photos: tres }))).toBe(true);
  });

  it('un arreglo vacío no cuenta, y tampoco un `photos` que no sea arreglo', () => {
    // El segundo caso es real: un checklist viejo puede traer `photos` ausente
    // o como objeto. `Array.isArray` es lo que lo protege.
    expect(tieneEvidencia(puntoDelManual({ photos: [] }))).toBe(false);
    expect(tieneEvidencia(puntoDelManual({ photos: undefined }))).toBe(false);
    expect(tieneEvidencia(puntoDelManual({ photos: {} as any }))).toBe(false);
  });

  it('la foto a medio subir no cuenta como evidencia', () => {
    // 'subiendo...' es el marcador que pone la app mientras sube a Cloudinary.
    expect(tieneEvidencia({ requiresPhoto: true, photo: 'subiendo...' })).toBe(false);
    expect(tieneEvidencia({ requiresPhoto: true, photo: 'https://x/y.jpg' })).toBe(true);
  });

  // ═══ LA COMBINACIÓN IMPOSIBLE ════════════════════════════════════════════
  it('LAS DOS BANDERAS JUNTAS: hoy se salva por el ORDEN de los if, no por diseño', () => {
    // Con las dos encendidas y fotos en la galería, `tieneEvidencia` dice true
    // porque mira variasFotos ANTES de requiresPhoto. Si se reordenaran, este
    // punto pediría `item.photo` — que la plantilla no deja llenar — y ningún
    // punto del manual se podría cerrar. Por eso el robot pone requiresPhoto
    // en false explícitamente, y por eso la migración 055 comprueba que no
    // quede ningún punto con las dos.
    const doble = puntoDelManual({ requiresPhoto: true, photos: [{ url: 'u', time: '14:00' }] });
    expect(tieneEvidencia(doble)).toBe(true);

    // Y la mitad que de verdad duele: con las dos banderas y SIN fotos, no hay
    // ningún camino en la interfaz para completarlo.
    const bloqueado = puntoDelManual({ requiresPhoto: true, photos: [] });
    expect(tieneEvidencia(bloqueado)).toBe(false);
  });

  // ═══ FASE 2.1, APLICADA EL 13/sep/2026 ═══════════════════════════════════
  //  Este bloque decía «MAL Y A PROPÓSITO: una nota cierra un punto sin foto en
  //  los tableros» y afirmaba `toBe(true)`, fijando el defecto para que la fase
  //  tuviera que venir a romperlo. Vino. Ahora afirma la regla correcta, que es
  //  el invariante §5.3: ninguna nota convierte un punto sin prueba en cumplido.
  it('una nota NO cierra un punto sin foto: el invariante §5.3, ya en vigor', () => {
    const sinFoto = puntoDelManual();
    expect(tieneEvidencia(sinFoto)).toBe(false);
    expect(esItemHecho(sinFoto, { notaEmpleado: 'x' })).toBe(false);
    expect(esItemHecho(sinFoto, { entregaConRetraso: true })).toBe(false);
  });

  it('la justificación NO desaparece: pasa a ser su propio estado', () => {
    // Que no cuente como hecho no es lo mismo que tirarla. `justificado` y
    // `no_ejecutado` tienen dueños distintos en el modelo de causas (§4), y por
    // eso son estados y no ausencia de dato.
    const sinFoto = puntoDelManual();
    expect(estadoItem(sinFoto, { notaEmpleado: 'no llegó el producto' })).toBe('justificado');
    expect(estadoItem(sinFoto, { entregaConRetraso: true })).toBe('justificado');
    expect(estadoItem(sinFoto, {})).toBe('no_ejecutado');
    expect(estadoItem(sinFoto, undefined)).toBe('no_ejecutado');
  });

  it('con evidencia el estado es hecho, aunque además traiga nota', () => {
    // Un punto con foto Y con nota se cierra por su prueba: la nota no lo
    // degrada. Es el caso que el diagnóstico llama «no se mueve».
    const conFoto = puntoDelManual({ photos: [{ url: 'u' }] });
    expect(estadoItem(conFoto, { notaEmpleado: 'ojo con el anaquel' })).toBe('hecho');
    expect(esItemHecho(conFoto, { notaEmpleado: 'ojo con el anaquel' })).toBe(true);
  });

  it('los tres estados son excluyentes y cubren todo: siempre cae en uno', () => {
    const casos = [
      [puntoDelManual({ photos: [{ url: 'u' }] }), {}],
      [puntoDelManual(), { notaEmpleado: 'x' }],
      [puntoDelManual(), {}],
    ];
    const vistos = casos.map(([it, ck]) => estadoItem(it, ck));
    expect(vistos).toEqual(['hecho', 'justificado', 'no_ejecutado']);
    expect(new Set(vistos).size).withContext('la muestra dejó de discriminar').toBe(3);
  });

  it('una nota en blanco NO justifica (los espacios no cuentan)', () => {
    expect(tieneJustificacionChecklist({ notaEmpleado: '   ' })).toBe(false);
    expect(tieneJustificacionChecklist({ notaEmpleado: '' })).toBe(false);
    expect(tieneJustificacionChecklist({})).toBe(false);
    expect(tieneJustificacionChecklist(null)).toBe(false);
  });

  it('sin checklist, la justificación no puede inventarse', () => {
    expect(esItemHecho(puntoDelManual(), undefined)).toBe(false);
    expect(esItemHecho(puntoDelManual(), null)).toBe(false);
  });

  // ═══ LO QUE NO SE TOCÓ ═══════════════════════════════════════════════════
  it('antes/después sigue exigiendo las dos fotos', () => {
    const ad = { requiresAntesDespues: true, photoAntes: 'a', photoDespues: null };
    expect(tieneEvidencia(ad)).toBe(false);
    expect(tieneEvidencia({ ...ad, photoDespues: 'b' })).toBe(true);
  });

  it('una tarea SIN evidencia se sigue cerrando con el palomeo', () => {
    // Las tareas libres y las rutinas que alguien crea a mano siguen igual: su
    // creador decide si piden foto. Esto sólo cambió para el manual.
    const libre = { text: 'Pasar por el banco', checked: true };
    expect(tieneEvidencia(libre)).toBe(true);
    expect(tieneEvidencia({ ...libre, checked: false })).toBe(false);
  });

  // ═══ LA FOTO QUE NO SUBIÓ — 22/sep/2026 ══════════════════════════════════
  //
  // Reporte de David: «no los deja subir sus tareas». Medido en el DOM: cuando
  // Cloudinary rechazaba, la foto entraba igual en la galería con la marca
  // `offline_syncing` y el punto QUEDABA HECHO. O sea, se podía cerrar el turno
  // con una prueba que solo existía en ese teléfono y que nadie más podía abrir.
  it('una foto que NO subió no cierra el punto', () => {
    const sinSubir = puntoDelManual({ photos: [{ url: 'offline_syncing', time: '08:14' }] });
    expect(tieneEvidencia(sinSubir)).toBe(false);
    expect(estadoItem(sinSubir)).toBe('no_ejecutado');
  });

  it('una foto a medio subir tampoco', () => {
    expect(tieneEvidencia(puntoDelManual({ photos: [{ url: 'subiendo...' }] }))).toBe(false);
  });

  it('la marca `pendiente` manda aunque la url parezca buena', () => {
    // La pone la pantalla al encolar. Sin esta rama, bastaría con que la url
    // dejara de ser exactamente `offline_syncing` para reabrir el hueco.
    expect(tieneEvidencia(puntoDelManual({
      photos: [{ url: 'https://res.cloudinary.com/x.jpg', pendiente: true }],
    }))).toBe(false);
  });

  it('UNA subida entre varias pendientes SÍ cierra el punto', () => {
    // El punto pide prueba, no todas las pruebas: si subió una, hay evidencia.
    expect(tieneEvidencia(puntoDelManual({
      photos: [{ url: 'offline_syncing' }, { url: 'https://res.cloudinary.com/ok.jpg' }],
    }))).toBe(true);
  });

  it('NO le quita el punto a nadie que sí subió su foto', () => {
    // El error caro de esta regla sería al revés: dejar sin cumplimiento a
    // quien trabajó. Por eso el criterio nombra lo que no es prueba en vez de
    // exigir una forma concreta de url (ver `fotoSubida`).
    for (const url of ['https://res.cloudinary.com/a.jpg', 'http://x/y.png', 'u', '/local/a.jpg']) {
      expect(tieneEvidencia(puntoDelManual({ photos: [{ url }] }))).toBe(true);
    }
  });

  it('fotoSubida DISCRIMINA: separa las dos familias', () => {
    // Sin esto, un `fotoSubida` que devolviera siempre true pasaría los casos
    // de arriba que afirman evidencia, y siempre false, los que la niegan.
    expect(fotoSubida({ url: 'https://res.cloudinary.com/a.jpg' })).toBe(true);
    expect(fotoSubida({ url: 'offline_syncing' })).toBe(false);
    expect(fotoSubida(null)).toBe(false);
    expect(fotoSubida({ url: '   ' })).toBe(false);
  });

  // ═══ GUARDIA DE LA PROPIA PRUEBA ═════════════════════════════════════════
  it('tieneEvidencia DISCRIMINA: no devuelve lo mismo para todo', () => {
    // Si devolviera siempre true (o siempre false) casi ningún caso de arriba
    // lo delataría por sí solo.
    const con = tieneEvidencia(puntoDelManual({ photos: [{ url: 'u' }] }));
    const sin = tieneEvidencia(puntoDelManual());
    expect(con).not.toBe(sin);
  });
});
