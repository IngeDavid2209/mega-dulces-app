import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Firestore, collection, doc, setDoc, getDoc, deleteDoc, onSnapshot, getDocs, query, where } from '@angular/fire/firestore';
import * as localforage from 'localforage';
import Swal from 'sweetalert2';
import { esAdminGlobal, esAdminLimitado, sucursalesPermitidas, normalizarNombre } from '../../../shared/permisos.util';
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
  formItems: any[] = [{
    text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
    permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 60,
    fechaInicio: '', horaInicio: '', fechaLimite: '', horaLimite: '',
    date: '', time: ''
  }];
  isModalRutinasOpen = false;
  isEditMode = false;
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
  sucursalesDisponibles = signal<string[]>([]);

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
  private destructoresRadares: (() => void)[] = [];
  private intervalId: any;

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

  puedeAvanzarWizard(): boolean {
    switch (this.wizardStep) {
      case 1: return !!this.formName && this.formName.trim().length > 0;
      case 2: return !!this.formStore;
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
   */
  private empleadoPerteneceASucursal(emp: any, store: string): boolean {
    if (store === 'ADMINISTRADORES DEL SISTEMA') return emp.rol === 'admin';
    const susSucursales = emp.sucursales || [emp.sucursal || ''];
    if (emp.rol === 'admin') {
      return susSucursales.includes(store);
    }
    if (emp.sucursales && emp.sucursales.includes('General (Acceso Total)')) return true;
    return susSucursales.includes(store);
  }

  get checklistsFiltrados() {
    if (!this.terminoBusquedaChecklist.trim()) return this.checklists();
    const termino = this.terminoBusquedaChecklist.toLowerCase();
    return this.checklists().filter(c =>
      c.name?.toLowerCase().includes(termino) ||
      c.assigned?.toLowerCase().includes(termino) ||
      c.store?.toLowerCase().includes(termino)
    );
  }

  mostrarToast(mensaje: string) {
    this.toastMessage = mensaje;
    setTimeout(() => { this.toastMessage = ''; }, 3500);
  }

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) this.currentUser = JSON.parse(sesion);
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
    // 🔥 Detiene el robot notificador (setInterval de 30s)
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** ¿El usuario actual es el dueño del checklist actualmente abierto (tolerante a tildes/espacios)? */
  esElDueno(): boolean {
    const cs = this.checklistSeleccionado();
    if (!cs) return false;
    return normalizarNombre(this.currentUser?.nombre) === normalizarNombre(cs.assigned);
  }

  /** ¿Puede editar el checklist actual? (es el dueño y no se ha enviado). */
  puedoEditarChecklistActivo(): boolean {
    const cs = this.checklistSeleccionado();
    if (!cs || cs.enviado) return false;
    return this.esElDueno();
  }

  /** ¿Puede editar este item específico? (no enviado, es dueño, no vencido). */
  puedoEditarItem(item: any): boolean {
    if (!this.puedoEditarChecklistActivo()) return false;
    const cs = this.checklistSeleccionado();
    return !this.isTareaVencida(item, cs.date);
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

  conectarRadarNube() {
    const usuariosRef = collection(this.firestore, 'usuarios');
    const radarUsuarios = onSnapshot(usuariosRef, (snapshot) => {
      const todosLosUsuarios: any[] = [];
      snapshot.forEach(docSnap => todosLosUsuarios.push(docSnap.data()));

      // 🤖 Cache para el Robot V2 (necesita expandir roles → personas)
      this.usuariosV2 = todosLosUsuarios;
      this.dispararRobotV2();

      const todasLasSucursales = [
        'ADMINISTRADORES DEL SISTEMA', 'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
        'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro', 'OFICINAS CORPORATIVAS',
        'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
      ];

      // 🔥 SUCURSALES DISPONIBLES
      if (esAdminGlobal(this.currentUser)) {
        this.sucursalesDisponibles.set(todasLasSucursales);
      } else if (esAdminLimitado(this.currentUser) || this.currentUser?.puedeCrearChecklists) {
        const permitidas = sucursalesPermitidas(this.currentUser);
        const misSucursales = permitidas ?? [];
        const sucursalesFiltradas = todasLasSucursales.filter(
          s => s !== 'ADMINISTRADORES DEL SISTEMA' && misSucursales.includes(s)
        );
        this.sucursalesDisponibles.set(sucursalesFiltradas);
      }

      // 🔥 EMPLEADOS DISPONIBLES (a quién puedo asignarle tareas)
      if (esAdminGlobal(this.currentUser)) {
        const personalActivo = todosLosUsuarios.filter((u: any) => u.rol === 'trabajador' || u.rol === 'admin');
        this.empleados.set(personalActivo);
      } else if (esAdminLimitado(this.currentUser) || this.currentUser?.puedeCrearChecklists) {
        const permitidas = sucursalesPermitidas(this.currentUser);
        const misSucursales = permitidas ?? [];
        // Trabajadores + admins NO globales que compartan alguna sucursal conmigo.
        // Excluimos admins globales (gerencia general) para no exponerlos en el selector.
        const candidatos = todosLosUsuarios.filter((u: any) => {
          if (u.rol === 'trabajador') return true;
          if (u.rol === 'admin'
              && u.alcance !== 'global'
              && !(u.sucursales || []).includes('General (Acceso Total)')) return true;
          return false;
        });
        const empleadosFiltrados = candidatos.filter((t: any) => {
          const susSucursales = t.sucursales || [t.sucursal || ''];
          return susSucursales.some((s: string) => misSucursales.includes(s));
        });
        this.empleados.set(empleadosFiltrados);
      }
    });
    this.destructoresRadares.push(radarUsuarios);

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

    // 💸 OPTIMIZACIÓN: pedimos solo checklists de hoy en adelante.
    // Antes traíamos TODA la historia y filtrábamos en cliente → reads masivos.
    const offset = new Date().getTimezoneOffset() * 60000;
    const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];

    const checklistsRef = collection(this.firestore, 'checklists');
    const checklistsQuery = query(checklistsRef, where('date', '>=', fechaHoyLocal));
    const radarChecklists = onSnapshot(checklistsQuery, (snapshot) => {
      const todasLasListas: any[] = [];

      snapshot.forEach(docSnap => {
        const c = docSnap.data() as any;
        if (c.eliminado === true || c.enviado === true) return;
        // El filtro de fecha ya viene aplicado en el query, no hace falta repetirlo.
        const tareasMarcadas = c.items.filter((i: any) => i.checked).length;
        c.calcCompletados = tareasMarcadas;
        c.calcProgreso = Math.round((tareasMarcadas / c.items.length) * 100) || 0;
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

      if (esAdminGlobal(this.currentUser)) {
        // Admin global: ve TODOS los checklists
        this.checklists.set(listasFinales);
      } else if (esAdminLimitado(this.currentUser)) {
        // Admin limitado: ve checklists de sus sucursales asignadas
        const permitidas = sucursalesPermitidas(this.currentUser) ?? [];
        const listasDeMisSucursales = listasFinales.filter(
          (c: any) => permitidas.includes(c.store)
        );
        this.checklists.set(listasDeMisSucursales);
      } else {
        // Trabajador: solo sus propios checklists asignados
        // 🔥 Comparación tolerante a tildes/espacios/casing (mismo bug que en home)
        const miNombreNorm = normalizarNombre(this.currentUser?.nombre);
        const misListas = listasFinales.filter((c: any) => normalizarNombre(c.assigned) === miNombreNorm);
        this.checklists.set(misListas);
        const pendientesActuales = misListas.filter((c: any) => c.status !== 'completo' && c.enviado !== true).length;
        if (this.cantidadPendientesAnterior !== -1 && pendientesActuales > this.cantidadPendientesAnterior) {
          this.lanzarNotificacionInmediata();
        }
        this.cantidadPendientesAnterior = pendientesActuales;
      }
    });
    this.destructoresRadares.push(radarChecklists);

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

  eliminarChecklist(checklist: any, event: Event) {
    event.stopPropagation();
    this.checklistToDelete = checklist;
    this.passwordInput = '';
    this.isPasswordModalOpen = true;
  }

  cerrarPasswordModal() { this.isPasswordModalOpen = false; this.checklistToDelete = null; this.passwordInput = ''; }

  async confirmarEliminacion() {
    if (this.passwordInput !== 'Mega2323') { alert(' ❌ Contraseña maestra incorrecta.'); return; }
    const confirmar = confirm(` ⚠️ ¿Borrar "${this.checklistToDelete.name}" y sus duplicados?`);
    if (confirmar) {
      try {
        const targetName = this.checklistToDelete.name.replace(/ \( (Diaria|Semanal|Catorcenal|Mensual|Trimestral) \) $/, "");
        const targetAssigned = this.checklistToDelete.assigned;
        const checklistsRef = collection(this.firestore, 'checklists');
        const chkSnap = await getDocs(checklistsRef);
        chkSnap.forEach(async (cDoc) => {
          const cData = cDoc.data();
          if (cData['name'].startsWith(targetName) && cData['assigned'] === targetAssigned) {
            await setDoc(doc(this.firestore, 'checklists', cDoc.id), { eliminado: true }, { merge: true });
          }
        });
        const moldesRef = collection(this.firestore, 'moldes_checklists');
        const moldesSnap = await getDocs(moldesRef);
        moldesSnap.forEach(async (mDoc) => {
          const mData = mDoc.data();
          if (targetName.includes(mData['name']) && mData['assigned'] === targetAssigned) {
            await deleteDoc(doc(this.firestore, 'moldes_checklists', mDoc.id));
          }
        });
        alert(' 🗑️ Checklist eliminado.');
      } catch (error) { alert(' ❌ Error al eliminar.'); }
    }
    this.cerrarPasswordModal();
  }

  async editarBloqueRutinas(checklist: any, event: Event) {
    event.stopPropagation();
    this.isEditMode = true;
    const targetName = checklist.name.replace(/ \( (Diaria|Semanal|Catorcenal|Mensual|Trimestral) \) $/, "");
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

    // 📸 Compresión cliente: bajamos JPGs de 4-6 MB a ~300 KB antes de subir.
    // Si no es imagen (PDF, etc.) o ya es pequeña, devuelve el original sin tocar.
    const file = await comprimirImagenSiAplica(fileOriginal);

    if (!navigator.onLine) {
      item[tipoFoto] = 'offline_syncing';
      item.pendienteDeSync = true;
      const ahora = new Date();
      item[tipoFoto + 'Time'] = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      if (tipoFoto === 'photoAntes') item.photoAntesTimestamp = Date.now();
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64String = reader.result as string;
        const indexItem = checklistActual.items.findIndex((i: any) => i === item);
        const fotoEstancada = { idTarea: checklistActual.id, indexItem: indexItem, tipoFoto: tipoFoto, base64: base64String };
        const colaActual: any[] = await localforage.getItem('md_fotos_offline') || [];
        colaActual.push(fotoEstancada);
        await localforage.setItem('md_fotos_offline', colaActual);
        this.actualizarEstado();
        this.mostrarToast(' 📡 Guardado sin conexión.');
      };
      event.target.value = '';
      return;
    }
    const cloudName = 'duherjgyg';
    const uploadPreset = 'fotos_mega';
    item[tipoFoto] = 'subiendo...';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    try {
      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, { method: 'POST', body: formData });
      const data = await response.json();
      if (data.secure_url) {
        item[tipoFoto] = data.secure_url;
        item.pendienteDeSync = false;
        const ahora = new Date();
        item[tipoFoto + 'Time'] = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        if (tipoFoto === 'photoAntes') item.photoAntesTimestamp = Date.now();
        this.actualizarEstado();
      } else {
        item[tipoFoto] = null; this.actualizarEstado(); alert(' ❌ Error de Cloudinary.');
      }
    } catch (error) {
      item[tipoFoto] = null; this.actualizarEstado(); alert(' ❌ Error de conexión.');
    } finally {
      event.target.value = '';
    }
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
  esItemCompleto(item: any): boolean {
    if (item.requiresAntesDespues) {
      return (item.photoAntes !== null && item.photoAntes !== undefined && item.photoAntes !== 'subiendo...') &&
             (item.photoDespues !== null && item.photoDespues !== undefined && item.photoDespues !== 'subiendo...');
    }
    if (item.requiresVariasFotos) {
      return Array.isArray(item.photos) && item.photos.length > 0;
    }
    if (item.requiresPhoto) {
      return (item.photo !== null && item.photo !== undefined && item.photo !== 'subiendo...');
    }
    return item.checked === true;
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
    // 🧙 Reset wizard
    this.wizardStep = 1;
    this.wizardTipoEvidencia = 'ninguna';
    this.terminoBusquedaEmpleadoWizard = '';
    // 📅 Reset preset de fecha (por defecto: hoy)
    this.presetFechaTarea = 'hoy';
    const offset = new Date().getTimezoneOffset() * 60000;
    this.formFechaTarea = new Date(Date.now() - offset).toISOString().split('T')[0];
    this.isModalOpen = true;
  }

  abrirModalEquipo() { this.isModalEquipoOpen = true; }
  cerrarModalEquipo() { this.isModalEquipoOpen = false; }

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
  trackByIndex(index: number, obj: any): any { return index; }

  abrirEditarChecklistActual() {
    const actual = this.checklistSeleccionado();
    if (!actual) return;
    this.isEditandoTarea = true;
    this.formName = actual.name;
    this.formAssigned = [actual.assigned];
    this.formStore = actual.store;
    this.formItems = JSON.parse(JSON.stringify(actual.items));
    this.fasesTemporales = actual.subtareas ? JSON.parse(JSON.stringify(actual.subtareas)) : [];
    this.wizardStep = 1;
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
        id: Date.now() + i,
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
        checked: false,
        photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null,
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

    this.formAssigned.forEach((empleadoNombre, index) => {
      const uniqueId = Date.now() + index;
      const offset = new Date().getTimezoneOffset() * 60000;
      const hoy = new Date(Date.now() - offset).toISOString().split('T')[0];

      const checklistTareas = {
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
      const moldesRef = collection(this.firestore, 'moldes_checklists');
      const moldesSnap = await getDocs(moldesRef);
      moldesSnap.forEach(async (mDoc) => {
        const mData = mDoc.data();
        if (mData['name'] === this.formNameRutina && mData['assigned'] === this.formAssignedRutina[0]) {
          await deleteDoc(doc(this.firestore, 'moldes_checklists', mDoc.id));
        }
      });
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