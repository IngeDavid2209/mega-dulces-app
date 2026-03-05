import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login';
import { HomeComponent } from './modules/dashboard/home/home';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'home', component: HomeComponent },
  
  // 🔥 Las sacamos del "children" para que sean rutas directas y funcionen tus botones
  { 
    path: 'checklist', 
    loadComponent: () => import('./modules/dashboard/checklist/checklist').then(m => m.ChecklistComponent) 
  },
  { 
    path: 'checkstore', 
    loadComponent: () => import('./modules/dashboard/checkstore/checkstore').then(m => m.CheckstoreComponent) 
  },
  { 
    path: 'estadisticas', 
    loadComponent: () => import('./modules/dashboard/estadisticas/estadisticas').then(m => m.EstadisticasComponent) 
  },

  // Agrégala debajo de tus otras rutas
  { 
    path: 'personal', 
    loadComponent: () => import('./modules/dashboard/personal/personal').then(m => m.PersonalComponent) 
  },
  
  // Cualquier ruta que no exista o esté mal escrita, te manda al login
  { path: '**', redirectTo: 'login' }
];