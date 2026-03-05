import { Component, signal, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Firestore, collection, doc, setDoc, onSnapshot } from '@angular/fire/firestore';

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
  // 🔥 AHORA ES UN ARREGLO PARA SOPORTAR VARIOS EMPLEADOS 🔥
  formAssigned: string[] = []; 
  formStore = '';
  formDate = '';
  formTime = '';
  formItems = [{ text: '', requiresPhoto: false }]; 

  checklists = signal<any[]>([]); 
  empleados = signal<any[]>([]);  
  sucursalesDisponibles = signal<string[]>([]);

  private firestore = inject(Firestore);

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
    }
    this.conectarRadarNube();
  }

  conectarRadarNube() {
    // 1. ESCUCHAR USUARIOS EN TIEMPO REAL
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

    // 2. ESCUCHAR CHECKLISTS EN TIEMPO REAL
    const checklistsRef = collection(this.firestore, 'checklists');
    onSnapshot(checklistsRef, (snapshot) => {
      const todasLasListas: any[] = [];
      const limite24h = 24 * 60 * 60 * 1000; 
      const ahora = Date.now();

      snapshot.forEach(docSnap => {
        const c: any = docSnap.data();
        if ((ahora - c.id) <= limite24h) {
          todasLasListas.push(c);
        }
      });

      todasLasListas.sort((a, b) => b.id - a.id);

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

      localStorage.setItem('md_checklists', JSON.stringify(todasLasListas));
    });
  }

  async guardarEnLaNube(checklist: any) {
    try {
      const ref = doc(this.firestore, 'checklists', checklist.id.toString());
      await setDoc(ref, checklist, { merge: true });
    } catch (error) {
      console.error("Error subiendo a la nube: ", error);
    }
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

  onFileSelected(event: any, item: any) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        item.photo = e.target.result; 
        this.actualizarEstado();
      };
      reader.readAsDataURL(file);
    }
    event.target.value = ''; 
  }

  removeImage(item: any) {
    item.photo = null; 
    this.actualizarEstado();
  }

  esItemCompleto(item: any): boolean {
    return item.checked && (!item.requiresPhoto || item.photo !== null);
  }

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

  getCompletados(checklist: any): number {
    return checklist.items.filter((i:any) => this.esItemCompleto(i)).length;
  }

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

  // 🔥 NUEVA FUNCIÓN PARA SELECCIONAR VARIOS EMPLEADOS 🔥
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
    this.formAssigned = []; // Reiniciamos el arreglo
    this.formStore = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    this.formDate = '';
    this.formTime = '';
    this.formItems = [{ text: '', requiresPhoto: false }]; 
    this.isModalOpen = true; 
  }

  cerrarModal() {
    this.isModalOpen = false;
  }

  agregarItem() {
    this.formItems.push({ text: '', requiresPhoto: false });
  }

  eliminarItem(index: number) {
    if (this.formItems.length > 1) {
      this.formItems.splice(index, 1);
    }
  }

  trackByIndex(index: number, obj: any): any {
    return index;
  }

  guardarChecklist() {
    if (!this.formName || this.formAssigned.length === 0) {
      alert('Por favor completa el nombre y selecciona al menos un trabajador.');
      return;
    }

    const itemsValidos = this.formItems
      .filter(item => item.text.trim() !== '')
      .map((item, i) => ({
        id: Date.now() + i, 
        text: item.text,
        requiresPhoto: item.requiresPhoto, 
        checked: false,
        photo: null 
      }));

    if (itemsValidos.length === 0) {
      alert('Debes agregar al menos una tarea válida.');
      return;
    }

    // 🔥 MAGIA: CREAMOS UN CHECKLIST INDEPENDIENTE POR CADA EMPLEADO SELECCIONADO 🔥
    this.formAssigned.forEach((empleadoNombre, index) => {
      const uniqueId = Date.now() + index; // ID único para que no choquen en la base de datos

      const nuevoChecklist = {
        id: uniqueId,
        name: this.formName,
        assigned: empleadoNombre, // Se asigna al empleado actual del ciclo
        store: this.formStore,
        date: this.formDate,
        time: this.formTime,
        status: 'pendiente',
        enviado: false,
        items: JSON.parse(JSON.stringify(itemsValidos)) // Copia profunda para que sus palomitas sean independientes
      };

      this.guardarEnLaNube(nuevoChecklist);
    });

    alert('✅ ¡Checklists asignados y enviados a la nube exitosamente!');
    this.cerrarModal();
  }
}