/**
 * 🎯 LA RESPUESTA: qué le falta a este equipo, ahora mismo
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Capa 1 de la revisión de usuario final (David, 18/sep/2026): una Encargada
 * abre Tareas a las 8 de la mañana con UNA pregunta —«¿quién no ha
 * entregado?»— y la pantalla no la contesta en ningún renglón. Hay 22 controles
 * y hay que abrir ramas del árbol e ir sumando de cabeza.
 *
 * El diagnóstico que originó esto: abrumar no es cantidad, es no saber dónde
 * mirar. Con una línea que conteste arriba, el resto de la pantalla deja de
 * agobiar sin haber quitado nada, porque el ojo ya tiene dónde aterrizar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ NO DICE «12 DE 15 ENTREGADAS», QUE ERA LA FORMA PEDIDA
 * ═══════════════════════════════════════════════════════════════════════════
 * Porque HOY no se puede decir sin mentir, y está medido: sirviendo 5 entregas
 * del equipo con 2 marcadas `enviado`, el árbol contó 3. La lista que alimenta
 * esta pantalla **no trae las ya entregadas** — el historial se carga aparte y
 * bajo demanda (`cargarEnviadas`), la primera vez que alguien abre esa bandeja.
 *
 * O sea que un «N de M entregadas» diría «0 de 3» al aterrizar, todos los días,
 * hasta que ella tocara otra pestaña. Es exactamente la trampa que este repo ya
 * documentó y rechazó para los badges de la barra: «un cero que significa "no
 * lo he leído" y se ve idéntico a "no hay". Mejor sin número que con uno que
 * miente.»
 *
 * Así que se cuenta solo lo que SÍ está en memoria al aterrizar: lo pendiente.
 * Que además es literalmente su pregunta — «quién no ha entregado» ES la lista
 * de pendientes. El «cuánto llevamos» necesita cargar el historial y es otra
 * conversación.
 *
 * ─── LOS TRES NÚMEROS CUADRAN, Y ESO SE PRUEBA ────────────────────────────
 * `vencidas + aTiempo === pendientes`, siempre. Tres números juntos que no
 * suman invitan a leerlos como partes de un todo y a restar mal: es la forma
 * más fácil de que una línea de resumen mienta sin que nadie lo note. Hay un
 * caso de prueba que lo fija sobre una muestra con solapamiento posible.
 *
 * ─── LA REGLA DE «VENCIDA» SE INYECTA, Y AQUÍ ESTÁ EL PORQUÉ ──────────────
 * Este util NO elige qué es una entrega vencida: se la pasa quien lo llama.
 * No es indecisión — es que al escribirlo apareció que en este módulo hay TRES
 * definiciones distintas conviviendo:
 *
 *   · `vista-organigrama.ts:esVencida`  — por `c.time`, la hora del CHECKLIST,
 *      comparada como texto. Es la que pinta de rojo las filas del árbol.
 *   · `checklist.ts:isTareaVencida`     — por `horaLimite` de cada PUNTO.
 *   · `urgencia-tarea.util`             — por el punto pendiente más próximo;
 *      es la que dice «Se pasó la hora» en la tarjeta de quien trabaja.
 *
 * Un resumen que eligiera una por su cuenta diría «2 vencidas» encima de una
 * lista que marca 3 en rojo, y esa contradicción está a dos centímetros en la
 * misma pantalla. Mientras las tres existan, la menos mala es que **el resumen
 * use la MISMA regla que pinta las filas que tiene debajo**, y eso solo lo sabe
 * quien lo monta. Unificar las tres es un paso propio: cambia qué se marca en
 * rojo para todo el mundo, así que no viaja de contrabando en una línea de
 * resumen.
 */

export interface ResumenPendientes {
  /** Entregas del equipo que siguen sin enviarse. */
  pendientes: number;
  /** De ésas, las que ya pasaron la hora de algún punto sin hacer. */
  vencidas: number;
  /** El resto. `vencidas + aTiempo === pendientes`, por construcción. */
  aTiempo: number;
}

/**
 * @param lista        Los checklists tal como los recibe la vista (ya recortados
 *                     por ámbito, pestaña y búsqueda por el padre). Se cuenta lo
 *                     que hay: este util NO vuelve a filtrar, porque un segundo
 *                     criterio de visibilidad aquí podría discrepar del que
 *                     decide qué se pinta, y el resumen diría otra cosa que la
 *                     pantalla que tiene debajo.
 * @param esVencida    La regla de vencimiento de la pantalla que lo monta (ver
 *                     la cabecera). Se inyecta para que la línea no pueda
 *                     contradecir a las filas que tiene debajo.
 */
export function resumenPendientes(
  lista: any[],
  esVencida: (checklist: any) => boolean,
): ResumenPendientes {
  if (!Array.isArray(lista) || !lista.length) {
    return { pendientes: 0, vencidas: 0, aTiempo: 0 };
  }

  // `enviado !== true` y no `!enviado`: el campo llega de Postgres y de
  // Firestore con formas distintas a lo largo de la historia de este repo, y un
  // `undefined` tiene que contar como PENDIENTE. El error, si lo hay, cae del
  // lado de enseñar trabajo de más, que es el lado seguro.
  const pendientes = lista.filter((c) => c && c.enviado !== true);

  let vencidas = 0;
  for (const c of pendientes) if (esVencida(c)) vencidas++;

  return {
    pendientes: pendientes.length,
    vencidas,
    // Se RESTA en vez de contarse aparte. Contando los dos por separado, un
    // checklist que no cayera en ninguna rama —o que cayera en las dos— dejaría
    // la línea sin cuadrar, y nadie lo vería hasta que alguien sumara a mano.
    aTiempo: pendientes.length - vencidas,
  };
}

/**
 * La frase, para no tener el texto repartido entre la plantilla y el código.
 *
 * ⚠ EL VACÍO NO DICE «TODO ENTREGADO», y no es prudencia: sería mentira. Con
 * cero pendientes no se puede distinguir «todos entregaron» de «hoy no se
 * emitió nada» —las entregadas no están en esta lista— y afirmar lo primero
 * taparía justo el día en que el robot no corrió. §5.2: la ausencia de datos no
 * puede significar dos cosas.
 */
export function textoResumen(r: ResumenPendientes): string {
  if (!r.pendientes) return 'No hay entregas pendientes';
  const n = r.pendientes === 1 ? 'Falta 1 entrega' : 'Faltan ' + r.pendientes + ' entregas';
  return n;
}
