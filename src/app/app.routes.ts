import { Routes } from '@angular/router';

// 🔥 ELIMINAMOS LAS IMPORTACIONES ESTÁTICAS DE ARRIBA 🔥
// (Ya no hacemos import { LoginComponent } ni import { HomeComponent })

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  
  // 🔥 AHORA SÍ, LOGIN Y HOME CON CARGA PEREZOSA (LAZY LOADING) 🔥
  { 
    path: 'login', 
    loadComponent: () => import('./components/login/login').then(m => m.LoginComponent) 
  },
  { 
    path: 'home', 
    loadComponent: () => import('./modules/dashboard/home/home').then(m => m.HomeComponent) 
  },
  
  // 🔥 Las demás ya las tenías perfectas (¡Excelente visión!) 🔥
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
  { 
    path: 'reportes', 
    loadComponent: () => import('./reportes/reportes').then(m => m.ReportesComponent) 
  },
  { 
    path: 'personal', 
    loadComponent: () => import('./modules/dashboard/personal/personal').then(m => m.PersonalComponent) 
  },
  
  // Cualquier ruta que no exista o esté mal escrita, te manda al login
  { path: '**', redirectTo: 'login' }
];