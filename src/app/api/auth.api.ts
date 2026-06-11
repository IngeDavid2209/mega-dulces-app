import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../core/api-client';
import type { Usuario } from './models';

export interface LoginRequest { usuario: string; password: string; }
export interface LoginResponse { token: string; user: Usuario; }
export interface RegisterRequest {
  usuario: string;
  nombre: string;
  password: string;
  correo?: string;
  rol?: 'admin' | 'trabajador';
  alcance?: 'global' | 'sucursales';
  cargo?: string;
  telefono?: string;
  sucursales?: string[];
  areas?: string[];
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
export class AuthApi {
  private api = inject(ApiClient);

  login(req: LoginRequest): Observable<LoginResponse> {
    return this.api.post<LoginResponse>('/auth/login', req);
  }

  register(req: RegisterRequest): Observable<{ user: Usuario }> {
    return this.api.post<{ user: Usuario }>('/auth/register', req);
  }

  me(): Observable<{ user: Usuario }> {
    return this.api.get<{ user: Usuario }>('/auth/me');
  }
}
