import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

/**
 * UsuariosService — fuente UNICA y compartida de la lista de `usuarios`.
 *
 * MIGRACION FERROCARRIL (Etapa 1): antes usaba un onSnapshot en tiempo real
 * sobre TODA la coleccion Firestore `usuarios`. Como el heartbeat de presencia
 * escribe cada 60s por usuario, cada escritura disparaba una relectura de todos
 * los docs para todos los clientes -> miles de lecturas/min (principal causa de
 * agotar la cuota). Ahora lee de Postgres via /api/usuarios con un POLL ligero
 * (cada 30s), compartido por refcount. Se pierde el "tiempo real" estricto a
 * cambio de una fraccion de las lecturas (mismo criterio que el Espacio TEC).
 *
 * El interfaz publico NO cambia: los componentes siguen usando
 * `usuarios()`, `iniciar()`, `detener()`, `buscarPorUsuario()`, `buscarPorId()`.
 * Nuevo: `refrescar()` para forzar recarga inmediata tras crear/editar/borrar.
 */
@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private api = inject(ApiService);
  private _usuarios = signal<any[]>([]);
  /** Signal readonly con la lista actual de usuarios. */
  usuarios = this._usuarios.asReadonly();

  private timer: any = null;
  private suscriptores = 0;
  private cargando = false;
  private readonly INTERVALO_MS = 30000; // 30s (mismo criterio que TEC)
  /** Fecha de la ultima carga recibida (para diagnostico). */
  ultimaActualizacion = signal<number>(0);

  /** Llamar al cargar un componente que necesite la lista. Idempotente. */
  iniciar(): void {
    this.suscriptores++;
    if (this.timer) return; // ya esta corriendo
    this.cargar();                                   // primera carga inmediata
    this.timer = setInterval(() => this.cargar(), this.INTERVALO_MS);
  }

  /** Llamar al destruir un componente. Cierra el poll cuando el refcount llega a 0. */
  detener(): void {
    this.suscriptores = Math.max(0, this.suscriptores - 1);
    if (this.suscriptores === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Fuerza una recarga inmediata (usar tras crear/editar/borrar un usuario). */
  refrescar(): void { this.cargar(); }

  private async cargar(): Promise<void> {
    if (this.cargando) return; // evita solaparse si una carga tarda
    this.cargando = true;
    try {
      const r = await this.api.get('/api/usuarios');
      const arr = (r.usuarios || []).map((u: any) => ({ ...u, id: u.id || u.uid, uid: u.uid || u.id }));
      this._usuarios.set(arr);
      this.ultimaActualizacion.set(Date.now());
    } catch (e) {
      console.error('[UsuariosService] Error al cargar usuarios:', e);
    } finally {
      this.cargando = false;
    }
  }

  /** Util: busca un usuario por su campo `usuario` (login). */
  buscarPorUsuario(login: string): any | null {
    if (!login) return null;
    return this._usuarios().find(u => u.usuario === login) || null;
  }

  /** Util: busca un usuario por su id (docId/uid). */
  buscarPorId(id: string): any | null {
    if (!id) return null;
    return this._usuarios().find(u => u.id === id || u.uid === id) || null;
  }
}
