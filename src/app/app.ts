import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, Router, NavigationEnd, NavigationError } from '@angular/router';
import { Firestore, doc, updateDoc } from '@angular/fire/firestore';
import { Storage, ref, uploadString, getDownloadURL } from '@angular/fire/storage';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import * as localforage from 'localforage';
import Swal from 'sweetalert2';

import { AsistenteChatComponent } from './shared/asistente-chat/asistente-chat';
import { ApiService } from './shared/api.service';
import { NotificacionesService } from './services/notificaciones';
import { cerrarSesionSegura } from './shared/sesion.util';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, AsistenteChatComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit {
  title = 'Mega Dulces Task';

  /** El asistente de voz solo se muestra a administradores, en toda la app. */
  esAdmin = false;

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
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.actualizarEsAdmin());

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

    // 🔒 SEGURIDAD EN DISPOSITIVOS COMPARTIDOS 🔒
    // Dos capas para que nadie termine trabajando en la cuenta de otra persona
    // (tablets de sucursal que se pasan de mano en mano):
    //   1) Cierre de sesión automático tras inactividad prolongada.
    //   2) Confirmación "¿Eres tú?" al abrir la app o al volver tras un rato.
    this.vigilarInactividad();
    this.vigilarIdentidadCompartida();

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

  // ── 🔒 Seguridad de sesión en dispositivos compartidos ────────────────────
  // Umbrales (fáciles de ajustar):
  //   INACTIVIDAD: sin ningún toque/tecla/scroll durante este tiempo → se cierra
  //   la sesión sola. Cualquier interacción reinicia el conteo, así que a quien
  //   está trabajando NO lo saca.
  //   AUSENCIA: si la app estuvo en segundo plano (pantalla apagada / cambió de
  //   app) más de este tiempo, al volver pedimos confirmar identidad. Cubre el
  //   handoff típico: dejan la tablet, la toma otra persona.
  private readonly INACTIVIDAD_MS = 30 * 60 * 1000; // 30 min
  private readonly AUSENCIA_MS = 8 * 60 * 1000;     // 8 min
  private ultimaActividad = Date.now();
  private ocultoDesde = 0;
  private confirmandoIdentidad = false;

  /** ¿Hay una sesión local activa en este momento? */
  private haySesion(): boolean {
    try { return !!localStorage.getItem('md_sesion_actual'); } catch { return false; }
  }
  /** Nombre (o usuario) de la sesión local, para los mensajes. */
  private nombreSesion(): string | null {
    try {
      const u = JSON.parse(localStorage.getItem('md_sesion_actual') || 'null');
      return (u && (u.nombre || u.usuario)) || null;
    } catch { return null; }
  }

  /**
   * 🔒 CIERRE POR INACTIVIDAD. Registra la última interacción del usuario y, cada
   * minuto, si pasó el umbral SIN actividad y hay sesión, la cierra de forma
   * segura (Firebase + local) y manda al login. Evita que una tablet quede
   * abierta en la cuenta de alguien que ya se fue.
   */
  private vigilarInactividad() {
    const marcar = () => { this.ultimaActividad = Date.now(); };
    ['click', 'touchstart', 'pointerdown', 'keydown', 'scroll'].forEach(ev =>
      window.addEventListener(ev, marcar, { passive: true }));
    // Volver al primer plano cuenta como actividad (no cerrar por estar en background).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') marcar();
    });

    setInterval(() => {
      if (!this.haySesion()) return;                 // sin sesión: el login manda
      if (this.confirmandoIdentidad) return;         // hay un diálogo abierto
      if (Date.now() - this.ultimaActividad < this.INACTIVIDAD_MS) return;
      this.cerrarPorInactividad();
    }, 60 * 1000);
  }

  private async cerrarPorInactividad() {
    if (!this.haySesion()) return;
    try { sessionStorage.removeItem('md_ident_confirmada'); } catch { /* noop */ }
    await cerrarSesionSegura();
    await this.router.navigate(['/login']);
    Swal.fire({
      icon: 'info',
      title: 'Sesión cerrada',
      text: 'Cerramos tu sesión por inactividad. Vuelve a entrar para continuar.',
      confirmButtonColor: '#0F172A',
    });
  }

  /**
   * 🔒 CONFIRMAR IDENTIDAD ("¿Eres tú?"). Se dispara:
   *   - al arrancar la app con una sesión ya abierta (reapertura de la PWA), una
   *     sola vez por sesión del navegador (sobrevive a las recargas automáticas
   *     por actualización, así que no molesta en cada deploy), y
   *   - al volver al primer plano tras estar oculta más de AUSENCIA_MS.
   * Si el usuario dice que NO es él, cerramos sesión y lo mandamos al login.
   */
  private vigilarIdentidadCompartida() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { this.ocultoDesde = Date.now(); return; }
      if (this.ocultoDesde && (Date.now() - this.ocultoDesde >= this.AUSENCIA_MS)) {
        this.confirmarIdentidad();
      }
      this.ocultoDesde = 0;
    });

    // Arranque con sesión ya abierta: confirmar una vez por sesión del navegador.
    let yaConfirmada = false;
    try { yaConfirmada = sessionStorage.getItem('md_ident_confirmada') === '1'; } catch { /* noop */ }
    if (this.haySesion() && !yaConfirmada) this.confirmarIdentidad();
  }

  private async confirmarIdentidad() {
    if (this.confirmandoIdentidad) return;           // no apilar diálogos
    if (!this.haySesion()) return;                   // sin sesión: nada que confirmar
    if (this.router.url.startsWith('/login')) return;
    const nombre = this.nombreSesion();
    if (!nombre) return;

    this.confirmandoIdentidad = true;
    const r = await Swal.fire({
      icon: 'question',
      title: `¿Eres ${nombre}?`,
      text: 'Confirma tu identidad para seguir en tu cuenta.',
      showCancelButton: true,
      confirmButtonText: 'Sí, soy yo',
      cancelButtonText: 'No, cambiar de usuario',
      confirmButtonColor: '#0F172A',
      cancelButtonColor: '#b91c1c',
      allowOutsideClick: false,
      allowEscapeKey: false,
    });
    this.confirmandoIdentidad = false;

    if (r.isConfirmed) {
      try { sessionStorage.setItem('md_ident_confirmada', '1'); } catch { /* noop */ }
      this.ultimaActividad = Date.now();             // no cerrar por inactividad justo después
    } else {
      try { sessionStorage.removeItem('md_ident_confirmada'); } catch { /* noop */ }
      await cerrarSesionSegura();
      await this.router.navigate(['/login']);
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
    const revisar = async () => {
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

      // Cambio crítico → recarga para que todas las pantallas tomen los nuevos permisos.
      const camposCriticos = ['nombre', 'rol', 'alcance', 'cargo'];
      const sucCambio = JSON.stringify(anterior.sucursales || []) !== JSON.stringify(fresco.sucursales || []);
      const areasCambio = JSON.stringify(anterior.areas || []) !== JSON.stringify(fresco.areas || []);
      const campoCriticoCambio = camposCriticos.some(c => (anterior[c] || '') !== (fresco[c] || ''));
      const permisos = [
        'puedeCrearChecklists', 'puedeCrearRutinas', 'puedeCrearTareasUnicas',
        'puedeVerCheckstore', 'puedeVerEstadisticas', 'puedeVerHistorial',
        'puedeAdministrarPersonal', 'puedeVerCalendario', 'puedeAdministrarAreas'
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
    setInterval(revisar, 60000); // cada 60s (antes era en vivo con onSnapshot)
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

    const recargarUnaVez = (motivo: string) => {
      // Candado anti-bucle: no recargar más de una vez cada 20 s.
      const ahora = Date.now();
      const ultima = Number(sessionStorage.getItem('md_reload_chunk') || '0');
      if (ahora - ultima < 20000) return;
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