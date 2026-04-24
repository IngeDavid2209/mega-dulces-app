import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router'; 
import { Firestore, doc, setDoc, updateDoc, getDoc } from '@angular/fire/firestore'; // 🔥 Agregamos getDoc
import { Storage, ref, uploadString, getDownloadURL } from '@angular/fire/storage';
import * as localforage from 'localforage';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit {
  title = 'mega-dulces-app';
  
  private firestore = inject(Firestore);
  private storage = inject(Storage);

  ngOnInit() {
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