importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

// 🔥 TUS CREDENCIALES EXACTAS 🔥
firebase.initializeApp({
  apiKey: "AIzaSyAoVz9oTcSQrgvUeqBTTDLYEilEkRFvsug",
  authDomain: "mega-dulces-96c57.firebaseapp.com",
  projectId: "mega-dulces-96c57",
  storageBucket: "mega-dulces-96c57.firebasestorage.app",
  messagingSenderId: "959280999203",
  appId: "1:959280999203:web:52ad3f6c263d3858e47a96"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('Notificación recibida con la app cerrada:', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/favicon.ico' // Usa el icono por defecto de Angular por ahora
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});