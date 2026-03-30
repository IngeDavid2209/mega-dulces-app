import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Firestore, collection, doc, setDoc, getDoc, deleteDoc, onSnapshot, getDocs } from '@angular/fire/firestore';

@Component({
  selector: 'app-checklist',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './checklist.html',
  styleUrls: ['./checklist.css']
})
export class ChecklistComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { 
    this.isMenuOpen = !this.isMenuOpen; 
  }

  currentUser: any = null; 
  vistaActual = signal<'lista' | 'detalle'>('lista');
  checklistSeleccionado = signal<any>(null);
  
  isModalOpen = false;
  formName = '';
  formAssigned: string[] = []; 
  formStore = '';
  formItems = [{ text: '', requiresPhoto: false, date: '', time: '' }]; 
  
  isModalRutinasOpen = false;
  formNameRutina = '';
  formAssignedRutina: string[] = []; 
  formStoreRutina = '';
  formRutinas: any[] = []; 
  frecuencias = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral'];
  
  diasDelMes = Array.from({length: 31}, (_, i) => i + 1);

  isPasswordModalOpen = false;
  passwordInput = '';
  checklistToDelete: any = null;

  checklists = signal<any[]>([]); 
  empleados = signal<any[]>([]);  
  sucursalesDisponibles = signal<string[]>([]);

  private firestore = inject(Firestore);
  private destructoresRadares: (() => void)[] = [];

  get empleadosFiltrados() {
    if (!this.formStore) return this.empleados();
    return this.empleados().filter(emp => {
      if (emp.sucursales && emp.sucursales.includes('General (Acceso Total)')) return true;
      const susSucursales = emp.sucursales || [emp.sucursal || ''];
      return susSucursales.includes(this.formStore);
    });
  }

  get empleadosFiltradosRutina() {
    if (!this.formStoreRutina) return this.empleados();
    return this.empleados().filter(emp => {
      if (emp.sucursales && emp.sucursales.includes('General (Acceso Total)')) return true;
      const susSucursales = emp.sucursales || [emp.sucursal || ''];
      return susSucursales.includes(this.formStoreRutina);
    });
  }

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
    }
    this.conectarRadarNube();
  }

  ngOnDestroy() {
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
  }

  conectarRadarNube() {
    const usuariosRef = collection(this.firestore, 'usuarios');
    const radarUsuarios = onSnapshot(usuariosRef, (snapshot) => {
      const todosLosUsuarios: any[] = [];
      snapshot.forEach(docSnap => todosLosUsuarios.push(docSnap.data()));

      const todasLasSucursales = [
        'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo', 
        'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
        'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 
        'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
      ];

      if (this.currentUser?.rol === 'admin') {
        this.sucursalesDisponibles.set(todasLasSucursales);
      } else if (this.currentUser?.puedeCrearChecklists) {
        const misSucursales = this.currentUser.sucursales || [this.currentUser.sucursal || ''];
        this.sucursalesDisponibles.set(misSucursales);
      }

      const trabajadores = todosLosUsuarios.filter((u: any) => u.rol === 'trabajador');
      if (this.currentUser?.rol === 'admin') {
        this.empleados.set(trabajadores);
      } else if (this.currentUser?.puedeCrearChecklists) {
        const misSucursales = this.currentUser.sucursales || [this.currentUser.sucursal || ''];
        const empleadosFiltrados = trabajadores.filter((t: any) => {
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
        
        if (c.eliminado === true) return;
        if (c.enviado === true) return;

        if (c.date === fechaHoyLocal) {
          const tareasMarcadas = c.items.filter((i:any) => i.checked).length;
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
          if (c.calcProgreso > existente.calcProgreso) {
            listasSinClones.set(firma, c);
          }
        }
      });

      const listasFinales = Array.from(listasSinClones.values());
      listasFinales.sort((a, b) => b.timestampCreacion - a.timestampCreacion);

      if (this.currentUser?.rol === 'admin') {
        this.checklists.set(listasFinales);
      } else {
        const misListas = listasFinales.filter((c: any) => c.assigned === this.currentUser.nombre);
        this.checklists.set(misListas);
      }
    });
    this.destructoresRadares.push(radarChecklists);
  }

  getPrimerasTareas(checklist: any): any[] {
    if (!checklist || !checklist.items) return [];
    return checklist.items.slice(0, 4);
  }

  isTareaVencida(item: any, checklistDate: string): boolean {
    if (!checklistDate) return false; 

    let hora = '23';
    let minuto = '59';

    if (item.tipo === 'rutina' && item.horaLimite) {
      const partes = item.horaLimite.split(':');
      if (partes.length === 2) { 
        hora = partes[0]; 
        minuto = partes[1]; 
      }
    } else if (item.tipo === 'tarea' && item.time) {
      const partes = item.time.split(':');
      if (partes.length === 2) { 
        hora = partes[0]; 
        minuto = partes[1]; 
      }
    }

    const [year, month, day] = checklistDate.split('-');
    const deadline = new Date(Number(year), Number(month) - 1, Number(day), Number(hora), Number(minuto), 59);
    const ahora = new Date();

    return ahora > deadline;
  }

  esDiaCerrado(sucursal: string, fecha: Date = new Date()): boolean {
    const dia = fecha.getDate();
    const mes = fecha.getMonth() + 1;
    const anio = fecha.getFullYear();

    if (sucursal === 'Padre Hidalgo' || sucursal === '8 Esquinas') {
      const viernesSanto = this.calcularViernesSanto(anio);
      if (dia === viernesSanto.getDate() && mes === (viernesSanto.getMonth() + 1)) {
        return true; 
      }
      return false; 
    } else {
      if ((dia === 25 && mes === 12) || (dia === 1 && mes === 1)) {
        return true; 
      }
      return false; 
    }
  }

  calcularViernesSanto(anio: number): Date {
    const a = anio % 19; const b = Math.floor(anio / 100); const c = anio % 100;
    const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mesResurreccion = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const diaResurreccion = ((h + l - 7 * m + 114) % 31) + 1;
    
    const domingoResurreccion = new Date(anio, mesResurreccion, diaResurreccion);
    const viernesSanto = new Date(domingoResurreccion);
    viernesSanto.setDate(domingoResurreccion.getDate() - 2);
    return viernesSanto;
  }

  calcularFechaFinDefault(frecuencia: string): string | null {
    return null; 
  }

  alCambiarFrecuencia(rutina: any) {
    rutina.fechaFin = this.calcularFechaFinDefault(rutina.frecuencia);
  }

  getTextoPeriodo(rutina: any): string {
    if (rutina.frecuencia === 'Diaria') return 'Activa siempre';
    if (rutina.frecuencia === 'Semanal') return `Todos los ${rutina.diaSemana || 'Lunes'}`;
    if (rutina.frecuencia === 'Catorcenal') return `Cada 2 weeks, los ${rutina.diaSemana || 'Lunes'}`;
    if (rutina.frecuencia === 'Mensual') return `Los días ${rutina.diaMes || 1} del mes`;
    if (rutina.frecuencia === 'Trimestral') return `El día ${rutina.diaMes || 1} cada 3 meses`;
    return '';
  }

  getNombreDiaCorto(numeroDia: string): string {
    const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return dias[parseInt(numeroDia)] || '';
  }

  getWeekNumber(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay()||7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
    return Math.ceil(( ( (date.getTime() - yearStart.getTime()) / 86400000) + 1)/7);
  }

  obtenerLlavePeriodo(frecuencia: string, fecha: Date): string {
    const y = fecha.getFullYear();
    const m = fecha.getMonth() + 1;
    const d = fecha.getDate();

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

    for (const molde of moldes) {
      if (this.esDiaCerrado(molde.store, fechaActual)) { continue; }

      if (molde.frecuencia === 'Semanal' || molde.frecuencia === 'Catorcenal') {
        if (molde.diaSemana && molde.diaSemana !== diaHoyTexto) {
          continue; 
        }
        
        if (molde.frecuencia === 'Catorcenal' && molde.timestampCreacion) {
           const semanaActual = this.getWeekNumber(fechaLocal);
           const semanaCreacion = this.getWeekNumber(new Date(molde.timestampCreacion));
           if (Math.abs(semanaActual - semanaCreacion) % 2 !== 0) {
             continue; 
           }
        }
      }

      if (molde.frecuencia === 'Mensual' || molde.frecuencia === 'Trimestral') {
        const diaObjetivo = parseInt(molde.diaMes || '1', 10);
        
        const ultimoDiaDelMesActual = new Date(fechaLocal.getFullYear(), fechaLocal.getMonth() + 1, 0).getDate();
        const diaRealAProcesar = diaObjetivo > ultimoDiaDelMesActual ? ultimoDiaDelMesActual : diaObjetivo;

        if (diaMesActual !== diaRealAProcesar) {
          continue; 
        }

        if (molde.frecuencia === 'Trimestral' && molde.timestampCreacion) {
           const mesActual = fechaLocal.getMonth();
           const mesCreacion = new Date(molde.timestampCreacion).getMonth();
           if (Math.abs(mesActual - mesCreacion) % 3 !== 0) {
             continue; 
           }
        }
      }

      const itemsVigentes = molde.items.filter((item: any) => {
        return !item.fechaFin || fechaString <= item.fechaFin;
      });

      if (itemsVigentes.length === 0) continue;

      const llavePeriodo = this.obtenerLlavePeriodo(molde.frecuencia, fechaActual);
      const checklistId = `${molde.id}_${llavePeriodo}`; 
      
      const docRef = doc(this.firestore, 'checklists', checklistId);
      const docSnap = await getDoc(docRef); 
      
      if (!docSnap.exists()) {
        const nuevoChecklist = {
           id: checklistId,
           timestampCreacion: Date.now(),
           name: `${molde.name} (${molde.frecuencia})`,
           assigned: molde.assigned,
           store: molde.store,
           date: fechaString,
           time: '23:59',
           status: 'pendiente',
           enviado: false,
           createdBy: 'Robot de Rutinas',
           items: itemsVigentes.map((i:any) => ({...i, checked: false, photo: null}))
        };
        await setDoc(docRef, nuevoChecklist);
      }
    }
  }

  async guardarEnLaNube(checklist: any) {
    try {
      const docId = checklist.id.toString();
      await setDoc(doc(this.firestore, 'checklists', docId), checklist, { merge: true });
    } catch (error) { 
      console.error("Error: ", error); 
    }
  }

  eliminarChecklist(checklist: any, event: Event) {
    event.stopPropagation(); 
    this.checklistToDelete = checklist;
    this.passwordInput = '';
    this.isPasswordModalOpen = true; 
  }

  cerrarPasswordModal() {
    this.isPasswordModalOpen = false;
    this.checklistToDelete = null;
    this.passwordInput = '';
  }

  async confirmarEliminacion() {
    if (this.passwordInput !== 'Mega2323') {
      alert('❌ Contraseña maestra incorrecta. Inténtalo de nuevo.');
      return;
    }

    const confirmar = confirm(`⚠️ ¿Estás completamente seguro de borrar "${this.checklistToDelete.name}"?\n\nSi es una rutina recurrente, se borrarán todos los duplicados y se cancelará para los próximos días.`);
    
    if (confirmar) {
      try {
        const targetName = this.checklistToDelete.name;
        const targetAssigned = this.checklistToDelete.assigned;

        const checklistsRef = collection(this.firestore, 'checklists');
        const chkSnap = await getDocs(checklistsRef);
        chkSnap.forEach(async (cDoc) => {
          const cData = cDoc.data();
          if (cData['name'] === targetName && cData['assigned'] === targetAssigned) {
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

        alert('🗑️ Checklist y sus duplicados eliminados de raíz para siempre.');
      } catch (error) {
        console.error("Error al eliminar: ", error);
        alert('❌ Hubo un error al intentar eliminar el checklist.');
      }
    }
    
    this.cerrarPasswordModal(); 
  }

  verDetalle(checklist: any) { 
    this.checklistSeleccionado.set(checklist); 
    this.vistaActual.set('detalle'); 
  }

  volverALista() { 
    this.checklistSeleccionado.set(null); 
    this.vistaActual.set('lista'); 
  }

  toggleItem(item: any) { 
    item.checked = !item.checked; 
    this.actualizarEstado(); 
  }

  // 🚀 CONEXIÓN CORPORATIVA A CLOUDINARY 🚀
  async onFileSelected(event: any, item: any) {
    const file = event.target.files[0];
    if (!file) return;

    // 🔥 TUS DATOS DE CLOUDINARY 🔥
    const cloudName = 'duherjgyg'; 
    const uploadPreset = 'fotos_mega'; 

    // Avisamos a la interfaz que estamos subiendo
    item.photo = 'subiendo...'; 
    this.actualizarEstado(); 

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);

    try {
      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      
      if (data.secure_url) {
        // Cloudinary nos da la URL segura y ligerita
        item.photo = data.secure_url; 
      } else {
        item.photo = null;
        alert('❌ Error de Cloudinary: Revisa tu configuración.');
      }
    } catch (error) {
      console.error("Error subiendo foto a Cloudinary:", error);
      item.photo = null;
      alert('❌ Ocurrió un error al subir la evidencia. Revisa tu conexión a internet.');
    } finally {
      // Impactamos los cambios en Firebase
      this.actualizarEstado(); 
      event.target.value = ''; 
    }
  }

  removeImage(item: any) { 
    item.photo = null; 
    this.actualizarEstado(); 
  }

  esItemCompleto(item: any): boolean { 
    return item.checked && (!item.requiresPhoto || (item.photo !== null && item.photo !== 'subiendo...')); 
  }

  actualizarEstado() {
    const actual = this.checklistSeleccionado();
    if(!actual) return;
    
    const checkboxesMarcados = actual.items.filter((i:any) => i.checked).length;
    
    actual.calcCompletados = checkboxesMarcados;
    actual.calcProgreso = Math.round((checkboxesMarcados / actual.items.length) * 100) || 0;

    if (checkboxesMarcados === 0) {
      actual.status = 'pendiente';
    } else if (checkboxesMarcados === actual.items.length) {
      actual.status = 'completo'; 
    } else {
      actual.status = 'en-progreso'; 
    }
    
    this.guardarEnLaNube(actual);
  }

  enviarChecklist() {
    const actual = this.checklistSeleccionado();
    if(!actual) return;

    const fotosPendientes = actual.items.some((i:any) => i.photo === 'subiendo...');
    if (fotosPendientes) {
      alert('⚠️ Espera un momento, hay una fotografía que todavía se está subiendo a la nube.');
      return;
    }

    const tareas100Porciento = actual.items.filter((i:any) => this.esItemCompleto(i)).length;
    
    if (tareas100Porciento < actual.items.length) {
      const confirmar = confirm('⚠️ ¡ATENCIÓN!\n\nHas marcado las tareas pero te faltan FOTOS obligatorias.\nSi lo envías así, se registrará en el PDF como marcado SIN FOTO.\n\n¿Estás completamente seguro de que deseas enviarlo así?');
      if (!confirmar) return;
    }
    
    actual.enviado = true;
    this.guardarEnLaNube(actual); 
    alert('🚀 ¡Checklist enviado exitosamente!');
    this.volverALista();
  }

  toggleEmpleado(nombre: string) {
    const index = this.formAssigned.indexOf(nombre);
    if (index > -1) { 
      this.formAssigned.splice(index, 1); 
    } else { 
      this.formAssigned.push(nombre); 
    }
  }

  abrirModal() {
    this.formName = ''; 
    this.formAssigned = []; 
    this.formStore = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    this.formItems = [{ text: '', requiresPhoto: false, date: '', time: '' }]; 
    this.isModalOpen = true; 
  }

  cerrarModal() { 
    this.isModalOpen = false; 
  }

  agregarItem() { 
    this.formItems.push({ text: '', requiresPhoto: false, date: '', time: '' }); 
  }

  eliminarItem(index: number) { 
    this.formItems.splice(index, 1); 
  }

  trackByIndex(index: number, obj: any): any { 
    return index; 
  }

  guardarChecklistUnico() {
    if (!this.formName || this.formAssigned.length === 0) {
      alert('Por favor completa el nombre y selecciona al menos un trabajador.');
      return;
    }

    const tareasValidas = this.formItems
      .filter(item => item.text.trim() !== '')
      .map((item, i) => ({ 
        id: Date.now() + i, 
        text: item.text, 
        requiresPhoto: item.requiresPhoto, 
        date: item.date, 
        time: item.time, 
        checked: false, 
        photo: null, 
        tipo: 'tarea' 
      }));

    if (tareasValidas.length === 0) {
      alert('Debes agregar al menos una Tarea válida.');
      return;
    }

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
        items: JSON.parse(JSON.stringify(tareasValidas))
      };
      this.guardarEnLaNube(checklistTareas);
    });

    alert('✅ ¡Checklist de Tareas Únicas enviado a los trabajadores!');
    this.cerrarModal();
  }

  toggleEmpleadoRutina(nombre: string) {
    const index = this.formAssignedRutina.indexOf(nombre);
    if (index > -1) { 
      this.formAssignedRutina.splice(index, 1); 
    } else { 
      this.formAssignedRutina.push(nombre); 
    }
  }

  abrirModalRutinas() {
    this.formNameRutina = ''; 
    this.formAssignedRutina = []; 
    this.formStoreRutina = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    this.formRutinas = [{ text: '', requiresPhoto: false, frecuencia: 'Diaria', fechaFin: this.calcularFechaFinDefault('Diaria'), horaLimite: '', diaSemana: 'Lunes', diaMes: 1 }];
    this.isModalRutinasOpen = true; 
  }

  cerrarModalRutinas() { 
    this.isModalRutinasOpen = false; 
  }

  agregarRutina() { 
    this.formRutinas.push({ text: '', requiresPhoto: false, frecuencia: 'Diaria', fechaFin: this.calcularFechaFinDefault('Diaria'), horaLimite: '', diaSemana: 'Lunes', diaMes: 1 }); 
  }

  eliminarRutina(index: number) { 
    this.formRutinas.splice(index, 1); 
  }

  guardarBloqueRutinas() {
    if (!this.formNameRutina || this.formAssignedRutina.length === 0) {
      alert('Por favor completa el nombre del bloque y asigna al menos un responsable.');
      return;
    }

    const rutinasValidas = this.formRutinas
      .filter(rutina => rutina.text.trim() !== '')
      .map((rutina, i) => ({ 
        id: Date.now() + 1000 + i, 
        text: rutina.text, 
        requiresPhoto: rutina.requiresPhoto, 
        checked: false, 
        photo: null, 
        tipo: 'rutina', 
        frecuencia: rutina.frecuencia,
        fechaFin: rutina.fechaFin,
        horaLimite: rutina.horaLimite,
        diaSemana: rutina.diaSemana || 'Lunes',
        diaMes: rutina.diaMes || 1
      }));

    if (rutinasValidas.length === 0) {
      alert('Debes agregar al menos una Rutina al bloque.');
      return;
    }

    this.formAssignedRutina.forEach((empleadoNombre, index) => {
      const rutinasPorFrecuencia: { [key: string]: any[] } = {};
      
      rutinasValidas.forEach(r => {
        const llaveGrupo = r.frecuencia === 'Diaria' ? 'Diaria' :
                           (r.frecuencia === 'Semanal' || r.frecuencia === 'Catorcenal') ? `${r.frecuencia}_${r.diaSemana}` : 
                           `${r.frecuencia}_${r.diaMes}`;
        
        if (!rutinasPorFrecuencia[llaveGrupo]) {
          rutinasPorFrecuencia[llaveGrupo] = [];
        }
        rutinasPorFrecuencia[llaveGrupo].push(r);
      });

      Object.keys(rutinasPorFrecuencia).forEach((llaveGrupo, fIndex) => {
        const partesGrupo = llaveGrupo.split('_');
        const frecuenciaReal = partesGrupo[0];
        
        let diaSemanaReal = null;
        let diaMesReal = null;
        
        if (frecuenciaReal === 'Semanal' || frecuenciaReal === 'Catorcenal') {
          diaSemanaReal = partesGrupo.length > 1 ? partesGrupo[1] : 'Lunes';
        } else if (frecuenciaReal === 'Mensual' || frecuenciaReal === 'Trimestral') {
          diaMesReal = partesGrupo.length > 1 ? parseInt(partesGrupo[1], 10) : 1;
        }

        const nombreMoldeLimpio = this.formNameRutina.replace(/\s+/g, '_').toLowerCase();
        const empleadoLimpio = empleadoNombre.replace(/\s+/g, '_').toLowerCase();
        const moldeId = `molde_${nombreMoldeLimpio}_${empleadoLimpio}_${llaveGrupo}`;
        
        const nuevoMolde = {
          id: moldeId,
          name: this.formNameRutina,
          assigned: empleadoNombre,
          store: this.formStoreRutina,
          frecuencia: frecuenciaReal,
          diaSemana: diaSemanaReal, 
          diaMes: diaMesReal,
          timestampCreacion: Date.now(), 
          createdBy: this.currentUser?.nombre || 'Desconocido', 
          items: JSON.parse(JSON.stringify(rutinasPorFrecuencia[llaveGrupo]))
        };
        
        setDoc(doc(this.firestore, 'moldes_checklists', moldeId), nuevoMolde);
      });
    });

    alert('🔄 ¡El Bloque de Rutinas se guardó en la Bóveda exitosamente!\nEl robot generará los checklists de acuerdo a las reglas y días seleccionados.');
    this.cerrarModalRutinas();
  }

  formatearHora(hora24: string): string {
    if (!hora24) return '';
    const partes = hora24.split(':');
    if (partes.length !== 2) return hora24;
    
    let horas = parseInt(partes[0], 10);
    const minutos = partes[1];
    const ampm = horas >= 12 ? 'PM' : 'AM';
    
    horas = horas % 12;
    horas = horas ? horas : 12; 
    
    const horasStr = horas < 10 ? '0' + horas : horas.toString();
    return `${horasStr}:${minutos} ${ampm}`;
  }
}