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
  /** Lo que devuelve el tablero del monitor. */
  panel = signal<{ porPromo: any[]; porSucursal: any[]; recientes: Luz[] }>({
    porPromo: [], porSucursal: [], recientes: [],
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
  get puedeCaja(): boolean { return this.currentUser?.ventaPromosCaja === true || this.esAdmin; }
  get puedeVender(): boolean { return this.currentUser?.ventaPromosVendedor === true || this.esAdmin; }
  get puedeMonitor(): boolean { return this.currentUser?.ventaPromosMonitor === true || this.esAdmin; }
  get esAdmin(): boolean { return this.currentUser?.rol === 'admin'; }

  /** Las sucursales entre las que puede reportar quien esta en caja. */
  get misSucursales(): string[] {
    const mias: string[] = this.currentUser?.sucursales || [];
    // Acceso total o sin sucursales asignadas: puede reportar de cualquiera.
    if (!mias.length || mias.includes('General (Acceso Total)')) return this.SUCURSALES;
    const propias = this.SUCURSALES.filter(s => mias.includes(s));
    return propias.length ? propias : this.SUCURSALES;
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
  async cargar() {
    this.cargando.set(true);
    try {
      const r = await this.api.get('/api/promos-venta');
      this.promos.set(r?.promos || []);
    } catch (e: any) {
      this.error('No se pudieron cargar las promos', e);
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarPanel() {
    try {
      const desde = Date.now() - this.dias() * 24 * 60 * 60 * 1000;
      const r = await this.api.get('/api/promos-venta?panel=1&desde=' + desde);
      this.panel.set({
        porPromo: r?.porPromo || [],
        porSucursal: r?.porSucursal || [],
        recientes: r?.recientes || [],
      });
    } catch (e: any) {
      this.error('No se pudo cargar el tablero', e);
    }
  }

  irA(v: 'caja' | 'promos' | 'tablero') {
    this.vista.set(v);
    this.edicion.set(null);
    if (v === 'tablero') { this.cargarPanel(); this.arrancarReloj(); }
    else { this.detenerReloj(); this.cargar(); }
  }

  cambiarDias(d: number) { this.dias.set(d); this.cargarPanel(); }

  /**
   * El tablero se refresca solo cada minuto mientras esta abierto. Quien
   * monitorea lo deja puesto en una pantalla y el chiste es ver entrar las
   * ventas sin tener que recargar.
   */
  private arrancarReloj() {
    this.detenerReloj();
    this.reloj = setInterval(() => this.cargarPanel(), 60000);
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

  // ================= Vendedor: alta de promos =================
  nueva() {
    this.edicion.set({
      id: '', nombre: '', descripcion: '', costo: null, fotoUrl: '',
      estado: 'activa', vigenciaDel: '', vigenciaAl: '', sucursales: [],
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
