import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { Firestore, doc, setDoc, updateDoc, getDoc, onSnapshot, collection, query, where, getDocs } from '@angular/fire/firestore';
import { Storage, ref, uploadString, getDownloadURL } from '@angular/fire/storage';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import * as localforage from 'localforage';

import { AsistenteVozComponent } from './shared/asistente-voz/asistente-voz';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, AsistenteVozComponent],
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
    // Mostrar/ocultar el asistente de voz según el rol, y re-evaluar en cada
    // navegación (cubre login, logout y cambios de pantalla).
    this.actualizarEsAdmin();
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.actualizarEsAdmin());

    // 🔄 AUTO-ACTUALIZACIÓN DE LA PWA INSTALADA 🔄
    this.vigilarActualizaciones();

    // 🔄 SINCRONIZAR SESIÓN EN VIVO con el doc real del usuario en Firestore.
    // Si un admin cambia nombre/sucursales/permisos del usuario, se reflejan al
    // instante sin tener que cerrar sesión.
    this.sincronizarSesion();

    // 🔥 FUNCIÓN DEL LATIDO (SE MANTIENE INTACTA) 🔥
    const enviarLatido = () => {
      const sesion = localStorage.getItem('md_sesion_actual');
      if (sesion) {
        const currentUser = JSON.parse(sesion);
        const docId = currentUser.idFirestore || currentUser.uid || currentUser.usuario;
        
        if (docId) {
          const userRef = doc(this.firestore, 'usuarios', docId);
          setDoc(userRef, { ultimoLatido: Date.now() }, { merge: true })
            .catch(() => console.log('Sin red para latido'));
        }
      }
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

    // 1) Resolver el docId real del usuario en Firestore.
    //    Primero por uid/idFirestore (lo habitual). Si no existe, fallback por
    //    'usuario' login (cubre cuentas viejas o cuando el doc se renombro).
    let docId: string | null = sesion?.uid || sesion?.idFirestore || null;
    if (docId) {
      const probe = await getDoc(doc(this.firestore, 'usuarios', docId));
      if (!probe.exists()) docId = null;
    }
    if (!docId && sesion?.usuario) {
      try {
        const q = query(collection(this.firestore, 'usuarios'), where('usuario', '==', sesion.usuario));
        const qs = await getDocs(q);
        qs.forEach(d => { if (!docId) docId = d.id; });
      } catch (e) { /* sin conexion: no podemos resolver */ }
    }
    if (!docId) {
      console.warn('[sesion] no se pudo localizar el doc del usuario en Firestore. ' +
        'Los permisos del localStorage podrian estar desactualizados. ' +
        `usuario=${sesion?.usuario} uid=${sesion?.uid}`);
      return;
    }

    // 2) Si el localStorage no tenia uid valido, lo guardamos ahora para que
    //    el resto del flujo lo encuentre.
    if (!sesion.uid && !sesion.idFirestore) {
      sesion = { ...sesion, uid: docId };
      localStorage.setItem('md_sesion_actual', JSON.stringify(sesion));
    }

    // 3) Subscribirse al doc real y sincronizar cualquier cambio.
    onSnapshot(doc(this.firestore, 'usuarios', docId), snap => {
      if (!snap.exists()) return;
      const fresco: any = { ...snap.data(), uid: docId };

      const anteriorRaw = localStorage.getItem('md_sesion_actual') || '{}';
      let anterior: any = {};
      try { anterior = JSON.parse(anteriorRaw); } catch {}

      if (JSON.stringify(fresco) === JSON.stringify(anterior)) return;

      localStorage.setItem('md_sesion_actual', JSON.stringify(fresco));

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

      if (campoCriticoCambio || sucCambio || areasCambio || permisoCambio) {
        console.log('[sesion] perfil cambio en Firestore — recargando…');
        setTimeout(() => window.location.reload(), 300);
      }
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
  private vigilarActualizaciones() {
    if (!this.swUpdate.isEnabled) return;

    // 1) Una versión nueva ya quedó lista en caché → aplicarla SOLA, sin avisar.
    //    No perdemos trabajo: los checklists/notas viven en Firestore (con cache
    //    offline) y las fotos a medio subir quedan en la cola de localforage,
    //    así que un reload no borra nada pendiente.
    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => {
        this.swUpdate.activateUpdate().then(() => document.location.reload());
      });

    // 2) Buscar actualizaciones en TODOS los momentos donde la PWA "despierta":
    //    - al arrancar, cada 15 min, al volver del background (visibilitychange),
    //      al recuperar internet (online), y al obtener el foco (focus).
    //    Antes era cada 30 min; bajado a 15 para detectar más rápido en la PWA.
    const buscar = () => this.swUpdate.checkForUpdate().catch(() => {});
    buscar();
    setInterval(buscar, 15 * 60 * 1000); // cada 15 min (era 30)
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

    // 3) Caché corrupto / irrecuperable → recargar limpio desde el servidor (sin avisar).
    this.swUpdate.unrecoverable.subscribe(() => document.location.reload());
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
          const docSnap = await getDoc(docRef); // Descargamos el documento completo

          if (docSnap.exists()) {
            const checklistData = docSnap.data();
            const itemsArray = checklistData['items'] || [];

            // Modificamos el ítem específico dentro del arreglo
            if (itemsArray[item.indexItem]) {
              itemsArray[item.indexItem][item.tipoFoto] = urlDescarga;
              itemsArray[item.indexItem].pendienteDeSync = false;

              // Subimos el arreglo completo ya modificado
              await updateDoc(docRef, { items: itemsArray });
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