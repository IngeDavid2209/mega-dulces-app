import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { ApiService } from '../../../shared/api.service';
import { CloudinaryService } from '../../../shared/cloudinary.service';
import { PromoExpedientesComponent } from './expedientes';
// Los canales del formato viven aparte: el seguimiento tambien los necesita.
import { CANALES, RUTAS, CANALES_POR_RUTA } from './canales';

/** Un archivo de evidencia ya subido. */
interface Evidencia {
  url: string;
  nombre: string;
  tipo: string;
  pesoKB: number;
  subidoEn: number;
}

/** Las cinco maneras de pago del formato ("Tache la aplicable"). */
const RECURSOS = [
  'Se toma del inventario de CEDIS y se cobra con nota de crédito',
  'El proveedor entrega el producto sin cargo',
  'El proveedor entrega promocionales como recurso',
  'Presupuesto a favor',
  'Otros'
] as const;

/**
 * Activación de promociones — formato MKTN001 "Apoyo para Sell Out".
 *
 * Tres pasos que se desbloquean conforme se avanza:
 *   1. Proveedor (el catálogo se va formando solo con lo que se escribe).
 *   2. La oferta negociada y su evidencia (pdf, excel, xml, foto, lo que sea).
 *   3. El formato completo y su descarga en PDF.
 *
 * Todo se guarda en cada paso, no al final: si alguien cierra la pestaña a media
 * captura, no pierde lo escrito.
 *
 * DOS OFICIOS EN LA MISMA PANTALLA (ver src/app/services/promociones.guard.ts):
 *
 *   promocionesFormato      captura el formato, lo edita, lo quita, llena
 *                           expedientes de donde sea y ve el KPI de ventas.
 *   promocionesExpediente   entra a lo mismo pero SIN poder modificar: el
 *                           formato lo ve en solo lectura (y lo baja en PDF), y
 *                           solo sube evidencia de los canales de SU sucursal.
 *
 * Lo que se esconde aqui es la parte visible del candado, no el candado: el que
 * manda es el servidor (api/_promo-acceso.js), que vuelve a preguntar contra la
 * base en cada escritura.
 */
@Component({
  selector: 'app-promociones',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent, PromoExpedientesComponent],
  templateUrl: './promociones.html',
  styleUrls: ['./promociones.css']
})
export class PromocionesComponent implements OnInit {
  currentUser: any = null;
  isMenuOpen = false;

  private router = inject(Router);
  private api = inject(ApiService);
  private nube = inject(CloudinaryService);

  readonly CANALES = CANALES;
  readonly RECURSOS = RECURSOS;
  readonly RUTAS = RUTAS;
  readonly CANALES_POR_RUTA = CANALES_POR_RUTA;
  /** Tope real de Cloudinary en subida sin firma. No es un limite que yo invente. */
  readonly MAX_ARCHIVO_MB = 10;
  /** Renglones de codigos que se muestran de entrada: los 6 del formato en papel. */
  readonly CODIGOS_INICIALES = 6;
  /** Tope de codigos. El papel trae 6; aqui se pueden agregar los que hagan
   *  falta (15, 20...). El tope solo existe para que el PDF siga siendo legible. */
  readonly MAX_CODIGOS = 30;

  // ---------------- Vista ----------------
  //   lista       las promociones y su avance
  //   captura     el formato MKTN001 en sus tres pasos
  //   seguimiento los expedientes de UNA promocion (evidencia por sucursal)
  //   ranking     que promocion se vendio mas, en general y por sucursal
  vista = signal<'lista' | 'captura' | 'seguimiento' | 'ranking'>('lista');

  /** La promoción cuyo seguimiento se está viendo. */
  promoSeguimiento: any = null;

  /** Avance de cada promoción (expedientes, piezas, dinero), por promoId. */
  resumen = signal<Record<string, any>>({});

  /** Ranking general y por sucursal. Se carga al entrar a esa vista. */
  ranking = signal<{ general: any[]; porCanal: any[] }>({ general: [], porCanal: [] });
  cargandoRanking = signal(false);

  /** El mismo ranking, pero cargado de entrada para el KPI de la lista. */
  kpi = signal<{ general: any[]; porCanal: any[] }>({ general: [], porCanal: [] });
  cargando = signal(false);
  guardando = signal(false);
  subiendo = signal(0);

  promociones = signal<any[]>([]);
  proveedores = signal<any[]>([]);

  /** Paso visible. El candado lo pone `pasoDesbloqueado`. */
  paso = signal<1 | 2 | 3>(1);

  // ---------------- La promoción en captura ----------------
  id = '';
  folio: number | null = null;

  // Paso 1
  proveedor = '';
  // Paso 2
  oferta = '';
  evidencias: Evidencia[] = [];
  // Paso 3 (el formato)
  fechaNegociacion = '';
  agenteVentas = '';
  periodo = '';
  vigenciaDel = '';
  vigenciaAl = '';
  canales: Record<string, boolean> = {};
  mecanica = '';
  codigos: { codigo: string; descripcion: string }[] = [];
  presupuestoTopado = '';
  recurso = '';
  recursoOtros = '';
  conceptos = '';
  monto: number | null = null;
  distribucionDe = '';
  distribucionCod = '';
  cargo: 'con' | 'sin' | '' = '';
  /** Lo que se captura por canal, ya desglosado en renglones. Es una lista de
   *  objetos (no de strings) a proposito: con strings sueltos, Angular vuelve a
   *  crear el input en cada tecla y se pierde el cursor.
   *  A la base sigue viajando como UN texto por canal con los renglones
   *  separados por salto de linea, para no migrar lo ya capturado. */
  porCanalLineas: Record<string, { v: string }[]> = {};
  /** Lo capturado por ruta: canal -> { LP, ZAM, MOR }. En la base cada uno
   *  sigue viajando plano (rutaDiariaLP, mayoreoZAM...), para no migrar lo ya
   *  capturado. */
  porRuta: Record<string, Record<string, string>> = {};
  autoriza = '';
  /** Solo para el selector de calendario del campo "Al", que acepta texto libre
   *  ("Agotar Producto Asignado") y por eso no puede ser un input date. */
  alCalendario = '';

