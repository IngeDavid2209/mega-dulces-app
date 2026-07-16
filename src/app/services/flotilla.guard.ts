import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/**
 * Guard del modulo /flotilla (reservas de vehiculos de la empresa).
 * Es una seccion gateada por el privilegio `grupoFlotilla` que el admin activa
 * (mismo modelo que el Espacio TEC / grupoTec):
 *  - Sin sesion              -> login.
 *  - grupoFlotilla === true  -> entra.
 *  - Admin (rol 'admin')     -> entra (para poder aprobar y administrar coches).
 *  - Cualquier otro          -> fuera, a /home.
 */
export const flotillaGuard: CanActivateFn = () => {
  const router = inject(Router);
  const sesion = localStorage.getItem('md_sesion_actual');

  if (!sesion) { router.navigate(['/login']); return false; }

  try {
    const u = JSON.parse(sesion);
    if (u?.grupoFlotilla === true || u?.rol === 'admin') return true;
  } catch { /* sesion corrupta */ }

  router.navigate(['/home']);
  return false;
};
