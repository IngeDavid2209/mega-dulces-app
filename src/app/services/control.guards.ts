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
  if (!tab) {
    router.navigate(['/home']);
    return false;
  }
  if (tab.ve(u)) return true;

  // Sin permiso para ESTA pestaña: se manda a la primera que sí sea suya. Así
  // un enlace viejo de WhatsApp a una pantalla que ya no le toca lo deja en
  // Control con lo que sí puede ver, en vez de expulsarlo al Dashboard.
  const primera = primeraTab(u);
  router.navigate(primera ? ['/control', primera.ruta] : ['/home']);
  return false;
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
  router.navigate(primera ? ['/control', primera.ruta] : ['/home']);
  return false;
};
