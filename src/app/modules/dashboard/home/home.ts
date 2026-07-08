
import {
  Component, signal, computed, OnInit, OnDestroy, AfterViewInit,
  inject, ViewChild, ElementRef, effect
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas, esSupervisor, mismoEmpleadoNombre } from '../../../shared/permisos.util';
import { nivelDeUsuario } from '../../../shared/nivel-jerarquico.util';
import { esItemHecho } from '../../../shared/item-completado.util';
import { UsuariosService } from '../../../shared/usuarios.service';
import { ApiService } from '../../../shared/api.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './home.html',
  styleUrls: ['./home.css']
})
export class HomeComponent implements OnInit, OnDestroy, AfterViewInit {
 
  // ------- Estado principal -------
  currentUser: any = null;
  isMenuOpen = false;
 
  checklists = signal<any[]>([]);
  areas      = signal<any[]>([]);
  usuarios   = signal<any[]>([]);
  horaActual = signal<Date>(new Date());

  // 🎯 Tabs: separa tareas propias del admin/supervisor de las del equipo.
  // Para trabajador puro siempre es 'mis' (ya no ve nada más).
  vistaTareas = signal<'mis' | 'equipo' | 'todas'>('todas');
 
  private router    = inject(Router);
  private usuariosSvc = inject(UsuariosService);
  private api = inject(ApiService);
  private destructoresRadares: (() => void)[] = [];
  private clockInterval: any = null;

  // Effect que toma la lista cruda del UsuariosService (listener compartido) y
  // aplica el filtro por sucursal/rol del usuario actual. Reemplaza al
  // onSnapshot duplicado que antes vivía en conectarConLaNube().
  private _usuariosEffect = effect(() => {
    const raw = this.usuariosSvc.usuarios();
    if (!raw) return;
    const sesion = (() => {
      try { return JSON.parse(localStorage.getItem('md_sesion_actual') || 'null'); }
      catch { return null; }
    })() || this.currentUser;
    const permitidas = sucursalesPermitidas(sesion);
    const esGlobal = esAdminGlobal(sesion);
    const supervisor = esSupervisor(sesion);
    let arr: any[] = raw.map((u: any) => ({ ...u, idFirestore: u.id || u.uid }));
    if ((!esGlobal && permitidas !== null) || supervisor) {
      arr = arr.filter(u => {
        if (u.rol === 'admin') return false;
        const susSuc: string[] = u.sucursales || (u.sucursal ? [u.sucursal] : []);
        return susSuc.some((s: string) => permitidas!.includes(s));
      });
    }
    this.usuarios.set(arr);
  });
 
  @ViewChild('trendChartCanvas') trendChartCanvas?: ElementRef<HTMLCanvasElement>;
  private trendChart: any = null;
 
  // ============================ COMPUTED SIGNALS ============================
 
  saludoDinamico = computed(() => {
    const h = this.horaActual().getHours();
    if (h < 12)  return 'Buenos días';
    if (h < 19)  return 'Buenas tardes';
    return 'Buenas noches';
  });
 
  fechaFormateada = computed(() => {
    const d = this.horaActual();
    return d.toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  });
 
  horaFormateada = computed(() =>
    this.horaActual().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  );
 
  private hoyISO(): string {
    const d = this.horaActual();
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
  }
 
  // ------- Métricas globales -------
  /** Para admin limitado: solo áreas que tengan al menos 1 empleado en sus sucursales. */
  areasVisibles = computed(() => {
    if (esAdminGlobal(this.currentUser)) return this.areas();
    const conPersonal = new Set<string>();
    for (const u of this.usuarios()) {
      if (u.areas && Array.isArray(u.areas)) {
        for (const a of u.areas) conPersonal.add(a);
      }
    }
    return this.areas().filter(a => conPersonal.has(a.nombre));
  });

  totalSucursales      = computed(() => this.areasVisibles().length);
  totalEmpleados       = computed(() => this.usuarios().filter(u => u.rol !== 'admin').length);
  totalMandos          = computed(() =>
    this.usuarios().filter(u => u.rol !== 'admin' && nivelDeUsuario(u) === 'mando').length
  );
  totalOperativos      = computed(() =>
    this.usuarios().filter(u => u.rol !== 'admin' && nivelDeUsuario(u) === 'operativo').length
  );
  totalChecklistsHoy   = computed(() => this.checklistsHoy().length);
 
  /** Todos los checklists de hoy (sin filtro de tabs). Base para contadores. */
  checklistsHoyTodos = computed(() =>
    this.checklists().filter(c => c.date === this.hoyISO())
  );

