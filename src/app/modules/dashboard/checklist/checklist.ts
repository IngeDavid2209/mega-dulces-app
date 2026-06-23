import { Component, signal, OnInit, OnDestroy, inject, effect } from '@angular/core';
import { UsuariosService } from '../../../shared/usuarios.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Firestore, collection, doc, setDoc, getDoc, deleteDoc, onSnapshot, getDocs, query, where } from '@angular/fire/firestore';
import * as localforage from 'localforage';
import Swal from 'sweetalert2';
import { esAdminGlobal, esAdminLimitado, sucursalesPermitidas, esSupervisor, mismoEmpleadoNombre, normalizarNombre, puedeSerAsignado } from '../../../shared/permisos.util';
import { nivelDeCargo } from '../../../shared/nivel-jerarquico.util';
import { TareaEquipo, FaseEquipo, ItemEquipo, SubtareaEquipo } from '../../../shared/tareas-equipo.types';
import { esItemHecho, tieneEvidencia } from '../../../shared/item-completado.util';
import { obtenerSemanaISO, obtenerNombreDia } from '../../../shared/descansos.util';
import { RobotRutinasV2Service } from '../../../shared/robot-rutinas-v2.service';
import { RutinaMaestra } from '../../../shared/rutinas.types';
import { AsignacionRutina } from '../../../shared/asignaciones.types';
import { comprimirImagenSiAplica } from '../../../shared/imagen.util';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';

@Component({
  selector: 'app-checklist',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './checklist.html',
  styleUrls: ['./checklist.css']
})
export class ChecklistComponent implements OnInit, OnDestroy {
  ultimaHoraNotificada: number = -1;
  cantidadPendientesAnterior: number = -1;
  notificarPorWhatsApp: boolean = true;
  notificarPorCorreo: boolean = false;
  isModalActividadIntegranteOpen = false;
  integranteActualIndex: number = -1;
  formItemsActividad: any[] = [];
  fasesTemporalesIntegrante: any[] = [];
  nuevaFaseIntegranteTexto: string = '';
  isMenuOpen = false;
  isEditandoTarea = false;
  // ID del doc de checklist que se está editando (modo edición de Tarea Única).
  editandoChecklistId: string | null = null;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  pasoEquipo = 1;
  nombreTareaEquipo = '';
  metaGlobalEquipo = 100;
  integrantesAsignados: any[] = [];
  currentUser: any = null;
  vistaActual = signal<'lista' | 'detalle'>('lista');
  checklistSeleccionado = signal<any>(null);
  terminoBusquedaChecklist = '';
  toastMessage = '';
  integrantesEquipo: any[] = [];
  empleadoSeleccionadoEquipo: string = '';
  mostrarDropdownEquipo: boolean = false;
  isModalEquipoOpen = false;
  notificacionesPendientes = signal<any[]>([]);
  isModalNotificacionOpen = false;
  empleadoParaNotificar = '';
  mensajeNotificacion = '';

  // ⏰ Modal de justificante de retraso (se abre al enviar si hay tareas vencidas)
  isModalJustificanteOpen = false;
  justificanteCategoria: 'Falla de equipo' | 'Falta de personal' | 'Cliente complicado' | 'Otro' | '' = '';
  justificanteComentario = '';
  readonly categoriasJustificante: string[] = [
    'Falla de equipo',
    'Falta de personal',
    'Cliente complicado',
    'Otro'
  ];

  isModalOpen = false;
  formName = '';
  busquedaEmpleadoEquipo: string = '';
  nuevaFaseTexto: string = '';
  fasesTemporales: any[] = [];
  formAssigned: string[] = [];
  formStore = '';

