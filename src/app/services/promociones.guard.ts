import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/**
 * Guard del modulo /promociones (Activacion de promociones).
 *
 * La seccion es una sola pero son DOS oficios, y cada uno se asigna por
 * separado desde Personal:
 *
 *   promocionesFormato      da de alta el formato MKTN001, lo edita, lo quita,
 *                           y ademas llena expedientes (alcanza todo).
 *   promocionesExpediente   SOLO llena el expediente de SU sucursal: sube la
 *                           salida, la exhibicion y los tickets. Ve el formato
 *                           y lo baja en PDF, pero no le mueve nada, ni quita
 *                           evidencia ya subida.
 *
 * Con CUALQUIERA de los dos se entra; adentro, cada quien ve lo suyo (de eso se
 * encargan el componente y, sobre todo, el servidor: api/_promo-acceso.js).
 *
 * `grupoPromociones` es la bandera VIEJA, cuando el apartado era un solo
 * permiso que daba todo. Se sigue aceptando para que nadie se quede afuera el
 * dia del cambio, mientras corre scripts/sql/035_promociones_roles.sql y la
 * gente vuelve a entrar (la sesion guardada trae las banderas de cuando se
 * firmo). Se puede borrar de aqui cuando ya nadie traiga sesiones viejas.
 *
 * OJO, y es a proposito: los admins NO entran por ser admin. Tambien necesitan
 * que se les prenda al menos uno de los dos oficios. Asi el apartado queda
 * visible solo para la gente que David designe, no para cualquier administrador.
 *  - Sin sesion              -> login.
 *  - Alguno de los dos       -> entra.
 *  - Cualquier otro          -> fuera, a /home.
 */
export const promocionesGuard: CanActivateFn = () => {
  const router = inject(Router);
  const sesion = localStorage.getItem('md_sesion_actual');

  if (!sesion) { router.navigate(['/login']); return false; }

  try {
    const u = JSON.parse(sesion);
    if (u?.promocionesFormato === true) return true;
    if (u?.promocionesExpediente === true) return true;
    if (u?.grupoPromociones === true) return true;   // bandera vieja
  } catch { /* sesion corrupta */ }

  router.navigate(['/home']);
  return false;
};
