import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router'; 
import { Firestore, doc, setDoc, updateDoc } from '@angular/fire/firestore';
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
  private storage = inject(Storage); // 🔥 INYECTAMOS STORAGE PARA SUBIR LAS FOTOS 🔥

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

    // 1. Mandamos el primer latido
    enviarLatido();

    // 2. Motor encendido para el latido cada 60 seg
    setInterval(enviarLatido, 60000);

    // =========================================================
    // 🔥 SYNC MANAGER (EL FRANCOTIRADOR DE INTERNET) 🔥
    // =========================================================
    
    // Escuchamos el instante exacto en que regresa el internet
    window.addEventListener('online', () => {
      console.log('🌐 ¡Conexión recuperada! Iniciando sincronización fantasma...');
      this.sincronizarFotosOffline();
    });

    // Por si el usuario cerró la app estando offline y la vuelve a abrir ya con internet
    if (navigator.onLine) {
      this.sincronizarFotosOffline();
    }
  }

  // Función que procesa la cola de fotos estancadas
  async sincronizarFotosOffline() {
    try {
      // 1. Buscamos en la bóveda si hay un arreglo de fotos pendientes
      const colaFotos: any[] = await localforage.getItem('md_fotos_offline') || [];

      if (colaFotos.length === 0) {
        return; // No hay nada pendiente, salimos silenciosamente
      }

      console.log(`🚀 Subiendo ${colaFotos.length} fotos estancadas en segundo plano...`);

      const fotosRestantes = [];

      // 2. Procesamos cada foto de la cola
      for (let item of colaFotos) {
        try {
          // Creamos una ruta única en Storage
          const rutaStorage = `checklists_evidencias/sync_offline_${item.idTarea}_${Date.now()}.jpg`;
          const storageRef = ref(this.storage, rutaStorage);

          // 3. Subimos el Base64 a Firebase Storage
          await uploadString(storageRef, item.base64, 'data_url');
          const urlDescarga = await getDownloadURL(storageRef);

          // 4. Enlazamos la URL generada al documento de la tarea en Firestore
          const docRef = doc(this.firestore, 'checklists', item.idTarea);
          
          const updateData: any = {};
          // Usamos notación de puntos para actualizar un ítem específico del array
          updateData[`items.${item.indexItem}.${item.tipoFoto}`] = urlDescarga;
          // Apagamos la alerta visual de "Pendiente por Sincronizar"
          updateData[`items.${item.indexItem}.pendienteDeSync`] = false;

          await updateDoc(docRef, updateData);
          console.log(`📸 Foto subida y enlazada con éxito: Tarea ${item.idTarea}`);

        } catch (error) {
          console.error('❌ Falló una foto por intermitencia, se intentará luego:', error);
          // Si el internet parpadeó y falló esta foto en particular, la regresamos a la cola
          fotosRestantes.push(item);
        }
      }

      // 5. Actualizamos la bóveda (si todo salió bien, quedará vacía)
      await localforage.setItem('md_fotos_offline', fotosRestantes);

    } catch (error) {
      console.error('Error general en el Sync Manager:', error);
    }
  }
}