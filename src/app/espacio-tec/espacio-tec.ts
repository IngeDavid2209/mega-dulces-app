import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { Firestore, collection, query, where, onSnapshot, addDoc, doc, setDoc, updateDoc, deleteDoc } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../shared/sidebar/sidebar';
import { normalizarNombre } from '../shared/permisos.util';

interface Subtarea { id: string; texto: string; hecha: boolean; }

/**
 * Espacio TEC — sección colaborativa dentro de la app (privilegio `grupoTec`).
 * Fase 1: Tablero Kanban (tipo Trello) + Ideas/Notas.
 *
 * Firestore:
 *   - tec_tareas: tarjetas del tablero
 *       { titulo, columna, orden, color, asignado, fechaLimite, subtareas[],
 *         creadoPor, creadoPorUid, creadoEn, actualizadoEn }
 *   - tec_notas: ideas/notas { titulo, texto, autor, autorUid, creadoEn, actualizadoEn }
 */
@Component({
  selector: 'app-espacio-tec',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DragDropModule, SidebarComponent],
  templateUrl: './espacio-tec.html',
  styleUrls: ['./espacio-tec.css']
})
export class EspacioTecComponent implements OnInit, OnDestroy {
  currentUser: any = null;
  isMenuOpen = false;
  vista: 'inicio' | 'tablero' | 'conversaciones' | 'equipos' | 'asignar' | 'notas' = 'inicio';

  // ---------------- Tablero Kanban ----------------
  readonly columnas = [
    { id: 'porhacer', nombre: 'Por hacer',   color: '#8B5CF6' },
    { id: 'hoy',      nombre: 'Para hoy',    color: '#3B82F6' },
    { id: 'progreso', nombre: 'En progreso', color: '#F59E0B' },
    { id: 'hecho',    nombre: 'Hecho',       color: '#10B981' },
  ];
  readonly colores = ['#A78BFA', '#34D399', '#FCD34D', '#F472B6', '#60A5FA', '#FB923C', '#E2E8F0'];
  readonly idsColumnas = this.columnas.map(c => c.id);

  /** Tarjetas agrupadas por columna (lo que consume el tablero / CDK). */
  tablero: Record<string, any[]> = { porhacer: [], hoy: [], progreso: [], hecho: [] };
  private radarTareas: (() => void) | null = null;

  // Alta rápida inline por columna
  agregandoEnColumna: string | null = null;
  nuevoCardTexto = '';

  // Modal de detalle de tarjeta
  isCardModalOpen = false;
  tarjeta: any = null;            // copia editable de la tarjeta abierta
  nuevaSubtareaTexto = '';

  // ---------------- Conversaciones ----------------
  posts: any[] = [];
  nuevoPostTexto = '';
  respuestaTexto: Record<string, string> = {};
  private radarPosts: (() => void) | null = null;

  // ---------------- Equipos / Proyectos ----------------
  grupos: any[] = [];
  private radarGrupos: (() => void) | null = null;
  isGrupoModalOpen = false;
  grupoModal: any = null;        // copia editable
  grupoEsNuevo = false;
  nuevoMiembroTexto = '';

