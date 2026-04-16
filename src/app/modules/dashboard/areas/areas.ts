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
  
  // 🔥 SISTEMA DE VISTAS 🔥
  vistaActual = signal<'lista' | 'detalle'>('lista');
  areaDetalle = signal<any>(null);

  terminoBusqueda = '';
  isModalOpen = false;
  
  formNombreArea = '';
  formDescripcionArea = '';
  formAssignedUsers: any[] = [];
  terminoBusquedaCreacion = '';

  isModalAsignacionOpen = false;
  areaSeleccionada: any = null;
  empleadosFiltradosAsignacion = signal<any[]>([]);
  terminoBusquedaAsignacion = '';

  private firestore = inject(Firestore); 
  private router = inject(Router); // 🔥 INYECTAMOS EL ENRUTADOR
  private destructoresRadares: (() => void)[] = [];

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }
    
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) {
      window.location.href = '/home';
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

  // 🔥 FUNCIONES DE LA VISTA DE DETALLES 🔥
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

  irACrearTarea(empleadoNombre: string) {
    this.router.navigate(['/checklist'], { queryParams: { assign: empleadoNombre, modal: 'tarea' } });
  }

  irACrearRutina(empleadoNombre: string) {
    this.router.navigate(['/checklist'], { queryParams: { assign: empleadoNombre, modal: 'rutina' } });
  }
  // =====================================

  getAreasFiltradas() {
    const term = this.terminoBusqueda.toLowerCase();
    return this.areas().filter(a => a.nombre.toLowerCase().includes(term));
  }

  contarEmpleadosEnArea(nombreArea: string): number {
    return this.usuarios().filter(u => u.areas && u.areas.includes(nombreArea)).length;
  }

  abrirModalNuevaArea() { 
    this.formNombreArea = ''; this.formDescripcionArea = ''; this.formAssignedUsers = [];
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
      await setDoc(doc(this.firestore, 'areas_operativas', areaId), {
        nombre: nombreFormateado, descripcion: this.formDescripcionArea.trim(), fechaCreacion: new Date().toISOString()
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
    event.stopPropagation(); // 🔥 EVITA QUE SE ABRA LA TARJETA AL BORRAR
    if (this.contarEmpleadosEnArea(area.nombre) > 0) {
      Swal.fire('Atención', 'Hay personal en esta área. Quítalos primero.', 'warning'); return;
    }
    const res = await Swal.fire({ title: '¿Borrar?', text: area.nombre, icon: 'warning', showCancelButton: true });
    if (res.isConfirmed) await deleteDoc(doc(this.firestore, 'areas_operativas', area.id));
  }

  abrirAsignacion(area: any, event: Event) {
    event.stopPropagation(); // 🔥 EVITA QUE SE ABRA LA TARJETA AL ASIGNAR
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
}