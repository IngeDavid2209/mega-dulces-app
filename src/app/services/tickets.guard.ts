import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/**
 * Guard del modulo /tickets (vale de servicio operativo).
 *
 * Seccion gateada por el privilegio `grupoTickets`, que se asigna usuario por
 * usuario desde Personal. Mismo modelo que el Espacio TEC (grupoTec), Flotilla
 * (grupoFlotilla) y Promociones (grupoPromociones).
 *
 * DIFERENCIA con esos tres: aqui el rol `admin` SI entra sin la bandera. Los
 * tickets son el canal por el que se piden los servicios internos; si algo se
 * traba, el administrador tiene que poder entrar a destrabarlo sin depender de
 * que alguien le prenda el permiso.
 * El backend aplica exactamente el mismo criterio (api/_tickets-acceso.js).
 *
 *  - Sin sesion                          -> login.
 *  - grupoTickets === true, o rol 'admin'  -> entra.
 *  - Cualquier otro                      -> fuera, a /home.
 */
export const ticketsGuard: CanActivateFn = () => {
  const router = inject(Router);
  const sesion = localStorage.getItem('md_sesion_actual');

  if (!sesion) { router.navigate(['/login']); return false; }

  try {
    const u = JSON.parse(sesion);
    if (u?.grupoTickets === true || u?.rol === 'admin') return true;
  } catch { /* sesion corrupta */ }

  router.navigate(['/home']);
  return false;
};
