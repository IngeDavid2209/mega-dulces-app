import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router'; 
import { Firestore, doc, setDoc } from '@angular/fire/firestore';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit {
  title = 'mega-dulces-app';
  
  // 1. Inyectamos Firebase al archivo raíz
  private firestore = inject(Firestore);

  ngOnInit() {
    // 🔥 EL CORAZÓN DEL SISTEMA (LATIDO GLOBAL) 🔥
    setInterval(() => {
      const sesion = localStorage.getItem('md_sesion_actual');
      if (sesion) {
        const currentUser = JSON.parse(sesion);
        // Buscamos el ID correcto del usuario
        const docId = currentUser.idFirestore || currentUser.uid || currentUser.usuario;
        
        if (docId) {
          const userRef = doc(this.firestore, 'usuarios', docId);
          // Actualizamos su última conexión sin borrar sus demás datos (merge: true)
          setDoc(userRef, { ultimoLatido: Date.now() }, { merge: true })
            .catch(e => console.log('Sin red para latido'));
        }
      }
    }, 60000); // 👈 El sistema envía una señal cada 60 segundos (1 minuto)
  }
}