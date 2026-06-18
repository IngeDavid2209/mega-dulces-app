import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const authGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);

  // Revisamos si la sesión de Mega Dulces está activa
  const sesionActiva = localStorage.getItem('md_sesion_actual');

  if (!sesionActiva) {
    router.navigate(['/login']); // Pa' fuera
    return false;
  }

  // 🎓 Aislamiento Grupo TEC: estos usuarios SOLO pueden estar en su apartado.
  // Si intentan entrar a cualquier ruta de la empresa, los regresamos a /tec.
  try {
    const u = JSON.parse(sesionActiva);
    if (u?.grupoTec === true) {
      router.navigate(['/tec']);
      return false;
    }
  } catch { /* sesión corrupta: la dejamos pasar al flujo normal */ }

  return true; // Pásale, güero
};