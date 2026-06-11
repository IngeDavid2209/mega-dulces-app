import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../core/api-client';
import type { RutinaCatalogo } from './models';

@Injectable({ providedIn: 'root' })
export class RutinasCatalogoApi {
  private api = inject(ApiClient);

  list(): Observable<{ rutinas: RutinaCatalogo[] }> {
    return this.api.get<{ rutinas: RutinaCatalogo[] }>('/rutinas-catalogo');
  }

  getById(id: string): Observable<{ rutina: RutinaCatalogo }> {
    return this.api.get<{ rutina: RutinaCatalogo }>(`/rutinas-catalogo/${id}`);
  }

  create(body: Partial<RutinaCatalogo>): Observable<{ rutina: RutinaCatalogo }> {
    return this.api.post<{ rutina: RutinaCatalogo }>('/rutinas-catalogo', body);
  }

  update(id: string, body: Partial<RutinaCatalogo>): Observable<{ rutina: RutinaCatalogo }> {
    return this.api.put<{ rutina: RutinaCatalogo }>(`/rutinas-catalogo/${id}`, body);
  }

  duplicar(id: string): Observable<{ rutina: RutinaCatalogo }> {
    return this.api.post<{ rutina: RutinaCatalogo }>(`/rutinas-catalogo/${id}/duplicar`, {});
  }

  archivar(id: string): Observable<{ rutina: RutinaCatalogo; checklistsCancelados: number }> {
    return this.api.post<{ rutina: RutinaCatalogo; checklistsCancelados: number }>(`/rutinas-catalogo/${id}/archivar`, {});
  }

  restaurar(id: string): Observable<{ rutina: RutinaCatalogo }> {
    return this.api.post<{ rutina: RutinaCatalogo }>(`/rutinas-catalogo/${id}/restaurar`, {});
  }

  remove(id: string): Observable<{ checklistsCancelados: number }> {
    return this.api.delete<{ checklistsCancelados: number }>(`/rutinas-catalogo/${id}`);
  }
}
