import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/**
 * Guard del modulo /venta-promos (Venta de Promos).
 *
 * La seccion es una sola pero atiende TRES oficios, y cada uno se asigna por
 * separado desde Personal:
 *
 *   ventaPromosVendedor  crea las promos (nombre, costo, descripcion, foto).
 *   ventaPromosCaja      la cajera: da la luz verde de la venta.
 *   ventaPromosMonitor   vigila el tablero y recibe el aviso dentro de la app.
 *
 * Con CUALQUIERA de los tres se entra; adentro, cada quien ve lo suyo (de eso se
 * encarga el componente).
 *
 * OJO, y es a proposito, igual que en Promociones y el Espacio TEC: los admins
 * NO entran por ser admin. Tambien necesitan que se les prenda al menos una de
 * las tres banderas. Asi el apartado queda visible solo para la gente que David
 * designe, no para cualquier administrador.
 *  - Sin sesion            -> login.
 *  - Alguna de las tres    -> entra.
 *  - Cualquier otro        -> fuera, a /home.
 */
export const ventaPromosGuard: CanActivateFn = () => {
  const router = inject(Router);
  const sesion = localStorage.getItem('md_sesion_actual');

  if (!sesion) { router.navigate(['/login']); return false; }

  try {
    const u = JSON.parse(sesion);
    if (u?.ventaPromosVendedor === true) return true;
    if (u?.ventaPromosCaja === true) return true;
    if (u?.ventaPromosMonitor === true) return true;
  } catch { /* sesion corrupta */ }

  router.navigate(['/home']);
  return false;
};
