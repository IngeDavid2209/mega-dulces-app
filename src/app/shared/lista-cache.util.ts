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

/** Lee la ultima lista buena, o null si no hay. Nunca lanza. */
export function leerListaCache(clave: string, usuarioId: string): any[] | null {
  try {
    const raw = localStorage.getItem(PREFIJO + clave + '_' + (usuarioId || 'anon'));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return Array.isArray(obj?.lista) ? obj.lista : null;
  } catch { return null; }
}
