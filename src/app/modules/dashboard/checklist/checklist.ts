import { Component, signal, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Firestore, collection, doc, setDoc, getDoc, onSnapshot } from '@angular/fire/firestore';

@Component({
  selector: 'app-checklist',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './checklist.html',
  styleUrls: ['./checklist.css']
})
export class ChecklistComponent implements OnInit {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null; 
  vistaActual = signal<'lista' | 'detalle'>('lista');
  checklistSeleccionado = signal<any>(null);
  
  isModalOpen = false;
  formName = '';
  formAssigned: string[] = []; 
  formStore = '';
  formDate = '';
  formTime = '';
  
  formItems = [{ text: '', requiresPhoto: false }]; 
  
  // 🔥 AHORA LAS RUTINAS INICIAN CON FECHA DE FIN INTELIGENTE 🔥
  formRutinas: any[] = []; 
  frecuencias = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral'];

  checklists = signal<any[]>([]); 
  empleados = signal<any[]>([]);  
  sucursalesDisponibles = signal<string[]>([]);

  private firestore = inject(Firestore);

  get empleadosFiltrados() {
    if (!this.formStore) return this.empleados();
    
    return this.empleados().filter(emp => {
      if (emp.sucursales && emp.sucursales.includes('General (Acceso Total)')) return true;
      const susSucursales = emp.sucursales || [emp.sucursal || ''];
      return susSucursales.includes(this.formStore);
    });
  }

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
    }
    this.conectarRadarNube();
  }

  conectarRadarNube() {
    const usuariosRef = collection(this.firestore, 'usuarios');
    onSnapshot(usuariosRef, (snapshot) => {
      const todosLosUsuarios: any[] = [];
      snapshot.forEach(docSnap => todosLosUsuarios.push(docSnap.data()));

      const todasLasSucursales = ['Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo', 'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro'];

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

    const moldesRef = collection(this.firestore, 'moldes_checklists');
    onSnapshot(moldesRef, (snapshot) => {
      const moldesActivos: any[] = [];
      snapshot.forEach(docSnap => moldesActivos.push(docSnap.data()));
      this.ejecutarRobotRutinas(moldesActivos); 
    });

    const checklistsRef = collection(this.firestore, 'checklists');
    onSnapshot(checklistsRef, (snapshot) => {
      const todasLasListas: any[] = [];
      const limite24h = 24 * 60 * 60 * 1000; 
      const ahora = Date.now();

      snapshot.forEach(docSnap => {
        const c: any = docSnap.data();
        if ((ahora - (typeof c.id === 'number' ? c.id : c.timestampCreacion || ahora)) <= limite24h) {
          todasLasListas.push(c);
        }
      });

      todasLasListas.sort((a, b) => b.timestampCreacion - a.timestampCreacion);

      if (this.currentUser?.rol === 'admin') {
        this.checklists.set(todasLasListas);
      } else if (this.currentUser?.puedeCrearChecklists) {
        const misSucursales = this.currentUser.sucursales || [this.currentUser.sucursal || ''];
        const filtradas = todasLasListas.filter((c: any) => 
          c.assigned === this.currentUser.nombre || misSucursales.includes(c.store)
        );
        this.checklists.set(filtradas);
      } else {
        const misListas = todasLasListas.filter((c: any) => c.assigned === this.currentUser.nombre);
        this.checklists.set(misListas);
      }
    });
  }

  // 🔥 MAGIA: Calcula cuándo termina en automático según la frecuencia 🔥
 // 🔥 MAGIA CORREGIDA: Calcula la fecha exacta según la palabra literal 🔥
  calcularFechaFinDefault(frecuencia: string): string {
    const fecha = new Date();
    
    if (frecuencia === 'Diaria') {
      fecha.setDate(fecha.getDate() + 1); // Suma exactamente 1 día
    } else if (frecuencia === 'Semanal') {
      fecha.setDate(fecha.getDate() + 7); // Suma exactamente 7 días
    } else if (frecuencia === 'Catorcenal') {
      fecha.setDate(fecha.getDate() + 14); // Suma exactamente 14 días
    } else if (frecuencia === 'Mensual') {
      fecha.setMonth(fecha.getMonth() + 1); // Suma exactamente 1 mes
    } else if (frecuencia === 'Trimestral') {
      fecha.setMonth(fecha.getMonth() + 3); // Suma exactamente 3 meses
    }
    
    // Ajuste de zona horaria para que no se desfase un día por el cambio de horario
    const offset = fecha.getTimezoneOffset() * 60000;
    const fechaLocal = new Date(fecha.getTime() - offset);
    
    return fechaLocal.toISOString().split('T')[0];
  }
  // Se ejecuta cuando el admin cambia el menú desplegable de frecuencia
  alCambiarFrecuencia(rutina: any) {
    rutina.fechaFin = this.calcularFechaFinDefault(rutina.frecuencia);
  }

  obtenerLlavePeriodo(frecuencia: string, fecha: Date): string {
    const y = fecha.getFullYear();
    const m = fecha.getMonth() + 1;
    const d = fecha.getDate();

    if (frecuencia === 'Diaria') return `${y}-${m}-${d}`;
    if (frecuencia === 'Mensual') return `${y}-${m}`;
    if (frecuencia === 'Trimestral') return `${y}-Q${Math.ceil(m / 3)}`;
    
    const firstDay = new Date(y, 0, 1);
    const days = Math.floor((fecha.getTime() - firstDay.getTime()) / (24 * 60 * 60 * 1000));
    const week = Math.ceil((days + firstDay.getDay() + 1) / 7);
    
    if (frecuencia === 'Semanal') return `${y}-W${week}`;
    if (frecuencia === 'Catorcenal') return `${y}-C${Math.ceil(week / 2)}`;

    return `${y}-${m}-${d}`;
  }

  async ejecutarRobotRutinas(moldes: any[]) {
    const fechaActual = new Date();
    const fechaString = fechaActual.toISOString().split('T')[0];

    for (const molde of moldes) {
      
      // 🔥 EL ROBOT REVISA SI LA RUTINA YA CADUCÓ 🔥
      const itemsVigentes = molde.items.filter((item: any) => {
        return !item.fechaFin || fechaString <= item.fechaFin;
      });

      // Si todos los items del molde ya caducaron, nos saltamos este molde
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
           items: itemsVigentes.map((i:any) => ({...i, checked: false, photo: null}))
        };
        await setDoc(docRef, nuevoChecklist);
      }
    }
  }

  async guardarEnLaNube(checklist: any) {
    try {
      const docId = checklist.id.toString();
      const ref = doc(this.firestore, 'checklists', docId);
      await setDoc(ref, checklist, { merge: true });
    } catch (error) {
      console.error("Error subiendo a la nube: ", error);
    }
  }

  verDetalle(checklist: any) { this.checklistSeleccionado.set(checklist); this.vistaActual.set('detalle'); }
  volverALista() { this.checklistSeleccionado.set(null); this.vistaActual.set('lista'); }
  toggleItem(item: any) { item.checked = !item.checked; this.actualizarEstado(); }

  onFileSelected(event: any, item: any) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e: any) => { item.photo = e.target.result; this.actualizarEstado(); };
      reader.readAsDataURL(file);
    }
    event.target.value = ''; 
  }

  removeImage(item: any) { item.photo = null; this.actualizarEstado(); }
  esItemCompleto(item: any): boolean { return item.checked && (!item.requiresPhoto || item.photo !== null); }

  actualizarEstado() {
    const actual = this.checklistSeleccionado();
    if(!actual) return;
    
    const checkboxesMarcados = actual.items.filter((i:any) => i.checked).length;
    const tareas100Porciento = actual.items.filter((i:any) => this.esItemCompleto(i)).length;
    
    if (checkboxesMarcados === 0) actual.status = 'pendiente';
    else if (tareas100Porciento === actual.items.length) actual.status = 'completo';
    else actual.status = 'en-progreso';
    
    this.guardarEnLaNube(actual);
  }

  getProgreso(checklist: any): number {
    const tareas100Porciento = checklist.items.filter((i:any) => this.esItemCompleto(i)).length;
    return Math.round((tareas100Porciento / checklist.items.length) * 100) || 0;
  }

  getCompletados(checklist: any): number { return checklist.items.filter((i:any) => this.esItemCompleto(i)).length; }

  enviarChecklist() {
    const actual = this.checklistSeleccionado();
    if(!actual) return;

    const tareas100Porciento = actual.items.filter((i:any) => this.esItemCompleto(i)).length;
    if (tareas100Porciento < actual.items.length) {
      const confirmar = confirm('⚠️ El checklist aún no está al 100%.\n¿Estás seguro de que deseas enviarlo incompleto al administrador?');
      if (!confirmar) return;
    }
    actual.enviado = true;
    this.guardarEnLaNube(actual); 
    alert('🚀 ¡Checklist enviado exitosamente!');
    this.volverALista();
  }

  toggleEmpleado(nombre: string) {
    const index = this.formAssigned.indexOf(nombre);
    if (index > -1) { this.formAssigned.splice(index, 1); } else { this.formAssigned.push(nombre); }
  }

  abrirModal() {
    this.formName = ''; this.formAssigned = []; 
    this.formStore = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    this.formDate = ''; this.formTime = '';
    this.formItems = [{ text: '', requiresPhoto: false }]; 
    // 🔥 INICIAMOS CON FECHA INTELIGENTE 🔥
    this.formRutinas = [{ text: '', requiresPhoto: false, frecuencia: 'Diaria', fechaFin: this.calcularFechaFinDefault('Diaria') }];
    this.isModalOpen = true; 
  }

  cerrarModal() { this.isModalOpen = false; }
  agregarItem() { this.formItems.push({ text: '', requiresPhoto: false }); }
  eliminarItem(index: number) { this.formItems.splice(index, 1); }
  
  agregarRutina() { 
    this.formRutinas.push({ text: '', requiresPhoto: false, frecuencia: 'Diaria', fechaFin: this.calcularFechaFinDefault('Diaria') }); 
  }
  
  eliminarRutina(index: number) { this.formRutinas.splice(index, 1); }
  trackByIndex(index: number, obj: any): any { return index; }

  guardarChecklist() {
    if (!this.formName || this.formAssigned.length === 0) {
      alert('Por favor completa el nombre y selecciona al menos un trabajador.');
      return;
    }

    const tareasValidas = this.formItems
      .filter(item => item.text.trim() !== '')
      .map((item, i) => ({ id: Date.now() + i, text: item.text, requiresPhoto: item.requiresPhoto, checked: false, photo: null, tipo: 'tarea' }));

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
        fechaFin: rutina.fechaFin // 🔥 GUARDAMOS LA FECHA DE CADUCIDAD 🔥
      }));

    if (tareasValidas.length === 0 && rutinasValidas.length === 0) {
      alert('Debes agregar al menos una Tarea o una Rutina válida.');
      return;
    }

    this.formAssigned.forEach((empleadoNombre, index) => {
      // Guardar Tareas Únicas
      if (tareasValidas.length > 0) {
        const uniqueId = Date.now() + index; 
        const checklistTareas = {
          id: uniqueId,
          timestampCreacion: Date.now(),
          name: this.formName + ' (Tareas Únicas)',
          assigned: empleadoNombre,
          store: this.formStore,
          date: this.formDate,
          time: this.formTime,
          status: 'pendiente',
          enviado: false,
          items: JSON.parse(JSON.stringify(tareasValidas))
        };
        this.guardarEnLaNube(checklistTareas);
      }

      // Guardar Moldes en la bóveda
      if (rutinasValidas.length > 0) {
        const rutinasPorFrecuencia: { [key: string]: any[] } = {};
        rutinasValidas.forEach(r => {
          if (!rutinasPorFrecuencia[r.frecuencia]) rutinasPorFrecuencia[r.frecuencia] = [];
          rutinasPorFrecuencia[r.frecuencia].push(r);
        });

        Object.keys(rutinasPorFrecuencia).forEach((frecuencia, fIndex) => {
          const moldeId = `molde_${Date.now()}_${index}_${fIndex}`;
          const nuevoMolde = {
            id: moldeId,
            name: this.formName,
            assigned: empleadoNombre,
            store: this.formStore,
            frecuencia: frecuencia,
            items: JSON.parse(JSON.stringify(rutinasPorFrecuencia[frecuencia]))
          };
          
          setDoc(doc(this.firestore, 'moldes_checklists', moldeId), nuevoMolde);
        });
      }
    });

    alert('✅ ¡Checklists creados y Rutinas guardadas en la bóveda automática!');
    this.cerrarModal();
  }
}