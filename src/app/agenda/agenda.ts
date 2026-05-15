import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, getDocs } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth'; // Si no usas Auth aquí, puedes quitarlo, pero lo dejo por si acaso

@Component({
  selector: 'app-agenda',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './agenda.html',
  styleUrls: ['./agenda.css']
})
export class AgendaComponent implements OnInit {
  isMenuOpen = false;
  currentUser: any = null;
  
  nuevaTareaTexto: string = '';
  tareasPersonales: any[] = [];
  
  // Variables para el Jefe
  listaUsuarios: any[] = [];
  usuarioSeleccionado: string = '';

  // Variable para el Modal de Detalles
  tareaActiva: any = null;

  // Inyecciones
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
      this.usuarioSeleccionado = this.miPropioId(); // Por defecto veo mi propia agenda

      // Si es el Jefe, le traemos la lista de sus empleados
      if (this.currentUser?.rol === 'admin') {
        this.cargarListaPersonal();
      }

      this.cargarAgenda();
    } else {
      this.router.navigate(['/login']);
    }
  }

  // Funciancita auxiliar para no repetir código con el ID
  miPropioId(): string {
    return this.currentUser?.uid || this.currentUser?.id || this.currentUser?.idUsuario || this.currentUser?.correo || '';
  }

  // Trae a todos los empleados para llenar el desplegable del jefe
  async cargarListaPersonal() {
    try {
      const usersRef = collection(this.firestore, 'usuarios');
      const snapshot = await getDocs(query(usersRef));
      this.listaUsuarios = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data() as any
      }));
    } catch (error) {
      console.error('Error al cargar lista de personal:', error);
    }
  }

  // Se ejecuta cuando el jefe cambia el valor del menú desplegable
  cambiarUsuarioFiltro(event: any) {
    this.usuarioSeleccionado = event.target.value;
    this.cargarAgenda(); // Recarga las tareas pero ahora con el ID del trabajador
  }

  cargarAgenda() {
    const userId = this.usuarioSeleccionado; 
    if (!userId) return;

    const agendaRef = collection(this.firestore, `usuarios/${userId}/agenda`);
    
    onSnapshot(query(agendaRef), (snapshot) => {
      this.tareasPersonales = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data() as any
      })).sort((a: any, b: any) => b.fechaCreacion - a.fechaCreacion);
    });
  }

  async agregarTarea() {
    if (!this.nuevaTareaTexto.trim()) return;

    const userId = this.usuarioSeleccionado; 
    if (!userId) return;

    const tarea = {
      texto: this.nuevaTareaTexto,
      completada: false,
      fechaCreacion: Date.now(),
      instrucciones: '',
      comentarios: '',
      adjunto: null
    };

    try {
      await addDoc(collection(this.firestore, `usuarios/${userId}/agenda`), tarea);
      this.nuevaTareaTexto = ''; 
    } catch (error) {
      console.error("Error al guardar:", error);
    }
  }

  async toggleTarea(tarea: any) {
    const userId = this.usuarioSeleccionado; 
    if (!userId) return;

    try {
      const docRef = doc(this.firestore, `usuarios/${userId}/agenda/${tarea.id}`);
      await updateDoc(docRef, { completada: !tarea.completada });
    } catch (error) {
      console.error("Error actualizando tarea", error);
    }
  }

  async eliminarTarea(tareaId: string, event?: Event) {
    if (event) event.stopPropagation(); // Evita que se abra el modal al darle click al bote de basura
    
    const userId = this.usuarioSeleccionado; 
    if (!userId) return;

    if(confirm('¿Estás seguro de eliminar esta tarea?')) {
      try {
        const docRef = doc(this.firestore, `usuarios/${userId}/agenda/${tareaId}`);
        await deleteDoc(docRef);
      } catch (error) {
        console.error("Error eliminando tarea", error);
      }
    }
  }

  // 🔥 FUNCIONES DEL MODAL DE DETALLES 🔥
  abrirDetalle(tarea: any) {
    this.tareaActiva = { ...tarea }; // Clonamos la tarea para no afectar la lista hasta que guarde
  }

  cerrarDetalle() {
    this.tareaActiva = null;
  }

  async guardarDetalles() {
    if (!this.tareaActiva) return;
    const userId = this.usuarioSeleccionado; 
    if (!userId) return;

    try {
      const docRef = doc(this.firestore, `usuarios/${userId}/agenda/${this.tareaActiva.id}`);
      await updateDoc(docRef, {
        texto: this.tareaActiva.texto,
        instrucciones: this.tareaActiva.instrucciones || '',
        comentarios: this.tareaActiva.comentarios || ''
      });
      console.log('✅ Detalles guardados');
      this.cerrarDetalle();
    } catch (error) {
      console.error('Error al guardar detalles', error);
      alert('Hubo un error al guardar los detalles.');
    }
  }

  // Funciones del Layout (Menú y Sesión)
  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

  async cerrarSesion() {
    try {
      if (this.auth) await this.auth.signOut();
      localStorage.removeItem('md_sesion_actual');
      this.router.navigate(['/login']);
    } catch (error) {
      localStorage.removeItem('md_sesion_actual');
      this.router.navigate(['/login']);
    }
  }
}