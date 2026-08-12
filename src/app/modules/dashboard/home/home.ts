
import {
  Component, signal, computed, OnInit, OnDestroy, AfterViewInit,
  inject, ViewChild, ElementRef, effect
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas, esSupervisor, mismoEmpleadoNombre } from '../../../shared/permisos.util';
import { nivelDeUsuario } from '../../../shared/nivel-jerarquico.util';
import { esItemHecho, tieneEvidencia } from '../../../shared/item-completado.util';
import { UsuariosService } from '../../../shared/usuarios.service';
import { ApiService } from '../../../shared/api.service';
import {
  guardarListaCache, leerListaCacheConEdad, textoAntiguedad
} from '../../../shared/lista-cache.util';
import { avisoDeFalla, AvisoDatos } from '../../../shared/aviso-datos.util';
import { MapaSucursalesComponent, PuntoMapa } from './mapa-sucursales';
import {
  UBICACIONES_SUCURSALES, SUCURSALES_COMERCIALES, tieneCoordenadas,
  sucursalesSinUbicar, esSucursalComercial
} from '../../../shared/sucursales-ubicaciones.util';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent, MapaSucursalesComponent],
  templateUrl: './home.html',
  styleUrls: ['./home.css']
})
export class HomeComponent implements OnInit, OnDestroy, AfterViewInit {
 
  // ------- Estado principal -------
  currentUser: any = null;
  isMenuOpen = false;
 
  checklists = signal<any[]>([]);
  // 📡 true cuando el último poll falló: se muestra la última lista buena (cache)
  // con un aviso, en vez de un dashboard vacío.
  sinConexion = signal<boolean>(false);
  // 📣 Qué dice ese aviso. No siempre es falta de internet: puede ser la sesión
  // vencida o el servidor. Decir "Sin conexión" cuando el internet está bien
  // manda a buscar el problema donde no está.
  aviso = signal<AvisoDatos>({
    titulo: 'Sin conexión',
    detalle: 'Se actualizarán solos al volver el internet.'
  });
  // 🕒 De cuándo son los datos que se están mostrando ('hace 5 minutos'). Vacío
  // cuando vienen frescos de la nube. Sin esto, el aviso decía "datos guardados"
  // sin aclarar si eran de hace un minuto o de la mañana.
  edadDatos = signal<string>('');
  areas      = signal<any[]>([]);
  usuarios   = signal<any[]>([]);
  horaActual = signal<Date>(new Date());

  // 🎯 Tabs: separa tareas propias del admin/supervisor de las del equipo.
  // Para trabajador puro siempre es 'mis' (ya no ve nada más).
  vistaTareas = signal<'mis' | 'equipo' | 'todas'>('todas');
 
  private router    = inject(Router);
  private usuariosSvc = inject(UsuariosService);
  private api = inject(ApiService);
  private destructoresRadares: (() => void)[] = [];
  private clockInterval: any = null;

  // Effect que toma la lista cruda del UsuariosService (listener compartido) y
  // aplica el filtro por sucursal/rol del usuario actual. Reemplaza al
  // onSnapshot duplicado que antes vivía en conectarConLaNube().
  private _usuariosEffect = effect(() => {
    const raw = this.usuariosSvc.usuarios();
    if (!raw) return;
    const sesion = (() => {
      try { return JSON.parse(localStorage.getItem('md_sesion_actual') || 'null'); }
      catch { return null; }
    })() || this.currentUser;
    const permitidas = sucursalesPermitidas(sesion);
    const esGlobal = esAdminGlobal(sesion);
    const supervisor = esSupervisor(sesion);
    let arr: any[] = raw.map((u: any) => ({ ...u, idFirestore: u.id || u.uid }));
    if ((!esGlobal && permitidas !== null) || supervisor) {
      arr = arr.filter(u => {
        if (u.rol === 'admin') return false;
        const susSuc: string[] = u.sucursales || (u.sucursal ? [u.sucursal] : []);
        return susSuc.some((s: string) => permitidas!.includes(s));
      });
    }
    this.usuarios.set(arr);
  });
 
  @ViewChild('trendChartCanvas') trendChartCanvas?: ElementRef<HTMLCanvasElement>;
  private trendChart: any = null;
 
  // ============================ COMPUTED SIGNALS ============================
 
  saludoDinamico = computed(() => {
    const h = this.horaActual().getHours();
    if (h < 12)  return 'Buenos días';
    if (h < 19)  return 'Buenas tardes';
    return 'Buenas noches';
  });
 
  fechaFormateada = computed(() => {
    const d = this.horaActual();
    const txt = d.toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    // Solo la primera letra en mayúscula. Con CSS capitalize salía
    // "Jueves, 30 De Julio De 2026", que se lee mal.
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  });
 
