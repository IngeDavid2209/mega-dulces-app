/**
 * EVIDENCIA QUE PIDE CADA PUNTO DE CONTROL
 *
 * --- POR QUE ESTA APARTE DEL CATALOGO --------------------------------------
 * `tareas-manual.catalogo.ts` es la transcripcion de los Manuales Corporativos:
 * lo que dice ahi lo dice el documento. La evidencia NO sale del documento
 * -los anexos piden marcar, firmar y observar, no fotografiar-, es una decision
 * de la app para que un checklist marcado se pueda auditar. Mezclarlas haria
 * imposible saber despues que vino del manual y que pusimos nosotros.
 *
 * --- LAS DOS REGLAS QUE MANDAN ---------------------------------------------
 *
 * 1. LAS DECLARACIONES NO PIDEN NADA. Los checklists de "Operacion del turno"
 *    estan escritos en primera persona del pasado ("Cobre con mi usuario
 *    propio", "No otorgue descuentos"). No hay objeto que fotografiar ni
 *    documento que adjuntar: son afirmaciones de conducta. Exigirles evidencia
 *    obliga a inventarla, y una evidencia inventada es peor que ninguna.
 *
 * 2. LA EVIDENCIA OBLIGATORIA SE RACIONA. --- REGLA DEROGADA EL 3/SEP/2026 ---
 *
 *    Decia: "De 377 puntos, 50 piden foto. Si pidiera foto en todos, en dos
 *    semanas la plantilla estaria disparando fotos al piso para poder avanzar,
 *    y el dato dejaria de valer."
 *
 *    Direccion decidio lo contrario: TODOS los puntos piden foto, y mas de una.
 *    Se aplica en `robot-manual.service.ts` (`requiresVariasFotos: true`), no
 *    aqui, para que este archivo siga diciendo QUE CLASE de evidencia le toca a
 *    cada punto -y sobre todo cuales son los 45 que piden un DOCUMENTO que ya
 *    existe, porque esos necesitan un selector de archivo y no la camara-.
 *
 *    LA REGLA 1 SIGUE EN PIE COMO ADVERTENCIA, NO COMO FILTRO. Se midieron 62
 *    puntos en primera persona del pasado, y en esos la foto no prueba el
 *    enunciado. Se le planteo a Direccion dejarlos fuera (315 en vez de 377) y
 *    eligio los 377. Queda escrito para que el dia que aparezcan fotos del piso
 *    en esos puntos se sepa que estaba previsto y donde se decidio, en vez de
 *    tratarlo como un descubrimiento.
 *
 * --- COMO SE AMARRA, Y POR QUE ASI -----------------------------------------
 * Por `tareaId` + posicion, y ADEMAS se guarda el texto del punto. Al aplicarse
 * se compara: si el texto ya no coincide -porque el manual se actualizo o los
 * puntos se reordenaron- la evidencia de ese punto simplemente NO se aplica.
 *
 * Es a proposito. Un desfase silencioso pondria "requiere foto de pasillos
 * libres" sobre un punto que ahora habla de otra cosa, y nadie lo notaria.
 * Preferible perder una marca que ponerla en el lugar equivocado.
 */

