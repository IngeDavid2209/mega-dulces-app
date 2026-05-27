import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Firestore, doc, setDoc, updateDoc, getDoc } from '@angular/fire/firestore'; // 🔥 Agregamos getDoc
import { Storage, ref, uploadString, getDownloadURL } from '@angular/fire/storage';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import * as localforage from 'localforage';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit {
  title = 'Mega Dulces Task';
  
  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private swUpdate = inject(SwUpdate);

  ngOnInit() {
    // 🔄 AUTO-ACTUALIZACIÓN DE LA PWA INSTALADA 🔄
    this.vigilarActualizaciones();

    // 🔥 FUNCIÓN DEL LATIDO (SE MANTIENE INTACTA) 🔥
    const enviarLatido = () => {
      const sesion = localStorage.getItem('md_sesion_actual');
      if (sesion) {
        const currentUser = JSON.parse(sesion);
        const docId = currentUser.idFirestore || currentUser.uid || currentUser.usuario;
        
        if (docId) {
          const userRef = doc(this.firestore, 'usuarios', docId);
          setDoc(userRef, { ultimoLatido: Date.now() }, { merge: true })
            .catch(e => console.log('Sin red para latido'));
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

    // 2) Buscar actualizaciones: al arrancar, periódicamente y al reabrir la app.
    const buscar = () => this.swUpdate.checkForUpdate().catch(() => {});
    buscar();
    setInterval(buscar, 30 * 60 * 1000); // cada 30 min
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') buscar();
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