// Wrapper sobre HttpClient: centraliza baseURL, manejo de errores y tipado.
// Los servicios api/*.api.ts lo inyectan; nunca usan HttpClient directo.
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl;

  /** GET con query params opcionales. Cualquier objeto plano sirve; los
   *  valores undefined/null se descartan y todos se serializan a string. */
  get<T>(path: string, params?: object): Observable<T> {
    return this.http.get<T>(this.url(path), { params: this.params(params) }).pipe(catchError(this.errorHandler));
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(this.url(path), body).pipe(catchError(this.errorHandler));
  }

  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<T>(this.url(path), body).pipe(catchError(this.errorHandler));
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(this.url(path), body).pipe(catchError(this.errorHandler));
  }

  delete<T = void>(path: string): Observable<T> {
    return this.http.delete<T>(this.url(path)).pipe(catchError(this.errorHandler));
  }

  // ----- helpers internos -----
  private url(path: string): string {
    if (path.startsWith('http')) return path;     // permite URLs absolutas para overrides
    return `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
  }

  private params(p?: object): HttpParams | undefined {
    if (!p) return undefined;
    let hp = new HttpParams();
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      hp = hp.set(k, String(v));
    }
    return hp;
  }

  /** Normaliza errores HTTP para que los consumidores siempre reciban {error, status}. */
  private errorHandler = (err: HttpErrorResponse) => {
    const detalle = err.error?.detalle;
    const msg = err.error?.error || err.message || 'Error desconocido';
    return throwError(() => ({ status: err.status, error: msg, detalle }));
  };
}
