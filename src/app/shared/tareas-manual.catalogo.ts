/**
 * 📕 CATÁLOGO DE TAREAS DE MANUAL — INMUTABLE
 *
 * Las tareas que la app entrega automáticamente a cada puesto. Salen de los
 * ANEXOS OPERATIVOS de los Manuales Corporativos de Operación 2026: los
 * formatos que el propio manual diseñó para llenarse cada jornada.
 *
 * ─── POR QUÉ NADIE PUEDE EDITARLAS ───────────────────────────────────────────
 * Un manual es un documento controlado: se elabora en Capital Humano, lo revisa
 * la Jefatura de Zona y lo autoriza Dirección. Si un Encargado pudiera quitarle
 * un punto de control al checklist de cierre de caja desde una pantalla, la
 * empresa perdería justo lo que el manual vino a garantizar. Por eso el catálogo
 * vive en código: se cambia con una nueva versión del manual y un commit, no
 * desde la app. La app las ENTREGA y las COBRA; no las negocia.
 *
 * Para tareas de cualquier otra cosa —lo que se le ocurra a cada quien, lo que
 * pida la Jefatura, lo del día— sigue existiendo el apartado de Tareas normal,
 * que sí se crea, edita y borra libremente.
 *
 * ─── FIDELIDAD AL DOCUMENTO ─────────────────────────────────────────────────
 * Los `items` son los puntos de control tal como los redacta el anexo. Dos
 * salvedades, para que quede constancia:
 *
 *  1. Varios anexos listan el punto como sustantivo suelto porque en el papel
 *     hay una columna "Cumple / Observaciones" al lado (p. ej. "Estibas" en el
 *     Checklist de seguridad del Almacenista). Aquí se redactan como afirmación
 *     verificable ("Estibas estables y dentro de límite") sin cambiarles el
 *     sujeto: en una app el ítem tiene que poder marcarse sí o no.
 *  2. Unos pocos anexos son TABLAS de registro por renglón (bitácoras de
 *     diferencias, controles de caducidades, minutas). Esos NO se convirtieron
 *     en tareas: son historiales, no listas de verificación. Se enumeran en
 *     `formatosNoAutomatizados` de cada manual para que se sepa que existen y
 *     que se decidió, a propósito, dejarlos fuera.
 *
 * ─── ORIGEN ─────────────────────────────────────────────────────────────────
 * Carpeta de manuales entregada el 2026-08-28. Un puesto sin manual todavía
 * aparece en el organigrama pero no recibe tareas automáticas: se queda
 * esperando su documento, y no se le inventan.
 */

import { PUESTOS_ORGANIGRAMA } from './organigrama.catalogo';

/** Momento de la jornada al que el manual adscribe la tarea. */
export type MomentoManual =
  | 'apertura'
  | 'operacion'
  | 'cierre'
  | 'supervision'
  | 'administrativo';

/** Periodicidad declarada por el manual (o por su tabla de implementación). */
export type FrecuenciaManual = 'Diaria' | 'Semanal' | 'Quincenal' | 'Mensual';

export interface ItemManual {
  /** El punto de control. */
  texto: string;
  /** Bloque de la jornada al que el anexo lo adscribe, cuando lo indica. */
  bloque?: string;
}

export interface TareaManual {
  /** Llave estable `puestoId.slug`. No se renombra una vez publicada. */
  id: string;
  nombre: string;
  momento: MomentoManual;
  frecuencia: FrecuenciaManual;
  /** Si es Semanal: día en que se entrega. */
  diaSemana?: 'Lunes' | 'Martes' | 'Miércoles' | 'Jueves' | 'Viernes' | 'Sábado';
  /** Si es Mensual: día del mes. */
  diaMes?: number;
  /**
   * Hora límite de entrega en la app. OJO: los manuales fijan el MOMENTO
   * ("Inicio", "Cierre") pero casi ninguno fija una hora corporativa, así que
   * estas horas son la ventana de entrega que usa la app, no una regla del
   * documento. Se pueden ajustar sin tocar el contenido del checklist.
   */
  horaLimite: string;
  /** Código del anexo/formato en el manual (CEDIS-CH-01, RM-PH-02, ...). */
  codigoFormato?: string;
  /**
   * Con qué norma se juzga esta tarea, cuando NO es la del manual publicado.
   *
   * ═════════════════════════════════════════════════════════════════════════
   *  POR QUÉ EXISTE, Y POR QUÉ ES UN OBJETO Y NO DOS CAMPOS SUELTOS
   * ═════════════════════════════════════════════════════════════════════════
   * Las tareas CAPTURADAS (`mdtask_tareas_puesto`, prefijo `tp-`) traen su
   * propio documento y su propia versión. Sin esto, `armarChecklist` sellaría
   * el checklist con los del manual publicado del puesto —porque es lo único
   * que conoce— y afirmaría que una tarea capturada viene de un documento en
   * el que no está. Para una cajera diría «Manual Corporativo de Operación —
   * Cajera de Sucursal · v1.1», que es sencillamente falso, y el `|| ''` de
   * abajo hace que eso NO falle: se emite igual y simplemente no se puede
   * auditar. Sería perder el invariante §5.4 —«cada emisión guarda la versión
   * con la que se juzgó»— en el paso que viene a cumplirlo.
   *
   * Va como OBJETO para que no se pueda llenar a medias: un documento sin
   * versión, o al revés, es media coordenada, y media coordenada no imprime
   * una hoja de auditoría. O están los dos o no está ninguno.
   *
   * Ausente = la tarea es del catálogo publicado y se sella con su manual,
   * exactamente como hasta hoy.
   */
  selloPropio?: { documento: string; version: string };
  /**
   * El manual lo llena una vez por CADA evento del día (cada pedido, cada
   * recepción). La app entrega una instancia diaria que hace de registro
   * consolidado de la jornada; el detalle por evento va en las observaciones.
   */
  porEvento?: boolean;
  /**
   * El disparador es un evento que la app no puede anticipar: cambio de
   * custodia de un vehículo, siniestro, alta de unidad. Aparece en la hoja del
   * puesto para consulta, pero el robot NO la entrega periódicamente.
   */
  soloPorEvento?: boolean;
  /**
   * ESTA TAREA SOLO LE TOCA A ALGUNOS DE LOS PUESTOS DEL MANUAL.
   *
   * Ausente = le toca a todos los `puestoIds` del documento, que es el caso
   * normal y el de todas las tareas anteriores al 21/sep/2026.
   *
   * ─── POR QUE ESTO Y NO UN SEGUNDO MANUAL ─────────────────────────────────
   * El Auxiliar de Encargado comparte el manual de la Encargada -misma norma,
   * no una copia- pero la operacion del turno de ella incluye puntos de MANDO
   * («Ausencias cubiertas…»): el Auxiliar es quien cubre, no quien decide quien
   * cubre (decision de David, 19/sep). Asi que necesita su propia operacion sin
   * duplicar apertura ni cierre.
   *
   * Darle un segundo manual habria roto el sello de auditoria EN SILENCIO:
   * `manualDePuesto()` devuelve EL PRIMERO que encuentra, asi que sus
   * checklists se habrian sellado con el documento equivocado -y §5.4 dice que
   * cada emision guarda la version con la que se juzgo-. Con un campo por
   * TAREA sigue habiendo un solo manual por puesto y el sello no se mueve.
   */
  soloPuestos?: string[];
  /** Aclaración que se muestra al trabajador junto a la tarea. */
  nota?: string;
  items: ItemManual[];
}

export interface ManualPuesto {
  /** Puestos del organigrama a los que aplica este manual. */
  puestoIds: string[];
  /** Título del documento controlado. */
  documento: string;
  /** Código documental sugerido en el manual ('' si el manual no lo asigna). */
  codigo: string;
  version: string;
  /** PDF de origen, para poder volver a la fuente. */
  archivo: string;
  tareas: TareaManual[];
  /** Anexos del manual que a propósito NO se automatizaron (son bitácoras). */
  formatosNoAutomatizados?: string[];
}

// ══════════════════════════════════════════════════════════════════════════
//  LA VENTANA DE ENTREGA: 06:00 → 23:00, LA MISMA PARA TODAS
// ══════════════════════════════════════════════════════════════════════════
// Instrucción de David (22/sep/2026): «vamos a cambiar los horarios de las
// tareas, quiero que inicien de 6:00 am a 11:00 pm absolutamente todas». Se
// le puso enfrente la tabla de lo que había —NUEVE horas distintas repartidas
// en 9 949 puntos emitidos en una semana— y contestó «no las quiero así».
//
// DEROGA el reparto por momento, que era esto:
//
//     const H_APERTURA    = '12:00';
//     const H_OPERACION   = '18:00';
//     const H_SUPERVISION = '19:00';
//     const H_ADMIN       = '19:00';
//     const H_CIERRE      = '23:59';
//
// Se cita en vez de borrarse, como el resto de reglas derogadas de este repo,
// para que nadie lo relea como vigente y para que devolver la diferenciación
// sea cambiar cinco valores y no reconstruirla de memoria.
//
// ─── LO QUE NO DESAPARECE ─────────────────────────────────────────────────
// El `momento` de cada tarea sigue intacto: dice de qué parte de la jornada
// es (apertura, cierre, operación…) y el emisor lo sella en `_momento`, que
// es de donde salen los conteos por momento. Lo único que se unifica es la
// hora con la que se juzga el RETRASO, que es otra cosa: hasta hoy una
// apertura se ponía en rojo a media mañana y una de cierre a las 23:59.
//
// ─── POR QUÉ 23:00 Y NO 23:59 IMPORTA MÁS DE LO QUE PARECE ────────────────
// `rutinaPermitidaEnTurno` (turnos.util.ts:212) deja pasar cualquier tarea
// cuya hora sea EXACTAMENTE '23:59' — ese escape es el que hoy salva a las
// 2 356 entregas de cierre de la semana. Con 23:00 el escape ya no aplica, y
// por eso el emisor lleva su propia guarda: ver `emision-manual.util.ts`.
export const VENTANA_MANUAL = { inicio: '06:00', fin: '23:00' } as const;