  /** ¿Puede el usuario alternar entre Mis/Equipo/Todas? Admins y supervisores sí. */
  puedeFiltrarVista = computed(() => {
    const u = this.currentUser;
    if (!u) return false;
    if (u.rol === 'admin') return true;
    return esSupervisor(u);
  });

  /** Contadores para los tabs (referencia siempre al universo sin filtrar).
   *  Match tolerante: el perfil puede tener apellido extra o de menos respecto a `assigned`. */
  contadorMis = computed(() => {
    const mi = this.currentUser?.nombre;
    return this.checklistsHoyTodos().filter(c => mismoEmpleadoNombre(c.assigned, mi)).length;
  });
  contadorEquipo = computed(() => {
    const mi = this.currentUser?.nombre;
    return this.checklistsHoyTodos().filter(c => !mismoEmpleadoNombre(c.assigned, mi)).length;
  });
  contadorTodas = computed(() => this.checklistsHoyTodos().length);

  /**
   * Checklists de hoy filtrados por la pestaña activa.
   * Los KPI y rankings consumen este computed, así que el toggle afecta TODO
   * el dashboard (pendientes, completadas, cumplimiento, top empleados, etc.).
   */
  checklistsHoy = computed(() => {
    const todos = this.checklistsHoyTodos();
    if (!this.puedeFiltrarVista()) return todos;
    const vista = this.vistaTareas();
    if (vista === 'todas') return todos;
    const mi = this.currentUser?.nombre;
    if (vista === 'mis') return todos.filter(c => mismoEmpleadoNombre(c.assigned, mi));
    return todos.filter(c => !mismoEmpleadoNombre(c.assigned, mi));
  });

  cambiarVistaTareas(v: 'mis' | 'equipo' | 'todas') {
    this.vistaTareas.set(v);
  }
 
  totalTareasHoy = computed(() =>
    this.checklistsHoy().reduce((acc, c) => acc + (c.items?.length || 0), 0)
  );
 
  tareasCompletadasHoy = computed(() =>
    this.checklistsHoy().reduce(
      // ✅ Una tarea cuenta como completa si tiene su EVIDENCIA (foto/antes-después/
      // varias fotos) o, si no pide evidencia, si está palomeada. Antes contaba solo
      // i.checked y daba 0% aunque la persona hubiera subido todas sus fotos.
      (acc, c) => acc + (c.items?.filter((it: any) => this.itemHecho(it, c)).length || 0), 0
    )
  );
 
  tareasPendientesHoy = computed(() =>
    this.totalTareasHoy() - this.tareasCompletadasHoy()
  );
 
  porcentajeCumplimiento = computed(() => {
    const t = this.totalTareasHoy();
    if (t === 0) return 0;
    return Math.round((this.tareasCompletadasHoy() / t) * 100);
  });
 
  cumplimientoClase = computed(() => {
    const p = this.porcentajeCumplimiento();
    if (p >= 80) return 'kpi-ok';
    if (p >= 50) return 'kpi-warn';
    return 'kpi-bad';
  });
 
  // ------- Top empleados (hoy) -------
  topEmpleados = computed(() => {
    const stats: Record<string, any> = {};
    this.checklistsHoy().forEach(c => {
      if (!c.assigned) return;
      if (!stats[c.assigned]) {
        stats[c.assigned] = { nombre: c.assigned, total: 0, completadas: 0 };
      }
      (c.items || []).forEach((it: any) => {
        stats[c.assigned].total++;
        if (this.itemHecho(it, c)) stats[c.assigned].completadas++;
      });
    });
    return Object.values(stats)
      .map((e: any) => ({
        ...e,
        porcentaje: e.total > 0 ? Math.round((e.completadas / e.total) * 100) : 0
      }))
      .sort((a: any, b: any) => b.porcentaje - a.porcentaje || b.completadas - a.completadas)
      .slice(0, 5);
  });

  // ------- Top sucursales (hoy) -------
  topSucursales = computed(() => {
    const stats: Record<string, any> = {};
    this.checklistsHoy().forEach(c => {
      const key = c.store;
      if (!key) return;
      if (!stats[key]) stats[key] = { nombre: key, total: 0, completadas: 0, checklists: 0 };
      stats[key].checklists++;
      (c.items || []).forEach((it: any) => {
        stats[key].total++;
        if (this.itemHecho(it, c)) stats[key].completadas++;
      });
    });
    return Object.values(stats)
      .map((s: any) => ({
        ...s,
        porcentaje: s.total > 0 ? Math.round((s.completadas / s.total) * 100) : 0
      }))
      .sort((a: any, b: any) => b.porcentaje - a.porcentaje)
      .slice(0, 5);
  });
 
