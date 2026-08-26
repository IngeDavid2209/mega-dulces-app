import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { ApiService } from '../../../shared/api.service';
import { CloudinaryService } from '../../../shared/cloudinary.service';
import { SUCURSALES_COMERCIALES } from '../../../shared/sucursales-ubicaciones.util';

/** Una promo del piso de venta. */
interface Promo {
  id: string;
  nombre: string;
  descripcion: string;
  costo: number | null;
  fotoUrl: string;
  estado: 'activa' | 'pausada' | 'terminada';
  vigenciaDel: string;
  vigenciaAl: string;
  sucursales: string[];
  creadoPorNombre?: string;
  piezas?: number;
  importe?: number;
  vendidas?: number;
  aseguradas?: number;
  ultima?: number | null;
}

/** Un aviso de la caja. */
interface Luz {
  id: string;
  promoId: string;
  promoNombre: string;
  sucursal: string;
  tipo: 'vendida' | 'asegurada';
  piezas: number;
  importe: number;
  nota: string;
  creadoEn: number;
  creadoPorNombre: string;
}

/** Un encargo: lo que el vendedor le avisa a la caja antes de que llegue el cliente. */
interface Encargo {
  id: string;
  promoId: string;
  promoNombre: string;
  promoFotoUrl: string;
  promoCosto: number | null;
  sucursal: string;
  piezas: number;
  cliente: string;
  estado: 'pendiente' | 'confirmado' | 'cancelado';
  nota: string;
  creadoEn: number;
  creadoPorNombre: string;
  resueltoEn: number | null;
  resueltoPorNombre: string;
  motivo: string;
}

/**
 * VENTA DE PROMOS — el piso de venta, en vivo.
 *
 * Una seccion, tres oficios, y cada quien entra solo a lo suyo segun el permiso
 * que se le haya prendido en Personal:
 *
 *   CAJA      (ventaPromosCaja)      ve las promos vivas de SU sucursal y da la
 *                                    luz verde de un toque cuando la venta se
 *                                    cierra. Es la pantalla mas simple a
 *                                    proposito: se usa con un cliente enfrente.
 *   PROMOS    (ventaPromosVendedor)  da de alta la promo: nombre, descripcion,
 *                                    costo, foto y en que sucursales aplica.
 *   TABLERO   (ventaPromosMonitor)   ve lo que va entrando en vivo, por promo y
 *                                    por sucursal. Ademas le llega el aviso de la app en
 *                                    cuanto una caja da luz verde.
 *
 * Esto NO es el modulo de Promociones (formato MKTN001). Aquel es la
 * negociacion con el proveedor: folio, presupuesto, evidencia, firmas. Este es
 * el piso: que se esta vendiendo AHORA y donde.
 */
@Component({
  selector: 'app-venta-promos',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './venta-promos.html',
  styleUrls: ['./venta-promos.css'],
})
export class VentaPromosComponent implements OnInit, OnDestroy {
  currentUser: any = null;
  isMenuOpen = false;

  private router = inject(Router);
  private api = inject(ApiService);
  private nube = inject(CloudinaryService);

  readonly SUCURSALES = SUCURSALES_COMERCIALES;
  /** Tope real de Cloudinary en subida sin firma. */
  readonly MAX_ARCHIVO_MB = 10;

  // ---------------- Vista ----------------
  //   caja     el toque de luz verde
  //   promos   el alta y la lista de promos (vendedor)
  //   tablero  lo que va entrando (monitor)
  vista = signal<'caja' | 'promos' | 'tablero'>('caja');

  cargando = signal(false);
  guardando = signal(false);
  subiendo = signal(false);

  promos = signal<Promo[]>([]);
  /** Encargos de MI sucursal, para la caja. */
  encargos = signal<Encargo[]>([]);
  /** Lo que YO mandé como vendedor, para ver en qué quedó. */
  misEncargos = signal<Encargo[]>([]);
  /** Lo que devuelve el tablero del monitor. */
  panel = signal<{ porPromo: any[]; porSucursal: any[]; porVendedor: any[]; recientes: Luz[] }>({
    porPromo: [], porSucursal: [], porVendedor: [], recientes: [],
  });
  /** Ventana del tablero, en dias. */
  dias = signal(7);

  /** La sucursal desde la que la caja esta reportando. */
  sucursal = signal('');

  /** Promo abierta en el formulario de alta. null = no se esta editando. */
  edicion = signal<Promo | null>(null);

  /** Refresco del tablero mientras esta abierto. */
  private reloj: any = null;

