import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../core/api-client';
import type { Usuario, TareaUnica, AgendaItem } from './models';

export interface ListUsuariosFiltro {
  rol?: 'admin' | 'trabajador';
  q?: string;
}

export interface UpdateUsuarioBody {
  nombre?: string;
  correo?: string;
  password?: string;
  cargo?: string;
  rol?: 'admin' | 'trabajador';
  alcance?: 'global' | 'sucursales';
  sucursales?: string[];
  areas?: string[];
  telefono?: string;
  puedeCrearChecklists?: boolean;
  puedeCrearRutinas?: boolean;
  puedeCrearTareasUnicas?: boolean;
  puedeVerCheckstore?: boolean;
  puedeVerEstadisticas?: boolean;
  puedeVerHistorial?: boolean;
  puedeAdministrarPersonal?: boolean;
  puedeVerCalendario?: boolean;
  puedeAdministrarAreas?: boolean;
}

@Injectable({ providedIn: 'root' })
export class UsuariosApi {
  private api = inject(ApiClient);

  list(filtros: ListUsuariosFiltro = {}): Observable<{ usuarios: Usuario[] }> {
    return this.api.get<{ usuarios: Usuario[] }>('/usuarios', filtros);
  }

  getById(id: string): Observable<{ user: Usuario }> {
    return this.api.get<{ user: Usuario }>(`/usuarios/${id}`);
  }

  update(id: string, body: UpdateUsuarioBody): Observable<{ user: Usuario }> {
    return this.api.put<{ user: Usuario }>(`/usuarios/${id}`, body);
  }

  remove(id: string): Observable<void> {
    return this.api.delete(`/usuarios/${id}`);
  }

  // --- Sub-recurso: tareas unicas ---
  listTareasUnicas(usuarioId: string): Observable<{ tareas: TareaUnica[] }> {
    return this.api.get<{ tareas: TareaUnica[] }>(`/usuarios/${usuarioId}/tareas-unicas`);
  }
  crearTareaUnica(usuarioId: string, body: Partial<TareaUnica>): Observable<{ tarea: TareaUnica }> {
    return this.api.post<{ tarea: TareaUnica }>(`/usuarios/${usuarioId}/tareas-unicas`, body);
  }
  actualizarTareaUnica(usuarioId: string, id: string, body: Partial<TareaUnica>): Observable<{ tarea: TareaUnica }> {
    return this.api.put<{ tarea: TareaUnica }>(`/usuarios/${usuarioId}/tareas-unicas/${id}`, body);
  }
  borrarTareaUnica(usuarioId: string, id: string): Observable<void> {
    return this.api.delete(`/usuarios/${usuarioId}/tareas-unicas/${id}`);
  }

  // --- Sub-recurso: agenda ---
  listAgenda(usuarioId: string): Observable<{ items: AgendaItem[] }> {
    return this.api.get<{ items: AgendaItem[] }>(`/usuarios/${usuarioId}/agenda`);
  }
  crearAgenda(usuarioId: string, body: Partial<AgendaItem>): Observable<{ item: AgendaItem }> {
    return this.api.post<{ item: AgendaItem }>(`/usuarios/${usuarioId}/agenda`, body);
  }
  actualizarAgenda(usuarioId: string, id: string, body: Partial<AgendaItem>): Observable<{ item: AgendaItem }> {
    return this.api.put<{ item: AgendaItem }>(`/usuarios/${usuarioId}/agenda/${id}`, body);
  }
  borrarAgenda(usuarioId: string, id: string): Observable<void> {
    return this.api.delete(`/usuarios/${usuarioId}/agenda/${id}`);
  }
}
