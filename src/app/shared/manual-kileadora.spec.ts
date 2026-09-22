/**
 * 📦 LA KILEADORA — puesto declarado y manual derivado (22/sep/2026)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * David pidió «un plan de tareas para las kileadoras» y lo primero que hubo que
 * decirle es que EL PUESTO NO EXISTÍA COMO DATO. Medido antes de escribir nada:
 * 0 apariciones en el organigrama (89 puestos), 0 en la nómina de agosto y 0 de
 * las 149 fichas activas. Lo único que había en todo el repo era la palabra
 * `kileado`, en el vocabulario del dictado por voz — o sea, la operación se
 * nombraba todos los días y el puesto no se había declarado nunca.
 *
 * Se declaró con su decisión (§8.5: un puesto lo declara Dirección, no lo
 * inventa el desarrollo por parecido), y sus nueve puntos los aprobó él.
 *
 * ─── LO QUE ESTAS PRUEBAS PROTEGEN, Y NO ES EL CONTEO ─────────────────────
 * Un manual derivado tiene un riesgo propio que un manual transcrito no tiene:
 * que se selle con el documento de OTRO puesto. `manualDePuesto` devuelve el
 * primero que encuentra, así que un `puestoIds` mal puesto haría que los
 * checklists de la Kileadora afirmaran venir del manual del Anaquelista —donde
 * estos puntos NO están— y el §5.4 se perdería sin un solo error visible.
 * Por eso la prueba del sello nombra el documento exacto que saldría mal.
 */
import { puestoPorId } from './organigrama.catalogo';
import { resolverPuesto } from './puesto.util';
import {
  tareasAutomaticasDePuesto, manualDePuesto,
} from './tareas-manual.catalogo';

describe('Kileadora de Sucursal', () => {

  it('el puesto existe y cuelga donde cuelgan los de piso', () => {
    const p = puestoPorId('kileadora');
    expect(p).withContext('el puesto no está declarado en el organigrama').toBeTruthy();
    expect(p!.unidad).toBe('sucursal');
    expect(p!.nivel).toBe('operativo');
    // Reporta a la Encargada, igual que el Anaquelista y el Surtidor. No es
    // decorativo: de `reportaA` cuelgan el árbol del organigrama, a quién se le
    // cuenta su cumplimiento y qué ve su jefa.
    expect(p!.reportaA).toBe('encargado-sucursal');
  });

  it('una ficha capturada a mano como «Kileadora» SÍ cruza con el puesto', () => {
    // Es lo que evita el hallazgo 1 por esta puerta: sin alias, una ficha con
    // el cargo escrito a mano no emparejaría con nada y esa persona se quedaría
    // sin tareas EN SILENCIO —que se ve idéntico a no tener trabajo—.
    for (const cargo of ['Kileadora', 'kileadora', 'KILEADORAS', 'Kileador']) {
      expect(resolverPuesto({ cargo }).puestoId)
        .withContext(`el cargo «${cargo}» no resolvió`).toBe('kileadora');
    }
  });

  it('tiene UNA tarea diaria de NUEVE puntos', () => {
    const t = tareasAutomaticasDePuesto('kileadora');
    expect(t.length).toBe(1);
    expect(t[0].id).toBe('kileadora.operacion');
    expect(t[0].frecuencia).toBe('Diaria');
    expect(t[0].items.length).toBe(9);
  });

  it('se sella con SU documento, no con el de otro puesto', () => {
    const m = manualDePuesto('kileadora');
    expect(m).toBeTruthy();
    expect(m!.documento).toContain('Kileadora');
    expect(m!.documento).toContain('derivado');
    expect(m!.version).toContain('0.1');
    // El código de formato va VACÍO a propósito: es el anexo de un manual
    // publicado, y este puesto no tiene anexo. Heredarlo le haría citar un
    // formato que no le corresponde.
    expect(m!.codigo).toBe('');
    // Y el control que de verdad importa: NO es el manual del Anaquelista.
    const anaquelista = manualDePuesto('anaquelista');
    expect(m!.documento)
      .withContext('se está sellando con el documento de otro puesto')
      .not.toBe(anaquelista!.documento);
  });

  it('sus puntos son SUYOS: no se los lleva ni se los presta a nadie', () => {
    // Las dos direcciones. Sólo con la primera, un `puestoIds` que incluyera de
    // más al Anaquelista pasaría en verde.
    const kile = tareasAutomaticasDePuesto('kileadora').map((t: any) => t.id);
    const otros = ['anaquelista', 'surtidor-sucursal', 'cajero-sucursal', 'vendedora-piso']
      .flatMap((p) => tareasAutomaticasDePuesto(p).map((t: any) => t.id));
    expect(kile).toEqual(['kileadora.operacion']);
    expect(otros).not.toContain('kileadora.operacion');
  });

  it('los nueve puntos están escritos en primera persona y en pasado', () => {
    // No es estilo: es lo que hace que el punto sea una AFIRMACIÓN de quien lo
    // marca —«lo hice»— y no una instrucción que se puede palomear sin leer.
    // Es el mismo criterio del Anaquelista y el Surtidor.
    const items = tareasAutomaticasDePuesto('kileadora')[0].items;
    for (const i of items) {
      expect(i.texto.length).withContext('punto vacío').toBeGreaterThan(10);
      expect(i.texto)
        .withContext(`«${i.texto}» no empieza con un verbo en primera persona`)
        .toMatch(/^(Revisé|Usé|Etiqueté|Comparé|Mantuve|Repuse|Registré|Dejé|Pesé|Conté|Reporté|Marqué|Atendí|Devolví|Surtí)/);
    }
  });

  it('GUARDIA: la báscula es el primer punto, y no por orden alfabético', () => {
    // Todo lo demás depende de que el instrumento esté bien: un kilo mal pesado
    // no se detecta después mirando bolsas ni fotos. Si algún día alguien
    // reordena la lista, esto lo dice.
    expect(tareasAutomaticasDePuesto('kileadora')[0].items[0].texto).toContain('báscula');
  });
});