  // ---------------- Permisos ----------------
  // Se leen de la sesion para pintar; el servidor los vuelve a revisar contra la
  // base en cada escritura, que es donde de verdad cuentan.
  // NINGUNO se le regala al rol admin. Quien solo monitorea ve el tablero y
  // nada mas: no le aparece la pantalla de caja ni la de dar de alta promos,
  // aunque sea administrador. Es lo que se pidio y es lo correcto — el que
  // vigila las ventas no es el que las captura, y darle el boton de "Se vendio"
  // a quien mide los resultados es pedir que el numero y quien lo revisa sean
  // la misma persona.
  get puedeCaja(): boolean { return this.currentUser?.ventaPromosCaja === true; }
  get puedeVender(): boolean { return this.currentUser?.ventaPromosVendedor === true; }
  get puedeMonitor(): boolean { return this.currentUser?.ventaPromosMonitor === true; }

  /** Las sucursales entre las que puede reportar quien esta en caja. */
  get misSucursales(): string[] {
    const mias: string[] = this.currentUser?.sucursales || [];
    // Acceso total o sin sucursales asignadas: puede reportar de cualquiera.
    if (!mias.length || mias.includes('General (Acceso Total)')) return this.SUCURSALES;
    const propias = this.SUCURSALES.filter(s => mias.includes(s));
    return propias.length ? propias : this.SUCURSALES;
  }

  /** ¿Este usuario alcanza TODAS las sucursales, o solo las suyas? */
  get alcanzaTodas(): boolean {
    const mias: string[] = this.currentUser?.sucursales || [];
    return !mias.length || mias.includes('General (Acceso Total)');
  }

  /**
   * Las sucursales que se pueden marcar al dar de alta una promo: SOLO las que
   * el usuario tiene asignadas. El vendedor de Padre Hidalgo no tiene por qué
   * poder publicar una promo en Morelia.
   *
   * Se suman las que la promo YA traía marcadas aunque no sean suyas. Si no, al
   * editar desaparecerían de la vista y nadie sabría que la promo también
   * aplica allá: se seguirían guardando, pero a ciegas.
   */
  get sucursalesParaLaPromo(): string[] {
    const mias = this.misSucursales;
    const yaMarcadas = this.edicion()?.sucursales || [];
    const ajenas = yaMarcadas.filter(s => !mias.includes(s));
    return ajenas.length ? [...mias, ...ajenas] : mias;
  }

  /** ¿Esta sucursal viene marcada de antes y NO es de las suyas? (se avisa). */
  esAjena(nombre: string): boolean {
    return !this.misSucursales.includes(nombre);
  }

  ngOnInit() {
    const s = localStorage.getItem('md_sesion_actual');
    if (s) { try { this.currentUser = JSON.parse(s); } catch { } }

    // Cada quien aterriza en SU pantalla. Quien solo cobra no tiene por que ver
    // primero un tablero que no puede usar.
    if (this.puedeCaja) this.vista.set('caja');
    else if (this.puedeMonitor) this.vista.set('tablero');
    else this.vista.set('promos');

    const mias = this.misSucursales;
    // Con una sola sucursal no se pregunta nada: se asume y ya.
    this.sucursal.set(mias.length === 1 ? mias[0] : (this.currentUser?.sucursales?.[0] || ''));

    this.cargar();
  }

  ngOnDestroy() { this.detenerReloj(); }

  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  // ================= Carga =================
  async cargar(silencioso = false) {
    if (!silencioso) this.cargando.set(true);
    try {
      const suc = this.sucursal();
      const r = await this.api.get('/api/promos-venta'
        + (suc ? '?sucursal=' + encodeURIComponent(suc) : ''));
      this.promos.set(r?.promos || []);
      this.encargos.set(r?.encargos || []);
      this.misEncargos.set(r?.misEncargos || []);
    } catch (e: any) {
      // En el refresco automático no se avisa: la caja está trabajando y un
      // aviso de red cada minuto encima del mostrador es insoportable.
      if (!silencioso) this.error('No se pudieron cargar las promos', e);
    } finally {
      if (!silencioso) this.cargando.set(false);
    }
  }

  /** Los encargos que la caja todavía tiene que atender. */
  pendientes = computed(() => this.encargos().filter(e => e.estado === 'pendiente'));
  /** Los ya resueltos hace poco, por si hay que deshacer uno. */
  resueltos = computed(() => this.encargos().filter(e => e.estado !== 'pendiente'));

