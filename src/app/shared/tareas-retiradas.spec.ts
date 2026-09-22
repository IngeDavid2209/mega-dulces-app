/**
 * 🗑 NUEVE PUNTOS RETIRADOS DEL MANUAL (22/sep/2026)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUÉ PASÓ
 * ═══════════════════════════════════════════════════════════════════════════
 * David nombró ocho puntos a retirar, uno por uno y con su texto literal. Al
 * ponerle enfrente que había SEIS puntos gemelos —la misma idea escrita con
 * otras palabras, en tareas de otros puestos— eligió añadir exactamente uno:
 * «Escaleras en condición segura», del checklist DIARIO del Almacenista.
 *
 * El motivo de ese noveno es el que vale la pena conservar: quitar «Escaleras y
 * antiderrapante» del checklist SEMANAL y dejar el gemelo en el DIARIO habría
 * dejado a la MISMA persona reportando escaleras todos los días en vez de una
 * vez por semana — o sea, lo contrario de lo que se pidió.
 *
 * Los otros cinco gemelos (Bodeguero, Surtidor, Anaquelista) SE QUEDAN.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LO QUE ESTAS PRUEBAS PROTEGEN, Y NO ES EL CONTEO
 * ═══════════════════════════════════════════════════════════════════════════
 * La dirección peligrosa de un retiro es BORRAR DE MÁS, y un conteo no la caza:
 * «esta tarea tiene 6 puntos» lo pasa igual de bien un archivo al que se le
 * quitaron los tres puntos equivocados. Por eso la aserción que de verdad
 * sostiene este archivo es la de los GEMELOS QUE SIGUEN: fija que el recorte
 * llegó hasta donde David dijo y ni un punto más allá (§8.5).
 *
 * Y es también el CONTROL POSITIVO de los nueve ceros. Un `filter` que no
 * encontrara nunca nada daría los nueve retirados en 0 y pasaría la mitad de
 * arriba en verde; que el MISMO `filter` devuelva 1 para los seis gemelos es lo
 * que prueba que discrimina (§8.11 a: un cero no vale hasta saber de cuántas
 * líneas salió — aquí, de 391 puntos).
 */
import { MANUALES_POR_PUESTO, tareasAutomaticasDePuesto } from './tareas-manual.catalogo';

/** Todos los textos del catálogo, de todos los manuales y todas las tareas. */
function todosLosPuntos(): string[] {
  const out: string[] = [];
  for (const m of MANUALES_POR_PUESTO as any[]) {
    for (const t of m.tareas) for (const i of t.items) out.push(i.texto);
  }
  return out;
}

function tareaPorId(id: string): any {
  for (const m of MANUALES_POR_PUESTO as any[]) {
    const t = m.tareas.find((x: any) => x.id === id);
    if (t) return t;
  }
  return null;
}

/** Los nueve, con el texto EXACTO que tenían. Si alguien devuelve uno, cae aquí. */
const RETIRADOS = [
  'Evidencia enviada',
  'No sustituí un código por otro para cerrar una diferencia',
  'Efectivo/documentación resguardados',
  'Escaleras en condición segura',
  'Escaleras y antiderrapante en condición segura',
  'Carretas en condición de uso',
  'Revisé restos antes de surtir una caja nueva del mismo producto',
  'Surtí solo contra lista, ticket o instrucción autorizada',
  'No hice ajustes de inventario por cuenta propia',
];

/** Los seis que NO se tocaron. Su presencia es el control positivo del bloque. */
const GEMELOS_QUE_SE_QUEDAN = [
  'Revisé la zona de restos antes de pedir o abrir una caja nueva',
  'Surtí contra lista física o solicitud autorizada',
  'Verifiqué restos antes de abrir una caja nueva',
  'Revisé los restos antes de abrir una caja nueva del mismo producto',
  'Marqué en la lista lo que no había, sin sustituirlo por otro código',
  'Carretas despejadas o correctamente ubicadas',
];

