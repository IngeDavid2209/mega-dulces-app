import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/**
 * Guard del apartado /tec.
 *  - Sin sesión → login.
 *  - Usuario del Grupo TEC (grupoTec) → entra.
 *  - Admin global (soporte/dueño) → entra también, para poder supervisar.
 *  - Cualquier otro (personal de la empresa) → fuera, a /home.
 */
export const soloTecGuard: CanActivateFn = () => {
  const router = inject(Router);
  const sesion = localStorage.getItem('md_sesion_actual');

  if (!sesion) { router.navigate(['/login']); return false; }

  try {
    const u = JSON.parse(sesion);
    const esTec = u?.grupoTec === true;
    const esAdminGlobal = u?.rol === 'admin' && (u?.alcance ?? 'global') === 'global';
    if (esTec || esAdminGlobal) return true;
  } catch { /* sesión corrupta */ }

  router.navigate(['/home']);
  return false;
};
