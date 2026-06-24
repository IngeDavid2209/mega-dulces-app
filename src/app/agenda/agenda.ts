import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, getDocs, getDoc, setDoc, where } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

import { SidebarComponent } from '../shared/sidebar/sidebar';
import { esAdmin, esAdminGlobal, sucursalesPermitidas, normalizarNombre } from '../shared/permisos.util';
import { detectarRecomendaciones, Recomendacion } from '../shared/recomendaciones-rutinas.util';

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
  nuevaPrioridad: string = 'media';   // selector rápido junto al input
  nuevaFrecuencia: string = 'unica';
  tareasPersonales: any[] = [];

  // ----- Recomendaciones (solo admin, por sucursal habilitada) -----
  esAdminUsuario = false;
  recomendaciones: Recomendacion[] = [];
  analizandoReco = false;
  yaAnalizado = false;
  private recoHabilitadas: string[] = [];
  private recoDescartadas: string[] = [];
  
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

      this.esAdminUsuario = esAdmin(this.currentUser);
      if (this.currentUser?.rol === 'admin') {
        this.cargarListaPersonal();
      }
      if (this.esAdminUsuario) this.analizarRecomendaciones();

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
      })).sort((a: any, b: any) => {
        // Las que tienen fecha van primero, en orden cronológico (lo más próximo
        // arriba); las sin fecha después, por fecha de creación (más reciente).
        if (a.fecha && b.fecha) return a.fecha.localeCompare(b.fecha);
        if (a.fecha && !b.fecha) return -1;
        if (!a.fecha && b.fecha) return 1;
        return (b.fechaCreacion || 0) - (a.fechaCreacion || 0);
      });
    });
  }

  // ➕ Alta rápida: crea la tarea directo con la prioridad/frecuencia elegidas.
  //    (Para detalles —fecha, notas, adjunto— se toca la tarea y se abre el modal.)
  async agregarTarea() {
    const texto = this.nuevaTareaTexto.trim();
    if (!texto) return;
    const userId = this.usuarioSeleccionado || this.miPropioId();
    if (!userId) return;
    try {
      await addDoc(collection(this.firestore, `usuarios/${userId}/agenda`), {
        texto, completada: false, fechaCreacion: Date.now(), fecha: '',
        prioridad: this.nuevaPrioridad, frecuencia: this.nuevaFrecuencia,
        instrucciones: '', comentarios: '', adjunto: null
      });
      this.nuevaTareaTexto = '';
    } catch (error) {
      console.error('Error creando tarea', error);
    }
  }

  // ============================================================================
  // RUTINAS RECOMENDADAS (solo admin, sucursales habilitadas)
  // ============================================================================
  private async cargarConfigReco() {
    try {
      const snap = await getDoc(doc(this.firestore, 'config', 'recomendaciones'));
      const data = snap.exists() ? (snap.data() as any) : {};
      this.recoHabilitadas = data.sucursalesHabilitadas || [];
      this.recoDescartadas = data.descartadas || [];
    } catch (e) { console.error('[agenda reco] config', e); }
  }

  private sucursalesVisiblesReco(): string[] {
    const permitidas = esAdminGlobal(this.currentUser) ? null : sucursalesPermitidas(this.currentUser);
    if (permitidas === null) return [...this.recoHabilitadas];
    const perm = new Set(permitidas.map(s => normalizarNombre(s)));
    return this.recoHabilitadas.filter(s => perm.has(normalizarNombre(s)));
  }

  async analizarRecomendaciones() {
    if (this.analizandoReco) return;
    this.analizandoReco = true;
    try {
      await this.cargarConfigReco();
      const visibles = this.sucursalesVisiblesReco();
      if (visibles.length === 0) { this.recomendaciones = []; this.yaAnalizado = true; return; }
      const visSet = new Set(visibles.map(s => normalizarNombre(s)));

      const hace30 = new Date();
      hace30.setDate(hace30.getDate() - 30);
      const off = hace30.getTimezoneOffset() * 60000;
      const desde = new Date(hace30.getTime() - off).toISOString().split('T')[0];

      const snap = await getDocs(query(collection(this.firestore, 'checklists'), where('date', '>=', desde)));
      const checklists: any[] = [];
      snap.forEach(d => { const c = d.data() as any; if (c.store && visSet.has(normalizarNombre(c.store))) checklists.push(c); });

      // Catálogo (para excluir lo ya configurado).
      const catSnap = await getDocs(collection(this.firestore, 'catalogo_rutinas'));
      const catalogo: any[] = [];
      catSnap.forEach(d => catalogo.push({ ...(d.data() as any), id: d.id }));

      this.recomendaciones = detectarRecomendaciones({
        checklists, catalogo, descartadas: this.recoDescartadas, diasVentana: 30
      }).slice(0, 8);
      this.yaAnalizado = true;
    } catch (e) {
      console.error('[agenda reco] analizar', e);
    } finally {
      this.analizandoReco = false;
    }
  }

  private frecRecoAAgenda(f: string): string {
    if (f === 'Diaria') return 'diaria';
    if (f === 'Semanal') return 'semanal';
    return 'unica';
  }

  /** Botón "A mi agenda": agrega la recomendación como tarea propia (1 clic). */
  async agregarRecoAMiAgenda(r: Recomendacion) {
    const userId = this.miPropioId();
    if (!userId) return;
    try {
      await addDoc(collection(this.firestore, `usuarios/${userId}/agenda`), {
        texto: r.nombre, completada: false, fechaCreacion: Date.now(), fecha: '',
        prioridad: 'media', frecuencia: this.frecRecoAAgenda(r.frecuencia),
        instrucciones: '', comentarios: '', adjunto: null
      });
      this.recomendaciones = this.recomendaciones.filter(x => x.clave !== r.clave);
    } catch (e) { console.error('[agenda reco] a mi agenda', e); }
  }

  /** Botón "Crear rutina": la vuelve rutina maestra del catálogo. */
  async crearRutinaDeReco(r: Recomendacion) {
    const yo = this.currentUser?.nombre || this.currentUser?.usuario || 'desconocido';
    const ahora = Date.now();
    const id = 'rutina_' + ahora;
    try {
      await setDoc(doc(this.firestore, 'catalogo_rutinas', id), {
        id, nombre: r.nombre, tipo: 'operacion', descripcion: 'Sugerida por patrón de uso.',
        frecuencia: r.frecuencia, horaInicio: '', horaLimite: '',
        responsableSugerido: 'Encargado', nivelCritico: 'importante',
        tareas: [{ id: 'ti_' + ahora, text: r.nombre, requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false }],
        activa: true, creadoPor: yo, creadoEn: ahora
      });
      this.recomendaciones = this.recomendaciones.filter(x => x.clave !== r.clave);
    } catch (e) { console.error('[agenda reco] crear rutina', e); }
  }

  async descartarReco(r: Recomendacion) {
    const nuevas = Array.from(new Set([...this.recoDescartadas, r.clave]));
    try {
      await setDoc(doc(this.firestore, 'config', 'recomendaciones'), { descartadas: nuevas }, { merge: true });
      this.recoDescartadas = nuevas;
      this.recomendaciones = this.recomendaciones.filter(x => x.clave !== r.clave);
    } catch (e) { console.error('[agenda reco] descartar', e); }
  }

  /** Fecha de hoy legible para la barra superior. */
  get fechaHoyTexto(): string {
    return new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  // ----- Listas separadas + contadores -----
  get pendientes(): any[] { return this.tareasPersonales.filter(t => !t.completada); }
  get completadas(): any[] { return this.tareasPersonales.filter(t => t.completada); }

  readonly prioridades = [
    { v: 'alta', t: 'Alta' }, { v: 'media', t: 'Media' }, { v: 'baja', t: 'Baja' }
  ];
  readonly frecuencias = [
    { v: 'unica', t: 'Única' }, { v: 'diaria', t: 'Diaria' }, { v: 'semanal', t: 'Semanal' }
  ];
  etiquetaPrioridad(p: string): string { return this.prioridades.find(x => x.v === p)?.t || ''; }
  etiquetaFrecuencia(f: string): string { return this.frecuencias.find(x => x.v === f)?.t || ''; }

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
          fecha: this.tareaActiva.fecha || '',
          prioridad: this.tareaActiva.prioridad || 'media',
          frecuencia: this.tareaActiva.frecuencia || 'unica',
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

  // 📅 Helpers de fecha de actividad
  private hoyISO(): string {
    const d = new Date();
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().split('T')[0];
  }
  formatearFecha(iso: string | undefined): string {
    if (!iso) return '';
    try { return new Date(iso + 'T00:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' }); }
    catch { return iso; }
  }
  esHoy(iso: string | undefined): boolean { return !!iso && iso === this.hoyISO(); }
  estaVencida(t: any): boolean { return !!t?.fecha && !t?.completada && t.fecha < this.hoyISO(); }

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