import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, addDoc, doc, updateDoc, deleteDoc, setDoc } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

import { SidebarComponent } from '../shared/sidebar/sidebar';
import { esAdmin, esAdminGlobal, sucursalesPermitidas, normalizarNombre } from '../shared/permisos.util';
import { detectarRecomendaciones, Recomendacion } from '../shared/recomendaciones-rutinas.util';
import { ApiService } from '../shared/api.service';
import { comprimirImagenSiAplica } from '../shared/imagen.util';

@Component({
  selector: 'app-agenda',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './agenda.html',
  styleUrls: ['./agenda.css']
})
export class AgendaComponent implements OnInit, OnDestroy {
  /** Timer del poll de la agenda (FERROCARRIL: antes era un onSnapshot de Firestore). */
  private radarAgenda: any = null;

  ngOnDestroy() {
    // Cierra el poll al salir para evitar fugas.
    if (this.radarAgenda) { clearInterval(this.radarAgenda); this.radarAgenda = null; }
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

  // ----- Adjuntos de la tarea (cualquier formato: PDF, Excel, Word, imagen...) -----
  /** Cuántas subidas hay en vuelo; mientras sea > 0 no se deja guardar. */
  subiendoArchivos = 0;
  /** Tope por archivo. Cloudinary rechaza los pesados en subida sin firma. */
  readonly MAX_ARCHIVO_MB = 10;

  // Inyecciones
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);
  private api = inject(ApiService); // FERROCARRIL: usuarios desde Postgres

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
      this.usuarioSeleccionado = this.miPropioId();