  async cargarPanel() {
    try {
      const desde = Date.now() - this.dias() * 24 * 60 * 60 * 1000;
      const r = await this.api.get('/api/promos-venta?panel=1&desde=' + desde);
      this.panel.set({
        porPromo: r?.porPromo || [],
        porSucursal: r?.porSucursal || [],
        porVendedor: r?.porVendedor || [],
        recientes: r?.recientes || [],
      });
    } catch (e: any) {
      this.error('No se pudo cargar el tablero', e);
    }
  }

  irA(v: 'caja' | 'promos' | 'tablero') {
    this.vista.set(v);
    this.edicion.set(null);
    this.detenerReloj();
    if (v === 'tablero') { this.cargarPanel(); this.arrancarReloj(); }
    else if (v === 'caja') { this.cargar(); this.arrancarReloj(); }
    else this.cargar();
  }

  /** La caja cambió de sucursal: los encargos son otros. */
  cambiarSucursal(s: string) {
    this.sucursal.set(s);
    this.cargar();
  }

  cambiarDias(d: number) { this.dias.set(d); this.cargarPanel(); }

  /**
   * Refresco automático mientras la pantalla está abierta.
   *
   *   tablero  cada minuto: quien monitorea lo deja puesto y el chiste es ver
   *            entrar las ventas sin recargar.
   *   caja     cada 20 segundos, y más seguido a propósito: el cliente va
   *            caminando del piso al mostrador, así que el encargo tiene que
   *            estar en la pantalla ANTES de que llegue. El push ayuda, pero no
   *            se puede depender de que la cajera traiga el celular en la mano.
   */
  private arrancarReloj() {
    this.detenerReloj();
    const esCaja = this.vista() === 'caja';
    this.reloj = setInterval(
      () => esCaja ? this.cargar(true) : this.cargarPanel(),
      esCaja ? 20000 : 60000);
  }
  private detenerReloj() {
    if (this.reloj) { clearInterval(this.reloj); this.reloj = null; }
  }

  // ================= Caja: la luz verde =================
  /** Las promos que la caja puede reportar: vivas y marcadas para su sucursal. */
  promosDeCaja = computed(() => {
    const suc = this.sucursal();
    return this.promos().filter(p => {
      if (p.estado !== 'activa') return false;
      // Una promo sin sucursales marcadas aplica en todas: es lo que se espera
      // de una promo general, y obliga menos al que la da de alta.
      if (!p.sucursales?.length) return true;
      return p.sucursales.includes(suc);
    });
  });

  /**
   * El toque de luz verde.
   *
   * Pregunta lo MINIMO: cuantas piezas. El importe se calcula solo con el costo
   * de la promo, porque quien esta en caja tiene un cliente enfrente y cada
   * campo de mas es una razon para no usar esto.
   */
  async luzVerde(promo: Promo, tipo: 'vendida' | 'asegurada') {
    if (!this.sucursal()) {
      Swal.fire({
        icon: 'warning', title: 'Falta la sucursal',
        text: 'Elige desde qué sucursal estás reportando.',
        confirmButtonColor: '#0F172A',
      });
      return;
    }

    const r = await Swal.fire({
      title: tipo === 'vendida' ? '¿Cuántas se vendieron?' : '¿Cuántas apartó?',
      html: `<div style="font-size:13px;color:#64748B;margin-bottom:10px">${promo.nombre}</div>`,
      input: 'number',
      inputValue: 1,
      inputAttributes: { min: '1', step: '1' },
      showCancelButton: true,
      confirmButtonText: tipo === 'vendida' ? 'Dar luz verde' : 'Apartar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: tipo === 'vendida' ? '#1F7A4D' : '#B45309',
    });
    if (!r.isConfirmed) return;

    const piezas = Math.max(1, Math.round(Number(r.value) || 1));

    this.guardando.set(true);
    try {
      await this.api.post('/api/promos-venta', {
        accion: 'luzVerde',
        promoId: promo.id,
        sucursal: this.sucursal(),
        tipo, piezas,
      });
      await Swal.fire({
        icon: 'success',
        title: tipo === 'vendida' ? '🟢 Luz verde enviada' : 'Apartado registrado',
        text: 'Ya le llegó a quien monitorea.',
        timer: 1400, showConfirmButton: false,
      });
      this.cargar();
    } catch (e: any) {
      this.error('No se pudo enviar la luz verde', e);
    } finally {
      this.guardando.set(false);
    }
  }

