// Guard de rutas: bloquea acceso si no hay sesion valida.
//
// En modo Firebase legacy (`useBackend=false`) basta con que exista la entrada
// `md_sesion_actual` en localStorage (mismo comportamiento original).
//
// En modo backend (`useBackend=true`) ademas validamos que el JWT no haya
// expirado decodificandolo en cliente. Si falta o esta vencido, redirigimos
// a /login. La verificacion fuerte (firma) la hace el backend en cada request.
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { leerTokenJwt } from '../core/jwt.interceptor';

function jwtExpiroLocalmente(token: string): boolean {
  try {
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return true;
    const json = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (!json.exp) return false;          // sin exp lo damos por valido (lo invalidara el backend)
    return json.exp * 1000 < Date.now();
  } catch {
    return true;                          // token corrupto
  }
}

export const authGuard: CanActivateFn = (_route, _state) => {
  const router = inject(Router);

  if (environment.useBackend) {
    const token = leerTokenJwt();
    if (!token || jwtExpiroLocalmente(token)) {
      router.navigate(['/login']);
      return false;
    }
    return true;
  }

  // Legacy: solo verificamos que exista la sesion en localStorage.
  const sesion = localStorage.getItem('md_sesion_actual');
  if (sesion) return true;
  router.navigate(['/login']);
  return false;
};
