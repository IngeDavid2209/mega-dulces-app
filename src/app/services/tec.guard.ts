import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/**
 * Guard del apartado /tec (Espacio TEC).
 * Es una sección normal de la app, gateada por el privilegio `grupoTec` que solo
 * el admin activa:
 *  - Sin sesión → login.
 *  - Usuario con el privilegio (grupoTec) → entra.
 *  - Cualquier admin (para administrar/supervisar) → entra.
 *  - Cualquier otro → fuera, a /home.
 */
export const soloTecGuard: CanActivateFn = () => {
  const router = inject(Router);
  const sesion = localStorage.getItem('md_sesion_actual');

  if (!sesion) { router.navigate(['/login']); return false; }

  try {
    const u = JSON.parse(sesion);
    if (u?.grupoTec === true || u?.rol === 'admin') return true;
  } catch { /* sesión corrupta */ }

  router.navigate(['/home']);
  return false;
};
