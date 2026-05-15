import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { getDocs, Firestore, collection, addDoc, query, onSnapshot, doc, updateDoc, deleteDoc } from '@angular/fire/firestore';
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
  listaUsuarios: any[] = [];
  usuarioSeleccionado: string = '';

  // Inyecciones
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);

ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
      this.usuarioSeleccionado = this.miPropioId(); // Por defecto, veo mi propia agenda

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
        ...doc.data()
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
    // MAGIA: Ahora usa "usuarioSeleccionado" en vez del usuario actual
    const userId = this.usuarioSeleccionado; 
    if (!userId) return;

    const agendaRef = collection(this.firestore, `usuarios/${userId}/agenda`);
    
    onSnapshot(query(agendaRef), (snapshot) => {
      this.tareasPersonales = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).sort((a: any, b: any) => b.fechaCreacion - a.fechaCreacion);
    });
  }

  async agregarTarea() {
    if (!this.nuevaTareaTexto.trim()) return;

    // MAGIA PARTE 2: Si el jefe está viendo la agenda de "Juan" y escribe una tarea, 
    // se le asigna directamente a Juan en tiempo real. ¡Asignación remota!
    const userId = this.usuarioSeleccionado; 
    if (!userId) return;

    const tarea = {
      texto: this.nuevaTareaTexto,
      completada: false,
      fechaCreacion: Date.now()
    };

    try {
      await addDoc(collection(this.firestore, `usuarios/${userId}/agenda`), tarea);
      this.nuevaTareaTexto = ''; 
    } catch (error) {
      console.error("Error al guardar:", error);
    }
  }

  async toggleTarea(tarea: any) {
    try {
      const docRef = doc(this.firestore, `usuarios/${this.currentUser.uid}/agenda/${tarea.id}`);
      await updateDoc(docRef, { completada: !tarea.completada });
    } catch (error) {
      console.error("Error actualizando tarea", error);
    }
  }

  async eliminarTarea(id: string) {
    try {
      const docRef = doc(this.firestore, `usuarios/${this.currentUser.uid}/agenda/${id}`);
      await deleteDoc(docRef);
    } catch (error) {
      console.error("Error eliminando tarea", error);
    }
  }
  // Función para abrir/cerrar el menú en celulares
  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

  // Función para salir del sistema
  async cerrarSesion() {
    try {
      if (this.auth) {
        await this.auth.signOut();
      }
      localStorage.removeItem('md_sesion_actual');
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('Error al cerrar sesión', error);
      localStorage.removeItem('md_sesion_actual');
      this.router.navigate(['/login']);
    }
  }
}