export interface EvidenciaPunto {
  /** Posicion del punto dentro de la tarea. */
  i: number;
  /** El texto tal como estaba al clasificar. Si cambio, no se aplica nada. */
  texto: string;
  /** Camara obligatoria: estado fisico que una foto prueba. */
  foto?: boolean;
  /** Varias fotos: el punto pide mas de un angulo y lo dice. */
  variasFotos?: boolean;
  /** Adjuntar archivo (PDF/Excel/foto): el documento ya existe. */
  documento?: boolean;
  /** Cantidad de dinero que se cuenta. */
  monto?: boolean;
  /** Numero de documento que el sistema genera. */
  folio?: boolean;
  /** Pide explicacion escrita. */
  comentario?: boolean;
  /**
   * LA EVIDENCIA DE ESTE PUNTO ES LO ESCRITO, NO UNA FOTO.
   *
   * Es la unica excepcion a la orden de Direccion del 3/sep («todos los puntos
   * piden foto»), y se declara punto por punto aqui, nunca a bulto. Hay hechos
   * que una camara no prueba: una ausencia cubierta no tiene objeto que
   * fotografiar, y los pendientes que dejo el turno anterior son una lista.
   * Exigirles foto obliga a inventarla — que es literalmente la regla 1 de este
   * archivo, y lo que la orden de Direccion acepto como riesgo.
   *
   *   'comentario' .. un cuadro de texto. Sin texto, el punto NO esta hecho.
   *   'listado' ..... renglones que se agregan y se quitan. Sin al menos uno,
   *                   el punto NO esta hecho.
   *
   * ⚠ NO ES `comentario: true`. Esa bandera la traen 28 puntos que ADEMAS piden
   * foto, y que llevan meses emitidos asi. Colgar de ella la evidencia escrita
   * les quitaria la camara a los 28 y —peor— reabriria su historico: un punto
   * de agosto cerrado con su foto pasaria a exigir un texto que nadie escribio
   * ese dia. Por eso esto es un campo APARTE y NUEVO: no existe en un solo
   * documento ya emitido, asi que no puede mover un numero del pasado.
   */
  escrito?: 'comentario' | 'listado';
}

