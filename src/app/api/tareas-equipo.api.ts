import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../core/api-client';
import type { TareaEquipo } from './models';

@Injectable({ providedIn: 'root' })
export class TareasEquipoApi {
  private api = inject(ApiClient);

  list(cerrado?: boolean): Observable<{ tareas: TareaEquipo[] }> {
    return this.api.get<{ tareas: TareaEquipo[] }>('/tareas-equipo', cerrado === undefined ? undefined : { cerrado });
  }

  getById(id: string): Observable<{ tarea: TareaEquipo }> {
    return this.api.get<{ tarea: TareaEquipo }>(`/tareas-equipo/${id}`);
  }

  create(body: Partial<TareaEquipo>): Observable<{ tarea: TareaEquipo }> {
    return this.api.post<{ tarea: TareaEquipo }>('/tareas-equipo', body);
  }

  update(id: string, body: Partial<TareaEquipo>): Observable<{ tarea: TareaEquipo }> {
    return this.api.put<{ tarea: TareaEquipo }>(`/tareas-equipo/${id}`, body);
  }

  cerrar(id: string): Observable<{ tarea: TareaEquipo }> {
    return this.api.post<{ tarea: TareaEquipo }>(`/tareas-equipo/${id}/cerrar`, {});
  }

  remove(id: string): Observable<void> {
    return this.api.delete(`/tareas-equipo/${id}`);
  }
}