  // ------- Alertas críticas -------
  /** Wrapper que delega al helper unificado. Mantiene la firma con (it, c) para
   *  que las llamadas existentes que pasan ambos parámetros sigan funcionando. */
  private itemHecho(it: any, c?: any): boolean {
    return esItemHecho(it, c);
  }

  alertasCriticas = computed(() => {
    const ahora = this.horaActual();
    const alertas: any[] = [];

    this.checklistsHoy().forEach(c => {
      // No alertamos sobre checklists ya enviados, eliminados o archivados (eran tareas fantasma).
      if (c.eliminado === true || c.enviado === true || c.archivado === true) return;
      (c.items || []).forEach((it: any) => {
        if (this.itemHecho(it, c)) return;
        const hl = it.horaLimite || it.time;
        if (!hl) return;
        const [h, m] = hl.split(':').map(Number);
        const limite = new Date(ahora);
        limite.setHours(h, m, 0, 0);
        if (ahora > limite) {
          alertas.push({
            tipo: 'vencida',
            empleado: c.assigned,
            tarea: it.text,
            sucursal: c.store,
            limite: this.formatearHora(hl)
          });
        }
      });
    });
 
    return alertas.slice(0, 8);
  });
 
  // ------- Actividad reciente -------
  actividadReciente = computed(() => {
    const acts: any[] = [];
    this.checklistsHoy().forEach(c => {
      (c.items || []).forEach((it: any) => {
        if (this.itemHecho(it, c) && it.photoTime) {
          acts.push({
            empleado: c.assigned,
            tarea: it.text,
            sucursal: c.store,
            hora: it.photoTime
          });
        }
      });
    });
    return acts
      .sort((a, b) => (b.hora || '').localeCompare(a.hora || ''))
      .slice(0, 8);
  });
 
