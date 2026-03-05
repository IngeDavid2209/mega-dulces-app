import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getStorage, provideStorage } from '@angular/fire/storage';

const firebaseConfig = {
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
    provideFirestore(() => getFirestore()),
    provideStorage(() => getStorage()),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
  ]
};
