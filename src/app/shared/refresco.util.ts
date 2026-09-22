/**
 * 🔄 QUÉ HACE EL BOTÓN «BUSCAR ACTUALIZACIÓN»
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ ESTO ES UNA FUNCIÓN Y NO TRES `if` DENTRO DEL COMPONENTE
 * ═══════════════════════════════════════════════════════════════════════════
 * Porque lo que decide es SI SE RECARGA LA PANTALLA, y una recarga se lleva lo
 * que la persona tenga a medias: un motivo de retraso a medio escribir, una
 * foto elegida y sin subir, el desplazamiento en una lista larga. Es el mismo
 * costo por el que el 13/sep/2026 se dejó de aplicar la actualización sola.
 *
 * Dentro del componente esa decisión sólo se puede comprobar abriendo un
 * navegador con un service worker de verdad — y en Chrome headless
 * `SwUpdate.isEnabled` es false, así que un arnés DOM recorrería siempre la
 * misma rama y daría verde sin ejercer ninguna de las otras. Aquí se prueban
 * las seis con la función real.
 *
 * ─── LA REGLA, EN UNA LÍNEA ───────────────────────────────────────────────
 * Sólo se recarga cuando hay algo nuevo que traer. «Ya estás al día» NO recarga
 * y lo dice: si no hay versión nueva, interrumpir no compra nada.
 */
import { conTope, mensajeDeFallo } from './con-tope.util';

/** Lo que el botón necesita del mundo. Se pasa para poder probarlo sin uno. */
export interface EntornoRefresco {
  /** `navigator.onLine` */
  enLinea: boolean;
  /** `SwUpdate.isEnabled`: false en desarrollo, en incógnito y sin soporte. */
  swActivo: boolean;
  /** El sello de versión instalado, para poder nombrarlo al decir «al día». */
  version: string;
  /** `SwUpdate.checkForUpdate()`: true si dejó una versión nueva lista. */
  buscar: () => Promise<boolean>;
  /** `SwUpdate.activateUpdate()`. */
  activar: () => Promise<void>;
  /**
   * Tope de la búsqueda. Se LEE en cada llamada y no se congela en una
   * constante del módulo: con un tope fijo de 15 s, su prueba tardaría 15 s
   * reales, y una prueba lenta es una prueba que nadie corre (15/sep).
   */
  topeMs?: number;
}

export interface PlanRefresco {
  estado: 'aplicando' | 'aldia' | 'sinred' | 'error';
  mensaje: string;
  /** Si es `false`, la pantalla NO se toca. */
  recargar: boolean;
}

export async function decidirRefresco(e: EntornoRefresco): Promise<PlanRefresco> {
  // 1. Sin red no hay a quién preguntarle, y recargar dejaría la app en blanco
  //    si al service worker le falta algún chunk — el modo de fallo que el
  //    rescate del 1/sep tuvo que aprender por las malas.
  if (!e.enLinea) {
    return { estado: 'sinred', recargar: false,
             mensaje: 'Sin conexión. Conéctate e inténtalo otra vez.' };
  }

  // 2. Sin service worker no hay versión que consultar: ahí el «refresh»
  //    honesto es la recarga de toda la vida, que es lo que la persona esperaba
  //    al pulsar. No se finge una comprobación que no se puede hacer.
  if (!e.swActivo) {
    return { estado: 'aplicando', recargar: true, mensaje: 'Recargando…' };
  }

  try {
    // ⏱ `checkForUpdate()` NO RECHAZA si el service worker no contesta: deja la
    // promesa pendiente. Sin tope, el botón diría «Buscando…» para siempre —
    // el «VERIFICANDO...» del login del 1/sep, que costó cinco horas porque no
    // había error que buscar: había un silencio.
    const hay = await conTope(e.buscar(), e.topeMs ?? 15000, 'buscar la actualización');

    if (!hay) {
      return { estado: 'aldia', recargar: false,
               mensaje: 'Ya tienes la última versión (' + e.version + ').' };
    }

    await e.activar().catch(() => { /* si falla, la recarga la trae igual */ });
    return { estado: 'aplicando', recargar: true, mensaje: 'Actualizando…' };
  } catch (err: any) {
    // Un tope y un fallo real se dicen distinto: `mensajeDeFallo` nombra el paso
    // («se agotó el tiempo al buscar la actualización»), que es lo que permite
    // saber dónde mirar en vez de revisar la app entera.
    return { estado: 'error', recargar: false,
             mensaje: mensajeDeFallo(err, 'No se pudo buscar la actualización.') };
  }
}
