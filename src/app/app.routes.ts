import { Routes } from '@angular/router';

// 🔥 IMPORTAMOS AL GUARDIA DE SEGURIDAD 🔥
// (Asegúrate de que la ruta coincida con la carpeta donde guardaste auth.guard.ts)
import { authGuard } from './services/auth.guard'; 

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  
  // El Login es público, cualquiera puede verlo
  { 
    path: 'login', 
    loadComponent: () => import('./components/login/login').then(m => m.LoginComponent) 
  },
  
  // 🔥 A PARTIR DE AQUÍ, TODAS LAS RUTAS TIENEN EL CANDADO "canActivate" 🔥
  { 
    path: 'home', 
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/home/home').then(m => m.HomeComponent) 
  },
  { 
    path: 'checklist', 
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/checklist/checklist').then(m => m.ChecklistComponent) 
  },
  { 
    path: 'checkstore', 
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/checkstore/checkstore').then(m => m.CheckstoreComponent) 
  },
  { 
    path: 'estadisticas', 
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/estadisticas/estadisticas').then(m => m.EstadisticasComponent) 
  },
  { 
    path: 'reportes', 
    canActivate: [authGuard],
    loadComponent: () => import('./reportes/reportes').then(m => m.ReportesComponent) 
  },
  { 
    path: 'personal', 
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/personal/personal').then(m => m.PersonalComponent) 
  },
  
  // 🔥 NUEVA RUTA: PANEL DE ÁREAS OPERATIVAS 🔥
  { 
    path: 'areas', 
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/areas/areas').then(m => m.AreasComponent) 
  },
  
  // Cualquier ruta que no exista o intente saltarse el sistema, al login
  { path: '**', redirectTo: 'login' }
];