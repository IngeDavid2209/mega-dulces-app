import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../core/api-client';
import type { DescansoSemanal } from './models';

export interface ListDescansosFiltro {
  empleado?: string;
  semana?: string;
}

@Injectable({ providedIn: 'root' })
export class DescansosApi {
  private api = inject(ApiClient);

  list(filtros: ListDescansosFiltro = {}): Observable<{ descansos: DescansoSemanal[] }> {
    return this.api.get<{ descansos: DescansoSemanal[] }>('/descansos', filtros);
  }

  /** Upsert por (empleado, semanaIso). dias=[] equivale a borrar el descanso. */
  upsert(body: { empleado: string; userId?: string; semanaIso: string; dias: string[] }): Observable<{ descanso: DescansoSemanal | null; borrado?: boolean }> {
    return this.api.put<{ descanso: DescansoSemanal | null; borrado?: boolean }>('/descansos', body);
  }

  remove(id: string): Observable<void> {
    return this.api.delete(`/descansos/${id}`);
  }
}