  ngOnInit() {
    const s = localStorage.getItem('md_sesion_actual');
    if (s) { try { this.currentUser = JSON.parse(s); } catch { } }
    this.cargarTodo();
  }

  // ================= Los dos oficios =================
  /**
   * ¿Captura formatos? Es el permiso que alcanza TODO: dar de alta, editar,
   * quitar, llenar cualquier expediente y ver el KPI de ventas.
   *
   * `grupoPromociones` es la bandera vieja, de cuando el apartado era un solo
   * permiso que daba todo. Se sigue respetando para que nadie se quede a medias
   * con una sesión firmada antes del cambio.
   */
  get puedeFormato(): boolean {
    const u = this.currentUser;
    return u?.promocionesFormato === true || u?.grupoPromociones === true;
  }

  /**
   * Lo contrario de puedeFormato, para leerlo bonito en la plantilla.
   *
   * Quien no captura formatos ve el formato apagado y sin botones de guardar.
   * El filtro por sucursal NO vive aqui sino en el componente de expedientes,
   * que es donde de veras se sube la evidencia: una sola verdad y en su lugar.
   */
  get soloLectura(): boolean { return !this.puedeFormato; }

  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  irA(r: string) { this.router.navigate([r]); this.isMenuOpen = false; }

  iniciales(nombre: string): string {
    if (!nombre) return 'A';
    return nombre.split(' ').filter(Boolean).slice(0, 2).map(p => p.charAt(0)).join('').toUpperCase();
  }

  // ================= Carga =================
  async cargarTodo() {
    this.cargando.set(true);
    try {
      // El KPI de la lista es SOLO para quien captura formatos: es quien negocia
      // con el proveedor y a quien le sirve saber, de un vistazo, que se esta
      // vendiendo. A quien nada mas sube evidencia no se le pide ni se le carga.
      const [p, pr, res, rk] = await Promise.all([
        this.api.get('/api/promociones').catch(() => ({ promociones: [] })),
        this.api.get('/api/promo-proveedores').catch(() => ({ proveedores: [] })),
        // El avance es de adorno hasta que hay expedientes: si falla, la lista
        // se ve igual, nomas sin las cifras.
        this.api.get('/api/promo-expedientes').catch(() => ({ resumen: [] })),
        this.puedeFormato
          ? this.api.get('/api/promo-expedientes?ranking=1').catch(() => ({ general: [], porCanal: [] }))
          : Promise.resolve({ general: [], porCanal: [] })
      ]);
      this.promociones.set(p?.promociones || []);
      this.proveedores.set(pr?.proveedores || []);
      const porId: Record<string, any> = {};
      for (const x of (res?.resumen || [])) porId[x.promoId] = x;
      this.resumen.set(porId);
      this.kpi.set({ general: rk?.general || [], porCanal: rk?.porCanal || [] });
    } finally {
      this.cargando.set(false);
    }
  }

  // ================= Candados =================
  /** El paso 2 se abre con proveedor; el 3, con la oferta Y su evidencia. */
  pasoDesbloqueado(n: 1 | 2 | 3): boolean {
    if (n === 1) return true;
    if (n === 2) return this.proveedor.trim().length > 1;
    return this.pasoDesbloqueado(2) && this.oferta.trim().length > 2 && this.evidencias.length > 0;
  }

  motivoCandado(n: 2 | 3): string {
    if (n === 2) return 'Escribe primero el proveedor.';
    if (!this.pasoDesbloqueado(2)) return 'Escribe primero el proveedor.';
    if (this.oferta.trim().length <= 2) return 'Escribe la oferta que se negoció.';
    return 'Adjunta al menos una evidencia de la oferta.';
  }

  irAPaso(n: 1 | 2 | 3) {
    if (!this.pasoDesbloqueado(n)) return;
    if (n === 3) this.sembrarMecanica();
    this.paso.set(n);
  }

  /**
   * La MECANICA del formato es, en la practica, la oferta que se negocio en el
   * paso 2 escrita en limpio. Se copia sola la primera vez que se entra al paso
   * 3 para no capturar lo mismo dos veces; si ya hay algo escrito NO se pisa.
   */
  private sembrarMecanica() {
    if (!this.mecanica.trim() && this.oferta.trim()) this.mecanica = this.oferta.trim();
  }

  // ================= Alta y edición =================
  async nueva() {
    if (!this.puedeFormato) return;
    this.limpiar();
    this.vista.set('captura');
    this.paso.set(1);
    try {
      const r = await this.api.get('/api/promociones?siguienteFolio=1');
      this.folio = r?.folio ?? null;
    } catch { this.folio = null; }
  }

  private limpiar() {
    this.id = 'promo_' + Date.now();
    this.folio = null;
    this.proveedor = ''; this.oferta = ''; this.evidencias = [];
    const hoy = new Date();
    const off = hoy.getTimezoneOffset() * 60000;
    this.fechaNegociacion = new Date(hoy.getTime() - off).toISOString().split('T')[0];
    this.agenteVentas = ''; this.periodo = '';
    this.vigenciaDel = this.fechaNegociacion; this.vigenciaAl = '';
    this.canales = {}; this.mecanica = '';
    this.codigos = Array.from({ length: this.CODIGOS_INICIALES }, () => ({ codigo: '', descripcion: '' }));
    this.presupuestoTopado = ''; this.recurso = ''; this.recursoOtros = '';
    this.conceptos = ''; this.monto = null;
    this.distribucionDe = ''; this.distribucionCod = ''; this.cargo = '';
    this.porCanalLineas = {};
    for (const c of CANALES) this.porCanalLineas[c] = [{ v: '' }];
    this.porRuta = {};
    for (const c of Object.keys(CANALES_POR_RUTA)) {
      this.porRuta[c] = {};
      for (const r of RUTAS) this.porRuta[c][r] = '';
    }
    this.autoriza = '';
    this.alCalendario = '';
  }

