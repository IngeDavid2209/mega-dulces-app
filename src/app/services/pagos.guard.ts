import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/**
 * Guard del modulo /pagos (pagos de servicios: luz, agua, internet, renta...).
 *
 * Seccion gateada por el privilegio `grupoPagos`, que se asigna usuario por
 * usuario desde Personal. Mismo modelo que el Espacio TEC (grupoTec), Flotilla
 * (grupoFlotilla) y Promociones (grupoPromociones).
 *
 * DIFERENCIA con esos tres: aqui el rol `admin` SI entra sin la bandera. Es un
 * modulo de dinero y de avisos automaticos; si algo se traba (un servicio mal
 * dado de alta mandando WhatsApps a quien no debe), el administrador tiene que
 * poder entrar a apagarlo sin depender de que alguien le prenda un permiso.
 * El backend aplica exactamente el mismo criterio (api/_pagos-acceso.js).
 *
 *  - Sin sesion                          -> login.
 *  - grupoPagos === true, o rol 'admin'  -> entra.
 *  - Cualquier otro                      -> fuera, a /home.
 */
export const pagosGuard: CanActivateFn = () => {
  const router = inject(Router);
  const sesion = localStorage.getItem('md_sesion_actual');

  if (!sesion) { router.navigate(['/login']); return false; }

  try {
    const u = JSON.parse(sesion);
    if (u?.grupoPagos === true || u?.rol === 'admin') return true;
  } catch { /* sesion corrupta */ }

  router.navigate(['/home']);
  return false;
};
