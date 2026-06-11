import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../core/api-client';
import type { Checklist, RankingSucursal } from './models';

export interface ListChecklistsFiltro {
  fechaDesde?: string;
  fechaHasta?: string;
  store?: string;
  assigned?: string;
  enviado?: boolean;
  archivado?: boolean;
  eliminado?: boolean;
  limit?: number;
}

export interface RankingFiltro {
  desde: string;
  hasta: string;
}

@Injectable({ providedIn: 'root' })
export class ChecklistsApi {
  private api = inject(ApiClient);

  list(filtros: ListChecklistsFiltro = {}): Observable<{ checklists: Checklist[] }> {
    return this.api.get<{ checklists: Checklist[] }>('/checklists', filtros);
  }

  getById(id: string): Observable<{ checklist: Checklist }> {
    return this.api.get<{ checklist: Checklist }>(`/checklists/${id}`);
  }

  create(body: Partial<Checklist>): Observable<{ checklist: Checklist }> {
    return this.api.post<{ checklist: Checklist }>('/checklists', body);
  }

  update(id: string, body: Partial<Checklist>): Observable<{ checklist: Checklist }> {
    return this.api.put<{ checklist: Checklist }>(`/checklists/${id}`, body);
  }

  /** Update parcial usando el docIdFirebase (id legacy del cliente). */
  updateByFirebaseId(docIdFirebase: string, body: Partial<Checklist>): Observable<{ checklist: Checklist }> {
    return this.api.patch<{ checklist: Checklist }>(`/checklists/by-firebase-id/${docIdFirebase}`, body);
  }

  /** Marca eliminado=true + cascada por (name, assigned, store, fecha). */
  softDelete(id: string, cascada = true): Observable<{ checklistsAfectados: number }> {
    return this.api.patch<{ checklistsAfectados: number }>(`/checklists/${id}/soft-delete`, { cascada });
  }

  hardDelete(id: string): Observable<void> {
    return this.api.delete(`/checklists/${id}`);
  }

  archivarMes(mes: string): Observable<{ mes: string; archivados: number }> {
    return this.api.post<{ mes: string; archivados: number }>('/checklists/archivar-mes', { mes });
  }

  marcarFotosBorradas(ids: string[], fotosBorradasCount?: number): Observable<{ marcados: number }> {
    return this.api.post<{ marcados: number }>('/checklists/marcar-fotos-borradas', { ids, fotosBorradasCount });
  }

  ranking(filtro: RankingFiltro): Observable<{ desde: string; hasta: string; ranking: RankingSucursal[] }> {
    return this.api.get('/checklists/ranking', filtro);
  }
}
