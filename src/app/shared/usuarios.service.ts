import { Injectable, inject, signal } from '@angular/core';
import { Firestore, collection, onSnapshot, Unsubscribe } from '@angular/fire/firestore';

/**
 * UsuariosService — listener UNICO y compartido sobre la coleccion `usuarios`.
 *
 * Antes cada componente abria su propio onSnapshot sobre `usuarios`. Con 10+
 * pantallas que necesitan la lista (home, checklist, personal, calendario,
 * checkstore, estadisticas, etc.), eso multiplicaba las lecturas a Firestore
 * por el numero de pantallas abiertas, sumando rapidamente miles de lecturas
 * por minuto.
 *
 * Ahora todos los componentes piden el mismo signal compartido. El listener
 * unico se levanta cuando el primer componente llama `iniciar()` y se cierra
 * cuando el ultimo llama `detener()` (refcount interno). Asi solo se paga 1
 * suscripcion en vez de N, sin perder tiempo real.
 *
 * Uso en componentes:
 *   private usuariosSvc = inject(UsuariosService);
 *   ngOnInit() { this.usuariosSvc.iniciar(); }
 *   ngOnDestroy() { this.usuariosSvc.detener(); }
 *   // y leer la lista con this.usuariosSvc.usuarios()
 */
@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private firestore = inject(Firestore);
  private _usuarios = signal<any[]>([]);
  /** Signal readonly con la lista actual de usuarios. */
  usuarios = this._usuarios.asReadonly();

  private unsub: Unsubscribe | null = null;
  private suscriptores = 0;
  /** Fecha del ultimo snapshot recibido (para diagnostico). */
  ultimaActualizacion = signal<number>(0);

  /** Llamar al cargar un componente que necesite la lista. Idempotente. */
  iniciar(): void {
    this.suscriptores++;
    if (this.unsub) return; // ya esta corriendo

    const ref = collection(this.firestore, 'usuarios');
    this.unsub = onSnapshot(ref, (snap) => {
      const arr: any[] = [];
      snap.forEach(d => arr.push({ ...d.data(), id: d.id, uid: d.id }));
      this._usuarios.set(arr);
      this.ultimaActualizacion.set(Date.now());
    }, (err) => {
      console.error('[UsuariosService] Error en onSnapshot:', err);
    });
  }

  /** Llamar al destruir un componente. Decrementa refcount y cierra el listener cuando llegue a 0. */
  detener(): void {
    this.suscriptores = Math.max(0, this.suscriptores - 1);
    if (this.suscriptores === 0 && this.unsub) {
      this.unsub();
      this.unsub = null;
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