  horaFormateada = computed(() =>
    this.horaActual().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  );
 
  private hoyISO(): string {
    const d = this.horaActual();
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
  }
 
  // ------- Métricas globales -------
  /** Para admin limitado: solo áreas que tengan al menos 1 empleado en sus sucursales. */
  areasVisibles = computed(() => {
    if (esAdminGlobal(this.currentUser)) return this.areas();
    const conPersonal = new Set<string>();
    for (const u of this.usuarios()) {
      if (u.areas && Array.isArray(u.areas)) {
        for (const a of u.areas) conPersonal.add(a);
      }
    }
    return this.areas().filter(a => conPersonal.has(a.nombre));
  });

  totalSucursales      = computed(() => this.areasVisibles().length);
  totalEmpleados       = computed(() => this.usuarios().filter(u => u.rol !== 'admin').length);
  totalMandos          = computed(() =>
    this.usuarios().filter(u => u.rol !== 'admin' && nivelDeUsuario(u) === 'mando').length
  );
  totalOperativos      = computed(() =>
    this.usuarios().filter(u => u.rol !== 'admin' && nivelDeUsuario(u) === 'operativo').length
  );
  totalChecklistsHoy   = computed(() => this.checklistsHoy().length);
 
  /** Todos los checklists de hoy (sin filtro de tabs). Base para contadores. */
  checklistsHoyTodos = computed(() =>
    this.checklists().filter(c => c.date === this.hoyISO())
  );

  /** ¿Puede el usuario alternar entre Mis/Equipo/Todas? Admins y supervisores sí. */
  puedeFiltrarVista = computed(() => {
    const u = this.currentUser;
    if (!u) return false;
    if (u.rol === 'admin') return true;
    return esSupervisor(u);
  });

  /** Contadores para los tabs (referencia siempre al universo sin filtrar).
   *  Match tolerante: el perfil puede tener apellido extra o de menos respecto a `assigned`. */
  contadorMis = computed(() => {
    const mi = this.currentUser?.nombre;
    return this.checklistsHoyTodos().filter(c => mismoEmpleadoNombre(c.assigned, mi)).length;
  });
  contadorEquipo = computed(() => {
    const mi = this.currentUser?.nombre;
    return this.checklistsHoyTodos().filter(c => !mismoEmpleadoNombre(c.assigned, mi)).length;
  });
  contadorTodas = computed(() => this.checklistsHoyTodos().length);

  /**
   * Checklists de hoy filtrados por la pestaña activa.
   * Los KPI y rankings consumen este computed, así que el toggle afecta TODO
   * el dashboard (pendientes, completadas, cumplimiento, top empleados, etc.).
   */
  checklistsHoy = computed(() => {
    const todos = this.checklistsHoyTodos();
    if (!this.puedeFiltrarVista()) return todos;
    const vista = this.vistaTareas();
    if (vista === 'todas') return todos;
    const mi = this.currentUser?.nombre;
    if (vista === 'mis') return todos.filter(c => mismoEmpleadoNombre(c.assigned, mi));
    return todos.filter(c => !mismoEmpleadoNombre(c.assigned, mi));
  });

  cambiarVistaTareas(v: 'mis' | 'equipo' | 'todas') {
    this.vistaTareas.set(v);
  }
 
  totalTareasHoy = computed(() =>
    this.checklistsHoy().reduce((acc, c) => acc + (c.items?.length || 0), 0)
  );
 
  tareasCompletadasHoy = computed(() =>
    this.checklistsHoy().reduce(
      // ✅ Una tarea cuenta como completa si tiene su EVIDENCIA (foto/antes-después/
      // varias fotos) o, si no pide evidencia, si está palomeada. Antes contaba solo
      // i.checked y daba 0% aunque la persona hubiera subido todas sus fotos.
      (acc, c) => acc + (c.items?.filter((it: any) => this.itemHecho(it, c)).length || 0), 0
    )
  );
 
  tareasPendientesHoy = computed(() =>
    this.totalTareasHoy() - this.tareasCompletadasHoy()
  );
 
  porcentajeCumplimiento = computed(() => {
    const t = this.totalTareasHoy();
    if (t === 0) return 0;
    return Math.round((this.tareasCompletadasHoy() / t) * 100);
  });
 
  cumplimientoClase = computed(() => {
    const p = this.porcentajeCumplimiento();
    if (p >= 80) return 'kpi-ok';
    if (p >= 50) return 'kpi-warn';
    return 'kpi-bad';
  });
 
  // ==================================================================
  // MÉTRICAS DEL CENTRO DE MANDO
  // Las cuatro tarjetas de arriba miden cosas que EXISTEN en la base:
  // entrega, cumplimiento, puntualidad y evidencia fotográfica. Ninguna
  // se inventa ni se rellena con promedios de relleno: si no hay de dónde
  // calcularlas, devuelven null y la tarjeta dice "Sin datos".
  // ==================================================================

