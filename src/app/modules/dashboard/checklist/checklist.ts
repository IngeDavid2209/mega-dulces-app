import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Firestore, collection, doc, setDoc, getDoc, deleteDoc, onSnapshot, getDocs } from '@angular/fire/firestore';
import * as localforage from 'localforage';

@Component({
  selector: 'app-checklist',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './checklist.html',
  styleUrls: ['./checklist.css']
})
export class ChecklistComponent implements OnInit, OnDestroy {
  // 🔥 VARIABLE PARA EL ROBOT DE ALERTAS 🔥
  ultimaHoraNotificada: number = -1;
  cantidadPendientesAnterior: number = -1;
  
  // 🔥 CONTROLES DE NOTIFICACIÓN (NUEVOS) 🔥
  notificarPorWhatsApp: boolean = true; 
  notificarPorCorreo: boolean = false; 
  
  isMenuOpen = false;
  isEditandoTarea = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  pasoEquipo = 1; // Controla en qué paso del wizard estamos (1, 2 o 3)
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
  isModalActividadIntegranteOpen = false;
  integranteActualIndex: number = -1;
  isModalOpen = false;
  formName = '';

  formItemsActividad: any[] = [];
  busquedaEmpleadoEquipo: string = '';
  // 🔥 VARIABLES DE FASES TEMPORALES
  nuevaFaseTexto: string = '';
  fasesTemporales: any[] = [];
  