  // ============================================================================
  // Campos extra que aparecen SOLO cuando formStore === 'MANTENIMIENTO'.
  // Permiten capturar orden de servicio: donde esta el problema, que tipo, ubicacion
  // exacta dentro de la sucursal, prioridad y foto del problema antes de intervenir.
  // Se guardan como sub-objeto `mantenimiento` en el doc del checklist.
  // ============================================================================
  formMantSucursalOrigen: string = '';
  formMantTipo: string = '';
  formMantUbicacion: string = '';
  formMantPrioridad: 'urgente' | 'normal' | 'noUrgente' = 'normal';
  formMantFoto: string = '';
  formMantFotoSubiendo: boolean = false;
  tiposMantenimiento: string[] = [
    'Eléctrico', 'Plomería', 'Refrigeración', 'Aire acondicionado',
    'Pintura', 'Carpintería', 'Limpieza profunda', 'Equipo de cómputo', 'Otro'
  ];
  /** Sucursales operativas donde puede ESTAR el problema (excluye Mantenimiento y "ADMINISTRADORES DEL SISTEMA"). */
  sucursalesParaMantenimientoOrigen: string[] = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD',
    'FINANZAS', 'SISTEMAS', 'RH', 'MKT'
  ];
  formItems: any[] = [{
    text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
    permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 60,
    fechaInicio: '', horaInicio: '', fechaLimite: '', horaLimite: '',
    date: '', time: ''
  }];
  isModalRutinasOpen = false;
  isEditMode = false;
  // 📝 Originales antes de editar — para poder borrar el molde viejo aunque
  // el admin cambie el nombre o el asignado en el modal de edición.
  formNameRutinaOriginal = '';
  formAssignedRutinaOriginal = '';
  formNameRutina = '';
  formAssignedRutina: string[] = [];
  formStoreRutina = '';

  // ✅ Reglas de rutina con horaInicio + horaLimite + 📅 fechaInicio + fechaFin
  formRutinas: any[] = [{
    text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
    permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 60,
    frecuencia: 'Diaria', fechaInicio: '', fechaFin: null,
    horaInicio: '', horaLimite: '',
    diaSemana: 'Lunes', diaMes: 1
  }];

  frecuencias = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral'];
  diasDelMes = Array.from({ length: 31 }, (_, i) => i + 1);

  isPasswordModalOpen = false;
  passwordInput = '';
  checklistToDelete: any = null;

  checklists = signal<any[]>([]);
  empleados = signal<any[]>([]);
  /** Admins globales SIEMPRE disponibles (no se filtran por sucursal). Lo usa
   *  el wizard de Tareas de Equipo para que el admin que arma el proyecto pueda
   *  incluir a la gerencia general como integrante o jefe. No se mezcla en
   *  `empleados()` para no contaminar el wizard normal de checklists. */
  adminsGlobales = signal<any[]>([]);
  sucursalesDisponibles = signal<string[]>([]);

  // ===== Tareas de Equipo (proyectos colaborativos en fases) =====
  tareasEquipo = signal<TareaEquipo[]>([]);
  tareaEquipoSeleccionada = signal<TareaEquipo | null>(null);
  vistaEquipo = signal<'lista' | 'detalle'>('lista');

  // Wizard de creación de Tarea en Equipo (4 pasos)
  pasoEquipoWizard: 1 | 2 | 3 | 4 = 1;
  equipoFormName = '';
  equipoFormObjetivo = '';
  equipoFormStore = '';
  equipoFormDate = '';
  equipoFormIntegrantes: string[] = [];
  equipoFormJefe = '';
  /** Fases temporales mientras se crea — cada una con un array de items iniciales. */
  equipoFormFases: { id: string; nombre: string; items: { id: string; asignado: string; texto: string; objetivo?: string; horaLimite?: string; requiresPhoto?: boolean; requiresAntesDespues?: boolean; }[] }[] = [];
  equipoBusquedaIntegrante = '';

  // Estado del agregar-en-vivo dentro de una fase activa (vista detalle)
  agregandoEnFaseId: string | null = null;
  nuevoItemAsignado = '';
  nuevoItemTexto = '';
  nuevoItemHoraLimite = '';
  nuevoItemRequiresPhoto = false;
  agregandoSubtareaItemId: string | null = null;
  nuevaSubtareaTexto = '';

  // Auto-tarea del integrante en tareas de equipo (auto-asignada a sí mismo).
  agregandoTareaPropiaFaseId: string | null = null;
  nuevaTareaPropiaTexto = '';
  nuevaTareaPropiaHora = '';

  // "Agregar mi tarea del día": tarea propia/extra que el trabajador suma a su
  // lista diaria de rutinas (checklist auto-asignado para hoy).
  isModalTareaDiaOpen = false;
  tareaDiaTexto = '';
  tareaDiaHora = '';

  // 🩺 Diagnóstico del último snapshot — alimenta el botón "¿Por qué no veo tareas?"
  // en el estado vacío para inspeccionar el filtrado desde el propio móvil.
  ultimoDiagnostico: any = null;

  // 🎯 Tab activo (Mis / Equipo / Todas). Solo aplica a admin o supervisor;
  // un trabajador puro ya ve solo lo suyo.
  vistaTareas: 'mis' | 'equipo' | 'todas' = 'todas';
  cambiarVistaTareas(v: 'mis' | 'equipo' | 'todas') { this.vistaTareas = v; }

  get puedeFiltrarVista(): boolean {
    const u = this.currentUser;
    if (!u) return false;
    if (u.rol === 'admin') return true;
    return esSupervisor(u);
  }
  get contadorMisChecklists(): number {
    const mi = this.currentUser?.nombre;
    return this.checklists().filter(c => mismoEmpleadoNombre(c.assigned, mi)).length;
  }
  get contadorEquipoChecklists(): number {
    const mi = this.currentUser?.nombre;
    return this.checklists().filter(c => !mismoEmpleadoNombre(c.assigned, mi)).length;
  }
  get contadorTodasChecklists(): number {
    return this.checklists().length;
  }

  // ============================================================================
  //  🧙 WIZARD DE TAREAS ÚNICAS (Modo Asistido para adultos mayores)
  // ============================================================================
  wizardStep: number = 1;
  wizardTotalSteps: number = 7;
  wizardTipoEvidencia: 'ninguna' | 'foto' | 'antesDespues' | 'variasFotos' = 'ninguna';
  terminoBusquedaEmpleadoWizard: string = '';
  // 📅 NUEVO: preset y valor de la fecha en que se ejecuta la tarea
  presetFechaTarea: 'hoy' | 'manana' | 'custom' | '' = '';
  formFechaTarea: string = ''; // YYYY-MM-DD

  /** Fecha de hoy en formato YYYY-MM-DD (para usar como `min` en inputs date). */
  get hoyIsoStr(): string {
    const offset = new Date().getTimezoneOffset() * 60000;
    return new Date(Date.now() - offset).toISOString().split('T')[0];
  }

  // ============================================================================
  //  🧙 WIZARD DE BLOQUE DE RUTINAS (mismo formato asistido)
  // ============================================================================
  wizardStepRutina: number = 1;
  wizardTotalStepsRutina: number = 8;
  wizardTipoEvidenciaRutina: 'ninguna' | 'foto' | 'antesDespues' | 'variasFotos' = 'ninguna';
  terminoBusquedaEmpleadoWizardRutina: string = '';

  private firestore = inject(Firestore);
  private route = inject(ActivatedRoute);
  private robotV2 = inject(RobotRutinasV2Service);
  private usuariosSvc = inject(UsuariosService);
  private destructoresRadares: (() => void)[] = [];
  private intervalId: any;

  // Effect que toma la lista cruda de UsuariosService (listener compartido) y
  // delega a procesarUsuariosCompartidos() para calcular sucursalesDisponibles,
  // adminsGlobales y empleados. Reemplaza el onSnapshot duplicado en
  // conectarRadarNube() — antes este componente abria su propio listener sobre
  // `usuarios` aunque varios otros tambien lo hacian.
  private _usuariosEffect = effect(() => {
    const raw = this.usuariosSvc.usuarios();
    if (raw && raw.length > 0) this.procesarUsuariosCompartidos(raw);
  });

  // 🤖 Robot V2 (Fase 4): cache local del catálogo y las asignaciones.
  // Cuando cualquiera de los dos cambia (o cuando cargamos por primera vez),
  // se dispara `correrRobotV2()` para generar checklists del día desde el
  // nuevo modelo (catálogo + asignaciones). Convive con el V1 (moldes).
  private catalogoV2: RutinaMaestra[] = [];
  private asignacionesV2: AsignacionRutina[] = [];
  private usuariosV2: any[] = [];
  private robotV2Corriendo = false;

  private sucursalesAdministrativas = [
    'ADMINISTRADORES DEL SISTEMA',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD',
    'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
  ];

  // ============================================================================
  //  🎯 CONTADORES EN VIVO
  // ============================================================================
  actividadesValidas(): number {
    return this.formItems.filter((it: any) => it && it.text && it.text.trim() !== '').length;
  }

  totalTareasAGenerar(): number {
    return this.formAssigned.length * this.actividadesValidas();
  }

  totalEjecucionesPorSemana(): number {
    const pesos: Record<string, number> = {
      'Diaria': 7, 'Semanal': 1, 'Catorcenal': 0.5, 'Mensual': 0.25, 'Trimestral': 0.08
    };
    const validas = (this.formRutinas || []).filter(
      (r: any) => r && r.text && r.text.trim() !== ''
    );
    const total = validas.reduce(
      (acc: number, r: any) => acc + (pesos[r.frecuencia] || 0), 0
    );
    return Math.max(0, Math.round(total));
  }

  totalRutinasSemanales(): number {
    return this.totalEjecucionesPorSemana() * (this.formAssignedRutina?.length || 0);
  }

  // ============================================================================
  //  🧙 WIZARD: NAVEGACIÓN Y VALIDACIÓN
  // ============================================================================
  avanzarPasoWizard() {
    if (!this.puedeAvanzarWizard()) return;
    if (this.wizardStep < this.wizardTotalSteps) {
      this.wizardStep++;
    }
  }

  retrocederPasoWizard() {
    if (this.wizardStep > 1) {
      this.wizardStep--;
    }
  }

  irAPasoWizard(paso: number) {
    if (paso >= 1 && paso <= this.wizardTotalSteps) {
      this.wizardStep = paso;
    }
  }

  /** True si la tarea actual del wizard es del area de Mantenimiento. */
  get esTareaMantenimiento(): boolean {
    return this.formStore === 'MANTENIMIENTO';
  }

  /** Campos obligatorios de mantenimiento llenos? (sucursal origen + tipo) */
  private validarMantenimientoMinimo(): boolean {
    if (!this.esTareaMantenimiento) return true;
    return !!this.formMantSucursalOrigen && !!this.formMantTipo;
  }

  /** Sube la foto del problema inicial a Cloudinary. Se llama desde el input file. */
  async onMantFotoChange(event: any) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    this.formMantFotoSubiendo = true;
    try {
      const r = await this.subirACloudinary(file);
      if (r.ok && r.url) {
        this.formMantFoto = r.url;
        this.mostrarToast('Foto del problema subida');
      } else {
        this.mostrarToast('No se pudo subir: ' + (r.error || 'Error desconocido'));
      }
    } finally {
      this.formMantFotoSubiendo = false;
      if (event?.target) event.target.value = '';
    }
  }

  quitarFotoMantenimiento() {
    this.formMantFoto = '';
  }

  /** Labels humanos de la prioridad para el resumen / vista de detalle. */
  prioridadLabel(p: string): string {
    if (p === 'urgente') return 'Urgente';
    if (p === 'noUrgente') return 'No urgente';
    return 'Normal';
  }

  puedeAvanzarWizard(): boolean {
    switch (this.wizardStep) {
      case 1: return !!this.formName && this.formName.trim().length > 0;
      case 2: return !!this.formStore && this.validarMantenimientoMinimo();
      case 3: return this.formAssigned.length > 0;
      case 4: return !!this.presetFechaTarea && !!this.formFechaTarea; // 📅 fecha de ejecución
      case 5: return !!this.formItems[0]?.horaInicio && !!this.formItems[0]?.horaLimite;
      case 6: return true; // evidencia
      case 7: return true; // resumen
      default: return false;
    }
  }

  seleccionarTipoEvidencia(tipo: 'ninguna' | 'foto' | 'antesDespues' | 'variasFotos') {
    this.wizardTipoEvidencia = tipo;
    if (!this.formItems[0]) return;
    this.formItems[0].requiresPhoto = false;
    this.formItems[0].requiresAntesDespues = false;
    this.formItems[0].requiresVariasFotos = false;
    if (tipo === 'foto') this.formItems[0].requiresPhoto = true;
    else if (tipo === 'antesDespues') this.formItems[0].requiresAntesDespues = true;
    else if (tipo === 'variasFotos') this.formItems[0].requiresVariasFotos = true;
  }

  /** Cambia el tiempo (en minutos) entre la foto "Antes" y la foto "Después". 0 = sin límite. */
  seleccionarTiempoAntesDespues(minutos: number) {
    if (this.formItems[0]) this.formItems[0].tiempoEstimado = minutos;
  }

  /** Cambia el tiempo (en minutos) entre la foto "Antes" y la foto "Después" en rutinas. */
  seleccionarTiempoAntesDespuesRutina(minutos: number) {
    if (this.formRutinas[0]) this.formRutinas[0].tiempoEstimado = minutos;
  }

  /** Texto humano del tiempo entre Antes/Después (para el resumen). */
  getTextoTiempoAD(minutos: number | null | undefined): string {
    if (!minutos || minutos <= 0) return 'Sin límite';
    if (minutos === 30) return '30 minutos';
    if (minutos === 60) return '1 hora';
    if (minutos === 120) return '2 horas';
    if (minutos === 240) return '4 horas';
    if (minutos % 60 === 0) return `${minutos / 60} horas`;
    return `${minutos} minutos`;
  }

  get empleadosFiltradosWizard() {
    let lista = this.empleadosFiltrados;
    if (this.terminoBusquedaEmpleadoWizard.trim() !== '') {
      const t = this.terminoBusquedaEmpleadoWizard.toLowerCase();
      lista = lista.filter(emp => emp.nombre.toLowerCase().includes(t));
    }
    return lista;
  }

  getResumenEvidencia(): string {
    switch (this.wizardTipoEvidencia) {
      case 'foto': return 'Sí, una foto';
      case 'antesDespues': return 'Sí, foto Antes y Después';
      default: return 'No requiere foto';
    }
  }

  getEmpleadosResumen(): string {
    if (this.formAssigned.length === 0) return 'Nadie';
    if (this.formAssigned.length === 1) return this.formAssigned[0];
    if (this.formAssigned.length <= 3) return this.formAssigned.join(', ');
    return `${this.formAssigned[0]}, ${this.formAssigned[1]} y ${this.formAssigned.length - 2} más`;
  }

  ponerHoraInicio(hora: string) {
    if (this.formItems[0]) this.formItems[0].horaInicio = hora;
  }

  ponerHoraLimite(hora: string) {
    if (this.formItems[0]) this.formItems[0].horaLimite = hora;
  }

  /** 📅 Aplica un preset de fecha (hoy / mañana / personalizar) al formulario. */
  seleccionarPresetFechaTarea(preset: 'hoy' | 'manana' | 'custom') {
    this.presetFechaTarea = preset;
    const offset = new Date().getTimezoneOffset() * 60000;
    if (preset === 'hoy') {
      this.formFechaTarea = new Date(Date.now() - offset).toISOString().split('T')[0];
    } else if (preset === 'manana') {
      this.formFechaTarea = new Date(Date.now() + 86400000 - offset).toISOString().split('T')[0];
    }
    // En 'custom' el usuario llena el input manualmente
  }

  /** 📅 Texto humano para el resumen del paso final. */
  getResumenFechaTarea(): string {
    if (!this.formFechaTarea) return 'Sin fecha';
    if (this.presetFechaTarea === 'hoy') return `📅 Hoy (${this.formFechaTarea})`;
    if (this.presetFechaTarea === 'manana') return `📅 Mañana (${this.formFechaTarea})`;
    return `📅 ${this.formFechaTarea}`;
  }

  finalizarWizard() {
    if (this.formItems[0]) {
      this.formItems[0].text = this.formName;
      // 📅 Aplica la fecha elegida al item — se guardará en `date` del checklist
      this.formItems[0].fechaLimite = this.formFechaTarea;
    }
    this.guardarChecklistUnico();
  }

  // ============================================================================
  //  🧙 WIZARD DE RUTINAS: NAVEGACIÓN Y VALIDACIÓN
  // ============================================================================
  avanzarPasoWizardRutina() {
    if (!this.puedeAvanzarWizardRutina()) return;
    if (this.wizardStepRutina < this.wizardTotalStepsRutina) {
      this.wizardStepRutina++;
    }
  }

  retrocederPasoWizardRutina() {
    if (this.wizardStepRutina > 1) {
      this.wizardStepRutina--;
    }
  }

  irAPasoWizardRutina(paso: number) {
    if (paso >= 1 && paso <= this.wizardTotalStepsRutina) {
      this.wizardStepRutina = paso;
    }
  }

  puedeAvanzarWizardRutina(): boolean {
    const regla = this.formRutinas[0];
    switch (this.wizardStepRutina) {
      case 1: return !!this.formNameRutina && this.formNameRutina.trim().length > 0;
      case 2: return !!this.formStoreRutina;
      case 3: return !!regla?.frecuencia;                                   // 🔁 Frecuencia (era paso 4)
      case 4: return !!regla?.horaInicio && !!regla?.horaLimite;            // 🕒 Horario
      case 5: {                                                              // 📅 Vigencia
        if (!regla?.fechaInicio) return false;
        if (regla?.fechaFin && regla.fechaFin < regla.fechaInicio) return false;
        return true;
      }
      case 6: return true;                                                   // 📷 Evidencia
      case 7: return this.formAssignedRutina.length > 0;                     // 👤 Empleados (movido al final)
      case 8: return true;                                                   // ✅ Resumen
      default: return false;
    }
  }

  /** 📅 Resumen humano de la vigencia (Desde X hasta Y). */
  getResumenVigenciaRutina(): string {
    const r = this.formRutinas[0];
    if (!r?.fechaInicio) return 'Sin vigencia';
    if (r.fechaFin) return `Del ${r.fechaInicio} al ${r.fechaFin}`;
    return `Desde ${r.fechaInicio} (sin fecha de fin)`;
  }

  seleccionarTipoEvidenciaRutina(tipo: 'ninguna' | 'foto' | 'antesDespues' | 'variasFotos') {
    this.wizardTipoEvidenciaRutina = tipo;
    if (!this.formRutinas[0]) return;
    this.formRutinas[0].requiresPhoto = false;
    this.formRutinas[0].requiresAntesDespues = false;
    this.formRutinas[0].requiresVariasFotos = false;
    if (tipo === 'foto') this.formRutinas[0].requiresPhoto = true;
    else if (tipo === 'antesDespues') this.formRutinas[0].requiresAntesDespues = true;
    else if (tipo === 'variasFotos') this.formRutinas[0].requiresVariasFotos = true;
  }

  seleccionarFrecuenciaRutina(frecuencia: string) {
    if (!this.formRutinas[0]) return;
    this.formRutinas[0].frecuencia = frecuencia;
  }

  get empleadosFiltradosWizardRutina() {
    let lista = this.empleadosFiltradosRutina;
    if (this.terminoBusquedaEmpleadoWizardRutina.trim() !== '') {
      const t = this.terminoBusquedaEmpleadoWizardRutina.toLowerCase();
      lista = lista.filter(emp => emp.nombre.toLowerCase().includes(t));
    }
    return lista;
  }

  getResumenEvidenciaRutina(): string {
    switch (this.wizardTipoEvidenciaRutina) {
      case 'foto': return 'Sí, una foto';
      case 'antesDespues': return 'Sí, foto Antes y Después';
      default: return 'No requiere foto';
    }
  }

  getEmpleadosResumenRutina(): string {
    if (this.formAssignedRutina.length === 0) return 'Nadie';
    if (this.formAssignedRutina.length === 1) return this.formAssignedRutina[0];
    if (this.formAssignedRutina.length <= 3) return this.formAssignedRutina.join(', ');
    return `${this.formAssignedRutina[0]}, ${this.formAssignedRutina[1]} y ${this.formAssignedRutina.length - 2} más`;
  }

  getResumenFrecuenciaRutina(): string {
    const r = this.formRutinas[0];
    if (!r) return '';
    if (r.frecuencia === 'Diaria') return 'Todos los días';
    if (r.frecuencia === 'Semanal') return `Cada semana, los ${r.diaSemana || 'Lunes'}`;
    if (r.frecuencia === 'Catorcenal') return `Cada 2 semanas, los ${r.diaSemana || 'Lunes'}`;
    if (r.frecuencia === 'Mensual') return `Los días ${r.diaMes || 1} del mes`;
    if (r.frecuencia === 'Trimestral') return `El día ${r.diaMes || 1} cada 3 meses`;
    return '';
  }

  ponerHoraInicioRutina(hora: string) {
    if (this.formRutinas[0]) this.formRutinas[0].horaInicio = hora;
  }

  ponerHoraLimiteRutina(hora: string) {
    if (this.formRutinas[0]) this.formRutinas[0].horaLimite = hora;
  }

  finalizarWizardRutina() {
    if (this.formRutinas[0]) this.formRutinas[0].text = this.formNameRutina;
    this.guardarBloqueRutinas();
  }

  asignarATodoMiPersonalRutina() {
    const lista = this.empleadosFiltradosRutina.map(emp => emp.nombre);
    this.formAssignedRutina = [...lista];
    this.mostrarToast(` 🚀 Se asignaron ${lista.length} personas.`);
  }

  // ============================================================================

  asignarATodos(tipo: 'tarea' | 'rutina') {
    const empleadosParaAsignar = tipo === 'tarea' ? this.empleadosFiltrados : this.empleadosFiltradosRutina;
    if (empleadosParaAsignar.length === 0) {
      this.mostrarToast(' ⚠️ No hay empleados en esta sucursal para asignar.');
      return;
    }
    const nombres = empleadosParaAsignar.map(emp => emp.nombre);
    if (tipo === 'tarea') this.formAssigned = [...nombres];
    else this.formAssignedRutina = [...nombres];
    this.mostrarToast(` ✅ Se asignaron ${nombres.length} empleados.`);
  }

  desmarcarTodos(tipo: 'tarea' | 'rutina') {
    if (tipo === 'tarea') this.formAssigned = [];
    else this.formAssignedRutina = [];
  }

  esSucursalAdministrativa(sucursal: string): boolean {
    return this.sucursalesAdministrativas.includes(sucursal);
  }

  get empleadosFiltrados() {
    if (!this.formStore) return this.empleados();
    return this.empleados().filter(emp => this.empleadoPerteneceASucursal(emp, this.formStore));
  }

  get empleadosFiltradosRutina() {
    if (!this.formStoreRutina) return this.empleados();
    return this.empleados().filter(emp => this.empleadoPerteneceASucursal(emp, this.formStoreRutina));
  }

  /**
   * ¿Este empleado se puede asignar en `store`?
   *
   * - Sucursal "ADMINISTRADORES DEL SISTEMA": solo admins.
   * - Admins: aparecen SOLO si tienen esa sucursal explícitamente en su lista.
   *   No usamos el atajo 'General (Acceso Total)' para ellos, para no saturar
   *   cada sucursal con la gerencia general. (Petición del cliente.)
   * - Trabajadores: lógica original — 'General (Acceso Total)' los pone en todas.
   * - EXCEPCION: el creador (usuario actual) SIEMPRE se ve a si mismo, aunque
   *   no tenga la sucursal explicita. Sin esto, un admin global no puede
   *   asignarse las tareas que el mismo crea para sucursales especificas.
   */
  private empleadoPerteneceASucursal(emp: any, store: string): boolean {
    if (store === 'ADMINISTRADORES DEL SISTEMA') return emp.rol === 'admin';
    // El creador siempre se ve a si mismo
    if (emp.usuario && this.currentUser?.usuario && emp.usuario === this.currentUser.usuario) {
      return true;
    }
    // Asignable a esta sucursal (comparación normalizada; admin global y comodín
    // 'General (Acceso Total)' aplican a cualquier sucursal). Incluye admins:
    // hay cargos operativos con cuenta admin que igual reciben tareas.
    return puedeSerAsignado(emp, store ? [store] : []);
  }

  /**
   * Map cache (nombre normalizado → nivel) construido una sola vez cada vez
   * que cambia `empleados()`. Antes hacíamos `.find()` en empleados por cada
   * checklist en cada render → cientos de iteraciones por ciclo de change
   * detection. Ahora es O(1).
   */
  private _nivelPorNombre = new Map<string, 'mando' | 'operativo'>();
  private _empleadosVersion = -1;
  private actualizarMapaNivelSiCambio() {
    const empleados = this.empleados();
    if (empleados.length === this._empleadosVersion) return;
    this._empleadosVersion = empleados.length;
    const mapa = new Map<string, 'mando' | 'operativo'>();
    for (const e of empleados) {
      if (!e?.nombre) continue;
      mapa.set((e.nombre || '').trim().toLowerCase(), nivelDeCargo(e.cargo));
    }
    this._nivelPorNombre = mapa;
  }

  /**
   * Devuelve el nivel jerárquico ('mando' | 'operativo') de la persona a la
   * que está asignado un checklist. Usa el Map cacheado.
   */
  nivelDelAssigned(assigned: string | undefined | null): 'mando' | 'operativo' {
    if (!assigned) return 'operativo';
    this.actualizarMapaNivelSiCambio();
    return this._nivelPorNombre.get(assigned.trim().toLowerCase()) || 'operativo';
  }

  /**
   * Cache de los 3 derivados (mandos, operativos, ordenados) recalculado solo
   * cuando cambia la huella: length de checklists + tab + busqueda + version
   * de empleados. Antes estos eran 3 getters separados que se invocaban en
   * cada change detection y cada uno recorría toda la lista filtrada.
   */
  private _cacheChecklistsHuella = '';
  private _cacheChecklistsMandos: any[] = [];
  private _cacheChecklistsOperativos: any[] = [];
  private _cacheChecklistsOrdenados: any[] = [];
  private actualizarCacheChecklistsSiCambio() {
    const filtrados = this.checklistsFiltrados;
    const huella = `${filtrados.length}-${this.vistaTareas}-${this.terminoBusquedaChecklist}-${this._empleadosVersion}`;
    if (huella === this._cacheChecklistsHuella) return;
    this._cacheChecklistsHuella = huella;
    const mandos: any[] = [];
    const operativos: any[] = [];
    for (const c of filtrados) {
      if (this.nivelDelAssigned(c.assigned) === 'mando') mandos.push(c);
      else operativos.push(c);
    }
    this._cacheChecklistsMandos = mandos;
    this._cacheChecklistsOperativos = operativos;
    this._cacheChecklistsOrdenados = [...mandos, ...operativos];
  }

  /** Sublista de mandos del set filtrado actual. Alimenta la sub-sección "Mandos de sucursal". */
  get checklistsDeMandos() {
    this.actualizarCacheChecklistsSiCambio();
    return this._cacheChecklistsMandos;
  }
  /** Sublista de operativos del set filtrado actual. Alimenta la sub-sección "Operativos". */
  get checklistsDeOperativos() {
    this.actualizarCacheChecklistsSiCambio();
    return this._cacheChecklistsOperativos;
  }
  /**
   * Lista filtrada ordenada por nivel: mandos primero, después operativos.
   * El template itera con `*ngFor` único + separadores cuando cambia el nivel.
   */
  get checklistsOrdenadosPorNivel() {
    this.actualizarCacheChecklistsSiCambio();
    return this._cacheChecklistsOrdenados;
  }

  /**
   * Cache de `checklistsFiltrados`. Recalcula solo si cambian length de
   * checklists, vistaTareas o el termino de búsqueda. Sin esto, los templates
   * lo evaluaban en cada change detection y cada vez recorría toda la lista.
   */
  private _cacheFiltradosHuella = '';
  private _cacheFiltrados: any[] = [];
  get checklistsFiltrados() {
    const huella = `${this.checklists().length}-${this.vistaTareas}-${this.terminoBusquedaChecklist}-${this.currentUser?.nombre || ''}`;
    if (huella === this._cacheFiltradosHuella) return this._cacheFiltrados;
    this._cacheFiltradosHuella = huella;
    let lista = this.checklists();

    // Filtro por pestaña (Mis / Equipo / Todas). Solo aplica si el usuario
    // puede alternar — para trabajadores puros, la lista ya viene filtrada por
    // su nombre desde el snapshot. Match tolerante a apellido extra/de menos.
    if (this.puedeFiltrarVista && this.vistaTareas !== 'todas') {
      const mi = this.currentUser?.nombre;
      lista = lista.filter(c => {
        const esMia = mismoEmpleadoNombre(c.assigned, mi);
        return this.vistaTareas === 'mis' ? esMia : !esMia;
      });
    }

    // Filtro por búsqueda libre (texto en nombre/empleado/sucursal).
    const termino = this.terminoBusquedaChecklist.trim().toLowerCase();
    if (termino) {
      lista = lista.filter(c =>
        c.name?.toLowerCase().includes(termino) ||
        c.assigned?.toLowerCase().includes(termino) ||
        c.store?.toLowerCase().includes(termino)
      );
    }
    this._cacheFiltrados = lista;
    return lista;
  }

  mostrarToast(mensaje: string) {
    this.toastMessage = mensaje;
    setTimeout(() => { this.toastMessage = ''; }, 3500);
  }

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) this.currentUser = JSON.parse(sesion);
    // Listener compartido de usuarios (refcount; no abre uno duplicado si ya existe).
    this.usuariosSvc.iniciar();
    this.conectarRadarNube();
    this.iniciarRobotNotificador();
    this.route.queryParams.subscribe(params => {
      if (params['assign'] && params['modal']) {
        setTimeout(() => {
          if (params['modal'] === 'tarea') {
            this.abrirModal();
            this.formAssigned = [params['assign']];
          } else if (params['modal'] === 'rutina') {
            this.abrirModalRutinas();
            this.formAssignedRutina = [params['assign']];
          }
        }, 500);
      }
    });
    // (Nota: this.intervalId se setea en iniciarRobotNotificador())
  }

  ngOnDestroy() {
    // 🔥 Cierra todos los listeners de Firestore para evitar memory leaks
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
    this.destructoresRadares = [];
    // Soltar el refcount del listener compartido de usuarios
    this.usuariosSvc.detener();
    // 🔥 Detiene el robot notificador (setInterval de 30s)
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** ¿El usuario actual es el dueño del checklist actualmente abierto?
   *  Match tolerante a tildes/espacios/apellido extra (para que Jorge Alberto
   *  Duarte Vazquez pueda editar tareas asignadas a Jorge Alberto Duarte). */
  esElDueno(): boolean {
    const cs = this.checklistSeleccionado();
    if (!cs) return false;
    return mismoEmpleadoNombre(this.currentUser?.nombre, cs.assigned);
  }

  /** ¿Puede editar el checklist actual? (es el dueño y no se ha enviado). */
  puedoEditarChecklistActivo(): boolean {
    const cs = this.checklistSeleccionado();
    if (!cs || cs.enviado) return false;
    return this.esElDueno();
  }

  /**
   * ¿Puede editar/subir evidencia en este item?
   *
   * Ya NO se bloquea por vencimiento: aunque la tarea pase de su hora límite,
   * el trabajador puede seguir completándola y subir evidencia. Al enviar el
   * checklist se le pedirá el justificante de retraso (ver enviarChecklist).
   * Solo se bloquea si el checklist ya fue enviado o no es el dueño.
   */
  puedoEditarItem(_item: any): boolean {
    return this.puedoEditarChecklistActivo();
  }

  /** Agrega una foto al array item.photos[] (para tareas con `requiresVariasFotos`). */
  async onMultiplePhotoSelected(event: any, item: any) {
    const file = event.target.files[0];
    if (!file) return;
    if (!item.photos) item.photos = [];
    // Reutiliza el flujo existente: subimos al servidor y agregamos la URL al array.
    // Aprovechamos onFileSelected con un objeto temporal y luego empujamos al array.
    const tempItem: any = {};
    await this.onFileSelected(event, tempItem, 'photo');
    if (tempItem.photo && tempItem.photo !== 'subiendo...') {
      item.photos.push({ url: tempItem.photo, time: tempItem.photoTime || '' });
      this.actualizarEstado();
    }
  }

  /** Quita una foto del array item.photos[] por índice. */
  removerFotoDeArray(item: any, index: number) {
    if (item.photos && index >= 0 && index < item.photos.length) {
      item.photos.splice(index, 1);
      this.actualizarEstado();
    }
  }

  isDespuesExpirado(item: any): boolean {
    if (!item.requiresAntesDespues || !item.photoAntesTimestamp) return false;
    // El "Después" expira cuando expira la TAREA (su horaLimite/time del día).
    // Antes esto se basaba en un contador entre fotos — quitado a petición.
    const fecha = this.checklistSeleccionado()?.date;
    if (!fecha) return false;
    return this.isTareaVencida(item, fecha);
  }

  /** Hora límite efectiva del item (HH:mm), o fallback a la del checklist. */
  horaLimiteItem(item: any): string {
    return item?.horaLimite || item?.time || this.checklistSeleccionado()?.time || '23:59';
  }

  iniciarRobotNotificador() {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
    // 🔥 FIX MEMORY LEAK: guardamos la referencia para limpiar en ngOnDestroy.
    // Antes este setInterval quedaba huérfano. Cada vez que el admin entraba
    // a Checklist se acumulaba uno nuevo → 20 entradas = 20 intervals corriendo.
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      const ahora = new Date();
      if (ahora.getMinutes() === 0 && this.ultimaHoraNotificada !== ahora.getHours()) {
        this.ultimaHoraNotificada = ahora.getHours();
        this.verificarYNotificarPendientes();
      }
    }, 30000);
  }

  verificarYNotificarPendientes() {
    const misPendientes = this.checklists().filter(c => c.status !== 'completo' && c.enviado !== true);
    if (misPendientes.length > 0) {
      const mensaje = `Tienes ${misPendientes.length} checklist(s) pendientes por terminar. ¡No te retrases! 🕒`;
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Mega Dulces Task 🍭', { body: mensaje, vibrate: [200, 100, 200] } as any);
      }
      this.mostrarToast(`⏰ ¡Hora de checar! ${mensaje}`);
    }
  }

  lanzarNotificacionInmediata() {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Nueva Tarea - Mega Dulces 🍭', { body: '¡Acaban de asignarte una nueva tarea! Entra a revisarla. 🚀', vibrate: [300, 100, 300] } as any);
    }
    this.mostrarToast('🔔 ¡Te acaban de asignar una nueva tarea!');
  }

  /**
   * Calcula sucursalesDisponibles, adminsGlobales y empleados a partir de la
   * lista cruda de usuarios. Se llama desde el effect _usuariosEffect cada
   * vez que el UsuariosService publica una actualizacion del snapshot
   * compartido. Antes vivia inline en el callback del onSnapshot dedicado.
   */
  procesarUsuariosCompartidos(todosLosUsuarios: any[]) {
    // Cache para el Robot V2 (necesita expandir roles → personas)
    this.usuariosV2 = todosLosUsuarios;
    this.dispararRobotV2();

    const todasLasSucursales = [
      'ADMINISTRADORES DEL SISTEMA', 'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
      'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro', 'OFICINAS CORPORATIVAS',
      'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
    ];

    // Version VIVA del usuario actual (no la stale del localStorage).
    const yoVivo = todosLosUsuarios.find((u: any) =>
      (this.currentUser?.usuario && u.usuario === this.currentUser.usuario) ||
      (this.currentUser?.uid && u.uid === this.currentUser.uid)
    ) || this.currentUser;
    if (yoVivo && yoVivo !== this.currentUser) {
      this.currentUser = { ...this.currentUser, ...yoVivo };
      try { localStorage.setItem('md_sesion_actual', JSON.stringify(this.currentUser)); } catch (e) { /* noop */ }
    }

    // SUCURSALES DISPONIBLES
    if (esAdminGlobal(yoVivo)) {
      this.sucursalesDisponibles.set(todasLasSucursales);
    } else if (esAdminLimitado(yoVivo) || yoVivo?.puedeCrearChecklists) {
      const permitidas = sucursalesPermitidas(yoVivo);
      if (permitidas === null) {
        // null = acceso a TODAS (admin con comodin 'General (Acceso Total)').
        // OJO: antes esto se volvia [] y dejaba la lista vacia (bug de Ivette).
        this.sucursalesDisponibles.set(todasLasSucursales.filter(s => s !== 'ADMINISTRADORES DEL SISTEMA'));
      } else {
        const misSucNorm = new Set(permitidas.map(s => normalizarNombre(s)));
        const sucursalesFiltradas = todasLasSucursales.filter(
          s => s !== 'ADMINISTRADORES DEL SISTEMA' && misSucNorm.has(normalizarNombre(s))
        );
        this.sucursalesDisponibles.set(sucursalesFiltradas);
        if (sucursalesFiltradas.length === 0) {
          console.warn('[checklist] Lista de sucursales vacia para Nueva Tarea. ' +
            `rol=${yoVivo?.rol} alcance=${yoVivo?.alcance} ` +
            `sucursales=${JSON.stringify(yoVivo?.sucursales)} ` +
            `puedeCrearChecklists=${!!yoVivo?.puedeCrearChecklists}. ` +
            'Si tienes sucursales asignadas, verifica que esten escritas exactamente como en el catalogo (tildes, mayusculas).');
        }
      }
    } else {
      this.sucursalesDisponibles.set([]);
      console.warn('[checklist] No tienes permisos para crear tareas. ' +
        `rol=${yoVivo?.rol} alcance=${yoVivo?.alcance} ` +
        `puedeCrearChecklists=${!!yoVivo?.puedeCrearChecklists}. ` +
        'Si esto es un error, pidele al admin global que te active "Crear checklists" o te haga admin limitado.');
    }

    // Admins globales (para wizard de Tareas en Equipo)
    const globales = todosLosUsuarios.filter((u: any) =>
      u.rol === 'admin' && ((u.alcance ?? 'global') === 'global'
                            || (u.sucursales || []).includes('General (Acceso Total)'))
    );
    this.adminsGlobales.set(globales);

    // Empleados que el usuario actual puede asignar
    if (esAdminGlobal(this.currentUser)) {
      const personalActivo = todosLosUsuarios.filter((u: any) => u.rol === 'trabajador' || u.rol === 'admin');
      this.empleados.set(personalActivo);
    } else if (esAdminLimitado(this.currentUser) || this.currentUser?.puedeCrearChecklists) {
      const permitidas = sucursalesPermitidas(this.currentUser);
      const misSucursales = permitidas ?? [];
      // Candidatos: trabajadores + admins (incluye admin global). Algunos cargos
      // operativos tienen cuenta admin y aun asi deben poder recibir tareas.
      const candidatos = todosLosUsuarios.filter((u: any) => u.rol === 'trabajador' || u.rol === 'admin');
      // Asignables en las sucursales del usuario actual (normalizado; admin global
      // y comodín 'General (Acceso Total)' pasan en cualquier sucursal).
      const empleadosFiltrados = candidatos.filter((t: any) => puedeSerAsignado(t, misSucursales));
      this.empleados.set(empleadosFiltrados);
    }
  }

  conectarRadarNube() {
    // La coleccion `usuarios` ya viene por UsuariosService (listener compartido).
    // El effect _usuariosEffect llama procesarUsuariosCompartidos() cada vez que
    // se actualiza. No abrimos onSnapshot duplicado aqui.

    const moldesRef = collection(this.firestore, 'moldes_checklists');
    const radarMoldes = onSnapshot(moldesRef, (snapshot) => {
      const moldesActivos: any[] = [];
      snapshot.forEach(docSnap => moldesActivos.push(docSnap.data()));
      this.ejecutarRobotRutinas(moldesActivos);
    });
    this.destructoresRadares.push(radarMoldes);

    // 🤖 ROBOT V2 (Fase 4): escucha catalogo_rutinas + asignaciones_rutinas
    // y genera checklists desde el modelo nuevo. Convive con el V1.
    const catalogoRef = collection(this.firestore, 'catalogo_rutinas');
    const radarCatalogo = onSnapshot(catalogoRef, (snapshot) => {
      const arr: RutinaMaestra[] = [];
      snapshot.forEach(d => {
        const data = d.data() as any;
        if (data.activa !== false) arr.push({ ...data, id: d.id });
      });
      this.catalogoV2 = arr;
      this.dispararRobotV2();
    });
    this.destructoresRadares.push(radarCatalogo);

    const asignacionesRef = collection(this.firestore, 'asignaciones_rutinas');
    const radarAsignaciones = onSnapshot(asignacionesRef, (snapshot) => {
      const arr: AsignacionRutina[] = [];
      snapshot.forEach(d => {
        const data = d.data() as any;
        if (data.activa !== false) arr.push({ ...data, id: d.id });
      });
      this.asignacionesV2 = arr;
      this.dispararRobotV2();
    });
    this.destructoresRadares.push(radarAsignaciones);

    // 📅 SOLO HOY: el trabajador ve únicamente las tareas del día de hoy.
    // Las que vencieron su HORA siguen siendo de hoy, así que siguen apareciendo
    // y se pueden enviar con retardo (con justificante). NO se arrastran días
    // anteriores: las de ayer ya son historia.
    const offset = new Date().getTimezoneOffset() * 60000;
    const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];

    // 🔒 Lee la sesión actualizada desde localStorage en CADA snapshot. Si solo
    // usamos `this.currentUser` (que se setea una vez en ngOnInit), una persona
    // que cambió permisos vería el filtro viejo hasta que cierre sesión y vuelva.
    // Mismo patrón que home.ts.
    const leerSesion = (): any => {
      try { return JSON.parse(localStorage.getItem('md_sesion_actual') || 'null'); }
      catch { return null; }
    };

    const checklistsRef = collection(this.firestore, 'checklists');
    const checklistsQuery = query(checklistsRef, where('date', '>=', fechaHoyLocal));
    const radarChecklists = onSnapshot(checklistsQuery, (snapshot) => {
      const todasLasListas: any[] = [];
      let descartadosEnviados = 0;
      let descartadosEliminados = 0;
      let descartadosFecha = 0;
      // 🩺 Diagnóstico: guarda los assigned de TODO lo que existe hoy (incluye
      // enviados/eliminados), separado por motivo. Permite ver si el checklist
      // del usuario existe pero quedó marcado como enviado/eliminado.
      const muestraEnviados: { id: string; assigned: string; name: string }[] = [];
      const muestraEliminados: { id: string; assigned: string; name: string }[] = [];
      const todosAssignedHoy = new Set<string>();

      snapshot.forEach(docSnap => {
        const c = docSnap.data() as any;
        const docId = docSnap.id;
        if (c.date === fechaHoyLocal && c.assigned) todosAssignedHoy.add(c.assigned);
        if (c.eliminado === true || c.archivado === true) {
          descartadosEliminados++;
          if (c.assigned) muestraEliminados.push({ id: docId, assigned: c.assigned, name: c.name });
          return;
        }
        if (c.enviado === true) {
          descartadosEnviados++;
          if (c.assigned) muestraEnviados.push({ id: docId, assigned: c.assigned, name: c.name });
          return;
        }
        // Solo HOY: el query trae hoy en adelante; aquí excluimos cualquier fecha futura.
        if (c.date !== fechaHoyLocal) { descartadosFecha++; return; }
        // 🔢 Progreso visual: una tarea cuenta como completa si TIENE su evidencia
        // (foto / antes+después / varias fotos / palomeo) O si el checklist trae
        // una nota del colaborador o se entregó con retraso justificado. Usamos
        // el helper unificado para mantener consistencia con Dashboard, Auditoría,
        // Checkstore, Estadísticas y Ranking.
        const tareasMarcadas = (c.items || []).filter((i: any) => esItemHecho(i, c)).length;
        c.calcCompletados = tareasMarcadas;
        c.calcProgreso = Math.round((tareasMarcadas / (c.items?.length || 1)) * 100) || 0;
        todasLasListas.push(c);
      });

      const listasSinClones = new Map();
      todasLasListas.forEach(c => {
        const firma = `${c.name}_${c.assigned}_${c.store}_${c.date}`;
        if (!listasSinClones.has(firma)) {
          listasSinClones.set(firma, c);
        } else {
          const existente = listasSinClones.get(firma);
          if (c.calcProgreso > existente.calcProgreso) listasSinClones.set(firma, c);
        }
      });
      const listasFinales = Array.from(listasSinClones.values());
      listasFinales.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return b.timestampCreacion - a.timestampCreacion;
      });

      // Recalculamos permisos cada vez desde la sesión FRESCA en localStorage
      // (currentUser podría estar viejo si el admin le cambió permisos).
      const sesion = leerSesion() || this.currentUser;
      const esGlobal = esAdminGlobal(sesion);
      const esLimitado = esAdminLimitado(sesion);
      const supervisor = esSupervisor(sesion);
      const permitidas = sucursalesPermitidas(sesion);
      const esTrabajadorPuro = sesion?.rol === 'trabajador' && !supervisor;

      let resultado: any[];
      let rama: string;
      if (esGlobal) {
        rama = 'admin-global';
        resultado = listasFinales;
      } else if (esLimitado) {
        rama = 'admin-limitado';
        resultado = listasFinales.filter((c: any) => (permitidas ?? []).includes(c.store));
      } else if (supervisor) {
        rama = 'supervisor';
        resultado = listasFinales.filter((c: any) => (permitidas ?? []).includes(c.store));
      } else {
        rama = 'trabajador-puro';
        // 🔥 Match tolerante: tildes/espacios/casing + apellido extra/de menos
        // (perfil "Jorge Alberto Duarte Vazquez" matchea assigned "Jorge Alberto Duarte").
        const miNombre = sesion?.nombre;
        resultado = listasFinales.filter((c: any) => mismoEmpleadoNombre(c.assigned, miNombre));
      }

      this.checklists.set(resultado);

      // 🐛 DEBUG para diagnosticar por qué un usuario ve 0 tareas.
      // Guardamos en `ultimoDiagnostico` para mostrar inline (móvil sin consola).
      // Resaltamos los checklists que matchearían contra el nombre del usuario,
      // separando los que están vivos vs los marcados como enviados/eliminados.
      const miNombre = sesion?.nombre || '';
      const matcheaUsuario = (assigned: string) => mismoEmpleadoNombre(assigned, miNombre);
      this.ultimoDiagnostico = {
        usuario: sesion?.usuario, nombre: sesion?.nombre, rol: sesion?.rol,
        alcance: sesion?.alcance, sucursales: sesion?.sucursales,
        rama, descartadosEliminados, descartadosEnviados, descartadosFecha,
        crudoTrasFiltro: listasFinales.length, resultadoFinal: resultado.length,
        fechaHoyLocal,
        // Lista única de empleados con tareas hoy (en cualquier estado)
        empleadosConTareasHoy: Array.from(todosAssignedHoy).sort(),
        // ¿Existen tareas para este usuario en otros estados?
        misEnviadosHoy: muestraEnviados.filter(x => matcheaUsuario(x.assigned)),
        misEliminadosHoy: muestraEliminados.filter(x => matcheaUsuario(x.assigned)),
        primerosAssigned: resultado.slice(0, 3).map((c: any) => c.assigned),
        crudoAssignedMuestra: listasFinales.slice(0, 10).map((c: any) => `${c.assigned}@${c.store} [${c.date}]`)
      };
      console.log('[DBG checklist]', this.ultimoDiagnostico);

      if (esTrabajadorPuro) {
        const pendientesActuales = resultado.filter((c: any) => c.status !== 'completo' && c.enviado !== true).length;
        if (this.cantidadPendientesAnterior !== -1 && pendientesActuales > this.cantidadPendientesAnterior) {
          this.lanzarNotificacionInmediata();
        }
        this.cantidadPendientesAnterior = pendientesActuales;
      }
    });
    this.destructoresRadares.push(radarChecklists);

    // Radar de Tareas de Equipo (colección separada `tareas_equipo`).
    // Cada usuario solo ve las tareas donde es integrante, jefe o admin.
    const tareasEquipoRef = collection(this.firestore, 'tareas_equipo');
    const radarTareasEquipo = onSnapshot(tareasEquipoRef, (snapshot) => {
      const sesion = leerSesion() || this.currentUser;
      const esGlobal = esAdminGlobal(sesion);
      const esLimitado = esAdminLimitado(sesion);
      const permitidas = sucursalesPermitidas(sesion);
      const miNombre = sesion?.nombre;

      const arr: TareaEquipo[] = [];
      snapshot.forEach(d => {
        const data = d.data() as any;
        const tarea: TareaEquipo = { ...data, id: d.id };
        if (tarea.cerrado === true && esAdminGlobal(sesion) === false) {
          // Trabajadores y admins limitados no ven proyectos cerrados (limpieza visual)
          return;
        }
        // Filtro por sucursal / rol
        if (esGlobal) {
          arr.push(tarea);
        } else if (esLimitado) {
          if ((permitidas ?? []).includes(tarea.store)) arr.push(tarea);
        } else {
          // Trabajador: solo si está como integrante o jefe del proyecto
          if (mismoEmpleadoNombre(tarea.jefeEquipo, miNombre) ||
              (tarea.integrantes || []).some(n => mismoEmpleadoNombre(n, miNombre))) {
            arr.push(tarea);
          }
        }
      });
      arr.sort((a, b) => (b.timestampCreacion || 0) - (a.timestampCreacion || 0));
      this.tareasEquipo.set(arr);

      // 🔄 Mantener el DETALLE abierto sincronizado con los cambios en vivo.
      // Sin esto, al completar un item / agregar tarea / cerrar fase, se guardaba
      // pero la pantalla del proyecto seguía mostrando los datos viejos.
      const sel = this.tareaEquipoSeleccionada();
      if (sel) {
        const actualizado = arr.find(t => t.id === sel.id);
        if (actualizado) this.tareaEquipoSeleccionada.set(actualizado);
      }
    });
    this.destructoresRadares.push(radarTareasEquipo);

    const notiRef = collection(this.firestore, 'notificaciones');
    const radarNotificaciones = onSnapshot(notiRef, (snapshot) => {
      const misNotis: any[] = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data['empleado'] === this.currentUser?.nombre && data['leido'] === false) {
          misNotis.push({ id: docSnap.id, ...data });
        }
      });
      misNotis.sort((a, b) => a.timestamp - b.timestamp);
      this.notificacionesPendientes.set(misNotis);
    });
    this.destructoresRadares.push(radarNotificaciones);
  }

  abrirModalNotificacion(empleadoNombre: string) {
    this.empleadoParaNotificar = empleadoNombre;
    this.mensajeNotificacion = '';
    this.isModalNotificacionOpen = true;
  }

  cerrarModalNotificacion() {
    this.isModalNotificacionOpen = false;
    this.empleadoParaNotificar = '';
  }

  async enviarNotificacion() {
    if (!this.mensajeNotificacion.trim()) { alert('Por favor escribe un mensaje.'); return; }
    const notiId = 'noti_' + Date.now();
    const payload = {
      empleado: this.empleadoParaNotificar, mensaje: this.mensajeNotificacion,
      de: this.currentUser?.nombre || 'Gerencia', leido: false, timestamp: Date.now()
    };
    try {
      await setDoc(doc(this.firestore, 'notificaciones', notiId), payload);
      this.mostrarToast(` 🔔 ¡Zumbido enviado a ${this.empleadoParaNotificar}!`);
      this.cerrarModalNotificacion();
    } catch (error) { alert('Error al enviar la alerta.'); }
  }

  async marcarNotificacionComoLeida(noti: any) {
    try { await setDoc(doc(this.firestore, 'notificaciones', noti.id), { leido: true }, { merge: true }); }
    catch (error) { console.error("Error cerrando notificación", error); }
  }

  getPrimerasTareas(checklist: any): any[] {
    if (!checklist || !checklist.items) return [];
    return checklist.items.slice(0, 4);
  }

  isTareaVencida(item: any, checklistDate: string): boolean {
    if (!checklistDate) return false;
    let hora = '23'; let minuto = '59';
    // 🔥 Prioriza horaLimite (campo actual) sobre time (legacy). Aplica a ambos tipos.
    // Esto evita que tareas con campos desincronizados se cierren con una hora vieja.
    const horaUsar = item.horaLimite || item.time;
    if (horaUsar && typeof horaUsar === 'string') {
      const partes = horaUsar.split(':');
      if (partes.length >= 2) {
        hora = partes[0];
        minuto = partes[1];
      }
    }
    const [year, month, day] = checklistDate.split('-');
    const deadline = new Date(Number(year), Number(month) - 1, Number(day), Number(hora), Number(minuto), 59);
    return new Date() > deadline;
  }

  esDiaCerrado(sucursal: string, fecha: Date = new Date()): boolean {
    const dia = fecha.getDate(); const mes = fecha.getMonth() + 1; const anio = fecha.getFullYear();
    if (sucursal === 'Padre Hidalgo' || sucursal === '8 Esquinas') {
      const viernesSanto = this.calcularViernesSanto(anio);
      if (dia === viernesSanto.getDate() && mes === (viernesSanto.getMonth() + 1)) return true;
      return false;
    } else {
      if ((dia === 25 && mes === 12) || (dia === 1 && mes === 1)) return true;
      return false;
    }
  }

  calcularViernesSanto(anio: number): Date {
    const a = anio % 19; const b = Math.floor(anio / 100); const c = anio % 100;
    const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4); const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mesResurreccion = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const diaResurreccion = ((h + l - 7 * m + 114) % 31) + 1;
    const domingoResurreccion = new Date(anio, mesResurreccion, diaResurreccion);
    const viernesSanto = new Date(domingoResurreccion);
    viernesSanto.setDate(domingoResurreccion.getDate() - 2);
    return viernesSanto;
  }

  calcularFechaFinDefault(frecuencia: string): string | null { return null; }
  alCambiarFrecuencia(rutina: any) { rutina.fechaFin = this.calcularFechaFinDefault(rutina.frecuencia); }

  getTextoPeriodo(rutina: any): string {
    if (rutina.frecuencia === 'Diaria') return 'Activa siempre';
    if (rutina.frecuencia === 'Semanal') return `Todos los ${rutina.diaSemana || 'Lunes'}`;
    if (rutina.frecuencia === 'Catorcenal') return `Cada 2 semanas, los ${rutina.diaSemana || 'Lunes'}`;
    if (rutina.frecuencia === 'Mensual') return `Los días ${rutina.diaMes || 1} del mes`;
    if (rutina.frecuencia === 'Trimestral') return `El día ${rutina.diaMes || 1} cada 3 meses`;
    return '';
  }

  getWeekNumber(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  obtenerLlavePeriodo(frecuencia: string, fecha: Date): string {
    const y = fecha.getFullYear(); const m = fecha.getMonth() + 1; const d = fecha.getDate();
    if (frecuencia === 'Diaria') return `${y}-${m}-${d}`;
    if (frecuencia === 'Mensual') return `${y}-${m}`;
    if (frecuencia === 'Trimestral') return `${y}-Q${Math.ceil(m / 3)}`;
    const week = this.getWeekNumber(fecha);
    if (frecuencia === 'Semanal') return `${y}-W${week}`;
    if (frecuencia === 'Catorcenal') return `${y}-C${Math.ceil(week / 2)}`;
    return `${y}-${m}-${d}`;
  }

  /**
   * 🤖 Robot V2 (Fase 4): genera checklists del día desde catálogo + asignaciones.
   *
   * Se llama cada vez que cambian los caches (catálogo, asignaciones o usuarios).
   * Es idempotente: el service no recrea checklists que ya existen.
   *
   * Convive con el V1 (moldes). Cuando la migración termine (Fase 5) se podrá
   * apagar el V1 quitando el `radarMoldes` y este método se quedará solo.
   */
  private dispararRobotV2() {
    // Necesitamos al menos algo del catálogo y de asignaciones; usuarios puede
    // estar vacío si la asignación es 'porPersonas' (el robot no lo necesita).
    if (this.robotV2Corriendo) return;
    if (!this.catalogoV2.length || !this.asignacionesV2.length) return;

    this.robotV2Corriendo = true;
    this.robotV2.generarChecklistsDeFecha(
      this.catalogoV2,
      this.asignacionesV2,
      this.usuariosV2,
      new Date(),
      {
        esDiaCerrado: (suc, f) => this.esDiaCerrado(suc, f),
        esSucursalAdministrativa: (suc) => this.esSucursalAdministrativa(suc)
      }
    ).catch(err => {
      console.error('[Robot V2] Error al generar checklists:', err);
    }).finally(() => {
      this.robotV2Corriendo = false;
    });
  }

  async ejecutarRobotRutinas(moldes: any[]) {
    const fechaActual = new Date();
    const offset = fechaActual.getTimezoneOffset() * 60000;
    const fechaLocal = new Date(fechaActual.getTime() - offset);
    const fechaString = fechaLocal.toISOString().split('T')[0];
    const diasTexto = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const diaHoyTexto = diasTexto[fechaLocal.getDay()];
    const diaMesActual = fechaLocal.getDate();
    const esDomingo = fechaLocal.getDay() === 0;

    for (const molde of moldes) {
      // 🚚 Fase 5: si el molde ya fue migrado al nuevo modelo, lo skipeamos
      // para que el Robot V2 sea el único que genere checklists.
      if (molde._pausadoPorMigracion === true || molde._migradoA) continue;

      if (this.esDiaCerrado(molde.store, fechaActual)) continue;
      if (esDomingo && this.esSucursalAdministrativa(molde.store) && molde.frecuencia === 'Diaria') continue;

      if (molde.frecuencia === 'Semanal' || molde.frecuencia === 'Catorcenal') {
        if (molde.diaSemana && molde.diaSemana !== diaHoyTexto) continue;
        if (molde.frecuencia === 'Catorcenal' && molde.timestampCreacion) {
          const semanaActual = this.getWeekNumber(fechaLocal);
          const semanaCreacion = this.getWeekNumber(new Date(molde.timestampCreacion));
          if (Math.abs(semanaActual - semanaCreacion) % 2 !== 0) continue;
        }
      }

      if (molde.frecuencia === 'Mensual' || molde.frecuencia === 'Trimestral') {
        const diaObjetivo = parseInt(molde.diaMes || '1', 10);
        const ultimoDiaDelMesActual = new Date(fechaLocal.getFullYear(), fechaLocal.getMonth() + 1, 0).getDate();
        const diaRealAProcesar = diaObjetivo > ultimoDiaDelMesActual ? ultimoDiaDelMesActual : diaObjetivo;
        if (diaMesActual !== diaRealAProcesar) continue;
        if (molde.frecuencia === 'Trimestral' && molde.timestampCreacion) {
          const mesActual = fechaLocal.getMonth();
          const mesCreacion = new Date(molde.timestampCreacion).getMonth();
          if (Math.abs(mesActual - mesCreacion) % 3 !== 0) continue;
        }
      }
      // 📅 Vigencia: solo aplican items cuya fechaInicio ya pasó (o no tiene) Y cuya fechaFin no ha pasado (o no tiene).
      const itemsVigentes = molde.items.filter((item: any) => {
        const empezo = !item.fechaInicio || fechaString >= item.fechaInicio;
        const noTermino = !item.fechaFin || fechaString <= item.fechaFin;
        return empezo && noTermino;
      });
      if (itemsVigentes.length === 0) continue;
      const llavePeriodo = this.obtenerLlavePeriodo(molde.frecuencia, fechaActual);
      const checklistId = `${molde.id}_${llavePeriodo}`;
      const docRef = doc(this.firestore, 'checklists', checklistId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        const nuevoChecklist = {
          id: checklistId, timestampCreacion: Date.now(), name: `${molde.name} (${molde.frecuencia})`,
          assigned: molde.assigned, store: molde.store, date: fechaString, time: '23:59',
          status: 'pendiente', enviado: false, createdBy: molde.createdBy || 'Robot de Rutinas', notaEmpleado: '',
          items: itemsVigentes.map((i: any) => ({
            ...i,
            horaInicio: i.horaInicio || null,
            horaLimite: i.horaLimite || null,
            checked: false, photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photos: []
          }))
        };
        await setDoc(docRef, nuevoChecklist);
      }
    }
  }

  async guardarEnLaNube(checklist: any) {
    try { await setDoc(doc(this.firestore, 'checklists', checklist.id.toString()), checklist, { merge: true }); }
    catch (error) { console.error("Error: ", error); }
  }

  // ==========================================================================
  // TAREA PROPIA DEL DÍA — el trabajador suma una tarea/extra a sus rutinas de hoy
  // ==========================================================================
  abrirModalTareaDia() {
    this.tareaDiaTexto = '';
    this.tareaDiaHora = '';
    this.isModalTareaDiaOpen = true;
  }

  cerrarModalTareaDia() { this.isModalTareaDiaOpen = false; }

  /** Sucursal por defecto del usuario para asociar la tarea propia. */
  private miSucursalPrincipal(): string {
    const u = this.currentUser;
    return (u?.sucursales && u.sucursales[0]) || u?.sucursal || 'General';
  }

  /** Crea un checklist auto-asignado para hoy con una sola tarea manual.
   *  Aparece junto a las rutinas del día del trabajador y se completa/envía
   *  con el flujo normal (sin requerir foto). */
  async guardarTareaDia() {
    const texto = this.tareaDiaTexto.trim();
    if (!texto) { this.mostrarToast(' Escribe el nombre de tu tarea.'); return; }
    const nombre = this.currentUser?.nombre;
    if (!nombre) { this.mostrarToast(' No hay sesión activa.'); return; }

    const hoy = this.hoyIsoStr;
    const id = `propia_${normalizarNombre(nombre).replace(/\s+/g, '_')}_${Date.now()}`;
    const checklist: any = {
      id,
      timestampCreacion: Date.now(),
      name: texto,
      assigned: nombre,
      store: this.miSucursalPrincipal(),
      date: hoy,
      time: this.tareaDiaHora || '23:59',
      status: 'pendiente',
      enviado: false,
      createdBy: nombre,
      esTareaPropia: true,
      notaEmpleado: '',
      items: [{
        id: Date.now(),
        text: texto,
        requiresPhoto: false,
        requiresAntesDespues: false,
        requiresVariasFotos: false,
        permiteGaleria: false,
        permiteDocumentos: false,
        checked: false,
        photo: null, photoTime: null, photoAntes: null, photoAntesTime: null,
        photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null, photos: [],
        tipo: 'manual',
        horaInicio: null,
        horaLimite: this.tareaDiaHora || null,
        frecuencia: null
      }]
    };

    try {
      await this.guardarEnLaNube(checklist);
      // Refresco optimista: aparece de inmediato sin esperar el snapshot.
      this.checklists.set([...(this.checklists() || []), checklist]);
      this.isModalTareaDiaOpen = false;
      this.tareaDiaTexto = '';
      this.tareaDiaHora = '';
      this.mostrarToast(' Tu tarea fue agregada a tu día.');
    } catch (e) {
      console.error('[tarea-propia-dia] error', e);
      this.mostrarToast(' Error al agregar tu tarea.');
    }
  }

  eliminarChecklist(checklist: any, event: Event) {
    event.stopPropagation();
    this.checklistToDelete = checklist;
    this.passwordInput = '';
    this.isPasswordModalOpen = true;
  }

  cerrarPasswordModal() { this.isPasswordModalOpen = false; this.checklistToDelete = null; this.passwordInput = ''; }

  async confirmarEliminacion() {
    // 🔒 Antes pedía una contraseña maestra hardcodeada ('Mega2323') visible en el
    // bundle. Ahora exige rol de administrador. La protección real vive en las
    // Firestore Security Rules (Fase 2).
    if (this.currentUser?.rol !== 'admin') { alert(' ⚠️ Solo un administrador puede eliminar checklists.'); return; }
    const confirmar = confirm(` ⚠️ ¿Borrar "${this.checklistToDelete.name}" definitivamente?\n\nLa rutina dejará de generarse en días futuros.`);
    if (confirmar) {
      try {
        const checklist = this.checklistToDelete;
        const targetName = checklist.name.replace(/ \((Diaria|Semanal|Catorcenal|Mensual|Trimestral)\)$/, '').trim();
        const targetAssigned = checklist.assigned;

        // 1) Soft-delete de TODOS los checklists ya generados con este nombre+assigned.
        const checklistsRef = collection(this.firestore, 'checklists');
        const chkSnap = await getDocs(checklistsRef);
        for (const cDoc of chkSnap.docs) {
          const cData = cDoc.data() as any;
          if ((cData.name || '').startsWith(targetName) && cData.assigned === targetAssigned) {
            await setDoc(doc(this.firestore, 'checklists', cDoc.id), { eliminado: true }, { merge: true });
          }
        }

        // 2) Borrado físico del molde V1.
        const moldesRef = collection(this.firestore, 'moldes_checklists');
        const moldesSnap = await getDocs(moldesRef);
        for (const mDoc of moldesSnap.docs) {
          const mData = mDoc.data() as any;
          if (targetName.includes(mData.name) && mData.assigned === targetAssigned) {
            await deleteDoc(doc(this.firestore, 'moldes_checklists', mDoc.id));
          }
        }

        // 3) 🔥 Desactivar la asignación V2 para que el Robot V2 deje de regenerar.
        // Antes este paso faltaba: por eso al día siguiente reaparecía la rutina.
        // - Si la asignación es porPersonas con varios empleados, sacamos SOLO a
        //   este empleado (no rompemos las tareas de los demás).
        // - Si queda con 0 empleados, o es porRol, marcamos `activa: false`.
        if (checklist._v2 && checklist._asignacionId) {
          const asigRef = doc(this.firestore, 'asignaciones_rutinas', checklist._asignacionId);
          const asigSnap = await getDoc(asigRef);
          if (asigSnap.exists()) {
            const a = asigSnap.data() as any;
            if (a.modoAsignacion === 'porPersonas' && Array.isArray(a.empleadosNombres)) {
              const sinEste = a.empleadosNombres.filter((n: string) => n !== targetAssigned);
              if (sinEste.length > 0) {
                await setDoc(asigRef, { empleadosNombres: sinEste }, { merge: true });
              } else {
                await setDoc(asigRef, { activa: false, empleadosNombres: [] }, { merge: true });
              }
            } else {
              await setDoc(asigRef, { activa: false }, { merge: true });
            }
          }
        }

        alert(' 🗑️ Tarea/rutina eliminada definitivamente.');
      } catch (error) {
        console.error('[confirmarEliminacion]', error);
        alert(' ❌ Error al eliminar.');
      }
    }
    this.cerrarPasswordModal();
  }

  /**
   * Muestra el diagnóstico del último snapshot en un modal visible en pantalla,
   * útil cuando un usuario ve "No hay tareas asignadas" y queremos saber por qué
   * sin tener que abrir la consola del navegador (típico en móviles).
   */
  mostrarDiagnostico() {
    const d = this.ultimoDiagnostico;
    if (!d) {
      Swal.fire({
        icon: 'info', title: 'Sin diagnóstico todavía',
        text: 'Aún no se ha cargado ningún snapshot. Espera unos segundos.',
        confirmButtonColor: '#0F172A'
      });
      return;
    }
    const sucursales = (d.sucursales && d.sucursales.length)
      ? d.sucursales.join(', ') : '(ninguna)';
    const crudo = (d.crudoAssignedMuestra && d.crudoAssignedMuestra.length)
      ? d.crudoAssignedMuestra.map((s: string) => `<li style="font-size:11px;color:#475569">${s}</li>`).join('')
      : '<li style="color:#94a3b8">(0 checklists pasaron el filtro de fecha/estado)</li>';
    const empleadosUnicos = (d.empleadosConTareasHoy && d.empleadosConTareasHoy.length)
      ? d.empleadosConTareasHoy.map((s: string) => `<li style="font-size:11px;color:#475569">${s}</li>`).join('')
      : '<li style="color:#94a3b8">(no se encontraron empleados con tareas hoy)</li>';
    const misEnviados = (d.misEnviadosHoy && d.misEnviadosHoy.length)
      ? `<ul style="padding-left:18px;margin:4px 0">${d.misEnviadosHoy.map((x: any) => `<li style="font-size:11px;color:#F59E0B">${x.assigned}: ${x.name}</li>`).join('')}</ul>`
      : '<div style="color:#94a3b8;font-size:12px;padding-left:8px">— ninguno —</div>';
    const misEliminados = (d.misEliminadosHoy && d.misEliminadosHoy.length)
      ? `<ul style="padding-left:18px;margin:4px 0">${d.misEliminadosHoy.map((x: any) => `<li style="font-size:11px;color:#EF4444">${x.assigned}: ${x.name}</li>`).join('')}</ul>`
      : '<div style="color:#94a3b8;font-size:12px;padding-left:8px">— ninguno —</div>';
    // Botón "Reabrir" solo si hay mis tareas marcadas como enviadas y el usuario
    // es admin o es el propio dueño de las tareas.
    const puedeReabrir = (d.misEnviadosHoy && d.misEnviadosHoy.length > 0) &&
      (this.currentUser?.rol === 'admin' ||
       mismoEmpleadoNombre(this.currentUser?.nombre, d.misEnviadosHoy[0].assigned));
    const botonReabrir = puedeReabrir
      ? `<button id="btn-reabrir-misenviados" style="margin-top:10px;background:#F59E0B;color:white;border:none;padding:10px 18px;border-radius:8px;font-weight:600;cursor:pointer">🔓 Reabrir mis ${d.misEnviadosHoy.length} tarea(s) marcadas como enviadas</button>`
      : '';
    const html = `
      <div style="text-align:left;font-size:13px;line-height:1.55">
        <div><strong>Usuario:</strong> ${d.usuario || '(vacío)'}</div>
        <div><strong>Nombre:</strong> ${d.nombre || '(vacío)'}</div>
        <div><strong>Rol:</strong> ${d.rol || '(vacío)'}</div>
        <div><strong>Alcance:</strong> ${d.alcance || '(vacío)'}</div>
        <div><strong>Sucursales:</strong> ${sucursales}</div>
        <div><strong>Rama de filtrado:</strong> <code>${d.rama}</code></div>
        <div><strong>Fecha hoy local:</strong> <code>${d.fechaHoyLocal}</code></div>
        <hr style="margin:10px 0">
        <div><strong>Descartados:</strong></div>
        <div style="padding-left:12px;color:#64748b">
          • Por eliminado: ${d.descartadosEliminados}<br>
          • Por enviado: ${d.descartadosEnviados}<br>
          • Por fecha distinta a hoy: ${d.descartadosFecha}
        </div>
        <div style="margin-top:8px"><strong>Tras filtros de estado/fecha:</strong> ${d.crudoTrasFiltro}</div>
        <div><strong>Tras filtro de permisos:</strong> ${d.resultadoFinal}</div>
        <hr style="margin:10px 0">
        <div style="color:#F59E0B"><strong>🚨 Mis tareas marcadas como ENVIADAS hoy:</strong></div>
        ${misEnviados}
        ${botonReabrir}
        <div style="color:#EF4444;margin-top:6px"><strong>🚨 Mis tareas marcadas como ELIMINADAS hoy:</strong></div>
        ${misEliminados}
        <hr style="margin:10px 0">
        <div><strong>Empleados con tareas creadas hoy (cualquier estado):</strong></div>
        <ul style="padding-left:18px;margin:4px 0;max-height:160px;overflow:auto">${empleadosUnicos}</ul>
        <hr style="margin:10px 0">
        <div><strong>Muestra del universo crudo (no enviadas, no eliminadas):</strong></div>
        <ul style="padding-left:18px;margin:4px 0">${crudo}</ul>
      </div>
    `;
    Swal.fire({
      title: '🩺 Diagnóstico del filtro',
      html, width: 560, confirmButtonText: 'Cerrar', confirmButtonColor: '#0F172A',
      didOpen: () => {
        const btn = document.getElementById('btn-reabrir-misenviados');
        if (btn) {
          btn.addEventListener('click', () => {
            Swal.close();
            this.reabrirMisTareasEnviadas();
          });
        }
      }
    });
  }

  /**
   * Pone `enviado: false` en los checklists de hoy que están marcados como
   * enviados Y son del usuario actual (o de cualquiera si es admin). Resuelve
   * el caso en que se envió un checklist sin completar todas las tareas y el
   * trabajador queda sin poder verlas.
   */
  async reabrirMisTareasEnviadas() {
    const d = this.ultimoDiagnostico;
    if (!d || !Array.isArray(d.misEnviadosHoy) || d.misEnviadosHoy.length === 0) return;
    const lista = d.misEnviadosHoy as { id: string; assigned: string; name: string }[];
    const itemsHtml = lista.map(x => `<li style="text-align:left;font-size:13px">${x.name}</li>`).join('');
    const confirma = await Swal.fire({
      title: `¿Reabrir ${lista.length} tarea(s)?`,
      html: `<div>Se desmarcarán como enviadas y volverán a aparecer en el Checklist del día:</div><ul style="padding-left:18px;margin:8px 0">${itemsHtml}</ul>`,
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Sí, reabrir', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#F59E0B'
    });
    if (!confirma.isConfirmed) return;
    let ok = 0, fail = 0;
    for (const item of lista) {
      try {
        await setDoc(doc(this.firestore, 'checklists', item.id), { enviado: false }, { merge: true });
        ok++;
      } catch (e) { console.error('[reabrirMisTareasEnviadas]', e); fail++; }
    }
    Swal.fire({
      icon: 'success', title: 'Tareas reabiertas',
      html: `Reabiertas: <strong>${ok}</strong>${fail > 0 ? `<br>Errores: <strong style="color:#EF4444">${fail}</strong>` : ''}<br><br>Recarga la pantalla para verlas.`,
      confirmButtonColor: '#0F172A'
    });
  }

  /**
   * Decide qué flujo de edición abrir según el tipo de checklist.
   * - Si el nombre termina en `(Diaria)`, `(Semanal)`, etc. → es rutina → editor de rutinas.
   * - En cualquier otro caso → editor de Tarea Única.
   */
  editarChecklist(checklist: any, event: Event) {
    const esRutina = /\((Diaria|Semanal|Catorcenal|Mensual|Trimestral)\)$/.test(checklist?.name || '');
    if (esRutina) this.editarBloqueRutinas(checklist, event);
    else this.editarTareaUnica(checklist, event);
  }

  async editarBloqueRutinas(checklist: any, event: Event) {
    event.stopPropagation();
    this.isEditMode = true;
    const targetName = checklist.name.replace(/ \((Diaria|Semanal|Catorcenal|Mensual|Trimestral)\)$/, '').trim();
    const targetAssigned = checklist.assigned;
    const moldesRef = collection(this.firestore, 'moldes_checklists');
    const moldesSnap = await getDocs(moldesRef);
    let rutinasEncontradas: any[] = [];
    let sucursalOriginal = '';
    moldesSnap.forEach((mDoc) => {
      const mData = mDoc.data();
      if (mData['name'] === targetName && mData['assigned'] === targetAssigned) {
        sucursalOriginal = mData['store'];
        if (mData['items'] && Array.isArray(mData['items'])) {
          rutinasEncontradas = [...rutinasEncontradas, ...mData['items']];
        }
      }
    });
    if (rutinasEncontradas.length === 0) {
      alert('Esta es una "Tarea Única" o no tiene rutinas registradas en la Bóveda.');
      return;
    }
    // 📝 Guarda originales para que `guardarBloqueRutinas` pueda limpiar el
    // molde viejo aunque cambies nombre/sucursal/asignado.
    this.formNameRutinaOriginal = targetName;
    this.formAssignedRutinaOriginal = targetAssigned;
    this.formNameRutina = targetName;
    this.formAssignedRutina = [targetAssigned];
    this.formStoreRutina = sucursalOriginal;
    this.formRutinas = rutinasEncontradas.map((r: any) => ({
      ...r,
      horaInicio: r.horaInicio || '',
      horaLimite: r.horaLimite || '',
      fechaInicio: r.fechaInicio || this.hoyIsoStr,
      fechaFin: r.fechaFin || null
    }));
    // 🧙 Reset wizard de rutinas para edición
    this.wizardStepRutina = 1;
    this.terminoBusquedaEmpleadoWizardRutina = '';
    const primeraRutina = this.formRutinas[0];
    if (primeraRutina?.requiresAntesDespues) this.wizardTipoEvidenciaRutina = 'antesDespues';
    else if (primeraRutina?.requiresVariasFotos) this.wizardTipoEvidenciaRutina = 'variasFotos';
    else if (primeraRutina?.requiresPhoto) this.wizardTipoEvidenciaRutina = 'foto';
    else this.wizardTipoEvidenciaRutina = 'ninguna';
    this.isModalRutinasOpen = true;
  }

  verDetalle(checklist: any) { this.checklistSeleccionado.set(checklist); this.vistaActual.set('detalle'); }
  volverALista() { this.checklistSeleccionado.set(null); this.vistaActual.set('lista'); }
  toggleItem(item: any) { item.checked = !item.checked; this.actualizarEstado(); }

  /** ¿Esta tarea pide alguna evidencia (foto / antes-después / varias fotos)? */
  pideEvidencia(item: any): boolean {
    return !!(item.requiresPhoto || item.requiresAntesDespues || item.requiresVariasFotos);
  }

  /**
   * Toque sobre el indicador de la tarea.
   *
   * - Tareas CON evidencia: NO se palomean a mano. Se completan solas al subir
   *   la foto, así que el toque no hace nada (el círculo es solo indicador visual).
   * - Tareas SIN evidencia: se marcan/desmarcan con el toque (única forma de
   *   indicar que se hicieron).
   */
  onClickCheck(item: any) {
    if (!this.puedoEditarItem(item)) return;
    if (this.pideEvidencia(item)) return; // las de foto se completan subiendo evidencia
    item.checked = !item.checked;
    this.actualizarEstado();
  }

  async onFileSelected(event: any, item: any, tipoFoto: string = 'photo') {
    const fileOriginal = event.target.files[0];
    if (!fileOriginal) return;
    const checklistActual = this.checklistSeleccionado();
    if (!checklistActual) return;

    // Compresión cliente: bajamos JPGs de 4-6 MB a ~300 KB antes de subir.
    // Si no es imagen (PDF, etc.) o ya es pequeña, devuelve el original sin tocar.
    let file: File;
    try {
      file = await comprimirImagenSiAplica(fileOriginal);
    } catch (e: any) {
      console.error('[compresion]', e);
      // Si la compresión falla, intentamos subir el archivo original tal cual
      file = fileOriginal;
    }

    // Sin conexión → guardamos offline desde el inicio.
    if (!navigator.onLine) {
      await this.guardarFotoOffline(item, tipoFoto, file, checklistActual);
      event.target.value = '';
      this.mostrarToast(' Guardado sin conexión. Se subirá cuando regrese la señal.');
      return;
    }

    // Subida online con un reintento automático y fallback offline si falla.
    item[tipoFoto] = 'subiendo...';
    const resultado = await this.subirACloudinary(file);
    if (resultado.ok && resultado.url) {
      item[tipoFoto] = resultado.url;
      item.pendienteDeSync = false;
      const ahora = new Date();
      item[tipoFoto + 'Time'] = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      if (tipoFoto === 'photoAntes') item.photoAntesTimestamp = Date.now();
      this.actualizarEstado();
    } else {
      // Fallback: si falla la subida online (cuota, red intermitente, etc.) la
      // guardamos offline para que se reintente automáticamente. Antes se
      // perdía la foto y el trabajador veía solo un alert genérico.
      console.error('[Cloudinary error]', resultado.error);
      await this.guardarFotoOffline(item, tipoFoto, file, checklistActual);
      Swal.fire({
        icon: 'warning',
        title: 'No se pudo subir la foto',
        html: `<div style="text-align:left">
                 <p>Se guardó en tu dispositivo y se subirá cuando regrese la señal.</p>
                 <p style="font-size:11px;color:#64748B;margin-top:8px">
                   <strong>Detalle técnico:</strong>
                   <code style="word-break:break-word">${(resultado.error || 'sin detalle').toString().slice(0, 240)}</code>
                 </p>
               </div>`,
        confirmButtonColor: '#0F172A'
      });
    }
    event.target.value = '';
  }

  /**
   * Sube un archivo a Cloudinary con 2 intentos (espera 800ms entre intentos).
   * Devuelve `{ok, url, error}` para que el llamador decida qué hacer.
   */
  private async subirACloudinary(file: File | Blob): Promise<{ ok: boolean; url?: string; error?: string }> {
    const cloudName = 'duherjgyg';
    const uploadPreset = 'fotos_mega';
    const url = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;
    let ultimoError = '';
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', uploadPreset);
        const response = await fetch(url, { method: 'POST', body: formData });
        const data = await response.json();
        if (data && data.secure_url) {
          return { ok: true, url: data.secure_url };
        }
        // Cloudinary suele devolver `error.message` cuando rechaza algo (cuota,
        // formato, tamaño). Lo guardamos para mostrarlo al usuario.
        ultimoError = (data && data.error && data.error.message)
          ? `Cloudinary: ${data.error.message}`
          : `Cloudinary respondió sin URL (HTTP ${response.status})`;
      } catch (e: any) {
        ultimoError = e?.message || 'Error de red';
      }
      if (intento < 2) await new Promise(r => setTimeout(r, 800));
    }
    return { ok: false, error: ultimoError };
  }

  /**
   * Guarda una foto en la cola offline (localforage). El robot de sincronización
   * la subirá cuando regrese la conexión. Antes esta lógica estaba duplicada
   * inline en `onFileSelected` y solo se usaba cuando `!navigator.onLine`;
   * ahora también se usa como fallback cuando Cloudinary falla online.
   */
  private async guardarFotoOffline(item: any, tipoFoto: string, file: File | Blob, checklistActual: any): Promise<void> {
    item[tipoFoto] = 'offline_syncing';
    item.pendienteDeSync = true;
    const ahora = new Date();
    item[tipoFoto + 'Time'] = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (tipoFoto === 'photoAntes') item.photoAntesTimestamp = Date.now();
    await new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64String = reader.result as string;
        const indexItem = checklistActual.items.findIndex((i: any) => i === item);
        const fotoEstancada = {
          idTarea: checklistActual.id,
          indexItem,
          tipoFoto,
          base64: base64String
        };
        const colaActual: any[] = (await localforage.getItem('md_fotos_offline')) || [];
        colaActual.push(fotoEstancada);
        await localforage.setItem('md_fotos_offline', colaActual);
        this.actualizarEstado();
        resolve();
      };
      reader.onerror = () => resolve();
    });
  }

  async adjuntarDocumentoInstruccion(event: any, item: any) {
    const fileOriginal = event.target.files[0];
    if (!fileOriginal) return;
    // Si es imagen, la comprimimos; PDFs y otros formatos pasan sin tocar.
    const file = await comprimirImagenSiAplica(fileOriginal);
    item.archivoInstruccion = 'subiendo...';
    item.nombreArchivo = file.name;
    const cloudName = 'duherjgyg';
    const uploadPreset = 'fotos_mega';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    try {
      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, { method: 'POST', body: formData });
      const data = await response.json();
      if (data.secure_url) {
        item.archivoInstruccion = data.secure_url;
        this.mostrarToast(' 📎 Documento adjuntado');
      } else {
        item.archivoInstruccion = null; item.nombreArchivo = null;
        alert(' ❌ Error al subir el documento.');
      }
    } catch (error) {
      item.archivoInstruccion = null; item.nombreArchivo = null;
      alert(' ❌ Error de conexión al subir.');
    }
    event.target.value = '';
  }

  quitarDocumentoInstruccion(item: any) {
    item.archivoInstruccion = null;
    item.nombreArchivo = null;
  }

  removeImage(item: any, tipoFoto: string = 'photo') {
    item[tipoFoto] = null; item[tipoFoto + 'Time'] = null;
    if (tipoFoto === 'photoAntes') item.photoAntesTimestamp = null;
    this.actualizarEstado();
  }

  /**
   * ¿La tarea está completa?
   *
   * - Tareas CON evidencia: completas cuando la evidencia está subida.
   *   Ya NO requieren palomear — subir la foto basta.
   * - Tareas SIN evidencia: completas con el toque manual (item.checked).
   */
  /**
   * Para esta vista (modal de detalle del trabajador / verificación al ENVIAR),
   * un item se considera completo SOLO con su evidencia real — no con la nota
   * global del checklist. Esto evita que el trabajador pueda enviar sin nada
   * hecho solo con un comentario.
   *
   * Para los KPIs visuales (Dashboard, Auditoría, Checkstore, Estadísticas,
   * Ranking) se usa `esItemHecho(item, checklist)` que SÍ acepta la
   * justificación del checklist completo.
   */
  esItemCompleto(item: any): boolean {
    return tieneEvidencia(item);
  }

  /**
   * Devuelve un texto corto explicando QUÉ le falta a un item para considerarse completo.
   * Se usa en el confirm() al enviar el checklist para que el trabajador sepa exactamente
   * qué tiene que volver a revisar.
   */
  motivoIncompleto(item: any): string {
    if (item.requiresAntesDespues) {
      const falta: string[] = [];
      if (!item.photoAntes || item.photoAntes === 'subiendo...') falta.push('foto ANTES');
      if (!item.photoDespues || item.photoDespues === 'subiendo...') falta.push('foto DESPUÉS');
      if (falta.length) return 'falta ' + falta.join(' y ');
    }
    if (item.requiresVariasFotos && (!Array.isArray(item.photos) || item.photos.length === 0)) {
      return 'falta subir fotos';
    }
    if (item.requiresPhoto && (!item.photo || item.photo === 'subiendo...')) {
      return 'falta la foto';
    }
    if (!this.pideEvidencia(item) && !item.checked) return 'falta marcar como hecha';
    return 'incompleta';
  }

  actualizarEstado() {
    const actual = this.checklistSeleccionado(); if (!actual) return;
    // Completado = evidencia subida (tareas con foto) o toque manual (tareas sin foto).
    const completados = actual.items.filter((i: any) => this.esItemCompleto(i)).length;
    actual.calcCompletados = completados;
    actual.calcProgreso = Math.round((completados / actual.items.length) * 100) || 0;
    if (completados === 0) actual.status = 'pendiente';
    else if (completados === actual.items.length) actual.status = 'completo';
    else actual.status = 'en-progreso';
    this.guardarEnLaNube(actual);
  }

  /** ¿El checklist se está enviando después de la hora límite de alguna de sus tareas? */
  hayRetrasoEnChecklist(checklist: any): boolean {
    if (!checklist?.items?.length || !checklist.date) return false;
    return checklist.items.some((i: any) => this.isTareaVencida(i, checklist.date));
  }

  enviarChecklist() {
    const actual = this.checklistSeleccionado(); if (!actual) return;
    // 🔒 Defensa: solo el dueño del checklist puede enviarlo
    if (!this.esElDueno()) {
      alert(' ⚠️ Solo el responsable asignado puede enviar este checklist.');
      return;
    }
    if (actual.enviado) {
      alert(' ⚠️ Este checklist ya fue enviado.');
      return;
    }
    const fotosPendientes = actual.items.some((i: any) => i.photo === 'subiendo...' || i.photoAntes === 'subiendo...' || i.photoDespues === 'subiendo...');
    if (fotosPendientes) { alert(' ⚠️ Espera, una foto se está subiendo.'); return; }

    // 🔍 Detallamos QUÉ falta para que el trabajador pueda regresar a arreglarlo.
    // Antes el mensaje era genérico ("Faltan FOTOS obligatorias") y se les pasaba.
    const incompletas = actual.items.filter((i: any) => !this.esItemCompleto(i));
    if (incompletas.length > 0) {
      const lista = incompletas.slice(0, 5).map((i: any, idx: number) => {
        const motivo = this.motivoIncompleto(i);
        return `  ${idx + 1}. ${this.limpiarEmojis(i.text || '(sin nombre)')}  →  ${motivo}`;
      }).join('\n');
      const extra = incompletas.length > 5 ? `\n  ...y ${incompletas.length - 5} más` : '';
      const confirmar = confirm(
        ` ⚠️ Tienes ${incompletas.length} ${incompletas.length === 1 ? 'tarea incompleta' : 'tareas incompletas'}:\n\n${lista}${extra}\n\n¿Enviar así de todos modos?`
      );
      if (!confirmar) return;
    }

    // ⏰ Si hay retraso, en vez de enviar directo abrimos el modal de justificante.
    if (this.hayRetrasoEnChecklist(actual)) {
      this.abrirModalJustificante();
      return;
    }

    this.realizarEnvioFinal(actual, null);
  }

  // ============================================================================
  // ⏰ MODAL DE JUSTIFICANTE DE RETRASO
  // ============================================================================
  abrirModalJustificante() {
    this.justificanteCategoria = '';
    this.justificanteComentario = '';
    this.isModalJustificanteOpen = true;
  }
  cerrarModalJustificante() {
    this.isModalJustificanteOpen = false;
  }
  seleccionarCategoriaJustificante(c: string) {
    this.justificanteCategoria = c as any;
  }
  puedeConfirmarJustificante(): boolean {
    return !!this.justificanteCategoria && this.justificanteComentario.trim().length >= 5;
  }
  confirmarJustificanteYEnviar() {
    if (!this.puedeConfirmarJustificante()) {
      alert(' ⚠️ Elige una categoría y escribe un comentario de al menos 5 caracteres.');
      return;
    }
    const actual = this.checklistSeleccionado(); if (!actual) return;
    const motivo = {
      categoria: this.justificanteCategoria,
      comentario: this.justificanteComentario.trim(),
      reportadoPor: this.currentUser?.nombre || 'desconocido',
      timestamp: Date.now()
    };
    this.cerrarModalJustificante();
    this.realizarEnvioFinal(actual, motivo);
  }

  /** Envío real al cloud. Si `motivo` viene, marca el checklist como retraso justificado. */
  private realizarEnvioFinal(actual: any, motivo: any | null) {
    actual.enviado = true;
    const ahora = new Date();
    actual.horaEnvio = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (motivo) {
      actual.entregaConRetraso = true;
      actual.motivoRetraso = motivo;
    }
    this.guardarEnLaNube(actual);
    const txt = motivo
      ? ' ✅ ¡Enviado con justificante de retraso!'
      : ' ✅ ¡Checklist enviado correctamente!';
    this.mostrarToast(txt);
    this.volverALista();
  }

  toggleEmpleado(nombre: string) {
    const index = this.formAssigned.indexOf(nombre);
    if (index > -1) this.formAssigned.splice(index, 1);
    else this.formAssigned.push(nombre);
  }

  // 🧙 abrirModal() resetea el wizard al paso 1
  abrirModal() {
    this.isEditandoTarea = false;
    this.editandoChecklistId = null;
    this.formName = '';
    this.formAssigned = [];
    this.formStore = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    this.formItems = [{
      text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
      permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 60,
      fechaInicio: '', horaInicio: '', fechaLimite: '', horaLimite: '',
      date: '', time: ''
    }];
    this.fasesTemporales = [];
    // Reset campos de mantenimiento
    this.formMantSucursalOrigen = '';
    this.formMantTipo = '';
    this.formMantUbicacion = '';
    this.formMantPrioridad = 'normal';
    this.formMantFoto = '';
    this.formMantFotoSubiendo = false;
    // Reset wizard
    this.wizardStep = 1;
    this.wizardTipoEvidencia = 'ninguna';
    this.terminoBusquedaEmpleadoWizard = '';
    // 📅 Reset preset de fecha (por defecto: hoy)
    this.presetFechaTarea = 'hoy';
    const offset = new Date().getTimezoneOffset() * 60000;
    this.formFechaTarea = new Date(Date.now() - offset).toISOString().split('T')[0];
    this.isModalOpen = true;
  }

  // ==========================================================================
  // TAREAS DE EQUIPO — wizard de creación
  // ==========================================================================
  abrirModalEquipo() {
    this.pasoEquipoWizard = 1;
    this.equipoFormName = '';
    this.equipoFormObjetivo = '';
    this.equipoFormStore = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    this.equipoFormDate = this.hoyIsoStr;
    this.equipoFormIntegrantes = [];
    this.equipoFormJefe = '';
    this.equipoFormFases = [{ id: 'fase_' + Date.now(), nombre: 'Fase 1', items: [] }];
    this.equipoBusquedaIntegrante = '';
    this.isModalEquipoOpen = true;
  }
  cerrarModalEquipo() { this.isModalEquipoOpen = false; }

  /** Avance/retroceso del wizard de equipo. */
  puedeAvanzarEquipoWizard(): boolean {
    switch (this.pasoEquipoWizard) {
      case 1: return !!this.equipoFormName.trim() && !!this.equipoFormStore && !!this.equipoFormDate;
      case 2: return this.equipoFormIntegrantes.length >= 2;
      case 3: return !!this.equipoFormJefe && this.equipoFormIntegrantes.includes(this.equipoFormJefe);
      case 4: return this.equipoFormFases.length > 0 && this.equipoFormFases.every(f => f.nombre.trim().length > 0);
      default: return false;
    }
  }
  avanzarEquipoWizard() {
    if (!this.puedeAvanzarEquipoWizard()) return;
    if (this.pasoEquipoWizard < 4) this.pasoEquipoWizard = (this.pasoEquipoWizard + 1) as 1 | 2 | 3 | 4;
  }
  retrocederEquipoWizard() {
    if (this.pasoEquipoWizard > 1) this.pasoEquipoWizard = (this.pasoEquipoWizard - 1) as 1 | 2 | 3 | 4;
  }

  /** Toggle de integrantes en el paso 2 del wizard. */
  toggleIntegranteEquipoWizard(nombre: string) {
    const i = this.equipoFormIntegrantes.indexOf(nombre);
    if (i >= 0) {
      this.equipoFormIntegrantes.splice(i, 1);
      if (this.equipoFormJefe === nombre) this.equipoFormJefe = '';
    } else {
      this.equipoFormIntegrantes.push(nombre);
    }
  }

  /**
   * Empleados del paso 2 del wizard de Equipo: SOLO quienes pertenecen de verdad
   * a la sucursal elegida (su sucursal está literalmente en su perfil). No se
   * incluyen admins globales ni gente con 'General (Acceso Total)', para que el
   * equipo sea de esa sucursal y no salga medio directorio.
   */
  get empleadosParaEquipoWizard(): any[] {
    if (!this.equipoFormStore) return [];
    const store = normalizarNombre(this.equipoFormStore);
    let lista = this.empleados().filter(e => {
      const sucs: string[] = (e.sucursales && e.sucursales.length) ? e.sucursales : (e.sucursal ? [e.sucursal] : []);
      return sucs.some((s: string) => normalizarNombre(s) === store);
    });
    const t = this.equipoBusquedaIntegrante.trim().toLowerCase();
    if (t) lista = lista.filter(e => (e.nombre || '').toLowerCase().includes(t));
    return lista.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  }

  /** Manejo de fases temporales en paso 4. */
  agregarFaseEquipoTemp() {
    const i = this.equipoFormFases.length + 1;
    this.equipoFormFases.push({ id: 'fase_' + Date.now() + '_' + i, nombre: `Fase ${i}`, items: [] });
  }
  eliminarFaseEquipoTemp(idx: number) {
    if (this.equipoFormFases.length === 1) return; // siempre al menos una
    this.equipoFormFases.splice(idx, 1);
  }
  agregarItemFaseEquipoTemp(faseIdx: number) {
    this.equipoFormFases[faseIdx].items.push({
      id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      asignado: this.equipoFormIntegrantes[0] || '',
      texto: '',
      objetivo: '',
      horaLimite: '',
      requiresPhoto: false,
      requiresAntesDespues: false
    });
  }

  /** Crea de un jalón una tarea (vacía) para CADA integrante en la fase. */
  agregarTareaPorIntegrante(faseIdx: number) {
    for (const nombre of this.equipoFormIntegrantes) {
      this.equipoFormFases[faseIdx].items.push({
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        asignado: nombre, texto: '', objetivo: '', horaLimite: '',
        requiresPhoto: false, requiresAntesDespues: false
      });
    }
  }
  eliminarItemFaseEquipoTemp(faseIdx: number, itemIdx: number) {
    this.equipoFormFases[faseIdx].items.splice(itemIdx, 1);
  }

  /** Guarda definitivamente la Tarea de Equipo en Firestore (colección tareas_equipo).
   *  La primera fase queda 'activa'; las siguientes 'pendiente'. */
  async guardarTareaEquipo() {
    if (!this.puedeAvanzarEquipoWizard()) {
      this.mostrarToast(' Faltan datos en el último paso.');
      return;
    }
    const id = 'eq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const ahora = Date.now();
    const fases: FaseEquipo[] = this.equipoFormFases.map((f, idx) => ({
      id: f.id,
      nombre: f.nombre.trim(),
      orden: idx,
      estado: idx === 0 ? 'activa' : 'pendiente',
      items: f.items.filter(it => it.texto.trim().length > 0 && it.asignado).map(it => ({
        id: it.id,
        asignado: it.asignado,
        texto: it.texto.trim(),
        objetivo: it.objetivo?.trim() || undefined,
        horaLimite: it.horaLimite || undefined,
        requiresPhoto: !!it.requiresPhoto && !it.requiresAntesDespues,
        requiresAntesDespues: !!it.requiresAntesDespues,
        completada: false,
        subtareas: [],
        agregadaPor: this.currentUser?.nombre || 'admin',
        agregadaEn: ahora
      })),
      iniciadaEn: idx === 0 ? ahora : undefined
    }));
    const tarea: TareaEquipo = {
      id,
      name: this.equipoFormName.trim(),
      objetivo: this.equipoFormObjetivo.trim(),
      store: this.equipoFormStore,
      date: this.equipoFormDate,
      createdBy: this.currentUser?.nombre || 'admin',
      jefeEquipo: this.equipoFormJefe,
      integrantes: [...this.equipoFormIntegrantes],
      fases,
      cerrado: false,
      timestampCreacion: ahora,
      _tipo: 'equipo'
    };
    try {
      await setDoc(doc(this.firestore, 'tareas_equipo', id), tarea);
      this.mostrarToast(' Proyecto en equipo creado.');
      this.cerrarModalEquipo();
    } catch (e) {
      console.error('[guardarTareaEquipo]', e);
      this.mostrarToast(' Error al crear el proyecto.');
    }
  }

  // ==========================================================================
  // TAREAS DE EQUIPO — operaciones en vivo (jefe + integrantes)
  // ==========================================================================
  /** ¿El usuario actual puede monitorear/agregar tareas? (admin global, admin
   *  limitado con sucursal del proyecto, creador o jefe designado). */
  puedeMonitorearEquipo(t: TareaEquipo | null): boolean {
    if (!t) return false;
    const u = this.currentUser;
    if (esAdminGlobal(u)) return true;
    if (esAdminLimitado(u) && (sucursalesPermitidas(u) ?? []).includes(t.store)) return true;
    if (mismoEmpleadoNombre(u?.nombre, t.createdBy)) return true;
    if (mismoEmpleadoNombre(u?.nombre, t.jefeEquipo)) return true;
    return false;
  }

  /** ¿El usuario actual puede ver/completar este item? (su asignado o jefe). */
  puedeOperarItemEquipo(t: TareaEquipo, item: ItemEquipo): boolean {
    const u = this.currentUser;
    if (mismoEmpleadoNombre(u?.nombre, item.asignado)) return true;
    return this.puedeMonitorearEquipo(t);
  }

  /** Items que el usuario actual debe ver dentro de una fase. */
  itemsVisiblesParaUsuario(t: TareaEquipo, fase: FaseEquipo): ItemEquipo[] {
    if (this.puedeMonitorearEquipo(t)) return fase.items;
    const mi = this.currentUser?.nombre;
    return fase.items.filter(i => mismoEmpleadoNombre(i.asignado, mi));
  }

  /** Progreso de una fase (0..100) basado en items completados. */
  progresoFase(fase: FaseEquipo): number {
    if (!fase.items || fase.items.length === 0) return 0;
    const ok = fase.items.filter(i => i.completada).length;
    return Math.round((ok / fase.items.length) * 100);
  }
  /** Progreso global del proyecto (promedio de fases). */
  progresoEquipo(t: TareaEquipo): number {
    if (!t.fases || t.fases.length === 0) return 0;
    const suma = t.fases.reduce((acc, f) => acc + this.progresoFase(f), 0);
    return Math.round(suma / t.fases.length);
  }

  /** Marca/desmarca un item como completado. */
  async toggleItemEquipoCompletado(t: TareaEquipo, faseId: string, itemId: string) {
    if (t.cerrado) return;
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const fase = fresca.fases.find(f => f.id === faseId);
    if (!fase || fase.estado !== 'activa') {
      this.mostrarToast(' Esta fase no está activa.');
      return;
    }
    const item = fase.items.find(i => i.id === itemId);
    if (!item) return;
    if (!this.puedeOperarItemEquipo(fresca, item)) return;
    item.completada = !item.completada;
    item.completadaEn = item.completada ? Date.now() : undefined;
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
  }

  /** Marca/desmarca una subtarea de un item. */
  async toggleSubtareaEquipo(t: TareaEquipo, faseId: string, itemId: string, subId: string) {
    if (t.cerrado) return;
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const fase = fresca.fases.find(f => f.id === faseId);
    if (!fase || fase.estado !== 'activa') return;
    const item = fase.items.find(i => i.id === itemId);
    if (!item) return;
    if (!this.puedeOperarItemEquipo(fresca, item)) return;
    const sub = item.subtareas.find(s => s.id === subId);
    if (!sub) return;
    sub.completada = !sub.completada;
    sub.completadaPor = sub.completada ? this.currentUser?.nombre : undefined;
    sub.completadaEn = sub.completada ? Date.now() : undefined;
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
  }

  /** Jefe agrega una tarea nueva en la fase activa, asignada a un integrante. */
  async agregarItemEnVivo(t: TareaEquipo, faseId: string) {
    if (!this.puedeMonitorearEquipo(t) || t.cerrado) return;
    if (!this.nuevoItemTexto.trim() || !this.nuevoItemAsignado) {
      this.mostrarToast(' Falta texto o asignado.');
      return;
    }
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const fase = fresca.fases.find(f => f.id === faseId);
    if (!fase || fase.estado !== 'activa') return;
    fase.items.push({
      id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      asignado: this.nuevoItemAsignado,
      texto: this.nuevoItemTexto.trim(),
      horaLimite: this.nuevoItemHoraLimite || undefined,
      requiresPhoto: this.nuevoItemRequiresPhoto,
      completada: false,
      subtareas: [],
      agregadaPor: this.currentUser?.nombre,
      agregadaEn: Date.now()
    });
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
    this.nuevoItemTexto = '';
    this.nuevoItemHoraLimite = '';
    this.nuevoItemRequiresPhoto = false;
    this.agregandoEnFaseId = null;
    this.mostrarToast(' Tarea agregada al equipo.');
  }

  /** ¿El usuario actual es integrante (o jefe) de este equipo? */
  esIntegranteEquipo(t: TareaEquipo | null): boolean {
    if (!t) return false;
    const mi = this.currentUser?.nombre;
    if (mismoEmpleadoNombre(t.jefeEquipo, mi)) return true;
    return (t.integrantes || []).some(n => mismoEmpleadoNombre(n, mi));
  }

  /** ¿Puede agregar una tarea PROPIA (auto-asignada) en la fase activa?
   *  Cualquier integrante puede; los monitores ya usan agregarItemEnVivo. */
  puedeAgregarTareaPropia(t: TareaEquipo | null): boolean {
    if (!t || t.cerrado) return false;
    return this.esIntegranteEquipo(t) || this.puedeMonitorearEquipo(t);
  }

  /** Integrante agrega una tarea suya (auto-asignada) en la fase activa. */
  async agregarTareaPropiaEnVivo(t: TareaEquipo, faseId: string) {
    if (!this.puedeAgregarTareaPropia(t) || t.cerrado) return;
    if (!this.nuevaTareaPropiaTexto.trim()) {
      this.mostrarToast(' Escribe la tarea que quieres agregar.');
      return;
    }
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const fase = fresca.fases.find(f => f.id === faseId);
    if (!fase || fase.estado !== 'activa') {
      this.mostrarToast(' Esta fase no está activa.');
      return;
    }
    fase.items.push({
      id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      asignado: this.currentUser?.nombre,
      texto: this.nuevaTareaPropiaTexto.trim(),
      horaLimite: this.nuevaTareaPropiaHora || undefined,
      requiresPhoto: false,
      completada: false,
      subtareas: [],
      agregadaPor: this.currentUser?.nombre,
      agregadaEn: Date.now()
    });
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
    this.nuevaTareaPropiaTexto = '';
    this.nuevaTareaPropiaHora = '';
    this.agregandoTareaPropiaFaseId = null;
    this.mostrarToast(' Tu tarea fue agregada.');
  }

  /** Jefe agrega una subtarea dentro de un item existente. */
  async agregarSubtareaEnVivo(t: TareaEquipo, faseId: string, itemId: string) {
    if (!this.puedeMonitorearEquipo(t) || t.cerrado) return;
    if (!this.nuevaSubtareaTexto.trim()) return;
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const fase = fresca.fases.find(f => f.id === faseId);
    const item = fase?.items.find(i => i.id === itemId);
    if (!fase || !item || fase.estado !== 'activa') return;
    const sub: SubtareaEquipo = {
      id: 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      texto: this.nuevaSubtareaTexto.trim(),
      completada: false
    };
    item.subtareas.push(sub);
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
    this.nuevaSubtareaTexto = '';
    this.agregandoSubtareaItemId = null;
  }

  /** Jefe cierra la fase activa. Abre automáticamente la siguiente. */
  async cerrarFaseEquipo(t: TareaEquipo, faseId: string) {
    if (!this.puedeMonitorearEquipo(t) || t.cerrado) return;
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const fase = fresca.fases.find(f => f.id === faseId);
    if (!fase || fase.estado !== 'activa') return;
    // Confirma que todos los items están completos antes de cerrar
    const incompletos = fase.items.filter(i => !i.completada);
    if (incompletos.length > 0) {
      const r = await Swal.fire({
        title: `Quedan ${incompletos.length} tarea(s) incompleta(s)`,
        text: '¿Cerrar la fase de todas formas? Las tareas incompletas quedarán como vencidas.',
        icon: 'warning', showCancelButton: true,
        confirmButtonText: 'Sí, cerrar fase', cancelButtonText: 'Cancelar',
        confirmButtonColor: '#F59E0B'
      });
      if (!r.isConfirmed) return;
    }
    fase.estado = 'completa';
    fase.cerradaEn = Date.now();
    fase.cerradaPor = this.currentUser?.nombre;
    // Abre la siguiente fase si existe
    const siguiente = fresca.fases.find(f => f.orden === fase.orden + 1);
    if (siguiente) {
      siguiente.estado = 'activa';
      siguiente.iniciadaEn = Date.now();
    }
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
    this.mostrarToast(siguiente ? ` Fase cerrada. Inicia: ${siguiente.nombre}` : ' Última fase cerrada.');
  }

  /** Jefe cierra el proyecto completo (solo si todas las fases están completas). */
  async cerrarProyectoEquipo(t: TareaEquipo) {
    if (!this.puedeMonitorearEquipo(t)) return;
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const incompletas = fresca.fases.filter(f => f.estado !== 'completa').length;
    if (incompletas > 0) {
      this.mostrarToast(' Aún hay fases sin cerrar.');
      return;
    }
    const r = await Swal.fire({
      title: '¿Cerrar el proyecto?',
      text: 'Quedará archivado y no aparecerá más en el listado.',
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Cerrar proyecto', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#0F172A'
    });
    if (!r.isConfirmed) return;
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id),
      { cerrado: true, cerradoEn: Date.now() }, { merge: true });
    this.volverDeEquipoDetalle();
  }

  /** Lee el doc fresco antes de mutar (evita race conditions con el snapshot). */
  private async obtenerTareaEquipoFresca(id: string): Promise<TareaEquipo | null> {
    const ref = doc(this.firestore, 'tareas_equipo', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { ...(snap.data() as any), id } as TareaEquipo;
  }

  /** Navegación vista detalle equipo. */
  verDetalleEquipo(t: TareaEquipo) {
    this.tareaEquipoSeleccionada.set(t);
    this.vistaEquipo.set('detalle');
  }
  volverDeEquipoDetalle() {
    this.tareaEquipoSeleccionada.set(null);
    this.vistaEquipo.set('lista');
  }

  cerrarModal() { this.isModalOpen = false; }
  agregarItem() {
    this.formItems.push({
      text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
      permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 60,
      fechaInicio: '', horaInicio: '', fechaLimite: '', horaLimite: '',
      date: '', time: ''
    });
  }
  eliminarItem(index: number) { this.formItems.splice(index, 1); }
  trackByIndex(index: number, _obj: any): any { return index; }

  /** trackBy para los *ngFor de checklists. Usa el id firestore para no
   *  destruir/recrear las tarjetas cuando solo cambian campos internos. */
  trackByChecklist(_: number, c: any): any { return c?.id || c?._asignacionId || _; }

  abrirEditarChecklistActual() {
    const actual = this.checklistSeleccionado();
    if (!actual) return;
    this.cargarChecklistEnFormParaEditar(actual);
  }

  /**
   * Abre el modal de Tarea Única en modo edición desde una tarjeta del listado.
   * Solo admin (o el creador de la tarea) puede hacerlo.
   */
  editarTareaUnica(checklist: any, event: Event) {
    event.stopPropagation();
    const esAdmin = this.currentUser?.rol === 'admin';
    const esCreador = checklist.createdBy === this.currentUser?.nombre;
    if (!esAdmin && !esCreador) {
      Swal.fire({ icon: 'error', title: 'Sin permiso', text: 'Solo el creador o un administrador pueden editar.', confirmButtonColor: '#0F172A' });
      return;
    }
    this.cargarChecklistEnFormParaEditar(checklist);
  }

  /** Carga un checklist en el formulario de Tarea Única para editarlo. */
  private cargarChecklistEnFormParaEditar(actual: any) {
    this.isEditandoTarea = true;
    this.editandoChecklistId = (actual.id ?? '').toString();
    this.formName = actual.name || '';
    this.formAssigned = actual.assigned ? [actual.assigned] : [];
    this.formStore = actual.store || '';
    this.formItems = actual.items ? JSON.parse(JSON.stringify(actual.items)) : [];
    this.fasesTemporales = actual.subtareas ? JSON.parse(JSON.stringify(actual.subtareas)) : [];
    // Preset de fecha: arranca en custom con la fecha actual del checklist.
    this.formFechaTarea = actual.date || this.hoyIsoStr;
    this.presetFechaTarea = 'custom';
    // Tipo de evidencia derivado del primer item para que el wizard lo refleje.
    const it = this.formItems[0];
    if (it?.requiresAntesDespues) this.wizardTipoEvidencia = 'antesDespues';
    else if (it?.requiresVariasFotos) this.wizardTipoEvidencia = 'variasFotos';
    else if (it?.requiresPhoto) this.wizardTipoEvidencia = 'foto';
    else this.wizardTipoEvidencia = 'ninguna';
    this.wizardStep = 1;
    this.terminoBusquedaEmpleadoWizard = '';
    this.isModalOpen = true;
  }

  async enviarAvisoPorCorreo(empleadoNombre: string, nombreTarea: string) {
    const empleado = this.empleados().find(emp => emp.nombre === empleadoNombre);
    const correoDestino = empleado?.correo || empleado?.email;
    if (!correoDestino) {
      this.mostrarToast(` ⚠️ No se pudo enviar correo a ${empleadoNombre}.`);
      return;
    }
    const nombreAsignador = this.currentUser?.nombre || 'Administración';
    const asunto = `NUEVA TAREA de ${nombreAsignador}: ${nombreTarea} - Mega Dulces Task`;
    const cuerpo = `Hola ${empleadoNombre},\n\n¡${nombreAsignador} te ha asignado una nueva tarea!\n\n 📌 Operación: ${nombreTarea}\n\nIngresa a https://md-chlist.vercel.app/\n\nSaludos,\n${nombreAsignador}.`;
    const googleScriptUrl = 'https://script.google.com/macros/s/AKfycbw3rrfQizd-jHzz0gBEF3Gj8fOEYOnJ-w4X1rY1GoKAzn7636mnEyDrd7gvSqvyLNH9sg/exec';
    const miCorreo = this.currentUser?.correo || 'gerencia@megadulces.com';
    try {
      await fetch(googleScriptUrl, {
        method: 'POST', mode: 'no-cors',
        body: JSON.stringify({ to: correoDestino, subject: asunto, body: cuerpo, replyTo: miCorreo })
      });
    } catch (error) { console.error(' ❌ Error enviando correo:', error); }
  }

  /**
   * Devuelve los nombres de empleados que tienen día de descanso en la fecha dada.
   * Consulta puntual a Firestore filtrada por semanaISO (1 documento por trabajador/semana).
   */
  private async verificarConflictosDescanso(empleadosNombres: string[], fechaStr: string): Promise<string[]> {
    if (!fechaStr) return [];
    try {
      // Forzamos hora 12:00 para evitar saltos de día por timezone
      const fecha = new Date(fechaStr + 'T12:00:00');
      const semana = obtenerSemanaISO(fecha);
      const nombreDia = obtenerNombreDia(fecha);

      const descansosRef = collection(this.firestore, 'descansos_semanales');
      const q = query(descansosRef, where('semanaISO', '==', semana));
      const snap = await getDocs(q);
      const docs: any[] = [];
      snap.forEach(d => docs.push(d.data()));

      const conflictos: string[] = [];
      for (const nombre of empleadosNombres) {
        const emp = this.empleados().find((e: any) => e.nombre === nombre);
        if (!emp) continue;
        const uid = emp.uid || emp.id || emp.idFirestore;
        if (!uid) continue;
        const doc = docs.find(d => d.userId === uid);
        if (doc && doc.dias?.includes(nombreDia)) {
          conflictos.push(nombre);
        }
      }
      return conflictos;
    } catch (e) {
      console.error('Error verificando descansos:', e);
      return []; // En caso de error, no bloqueamos el guardado
    }
  }

  async guardarChecklistUnico() {
    if (!this.formName || this.formAssigned.length === 0) {
      alert('Faltan datos.');
      return;
    }

    const tareasValidas = this.formItems
      .filter(item => item.text.trim() !== '')
      .map((item, i) => ({
        id: item.id || (Date.now() + i),
        text: item.text,
        requiresPhoto: item.requiresPhoto,
        requiresAntesDespues: item.requiresAntesDespues,
        requiresVariasFotos: item.requiresVariasFotos || false,
        permiteGaleria: item.permiteGaleria || false,
        permiteDocumentos: item.permiteDocumentos || false,
        tiempoEstimado: item.requiresAntesDespues ? (item.tiempoEstimado || 30) : null,
        archivoInstruccion: item.archivoInstruccion || null,
        nombreArchivo: item.nombreArchivo || null,
        fechaInicio: item.fechaInicio || null,
        horaInicio:  item.horaInicio  || null,
        fechaLimite: item.fechaLimite || null,
        horaLimite:  item.horaLimite  || null,
        date: item.fechaLimite || item.date || null,
        time: item.horaLimite  || item.time || null,
        // 🔁 En edición preservamos lo que el trabajador ya haya hecho (evidencia,
        // checks). En creación normal item.* es undefined → quedan vacíos.
        checked: item.checked || false,
        photo: item.photo || null,
        photoTime: item.photoTime || null,
        photoAntes: item.photoAntes || null,
        photoAntesTime: item.photoAntesTime || null,
        photoAntesTimestamp: item.photoAntesTimestamp || null,
        photoDespues: item.photoDespues || null,
        photoDespuesTime: item.photoDespuesTime || null,
        photos: item.photos || [],
        tipo: 'tarea'
      }));

    if (tareasValidas.length === 0) {
      alert('Agrega tareas.');
      return;
    }

    // 🔴 VALIDACIÓN DE DÍA DE DESCANSO
    const offsetTz = new Date().getTimezoneOffset() * 60000;
    const fechaCheckStr = tareasValidas[0].date ||
      new Date(Date.now() - offsetTz).toISOString().split('T')[0];
    const conflictosDescanso = await this.verificarConflictosDescanso(this.formAssigned, fechaCheckStr);
    if (conflictosDescanso.length > 0) {
      const html = `Los siguientes trabajadores tienen <strong>día de descanso</strong> el ${fechaCheckStr}:` +
        `<ul style="text-align:left; margin: 12px 0; padding-left: 24px;">` +
        conflictosDescanso.map((n: string) => `<li>${n}</li>`).join('') +
        `</ul>¿Asignarles la tarea de todas formas?`;
      const res = await Swal.fire({
        title: '📅 Día de descanso detectado',
        html,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, asignar igual',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#0F172A'
      });
      if (!res.isConfirmed) return;
    }

    const urlsWhatsApp: string[] = [];
    const offsetGlobal = new Date().getTimezoneOffset() * 60000;
    const hoyGlobal = new Date(Date.now() - offsetGlobal).toISOString().split('T')[0];

    // 🔧 Modo edición: sobreescribe el doc existente conservando id, timestamp
    // y createdBy. NO crea uno nuevo, NO itera por formAssigned (en edición se
    // edita un solo checklist a la vez).
    if (this.isEditandoTarea && this.editandoChecklistId) {
      const payload: any = {
        id: this.editandoChecklistId,
        name: this.formName,
        assigned: this.formAssigned[0],
        store: this.formStore,
        date: tareasValidas[0].date || hoyGlobal,
        time: tareasValidas[0].time || '23:59',
        items: JSON.parse(JSON.stringify(tareasValidas)),
        subtareas: JSON.parse(JSON.stringify(this.fasesTemporales))
      };
      await setDoc(doc(this.firestore, 'checklists', this.editandoChecklistId), payload, { merge: true });
      this.mostrarToast(' ✅ Tarea actualizada');
      this.cerrarModal();
      this.isEditandoTarea = false;
      this.editandoChecklistId = null;
      return;
    }

    this.formAssigned.forEach((empleadoNombre, index) => {
      const uniqueId = Date.now() + index;
      const hoy = hoyGlobal;

      const checklistTareas: any = {
        id: uniqueId,
        timestampCreacion: Date.now(),
        name: this.formName,
        assigned: empleadoNombre,
        store: this.formStore,
        date: tareasValidas[0].date || hoy,
        time: tareasValidas[0].time || '23:59',
        status: 'pendiente',
        enviado: false,
        createdBy: this.currentUser?.nombre || 'Desconocido',
        notaEmpleado: '',
        items: JSON.parse(JSON.stringify(tareasValidas)),
        subtareas: JSON.parse(JSON.stringify(this.fasesTemporales))
      };

      // Orden de mantenimiento: solo se guarda si la tarea fue creada con store='MANTENIMIENTO'.
      // Asi el detalle del checklist puede mostrar la info adicional y filtros pueden buscar
      // por prioridad/tipo despues sin afectar a tareas normales.
      if (this.formStore === 'MANTENIMIENTO') {
        checklistTareas.mantenimiento = {
          sucursalOrigen: this.formMantSucursalOrigen,
          tipo: this.formMantTipo,
          ubicacion: (this.formMantUbicacion || '').trim(),
          prioridad: this.formMantPrioridad,
          fotoInicial: this.formMantFoto || null,
          reportadoPor: this.currentUser?.nombre || 'Desconocido'
        };
      }

      this.guardarEnLaNube(checklistTareas);

      if (this.notificarPorWhatsApp) {
        const datosEmpleado = this.empleados().find(e => e.nombre === empleadoNombre);
        let telefono = datosEmpleado?.telefono || '';
        telefono = telefono.replace(/[\s\- \(\) ]/g, '');
        if (telefono.startsWith('+')) telefono = telefono.slice(1);
        if (telefono.length === 10) telefono = '52' + telefono;
        if (telefono) {
          const urlApp = 'https://md-chlist.vercel.app';
          const mensaje =
            `*Mega Dulces Task* 🍭\n\n` +
            `¡Hola *${this.limpiarEmojis(empleadoNombre)}*!\n` +
            `Se te ha asignado un nuevo checklist: *${this.limpiarEmojis(this.formName)}*\n\n` +
            ` 📅 Fecha: ${checklistTareas.date}\n` +
            ` ⏰ Hora Límite: ${this.formatearHora(checklistTareas.time)}\n\n` +
            ` 🔗 Entra aquí: ${urlApp}`;
          const url = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
          urlsWhatsApp.push(url);
        }
      }

      if (this.notificarPorCorreo) {
        this.enviarAvisoPorCorreo(empleadoNombre, this.formName);
      }
    });

    urlsWhatsApp.forEach((url, i) => {
      setTimeout(() => { window.open(url, '_blank'); }, i * 800);
    });

    this.mostrarToast(' ✅ ¡Tareas creadas y avisos generados!');
    this.cerrarModal();
  }

  async guardarCambiosChecklist() {
    if (!this.formName || this.formAssigned.length === 0) { alert('Faltan datos.'); return; }
    const actual = this.checklistSeleccionado();
    if (!actual) return;
    const tareasValidas = this.formItems.filter(item => item.text.trim() !== '').map((item, i) => {
      const itemOriginal = actual.items.find((orig: any) => orig.text === item.text);
      if (itemOriginal) {
        return {
          ...itemOriginal, requiresPhoto: item.requiresPhoto, requiresAntesDespues: item.requiresAntesDespues,
          requiresVariasFotos: item.requiresVariasFotos || false, permiteGaleria: item.permiteGaleria || false,
          permiteDocumentos: item.permiteDocumentos || false, tiempoEstimado: item.tiempoEstimado,
          archivoInstruccion: item.archivoInstruccion || itemOriginal.archivoInstruccion || null,
          nombreArchivo: item.nombreArchivo || itemOriginal.nombreArchivo || null,
          fechaInicio: item.fechaInicio || itemOriginal.fechaInicio || null,
          horaInicio:  item.horaInicio  || itemOriginal.horaInicio  || null,
          fechaLimite: item.fechaLimite || itemOriginal.fechaLimite || null,
          horaLimite:  item.horaLimite  || itemOriginal.horaLimite  || null
        };
      }
      return {
        id: Date.now() + i, text: item.text, requiresPhoto: item.requiresPhoto,
        requiresVariasFotos: (item as any).requiresVariasFotos || false,
        permiteGaleria: (item as any).permiteGaleria || false,
        permiteDocumentos: (item as any).permiteDocumentos || false,
        tiempoEstimado: item.requiresAntesDespues ? (item.tiempoEstimado || 30) : null,
        archivoInstruccion: (item as any).archivoInstruccion || null,
        nombreArchivo: (item as any).nombreArchivo || null,
        fechaInicio: item.fechaInicio || null,
        horaInicio:  item.horaInicio  || null,
        fechaLimite: item.fechaLimite || null,
        horaLimite:  item.horaLimite  || null,
        date: item.fechaLimite || actual.date,
        time: item.horaLimite  || actual.time || '23:59',
        checked: false,
        photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null, tipo: 'tarea'
      };
    });
    if (tareasValidas.length === 0) { alert('Agrega tareas.'); return; }

    try {
      await setDoc(doc(this.firestore, 'checklists', actual.id.toString()), {
        name: this.formName, assigned: this.formAssigned[0], store: this.formStore,
        items: tareasValidas,
        subtareas: this.fasesTemporales
      }, { merge: true });

      this.mostrarToast(' ✏️ ¡Tarea actualizada con éxito!');
      actual.name = this.formName; actual.assigned = this.formAssigned[0]; actual.store = this.formStore;
      actual.items = tareasValidas;
      actual.subtareas = this.fasesTemporales;
      this.cerrarModal();
    } catch (error) { alert('Error al actualizar la tarea.'); }
  }

  toggleEmpleadoRutina(nombre: string) {
    const index = this.formAssignedRutina.indexOf(nombre);
    if (index > -1) this.formAssignedRutina.splice(index, 1);
    else this.formAssignedRutina.push(nombre);
  }

  asignarATodoMiPersonal() {
    const todosMisEmpleados = this.empleados().map(emp => emp.nombre);
    this.formAssigned = [...todosMisEmpleados];
    this.mostrarToast(` 🚀 ¡Fuego! Asignado a todo el personal.`);
  }

  abrirModalRutinas() {
    this.isEditMode = false;
    this.formNameRutinaOriginal = '';
    this.formAssignedRutinaOriginal = '';
    this.formNameRutina = '';
    this.formAssignedRutina = [];
    this.formStoreRutina = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    // 📅 fechaInicio por defecto = hoy
    const hoyStr = this.hoyIsoStr;
    this.formRutinas = [{
      text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
      permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 60,
      frecuencia: 'Diaria', fechaInicio: hoyStr, fechaFin: null,
      horaInicio: '', horaLimite: '',
      diaSemana: 'Lunes', diaMes: 1
    }];
    // 🧙 Reset wizard de rutinas
    this.wizardStepRutina = 1;
    this.wizardTipoEvidenciaRutina = 'ninguna';
    this.terminoBusquedaEmpleadoWizardRutina = '';
    this.isModalRutinasOpen = true;
  }

  cerrarModalRutinas() { this.isModalRutinasOpen = false; }

  agregarRutina() {
    this.formRutinas.push({
      text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
      permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 60,
      frecuencia: 'Diaria', fechaFin: null,
      horaInicio: '', horaLimite: '',
      diaSemana: 'Lunes', diaMes: 1
    });
  }

  eliminarRutina(index: number) { this.formRutinas.splice(index, 1); }

  async guardarBloqueRutinas() {
    if (!this.formNameRutina || this.formAssignedRutina.length === 0) { alert('Faltan datos.'); return; }
    const rutinasValidas = this.formRutinas.filter(rutina => rutina.text.trim() !== '').map((rutina, i) => ({
      id: Date.now() + 1000 + i,
      text: rutina.text,
      requiresPhoto: rutina.requiresPhoto,
      requiresAntesDespues: rutina.requiresAntesDespues || false,
      requiresVariasFotos: rutina.requiresVariasFotos || false,
      permiteGaleria: rutina.permiteGaleria || false,
      permiteDocumentos: rutina.permiteDocumentos || false,
      tiempoEstimado: rutina.requiresAntesDespues ? (rutina.tiempoEstimado || 30) : null,
      archivoInstruccion: rutina.archivoInstruccion || null,
      nombreArchivo: rutina.nombreArchivo || null,
      checked: false, photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null,
      tipo: 'rutina',
      frecuencia: rutina.frecuencia,
      fechaInicio: rutina.fechaInicio || null,
      fechaFin: rutina.fechaFin || null,
      horaInicio: rutina.horaInicio || null,
      horaLimite: rutina.horaLimite || null,
      diaSemana: rutina.diaSemana || 'Lunes',
      diaMes: rutina.diaMes || 1
    }));
    if (rutinasValidas.length === 0) { alert('Agrega rutinas.'); return; }
    if (this.isEditMode) {
      // 🔄 Edición libre: el admin pudo cambiar nombre, sucursal o asignados.
      // Borramos el molde VIEJO usando el nombre+assigned ORIGINAL (no el nuevo),
      // y también soft-delete los checklists ya generados del original para que
      // no queden duplicados con datos obsoletos.
      const nombreViejo = this.formNameRutinaOriginal || this.formNameRutina;
      const assignedViejo = this.formAssignedRutinaOriginal || this.formAssignedRutina[0];

      const moldesRef = collection(this.firestore, 'moldes_checklists');
      const moldesSnap = await getDocs(moldesRef);
      for (const mDoc of moldesSnap.docs) {
        const mData = mDoc.data() as any;
        if (mData.name === nombreViejo && mData.assigned === assignedViejo) {
          await deleteDoc(doc(this.firestore, 'moldes_checklists', mDoc.id));
        }
      }
      const chkRef = collection(this.firestore, 'checklists');
      const chkSnap = await getDocs(chkRef);
      for (const cDoc of chkSnap.docs) {
        const cData = cDoc.data() as any;
        if ((cData.name || '').startsWith(nombreViejo) && cData.assigned === assignedViejo && !cData.enviado) {
          await setDoc(doc(this.firestore, 'checklists', cDoc.id), { eliminado: true }, { merge: true });
        }
      }
    }
    this.formAssignedRutina.forEach((empleadoNombre) => {
      const rutinasPorFrecuencia: { [key: string]: any[] } = {};
      rutinasValidas.forEach(r => {
        const llaveGrupo = r.frecuencia === 'Diaria' ? 'Diaria' : (r.frecuencia === 'Semanal' || r.frecuencia === 'Catorcenal') ? `${r.frecuencia}_${r.diaSemana}` : `${r.frecuencia}_${r.diaMes}`;
        if (!rutinasPorFrecuencia[llaveGrupo]) rutinasPorFrecuencia[llaveGrupo] = [];
        rutinasPorFrecuencia[llaveGrupo].push(r);
      });
      Object.keys(rutinasPorFrecuencia).forEach((llaveGrupo) => {
        const partesGrupo = llaveGrupo.split('_');
        const frecuenciaReal = partesGrupo[0];
        let diaSemanaReal = null; let diaMesReal = null;
        if (frecuenciaReal === 'Semanal' || frecuenciaReal === 'Catorcenal') diaSemanaReal = partesGrupo.length > 1 ? partesGrupo[1] : 'Lunes';
        else if (frecuenciaReal === 'Mensual' || frecuenciaReal === 'Trimestral') diaMesReal = partesGrupo.length > 1 ? parseInt(partesGrupo[1], 10) : 1;
        const nombreMoldeLimpio = this.formNameRutina.replace(/\s+/g, '_').toLowerCase();
        const empleadoLimpio = empleadoNombre.replace(/\s+/g, '_').toLowerCase();
        const moldeId = `molde_${nombreMoldeLimpio}_${empleadoLimpio}_${llaveGrupo}`;
        const nuevoMolde = {
          id: moldeId, name: this.formNameRutina, assigned: empleadoNombre, store: this.formStoreRutina,
          frecuencia: frecuenciaReal, diaSemana: diaSemanaReal, diaMes: diaMesReal, timestampCreacion: Date.now(),
          createdBy: this.currentUser?.nombre || 'Desconocido',
          items: JSON.parse(JSON.stringify(rutinasPorFrecuencia[llaveGrupo]))
        };
        setDoc(doc(this.firestore, 'moldes_checklists', moldeId), nuevoMolde);
      });
    });
    this.mostrarToast(this.isEditMode ? ' 🔄 ¡Bloque actualizado!' : ' 🔄 ¡Bloque guardado!');
    this.cerrarModalRutinas();
  }

  formatearHora(hora24: string): string {
    if (!hora24) return ''; const partes = hora24.split(':'); if (partes.length !== 2) return hora24;
    let horas = parseInt(partes[0], 10); const ampm = horas >= 12 ? 'PM' : 'AM';
    horas = horas % 12; horas = horas ? horas : 12;
    const horasStr = horas < 10 ? '0' + horas : horas.toString();
    return `${horasStr}:${partes[1]} ${ampm}`;
  }

  limpiarEmojis(texto: string): string {
    if (!texto) return '';
    return texto.replace(/([✀-➿]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD10-\uDDFF])/g, '').trim();
  }

  esImagen(url: string): boolean {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    if (urlLower.includes('/raw/upload/') || urlLower.match(/\.(pdf|xls|xlsx|doc|docx|csv|txt|zip|rar)$/)) return false;
    return true;
  }

  agregarFase() {
    if (!this.nuevaFaseTexto.trim()) return;
    this.fasesTemporales.push({ texto: this.nuevaFaseTexto, completada: false });
    this.nuevaFaseTexto = '';
  }

  eliminarFase(index: number) { this.fasesTemporales.splice(index, 1); }
  toggleFase(index: number) { this.fasesTemporales[index].completada = !this.fasesTemporales[index].completada; }
  toggleFaseEnPantallaDetalle(index: number, checklist: any) {
    if (!checklist.subtareas) return;
    checklist.subtareas[index].completada = !checklist.subtareas[index].completada;
    this.guardarEnLaNube(checklist);
  }

  agregarIntegranteEquipo() {
    if (!this.empleadoSeleccionadoEquipo) return;
    const existe = this.integrantesEquipo.find(i => i.nombre === this.empleadoSeleccionadoEquipo);
    if (existe) {
      this.mostrarToast('⚠️ Este empleado ya está en la lista.');
      return;
    }
    const empData = this.empleados().find(e => e.nombre === this.empleadoSeleccionadoEquipo);
    this.integrantesEquipo.push({
      nombre: this.empleadoSeleccionadoEquipo,
      departamento: empData?.sucursal || empData?.sucursales?.[0] || 'General',
      iniciales: this.empleadoSeleccionadoEquipo.substring(0, 2).toUpperCase(),
      fases: []
    });
    this.empleadoSeleccionadoEquipo = '';
    this.busquedaEmpleadoEquipo = '';
  }

  eliminarIntegranteEquipo(index: number) { this.integrantesEquipo.splice(index, 1); }

  get empleadosEquipoFiltrados() {
    if (!this.busquedaEmpleadoEquipo) return this.empleados();
    const termino = this.busquedaEmpleadoEquipo.toLowerCase();
    return this.empleados().filter((emp: any) => emp.nombre.toLowerCase().includes(termino));
  }

  seleccionarEmpleadoEquipo(emp: any) {
    this.empleadoSeleccionadoEquipo = emp.nombre;
    this.busquedaEmpleadoEquipo = emp.nombre;
    this.mostrarDropdownEquipo = false;
  }

  ocultarDropdownEquipo() {
    setTimeout(() => { this.mostrarDropdownEquipo = false; }, 200);
  }

  abrirActividadIntegrante(index: number) {
    this.integranteActualIndex = index;
    const integrante = this.integrantesEquipo[index];
    if (integrante.fases && integrante.fases.length > 0) {
      this.formItemsActividad = JSON.parse(JSON.stringify(integrante.fases));
    } else {
      this.formItemsActividad = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, fechaInicio: '', horaInicio: '', fechaLimite: '', horaLimite: '' }];
    }
    if (integrante.listaFases && integrante.listaFases.length > 0) {
      this.fasesTemporalesIntegrante = JSON.parse(JSON.stringify(integrante.listaFases));
    } else {
      this.fasesTemporalesIntegrante = [];
    }
    this.isModalActividadIntegranteOpen = true;
  }

  guardarActividadesIntegrante() {
    if (this.integranteActualIndex > -1) {
      this.integrantesEquipo[this.integranteActualIndex].fases = [...this.formItemsActividad];
      this.integrantesEquipo[this.integranteActualIndex].listaFases = [...this.fasesTemporalesIntegrante];
      this.mostrarToast('✅ Tareas asignadas');
      this.cerrarModalActividadIntegrante();
    }
  }

  cerrarModalActividadIntegrante() {
    this.isModalActividadIntegranteOpen = false;
    this.integranteActualIndex = -1;
  }

  agregarActividadIntegrante() {
    this.formItemsActividad.push({ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, fechaInicio: '', horaInicio: '', fechaLimite: '', horaLimite: '' });
  }

  eliminarActividadIntegrante(index: number) {
    this.formItemsActividad.splice(index, 1);
  }

  agregarFaseIntegrante() {
    if (this.nuevaFaseIntegranteTexto.trim()) {
      this.fasesTemporalesIntegrante.push({ texto: this.nuevaFaseIntegranteTexto.trim(), completada: false });
      this.nuevaFaseIntegranteTexto = '';
    }
  }

  eliminarFaseIntegrante(index: number) {
    this.fasesTemporalesIntegrante.splice(index, 1);
  }
}