/** Hora en que vence CUALQUIER tarea del manual. Ver el bloque de arriba. */
const H_LIMITE = VENTANA_MANUAL.fin;

/**
 * Nota que llevan las tareas de "operación del turno".
 *
 * Estas tareas NO salen de un anexo: se derivaron de los procedimientos del
 * capítulo 3 de cada manual, y existen porque los anexos de varios puestos solo
 * cubren apertura y cierre, dejando fuera el oficio de en medio.
 *
 * El criterio de redacción fue estricto: cada punto es algo que la persona
 * PUEDE AFIRMAR al terminar su turno. Los procedimientos que se ejecutan cientos
 * de veces al día (cobrar una venta) no se volvieron un palomeo por evento —
 * eso convierte el checklist en burocracia y el palomeo deja de significar algo.
 * Y los reactivos ("si falla la luz", "si el cliente devuelve") quedaron como la
 * afirmación de haberlos escalado bien, no como tareas que casi nunca aplican.
 */
const NOTA_OPERACION =
  'Autoevaluación del turno sobre los procedimientos del manual. No sustituye al ' +
  'procedimiento: confirma que se siguió. Lo que no se pueda afirmar se explica en ' +
  'las observaciones.';

export const MANUALES_POR_PUESTO: ManualPuesto[] = [

  // ══════════════════════════════════════════════════════════════════════════
  //  CAJERO(A) DE SUCURSAL
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['cajero-sucursal'],
    documento: 'Manual Corporativo de Operación — Cajera de Sucursal',
    codigo: 'MDDLA-SUC-CAJ-001',
    version: '1.1 · Agosto 2026',
    archivo: '15. Manual_Corporativo_Cajera_Sucursal_MDDLA_2026.pdf',
    formatosNoAutomatizados: ['C. Registro sugerido de incidencias de caja'],
    tareas: [
      {
        id: 'cajero-sucursal.apertura',
        nombre: 'Checklist de apertura de caja',
        momento: 'apertura', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo A',
        items: [
          { texto: 'Área limpia y ordenada' },
          { texto: 'Usuario propio y caja correcta' },
          { texto: 'Fondo contado/registrado' },
          { texto: 'Lector, impresora y rollos disponibles' },
          { texto: 'Terminal bancaria operativa' },
          { texto: 'Material y detector de billetes disponibles' },
        ],
      },
      {
        id: 'cajero-sucursal.cierre',
        nombre: 'Checklist de cierre de caja',
        momento: 'cierre', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo B',
        items: [
          { texto: 'Último cliente atendido y cortina cerrada' },
          { texto: 'Vouchers conciliados' },
          { texto: 'Retiros integrados' },
          { texto: 'Devoluciones/documentos integrados' },
          { texto: 'Efectivo arqueado' },
          { texto: 'Diferencias reportadas' },
          { texto: 'Corte generado' },
          { texto: 'Efectivo y documentos en caja fuerte' },
        ],
      },
      {
        id: 'cajero-sucursal.operacion',
        nombre: 'Operación de caja del turno',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '3.2 – 3.11',
        nota: NOTA_OPERACION,
        items: [
          { texto: 'Cobré siempre con mi usuario propio y en la caja que me corresponde' },
          { texto: 'Comparé la descripción del sistema contra el producto físico ante cualquier duda' },
          { texto: 'No otorgué descuentos ni modifiqué precios por iniciativa propia' },
          { texto: 'Revisé autenticidad de billetes y conté el cambio antes de entregarlo' },
          { texto: 'No hice préstamos de caja ni cambios a personas ajenas a una venta' },
          { texto: 'Capturé la forma de pago correcta y conservé los comprobantes' },
          { texto: 'Validé datos fiscales antes de generar cada factura' },
          { texto: 'Entregué los retiros a la Encargada de inmediato, sin dejarlos expuestos' },
          { texto: 'Escalé a la Encargada las diferencias de precio, devoluciones y fallas de sistema' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ANAQUELISTA DE SUCURSAL
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['anaquelista'],
    documento: 'Manual Corporativo de Operación — Anaquelista de Sucursal',
    codigo: 'MDDLA-SUC-ANA-001',
    version: '1.1 · Agosto 2026',
    archivo: '11. Manual_Corporativo_Anaquelista_Sucursal_MDDLA_2026_v1.1.pdf',
    formatosNoAutomatizados: [
      'B. Registro sugerido de caducidades',
      'C. Registro sugerido de faltantes recurrentes',
    ],
    tareas: [
      {
        id: 'anaquelista.pasillo',
        nombre: 'Checklist diario de pasillo',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo A',
        items: [
          { texto: 'Lista de surtido entregada/atendida' },
          { texto: 'Faltantes identificados' },
          { texto: 'Producto rotado por fecha' },
          { texto: 'Etiquetas correctas/actualizadas' },
          { texto: 'Producto frenteado y estable' },
          { texto: 'Pasillo sin cajas/restos' },
          { texto: 'Área limpia' },
          { texto: 'Evidencia enviada' },
          { texto: 'Revisión final de Encargada/Auxiliar' },
        ],
      },
      {
        id: 'anaquelista.operacion',
        nombre: 'Operación de pasillo del turno',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '3.1 – 3.12',
        nota: NOTA_OPERACION,
        items: [
          { texto: 'Recorrí el pasillo y registré los faltantes con descripción y código' },
          { texto: 'Comparé el surtido recibido contra la etiqueta y la presentación del anaquel' },
          { texto: 'Revisé la zona de restos antes de pedir o abrir una caja nueva' },
          { texto: 'Comparé fechas al acomodar y dejé al frente lo de caducidad más próxima' },
          { texto: 'Reporté a Encargada el producto próximo a caducar, sin decidir merma ni descuento' },
          { texto: 'Revisé los cambios de precio del día y avisé de cualquier diferencia antes de que llegara a Caja' },
          { texto: 'Retiré la señalización de promociones ya vencidas' },
          { texto: 'No sustituí un código por otro para cerrar una diferencia' },
          { texto: 'Dejé el acomodo estable y las etiquetas legibles' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ENCARGADO(A) DE SUCURSAL
  // ══════════════════════════════════════════════════════════════════════════
  {
    // ── EL AUXILIAR DE ENCARGADO RECIBE ESTE MISMO MANUAL ────────────────────
    // Instruccion de David (21/sep/2026): «ya que no existe el turno de Aux de
    // encargada(o) crealo y agregale las mismas tareas que tienen el puesto de
    // encargada de sucursal».
    //
    // NO SE ESCRIBE UN MANUAL NUEVO: se comparte este. Un segundo documento con
    // los mismos puntos serian dos normas libres de discrepar, y la que se
    // quedara atras juzgaria a una de las dos poblaciones con una regla vieja.
    // Es el mismo patron que ya usa el Checador (`checador` + `checador-cedis`).
    //
    // LO QUE ESTO MUEVE, dicho para que no sorprenda: el censo del emisor conto
    // `auxiliar-encargado` como el puesto con MAS gente sin manual (11 fichas,
    // 15/sep). Desde el despliegue pasan de CERO tareas a las tres de aqui, asi
    // que su denominador nace manana, no estaba antes.
    //
    // Y su sello dice «Encargada de Sucursal PH», que es el documento real del
    // que salen los puntos. Escribirles uno propio es Fase 7 y lo redacta
    // Capital Humano, no el codigo.
    puestoIds: ['encargado-sucursal', 'auxiliar-encargado'],
    documento: 'Manual Corporativo de Operación — Encargada de Sucursal PH',
    codigo: '',
    // 1.1 — 21/sep/2026. La norma SE VERSIONA, NO SE EDITA (§5.4): cada emision
    // guarda la version con la que se juzgo, asi que cambiar los puntos sin
    // mover este campo dejaria dos contenidos distintos bajo el mismo numero y
    // una hoja de auditoria de la semana pasada seria imposible de reconstruir.
    version: '1.1 · Septiembre 2026',
    archivo: '20. Manual_Corporativo_Encargada_Sucursal_PH_MDDLA_2026.pdf',
    formatosNoAutomatizados: [
      'C. Registro de incidencias de Encargada',
      'D. Seguimiento semanal de caducidades',
      'E. Control de traspasos entre sucursales',
      'F. Control de pedidos directos a proveedor',
      'G. Bitácora de diferencias de Caja',
      'H. Validación de competencia de respaldo',
      'I. Matriz rápida de escalamiento',
    ],
    tareas: [
      {
        id: 'encargado-sucursal.apertura',
        nombre: 'Checklist de apertura de sucursal',
        momento: 'apertura', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo A',
        items: [
          { texto: 'Alarma/candados retirados y acceso seguro' },
          { texto: 'Sistemas y computadoras operativos' },
          { texto: 'Cajas aperturadas/habilitadas' },
          { texto: 'Área de cajas libre y ordenada' },
          { texto: 'Piso frenteado y sin obstáculos' },
          { texto: 'Bodega despejada y segura' },
          // «Pendientes del turno anterior revisados» VIVIA AQUI y se mudo a
          // `encargado-sucursal.operacion`, donde es un LISTADO (21/sep/2026).
          // Se quita de la apertura para que no se pida dos veces el mismo
          // hecho: un punto duplicado infla el denominador de quien lo cumple.
          { texto: 'Tareas del día asignadas en Mega Dulces Task' },
        ],
      },
      {
        id: 'encargado-sucursal.cierre',
        nombre: 'Checklist de cierre de sucursal',
        momento: 'cierre', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo B',
        items: [
          { texto: 'Pasillos sin mercancía pendiente de acomodo' },
          { texto: 'Cortes y retiros integrados' },
          { texto: 'Diferencias de Caja reportadas' },
          { texto: 'Factura global generada' },
          { texto: 'Reportes de venta actualizados' },
          { texto: 'Efectivo/documentación resguardados' },
          { texto: 'Bodega y áreas críticas revisadas' },
          { texto: 'Alarma/candados colocados' },
        ],
      },
      {
        id: 'encargado-sucursal.operacion',
        nombre: 'Operación de sucursal del turno',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '2.3',
        // SOLO LA ENCARGADA (21/sep/2026). El Auxiliar comparte este manual
        // pero tiene su propia operacion, abajo: aqui hay puntos de MANDO
        // -«Ausencias cubiertas…» decide quien cubre- y el Auxiliar es quien
        // cubre. Apertura y cierre siguen siendo de los dos.
        soloPuestos: ['encargado-sucursal'],
        nota: 'Prioridades diarias del puesto, en el orden que fija el manual. Lo que no se pueda afirmar se explica en las observaciones.',
        // ── REESCRITA EL 21/sep/2026, POR INSTRUCCION DE DAVID ──────────────
        // De 7 puntos a 5. Queda constancia de QUE HABIA, porque un punto que
        // desaparece sin rastro se lee despues como un dato perdido:
        //
        //   SE QUITAN   «Seguridad, acceso y continuidad del sistema y de las cajas»
        //               «Descarga, acomodo y surtido coordinados para no desabastecer…»
        //               «Caducidades, tareas programadas, limpieza y cierre documental»
        //   SE ACORTAN  «Atención al cliente y disponibilidad de mercancía en piso»
        //                 -> «Disponibilidad de mercancía en piso»
        //               «Objetivo de venta y atención de la alta afluencia»
        //                 -> «Objetivo de venta del día»
        //               «Incidencias de efectivo, precios, transferencias o mercancía
        //                atendidas» -> «Revisión de retiros durante el turno»
        //   LLEGA       «Pendientes del turno anterior», que venia de la APERTURA
        //
        // OJO CON LOS INDICES: `evidencia-manual.ts` amarra por tareaId +
        // POSICION + texto. Al reordenarse todos, su entrada para esta tarea se
        // escribio contra ESTA lista, no contra la anterior. Si alguien mueve un
        // renglon de aqui tiene que mover el `i` de alla, o la evidencia
        // sencillamente no se aplica (es a proposito: preferible perder una
        // marca que ponerla sobre un punto que ahora habla de otra cosa).
        //
        // «Objetivo de venta del día» DEPENDE DEL TURNO y eso todavia no se
        // puede expresar: la tarea es UNA diaria y el turno no existe como dato
        // (§4, Fase 3). Queda anotado y no inventado — hoy le sale igual a la
        // Encargada y al Auxiliar, todos los dias.
        items: [
          // Listado, no foto: son los pendientes que dejo el turno anterior y se
          // enumeran uno por uno. Lo enciende `evidencia-manual.ts`.
          { texto: 'Pendientes del turno anterior' },
          { texto: 'Disponibilidad de mercancía en piso' },
          { texto: 'Objetivo de venta del día' },
          { texto: 'Revisión de retiros durante el turno' },
          // Cuadro de texto, no foto: una ausencia no se fotografia. Se pide por
          // que, de quien, quien sustituyo, puesto y lugar.
          { texto: 'Ausencias cubiertas sin dejar Caja, Recepción, Piso ni Bodega desatendidos' },
        ],
      },
      {
        // ══════════════════════════════════════════════════════════════════
        //  LA OPERACION DEL AUXILIAR DE ENCARGADO — 21/sep/2026
        // ══════════════════════════════════════════════════════════════════
        // El principio del que salen los ocho puntos, y es una decision de
        // David (19/sep): EL AUXILIAR CUBRE, NO MANDA. Su autoridad sale de la
        // cobertura del dia, no de una bandera permanente. En el organigrama es
        // nivel OPERATIVO con cero gente debajo, asi que sus puntos son de
        // ejecucion y relevo, nunca de supervision.
        //
        // ESTAN EN PRIMERA PERSONA DEL PASADO, y no es cosmetica. El manual de
        // la Encargada esta escrito en ESTADOS («Disponibilidad de mercancia en
        // piso») porque ella responde por el resultado; los manuales operativos
        // -Cajera, Anaquelista, Bodeguero- van en primera persona porque quien
        // los llena responde por SU acto. Es el estilo que se puede exigir sin
        // ambiguedad a este nivel.
        //
        // EL 1 Y EL 8 SON UN PAR: abren y cierran el relevo. Hoy la continuidad
        // entre turnos no la registra nadie, y es justo donde se pierde el
        // trabajo. El 7 es el que PROTEGE A LA PERSONA: deja escrito que no era
        // su decision, para que no se le cuente como falta.
        id: 'auxiliar-encargado.operacion',
        nombre: 'Operación del Auxiliar de Encargado',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '',
        soloPuestos: ['auxiliar-encargado'],
        // ⚠ SELLO PROPIO, Y EL TEXTO ES FEO A PROPOSITO.
        // Estos ocho puntos NO SALEN del manual de la Encargada: se derivaron
        // del Cajero, el Anaquelista y de la decision de «cubre, no manda».
        // Sellarlos con «Encargada de Sucursal PH» afirmaria que estan en un
        // documento donde no estan, y §5.4 dice que cada emision guarda la
        // version CON LA QUE SE JUZGO. Se lee como lo que es -norma derivada,
        // sin manual firmado- hasta que Capital Humano escriba el suyo.
        selloPropio: {
          documento: 'Operación del Auxiliar de Encargado — derivado, pendiente de manual propio',
          version: '0.1 · Septiembre 2026',
        },
        nota: NOTA_OPERACION,
        items: [
          { texto: 'Recibí el turno y anoté lo que quedó pendiente del anterior' },
          { texto: 'Cubrí el puesto que quedó sin gente y anoté cuál y por cuánto tiempo' },
          { texto: 'Recorrí piso y bodega al menos una vez y levanté los faltantes con código' },
          { texto: 'Apoyé en Caja cobrando siempre con mi usuario propio' },
          { texto: 'Entregué a la Encargada los retiros que recibí, sin dejarlos expuestos' },
          { texto: 'Revisé los cambios de precio del día antes de que llegaran a Caja' },
          { texto: 'Escalé a la Encargada lo que no me toca decidir: mermas, descuentos, bajas y diferencias' },
          { texto: 'Dejé por escrito lo que la Encargada tiene que retomar al volver' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  BODEGUERO DE SUCURSAL
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['bodeguero-sucursal'],
    documento: 'Manual Corporativo de Operación — Bodeguero de Sucursal PH',
    codigo: '',
    version: '1.0 · Agosto 2026',
    archivo: '18. Manual_Corporativo_Bodeguero_Sucursal_PH_MDDLA_2026.pdf',
    formatosNoAutomatizados: ['16.3 Registro sugerido de incidencia'],
    tareas: [
      {
        id: 'bodeguero-sucursal.inicio',
        nombre: 'Checklist diario de inicio y surtido',
        momento: 'apertura', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '16.1',
        items: [
          { texto: 'Listas de Anaquelistas/Promotoras recibidas' },
          { texto: 'Prioridades de alta rotación identificadas' },
          { texto: 'Restos revisados antes de abrir nuevas cajas' },
          { texto: 'Faltantes marcados y comunicados' },
          { texto: 'Pasillos de Bodega transitables' },
          { texto: 'Área de excesos sin incidencias visibles' },
        ],
      },
      {
        id: 'bodeguero-sucursal.cierre',
        nombre: 'Checklist de cierre de Bodega',
        momento: 'cierre', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '16.2',
        items: [
          { texto: 'Carretas despejadas o correctamente ubicadas' },
          { texto: 'Mercancía sin acomodar identificada y controlada' },
          { texto: 'Restos ordenados' },
          { texto: 'Producto dañado/caducado segregado y marcado' },
          { texto: 'Pasillos libres' },
          { texto: 'Tareas de aplicación completadas' },
        ],
      },
      {
        id: 'bodeguero-sucursal.operacion',
        nombre: 'Operación de Bodega del turno',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '4.1 – 10.1',
        nota: NOTA_OPERACION,
        items: [
          { texto: 'Surtí contra lista física o solicitud autorizada' },
          { texto: 'Verifiqué restos antes de abrir una caja nueva' },
          { texto: 'Confirmé código, descripción, marca y presentación antes de entregar' },
          { texto: 'Marqué en la lista lo no disponible y lo regresé para integrarlo a faltantes' },
          { texto: 'Informé a Encargada las diferencias entre existencia de sistema y físico' },
          { texto: 'Di prioridad al piso de venta cuando hubo necesidad crítica de surtido' },
          { texto: 'Reporté producto próximo a caducar y lo mantuve visible para su rotación' },
          { texto: 'Acomodé de inmediato las cajas que estaban fuera de su ubicación' },
          { texto: 'Dejé pasillos y rutas de tránsito despejados' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SURTIDOR DE SUCURSAL — 21/sep/2026
  //
  //  NORMA DERIVADA, NO TRANSCRITA. No hay PDF: estos puntos se derivaron del
  //  Bodeguero y del Anaquelista, y el vocabulario lo corrigio David —«lo que
  //  el surtidor surte son las LISTAS DE PASILLOS», no pedidos ni tickets—.
  //
  //  POR QUE NO COMPARTE EL MANUAL DEL BODEGUERO, que era lo primero que
  //  propuse: el Bodeguero NO pide foto por lista, y sus otras dos tareas son
  //  los checklists de inicio y cierre de BODEGA, que no son trabajo del
  //  Surtidor. Compartir le habria entregado dos checklists ajenos.
  //
  //  ES PARA UNA SOLA PERSONA HOY (Padre Hidalgo, y es la unica a la que la
  //  nomina llama «Surtidor De Pasillo»). Se escribe igual porque LA NORMA ES
  //  DE LA PLAZA, NO DE QUIEN LA OCUPA (§4): el dia que entren tres surtidores
  //  ya esta escrita, y el dia que esa persona se vaya no se va con ella.
  //
  //  ⚠ NO SE LE DA A `surtidor-zona` NI A `surtidor-ventas`, y esta medido:
  //  los 4 de zona estan en centros `Tlmkt` y `Rutas` -otra cadena, la de
  //  reparto, donde no hay pasillos- y la unidad `ventas` entera no tiene un
  //  solo manual del que derivar. Decision de David con las cifras enfrente.
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['surtidor-sucursal'],
    documento: 'Operación del Surtidor de Sucursal — derivado, pendiente de manual propio',
    codigo: '',
    version: '0.1 · Septiembre 2026',
    // Sin PDF de origen: no existe todavia. Se deja vacio en vez de apuntar al
    // del Bodeguero, que diria que estos puntos salen de un documento donde no
    // estan.
    archivo: '',
    tareas: [
      {
        id: 'surtidor-sucursal.operacion',
        nombre: 'Operación de surtido del turno',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '',
        nota: NOTA_OPERACION,
        items: [
          // Varias fotos: una de cada lista y del pasillo surtido. LIMITE
          // HONESTO, escrito para que no se lea como candado: la app pide N
          // fotos con su hora de captura, pero NO PUEDE exigir que sean una por
          // pasillo -no sabe cuantos pasillos tiene la tienda ni cuantas listas
          // recibio esa persona-. Eso lo verifica la Encargada mirandolas. El
          // dia que exista el AMBITO como dato (pasillo 1, pasillo 2, con su
          // etiqueta fisica) se vuelve exigible solo: es Fase 3, y este punto
          // es el caso de uso que la justifica.
          { texto: 'Surtí las listas de pasillo que recibí' },
          { texto: 'Confirmé código, descripción y presentación contra el físico antes de subirlo al pasillo' },
          { texto: 'Conté la cantidad contra la lista, no la estimé por caja' },
          { texto: 'Revisé los restos antes de abrir una caja nueva del mismo producto' },
          // Listado: lo que no habia se enumera, uno por renglon.
          { texto: 'Marqué en la lista lo que no había, sin sustituirlo por otro código' },
          { texto: 'Reporté el producto dañado o próximo a caducar en vez de subirlo al pasillo' },
          { texto: 'Dejé el pasillo transitable y sin cajas ni restos al terminar' },
          { texto: 'Atendí primero los pasillos de alta rotación y las listas marcadas como urgentes' },
          // Cuadro de texto: lo que quedo sin surtir y por que.
          { texto: 'Devolví las listas atendidas y anoté lo que quedó sin surtir y por qué' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  KILEADORA DE SUCURSAL — 22/sep/2026
  //
  //  NORMA DERIVADA, NO TRANSCRITA. No hay PDF: estos nueve puntos se
  //  derivaron de la operacion de granel y del estilo del Anaquelista y el
  //  Surtidor, y David los aprobo con la lista enfrente.
  //
  //  EL PUESTO SE DECLARO EL MISMO DIA, y hay que decir por que: la operacion
  //  existia -«kileado» estaba en el vocabulario del dictado por voz desde
  //  hace meses- pero el PUESTO no estaba en ningun sitio. Medido antes de
  //  escribir: 0 en el organigrama, 0 en la nomina, 0 de 149 fichas activas.
  //
  //  ⚠ HOY NO SE LE ENTREGA A NADIE, Y NO ES UN DEFECTO. El emisor reparte por
  //  `puestoId`, y ninguna ficha lo tiene todavia. Se escribe igual porque LA
  //  NORMA ES DE LA PLAZA, NO DE QUIEN LA OCUPA (§4): el dia que Capital
  //  Humano le ponga el puesto a esas personas, sus tareas salen a las 00:00
  //  sin tocar una linea de codigo. Mientras tanto el censo del emisor NO va a
  //  nombrar a «Kileadora» entre los puestos sin manual, porque ese censo
  //  cuenta gente, y aqui todavia no hay.
  //
  //  SELLO PROPIO Y FEO A PROPOSITO: estos puntos no salen de ningun manual
  //  publicado, asi que sellarlos con el de otro puesto afirmaria que estan en
  //  un papel donde no estan (§5.4). Se lee como lo que es -derivado, v0.1-
  //  hasta que Capital Humano escriba el suyo.
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['kileadora'],
    documento: 'Operación de la Kileadora — derivado, pendiente de manual propio',
    codigo: '',
    version: '0.1 · Septiembre 2026',
    // Sin PDF de origen: no existe todavia. Vacio en vez de apuntar al del
    // Anaquelista, que diria que estos puntos salen de un documento ajeno.
    archivo: '',
    tareas: [
      {
        id: 'kileadora.operacion',
        nombre: 'Operación de kileo del turno',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '',
        nota: NOTA_OPERACION,
        items: [
          // El instrumento primero: todo lo que sigue depende de que la bascula
          // este bien. Un kilo mal pesado no se detecta despues mirando bolsas.
          { texto: 'Revisé que la báscula estuviera en cero y con su verificación vigente antes de pesar' },
          { texto: 'Usé cofia, guantes y utensilio limpio para manipular el producto a granel' },
          { texto: 'Revisé la caducidad del granel antes de abrir y solo empaqué producto dentro de fecha' },
          { texto: 'Etiqueté cada bolsa con su peso, precio y fecha de empaque, legibles' },
          // El mismo punto que ya traen el Anaquelista y el Cajero: la
          // diferencia de precio se avisa ANTES de Caja, y no la decide quien
          // la encuentra.
          { texto: 'Comparé el precio de la etiqueta contra la lista vigente del día y avisé de cualquier diferencia antes de que llegara a Caja' },
          { texto: 'Mantuve los recipientes tapados y rotulados, sin mezclar producto de dos lotes' },
          { texto: 'Repuse el exhibidor de bolsas kileadas y retiré las que ya no estaban en condiciones de venta' },
          // Registrar la merma, NO decidirla: el criterio de merma y descuento
          // es de la Encargada, igual que en el manual del Anaquelista.
          { texto: 'Registré la merma y los restos del día en vez de reintegrarlos al granel' },
          { texto: 'Dejé el área, la báscula y los utensilios limpios y sin producto expuesto al terminar' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ALMACENISTA DE SUCURSAL
  //  Base: el manual INTEGRADO (estándar corporativo para toda sucursal).
  //  El manual del Almacenista de 8 Esquinas (MDDLA-OP-ALM-8E-001) añade
  //  controles propios de esa sucursal (recepción de proveedores locales,
  //  carpeta semanal para Prevención); no se reparten a todas las sucursales
  //  porque no todas tienen ese flujo.
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['almacenista-sucursal'],
    documento: 'Manual Corporativo de Operación — Almacenista de Sucursal (Integrado)',
    codigo: 'MDDLA-OP-ALM-SUC-001',
    version: '1.0 · 2026',
    archivo: '19. Manual_Corporativo_Almacenista INTEGRADO_de_Sucursal_MDDLA_2026.pdf',
    formatosNoAutomatizados: [
      'Anexo 2. Control de caducidades y rotación',
      'Anexo 3. Control de restos y excesos',
      'Anexo 4. Bitácora de diferencias físicas',
      'Anexo 5. Mapa de ubicaciones del almacén',
      'Anexo 7. Entrega-recepción de ausencia o cambio de responsable',
      'Anexo 8. Matriz de funciones por sucursal',
      'Anexo 9. Tablero mensual de indicadores',
    ],
    tareas: [
      {
        id: 'almacenista-sucursal.diario',
        nombre: 'Checklist diario de almacén',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo 1',
        items: [
          { texto: 'Pasillos libres' },
          { texto: 'Mercancía en ubicación correcta' },
          { texto: 'Restos revisados' },
          { texto: 'Excesos identificados' },
          { texto: 'Producto fecha corta identificado' },
          { texto: 'Escaleras en condición segura' },
          { texto: 'Estibas estables' },
          { texto: 'Producto de limpieza separado de alimentos' },
          { texto: 'Chocolate/producto sensible en zona adecuada' },
          { texto: 'Mercancía pendiente identificada' },
        ],
      },
      {
        id: 'almacenista-sucursal.seguridad',
        nombre: 'Checklist de seguridad de almacén',
        momento: 'operacion', frecuencia: 'Semanal', diaSemana: 'Lunes', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo 6',
        nota: 'El anexo pide estado y acción requerida por elemento. Lo que no cumpla se reporta con su acción y responsable en las observaciones.',
        items: [
          { texto: 'Escaleras y antiderrapante en condición segura' },
          { texto: 'Carretas en condición de uso' },
          { texto: 'Estibas estables y dentro de límite' },
          { texto: 'Pasillos despejados' },
          { texto: 'Sin goteras ni humedad' },
          { texto: 'Producto pesado fuera de altura' },
          { texto: 'Separación de químicos y productos con olor' },
        ],
      },
      {
        id: 'almacenista-sucursal.operacion',
        nombre: 'Operación de almacén del turno',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '3.2 – 3.8',
        nota: NOTA_OPERACION,
        items: [
          { texto: 'Revisé pendientes del día anterior y mercancía por acomodar' },
          { texto: 'Validé producto, etiqueta, cantidad y estado físico antes de acomodar' },
          { texto: 'Detuve el acomodo y reporté cuando una etiqueta no coincidía con el producto' },
          { texto: 'Separé y reporté daño, humedad o producto no conforme antes de mezclarlo' },
          { texto: 'Comparé caducidades contra la existencia previa al acomodar' },
          { texto: 'Revisé restos antes de surtir una caja nueva del mismo producto' },
          { texto: 'Surtí solo contra lista, ticket o instrucción autorizada' },
          { texto: 'No entregué mercancía a otras sucursales o áreas sin respaldo ni autorización' },
          { texto: 'No hice ajustes de inventario por cuenta propia' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  RECEPCIÓN DE MERCANCÍA DE SUCURSAL
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['recepcion-mercancia-sucursal'],
    documento: 'Manual Corporativo de Operación — Recepción de Mercancía PH',
    codigo: 'RM-PH',
    version: '1.0 · 2026',
    archivo: '10. Manual_Corporativo_Recepcion_Mercancia_PH_COMPLETO_CON_ANEXOS.pdf',
    formatosNoAutomatizados: [
      'RM-PH-01 Agenda de proveedores y capacidad de recepción',
      'RM-PH-03 Formato de diferencias de recepción',
      'RM-PH-04 Registro de producto dañado o fecha corta',
      'RM-PH-05 Acuse de transferencia Recepción–Almacén',
      'RM-PH-07 Incidencia de etiquetado',
      'RM-PH-08 Duplicidad',
      'RM-PH-09 Devolución',
      'RM-PH-10 Registro de tiempos y volumen',
    ],
    tareas: [
      {
        id: 'recepcion-mercancia-sucursal.recepcion',
        nombre: 'Checklist de recepción de mercancía',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'RM-PH-02', porEvento: true,
        nota: 'El manual lo llena en CADA recepción. Aquí se entrega una vez al día como registro consolidado de la jornada.',
        items: [
          { texto: 'Proveedor identificado' },
          { texto: 'Factura o remisión recibida' },
          { texto: 'Destino validado' },
          { texto: 'Compra/Drive validado' },
          { texto: 'Unidad de medida verificada' },
          { texto: 'Cantidad conciliada' },
          { texto: 'Estado físico revisado' },
          { texto: 'Caducidad revisada' },
          { texto: 'Código y presentación verificados' },
          { texto: 'Etiqueta colocada' },
          { texto: 'Entrada registrada en Kepler' },
          { texto: 'Póliza generada' },
          { texto: 'Liberación autorizada' },
        ],
      },
      {
        id: 'recepcion-mercancia-sucursal.seguridad',
        nombre: 'Checklist de seguridad y orden del área',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'RM-PH-11',
        items: [
          { texto: 'Área despejada' },
          { texto: 'Pasillos libres' },
          { texto: 'Mercancía segregada' },
          { texto: 'Altura segura' },
          { texto: 'Carretas en buen estado' },
          { texto: 'Calzado adecuado' },
          { texto: 'Cámaras funcionales' },
          { texto: 'Incidencias reportadas' },
        ],
      },
      {
        id: 'recepcion-mercancia-sucursal.cierre',
        nombre: 'Cierre diario de recepción',
        momento: 'cierre', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'RM-PH-12',
        items: [
          { texto: 'Recepciones cerradas' },
          { texto: 'Pendientes de compra identificados' },
          { texto: 'Notas de crédito atendidas' },
          { texto: 'Devoluciones registradas' },
          { texto: 'Correcciones de etiqueta aplicadas' },
          { texto: 'Documentos por entregar concentrados' },
          { texto: 'Área ordenada' },
        ],
      },
      {
        id: 'recepcion-mercancia-sucursal.carpeta-prevencion',
        nombre: 'Control semanal de carpeta para Prevención',
        momento: 'administrativo', frecuencia: 'Semanal', diaSemana: 'Viernes', horaLimite: H_LIMITE,
        codigoFormato: 'RM-PH-06',
        items: [
          { texto: 'Folios y compras de la semana integrados' },
          { texto: 'Entradas registradas' },
          { texto: 'Pólizas integradas' },
          { texto: 'Facturas y vales completos' },
          { texto: 'Correcciones aplicadas y cerradas' },
          { texto: 'Carpeta entregada a Prevención' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  CHECADOR (Operaciones de Zona y CEDIS)
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['checador', 'checador-cedis'],
    documento: 'Manual Corporativo de Operación — Checador de CEDIS',
    codigo: 'CEDIS-CH',
    version: '1.0 · 2026',
    archivo: '8. Manual_Corporativo_Checador_CEDIS_COMPLETO_CON_ANEXOS.pdf',
    formatosNoAutomatizados: [
      'CEDIS-CH-02 Formato de diferencias de pedido',
      'CEDIS-CH-03 Control de incidencias de checado',
      'CEDIS-CH-04 Registro diario de cajas y pedidos revisados',
      'CEDIS-CH-05 Control de errores e indicadores',
    ],
    tareas: [
      {
        id: 'checador.checado-pedido',
        nombre: 'Checklist de checado de pedido',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'CEDIS-CH-01', porEvento: true,
        nota: 'El manual lo aplica por CADA pedido. Aquí se entrega una vez al día como registro consolidado; un "No" en código, cantidad, destino, mercancía sin etiqueta o diferencia sin resolver impide liberar la carga.',
        items: [
          { texto: 'Pedido corresponde a la sucursal indicada.' },
          { texto: 'Ticket y etiquetas corresponden al mismo destino.' },
          { texto: 'Código de producto coincide con mercancía física.' },
          { texto: 'Descripción/presentación coincide con la caja.' },
          { texto: 'Cantidad física coincide con ticket.' },
          { texto: 'Cajas y camas de tarima fueron contadas.' },
          { texto: 'Se revisaron frente, laterales, parte posterior e interior visible de la tarima.' },
          { texto: 'No existen cajas sin etiqueta de checado.' },
          { texto: 'No existe mercancía de otra sucursal mezclada.' },
          { texto: 'Producto dañado fue separado o escalado.' },
          { texto: 'Producto próximo a caducar fue reportado cuando aplique.' },
          { texto: 'Diferencias detectadas fueron corregidas o documentadas.' },
          { texto: 'Pedido quedó acomodado para carga sin obstrucciones.' },
          { texto: 'No queda mercancía pendiente de revisión asociada al pedido.' },
        ],
      },
      {
        id: 'checador.liberacion-carga',
        nombre: 'Liberación de pedido para carga',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'CEDIS-CH-06', porEvento: true,
        nota: 'Con este formato el Checador confirma que terminó su revisión y transfiere el pedido a carga. No se libera con una diferencia crítica pendiente: la excepción la autoriza y documenta la Jefatura de CEDIS.',
        items: [
          { texto: 'Código, descripción y cantidad verificados contra ticket.' },
          { texto: 'Todas las cajas fueron revisadas y cuentan con etiqueta de checado.' },
          { texto: 'No existe mercancía de otra sucursal dentro de la carga.' },
          { texto: 'Diferencias detectadas quedaron corregidas/cerradas.' },
          { texto: 'Producto dañado o no conforme fue retirado/escalado.' },
          { texto: 'Pedido está físicamente disponible y acomodado para carga.' },
        ],
      },
      {
        id: 'checador.seguridad-area',
        nombre: 'Checklist de seguridad, orden y limpieza del área',
        momento: 'cierre', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'CEDIS-CH-07',
        nota: 'El anexo se revisa al inicio y al cierre del turno.',
        items: [
          { texto: 'Pasillos libres de cajas, etiquetas y residuos.' },
          { texto: 'Tarimas colocadas sin bloquear rutas de tránsito.' },
          { texto: 'Patín en condición visible adecuada y estacionado de forma segura.' },
          { texto: 'Calzado/equipo de protección requerido disponible y utilizado.' },
          { texto: 'No se manipulan cargas que excedan capacidad segura de la persona/equipo.' },
          { texto: 'Cajas inestables o dañadas fueron corregidas antes de movimiento.' },
          { texto: 'Área de checado despejada y residuos de etiquetas retirados.' },
          { texto: 'Se reportaron golpes, esguinces, casi accidentes o condiciones inseguras.' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  AUXILIAR DE CEDIS
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['auxiliar-cedis'],
    documento: 'Manual Corporativo de Operación — Auxiliar de CEDIS',
    codigo: 'CEDIS-AUX',
    version: '1.0 · 2026',
    archivo: '13. Manual_Corporativo_Auxiliar_CEDIS.pdf',
    formatosNoAutomatizados: [
      'CEDIS-AUX-02 Asignación diaria de personal',
      'CEDIS-AUX-03 Control de recepción y repartición',
      'CEDIS-AUX-04 Registro de diferencias de recepción',
      'CEDIS-AUX-05 Control de surtido por sucursal',
      'CEDIS-AUX-06 Liberación a embarque',
      'CEDIS-AUX-07 Bitácora de saturación y capacidad',
      'CEDIS-AUX-09 Reporte de condición insegura / casi accidente',
      'CEDIS-AUX-10 Control de inventario y diferencias',
      'CEDIS-AUX-11 Contingencia por falla de Kepler',
    ],
    tareas: [
      {
        id: 'auxiliar-cedis.jornada',
        nombre: 'Checklist de inicio y cierre de jornada',
        momento: 'cierre', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'CEDIS-AUX-01',
        items: [
          { texto: 'Personal disponible y ausencias registradas' },
          { texto: 'Descargas esperadas identificadas' },
          { texto: 'Cargas por sucursal definidas' },
          { texto: 'Pasillos pendientes identificados' },
          { texto: 'Mercancía por repartir controlada' },
          { texto: 'Orden y limpieza al cierre' },
          { texto: 'Incidencias escaladas' },
        ],
      },
      {
        id: 'auxiliar-cedis.montacargas',
        nombre: 'Checklist de seguridad de montacargas y maniobras',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'CEDIS-AUX-08',
        items: [
          { texto: 'Operador autorizado' },
          { texto: 'Zona despejada' },
          { texto: 'Sin celular ni distracciones' },
          { texto: 'Tarimas íntegras' },
          { texto: 'Carga estable' },
          { texto: 'Pasillos libres' },
          { texto: 'Incidencias reportadas' },
        ],
      },
      {
        id: 'auxiliar-cedis.operacion',
        nombre: 'Operación de CEDIS del turno',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '3.1 – 3.9',
        nota: NOTA_OPERACION,
        items: [
          { texto: 'Asigné actividades al personal al inicio de la jornada' },
          { texto: 'La recepción y descarga se hizo con conteo, no solo contra documento' },
          { texto: 'La repartición por sucursal quedó validada' },
          { texto: 'Vigilé la capacidad del acomodo para no bloquear pasillos' },
          { texto: 'El surtido interno salió contra instrucción autorizada' },
          { texto: 'Las diferencias de checado se corrigieron antes de liberar' },
          { texto: 'El embarque salió con su documentación completa' },
          { texto: 'Las diferencias de inventario quedaron escaladas' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  RECEPCIÓN DE PRODUCTO CEDIS
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['recepcion-producto-cedis'],
    documento: 'Manual Corporativo de Operación — Recepción de Mercancía CEDIS',
    codigo: '',
    version: '1.0 · Agosto 2026',
    archivo: '17. Manual_Corporativo_Recepcion_de_Mercancia_CEDIS_MDDLA_2026.pdf',
    formatosNoAutomatizados: [
      'Anexo B. Registro sugerido de incidencias de proveedor',
      'Anexo C. Validación de capacitación de respaldo',
    ],
    tareas: [
      {
        id: 'recepcion-producto-cedis.recepcion',
        nombre: 'Checklist de recepción de mercancía',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo A', porEvento: true,
        nota: 'El manual lo llena en cada recepción. Aquí se entrega una vez al día como registro consolidado de la jornada.',
        items: [
          { texto: 'Existe factura/remisión y vale de recepción' },
          { texto: 'Proveedor/unidad corresponden a la recepción prevista' },
          { texto: 'Producto y código corresponden al documento' },
          { texto: 'Presentación/gramaje/unidad por cartón correctos' },
          { texto: 'Cantidad física conciliada' },
          { texto: 'Caducidad revisada cuando aplica' },
          { texto: 'Condición física aceptable' },
          { texto: 'Etiquetas emitidas y colocadas' },
          { texto: 'Repartición por sucursal validada cuando aplica' },
          { texto: 'Incidencias documentadas y autorizadas' },
          { texto: 'Vale entregado a Entradas y Salidas' },
        ],
      },
      {
        id: 'recepcion-producto-cedis.operacion',
        nombre: 'Operación de recepción del turno',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '3.1 – 3.11',
        nota: NOTA_OPERACION,
        items: [
          { texto: 'Preparé la recepción con el vale y la documentación antes de la descarga' },
          { texto: 'Identifiqué y conté la mercancía durante la descarga, sin dar por buena la remisión' },
          { texto: 'Emití y coloqué las etiquetas del producto recibido' },
          { texto: 'Documenté las incidencias del proveedor y las escalé cuando correspondía' },
          { texto: 'Cerré la recepción y entregué el vale a Entradas y Salidas' },
          { texto: 'Las maniobras de descarga se hicieron sin exceder la capacidad segura del equipo' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ENTRADAS Y SALIDAS DE ALMACÉN CEDIS
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['entradas-salidas-cedis'],
    documento: 'Manual Corporativo de Operación — Entradas y Salidas de Almacén CEDIS',
    codigo: '',
    version: '1.0 · Agosto 2026',
    archivo: '16. Manual_Corporativo_Entradas_y_Salidas_Almacen_CEDIS_MDDLA_2026.pdf',
    formatosNoAutomatizados: [
      'Anexo B. Registro de diferencia de recepción',
      'Anexo D. Control de pólizas Kepler',
    ],
    tareas: [
      {
        id: 'entradas-salidas-cedis.entrada-proveedor',
        nombre: 'Checklist de entrada de proveedor',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo A', porEvento: true,
        nota: 'El manual lo llena por cada entrada de proveedor. Aquí se entrega una vez al día como registro consolidado.',
        items: [
          { texto: 'Factura/remisión recibida' },
          { texto: 'Orden de compra localizada' },
          { texto: 'Productos/cantidades cotejados' },
          { texto: 'Mercancía no solicitada consultada con Compras' },
          { texto: 'Vale generado por factura' },
          { texto: 'Repartición entregada' },
          { texto: 'Recepción física concluida' },
          { texto: 'Diferencias documentadas/resueltas' },
          { texto: 'Precios validados' },
          { texto: 'Entrada de almacén registrada' },
          { texto: 'Póliza Kepler generada' },
          { texto: 'Póliza y factura entregadas a Compras' },
        ],
      },
      {
        id: 'entradas-salidas-cedis.salida-sucursal',
        nombre: 'Checklist de salida a sucursal',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo C', porEvento: true,
        nota: 'El manual lo llena por cada salida. Aquí se entrega una vez al día como registro consolidado.',
        items: [
          { texto: 'Sucursal destino confirmada' },
          { texto: 'Cotizaciones/tickets recibidos de Checado' },
          { texto: 'Embarques confirma mercancía que viajará' },
          { texto: 'Tickets procesados sin bloqueos pendientes' },
          { texto: 'Existencia suficiente validada' },
          { texto: 'Traspaso/ticket de sucursal generado' },
          { texto: 'Copias y anexos integrados' },
          { texto: 'Documentación entregada a unidad/Logística' },
          { texto: 'Incidencia pendiente autorizada por Jefatura (si aplica)' },
          { texto: 'Evidencia archivada' },
        ],
      },
      {
        id: 'entradas-salidas-cedis.operacion',
        nombre: 'Operación administrativa del turno',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '3.1 – 3.8',
        nota: NOTA_OPERACION,
        items: [
          { texto: 'Comparé la documentación recibida contra la orden de compra' },
          { texto: 'Elaboré el vale y la repartición por sucursal' },
          { texto: 'Registré la entrada al almacén de lo recibido' },
          { texto: 'Generé la póliza definitiva en Kepler' },
          { texto: 'Los traspasos a sucursal quedaron cobrados o autorizados' },
          { texto: 'Las devoluciones de sucursales quedaron documentadas' },
          { texto: 'Consulté a Compras la mercancía no solicitada, sin darle entrada' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  COORDINADOR DE OPERACIONES DE ZONA
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['coordinador-operaciones-zona'],
    documento: 'Manual Corporativo de Operación — Supervisor Operativo TLMK La Piedad',
    codigo: '',
    version: '1.0 · 2026',
    archivo: '2. Manual_Corporativo_Supervisor_Operativo_TLMK_La_Piedad.pdf',
    formatosNoAutomatizados: [
      'Anexo B. Control de pedidos y rutas',
      'Anexo C. Registro de errores',
      'Anexo D. Formato de devolución',
      'Anexo E. Reporte semanal',
    ],
    tareas: [
      {
        id: 'coordinador-operaciones-zona.diario',
        nombre: 'Checklist diario del Supervisor',
        momento: 'cierre', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo A',
        items: [
          { texto: 'Revisé pedidos de sucursal y TLMK.', bloque: 'Inicio' },
          { texto: 'Identifiqué pedidos creados o bloqueados.', bloque: 'Inicio' },
          { texto: 'Definí prioridades y asigné personal.', bloque: 'Inicio' },
          { texto: 'Cada pedido está en carro o carreta separada.', bloque: 'Surtido' },
          { texto: 'Pedidos urgentes cuentan con instrucción clara.', bloque: 'Surtido' },
          { texto: 'Todos los pedidos fueron verificados.', bloque: 'Checado' },
          { texto: 'No hay diferencias abiertas.', bloque: 'Checado' },
          { texto: 'Cajas, paqueterías y secuencia están completas.', bloque: 'Corrección' },
          { texto: 'La mercancía coincide con la guía.', bloque: 'Guía' },
          { texto: 'La unidad se entregó a Logística.', bloque: 'Carga' },
          { texto: 'Registré devoluciones e incidencias.', bloque: 'Carga' },
          { texto: 'Comuniqué retrasos y causas.', bloque: 'Cierre' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FACTURACIÓN
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['facturacion'],
    documento: 'Manual Corporativo de Operación — Analista de Facturación y Control Documental TLMK',
    codigo: 'MDDLA-TLMK-FAC-01',
    version: '1.0 · 2026',
    archivo: '3. Manual_Corporativo_Analista_Facturacion_Control_Documental_TLMK_MDDLA.pdf',
    formatosNoAutomatizados: [
      'Anexo 2. Bitácora de incidencias',
      'Anexo 3. Bitácora de cancelaciones y refacturaciones',
      'Anexo 5. Matriz de cobertura del puesto',
    ],
    tareas: [
      {
        id: 'facturacion.diario',
        nombre: 'Checklist diario del puesto',
        momento: 'cierre', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo 1',
        items: [
          { texto: 'Generar reporte de facturas del día anterior', bloque: 'Inicio' },
          { texto: 'Revisar pendientes, devoluciones o errores reportados', bloque: 'Inicio' },
          { texto: 'Confirmar autorización de pedidos', bloque: 'Operación' },
          { texto: 'Corregir negados y sustituciones', bloque: 'Operación' },
          { texto: 'Entregar pedidos corregidos a checado', bloque: 'Operación' },
          { texto: 'Validar cliente, importe y tipo de comprobante', bloque: 'Facturación' },
          { texto: 'Verificar datos fiscales y códigos SAT', bloque: 'Facturación' },
          { texto: 'Asignar transporte y generar guía', bloque: 'Ruta' },
          { texto: 'Confirmar documentación completa contra hoja de carga', bloque: 'Ruta' },
          { texto: 'Archivar tickets, facturas y remisiones', bloque: 'Cierre' },
          { texto: 'Entregar reporte y carpeta a Crédito y Cobranza', bloque: 'Cierre' },
        ],
      },
      {
        id: 'facturacion.liberacion-ruta',
        nombre: 'Checklist de liberación documental de ruta',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo 4', porEvento: true,
        nota: 'El manual lo llena por cada ruta o guía. Aquí se entrega una vez al día como registro consolidado.',
        items: [
          { texto: 'Factura o remisión integrada' },
          { texto: 'Ticket de surtido integrado' },
          { texto: 'Ticket de checado integrado' },
          { texto: 'Documento entregado a la ruta' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  COORDINACIÓN DE COMPRAS
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['coordinacion-compras'],
    documento: 'Manual Corporativo de Operación — Jefatura de Compras',
    codigo: 'MDDLA-MCO-COM-01',
    version: '1.0 · 2026',
    archivo: '1. Manual_Corporativo_Jefa_de_Compras_MDDLA.pdf',
    formatosNoAutomatizados: ['Anexo B. Formato de seguimiento de órdenes'],
    tareas: [
      {
        id: 'coordinacion-compras.diario',
        nombre: 'Checklist diario de la Jefatura de Compras',
        momento: 'cierre', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo A',
        items: [
          { texto: 'Faltantes y riesgos críticos revisados.' },
          { texto: 'Pedidos vencidos o incompletos atendidos.' },
          { texto: 'Sugerencias de compra validadas.' },
          { texto: 'Presupuesto y prioridades coordinados con Finanzas.' },
          { texto: 'Recepciones y diferencias críticas resueltas.' },
          { texto: 'Excedentes y baja rotación con acción vigente.' },
          { texto: 'Cambios de precio o condiciones documentados.' },
          { texto: 'Facturas críticas conciliadas.' },
          { texto: 'Compromisos con proveedores actualizados.' },
          { texto: 'Reporte o tablero ejecutivo actualizado.' },
        ],
      },
      {
        id: 'coordinacion-compras.minuta-semanal',
        nombre: 'Minuta de revisión semanal de Compras',
        momento: 'administrativo', frecuencia: 'Semanal', diaSemana: 'Viernes', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo D',
        nota: 'Cada tema se cierra con hallazgo o decisión, responsable, fecha compromiso y estatus.',
        items: [
          { texto: 'Desabasto' },
          { texto: 'Pedidos pendientes' },
          { texto: 'Presupuesto y pagos' },
          { texto: 'Excedentes' },
          { texto: 'Baja rotación' },
          { texto: 'Promociones' },
          { texto: 'Proveedores' },
          { texto: 'Sistemas / datos' },
        ],
      },
      {
        id: 'coordinacion-compras.evaluacion-proveedor',
        nombre: 'Evaluación mensual de proveedor',
        momento: 'administrativo', frecuencia: 'Mensual', diaMes: 28, horaLimite: H_LIMITE,
        codigoFormato: 'Anexo C',
        nota: 'Ponderación del anexo: entregas completas 25%, entregas a tiempo 25%, calidad y caducidad 15%, exactitud de factura 15%, cumplimiento comercial 10%, atención de incidencias 10%.',
        items: [
          { texto: 'Entregas completas evaluadas (25%)' },
          { texto: 'Entregas a tiempo evaluadas (25%)' },
          { texto: 'Calidad y caducidad evaluadas (15%)' },
          { texto: 'Exactitud de factura evaluada (15%)' },
          { texto: 'Cumplimiento comercial evaluado (10%)' },
          { texto: 'Atención de incidencias evaluada (10%)' },
          { texto: 'Calificación total registrada' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  AUXILIAR ADMINISTRATIVO DE LOGÍSTICA
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['aux-administrativo-logistica'],
    documento: 'Manual Corporativo de Operación — Auxiliar Administrativo de Logística',
    codigo: 'MDDLA-LOG-AAL-001',
    version: '1.0 · 2026',
    archivo: '6. Manual_Corporativo_Auxiliar_Administrativo_Logistica.pdf',
    formatosNoAutomatizados: [
      'Anexo A. Tarjeta mensual de KPIs',
      'Anexo B. Plan de acción por error o atraso',
      'Anexo C. Evaluación de competencias',
      'Anexo D. Lista de transferencia del puesto',
    ],
    tareas: [
      {
        id: 'aux-administrativo-logistica.cierre',
        nombre: 'Checklist de cierre diario',
        momento: 'cierre', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'Anexo E',
        items: [
          { texto: 'Registré las hojas de viaje recibidas y señalé faltantes.' },
          { texto: 'Capturé facturas, gasolina y pólizas del corte correspondiente.' },
          { texto: 'Validé errores antes de entregar a Finanzas.' },
          { texto: 'Actualicé Drive y los controles del área.' },
          { texto: 'Di seguimiento a cartas porte, fletes o facturación de tickets.' },
          { texto: 'Identifiqué pendientes vencidos y los escalé cuando fue necesario.' },
          { texto: 'Organicé soportes y dejé prioridades del día siguiente.' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  AUXILIAR DE LOGÍSTICA — FLOTILLA
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['aux-logistica-flotilla'],
    documento: 'Manual Corporativo de Operación — Auxiliar de Logística, Control Documental y Operativo de Flotilla',
    codigo: 'A',
    version: '1.0 · 2026',
    archivo: '7. Manual_Corporativo_Auxiliar_Logistica_Flotilla_COMPLETO_CON_ANEXOS.pdf',
    formatosNoAutomatizados: [
      'A-01 Ficha maestra y alta de unidad',
      'A-03 Control maestro de pólizas y vencimientos',
      'A-04 Calendario de verificaciones y trámites',
      'A-05 Reporte de falla vehicular',
      'A-06 Orden de ingreso y salida de taller',
      'A-07 Bitácora e historial de mantenimiento por unidad',
      'A-08 Control de kilometraje y mantenimiento preventivo',
      'A-09 Reporte de contingencia en carretera',
      'A-10 Expediente de siniestro',
      'A-11 Control de multas e infracciones',
      'A-12 Control de facturas, pagos y centros de costo',
      'A-15 Evaluación de proveedores y talleres',
      'A-16 Formato de baja, venta o sustitución de unidad',
      'A-17 Minuta de seguimiento de flotilla',
      'A-18 Entrega-recepción y continuidad del puesto',
    ],
    tareas: [
      {
        id: 'aux-logistica-flotilla.seguimiento-semanal',
        nombre: 'Seguimiento operativo semanal de flotilla',
        momento: 'administrativo', frecuencia: 'Semanal', diaSemana: 'Lunes', horaLimite: H_LIMITE,
        codigoFormato: '5.4',
        nota: 'El ciclo de evaluación del manual fija este seguimiento como semanal, junto con la Jefatura de Logística.',
        items: [
          { texto: 'Vencimientos próximos revisados (pólizas, verificación, tenencia)' },
          { texto: 'Unidades en taller con estatus actualizado' },
          { texto: 'Pagos pendientes identificados' },
          { texto: 'Contingencias y siniestros abiertos con seguimiento' },
          { texto: 'Carpeta de continuidad actualizada' },
        ],
      },
      {
        id: 'aux-logistica-flotilla.combustible-semanal',
        nombre: 'Control semanal de combustible',
        momento: 'administrativo', frecuencia: 'Semanal', diaSemana: 'Viernes', horaLimite: H_LIMITE,
        codigoFormato: 'A-13',
        items: [
          { texto: 'Facturas de la semana concentradas' },
          { texto: 'Litros e importe registrados por unidad' },
          { texto: 'Gasto asignado a unidad, área o sucursal' },
          { texto: 'Consumos atípicos observados' },
        ],
      },
      {
        id: 'aux-logistica-flotilla.expediente-vehicular',
        nombre: 'Checklist de expediente vehicular',
        momento: 'administrativo', frecuencia: 'Mensual', diaMes: 25, horaLimite: H_LIMITE,
        codigoFormato: 'A-02',
        nota: 'El manual lo aplica al alta de cada unidad. Aquí se entrega mensual como revisión de integridad del expediente: cada documento debe estar, estar vigente y ser localizable.',
        items: [
          { texto: 'Factura o documento de propiedad' },
          { texto: 'Contrato de arrendamiento' },
          { texto: 'Tarjeta de circulación' },
          { texto: 'Póliza de seguro' },
          { texto: 'Comprobante de verificación' },
          { texto: 'Permisos especiales' },
          { texto: 'Tenencia / refrendo aplicable' },
          { texto: 'Identificación de número económico' },
          { texto: 'Órdenes de taller' },
          { texto: 'Facturas de mantenimiento' },
          { texto: 'Expedientes de siniestros' },
          { texto: 'Historial de kilometraje' },
          { texto: 'Baja o venta, cuando aplique' },
        ],
      },
      {
        id: 'aux-logistica-flotilla.entrega-unidad',
        nombre: 'Checklist de entrega y recepción de unidad',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'A-14', soloPorEvento: true,
        nota: 'Se llena únicamente cuando cambia la custodia de una unidad. La app no la entrega sola porque no puede saber cuándo ocurre: queda aquí como el formato oficial a seguir.',
        items: [
          { texto: 'Carrocería y cristales' },
          { texto: 'Llantas y refacción' },
          { texto: 'Luces y señales' },
          { texto: 'Frenos y dirección' },
          { texto: 'Niveles y fugas' },
          { texto: 'Herramienta / gato' },
          { texto: 'Extintor / equipo de seguridad' },
          { texto: 'Tarjeta de circulación' },
          { texto: 'Póliza de seguro' },
          { texto: 'Kilometraje' },
          { texto: 'Combustible' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  COORDINACIÓN DE AUDITORÍA OPERATIVA Y PREVENCIÓN DE PÉRDIDAS
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['coordinacion-auditoria-prevencion'],
    documento: 'Manual Corporativo de Operación — Coordinación de Auditoría Operativa y Prevención de Pérdidas',
    codigo: '',
    version: '1.0 · 2026',
    archivo: '5. Manual_Corporativo_Coordinacion_Auditoria_Operativa_Prevencion_Perdidas.pdf',
    formatosNoAutomatizados: [
      'Anexo A. Tarjeta mensual de KPIs',
      'Anexo B. Plan de acción por diferencia o riesgo',
      'Anexo C. Evaluación de competencias',
      'Anexo D. Minuta ejecutiva de auditoría o inventario',
      'Anexo E. Lista de transferencia del puesto',
    ],
    tareas: [
      {
        id: 'coordinacion-auditoria-prevencion.cargas-rutas',
        nombre: 'Control diario de cargas y operación de rutas',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '3.2',
        nota: 'Señales de alerta del manual: carga mayor a la habitual, devolución elevada, venta baja con carga alta, movimiento sin soporte y diferencia recurrente.',
        items: [
          { texto: 'Obtener la información de carga por vendedor o unidad.' },
          { texto: 'Comparar la carga con venta histórica, capacidad de desplazamiento, mercancía previa y límites autorizados.' },
          { texto: 'Identificar incrementos atípicos, productos de alto valor o mercancía que exceda la rotación esperada.' },
          { texto: 'Solicitar aclaración al Supervisor de Ruta Directa antes de liberar o normalizar una carga fuera de patrón.' },
          { texto: 'Dar seguimiento a venta, devoluciones y liquidación para confirmar correspondencia.' },
          { texto: 'Registrar incidencias y seleccionar rutas de mayor riesgo para inventario sorpresa.' },
        ],
      },
      {
        id: 'coordinacion-auditoria-prevencion.planeacion',
        nombre: 'Planeación y programación de actividades',
        momento: 'apertura', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '3.1',
        nota: 'Resultado esperado del manual: iniciar cada jornada con prioridades claras y actividades calendarizadas, sin descuidar los procesos quincenales o mensuales.',
        items: [
          { texto: 'Prioridades del día definidas' },
          { texto: 'Inventarios y conciliaciones calendarizados' },
          { texto: 'Asuntos críticos identificados' },
          { texto: 'Procesos quincenales y mensuales con avance revisado' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  AUXILIAR DE AUDITORÍA Y PREVENCIÓN
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['auxiliar-auditoria-prevencion'],
    documento: 'Manual Corporativo de Operación — Auxiliar de Auditoría y Prevención',
    codigo: 'MDDLA-AOP-AUX-01',
    version: '1.0 · 2026',
    archivo: '9. Manual_Corporativo_Auxiliar_Auditoria_Prevencion_COMPLETO_CON_ANEXOS.pdf',
    formatosNoAutomatizados: [
      'AP-04 Bitácora de anomalías',
      'AP-05 Investigación de diferencias',
      'AP-06 Ajustes',
      'AP-07 Inventario de ruta',
      'AP-09 Faltantes y sobrantes',
      'AP-10 Incidencias de inventario',
      'AP-14 Seguimiento de diferencias',
      'AP-16 Cierre de investigación',
    ],
    tareas: [
      {
        id: 'auxiliar-auditoria-prevencion.conciliacion',
        nombre: 'Conciliación de traspasos y compras',
        momento: 'operacion', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: 'AP-03',
        nota: 'La tabla de implementación del manual marca este formato como diario/semanal; la app lo entrega diario y la Coordinación interviene en las excepciones.',
        items: [
          { texto: 'Traspasos del periodo identificados' },
          { texto: 'Compra o entrada correspondiente localizada en la sucursal destino' },
          { texto: 'Cantidad coincide' },
          { texto: 'Costo coincide' },
          { texto: 'Excepciones escaladas a Coordinación' },
        ],
      },
      {
        id: 'auxiliar-auditoria-prevencion.jornada',
        nombre: 'Inicio de jornada y control diario de rutas',
        momento: 'apertura', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '3.2 – 3.3',
        nota: NOTA_OPERACION,
        items: [
          { texto: 'Prioricé los pendientes de control del día' },
          { texto: 'Revisé las ventas de rutas del día anterior' },
          { texto: 'Comparé carga contra venta y devolución de cada ruta' },
          { texto: 'Identifiqué movimientos atípicos o sin soporte' },
          { texto: 'Escalé a Coordinación lo que salió del patrón' },
          { texto: 'Registré las incidencias detectadas' },
        ],
      },
      {
        id: 'auxiliar-auditoria-prevencion.carpetas',
        nombre: 'Revisión de carpetas de sucursal',
        momento: 'administrativo', frecuencia: 'Semanal', diaSemana: 'Viernes', horaLimite: H_LIMITE,
        codigoFormato: 'AP-01',
        nota: 'Objetivo del formato: que la documentación semanal de cada sucursal permita reconstruir entradas, salidas, pólizas, devoluciones, ajustes y cancelaciones.',
        items: [
          { texto: 'Entradas completas' },
          { texto: 'Salidas completas' },
          { texto: 'Pólizas completas' },
          { texto: 'Devoluciones completas' },
          { texto: 'Ajustes completos' },
          { texto: 'Cancelaciones completas' },
          { texto: 'Pendientes enviados con fecha compromiso' },
        ],
      },
      {
        id: 'auxiliar-auditoria-prevencion.compras-pendientes',
        nombre: 'Control semanal de compras pendientes',
        momento: 'administrativo', frecuencia: 'Semanal', diaSemana: 'Viernes', horaLimite: H_LIMITE,
        codigoFormato: 'AP-02',
        items: [
          { texto: 'Traspasos sin compra o entrada en destino identificados' },
          { texto: 'Motivo del pendiente documentado' },
          { texto: 'Responsable contactado' },
          { texto: 'Compromiso de cierre registrado' },
          { texto: 'Estatus actualizado' },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  GERENCIA DE ZONA
  // ══════════════════════════════════════════════════════════════════════════
  {
    puestoIds: ['gerencia-zona'],
    documento: 'Manual Corporativo de Operación — Jefatura de Zona (Maestro)',
    codigo: '',
    version: '1.0 · Julio 2026',
    archivo: '4. Manual_Corporativo_Jefatura_Zona_La_Piedad_Maestro.pdf',
    formatosNoAutomatizados: [
      'Anexo 1. Tarjeta mensual de KPIs',
      'Anexo 2. Formato de plan de mejora',
      'Anexo 3. Evaluación de competencias',
      'Anexo 4. Minuta de revisión ejecutiva',
      'Anexo 5. Lista de transferencia del puesto',
    ],
    tareas: [
      {
        id: 'gerencia-zona.supervision-sucursal',
        nombre: 'Checklist de supervisión de sucursal',
        momento: 'supervision', frecuencia: 'Semanal', diaSemana: 'Miércoles', horaLimite: H_LIMITE,
        codigoFormato: '3.2.8',
        nota: 'Criterios esenciales de conformidad por área. El manual pide que la frecuencia de visita se defina por riesgo, desempeño, rotación y resultados; la app la entrega semanal como piso mínimo. Un control no se da por cumplido solo porque exista el formato: la información debe reflejar lo ocurrido.',
        items: [
          { texto: 'Apertura y cierre: horarios cumplidos, responsables definidos, alarmas y accesos controlados, checklist completo y desviaciones reportadas.' },
          { texto: 'Personal: cobertura razonable, presentación, puntualidad, asignación de actividades, descansos y comportamiento conforme a lineamientos.' },
          { texto: 'Venta e imagen: precios y promociones correctos, abasto visible, limpieza, exhibiciones vigentes, enfoque comercial y atención adecuada.' },
          { texto: 'Inventario: rotación, identificación, integridad, entradas y salidas registradas, diferencias investigadas y productos de riesgo controlados.' },
          { texto: 'Efectivo y cajas: arqueos, retiros, resguardo, devoluciones y autorizaciones documentados; acceso limitado a personal facultado.' },
          { texto: 'Bodega y seguridad: orden, pasillos libres, estiba segura, mercancía identificada, prevención de daños y condiciones adecuadas de trabajo.' },
        ],
      },
      {
        id: 'gerencia-zona.reporte-diario',
        nombre: 'Reporte diario de zona',
        momento: 'cierre', frecuencia: 'Diaria', horaLimite: H_LIMITE,
        codigoFormato: '3.1.12',
        nota: 'Registro de rendición de cuentas del puesto, por el canal definido por Dirección.',
        items: [
          { texto: 'Reporte de apertura de las encargaturas confirmado' },
          { texto: 'Incidencias del día documentadas con acción y responsable' },
          { texto: 'Evidencias de seguimiento revisadas dentro del plazo acordado' },
          { texto: 'Hallazgos críticos comunicados el mismo día' },
          { texto: 'Prioridades del día siguiente definidas' },
        ],
      },
    ],
  },
];

// ════════════════════════════════════════════════════════════════════════════
//  CONSULTAS
// ════════════════════════════════════════════════════════════════════════════

/** El manual de un puesto, o null si a ese puesto todavía no le llega manual. */
export function manualDePuesto(puestoId: string | undefined | null): ManualPuesto | null {
  if (!puestoId) return null;
  return MANUALES_POR_PUESTO.find(m => m.puestoIds.includes(puestoId)) || null;
}

/**
 * Las tareas de ESTE manual que le tocan a ESTE puesto.
 *
 * Vive aqui y no dentro de cada consumidor porque la pantalla de «Del manual»
 * recorre `m.puestoIds × m.tareas` a mano: con el filtro copiado alla, bastaria
 * que una copia se quedara atras para que esa pantalla ofreciera asignar una
 * tarea que el robot no le entrega a esa persona, y quien la asignara se
 * quedaria creyendo que hizo algo. Una definicion, todos los consumidores.
 */
export function tareasDelManualPara(manual: ManualPuesto, puestoId: string): TareaManual[] {
  return manual.tareas.filter(t => !t.soloPuestos || t.soloPuestos.includes(puestoId));
}

/**
 * Las tareas que la app entrega automáticamente a un puesto. Excluye las que
 * dependen de un evento impredecible (`soloPorEvento`).
 */
export function tareasAutomaticasDePuesto(puestoId: string | undefined | null): TareaManual[] {
  const manual = manualDePuesto(puestoId);
  if (!manual || !puestoId) return [];
  return tareasDelManualPara(manual, puestoId).filter(t => !t.soloPorEvento);
}

/** Todas las tareas del manual de un puesto, incluidas las de solo-evento. */
export function tareasDePuesto(puestoId: string | undefined | null): TareaManual[] {
  const manual = manualDePuesto(puestoId);
  if (!manual || !puestoId) return [];
  return tareasDelManualPara(manual, puestoId);
}

/** ¿Este puesto ya tiene manual publicado? */
export function puestoTieneManual(puestoId: string | undefined | null): boolean {
  return manualDePuesto(puestoId) !== null;
}

/** Busca una tarea del manual por su id, en cualquier puesto. */
export function tareaManualPorId(tareaId: string | undefined | null): TareaManual | null {
  if (!tareaId) return null;
  for (const m of MANUALES_POR_PUESTO) {
    const t = m.tareas.find(x => x.id === tareaId);
    if (t) return t;
  }
  return null;
}

/**
 * Puestos del organigrama que aún no tienen manual. Sirve para el tablero de
 * cobertura: son los documentos que faltan por levantar, y mientras no lleguen
 * esa gente no recibe tareas automáticas (a propósito: no se inventan).
 */
export function puestosSinManual(): { id: string; nombre: string }[] {
  return PUESTOS_ORGANIGRAMA
    .filter(p => p.vigente !== false && !puestoTieneManual(p.id))
    .map(p => ({ id: p.id, nombre: p.nombre }));
}

/** Cuántas tareas automáticas hay en total en el catálogo. */
export function totalTareasAutomaticas(): number {
  return MANUALES_POR_PUESTO
    .reduce((n, m) => n + m.tareas.filter(t => !t.soloPorEvento).length, 0);
}
