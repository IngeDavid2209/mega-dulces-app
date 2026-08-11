import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/**
 * Guard del modulo /promociones (Activacion de promociones).
 *
 * Seccion gateada EXCLUSIVAMENTE por el privilegio `grupoPromociones`, que se
 * asigna usuario por usuario desde Personal. Mismo modelo que el Espacio TEC
 * (grupoTec) y Flotilla (grupoFlotilla).
 *
 * OJO, y es a proposito: los admins NO entran por ser admin. Tambien necesitan
 * tener `grupoPromociones: true`. Asi el apartado queda visible solo para la
 * gente que David designe, no para cualquier administrador.
 *  - Sin sesion                  -> login.
 *  - grupoPromociones === true   -> entra.
 *  - Cualquier otro              -> fuera, a /home.
 */
export const promocionesGuard: CanActivateFn = () => {
  const router = inject(Router);
  const sesion = localStorage.getItem('md_sesion_actual');

  if (!sesion) { router.navigate(['/login']); return false; }

  try {
    const u = JSON.parse(sesion);
    if (u?.grupoPromociones === true) return true;
  } catch { /* sesion corrupta */ }

  router.navigate(['/home']);
  return false;
};
