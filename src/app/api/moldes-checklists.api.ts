import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../core/api-client';
import type { MoldeChecklist } from './models';

@Injectable({ providedIn: 'root' })
export class MoldesChecklistsApi {
  private api = inject(ApiClient);

  list(activo?: boolean): Observable<{ moldes: MoldeChecklist[] }> {
    return this.api.get<{ moldes: MoldeChecklist[] }>('/moldes-checklists', activo === undefined ? undefined : { activo });
  }

  getById(id: string): Observable<{ molde: MoldeChecklist }> {
    return this.api.get<{ molde: MoldeChecklist }>(`/moldes-checklists/${id}`);
  }

  create(body: Partial<MoldeChecklist>): Observable<{ molde: MoldeChecklist }> {
    return this.api.post<{ molde: MoldeChecklist }>('/moldes-checklists', body);
  }

  update(id: string, body: Partial<MoldeChecklist>): Observable<{ molde: MoldeChecklist }> {
    return this.api.put<{ molde: MoldeChecklist }>(`/moldes-checklists/${id}`, body);
  }

  remove(id: string): Observable<void> {
    return this.api.delete(`/moldes-checklists/${id}`);
  }
}