  formAssigned: string[] = [];
  formStore = '';
  formItems: any[] = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 30, date: '', time: '' }];
  
  isModalRutinasOpen = false;
  isEditMode = false;
  formNameRutina = '';
  formAssignedRutina: string[] = [];
  formStoreRutina = '';
  formRutinas: any[] = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 30, frecuencia: 'Diaria', fechaFin: null, horaLimite: '', diaSemana: 'Lunes', diaMes: 1 }];
  frecuencias = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral'];
  diasDelMes = Array.from({ length: 31 }, (_, i) => i + 1);
  
  isPasswordModalOpen = false;
  passwordInput = '';
  checklistToDelete: any = null;
  
  checklists = signal<any[]>([]);
  empleados = signal<any[]>([]);
  sucursalesDisponibles = signal<string[]>([]);
  
  private firestore = inject(Firestore);
  private route = inject(ActivatedRoute);
  private destructoresRadares: (() => void)[] = [];
  private intervalId: any;
  
  private sucursalesAdministrativas = [
    'ADMINISTRADORES DEL SISTEMA',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD',
    'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
  ];

  // 🔥 ASIGNAR A TODOS LOS EMPLEADOS DE LA SUCURSAL SELECCIONADA 🔥
  asignarATodos(tipo: 'tarea' | 'rutina') {
    const empleadosParaAsignar = tipo === 'tarea' ? this.empleadosFiltrados : this.empleadosFiltradosRutina;
    if (empleadosParaAsignar.length === 0) {
      this.mostrarToast(' ⚠️ No hay empleados en esta sucursal para asignar.');
      return;
    }
    const nombres = empleadosParaAsignar.map(emp => emp.nombre);
    if (tipo === 'tarea') {
      this.formAssigned = [...nombres];
    } else {
      this.formAssignedRutina = [...nombres];
    }
    this.mostrarToast(` ✅ Se asignaron ${nombres.length} empleados.`);
  }

  // 🔥 LIMPIAR TODA LA SELECCIÓN 🔥
  desmarcarTodos(tipo: 'tarea' | 'rutina') {
    if (tipo === 'tarea') {
      this.formAssigned = [];
    } else {
      this.formAssignedRutina = [];
    }
  }

  esSucursalAdministrativa(sucursal: string): boolean { return this.sucursalesAdministrativas.includes(sucursal); }

  get empleadosFiltrados() {
    if (!this.formStore) return this.empleados();
    return this.empleados().filter(emp => {
      if (this.formStore === 'ADMINISTRADORES DEL SISTEMA') { return emp.rol === 'admin'; }
      if (emp.rol === 'admin') return false;
      if (emp.sucursales && emp.sucursales.includes('General (Acceso Total)')) return true;
      const susSucursales = emp.sucursales || [emp.sucursal || ''];
      return susSucursales.includes(this.formStore);
    });
  }

  get empleadosFiltradosRutina() {
    if (!this.formStoreRutina) return this.empleados();
    return this.empleados().filter(emp => {
      if (this.formStoreRutina === 'ADMINISTRADORES DEL SISTEMA') { return emp.rol === 'admin'; }
      if (emp.rol === 'admin') return false;
      if (emp.sucursales && emp.sucursales.includes('General (Acceso Total)')) return true;
      const susSucursales = emp.sucursales || [emp.sucursal || ''];
      return susSucursales.includes(this.formStoreRutina);
    });
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
    if (sesion) { this.currentUser = JSON.parse(sesion); }
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
    this.intervalId = setInterval(() => {}, 1000);
  }

  ngOnDestroy() {
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
    if (this.intervalId) { clearInterval(this.intervalId); }
  }

  isDespuesExpirado(item: any): boolean {
    if (!item.requiresAntesDespues || !item.photoAntesTimestamp || !item.tiempoEstimado) return false;
    const limite = item.photoAntesTimestamp + (item.tiempoEstimado * 60000);
    return Date.now() > limite;
  }

  getTiempoRestanteTexto(item: any): string {
    if (!item.requiresAntesDespues || !item.photoAntesTimestamp || !item.tiempoEstimado) return '';
    if (item.photoDespues) return 'Completado';
    const limite = item.photoAntesTimestamp + (item.tiempoEstimado * 60000);
    const ahora = Date.now();
    if (ahora > limite) return 'Agotado';
    const faltanMs = limite - ahora;
    const minutos = Math.floor(faltanMs / 60000);
    const segundos = Math.floor((faltanMs % 60000) / 1000);
    return `${minutos}m ${segundos}s`;
  }

  iniciarRobotNotificador() {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
    setInterval(() => {
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

      const todasLasSucursales = [
        'ADMINISTRADORES DEL SISTEMA', 'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
        'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro', 'OFICINAS CORPORATIVAS', 
        'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
      ];
      
      if (this.currentUser?.rol === 'admin') {
        this.sucursalesDisponibles.set(todasLasSucursales);
      } else if (this.currentUser?.puedeCrearChecklists) {
        const misSucursales = this.currentUser.sucursales || [this.currentUser.sucursal || ''];
        const sucursalesFiltradas = todasLasSucursales.filter(s => s !== 'ADMINISTRADORES DEL SISTEMA' && misSucursales.includes(s));
        this.sucursalesDisponibles.set(sucursalesFiltradas);
      }

      if (this.currentUser?.rol === 'admin') {
        const personalActivo = todosLosUsuarios.filter((u: any) => u.rol === 'trabajador' || u.rol === 'admin');
        this.empleados.set(personalActivo);
      } else if (this.currentUser?.puedeCrearChecklists) {
        const trabajadoresUnicamente = todosLosUsuarios.filter((u: any) => u.rol === 'trabajador');
        const misSucursales = this.currentUser.sucursales || [this.currentUser.sucursal || ''];
        const empleadosFiltrados = trabajadoresUnicamente.filter((t: any) => {
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

    const checklistsRef = collection(this.firestore, 'checklists');
    const radarChecklists = onSnapshot(checklistsRef, (snapshot) => {
      const todasLasListas: any[] = [];
      const offset = new Date().getTimezoneOffset() * 60000;
      const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];
      
      snapshot.forEach(docSnap => {
        const c = docSnap.data() as any;
        if (c.eliminado === true || c.enviado === true) return;
        if (c.date >= fechaHoyLocal) {
          const tareasMarcadas = c.items.filter((i: any) => i.checked).length;
          c.calcCompletados = tareasMarcadas;
          c.calcProgreso = Math.round((tareasMarcadas / c.items.length) * 100) || 0;
          todasLasListas.push(c);
        }
      });

      const listasSinClones = new Map();
      todasLasListas.forEach(c => {
        const firma = `${c.name}_${c.assigned}_${c.store}_${c.date}`;
        if (!listasSinClones.has(firma)) {
          listasSinClones.set(firma, c);
        } else {
          const existente = listasSinClones.get(firma);
          if (c.calcProgreso > existente.calcProgreso) { listasSinClones.set(firma, c); }
        }
      });
      const listasFinales = Array.from(listasSinClones.values());
      listasFinales.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return b.timestampCreacion - a.timestampCreacion;
      });

      if (this.currentUser?.rol === 'admin') {
        this.checklists.set(listasFinales);
      } else {
        const misListas = listasFinales.filter((c: any) => c.assigned === this.currentUser.nombre);
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
    if (item.tipo === 'rutina' && item.horaLimite) {
      const partes = item.horaLimite.split(':');
      if (partes.length === 2) { hora = partes[0]; minuto = partes[1]; }
    } else if (item.tipo === 'tarea' && item.time) {
      const partes = item.time.split(':');
      if (partes.length === 2) { hora = partes[0]; minuto = partes[1]; }
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
    if (rutina.frecuencia === 'Catorcenal') return `Cada 2 weeks, los ${rutina.diaSemana || 'Lunes'}`;
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
      if (this.esDiaCerrado(molde.store, fechaActual)) { continue; }
      if (esDomingo && this.esSucursalAdministrativa(molde.store) && molde.frecuencia === 'Diaria') { continue; }

      if (molde.frecuencia === 'Semanal' || molde.frecuencia === 'Catorcenal') {
        if (molde.diaSemana && molde.diaSemana !== diaHoyTexto) { continue; }
        if (molde.frecuencia === 'Catorcenal' && molde.timestampCreacion) {
          const semanaActual = this.getWeekNumber(fechaLocal);
          const semanaCreacion = this.getWeekNumber(new Date(molde.timestampCreacion));
          if (Math.abs(semanaActual - semanaCreacion) % 2 !== 0) { continue; }
        }
      }

      if (molde.frecuencia === 'Mensual' || molde.frecuencia === 'Trimestral') {
        const diaObjetivo = parseInt(molde.diaMes || '1', 10);
        const ultimoDiaDelMesActual = new Date(fechaLocal.getFullYear(), fechaLocal.getMonth() + 1, 0).getDate();
        const diaRealAProcesar = diaObjetivo > ultimoDiaDelMesActual ? ultimoDiaDelMesActual : diaObjetivo;
        if (diaMesActual !== diaRealAProcesar) { continue; }
        if (molde.frecuencia === 'Trimestral' && molde.timestampCreacion) {
          const mesActual = fechaLocal.getMonth();
          const mesCreacion = new Date(molde.timestampCreacion).getMonth();
          if (Math.abs(mesActual - mesCreacion) % 3 !== 0) { continue; }
        }
      }
      const itemsVigentes = molde.items.filter((item: any) => { return !item.fechaFin || fechaString <= item.fechaFin; });
      if (itemsVigentes.length === 0) continue;
      const llavePeriodo = this.obtenerLlavePeriodo(molde.frecuencia, fechaActual);
      const checklistId = `${molde.id}_${llavePeriodo}`;
      const docRef = doc(this.firestore, 'checklists', checklistId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        const nuevoChecklist = {
          id: checklistId, timestampCreacion: Date.now(), name: `${molde.name} (${molde.frecuencia})`,
          assigned: molde.assigned, store: molde.store, date: fechaString, time: '23:59',
          status: 'pendiente', enviado: false, createdBy: 'Robot de Rutinas', notaEmpleado: '',
          items: itemsVigentes.map((i: any) => ({
            ...i, checked: false, photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photos: []
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
      alert('Esta es una "Tarea Única" o no tiene rutinas registradas en la Bóveda. No se puede editar como Bloque.');
      return;
    }
    this.formNameRutina = targetName;
    this.formAssignedRutina = [targetAssigned];
    this.formStoreRutina = sucursalOriginal;
    this.formRutinas = rutinasEncontradas;
    this.isModalRutinasOpen = true;
  }

  verDetalle(checklist: any) { this.checklistSeleccionado.set(checklist); this.vistaActual.set('detalle'); }
  volverALista() { this.checklistSeleccionado.set(null); this.vistaActual.set('lista'); }
  toggleItem(item: any) { item.checked = !item.checked; this.actualizarEstado(); }

  async onFileSelected(event: any, item: any, tipoFoto: string = 'photo') {
    const file = event.target.files[0];
    if (!file) return;
    const checklistActual = this.checklistSeleccionado();
    if (!checklistActual) return;
    if (!navigator.onLine) {
      console.log(' 📡 Sin internet detectado. Guardando foto en bóveda local...');
      item[tipoFoto] = 'offline_syncing';
      item.pendienteDeSync = true;
      const ahora = new Date();
      item[tipoFoto + 'Time'] = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      if (tipoFoto === 'photoAntes') { item.photoAntesTimestamp = Date.now(); }
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
        this.mostrarToast(' 📡 Guardado sin conexión. Se subirá automáticamente.');
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
        if (tipoFoto === 'photoAntes') { item.photoAntesTimestamp = Date.now(); }
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
    const file = event.target.files[0];
    if (!file) return;
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
        this.mostrarToast(' 📎 Documento adjuntado correctamente');
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

  async onMultipleFilesSelected(event: any, item: any) {
    const files: FileList = event.target.files;
    if (!files || files.length === 0) return;
    const checklistActual = this.checklistSeleccionado();
    if (!checklistActual) return;
    if (!item.photos) item.photos = [];
    const cloudName = 'duherjgyg';
    const uploadPreset = 'fotos_mega';
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!navigator.onLine) {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
          const base64String = reader.result as string;
          const indexItem = checklistActual.items.findIndex((it: any) => it === item);
          const colaActual: any[] = await localforage.getItem('md_fotos_offline') || [];
          colaActual.push({ idTarea: checklistActual.id, indexItem, tipoFoto: 'photos_multi', base64: base64String });
          await localforage.setItem('md_fotos_offline', colaActual);
        };
        item.photos.push({ url: 'offline_syncing', time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) });
        this.actualizarEstado();
        this.mostrarToast(' 📡 Foto guardada sin conexión.');
        continue;
      }
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', uploadPreset);
      try {
        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, { method: 'POST', body: formData });
        const data = await response.json();
        if (data.secure_url) {
          item.photos.push({ url: data.secure_url, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) });
          this.actualizarEstado();
        }
      } catch (error) { alert(' ❌ Error al subir una foto.'); }
    }
    event.target.value = '';
  }

  removeMultiPhoto(item: any, index: number) {
    if (item.photos) { item.photos.splice(index, 1); this.actualizarEstado(); }
  }

  removeImage(item: any, tipoFoto: string = 'photo') {
    item[tipoFoto] = null; item[tipoFoto + 'Time'] = null;
    if (tipoFoto === 'photoAntes') { item.photoAntesTimestamp = null; }
    this.actualizarEstado();
  }

  esItemCompleto(item: any): boolean {
    if (!item.checked) return false;
    if (item.requiresAntesDespues) {
      return (item.photoAntes !== null && item.photoAntes !== undefined && item.photoAntes !== 'subiendo...') &&
             (item.photoDespues !== null && item.photoDespues !== undefined && item.photoDespues !== 'subiendo...');
    }
    if (item.requiresPhoto) { return (item.photo !== null && item.photo !== undefined && item.photo !== 'subiendo...'); }
    return true;
  }

  actualizarEstado() {
    const actual = this.checklistSeleccionado(); if (!actual) return;
    const checkboxesMarcados = actual.items.filter((i: any) => i.checked).length;
    actual.calcCompletados = checkboxesMarcados;
    actual.calcProgreso = Math.round((checkboxesMarcados / actual.items.length) * 100) || 0;
    if (checkboxesMarcados === 0) { actual.status = 'pendiente'; }
    else if (checkboxesMarcados === actual.items.length) { actual.status = 'completo'; }
    else { actual.status = 'en-progreso'; }
    this.guardarEnLaNube(actual);
  }

  enviarChecklist() {
    const actual = this.checklistSeleccionado(); if (!actual) return;
    const fotosPendientes = actual.items.some((i: any) => i.photo === 'subiendo...' || i.photoAntes === 'subiendo...' || i.photoDespues === 'subiendo...');
    if (fotosPendientes) { alert(' ⚠️ Espera, una foto se está subiendo.'); return; }
    const tareas100Porciento = actual.items.filter((i: any) => this.esItemCompleto(i)).length;
    if (tareas100Porciento < actual.items.length) {
      const confirmar = confirm(' ⚠️ Faltan FOTOS obligatorias.\n¿Enviar así?');
      if (!confirmar) return;
    }
    actual.enviado = true;
    const ahora = new Date();
    actual.horaEnvio = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    this.guardarEnLaNube(actual);
    this.mostrarToast(' ✅ ¡Checklist enviado correctamente!');
    this.volverALista();
  }

  toggleEmpleado(nombre: string) {
    const index = this.formAssigned.indexOf(nombre);
    if (index > -1) { this.formAssigned.splice(index, 1); } else { this.formAssigned.push(nombre); }
  }

  abrirModal() {
    this.isEditandoTarea = false;
    this.formName = ''; this.formAssigned = [];
    this.formStore = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    this.formItems = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 30, date: '', time: '' }];
    this.fasesTemporales = []; // 🔥 LIMPIAMOS LAS FASES AL ABRIR UN NUEVO CHECKLIST
    this.isModalOpen = true;
  }
  abrirModalEquipo() {
    this.isModalEquipoOpen = true;
    // Aquí inicializaremos los datos de la tarea en equipo
  }

  cerrarModalEquipo() {
    this.isModalEquipoOpen = false;
  }

  cerrarModal() { this.isModalOpen = false; }
  agregarItem() { this.formItems.push({ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 30, date: '', time: '' }); }
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
    this.fasesTemporales = actual.subtareas ? JSON.parse(JSON.stringify(actual.subtareas)) : []; // 🔥 CARGAMOS FASES DE LA BD
    this.isModalOpen = true;
  }

  async enviarAvisoPorCorreo(empleadoNombre: string, nombreTarea: string) {
    const empleado = this.empleados().find(emp => emp.nombre === empleadoNombre);
    const correoDestino = empleado?.correo || empleado?.email;
    if (!correoDestino) {
      this.mostrarToast(` ⚠️ No se pudo enviar correo a ${empleadoNombre} (Sin correo registrado).`);
      return;
    }
    const nombreAsignador = this.currentUser?.nombre || 'Administración';
    const asunto = `NUEVA TAREA de ${nombreAsignador}: ${nombreTarea} - Mega Dulces Task`;
    const cuerpo = `Hola ${empleadoNombre},\n\n¡${nombreAsignador} te ha asignado una nueva tarea en tu panel de Mega Dulces Task!\n\n 📌 Operación: ${nombreTarea}\n\nPor favor, ingresa a la plataforma (https://md-chlist.vercel.app/) para revisar las instrucciones y subir tus evidencias a tiempo.\n\nSaludos,\n${nombreAsignador}.`;
    const googleScriptUrl = 'https://script.google.com/macros/s/AKfycbw3rrfQizd-jHzz0gBEF3Gj8fOEYOnJ-w4X1rY1GoKAzn7636mnEyDrd7gvSqvyLNH9sg/exec';
    const miCorreo = this.currentUser?.correo || 'gerencia@megadulces.com';
    try {
      await fetch(googleScriptUrl, {
        method: 'POST', mode: 'no-cors',
        body: JSON.stringify({ to: correoDestino, subject: asunto, body: cuerpo, replyTo: miCorreo })
      });
    } catch (error) { console.error(' ❌ Error enviando correo:', error); }
  }

  guardarChecklistUnico() {
    if (!this.formName || this.formAssigned.length === 0) { alert('Faltan datos.'); return; }
    const tareasValidas = this.formItems.filter(item => item.text.trim() !== '').map((item, i) => ({
      id: Date.now() + i, text: item.text, requiresPhoto: item.requiresPhoto, requiresAntesDespues: item.requiresAntesDespues,
      requiresVariasFotos: item.requiresVariasFotos || false, permiteGaleria: item.permiteGaleria || false,
      permiteDocumentos: item.permiteDocumentos || false, tiempoEstimado: item.requiresAntesDespues ? (item.tiempoEstimado || 30) : null,
      archivoInstruccion: item.archivoInstruccion || null, nombreArchivo: item.nombreArchivo || null, date: item.date, time: item.time,
      checked: false, photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null, tipo: 'tarea'
    }));
    if (tareasValidas.length === 0) { alert('Agrega tareas.'); return; }

    const urlsWhatsApp: string[] = [];
    this.formAssigned.forEach((empleadoNombre, index) => {
      const uniqueId = Date.now() + index;
      const offset = new Date().getTimezoneOffset() * 60000;
      const hoy = new Date(Date.now() - offset).toISOString().split('T')[0];
      const checklistTareas = {
        id: uniqueId, timestampCreacion: Date.now(), name: this.formName, assigned: empleadoNombre, store: this.formStore,
        date: tareasValidas[0].date || hoy, time: tareasValidas[0].time || '23:59', status: 'pendiente', enviado: false,
        createdBy: this.currentUser?.nombre || 'Desconocido', notaEmpleado: '', 
        items: JSON.parse(JSON.stringify(tareasValidas)),
        subtareas: JSON.parse(JSON.stringify(this.fasesTemporales)) // 🔥 GUARDAMOS LAS FASES EN FIREBASE
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
          let mensaje = `*Mega Dulces Task* 🍭\n\n¡Hola *${this.limpiarEmojis(empleadoNombre)}*!\nSe te ha asignado un nuevo checklist: *${this.limpiarEmojis(this.formName)}*\n\n 📅 Fecha: ${checklistTareas.date}\n ⏰ Hora Límite: ${this.formatearHora(checklistTareas.time)}\n\n 🔗 Entra aquí: ${urlApp}\n\nFavor de ingresar a la plataforma para completar tus evidencias.`;
          const url = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
          urlsWhatsApp.push(url);
        }
      }
      if (this.notificarPorCorreo) { this.enviarAvisoPorCorreo(empleadoNombre, this.formName); }
    });

    urlsWhatsApp.forEach((url, i) => { setTimeout(() => { window.open(url, '_blank'); }, i * 800); });
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
          nombreArchivo: item.nombreArchivo || itemOriginal.nombreArchivo || null
        };
      }
      return {
        id: Date.now() + i, text: item.text, requiresPhoto: item.requiresPhoto, requiresVariasFotos: (item as any).requiresVariasFotos || false,
        permiteGaleria: (item as any).permiteGaleria || false, permiteDocumentos: (item as any).permiteDocumentos || false,
        tiempoEstimado: item.requiresAntesDespues ? (item.tiempoEstimado || 30) : null, archivoInstruccion: (item as any).archivoInstruccion || null,
        nombreArchivo: (item as any).nombreArchivo || null, date: actual.date, time: actual.time || '23:59', checked: false,
        photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null, tipo: 'tarea'
      };
    });
    if (tareasValidas.length === 0) { alert('Agrega tareas.'); return; }

    try {
      await setDoc(doc(this.firestore, 'checklists', actual.id.toString()), {
        name: this.formName, assigned: this.formAssigned[0], store: this.formStore, 
        items: tareasValidas,
        subtareas: this.fasesTemporales // 🔥 ACTUALIZAMOS LAS FASES EN FIREBASE
      }, { merge: true });

      this.mostrarToast(' ✏️ ¡Tarea actualizada con éxito!');
      actual.name = this.formName; actual.assigned = this.formAssigned[0]; actual.store = this.formStore; 
      actual.items = tareasValidas;
      actual.subtareas = this.fasesTemporales; // 🔥 ACTUALIZAMOS LA PANTALLA EN TIEMPO REAL
      this.cerrarModal();
    } catch (error) { alert('Error al actualizar la tarea.'); }
  }

  toggleEmpleadoRutina(nombre: string) {
    const index = this.formAssignedRutina.indexOf(nombre);
    if (index > -1) { this.formAssignedRutina.splice(index, 1); } else { this.formAssignedRutina.push(nombre); }
  }

  asignarATodoMiPersonal() {
    const todosMisEmpleados = this.empleados().map(emp => emp.nombre);
    this.formAssigned = [...todosMisEmpleados];
    this.mostrarToast(` 🚀 ¡Fuego! Asignado a todo el personal de tus sucursales.`);
  }

  abrirModalRutinas() {
    this.isEditMode = false;
    this.formNameRutina = ''; this.formAssignedRutina = [];
    this.formStoreRutina = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    this.formRutinas = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 30, frecuencia: 'Diaria', fechaFin: null, horaLimite: '', diaSemana: 'Lunes', diaMes: 1 }];
    this.isModalRutinasOpen = true;
  }
  cerrarModalRutinas() { this.isModalRutinasOpen = false; }
  agregarRutina() { this.formRutinas.push({ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 30, frecuencia: 'Diaria', fechaFin: null, horaLimite: '', diaSemana: 'Lunes', diaMes: 1 }); }
  eliminarRutina(index: number) { this.formRutinas.splice(index, 1); }

  async guardarBloqueRutinas() {
    if (!this.formNameRutina || this.formAssignedRutina.length === 0) { alert('Faltan datos.'); return; }
    const rutinasValidas = this.formRutinas.filter(rutina => rutina.text.trim() !== '').map((rutina, i) => ({
      id: Date.now() + 1000 + i, text: rutina.text, requiresPhoto: rutina.requiresPhoto, requiresAntesDespues: rutina.requiresAntesDespues || false,
      requiresVariasFotos: rutina.requiresVariasFotos || false, permiteGaleria: rutina.permiteGaleria || false, permiteDocumentos: rutina.permiteDocumentos || false,
      tiempoEstimado: rutina.requiresAntesDespues ? (rutina.tiempoEstimado || 30) : null, archivoInstruccion: rutina.archivoInstruccion || null,
      nombreArchivo: rutina.nombreArchivo || null, checked: false, photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null,
      tipo: 'rutina', frecuencia: rutina.frecuencia, fechaFin: rutina.fechaFin, horaLimite: rutina.horaLimite, diaSemana: rutina.diaSemana || 'Lunes', diaMes: rutina.diaMes || 1
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
        if (frecuenciaReal === 'Semanal' || frecuenciaReal === 'Catorcenal') { diaSemanaReal = partesGrupo.length > 1 ? partesGrupo[1] : 'Lunes'; }
        else if (frecuenciaReal === 'Mensual' || frecuenciaReal === 'Trimestral') { diaMesReal = partesGrupo.length > 1 ? parseInt(partesGrupo[1], 10) : 1; }
        const nombreMoldeLimpio = this.formNameRutina.replace(/\s+/g, '_').toLowerCase();
        const empleadoLimpio = empleadoNombre.replace(/\s+/g, '_').toLowerCase();
        const moldeId = `molde_${nombreMoldeLimpio}_${empleadoLimpio}_${llaveGrupo}`;
        const nuevoMolde = {
          id: moldeId, name: this.formNameRutina, assigned: empleadoNombre, store: this.formStoreRutina,
          frecuencia: frecuenciaReal, diaSemana: diaSemanaReal, diaMes: diaMesReal, timestampCreacion: Date.now(),
          createdBy: this.currentUser?.nombre || 'Desconocido', items: JSON.parse(JSON.stringify(rutinasPorFrecuencia[llaveGrupo]))
        };
        setDoc(doc(this.firestore, 'moldes_checklists', moldeId), nuevoMolde);
      });
    });
    this.mostrarToast(this.isEditMode ? ' 🔄 ¡Bloque actualizado con éxito!' : ' 🔄 ¡Bloque guardado en la Bóveda!');
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
    return texto.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '').trim();
  }

  esImagen(url: string): boolean {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    if (urlLower.includes('/raw/upload/') || urlLower.match(/ \. (pdf|xls|xlsx|doc|docx|csv|txt|zip|rar)$/)) { return false; }
    return true;
  }

  // 🔥 FUNCIONES EXCLUSIVAS PARA FASES 🔥
  agregarFase() {
    if (!this.nuevaFaseTexto.trim()) return;
    this.fasesTemporales.push({ texto: this.nuevaFaseTexto, completada: false });
    this.nuevaFaseTexto = ''; 
  }

  eliminarFase(index: number) {
    this.fasesTemporales.splice(index, 1);
  }

  toggleFase(index: number) {
    this.fasesTemporales[index].completada = !this.fasesTemporales[index].completada;
  }

  toggleFaseEnPantallaDetalle(index: number, checklist: any) {
    if (!checklist.subtareas) return;
    checklist.subtareas[index].completada = !checklist.subtareas[index].completada;
    this.guardarEnLaNube(checklist);
  }
 agregarIntegranteEquipo() {
    if (!this.empleadoSeleccionadoEquipo) return;
    
    // Evitar duplicados
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
    
    // 🔥 ESTAS DOS LÍNEAS HACEN LA MAGIA DE LIMPIAR EL BUSCADOR 🔥
    this.empleadoSeleccionadoEquipo = ''; // Limpia el valor interno
    this.busquedaEmpleadoEquipo = ''; // Limpia el texto que ves en la pantalla
  }

  eliminarIntegranteEquipo(index: number) {
    this.integrantesEquipo.splice(index, 1);
  }

  abrirFasesIntegrante(index: number) {
    // Por ahora usamos un prompt rápido para no empalmar ventanas
    const nuevaFase = prompt(`Añadir una fase/subtarea para ${this.integrantesEquipo[index].nombre}:`);
    if (nuevaFase && nuevaFase.trim()) {
      if (!this.integrantesEquipo[index].fases) this.integrantesEquipo[index].fases = [];
      this.integrantesEquipo[index].fases.push({ texto: nuevaFase, completada: false });
      this.mostrarToast('✅ Fase agregada a ' + this.integrantesEquipo[index].nombre);
    }
  }
  get empleadosEquipoFiltrados() {
    if (!this.busquedaEmpleadoEquipo) return this.empleados();
const termino = this.busquedaEmpleadoEquipo.toLowerCase();
return this.empleados().filter((emp: any) => emp.nombre.toLowerCase().includes(termino));
  }

  seleccionarEmpleadoEquipo(emp: any) {
    this.empleadoSeleccionadoEquipo = emp.nombre;
    this.busquedaEmpleadoEquipo = emp.nombre; // Lo mostramos en el input
    this.mostrarDropdownEquipo = false;
  }

  ocultarDropdownEquipo() {
    // Un pequeño retraso para que alcance a registrar el click antes de cerrarse
    setTimeout(() => { this.mostrarDropdownEquipo = false; }, 200);
  }
  abrirActividadIntegrante(index: number) {
    this.integranteActualIndex = index;
    const integrante = this.integrantesEquipo[index];
    
    // Si el integrante ya tiene actividades, las cargamos. Si no, empezamos con una limpia.
    if (integrante.fases && integrante.fases.length > 0) {
      this.formItemsActividad = JSON.parse(JSON.stringify(integrante.fases));
    } else {
      this.formItemsActividad = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, fechaInicio: '', horaInicio: '', fechaLimite: '', horaLimite: '' }];
    }
    
    this.isModalActividadIntegranteOpen = true;
  }

  // 👉 Función para guardar esas actividades y volver al modal de equipo
  guardarActividadesIntegrante() {
    if (this.integranteActualIndex > -1) {
      // Guardamos los cambios en el integrante correspondiente
      this.integrantesEquipo[this.integranteActualIndex].fases = [...this.formItemsActividad];
      this.mostrarToast('✅ Actividades asignadas a ' + this.integrantesEquipo[this.integranteActualIndex].nombre);
      this.cerrarModalActividadIntegrante();
    }
  }

  cerrarModalActividadIntegrante() {
    this.isModalActividadIntegranteOpen = false;
    this.integranteActualIndex = -1;
  }

  // Funciones auxiliares para el sub-modal
  agregarActividadIntegrante() {
    this.formItemsActividad.push({ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, fechaInicio: '', horaInicio: '', fechaLimite: '', horaLimite: '' });
  }

  eliminarActividadIntegrante(index: number) {
    this.formItemsActividad.splice(index, 1);
  }
}