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
  
  // Formulario
  formNombreArea = '';
  formDescripcionArea = '';

  // Modal Asignación
  isModalAsignacionOpen = false;
  areaSeleccionada: any = null;
  empleadosFiltradosAsignacion = signal<any[]>([]);
  terminoBusquedaAsignacion = '';

  private firestore = inject(Firestore); 
  private destructoresRadares: (() => void)[] = [];

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }
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

  getAreasFiltradas() {
    const term = this.terminoBusqueda.toLowerCase();
    return this.areas().filter(a => a.nombre.toLowerCase().includes(term));
  }

  contarEmpleadosEnArea(nombreArea: string): number {
    return this.usuarios().filter(u => u.areas && u.areas.includes(nombreArea)).length;
  }

  abrirModalNuevaArea() { this.formNombreArea = ''; this.formDescripcionArea = ''; this.isModalOpen = true; }
  cerrarModal() { this.isModalOpen = false; }

  async guardarArea() {
    if (!this.formNombreArea.trim()) return;
    const areaId = 'area_' + Date.now();
    await setDoc(doc(this.firestore, 'areas_operativas', areaId), {
      nombre: this.formNombreArea.trim(),
      descripcion: this.formDescripcionArea.trim(),
      fechaCreacion: new Date().toISOString()
    });
    this.isModalOpen = false;
    Swal.fire('¡Éxito!', 'Área creada', 'success');
  }

  async eliminarArea(area: any) {
    if (this.contarEmpleadosEnArea(area.nombre) > 0) {
      Swal.fire('Atención', 'Hay personal en esta área. Quítalos primero.', 'warning');
      return;
    }
    const res = await Swal.fire({ title: '¿Borrar?', text: area.nombre, icon: 'warning', showCancelButton: true });
    if (res.isConfirmed) await deleteDoc(doc(this.firestore, 'areas_operativas', area.id));
  }

  abrirAsignacion(area: any) {
    this.areaSeleccionada = area;
    this.actualizarListaAsignacion();
    this.isModalAsignacionOpen = true;
  }

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