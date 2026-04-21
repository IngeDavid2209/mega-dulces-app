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
  
  private firestore = inject(Firestore);

  ngOnInit() {
    // 🔥 FUNCIÓN DEL LATIDO (SEPARADA PARA PODER LLAMARLA AL INSTANTE) 🔥
    const enviarLatido = () => {
      const sesion = localStorage.getItem('md_sesion_actual');
      if (sesion) {
        const currentUser = JSON.parse(sesion);
        // Buscamos el ID del usuario
        const docId = currentUser.idFirestore || currentUser.uid || currentUser.usuario;
        
        if (docId) {
          const userRef = doc(this.firestore, 'usuarios', docId);
          // Enviamos la hora exacta
          setDoc(userRef, { ultimoLatido: Date.now() }, { merge: true })
            .catch(e => console.log('Sin red para latido'));
        }
      }
    };

    // 1. Mandamos el primer latido INMEDIATAMENTE al abrir la app
    enviarLatido();

    // 2. Dejamos el motor encendido para que lata cada 60 segundos
    setInterval(enviarLatido, 60000);
  }
}