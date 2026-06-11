import { Component, signal, OnInit, OnDestroy, inject, effect } from '@angular/core';
import { UsuariosService } from '../../../shared/usuarios.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
// 🔥 Agregué getDocs y query para que pueda ir por la agenda personal
import { Firestore, collection, onSnapshot, getDocs, query, where } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AreasApi } from '../../../api/areas.api';
import { ChecklistsApi } from '../../../api/checklists.api';
import { UsuariosApi } from '../../../api/usuarios.api';
import Swal from 'sweetalert2';
import { esAdminGlobal, sucursalesPermitidas, normalizarNombre } from '../../../shared/permisos.util';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';

@Component({
  selector: 'app-calendario',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './calendario.html',
  styleUrls: ['./calendario.css']
})
export class CalendarioComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null;
  empleados = signal<any[]>([]);
  checklistsGlobales: any[] = [];
  
  vistaActual: string = 'asignadas';
  tareasPersonales: any[] = [];
  tareasPersonalesDelDia: any[] = []; // 🔥 Nueva variable para guardar la agenda del día

  areas = signal<any[]>([]);
  areaSeleccionada = 'Todas';
  terminoBusqueda = '';
  empleadoSeleccionado = 'Todos';
tareasAgendaMes: any[] = [];
  fechaActual = new Date();
  mesActualNombre = '';
  anioActual = 0;

  diasCalendario = signal<any[]>([]);
  diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  diaSeleccionado = signal<any>(null);
  isModalOpen = false;

  fotoAmpliada = signal<string | null>(null);
  fechaBuscada = '';

  private firestore = inject(Firestore);
  private areasApi = inject(AreasApi);
  private checklistsApi = inject(ChecklistsApi);
  private usuariosApi = inject(UsuariosApi);
  private pollAreas: any = null;
  private pollChecklists: any = null;
  private router = inject(Router);
  private usuariosSvc = inject(UsuariosService);
  /** Snapshot dinámico de checklists del mes visible (se recrea al cambiar de mes). */
  private radarChecklistsActivo: (() => void) | null = null;
  private destructores: (() => void)[] = [];

  // Effect que toma usuarios del servicio compartido y filtra por permisos.
  // Antes este componente abria su propio onSnapshot sobre `usuarios`.
  private _usuariosEffect = effect(() => {
    const raw = this.usuariosSvc.usuarios();
    if (!raw) return;
    let trabajadores: any[] = raw.filter((u: any) => u.rol === 'trabajador');
    if (!esAdminGlobal(this.currentUser)) {
      const permitidas = sucursalesPermitidas(this.currentUser);
      if (permitidas !== null) {
        trabajadores = trabajadores.filter((t: any) => {
          const susSucursales = t.sucursales || [t.sucursal || ''];
          return susSucursales.some((s: string) => permitidas.includes(s));
        });
      }
    }
    this.empleados.set(trabajadores.sort((a: any, b: any) => (a.nombre || '').localeCompare(b.nombre || '')));
  });

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }

    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeVerCalendario) {
      this.router.navigate(['/home']);
      return;
    }

    this.usuariosSvc.iniciar();
    this.conectarDatos();
    this.actualizarMes(0);
  }

  ngOnDestroy() {
    this.destructores.forEach(d => d());
    if (this.radarChecklistsActivo) { this.radarChecklistsActivo(); this.radarChecklistsActivo = null; }
    this.usuariosSvc.detener();
  }

  conectarDatos() {
    // La lista de usuarios la trae UsuariosService (listener compartido) +
    // _usuariosEffect aplica el filtro por sucursal. Aqui solo abrimos los
    // listeners de las otras colecciones.

    if (environment.useBackend) {
      const refresh = async () => {
        try {
          const res = await firstValueFrom(this.areasApi.list());
          this.areas.set([...res.areas].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '')));
        } catch (e) { console.error('[calendario/areas backend]', e); }
      };
      refresh();
      this.pollAreas = setInterval(refresh, 60_000);
      this.destructores.push(() => { if (this.pollAreas) { clearInterval(this.pollAreas); this.pollAreas = null; } });
    } else {
      const areasRef = collection(this.firestore, 'areas_operativas');
      this.destructores.push(onSnapshot(areasRef, (snap) => {
        const areasNube = snap.docs.map(d => d.data());
        this.areas.set(areasNube.sort((a: any, b: any) => (a.nombre || '').localeCompare(b.nombre || '')));
      }));
    }

    // 💸 OPTIMIZACIÓN: filtramos checklists al rango del mes visible (±1 mes para
    // amortiguar al navegar rápido entre meses cercanos). Antes traíamos toda la
    // colección histórica → ahora solo ~3 meses de data por conexión.
    this.reconectarChecklistsDelMesVisible();
  }

  /**
   * Cierra el snapshot anterior y abre uno nuevo filtrado al rango del mes visible
   * (1 mes antes y 1 después). Se llama al iniciar y cada vez que cambia el mes.
   */
  private reconectarChecklistsDelMesVisible() {
    if (this.radarChecklistsActivo) { this.radarChecklistsActivo(); this.radarChecklistsActivo = null; }
    if (this.pollChecklists) { clearInterval(this.pollChecklists); this.pollChecklists = null; }

    // Rango ±1 mes alrededor de fechaActual (3 meses de cobertura)
    const offset = new Date().getTimezoneOffset() * 60000;
    const inicio = new Date(this.fechaActual.getFullYear(), this.fechaActual.getMonth() - 1, 1, 12);
    const fin = new Date(this.fechaActual.getFullYear(), this.fechaActual.getMonth() + 2, 0, 12);
    const desdeISO = new Date(inicio.getTime() - offset).toISOString().split('T')[0];
    const hastaISO = new Date(fin.getTime() - offset).toISOString().split('T')[0];

    const aplicarFiltroSucursal = (lista: any[]) => {
      if (esAdminGlobal(this.currentUser)) return lista;
      const permitidas = sucursalesPermitidas(this.currentUser);
      if (permitidas === null) return lista;
      return lista.filter((c: any) => permitidas.includes(c.store));
    };

    if (environment.useBackend) {
      const refresh = async () => {
        try {
          const res = await firstValueFrom(this.checklistsApi.list({
            fechaDesde: desdeISO, fechaHasta: hastaISO, archivado: false, eliminado: false, limit: 2000,
          }));
          this.checklistsGlobales = aplicarFiltroSucursal(res.checklists as any[]);
          this.generarCalendario();
        } catch (e) { console.error('[calendario/checklists backend]', e); }
      };
      refresh();
      this.pollChecklists = setInterval(refresh, 60_000);
      return;
    }

    const checklistsRef = collection(this.firestore, 'checklists');
    const q = query(
      checklistsRef,
      where('date', '>=', desdeISO),
      where('date', '<=', hastaISO)
    );
    this.radarChecklistsActivo = onSnapshot(q, (snap) => {
      const lista = aplicarFiltroSucursal(snap.docs.map(d => d.data()).filter((c: any) => !c.eliminado && !c.archivado));
      this.checklistsGlobales = lista;
      this.generarCalendario();
    });
  }

  get empleadosFiltrados() {
    let filtrados = this.empleados();
    if (this.areaSeleccionada !== 'Todas') {
      filtrados = filtrados.filter(e => e.areas && e.areas.includes(this.areaSeleccionada));
    }
    if (this.terminoBusqueda.trim()) {
      const t = this.terminoBusqueda.toLowerCase();
      filtrados = filtrados.filter(e => (e.nombre || '').toLowerCase().includes(t));
    }
    return filtrados;
  }

  alCambiarFiltro() {
    const empAunValido = this.empleadoSeleccionado === 'Todos' || this.empleadosFiltrados.some(e => e.nombre === this.empleadoSeleccionado);
    if (!empAunValido) { this.empleadoSeleccionado = 'Todos'; }
    this.generarCalendario();
  }

  cambiarMes(incremento: number) {
    this.actualizarMes(incremento);
    // 💸 Recargar snapshot al nuevo rango (mes ±1)
    this.reconectarChecklistsDelMesVisible();
    this.generarCalendario();
  }

  actualizarMes(incremento: number) {
    this.fechaActual.setMonth(this.fechaActual.getMonth() + incremento);
    this.anioActual = this.fechaActual.getFullYear();
    const opcionesMes: Intl.DateTimeFormatOptions = { month: 'long' };
    this.mesActualNombre = this.fechaActual.toLocaleDateString('es-ES', opcionesMes).toUpperCase();
  }

  irAFechaPrecisa(event: any) {
    const input = event.target.value;
    if (!input) return;
    const partes = input.split('-');
    if (partes.length === 3) {
      const anio = parseInt(partes[0], 10);
      const mes = parseInt(partes[1], 10) - 1;
      const dia = parseInt(partes[2], 10);
      this.fechaActual = new Date(anio, mes, dia);
      this.actualizarMes(0);
      this.reconectarChecklistsDelMesVisible(); // 💸
      this.generarCalendario();
      this.abrirDiaPorString(input);
    }
  }

  irAHoy() {
    this.fechaActual = new Date();
    this.actualizarMes(0);
    this.reconectarChecklistsDelMesVisible(); // 💸
    this.generarCalendario();
    const offset = this.fechaActual.getTimezoneOffset() * 60000;
    const hoyStr = new Date(this.fechaActual.getTime() - offset).toISOString().split('T')[0];
    this.abrirDiaPorString(hoyStr);
  }

  irAAyer() {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    this.fechaActual = ayer;
    this.actualizarMes(0);
    this.reconectarChecklistsDelMesVisible(); // 💸
    this.generarCalendario();
    const offset = ayer.getTimezoneOffset() * 60000;
    const ayerStr = new Date(ayer.getTime() - offset).toISOString().split('T')[0];
    this.abrirDiaPorString(ayerStr);
  }

  abrirDiaPorString(fechaStr: string) {
    const partes = fechaStr.split('-');
    if (partes.length < 3) return;
    const dia = parseInt(partes[2], 10);
    const diaEncontrado = this.diasCalendario().find(d => d && d.numero === dia);
    // 🔥 Quité el ".total > 0" para que te deje abrir agendas en días vacíos
    if (diaEncontrado) {
      this.abrirDetalleDia(diaEncontrado);
    } else {
      Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, icon: 'info', title: 'Sin actividades registradas' });
    }
  }

