/**
 * 📋 EL EMISOR ENTREGA LO CAPTURADO — paso 7.1b
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUÉ CAMBIA, Y POR QUÉ IMPORTA QUE ESTÉ PROBADO
 * ═══════════════════════════════════════════════════════════════════════════
 * El paso 7.1a (15/sep/2026) creó `mdtask_tareas_puesto` y la pantalla para
 * capturar tareas de un puesto. La tabla nacía vacía y **nadie la leía**: se
 * podía capturar una tarea y no se le entregaba a nadie. Es la peor
 * combinación posible, porque quien captura se va convencido de que ya rige.
 *
 * Esto lo cierra: la regla suma el manual PUBLICADO más lo CAPTURADO, y la
 * misma función la llaman el navegador y el emisor del servidor.
 *
 * ─── LAS DOS COSAS QUE MÁS FÁCIL SE ROMPEN ────────────────────────────────
 *  1. EL SELLO. Una tarea capturada trae su propio documento y su versión.
 *     Sin `selloPropio`, `armarChecklist` la sellaría con los del manual
 *     publicado del puesto —lo único que conoce— y el checklist afirmaría
 *     venir de un documento en el que esa tarea no está. El `|| ''` hace que
 *     eso NO falle: se emite igual y simplemente no se puede auditar. Sería
 *     perder el invariante §5.4 en el paso que viene a cumplirlo.
 *
 *  2. LO PUBLICADO NO SE PUEDE PERDER. Una cajera tiene 3 tareas diarias
 *     desde antes de todo esto. Si al sumar lo capturado se cayera una sola,
 *     el arreglo habría costado más de lo que da.
 *
 * ─── Y LA GUARDIA DE DISCRIMINACIÓN ───────────────────────────────────────
 * Una regla que devolviera SIEMPRE todas las tareas pasaría los casos de «sí
 * se entrega». Por eso el último bloque exige que la misma llamada produzca
 * un sí Y un no sobre la misma muestra: la vigente entra, la retirada no.
 */
import { planDeEntregas } from './emision-manual.util';
import { TareaDePuesto, tareasAutomaticasCombinadas } from './tareas-puesto.util';
import { tareasAutomaticasDePuesto, tareasDePuesto } from './tareas-manual.catalogo';

/** Martes: las diarias de la cajera aplican, sin depender del día que se corra. */
const MARTES = new Date(2026, 8, 15);

const CAJERA = {
  rol: 'trabajador', activo: true, id: 'u-caj',
  nombre: 'Cajera De Prueba', puestoId: 'cajero-sucursal',
  sucursales: ['Padre Hidalgo'],
};

function capturada(over: Partial<TareaDePuesto> = {}): TareaDePuesto {
  return {
    id: 'tp-venta-promos',
    puestoId: 'cajero-sucursal',
    nombre: 'Venta de promociones',
    momento: 'operacion',
    frecuencia: 'Diaria',
    horaLimite: '23:59',
    documento: 'Adenda de Caja · Septiembre 2026',
    version: '1.0 · Sep 2026',
    vigente: true,
    items: [{ texto: 'Promociones del día ofrecidas en cada venta' }],
    ...over,
  } as TareaDePuesto;
}

function plan(declaradas: TareaDePuesto[]) {
  return planDeEntregas({
    usuarios: [CAJERA], fecha: MARTES,
    horarios: [], configTurnos: null, descansosSemana: [],
    idsExistentes: new Set<string>(),
    tareasDeclaradas: declaradas,
  });
}

describe('7.1b — el emisor suma las tareas capturadas', () => {

  it('sin capturadas entrega EXACTAMENTE lo de siempre (las publicadas)', () => {
    const publicadas = tareasAutomaticasDePuesto('cajero-sucursal').length;
    expect(publicadas).toBeGreaterThan(0);          // si esto fuera 0 no se mide nada
    expect(plan([]).entregas.length).toBe(publicadas);
  });

  it('una capturada vigente se SUMA, sin perder ninguna publicada', () => {
    const publicadas = tareasAutomaticasDePuesto('cajero-sucursal').length;
    const r = plan([capturada()]);
    expect(r.entregas.length).toBe(publicadas + 1);
    // Y las publicadas siguen ahí, una por una.
    for (const t of tareasAutomaticasDePuesto('cajero-sucursal')) {
      expect(r.entregas.some(e => e.payload._tareaManualId === t.id)).toBe(true);
    }
  });

  it('la llave de una capturada NO PUEDE CHOCAR con la de una publicada', () => {
    // `idemKey` pasa el id por `slug()`, que convierte los guiones en guiones
    // bajos: `tp-venta-promos` -> `tp_venta_promos`. O sea que el prefijo que
    // la tabla exige con un `check` SOBREVIVE al slug, y por eso la llave de
    // una capturada arranca en `man_tp_` mientras las publicadas arrancan por
    // su `puestoId` (`man_cajero_sucursal_...`).
    //
    // Importa mas de lo que parece: si las dos pudieran producir la MISMA
    // llave, el emisor crearia una, encontraria la otra tomada y la
    // descartaria en silencio, sin que nadie supiera que norma quedo escrita.
    const r = plan([capturada()]);
    const nueva = r.entregas.find(e => e.payload._tareaManualId === 'tp-venta-promos');
    expect(nueva).toBeTruthy();
    expect(nueva!.checklistId.startsWith('man_tp_')).toBe(true);

    const publicadas = r.entregas.filter(e => e.payload._tareaManualId !== 'tp-venta-promos');
    expect(publicadas.length).toBeGreaterThan(0);
    for (const p of publicadas) {
      expect(p.checklistId.startsWith('man_tp_')).toBe(false);
      expect(p.checklistId).not.toBe(nueva!.checklistId);
    }
  });

  it('una capturada NO VIGENTE no se entrega — retirar una norma la retira de verdad', () => {
    const publicadas = tareasAutomaticasDePuesto('cajero-sucursal').length;
    expect(plan([capturada({ vigente: false })]).entregas.length).toBe(publicadas);
  });

  it('una capturada de OTRO puesto no se le entrega a esta persona', () => {
    const publicadas = tareasAutomaticasDePuesto('cajero-sucursal').length;
    expect(plan([capturada({ puestoId: 'anaquelista' })]).entregas.length).toBe(publicadas);
  });
});