  abrir(p: any) {
    this.limpiar();
    this.id = p.id;
    this.folio = p.folio ?? null;
    this.proveedor = p.proveedor || '';
    this.oferta = p.oferta || '';
    this.evidencias = Array.isArray(p.evidencias) ? p.evidencias : [];
    this.fechaNegociacion = p.fechaNegociacion || this.fechaNegociacion;
    this.agenteVentas = p.agenteVentas || '';
    this.periodo = p.periodo || '';
    this.vigenciaDel = p.vigenciaDel || '';
    this.vigenciaAl = p.vigenciaAl || '';
    this.canales = { ...(p.canales || {}) };
    this.mecanica = p.mecanica || '';
    // Se cargan TODOS los codigos guardados (pueden ser mas de los 6 del papel)
    // y se completa hasta 6 para que siempre haya renglones a la mano.
    if (Array.isArray(p.codigos) && p.codigos.length) {
      this.codigos = p.codigos.map((c: any) => ({ codigo: c?.codigo || '', descripcion: c?.descripcion || '' }))
        .concat(Array.from({ length: Math.max(0, this.CODIGOS_INICIALES - p.codigos.length) },
          () => ({ codigo: '', descripcion: '' })));
    }
    this.presupuestoTopado = p.presupuestoTopado || '';
    this.recurso = p.recurso || '';
    this.recursoOtros = p.recursoOtros || '';
    this.conceptos = p.conceptos || '';
    this.monto = p.monto ?? null;
    this.distribucionDe = p.distribucionDe || '';
    this.distribucionCod = p.distribucionCod || '';
    this.cargo = p.cargo || '';
    const guardadoPorCanal = p.porCanal || {};
    for (const c of CANALES) this.porCanalLineas[c] = this.aRenglones(guardadoPorCanal[c]);
    for (const [canal, prefijo] of Object.entries(CANALES_POR_RUTA)) {
      for (const r of RUTAS) this.porRuta[canal][r] = p[prefijo + r] || '';
    }
    // rutaDiariaCAN es el nombre viejo de esa ruta (antes decia CAN, ahora ZAM).
    if (!this.porRuta['Ruta Diaria']['ZAM'] && p.rutaDiariaCAN) {
      this.porRuta['Ruta Diaria']['ZAM'] = p.rutaDiariaCAN;
    }
    this.autoriza = p.autoriza || '';
    this.alCalendario = /^\d{4}-\d{2}-\d{2}$/.test(String(this.vigenciaAl || '')) ? this.vigenciaAl : '';
    this.vista.set('captura');
    if (this.pasoDesbloqueado(3)) this.sembrarMecanica();
    this.paso.set(this.pasoDesbloqueado(3) ? 3 : (this.pasoDesbloqueado(2) ? 2 : 1));
  }

  volverALista() { this.vista.set('lista'); this.promoSeguimiento = null; this.cargarTodo(); }

  // ================= Seguimiento y ranking =================
  /** Abre los expedientes (evidencia por sucursal) de una promoción. */
  abrirSeguimiento(p: any) {
    this.promoSeguimiento = p;
    this.vista.set('seguimiento');
  }

  /** Viene del seguimiento: abre el formato en el paso 3 (donde se eligen). */
  marcarSucursalesEnFormato() {
    const p = this.promoSeguimiento;
    if (!p) return;
    this.abrir(p);
    if (this.pasoDesbloqueado(3)) this.paso.set(3);
  }

  async abrirRanking() {
    this.vista.set('ranking');
    // Se pinta de una con lo que el KPI ya tenia y luego se refresca: asi la
    // pantalla no arranca en blanco cuando ya conocemos las cifras.
    if (this.kpi().general.length) this.ranking.set(this.kpi());
    this.cargandoRanking.set(true);
    try {
      const r = await this.api.get('/api/promo-expedientes?ranking=1');
      const fresco = { general: r?.general || [], porCanal: r?.porCanal || [] };
      this.ranking.set(fresco);
      this.kpi.set(fresco);
    } catch (e: any) {
      Swal.fire({
        icon: 'error', title: 'No se pudo cargar el ranking',
        text: e?.message || 'Revisa tu conexión.', confirmButtonColor: 'var(--action)'
      });
    } finally {
      this.cargandoRanking.set(false);
    }
  }

