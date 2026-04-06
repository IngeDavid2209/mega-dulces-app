import { Injectable, inject } from '@angular/core';
import { Messaging, getToken, onMessage } from '@angular/fire/messaging';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root'
})
export class NotificacionesService {
  private messaging = inject(Messaging);
  private firestore = inject(Firestore);

  async solicitarPermisos(usuarioNombre: string) {
    try {
      // 1. Pedimos permiso al usuario ("Desea permitir notificaciones?")
      const permission = await Notification.requestPermission();
      
      if (permission === 'granted') {
        // 🔥 AQUÍ VAS A PEGAR TU VAPID KEY EN EL SIGUIENTE PASO 🔥
        const token = await getToken(this.messaging, {
          vapidKey: 'BItRm5eYik-A2jdD0iS3nukAh41n47mYwdpfw9L_IRFUZ2L6OSEDNAo_XiYIimZFXT3Bn6-QJ4BYZoimvjIKigY' 
        });

        if (token) {
          // Guardamos la llave del celular del usuario en Firebase
          await setDoc(doc(this.firestore, 'usuarios_tokens', usuarioNombre), {
            token: token,
            actualizado: Date.now()
          }, { merge: true });
          console.log('Token guardado exitosamente.');
        }
      }
    } catch (error) {
      console.error('Error al configurar notificaciones:', error);
    }
  }
}