  // ================= Vendedor: mandar la venta a caja =================
  /**
   * El vendedor cerró el trato en el piso y se lo avisa a la caja.
   *
   * Pide lo mínimo que la cajera necesita para reconocer al cliente cuando
   * llegue: cuántas y a nombre de quién. El importe no se pregunta — sale del
   * costo de la promo al confirmarse.
   */
  async vender(promo: Promo) {
    const sucursales = this.misSucursales;
    let suc = this.sucursal() || (sucursales.length === 1 ? sucursales[0] : '');

    // Si la promo solo aplica en unas sucursales, la venta tiene que ser en una
    // de esas: mandarle a Morelia un encargo de una promo que ahí no existe
    // deja a la cajera sin poder confirmarlo y al cliente esperando.
    const validas = promo.sucursales?.length
      ? sucursales.filter(s => promo.sucursales.includes(s))
      : sucursales;

    if (!validas.length) {
      Swal.fire({
        icon: 'warning', title: 'Esta promo no aplica en tus sucursales',
        text: 'Pídele a quien la dio de alta que la habilite donde la vas a vender.',
        confirmButtonColor: '#0F172A',
      });
      return;
    }
    if (!suc || !validas.includes(suc)) suc = validas[0];

    const opciones = validas.map(s =>
      `<option value="${s}" ${s === suc ? 'selected' : ''}>${s}</option>`).join('');

    const r = await Swal.fire({
      title: 'Mandar a caja',
      html:
        `<div style="font-size:13px;color:#64748B;margin-bottom:14px">${promo.nombre}</div>` +
        `<label style="display:block;text-align:left;font-size:12px;font-weight:700;color:#64748B;margin-bottom:4px">¿CUÁNTAS?</label>` +
        `<input id="vp-piezas" type="number" min="1" step="1" value="1" class="swal2-input" style="margin:0 0 14px;width:100%">` +
        `<label style="display:block;text-align:left;font-size:12px;font-weight:700;color:#64748B;margin-bottom:4px">NOMBRE DEL CLIENTE</label>` +
        `<input id="vp-cliente" type="text" maxlength="80" placeholder="Para que la caja lo reconozca" class="swal2-input" style="margin:0 0 14px;width:100%">` +
        (validas.length > 1
          ? `<label style="display:block;text-align:left;font-size:12px;font-weight:700;color:#64748B;margin-bottom:4px">SUCURSAL</label>` +
            `<select id="vp-suc" class="swal2-input" style="margin:0;width:100%">${opciones}</select>`
          : `<input id="vp-suc" type="hidden" value="${suc}">`),
      showCancelButton: true,
      confirmButtonText: 'Mandar a caja',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#1F4E79',
      focusConfirm: false,
      preConfirm: () => {
        const piezas = Math.max(1, Math.round(
          Number((document.getElementById('vp-piezas') as HTMLInputElement)?.value) || 1));
        const cliente = String(
          (document.getElementById('vp-cliente') as HTMLInputElement)?.value || '').trim();
        const sucursal = String(
          (document.getElementById('vp-suc') as HTMLInputElement | HTMLSelectElement)?.value || '');
        if (!cliente) {
          Swal.showValidationMessage('Escribe el nombre del cliente: es como la caja lo va a identificar.');
          return false;
        }
        return { piezas, cliente, sucursal };
      },
    });
    if (!r.isConfirmed || !r.value) return;

    this.guardando.set(true);
    try {
      await this.api.post('/api/promos-venta', {
        accion: 'encargar',
        promoId: promo.id,
        sucursal: r.value.sucursal,
        piezas: r.value.piezas,
        cliente: r.value.cliente,
      });
      await Swal.fire({
        icon: 'success', title: 'Mandado a caja',
        text: `${r.value.cliente} · ${r.value.piezas} pza(s). La cajera lo confirma cuando pase a pagar.`,
        timer: 2200, showConfirmButton: false,
      });
      this.cargar();
    } catch (e: any) {
      this.error('No se pudo mandar a caja', e);
    } finally {
      this.guardando.set(false);
    }
  }

  // ================= Caja: atender los encargos =================
  /** El cliente llegó y sí se las llevó. Esto es lo que genera la venta. */
  async confirmarEncargo(e: Encargo) {
    this.guardando.set(true);
    try {
      await this.api.post('/api/promos-venta', { accion: 'confirmarEncargo', encargoId: e.id });
      await Swal.fire({
        icon: 'success', title: '🟢 Venta confirmada',
        text: `${e.cliente || 'Cliente'} · ${e.piezas} × ${e.promoNombre}`,
        timer: 1500, showConfirmButton: false,
      });
      this.cargar();
    } catch (err: any) {
      this.error('No se pudo confirmar', err);
      this.cargar();   // otra caja pudo haberlo tomado; se refresca para verlo
    } finally {
      this.guardando.set(false);
    }
  }

