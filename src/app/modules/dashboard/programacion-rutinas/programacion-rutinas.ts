import { Component, signal, computed, OnInit, OnDestroy, inject, effect } from '@angular/core';
import { UsuariosService } from '../../../shared/usuarios.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';

import { ApiService } from '../../../shared/api.service';
import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { RutinasNavComponent } from '../../../shared/rutinas-nav/rutinas-nav';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import { AsignacionRutina } from '../../../shared/asignaciones.types';
import {
  asignacionAplicaEnFecha,
  rangoDias,
  etiquetaDiaRelativa,
  fechaToYmd,
  nombreDiaSemana
} from '../../../shared/programacion.util';
import { ETIQUETAS_FRECUENCIA, RutinaMaestra } from '../../../shared/rutinas.types';
import { ConfigTurnos } from '../../../shared/turnos.util';
import { construirMatrizSemana, FilaProg } from '../../../shared/conflictos-rutinas.util';

/** Una rutina programada para un día específico (resultado del cálculo). */
interface RutinaProgramada {
  asignacion: AsignacionRutina;
  sucursales: string[];          // sucursales que aplican (filtradas por permisos del usuario)
  destinatariosTexto: string;    // "Rol Cajero" o "Juan, María"
  destinatariosCount: number;
}

/** Un día con sus rutinas programadas. */
interface DiaProgramado {
  fecha: Date;
  fechaYmd: string;
  etiqueta: string;          // "Hoy" / "Mañana" / "Lunes 25 may"
  esHoy: boolean;
  esManana: boolean;
  rutinas: RutinaProgramada[];
  totalRutinas: number;
}

