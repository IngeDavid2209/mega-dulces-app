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

// 📡 Llega un push en background.
//   - tipo 'actualizacion' → push SILENCIOSO: solo avisamos a las pestañas para
//     que apliquen la versión nueva (no se muestra notificación).
//   - cualquier otro (ej. 'aviso') → notificación VISIBLE (nueva tarea, mensaje…).
messaging.onBackgroundMessage((payload) => {
  const data = (payload && payload.data) || {};
  const tipo = data.tipo;

  // Siempre avisamos a las pestañas abiertas (el cliente decide qué hacer).
  self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientes) => {
      for (const c of clientes) {
        try { c.postMessage({ source: 'fcm', tipo, payload }); } catch (_) {}
      }
    });

  // Push silencioso de versión: no mostramos nada visible.
  if (tipo === 'actualizacion') return;

  // Aviso visible: mostramos la notificación.
  const titulo = data.title || 'Mega Dulces';
  const opciones = {
    body: data.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined
  };
  return self.registration.showNotification(titulo, opciones);
});

// 👆 Al tocar la notificación: enfocar una pestaña abierta o abrir la app en la
// ruta indicada.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientes) => {
      for (const c of clientes) {
        if ('focus' in c) {
          try { c.navigate(destino); } catch (_) {}
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(destino);
      return undefined;
    })
  );
});