  /** El ranking por sucursal, agrupado por canal (ya viene ordenado del servidor). */
  rankingAgrupado = computed<{ canal: string; promos: any[] }[]>(() => {
    const grupos: { canal: string; promos: any[] }[] = [];
    for (const r of this.ranking().porCanal) {
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.canal === r.canal) ultimo.promos.push(r);
      else grupos.push({ canal: r.canal, promos: [r] });
    }
    return grupos;
  });

  // ================= KPI de la lista (solo para quien captura formatos) =================
  /**
   * Las promociones que mas se han vendido, de todas las sucursales juntas.
   *
   * Se recortan a tres a proposito: es un KPI de un vistazo, no el ranking. El
   * ranking completo sigue a un boton de distancia y ahi salen las 200.
   */
  kpiTop = computed(() => this.kpi().general.slice(0, 3));

  /**
   * La promocion que mas se vende en CADA sucursal.
   *
   * `porCanal` ya viene del servidor ordenado por canal y, dentro de cada uno,
   * por piezas: la primera de cada canal es la que gana ahi. Asi no hay que
   * ordenar nada aqui ni pedir otra consulta.
   */
  kpiPorSucursal = computed<any[]>(() => {
    const vistos = new Set<string>();
    const mejores: any[] = [];
    for (const r of this.kpi().porCanal) {
      if (vistos.has(r.canal)) continue;
      vistos.add(r.canal);
      mejores.push(r);
    }
    return mejores;
  });

  /** Lo vendido en total, para el encabezado del KPI. */
  kpiTotales = computed(() => {
    const g = this.kpi().general;
    return {
      piezas: g.reduce((s, r) => s + (r.piezas || 0), 0),
      importe: g.reduce((s, r) => s + (r.importe || 0), 0),
      tickets: g.reduce((s, r) => s + (r.tickets || 0), 0),
      sucursales: this.kpiPorSucursal().length,
    };
  });

  /** ¿Ya hay ventas que enseñar? Sin esto el KPI sale vacío y estorba. */
  kpiHayDatos = computed(() => this.kpi().general.some(r => (r.piezas || 0) > 0));

  /** El avance de una promoción para la tarjeta de la lista. */
  avanceDe(p: any): any {
    const r = this.resumen()[p?.id];
    const canales = Object.keys(p?.canales || {}).filter(c => p.canales[c] === true).length;
    return {
      canales,
      expedientes: r?.expedientes || 0,
      completos: r?.completos || 0,
      piezas: r?.piezas || 0,
      importe: r?.importe || 0,
      tickets: r?.tickets || 0,
    };
  }

  /** Qué tan avanzada va, en porcentaje, para la barra de la tarjeta. */
  porcentaje(p: any): number {
    const a = this.avanceDe(p);
    if (!a.canales) return 0;
    return Math.round((a.completos / a.canales) * 100);
  }

  pesos(n: any): string {
    const v = Number(n || 0);
    return '$' + v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Estado que se guarda, para saber en que quedo cada promocion. */
  private estadoActual(): string {
    if (this.pasoDesbloqueado(3)) return 'paso3';
    if (this.pasoDesbloqueado(2)) return 'paso2';
    return 'paso1';
  }

  async guardar(avanzarA?: 1 | 2 | 3) {
    // Quien solo llena expedientes ve el formato, pero no lo guarda. Aqui ni
    // deberia llegar (los botones no le salen); el servidor lo rechaza igual.
    if (!this.puedeFormato) return;
    if (avanzarA === 3) this.sembrarMecanica();

    // Las sucursales se eligen AQUI, al dar de alta: de los canales marcados
    // salen los expedientes del seguimiento. Guardar el formato sin ninguna deja
    // la promocion sin nada que llenar, asi que se avisa antes (no se bloquea:
    // a veces se captura a medias y se completa despues).
    if (this.paso() === 3 && !this.cuantosCanales) {
      const r = await Swal.fire({
        icon: 'warning', title: 'No marcaste sucursales',
        html: 'De los <b>canales de venta participantes</b> salen los expedientes: '
          + 'sin ninguno marcado, nadie va a poder subir la evidencia de esta promoción.',
        showCancelButton: true,
        confirmButtonText: 'Ir a marcarlas', cancelButtonText: 'Guardar así',
        confirmButtonColor: 'var(--action)',
      });
      if (r.isConfirmed) return;   // se queda en el paso 3 para marcarlas
    }
    if (!this.proveedor.trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta el proveedor', confirmButtonColor: 'var(--action)' });
      return;
    }
    if (this.subiendo() > 0) {
      Swal.fire({ icon: 'info', title: 'Espera a que terminen de subir los archivos', confirmButtonColor: 'var(--action)' });
      return;
    }

    this.guardando.set(true);
    try {
      // El proveedor se registra en el catalogo: asi la lista se arma sola.
      await this.api.post('/api/promo-proveedores', { nombre: this.proveedor.trim() })
        .catch(e => console.error('[promociones] catalogo proveedor', e));

      const cuerpo = {
        id: this.id,
        folio: this.folio,
        estado: this.estadoActual(),
        proveedor: this.proveedor.trim(),
        agenteVentas: this.agenteVentas.trim(),
        fechaNegociacion: this.fechaNegociacion,
        periodo: this.periodo,
        vigenciaDel: this.vigenciaDel,
        vigenciaAl: this.vigenciaAl,
        monto: this.monto,
        // lo que va al jsonb
        oferta: this.oferta,
        evidencias: this.evidencias,
        canales: this.canales,
        mecanica: this.mecanica,
        codigos: this.codigos.filter(c => c.codigo.trim() || c.descripcion.trim()),
        presupuestoTopado: this.presupuestoTopado,
        recurso: this.recurso,
        recursoOtros: this.recursoOtros,
        conceptos: this.conceptos,
        distribucionDe: this.distribucionDe,
        distribucionCod: this.distribucionCod,
        cargo: this.cargo,
        porCanal: this.porCanalTexto(),
        ...this.rutasPlanas(),
        autoriza: this.autoriza
      };

      const r = await this.api.post('/api/promociones', cuerpo);
      if (r?.promocion?.folio) this.folio = r.promocion.folio;
      await this.api.get('/api/promo-proveedores')
        .then(x => this.proveedores.set(x?.proveedores || [])).catch(() => { });

      if (avanzarA && this.pasoDesbloqueado(avanzarA)) this.paso.set(avanzarA);
      else if (!avanzarA) {
        Swal.fire({ icon: 'success', title: 'Guardado', timer: 1200, showConfirmButton: false });
      }
    } catch (e: any) {
      Swal.fire({
        icon: 'error', title: 'No se pudo guardar',
        text: e?.message || 'Revisa tu conexión e inténtalo de nuevo.',
        confirmButtonColor: 'var(--action)'
      });
    } finally {
      this.guardando.set(false);
    }
  }

  async eliminar(p: any) {
    if (!this.puedeFormato) return;
    const r = await Swal.fire({
      icon: 'warning', title: '¿Quitar esta promoción?',
      text: `Folio ${p.folio ?? '(sin folio)'} · ${p.proveedor || ''}. Se puede recuperar después.`,
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar',
      confirmButtonColor: 'var(--bad-fg)'
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.del('/api/promociones?id=' + encodeURIComponent(p.id));
      this.cargarTodo();
    } catch (e: any) {
      Swal.fire({ icon: 'error', title: 'No se pudo quitar', text: e?.message || '', confirmButtonColor: 'var(--action)' });
    }
  }

  // ================= Evidencia =================
  async alElegirArchivos(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files || []);
    input.value = '';   // permite volver a elegir el mismo archivo
    for (const a of archivos) await this.subirUno(a);
  }

  private async subirUno(archivo: File) {
    const pesado = this.nube.revisarPeso(archivo);
    if (pesado) {
      Swal.fire({
        icon: 'warning', title: 'Archivo demasiado pesado',
        text: pesado, confirmButtonColor: 'var(--action)'
      });
      return;
    }

    this.subiendo.set(this.subiendo() + 1);
    try {
      // La subida vive en CloudinaryService: el seguimiento sube evidencia desde
      // otras pantallas y la cuenta y el preset no pueden andar copiados.
      this.evidencias = [...this.evidencias, await this.nube.subir(archivo)];
    } catch (e: any) {
      Swal.fire({
        icon: 'error', title: 'No se pudo subir el archivo',
        text: `"${archivo.name}": ${e?.message || 'revisa tu conexión'}`,
        confirmButtonColor: 'var(--action)'
      });
    } finally {
      this.subiendo.set(this.subiendo() - 1);
    }
  }

  quitarEvidencia(i: number) {
    this.evidencias = this.evidencias.filter((_, k) => k !== i);
  }

  esImagen(e: Evidencia): boolean {
    if ((e.tipo || '').startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|avif)$/i.test(e.nombre || '');
  }

  // ================= Ayudas de la vista =================
  canalMarcado(c: string): boolean { return this.canales[c] === true; }
  alternarCanal(c: string) { this.canales[c] = !this.canales[c]; }

  /** Cuántas sucursales lleva marcadas. De aquí salen los expedientes. */
  get cuantosCanales(): number {
    return this.CANALES.filter(c => this.canales[c] === true).length;
  }

  get proveedoresSugeridos(): any[] {
    const q = this.proveedor.trim().toLowerCase();
    const todos = this.proveedores();
    if (!q) return todos.slice(0, 8);
    return todos.filter(p => (p.nombre || '').toLowerCase().includes(q)).slice(0, 8);
  }

  elegirProveedor(nombre: string) { this.proveedor = nombre; }

  // ---- Códigos de promoción (tantos como hagan falta) ----
  agregarCodigo() {
    if (this.codigos.length >= this.MAX_CODIGOS) return;
    this.codigos = [...this.codigos, { codigo: '', descripcion: '' }];
  }

  /** Quita el renglón. Siempre queda al menos uno, para no dejar la tabla vacía. */
  quitarCodigo(i: number) {
    if (this.codigos.length <= 1) { this.codigos = [{ codigo: '', descripcion: '' }]; return; }
    this.codigos = this.codigos.filter((_, k) => k !== i);
  }

  // ---- Desglose de cajas/piezas por canal ----
  /** Texto guardado -> renglones editables (siempre al menos uno). */
  private aRenglones(texto: any): { v: string }[] {
    const l = String(texto == null ? '' : texto)
      .split('\n').map(x => x.trim()).filter(Boolean);
    return l.length ? l.map(v => ({ v })) : [{ v: '' }];
  }

  /** Renglones editables -> lo que se guarda: un texto por canal. */
  private porCanalTexto(): Record<string, string> {
    const salida: Record<string, string> = {};
    for (const c of this.CANALES) {
      const t = (this.porCanalLineas[c] || [])
        .map(l => (l.v || '').trim()).filter(Boolean).join('\n');
      if (t) salida[c] = t;
    }
    return salida;
  }

  /** ¿Este canal se captura por rutas (LP/ZAM/MOR) en vez de un renglon? */
  esPorRuta(canal: string): boolean {
    return CANALES_POR_RUTA[canal] !== undefined;
  }

  /** Las rutas como se guardan en la base: { rutaDiariaLP: '...', mayoreoLP: '...' }. */
  private rutasPlanas(): Record<string, string> {
    const salida: Record<string, string> = {};
    for (const [canal, prefijo] of Object.entries(CANALES_POR_RUTA)) {
      for (const r of RUTAS) salida[prefijo + r] = (this.porRuta[canal]?.[r] || '').trim();
    }
    return salida;
  }

  /**
   * Lo que quedo capturado en el renglon unico de un canal que AHORA va por
   * rutas (le paso a Mayoreo al partirlo en LP/ZAM/MOR).
   *
   * Se conserva a proposito: si alguien ya habia escrito ahi, ese texto no puede
   * desaparecer del formato nomas porque cambio la captura. Se sigue imprimiendo
   * mientras las rutas esten vacias, y en pantalla se avisa para poder moverlo.
   */
  textoViejoDeCanal(canal: string): string {
    if (!this.esPorRuta(canal)) return '';
    if (this.textoDeRutas(canal)) return '';   // ya se capturo por ruta: manda eso
    return (this.porCanalLineas[canal] || [])
      .map(l => (l.v || '').trim()).filter(Boolean).join(' ');
  }

  /** Lo de un canal por rutas, ya armado para el PDF: un renglon por ruta. */
  private textoDeRutas(canal: string): string {
    return RUTAS
      .map(r => {
        const v = (this.porRuta[canal]?.[r] || '').trim();
        return v ? r + ': ' + v : '';
      })
      .filter(Boolean).join('\n');
  }

  agregarRenglon(canal: string) {
    this.porCanalLineas[canal] = [...(this.porCanalLineas[canal] || []), { v: '' }];
  }

  quitarRenglon(canal: string, i: number) {
    const l = (this.porCanalLineas[canal] || []).filter((_, k) => k !== i);
    this.porCanalLineas[canal] = l.length ? l : [{ v: '' }];
  }

  /** El calendario del campo "Al" solo escribe la fecha en el campo de texto:
   *  ese campo también acepta texto libre ("Agotar Producto Asignado"). */
  alElegirFechaAl(fecha: string) {
    this.alCalendario = fecha || '';
    if (fecha) this.vigenciaAl = fecha;
  }

  etiquetaEstado(e: string): string {
    return { paso1: 'Solo proveedor', paso2: 'Con oferta', paso3: 'Formato completo', cerrada: 'Cerrada' }[e] || e || '—';
  }

  folioTexto(f: number | null | undefined): string {
    if (f == null) return '—';
    return String(f).padStart(4, '0');
  }

  // ================= El PDF =================
  /**
   * El logo que va en el encabezado del PDF. Se toma del icono de la propia app
   * (public/icons), asi no hay que subir otra copia ni depender de internet: el
   * archivo ya viene con la app y el service worker lo tiene guardado.
   *
   * Se recuerda en memoria para no volver a leerlo en cada descarga, y si por lo
   * que sea no se puede leer regresa null: el PDF sale igual, nomas sin imagen.
   */
  private logoGuardado: string | null | undefined;

  private async cargarLogo(): Promise<string | null> {
    if (this.logoGuardado !== undefined) return this.logoGuardado;
    try {
      const r = await fetch('/icons/icon-512x512.png');
      if (!r.ok) { this.logoGuardado = null; return null; }
      const imagen = await r.blob();
      const plano = await new Promise<string>((listo, falla) => {
        const lector = new FileReader();
        lector.onload = () => listo(String(lector.result));
        lector.onerror = () => falla(new Error('no se pudo leer el logo'));
        lector.readAsDataURL(imagen);
      });
      // Si el recorte falla por lo que sea, se usa el icono tal cual: mas vale
      // el logo grandote y el archivo pesado que un formato sin logo.
      try { this.logoGuardado = await this.recortarLogo(plano); }
      catch { this.logoGuardado = plano; }
    } catch {
      this.logoGuardado = null;
    }
    return this.logoGuardado ?? null;
  }

  /**
   * El icono de la app trae mucho margen vacio alrededor del circulo. Metido tal
   * cual, el logo se veia chiquito en la hoja y el PDF pesaba mas de 1 MB (512x512
   * sin comprimir), y estos formatos se mandan por correo.
   *
   * Aqui se busca donde empieza y acaba el dibujo de verdad, se recorta cuadrado
   * para no deformarlo y se baja a 256 px, de sobra para los 13 mm impresos.
   */
  private recortarLogo(dataUrl: string): Promise<string> {
    return new Promise((listo, falla) => {
      const img = new Image();
      img.onerror = () => falla(new Error('no se pudo cargar el logo'));
      img.onload = () => {
        const an = img.naturalWidth, al = img.naturalHeight;
        const lienzo = document.createElement('canvas');
        lienzo.width = an; lienzo.height = al;
        const ctx = lienzo.getContext('2d');
        if (!ctx || !an || !al) return falla(new Error('sin lienzo'));
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, an, al).data;

        let x1 = an, y1 = al, x2 = -1, y2 = -1;
        for (let y = 0; y < al; y++) {
          for (let x = 0; x < an; x++) {
            const i = (y * an + x) * 4;
            // Margen = transparente o practicamente blanco
            if (px[i + 3] < 12) continue;
            if (px[i] > 244 && px[i + 1] > 244 && px[i + 2] > 244) continue;
            if (x < x1) x1 = x;
            if (x > x2) x2 = x;
            if (y < y1) y1 = y;
            if (y > y2) y2 = y;
          }
        }
        if (x2 < 0) return falla(new Error('el logo salio vacio'));

        // Cuadrado centrado en el dibujo, con un pelo de aire alrededor
        const lado = Math.max(x2 - x1 + 1, y2 - y1 + 1) * 1.04;
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;

        const LADO_FINAL = 256;
        const destino = document.createElement('canvas');
        destino.width = destino.height = LADO_FINAL;
        const c2 = destino.getContext('2d');
        if (!c2) return falla(new Error('sin lienzo de salida'));
        c2.fillStyle = '#ffffff';
        c2.fillRect(0, 0, LADO_FINAL, LADO_FINAL);
        c2.drawImage(img, cx - lado / 2, cy - lado / 2, lado, lado, 0, 0, LADO_FINAL, LADO_FINAL);
        listo(destino.toDataURL('image/png'));
      };
      img.src = dataUrl;
    });
  }

  /**
   * Arma el formato MKTN001 en PDF, con la misma estructura del papel: barras
   * azules de titulo, los campos del encabezado, las casillas de canales, la
   * mecanica, los codigos, el presupuesto, la manera de pago, la distribucion
   * por canal y las dos firmas.
   *
   * jspdf se carga al vuelo: pesa, y no tiene por que viajar en el arranque de
   * la app para los 154 que nunca abren este apartado.
   */
  async descargarPdf() {
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });

      const AZUL: [number, number, number] = [31, 78, 121];
      const AZUL_CLARO: [number, number, number] = [222, 235, 247];
      // El folio va en ROJO, como el numerado del bloque impreso.
      const ROJO: [number, number, number] = [199, 56, 46];
      const M = 10;                        // margen
      const W = 210 - M * 2;               // ancho util
      let y = M;

      const barra = (texto: string, alto = 7) => {
        doc.setFillColor(...AZUL); doc.rect(M, y, W, alto, 'F');
        doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
        doc.text(texto, 105, y + alto - 2.2, { align: 'center' });
        doc.setTextColor(0); y += alto;
      };

      /** Etiqueta azul a la izquierda y su valor en una caja. */
      const campo = (etiqueta: string, valor: string, anchoEtiqueta = 45, alto = 6.5) => {
        doc.setFillColor(...AZUL); doc.rect(M, y, anchoEtiqueta, alto, 'F');
        doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
        doc.text(etiqueta.toUpperCase(), M + 1.5, y + alto - 2.3);
        doc.setDrawColor(150); doc.rect(M + anchoEtiqueta, y, W - anchoEtiqueta, alto);
        doc.setTextColor(0); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        doc.text(String(valor || ''), M + anchoEtiqueta + 2, y + alto - 2.2);
        y += alto;
      };

      /** Bloque de texto con su etiqueta arriba, que crece con el contenido. */
      const bloque = (texto: string, altoMin = 10) => {
        const lineas = doc.splitTextToSize(String(texto || ''), W - 4);
        const alto = Math.max(altoMin, lineas.length * 4 + 3);
        doc.setDrawColor(150); doc.rect(M, y, W, alto);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(0);
        doc.text(lineas, M + 2, y + 4.5);
        y += alto;
      };

      const casilla = (x: number, yy: number, marcada: boolean, etiqueta: string, ancho = 0) => {
        doc.setDrawColor(80); doc.rect(x, yy, 3.2, 3.2);
        if (marcada) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...AZUL);
          doc.text('X', x + 0.6, yy + 2.7);
        }
        doc.setTextColor(0); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        doc.text(etiqueta, x + 4.2, yy + 2.6);
        return x + 4.2 + (ancho || doc.getTextWidth(etiqueta) + 3);
      };

      // ---------- Encabezado ----------
      // El logo se lleva una columna a la izquierda y lo demas del encabezado se
      // recorre: las tres cajas reparten el ancho que queda (Wenc), no el total,
      // para que no se salgan de la hoja.
      const logo = await this.cargarLogo();
      const ALTO_ENC = 13;
      const COL_LOGO = logo ? 16 : 0;
      if (logo) doc.addImage(logo, 'PNG', M, y, ALTO_ENC, ALTO_ENC);

      const xEnc = M + COL_LOGO;
      const Wenc = W - COL_LOGO;
      const medio = y + ALTO_ENC / 2;

      doc.setFillColor(...AZUL); doc.rect(xEnc, y, Wenc * 0.52, ALTO_ENC, 'F');
      doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text('APOYO PARA SELL OUT', xEnc + 3, medio + 1.6);
      doc.setDrawColor(...AZUL); doc.rect(xEnc + Wenc * 0.53, y, Wenc * 0.23, ALTO_ENC);
      doc.setTextColor(...AZUL); doc.setFontSize(9);
      doc.text('FORMATO: MKTN001', xEnc + Wenc * 0.535 + 1, medio + 1.2);
      doc.rect(xEnc + Wenc * 0.77, y, Wenc * 0.23, ALTO_ENC);
      doc.setFontSize(11);
      // La palabra "Folio:" en azul y el NUMERO en rojo, como el papel numerado.
      const xFolio = xEnc + Wenc * 0.785;
      doc.text('Folio:', xFolio, medio + 1.4);
      doc.setTextColor(...ROJO);
      doc.text(this.folioTexto(this.folio), xFolio + doc.getTextWidth('Folio: '), medio + 1.4);
      doc.setTextColor(0);
      y += ALTO_ENC + 2;

      campo('Fecha de negociación:', this.fechaNegociacion);
      campo('Proveedor / Marca:', this.proveedor);
      campo('Agente de ventas:', this.agenteVentas);
      y += 1.5;

      // Periodo / Del / Al en un renglon
      const alto = 6.5; const tercio = W / 3;
      const trio = [['PERIODO:', this.periodo], ['DEL:', this.vigenciaDel], ['AL:', this.vigenciaAl]];
      trio.forEach(([et, val], i) => {
        const x = M + tercio * i;
        doc.setFillColor(...AZUL); doc.rect(x, y, 20, alto, 'F');
        doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
        doc.text(String(et), x + 1.5, y + alto - 2.3);
        doc.setDrawColor(150); doc.rect(x + 20, y, tercio - 20, alto);
        doc.setTextColor(0); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        doc.text(String(val || ''), x + 22, y + alto - 2.2);
      });
      y += alto + 2;

      // ---------- Canales ----------
      barra('CANALES DE VENTA PARTICIPANTES', 6);

      // Los 11 canales se reparten en renglones ANTES de dibujar. Al principio
      // solo reiniciaba la posición horizontal sin bajar de renglón, y el último
      // canal se encimaba sobre el primero.
      doc.setFontSize(7);
      const anchoItem = (c: string) => 4.2 + doc.getTextWidth(c) + 5;
      const renglones: string[][] = [[]];
      let usado = 0;
      for (const c of this.CANALES) {
        const w = anchoItem(c);
        if (usado + w > W - 4 && renglones[renglones.length - 1].length) {
          renglones.push([]); usado = 0;
        }
        renglones[renglones.length - 1].push(c);
        usado += w;
      }

      const altoCanales = renglones.length * 5 + 2;
      doc.setFillColor(...AZUL_CLARO); doc.rect(M, y, W, altoCanales, 'F');
      let yCanal = y + 2;
      for (const renglon of renglones) {
        let x = M + 2;
        for (const c of renglon) x = casilla(x, yCanal, this.canalMarcado(c), c);
        yCanal += 5;
      }
      y += altoCanales;
      doc.setFontSize(6.5); doc.setTextColor(90);
      doc.text('Apoyo para desplazar inventario, Apoyo por Volumen, Actividad en punto de Venta, Concurso etc.',
        105, y + 3, { align: 'center' });
      doc.setTextColor(0); y += 5;

      // ---------- Mecánica ----------
      barra('MECÁNICA', 6);
      bloque(this.mecanica, 14);
      y += 2;

      // ---------- Códigos ----------
      barra('CÓDIGOS DE PROMOCIÓN', 6);
      const usados = this.codigos.filter(c => c.codigo || c.descripcion);
      const filas = Math.max(1, Math.ceil(usados.length / 2));
      for (let f = 0; f < filas; f++) {
        // Ya no son fijos 6: si se capturaron 15 o 20, la tabla puede pasar de hoja.
        if (y + 5.5 > 285) { doc.addPage(); y = M; }
        for (let col = 0; col < 2; col++) {
          const c = usados[f * 2 + col];
          const xx = M + (W / 2) * col;
          doc.setDrawColor(150);
          doc.rect(xx, y, 8, 5.5);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...AZUL);
          doc.text(String(f * 2 + col + 1), xx + 3, y + 3.9);
          doc.setTextColor(0); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
          doc.rect(xx + 8, y, (W / 2) - 8, 5.5);
          if (c) doc.text(`${c.codigo || ''}   ${c.descripcion || ''}`.trim(), xx + 10, y + 3.8);
        }
        y += 5.5;
      }
      y += 2;

      // ---------- Presupuesto ----------
      barra('PRESUPUESTO', 6);
      doc.setFillColor(...AZUL_CLARO); doc.rect(M, y, W, 5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...AZUL);
      doc.text('Topado', 105, y + 3.5, { align: 'center' });
      doc.setTextColor(0); y += 5;
      bloque(this.presupuestoTopado, 10);
      y += 2;

      // ---------- Manera de pago ----------
      doc.setFillColor(...AZUL); doc.rect(M, y, 42, 22, 'F');
      doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.text(['Tache la Aplicable', 'RECURSO QUE', 'SE UTILIZA', '(MANERA DE PAGO)'], M + 2, y + 5);
      doc.setTextColor(0);
      doc.setDrawColor(150); doc.rect(M + 42, y, W - 42, 22);
      let yr = y + 3.2;
      for (const r of this.RECURSOS) {
        const marcada = this.recurso === r;
        const etiqueta = r === 'Otros'
          ? 'Otros (Especifique): ' + (this.recursoOtros || '')
          : r;
        casilla(M + 45, yr, marcada, etiqueta);
        yr += 4;
      }
      y += 23;

      // ---------- Conceptos ----------
      doc.setFillColor(...AZUL); doc.rect(M, y, 42, 12, 'F');
      doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.text(['CONCEPTOS DEL', 'PRESUPUESTO DE', 'MERCADOTECNIA'], M + 2, y + 4);
      doc.setTextColor(0);
      const conceptoTexto = (this.conceptos || '') +
        (this.monto != null ? `   $${Number(this.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '');
      const lc = doc.splitTextToSize(conceptoTexto, W - 46);
      doc.setDrawColor(150); doc.rect(M + 42, y, W - 42, 12);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(lc.slice(0, 3), M + 44, y + 4);
      y += 13;

      // ---------- Distribución ----------
      campo('Distribución de cajas de:', this.distribucionDe, 45, 6);
      campo('Cód:', this.distribucionCod, 45, 6);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
      casilla(M + 2, y + 1.5, this.cargo === 'con', 'CON CARGO');
      casilla(M + 45, y + 1.5, this.cargo === 'sin', 'SIN CARGO');
      y += 7;

      // ---------- Tabla por canal ----------
      doc.setFillColor(...AZUL); doc.rect(M, y, W, 5.5, 'F');
      doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
      doc.text('CANAL DE VENTA', M + 2, y + 3.9);
      doc.text('NÚMERO DE CAJAS O PIEZAS', M + 55, y + 3.9);
      doc.setTextColor(0); y += 5.5;

      const desglosado = this.porCanalTexto();
      for (const c of this.CANALES) {
        // Ruta Diaria y Mayoreo se reparten en sus tres rutas, una por renglon;
        // los demas canales llevan el desglose tal como se capturo.
        const texto = this.esPorRuta(c)
          // Si todavia no se captura por ruta, sale lo que se habia escrito antes.
          ? (this.textoDeRutas(c) || this.textoViejoDeCanal(c))
          : (desglosado[c] || '');
        const lineas = doc.splitTextToSize(String(texto), W - 55);
        const h = Math.max(5, lineas.length * 3.4 + 1.6);
        if (y + h > 285) { doc.addPage(); y = M; }
        doc.setFillColor(...AZUL_CLARO); doc.rect(M, y, 45, h, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...AZUL);
        doc.text(c, M + 1.5, y + 3.6);
        doc.setTextColor(0); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        doc.setDrawColor(150); doc.rect(M + 45, y, W - 45, h);
        doc.text(lineas, M + 47, y + 3.4);
        y += h;
      }
      y += 6;

      // ---------- Firmas ----------
      if (y > 265) { doc.addPage(); y = M + 10; }
      const mitad = (W - 6) / 2;
      doc.setDrawColor(...AZUL);
      doc.roundedRect(M, y, mitad, 16, 2, 2);
      doc.roundedRect(M + mitad + 6, y, mitad, 16, 2, 2);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...AZUL);
      doc.text('Agente de Ventas', M + mitad / 2, y + 13, { align: 'center' });
      doc.text('Mega Dulces de los Altos', M + mitad + 6 + mitad / 2, y + 13, { align: 'center' });
      if (this.autoriza) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(20);
        doc.text(this.autoriza, M + mitad + 6 + mitad / 2, y + 7, { align: 'center' });
      }
      if (this.agenteVentas) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(20);
        doc.text(this.agenteVentas, M + mitad / 2, y + 7, { align: 'center' });
      }

      // El folio puede no estar todavía (se asigna al guardar). Sin esto el
      // archivo salía llamándose "MKTN001-—-Canels.pdf", con guion largo.
      const folioArchivo = this.folio == null ? 'sin-folio' : this.folioTexto(this.folio);
      const nombre = `MKTN001-${folioArchivo}-${(this.proveedor || 'promocion')
        .replace(/[^\wáéíóúñÁÉÍÓÚÑ -]/g, '').trim().replace(/\s+/g, '-')}.pdf`;
      doc.save(nombre);
    } catch (e: any) {
      Swal.fire({
        icon: 'error', title: 'No se pudo generar el PDF',
        text: e?.message || 'Inténtalo de nuevo.', confirmButtonColor: 'var(--action)'
      });
    }
  }
}
