import { Component, signal, computed, OnInit, OnDestroy, inject, effect } from '@angular/core';
import { UsuariosService } from '../../../shared/usuarios.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { Firestore, collection, onSnapshot, doc, setDoc, deleteDoc, getDocs, query, where } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import {
  RutinaMaestra,
  FrecuenciaRutina,
  ROLES_RUTINA,
  ETIQUETAS_TIPO,
  ETIQUETAS_FRECUENCIA
} from '../../../shared/rutinas.types';
import { AsignacionRutina, ModoAsignacion } from '../../../shared/asignaciones.types';

@Component({
  selector: 'app-asignaciones-rutinas',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './asignaciones-rutinas.html',
  styleUrls: ['./asignaciones-rutinas.css']
})
export class AsignacionesRutinasComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  currentUser: any = null;

  // ---------- Datos ----------
  catalogo = signal<RutinaMaestra[]>([]);
  asignaciones = signal<AsignacionRutina[]>([]);
  usuarios = signal<any[]>([]);
  sucursalesDisponibles = signal<string[]>([]);

  // ---------- Filtros ----------
  terminoBusqueda = '';
  sucursalFiltro = 'todas';
  mostrarInactivas = false;

  // ---------- Wizard ----------
  isWizardOpen = false;
  wizardStep = 1;
  readonly wizardTotalSteps = 6;
  isGuardando = false;
  editandoId = '';

  // Form del wizard
  formCatalogoRutinaId = '';
  formSucursales: string[] = [];
  formModo: ModoAsignacion = 'porRol';
  formRol: string = 'Encargado';
  formEmpleados: string[] = [];
  formFrecuencia: FrecuenciaRutina = 'Diaria';
  formDiaSemana = 'Lunes';
  formDiaMes = 1;
  formHoraInicio = '';
  formHoraLimite = '';
  formFechaInicio = '';
  formFechaFin: string | null = null;
  terminoBusquedaEmpleado = '';
  terminoBusquedaRutina = '';

  // ---------- Constantes ----------
  readonly roles = ROLES_RUTINA;
  readonly etiquetasFrecuencia = ETIQUETAS_FRECUENCIA;
  readonly etiquetasTipo = ETIQUETAS_TIPO;
  readonly diasSemana = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  readonly diasDelMes = Array.from({ length: 31 }, (_, i) => i + 1);
  readonly frecuencias: FrecuenciaRutina[] = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral', 'PorEvento'];
  readonly todasLasSucursales = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD',
    'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
  ];

  private firestore = inject(Firestore);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private usuariosSvc = inject(UsuariosService);
  private radarCatalogo: (() => void) | null = null;
  private radarAsignaciones: (() => void) | null = null;

  // Effect: replica la lista del UsuariosService a this.usuarios.
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

    // Deep-links desde otras pantallas:
    //  - ?rutina=XYZ  → wizard pre-llenado desde el catálogo
    //  - ?editar=XYZ  → abrir directamente la asignación XYZ para editar
    this.route.queryParams.subscribe(params => {
      if (params['rutina']) {
        setTimeout(() => this.abrirWizardDesdeRutina(params['rutina']), 400);
      } else if (params['editar']) {
        setTimeout(() => {
          const a = this.asignaciones().find(x => x.id === params['editar']);
          if (a) this.abrirWizardEditar(a);
        }, 500);
      }
    });
  }

  ngOnDestroy() {
    if (this.radarCatalogo) { this.radarCatalogo(); this.radarCatalogo = null; }
    if (this.radarAsignaciones) { this.radarAsignaciones(); this.radarAsignaciones = null; }
    this.usuariosSvc.detener();
  }

  conectarConLaNube() {
    // Catálogo (solo activas)
    const refCat = collection(this.firestore, 'catalogo_rutinas');
    this.radarCatalogo = onSnapshot(refCat, snap => {
      const arr: RutinaMaestra[] = [];
      snap.forEach(d => {
        const data = d.data() as any;
        if (data.activa !== false) arr.push({ ...data, id: d.id });
      });
      arr.sort((a, b) => a.nombre.localeCompare(b.nombre));
      this.catalogo.set(arr);
    });

    // Asignaciones
    const refAsig = collection(this.firestore, 'asignaciones_rutinas');
    this.radarAsignaciones = onSnapshot(refAsig, snap => {
      const arr: AsignacionRutina[] = [];
      snap.forEach(d => arr.push({ ...(d.data() as any), id: d.id }));
      arr.sort((a, b) => (b.creadoEn || 0) - (a.creadoEn || 0));
      this.asignaciones.set(arr);
    });

    // Usuarios viene de UsuariosService (listener compartido) + _usuariosEffect.
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
  // FILTROS / LISTA
  // ============================================================================
  asignacionesFiltradas = computed(() => {
    let lista = this.asignaciones();
    // Activas / inactivas
    lista = lista.filter(a => this.mostrarInactivas ? !a.activa : a.activa);
    // Sucursal
    if (this.sucursalFiltro !== 'todas') {
      lista = lista.filter(a => a.sucursales?.includes(this.sucursalFiltro));
    }
    // Solo sucursales permitidas para admin limitado
    if (!esAdminGlobal(this.currentUser)) {
      const permitidas = sucursalesPermitidas(this.currentUser);
      if (permitidas !== null) {
        lista = lista.filter(a => a.sucursales?.some(s => permitidas.includes(s)));
      }
    }
    // Búsqueda
    const t = this.terminoBusqueda.toLowerCase().trim();
    if (t) lista = lista.filter(a => a.nombreRutina.toLowerCase().includes(t));
    return lista;
  });

  onCambioFiltro() {
    // Forzar recompute
    this.asignaciones.set([...this.asignaciones()]);
  }

  trackById(_i: number, a: AsignacionRutina) { return a.id; }

  // ============================================================================
  // WIZARD: abrir / cerrar / navegar
  // ============================================================================
  abrirWizardNueva() {
    this.editandoId = '';
    this.resetForm();
    this.wizardStep = 1;
    this.isWizardOpen = true;
  }

  abrirWizardDesdeRutina(rutinaId: string) {
    this.editandoId = '';
    this.resetForm();
    this.formCatalogoRutinaId = rutinaId;
    // Pre-rellenar frecuencia/horario/etc desde la rutina maestra
    const r = this.catalogo().find(c => c.id === rutinaId);
    if (r) {
      this.formFrecuencia = r.frecuencia;
      this.formDiaSemana = r.diaSemana || 'Lunes';
      this.formDiaMes = r.diaMes || 1;
      this.formHoraInicio = r.horaInicio || '';
      this.formHoraLimite = r.horaLimite || '';
      this.formRol = r.responsableSugerido || 'Encargado';
    }
    this.wizardStep = 2; // saltamos el paso 1 (ya elegida)
    this.isWizardOpen = true;
  }

  abrirWizardEditar(a: AsignacionRutina) {
    this.editandoId = a.id;
    this.formCatalogoRutinaId = a.catalogoRutinaId;
    this.formSucursales = [...(a.sucursales || [])];
    this.formModo = a.modoAsignacion;
    this.formRol = a.rolObjetivo || 'Encargado';
    this.formEmpleados = [...(a.empleadosNombres || [])];
    this.formFrecuencia = a.frecuencia;
    this.formDiaSemana = a.diaSemana || 'Lunes';
    this.formDiaMes = a.diaMes || 1;
    this.formHoraInicio = a.horaInicio || '';
    this.formHoraLimite = a.horaLimite || '';
    this.formFechaInicio = a.fechaInicio;
    this.formFechaFin = a.fechaFin ?? null;
    this.wizardStep = 1;
    this.isWizardOpen = true;
  }

  cerrarWizard() {
    this.isWizardOpen = false;
    this.editandoId = '';
  }

  resetForm() {
    this.formCatalogoRutinaId = '';
    this.formSucursales = [];
    this.formModo = 'porRol';
    this.formRol = 'Encargado';
    this.formEmpleados = [];
    this.formFrecuencia = 'Diaria';
    this.formDiaSemana = 'Lunes';
    this.formDiaMes = 1;
    this.formHoraInicio = '';
    this.formHoraLimite = '';
    this.terminoBusquedaEmpleado = '';
    this.terminoBusquedaRutina = '';
    // Vigencia por defecto: hoy
    const offset = new Date().getTimezoneOffset() * 60000;
    this.formFechaInicio = new Date(Date.now() - offset).toISOString().split('T')[0];
    this.formFechaFin = null;
  }

  avanzarPaso() {
    if (!this.puedeAvanzar()) return;
    if (this.wizardStep < this.wizardTotalSteps) this.wizardStep++;
  }

  retrocederPaso() {
    if (this.wizardStep > 1) this.wizardStep--;
  }

  irAPaso(p: number) {
    if (p >= 1 && p <= this.wizardTotalSteps) this.wizardStep = p;
  }

  puedeAvanzar(): boolean {
    switch (this.wizardStep) {
      case 1: return !!this.formCatalogoRutinaId;
      case 2: return this.formSucursales.length > 0;
      case 3:
        return this.formModo === 'porRol'
          ? !!this.formRol
          : this.formEmpleados.length > 0;
      case 4: return !!this.formFrecuencia;
      case 5: {
        if (!this.formFechaInicio) return false;
        if (this.formFechaFin && this.formFechaFin < this.formFechaInicio) return false;
        return true;
      }
      case 6: return true;
      default: return false;
    }
  }

  // ============================================================================
  // PASO 1: SELECCIÓN DE RUTINA DEL CATÁLOGO
  // ============================================================================
  catalogoFiltrado = computed(() => {
    let lista = this.catalogo();
    const t = this.terminoBusquedaRutina.toLowerCase().trim();
    if (t) lista = lista.filter(r => r.nombre.toLowerCase().includes(t));
    return lista;
  });

  seleccionarRutinaCatalogo(r: RutinaMaestra) {
    this.formCatalogoRutinaId = r.id;
    // Heredar valores sugeridos (solo si el form aún está vacío para no pisar edición)
    if (!this.formFrecuencia || this.formFrecuencia === 'Diaria') this.formFrecuencia = r.frecuencia;
    if (!this.formRol) this.formRol = r.responsableSugerido;
    if (!this.formHoraInicio && r.horaInicio) this.formHoraInicio = r.horaInicio;
    if (!this.formHoraLimite && r.horaLimite) this.formHoraLimite = r.horaLimite;
    if (r.diaSemana) this.formDiaSemana = r.diaSemana;
    if (r.diaMes) this.formDiaMes = r.diaMes;
  }

  rutinaSeleccionada(): RutinaMaestra | null {
    return this.catalogo().find(r => r.id === this.formCatalogoRutinaId) || null;
  }

  // ============================================================================
  // PASO 2: SUCURSALES
  // ============================================================================
  toggleSucursal(suc: string) {
    const i = this.formSucursales.indexOf(suc);
    if (i > -1) this.formSucursales.splice(i, 1);
    else this.formSucursales.push(suc);
  }

  marcarTodasLasSucursales() {
    // 🔥 PETICIÓN DEL JEFE: botón automático para asignar a todas las sucursales
    this.formSucursales = [...this.sucursalesDisponibles()];
  }

  limpiarSucursales() {
    this.formSucursales = [];
  }

  // ============================================================================
  // PASO 3: A QUIÉN (rol o personas)
  // ============================================================================
  empleadosVisibles = computed(() => {
    let lista = this.usuarios().filter(u => u.rol === 'trabajador');
    // Filtrar por sucursales seleccionadas
    if (this.formSucursales.length > 0) {
      lista = lista.filter(u => {
        const susSuc = u.sucursales || (u.sucursal ? [u.sucursal] : []);
        return susSuc.some((s: string) => this.formSucursales.includes(s));
      });
    }
    // Buscador
    const t = this.terminoBusquedaEmpleado.toLowerCase().trim();
    if (t) lista = lista.filter(u => (u.nombre || '').toLowerCase().includes(t));
    return lista.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  });

  toggleEmpleado(nombre: string) {
    const i = this.formEmpleados.indexOf(nombre);
    if (i > -1) this.formEmpleados.splice(i, 1);
    else this.formEmpleados.push(nombre);
  }

  estimacionPersonasPorRol(): number {
    // Cuántos trabajadores cumplen rol + sucursales seleccionadas
    if (!this.formRol || this.formSucursales.length === 0) return 0;
    return this.usuarios().filter(u => {
      if (u.rol !== 'trabajador') return false;
      const rolLower = (u.cargo || '').toLowerCase();
      if (!rolLower.includes(this.formRol.toLowerCase())) return false;
      const susSuc = u.sucursales || (u.sucursal ? [u.sucursal] : []);
      return susSuc.some((s: string) => this.formSucursales.includes(s));
    }).length;
  }

  // ============================================================================
  // PASO 4: FRECUENCIA
  // ============================================================================
  seleccionarFrecuencia(f: FrecuenciaRutina) {
    this.formFrecuencia = f;
  }

  // ============================================================================
  // RESUMEN
  // ============================================================================
  textoFrecuenciaResumen(): string {
    if (this.formFrecuencia === 'Diaria') return 'Todos los días';
    if (this.formFrecuencia === 'Semanal') return `Cada semana, los ${this.formDiaSemana}`;
    if (this.formFrecuencia === 'Catorcenal') return `Cada 2 semanas, los ${this.formDiaSemana}`;
    if (this.formFrecuencia === 'Mensual') return `Día ${this.formDiaMes} de cada mes`;
    if (this.formFrecuencia === 'Trimestral') return `Día ${this.formDiaMes} cada 3 meses`;
    return 'Solo por evento (manual)';
  }

  textoDestinatariosResumen(): string {
    if (this.formModo === 'porRol') {
      const n = this.estimacionPersonasPorRol();
      return `Rol "${this.formRol}" — aprox ${n} ${n === 1 ? 'persona' : 'personas'}`;
    }
    if (this.formEmpleados.length === 0) return 'Nadie seleccionado';
    if (this.formEmpleados.length === 1) return this.formEmpleados[0];
    if (this.formEmpleados.length <= 3) return this.formEmpleados.join(', ');
    return `${this.formEmpleados[0]}, ${this.formEmpleados[1]} y ${this.formEmpleados.length - 2} más`;
  }

  textoSucursalesResumen(): string {
    if (this.formSucursales.length === 0) return 'Ninguna';
    if (this.formSucursales.length === this.sucursalesDisponibles().length) {
      return `🚀 Todas (${this.formSucursales.length})`;
    }
    if (this.formSucursales.length === 1) return this.formSucursales[0];
    if (this.formSucursales.length <= 3) return this.formSucursales.join(', ');
    return `${this.formSucursales[0]}, ${this.formSucursales[1]} y ${this.formSucursales.length - 2} más`;
  }

  // ============================================================================
  // GUARDAR
  // ============================================================================
  async guardar() {
    if (this.isGuardando) return;
    if (!this.puedeAvanzar()) return;

    this.isGuardando = true;
    const ahora = Date.now();
    const id = this.editandoId || ('asig_' + ahora);
    const yo = this.currentUser?.nombre || this.currentUser?.usuario || 'desconocido';
    const rutina = this.catalogo().find(r => r.id === this.formCatalogoRutinaId);
    if (!rutina) {
      Swal.fire('Error', 'La rutina seleccionada ya no existe en el catálogo.', 'error');
      this.isGuardando = false;
      return;
    }

    const payload: any = {
      id,
      catalogoRutinaId: this.formCatalogoRutinaId,
      nombreRutina: rutina.nombre,
      sucursales: [...this.formSucursales],
      modoAsignacion: this.formModo,
      frecuencia: this.formFrecuencia,
      horaInicio: this.formHoraInicio || '',
      horaLimite: this.formHoraLimite || '',
      fechaInicio: this.formFechaInicio,
      fechaFin: this.formFechaFin || null,
      activa: true
    };

    if (this.formModo === 'porRol') {
      payload.rolObjetivo = this.formRol;
    } else {
      payload.empleadosNombres = [...this.formEmpleados];
    }

    if (this.formFrecuencia === 'Semanal' || this.formFrecuencia === 'Catorcenal') {
      payload.diaSemana = this.formDiaSemana;
    }
    if (this.formFrecuencia === 'Mensual' || this.formFrecuencia === 'Trimestral') {
      payload.diaMes = this.formDiaMes;
    }

    if (this.editandoId) {
      payload.actualizadoPor = yo;
      payload.actualizadoEn = ahora;
    } else {
      payload.creadoPor = yo;
      payload.creadoEn = ahora;
    }

    try {
      await setDoc(doc(this.firestore, 'asignaciones_rutinas', id), payload, { merge: true });
      this.cerrarWizard();
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 2500,
        icon: 'success',
        title: this.editandoId ? 'Asignación actualizada ✏️' : 'Asignación creada ✅'
      });
    } catch (e: any) {
      console.error(e);
      Swal.fire('Error', e.message || 'No se pudo guardar.', 'error');
    } finally {
      this.isGuardando = false;
    }
  }

  // ============================================================================
  // ACCIONES DE LA CARD
  // ============================================================================
  async pausarReanudar(a: AsignacionRutina, event: Event) {
    event.stopPropagation();
    const accion = a.activa ? 'pausar' : 'reanudar';
    const confirma = await Swal.fire({
      title: `¿${accion === 'pausar' ? 'Pausar' : 'Reanudar'} esta asignación?`,
      text: accion === 'pausar'
        ? 'Mientras esté pausada, el robot no generará tareas para esta asignación.'
        : 'La asignación volverá a generar tareas automáticamente.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: `Sí, ${accion}`,
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#0F172A'
    });
    if (!confirma.isConfirmed) return;
    try {
      await setDoc(doc(this.firestore, 'asignaciones_rutinas', a.id), { activa: !a.activa }, { merge: true });
    } catch (e: any) {
      Swal.fire('Error', e.message || 'No se pudo cambiar el estado.', 'error');
    }
  }

  async eliminar(a: AsignacionRutina, event: Event) {
    event.stopPropagation();
    const confirma = await Swal.fire({
      title: '¿Eliminar esta asignación?',
      text: `"${a.nombreRutina}" dejará de generar tareas. Esta acción no se puede deshacer.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#EF4444'
    });
    if (!confirma.isConfirmed) return;
    try {
      await deleteDoc(doc(this.firestore, 'asignaciones_rutinas', a.id));
      // 🗑️ Cancelar las tareas que esta asignación ya había generado y siguen
      // pendientes, para que no queden estancadas contando como sin hacer.
      await this.cancelarChecklistsPendientes(a.id);
    } catch (e: any) {
      Swal.fire('Error', e.message || 'No se pudo eliminar.', 'error');
    }
  }

  /**
   * Marca como eliminados los checklists que generó una asignación y que siguen
   * pendientes (no enviados). Respeta los ya enviados — esos son historial.
   */
  private async cancelarChecklistsPendientes(asignacionId: string) {
    try {
      const q = query(collection(this.firestore, 'checklists'), where('_asignacionId', '==', asignacionId));
      const snap = await getDocs(q);
      const ops: Promise<any>[] = [];
      snap.forEach(d => {
        const c = d.data() as any;
        if (c.enviado === true || c.eliminado === true || c.archivado === true) return; // no tocar enviados, borrados ni archivados
        ops.push(setDoc(doc(this.firestore, 'checklists', d.id), { eliminado: true }, { merge: true }));
      });
      await Promise.all(ops);
    } catch (e) {
      console.error('[cancelarChecklistsPendientes]', e);
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================
  esSucursalSeleccionada(suc: string): boolean {
    return this.formSucursales.includes(suc);
  }

  esEmpleadoSeleccionado(nombre: string): boolean {
    return this.formEmpleados.includes(nombre);
  }

  /** ¿Todas las sucursales disponibles están marcadas? */
  todasSucursalesMarcadas(): boolean {
    const disponibles = this.sucursalesDisponibles();
    return disponibles.length > 0 && disponibles.every(s => this.formSucursales.includes(s));
  }

  /** Hoy en formato YYYY-MM-DD para usar como min en inputs date. */
  get hoyIsoStr(): string {
    const offset = new Date().getTimezoneOffset() * 60000;
    return new Date(Date.now() - offset).toISOString().split('T')[0];
  }
}
