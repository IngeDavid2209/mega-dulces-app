import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, getDocs } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { firstValueFrom } from 'rxjs';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import { environment } from '../../../../environments/environment';
import { UsuariosApi } from '../../../api/usuarios.api';

@Component({
  selector: 'app-tareas-unicas',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './tareas-unicas.html', // ⚠️ Verifica si tu archivo se llama así o solo tareas-unicas.html
  styleUrls: ['./tareas-unicas.css'] // ⚠️ Igual aquí
})
export class TareasUnicasComponent implements OnInit, OnDestroy {
  /** Unsubscribe del snapshot activo (se reemplaza al cambiar de usuario). */
  private radarProyectos: (() => void) | null = null;

  ngOnDestroy() {
    if (this.radarProyectos) { this.radarProyectos(); this.radarProyectos = null; }
    if (this.pollProyectos)  { clearInterval(this.pollProyectos); this.pollProyectos = null; }
  }

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
  private usuariosApi = inject(UsuariosApi);
  /** Timer del polling al backend (sustituye al onSnapshot Firestore en modo backend). */
  private pollProyectos: any = null;

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
      let lista: any[];
      if (environment.useBackend) {
        const res = await firstValueFrom(this.usuariosApi.list());
        // Normalizamos al shape esperado por la UI (id, ...resto). El backend ya
        // aplica filtros de visibilidad por permisos, asi que aqui solo necesitamos
        // excluir admins cuando el actual es admin limitado.
        // u ya trae `id` (uuid Postgres) desde el modelo Usuario.
        lista = res.usuarios as any[];
        if (!esAdminGlobal(this.currentUser)) {
          lista = lista.filter((u: any) => u.rol !== 'admin');
        }
      } else {
        const usersRef = collection(this.firestore, 'usuarios');
        const snapshot = await getDocs(query(usersRef));
        lista = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

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
      }
      this.listaUsuarios = lista;
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

    // Cerrar listeners anteriores antes de abrir uno nuevo.
    if (this.radarProyectos) { this.radarProyectos(); this.radarProyectos = null; }
    if (this.pollProyectos)  { clearInterval(this.pollProyectos); this.pollProyectos = null; }

    if (environment.useBackend) {
      const refresh = async () => {
        try {
          const res = await firstValueFrom(this.usuariosApi.listTareasUnicas(userId));
          this.proyectosUnicos = (res.tareas as any[])
            .sort((a, b) => Number(b.fechaCreacion) - Number(a.fechaCreacion));
        } catch (e) {
          console.error('[tareas-unicas/backend] error al cargar', e);
        }
      };
      refresh();
      this.pollProyectos = setInterval(refresh, 30_000);   // 30s polling
      return;
    }

    // Firestore legacy: onSnapshot sobre la sub-coleccion del usuario.
    const proyectosRef = collection(this.firestore, `usuarios/${userId}/tareas_unicas`);
    this.radarProyectos = onSnapshot(query(proyectosRef), (snapshot) => {
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
      if (environment.useBackend) {
        await firstValueFrom(this.usuariosApi.actualizarTareaUnica(userId, tarea.id, { completada: !tarea.completada } as any));
        tarea.completada = !tarea.completada;
      } else {
        const docRef = doc(this.firestore, `usuarios/${userId}/tareas_unicas/${tarea.id}`);
        await updateDoc(docRef, { completada: !tarea.completada });
      }
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
      const { esNueva, id, ...data } = this.tareaActiva;
      if (environment.useBackend) {
        if (esNueva) {
          await firstValueFrom(this.usuariosApi.crearTareaUnica(userId, data as any));
        } else {
          await firstValueFrom(this.usuariosApi.actualizarTareaUnica(userId, id, {
            texto: data.texto,
            completada: data.completada,
            instrucciones: data.instrucciones || '',
            subtareas: data.subtareas || [],
          } as any));
        }
        if (esNueva) this.nuevaTareaTexto = '';
        // Refrescamos lista para reflejar el cambio (no esperamos al polling).
        this.cargarProyectos();
      } else {
        if (esNueva) {
          await addDoc(collection(this.firestore, `usuarios/${userId}/tareas_unicas`), data);
          this.nuevaTareaTexto = '';
        } else {
          const docRef = doc(this.firestore, `usuarios/${userId}/tareas_unicas/${id}`);
          await updateDoc(docRef, {
            texto: data.texto,
            completada: data.completada,
            instrucciones: data.instrucciones || '',
            subtareas: data.subtareas || []
          });
        }
      }
      this.cerrarDetalle();
    } catch (error) {
      console.error('Error al guardar tarea unica', error);
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
    if (!confirm('¿Eliminar este proyecto y todas sus fases?')) return;
    try {
      if (environment.useBackend) {
        await firstValueFrom(this.usuariosApi.borrarTareaUnica(userId, id));
        this.cargarProyectos();
      } else {
        await deleteDoc(doc(this.firestore, `usuarios/${userId}/tareas_unicas/${id}`));
      }
    } catch (e) {
      console.error('[tareas-unicas] error al eliminar', e);
    }
  }

  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  cerrarSesion() {
    localStorage.removeItem('md_sesion_actual');
    this.router.navigate(['/login']);
  }
}