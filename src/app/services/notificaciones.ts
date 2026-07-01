import { Injectable, inject } from '@angular/core';
import { Messaging, getToken, onMessage } from '@angular/fire/messaging';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { getAuth } from '@angular/fire/auth';

/**
 * Servicio de Firebase Cloud Messaging (FCM) — Push notifications a la PWA.
 *
 * Se usa para empujar "actualización disponible" a todos los dispositivos
 * (incluso a la PWA instalada en la pantalla de inicio). El servidor envía
 * un push silencioso → el Service Worker se despierta y le avisa al cliente
 * principal, que entonces fuerza la activación de la versión nueva (SwUpdate).
 *
 * VAPID public key (es público — no es secreto): se genera en
 * Firebase Console → Project settings → Cloud Messaging → Web Push certificates.
 */
const VAPID_PUBLIC_KEY = 'BltRm5eYik-A2jdDOiS3nukAh41n47mYwdpfw9L_IRFUZ2L6OSEDNAo_XiYIimZFXT3Bn6-QJ4BYZoimvjlKigY';

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private messaging = inject(Messaging);
  private firestore = inject(Firestore);

  /**
   * Pide permiso de notificaciones, obtiene el token FCM y lo guarda en
   * `usuarios_tokens/{uidOrNombre}`. Idempotente: se puede llamar en cada login.
   */
  async solicitarPermisos(usuarioNombre: string, uid?: string): Promise<string | null> {
    if (!('Notification' in window)) return null;
    if (!usuarioNombre) return null;

    try {
      // 1. Si el navegador no soporta SW, no hay nada que hacer.
      if (!('serviceWorker' in navigator)) return null;

      // 2. Pedimos permiso.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.log('[FCM] usuario no concedió permiso de notificaciones.');
        return null;
      }

      // 3. Registramos el SW de FCM (vive en /firebase-messaging-sw.js).
      //    Si ya está registrado, getRegistration devuelve el existente.
      let swReg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
      if (!swReg) {
        swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      }

      // 4. Obtenemos el token FCM con la VAPID.
      const token = await getToken(this.messaging, {
        vapidKey: VAPID_PUBLIC_KEY,
        serviceWorkerRegistration: swReg
      });
      if (!token) {
        console.warn('[FCM] no se obtuvo token (puede ser permiso denegado o problema con la VAPID).');
        return null;
      }

      // 5. Guardamos el token. Lo indexamos por uid si lo hay (estable),
      //    si no, por nombre (compatibilidad con el modelo viejo).
      const docId = uid || usuarioNombre;
      await setDoc(doc(this.firestore, 'usuarios_tokens', docId), {
        token,
        usuario: usuarioNombre,
        uid: uid || null,
        actualizado: Date.now(),
        userAgent: navigator.userAgent
      }, { merge: true });

      // 6. Cuando llega un push y la app está EN PRIMER PLANO, onMessage dispara aquí.
      //    (Si está en background, lo maneja firebase-messaging-sw.js.)
      onMessage(this.messaging, (payload) => {
        window.dispatchEvent(new CustomEvent('fcm-message', { detail: payload }));
      });

      return token;
    } catch (error) {
      console.error('[FCM] error al configurar notificaciones:', error);
      return null;
    }
  }

  /**
   * Envía una notificación PUSH VISIBLE a otros usuarios (nueva tarea, mensaje…).
   * Llama al endpoint /api/notificar con el ID Token del usuario actual.
   * Es "fire-and-forget": si falla (sin red, sin permiso del server), no rompe
   * el flujo principal — solo no llega el aviso.
   *
   *  destinatarios:
   *    - uids?:    lista de uids
   *    - nombres?: lista de nombres (compatibilidad con tokens viejos)
   *    - grupoTec?: true → además, todos los del grupo TEC
   */
  async enviar(opts: {
    titulo: string;
    cuerpo: string;
    url?: string;
    uids?: string[];
    nombres?: string[];
    grupoTec?: boolean;
  }): Promise<void> {
    try {
      const user = getAuth().currentUser;
      if (!user) return;
      const idToken = await user.getIdToken();
      await fetch('/api/notificar', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(opts)
      });
    } catch (e) {
      console.warn('[FCM] no se pudo enviar el aviso:', e);
    }
  }
}
