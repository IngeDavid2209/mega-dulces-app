/**
 * ⏱️ UNA ESPERA QUE NO PUEDE DURAR PARA SIEMPRE
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ EXISTE, Y POR QUÉ SE SACÓ DE `login.ts`
 * ═══════════════════════════════════════════════════════════════════════════
 * El 1/sep/2026 el botón de entrar se quedaba en «VERIFICANDO...» para siempre.
 * No había error, no había nada en la consola: había cinco `await` sin tope, y
 * uno que nunca volvía. Desde fuera, «no me deja entrar» se ve idéntico esté la
 * contraseña mal, la red bloqueada o el servidor dormido. Cinco horas de
 * diagnóstico se fueron ahí, y no había nada que encontrar: había un silencio.
 *
 * El arreglo de entonces —topes con el NOMBRE del paso— se quedó dentro de
 * `login.ts`, y el 13/sep volvió a pasar lo mismo en otra pantalla: la de
 * Plantilla se quedó en «Cargando...» indefinidamente. Misma familia, otro
 * archivo. Así que esto sube a `shared/` para que la próxima pantalla no tenga
 * que volver a aprenderlo.
 *
 * ─── EL NOMBRE DEL PASO NO ES ADORNO ──────────────────────────────────────
 * «Se agotó el tiempo» manda a revisar la red entera. «Se agotó el tiempo al
 * leer la lista de personas» dice qué endpoint mirar. Cuando alguien reporta un
 * síntoma, la frase literal que ve en pantalla es lo que localiza el archivo en
 * un `grep` — es la regla de diagnóstico que dejó ese mismo día.
 *
 * ─── Y UN TOPE NO SE TRAGA ────────────────────────────────────────────────
 * Se RELANZA como error. Los dos `try/catch` de `login.ts` se comían el fallo y
 * mostraban «Usuario no encontrado», que manda a revisar la base cuando lo que
 * hubo fue una espera sin respuesta. Quien llame a esto tiene que dejar que el
 * error llegue a la pantalla.
 */

/** Envuelve una promesa con un tope. Si se agota, rechaza nombrando el paso. */
export function conTope<T>(promesa: Promise<T>, ms: number, paso: string): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error('TIEMPO_AGOTADO:' + paso)), ms);
    promesa.then(
      (v) => { clearTimeout(reloj); resolver(v); },
      (e) => { clearTimeout(reloj); rechazar(e); },
    );
  });
}

/** ¿Este error es un tope de tiempo? Devuelve el paso, o null. */
export function pasoAgotado(e: any): string | null {
  const m = /^TIEMPO_AGOTADO:(.+)$/.exec(String(e?.message || ''));
  return m ? m[1] : null;
}

/**
 * El mensaje que se le enseña a una persona cuando algo no cargó.
 *
 * Distingue los dos casos porque se arreglan distinto, y confundirlos manda a
 * la persona —o a quien la ayuda— a buscar en el sitio equivocado:
 *   · tope     → el servidor no contestó a tiempo. No es su culpa ni su clave.
 *   · lo demás → el error real, tal cual, sin maquillar.
 */
export function mensajeDeFallo(e: any, porOmision = 'No se pudieron cargar los datos.'): string {
  const paso = pasoAgotado(e);
  if (paso) {
    return `Se agotó el tiempo al ${paso}. El servidor no respondió; ` +
           `revisa tu conexión y vuelve a intentar.`;
  }
  return String(e?.message || porOmision);
}
