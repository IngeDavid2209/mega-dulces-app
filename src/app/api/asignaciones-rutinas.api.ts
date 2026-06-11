import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../core/api-client';
import type { AsignacionRutina } from './models';

export interface ListAsignacionesFiltro {
  activa?: boolean;
  store?: string;
}

@Injectable({ providedIn: 'root' })
export class AsignacionesRutinasApi {
  private api = inject(ApiClient);

  list(filtros: ListAsignacionesFiltro = {}): Observable<{ asignaciones: AsignacionRutina[] }> {
    return this.api.get<{ asignaciones: AsignacionRutina[] }>('/asignaciones-rutinas', filtros);
  }

  getById(id: string): Observable<{ asignacion: AsignacionRutina }> {
    return this.api.get<{ asignacion: AsignacionRutina }>(`/asignaciones-rutinas/${id}`);
  }

  create(body: Partial<AsignacionRutina>): Observable<{ asignacion: AsignacionRutina }> {
    return this.api.post<{ asignacion: AsignacionRutina }>('/asignaciones-rutinas', body);
  }

  update(id: string, body: Partial<AsignacionRutina>): Observable<{ asignacion: AsignacionRutina }> {
    return this.api.put<{ asignacion: AsignacionRutina }>(`/asignaciones-rutinas/${id}`, body);
  }

  remove(id: string): Observable<void> {
    return this.api.delete(`/asignaciones-rutinas/${id}`);
  }
}
