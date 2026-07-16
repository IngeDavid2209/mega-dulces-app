import { Routes } from '@angular/router';

import { CalendarioComponent } from './modules/dashboard/calendario/calendario';
import { authGuard } from './services/auth.guard';
import { soloTecGuard } from './services/tec.guard';
import { flotillaGuard } from './services/flotilla.guard';
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
  // 🏆 RANKING SEMANAL DE SUCURSALES
  {
    path: 'ranking-sucursales',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/ranking-sucursales/ranking-sucursales').then(m => m.RankingSucursalesComponent)
  },
  // 📄 CIERRE MENSUAL DE OPERACIONES (PDF con fotos por sucursal)
  {
    path: 'cierre-mensual',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/cierre-mensual/cierre-mensual').then(m => m.CierreMensualComponent)
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

  // 📋 CATÁLOGO DE RUTINAS MAESTRAS (Fase 1 de la refactorización)
  {
    path: 'rutinas',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/rutinas-catalogo/rutinas-catalogo').then(m => m.RutinasCatalogoComponent)
  },

  // 📌 ASIGNACIÓN DE RUTINAS (Fase 2)
  {
    path: 'asignaciones-rutinas',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/asignaciones-rutinas/asignaciones-rutinas').then(m => m.AsignacionesRutinasComponent)
  },

  // 📅 PROGRAMACIÓN DE RUTINAS (Fase 3) — vista previa de próximos días
  {
    path: 'programacion-rutinas',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/programacion-rutinas/programacion-rutinas').then(m => m.ProgramacionRutinasComponent)
  },

  // 🚚 MIGRACIÓN DEL SISTEMA LEGACY (Fase 5) — solo admin global
  {
    path: 'migracion-rutinas',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/migracion-rutinas/migracion-rutinas').then(m => m.MigracionRutinasComponent)
  },

  // 📤 TAREAS QUE EL ADMIN HA ASIGNADO A OTROS
  {
    path: 'tareas-asignadas',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/tareas-asignadas/tareas-asignadas').then(m => m.TareasAsignadasComponent)
  },

  // 🕐 TURNOS DE CANINDO (manana/tarde) — solo admins de Canindo
  {
    path: 'turnos',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/turnos/turnos').then(m => m.TurnosComponent)
  },

  // 🔥 NUEVA RUTA: PERFIL DEL USUARIO 🔥
  {
    path: 'perfil',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/perfil/perfil').then(m => m.PerfilComponent)
  },

  // 🎓 ESPACIO TEC DE MONTERREY — apartado aislado para el grupo de estudiantes
  {
    path: 'tec',
    canActivate: [soloTecGuard],
    loadComponent: () => import('./espacio-tec/espacio-tec').then(m => m.EspacioTecComponent)
  },

  // 🚗 FLOTILLA — reservas/itinerario de los vehiculos de la empresa (gateado por grupoFlotilla)
  {
    path: 'flotilla',
    canActivate: [flotillaGuard],
    loadComponent: () => import('./modules/dashboard/flotilla/flotilla').then(m => m.FlotillaComponent)
  },

  
  
  // Cualquier ruta que no exista o intente saltarse el sistema, al login
  { path: '**', redirectTo: 'login' }
];