import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/**
 * Guard del modulo /flotilla (reservas de vehiculos de la empresa).
 * Es una seccion gateada EXCLUSIVAMENTE por el privilegio `grupoFlotilla`, que
 * solo se le activa a los usuarios designados (mismo modelo que el Espacio TEC /
 * grupoTec). OJO: los admins NO entran por ser admin; tambien necesitan tener
 * `grupoFlotilla: true` en su perfil. Asi el modulo queda visible solo para la
 * gente que David indique, no para cualquier administrador.
 *  - Sin sesion              -> login.
 *  - grupoFlotilla === true  -> entra.
 *  - Cualquier otro          -> fuera, a /home.
 */
export const flotillaGuard: CanActivateFn = () => {
  const router = inject(Router);
  const sesion = localStorage.getItem('md_sesion_actual');

  if (!sesion) { router.navigate(['/login']); return false; }

  try {
    const u = JSON.parse(sesion);
    if (u?.grupoFlotilla === true) return true;
  } catch { /* sesion corrupta */ }

  router.navigate(['/home']);
  return false;
};
