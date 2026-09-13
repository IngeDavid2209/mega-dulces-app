import { Injectable } from '@angular/core';
import { getAuth, onAuthStateChanged, type User } from '@angular/fire/auth';

/**
 * Cliente HTTP autenticado para la API propia (Postgres) durante la migración.
 * Adjunta el idToken de Firebase (el login sigue en Firebase) en cada llamada.
 * Se reutiliza para todas las colecciones que se vayan migrando a Postgres.
 */
/**
 * Error de la API con el MOTIVO, para que las pantallas puedan distinguir "no
 * hay internet" de "el servidor contestó con error" o "la sesión se venció".
 *
 * Antes todo caía en el mismo aviso de "Sin conexión", y eso mandaba a revisar
 * el wifi cuando el problema estaba en otra parte.
 */
export class ErrorApi extends Error {
  constructor(mensaje: string, public sinRed: boolean, public status = 0) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private async token(forzarRefresco = false): Promise<string> {
    // ── ACCESO POR PLAZA (13/sep/2026) ─────────────────────────────────────
    //
    // Quien entra con «PH-ANA-1» + PIN NO tiene usuario de Firebase: su sesión
    // la emite `/api/login-plaza` como JWT propio, y `api/_auth.js` ya sabe
    // verificarlo. Sin esta rama, `getAuth().currentUser` sería null, este
    // método lanzaría «Sin sesión activa» y la persona entraría a una app
    // COMPLETAMENTE VACÍA — sin un solo error visible que explicara por qué.
    //
    // Va primero y sin `await`: si la llave existe, no hay nada que esperar.
    // Se borra al entrar por el login normal y al cerrar sesión, para que un
    // token de plaza olvidado no secuestre la sesión de otra persona en el
    // mismo navegador.
    try {
      const propio = localStorage.getItem('md_token');
      if (propio) return propio;
    } catch { /* navegador sin storage: sigue por Firebase */ }

    const auth = getAuth();
    let u = auth.currentUser;
    // Tras un reload (F5/PWA update), Firebase restaura la sesión persistida de
    // forma ASÍNCRONA. Si consultamos antes de que termine, currentUser es null
    // y toda la vista queda vacía. Esperamos el primer estado de auth resuelto.
    // Con TIMEOUT: si el observer no resuelve (red lenta), no colgamos la request
    // para siempre; reintentamos con lo que haya en currentUser en ese momento.
    if (!u) {
      u = await new Promise<User | null>((resolve) => {
        let listo = false;
        const cerrar = (v: User | null) => { if (!listo) { listo = true; try { unsub(); } catch { } resolve(v); } };
        const unsub = onAuthStateChanged(auth, (usr) => cerrar(usr), () => cerrar(null));
        setTimeout(() => cerrar(auth.currentUser), 8000);
      });
    }
    if (!u) throw new ErrorApi('Sin sesión activa', false, 401);
    // getIdToken() sin forzar: devuelve el token en cache si aún es válido (no
    // pega a la red salvo que esté por expirar). Evita que un refresh de token
    // por red tumbe cada petición con mala señal. Con `forzarRefresco` se pide
    // uno nuevo a huevo, que es lo que se hace al recibir un 401.
    return u.getIdToken(forzarRefresco);
  }

  private async req(
    method: string, url: string, body?: any,
    reintentosRed = 2, forzarToken = false, puedeReintentarAuth = true
  ): Promise<any> {
    const token = await this.token(forzarToken);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // Error de RED (fetch lanza TypeError cuando no hay respuesta del server:
      // sin señal, DNS, cold-start caído). Solo para GET (idempotente) reintentamos
      // un par de veces con backoff corto, para que un parpadeo no tire el poll y
      // deje la vista vacía. Las escrituras NO se reintentan aquí (guardarChecklist
      // ya tiene su propio reintento y no queremos duplicar envíos).
      if (method === 'GET' && reintentosRed > 0) {
        await new Promise(r => setTimeout(r, 700 * (3 - reintentosRed)));
        return this.req(method, url, body, reintentosRed - 1, forzarToken, puedeReintentarAuth);
      }
      // Aquí sí es falta de red: la petición no obtuvo NINGUNA respuesta.
      throw new ErrorApi('Sin conexión con el servidor', true);
    }
    // Respuesta que SÍ llegó, pero de una puerta intermedia caída. Railway
    // devuelve 502/503/504 (con cuerpo HTML, no JSON) mientras el contenedor
    // despierta o se reinicia por un deploy, y eso dura unos segundos. Antes
    // caía derecho al modo "sin conexión" aunque la red del usuario estuviera
    // perfecta. Mismo criterio que el fallo de red: solo GET, que es idempotente.
    const puertaCaida = res.status === 502 || res.status === 503 || res.status === 504;
    if (puertaCaida && method === 'GET' && reintentosRed > 0) {
      await new Promise(r => setTimeout(r, 700 * (3 - reintentosRed)));
      return this.req(method, url, body, reintentosRed - 1, forzarToken, puedeReintentarAuth);
    }

    // El idToken de Firebase dura una hora. Firebase lo renueva solo, pero si esa
    // renovación falla una vez (un parpadeo de red, la pestaña dormida), el token
    // en cache se queda viejo y TODAS las lecturas se van en 401 para siempre: la
    // app se congela mostrando datos de horas antes con el aviso de "sin conexión"
    // aunque haya internet perfecto. Nada la sacaba de ahí sin recargar.
    //
    // Un 401 significa que el servidor rechazó ANTES de hacer nada, así que
    // reintentar es seguro incluso en una escritura.
    if (res.status === 401 && puedeReintentarAuth) {
      return this.req(method, url, body, reintentosRed, true, false);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ErrorApi((data && data.error) || ('HTTP ' + res.status), false, res.status);
    }
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
