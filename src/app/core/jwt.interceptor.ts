// Interceptor que adjunta el JWT del localStorage en cada request al backend
// y maneja 401 cerrando sesion + redirigiendo a /login.
//
// Solo intercepta URLs que apuntan al backend propio. Las llamadas a Cloudinary,
// Firebase Storage o cualquier otro dominio pasan sin tocar para no filtrar
// el token a terceros.
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';

const STORAGE_KEY_TOKEN = 'md_jwt';

/** Helper exportado para que AuthService persista el token sin duplicar la constante. */
export function guardarTokenJwt(token: string | null): void {
  try {
    if (token) localStorage.setItem(STORAGE_KEY_TOKEN, token);
    else       localStorage.removeItem(STORAGE_KEY_TOKEN);
  } catch { /* storage bloqueado / modo incognito */ }
}

export function leerTokenJwt(): string | null {
  try { return localStorage.getItem(STORAGE_KEY_TOKEN); }
  catch { return null; }
}

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  // Solo tocamos requests al backend propio. Si la URL apunta a otro dominio,
  // no adjuntamos token ni cerramos sesion en 401 (esos errores son del proveedor).
  const esBackend = req.url.startsWith(environment.apiUrl);
  if (!esBackend) return next(req);

  const token = leerTokenJwt();
  const reqAuth = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  const router = inject(Router);

  return next(reqAuth).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401) {
        // Token invalido o expirado → limpiar sesion + ir al login
        guardarTokenJwt(null);
        try { localStorage.removeItem('md_sesion_actual'); } catch {}
        // Evitamos redirigir si ya estamos en /login (loop)
        if (router.url !== '/login') router.navigate(['/login']);
      }
      return throwError(() => err);
    })
  );
};