describe('Los nueve puntos retirados el 22/sep/2026', () => {

  it('ninguno de los nueve sigue en el catálogo', () => {
    const todos = todosLosPuntos();

    // EL DENOMINADOR PRIMERO. Sin esta guardia, un catálogo que no cargara
    // daría los nueve ceros de abajo y esta prueba pasaría en verde sin haber
    // mirado un solo punto: «no pude leer» y «no hay» se ven idénticos.
    expect(todos.length)
      .withContext('el catálogo vino vacío: los ceros de abajo no significarían nada')
      .toBeGreaterThan(300);

    for (const texto of RETIRADOS) {
      expect(todos.filter(t => t === texto).length)
        .withContext(`«${texto}» volvió al catálogo: se retiró el 22/sep por instrucción de David`)
        .toBe(0);
    }
  });

  it('los SEIS gemelos siguen ahí — se retiró lo nombrado, no lo parecido', () => {
    // Esta es la aserción que sostiene el archivo. Un retiro que barriera por
    // parecido cambiaría el denominador del Bodeguero, el Surtidor y el
    // Anaquelista, a los que nadie mencionó. Y de paso es el control positivo:
    // prueba que el `filter` de arriba sabe encontrar un texto cuando existe.
    const todos = todosLosPuntos();
    for (const texto of GEMELOS_QUE_SE_QUEDAN) {
      expect(todos.filter(t => t === texto).length)
        .withContext(`«${texto}» se borró de más: NO estaba en la lista de David`)
        .toBe(1);
    }
  });

  it('las seis tareas quedan con el número de puntos que se acordó', () => {
    const ESPERADO: Record<string, number> = {
      'anaquelista.pasillo': 8,             // 9 → 8
      'anaquelista.operacion': 8,           // 9 → 8
      'encargado-sucursal.cierre': 7,       // 8 → 7
      'almacenista-sucursal.diario': 9,     // 10 → 9
      'almacenista-sucursal.seguridad': 5,  // 7 → 5
      'almacenista-sucursal.operacion': 6,  // 9 → 6
    };
    for (const id of Object.keys(ESPERADO)) {
      const t = tareaPorId(id);
      expect(t).withContext(`la tarea ${id} desapareció del catálogo`).toBeTruthy();
      expect(t.items.length).withContext(`${id} cambió de tamaño`).toBe(ESPERADO[id]);
    }
  });

  it('el cierre le baja el punto al Auxiliar TAMBIÉN, porque comparten manual', () => {
    // No es un detalle: `encargado-sucursal.cierre` sirve a los dos puestos
    // desde el 21/sep. Si alguien partiera ese manual en dos copias, esta
    // prueba seguiría verde mirando solo a la Encargada — por eso mira a los
    // dos y exige que sea LA MISMA tarea, no dos con el mismo contenido.
    const cierreEnc = tareasAutomaticasDePuesto('encargado-sucursal')
      .find((t: any) => t.id === 'encargado-sucursal.cierre');
    const cierreAux = tareasAutomaticasDePuesto('auxiliar-encargado')
      .find((t: any) => t.id === 'encargado-sucursal.cierre');

    expect(cierreEnc).withContext('la Encargada perdió su checklist de cierre').toBeTruthy();
    expect(cierreAux).withContext('el Auxiliar perdió su checklist de cierre').toBeTruthy();
    expect(cierreAux).toBe(cierreEnc!);   // la MISMA referencia, no una copia
    expect(cierreEnc!.items.length).toBe(7);
    expect(cierreEnc!.items.map((i: any) => i.texto))
      .not.toContain('Efectivo/documentación resguardados');
  });

  it('los tres manuales tocados subieron de versión (§5.4)', () => {
    // La norma se versiona, NO se edita: cada emisión guarda la versión con la
    // que se juzgó, así que dejar el número quieto pondría dos contenidos
    // distintos bajo el mismo sello y una hoja de auditoría de la semana
    // pasada dejaría de ser reconstruible.
    const versionDe = (puestoId: string) => {
      const m = (MANUALES_POR_PUESTO as any[]).find(x => x.puestoIds.includes(puestoId));
      return m ? m.version : null;
    };
    expect(versionDe('anaquelista')).toBe('1.2 · Septiembre 2026');
    expect(versionDe('encargado-sucursal')).toBe('1.2 · Septiembre 2026');
    expect(versionDe('almacenista-sucursal')).toBe('1.1 · Septiembre 2026');
  });

  it('el Anexo 6 quedó cubierto a medias, y está declarado', () => {
    // Esta tarea ES el Anexo 6 publicado, y el PDF sigue pidiendo sus siete
    // elementos mientras la app cobra cinco. La prueba NO exige que sean siete
    // —eso revertiría la instrucción de David— sino que fija el hecho para que
    // el día que Capital Humano reedite el anexo (Fase 7), alguien lo encuentre.
    const t = tareaPorId('almacenista-sucursal.seguridad');
    expect(t.codigoFormato).toBe('Anexo 6');
    expect(t.items.length).toBe(5);
    expect(t.frecuencia).toBe('Semanal');
  });
});