      this.esAdminUsuario = esAdmin(this.currentUser);
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
      const r = await this.api.get('/api/usuarios');
      let lista = (r.usuarios || []).map((u: any) => ({ id: u.id || u.uid, ...u }));

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
    // FERROCARRIL: cerramos el poll anterior antes de abrir otro.
    if (this.radarAgenda) { clearInterval(this.radarAgenda); this.radarAgenda = null; }
    this.recargarAgenda();
    this.radarAgenda = setInterval(() => this.recargarAgenda(), 20000);
  }

  // Lee la agenda del usuario seleccionado desde Postgres (antes onSnapshot Firestore).
  private async recargarAgenda() {
    const userId = this.usuarioSeleccionado;
    if (!userId) return;
    try {
      const r = await this.api.get('/api/usuarios-agenda?uid=' + encodeURIComponent(userId));
      this.tareasPersonales = (r.tareas || []).sort((a: any, b: any) => {
        // Las que tienen fecha van primero (más próxima arriba); las sin fecha,
        // por fecha de creación (más reciente).
        if (a.fecha && b.fecha) return a.fecha.localeCompare(b.fecha);
        if (a.fecha && !b.fecha) return -1;
        if (!a.fecha && b.fecha) return 1;
        return (b.fechaCreacion || 0) - (a.fechaCreacion || 0);
      });
      this.recalcularGrupos();
    } catch (e) { console.error('[agenda] recargar', e); }
  }

  // ➕ Alta rápida: crea la tarea directo con la prioridad/frecuencia elegidas.
  //    (Para detalles —fecha, notas, adjunto— se toca la tarea y se abre el modal.)
  async agregarTarea() {
    const texto = this.nuevaTareaTexto.trim();
    if (!texto) return;
    const userId = this.usuarioSeleccionado || this.miPropioId();
    if (!userId) return;
    try {
      const nueva = {
        texto, completada: false, fechaCreacion: Date.now(), fecha: '',
        prioridad: this.nuevaPrioridad, frecuencia: this.nuevaFrecuencia,
        estado: 'pendiente', instrucciones: '', comentarios: '', adjunto: null, adjuntos: []
      };
      const ref = await addDoc(collection(this.firestore, `usuarios/${userId}/agenda`), nueva);
      await this.api.post('/api/usuarios-agenda', { id: ref.id, uid: userId, ...nueva }).catch(e => console.error('[agenda] sync PG', e));
      this.nuevaTareaTexto = '';
      await this.recargarAgenda();
    } catch (error) {
      console.error('Error creando tarea', error);
    }
  }

  // ============================================================================
  // RUTINAS RECOMENDADAS (solo admin, sucursales habilitadas)
  // ============================================================================
  private async cargarConfigReco() {
    try {
      // FERROCARRIL Etapa 9 (config): recomendaciones desde Postgres (antes getDoc).
      const resp = await this.api.get('/api/config?id=recomendaciones').catch(() => null);
      const data = resp?.item || {};
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

      // FERROCARRIL Etapa 3: checklists desde Postgres
      const resp = await this.api.get('/api/checklists?desde=' + encodeURIComponent(desde));
      const filas: any[] = resp?.checklists || [];
      const checklists: any[] = [];
      filas.forEach((c: any) => { if (c.store && visSet.has(normalizarNombre(c.store))) checklists.push(c); });

      // Catálogo (para excluir lo ya configurado).
      // FERROCARRIL: catalogo_rutinas desde Postgres (resp.items)
      const catResp = await this.api.get('/api/catalogo-rutinas');
      const catalogo: any[] = (catResp?.items || []).map((data: any) => ({ ...data, id: data.id }));

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
      const nueva = {
        texto: r.nombre, completada: false, fechaCreacion: Date.now(), fecha: '',
        prioridad: 'media', frecuencia: this.frecRecoAAgenda(r.frecuencia),
        estado: 'pendiente', instrucciones: '', comentarios: '', adjunto: null, adjuntos: []
      };
      const ref = await addDoc(collection(this.firestore, `usuarios/${userId}/agenda`), nueva);
      await this.api.post('/api/usuarios-agenda', { id: ref.id, uid: userId, ...nueva }).catch(e => console.error('[agenda] sync PG', e));
      this.recomendaciones = this.recomendaciones.filter(x => x.clave !== r.clave);
      await this.recargarAgenda();
    } catch (e) { console.error('[agenda reco] a mi agenda', e); }
  }

  /** Botón "Crear rutina": la vuelve rutina maestra del catálogo. */
  async crearRutinaDeReco(r: Recomendacion) {
    const yo = this.currentUser?.nombre || this.currentUser?.usuario || 'desconocido';
    const ahora = Date.now();
    const id = 'rutina_' + ahora;
    try {
      const nuevaRutina = {
        id, nombre: r.nombre, tipo: 'operacion', descripcion: 'Sugerida por patrón de uso.',
        frecuencia: r.frecuencia, horaInicio: '', horaLimite: '',
        responsableSugerido: 'Encargado', nivelCritico: 'importante',
        tareas: [{ id: 'ti_' + ahora, text: r.nombre, requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false }],
        activa: true, creadoPor: yo, creadoEn: ahora
      };
      await setDoc(doc(this.firestore, 'catalogo_rutinas', id), nuevaRutina);
      // FERROCARRIL: dual-write de la creación a Postgres
      await this.api.guardar('/api/catalogo-rutinas', { ...nuevaRutina, id: String(id) });
      this.recomendaciones = this.recomendaciones.filter(x => x.clave !== r.clave);
    } catch (e) { console.error('[agenda reco] crear rutina', e); }
  }

  async descartarReco(r: Recomendacion) {
    const nuevas = Array.from(new Set([...this.recoDescartadas, r.clave]));
    try {
      await setDoc(doc(this.firestore, 'config', 'recomendaciones'), { descartadas: nuevas }, { merge: true });
      // FERROCARRIL Etapa 9 (config): dual-write a Postgres.
      await this.api.parchar('/api/config', 'recomendaciones', { descartadas: nuevas });
      this.recoDescartadas = nuevas;
      this.recomendaciones = this.recomendaciones.filter(x => x.clave !== r.clave);
    } catch (e) { console.error('[agenda reco] descartar', e); }
  }

  /** Fecha de hoy legible para la barra superior. */
  get fechaHoyTexto(): string {
    return new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  // ============================================================================
  // CALENDARIO MENSUAL (estilo planner)
  // ============================================================================
  mesActual: Date = new Date();
  readonly espiral = new Array(14);
  readonly mesesTabs = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  readonly diasSemanaCal = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  get mesActualIndex(): number { return this.mesActual.getMonth(); }
  get anioActual(): number { return this.mesActual.getFullYear(); }
  get mesNombre(): string {
    const s = this.mesActual.toLocaleDateString('es-MX', { month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  irAMes(i: number) { this.mesActual = new Date(this.anioActual, i, 1); }
  mesAnterior() { this.mesActual = new Date(this.anioActual, this.mesActualIndex - 1, 1); }
  mesSiguiente() { this.mesActual = new Date(this.anioActual, this.mesActualIndex + 1, 1); }

  get celdasMes(): any[] {
    const y = this.mesActual.getFullYear();
    const m = this.mesActual.getMonth();
    const primeroDow = (new Date(y, m, 1).getDay() + 6) % 7; // Lunes = 0
    const diasMes = new Date(y, m + 1, 0).getDate();
    const celdas: any[] = [];
    for (let i = 0; i < primeroDow; i++) celdas.push({ dia: null });
    for (let d = 1; d <= diasMes; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      celdas.push({
        dia: d, iso,
        tareas: this.tareasPersonales.filter(t => t.fecha === iso),
        esHoy: iso === this.hoyISO()
      });
    }
    return celdas;
  }

  /** Clic en un día del calendario: prepara una tarea nueva para ese día. */
  nuevaEnDia(iso: string) {
    this.tareaActiva = {
      texto: '', completada: false, fechaCreacion: Date.now(), fecha: iso,
      prioridad: 'media', frecuencia: 'unica', estado: 'pendiente', instrucciones: '', comentarios: '', adjunto: null, adjuntos: [],
      esNueva: true
    };
  }

  // ============================================================================
  // ESTADOS: pendiente -> haciendo -> hecha
  //
  // Las tareas viejas solo traen `completada` (booleano). `estadoDe` las traduce
  // para que la vista sea una sola. Al guardar mantenemos AMBOS campos en
  // sincronia: el calendario, el robot y otras vistas siguen leyendo
  // `completada`, y romperlo se llevaria mas que la agenda.
  // ============================================================================
  estadoDe(t: any): 'pendiente' | 'haciendo' | 'hecha' {
    const e = String(t?.estado || '');
    if (e === 'pendiente' || e === 'haciendo' || e === 'hecha') return e;
    return t?.completada ? 'hecha' : 'pendiente';
  }

  etiquetaEstado(t: any): string {
    const e = this.estadoDe(t);
    return e === 'hecha' ? 'Hecha' : e === 'haciendo' ? 'Haciendo' : 'Por hacer';
  }

  /** Texto del tooltip: dice a que estado pasa al tocarla. */
  tituloEstado(t: any): string {
    const e = this.estadoDe(t);
    if (e === 'pendiente') return 'Marcar como que la estas haciendo';
    if (e === 'haciendo') return 'Marcar como hecha';
    return 'Regresar a por hacer';
  }

  /** Un toque en la casilla avanza al siguiente estado y da la vuelta. */
  async cicloEstado(tarea: any, event?: Event) {
    if (event) event.stopPropagation();
    const userId = this.usuarioSeleccionado;
    if (!userId) return;

    const actual = this.estadoDe(tarea);
    const siguiente = actual === 'pendiente' ? 'haciendo' : actual === 'haciendo' ? 'hecha' : 'pendiente';
    const completada = siguiente === 'hecha';

    // Reflejo inmediato; si el guardado falla lo revertimos para no mentir.
    const previo = { estado: tarea.estado, completada: tarea.completada };
    tarea.estado = siguiente;
    tarea.completada = completada;
    this.recalcularGrupos();

    try {
      const docRef = doc(this.firestore, `usuarios/${userId}/agenda/${tarea.id}`);
      await updateDoc(docRef, { estado: siguiente, completada });
      await this.api.patch('/api/usuarios-agenda', {
        id: tarea.id, estado: siguiente, completada,
        completadaEn: completada ? Date.now() : null,
      }).catch(e => console.error('[agenda] sync PG', e));
    } catch (error) {
      tarea.estado = previo.estado;
      tarea.completada = previo.completada;
      this.recalcularGrupos();
      console.error('[agenda] no se pudo cambiar el estado', error);
    }
  }

  // ----- Listas separadas + contadores -----
  get pendientes(): any[] { return this.tareasPersonales.filter(t => this.estadoDe(t) === 'pendiente'); }
  get enCurso(): any[] { return this.tareasPersonales.filter(t => this.estadoDe(t) === 'haciendo'); }
  get completadas(): any[] { return this.tareasPersonales.filter(t => this.estadoDe(t) === 'hecha'); }

  // ============================================================================
  // AGRUPADO POR DIA (hoja izquierda)
  //
  // Se calcula al cargar y al cambiar un estado, NO en un getter: un getter se
  // reevalua en cada ciclo de deteccion y devolveria arreglos nuevos, lo que
  // hace que *ngFor reconstruya la lista completa cada vez.
  // ============================================================================
  /** Bloques activos: atrasadas, hoy, lo que viene y sin fecha. */
  grupos: any[] = [];
  /** Días ya cerrados. Van aparte y plegados: es historial, no trabajo por hacer. */
  historial: any[] = [];

  /** Un día del historial se abre al tocarlo; arrancan todos cerrados. */
  private historialAbierto = new Set<string>();
  verTodoHistorial = false;
  readonly TOPE_HISTORIAL = 5;

  get historialVisible(): any[] {
    return this.verTodoHistorial ? this.historial : this.historial.slice(0, this.TOPE_HISTORIAL);
  }
  get hayMasHistorial(): boolean { return this.historial.length > this.TOPE_HISTORIAL; }
  diaAbierto(clave: string): boolean { return this.historialAbierto.has(clave); }
  alternarDia(clave: string) {
    if (this.historialAbierto.has(clave)) this.historialAbierto.delete(clave);
    else this.historialAbierto.add(clave);
  }

  trackGrupo = (_: number, g: any) => g.clave;
  trackTarea = (_: number, t: any) => t.id;

  private ordenEstado(t: any): number {
    const e = this.estadoDe(t);
    return e === 'haciendo' ? 0 : e === 'pendiente' ? 1 : 2;
  }

  /** Ordena dentro del dia: primero lo que se esta haciendo, al final lo hecho. */
  private ordenarTareas(lista: any[]): any[] {
    const prioridad: any = { alta: 0, media: 1, baja: 2 };
    return [...lista].sort((a, b) => {
      const e = this.ordenEstado(a) - this.ordenEstado(b);
      if (e !== 0) return e;
      const p = (prioridad[a.prioridad] ?? 1) - (prioridad[b.prioridad] ?? 1);
      if (p !== 0) return p;
      return (a.fechaCreacion || 0) - (b.fechaCreacion || 0);
    });
  }

  private armarGrupo(clave: string, titulo: string, subtitulo: string, tareas: any[], tipo: string, iso = ''): any {
    const total = tareas.length;
    const hechas = tareas.filter(t => this.estadoDe(t) === 'hecha').length;
    const haciendo = tareas.filter(t => this.estadoDe(t) === 'haciendo').length;
    return {
      clave, titulo, subtitulo, tipo, iso,
      tareas: this.ordenarTareas(tareas),
      total, hechas, haciendo,
      pct: total ? Math.round((hechas / total) * 100) : 0,
      esHoy: iso !== '' && iso === this.hoyISO(),
      cerrado: total > 0 && hechas === total,
    };
  }

  /** Reconstruye los bloques de la hoja izquierda a partir de tareasPersonales. */
  recalcularGrupos() {
    const hoy = this.hoyISO();
    const lista = this.tareasPersonales || [];
    const grupos: any[] = [];

    // Sin nada en la agenda no armamos bloques: se muestra solo el mensaje de
    // hoja vacia, para no sacar un "Hoy" solitario debajo del aviso.
    if (lista.length === 0) { this.grupos = []; this.historial = []; return; }

    const conFecha = lista.filter(t => !!t.fecha);
    const sinFecha = lista.filter(t => !t.fecha);

    // 1) Atrasadas: dia ya pasado y siguen abiertas. Van arriba porque urgen.
    const atrasadas = conFecha.filter(t => t.fecha < hoy && this.estadoDe(t) !== 'hecha');
    if (atrasadas.length) {
      grupos.push(this.armarGrupo('atrasadas', 'Atrasadas', '', atrasadas, 'atrasadas'));
    }

    // 2) Hoy y lo que viene, un bloque por dia en orden ascendente.
    const porDia = new Map<string, any[]>();
    for (const t of conFecha) {
      if (t.fecha < hoy) continue;
      if (!porDia.has(t.fecha)) porDia.set(t.fecha, []);
      porDia.get(t.fecha)!.push(t);
    }
    // Si hoy no tiene tareas igual mostramos el bloque, para que se vea el dia.
    if (!porDia.has(hoy)) porDia.set(hoy, []);

    for (const iso of [...porDia.keys()].sort()) {
      const tareas = porDia.get(iso)!;
      if (iso !== hoy && tareas.length === 0) continue;
      grupos.push(this.armarGrupo(
        'dia-' + iso, this.tituloDia(iso), this.formatearFecha(iso), tareas, 'dia', iso
      ));
    }

    // 3) Sin fecha asignada.
    if (sinFecha.length) {
      grupos.push(this.armarGrupo('sin-fecha', 'Sin fecha', '', sinFecha, 'sin-fecha'));
    }

    this.grupos = grupos;

    // 4) Historial: dias anteriores ya cerrados. Es el "que he hecho". Va en su
    //    propia lista, del mas reciente al mas viejo, y plegado: con muchos dias
    //    de trabajo esto llega a decenas de bloques y taparia el resumen.
    const pasadas = conFecha.filter(t => t.fecha < hoy && this.estadoDe(t) === 'hecha');
    const porDiaPasado = new Map<string, any[]>();
    for (const t of pasadas) {
      if (!porDiaPasado.has(t.fecha)) porDiaPasado.set(t.fecha, []);
      porDiaPasado.get(t.fecha)!.push(t);
    }
    this.historial = [...porDiaPasado.keys()].sort().reverse().map(iso =>
      this.armarGrupo('pasado-' + iso, this.formatearFecha(iso), '', porDiaPasado.get(iso)!, 'pasado', iso)
    );
  }

  /** "Hoy", "Mañana" o el día tal cual para el encabezado del bloque. */
  private tituloDia(iso: string): string {
    if (iso === this.hoyISO()) return 'Hoy';
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const off = d.getTimezoneOffset() * 60000;
    const manana = new Date(d.getTime() - off).toISOString().split('T')[0];
    if (iso === manana) return 'Mañana';
    return this.formatearFecha(iso);
  }

  readonly prioridades = [
    { v: 'alta', t: 'Alta' }, { v: 'media', t: 'Media' }, { v: 'baja', t: 'Baja' }
  ];
  readonly frecuencias = [
    { v: 'unica', t: 'Única' }, { v: 'diaria', t: 'Diaria' }, { v: 'semanal', t: 'Semanal' }
  ];
  etiquetaPrioridad(p: string): string { return this.prioridades.find(x => x.v === p)?.t || ''; }
  etiquetaFrecuencia(f: string): string { return this.frecuencias.find(x => x.v === f)?.t || ''; }

  async eliminarTarea(tareaId: string, event?: Event) {
    if (event) event.stopPropagation();
    
    const userId = this.usuarioSeleccionado; 
    if (!userId) return;

    if(confirm('¿Estás seguro de eliminar esta tarea?')) {
      try {
        const docRef = doc(this.firestore, `usuarios/${userId}/agenda/${tareaId}`);
        await deleteDoc(docRef);
        await this.api.del('/api/usuarios-agenda?id=' + encodeURIComponent(tareaId)).catch(e => console.error('[agenda] sync PG', e));
        await this.recargarAgenda();
      } catch (error) {
        console.error("Error eliminando tarea", error);
      }
    }
  }

  // 🔥 2. Funciones del Modal de Detalles
  abrirDetalle(tarea: any) {
    // Clonamos para edición. Los adjuntos se normalizan a lista para poder
    // manejar varios archivos y no romper las tareas viejas de un solo `adjunto`.
    this.tareaActiva = { ...tarea, adjuntos: this.normalizarAdjuntos(tarea), esNueva: false };
  }

  cerrarDetalle() {
    this.tareaActiva = null;
  }

  // ============================================================================
  // ADJUNTOS: cualquier tipo de archivo (PDF, Excel, Word, CSV, imagen, ZIP...)
  // ============================================================================

  /**
   * Las tareas antiguas guardaban una sola imagen en `adjunto`. Aquí lo pasamos
   * a la lista `adjuntos` para que la vista sea una sola, sin perder lo viejo.
   */
  private normalizarAdjuntos(tarea: any): any[] {
    if (Array.isArray(tarea?.adjuntos)) return tarea.adjuntos.map((a: any) => ({ ...a }));
    if (tarea?.adjunto) {
      return [{
        url: tarea.adjunto,
        nombre: this.nombreDesdeUrl(tarea.adjunto),
        tipo: '', tamano: 0,
        subidoEn: tarea.fechaCreacion || Date.now(),
      }];
    }
    return [];
  }

  /** Saca el nombre del archivo de una URL, para los adjuntos viejos que no lo traían. */
  private nombreDesdeUrl(url: string): string {
    try {
      const limpia = String(url).split('?')[0];
      const ultimo = limpia.substring(limpia.lastIndexOf('/') + 1);
      return decodeURIComponent(ultimo) || 'Adjunto';
    } catch { return 'Adjunto'; }
  }

  /** Cuántos archivos trae una tarea (para el indicador de la lista). */
  cuentaAdjuntos(tarea: any): number {
    if (Array.isArray(tarea?.adjuntos)) return tarea.adjuntos.length;
    return tarea?.adjunto ? 1 : 0;
  }

  /** Sube uno o varios archivos elegidos y los agrega a la tarea abierta. */
  async adjuntarArchivos(event: any) {
    const input = event?.target as HTMLInputElement;
    const elegidos: File[] = Array.from(input?.files || []);
    if (!elegidos.length || !this.tareaActiva) return;
    if (!Array.isArray(this.tareaActiva.adjuntos)) this.tareaActiva.adjuntos = [];

    const fallidos: string[] = [];
    for (const original of elegidos) {
      if (original.size > this.MAX_ARCHIVO_MB * 1024 * 1024) {
        fallidos.push(`${original.name} (pasa de ${this.MAX_ARCHIVO_MB} MB)`);
        continue;
      }
      this.subiendoArchivos++;
      try {
        // Las imágenes se comprimen para no gastar datos; PDF, Excel, Word y
        // el resto de formatos pasan intactos.
        const archivo = await comprimirImagenSiAplica(original);
        const url = await this.subirArchivo(archivo);
        if (!url) { fallidos.push(original.name); continue; }
        this.tareaActiva.adjuntos.push({
          url,
          nombre: original.name,
          tipo: original.type || '',
          tamano: archivo.size,
          subidoEn: Date.now(),
        });
      } catch (e) {
        console.error('[agenda] adjuntar', e);
        fallidos.push(original.name);
      } finally {
        this.subiendoArchivos--;
      }
    }

    if (input) input.value = ''; // permite volver a elegir el mismo archivo
    if (fallidos.length) {
      alert('No se pudieron subir estos archivos:\n\n' + fallidos.join('\n') +
        '\n\nRevisa tu conexión e inténtalo de nuevo.');
    }
  }

  /** Sube a Cloudinary. El endpoint 'auto' acepta cualquier formato, no solo imágenes. */
  private async subirArchivo(archivo: File): Promise<string | null> {
    const formData = new FormData();
    // El preset ANTES del archivo (ver checklist.ts): si la subida se corta a
    // medias, Cloudinary ya lo leyo y no rebota la peticion.
    formData.append('upload_preset', 'fotos_mega');
    formData.append('file', archivo);
    try {
      const resp = await fetch('https://api.cloudinary.com/v1_1/duherjgyg/auto/upload', {
        method: 'POST', body: formData
      });
      const data = await resp.json();
      return data?.secure_url || null;
    } catch (e) {
      console.error('[agenda] subir archivo', e);
      return null;
    }
  }

  quitarAdjunto(i: number) {
    if (!Array.isArray(this.tareaActiva?.adjuntos)) return;
    this.tareaActiva.adjuntos.splice(i, 1);
  }

  /** ¿Se puede mostrar como miniatura? */
  esImagen(a: any): boolean {
    if (String(a?.tipo || '').startsWith('image/')) return true;
    // Probamos nombre Y url: los adjuntos viejos no traen nombre de archivo.
    const patron = /\.(png|jpe?g|gif|webp|bmp|heic|avif)(\?|$)/i;
    return patron.test(String(a?.nombre || '')) || patron.test(String(a?.url || ''));
  }

  /** Etiqueta corta del formato (PDF, XLSX, DOCX...) para los que no son imagen. */
  extensionArchivo(a: any): string {
    const nombre = String(a?.nombre || a?.url || '').split('?')[0];
    const m = nombre.match(/\.([a-z0-9]{1,5})$/i);
    return m ? m[1].toUpperCase() : 'DOC';
  }

  pesoLegible(bytes: number): string {
    const n = Number(bytes) || 0;
    if (n <= 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async guardarDetalles() {
    if (!this.tareaActiva) return;
    // Si hay archivos a medio subir, esperamos: guardar ahora los perdería.
    if (this.subiendoArchivos > 0) {
      alert('Espera a que terminen de subir los archivos.');
      return;
    }
    const userId = this.usuarioSeleccionado || this.miPropioId();
    if (!userId) return;

    try {
      if (this.tareaActiva.esNueva) {
        // CREACIÓN: Firestore + Postgres (dual-write, mismo id).
        const { esNueva, id, ...tareaParaGuardar } = this.tareaActiva;
        const ref = await addDoc(collection(this.firestore, `usuarios/${userId}/agenda`), tareaParaGuardar);
        await this.api.post('/api/usuarios-agenda', { id: ref.id, uid: userId, ...tareaParaGuardar }).catch(e => console.error('[agenda] sync PG', e));
        this.nuevaTareaTexto = '';
      } else {
        // ACTUALIZACIÓN: Firestore + Postgres.
        const cambios = {
          texto: this.tareaActiva.texto,
          fecha: this.tareaActiva.fecha || '',
          prioridad: this.tareaActiva.prioridad || 'media',
          frecuencia: this.tareaActiva.frecuencia || 'unica',
          instrucciones: this.tareaActiva.instrucciones || '',
          comentarios: this.tareaActiva.comentarios || '',
          adjuntos: this.tareaActiva.adjuntos || []
        };
        const docRef = doc(this.firestore, `usuarios/${userId}/agenda/${this.tareaActiva.id}`);
        await updateDoc(docRef, cambios);
        await this.api.patch('/api/usuarios-agenda', { id: this.tareaActiva.id, ...cambios }).catch(e => console.error('[agenda] sync PG', e));
      }
      this.cerrarDetalle();
      await this.recargarAgenda();
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
  estaVencida(t: any): boolean { return !!t?.fecha && this.estadoDe(t) !== 'hecha' && t.fecha < this.hoyISO(); }

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