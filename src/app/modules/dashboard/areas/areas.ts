import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router'; 
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
  
  terminoBusqueda = '';
  isModalOpen = false;
  
  // Formulario de Nueva Área
  formNombreArea = '';
  formDescripcionArea = '';

  // Modal de Asignación Rápida
  isModalAsignacionOpen = false;
  areaSeleccionada: any = null;
  empleadosFiltradosAsignacion = signal<any[]>([]);
  terminoBusquedaAsignacion = '';

  private firestore = inject(Firestore); 
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

  ngOnDestroy() {
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
  }

  conectarConLaNube() {
    // RADAR DE ÁREAS
    const areasRef = collection(this.firestore, 'areas_operativas');
    const radarAreas = onSnapshot(areasRef, (snapshot) => {
      const areasNube: any[] = [];
      snapshot.forEach((documento) => {
        areasNube.push({ ...documento.data(), id: documento.id });
      });
      areasNube.sort((a, b) => a.nombre.localeCompare(b.nombre));
      this.areas.set(areasNube);
    });
    this.destructoresRadares.push(radarAreas);

    // RADAR DE USUARIOS
    const usuariosRef = collection(this.firestore, 'usuarios');
    const radarUsuarios = onSnapshot(usuariosRef, (snapshot) => {
      const usuariosNube: any[] = [];
      snapshot.forEach((documento) => {
        usuariosNube.push({ ...documento.data(), idFirestore: documento.id });
      });
      this.usuarios.set(usuariosNube);
    });
    this.destructoresRadares.push(radarUsuarios);
  }

  getAreasFiltradas() {
    if (!this.terminoBusqueda.trim()) return this.areas();
    const termino = this.terminoBusqueda.toLowerCase();
    return this.areas().filter(a => a.nombre.toLowerCase().includes(termino) || (a.descripcion && a.descripcion.toLowerCase().includes(termino)));
  }

  contarEmpleadosEnArea(nombreArea: string): number {
    return this.usuarios().filter(u => u.rol === 'trabajador' && u.areas && u.areas.includes(nombreArea)).length;
  }

  abrirModalNuevaArea() {
    this.formNombreArea = ''; this.formDescripcionArea = ''; this.isModalOpen = true;
  }

  cerrarModal() { this.isModalOpen = false; }

  async guardarArea() {
    if (!this.formNombreArea.trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta el nombre', text: 'Debes asignarle un nombre al área operativa.', confirmButtonColor: '#0F172A' });
      return;
    }

    const nombreFormateado = this.formNombreArea.trim();
    const existe = this.areas().some(a => a.nombre.toLowerCase() === nombreFormateado.toLowerCase());
    
    if (existe) {
      Swal.fire({ icon: 'error', title: 'Área Duplicada', text: 'Ya existe un área con ese nombre.', confirmButtonColor: '#0F172A' });
      return;
    }

    const areaId = 'area_' + Date.now();
    const payload = {
      nombre: nombreFormateado, descripcion: this.formDescripcionArea.trim(),
      fechaCreacion: new Date().toISOString(), creadoPor: this.currentUser?.nombre || 'Administrador'
    };

    try {
      await setDoc(doc(this.firestore, 'areas_operativas', areaId), payload);
      this.cerrarModal();
      this.mostrarToast('✅ Área creada exitosamente');
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Error', text: 'Hubo un problema al crear el área.', confirmButtonColor: '#0F172A' });
    }
  }

  async eliminarArea(area: any) {
    const totalEmpleados = this.contarEmpleadosEnArea(area.nombre);
    if (totalEmpleados > 0) {
      Swal.fire({ icon: 'warning', title: 'Área en uso', text: `No puedes eliminar esta área porque hay ${totalEmpleados} empleado(s) asignados a ella.`, confirmButtonColor: '#0F172A' });
      return;
    }

    const result = await Swal.fire({
      title: `¿Eliminar área "${area.nombre}"?`, text: "Esta acción no se puede deshacer.", icon: 'warning',
      showCancelButton: true, confirmButtonColor: '#EF4444', cancelButtonColor: '#0F172A',
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      try {
        await deleteDoc(doc(this.firestore, 'areas_operativas', area.id));
        this.mostrarToast('🗑️ Área eliminada');
      } catch (error) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo eliminar el área.', confirmButtonColor: '#0F172A' });
      }
    }
  }
  
  abrirAsignacion(area: any) {
    this.areaSeleccionada = area;
    this.terminoBusquedaAsignacion = '';
    this.actualizarListaAsignacion();
    this.isModalAsignacionOpen = true;
  }

  cerrarAsignacion() { this.isModalAsignacionOpen = false; this.areaSeleccionada = null; }

  actualizarListaAsignacion() {
    let trabajadores = this.usuarios().filter(u => u.rol === 'trabajador');
    if (this.terminoBusquedaAsignacion.trim()) {
      const term = this.terminoBusquedaAsignacion.toLowerCase();
      trabajadores = trabajadores.filter(t => t.nombre.toLowerCase().includes(term) || (t.cargo && t.cargo.toLowerCase().includes(term)));
    }
    this.empleadosFiltradosAsignacion.set(trabajadores);
  }

  tieneElArea(usuario: any): boolean {
    return usuario.areas && usuario.areas.includes(this.areaSeleccionada.nombre);
  }

  async toggleAreaUsuario(usuario: any) {
    const tieneArea = this.tieneElArea(usuario);
    let nuevasAreas = usuario.areas ? [...usuario.areas] : [];

    if (tieneArea) { nuevasAreas = nuevasAreas.filter(a => a !== this.areaSeleccionada.nombre); } 
    else { nuevasAreas.push(this.areaSeleccionada.nombre); }

    try {
      const docId = usuario.idFirestore || usuario.uid || usuario.usuario;
      await setDoc(doc(this.firestore, 'usuarios', docId), { areas: nuevasAreas }, { merge: true });
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar el permiso del usuario.', confirmButtonColor: '#0F172A' });
    }
  }

  mostrarToast(mensaje: string) {
    Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true, icon: 'success', title: mensaje });
  }
}