async generarCalendario() {
    const year = this.fechaActual.getFullYear();
    const month = this.fechaActual.getMonth();
    const primerDia = new Date(year, month, 1).getDay();
    const diasEnMes = new Date(year, month + 1, 0).getDate();
    let grid = [];
    
    const offset = new Date().getTimezoneOffset() * 60000;
    const hoyStr = new Date(Date.now() - offset).toISOString().split('T')[0];

    // 1. Identificamos de quién vamos a contar la agenda
    let userId = this.currentUser?.uid || this.currentUser?.id || this.currentUser?.idUsuario || this.currentUser?.correo;
    if (this.currentUser?.rol === 'admin' && this.empleadoSeleccionado !== 'Todos') {
      const emp = this.empleados().find(e => e.nombre === this.empleadoSeleccionado);
      if (emp) userId = emp.uid || emp.id || emp.idUsuario || emp.correo;
    }

    // 2. Traemos la agenda completa una sola vez para este mes (Optimizado)
    if (userId) {
      if (environment.useBackend) {
        try {
          const res = await firstValueFrom(this.usuariosApi.listAgenda(userId));
          this.tareasAgendaMes = res.items as any[];
        } catch (e) {
          console.error('[calendario/agenda backend]', e);
          this.tareasAgendaMes = [];
        }
      } else {
        const agendaRef = collection(this.firestore, `usuarios/${userId}/agenda`);
        const snap = await getDocs(query(agendaRef));
        this.tareasAgendaMes = snap.docs.map(doc => ({ ...doc.data() as any }));
      }
    }

    for (let i = 0; i < primerDia; i++) { grid.push(null); }

    for (let i = 1; i <= diasEnMes; i++) {
      const fechaLocal = new Date(year, month, i, 12);
      const fechaStr = fechaLocal.toISOString().split('T')[0];
      
      // Conteo de Checklists (Operativo)
      let tareasDelDia = this.checklistsGlobales.filter(c => c.date === fechaStr);
      if (this.empleadoSeleccionado !== 'Todos') {
        const empNorm = normalizarNombre(this.empleadoSeleccionado);
        tareasDelDia = tareasDelDia.filter(c => normalizarNombre(c.assigned) === empNorm);
      } else if (this.areaSeleccionada !== 'Todas') {
        const nombresEmpleadosArea = new Set(this.empleadosFiltrados.map(e => normalizarNombre(e.nombre)));
        tareasDelDia = tareasDelDia.filter(c => nombresEmpleadosArea.has(normalizarNombre(c.assigned)));
      }

      // 🔥 NUEVO: Conteo de Agenda Personal (Azul)
      const personalesDelDia = this.tareasAgendaMes.filter(t => {
        if (!t.fechaCreacion) return false;
        const dStr = new Date(t.fechaCreacion - offset).toISOString().split('T')[0];
        return dStr === fechaStr;
      }).length;

      let completadas = 0; let pendientes = 0; let vencidas = 0;
      tareasDelDia.forEach(tarea => {
        const tareasMarcadas = tarea.items ? tarea.items.filter((item: any) => item.checked).length : 0;
        const totalItems = tarea.items ? tarea.items.length : 0;
        if (tareasMarcadas === totalItems && totalItems > 0) completadas++;
        else if (fechaStr < hoyStr) vencidas++;
        else pendientes++;
      });

      grid.push({
        numero: i, fechaStr: fechaStr, esHoy: fechaStr === hoyStr,
        tareas: tareasDelDia, completadas, pendientes, vencidas, total: tareasDelDia.length,
        personalesCount: personalesDelDia // 👈 Guardamos el conteo azul
      });
    }
    this.diasCalendario.set(grid);
  }

  abrirDetalleDia(dia: any) {
    if (!dia) return; // 🔥 Permite abrir días aunque no tengan checklists
    this.diaSeleccionado.set(dia);
    this.vistaActual = 'asignadas';
    this.cargarAgendaPersonal(dia.fechaStr); // 🔥 Mandamos traer la agenda
    this.isModalOpen = true;
  }

  // 🔥 NUEVA FUNCIÓN MÁGICA: Trae solo las tareas personales de ese día específico
  async cargarAgendaPersonal(fechaStr: string) {
    this.tareasPersonalesDelDia = [];
    
    // Por defecto, usa el ID del que tiene la sesión abierta
    let userIdToFetch = this.currentUser?.uid || this.currentUser?.id || this.currentUser?.idUsuario || this.currentUser?.correo;

    // Si es Admin y seleccionó a alguien en el filtro, traemos la agenda de ese empleado
    if (this.currentUser?.rol === 'admin' && this.empleadoSeleccionado !== 'Todos') {
      const emp = this.empleados().find(e => e.nombre === this.empleadoSeleccionado);
      if (emp) {
        userIdToFetch = emp.uid || emp.id || emp.idUsuario || emp.correo;
      }
    }

    if (!userIdToFetch) return;

    try {
      let todasLasTareas: any[];
      if (environment.useBackend) {
        const res = await firstValueFrom(this.usuariosApi.listAgenda(userIdToFetch));
        todasLasTareas = res.items as any[];
      } else {
        const agendaRef = collection(this.firestore, `usuarios/${userIdToFetch}/agenda`);
        const snapshot = await getDocs(query(agendaRef));
        todasLasTareas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      }

      // Filtramos las que coincidan exactamente con la fecha que se abrió
      this.tareasPersonalesDelDia = todasLasTareas.filter(t => {
        if (!t.fechaCreacion) return false;
        const offset = new Date().getTimezoneOffset() * 60000;
        const dateStr = new Date(Number(t.fechaCreacion) - offset).toISOString().split('T')[0];
        return dateStr === fechaStr;
      });

    } catch (error) {
      console.error('Error al cargar agenda personal:', error);
    }
  }

  cerrarDetalle() {
    this.isModalOpen = false;
    this.diaSeleccionado.set(null);
  }

  cerrarSesion() {
    localStorage.removeItem('md_sesion_actual');
    this.router.navigate(['/login']);
  }

  toggleTareaExpandida(tarea: any) {
    tarea.expandido = !tarea.expandido;
  }

  abrirFoto(url: string, event: Event) {
    event.stopPropagation();
    this.fotoAmpliada.set(url);
  }

  cerrarFoto() {
    this.fotoAmpliada.set(null);
  }

  // ============================================================================
  // 📊 KPIs DEL MES (para el panel resumen)
  // ============================================================================
  getKpiMesCompletadas(): number {
    return this.diasCalendario().reduce((sum, d) => sum + (d?.completadas || 0), 0);
  }

  getKpiMesPendientes(): number {
    return this.diasCalendario().reduce((sum, d) => sum + (d?.pendientes || 0), 0);
  }

  getKpiMesVencidas(): number {
    return this.diasCalendario().reduce((sum, d) => sum + (d?.vencidas || 0), 0);
  }

  getKpiMesAgenda(): number {
    return this.diasCalendario().reduce((sum, d) => sum + (d?.personalesCount || 0), 0);
  }

  getKpiMesTotal(): number {
    return this.diasCalendario().reduce(
      (sum, d) => sum + (d?.total || 0) + (d?.personalesCount || 0), 0
    );
  }

  // Estado predominante de una celda para colorear su barra superior
  estadoCelda(dia: any): 'completo' | 'pendiente' | 'vencido' | 'mixto' | null {
    if (!dia) return null;
    const c = dia.completadas || 0;
    const p = dia.pendientes || 0;
    const v = dia.vencidas || 0;
    if (c + p + v === 0) return null;
    if (v > 0) return 'vencido';
    if (p > 0 && c > 0) return 'mixto';
    if (p > 0) return 'pendiente';
    return 'completo';
  }

  // ¿Es sábado o domingo? (recibe el índice de la grilla)
  esFinDeSemana(indiceEnGrilla: number): boolean {
    const dow = indiceEnGrilla % 7; // 0 = Dom, 6 = Sáb
    return dow === 0 || dow === 6;
  }
}