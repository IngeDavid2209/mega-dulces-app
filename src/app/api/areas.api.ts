import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../core/api-client';
import type { Area } from './models';

@Injectable({ providedIn: 'root' })
export class AreasApi {
  private api = inject(ApiClient);

  list(): Observable<{ areas: Area[] }> {
    return this.api.get<{ areas: Area[] }>('/areas');
  }

  getById(id: string): Observable<{ area: Area }> {
    return this.api.get<{ area: Area }>(`/areas/${id}`);
  }

  create(body: Partial<Area>): Observable<{ area: Area }> {
    return this.api.post<{ area: Area }>('/areas', body);
  }

  update(id: string, body: Partial<Area>): Observable<{ area: Area }> {
    return this.api.put<{ area: Area }>(`/areas/${id}`, body);
  }

  remove(id: string): Observable<void> {
    return this.api.delete(`/areas/${id}`);
  }
}
