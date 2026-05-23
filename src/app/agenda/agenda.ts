import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, getDocs } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

import { SidebarComponent } from '../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas } from '../shared/permisos.util';

@Component({
  selector: 'app-agenda',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './agenda.html',
  styleUrls: ['./agenda.css']
})
export class AgendaComponent implements OnInit, OnDestroy {
  /** Unsubscribe del snapshot activo (se reemplaza cada vez que se cambia de usuario). */
  private radarAgenda: (() => void) | null = null;

  ngOnDestroy() {
    // 🔥 Cierra el snapshot al salir para evitar memory leak
    if (this.radarAgenda) { this.radarAgenda(); this.radarAgenda = null; }
  }

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
      this.usuarioSeleccionado = this.miPropioId();

      if (this.currentUser?.rol === 'admin') {
        this.cargarListaPersonal();
      }

      this.cargarAgenda();
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
      let lista = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data() as any
      }));

      // 🔥 Admin LIMITADO: solo trabajadores de sus sucursales (excluye otros admins)
      if (!esAdminGlobal(this.currentUser)) {
        const permitidas = sucursalesPermitidas(this.currentUser);
        if (permitidas !== null) {
          lista = lista.filter((u: any) => {
            if (u.rol === 'admin') return false;
            const susSuc: string[] = u.sucursales || (u.sucursal ? [u.sucursal] : []);
            return susSuc.some((s: string) => permitidas.includes(s));
          });
        }
      }

      this.listaUsuarios = lista;
    } catch (error) {
      console.error('Error al cargar lista de personal:', error);
    }
  }

  cambiarUsuarioFiltro(event: any) {
    this.usuarioSeleccionado = event.target.value;
    this.cargarAgenda();
  }

  cargarAgenda() {
    const userId = this.usuarioSeleccionado;
    if (!userId) return;

    // 🔥 FIX MEMORY LEAK: cerrar el snapshot anterior antes de abrir uno nuevo.
    // Antes cada cambio de usuario creaba un listener nuevo SIN cerrar el viejo.
    if (this.radarAgenda) { this.radarAgenda(); this.radarAgenda = null; }

    const agendaRef = collection(this.firestore, `usuarios/${userId}/agenda`);

    this.radarAgenda = onSnapshot(query(agendaRef), (snapshot) => {
      this.tareasPersonales = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data() as any
      })).sort((a: any, b: any) => b.fechaCreacion - a.fechaCreacion);
    });
  }

  // 🔥 1. El botón "+" solo prepara el borrador y abre el modal
  agregarTarea() {
    if (!this.nuevaTareaTexto.trim()) return;

    this.tareaActiva = {
      texto: this.nuevaTareaTexto,
      completada: false,
      fechaCreacion: Date.now(),
      instrucciones: '',
      comentarios: '',
      adjunto: null,
      esNueva: true // Bandera para saber que es creación
    };
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
    if (event) event.stopPropagation();
    
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

  // 🔥 2. Funciones del Modal de Detalles
  abrirDetalle(tarea: any) {
    this.tareaActiva = { ...tarea, esNueva: false }; // Clonamos para edición
  }

  cerrarDetalle() {
    this.tareaActiva = null;
  }

  async guardarDetalles() {
    if (!this.tareaActiva) return;
    const userId = this.usuarioSeleccionado || this.miPropioId(); 
    if (!userId) return;

    try {
      if (this.tareaActiva.esNueva) {
        // CREACIÓN: Guardar nueva tarea en Firebase
        const { esNueva, ...tareaParaGuardar } = this.tareaActiva;
        await addDoc(collection(this.firestore, `usuarios/${userId}/agenda`), tareaParaGuardar);
        this.nuevaTareaTexto = ''; 
      } else {
        // ACTUALIZACIÓN: Guardar cambios en tarea existente
        const docRef = doc(this.firestore, `usuarios/${userId}/agenda/${this.tareaActiva.id}`);
        await updateDoc(docRef, {
          texto: this.tareaActiva.texto,
          instrucciones: this.tareaActiva.instrucciones || '',
          comentarios: this.tareaActiva.comentarios || ''
        });
      }
      this.cerrarDetalle();
    } catch (error) {
      console.error('Error al guardar:', error);
      alert('Hubo un error al procesar la solicitud.');
    }
  }

  // Layout
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

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