
import {
  Component, signal, computed, OnInit, OnDestroy, AfterViewInit,
  inject, ViewChild, ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';

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
 
  private firestore = inject(Firestore);
  private router    = inject(Router);
  private destructoresRadares: (() => void)[] = [];
  private clockInterval: any = null;
 
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
  totalChecklistsHoy   = computed(() => this.checklistsHoy().length);
 
  checklistsHoy = computed(() =>
    this.checklists().filter(c => c.date === this.hoyISO())
  );
 
  totalTareasHoy = computed(() =>
    this.checklistsHoy().reduce((acc, c) => acc + (c.items?.length || 0), 0)
  );
 
  tareasCompletadasHoy = computed(() =>
    this.checklistsHoy().reduce(
      (acc, c) => acc + (c.items?.filter((it: any) => it.checked).length || 0), 0
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
        if (it.checked) stats[c.assigned].completadas++;
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
        if (it.checked) stats[key].completadas++;
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
  alertasCriticas = computed(() => {
    const ahora = this.horaActual();
    const alertas: any[] = [];
 
    this.checklistsHoy().forEach(c => {
      (c.items || []).forEach((it: any) => {
        if (it.checked) return;
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
        if (it.checked && it.photoTime) {
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
        if (it.checked) completadas++;
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
 
    this.conectarConLaNube();
 
    // Reloj que refresca cada minuto
    this.clockInterval = setInterval(() => this.horaActual.set(new Date()), 60000);
  }
 
  ngAfterViewInit() { this.cargarChartJS(); }
 
  ngOnDestroy() {
    this.destructoresRadares.forEach(apagar => apagar());
    if (this.clockInterval) clearInterval(this.clockInterval);
    if (this.trendChart) this.trendChart.destroy();
  }
 
  // ================================== FIRESTORE ==================================
  conectarConLaNube() {
    // 🔥 Filtro de alcance: admin global ve todo; admin limitado solo sus sucursales.
    const permitidas = sucursalesPermitidas(this.currentUser);
    const esGlobal = esAdminGlobal(this.currentUser);

    const checklistsRef = collection(this.firestore, 'checklists');
    this.destructoresRadares.push(
      onSnapshot(checklistsRef, snap => {
        let arr: any[] = [];
        snap.forEach(d => arr.push({ ...d.data(), id: d.id }));
        // Admin limitado: solo checklists de sus sucursales
        if (!esGlobal && permitidas !== null) {
          arr = arr.filter(c => permitidas.includes(c.store));
        }
        this.checklists.set(arr);
        setTimeout(() => this.actualizarGrafica(), 100);
      })
    );

    const areasRef = collection(this.firestore, 'areas_operativas');
    this.destructoresRadares.push(
      onSnapshot(areasRef, snap => {
        const arr: any[] = [];
        snap.forEach(d => arr.push({ ...d.data(), id: d.id }));
        this.areas.set(arr);
      })
    );

    const usuariosRef = collection(this.firestore, 'usuarios');
    this.destructoresRadares.push(
      onSnapshot(usuariosRef, snap => {
        let arr: any[] = [];
        snap.forEach(d => arr.push({ ...d.data(), idFirestore: d.id }));
        // Admin limitado: solo trabajadores de sus sucursales (excluye otros admins)
        if (!esGlobal && permitidas !== null) {
          arr = arr.filter(u => {
            if (u.rol === 'admin') return false;
            const susSuc: string[] = u.sucursales || (u.sucursal ? [u.sucursal] : []);
            return susSuc.some((s: string) => permitidas.includes(s));
          });
        }
        this.usuarios.set(arr);
      })
    );
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