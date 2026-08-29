// ============================================================================
//  🚧 MODO MANTENIMIENTO
//
//  Mientras se trabaja el cambio grande del apartado de Tareas (rutinas fuera,
//  tareas del Manual Corporativo por puesto), la app queda cerrada para todos
//  MENOS para las cuentas de la lista de exentos.
//
//  ─── CÓMO SE APAGA ────────────────────────────────────────────────────────
//  Poner MANTENIMIENTO_ACTIVO en false y desplegar:
//
//      railway up
//
//  OJO: `git push` NO despliega. Mientras no corra `railway up`, el cambio de
//  este interruptor no llega a nadie.
//
//  ─── QUÉ TAPA Y QUÉ NO ────────────────────────────────────────────────────
//  Tapa la INTERFAZ: cualquier pantalla que no sea el login se reemplaza por el
//  aviso. No es un candado de seguridad y no pretende serlo: los endpoints de
//  /api siguen respondiendo, a propósito, para que el bot de WhatsApp, los
//  avisos y los procesos programados no se caigan durante el mantenimiento.
//  Los permisos de verdad (rol, sucursal, alcance) siguen siendo los mismos de
//  siempre; esto solo decide si se pinta la app o el aviso.
//
//  ─── SI TE QUEDAS FUERA A TI MISMO ───────────────────────────────────────
//  La pantalla de aviso muestra con qué identidad te está viendo la app. Si tu
//  cuenta no cae en la lista de abajo, agrega ahí el dato que salga en pantalla
//  (correo o usuario) y vuelve a desplegar. Por eso la pantalla lo enseña: para
//  que el problema se diagnostique solo y no a ciegas.
// ============================================================================

/** El interruptor. true = app cerrada para todos menos los exentos. */
export const MANTENIMIENTO_ACTIVO = false;

/**
 * Cuentas que SÍ pueden trabajar durante el mantenimiento.
 *
 * Se compara contra `correo`, `usuario` y `uid` del perfil, sin distinguir
 * mayúsculas ni espacios de sobra. Basta que UNO coincida.
 *
 * Está a propósito como lista y no como un solo valor: si el correo del perfil
 * resultara distinto al que se espera, se agrega el usuario o el uid y se sale
 * del problema sin tener que tocar la lógica.
 */
export const CUENTAS_EXENTAS: string[] = [
  'desarrollador.david@megadulces.com.mx',
  // La cuenta con la que David entra de verdad a la app. No es la misma que la
  // de arriba: en el perfil su correo es este, y por eso el aviso lo dejaba
  // fuera de su propia app. La pantalla lo enseñaba tal cual
  // ("admin · davidcisneros2209@outlook.es"), que es justo para lo que existe.
  'davidcisneros2209@outlook.es',
  // NO se pone 'admin' a secas a proposito: `usuario` tambien se compara, y
  // dejaria pasar a CUALQUIER cuenta que se llame admin (admin-local entre
  // ellas). El correo identifica a una persona; el nombre de usuario, no.
];

/** Título del aviso. */
export const MANTENIMIENTO_TITULO = 'App en mantenimiento';

/** El texto que ve la gente. */
export const MANTENIMIENTO_MENSAJE =
  'Estamos actualizando el apartado de Tareas. La app estará disponible en cuanto ' +
  'terminemos. No necesitas hacer nada: tus tareas y tu historial están a salvo.';

/** Normaliza un identificador para comparar sin sorpresas. */
function clave(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

/** Índice de exentos, armado una sola vez. */
const EXENTOS = new Set(CUENTAS_EXENTAS.map(clave).filter(Boolean));

/**
 * ¿Esta cuenta puede pasar durante el mantenimiento?
 *
 * Sin sesión devuelve false: un visitante anónimo también ve el aviso.
 */
export function esCuentaExenta(usuario: any): boolean {
  if (!usuario) return false;
  const candidatos = [
    usuario.correo,
    usuario.usuario,
    usuario.uid,
    usuario.id,
    usuario.idFirestore,
  ];
  return candidatos.some(c => {
    const k = clave(c);
    return !!k && EXENTOS.has(k);
  });
}

/**
 * Con qué identidad ve la app a quien está enfrente. Se muestra en el aviso
 * para poder corregir la lista de exentos sin adivinar.
 */
export function identidadVisible(usuario: any): string {
  if (!usuario) return 'sin sesión iniciada';
  const partes = [usuario.usuario, usuario.correo].map(x => String(x ?? '').trim()).filter(Boolean);
  return partes.length ? partes.join(' · ') : 'sesión sin correo ni usuario';
}

/**
 * Rutas que siguen abiertas durante el mantenimiento.
 *
 * Solo el login, y por una razón concreta: es el único camino para que la
 * cuenta exenta se identifique. Si se cerrara también, nadie podría entrar a
 * levantar el mantenimiento.
 */
const RUTAS_ABIERTAS = ['/login'];

/** ¿Esta ruta se puede ver aunque el mantenimiento esté activo? */
export function rutaAbiertaEnMantenimiento(url: string): boolean {
  const limpia = (url || '').split('?')[0].split('#')[0];
  return RUTAS_ABIERTAS.some(r => limpia === r || limpia.startsWith(r + '/'));
}

/**
 * La decisión completa: ¿se le pinta el aviso en vez de la app?
 *
 * @param usuario perfil de `md_sesion_actual` (o null si no hay sesión)
 * @param url     ruta actual del router
 */
export function debeVerMantenimiento(usuario: any, url: string): boolean {
  if (!MANTENIMIENTO_ACTIVO) return false;
  if (rutaAbiertaEnMantenimiento(url)) return false;
  return !esCuentaExenta(usuario);
}
