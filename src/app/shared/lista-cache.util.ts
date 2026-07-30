// ============================================================================
//  Cache de "ultima lista buena" en localStorage.
//
//  Motivo: las vistas (checklist, dashboard) se llenan SOLO desde el poll a
//  Postgres. Si el primer fetch falla por mala senal, la lista se ve VACIA y el
//  usuario cree que "se le borraron las tareas" (no es cierto: siguen en la BD).
//
//  Con esto: al traer datos con exito se guarda la lista; al abrir la vista o si
//  un poll falla, se hidrata desde el cache para no mostrar nunca vacio por red.
//  Los datos pueden estar un poco viejos, pero el proximo poll bueno (<=20s) los
//  refresca. Es estrictamente mejor que mostrar vacio.
//
//  El cache es POR USUARIO (para no mezclar tareas si cambian de cuenta en el
//  mismo dispositivo) y con tope de tamano para no presionar el cupo de storage
//  (relacionado con el bug de desalojo por fotos).
// ============================================================================

const PREFIJO = 'md_cache_';
// Tope defensivo: si la lista serializada supera ~1.5 MB no la guardamos, para
// no contribuir al desalojo de almacenamiento del navegador.
const TOPE_BYTES = 1_500_000;

/** Guarda la lista buena para una clave+usuario. Best-effort (nunca lanza). */
export function guardarListaCache(clave: string, usuarioId: string, lista: any[]): void {
  try {
    const payload = JSON.stringify({ t: Date.now(), lista });
    if (payload.length > TOPE_BYTES) return; // demasiado grande: no arriesgar el cupo
    localStorage.setItem(PREFIJO + clave + '_' + (usuarioId || 'anon'), payload);
  } catch { /* cupo lleno / modo privado: ignorar */ }
}

/**
 * Cuantas horas se considera utilizable una lista guardada.
 *
 * Se guardaba la hora (`t`) desde el principio pero nadie la leia, asi que una
 * lista de hace dias se podia pintar como si fuera de hoy. Un dia es el limite
 * natural: las tareas son diarias, y un checklist de ayer en la pantalla de hoy
 * es informacion falsa, no informacion vieja.
 */
const HORAS_VALIDAS = 24;

/** Lista guardada junto con su antiguedad, para poder decirla en pantalla. */
export interface ListaCacheada {
  lista: any[];
  /** Minutos desde que se guardo. 0 si el registro no traia hora. */
  edadMinutos: number;
}

/**
 * Lee la ultima lista buena con su antiguedad, o null si no hay o si ya expiro.
 * Nunca lanza.
 *
 * `maxHoras` permite alargar la vida a datos que no son del dia: el ranking
 * semanal, por ejemplo, sigue siendo valido dos dias despues porque su clave ya
 * incluye la semana.
 */
export function leerListaCacheConEdad(
  clave: string, usuarioId: string, maxHoras: number = HORAS_VALIDAS
): ListaCacheada | null {
  try {
    const llave = PREFIJO + clave + '_' + (usuarioId || 'anon');
    const raw = localStorage.getItem(llave);
    if (!raw) return null;

    const obj = JSON.parse(raw);
    if (!Array.isArray(obj?.lista)) return null;

    const guardadoEn = Number(obj?.t);
    if (Number.isFinite(guardadoEn) && guardadoEn > 0) {
      const edadMs = Date.now() - guardadoEn;
      // Reloj del dispositivo movido hacia atras: no lo tratamos como del futuro.
      const edad = Math.max(0, edadMs);
      if (edad > maxHoras * 3600_000) {
        // Vencida: la soltamos para no volver a evaluarla ni ocupar cupo.
        try { localStorage.removeItem(llave); } catch { }
        return null;
      }
      return { lista: obj.lista, edadMinutos: Math.floor(edad / 60000) };
    }

    // Registro viejo sin hora (de antes de este cambio): lo aceptamos una vez,
    // sin poder decir su edad. El proximo guardado ya trae `t`.
    return { lista: obj.lista, edadMinutos: 0 };
  } catch { return null; }
}

/** Lee la ultima lista buena, o null si no hay o ya expiro. Nunca lanza. */
export function leerListaCache(
  clave: string, usuarioId: string, maxHoras: number = HORAS_VALIDAS
): any[] | null {
  return leerListaCacheConEdad(clave, usuarioId, maxHoras)?.lista ?? null;
}

/** Texto corto para el aviso: "hace 3 minutos", "hace 2 horas". */
export function textoAntiguedad(edadMinutos: number): string {
  if (edadMinutos < 1) return 'hace un momento';
  if (edadMinutos === 1) return 'hace 1 minuto';
  if (edadMinutos < 60) return `hace ${edadMinutos} minutos`;
  const horas = Math.floor(edadMinutos / 60);
  return horas === 1 ? 'hace 1 hora' : `hace ${horas} horas`;
}
