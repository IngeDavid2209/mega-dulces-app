import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, getDocs } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { firstValueFrom } from 'rxjs';

import { SidebarComponent } from '../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas } from '../shared/permisos.util';
import { environment } from '../../environments/environment';
import { UsuariosApi } from '../api/usuarios.api';

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
  private usuariosApi = inject(UsuariosApi);
  private pollAgenda: any = null;
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

    if (this.radarAgenda) { this.radarAgenda(); this.radarAgenda = null; }
    if (this.pollAgenda)  { clearInterval(this.pollAgenda); this.pollAgenda = null; }

    if (environment.useBackend) {
      const refresh = async () => {
        try {
          const res = await firstValueFrom(this.usuariosApi.listAgenda(userId));
          this.tareasPersonales = (res.items as any[])
            .sort((a, b) => Number(b.fechaCreacion) - Number(a.fechaCreacion));
        } catch (e) {
          console.error('[agenda/backend] error', e);
        }
      };
      refresh();
      this.pollAgenda = setInterval(refresh, 30_000);
      return;
    }

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
      if (environment.useBackend) {
        await firstValueFrom(this.usuariosApi.actualizarAgenda(userId, tarea.id, { completada: !tarea.completada } as any));
        tarea.completada = !tarea.completada;
      } else {
        const docRef = doc(this.firestore, `usuarios/${userId}/agenda/${tarea.id}`);
        await updateDoc(docRef, { completada: !tarea.completada });
      }
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
        if (environment.useBackend) {
          await firstValueFrom(this.usuariosApi.borrarAgenda(userId, tareaId));
          this.cargarAgenda();
        } else {
          const docRef = doc(this.firestore, `usuarios/${userId}/agenda/${tareaId}`);
          await deleteDoc(docRef);
        }
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
      const { esNueva, id, ...data } = this.tareaActiva;
      if (environment.useBackend) {
        if (esNueva) {
          await firstValueFrom(this.usuariosApi.crearAgenda(userId, data as any));
        } else {
          await firstValueFrom(this.usuariosApi.actualizarAgenda(userId, id, {
            texto: data.texto,
            instrucciones: data.instrucciones || '',
            comentarios: data.comentarios || '',
          } as any));
        }
        if (esNueva) this.nuevaTareaTexto = '';
        this.cargarAgenda();
      } else {
        if (esNueva) {
          await addDoc(collection(this.firestore, `usuarios/${userId}/agenda`), data);
          this.nuevaTareaTexto = '';
        } else {
          const docRef = doc(this.firestore, `usuarios/${userId}/agenda/${id}`);
          await updateDoc(docRef, {
            texto: data.texto,
            instrucciones: data.instrucciones || '',
            comentarios: data.comentarios || ''
          });
        }
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