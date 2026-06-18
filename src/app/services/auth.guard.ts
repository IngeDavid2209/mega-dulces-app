import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const authGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);

  // Revisamos si la sesión de Mega Dulces está activa
  const sesionActiva = localStorage.getItem('md_sesion_actual');

  if (sesionActiva) {
    return true; // Pásale, güero
  } else {
    router.navigate(['/login']); // Pa' fuera
    return false;
  }
};