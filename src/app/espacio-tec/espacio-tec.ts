import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { Firestore, addDoc, doc, getDoc, setDoc, updateDoc, deleteDoc } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../shared/sidebar/sidebar';
import { normalizarNombre } from '../shared/permisos.util';
import { NotificacionesService } from '../services/notificaciones';
import { ApiService } from '../shared/api.service';
import { obtenerSemanaISO } from '../shared/descansos.util';
import { resolverAsignadoTarea, mapaNombreAUid } from '../shared/reasignacion-turnos.util';
import { ConfigTurnos } from '../shared/turnos.util';

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
  // Kanban: migrado a Postgres (API). Poll ligero.
  private tareasPoll: any = null;

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
  postEnEdicion: string | null = null;
  postEdicionTexto = '';
  respEnEdicion: string | null = null;
  respEdicionTexto = '';
  // Conversaciones: migradas a Postgres (API). Poll ligero.
  private postsPoll: any = null;

  // ---------------- Equipos / Proyectos ----------------
  grupos: any[] = [];
  // Equipos/Proyectos: migrados a Postgres (API). Poll ligero.
  private gruposPoll: any = null;
  isGrupoModalOpen = false;
  grupoModal: any = null;        // copia editable
  grupoEsNuevo = false;
  nuevoMiembroTexto = '';

  // ---------------- Asignar a Personal (sucursales) ----------------
  readonly sucursales = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD',
    'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO', 'CEDIS'
  ];
  usuariosEmpresa: any[] = [];
  /** Usuarios con acceso al Espacio TEC (privilegio grupoTec). */
  miembrosTec: any[] = [];
  private usuariosPoll: any = null; // FERROCARRIL: poll de usuarios desde Postgres
  sucursalSel = '';
  empleadosSel: string[] = [];
  tareaAsignarTexto = '';
  // Hora real de la tarea: inicio y finalización (ambas opcionales). La de fin
  // funciona además como hora límite del checklist.
  tareaAsignarHoraInicio = '';
  tareaAsignarHoraFin = '';
  tareaAsignarFecha = '';   // fecha de la tarea (YYYY-MM-DD); vacío = hoy. Puede ser pasada.
  // Rango inicio–fin (solo "única", informativo): la tarea cae en fechaInicio.
  tareaAsignarUsarFechas = false;
  tareaAsignarFechaInicio = '';
  tareaAsignarFechaFin = '';
  asignando = false;
  // Frecuencia de la tarea asignada: 'unica' = solo hoy; o recurrente.
  tareaAsignarFrecuencia: 'unica' | 'Diaria' | 'Semanal' | 'Mensual' | 'Anual' = 'unica';
  tareaAsignarDiaSemana = 1;   // 0=Domingo .. 6=Sabado
  tareaAsignarDiaMes = 1;      // 1..31
  tareaAsignarFechaAnual = ''; // 'YYYY-MM-DD' (se guarda MM-DD)
  readonly diasSemanaOpc = [
    { v: 1, t: 'Lunes' }, { v: 2, t: 'Martes' }, { v: 3, t: 'Miercoles' },
    { v: 4, t: 'Jueves' }, { v: 5, t: 'Viernes' }, { v: 6, t: 'Sabado' }, { v: 0, t: 'Domingo' }
  ];
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
  // Notas: migradas a Postgres (API). Ya no usan Firestore en vivo; se refrescan
  // con un poll ligero + tras cada cambio.
  private notasPoll: any = null;

  private firestore = inject(Firestore);
  private router = inject(Router);
  private noti = inject(NotificacionesService);
  private api = inject(ApiService);

  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (!sesion) { this.router.navigate(['/login']); return; }
    this.currentUser = JSON.parse(sesion);
    this.conectar();
  }

  ngOnDestroy() {
    if (this.tareasPoll) { clearInterval(this.tareasPoll); this.tareasPoll = null; }
    if (this.notasPoll) { clearInterval(this.notasPoll); this.notasPoll = null; }
    if (this.postsPoll) { clearInterval(this.postsPoll); this.postsPoll = null; }
    if (this.gruposPoll) { clearInterval(this.gruposPoll); this.gruposPoll = null; }
    if (this.usuariosPoll) { clearInterval(this.usuariosPoll); this.usuariosPoll = null; }
    if (this.radarAsignadas) { this.radarAsignadas(); this.radarAsignadas = null; }
  }

  private miUid(): string { return this.currentUser?.uid || this.currentUser?.id || ''; }
  private miNombre(): string { return this.currentUser?.nombre || this.currentUser?.usuario || 'TEC'; }

  private conectar() {
    // Kanban: ahora en Postgres (API). Carga + poll.
    this.cargarTareas();
    this.tareasPoll = setInterval(() => this.cargarTareas(), 30000);

    // Notas: ahora viven en Postgres (API). Cargamos y refrescamos por poll.
    this.cargarNotas();
    this.notasPoll = setInterval(() => this.cargarNotas(), 30000);

    // Conversaciones: ahora en Postgres (API). Carga + poll.
    this.cargarPosts();
    this.postsPoll = setInterval(() => this.cargarPosts(), 30000);

    // Equipos/Proyectos: ahora en Postgres (API). Carga + poll.
    this.cargarGrupos();
    this.gruposPoll = setInterval(() => this.cargarGrupos(), 30000);

    // Personal de la empresa (FERROCARRIL: desde Postgres, poll cada 30s).
    this.cargarUsuariosTec();
    this.usuariosPoll = setInterval(() => this.cargarUsuariosTec(), 30000);

    // Tareas asignadas por el TEC a personal (para el resumen).
    // FERROCARRIL Etapa 3: tareas origenTec desde Postgres (poll; antes onSnapshot).
    const recargarAsignadas = async () => {
      const resp = await this.api.get('/api/checklists?origenTec=true')
        .catch((e: any) => { console.error('[tec] asignadas', e); return null; });
      if (!resp) return;
      this.tecAsignadas = resp.checklists || [];
    };
    recargarAsignadas();
    const idAsignadas = setInterval(recargarAsignadas, 20000);
    this.radarAsignadas = () => clearInterval(idAsignadas);
  }

  /** FERROCARRIL: personal de la empresa desde Postgres (reemplaza el onSnapshot). */
  private async cargarUsuariosTec() {
    try {
      const r = await this.api.get('/api/usuarios');
      const todos = (r.usuarios || []).map((u: any) => ({ id: u.id || u.uid, ...u }));
      this.usuariosEmpresa = todos.filter((u: any) => (u.rol === 'trabajador' || u.rol === 'admin') && !u.grupoTec);
      this.miembrosTec = todos
        .filter((u: any) => u.grupoTec === true)
        .sort((a: any, b: any) => (a.nombre || '').localeCompare(b.nombre || ''));
    } catch (e) { console.error('[tec] cargarUsuariosTec', e); }
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
      fechaInicio: c.fechaInicio || '',
      fechaFin: c.fechaFin || '',
      usarFechas: !!c.usarFechas,
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
  /** Porcentaje de fases/pasos cumplidos de una tarjeta. */
  progresoPct(c: any): number {
    const { hechas, total } = this.progresoSub(c);
    return total ? Math.round((hechas / total) * 100) : 0;
  }

  /** Carga las tarjetas del Kanban desde /api/tec-tareas y arma el tablero. */
  async cargarTareas() {
    try {
      const r = await this.api.get('/api/tec-tareas');
      const cards = (r.tareas || []).map((c: any) => this.normalizar(c));
      const nuevo: Record<string, any[]> = { porhacer: [], hoy: [], progreso: [], hecho: [] };
      for (const c of cards) {
        const col = nuevo[c.columna] ? c.columna : 'porhacer';
        nuevo[col].push(c);
      }
      for (const k of Object.keys(nuevo)) nuevo[k].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
      this.tablero = nuevo;
    } catch (e) {
      console.error('[tec] cargarTareas', e);
    }
  }

  async agregarCard(colId: string) {
    const titulo = this.nuevoCardTexto.trim();
    if (!titulo) { this.agregandoEnColumna = null; return; }
    const orden = (this.tablero[colId]?.length || 0);
    try {
      await this.api.post('/api/tec-tareas', {
        titulo, columna: colId, orden,
        color: '#E2E8F0', asignado: '', fechaLimite: '',
        fechaInicio: '', fechaFin: '', usarFechas: false,
        subtareas: [],
        creadoPor: this.miNombre(), creadoPorUid: this.miUid(),
        creadoEn: Date.now(), actualizadoEn: Date.now()
      });
      this.nuevoCardTexto = '';
      this.agregandoEnColumna = null;
      await this.cargarTareas();
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

  /** Reescribe columna + orden de todas las tarjetas de una columna (vía API). */
  private async persistirColumna(colId: string) {
    const lista = this.tablero[colId] || [];
    await Promise.all(lista.map((c, i) => {
      c.columna = colId; c.orden = i; c.actualizadoEn = Date.now();
      // Se envía la tarjeta completa (el upsert sobrescribe el documento).
      return this.api.post('/api/tec-tareas', c).catch(e => console.error('[tec] persistir', e));
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
      // Se envía la tarjeta completa (conserva columna/orden/creadoEn) con los cambios.
      await this.api.post('/api/tec-tareas', {
        ...this.tarjeta,
        titulo,
        color: this.tarjeta.color || '#E2E8F0',
        asignado: this.tarjeta.asignado || '',
        fechaLimite: this.tarjeta.fechaLimite || '',
        usarFechas: !!this.tarjeta.usarFechas,
        fechaInicio: this.tarjeta.usarFechas ? (this.tarjeta.fechaInicio || '') : '',
        fechaFin: this.tarjeta.usarFechas ? (this.tarjeta.fechaFin || '') : '',
        subtareas: this.tarjeta.subtareas || [],
        actualizadoEn: Date.now()
      });
      this.cerrarTarjeta();
      await this.cargarTareas();
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
      await this.api.del('/api/tec-tareas?id=' + encodeURIComponent(this.tarjeta.id));
      this.cerrarTarjeta();
      await this.cargarTareas();
    } catch (e) { console.error('[tec] eliminarTarjeta', e); }
  }

  // ===================== CONVERSACIONES =====================
  /** ¿Puede borrar este post/respuesta? El autor o un admin. */
  puedeBorrar(autorUid: string | undefined): boolean {
    return autorUid === this.miUid() || this.currentUser?.rol === 'admin';
  }

  /** Carga los mensajes desde /api/tec-conversaciones (Postgres). */
  async cargarPosts() {
    try {
      const r = await this.api.get('/api/tec-conversaciones');
      this.posts = (r.posts || []).map((p: any) => ({ ...p, respuestas: Array.isArray(p.respuestas) ? p.respuestas : [] }));
    } catch (e) {
      console.error('[tec] cargarPosts', e);
    }
  }

  async publicarPost() {
    const texto = this.nuevoPostTexto.trim();
    if (!texto) return;
    try {
      await this.api.post('/api/tec-conversaciones', { texto, autor: this.miNombre() });
      // Aviso push a los demás del grupo TEC (el emisor se excluye en el server).
      this.noti.enviar({
        titulo: `Nuevo mensaje de ${this.miNombre()}`,
        cuerpo: texto,
        url: '/tec',
        grupoTec: true
      });
      this.nuevoPostTexto = '';
      await this.cargarPosts();
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
    try {
      await this.api.del('/api/tec-conversaciones?id=' + encodeURIComponent(p.id));
      await this.cargarPosts();
    } catch (e) { console.error('[tec] eliminarPost', e); }
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
      await this.api.patch('/api/tec-conversaciones', { id: p.id, respuestas });
      this.respuestaTexto[p.id] = '';
      // Aviso al autor del mensaje y a quienes ya habian respondido (el emisor
      // se excluye en el server).
      const uids = [p.autorUid, ...(p.respuestas || []).map((x: any) => x.autorUid)]
        .filter(Boolean);
      this.noti.enviar({
        titulo: `${this.miNombre()} respondió`,
        cuerpo: texto,
        url: '/tec',
        uids: Array.from(new Set(uids))
      });
      await this.cargarPosts();
    } catch (e) {
      console.error('[tec] responder', e);
      Swal.fire({ icon: 'error', title: 'No se pudo responder', confirmButtonColor: '#0F172A' });
    }
  }

  async eliminarRespuesta(p: any, r: any) {
    if (!this.puedeBorrar(r.autorUid)) return;
    const respuestas = (p.respuestas || []).filter((x: any) => x.id !== r.id);
    try {
      await this.api.patch('/api/tec-conversaciones', { id: p.id, respuestas });
      await this.cargarPosts();
    } catch (e) { console.error('[tec] eliminarRespuesta', e); }
  }

  // Editar mensaje
  empezarEdicionPost(p: any) { if (!this.puedeBorrar(p.autorUid)) return; this.postEnEdicion = p.id; this.postEdicionTexto = p.texto || ''; }
  cancelarEdicionPost() { this.postEnEdicion = null; this.postEdicionTexto = ''; }
  async guardarEdicionPost(p: any) {
    const t = this.postEdicionTexto.trim();
    if (!t) return;
    try {
      await this.api.patch('/api/tec-conversaciones', { id: p.id, texto: t });
      this.cancelarEdicionPost();
      await this.cargarPosts();
    } catch (e) { console.error('[tec] editar post', e); }
  }

  // Editar respuesta
  empezarEdicionResp(r: any) { if (!this.puedeBorrar(r.autorUid)) return; this.respEnEdicion = r.id; this.respEdicionTexto = r.texto || ''; }
  cancelarEdicionResp() { this.respEnEdicion = null; this.respEdicionTexto = ''; }
  async guardarEdicionResp(p: any, r: any) {
    const t = this.respEdicionTexto.trim();
    if (!t) return;
    const respuestas = (p.respuestas || []).map((x: any) => x.id === r.id ? { ...x, texto: t, editadoEn: Date.now() } : x);
    try {
      await this.api.patch('/api/tec-conversaciones', { id: p.id, respuestas });
      this.cancelarEdicionResp();
      await this.cargarPosts();
    } catch (e) { console.error('[tec] editar respuesta', e); }
  }

  // ===================== EQUIPOS / PROYECTOS =====================
  nuevaTareaProyectoTexto = '';

  abrirNuevoGrupo(tipo: 'equipo' | 'proyecto') {
    this.grupoEsNuevo = true;
    this.grupoModal = { tipo, nombre: '', descripcion: '', color: '#60A5FA', miembros: [], tareas: [] };
    this.nuevoMiembroTexto = '';
    this.nuevaTareaProyectoTexto = '';
    this.isGrupoModalOpen = true;
  }

  abrirGrupo(g: any) {
    this.grupoEsNuevo = false;
    this.grupoModal = { ...g, miembros: [...(g.miembros || [])], tareas: (g.tareas || []).map((t: any) => ({ ...t })) };
    this.nuevoMiembroTexto = '';
    this.nuevaTareaProyectoTexto = '';
    this.isGrupoModalOpen = true;
  }

  // ---- Editor de tarea de proyecto (formato completo) ----
  tareaProyEditor: any = null;
  tareaProyEsNueva = false;
  nuevaFaseTexto = '';

  private tareaProyVacia() {
    return {
      id: 'pt_' + Date.now() + Math.random().toString(36).slice(2, 5),
      texto: '', hecha: false, observaciones: '',
      fechaInicio: '', fechaFin: '', horaInicio: '', horaFin: '',
      requiereFoto: false, requiereVariasFotos: false, permiteDocs: false,
      tieneFases: false, fases: [] as any[]
    };
  }

  abrirNuevaTareaProyecto() {
    this.tareaProyEsNueva = true;
    this.tareaProyEditor = this.tareaProyVacia();
    this.nuevaFaseTexto = '';
  }
  editarTareaProyecto(t: any) {
    this.tareaProyEsNueva = false;
    this.tareaProyEditor = { ...this.tareaProyVacia(), ...t, fases: (t.fases || []).map((f: any) => ({ ...f })) };
    this.nuevaFaseTexto = '';
  }
  cerrarTareaProyEditor() { this.tareaProyEditor = null; }

  agregarFaseEditor() {
    const t = this.nuevaFaseTexto.trim();
    if (!t || !this.tareaProyEditor) return;
    this.tareaProyEditor.fases = [...(this.tareaProyEditor.fases || []), { id: 'f_' + Date.now() + Math.random().toString(36).slice(2, 5), texto: t, hecha: false }];
    this.nuevaFaseTexto = '';
  }
  quitarFaseEditor(f: any) {
    if (this.tareaProyEditor) this.tareaProyEditor.fases = this.tareaProyEditor.fases.filter((x: any) => x.id !== f.id);
  }

  guardarTareaProyEditor() {
    if (!this.tareaProyEditor || !this.grupoModal) return;
    const nombre = (this.tareaProyEditor.texto || '').trim();
    if (!nombre) { Swal.fire({ icon: 'info', title: 'Ponle nombre a la tarea', confirmButtonColor: '#0F172A' }); return; }
    this.tareaProyEditor.texto = nombre;
    if (!this.tareaProyEditor.tieneFases) this.tareaProyEditor.fases = [];
    const lista = [...(this.grupoModal.tareas || [])];
    const i = lista.findIndex(x => x.id === this.tareaProyEditor.id);
    if (i > -1) lista[i] = this.tareaProyEditor; else lista.push(this.tareaProyEditor);
    this.grupoModal.tareas = lista;
    this.tareaProyEditor = null;
  }
  eliminarTareaProyEditor() {
    if (!this.tareaProyEditor || !this.grupoModal) return;
    this.grupoModal.tareas = (this.grupoModal.tareas || []).filter((x: any) => x.id !== this.tareaProyEditor.id);
    this.tareaProyEditor = null;
  }

  toggleTareaProyecto(t: any) { t.hecha = !t.hecha; }

  /** Fases de una tarea de proyecto: progreso. */
  faseInfo(t: any): { hechas: number; total: number } {
    const total = (t.fases || []).length;
    const hechas = (t.fases || []).filter((f: any) => f.hecha).length;
    return { hechas, total };
  }

  /** Avance de un grupo según sus tareas. */
  progresoGrupo(g: any): { hechas: number; total: number; pct: number } {
    const total = (g.tareas || []).length;
    const hechas = (g.tareas || []).filter((t: any) => t.hecha).length;
    return { hechas, total, pct: total ? Math.round((hechas / total) * 100) : 0 };
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

  /** Carga los grupos (Equipos/Proyectos) desde /api/tec-grupos (Postgres). */
  async cargarGrupos() {
    try {
      const r = await this.api.get('/api/tec-grupos');
      this.grupos = (r.grupos || [])
        .map((g: any) => ({ ...g, miembros: Array.isArray(g.miembros) ? g.miembros : [], tareas: Array.isArray(g.tareas) ? g.tareas : [] }))
        .sort((a: any, b: any) => Number(a.creadoEn || 0) - Number(b.creadoEn || 0));
    } catch (e) {
      console.error('[tec] cargarGrupos', e);
    }
  }

  async guardarGrupo() {
    if (!this.grupoModal) return;
    const nombre = (this.grupoModal.nombre || '').trim();
    if (!nombre) { Swal.fire({ icon: 'info', title: 'Ponle un nombre', confirmButtonColor: '#0F172A' }); return; }
    try {
      const payload: any = {
        tipo: this.grupoModal.tipo, nombre,
        descripcion: (this.grupoModal.descripcion || '').trim(),
        color: this.grupoModal.color || '#60A5FA',
        miembros: this.grupoModal.miembros || [],
        tareas: this.grupoModal.tareas || [],
        actualizadoEn: Date.now()
      };
      if (this.grupoEsNuevo) {
        payload.creadoPor = this.miNombre();
        payload.creadoPorUid = this.miUid();
        payload.creadoEn = Date.now();
      } else {
        payload.id = this.grupoModal.id;
        payload.creadoPor = this.grupoModal.creadoPor;
        payload.creadoPorUid = this.grupoModal.creadoPorUid;
        payload.creadoEn = this.grupoModal.creadoEn;
      }
      await this.api.post('/api/tec-grupos', payload);
      this.cerrarGrupo();
      await this.cargarGrupos();
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
    try {
      await this.api.del('/api/tec-grupos?id=' + encodeURIComponent(this.grupoModal.id));
      this.cerrarGrupo();
      await this.cargarGrupos();
    } catch (e) { console.error('[tec] eliminarGrupo', e); }
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
        // Los admins (encargados) aparecen SOLO si tienen esta sucursal de forma
        // explícita; NO por el comodín 'General (Acceso Total)', para no saturar
        // cada sucursal con la gerencia global. Los trabajadores conservan el comodín.
        if (u.rol === 'admin') return sucs.some(s => normalizarNombre(s) === objetivo);
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

    const frecuencia = this.tareaAsignarFrecuencia;
    const recurrente = frecuencia !== 'unica';
    let fechaAnual: string | null = null;
    if (frecuencia === 'Anual') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(this.tareaAsignarFechaAnual)) {
        Swal.fire({ icon: 'info', title: 'Elige la fecha de la tarea anual', confirmButtonColor: '#0F172A' });
        return;
      }
      fechaAnual = this.tareaAsignarFechaAnual.slice(5); // MM-DD
    }

    // Rango inicio–fin (solo "única"): valida orden si ambas están puestas.
    const usarRango = frecuencia === 'unica' && this.tareaAsignarUsarFechas;
    if (usarRango && this.tareaAsignarFechaInicio && this.tareaAsignarFechaFin
        && this.tareaAsignarFechaFin < this.tareaAsignarFechaInicio) {
      Swal.fire({ icon: 'info', title: 'La fecha de fin no puede ser anterior a la de inicio', confirmButtonColor: '#0F172A' });
      return;
    }

    this.asignando = true;
    const hoy = this.hoyISO();
    const avisosReasig: string[] = [];
    const nombresFinalesTec: string[] = [];
    try {
      if (recurrente) {
        // Recurrente: se guarda una rutina_personal por empleado (con su uid).
        // El checklist del empleado regenera la instancia cuando aplica.
        await Promise.all(this.empleadosSel.map((nombre, i) => {
          const u = this.usuariosEmpresa.find(x => normalizarNombre(x.nombre) === normalizarNombre(nombre));
          const uid = u?.id || u?.uid;
          if (!uid) return Promise.resolve();
          const rid = `rp_tec_${normalizarNombre(nombre).replace(/\s+/g, '_')}_${Date.now()}_${i}`;
          const r: any = {
            id: rid, uid, nombre, texto,
            hora: this.tareaAsignarHoraFin || '', horaInicio: this.tareaAsignarHoraInicio || '',
            sucursal: this.sucursalSel, frecuencia,
            diaSemana: frecuencia === 'Semanal' ? Number(this.tareaAsignarDiaSemana) : null,
            diaMes: frecuencia === 'Mensual' ? Number(this.tareaAsignarDiaMes) : null,
            fechaAnual, actividades: [], activa: true,
            origenTec: true, createdBy: this.miNombre(), creadoEn: Date.now()
          };
          // FERROCARRIL: dual-write de la rutina personal a Postgres (mismo id).
          return setDoc(doc(this.firestore, 'rutinas_personales', rid), r)
            .then(() => this.api.guardar('/api/rutinas-personales', { ...r, id: String(rid) }));
        }));
      } else {
        // Reasignacion por turno/descanso (igual que rutinas): si el elegido no
        // esta disponible para la fecha/hora, la tarea pasa al primer disponible
        // de la sucursal. Precargamos config de turnos + descansos de la semana.
        const fechaTareaStr = usarRango ? (this.tareaAsignarFechaInicio || hoy) : (this.tareaAsignarFecha || hoy);
        const fechaTareaDate = new Date(fechaTareaStr + 'T12:00:00');
        const horaTarea = this.tareaAsignarHoraFin || '23:59';
        let configTurnos: ConfigTurnos | null = null;
        try {
          const ct = await getDoc(doc(this.firestore, 'config', 'turnos'));
          if (ct.exists()) configTurnos = ct.data() as ConfigTurnos;
        } catch { /* sin config -> sin restriccion de turno */ }
        let descansosSemana: any[] = [];
        try {
          const resp = await this.api.get('/api/descansos-semanales?semanaISO=' + encodeURIComponent(obtenerSemanaISO(fechaTareaDate)));
          descansosSemana = resp?.items || [];
        } catch (e) { console.error('[tec] descansos', e); }
        const nombreAUid = mapaNombreAUid(this.usuariosEmpresa);
        const yaUsados = new Set<string>();

        await Promise.all(this.empleadosSel.map((nombre, i) => {
          const resol = resolverAsignadoTarea({
            nombre, sucursal: this.sucursalSel, fecha: fechaTareaDate, hora: horaTarea,
            usuarios: this.usuariosEmpresa, configTurnos, descansosSemana, nombreAUid, yaUsados,
          });
          const asignadoFinal = resol.nombreFinal;
          nombresFinalesTec.push(asignadoFinal);
          if (resol.reasignado) avisosReasig.push(`"${resol.original}" no estaba disponible (turno/descanso); la tarea pasó a "${asignadoFinal}".`);
          else if (resol.sinReemplazo) avisosReasig.push(`"${resol.original}" no está disponible y no hubo reemplazo en ${this.sucursalSel}.`);

          const id = `tec_${normalizarNombre(asignadoFinal).replace(/\s+/g, '_')}_${Date.now()}_${i}`;
          const checklist: any = {
            id, timestampCreacion: Date.now(),
            name: texto, assigned: asignadoFinal, assignedUid: nombreAUid.get(normalizarNombre(asignadoFinal)) || null,
            store: this.sucursalSel,
            date: fechaTareaStr,
            fechaInicio: usarRango ? (this.tareaAsignarFechaInicio || '') : '',
            fechaFin: usarRango ? (this.tareaAsignarFechaFin || '') : '',
            time: this.tareaAsignarHoraFin || '23:59',
            status: 'pendiente', enviado: false,
            createdBy: this.miNombre(), origenTec: true, notaEmpleado: '',
            ...(resol.reasignado ? { reasignadoTurno: true, asignadoOriginal: resol.original } : {}),
            items: [{
              id: Date.now() + i, text: texto,
              requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
              permiteGaleria: false, permiteDocumentos: false, checked: false,
              photo: null, photoTime: null, photoAntes: null, photoAntesTime: null,
              photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null, photos: [],
              tipo: 'manual', horaInicio: this.tareaAsignarHoraInicio || null, horaLimite: this.tareaAsignarHoraFin || null, frecuencia: null
            }]
          };
          // FERROCARRIL Etapa 3: dual-write (Firestore + Postgres, mismo id).
          return setDoc(doc(this.firestore, 'checklists', id), checklist)
            .then(() => this.api.guardarChecklist(checklist));
        }));
      }
      const n = this.empleadosSel.length;
      // Aviso push SOLO a destinatarios que sean de Espacio TEC (los demás no
      // reciben push, como estaban). Nota: "Asignar a personal" apunta a
      // usuariosEmpresa (no-TEC), así que normalmente no se enviará ninguno.
      const nombresParaNoti = nombresFinalesTec.length ? nombresFinalesTec : this.empleadosSel;
      const destinatariosTec = nombresParaNoti.filter(nom =>
        this.miembrosTec.some(m => normalizarNombre(m.nombre) === normalizarNombre(nom)));
      if (destinatariosTec.length) {
        this.noti.enviar({
          titulo: 'Nueva tarea asignada',
          cuerpo: texto,
          url: '/checklist',
          nombres: destinatariosTec
        });
      }
      this.tareaAsignarTexto = ''; this.tareaAsignarHoraInicio = ''; this.tareaAsignarHoraFin = ''; this.empleadosSel = [];
      this.tareaAsignarFrecuencia = 'unica'; this.tareaAsignarFechaAnual = ''; this.tareaAsignarFecha = '';
      this.tareaAsignarUsarFechas = false; this.tareaAsignarFechaInicio = ''; this.tareaAsignarFechaFin = '';
      const detalle = recurrente
        ? `Tarea ${frecuencia.toLowerCase()} asignada a ${n} ${n === 1 ? 'persona' : 'personas'} de ${this.sucursalSel}.`
        : `Se asignó a ${n} ${n === 1 ? 'persona' : 'personas'} de ${this.sucursalSel}.`;
      if (avisosReasig.length) {
        await Swal.fire({
          icon: 'info', title: 'Tarea asignada (con reasignación)',
          html: `${detalle}<ul style="text-align:left;margin:12px 0;padding-left:22px;font-size:13px">` +
            avisosReasig.map(a => `<li>${a}</li>`).join('') + `</ul>`,
          confirmButtonColor: '#0F172A'
        });
      } else {
        Swal.fire({ icon: 'success', title: 'Tarea asignada', text: detalle, confirmButtonColor: '#0F172A' });
      }
    } catch (e) {
      console.error('[tec] asignarTareaSucursal', e);
      Swal.fire({ icon: 'error', title: 'No se pudo asignar', confirmButtonColor: '#0F172A' });
    } finally {
      this.asignando = false;
    }
  }

  // ---- Editar / borrar tareas ya asignadas a personal ----
  asignadaEdit: any = null;

  /** Tareas TEC asignadas, activas (no borradas), de más reciente a más antigua. */
  get asignadasActivas(): any[] {
    return this.tecAsignadas
      .filter(t => !t.eliminado)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }

  abrirEditarAsignada(t: any) {
    const it0 = t.items && t.items[0];
    this.asignadaEdit = {
      id: t.id, name: t.name || '',
      fecha: t.date || this.hoyISO(),
      horaInicio: (it0?.horaInicio) || '',
      horaFin: (it0?.horaLimite) || (t.time && t.time !== '23:59' ? t.time : '') || ''
    };
  }
  cerrarEditarAsignada() { this.asignadaEdit = null; }

  async guardarAsignada() {
    if (!this.asignadaEdit) return;
    const nombre = (this.asignadaEdit.name || '').trim();
    if (!nombre) { Swal.fire({ icon: 'info', title: 'Escribe el nombre de la tarea', confirmButtonColor: '#0F172A' }); return; }
    const orig = this.tecAsignadas.find(x => x.id === this.asignadaEdit.id);
    const items = (orig?.items || []).map((it: any, i: number) => i === 0
      ? { ...it, text: nombre, horaInicio: this.asignadaEdit.horaInicio || null, horaLimite: this.asignadaEdit.horaFin || null }
      : it);
    try {
      // FERROCARRIL Etapa 3: dual-write de la edición.
      const idAsig = String(this.asignadaEdit.id);
      const cambiosAsig = {
        name: nombre, items, time: this.asignadaEdit.horaFin || '23:59',
        date: this.asignadaEdit.fecha || orig?.date || this.hoyISO()
      };
      await updateDoc(doc(this.firestore, 'checklists', idAsig), cambiosAsig);
      await this.api.patchChecklist(idAsig, cambiosAsig);
      this.asignadaEdit = null;
    } catch (e) {
      console.error('[tec] guardarAsignada', e);
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', confirmButtonColor: '#0F172A' });
    }
  }

  async eliminarAsignada(t: any) {
    const r = await Swal.fire({
      title: 'Quitar tarea asignada', text: `¿Quitar "${t.name}" de ${t.assigned}?`, icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, quitar', cancelButtonText: 'Cancelar', confirmButtonColor: '#DC2626'
    });
    if (!r.isConfirmed) return;
    try {
      await updateDoc(doc(this.firestore, 'checklists', t.id), { eliminado: true });
      await this.api.patchChecklist(String(t.id), { eliminado: true }); // FERROCARRIL Etapa 3
    }
    catch (e) { console.error('[tec] eliminarAsignada', e); }
  }

  /** Texto de horario (inicio–fin) de una tarea asignada, o '' si no tiene. */
  horarioAsignada(t: any): string {
    const it = t?.items && t.items[0];
    const ini = it?.horaInicio || '';
    const fin = it?.horaLimite || (t?.time && t.time !== '23:59' ? t.time : '');
    if (!ini && !fin) return '';
    return `${ini || '—'} a ${fin || '—'}`;
  }

  estadoAsignada(t: any): string {
    if (t.enviado) return 'Enviada';
    if (t.status === 'completo') return 'Completa';
    if (t.status === 'en-progreso') return 'En progreso';
    return 'Pendiente';
  }

  // ===================== NOTAS / IDEAS (Postgres vía API) =====================
  /** Carga las notas desde /api/tec-notas (ya vienen ordenadas por fecha desc). */
  async cargarNotas() {
    try {
      const r = await this.api.get('/api/tec-notas');
      this.notas = r.notas || [];
    } catch (e) {
      console.error('[tec] cargarNotas', e);
    }
  }

  async agregarNota() {
    const titulo = this.nuevaNotaTitulo.trim();
    const texto = this.nuevaNotaTexto.trim();
    if (!titulo && !texto) return;
    try {
      await this.api.post('/api/tec-notas', { titulo, texto, autor: this.miNombre() });
      this.nuevaNotaTitulo = ''; this.nuevaNotaTexto = '';
      await this.cargarNotas();
    } catch (e) {
      console.error('[tec] agregarNota', e);
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', confirmButtonColor: '#0F172A' });
    }
  }
  empezarEdicionNota(n: any) { this.notaEnEdicionId = n.id; this.edicionTitulo = n.titulo || ''; this.edicionTexto = n.texto || ''; }
  cancelarEdicionNota() { this.notaEnEdicionId = null; this.edicionTitulo = ''; this.edicionTexto = ''; }
  async guardarEdicionNota(n: any) {
    try {
      await this.api.patch('/api/tec-notas', {
        id: n.id, titulo: this.edicionTitulo.trim(), texto: this.edicionTexto.trim()
      });
      this.cancelarEdicionNota();
      await this.cargarNotas();
    } catch (e) {
      console.error('[tec] guardarEdicionNota', e);
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', confirmButtonColor: '#0F172A' });
    }
  }
  async eliminarNota(n: any) {
    const r = await Swal.fire({
      title: 'Eliminar nota', text: '¿Seguro?', icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#DC2626'
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.del('/api/tec-notas?id=' + encodeURIComponent(n.id));
      await this.cargarNotas();
    } catch (e) {
      console.error('[tec] eliminarNota', e);
      Swal.fire({ icon: 'error', title: 'No se pudo eliminar', confirmButtonColor: '#0F172A' });
    }
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
