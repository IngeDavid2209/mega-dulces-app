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
 * ─── Y FIJA EL DEFECTO CONOCIDO, a propósito ───────────────────────────────
 * `esItemHecho` cuenta el punto como hecho si el checklist trae CUALQUIER nota
 * o se entregó con retraso, sin mirar la evidencia. Eso rompe el invariante
 * §5.3 y es la Fase 2.1, pendiente. Se prueba tal como está HOY, con el nombre
 * del caso diciendo que está mal: cuando la Fase 2.1 lo corrija, esta prueba
 * tiene que fallar y cambiarse a mano. Es la diferencia entre una deuda que se
 * ve y una que se olvida.
 */
import { tieneEvidencia, tieneJustificacionChecklist, esItemHecho } from './item-completado.util';

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

  // ═══ EL DEFECTO CONOCIDO (Fase 2.1) ══════════════════════════════════════
  it('MAL Y A PROPÓSITO: una nota cierra un punto sin foto en los tableros', () => {
    // Rompe el invariante §5.3. Se fija tal cual está HOY para que la Fase 2.1
    // tenga que venir a romper esta prueba en vez de cambiar los números de 186
    // personas sin que nadie lo note.
    const sinFoto = puntoDelManual();
    expect(tieneEvidencia(sinFoto)).toBe(false);
    expect(esItemHecho(sinFoto, { notaEmpleado: 'x' })).toBe(true);
    expect(esItemHecho(sinFoto, { entregaConRetraso: true })).toBe(true);
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

  // ═══ GUARDIA DE LA PROPIA PRUEBA ═════════════════════════════════════════
  it('tieneEvidencia DISCRIMINA: no devuelve lo mismo para todo', () => {
    // Si devolviera siempre true (o siempre false) casi ningún caso de arriba
    // lo delataría por sí solo.
    const con = tieneEvidencia(puntoDelManual({ photos: [{ url: 'u' }] }));
    const sin = tieneEvidencia(puntoDelManual());
    expect(con).not.toBe(sin);
  });
});
