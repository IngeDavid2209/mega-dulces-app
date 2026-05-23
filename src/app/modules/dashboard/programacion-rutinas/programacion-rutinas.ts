import { Component, signal, computed, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import { AsignacionRutina } from '../../../shared/asignaciones.types';
import {
  asignacionAplicaEnFecha,
  rangoDias,
  etiquetaDiaRelativa,
  fechaToYmd,
  nombreDiaSemana
} from '../../../shared/programacion.util';
import { ETIQUETAS_FRECUENCIA } from '../../../shared/rutinas.types';

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
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
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
  sucursalesDisponibles = signal<string[]>([]);

  // ---------- Filtros ----------
  terminoBusqueda = '';
  sucursalFiltro = 'todas';
  diasAdelante = signal(14);

  // ---------- Constantes ----------
  readonly etiquetasFrecuencia = ETIQUETAS_FRECUENCIA;
  readonly opcionesRango = [7, 14, 30];
  readonly todasLasSucursales = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD',
    'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
  ];

  private firestore = inject(Firestore);
  private router = inject(Router);
  private radarAsignaciones: (() => void) | null = null;
  private radarUsuarios: (() => void) | null = null;

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
    this.conectarConLaNube();
  }

  ngOnDestroy() {
    if (this.radarAsignaciones) { this.radarAsignaciones(); this.radarAsignaciones = null; }
    if (this.radarUsuarios) { this.radarUsuarios(); this.radarUsuarios = null; }
  }

  conectarConLaNube() {
    const refAsig = collection(this.firestore, 'asignaciones_rutinas');
    this.radarAsignaciones = onSnapshot(refAsig, snap => {
      const arr: AsignacionRutina[] = [];
      snap.forEach(d => {
        const data = d.data() as any;
        if (data.activa !== false) arr.push({ ...data, id: d.id });
      });
      this.asignaciones.set(arr);
    });

    const refUsr = collection(this.firestore, 'usuarios');
    this.radarUsuarios = onSnapshot(refUsr, snap => {
      const arr: any[] = [];
      snap.forEach(d => arr.push({ ...(d.data() as any), idFirestore: d.id }));
      this.usuarios.set(arr);
    });
  }

  calcularSucursalesDisponibles() {
    if (esAdminGlobal(this.currentUser)) {
      this.sucursalesDisponibles.set([...this.todasLasSucursales]);
    } else {
      const permitidas = sucursalesPermitidas(this.currentUser) ?? [];
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