  // ------- Tendencia 7 días -------
  tendencia7Dias = computed(() => {
    const dias: { fecha: string, porcentaje: number }[] = [];
    const hoy = this.horaActual();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(hoy);
      d.setDate(d.getDate() - i);
      const offset = d.getTimezoneOffset() * 60000;
      const fechaISO = new Date(d.getTime() - offset).toISOString().split('T')[0];
      const checks = this.checklists().filter(c => c.date === fechaISO);
 
      let total = 0, completadas = 0;
      checks.forEach(c => (c.items || []).forEach((it: any) => {
        total++;
        if (this.itemHecho(it, c)) completadas++;
      }));
 
      dias.push({
        fecha: d.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', ''),
        porcentaje: total > 0 ? Math.round((completadas / total) * 100) : 0
      });
    }
    return dias;
  });
 
  // ================================== LIFECYCLE ==================================
  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) this.currentUser = JSON.parse(sesion);

    // Levanta el listener compartido de usuarios (refcount); otros componentes que
    // tambien lo usen comparten el mismo onSnapshot.
    this.usuariosSvc.iniciar();

    this.conectarConLaNube();

    // Reloj que refresca cada minuto
    this.clockInterval = setInterval(() => this.horaActual.set(new Date()), 60000);
  }

  ngAfterViewInit() { this.cargarChartJS(); }

  ngOnDestroy() {
    this.destructoresRadares.forEach(apagar => apagar());
    this.usuariosSvc.detener();
    if (this.clockInterval) clearInterval(this.clockInterval);
    if (this.trendChart) this.trendChart.destroy();
  }
 
  // ================================== FIRESTORE ==================================
  conectarConLaNube() {
    // 🔥 Filtro de alcance: admin global ve todo; admin limitado solo sus sucursales;
    //    trabajador solo sus propias tareas (sin importar la sucursal).
    // 🔒 IMPORTANTE: los permisos se calculan DENTRO de cada snapshot (no aquí
    // afuera), para que tomen el currentUser FRESCO cada vez que cambie (gracias
    // a la sincronización en vivo de app.ts). Antes se "congelaban" al inicio.
    const leerSesion = (): any => {
      try { return JSON.parse(localStorage.getItem('md_sesion_actual') || 'null'); }
      catch { return null; }
    };

    // 💸 OPTIMIZACIÓN: solo traemos los últimos 7 días, no toda la historia.
    const hace7Dias = new Date();
    hace7Dias.setDate(hace7Dias.getDate() - 7);
    const offsetDays = hace7Dias.getTimezoneOffset() * 60000;
    const desdeISO = new Date(hace7Dias.getTime() - offsetDays).toISOString().split('T')[0];

    // FERROCARRIL Etapa 3: antes onSnapshot(checklists); ahora poll a Postgres.
    const recargarChecklists = async () => {
      const resp = await this.api.get('/api/checklists?desde=' + encodeURIComponent(desdeISO))
        .catch((e: any) => { console.error('[home] poll PG', e); return null; });
      if (!resp) return;
      const filas: any[] = resp.checklists || [];
      // Recalculamos permisos cada vez (currentUser podría haberse actualizado).
      const sesion = leerSesion() || this.currentUser;
      const permitidas = sucursalesPermitidas(sesion);
      const esGlobal = esAdminGlobal(sesion);
      // Supervisor = trabajador con flags de admin + sucursales asignadas.
      // En el dashboard se comporta como admin limitado (ve su sucursal completa),
      // no como trabajador puro (que solo ve sus propias tareas).
      const supervisor = esSupervisor(sesion);
      const esTrabajadorPuro = sesion?.rol === 'trabajador' && !supervisor;
      const miNombre = sesion?.nombre;

      let arr: any[] = [];
      filas.forEach((c: any) => {
        if (c.eliminado === true || c.archivado === true) return;
        arr.push({ ...c });
      });
      const totalCrudo = arr.length;

      if (esTrabajadorPuro) {
        // Match tolerante: cubre perfiles con apellido extra/de menos vs assigned.
        arr = arr.filter(c => mismoEmpleadoNombre(c.assigned, miNombre));
      } else if (!esGlobal && permitidas !== null) {
        // admin limitado O supervisor → filtra por sucursales
        arr = arr.filter(c => permitidas.includes(c.store));
      }

      // DEBUG temporal: ver en consola por qué un admin/supervisor ve 0.
      console.log('[DBG dashboard]', {
        usuario: sesion?.usuario, rol: sesion?.rol, alcance: sesion?.alcance,
        sucursales: sesion?.sucursales, esGlobal, supervisor, permitidas,
        checklistsCrudos: totalCrudo, despuesFiltro: arr.length,
        sucursalesUnicasEnDatos: Array.from(new Set(arr.map(c => c.store)))
      });

      this.checklists.set(arr);
      setTimeout(() => this.actualizarGrafica(), 100);
    };
    recargarChecklists();
    const idPollChecklists = setInterval(recargarChecklists, 20000);
    this.destructoresRadares.push(() => clearInterval(idPollChecklists));

    // areas_operativas migrada a Postgres (API). Poll ligero.
    this.cargarAreas();
    const areasPoll = setInterval(() => this.cargarAreas(), 60000);
    this.destructoresRadares.push(() => clearInterval(areasPoll));

    // La lista de usuarios ya la trae UsuariosService (listener compartido).
    // Aquí ya no abrimos un onSnapshot duplicado — el _usuariosEffect arriba
    // se encarga de filtrar por permisos y sucursales del currentUser.
  }

  /** Carga las áreas operativas desde /api/areas-operativas (Postgres). */
  async cargarAreas() {
    try {
      const r = await this.api.get('/api/areas-operativas');
      this.areas.set(r.areas || []);
    } catch (e) {
      console.error('[home] cargarAreas', e);
    }
  }

  // ================================== CHART.JS ==================================
  cargarChartJS() {
    if ((window as any).Chart) { this.actualizarGrafica(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.onload = () => this.actualizarGrafica();
    document.head.appendChild(s);
  }
 
  actualizarGrafica() {
    const Chart = (window as any).Chart;
    if (!Chart || !this.trendChartCanvas) return;
 
    const datos = this.tendencia7Dias();
    if (this.trendChart) this.trendChart.destroy();
 
    this.trendChart = new Chart(this.trendChartCanvas.nativeElement, {
      type: 'line',
      data: {
        labels: datos.map(d => d.fecha),
        datasets: [{
          label: '% Cumplimiento',
          data: datos.map(d => d.porcentaje),
          borderColor: '#1E3A8A',
          backgroundColor: 'rgba(30, 58, 138, 0.12)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#1E3A8A',
          pointRadius: 5,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: (v: any) => v + '%' } },
          x: { grid: { display: false } }
        }
      }
    });
  }
 
  // ================================== HELPERS ==================================
  formatearHora(hora: string): string {
    if (!hora || !hora.includes(':')) return hora || '';
    const [h, m] = hora.split(':').map(Number);
    const sufijo = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, '0')} ${sufijo}`;
  }
 
  iniciales(nombre: string): string {
    if (!nombre) return 'A';
    return nombre.split(' ').filter(Boolean).slice(0, 2).map(p => p.charAt(0)).join('').toUpperCase();
  }
 
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
 
  irA(ruta: string) { this.router.navigate([ruta]); this.isMenuOpen = false; }
}