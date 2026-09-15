import { inject } from '@angular/core';
import { Routes, Router } from '@angular/router';

import { homeGuard } from './services/home.guard';
import { authGuard } from './services/auth.guard';
import { tabControlGuard, primeraTabControlGuard, estructuraGuard, usuariosGuard } from './services/control.guards';
import { soloTecGuard } from './services/tec.guard';
import { promocionesGuard } from './services/promociones.guard';
import { pagosGuard } from './services/pagos.guard';
import { ticketsGuard } from './services/tickets.guard';
import { ventaPromosGuard } from './services/venta-promos.guard';
import { AgendaComponent } from './agenda/agenda';

/**
 * Redirección de una ruta vieja de tareas a `/tareas` con su chip puesto.
 *
 * Devuelve un `UrlTree` y no una cadena porque `redirectTo: 'tareas?ver=manual'`
 * NO funciona: el redirect de cadena es una RUTA, no una URL, y el query param
 * se pierde en silencio — el enlace viejo aterrizaría en «Todas» sin un solo
 * error que lo delatara.
 *
 * La función corre en contexto de inyección, así que `inject(Router)` es válido
 * aquí dentro y no fuera.
 */
const aTareas = (ver: 'manual' | 'libres') => () =>
  inject(Router).createUrlTree(['/tareas'], { queryParams: { ver } });

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
    // `homeGuard` manda a su trabajo a quien no tenga tablero que ver. Sin el,
    // una colaboradora aterrizaba aqui y veia el titulo y NADA MAS: los tres
    // bloques que quedan en la plantilla estan gateados a admin o supervisor.
    canActivate: [authGuard, homeGuard],
    loadComponent: () => import('./modules/dashboard/home/home').then(m => m.HomeComponent)
  },
  {
    // ✅ TAREAS — UNA SOLA LISTA (14/sep/2026).
    //
    // Hasta hoy esto eran DOS rutas y DOS entradas de menú con el MISMO
    // componente, separadas por `data.modoManual`: `/tareas-manual` pintaba lo
    // que entrega el robot y `/checklist` lo que se asigna a mano. Instrucción
    // de David: «quiero que queden unidas […] solo que esté todo ahí».
    //
    // El origen pasó a ser un chip dentro de la pantalla. Ya no hay `data`: lo
    // que antes decidía la ruta ahora lo decide `filtroOrigen`, y el candado de
    // «el manual no se edita» nunca estuvo aquí — está por tarjeta, en
    // `esTareaDeManual`.
    path: 'tareas',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/dashboard/checklist/checklist').then(m => m.ChecklistComponent)
  },

  // ── LAS DOS RUTAS VIEJAS, VIVAS Y APUNTANDO A SU MITAD ──────────────────
  //
  // No se borran (§2: hay enlaces de hace meses en WhatsApp). Y no redirigen a
  // «Todas» a secas: llevan su `?ver=`, así que quien abre un enlace viejo ve
  // LA MISMA MITAD que veía cuando se lo mandaron. Con un `redirectTo` de
  // cadena eso no se puede —un redirect de cadena no lleva query params—, por
  // eso son funciones.
  //
  // `pathMatch: 'full'` es obligatorio: sin él el redirect también se dispara
  // para cualquier cosa que empiece igual.
  { path: 'checklist',     pathMatch: 'full', redirectTo: aTareas('libres') },
  { path: 'tareas-manual', pathMatch: 'full', redirectTo: aTareas('manual') },
  { 
    path: 'checkstore',
    redirectTo: 'control/sucursales',
    pathMatch: 'full'
  },
  // 🏆 RANKING SEMANAL DE SUCURSALES
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
    // El menu NO es un permiso: hasta el 13/sep esta ruta solo pedia authGuard,
    // asi que cualquiera con sesion entraba escribiendo la URL — y aqui se da de
    // alta gente y se reparten permisos.
    canActivate: [authGuard, usuariosGuard],
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
      {
        path: 'ranking',
        canActivate: [tabControlGuard],
        loadComponent: () => import('./modules/dashboard/ranking-sucursales/ranking-sucursales').then(m => m.RankingSucursalesComponent)
      },
      {
        path: 'productividad',
        canActivate: [tabControlGuard],
        loadComponent: () => import('./modules/dashboard/productividad/productividad').then(m => m.ProductividadComponent)
      },
      {
        path: 'sucursales',
        canActivate: [tabControlGuard],
        loadComponent: () => import('./modules/dashboard/checkstore/checkstore').then(m => m.CheckstoreComponent)
      },
      // Vivieron aqui unas horas el 13/sep y se mudaron a ruta propia. NO se
      // borran: quien haya compartido el enlace por WhatsApp aterriza igual.
      { path: 'plantilla',  redirectTo: '/plantilla',  pathMatch: 'full' },
      { path: 'pase-lista', redirectTo: '/pase-lista', pathMatch: 'full' },
    ]
  },

  // La ruta vieja NO se borra: aterriza en SU pestaña. Va en el mismo cambio en
  // que estadisticas.html perdio su marco — si siguiera sirviendo el componente,
  // esa URL mostraria una pantalla sin sidebar.
  { path: 'estadisticas', redirectTo: 'control/estadisticas', pathMatch: 'full' },
  { path: 'ranking-sucursales', redirectTo: 'control/ranking', pathMatch: 'full' },
  // 📈 PRODUCTIVIDAD CONTRA EL TURNO (lo hecho cruzado con el horario de RH):
  // es la entrada de menu numero 20, la deuda que la §7 registro el 31/ago. La
  // absorbe esta fusion: deja de ser entrada y pasa a ser pestaña de Control.
  { path: 'productividad', redirectTo: 'control/productividad', pathMatch: 'full' },

  // 🧩 ESTRUCTURA DE LA SUCURSAL — la plantilla (cuantas plazas debe haber) y
  // el pase de lista (quien ocupa cada una hoy).
  //
  // Entraron como pestañas de /control y salieron de ahi el mismo dia: esa
  // pantalla agrupa ANALISIS, y estas dos son una DEFINICION y una operacion
  // diaria. `estructuraGuard` conserva EXACTAMENTE el permiso que tenian como
  // pestaña (esJefatura), para que el cambio sea de sitio y no de audiencia.
  {
    path: 'plantilla',
    canActivate: [authGuard, estructuraGuard],
    loadComponent: () => import('./modules/dashboard/plantilla/plantilla').then(m => m.PlantillaComponent)
  },
  {
    path: 'pase-lista',
    canActivate: [authGuard, estructuraGuard],
    loadComponent: () => import('./modules/dashboard/pase-lista/pase-lista').then(m => m.PaseListaComponent)
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