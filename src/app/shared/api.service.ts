import { Injectable } from '@angular/core';
import { getAuth, onAuthStateChanged, type User } from '@angular/fire/auth';

/**
 * Cliente HTTP autenticado para la API propia (Postgres) durante la migración.
 * Adjunta el idToken de Firebase (el login sigue en Firebase) en cada llamada.
 * Se reutiliza para todas las colecciones que se vayan migrando a Postgres.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private async token(): Promise<string> {
    const auth = getAuth();
    let u = auth.currentUser;
    // Tras un reload (F5/PWA update), Firebase restaura la sesión persistida de
    // forma ASÍNCRONA. Si consultamos antes de que termine, currentUser es null
    // y toda la vista queda vacía. Esperamos el primer estado de auth resuelto.
    if (!u) {
      u = await new Promise<User | null>((resolve) => {
        const unsub = onAuthStateChanged(auth, (usr) => { unsub(); resolve(usr); },
          () => { unsub(); resolve(null); });
      });
    }
    if (!u) throw new Error('Sin sesión activa');
    return u.getIdToken();
  }

  private async req(method: string, url: string, body?: any): Promise<any> {
    const token = await this.token();
    const res = await fetch(url, {
      method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  get(url: string) { return this.req('GET', url); }
  post(url: string, body?: any) { return this.req('POST', url, body); }
  patch(url: string, body?: any) { return this.req('PATCH', url, body); }
  del(url: string) { return this.req('DELETE', url); }

  // ── Helpers de dual-write para `checklists` (Etapa 3 FERROCARRIL) ──────────
  // Best-effort: si Postgres falla NO rompen el flujo (Firestore ya quedó
  // escrito y el dato se recupera en el recopiado). Centralizan el endpoint y
  // el manejo de error para no repetirlo en los ~20 sitios de escritura.
  /** Upsert completo de un checklist (como setDoc). `obj` debe incluir `id`.
   * Con reintentos: el checklist es el dato crítico de la entrega. Si el POST
   * falla y no reintentamos, Postgres se queda con el estado viejo y el poll de
   * 20 s repinta la tarea como "no hecha" (el usuario ve que se borró su avance).
   * 3 intentos con espera creciente cubren parpadeos de red / cold-starts. */
  async guardarChecklist(obj: any): Promise<void> {
    for (let intento = 1; intento <= 3; intento++) {
      try { await this.post('/api/checklists', obj); return; }
      catch (e) {
        if (intento === 3) { console.error('[checklists] sync PG (guardar) FALLO tras 3 intentos', e); return; }
        await new Promise(r => setTimeout(r, 800 * intento));
      }
    }
  }
  /** Edición parcial/merge de un checklist (como updateDoc / setDoc merge). */
  async patchChecklist(id: any, campos: any): Promise<void> {
    try { await this.patch('/api/checklists', { id: String(id), ...campos }); }
    catch (e) { console.error('[checklists] sync PG (patch)', e); }
  }
  /** Borrado FÍSICO de un checklist (para el deleteDoc de reportes). */
  async borrarChecklist(id: any): Promise<void> {
    try { await this.del('/api/checklists?id=' + encodeURIComponent(String(id))); }
    catch (e) { console.error('[checklists] sync PG (borrar)', e); }
  }

  // ── Helpers genéricos de dual-write (Etapas 4-8 FERROCARRIL) ──────────────
  // Para catalogo-rutinas, asignaciones-rutinas, moldes-checklists,
  // descansos-semanales, tareas-equipo y rutinas-personales. Best-effort:
  // si Postgres falla no rompen el flujo (Firestore ya quedó escrito).
  /** Upsert completo (como setDoc). `obj` debe incluir `id`. */
  async guardar(endpoint: string, obj: any): Promise<void> {
    try { await this.post(endpoint, obj); }
    catch (e) { console.error('[sync PG] guardar', endpoint, e); }
  }
  /** Edición parcial/merge (como updateDoc / setDoc merge). */
  async parchar(endpoint: string, id: any, campos: any): Promise<void> {
    try { await this.patch(endpoint, { id: String(id), ...campos }); }
    catch (e) { console.error('[sync PG] parchar', endpoint, e); }
  }
  /** Borrado físico (como deleteDoc). */
  async borrar(endpoint: string, id: any): Promise<void> {
    try { await this.del(endpoint + '?id=' + encodeURIComponent(String(id))); }
    catch (e) { console.error('[sync PG] borrar', endpoint, e); }
  }
}
