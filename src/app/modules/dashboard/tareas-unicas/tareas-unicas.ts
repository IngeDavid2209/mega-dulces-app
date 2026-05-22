import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, getDocs } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

@Component({
  selector: 'app-tareas-unicas',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './tareas-unicas.html', // ⚠️ Verifica si tu archivo se llama así o solo tareas-unicas.html
  styleUrls: ['./tareas-unicas.css'] // ⚠️ Igual aquí
})
export class TareasUnicasComponent implements OnInit {
  isMenuOpen = false;
  currentUser: any = null;
    wizardStep: number = 1;
  wizardTotalSteps: number = 6;
  wizardTipoEvidencia: 'ninguna' | 'foto' | 'antesDespues' = 'ninguna';
  terminoBusquedaEmpleadoWizard: string = '';
  nuevaTareaTexto: string = '';
  proyectosUnicos: any[] = [];
  
  // Variables para Auditoría (Don Luis)
  listaUsuarios: any[] = [];
  usuarioSeleccionado: string = '';

  // Control del Proyecto y sus Fases
  tareaActiva: any = null;
  nuevaFaseTexto: string = ''; 

  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
      this.usuarioSeleccionado = this.miPropioId();

      if (this.currentUser?.rol === 'admin') {
        this.cargarListaPersonal();
      }
      this.cargarProyectos();
    } else {
      this.router.navigate(['/login']);
    }
  }

  miPropioId(): string {
    return this.currentUser?.uid || this.currentUser?.id || this.currentUser?.idUsuario || this.currentUser?.correo || '';
  }

  async cargarListaPersonal() {
    try {
      const usersRef = collection(this.firestore, 'usuarios');
      const snapshot = await getDocs(query(usersRef));
      this.listaUsuarios = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
    } catch (error) {
      console.error('Error al cargar lista de personal:', error);
    }
  }

  cambiarUsuarioFiltro(event: any) {
    this.usuarioSeleccionado = event.target.value;
    this.cargarProyectos();
  }

  esViendoMisProyectos(): boolean {
    return this.usuarioSeleccionado === this.miPropioId();
  }

  getNombreUsuarioVisualizado(): string {
    if (this.esViendoMisProyectos()) {
      return this.currentUser?.nombre || 'Mis proyectos';
    }
    const u = this.listaUsuarios.find(x => x.id === this.usuarioSeleccionado);
    return u?.nombre || u?.correo || 'Usuario';
  }

  getInicialesUsuarioVisualizado(): string {
    const nombre = this.getNombreUsuarioVisualizado();
    const partes = nombre.trim().split(/\s+/);
    if (partes.length >= 2) {
      return (partes[0][0] + partes[1][0]).toUpperCase();
    }
    return (partes[0]?.substring(0, 2) || '??').toUpperCase();
  }

  getRolUsuarioVisualizado(): string {
    if (this.esViendoMisProyectos()) return this.currentUser?.rol || 'admin';
    const u = this.listaUsuarios.find(x => x.id === this.usuarioSeleccionado);
    return u?.rol || 'trabajador';
  }

  getProyectosCompletados(): number {
    return this.proyectosUnicos.filter(p => p.completada).length;
  }

  getProyectosEnCurso(): number {
    return this.proyectosUnicos.filter(p => !p.completada).length;
  }

  cargarProyectos() {
    const userId = this.usuarioSeleccionado; 
    if (!userId) return;
    
    // 🔥 MAGIA: Nueva colección en Firebase exclusiva para proyectos/fases
    const proyectosRef = collection(this.firestore, `usuarios/${userId}/tareas_unicas`);
    
    onSnapshot(query(proyectosRef), (snapshot) => {
      this.proyectosUnicos = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data() as any
      })).sort((a: any, b: any) => b.fechaCreacion - a.fechaCreacion);
    });
  }

  prepararTarea() {
    if (!this.nuevaTareaTexto.trim()) return;

    this.tareaActiva = {
      texto: this.nuevaTareaTexto,
      completada: false,
      fechaCreacion: Date.now(),
      instrucciones: '',
      subtareas: [], // Aquí irán las fases
      esNueva: true 
    };
  }

  async toggleTareaPrincipal(tarea: any) {
    const userId = this.usuarioSeleccionado || this.miPropioId(); 
    if (!userId) return;

    if (tarea.subtareas && tarea.subtareas.length > 0) {
      const terminadas = tarea.subtareas.filter((st: any) => st.completada).length;
      if (!tarea.completada && terminadas < tarea.subtareas.length) {
        alert(`❌ Proyecto Bloqueado: Tienes ${tarea.subtareas.length - terminadas} fases pendientes.\n\nCompleta todas las fases antes de cerrar este proyecto.`);
        return;
      }
    }

    try {
      const docRef = doc(this.firestore, `usuarios/${userId}/tareas_unicas/${tarea.id}`);
      await updateDoc(docRef, { completada: !tarea.completada });
    } catch (error) {
      console.error("Error al actualizar estado", error);
    }
  }

  agregarFase() {
    if (!this.nuevaFaseTexto.trim()) return;
    if (!this.tareaActiva.subtareas) this.tareaActiva.subtareas = [];

    this.tareaActiva.subtareas.push({
      texto: this.nuevaFaseTexto,
      completada: false
    });
    this.nuevaFaseTexto = '';
    this.actualizarEstadoAutomatico();
  }

  toggleFase(index: number) {
    this.tareaActiva.subtareas[index].completada = !this.tareaActiva.subtareas[index].completada;
    this.actualizarEstadoAutomatico();
  }

  eliminarFase(index: number) {
    this.tareaActiva.subtareas.splice(index, 1);
    this.actualizarEstadoAutomatico();
  }

  actualizarEstadoAutomatico() {
    if (this.tareaActiva.subtareas && this.tareaActiva.subtareas.length > 0) {
      const todasListas = this.tareaActiva.subtareas.every((st: any) => st.completada);
      this.tareaActiva.completada = todasListas; 
    }
  }

  async guardarTodo() {
    if (!this.tareaActiva) return;
    const userId = this.usuarioSeleccionado || this.miPropioId(); 
    if (!userId) return;

    try {
      if (this.tareaActiva.esNueva) {
        const { esNueva, ...data } = this.tareaActiva;
        await addDoc(collection(this.firestore, `usuarios/${userId}/tareas_unicas`), data);
        this.nuevaTareaTexto = ''; 
      } else {
        const docRef = doc(this.firestore, `usuarios/${userId}/tareas_unicas/${this.tareaActiva.id}`);
        await updateDoc(docRef, {
          texto: this.tareaActiva.texto,
          completada: this.tareaActiva.completada,
          instrucciones: this.tareaActiva.instrucciones || '',
          subtareas: this.tareaActiva.subtareas || []
        });
      }
      this.cerrarDetalle();
    } catch (error) {
      console.error('Error al guardar en Firebase', error);
    }
  }

  abrirDetalle(tarea: any) {
    this.tareaActiva = { ...tarea, esNueva: false };
    if (!this.tareaActiva.subtareas) this.tareaActiva.subtareas = [];
  }

  cerrarDetalle() {
    this.tareaActiva = null;
    this.nuevaFaseTexto = '';
  }

  async eliminarTarea(id: string, event: Event) {
    event.stopPropagation();
    const userId = this.usuarioSeleccionado || this.miPropioId();
    if(confirm('¿Eliminar este proyecto y todas sus fases?')) {
      await deleteDoc(doc(this.firestore, `usuarios/${userId}/tareas_unicas/${id}`));
    }
  }

  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  cerrarSesion() {
    localStorage.removeItem('md_sesion_actual');
    this.router.navigate(['/login']);
  }
}