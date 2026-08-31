import { Routes } from '@angular/router';

import { authGuard } from './services/auth.guard';
import { tabControlGuard, primeraTabControlGuard } from './services/control.guards';
import { soloTecGuard } from './services/tec.guard';
import { promocionesGuard } from './services/promociones.guard';
import { pagosGuard } from './services/pagos.guard';
import { ticketsGuard } from './services/tickets.guard';
import { ventaPromosGuard } from './services/venta-promos.guard';
import { AgendaComponent } from './agenda/agenda';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
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
    // ✏️ TAREAS FUERA DEL MANUAL — lo que se asigna a mano: tareas únicas, de
    // equipo, del día. Aquí sí se crea, se edita y se borra.
    path: 'checklist',
    canActivate: [authGuard],
    data: { modoManual: false },
    loadComponent: () => import('./modules/dashboard/checklist/checklist').then(m => m.ChecklistComponent)
  },

  // 📕 TAREAS DEL MANUAL — los checklists del Manual Corporativo que entrega el
  // robot según el puesto de cada persona. Mismo componente que /checklist: la
  // única diferencia es `modoManual`, que decide qué mitad de la lista se pinta
  // y esconde todo lo de crear. Toda la maquinaria de cumplir una tarea
  // (evidencia, fotos, envío, offline) es la misma y no se duplica.
  {
    path: 'tareas-manual',
    canActivate: [authGuard],
    data: { modoManual: true },
    loadComponent: () => import('./modules/dashboard/checklist/checklist').then(m => m.ChecklistComponent)
  },
  { 
    path: 'checkstore', 
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/checkstore/checkstore').then(m => m.CheckstoreComponent) 
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

  // 📅 DÍAS DE DESCANSO SEMANALES
  {
    path: 'descansos',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/descansos/descansos').then(m => m.DescansosComponent)
  },

  // 🎛️ CONTROL OPERATIVO · el cascaron de las pantallas de analisis.
  //
  // La pestaña va en la URL como ruta HIJA, no como ?tab=. Eso da tres cosas: el
  // redirectTo de cada ruta vieja aterriza en SU pestaña y no en la de por
  // defecto (hay enlaces viejos en WhatsApp), el boton atras del navegador
  // funciona entre pestañas, y el guard por pestaña sale de la propia ruta —que
  // es lo que impide que entrar al cascaron regale acceso a las demas.
  {
    path: 'control',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/control/control').then(m => m.ControlComponent),
    children: [
      // Sin pestaña: se manda a la primera que este usuario pueda abrir. No es
      // un redirectTo fijo porque la pestaña por defecto depende del permiso.
      { path: '', canActivate: [primeraTabControlGuard], children: [] },
      {
        path: 'estadisticas',
        canActivate: [tabControlGuard],
        loadComponent: () => import('./modules/dashboard/estadisticas/estadisticas').then(m => m.EstadisticasComponent)
      },
    ]
  },

  // La ruta vieja NO se borra: aterriza en SU pestaña. Va en el mismo cambio en
  // que estadisticas.html perdio su marco — si siguiera sirviendo el componente,
  // esa URL mostraria una pantalla sin sidebar.
  { path: 'estadisticas', redirectTo: 'control/estadisticas', pathMatch: 'full' },

  // 📈 PRODUCTIVIDAD CONTRA EL TURNO: lo hecho cruzado con el horario que RH
  // captura en Mega Talento.
  {
    path: 'productividad',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/productividad/productividad').then(m => m.ProductividadComponent)
  },

  // 📕 MANUAL POR PUESTO — reemplaza al sistema de Rutinas (Catálogo,
  // Asignación, Programación y Migración). Ya no se captura qué se hace ni a
  // quién se le asigna: el puesto del organigrama decide, y las tareas salen
  // del Manual Corporativo de Operación. Pantalla de solo consulta.
  {
    path: 'manual-puestos',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/manual-puestos/manual-puestos').then(m => m.ManualPuestosComponent)
  },

  // Las rutas del modelo retirado (/rutinas, /asignaciones-rutinas,
  // /programacion-rutinas, /migracion-rutinas) se van a la pantalla nueva.
  // Se mantienen como redirección, no se borran a secas: hay gente con esos
  // enlaces guardados en el navegador y en mensajes de WhatsApp, y un "**"
  // que los tira al login se lee como que la app se rompió.
  { path: 'rutinas',                redirectTo: 'manual-puestos', pathMatch: 'full' },
  { path: 'asignaciones-rutinas',   redirectTo: 'manual-puestos', pathMatch: 'full' },
  { path: 'programacion-rutinas',   redirectTo: 'manual-puestos', pathMatch: 'full' },
  { path: 'migracion-rutinas',      redirectTo: 'manual-puestos', pathMatch: 'full' },

  // 📤 TAREAS QUE EL ADMIN HA ASIGNADO A OTROS
  {
    path: 'tareas-asignadas',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/tareas-asignadas/tareas-asignadas').then(m => m.TareasAsignadasComponent)
  },

  // 🕐 TURNOS DE CANINDO (manana/tarde) — solo admins de Canindo

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

  // 🏷️ ACTIVACIÓN DE PROMOCIONES — visible solo para quien tenga grupoPromociones
  {
    path: 'promociones',
    canActivate: [promocionesGuard],
    loadComponent: () => import('./modules/dashboard/promociones/promociones').then(m => m.PromocionesComponent)
  },

  // 🟢 VENTA DE PROMOS — el piso de venta en vivo. Tres oficios en una sección:
  // la caja da luz verde, el vendedor crea las promos, el monitor las vigila.
  // Cada uno con su permiso propio (ventaPromosCaja/Vendedor/Monitor).
  {
    path: 'venta-promos',
    canActivate: [ventaPromosGuard],
    loadComponent: () => import('./modules/dashboard/venta-promos/venta-promos').then(m => m.VentaPromosComponent)
  },

  // 🧱 BLOQUES DE TRABAJO — el día partido en tramos de horario, con sus tareas.

  // 🎫 TICKETS — vale de servicio operativo: solicitudes de servicio entre áreas,
  // con su folio, el detalle de lo realizado y las firmas del formato.
  {
    path: 'tickets',
    canActivate: [ticketsGuard],
    loadComponent: () => import('./modules/dashboard/tickets/tickets').then(m => m.TicketsComponent)
  },

  // 🧾 PAGOS DE SERVICIOS — luz, agua, internet y demás recibos por sucursal.
  // Los recordatorios y la captura del comprobante van por WhatsApp.
  {
    path: 'pagos',
    canActivate: [pagosGuard],
    loadComponent: () => import('./modules/dashboard/pagos-servicios/pagos-servicios').then(m => m.PagosServiciosComponent)
  },

  
  
  // ══════════════════════════════════════════════════════════════════════════
  //  APARTADOS RETIRADOS DEL MENÚ (2026-08-28)
  //
  //  Se quitaron del sidebar y aquí se les cierra la puerta: quien tenga el
  //  enlace guardado en el navegador o en un WhatsApp cae en el Dashboard en
  //  vez de entrar. NO se borró su código ni sus datos — volver a abrir
  //  cualquiera es quitar su línea de aquí y devolver su bloque de ruta.
  //
  //  Dos consecuencias que quedan asumidas a propósito:
  //    · /turnos era el único editor de la config de turnos de Canindo, que el
  //      robot del manual sigue leyendo para no entregar tareas fuera de turno.
  //      La config sigue vigente tal como quedó; ya nadie la puede cambiar.
  //    · /areas era el único editor de `areas_operativas`, catálogo que el
  //      Dashboard sigue leyendo. Queda sin pantalla de edición.
  // ══════════════════════════════════════════════════════════════════════════
  { path: 'bloques',    redirectTo: 'home', pathMatch: 'full' },
  { path: 'flotilla',   redirectTo: 'home', pathMatch: 'full' },
  { path: 'turnos',     redirectTo: 'home', pathMatch: 'full' },
  { path: 'calendario', redirectTo: 'home', pathMatch: 'full' },
  { path: 'areas',      redirectTo: 'home', pathMatch: 'full' },

  // Cualquier ruta que no exista o intente saltarse el sistema, al login
  { path: '**', redirectTo: 'login' }
];