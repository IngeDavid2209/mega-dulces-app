/**
 * ⏰ CUÁNTO TIEMPO LE QUEDA A UN PUNTO — y la frase que lo dice
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Instrucción de David (18/sep/2026): «Agregaremos indicadores preventivos
 * ("Vence en 30 min") en lugar de solo avisar cuando ya fallaron».
 *
 * Hasta hoy la app tenía DOS estados —a tiempo y vencida— y el segundo solo se
 * veía DENTRO de la tarea. Medido el 18/sep con una sesión de anaquelista: sus
 * dos tareas de 07:00–09:00 a las 10:13 no llevaban una sola marca en la lista.
 * O sea que la única forma de enterarse de que se te pasó la hora era abrir la
 * tarea de una en una. Esto agrega el peldaño que faltaba —«por vencer»— y lo
 * saca a la tarjeta.
 *
 * ─── POR QUÉ ES UN ARCHIVO APARTE Y CON PRUEBAS ───────────────────────────
 * §8.8: «escribe pruebas para toda regla que produzca un número de una
 * persona». «Te quedan 12 minutos» es exactamente eso, y se lo va a creer
 * alguien que está corriendo en el piso de venta. Además `limiteDeTarea` vivía
 * PRIVADA dentro de un componente de 5 126 líneas, así que no se podía probar
 * sin montar el componente entero.
 *
 * ─── EL LÍMITE SE COPIA TAL CUAL, NO SE «MEJORA» ──────────────────────────
 * `limiteDeItem` es el cuerpo exacto de `checklist.ts:limiteDeTarea`, con sus
 * comentarios. No se le cambió una coma: hay tres sitios que ya lo llaman y
 * juzgan retrasos con él. Una segunda definición «parecida» sería justo el
 * defecto que este repo persigue (§8.11 d): dos reglas libres de discrepar, y
 * la que discrepara lo haría en silencio sobre el retraso de una persona.
 * El componente ahora DELEGA aquí, así que sigue habiendo una sola.
 */

/** a_tiempo · por_vencer (dentro de la ventana de aviso) · vencida. */
export type ClaseUrgencia = 'a_tiempo' | 'por_vencer' | 'vencida';

/**
 * 30 minutos. No sale de un estudio: sale de que es el aviso que David pidió
 * con ese número. Es parámetro y no constante enterrada, para que moverlo sea
 * un argumento y no una edición de código.
 */
export const MINUTOS_AVISO = 30;

export interface Urgencia {
  clase: ClaseUrgencia;
  /**
   * Minutos que FALTAN si aún no vence, o los que PASARON si ya venció.
   * Siempre positivo; el signo lo dice `clase`. `null` cuando no hay hora
   * límite conocida — que NO es lo mismo que «le sobra tiempo».
   */
  minutos: number | null;
  /** Epoch del límite, para poder pintar la hora. `null` si no hay. */
  limite: number | null;
}

const SIN_HORA: Urgencia = { clase: 'a_tiempo', minutos: null, limite: null };

/**
 * Hora límite de un punto, en epoch.
 *
 * ⚠ COPIA LITERAL de `checklist.ts:limiteDeTarea` (ver cabecera). Sus
 * comentarios se conservan porque explican decisiones que ya costaron un bug:
 *
 *   🔥 Prioriza horaLimite (campo actual) sobre time (legacy). Aplica a ambos
 *   tipos. Esto evita que tareas con campos desincronizados se cierren con una
 *   hora vieja. Si la tarea no trae hora propia, manda la del CHECKLIST (igual
 *   que horaLimiteItem()): antes se saltaba ese escalón y la misma tarea se
 *   MOSTRABA con límite 08:00 y se JUZGABA con las 23:59.
 */
export function limiteDeItem(item: any, fechaChecklist: string, horaChecklist?: string): number | null {
  if (!fechaChecklist) return null;
  let hora = '23'; let minuto = '59';
  const horaUsar = item?.horaLimite || item?.time || horaChecklist;
  if (horaUsar && typeof horaUsar === 'string') {
    const partes = horaUsar.split(':');
    if (partes.length >= 2) {
      hora = partes[0];
      minuto = partes[1];
    }
  }
  const [year, month, day] = fechaChecklist.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hora), Number(minuto), 59).getTime();
}

