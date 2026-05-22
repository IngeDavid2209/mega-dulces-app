import { Routes } from '@angular/router';

import { CalendarioComponent } from './modules/dashboard/calendario/calendario';
import { authGuard } from './services/auth.guard'; 
import { AgendaComponent } from './agenda/agenda';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'calendario', component: CalendarioComponent },
  { path: 'agenda', component: AgendaComponent },
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
  
  // 🔥 PANEL DE ÁREAS OPERATIVAS 🔥
  {
    path: 'areas',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/areas/areas').then(m => m.AreasComponent)
  },

  // 📅 DÍAS DE DESCANSO SEMANALES
  {
    path: 'descansos',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/descansos/descansos').then(m => m.DescansosComponent)
  },
  
  // 🔥 NUEVA RUTA: PERFIL DEL USUARIO 🔥
  {
    path: 'perfil',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/perfil/perfil').then(m => m.PerfilComponent)
  },

  
  
  // Cualquier ruta que no exista o intente saltarse el sistema, al login
  { path: '**', redirectTo: 'login' }
];