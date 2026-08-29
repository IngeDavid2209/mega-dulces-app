/**
 * 🕗 LA HORA A LA QUE DE VERDAD ABRE CADA SUCURSAL
 *
 * Viene del módulo de checador de Mega Talento (tabla `horarios_sucursal`), que
 * es donde RH la captura y la mantiene. MDTask la LEE y nunca la escribe.
 *
 * ─── QUÉ ESTABA MAL ─────────────────────────────────────────────────────────
 * Las tareas de apertura vencían a las 12:00 en toda la empresa. Esa hora no
 * salió de ningún manual: la inventé yo porque los manuales fijan el MOMENTO
 * ("Inicio", "Cierre") y no una hora de reloj. Con las horas reales enfrente se
 * ve lo arbitraria que era: Zamora Centro abre a las 07:00 y CEDIS a las 09:00,
 * dos horas de diferencia que la app trataba igual.
 *
 * ─── LO QUE ESTO NO ARREGLA ─────────────────────────────────────────────────
 * Ojo, porque es al revés de lo que parece. Si una tarea vencía a las 12:00 y
 * ahora vence a las 09:00, correr el robot por la tarde deja MÁS tareas
 * vencidas, no menos. La hora real hace que el plazo signifique algo; que las
 * tareas no nazcan vencidas depende de generarlas temprano, y eso es otro
 * problema con otra solución.
 *
 * ─── EL PUENTE ENTRE LOS DOS CATÁLOGOS ──────────────────────────────────────
 * MDTask nombra sus sucursales ("Morelia Madero") y Talento las identifica
 * ("morelia-vicente-guerrero"). El amarre se hizo cruzando las DIRECCIONES de
 * los dos catálogos, que es un hecho verificable, y no los nombres, que se
 * parecen engañosamente: MDTask llama "Morelia Abastos" a la de Figaredo, y
 * Talento tiene un `morelia-abastos` que es otra cosa.
 *
 * Donde el nombre y la dirección discrepaban, mandó el dato: "8 Esquinas" quedó
 * en `8-esquinas` —que sí tiene horario capturado— y no en `la-piedad-centro`,
 * que comparte su dirección pero no tiene ninguno.
 *
 * Una sucursal que no esté aquí, o que esté y no tenga horario capturado en
 * Talento, NO recibe una hora inventada: se queda con la de por defecto y se
 * puede reportar. Eso pasa hoy con las dos plazas más grandes.
 */

/** Nombre de sucursal en MDTask → `sucursal_id` en Mega Talento. */
export const SUCURSAL_A_TALENTO: Record<string, string> = {
  // ── Confirmadas por dirección idéntica en los dos catálogos ──────────────
  'Canindo':            'zamora-canindo',
  'La Piedad Abastos':  'la-piedad-abastos',
  'Morelia Madero':     'morelia-vicente-guerrero',
  'Yurécuaro':          'yurecuaro-centro',
  'Zamora Centro':      'zamora-catedral',    // la que la nómina llama "Damaso"
  'CEDIS':              'cedis',

  // ── Resuelta por el dato, no por la dirección ────────────────────────────
  // La dirección de "8 Esquinas" (Pino Suárez 259) coincide con
  // `la-piedad-centro`, pero esa no tiene horario capturado y `8-esquinas` sí.
  '8 Esquinas':         '8-esquinas',

  // ── Los departamentos del corporativo comparten el horario de oficinas ───
  'FINANZAS':           'corporativo',
  'CONTABILIDAD':       'corporativo',
  'SISTEMAS':           'corporativo',
  'COMPRAS':            'corporativo',
  'RH':                 'corporativo',
  'MKT':                'corporativo',
  'MANTENIMIENTO':      'corporativo',

  // ── SIN EQUIVALENTE CON HORARIO ──────────────────────────────────────────
  // 'Padre Hidalgo'   → santa-ana-pacueco existe en Talento pero NO tiene fila
  //                     de horario. Son 39 personas, la plaza más grande.
  // 'Morelia Abastos' → no aparece con horario por ningún nombre. Son 37.
  // Mientras RH no las capture, esas 76 personas siguen con la hora por
  // defecto. No se les inventa una: que se note es lo que hace que se arregle.
};

/** Una fila de horario tal como la devuelve /api/horarios-sucursal. */
export interface HorarioSucursal {
  sucursal_id: string;
  area_id: string | null;
  nombre: string;
  dias: number[];          // 0=domingo .. 6=sábado
  entrada: string;         // 'HH:mm'
  inicio_comida: string | null;
  fin_comida: string | null;
  salida: string;
  tolerancia_min: number;
}

/**
 * Cuánto tiempo después de abrir vence el checklist de apertura.
 *
 * Esto SÍ es una política de la app, no una regla del manual, y por eso está
 * aquí con nombre en vez de escondida en un número suelto. La diferencia con
 * las 12:00 de antes es que ahora cuelga de un hecho —la hora real de entrada—
 * y no de una hora fija que valía igual para una plaza que abre a las 07:00 que
 * para una que abre a las 09:00.
 */
export const MARGEN_APERTURA_MIN = 120;

/** 'HH:mm' + minutos, sin pasar de las 23:59. */
export function sumarMinutos(hhmm: string, minutos: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return hhmm;
  const total = Math.min(+m[1] * 60 + +m[2] + minutos, 23 * 60 + 59);
  const h = Math.floor(total / 60);
  return String(h).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

/**
 * La hora límite de una tarea de apertura en esta sucursal.
 * Devuelve null si no hay horario capturado, para que quien llame decida —
 * aquí no se inventa una hora.
 */
export function limiteAperturaDe(
  sucursal: string,
  horarios: HorarioSucursal[],
): { hora: string; entrada: string; sucursalTalento: string } | null {
  const id = SUCURSAL_A_TALENTO[(sucursal || '').trim()];
  if (!id) return null;

  // El turno general de la sucursal (sin área). Si solo hubiera turnos de área,
  // se toma el más temprano: quien abre es el que llega primero.
  const filas = horarios.filter(h => h.sucursal_id === id);
  if (!filas.length) return null;

  const general = filas.filter(h => !h.area_id);
  const usar = (general.length ? general : filas)
    .slice()
    .sort((a, b) => (a.entrada || '').localeCompare(b.entrada || ''))[0];
  if (!usar?.entrada) return null;

  return {
    hora: sumarMinutos(usar.entrada, MARGEN_APERTURA_MIN),
    entrada: usar.entrada,
    sucursalTalento: id,
  };
}

/**
 * ¿Esta sucursal trabaja este día, según el horario que capturó RH?
 *
 * Devuelve null cuando NO HAY DATO, y esa distinción es la importante: null no
 * es "sí" ni "no", es "nadie lo ha dicho". Quien llama tiene que decidir a
 * propósito qué hacer con la duda, en vez de que un `false` silencioso deje sin
 * tareas a una plaza que sí abre.
 *
 * Los días vienen como los guarda Postgres: 0=domingo .. 6=sábado, igual que
 * `Date.getDay()`.
 */
export function trabajaEsteDia(
  sucursal: string,
  diaSemana: number,
  horarios: HorarioSucursal[],
): boolean | null {
  const id = SUCURSAL_A_TALENTO[(sucursal || '').trim()];
  if (!id) return null;

  const filas = horarios.filter(h => h.sucursal_id === id && Array.isArray(h.dias) && h.dias.length);
  if (!filas.length) return null;

  // Basta que UN turno cubra el día para que la sucursal cuente como abierta.
  return filas.some(h => h.dias.includes(diaSemana));
}