  /** ¿Este item exige foto (simple, antes/después o varias)? */
  private pideEvidencia(it: any): boolean {
    return !!(it?.requiresPhoto || it?.requiresAntesDespues || it?.requiresVariasFotos);
  }

  /** "14:30" (hora límite, 24h) → minutos desde medianoche. null si no se puede leer. */
  private minutosDe24h(txt: any): number | null {
    if (typeof txt !== 'string' || !txt.includes(':')) return null;
    const [h, m] = txt.trim().split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }

  /** "02:35 PM" (sello de la foto, 12h en-US) → minutos desde medianoche. */
  private minutosDe12h(txt: any): number | null {
    if (typeof txt !== 'string') return null;
    const m = txt.trim().toUpperCase().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
    if (m[3] === 'PM' && h !== 12) h += 12;
    if (m[3] === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }

  /**
   * Recorre los checklists de hoy UNA sola vez y saca todos los contadores.
   * Cada porcentaje lleva su propio denominador: así una tarjeta sin base
   * (por ejemplo, ninguna tarea con hora límite) puede decir "sin datos" en
   * vez de mentir con un 0% o un 100%.
   */
  private agregadoHoy = computed(() => {
    let items = 0, hechos = 0;
    let pidenEvidencia = 0, conEvidencia = 0;
    let medibles = 0, aTiempo = 0;
    let checklists = 0, enviados = 0;

    for (const c of this.checklistsHoy()) {
      if (c.eliminado === true || c.archivado === true) continue;
      checklists++;
      if (c.enviado === true) enviados++;

      for (const it of (c.items || [])) {
        items++;
        if (this.itemHecho(it, c)) hechos++;

        if (this.pideEvidencia(it)) {
          pidenEvidencia++;
          if (tieneEvidencia(it)) conEvidencia++;
        }

        // Puntualidad: solo items con evidencia REAL sellada con hora y con
        // hora límite. Los justificados no entran (no hay hora que comparar).
        const limite = this.minutosDe24h(it.horaLimite || it.time);
        const sello = this.minutosDe12h(it.photoTime);
        if (limite !== null && sello !== null && tieneEvidencia(it)) {
          medibles++;
          if (sello <= limite) aTiempo++;
        }
      }
    }

    return { items, hechos, pidenEvidencia, conEvidencia, medibles, aTiempo, checklists, enviados };
  });

  private porcentaje(parte: number, total: number): number | null {
    if (!total) return null;
    return Math.round((parte / total) * 100);
  }

  /** Checklists ya entregados por el colaborador, sobre los del día. */
  porcentajeEntrega = computed(() => {
    const a = this.agregadoHoy();
    return this.porcentaje(a.enviados, a.checklists);
  });

  /** De las tareas con hora límite y foto sellada, cuántas se hicieron a tiempo. */
  porcentajePuntualidad = computed(() => {
    const a = this.agregadoHoy();
    return this.porcentaje(a.aTiempo, a.medibles);
  });

  /** De las tareas que exigen foto, cuántas la tienen de verdad. */
  porcentajeEvidencia = computed(() => {
    const a = this.agregadoHoy();
    return this.porcentaje(a.conEvidencia, a.pidenEvidencia);
  });

  /** Texto chico bajo cada tarjeta: de dónde sale el número. */
  detalleEntrega = computed(() => {
    const a = this.agregadoHoy();
    return `${a.enviados} de ${a.checklists} checklists`;
  });
  detallePuntualidad = computed(() => {
    const a = this.agregadoHoy();
    return a.medibles ? `${a.aTiempo} de ${a.medibles} con hora límite` : 'Ninguna tarea con hora límite';
  });
  detalleEvidencia = computed(() => {
    const a = this.agregadoHoy();
    return a.pidenEvidencia ? `${a.conEvidencia} de ${a.pidenEvidencia} fotos requeridas` : 'Ninguna tarea pide foto';
  });
  detalleCumplimiento = computed(() => {
    const a = this.agregadoHoy();
    return `${a.hechos} de ${a.items} tareas`;
  });

  /**
   * Cumplimiento en versión "nullable" para la tarjeta: sin tareas programadas
   * no es 0% (eso se leería como fracaso), es que no hay nada que medir.
   */
  cumplimientoTarjeta = computed(() => {
    const a = this.agregadoHoy();
    return this.porcentaje(a.hechos, a.items);
  });

  /** Las cuatro tarjetas de arriba. Cada una dice qué mide y de dónde sale. */
  tarjetasMando = computed(() => [
    {
      titulo: 'Checklists entregados',
      grupo: 'Productividad y eficiencia operativa',
      valor: this.porcentajeEntrega(),
      detalle: this.detalleEntrega(),
      nota: 'Checklists que el colaborador ya cerró y envió'
    },
    {
      titulo: 'Cumplimiento de tareas',
      grupo: 'Productividad y eficiencia operativa',
      valor: this.cumplimientoTarjeta(),
      detalle: this.detalleCumplimiento(),
      nota: 'Tareas hechas sobre las programadas del día'
    },
    {
      titulo: 'Puntualidad',
      grupo: 'Calidad de la ejecución',
      valor: this.porcentajePuntualidad(),
      detalle: this.detallePuntualidad(),
      nota: 'Terminadas antes de su hora límite'
    },
    {
      titulo: 'Evidencia fotográfica',
      grupo: 'Calidad de la ejecución',
      valor: this.porcentajeEvidencia(),
      detalle: this.detalleEvidencia(),
      nota: 'Fotos entregadas donde la tarea las exige'
    }
  ]);

  /** Semáforo compartido por todas las tarjetas y tablas. */
  nivelDe(pct: number | null): 'ok' | 'warn' | 'bad' | 'nulo' {
    if (pct === null) return 'nulo';
    if (pct >= 80) return 'ok';
    if (pct >= 50) return 'warn';
    return 'bad';
  }

  colorDeNivel(pct: number | null): string {
    switch (this.nivelDe(pct)) {
      case 'ok':   return '#10B981';
      case 'warn': return '#F59E0B';
      case 'bad':  return '#EF4444';
      default:     return '#94A3B8';
    }
  }

  /** Etiqueta del estado, en lugar del "estado de ánimo" que no se mide. */
  etiquetaDe(pct: number | null): string {
    switch (this.nivelDe(pct)) {
      case 'ok':   return 'En meta';
      case 'warn': return 'En riesgo';
      case 'bad':  return 'Crítico';
      default:     return 'Sin datos';
    }
  }

  // ---- Geometría del arco de las gráficas de aguja (semicírculo r=42) ----
  readonly largoArco = Math.round(Math.PI * 42);

  /** Longitud del trazo relleno para un porcentaje dado. */
  arcoDe(pct: number | null): number {
    if (pct === null) return 0;
    return (Math.max(0, Math.min(100, pct)) / 100) * this.largoArco;
  }

  // ==================================================================
  // RENDIMIENTO POR SUCURSAL (el bloque "por equipo / división")
  // ==================================================================
  filtroRendimiento = signal<'todas' | 'comerciales'>('todas');

  cambiarFiltroRendimiento(f: 'todas' | 'comerciales') {
    this.filtroRendimiento.set(f);
  }

  /** Una fila por sucursal, con sus tres métricas reales y su estado. */
  rendimientoPorSucursal = computed(() => {
    const acc: Record<string, any> = {};

    for (const c of this.checklistsHoy()) {
      if (c.eliminado === true || c.archivado === true) continue;
      const store = c.store;
      if (!store) continue;

      if (!acc[store]) {
        acc[store] = {
          nombre: store, items: 0, hechos: 0,
          pidenEvidencia: 0, conEvidencia: 0,
          medibles: 0, aTiempo: 0, checklists: 0
        };
      }
      const s = acc[store];
      s.checklists++;

      for (const it of (c.items || [])) {
        s.items++;
        if (this.itemHecho(it, c)) s.hechos++;

        if (this.pideEvidencia(it)) {
          s.pidenEvidencia++;
          if (tieneEvidencia(it)) s.conEvidencia++;
        }

        const limite = this.minutosDe24h(it.horaLimite || it.time);
        const sello = this.minutosDe12h(it.photoTime);
        if (limite !== null && sello !== null && tieneEvidencia(it)) {
          s.medibles++;
          if (sello <= limite) s.aTiempo++;
        }
      }
    }

    // ------------------------------------------------------------------
    // Sucursales que NO reportaron nada hoy: hay que meterlas a fuerza.
    //
    // Antes la tabla se armaba solo con lo que traían los checklists, asi que
    // una sucursal en cero simplemente no aparecia: se borraba del panel en
    // silencio. Al reves de lo que necesita un director, porque una sucursal
    // que no reporto en todo el dia es la primera que hay que ver.
    //
    // Solo las comerciales del catalogo, y respetando el alcance del usuario:
    // un admin de una sola sucursal no tiene por que ver las demas.
    // ------------------------------------------------------------------
    const permitidas = sucursalesPermitidas(this.currentUser);
    const esGlobal = esAdminGlobal(this.currentUser);
    for (const nombre of SUCURSALES_COMERCIALES) {
      if (acc[nombre]) continue;
      if (!esGlobal && permitidas !== null && !permitidas.includes(nombre)) continue;
      acc[nombre] = {
        nombre, items: 0, hechos: 0, pidenEvidencia: 0, conEvidencia: 0,
        medibles: 0, aTiempo: 0, checklists: 0
      };
    }

    let filas = Object.values(acc).map((s: any) => ({
      nombre: s.nombre,
      checklists: s.checklists,
      hechos: s.hechos,
      total: s.items,
      /** Ni un solo checklist hoy. No es 0% de cumplimiento: es que no hay nada. */
      sinReportar: s.checklists === 0,
      cumplimiento: this.porcentaje(s.hechos, s.items),
      puntualidad: this.porcentaje(s.aTiempo, s.medibles),
      evidencia: this.porcentaje(s.conEvidencia, s.pidenEvidencia),
      // Base de cada porcentaje, para el tooltip. Un 100% de una sola tarea no
      // dice lo mismo que un 100% de treinta, y el director merece verlo.
      baseCumplimiento: s.checklists === 0
        ? 'Sin checklists hoy'
        : `${s.hechos} de ${s.items} tareas`,
      basePuntualidad: s.medibles ? `${s.aTiempo} de ${s.medibles} con hora límite` : 'Sin tareas con hora límite',
      baseEvidencia: s.pidenEvidencia ? `${s.conEvidencia} de ${s.pidenEvidencia} fotos requeridas` : 'Ninguna tarea pide foto'
    }));

    if (this.filtroRendimiento() === 'comerciales') {
      filas = filas.filter(f => esSucursalComercial(f.nombre));
    }

    // Las que no reportaron van ARRIBA: es la peor noticia del tablero y no
    // puede quedar sepultada al final. Despues, peor cumplimiento primero: al
    // director le interesa donde meter mano, no quien va bien.
    return filas.sort((a, b) => {
      if (a.sinReportar !== b.sinReportar) return a.sinReportar ? -1 : 1;
      return (a.cumplimiento ?? 101) - (b.cumplimiento ?? 101);
    });
  });

  /**
   * Sucursales comerciales que no han abierto un solo checklist hoy.
   *
   * Se avisa arriba del tablero, no solo como una fila más de la tabla: es la
   * peor noticia posible del día y no debería haber que buscarla.
   */
  sucursalesSinReportar = computed(() =>
    this.rendimientoPorSucursal()
      .filter(f => f.sinReportar && esSucursalComercial(f.nombre))
      .map(f => f.nombre)
  );

  // ==================================================================
  // MAPA REAL DE SUCURSALES
  // ==================================================================
  /** Sucursales con coordenadas confirmadas, cruzadas con el desempeño de hoy. */
  puntosMapa = computed<PuntoMapa[]>(() => {
    const porNombre = new Map<string, any>(
      this.rendimientoPorSucursal().map(f => [f.nombre, f])
    );
    const permitidas = sucursalesPermitidas(this.currentUser);
    const esGlobal = esAdminGlobal(this.currentUser);

    return UBICACIONES_SUCURSALES
      .filter(u => tieneCoordenadas(u))
      .filter(u => esGlobal || permitidas === null || permitidas.includes(u.nombre))
      .map(u => {
        const f = porNombre.get(u.nombre);
        return {
          nombre: u.nombre,
          direccion: u.direccion,
          ciudad: u.ciudad,
          lat: u.lat as number,
          lng: u.lng as number,
          cumplimiento: f?.cumplimiento ?? 0,
          hechas: f?.hechos ?? 0,
          total: f?.total ?? 0,
          sinActividad: !f || !f.total,
          precision: u.precision
        };
      });
  });

  /**
   * Sucursales que aún no tienen coordenadas: se dicen en voz alta, para que
   * nadie crea que el mapa muestra toda la operación. Solo las comerciales:
   * las áreas administrativas no son puntos de venta y solo harían ruido.
   */
  sucursalesPendientesMapa = computed(() =>
    sucursalesSinUbicar().filter(n => esSucursalComercial(n))
  );

  // ==================================================================
  // RECONOCIMIENTOS (reemplaza los "hitos" inventados del boceto)
  // ==================================================================
  /** Colaboradores que cerraron el día completo. Dato real, no simbólico. */
  reconocimientos = computed(() => {
    return this.topEmpleados()
      .filter(e => e.porcentaje === 100 && e.total >= 3)
      .slice(0, 4)
      .map(e => ({
        nombre: e.nombre,
        detalle: `${e.total} tareas completas, sin pendientes`
      }));
  });

  /** Sucursales al 100% hoy, con al menos un checklist. */
  sucursalesPerfectas = computed(() =>
    this.rendimientoPorSucursal()
      .filter(s => s.cumplimiento === 100 && s.total > 0)
      .map(s => s.nombre)
  );

  // ------- Top empleados (hoy) -------
  topEmpleados = computed(() => {
    const stats: Record<string, any> = {};
    this.checklistsHoy().forEach(c => {
      if (!c.assigned) return;
      if (!stats[c.assigned]) {
        stats[c.assigned] = { nombre: c.assigned, total: 0, completadas: 0 };
      }
      (c.items || []).forEach((it: any) => {
        stats[c.assigned].total++;
        if (this.itemHecho(it, c)) stats[c.assigned].completadas++;
      });
    });
    return Object.values(stats)
      .map((e: any) => ({
        ...e,
        porcentaje: e.total > 0 ? Math.round((e.completadas / e.total) * 100) : 0
      }))
      .sort((a: any, b: any) => b.porcentaje - a.porcentaje || b.completadas - a.completadas)
      .slice(0, 5);
  });

  // ------- Top sucursales (hoy) -------
  topSucursales = computed(() => {
    const stats: Record<string, any> = {};
    this.checklistsHoy().forEach(c => {
      const key = c.store;
      if (!key) return;
      if (!stats[key]) stats[key] = { nombre: key, total: 0, completadas: 0, checklists: 0 };
      stats[key].checklists++;
      (c.items || []).forEach((it: any) => {
        stats[key].total++;
        if (this.itemHecho(it, c)) stats[key].completadas++;
      });
    });
    return Object.values(stats)
      .map((s: any) => ({
        ...s,
        porcentaje: s.total > 0 ? Math.round((s.completadas / s.total) * 100) : 0
      }))
      .sort((a: any, b: any) => b.porcentaje - a.porcentaje)
      .slice(0, 5);
  });
 
  // ------- Alertas críticas -------
  /** Wrapper que delega al helper unificado. Mantiene la firma con (it, c) para
   *  que las llamadas existentes que pasan ambos parámetros sigan funcionando. */
  private itemHecho(it: any, c?: any): boolean {
    return esItemHecho(it, c);
  }

  alertasCriticas = computed(() => {
    const ahora = this.horaActual();
    const alertas: any[] = [];

    this.checklistsHoy().forEach(c => {
      // No alertamos sobre checklists ya enviados, eliminados o archivados (eran tareas fantasma).
      if (c.eliminado === true || c.enviado === true || c.archivado === true) return;
      (c.items || []).forEach((it: any) => {
        if (this.itemHecho(it, c)) return;
        const hl = it.horaLimite || it.time;
        if (!hl) return;
        const [h, m] = hl.split(':').map(Number);
        const limite = new Date(ahora);
        limite.setHours(h, m, 0, 0);
        if (ahora > limite) {
          alertas.push({
            tipo: 'vencida',
            empleado: c.assigned,
            tarea: it.text,
            sucursal: c.store,
            limite: this.formatearHora(hl)
          });
        }
      });
    });
 
    return alertas.slice(0, 8);
  });
 
  // ------- Actividad reciente -------
  actividadReciente = computed(() => {
    const acts: any[] = [];
    this.checklistsHoy().forEach(c => {
      (c.items || []).forEach((it: any) => {
        if (this.itemHecho(it, c) && it.photoTime) {
          acts.push({
            empleado: c.assigned,
            tarea: it.text,
            sucursal: c.store,
            hora: it.photoTime
          });
        }
      });
    });
    return acts
      .sort((a, b) => (b.hora || '').localeCompare(a.hora || ''))
      .slice(0, 8);
  });
 
  // ------- Tendencia 7 días (tres series reales) -------
  tendencia7Dias = computed(() => {
    const dias: { fecha: string, porcentaje: number, puntualidad: number, evidencia: number }[] = [];
    const hoy = this.horaActual();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(hoy);
      d.setDate(d.getDate() - i);
      const offset = d.getTimezoneOffset() * 60000;
      const fechaISO = new Date(d.getTime() - offset).toISOString().split('T')[0];
      const checks = this.checklists().filter(c => c.date === fechaISO);

      let total = 0, completadas = 0;
      let pidenEvidencia = 0, conEvidencia = 0;
      let medibles = 0, aTiempo = 0;

      checks.forEach(c => (c.items || []).forEach((it: any) => {
        total++;
        if (this.itemHecho(it, c)) completadas++;

        if (this.pideEvidencia(it)) {
          pidenEvidencia++;
          if (tieneEvidencia(it)) conEvidencia++;
        }

        const limite = this.minutosDe24h(it.horaLimite || it.time);
        const sello = this.minutosDe12h(it.photoTime);
        if (limite !== null && sello !== null && tieneEvidencia(it)) {
          medibles++;
          if (sello <= limite) aTiempo++;
        }
      }));

      dias.push({
        fecha: d.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', ''),
        porcentaje: total > 0 ? Math.round((completadas / total) * 100) : 0,
        puntualidad: medibles > 0 ? Math.round((aTiempo / medibles) * 100) : 0,
        evidencia: pidenEvidencia > 0 ? Math.round((conEvidencia / pidenEvidencia) * 100) : 0
      });
    }
    return dias;
  });
 
