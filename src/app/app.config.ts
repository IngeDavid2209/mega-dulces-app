import { ApplicationConfig, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

// 🔥 IMPORTACIONES DE FIREBASE ACTUALIZADAS 🔥
import { initializeApp, provideFirebaseApp, getApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore, initializeFirestore, persistentLocalCache } from '@angular/fire/firestore';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { getMessaging, provideMessaging } from '@angular/fire/messaging';
import { provideServiceWorker } from '@angular/service-worker';

export const firebaseConfig = {
  apiKey: "AIzaSyAoVz9oTcSQrgvUeqBTTDLYEilEkRFvsug",
  authDomain: "mega-dulces-96c57.firebaseapp.com",
  projectId: "mega-dulces-96c57",
  storageBucket: "mega-dulces-96c57.firebasestorage.app",
  messagingSenderId: "959280999203",
  appId: "1:959280999203:web:52ad3f6c263d3858e47a96"
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideFirebaseApp(() => initializeApp(firebaseConfig)),
    provideAuth(() => getAuth()),
    
    // ====================================================================
    // 🔥 BASE DE DATOS BLINDADA (MODO OFFLINE ACTIVADO) 🔥
    // ====================================================================
    provideFirestore(() => {
      const app = getApp();
      // Inicializamos Firestore con la Bóveda Local Persistente encendida
      return initializeFirestore(app, {
        localCache: persistentLocalCache() 
      });
    }),
    // ====================================================================

    provideStorage(() => getStorage()),
    provideMessaging(() => getMessaging()), // Notificaciones activadas
    
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes), 
    
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    }),
  ]
};