/** La urgencia de UN punto. */
export function urgenciaDeItem(
  item: any,
  fechaChecklist: string,
  horaChecklist: string | undefined,
  ahora: number,
  minutosAviso: number = MINUTOS_AVISO,
): Urgencia {
  const limite = limiteDeItem(item, fechaChecklist, horaChecklist);
  if (limite == null) return SIN_HORA;

  // `>` y no `>=`, igual que `isTareaVencida`: el límite cae en el segundo :59,
  // así que el minuto de la hora límite todavía cuenta como dentro.
  if (ahora > limite) {
    return { clase: 'vencida', minutos: Math.floor((ahora - limite) / 60000), limite };
  }

  // ⚠ LA GRACIA DE 59 SEGUNDOS NO ENTRA EN LA CUENTA REGRESIVA, y eso lo cazaron
  // las pruebas antes de que esto se desplegara. El `:59` existe para no cobrarle
  // un retraso a quien llega en el minuto exacto; usarlo también para contar
  // inflaba TODOS los números en un minuto —a las 08:00 en punto decía «121» para
  // una tarea de las 09:00— y, peor, al filo decía «Vence en 1 min» cuando la
  // hora ya había pasado. La cuenta va contra el minuto (hh:mm:00); el perdón,
  // contra el segundo. Son dos preguntas distintas y ahora usan dos instantes.
  const minutoLimite = limite - 59000;
  const faltan = Math.max(0, Math.ceil((minutoLimite - ahora) / 60000));
  return { clase: faltan <= minutosAviso ? 'por_vencer' : 'a_tiempo', minutos: faltan, limite };
}

/**
 * La urgencia de un CHECKLIST entero, que es la que se pinta en la tarjeta.
 *
 * ─── MANDA EL PUNTO PENDIENTE MÁS PRÓXIMO, Y ESO ES UNA DECISIÓN ──────────
 * Cada punto trae su propia hora y la tarjeta hoy enseña la del PRIMERO del
 * arreglo, que no tiene por qué ser el que vence antes. Se toma el más próximo
 * de los que SIGUEN PENDIENTES: avisar de un límite ya cumplido sería empujar a
 * alguien a rehacer trabajo entregado.
 *
 * Si no queda ninguno pendiente, no hay urgencia que reportar: el trabajo está.
 * Ese `a_tiempo` con `minutos: null` es «ya no aplica», no «le sobra tiempo»;
 * quien pinte esto tiene que mirar `minutos`, no solo la clase.
 */
export function urgenciaDeChecklist(
  items: any[],
  fechaChecklist: string,
  horaChecklist: string | undefined,
  estaCompleto: (item: any) => boolean,
  ahora: number,
  minutosAviso: number = MINUTOS_AVISO,
): Urgencia {
  if (!Array.isArray(items) || !items.length || !fechaChecklist) return SIN_HORA;

  const pendientes = items.filter((i) => !estaCompleto(i));
  if (!pendientes.length) return SIN_HORA;

  let peor: Urgencia | null = null;
  for (const item of pendientes) {
    const u = urgenciaDeItem(item, fechaChecklist, horaChecklist, ahora, minutosAviso);
    if (u.limite == null) continue;
    // El más próximo por RELOJ, no por clase: así una vencida gana a una por
    // vencer sin necesidad de ordenar las clases a mano.
    if (!peor || u.limite < peor.limite!) peor = u;
  }
  return peor || SIN_HORA;
}

/**
 * La frase, en el idioma de quien trabaja en la tienda.
 *
 * `horaTexto` la pone quien llama —con el `formatearHora` que ya usa la app—
 * para no tener aquí un SEGUNDO formateador de horas que pueda discrepar del
 * que pinta el resto de la pantalla.
 */
export function textoUrgencia(u: Urgencia, horaTexto?: string): string {
  if (u.minutos == null) return '';
  if (u.clase === 'vencida') {
    return horaTexto ? 'Se pasó la hora (era a las ' + horaTexto + ')' : 'Se pasó la hora';
  }
  if (u.clase === 'por_vencer') {
    if (u.minutos <= 1) return 'Vence en menos de 1 min';
    return 'Vence en ' + u.minutos + ' min';
  }
  return '';
}