  // ================================== LIFECYCLE ==================================
  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) this.currentUser = JSON.parse(sesion);

    // Levanta el listener compartido de usuarios (refcount); otros componentes que
    // tambien lo usen comparten el mismo onSnapshot.
    this.usuariosSvc.iniciar();

    this.conectarConLaNube();

    // Reloj que refresca cada minuto
    this.clockInterval = setInterval(() => this.horaActual.set(new Date()), 60000);
  }

  ngAfterViewInit() { this.cargarChartJS(); }

  ngOnDestroy() {
    this.destructoresRadares.forEach(apagar => apagar());
    this.usuariosSvc.detener();
    if (this.clockInterval) clearInterval(this.clockInterval);
    if (this.trendChart) this.trendChart.destroy();
  }
 
  // ================================== FIRESTORE ==================================
  conectarConLaNube() {
    // 🔥 Filtro de alcance: admin global ve todo; admin limitado solo sus sucursales;
    //    trabajador solo sus propias tareas (sin importar la sucursal).
    // 🔒 IMPORTANTE: los permisos se calculan DENTRO de cada snapshot (no aquí
    // afuera), para que tomen el currentUser FRESCO cada vez que cambie (gracias
    // a la sincronización en vivo de app.ts). Antes se "congelaban" al inicio.
    const leerSesion = (): any => {
      try { return JSON.parse(localStorage.getItem('md_sesion_actual') || 'null'); }
      catch { return null; }
    };

    // 💸 OPTIMIZACIÓN: solo traemos los últimos 7 días, no toda la historia.
    const hace7Dias = new Date();
    hace7Dias.setDate(hace7Dias.getDate() - 7);
    const offsetDays = hace7Dias.getTimezoneOffset() * 60000;
    const desdeISO = new Date(hace7Dias.getTime() - offsetDays).toISOString().split('T')[0];

    // FERROCARRIL Etapa 3: antes onSnapshot(checklists); ahora poll a Postgres.
    const claveUsuario = (s: any) => String(s?.uid || s?.id || s?.usuario || 'anon');
    const recargarChecklists = async () => {
      let falla: any = null;
      const resp = await this.api.get('/api/checklists?desde=' + encodeURIComponent(desdeISO))
        .catch((e: any) => { falla = e; console.error('[home] poll PG', e); return null; });
      if (!resp) {
        // Falló la lectura: no vaciar el dashboard. Marcamos el aviso y, si no
        // hay nada en pantalla, hidratamos desde la última lista buena.
        // El aviso dice el motivo real: no siempre es falta de internet.
        this.sinConexion.set(true);
        this.aviso.set(avisoDeFalla(falla));
        if (this.checklists().length === 0) {
          const cache = leerListaCacheConEdad('dashboard', claveUsuario(leerSesion() || this.currentUser));
          if (cache && cache.lista.length) {
            this.checklists.set(cache.lista);
            this.edadDatos.set(textoAntiguedad(cache.edadMinutos));
            setTimeout(() => this.actualizarGrafica(), 100);
          }
        }
        return;
      }
      this.sinConexion.set(false);
      this.edadDatos.set('');   // ya son datos frescos de la nube
      const filas: any[] = resp.checklists || [];
      // Recalculamos permisos cada vez (currentUser podría haberse actualizado).
      const sesion = leerSesion() || this.currentUser;
      const permitidas = sucursalesPermitidas(sesion);
      const esGlobal = esAdminGlobal(sesion);
      // Supervisor = trabajador con flags de admin + sucursales asignadas.
      // En el dashboard se comporta como admin limitado (ve su sucursal completa),
      // no como trabajador puro (que solo ve sus propias tareas).
      const supervisor = esSupervisor(sesion);
      const esTrabajadorPuro = sesion?.rol === 'trabajador' && !supervisor;
      const miNombre = sesion?.nombre;

      let arr: any[] = [];
      filas.forEach((c: any) => {
        if (c.eliminado === true || c.archivado === true) return;
        arr.push({ ...c });
      });
      const totalCrudo = arr.length;

      if (esTrabajadorPuro) {
        // Match tolerante: cubre perfiles con apellido extra/de menos vs assigned.
        arr = arr.filter(c => mismoEmpleadoNombre(c.assigned, miNombre));
      } else if (!esGlobal && permitidas !== null) {
        // admin limitado O supervisor → filtra por sucursales
        arr = arr.filter(c => permitidas.includes(c.store));
      }

      // DEBUG temporal: ver en consola por qué un admin/supervisor ve 0.
      console.log('[DBG dashboard]', {
        usuario: sesion?.usuario, rol: sesion?.rol, alcance: sesion?.alcance,
        sucursales: sesion?.sucursales, esGlobal, supervisor, permitidas,
        checklistsCrudos: totalCrudo, despuesFiltro: arr.length,
        sucursalesUnicasEnDatos: Array.from(new Set(arr.map(c => c.store)))
      });

      this.checklists.set(arr);
      // 💾 Guardamos la lista buena para pintarla si un próximo poll falla por red.
      guardarListaCache('dashboard', claveUsuario(sesion), arr);
      setTimeout(() => this.actualizarGrafica(), 100);
    };
    // Hidratación inmediata desde cache (evita dashboard vacío tras recargar con
    // mala señal); el primer poll lo refresca al responder.
    if (this.checklists().length === 0) {
      const cacheInicial = leerListaCacheConEdad('dashboard', claveUsuario(leerSesion() || this.currentUser));
      if (cacheInicial && cacheInicial.lista.length) {
        this.checklists.set(cacheInicial.lista);
        this.edadDatos.set(textoAntiguedad(cacheInicial.edadMinutos));
      }
    }
    recargarChecklists();
    const idPollChecklists = setInterval(recargarChecklists, 20000);
    this.destructoresRadares.push(() => clearInterval(idPollChecklists));

    // areas_operativas migrada a Postgres (API). Poll ligero.
    this.cargarAreas();
    const areasPoll = setInterval(() => this.cargarAreas(), 60000);
    this.destructoresRadares.push(() => clearInterval(areasPoll));

    // La lista de usuarios ya la trae UsuariosService (listener compartido).
    // Aquí ya no abrimos un onSnapshot duplicado — el _usuariosEffect arriba
    // se encarga de filtrar por permisos y sucursales del currentUser.
  }

  /** Carga las áreas operativas desde /api/areas-operativas (Postgres). */
  async cargarAreas() {
    try {
      const r = await this.api.get('/api/areas-operativas');
      this.areas.set(r.areas || []);
    } catch (e) {
      console.error('[home] cargarAreas', e);
    }
  }

  // ================================== CHART.JS ==================================
  cargarChartJS() {
    if ((window as any).Chart) { this.actualizarGrafica(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.onload = () => this.actualizarGrafica();
    document.head.appendChild(s);
  }
 
  actualizarGrafica() {
    const Chart = (window as any).Chart;
    if (!Chart || !this.trendChartCanvas) return;
 
    const datos = this.tendencia7Dias();
    if (this.trendChart) this.trendChart.destroy();
 
    // Cada serie con su propio trazo: es muy común que dos coincidan (si todas
    // las tareas del día piden foto, evidencia == cumplimiento) y con el mismo
    // guionado una tapaba a la otra y parecía que faltaba una línea.
    const serie = (label: string, valores: number[], color: string,
                   relleno: boolean, guion: number[]) => ({
      label,
      data: valores,
      borderColor: color,
      backgroundColor: relleno ? 'rgba(30, 58, 138, 0.10)' : 'transparent',
      borderWidth: relleno ? 3 : 2,
      borderDash: guion,
      fill: relleno,
      tension: 0.4,
      pointBackgroundColor: color,
      pointRadius: 4,
      pointHoverRadius: 7
    });

    this.trendChart = new Chart(this.trendChartCanvas.nativeElement, {
      type: 'line',
      data: {
        labels: datos.map(d => d.fecha),
        datasets: [
          serie('Cumplimiento', datos.map(d => d.porcentaje), '#1E3A8A', true, []),
          serie('Puntualidad', datos.map(d => d.puntualidad), '#0EA5E9', false, [6, 4]),
          serie('Evidencia', datos.map(d => d.evidencia), '#8B5CF6', false, [2, 3])
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, font: { size: 11 } }
          },
          tooltip: { callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${ctx.parsed.y}%` } }
        },
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: (v: any) => v + '%' } },
          x: { grid: { display: false } }
        }
      }
    });
  }
 
  // ================================== HELPERS ==================================
  formatearHora(hora: string): string {
    if (!hora || !hora.includes(':')) return hora || '';
    const [h, m] = hora.split(':').map(Number);
    const sufijo = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, '0')} ${sufijo}`;
  }
 
  iniciales(nombre: string): string {
    if (!nombre) return 'A';
    return nombre.split(' ').filter(Boolean).slice(0, 2).map(p => p.charAt(0)).join('').toUpperCase();
  }
 
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
 
  irA(ruta: string) { this.router.navigate([ruta]); this.isMenuOpen = false; }
}