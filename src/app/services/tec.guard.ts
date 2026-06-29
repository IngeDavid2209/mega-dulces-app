import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/**
 * Guard del apartado /tec (Espacio TEC).
 * Es una sección normal de la app, gateada por el privilegio `grupoTec` que solo
 * el admin activa:
 *  - Sin sesión → login.
 *  - Usuario con el privilegio (grupoTec) → entra.
 *  - Cualquier otro (incluidos los admins SIN el privilegio) → fuera, a /home.
 *
 * Nota: antes cualquier admin entraba. Se quitó porque el apartado debe verse
 * solo para quien tenga el privilegio activado; un admin que administre el TEC
 * debe activárselo a sí mismo. La gestión de miembros vive en Personal.
 */
export const soloTecGuard: CanActivateFn = () => {
  const router = inject(Router);
  const sesion = localStorage.getItem('md_sesion_actual');

  if (!sesion) { router.navigate(['/login']); return false; }

  try {
    const u = JSON.parse(sesion);
    if (u?.grupoTec === true) return true;
  } catch { /* sesión corrupta */ }

  router.navigate(['/home']);
  return false;
};