  // ---------------- Asignar a Personal (sucursales) ----------------
  readonly sucursales = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD',
    'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
  ];
  usuariosEmpresa: any[] = [];
  /** Usuarios con acceso al Espacio TEC (privilegio grupoTec). */
  miembrosTec: any[] = [];
  private radarUsuarios: (() => void) | null = null;
  sucursalSel = '';
  empleadosSel: string[] = [];
  tareaAsignarTexto = '';
  tareaAsignarHora = '';
  asignando = false;
  /** Tareas que el equipo TEC ha asignado a personal (checklists con origenTec). */
  tecAsignadas: any[] = [];
  private radarAsignadas: (() => void) | null = null;

  // ---------------- Ideas / Notas ----------------
  notas: any[] = [];
  nuevaNotaTitulo = '';
  nuevaNotaTexto = '';
  notaEnEdicionId: string | null = null;
  edicionTitulo = '';
  edicionTexto = '';
  private radarNotas: (() => void) | null = null;

  private firestore = inject(Firestore);
  private router = inject(Router);

  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (!sesion) { this.router.navigate(['/login']); return; }
    this.currentUser = JSON.parse(sesion);
    this.conectar();
  }

  ngOnDestroy() {
    if (this.radarTareas) { this.radarTareas(); this.radarTareas = null; }
    if (this.radarNotas) { this.radarNotas(); this.radarNotas = null; }
    if (this.radarPosts) { this.radarPosts(); this.radarPosts = null; }
    if (this.radarGrupos) { this.radarGrupos(); this.radarGrupos = null; }
    if (this.radarUsuarios) { this.radarUsuarios(); this.radarUsuarios = null; }
    if (this.radarAsignadas) { this.radarAsignadas(); this.radarAsignadas = null; }
  }

  private miUid(): string { return this.currentUser?.uid || this.currentUser?.id || ''; }
  private miNombre(): string { return this.currentUser?.nombre || this.currentUser?.usuario || 'TEC'; }

  private conectar() {
    const tareasRef = collection(this.firestore, 'tec_tareas');
    this.radarTareas = onSnapshot(query(tareasRef), snap => {
      const cards = snap.docs.map(d => this.normalizar({ id: d.id, ...(d.data() as any) }));
      const nuevo: Record<string, any[]> = { porhacer: [], hoy: [], progreso: [], hecho: [] };
      for (const c of cards) {
        const col = nuevo[c.columna] ? c.columna : 'porhacer';
        nuevo[col].push(c);
      }
      for (const k of Object.keys(nuevo)) nuevo[k].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
      this.tablero = nuevo;
    });

    const notasRef = collection(this.firestore, 'tec_notas');
    this.radarNotas = onSnapshot(query(notasRef), snap => {
      this.notas = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => Number(b.creadoEn || 0) - Number(a.creadoEn || 0));
    });

    const postsRef = collection(this.firestore, 'tec_conversaciones');
    this.radarPosts = onSnapshot(query(postsRef), snap => {
      this.posts = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any), respuestas: Array.isArray((d.data() as any).respuestas) ? (d.data() as any).respuestas : [] }))
        .sort((a, b) => Number(b.creadoEn || 0) - Number(a.creadoEn || 0));
    });

    const gruposRef = collection(this.firestore, 'tec_grupos');
    this.radarGrupos = onSnapshot(query(gruposRef), snap => {
      this.grupos = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any), miembros: Array.isArray((d.data() as any).miembros) ? (d.data() as any).miembros : [] }))
        .sort((a, b) => Number(a.creadoEn || 0) - Number(b.creadoEn || 0));
    });

    // Personal de la empresa (para asignar tareas por sucursal).
    const usuariosRef = collection(this.firestore, 'usuarios');
    this.radarUsuarios = onSnapshot(query(usuariosRef), snap => {
      const todos = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      this.usuariosEmpresa = todos.filter(u => u.rol === 'trabajador' && !u.grupoTec);
      this.miembrosTec = todos
        .filter(u => u.grupoTec === true)
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    });

    // Tareas asignadas por el TEC a personal (para el resumen).
    const chkRef = collection(this.firestore, 'checklists');
    this.radarAsignadas = onSnapshot(query(chkRef, where('origenTec', '==', true)), snap => {
      this.tecAsignadas = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    }, err => console.error('[tec] asignadas', err));
  }

  // ===================== RESUMEN (Inicio) =====================
  get resumenColumnas() {
    return this.columnas.map(c => ({ ...c, n: (this.tablero[c.id] || []).length }));
  }
  get totalTarjetas(): number { return this.columnas.reduce((s, c) => s + (this.tablero[c.id] || []).length, 0); }
  get ultimasConversaciones(): any[] { return this.posts.slice(0, 3); }
  get ultimasNotas(): any[] { return this.notas.slice(0, 3); }

  /** Tareas TEC asignadas HOY, agrupadas por sucursal. */
  get asignadasHoyPorSucursal(): { store: string; n: number }[] {
    const hoy = this.hoyISO();
    const mapa: Record<string, number> = {};
    for (const t of this.tecAsignadas) {
      if (t.date !== hoy) continue;
      const s = t.store || 'Sin sucursal';
      mapa[s] = (mapa[s] || 0) + 1;
    }
    return Object.keys(mapa).map(store => ({ store, n: mapa[store] })).sort((a, b) => b.n - a.n);
  }
  get totalAsignadasHoy(): number { return this.asignadasHoyPorSucursal.reduce((s, x) => s + x.n, 0); }

  /** Tarjetas del tablero asignadas al usuario actual y aún no terminadas. */
  get misTarjetas(): any[] {
    const mi = normalizarNombre(this.miNombre());
    if (!mi) return [];
    const out: any[] = [];
    for (const col of this.columnas) {
      if (col.id === 'hecho') continue;
      for (const c of (this.tablero[col.id] || [])) {
        if (c.asignado && normalizarNombre(c.asignado) === mi) {
          out.push({ ...c, columnaNombre: col.nombre, columnaColor: col.color });
        }
      }
    }
    return out;
  }

  /** Saludo según la hora. */
  get saludo(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }
  get miPrimerNombre(): string { return (this.miNombre() || '').split(' ')[0]; }

  /** Acceso rápido: abre una sección (y opcionalmente prepara algo). */
  irA(v: 'tablero' | 'conversaciones' | 'asignar' | 'notas') { this.vista = v; }

  get equipos() { return this.grupos.filter(g => g.tipo === 'equipo'); }
  get proyectos() { return this.grupos.filter(g => g.tipo === 'proyecto'); }

  /** Tolera tarjetas viejas (modelo simple texto/completada). */
  private normalizar(c: any): any {
    return {
      ...c,
      titulo: c.titulo || c.texto || '(sin título)',
      columna: c.columna || (c.completada ? 'hecho' : 'porhacer'),
      orden: typeof c.orden === 'number' ? c.orden : 0,
      color: c.color || '#E2E8F0',
      subtareas: Array.isArray(c.subtareas) ? c.subtareas : [],
    };
  }

  cambiarVista(v: 'inicio' | 'tablero' | 'conversaciones' | 'equipos' | 'asignar' | 'notas') { this.vista = v; }

  // ===================== KANBAN =====================
  nombreColumna(id: string): string { return this.columnas.find(c => c.id === id)?.nombre || id; }

  progresoSub(c: any): { hechas: number; total: number } {
    const total = (c.subtareas || []).length;
    const hechas = (c.subtareas || []).filter((s: Subtarea) => s.hecha).length;
    return { hechas, total };
  }

  async agregarCard(colId: string) {
    const titulo = this.nuevoCardTexto.trim();
    if (!titulo) { this.agregandoEnColumna = null; return; }
    const orden = (this.tablero[colId]?.length || 0);
    try {
      await addDoc(collection(this.firestore, 'tec_tareas'), {
        titulo, columna: colId, orden,
        color: '#E2E8F0', asignado: '', fechaLimite: '',
        subtareas: [],
        creadoPor: this.miNombre(), creadoPorUid: this.miUid(),
        creadoEn: Date.now(), actualizadoEn: Date.now()
      });
      this.nuevoCardTexto = '';
      this.agregandoEnColumna = null;
    } catch (e) {
      console.error('[tec] agregarCard', e);
      Swal.fire({ icon: 'error', title: 'No se pudo agregar', confirmButtonColor: '#0F172A' });
    }
  }

  /** Drop de CDK: mueve dentro o entre columnas y persiste el orden. */
  async soltarTarjeta(event: CdkDragDrop<any[]>, colDestinoId: string) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      await this.persistirColumna(colDestinoId);
    } else {
      const colOrigenId = event.previousContainer.id;
      transferArrayItem(event.previousContainer.data, event.container.data, event.previousIndex, event.currentIndex);
      await Promise.all([this.persistirColumna(colOrigenId), this.persistirColumna(colDestinoId)]);
    }
  }

  /** Reescribe columna + orden de todas las tarjetas de una columna. */
  private async persistirColumna(colId: string) {
    const lista = this.tablero[colId] || [];
    await Promise.all(lista.map((c, i) => {
      c.columna = colId; c.orden = i;
      return updateDoc(doc(this.firestore, 'tec_tareas', c.id), { columna: colId, orden: i, actualizadoEn: Date.now() })
        .catch(e => console.error('[tec] persistir', e));
    }));
  }

  // ---- Modal de tarjeta ----
  abrirTarjeta(c: any) {
    // Copia editable (para no mutar el tablero hasta guardar)
    this.tarjeta = { ...c, subtareas: (c.subtareas || []).map((s: Subtarea) => ({ ...s })) };
    this.nuevaSubtareaTexto = '';
    this.isCardModalOpen = true;
  }
  cerrarTarjeta() { this.isCardModalOpen = false; this.tarjeta = null; }

  elegirColor(color: string) { if (this.tarjeta) this.tarjeta.color = color; }

  agregarSubtareaModal() {
    const t = this.nuevaSubtareaTexto.trim();
    if (!t || !this.tarjeta) return;
    this.tarjeta.subtareas = [...(this.tarjeta.subtareas || []), { id: 's_' + Date.now() + Math.random().toString(36).slice(2, 5), texto: t, hecha: false }];
    this.nuevaSubtareaTexto = '';
  }
  toggleSubtareaModal(s: Subtarea) { s.hecha = !s.hecha; }
  eliminarSubtareaModal(s: Subtarea) { this.tarjeta.subtareas = this.tarjeta.subtareas.filter((x: Subtarea) => x.id !== s.id); }

  async guardarTarjeta() {
    if (!this.tarjeta) return;
    const titulo = (this.tarjeta.titulo || '').trim();
    if (!titulo) { Swal.fire({ icon: 'info', title: 'Ponle un título a la tarjeta', confirmButtonColor: '#0F172A' }); return; }
    try {
      await updateDoc(doc(this.firestore, 'tec_tareas', this.tarjeta.id), {
        titulo,
        color: this.tarjeta.color || '#E2E8F0',
        asignado: this.tarjeta.asignado || '',
        fechaLimite: this.tarjeta.fechaLimite || '',
        subtareas: this.tarjeta.subtareas || [],
        actualizadoEn: Date.now()
      });
      this.cerrarTarjeta();
    } catch (e) {
      console.error('[tec] guardarTarjeta', e);
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', confirmButtonColor: '#0F172A' });
    }
  }

  async eliminarTarjeta() {
    if (!this.tarjeta) return;
    const r = await Swal.fire({
      title: 'Eliminar tarjeta', text: '¿Seguro que quieres eliminarla?', icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#DC2626'
    });
    if (!r.isConfirmed) return;
    try {
      await deleteDoc(doc(this.firestore, 'tec_tareas', this.tarjeta.id));
      this.cerrarTarjeta();
    } catch (e) { console.error('[tec] eliminarTarjeta', e); }
  }

  // ===================== CONVERSACIONES =====================
  /** ¿Puede borrar este post/respuesta? El autor o un admin. */
  puedeBorrar(autorUid: string | undefined): boolean {
    return autorUid === this.miUid() || this.currentUser?.rol === 'admin';
  }

  async publicarPost() {
    const texto = this.nuevoPostTexto.trim();
    if (!texto) return;
    try {
      await addDoc(collection(this.firestore, 'tec_conversaciones'), {
        texto, autor: this.miNombre(), autorUid: this.miUid(),
        creadoEn: Date.now(), respuestas: []
      });
      this.nuevoPostTexto = '';
    } catch (e) {
      console.error('[tec] publicarPost', e);
      Swal.fire({ icon: 'error', title: 'No se pudo publicar', confirmButtonColor: '#0F172A' });
    }
  }

  async eliminarPost(p: any) {
    if (!this.puedeBorrar(p.autorUid)) return;
    const r = await Swal.fire({
      title: 'Eliminar mensaje', text: '¿Seguro? También se borran sus respuestas.', icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#DC2626'
    });
    if (!r.isConfirmed) return;
    try { await deleteDoc(doc(this.firestore, 'tec_conversaciones', p.id)); }
    catch (e) { console.error('[tec] eliminarPost', e); }
  }

  async responder(p: any) {
    const texto = (this.respuestaTexto[p.id] || '').trim();
    if (!texto) return;
    const resp = {
      id: 'r_' + Date.now() + Math.random().toString(36).slice(2, 5),
      texto, autor: this.miNombre(), autorUid: this.miUid(), creadoEn: Date.now()
    };
    const respuestas = [...(p.respuestas || []), resp];
    try {
      await updateDoc(doc(this.firestore, 'tec_conversaciones', p.id), { respuestas });
      this.respuestaTexto[p.id] = '';
    } catch (e) {
      console.error('[tec] responder', e);
      Swal.fire({ icon: 'error', title: 'No se pudo responder', confirmButtonColor: '#0F172A' });
    }
  }

  async eliminarRespuesta(p: any, r: any) {
    if (!this.puedeBorrar(r.autorUid)) return;
    const respuestas = (p.respuestas || []).filter((x: any) => x.id !== r.id);
    try { await updateDoc(doc(this.firestore, 'tec_conversaciones', p.id), { respuestas }); }
    catch (e) { console.error('[tec] eliminarRespuesta', e); }
  }

  // ===================== EQUIPOS / PROYECTOS =====================
  abrirNuevoGrupo(tipo: 'equipo' | 'proyecto') {
    this.grupoEsNuevo = true;
    this.grupoModal = { tipo, nombre: '', descripcion: '', color: '#60A5FA', miembros: [] };
    this.nuevoMiembroTexto = '';
    this.isGrupoModalOpen = true;
  }

  abrirGrupo(g: any) {
    this.grupoEsNuevo = false;
    this.grupoModal = { ...g, miembros: [...(g.miembros || [])] };
    this.nuevoMiembroTexto = '';
    this.isGrupoModalOpen = true;
  }

  cerrarGrupo() { this.isGrupoModalOpen = false; this.grupoModal = null; }

  elegirColorGrupo(color: string) { if (this.grupoModal) this.grupoModal.color = color; }

  agregarMiembro() {
    const m = this.nuevoMiembroTexto.trim();
    if (!m || !this.grupoModal) return;
    if (!this.grupoModal.miembros.includes(m)) this.grupoModal.miembros = [...this.grupoModal.miembros, m];
    this.nuevoMiembroTexto = '';
  }
  quitarMiembro(m: string) {
    if (!this.grupoModal) return;
    this.grupoModal.miembros = this.grupoModal.miembros.filter((x: string) => x !== m);
  }

  /** ¿El miembro (por nombre) ya está en el grupo abierto? */
  esMiembroDeGrupo(nombre: string): boolean {
    return !!this.grupoModal && (this.grupoModal.miembros || []).includes(nombre);
  }
  /** Alterna a un miembro del TEC dentro del grupo abierto. */
  toggleMiembro(nombre: string) {
    if (!this.grupoModal) return;
    if (this.esMiembroDeGrupo(nombre)) this.quitarMiembro(nombre);
    else this.grupoModal.miembros = [...this.grupoModal.miembros, nombre];
  }

  async guardarGrupo() {
    if (!this.grupoModal) return;
    const nombre = (this.grupoModal.nombre || '').trim();
    if (!nombre) { Swal.fire({ icon: 'info', title: 'Ponle un nombre', confirmButtonColor: '#0F172A' }); return; }
    try {
      if (this.grupoEsNuevo) {
        await addDoc(collection(this.firestore, 'tec_grupos'), {
          tipo: this.grupoModal.tipo, nombre,
          descripcion: (this.grupoModal.descripcion || '').trim(),
          color: this.grupoModal.color || '#60A5FA',
          miembros: this.grupoModal.miembros || [],
          creadoPor: this.miNombre(), creadoPorUid: this.miUid(),
          creadoEn: Date.now(), actualizadoEn: Date.now()
        });
      } else {
        await updateDoc(doc(this.firestore, 'tec_grupos', this.grupoModal.id), {
          nombre,
          descripcion: (this.grupoModal.descripcion || '').trim(),
          color: this.grupoModal.color || '#60A5FA',
          miembros: this.grupoModal.miembros || [],
          actualizadoEn: Date.now()
        });
      }
      this.cerrarGrupo();
    } catch (e) {
      console.error('[tec] guardarGrupo', e);
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', confirmButtonColor: '#0F172A' });
    }
  }

  async eliminarGrupo() {
    if (!this.grupoModal || this.grupoEsNuevo) return;
    const r = await Swal.fire({
      title: 'Eliminar', text: `¿Eliminar "${this.grupoModal.nombre}"?`, icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#DC2626'
    });
    if (!r.isConfirmed) return;
    try { await deleteDoc(doc(this.firestore, 'tec_grupos', this.grupoModal.id)); this.cerrarGrupo(); }
    catch (e) { console.error('[tec] eliminarGrupo', e); }
  }

  /** Primeros N miembros para mostrar avatares; el resto como "+N". */
  miembrosVisibles(g: any, max = 5): string[] { return (g.miembros || []).slice(0, max); }
  miembrosExtra(g: any, max = 5): number { return Math.max(0, (g.miembros || []).length - max); }

  // ===================== ASIGNAR A PERSONAL (sucursales) =====================
  /** Empleados de la empresa que pertenecen a la sucursal seleccionada. */
  get empleadosDeSucursal(): any[] {
    if (!this.sucursalSel) return [];
    const objetivo = normalizarNombre(this.sucursalSel);
    const comodin = normalizarNombre('General (Acceso Total)');
    return this.usuariosEmpresa
      .filter(u => {
        const sucs: string[] = (u.sucursales && u.sucursales.length) ? u.sucursales : (u.sucursal ? [u.sucursal] : []);
        return sucs.some(s => { const n = normalizarNombre(s); return n === objetivo || n === comodin; });
      })
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  }

  cambiarSucursalAsignar(suc: string) { this.sucursalSel = suc; this.empleadosSel = []; }

  toggleEmpleadoSel(nombre: string) {
    const i = this.empleadosSel.indexOf(nombre);
    if (i > -1) this.empleadosSel.splice(i, 1); else this.empleadosSel.push(nombre);
  }
  estaSeleccionado(nombre: string): boolean { return this.empleadosSel.includes(nombre); }

  seleccionarTodosEmpleados() {
    const todos = this.empleadosDeSucursal.map(e => e.nombre);
    this.empleadosSel = this.empleadosSel.length === todos.length ? [] : [...todos];
  }

  private hoyISO(): string {
    const d = new Date();
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().split('T')[0];
  }

  /** Crea una tarea (checklist) para cada empleado seleccionado; aparece en su Checklist normal. */
  async asignarTareaSucursal() {
    const texto = this.tareaAsignarTexto.trim();
    if (!this.sucursalSel) { Swal.fire({ icon: 'info', title: 'Elige una sucursal', confirmButtonColor: '#0F172A' }); return; }
    if (!texto) { Swal.fire({ icon: 'info', title: 'Escribe la tarea', confirmButtonColor: '#0F172A' }); return; }
    if (this.empleadosSel.length === 0) { Swal.fire({ icon: 'info', title: 'Selecciona al menos un empleado', confirmButtonColor: '#0F172A' }); return; }

    this.asignando = true;
    const hoy = this.hoyISO();
    try {
      await Promise.all(this.empleadosSel.map((nombre, i) => {
        const id = `tec_${normalizarNombre(nombre).replace(/\s+/g, '_')}_${Date.now()}_${i}`;
        const checklist: any = {
          id, timestampCreacion: Date.now(),
          name: texto, assigned: nombre, store: this.sucursalSel, date: hoy,
          time: this.tareaAsignarHora || '23:59',
          status: 'pendiente', enviado: false,
          createdBy: this.miNombre(), origenTec: true, notaEmpleado: '',
          items: [{
            id: Date.now() + i, text: texto,
            requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
            permiteGaleria: false, permiteDocumentos: false, checked: false,
            photo: null, photoTime: null, photoAntes: null, photoAntesTime: null,
            photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null, photos: [],
            tipo: 'manual', horaInicio: null, horaLimite: this.tareaAsignarHora || null, frecuencia: null
          }]
        };
        return setDoc(doc(this.firestore, 'checklists', id), checklist);
      }));
      const n = this.empleadosSel.length;
      this.tareaAsignarTexto = ''; this.tareaAsignarHora = ''; this.empleadosSel = [];
      Swal.fire({ icon: 'success', title: 'Tarea asignada', text: `Se asignó a ${n} ${n === 1 ? 'persona' : 'personas'} de ${this.sucursalSel}.`, confirmButtonColor: '#0F172A' });
    } catch (e) {
      console.error('[tec] asignarTareaSucursal', e);
      Swal.fire({ icon: 'error', title: 'No se pudo asignar', confirmButtonColor: '#0F172A' });
    } finally {
      this.asignando = false;
    }
  }

  // ===================== NOTAS / IDEAS =====================
  async agregarNota() {
    const titulo = this.nuevaNotaTitulo.trim();
    const texto = this.nuevaNotaTexto.trim();
    if (!titulo && !texto) return;
    try {
      await addDoc(collection(this.firestore, 'tec_notas'), {
        titulo: titulo || '(Sin título)', texto,
        autor: this.miNombre(), autorUid: this.miUid(),
        creadoEn: Date.now(), actualizadoEn: Date.now()
      });
      this.nuevaNotaTitulo = ''; this.nuevaNotaTexto = '';
    } catch (e) {
      console.error('[tec] agregarNota', e);
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', confirmButtonColor: '#0F172A' });
    }
  }
  empezarEdicionNota(n: any) { this.notaEnEdicionId = n.id; this.edicionTitulo = n.titulo || ''; this.edicionTexto = n.texto || ''; }
  cancelarEdicionNota() { this.notaEnEdicionId = null; this.edicionTitulo = ''; this.edicionTexto = ''; }
  async guardarEdicionNota(n: any) {
    try {
      await updateDoc(doc(this.firestore, 'tec_notas', n.id), {
        titulo: this.edicionTitulo.trim() || '(Sin título)', texto: this.edicionTexto.trim(), actualizadoEn: Date.now()
      });
      this.cancelarEdicionNota();
    } catch (e) { console.error('[tec] guardarEdicionNota', e); }
  }
  async eliminarNota(n: any) {
    const r = await Swal.fire({
      title: 'Eliminar nota', text: '¿Seguro?', icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#DC2626'
    });
    if (!r.isConfirmed) return;
    try { await deleteDoc(doc(this.firestore, 'tec_notas', n.id)); } catch (e) { console.error('[tec] eliminarNota', e); }
  }

  // ===================== UTIL =====================
  inicial(nombre: string | undefined): string { return (nombre || '?').trim().charAt(0).toUpperCase(); }

  formatearFecha(ts: number | undefined): string {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  }
  formatearDia(iso: string | undefined): string {
    if (!iso) return '';
    try { return new Date(iso + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }); }
    catch { return iso; }
  }
}
