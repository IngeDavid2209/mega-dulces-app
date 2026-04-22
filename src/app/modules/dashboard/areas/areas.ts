import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, onSnapshot, doc, setDoc, deleteDoc } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-areas',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './areas.html',
  styleUrls: ['./areas.css']
})
export class AreasComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  currentUser: any = null;
  areas = signal<any[]>([]);
  usuarios = signal<any[]>([]);
  vistaActual = signal<'lista' | 'detalle'>('lista');
  areaDetalle = signal<any>(null);
  terminoBusqueda = '';
  isModalOpen = false;
  formNombreArea = '';
  formDescripcionArea = '';

  // 🔥 NUEVOS CAMPOS DE FECHA Y HORA 🔥
  formFechaArea = ''; 
  formHoraArea = '';  
  
  formAssignedUsers: any[] = [];
  terminoBusquedaCreacion = '';
  isModalAsignacionOpen = false;
  areaSeleccionada: any = null;
  empleadosFiltradosAsignacion = signal<any[]>([]);
  terminoBusquedaAsignacion = '';

  //   🔥   VARIABLES PARA TAREAS Y RUTINAS DIRECTAS CON CRONÓMETRO   🔥
  isModalTareaOpen = false;
  isModalRutinaOpen = false;
  formName = '';
  formAssigned: string[] = [];
  formStore = '';
  //   🔥   AQUÍ ESTÁ EL TIEMPO ESTIMADO   🔥
  formItems = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, tiempoEstimado: 30, date: '', time: '' }];
  formNameRutina = '';
  formAssignedRutina: string[] = [];
  formStoreRutina = '';
  //   🔥   AQUÍ ESTÁ EL TIEMPO ESTIMADO   🔥
  formRutinas: any[] = [];
  frecuencias = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral'];
  diasDelMes = Array.from({length: 31}, (_, i) => i + 1);
  sucursalesDisponibles = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
  ];
  private firestore = inject(Firestore);
  private router = inject(Router);
  private destructoresRadares: (() => void)[] = [];

  // 🔥 NUEVO GETTER DE SEGURIDAD EN VIVO 🔥
  get liveUser() {
    if (!this.currentUser) return null;
    const fresh = this.usuarios().find(u => u.usuario === this.currentUser.usuario);
    return fresh || this.currentUser;
  }

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarAreas) { // 🔥 CAMBIO DE SEGURIDAD
      this.router.navigate(['/home']);
      return;
    }
    this.conectarConLaNube();
  }
  ngOnDestroy() { this.destructoresRadares.forEach(apagarRadar => apagarRadar()); }
  
  conectarConLaNube() {
    const areasRef = collection(this.firestore, 'areas_operativas');
    const radarAreas = onSnapshot(areasRef, (snapshot) => {
      const areasNube: any[] = [];
      snapshot.forEach((doc) => areasNube.push({ ...doc.data(), id: doc.id }));
      this.areas.set(areasNube.sort((a, b) => a.nombre.localeCompare(b.nombre)));
    });
    this.destructoresRadares.push(radarAreas);
    const usuariosRef = collection(this.firestore, 'usuarios');
    const radarUsuarios = onSnapshot(usuariosRef, (snapshot) => {
      const usuariosNube: any[] = [];
      snapshot.forEach((doc) => usuariosNube.push({ ...doc.data(), idFirestore: doc.id }));
      this.usuarios.set(usuariosNube);
    });
    this.destructoresRadares.push(radarUsuarios);
  }
  
  verDetalleArea(area: any) {
    this.areaDetalle.set(area);
    this.vistaActual.set('detalle');
  }
  volverALista() {
    this.areaDetalle.set(null);
    this.vistaActual.set('lista');
  }
  getEmpleadosDelArea() {
    const area = this.areaDetalle();
    if (!area) return [];
    return this.usuarios().filter(u => u.rol === 'trabajador' && u.areas && u.areas.includes(area.nombre));
  }

  // 🔥 FILTRO BLINDADO PARA JEFES 🔥
  getAreasFiltradas() {
    const yo = this.liveUser;
    let lista = this.areas();

    if (yo?.rol !== 'admin') {
      const misAreasPermitidas = yo?.areas || [];
      lista = lista.filter(a => misAreasPermitidas.includes(a.nombre));
    }

    const term = this.terminoBusqueda.toLowerCase();
    if (term) {
      lista = lista.filter(a => a.nombre.toLowerCase().includes(term));
    }
    return lista;
  }

  contarEmpleadosEnArea(nombreArea: string): number {
    return this.usuarios().filter(u => u.areas && u.areas.includes(nombreArea)).length;
  }
  
  abrirModalNuevaArea() {
    this.formNombreArea = ''; this.formDescripcionArea = ''; this.formAssignedUsers = [];
    this.formFechaArea = ''; this.formHoraArea = ''; // 🔥 LIMPIAR CAMPOS
    this.terminoBusquedaCreacion = ''; this.isModalOpen = true;
  }
  cerrarModal() { this.isModalOpen = false; }
  
  get empleadosParaCreacion() {
    let filtrados = this.usuarios().filter(u => u.rol === 'trabajador');
    if (this.terminoBusquedaCreacion) {
      const t = this.terminoBusquedaCreacion.toLowerCase();
      filtrados = filtrados.filter(u => u.nombre.toLowerCase().includes(t));
    }
    return filtrados;
  }
  toggleUsuarioParaCreacion(usuario: any) {
    const index = this.formAssignedUsers.findIndex(u => u.idFirestore === usuario.idFirestore);
    if (index > -1) { this.formAssignedUsers.splice(index, 1); } else { this.formAssignedUsers.push(usuario); }
  }
  estaSeleccionadoParaCreacion(usuario: any): boolean {
    return this.formAssignedUsers.some(u => u.idFirestore === usuario.idFirestore);
  }
  
  async guardarArea() {
    if (!this.formNombreArea.trim()) { Swal.fire('Falta el nombre', 'Debes asignarle un nombre al área.', 'warning'); return; }
    const nombreFormateado = this.formNombreArea.trim();
    const existe = this.areas().some(a => a.nombre.toLowerCase() === nombreFormateado.toLowerCase());
    if (existe) { Swal.fire('Área Duplicada', 'Ya existe un área con ese nombre.', 'error'); return; }
    const areaId = 'area_' + Date.now();
    try {
      // 🔥 GUARDADO CON FECHA Y HORA PROGRAMADA 🔥
      await setDoc(doc(this.firestore, 'areas_operativas', areaId), {
        nombre: nombreFormateado, 
        descripcion: this.formDescripcionArea.trim(), 
        fechaAsignada: this.formFechaArea,
        horaAsignada: this.formHoraArea,
        fechaCreacion: new Date().toISOString()
      });
      for (const u of this.formAssignedUsers) {
        let nuevasAreas = u.areas ? [...u.areas] : [];
        if (!nuevasAreas.includes(nombreFormateado)) {
          nuevasAreas.push(nombreFormateado);
          await setDoc(doc(this.firestore, 'usuarios', u.idFirestore), { areas: nuevasAreas }, { merge: true });
        }
      }
      this.cerrarModal();
      Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, icon: 'success', title: 'Área creada y personal asignado' });
    } catch (error) { Swal.fire('Error', 'Hubo un problema al crear el área.', 'error'); }
  }
  
  async eliminarArea(area: any, event: Event) {
    event.stopPropagation();
    if (this.contarEmpleadosEnArea(area.nombre) > 0) {
      Swal.fire('Atención', 'Hay personal en esta área. Quítalos primero.', 'warning'); return;
    }
    const res = await Swal.fire({ title: '¿Borrar?', text: area.nombre, icon: 'warning', showCancelButton: true });
    if (res.isConfirmed) await deleteDoc(doc(this.firestore, 'areas_operativas', area.id));
  }
  abrirAsignacion(area: any, event: Event) {
    event.stopPropagation();
    this.areaSeleccionada = area;
    this.actualizarListaAsignacion();
    this.isModalAsignacionOpen = true;
  }
  cerrarAsignacion() { this.isModalAsignacionOpen = false; this.areaSeleccionada = null; }
  actualizarListaAsignacion() {
    let filtrados = this.usuarios().filter(u => u.rol === 'trabajador');
    if (this.terminoBusquedaAsignacion) {
      const t = this.terminoBusquedaAsignacion.toLowerCase();
      filtrados = filtrados.filter(u => u.nombre.toLowerCase().includes(t));
    }
    this.empleadosFiltradosAsignacion.set(filtrados);
  }
  tieneElArea(u: any) { return u.areas && u.areas.includes(this.areaSeleccionada.nombre); }
  async toggleAreaUsuario(u: any) {
    let nuevasAreas = u.areas ? [...u.areas] : [];
    if (this.tieneElArea(u)) nuevasAreas = nuevasAreas.filter(a => a !== this.areaSeleccionada.nombre);
    else nuevasAreas.push(this.areaSeleccionada.nombre);
    await setDoc(doc(this.firestore, 'usuarios', u.idFirestore), { areas: nuevasAreas }, { merge: true });
  }

  // =========================================================
  //  🔥  LÓGICA PARA CREAR TAREAS Y RUTINAS DESDE ÁREAS  🔥
  // =========================================================
  trackByIndex(index: number, obj: any): any { return index; }
  mostrarToast(mensaje: string) { Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, icon: 'success', title: mensaje }); }

  abrirModalTareaParaArea() {
    const empleadosDelArea = this.getEmpleadosDelArea().map(emp => emp.nombre);
    if (empleadosDelArea.length === 0) {
      Swal.fire('Área Vacía', 'No hay personal asignado a esta área para recibir tareas.', 'warning');
      return;
    }
    this.formName = '';
    this.formAssigned = [...empleadosDelArea]; //  🔥  Selecciona a todos automáticamente
    this.formStore = this.sucursalesDisponibles.length > 0 ? this.sucursalesDisponibles[0] : '';
    this.formItems = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, tiempoEstimado: 30, date: '', time: '' }];
    this.isModalTareaOpen = true;
  }

  abrirModalRutinaParaArea() {
    const empleadosDelArea = this.getEmpleadosDelArea().map(emp => emp.nombre);
    if (empleadosDelArea.length === 0) {
      Swal.fire('Área Vacía', 'No hay personal asignado a esta área para recibir rutinas.', 'warning');
      return;
    }
    this.formNameRutina = '';
    this.formAssignedRutina = [...empleadosDelArea]; //  🔥  Selecciona a todos automáticamente
    this.formStoreRutina = this.sucursalesDisponibles.length > 0 ? this.sucursalesDisponibles[0] : '';
    this.formRutinas = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, tiempoEstimado: 30, frecuencia: 'Diaria', fechaFin: null, horaLimite: '', diaSemana: 'Lunes', diaMes: 1 }];
    this.isModalRutinaOpen = true;
  }

  // --- TAREAS ÚNICAS ---
  abrirModalTarea(empleadoNombre: string) {
    this.formName = '';
    this.formAssigned = [empleadoNombre];
    this.formStore = this.sucursalesDisponibles.length > 0 ? this.sucursalesDisponibles[0] : '';
    this.formItems = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, tiempoEstimado: 30, date: '', time: '' }];
    this.isModalTareaOpen = true;
  }

  cerrarModalTarea() { this.isModalTareaOpen = false; }
  agregarItem() { this.formItems.push({ text: '', requiresPhoto: false, requiresAntesDespues: false, tiempoEstimado: 30, date: '', time: '' }); }
  eliminarItem(index: number) { this.formItems.splice(index, 1); }
  toggleEmpleadoTarea(nombre: string) {
    const index = this.formAssigned.indexOf(nombre);
    if (index > -1) { this.formAssigned.splice(index, 1); } else { this.formAssigned.push(nombre); }
  }

  async guardarChecklistUnico() {
    if (!this.formName || this.formAssigned.length === 0) { Swal.fire('Faltan datos', 'Completa los campos.', 'warning'); return; }
    const tareasValidas = this.formItems.filter(item => item.text.trim() !== '').map((item, i) => ({
      id: Date.now() + i, text: item.text, requiresPhoto: item.requiresPhoto, requiresAntesDespues: item.requiresAntesDespues,
      tiempoEstimado: item.requiresAntesDespues ? (item.tiempoEstimado || 30) : null,
      date: item.date, time: item.time, checked: false,
      photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null,
      tipo: 'tarea'
    }));

    if (tareasValidas.length === 0) { Swal.fire('Error', 'Agrega al menos una actividad.', 'warning'); return; }

    for (const empleadoNombre of this.formAssigned) {
      const uniqueId = Date.now() + Math.floor(Math.random() * 1000);
      const offset = new Date().getTimezoneOffset() * 60000;
      const hoy = new Date(Date.now() - offset).toISOString().split('T')[0];
      const checklistTareas = {
        id: uniqueId, timestampCreacion: Date.now(), name: this.formName, assigned: empleadoNombre,
        store: this.formStore, date: tareasValidas[0].date || hoy, time: tareasValidas[0].time || '23:59',
        status: 'pendiente', enviado: false, createdBy: this.currentUser?.nombre || 'Desconocido', notaEmpleado: '',
        items: JSON.parse(JSON.stringify(tareasValidas))
      };
      await setDoc(doc(this.firestore, 'checklists', uniqueId.toString()), checklistTareas);
    }
    this.mostrarToast('  ✅   ¡ Tareas creadas con  é xito!');
    this.cerrarModalTarea();
  }

  // --- RUTINAS ---
  abrirModalRutina(empleadoNombre: string) {
    this.formNameRutina = '';
    this.formAssignedRutina = [empleadoNombre];
    this.formStoreRutina = this.sucursalesDisponibles.length > 0 ? this.sucursalesDisponibles[0] : '';
    this.formRutinas = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, tiempoEstimado: 30, frecuencia: 'Diaria', fechaFin: null, horaLimite: '', diaSemana: 'Lunes', diaMes: 1 }];
    this.isModalRutinaOpen = true;
  }

  cerrarModalRutina() { this.isModalRutinaOpen = false; }
  toggleEmpleadoRutina(nombre: string) {
    const index = this.formAssignedRutina.indexOf(nombre);
    if (index > -1) { this.formAssignedRutina.splice(index, 1); } else { this.formAssignedRutina.push(nombre); }
  }

  agregarRutina() { this.formRutinas.push({ text: '', requiresPhoto: false, requiresAntesDespues: false, tiempoEstimado: 30, frecuencia: 'Diaria', fechaFin: null, horaLimite: '', diaSemana: 'Lunes', diaMes: 1 }); }
  eliminarRutina(index: number) { this.formRutinas.splice(index, 1); }
  alCambiarFrecuencia(rutina: any) { rutina.fechaFin = null; }

  getTextoPeriodo(rutina: any): string {
    if (rutina.frecuencia === 'Diaria') return 'Activa siempre';
    if (rutina.frecuencia === 'Semanal') return `Todos los ${rutina.diaSemana || 'Lunes'}`;
    if (rutina.frecuencia === 'Catorcenal') return `Cada 2 weeks, los ${rutina.diaSemana || 'Lunes'}`;
    if (rutina.frecuencia === 'Mensual') return `Los días ${rutina.diaMes || 1} del mes`;
    if (rutina.frecuencia === 'Trimestral') return `El día ${rutina.diaMes || 1} cada 3 meses`;
    return '';
  }

  esSucursalAdministrativa(sucursal: string): boolean {
    const admins = ['OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'];
    return admins.includes(sucursal);
  }

  async guardarBloqueRutinas() {
    if (!this.formNameRutina || this.formAssignedRutina.length === 0) { Swal.fire('Faltan datos', 'Completa los campos.', 'warning'); return; }

    const rutinasValidas = this.formRutinas.filter(rutina => rutina.text.trim() !== '').map((rutina, i) => ({
      id: Date.now() + 1000 + i, text: rutina.text, requiresPhoto: rutina.requiresPhoto,
      requiresAntesDespues: rutina.requiresAntesDespues || false,
      tiempoEstimado: rutina.requiresAntesDespues ? (rutina.tiempoEstimado || 30) : null,
      checked: false, photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null,
      tipo: 'rutina', frecuencia: rutina.frecuencia, fechaFin: rutina.fechaFin, horaLimite: rutina.horaLimite, diaSemana: rutina.diaSemana || 'Lunes', diaMes: rutina.diaMes || 1
    }));

    if (rutinasValidas.length === 0) { Swal.fire('Error', 'Agrega rutinas.', 'warning'); return; }

    for (const empleadoNombre of this.formAssignedRutina) {
      const rutinasPorFrecuencia: { [key: string]: any[] } = {};
      rutinasValidas.forEach(r => {
        const llaveGrupo = r.frecuencia === 'Diaria' ? 'Diaria' : (r.frecuencia === 'Semanal' || r.frecuencia === 'Catorcenal') ? `${r.frecuencia}_${r.diaSemana}` : `${r.frecuencia}_${r.diaMes}`;
        if (!rutinasPorFrecuencia[llaveGrupo]) rutinasPorFrecuencia[llaveGrupo] = [];
        rutinasPorFrecuencia[llaveGrupo].push(r);
      });

      for (const llaveGrupo of Object.keys(rutinasPorFrecuencia)) {
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
        await setDoc(doc(this.firestore, 'moldes_checklists', moldeId), nuevoMolde);
      }
    }
    this.mostrarToast('  🔄  ¡Bloque guardado en la Bóveda!');
    this.cerrarModalRutina();
  }
}