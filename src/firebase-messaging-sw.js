// Service Worker de Firebase Cloud Messaging.
//
// Se sirve desde la raíz del sitio (lo registra el navegador automáticamente
// cuando se inicializa FCM en el cliente). Recibe pushes en background y le
// avisa al cliente principal para que active la actualización del Service Worker
// de Angular y recargue la app.
//
// IMPORTANTE: este archivo se sirve "tal cual" — no puede importar módulos ES.
// Usa los scripts COMPAT de Firebase desde el CDN.

/* global importScripts, firebase, self */
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAoVz9oTcSQrgvUeqBTTDLYEilEkRFvsug',
  authDomain: 'mega-dulces-96c57.firebaseapp.com',
  projectId: 'mega-dulces-96c57',
  storageBucket: 'mega-dulces-96c57.firebasestorage.app',
  messagingSenderId: '959280999203',
  appId: '1:959280999203:web:52ad3f6c263d3858e47a96'
});

const messaging = firebase.messaging();

// 📡 Llega un push (silencioso) → avisamos a TODAS las pestañas abiertas para
// que ejecuten checkForUpdate del Service Worker de Angular y recarguen.
messaging.onBackgroundMessage((payload) => {
  const tipo = payload?.data?.tipo;
  // Empujamos el evento al cliente principal vía postMessage.
  self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientes) => {
      for (const c of clientes) {
        try { c.postMessage({ source: 'fcm', tipo, payload }); } catch (_) {}
      }
    });
  // Push silencioso: NO mostramos notificación visible.
});
