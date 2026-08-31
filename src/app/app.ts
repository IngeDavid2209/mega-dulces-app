import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, Router, NavigationEnd, NavigationError } from '@angular/router';
import { Firestore, doc, updateDoc } from '@angular/fire/firestore';
import { Storage, ref, uploadString, getDownloadURL } from '@angular/fire/storage';
// Para el candado de identidad de la sesión: hay que poder preguntar quién es
// el usuario que Firebase tiene activo AHORA, no el que había al arrancar.
import { getAuth } from '@angular/fire/auth';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import * as localforage from 'localforage';

import { AsistenteChatComponent } from './shared/asistente-chat/asistente-chat';
import { MantenimientoComponent } from './components/mantenimiento/mantenimiento';
import { ApiService } from './shared/api.service';
import { NotificacionesService } from './services/notificaciones';
import { debeVerMantenimiento, MANTENIMIENTO_ACTIVO } from './shared/mantenimiento.util';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, AsistenteChatComponent, MantenimientoComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit {
  title = 'Mega Dulces Task';

  /**
   * INTERRUPTOR DEL ASISTENTE (el boton azul de chat, abajo a la derecha).
   *
   * APAGADO a pedido de David el 2026-08-22, mientras se trabaja en otras cosas.
   * PARA VOLVER A MOSTRARLO: poner esto en true y desplegar. Nada del asistente
   * se borro ni se toco: el endpoint, los permisos y el bot de WhatsApp siguen
   * completos; nomas no se pinta el boton.
   */
  private readonly MOSTRAR_ASISTENTE = false;

  /** El asistente solo se muestra a administradores, en toda la app. */
  esAdmin = false;

  /**
   * 🚧 ¿Se pinta el aviso de mantenimiento en vez de la app?
   *
   * La compuerta vive AQUÍ, en la raíz, y no en un guard de ruta a propósito:
   * hay rutas sin guard (`/calendario`, `/agenda`) y el `**` manda al login, así
   * que un guard habría dejado huecos por donde entrar escribiendo la URL.
   * Desde la raíz se cubren todas las rutas de una vez, sin excepción posible.
   *
   * El interruptor y la lista de exentos están en shared/mantenimiento.util.ts.
   */
  verMantenimiento = false;

  /** Lo que decide si se pinta: el interruptor de arriba Y que sea admin. */
  get mostrarAsistente(): boolean { return this.MOSTRAR_ASISTENTE && this.esAdmin; }

  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private swUpdate = inject(SwUpdate);
  private router = inject(Router);
  private api = inject(ApiService); // FERROCARRIL: usuarios en Postgres
  private notificaciones = inject(NotificacionesService);

  /** Relee la sesión y decide si el usuario actual es admin. */
  private actualizarEsAdmin() {
    try {
      const raw = localStorage.getItem('md_sesion_actual');
      const user = raw ? JSON.parse(raw) : null;
      this.esAdmin = user?.rol === 'admin';
    } catch {
      this.esAdmin = false;
    }
  }

  /**
   * Relee sesión + ruta y decide si toca el aviso de mantenimiento.
   *
   * Se llama al arrancar y en cada navegación, que es lo que cubre los tres
   * momentos que importan: abrir la app con sesión vieja, entrar al login, y
   * el instante justo después de iniciar sesión.
   */
  private actualizarMantenimiento() {
    if (!MANTENIMIENTO_ACTIVO) { this.verMantenimiento = false; return; }
    let user: any = null;
    try {
      const raw = localStorage.getItem('md_sesion_actual');
      user = raw ? JSON.parse(raw) : null;
    } catch { user = null; }

    // Se miran las DOS urls: la del router y la de la barra de direcciones.
    //
    // Al arrancar, este método corre antes de que termine la primera
    // navegación, y en ese momento `router.url` todavía dice '/'. Si solo se
    // mirara esa, abrir la app directo en /login pintaba el aviso un instante
    // antes de corregirse: un parpadeo justo en la pantalla por la que tiene
    // que entrar quien va a levantar el mantenimiento.
    const rutaRouter = this.router.url;
    const rutaNavegador = (() => {
      try { return window.location.pathname; } catch { return rutaRouter; }
    })();

    // Abierta si CUALQUIERA de las dos lo dice: durante una navegación las dos
    // se desfasan por un momento y conviene errar del lado de no tapar.
    this.verMantenimiento =
      debeVerMantenimiento(user, rutaRouter) && debeVerMantenimiento(user, rutaNavegador);
  }

  ngOnInit() {
    // 🛡️ ALMACENAMIENTO PERSISTENTE: pedimos al navegador que NO borre los datos
    // del sitio bajo presión de espacio. Sin esto, en móviles (sobre todo iOS)
    // cuando la cola de fotos offline (base64 en IndexedDB) llena el cupo, el
    // navegador desaloja TODO el origen de golpe — incluida la sesión
    // (md_sesion_actual) y la sesión de Firebase — y al usuario lo manda al
    // login solo, justo cuando trabaja con tareas de fotos.
    this.asegurarAlmacenamientoPersistente();

    // Mostrar/ocultar el asistente de voz según el rol, y re-evaluar en cada
    // navegación (cubre login, logout y cambios de pantalla).
    this.actualizarEsAdmin();
    // 🚧 Compuerta de mantenimiento: se evalúa igual que el asistente, al
    // arrancar y en cada navegación (cubre login, logout y cambio de pantalla).
    this.actualizarMantenimiento();
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => {
        this.actualizarEsAdmin();
        this.actualizarMantenimiento();
      });

    // 🔄 AUTO-ACTUALIZACIÓN DE LA PWA INSTALADA 🔄
    this.vigilarActualizaciones();

    // 🛟 RED DE SEGURIDAD: si un apartado lazy (checklist, tec, etc.) no carga
    // porque el deploy reemplazó su chunk con otro hash, recargamos limpio en
    // vez de dejar la pantalla muerta/en blanco.
    this.manejarFallosDeChunk();

    // 🔄 SINCRONIZAR SESIÓN EN VIVO con el doc real del usuario en Firestore.
    // Si un admin cambia nombre/sucursales/permisos del usuario, se reflejan al
    // instante sin tener que cerrar sesión.
    this.sincronizarSesion();

    // 🔔 RE-REGISTRAR EL TOKEN FCM al abrir la app (no solo en el login). Los
    // usuarios casi nunca cierran sesión (la PWA la mantiene), así que el
    // registro del token —y su dual-write a Postgres— casi nunca se re-ejecutaba
    // y la tabla de tokens quedaba vacía/obsoleta. Al hacerlo en cada arranque
    // mantenemos Postgres poblado y los tokens frescos para el push.
    this.reRegistrarTokenPush();

    // 🔒 NOTA DE SEGURIDAD DE SESIÓN (leer antes de reactivar nada) 🔒
    // El 22/07/2026 se agregaron aquí dos capas pensadas para tablets de sucursal
    // compartidas: (1) cierre automático de sesión por 30 min de inactividad y
    // (2) diálogo "¿Eres tú?" al abrir la app o al volver tras 8 min en segundo
    // plano. Se aplicaron a TODOS los dispositivos y sacaron de la sesión a
    // muchísima gente que trabaja en su propio celular: apagan la pantalla, se
    // van a trabajar, el temporizador sigue corriendo en segundo plano y al
    // volver ya están en el login. El "¿Eres tú?" además se repetía casi cada
    // vez que se reabría la PWA (la marca vivía en sessionStorage, que se borra
    // al cerrarla) y su botón "No, cambiar de usuario" sacaba a quien le picara
    // por error. Se retiraron el 24/07/2026 — están en el commit 3adf8f8 si
    // algún día se necesitan, pero SOLO detrás de una marca de "dispositivo
    // compartido" y nunca activas por defecto.
    //
    // Lo que SÍ se conserva de ese fix (y es el arreglo de fondo): cerrar la
    // sesión de Firebase junto con la local (cerrarSesionSegura en
    // shared/sesion.util.ts) e identificar al usuario del checklist por uid y
    // nunca por nombre.

    // 🔥 LATIDO DE PRESENCIA 🔥 (FERROCARRIL: ahora a Postgres, no Firestore)
    const enviarLatido = () => {
      const sesion = localStorage.getItem('md_sesion_actual');
      if (!sesion) return;
      let currentUser: any;
      try { currentUser = JSON.parse(sesion); } catch { return; }
      const docId = currentUser.uid || currentUser.idFirestore || currentUser.id;
      if (!docId) return;
      // PATCH ligero: solo actualiza ultimoLatido en mdtask_usuarios.
      this.api.patch('/api/usuarios', { id: docId, ultimoLatido: Date.now() })
        .catch(() => { /* sin red o sin sesión: ignorar */ });
    };

    enviarLatido();
    setInterval(enviarLatido, 60000);

    // 🔥 SYNC MANAGER (EL FRANCOTIRADOR DE INTERNET) 🔥
    window.addEventListener('online', () => {
      console.log('🌐 ¡Conexión recuperada! Iniciando sincronización fantasma...');
      this.sincronizarFotosOffline();
    });

    if (navigator.onLine) {
      this.sincronizarFotosOffline();
    }
  }

  /**
   * 🛡️ Solicita almacenamiento persistente para que el navegador no borre
   * localStorage/IndexedDB del sitio cuando el dispositivo se queda sin espacio.
   *
   * Problema que resuelve: varios usuarios (los de peor señal) que suben tareas
   * CON FOTOS eran mandados al login solos. Causa: cuando Cloudinary falla, la
   * foto se guarda completa en base64 en la cola offline (IndexedDB). Al
   * acumularse, el origen supera su cupo y el navegador desaloja TODO su
   * almacenamiento — incluida la sesión — dejando al usuario en el login.
   *
   * `navigator.storage.persist()` marca el almacenamiento como "persistente":
   * el navegador ya no lo borra bajo presión de espacio. En PWAs instaladas
   * suele concederse solo; pedirlo explícitamente cubre también el navegador.
   * Best-effort: si el API no existe o se rechaza, no rompe nada.
   */
  private async asegurarAlmacenamientoPersistente() {
    try {
      if (!('storage' in navigator) || !navigator.storage?.persist) return;
      const yaPersistente = navigator.storage.persisted
        ? await navigator.storage.persisted()
        : false;
      if (yaPersistente) return;
      const concedido = await navigator.storage.persist();
      console.log(`[storage] persistente=${concedido}`);
    } catch (e) {
      console.warn('[storage] no se pudo solicitar persistencia', e);
    }
  }

  /**
   * 🔔 Re-registra el token FCM del dispositivo al abrir la app, para mantener
   * poblada y fresca la tabla de tokens (mdtask_usuarios_tokens en Postgres).
   *
   * Problema que resuelve: `solicitarPermisos()` solo se llamaba en el login
   * explícito. Como los usuarios casi nunca cierran sesión (la PWA la mantiene),
   * el token no se volvía a registrar y su dual-write a Postgres casi nunca
   * corría — la tabla quedaba vacía y los push (avisos de tarea, "actualizar")
   * no llegaban a nadie.
   *
   * Solo se ejecuta si el permiso YA está concedido: así NO mostramos el prompt
   * de notificaciones en cada arranque (el prompt inicial se queda en el login).
   * `solicitarPermisos` es idempotente (upsert por id) y refresca el token.
   */
  private reRegistrarTokenPush() {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const raw = localStorage.getItem('md_sesion_actual');
      if (!raw) return;
      const u = JSON.parse(raw);
      const nombre = u?.nombre;
      const uid = u?.uid || u?.idFirestore || u?.id;
      if (!nombre) return;
      this.notificaciones.solicitarPermisos(nombre, uid).catch(() => { /* best-effort */ });
    } catch { /* noop */ }
  }

  /**
   * 🔄 Sincroniza la sesión local (md_sesion_actual) con el doc real del usuario
   * en Firestore. Si un admin edita el perfil del usuario (nombre, sucursales,
   * permisos, rol), los cambios se reflejan al instante:
   *
   *  - Cambios menores (teléfono, cargo, áreas) → solo actualiza localStorage,
   *    los componentes los toman en la siguiente navegación.
   *  - Cambios CRÍTICOS (rol, alcance, sucursales, nombre) → recarga la app
   *    para que toda la UI se reconstruya con los nuevos permisos. Eso resuelve:
   *      • trabajadores que no veían tareas asignadas (su nombre cambió),
   *      • admins limitados que no veían el avance de sucursales nuevas,
   *      • usuarios bloqueados al enviar porque sus permisos estaban viejos.
   */
  private async sincronizarSesion() {
    const raw = localStorage.getItem('md_sesion_actual');
    if (!raw) return;
    let sesion: any;
    try { sesion = JSON.parse(raw); } catch { return; }

    // FERROCARRIL: el perfil vive en Postgres. Se resuelve por uid (que el login
    // ya deja en la sesión). Si no hay uid, no podemos sincronizar (los permisos
    // del localStorage siguen usándose tal cual).
    const docId: string | null = sesion?.uid || sesion?.idFirestore || null;
    if (!docId) {
      console.warn('[sesion] sesión sin uid; no se puede sincronizar el perfil desde Postgres. ' +
        `usuario=${sesion?.usuario}`);
      return;
    }

    // Poll del perfil real y sincronización de cambios (antes era onSnapshot).
    let reloj: any = null;
    const revisar = async () => {
      // ─────────────────────────────────────────────────────────────────────
      // CANDADO DE IDENTIDAD — antes de tocar nada, ¿esta sesión sigue siendo
      // la mía?
      //
      // `md_sesion_actual` vive en localStorage, que TODAS las pestañas del
      // mismo sitio comparten, y Firebase Auth solo admite un usuario activo a
      // la vez. Si alguien entra con otra cuenta en otra pestaña, la sesión
      // guardada deja de ser la de esta pestaña.
      //
      // Sin este candado pasaba lo siguiente: cada pestaña seguía consultando
      // SU cuenta (docId quedó capturado aquí arriba) y le reescribía encima la
      // sesión a la otra, una cada 60 s. Las dos pestañas se peleaban el mismo
      // espacio y, como el cambio de permisos cuenta como crítico, se recargaban
      // en turnos: el "salto de cuentas".
      //
      // Peor que el salto: entre recarga y recarga, la pantalla mostraba a una
      // persona mientras las llamadas al servidor salían firmadas como la otra.
      // En una app donde los permisos deciden quién puede autorizar y cobrar,
      // eso no se puede dejar pasar.
      //
      // Al detectarlo se para el reloj y se manda a login. NO se intenta
      // "arreglar" la sesión: no hay forma de saber cuál de las dos quería el
      // usuario, y adivinar es justo lo que causó el problema.
      const dueñoActual = getAuth().currentUser?.uid || null;
      if (dueñoActual && dueñoActual !== docId) {
        console.warn('[sesion] esta pestaña era de ' + docId + ' y la sesión ahora es de '
          + dueñoActual + '. Se detiene la sincronización y se manda a login.');
        if (reloj) { clearInterval(reloj); reloj = null; }
        this.router.navigate(['/login']);
        return;
      }

      let fresco: any;
      try {
        const r = await this.api.get('/api/usuarios?id=' + encodeURIComponent(docId));
        fresco = r && r.usuario;
      } catch (e) { return; /* sin red: reintenta en el próximo ciclo */ }
      if (!fresco) return;
      fresco.uid = fresco.uid || docId;

      const anteriorRaw = localStorage.getItem('md_sesion_actual') || '{}';
      let anterior: any = {};
      try { anterior = JSON.parse(anteriorRaw); } catch {}

      // Segunda revisión, ya con la sesión en la mano: si mientras se consultaba
      // el perfil otra pestaña metió una cuenta distinta, esta NO se la pisa.
      // Que la última en escribir gane es lo que hacía que las dos se turnaran
      // el navegador indefinidamente.
      const uidGuardado = anterior?.uid || anterior?.idFirestore || null;
      if (uidGuardado && uidGuardado !== docId) {
        console.warn('[sesion] la sesión guardada cambió a ' + uidGuardado
          + ' mientras se sincronizaba ' + docId + '. No se sobrescribe.');
        if (reloj) { clearInterval(reloj); reloj = null; }
        this.router.navigate(['/login']);
        return;
      }

      // Cambio crítico → recarga para que todas las pantallas tomen los nuevos permisos.
      const camposCriticos = ['nombre', 'rol', 'alcance', 'cargo'];
      const sucCambio = JSON.stringify(anterior.sucursales || []) !== JSON.stringify(fresco.sucursales || []);
      const areasCambio = JSON.stringify(anterior.areas || []) !== JSON.stringify(fresco.areas || []);
      const campoCriticoCambio = camposCriticos.some(c => (anterior[c] || '') !== (fresco[c] || ''));
      const permisos = [
        'puedeCrearChecklists', 'puedeCrearRutinas', 'puedeCrearTareasUnicas',
        'puedeVerCheckstore', 'puedeVerEstadisticas', 'puedeVerHistorial',
        'puedeAdministrarPersonal', 'puedeVerCalendario', 'puedeAdministrarAreas',
        // 🟢 Venta de Promos. Van aquí (y no solo guardados) porque el apartado
        // TIENE que aparecer en cuanto se le prende el permiso: se le asigna a
        // la cajera con el turno ya empezado y no se le va a pedir que cierre
        // sesión para poder reportar la primera venta.
        'ventaPromosCaja', 'ventaPromosVendedor', 'ventaPromosMonitor'
      ];
      const permisoCambio = permisos.some(p => !!anterior[p] !== !!fresco[p]);
      const huboCambioCritico = campoCriticoCambio || sucCambio || areasCambio || permisoCambio;

      // Guardar solo si algo cambió (evita escrituras innecesarias en cada ciclo).
      const cambioAlgo = JSON.stringify(fresco) !== JSON.stringify(anterior);
      if (cambioAlgo) localStorage.setItem('md_sesion_actual', JSON.stringify(fresco));

      if (huboCambioCritico) {
        console.log('[sesion] perfil cambió — recargando…');
        setTimeout(() => window.location.reload(), 300);
      }
    };

    revisar();
    // El reloj se guarda para poder pararlo: si esta pestaña deja de ser suya
    // (ver el candado de identidad), seguir consultando cada minuto solo sirve
    // para volver a pisar la sesión de la cuenta buena.
    reloj = setInterval(revisar, 60000); // cada 60s (antes era en vivo con onSnapshot)
  }

  /**
   * 🛟 Recupera la app cuando un módulo lazy (loadComponent) no se puede cargar.
   *
   * Causa típica: se publicó una versión nueva y el servidor reemplazó los chunks
   * con hash distinto. Una PWA que seguía abierta con la versión vieja intenta
   * importar el chunk anterior (p. ej. checklist-XXXX.js), el servidor responde
   * 404 y ese apartado queda en blanco / sin responder. El `unrecoverable` del
   * Service Worker NO cubre esto (el caché no está corrupto, solo desfasado).
   *
   * Solución: detectar ese fallo y recargar UNA sola vez (con candado anti-bucle),
   * pidiendo antes la última versión al Service Worker. Tras la recarga el cliente
   * toma el index.html nuevo con los hashes correctos y el apartado abre bien.
   */
  private manejarFallosDeChunk() {
    const esErrorDeChunk = (msg: any): boolean =>
      /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|dynamically imported module/i
        .test(String(msg ?? ''));

    /**
     * Borra el cache del Service Worker y lo da de baja.
     *
     * Hace falta porque recargar NO SIEMPRE BASTA. El Service Worker sirve su
     * propio `ngsw.json`, y si ese indice quedo de un despliegue anterior, la
     * recarga vuelve a pedir los mismos chunks con hash viejo que el servidor ya
     * no tiene. La app entra en un empate: recarga, falla, recarga, falla — y en
     * cuanto el candado anti-bucle entra, la navegacion se muere EN SILENCIO y el
     * usuario solo ve que el menu no responde.
     *
     * Borrando el cache y dando de baja el worker, la siguiente carga va directo
     * al servidor y toma el indice bueno. Se pierde el modo sin conexion hasta
     * que el worker se vuelva a registrar solo, que pasa en esa misma carga.
     */
    const purgarServiceWorker = async () => {
      try {
        if ('caches' in window) {
          const nombres = await caches.keys();
          await Promise.all(nombres.filter(n => /ngsw|angular/i.test(n)).map(n => caches.delete(n)));
        }
        if (navigator.serviceWorker?.getRegistrations) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
      } catch (e) {
        console.warn('[chunk] no se pudo purgar el service worker', e);
      }
    };

    /**
     * Ultimo recurso: DECIRLO. Un menu que no responde y no explica nada es el
     * peor final posible — el usuario concluye que la app esta rota y no hay
     * forma de que adivine que la solucion es un refresco duro.
     */
    const avisarSinSalida = () => {
      if (document.getElementById('md-aviso-version')) return;
      const d = document.createElement('div');
      d.id = 'md-aviso-version';
      d.setAttribute('role', 'alert');
      d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;'
        + 'background:#0F172A;color:#fff;padding:14px 18px;font:600 14px system-ui,sans-serif;'
        + 'display:flex;gap:14px;align-items:center;justify-content:center;flex-wrap:wrap;'
        + 'box-shadow:0 -2px 12px rgba(0,0,0,.25)';
      d.innerHTML = '<span>Hay una version nueva y esta pantalla no pudo cargar. '
        + 'Recarga para continuar.</span>';
      const b = document.createElement('button');
      b.textContent = 'Recargar ahora';
      b.style.cssText = 'font:700 14px system-ui,sans-serif;background:#fff;color:#0F172A;'
        + 'border:0;border-radius:8px;padding:8px 16px;cursor:pointer';
      b.onclick = async () => { await purgarServiceWorker(); document.location.reload(); };
      d.appendChild(b);
      document.body.appendChild(d);
    };

    const recargarUnaVez = (motivo: string) => {
      // Candado anti-bucle, pero ESCALANDO en vez de rendirse en silencio:
      //   1er fallo -> recarga normal, que casi siempre basta.
      //   2o fallo  -> purga el cache del Service Worker y recarga.
      //   3er fallo -> avisa al usuario, porque ya no hay nada mas que intentar
      //                automaticamente y callarse seria dejarle una app muerta.
      const ahora = Date.now();
      const ultima = Number(sessionStorage.getItem('md_reload_chunk') || '0');
      const intentos = Number(sessionStorage.getItem('md_reload_chunk_n') || '0');

      if (ahora - ultima < 20000) {
        if (intentos >= 2) avisarSinSalida();
        return;
      }

      if (intentos >= 1) {
        sessionStorage.setItem('md_reload_chunk', String(ahora));
        sessionStorage.setItem('md_reload_chunk_n', String(intentos + 1));
        console.warn('[chunk] segundo fallo — purgando service worker:', motivo);
        if (intentos >= 2) { avisarSinSalida(); return; }
        purgarServiceWorker().finally(() => document.location.reload());
        return;
      }
      sessionStorage.setItem('md_reload_chunk_n', String(intentos + 1));
      // Offline: recargar NO baja el chunk que falta; dejaría la app en blanco.
      // Esperamos a tener red y reintentamos una vez.
      if (!navigator.onLine) {
        console.warn('[chunk] offline — recarga diferida:', motivo);
        const alVolver = () => { window.removeEventListener('online', alVolver); recargarUnaVez(motivo); };
        window.addEventListener('online', alVolver);
        return;
      }
      sessionStorage.setItem('md_reload_chunk', String(ahora));
      console.warn('[chunk] módulo lazy no disponible — recargando:', motivo);
      if (this.swUpdate.isEnabled) {
        this.swUpdate.checkForUpdate()
          .then(() => this.swUpdate.activateUpdate().catch(() => {}))
          .finally(() => document.location.reload());
      } else {
        document.location.reload();
      }
    };

    // 1) Navegación a una ruta lazy cuyo chunk ya no existe.
    this.router.events
      .pipe(filter((e): e is NavigationError => e instanceof NavigationError))
      .subscribe(e => { if (esErrorDeChunk(e.error?.message || e.error)) recargarUnaVez('NavigationError'); });

    // 2) import() que falla fuera del router (rechazo sin manejar).
    window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
      if (esErrorDeChunk(ev?.reason?.message || ev?.reason)) recargarUnaVez('unhandledrejection');
    });
  }

  /**
   * 🔄 Mantiene actualizada la PWA aunque esté instalada en la pantalla de inicio.
   *
   * Problema que resuelve: cuando publicas una versión nueva, las apps instaladas
   * se quedan "pegadas" en la versión vieja del caché del Service Worker hasta que
   * el usuario la cierra y reabre varias veces.
   *
   * Esto:
   *  1) Detecta cuando una versión nueva quedó descargada (VERSION_READY) y avisa
   *     al usuario para reiniciar y aplicarla.
   *  2) Busca actualizaciones al arrancar, cada 30 min, y CADA VEZ que el usuario
   *     reabre la app (visibilitychange) — clave en celulares donde la PWA queda
   *     en segundo plano por días.
   *  3) Si el caché se corrompe (estado irrecuperable), recarga desde el servidor.
   *
   * Nota: solo corre en producción. En `ng serve` / build dev el Service Worker
   * está deshabilitado, así que swUpdate.isEnabled es false y esto no hace nada.
   */
  /**
   * 📡 Recarga la página, pero SOLO si hay conexión. Si está offline, difiere la
   * recarga hasta el evento 'online'. Motivo: recargar sin red deja la app en
   * blanco (no puede bajar el index/chunks nuevos ni traer datos), que es justo
   * lo que hacía ver "todo vacío" con mala señal. Mejor esperar a tener internet.
   */
  private recargarSiHayRed(motivo: string) {
    if (navigator.onLine) { document.location.reload(); return; }
    console.warn('[app] recarga diferida (offline):', motivo);
    const alVolver = () => { window.removeEventListener('online', alVolver); document.location.reload(); };
    window.addEventListener('online', alVolver);
  }

  private vigilarActualizaciones() {
    if (!this.swUpdate.isEnabled) return;

    // 1) Una versión nueva ya quedó lista en caché → aplicarla SOLA, sin avisar.
    //    No perdemos trabajo: los checklists/notas viven en Firestore (con cache
    //    offline) y las fotos a medio subir quedan en la cola de localforage,
    //    así que un reload no borra nada pendiente.
    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => {
        // Aplica y recarga SOLA. Recarga aunque activateUpdate falle: al recargar
        // el navegador toma igualmente la versión nueva del Service Worker.
        this.swUpdate.activateUpdate()
          .then(() => this.recargarSiHayRed('version-ready'))
          .catch(() => this.recargarSiHayRed('version-ready'));
      });

    // 2) Buscar actualizaciones en TODOS los momentos donde la PWA "despierta":
    //    - al arrancar, cada 2 min (para que se actualice sola aunque el usuario
    //      la tenga abierta sin salir), al volver del background
    //      (visibilitychange), al recuperar internet (online) y al obtener foco.
    const buscar = () => this.swUpdate.checkForUpdate().catch(() => {});
    buscar();
    setInterval(buscar, 2 * 60 * 1000); // cada 2 min (era 15)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') buscar();
    });
    window.addEventListener('focus', buscar);
    window.addEventListener('online', buscar);

    // 4) 🔔 PUSH desde FCM: cuando el admin pulsa "Notificar actualización",
    //    el SW de FCM (firebase-messaging-sw.js) recibe el push y reenvía un
    //    postMessage al cliente. Aquí lo escuchamos y forzamos un check + reload.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
        const data: any = event?.data;
        if (data?.source === 'fcm' && data?.tipo === 'actualizacion') {
          buscar();
        }
      });
    }
    // Y también cuando la app está EN PRIMER PLANO recibe el push vía onMessage,
    // que disparamos como CustomEvent('fcm-message') desde notificaciones.ts.
    window.addEventListener('fcm-message', (e: any) => {
      const tipo = e?.detail?.data?.tipo;
      if (tipo === 'actualizacion') buscar();
    });

    // 3) Caché corrupto / irrecuperable → recargar limpio desde el servidor (sin
    //    avisar), pero solo si hay red (offline no se puede bajar nada limpio).
    this.swUpdate.unrecoverable.subscribe(() => this.recargarSiHayRed('unrecoverable'));
  }

  // 🔥 FUNCIÓN DE SINCRONIZACIÓN CORREGIDA PARA ARREGLOS 🔥
  async sincronizarFotosOffline() {
    try {
      const colaFotos: any[] = await localforage.getItem('md_fotos_offline') || [];

      if (colaFotos.length === 0) return;

      console.log(`🚀 Subiendo ${colaFotos.length} fotos estancadas en segundo plano...`);
      const fotosRestantes = [];

      for (let item of colaFotos) {
        try {
          const rutaStorage = `checklists_evidencias/sync_offline_${item.idTarea}_${Date.now()}.jpg`;
          const storageRef = ref(this.storage, rutaStorage);

          await uploadString(storageRef, item.base64, 'data_url');
          const urlDescarga = await getDownloadURL(storageRef);

          // 🛠️ CIRUGÍA LÁSER: Actualización de arreglos en Firestore
          const docRef = doc(this.firestore, 'checklists', item.idTarea);
          // FERROCARRIL Etapa 3: leemos el checklist desde Postgres
          const resp = await this.api.get('/api/checklists?id=' + encodeURIComponent(String(item.idTarea)));
          const checklistData = resp?.checklist;

          if (checklistData) {
            const itemsArray = checklistData['items'] || [];

            // Modificamos el ítem específico dentro del arreglo
            if (itemsArray[item.indexItem]) {
              itemsArray[item.indexItem][item.tipoFoto] = urlDescarga;
              itemsArray[item.indexItem].pendienteDeSync = false;

              // Subimos el arreglo completo ya modificado
              await updateDoc(docRef, { items: itemsArray });
              // FERROCARRIL Etapa 3: dual-write del arreglo items a Postgres
              await this.api.patchChecklist(String(item.idTarea), { items: itemsArray });
              console.log(`📸 Foto sincronizada con éxito: Tarea ${item.idTarea}`);
            }
          }

        } catch (error) {
          console.error('❌ Error sincronizando una foto, se queda en la cola:', error);
          fotosRestantes.push(item);
        }
      }

      // Guardamos lo que haya quedado pendiente (si hubo algún error de red a mitad del proceso)
      await localforage.setItem('md_fotos_offline', fotosRestantes);

    } catch (error) {
      console.error('Error general en el Sync Manager:', error);
    }
  }
}