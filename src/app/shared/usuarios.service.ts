// =============================================================================
// UsuariosService — listener UNICO compartido sobre la coleccion `usuarios`.
// =============================================================================
// Modos de operacion (controlados por environment.useBackend):
//
//   useBackend=false (legacy, Firebase):
//     - onSnapshot UNICO sobre la coleccion `usuarios` con refcount.
//     - Reduce las lecturas Firestore drasticamente (antes 10+ componentes
//       abrian su propio onSnapshot).
//
//   useBackend=true (backend Node + Express):
//     - Polling UNICO cada 60s a GET /api/usuarios con refcount.
//     - Refresh inmediato al volver de background (visibilitychange).
//     - Mismo signal compartido — el lado del cliente no se entera del cambio.
//
// La interfaz publica (signal `usuarios`, `iniciar`, `detener`, `buscarPorX`)
// es identica en ambos modos para que los componentes que ya lo consumen no
// necesiten tocarse cuando hagamos el cutover.
import { Injectable, inject, signal } from '@angular/core';
import { Firestore, collection, onSnapshot, Unsubscribe } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { UsuariosApi } from '../api/usuarios.api';

const INTERVALO_POLLING_MS = 60_000;     // 60s: usuarios cambia poco

@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private firestore = inject(Firestore);
  private usuariosApi = inject(UsuariosApi);
  private _usuarios = signal<any[]>([]);
  /** Signal readonly con la lista actual de usuarios. */
  usuarios = this._usuarios.asReadonly();

  private unsub: Unsubscribe | null = null;          // Firestore
  private pollTimer: any = null;                      // backend
  private visibilityHandler: (() => void) | null = null;
  private suscriptores = 0;
  ultimaActualizacion = signal<number>(0);

  /** Llamar al cargar un componente que necesite la lista. Idempotente. */
  iniciar(): void {
    this.suscriptores++;
    if (environment.useBackend) {
      if (!this.pollTimer) this.iniciarPolling();
    } else {
      if (!this.unsub) this.iniciarSnapshotFirestore();
    }
  }

  /** Llamar al destruir un componente. Cierra el listener cuando refcount llega a 0. */
  detener(): void {
    this.suscriptores = Math.max(0, this.suscriptores - 1);
    if (this.suscriptores > 0) return;
    if (this.unsub)        { this.unsub(); this.unsub = null; }
    if (this.pollTimer)    { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  // ---------- Modo Firebase ----------
  private iniciarSnapshotFirestore(): void {
    const ref = collection(this.firestore, 'usuarios');
    this.unsub = onSnapshot(ref, (snap) => {
      const arr: any[] = [];
      snap.forEach(d => arr.push({ ...d.data(), id: d.id, uid: d.id }));
      this._usuarios.set(arr);
      this.ultimaActualizacion.set(Date.now());
    }, (err) => {
      console.error('[UsuariosService/firestore] Error en onSnapshot:', err);
    });
  }

  // ---------- Modo Backend ----------
  private iniciarPolling(): void {
    // Fetch inmediato y luego cada INTERVALO_POLLING_MS.
    this.fetchBackend();
    this.pollTimer = setInterval(() => this.fetchBackend(), INTERVALO_POLLING_MS);

    // Refresh al volver al primer plano (pestana visible).
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') this.fetchBackend();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private async fetchBackend(): Promise<void> {
    try {
      const res = await firstValueFrom(this.usuariosApi.list());
      // El backend devuelve `id` UUID Postgres y `uidFirebase` aparte.
      // Para compatibilidad con codigo legacy que espera `.uid`, alias = uidFirebase ?? id.
      const arr = res.usuarios.map(u => ({ ...u, uid: u.uidFirebase || u.id }));
      this._usuarios.set(arr);
      this.ultimaActualizacion.set(Date.now());
    } catch (err) {
      console.error('[UsuariosService/backend] Error en GET /api/usuarios:', err);
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
