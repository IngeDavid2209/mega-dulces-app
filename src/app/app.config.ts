import { ApplicationConfig, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

// 🔥 IMPORTACIONES DE FIREBASE ACTUALIZADAS 🔥
import { initializeApp, provideFirebaseApp, getApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import {
  provideFirestore, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED
} from '@angular/fire/firestore';
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
    //
    // Persistencia IndexedDB con:
    //  - persistentMultipleTabManager: funciona aunque el usuario abra
    //    la app en varias pestañas (antes solo 1 pestaña tenía cache offline).
    //  - CACHE_SIZE_UNLIMITED: sin tope de tamaño en cache (el navegador igual
    //    pone su propio límite). Útil porque cargan muchos checklists históricos.
    //
    // Cuando hay conexión: lee/escribe normal contra el server y actualiza cache.
    // Cuando no hay conexión: lee del cache local; las escrituras se encolan en
    // IndexedDB y se mandan al server al reconectar (Firestore lo hace solo).
    // Las fotos a Cloudinary NO entran aquí — esas tienen su propia cola en
    // localforage ('md_fotos_offline'), que ya está implementada.
    // ====================================================================
    provideFirestore(() => {
      const app = getApp();
      return initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
          cacheSizeBytes: CACHE_SIZE_UNLIMITED
        })
      });
    }),
    // ====================================================================

    provideStorage(() => getStorage()),
    provideMessaging(() => getMessaging()), // Notificaciones activadas
    
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes), 
    
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      // 🚀 Antes esperaba 30s a que la app "se estabilizara" para registrar el SW.
      // Ahora registra al instante: detecta y aplica actualizaciones MÁS rápido,
      // sobre todo en la PWA instalada de la pantalla de inicio.
      registrationStrategy: 'registerImmediately'
    }),
  ]
};