@Component({
  selector: 'app-programacion-rutinas',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent, RutinasNavComponent],
  templateUrl: './programacion-rutinas.html',
  styleUrls: ['./programacion-rutinas.css']
})
export class ProgramacionRutinasComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  currentUser: any = null;

  // ---------- Datos ----------
  asignaciones = signal<AsignacionRutina[]>([]);
  usuarios = signal<any[]>([]);
  catalogo = signal<RutinaMaestra[]>([]);
  descansos = signal<any[]>([]);
  configTurnos = signal<ConfigTurnos | null>(null);
  sucursalesDisponibles = signal<string[]>([]);

  // ---------- Filtros ----------
  terminoBusqueda = '';
  sucursalFiltro = 'todas';
  diasAdelante = signal(14);

  // ---------- Vista semanal (tabla de colores) ----------
  vista = signal<'semana' | 'lista'>('semana');
  semanaOffset = signal(0);     // 0 = semana actual, +1 siguiente, -1 anterior

  diasSemana = computed(() => {
    const hoy = new Date();
    const base = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const dow = (base.getDay() + 6) % 7;     // 0 = lunes
    base.setDate(base.getDate() - dow + this.semanaOffset() * 7);
    return rangoDias(base, 7);
  });

  /** Matriz rutina×día con estados (ok / conflicto / descanso / sin asignar). */
  matrizSemana = computed<FilaProg[]>(() => {
    const filas = construirMatrizSemana({
      asignaciones: this.asignaciones(),
      catalogo: this.catalogo(),
      usuarios: this.usuarios(),
      descansos: this.descansos(),
      configTurnos: this.configTurnos(),
      dias: this.diasSemana()
    });
    // Filtra por permisos, sucursal y búsqueda.
    const permitidas = esAdminGlobal(this.currentUser) ? null : sucursalesPermitidas(this.currentUser);
    const t = this.terminoBusqueda.toLowerCase().trim();
    return filas.filter(f => {
      if (permitidas !== null && !permitidas.includes(f.sucursal)) return false;
      if (this.sucursalFiltro !== 'todas' && f.sucursal !== this.sucursalFiltro) return false;
      if (t && !f.nombreRutina.toLowerCase().includes(t)) return false;
      return true;
    });
  });

  conflictosSemana = computed(() =>
    this.matrizSemana().reduce((n, f) => n + f.celdas.filter(c => c.estado === 'conflicto' || c.estado === 'sin_asignar').length, 0)
  );

  cambiarSemana(delta: number) { this.semanaOffset.set(this.semanaOffset() + delta); }
  primerNombre(n: string): string { const p = (n || '').trim().split(/\s+/); return p[0] || ''; }
  etiquetaFrec(frec: string): string { return (this.etiquetasFrecuencia as any)[frec] || frec; }
  nombreCortoDia(d: Date): string { return ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.getDay()]; }
  numDia(d: Date): number { return d.getDate(); }
  esHoy(d: Date): boolean { return fechaToYmd(d) === fechaToYmd(new Date()); }
  etiquetaSemana(): string {
    const dias = this.diasSemana();
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const a = dias[0], b = dias[6];
    return `${a.getDate()} ${meses[a.getMonth()]} – ${b.getDate()} ${meses[b.getMonth()]}`;
  }

  // ---------- Constantes ----------
  readonly etiquetasFrecuencia = ETIQUETAS_FRECUENCIA;
  readonly opcionesRango = [7, 14, 30];
  readonly todasLasSucursales = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD',
    'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO', 'CEDIS'
  ];

  private api = inject(ApiService);
  private router = inject(Router);
  private usuariosSvc = inject(UsuariosService);
  private radarAsignaciones: (() => void) | null = null;
  private radarCatalogo: (() => void) | null = null;
  private radarDescansos: (() => void) | null = null;
  private radarTurnos: (() => void) | null = null;

  private _usuariosEffect = effect(() => {
    const raw = this.usuariosSvc.usuarios();
    if (!raw) return;
    this.usuarios.set(raw.map((u: any) => ({ ...u, idFirestore: u.id || u.uid })));
  });

  // ============================================================================
  // CICLO DE VIDA
  // ============================================================================
  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) this.currentUser = JSON.parse(sesion);
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeCrearRutinas) {
      this.router.navigate(['/home']);
      return;
    }

    this.calcularSucursalesDisponibles();
    this.usuariosSvc.iniciar();
    this.conectarConLaNube();
  }

  ngOnDestroy() {
    if (this.radarAsignaciones) { this.radarAsignaciones(); this.radarAsignaciones = null; }
    if (this.radarCatalogo) { this.radarCatalogo(); this.radarCatalogo = null; }
    if (this.radarDescansos) { this.radarDescansos(); this.radarDescansos = null; }
    if (this.radarTurnos) { this.radarTurnos(); this.radarTurnos = null; }
    this.usuariosSvc.detener();
  }

  conectarConLaNube() {
    // FERROCARRIL: poll a Postgres (antes onSnapshot).
    const recargarAsignaciones = async () => {
      const resp = await this.api.get('/api/asignaciones-rutinas').catch((e: any) => { console.error('[programacion-rutinas] poll asignaciones', e); return null; });
      if (!resp) return;
      const items: any[] = resp.items || [];
      const arr: AsignacionRutina[] = [];
      items.forEach((data: any) => {
        if (data.activa !== false) arr.push({ ...data, id: data.id });
      });
      this.asignaciones.set(arr);
    };
    recargarAsignaciones();
    const idAsignaciones = setInterval(recargarAsignaciones, 20000);
    this.radarAsignaciones = () => clearInterval(idAsignaciones);

    // Catálogo (para hora de la rutina).
    // FERROCARRIL: poll a Postgres (antes onSnapshot).
    const recargarCatalogo = async () => {
      const resp = await this.api.get('/api/catalogo-rutinas').catch((e: any) => { console.error('[programacion-rutinas] poll catalogo', e); return null; });
      if (!resp) return;
      const items: any[] = resp.items || [];
      const arr: RutinaMaestra[] = [];
      items.forEach((data: any) => arr.push({ ...data, id: data.id }));
      this.catalogo.set(arr);
    };
    recargarCatalogo();
    const idCatalogo = setInterval(recargarCatalogo, 20000);
    this.radarCatalogo = () => clearInterval(idCatalogo);

    // Descansos y turnos (para colorear conflictos en la matriz).
    // FERROCARRIL: poll a Postgres (antes onSnapshot).
    const recargarDescansos = async () => {
      const resp = await this.api.get('/api/descansos-semanales').catch((e: any) => { console.error('[programacion-rutinas] poll descansos', e); return null; });
      if (!resp) return;
      const items: any[] = resp.items || [];
      const arr: any[] = [];
      items.forEach((data: any) => arr.push({ ...data, id: data.id }));
      this.descansos.set(arr);
    };
    recargarDescansos();
    const idDescansos = setInterval(recargarDescansos, 20000);
    this.radarDescansos = () => clearInterval(idDescansos);

    // FERROCARRIL Etapa 9 (config): turnos desde Postgres (poll; antes onSnapshot).
    const recargarTurnos = async () => {
      const resp = await this.api.get('/api/config?id=turnos').catch(() => null);
      if (!resp) return;
      this.configTurnos.set((resp.item as ConfigTurnos) || null);
    };
    recargarTurnos();
    const idTurnos = setInterval(recargarTurnos, 20000);
    this.radarTurnos = () => clearInterval(idTurnos);

    // Usuarios viene de UsuariosService (listener compartido) + _usuariosEffect.
  }

  calcularSucursalesDisponibles() {
    const permitidas = esAdminGlobal(this.currentUser) ? null : sucursalesPermitidas(this.currentUser);
    if (permitidas === null) {
      // null = acceso a TODAS (admin global o con comodin 'General (Acceso Total)').
      this.sucursalesDisponibles.set([...this.todasLasSucursales]);
    } else {
      this.sucursalesDisponibles.set(this.todasLasSucursales.filter(s => permitidas.includes(s)));
    }
  }

  // ============================================================================
  // CÁLCULO DE PROGRAMACIÓN
  // ============================================================================
  diasProgramados = computed<DiaProgramado[]>(() => {
    const hoy = new Date();
    const dias = rangoDias(hoy, this.diasAdelante());
    const mananaYmd = fechaToYmd(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1));
    const hoyYmd = fechaToYmd(hoy);

    const t = this.terminoBusqueda.toLowerCase().trim();
    const filtroSuc = this.sucursalFiltro;
    const permitidasUser = esAdminGlobal(this.currentUser)
      ? null
      : sucursalesPermitidas(this.currentUser);

    return dias.map(fecha => {
      const programadas: RutinaProgramada[] = [];

      for (const asig of this.asignaciones()) {
        if (!asignacionAplicaEnFecha(asig, fecha)) continue;

        // Filtrar sucursales por permisos del admin
        let sucsAplicables = asig.sucursales || [];
        if (permitidasUser !== null) {
          sucsAplicables = sucsAplicables.filter(s => permitidasUser.includes(s));
        }
        if (sucsAplicables.length === 0) continue;

        // Filtrar por sucursal seleccionada
        if (filtroSuc !== 'todas') {
          if (!sucsAplicables.includes(filtroSuc)) continue;
          sucsAplicables = [filtroSuc];
        }

        // Filtrar por término de búsqueda
        if (t && !asig.nombreRutina.toLowerCase().includes(t)) continue;

        programadas.push({
          asignacion: asig,
          sucursales: sucsAplicables,
          destinatariosTexto: this.textoDestinatarios(asig),
          destinatariosCount: this.contarDestinatarios(asig, sucsAplicables)
        });
      }

      // Ordenar por hora de inicio, luego por nombre
      programadas.sort((a, b) => {
        const hA = a.asignacion.horaInicio || 'zz';
        const hB = b.asignacion.horaInicio || 'zz';
        if (hA !== hB) return hA.localeCompare(hB);
        return a.asignacion.nombreRutina.localeCompare(b.asignacion.nombreRutina);
      });

      const fYmd = fechaToYmd(fecha);
      return {
        fecha,
        fechaYmd: fYmd,
        etiqueta: etiquetaDiaRelativa(fecha, hoy),
        esHoy: fYmd === hoyYmd,
        esManana: fYmd === mananaYmd,
        rutinas: programadas,
        totalRutinas: programadas.length
      };
    });
  });

  /** Día de "mañana" para el bloque destacado. */
  diaManana = computed<DiaProgramado | null>(() => {
    return this.diasProgramados().find(d => d.esManana) || null;
  });

  /** Días que tienen al menos 1 rutina (para no mostrar días vacíos en la lista). */
  diasConRutinas = computed<DiaProgramado[]>(() => {
    return this.diasProgramados().filter(d => d.totalRutinas > 0);
  });

  /** Total de rutinas programadas en el rango (para el header KPI). */
  totalRutinasRango = computed<number>(() => {
    return this.diasProgramados().reduce((sum, d) => sum + d.totalRutinas, 0);
  });

  // ============================================================================
  // HELPERS DE TEXTO
  // ============================================================================
  textoDestinatarios(a: AsignacionRutina): string {
    if (a.modoAsignacion === 'porRol') {
      return `Rol "${a.rolObjetivo || '?'}"`;
    }
    const nombres = a.empleadosNombres || [];
    if (nombres.length === 0) return 'Sin destinatarios';
    if (nombres.length === 1) return nombres[0];
    if (nombres.length <= 3) return nombres.join(', ');
    return `${nombres[0]}, ${nombres[1]} y ${nombres.length - 2} más`;
  }

  contarDestinatarios(a: AsignacionRutina, sucs: string[]): number {
    if (a.modoAsignacion === 'porPersonas') {
      return a.empleadosNombres?.length || 0;
    }
    // porRol: cuántos trabajadores cumplen rol + sucursales aplicables
    const rolLower = (a.rolObjetivo || '').toLowerCase();
    if (!rolLower) return 0;
    return this.usuarios().filter(u => {
      if (u.rol !== 'trabajador') return false;
      if (!(u.cargo || '').toLowerCase().includes(rolLower)) return false;
      const susSuc = u.sucursales || (u.sucursal ? [u.sucursal] : []);
      return susSuc.some((s: string) => sucs.includes(s));
    }).length;
  }

  textoSucursales(sucs: string[]): string {
    if (sucs.length === 0) return 'Ninguna';
    if (sucs.length === 1) return sucs[0];
    if (sucs.length <= 3) return sucs.join(', ');
    return `${sucs[0]}, ${sucs[1]} y ${sucs.length - 2} más`;
  }

  // ============================================================================
  // NAVEGACIÓN
  // ============================================================================
  editarAsignacion(a: AsignacionRutina) {
    this.router.navigate(['/asignaciones-rutinas'], { queryParams: { editar: a.id } });
  }

  irAAsignaciones() {
    this.router.navigate(['/asignaciones-rutinas']);
  }

  // ============================================================================
  // FILTROS
  // ============================================================================
  onCambioFiltro() {
    // Forzar recompute
    this.asignaciones.set([...this.asignaciones()]);
  }

  cambiarRango(n: number) {
    this.diasAdelante.set(n);
  }

  // trackBy
  trackByYmd(_i: number, d: DiaProgramado) { return d.fechaYmd; }
  trackByAsigId(_i: number, r: RutinaProgramada) { return r.asignacion.id; }
}