export const EVIDENCIA_MANUAL: Record<string, EvidenciaPunto[]> = {
  'almacenista-sucursal.diario': [
    { i: 0, texto: 'Pasillos libres', foto: true },
    { i: 6, texto: 'Estibas estables', foto: true },
    { i: 7, texto: 'Producto de limpieza separado de alimentos', foto: true },
  ],
  'almacenista-sucursal.seguridad': [
    { i: 1, texto: 'Carretas en condición de uso', foto: true },
    { i: 2, texto: 'Estibas estables y dentro de límite', foto: true },
    { i: 3, texto: 'Pasillos despejados', foto: true },
    { i: 4, texto: 'Sin goteras ni humedad', foto: true },
    { i: 5, texto: 'Producto pesado fuera de altura', foto: true },
    { i: 6, texto: 'Separación de químicos y productos con olor', foto: true },
  ],
  'anaquelista.pasillo': [
    { i: 1, texto: 'Faltantes identificados', comentario: true },
    { i: 4, texto: 'Producto frenteado y estable', foto: true },
    { i: 5, texto: 'Pasillo sin cajas/restos', foto: true },
    { i: 6, texto: 'Área limpia', foto: true },
  ],
  'aux-administrativo-logistica.cierre': [
    { i: 4, texto: 'Di seguimiento a cartas porte, fletes o facturación de tickets.', documento: true },
  ],
  'aux-logistica-flotilla.combustible-semanal': [
    { i: 0, texto: 'Facturas de la semana concentradas', documento: true },
    { i: 3, texto: 'Consumos atípicos observados', comentario: true },
  ],
  'aux-logistica-flotilla.entrega-unidad': [
    { i: 0, texto: 'Carrocería y cristales', foto: true },
    { i: 1, texto: 'Llantas y refacción', foto: true },
    { i: 3, texto: 'Frenos y dirección', foto: true },
    { i: 4, texto: 'Niveles y fugas', foto: true },
    { i: 5, texto: 'Herramienta / gato', foto: true },
    { i: 6, texto: 'Extintor / equipo de seguridad', foto: true },
    { i: 7, texto: 'Tarjeta de circulación', documento: true },
    { i: 8, texto: 'Póliza de seguro', documento: true },
  ],
  'aux-logistica-flotilla.expediente-vehicular': [
    { i: 0, texto: 'Factura o documento de propiedad', documento: true },
    { i: 1, texto: 'Contrato de arrendamiento', documento: true },
    { i: 2, texto: 'Tarjeta de circulación', documento: true },
    { i: 3, texto: 'Póliza de seguro', documento: true },
    { i: 4, texto: 'Comprobante de verificación', documento: true },
    { i: 5, texto: 'Permisos especiales', documento: true },
    { i: 6, texto: 'Tenencia / refrendo aplicable', documento: true },
    { i: 9, texto: 'Facturas de mantenimiento', documento: true },
    { i: 10, texto: 'Expedientes de siniestros', documento: true },
    { i: 11, texto: 'Historial de kilometraje', documento: true },
  ],
  'aux-logistica-flotilla.seguimiento-semanal': [
    { i: 0, texto: 'Vencimientos próximos revisados (pólizas, verificación, tenencia)', documento: true },
    { i: 3, texto: 'Contingencias y siniestros abiertos con seguimiento', documento: true },
    { i: 4, texto: 'Carpeta de continuidad actualizada', documento: true },
  ],
  'auxiliar-auditoria-prevencion.carpetas': [
    { i: 2, texto: 'Pólizas completas', documento: true },
  ],
  'auxiliar-auditoria-prevencion.conciliacion': [
    { i: 4, texto: 'Excepciones escaladas a Coordinación', comentario: true },
  ],
  'auxiliar-cedis.jornada': [
    { i: 5, texto: 'Orden y limpieza al cierre', foto: true },
    { i: 6, texto: 'Incidencias escaladas', comentario: true },
  ],
  'auxiliar-cedis.montacargas': [
    { i: 1, texto: 'Zona despejada', foto: true },
    { i: 3, texto: 'Tarimas íntegras', foto: true },
    { i: 4, texto: 'Carga estable', foto: true },
    { i: 5, texto: 'Pasillos libres', foto: true },
    { i: 6, texto: 'Incidencias reportadas', comentario: true },
  ],
  'bodeguero-sucursal.cierre': [
    { i: 0, texto: 'Carretas despejadas o correctamente ubicadas', foto: true },
    { i: 2, texto: 'Restos ordenados', foto: true },
    { i: 3, texto: 'Producto dañado/caducado segregado y marcado', foto: true },
    { i: 4, texto: 'Pasillos libres', foto: true },
  ],
  'bodeguero-sucursal.inicio': [
    { i: 3, texto: 'Faltantes marcados y comunicados', comentario: true },
    { i: 4, texto: 'Pasillos de Bodega transitables', foto: true },
    { i: 5, texto: 'Área de excesos sin incidencias visibles', comentario: true },
  ],
  'cajero-sucursal.apertura': [
    { i: 0, texto: 'Área limpia y ordenada', foto: true },
    { i: 2, texto: 'Fondo contado/registrado', monto: true },
  ],
  'cajero-sucursal.cierre': [
    { i: 0, texto: 'Último cliente atendido y cortina cerrada', foto: true },
    { i: 1, texto: 'Vouchers conciliados', documento: true },
    { i: 4, texto: 'Efectivo arqueado', monto: true },
    { i: 5, texto: 'Diferencias reportadas', comentario: true },
    { i: 6, texto: 'Corte generado', documento: true, folio: true },
  ],
  'checador.checado-pedido': [
    { i: 1, texto: 'Ticket y etiquetas corresponden al mismo destino.', documento: true },
    { i: 4, texto: 'Cantidad física coincide con ticket.', documento: true },
    { i: 6, texto: 'Se revisaron frente, laterales, parte posterior e interior visible de la tarima.', variasFotos: true },
    { i: 11, texto: 'Diferencias detectadas fueron corregidas o documentadas.', comentario: true },
    { i: 12, texto: 'Pedido quedó acomodado para carga sin obstrucciones.', foto: true },
  ],
  'checador.liberacion-carga': [
    { i: 0, texto: 'Código, descripción y cantidad verificados contra ticket.', documento: true },
    { i: 3, texto: 'Diferencias detectadas quedaron corregidas/cerradas.', comentario: true },
    { i: 4, texto: 'Producto dañado o no conforme fue retirado/escalado.', comentario: true },
    { i: 5, texto: 'Pedido está físicamente disponible y acomodado para carga.', foto: true },
  ],
  'checador.seguridad-area': [
    { i: 0, texto: 'Pasillos libres de cajas, etiquetas y residuos.', foto: true },
    { i: 1, texto: 'Tarimas colocadas sin bloquear rutas de tránsito.', foto: true },
    { i: 2, texto: 'Patín en condición visible adecuada y estacionado de forma segura.', foto: true },
    { i: 3, texto: 'Calzado/equipo de protección requerido disponible y utilizado.', foto: true },
    { i: 6, texto: 'Área de checado despejada y residuos de etiquetas retirados.', foto: true },
  ],
  'coordinacion-auditoria-prevencion.cargas-rutas': [
    { i: 5, texto: 'Registrar incidencias y seleccionar rutas de mayor riesgo para inventario sorpresa.', comentario: true },
  ],
  'coordinacion-compras.diario': [
    { i: 0, texto: 'Faltantes y riesgos críticos revisados.', comentario: true },
    { i: 4, texto: 'Recepciones y diferencias críticas resueltas.', comentario: true },
    { i: 7, texto: 'Facturas críticas conciliadas.', documento: true },
  ],
  'coordinacion-compras.evaluacion-proveedor': [
    { i: 3, texto: 'Exactitud de factura evaluada (15%)', documento: true },
    { i: 5, texto: 'Atención de incidencias evaluada (10%)', comentario: true },
  ],
  'coordinador-operaciones-zona.diario': [
    { i: 3, texto: 'Cada pedido está en carro o carreta separada.', foto: true },
    { i: 6, texto: 'No hay diferencias abiertas.', comentario: true },
    { i: 8, texto: 'La mercancía coincide con la guía.', documento: true },
  ],
  'encargado-sucursal.apertura': [
    { i: 0, texto: 'Alarma/candados retirados y acceso seguro', foto: true },
    { i: 4, texto: 'Piso frenteado y sin obstáculos', foto: true },
    { i: 5, texto: 'Bodega despejada y segura', foto: true },
  ],
  // Los dos puntos cuya prueba es lo ESCRITO. Los indices son de la lista
  // reescrita el 21/sep: si el catalogo se reordena, hay que mover estos `i` o
  // la evidencia no se aplica (y el punto volveria a pedir fotos en silencio).
  'encargado-sucursal.operacion': [
    { i: 0, texto: 'Pendientes del turno anterior', escrito: 'listado' },
    {
      i: 4,
      texto: 'Ausencias cubiertas sin dejar Caja, Recepción, Piso ni Bodega desatendidos',
      escrito: 'comentario',
      comentario: true,
    },
  ],
  'encargado-sucursal.cierre': [
    { i: 0, texto: 'Pasillos sin mercancía pendiente de acomodo', foto: true },
    { i: 2, texto: 'Diferencias de Caja reportadas', comentario: true },
    { i: 3, texto: 'Factura global generada', documento: true },
    { i: 7, texto: 'Alarma/candados colocados', foto: true },
  ],
  'entradas-salidas-cedis.entrada-proveedor': [
    { i: 0, texto: 'Factura/remisión recibida', documento: true },
    { i: 1, texto: 'Orden de compra localizada', documento: true },
    { i: 4, texto: 'Vale generado por factura', documento: true, folio: true },
    { i: 7, texto: 'Diferencias documentadas/resueltas', comentario: true },
    { i: 10, texto: 'Póliza Kepler generada', documento: true, folio: true },
    { i: 11, texto: 'Póliza y factura entregadas a Compras', documento: true },
  ],
  'entradas-salidas-cedis.salida-sucursal': [
    { i: 1, texto: 'Cotizaciones/tickets recibidos de Checado', documento: true },
    { i: 3, texto: 'Tickets procesados sin bloqueos pendientes', documento: true },
    { i: 5, texto: 'Traspaso/ticket de sucursal generado', documento: true, folio: true },
    { i: 8, texto: 'Incidencia pendiente autorizada por Jefatura (si aplica)', comentario: true },
  ],
  'facturacion.liberacion-ruta': [
    { i: 0, texto: 'Factura o remisión integrada', documento: true },
    { i: 1, texto: 'Ticket de surtido integrado', documento: true },
    { i: 2, texto: 'Ticket de checado integrado', documento: true },
  ],
  'gerencia-zona.reporte-diario': [
    { i: 1, texto: 'Incidencias del día documentadas con acción y responsable', comentario: true },
  ],
  'gerencia-zona.supervision-sucursal': [
    { i: 0, texto: 'Apertura y cierre: horarios cumplidos, responsables definidos, alarmas y accesos controlados, checklist completo y desviaciones reportadas.', comentario: true },
    { i: 1, texto: 'Personal: cobertura razonable, presentación, puntualidad, asignación de actividades, descansos y comportamiento conforme a lineamientos.', comentario: true },
    { i: 2, texto: 'Venta e imagen: precios y promociones correctos, abasto visible, limpieza, exhibiciones vigentes, enfoque comercial y atención adecuada.', comentario: true },
    { i: 3, texto: 'Inventario: rotación, identificación, integridad, entradas y salidas registradas, diferencias investigadas y productos de riesgo controlados.', comentario: true },
    { i: 4, texto: 'Efectivo y cajas: arqueos, retiros, resguardo, devoluciones y autorizaciones documentados; acceso limitado a personal facultado.', comentario: true },
    { i: 5, texto: 'Bodega y seguridad: orden, pasillos libres, estiba segura, mercancía identificada, prevención de daños y condiciones adecuadas de trabajo.', comentario: true },
  ],
  'recepcion-mercancia-sucursal.carpeta-prevencion': [
    { i: 2, texto: 'Pólizas integradas', documento: true },
    { i: 3, texto: 'Facturas y vales completos', documento: true },
    { i: 5, texto: 'Carpeta entregada a Prevención', documento: true },
  ],
  'recepcion-mercancia-sucursal.cierre': [
    { i: 6, texto: 'Área ordenada', foto: true },
  ],
  'recepcion-mercancia-sucursal.recepcion': [
    { i: 1, texto: 'Factura o remisión recibida', documento: true },
    { i: 10, texto: 'Entrada registrada en Kepler', folio: true },
    { i: 11, texto: 'Póliza generada', documento: true, folio: true },
  ],
  'recepcion-mercancia-sucursal.seguridad': [
    { i: 0, texto: 'Área despejada', foto: true },
    { i: 1, texto: 'Pasillos libres', foto: true },
    { i: 3, texto: 'Altura segura', foto: true },
    { i: 4, texto: 'Carretas en buen estado', foto: true },
    { i: 5, texto: 'Calzado adecuado', foto: true },
    { i: 6, texto: 'Cámaras funcionales', foto: true },
    { i: 7, texto: 'Incidencias reportadas', comentario: true },
  ],
  'recepcion-producto-cedis.recepcion': [
    { i: 0, texto: 'Existe factura/remisión y vale de recepción', documento: true },
    { i: 9, texto: 'Incidencias documentadas y autorizadas', comentario: true },
    { i: 10, texto: 'Vale entregado a Entradas y Salidas', documento: true },
  ],
};

/**
 * La evidencia de un punto, o null si no se le asigno ninguna.
 * Devuelve null tambien cuando el texto ya no coincide (ver cabecera).
 */
export function evidenciaDe(tareaId: string, indice: number, texto: string): EvidenciaPunto | null {
  const filas = EVIDENCIA_MANUAL[tareaId];
  if (!filas) return null;
  const f = filas.find(x => x.i === indice);
  if (!f) return null;
  return f.texto === texto ? f : null;
}
