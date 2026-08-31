/**
 * 🚦 GUARDS DE LAS PESTAÑAS DE CONTROL
 *
 * Cada pestaña se gatea por SU PROPIO permiso, no por el acceso al cascarón.
 * Sin esto, `/control` sería una puerta lateral: entras porque ves una pestaña y
 * te llevas las otras tres.
 *
 * El permiso NO se escribe aquí. Se importa de `control.tabs.ts`, que es la
 * única definición — la misma que usan la barra de pestañas y el menú. Repetir
 * la condición en el guard sería el segundo lugar donde se decide quién ve qué,
 * y de ahí salen las fugas.
 */

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { TABS_CONTROL, primeraTab } from '../modules/dashboard/control/control.tabs';

/*
 * ─── POR QUE ESTOS DOS GUARDS DEVUELVEN UrlTree Y NO `navigate() + false` ───
 *
 * El resto de los guards de la app usan `navigate()` y devuelven false, y ahi se
 * quedan: cambiarlos seria tocar codigo que funciona sin motivo. Pero estos dos
 * son la excepcion, y vale la pena por una razon concreta.
 *
 * `navigate()` ARRANCA UNA SEGUNDA NAVEGACION mientras la primera se esta
 * cancelando. Suele funcionar; cuando no, deja la URL desincronizada del
 * componente pintado, o tira un "cancelled navigation" que no se reproduce a
 * voluntad. Devolver un UrlTree hace que el router cancele y redirija en UNA
 * sola operacion.
 *
 * Importa mas aqui que en los guards viejos porque estos redirigen a un HERMANO
 * dentro del mismo padre —de /control/x a /control/y, con el cascaron ya
 * montado—, que es justo donde esa carrera se manifiesta.
 */

/** La sesión, de la MISMA clave que usa el resto de la app (`md_sesion_actual`). */
function usuario(): any {
  try {
    const s = localStorage.getItem('md_sesion_actual');
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/**
 * Deja pasar a `/control/<ruta>` solo si esa pestaña es de este usuario.
 *
 * La ruta se lee del path de la propia ruta hija, no de `data`: así no hay dos
 * sitios que puedan desalinearse —el segmento de la URL y una etiqueta— y una
 * pestaña nueva no puede quedar sin guard por haber olvidado su `data`.
 */
export const tabControlGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const u = usuario();
  const segmento = route.routeConfig?.path || '';
  const tab = TABS_CONTROL.find(t => t.ruta === segmento);

  // Una pestaña que no está en el catálogo NO pasa. Es el lado seguro: si
  // alguien agrega una ruta hija y olvida registrarla, se cierra en vez de
  // quedar abierta para todos.
  if (!tab) return router.parseUrl('/home');
  if (tab.ve(u)) return true;

  // Sin permiso para ESTA pestaña: se manda a la primera que sí sea suya. Así
  // un enlace viejo de WhatsApp a una pantalla que ya no le toca lo deja en
  // Control con lo que sí puede ver, en vez de expulsarlo al Dashboard.
  const primera = primeraTab(u);
  return router.parseUrl(primera ? `/control/${primera.ruta}` : '/home');
};

/**
 * `/control` sin pestaña: manda a la primera que este usuario pueda abrir.
 *
 * No se puede resolver con un `redirectTo` fijo, porque la pestaña por defecto
 * depende de los permisos: un `redirectTo: 'estadisticas'` mandaría a quien solo
 * tiene Sucursales a una pantalla que su guard le va a rebotar, y el usuario
 * vería un parpadeo y un rebote sin explicación.
 */
export const primeraTabControlGuard: CanActivateFn = () => {
  const router = inject(Router);
  const primera = primeraTab(usuario());
  return router.parseUrl(primera ? `/control/${primera.ruta}` : '/home');
};