  /** El cliente se arrepintió, o el encargo estaba mal. No cuenta como venta. */
  async cancelarEncargo(e: Encargo) {
    const r = await Swal.fire({
      title: '¿El cliente no se las llevó?',
      html: `<div style="font-size:13px;color:#64748B">${e.cliente || 'Cliente'} · ${e.piezas} × ${e.promoNombre}</div>`,
      input: 'text',
      inputPlaceholder: '¿Por qué? (opcional)',
      showCancelButton: true,
      confirmButtonText: 'No se las llevó',
      cancelButtonText: 'Volver',
      confirmButtonColor: '#C7382E',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.post('/api/promos-venta', {
        accion: 'cancelarEncargo', encargoId: e.id, motivo: r.value || '',
      });
      this.cargar();
    } catch (err: any) {
      this.error('No se pudo cancelar', err);
      this.cargar();
    }
  }

  /** Cuánto lleva esperando un encargo. Lo que la caja mira de reojo. */
  esperando(e: Encargo): string { return this.hace(e.creadoEn); }

  /** Un encargo que lleva demasiado sin atenderse: o el cliente ya se fue, o
   *  nadie lo vio. Se pinta distinto para que salte a la vista. */
  esViejo(e: Encargo): boolean {
    return e.estado === 'pendiente' && (Date.now() - e.creadoEn) > 45 * 60 * 1000;
  }

  // ================= Vendedor: alta de promos =================
  nueva() {
    this.edicion.set({
      id: '', nombre: '', descripcion: '', costo: null, fotoUrl: '',
      estado: 'activa', vigenciaDel: '', vigenciaAl: '',
      // A quien solo maneja unas sucursales se le marcan las suyas de entrada:
      // es lo que va a querer el 99% de las veces, y evita el descuido de dejar
      // la lista vacía (que significa "todas") sin haberlo pensado.
      sucursales: this.alcanzaTodas ? [] : [...this.misSucursales],
    });
  }

  editar(p: Promo) {
    this.edicion.set({ ...p, sucursales: [...(p.sucursales || [])] });
  }

  cancelarEdicion() { this.edicion.set(null); }

  /** Marca/desmarca una sucursal en la promo que se esta capturando. */
  alternarSucursal(nombre: string) {
    const e = this.edicion();
    if (!e) return;
    const lista = e.sucursales.includes(nombre)
      ? e.sucursales.filter(s => s !== nombre)
      : [...e.sucursales, nombre];
    this.edicion.set({ ...e, sucursales: lista });
  }

  tieneSucursal(nombre: string): boolean {
    return this.edicion()?.sucursales?.includes(nombre) === true;
  }

  /** La foto de la promo. Es lo que la caja va a reconocer de un vistazo. */
  async alElegirFoto(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const archivo = (input.files || [])[0];
    input.value = '';
    if (!archivo) return;

    if (archivo.size > this.MAX_ARCHIVO_MB * 1024 * 1024) {
      Swal.fire({
        icon: 'warning', title: 'La foto pesa mucho',
        text: `El máximo son ${this.MAX_ARCHIVO_MB} MB.`,
        confirmButtonColor: '#0F172A',
      });
      return;
    }

    this.subiendo.set(true);
    try {
      const subido = await this.nube.subir(archivo);
      const e = this.edicion();
      if (e) this.edicion.set({ ...e, fotoUrl: subido.url });
    } catch (e: any) {
      this.error('No se pudo subir la foto', e);
    } finally {
      this.subiendo.set(false);
    }
  }

  quitarFoto() {
    const e = this.edicion();
    if (e) this.edicion.set({ ...e, fotoUrl: '' });
  }

  async guardarPromo() {
    const e = this.edicion();
    if (!e) return;
    if (!String(e.nombre || '').trim()) {
      Swal.fire({
        icon: 'warning', title: 'Falta el nombre',
        text: 'La promo necesita un nombre para que la caja la reconozca.',
        confirmButtonColor: '#0F172A',
      });
      return;
    }

    // Dejar la lista vacía significa "en todas las sucursales", y eso solo lo
    // puede decidir quien alcanza todas. Si no, el vendedor de una sucursal
    // publicaría en toda la cadena con solo no marcar nada.
    if (!this.alcanzaTodas && !e.sucursales.length) {
      Swal.fire({
        icon: 'warning', title: 'Falta la sucursal',
        text: 'Marca al menos una sucursal donde aplique la promo.',
        confirmButtonColor: '#0F172A',
      });
      return;
    }

    this.guardando.set(true);
    try {
      await this.api.post('/api/promos-venta', {
        accion: 'guardarPromo',
        promo: {
          id: e.id || undefined,
          nombre: e.nombre,
          descripcion: e.descripcion,
          costo: e.costo,
          fotoUrl: e.fotoUrl,
          estado: e.estado,
          vigenciaDel: e.vigenciaDel,
          vigenciaAl: e.vigenciaAl,
          sucursales: e.sucursales,
        },
      });
      this.edicion.set(null);
      await this.cargar();
    } catch (err: any) {
      this.error('No se pudo guardar la promo', err);
    } finally {
      this.guardando.set(false);
    }
  }

  async cambiarEstado(p: Promo, estado: 'activa' | 'pausada' | 'terminada') {
    try {
      await this.api.post('/api/promos-venta', { accion: 'estadoPromo', promoId: p.id, estado });
      this.cargar();
    } catch (e: any) {
      this.error('No se pudo cambiar el estado', e);
    }
  }

  async eliminar(p: Promo) {
    const r = await Swal.fire({
      icon: 'warning', title: '¿Eliminar esta promo?',
      text: 'Deja de aparecerle a las cajas. Lo ya reportado se conserva.',
      showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#C7382E',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.del('/api/promos-venta?id=' + encodeURIComponent(p.id));
      this.cargar();
    } catch (e: any) {
      this.error('No se pudo eliminar', e);
    }
  }

  // ================= Monitor: deshacer una luz mal dada =================
  async quitarLuz(l: Luz) {
    const r = await Swal.fire({
      icon: 'warning', title: '¿Quitar este reporte?',
      html: `<div style="font-size:13px">${l.promoNombre} · ${l.sucursal}</div>`,
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#C7382E',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.post('/api/promos-venta', { accion: 'quitarLuz', luzId: l.id });
      this.cargarPanel();
    } catch (e: any) {
      this.error('No se pudo quitar', e);
    }
  }

  // ================= Totales del tablero =================
  totalPiezas = computed(() =>
    this.panel().porSucursal.reduce((s, x) => s + (x.piezas || 0), 0));
  totalImporte = computed(() =>
    this.panel().porSucursal.reduce((s, x) => s + (x.importe || 0), 0));
  totalLuces = computed(() =>
    this.panel().porSucursal.reduce((s, x) => s + (x.vendidas || 0), 0));

  /** Quien va en primer lugar. Solo cuenta si de verdad vendió algo: con la
   *  lista vacía, o con puros ceros, no hay líder que coronar. */
  lider = computed(() => {
    const v = this.panel().porVendedor;
    return v.length && v[0].piezas > 0 ? v[0] : null;
  });

  /** Sucursales que NO han dado una sola señal en la ventana. Es el dato que
   *  hoy no se tiene y el que de verdad duele. */
  calladas = computed(() => {
    const conSenal = new Set(this.panel().porSucursal.map(x => x.sucursal));
    return this.SUCURSALES.filter(s => !conSenal.has(s));
  });

  // ================= Utilidades =================
  pesos(n: any): string {
    const v = Number(n || 0);
    return '$' + v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  fechaHora(ms: any): string {
    if (!ms) return '';
    try {
      return new Date(Number(ms)).toLocaleString('es-MX',
        { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  /** "hace 4 min" — en un tablero en vivo importa más que la hora exacta. */
  hace(ms: any): string {
    if (!ms) return '';
    const seg = Math.max(0, Math.floor((Date.now() - Number(ms)) / 1000));
    if (seg < 60) return 'hace un momento';
    const min = Math.floor(seg / 60);
    if (min < 60) return `hace ${min} min`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `hace ${hrs} h`;
    return `hace ${Math.floor(hrs / 24)} d`;
  }

  etiquetaEstado(e: string): string {
    return e === 'activa' ? 'Activa' : e === 'pausada' ? 'Pausada' : 'Terminada';
  }

  private error(titulo: string, e: any) {
    Swal.fire({
      icon: 'error', title: titulo,
      text: e?.message || 'Revisa tu conexión.',
      confirmButtonColor: '#0F172A',
    });
  }
}
