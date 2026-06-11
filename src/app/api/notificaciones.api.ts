import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../core/api-client';
import type { Notificacion } from './models';

export interface ListNotificacionesFiltro {
  leido?: boolean;
  all?: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificacionesApi {
  private api = inject(ApiClient);

  list(filtros: ListNotificacionesFiltro = {}): Observable<{ notificaciones: Notificacion[] }> {
    return this.api.get<{ notificaciones: Notificacion[] }>('/notificaciones', filtros);
  }

  create(body: Partial<Notificacion>): Observable<{ notificacion: Notificacion }> {
    return this.api.post<{ notificacion: Notificacion }>('/notificaciones', body);
  }

  marcarLeida(id: string): Observable<{ notificacion: Notificacion }> {
    return this.api.patch<{ notificacion: Notificacion }>(`/notificaciones/${id}/leida`, {});
  }

  remove(id: string): Observable<void> {
    return this.api.delete(`/notificaciones/${id}`);
  }

  // --- Tokens FCM ---
  registrarToken(body: { token: string; usuario: string; usuarioUid?: string; userAgent?: string }): Observable<{ token: any }> {
    return this.api.post<{ token: any }>('/notificaciones/tokens', body);
  }
  borrarToken(token: string): Observable<void> {
    return this.api.delete(`/notificaciones/tokens/${encodeURIComponent(token)}`);
  }
}