describe('7.1b — el sello: con qué norma se juzga (§5.4)', () => {

  it('LA CAPTURADA SE SELLA CON SU DOCUMENTO Y SU VERSION, no con los del manual publicado', () => {
    const r = plan([capturada()]);
    const nueva = r.entregas.find(e => e.payload._tareaManualId === 'tp-venta-promos')!;
    expect(nueva.payload._manualDocumento).toBe('Adenda de Caja · Septiembre 2026');
    expect(nueva.payload._manualVersion).toBe('1.0 · Sep 2026');
  });

  it('y NO hereda el documento del manual de la cajera, que es el error que se vino a evitar', () => {
    const r = plan([capturada()]);
    const nueva = r.entregas.find(e => e.payload._tareaManualId === 'tp-venta-promos')!;
    const publicada = r.entregas.find(e => e.payload._tareaManualId !== 'tp-venta-promos')!;
    // La publicada sí lleva el del catálogo, y son DISTINTOS: ese contraste es
    // lo que prueba que el sello no se está copiando de un sitio para todas.
    expect(publicada.payload._manualDocumento).toContain('Cajera de Sucursal');
    expect(nueva.payload._manualDocumento).not.toBe(publicada.payload._manualDocumento);
    expect(nueva.payload._manualVersion).not.toBe(publicada.payload._manualVersion);
  });

  it('sin documento capturado lo DICE, en vez de heredar el del manual publicado', () => {
    const r = plan([capturada({ documento: '' })]);
    const nueva = r.entregas.find(e => e.payload._tareaManualId === 'tp-venta-promos')!;
    expect(nueva.payload._manualDocumento).toBe('Tarea capturada (sin documento)');
    expect(nueva.payload._manualDocumento).not.toContain('Cajera de Sucursal');
  });

  it('no se inventa un codigo de formato: el anexo es del manual publicado', () => {
    const r = plan([capturada()]);
    const nueva = r.entregas.find(e => e.payload._tareaManualId === 'tp-venta-promos')!;
    expect(nueva.payload._manualCodigo).toBe('');
  });

  it('las PUBLICADAS conservan su sello intacto — este paso no las toca', () => {
    const conCapturada = plan([capturada()]);
    const sinCapturada = plan([]);
    for (const e of sinCapturada.entregas) {
      const igual = conCapturada.entregas.find(x => x.checklistId === e.checklistId)!;
      expect(igual.payload._manualDocumento).toBe(e.payload._manualDocumento);
      expect(igual.payload._manualVersion).toBe(e.payload._manualVersion);
    }
  });
});

describe('7.1b — lo que el emisor NO debe entregar', () => {

  it('las de SOLO POR EVENTO siguen sin entregarse', () => {
    // Medido: hay 1 en el catálogo, en `aux-logistica-flotilla`. Si el emisor
    // hubiera pasado a `tareasCombinadasDePuesto` —la que usa la pantalla para
    // MOSTRAR la hoja— esa persona habría empezado a recibir una tarea que
    // nadie puede anticipar, sin que nadie lo pidiera.
    const todas = tareasDePuesto('aux-logistica-flotilla');
    const soloEvento = todas.filter(t => t.soloPorEvento);
    expect(soloEvento.length).toBeGreaterThan(0);   // si el catálogo cambia, esto avisa
    const combinadas = tareasAutomaticasCombinadas('aux-logistica-flotilla', []);
    for (const t of soloEvento) {
      expect(combinadas.some(x => x.id === t.id)).toBe(false);
    }
  });

  // ── GUARDIA DE DISCRIMINACION ──────────────────────────────────────────
  // Sin esto, una regla que devolviera SIEMPRE todas pasaria los casos de «si
  // se entrega» de arriba. Aqui se exige que la misma llamada, sobre la misma
  // muestra, produzca un si Y un no.
  it('la muestra discrimina: la vigente entra y la retirada no', () => {
    const base = tareasAutomaticasDePuesto('cajero-sucursal').length;
    const conVigente = plan([capturada()]).entregas.length;
    const conRetirada = plan([capturada({ vigente: false })]).entregas.length;
    expect(conVigente).toBe(base + 1);
    expect(conRetirada).toBe(base);
    expect(conVigente).not.toBe(conRetirada);
  });
});
