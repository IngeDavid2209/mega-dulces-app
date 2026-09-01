import { Component, EventEmitter, Input, OnInit, Output, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

import { ApiService } from '../../../shared/api.service';
import { CloudinaryService } from '../../../shared/cloudinary.service';
import { puedeEnCanal, SUCURSAL_POR_CANAL } from './canales';

/**
 * EXPEDIENTES DE UNA PROMOCION — el seguimiento de que si se ejecuto.
 *
 * Una promocion firmada no prueba nada por si sola: hay que demostrar que se
 * hizo en cada canal donde el formato la autorizo. Por eso cada canal marcado
 * lleva su expediente con tres pruebas:
 *
 *   1. SALIDA      el ticket o formato con que salio la mercancia del CEDIS.
 *   2. EXHIBICION  la foto del producto donde debe estar (el combo ya armado,
 *                  si la promocion es de combo).
 *   3. VENTAS      las fotos de los tickets de venta. De cada una, la IA lee el
 *                  importe y la persona lo confirma; de ahi salen las piezas y
 *                  el dinero que alimentan el KPI y el ranking.
 *
 * Solo aparecen los canales que la promocion trae marcados en su formato: el
 * expediente existe porque el formato lo autorizo ahi.
 *
 * Cada cambio se manda como una ACCION sobre el expediente (agregar evidencia,
 * agregar venta...), no como un guardado del objeto completo: varias sucursales
 * suben evidencia el mismo dia y un guardado entero pisaria lo del vecino.
 *
 * QUIEN SUBE QUE:
 *
 * Cada sucursal sube LO SUYO y nada mas. El de Padre Hidalgo sube el expediente
 * de PH; el de Morelia no se lo puede tocar. Los canales ajenos SI se ven (para
 * eso esta el avance de toda la promocion, "4 de 8 completas"), pero sin un solo
 * boton para subirles nada.
 *
 * Mayoreo, Ruta Diaria y Ruta Vecinal quedan abiertos a proposito: no son
 * sucursales, son formas de vender, y si se los amarraramos a alguien se
 * quedarian sin quien los llene.
 *
 * Y lo que se sube, se queda: quitar evidencia o una venta es de
 * `promocionesFormato`. La evidencia es la prueba de que la promocion se
 * ejecuto; quien la sube no la puede desandar. Si algo entro mal, lo corrige
 * quien manda el formato.
 *
 * Nada de esto es el candado de verdad: el candado esta en el servidor
 * (api/_promo-acceso.js), que vuelve a preguntar contra la base en cada accion.
 */
type Seccion = 'salida' | 'exhibicion';

@Component({
  selector: 'app-promo-expedientes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './expedientes.html',
  styleUrls: ['./expedientes.css'],
})
export class PromoExpedientesComponent implements OnInit {
  /** La promoción cuyo seguimiento se está viendo. */
  @Input({ required: true }) promo: any;
  @Output() volver = new EventEmitter<void>();
  /** Pide abrir el formato en el paso 3, que es donde se eligen las sucursales. */
  @Output() irAlFormato = new EventEmitter<void>();

  private api = inject(ApiService);
  private nube = inject(CloudinaryService);

  cargando = signal(true);
  subiendo = signal(0);
  /** Canal cuyo ticket está leyendo la IA ahora mismo (para el aviso). */
  leyendo = signal<string>('');

  /** Los canales marcados en el formato de la promoción. */
  canales = signal<string[]>([]);
  expedientes = signal<any[]>([]);

  /** Canal abierto. Vacío = se ve la lista de canales. */
  abierto = signal<string>('');

  /** La venta que se está capturando, por canal. */
  ventaNueva: Record<string, { url: string; nombre: string; piezas: number | null; importe: number | null; leidoIA: any }> = {};

  /** La sesión, para saber qué oficio es y qué sucursales trae. */
  currentUser: any = null;

  ngOnInit() {
    const s = localStorage.getItem('md_sesion_actual');
    if (s) { try { this.currentUser = JSON.parse(s); } catch { } }
    this.cargar();
  }

  // ================= Los dos oficios =================
  /** ¿Captura formatos? Ese alcanza todo: cualquier canal, y además quitar. */
  get puedeFormato(): boolean {
    const u = this.currentUser;
    return u?.promocionesFormato === true || u?.grupoPromociones === true;
  }

  /** Las sucursales de este usuario; vacío = acceso total. */
  private get misSucursales(): string[] {
    return Array.isArray(this.currentUser?.sucursales) ? this.currentUser.sucursales : [];
  }

  /**
   * ¿Puede subirle evidencia a ESTE canal?
   *
   * El de formato, a todos. A los demás solo los canales de sus sucursales, más
   * Mayoreo y las rutas, que no son de nadie.
   */
  puedeSubirEn(canal: string): boolean {
    if (this.puedeFormato) return true;
    if (this.currentUser?.promocionesExpediente !== true) return false;
    return puedeEnCanal(canal, this.misSucursales);
  }

  /** ¿A qué sucursal pertenece este canal? Vacío si no es de ninguna. */
  sucursalDe(canal: string): string { return SUCURSAL_POR_CANAL[canal] || ''; }

  /** El aviso de por qué este canal está sin botones. */
  motivoAjeno(canal: string): string {
    const suya = this.sucursalDe(canal);
    if (this.currentUser?.promocionesExpediente !== true) {
      return 'Tu permiso no incluye subir evidencia.';
    }
    return suya
      ? 'Este canal es de ' + suya + '. Solo puedes subir evidencia de tus sucursales.'
      : 'Solo puedes subir evidencia de tus sucursales.';
  }

  // ================= Carga =================
  async cargar() {
    this.cargando.set(true);
    try {
      const r = await this.api.get('/api/promo-expedientes?promo=' + encodeURIComponent(this.promo.id));
      this.canales.set(r?.canales || []);
      this.expedientes.set(r?.expedientes || []);
    } catch (e: any) {
      Swal.fire({
        icon: 'error', title: 'No se pudo cargar el seguimiento',
        text: e?.message || 'Revisa tu conexión.', confirmButtonColor: 'var(--action)',
      });
    } finally {
      this.cargando.set(false);
    }
  }

  /** El expediente de un canal, o uno vacío si todavía no tiene evidencia. */
  expedienteDe(canal: string): any {
    return this.expedientes().find(e => e.canal === canal) || {
      canal, estado: 'pendiente', salida: [], exhibicion: [], ventas: [],
      piezasTotal: 0, importeTotal: 0, ventasTotal: 0, vacio: true,
    };
  }

  // ================= Avance =================
  completos = computed(() => this.expedientes().filter(e => e.estado === 'completo').length);

  totalPiezas = computed(() => this.expedientes().reduce((s, e) => s + (e.piezasTotal || 0), 0));
  totalImporte = computed(() => this.expedientes().reduce((s, e) => s + (e.importeTotal || 0), 0));
  totalTickets = computed(() => this.expedientes().reduce((s, e) => s + (e.ventasTotal || 0), 0));

  /** Qué le falta a un canal, en palabras, para no hacer contar cuadritos. */
  queFalta(canal: string): string {
    const e = this.expedienteDe(canal);
    const faltan: string[] = [];
    if (!e.salida?.length) faltan.push('salida');
    if (!e.exhibicion?.length) faltan.push('exhibición');
    if (!e.ventas?.length) faltan.push('ventas');
    if (!faltan.length) return 'Completo';
    return 'Falta ' + faltan.join(', ');
  }

  esImagen(a: any): boolean { return this.nube.esImagen(a || {}); }

  // ================= Evidencia (salida y exhibición) =================
  async alElegirArchivos(ev: Event, canal: string, seccion: Seccion) {
    if (!this.puedeSubirEn(canal)) return;
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files || []);
    input.value = '';   // permite volver a elegir el mismo archivo
    for (const a of archivos) await this.subirEvidencia(a, canal, seccion);
  }

  private async subirEvidencia(archivo: File, canal: string, seccion: Seccion) {
    this.subiendo.set(this.subiendo() + 1);
    try {
      const subido = await this.nube.subir(archivo);
      const r = await this.api.post('/api/promo-expedientes', {
        promoId: this.promo.id, canal, accion: 'agregarEvidencia',
        seccion, evidencia: subido,
      });
      this.reemplazar(r?.expediente);
    } catch (e: any) {
      Swal.fire({
        icon: 'error', title: 'No se pudo guardar la evidencia',
        text: e?.message || 'Revisa tu conexión.', confirmButtonColor: 'var(--action)',
      });
    } finally {
      this.subiendo.set(this.subiendo() - 1);
    }
  }

  async quitarEvidencia(canal: string, seccion: Seccion, url: string) {
    // Lo que se sube, se queda: desandar es del que manda el formato.
    if (!this.puedeFormato) return;
    const r = await Swal.fire({
      icon: 'warning', title: '¿Quitar esta evidencia?',
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar',
      confirmButtonColor: 'var(--bad-fg)',
    });
    if (!r.isConfirmed) return;
    try {
      const resp = await this.api.post('/api/promo-expedientes', {
        promoId: this.promo.id, canal, accion: 'quitarEvidencia', seccion, url,
      });
      this.reemplazar(resp?.expediente);
    } catch (e: any) {
      Swal.fire({ icon: 'error', title: 'No se pudo quitar', text: e?.message || '', confirmButtonColor: 'var(--action)' });
    }
  }

  // ================= Ventas (con lectura de la IA) =================
  /**
   * Sube la foto del ticket y se la manda a la IA para que lea el importe.
   *
   * Lo que lee NO se guarda solo: queda propuesto en el formulario para que la
   * persona lo confirme o lo corrija, porque de estos numeros sale el ranking y
   * un digito mal leido cambia el lugar de una promocion.
   */
  async alElegirTicket(ev: Event, canal: string) {
    if (!this.puedeSubirEn(canal)) return;
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files || []);
    input.value = '';
    if (!archivos.length) return;

    this.subiendo.set(this.subiendo() + 1);
    try {
      const subido = await this.nube.subir(archivos[0]);
      this.ventaNueva[canal] = {
        url: subido.url, nombre: subido.nombre,
        piezas: null, importe: null, leidoIA: null,
      };

      // La lectura es aparte: si la IA falla, la foto ya esta subida y el importe
      // se puede capturar a mano.
      this.leyendo.set(canal);
      try {
        const leido = await this.api.post('/api/promo-leer-ticket', { url: subido.url });
        this.ventaNueva[canal].leidoIA = leido;
        if (leido?.legible && leido?.total != null) {
          this.ventaNueva[canal].importe = leido.total;
        }
        if (leido?.piezas != null) this.ventaNueva[canal].piezas = leido.piezas;
      } catch (e: any) {
        this.ventaNueva[canal].leidoIA = {
          legible: false,
          nota: e?.message || 'La IA no pudo leer el ticket. Captura el importe a mano.',
        };
      } finally {
        this.leyendo.set('');
      }
    } catch (e: any) {
      Swal.fire({
        icon: 'error', title: 'No se pudo subir el ticket',
        text: e?.message || 'Revisa tu conexión.', confirmButtonColor: 'var(--action)',
      });
    } finally {
      this.subiendo.set(this.subiendo() - 1);
    }
  }

  /** Guarda la venta ya revisada por una persona. */
  async guardarVenta(canal: string) {
    if (!this.puedeSubirEn(canal)) return;
    const v = this.ventaNueva[canal];
    if (!v) return;
    if (!v.piezas && !v.importe) {
      Swal.fire({
        icon: 'warning', title: 'Faltan los números',
        text: 'Escribe cuántas piezas se vendieron y de cuánto fue el ticket.',
        confirmButtonColor: 'var(--action)',
      });
      return;
    }
    try {
      const r = await this.api.post('/api/promo-expedientes', {
        promoId: this.promo.id, canal, accion: 'agregarVenta',
        venta: {
          url: v.url, nombre: v.nombre,
          piezas: v.piezas || 0, importe: v.importe || 0,
          leidoIA: v.leidoIA || null,
          // Confirmado = una persona vio el numero antes de guardarlo.
          confirmado: true,
        },
      });
      this.reemplazar(r?.expediente);
      delete this.ventaNueva[canal];
    } catch (e: any) {
      Swal.fire({ icon: 'error', title: 'No se pudo guardar la venta', text: e?.message || '', confirmButtonColor: 'var(--action)' });
    }
  }

  cancelarVenta(canal: string) { delete this.ventaNueva[canal]; }

  async quitarVenta(canal: string, ventaId: string) {
    if (!this.puedeFormato) return;
    const r = await Swal.fire({
      icon: 'warning', title: '¿Quitar esta venta?',
      text: 'Se descuenta de las piezas y del importe de la promoción.',
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar',
      confirmButtonColor: 'var(--bad-fg)',
    });
    if (!r.isConfirmed) return;
    try {
      const resp = await this.api.post('/api/promo-expedientes', {
        promoId: this.promo.id, canal, accion: 'quitarVenta', ventaId,
      });
      this.reemplazar(resp?.expediente);
    } catch (e: any) {
      Swal.fire({ icon: 'error', title: 'No se pudo quitar', text: e?.message || '', confirmButtonColor: 'var(--action)' });
    }
  }

  // ================= Utilidades =================
  /** Mete el expediente que devolvió el servidor en la lista que se ve. */
  private reemplazar(exp: any) {
    if (!exp) return;
    const lista = this.expedientes().filter(e => e.id !== exp.id);
    this.expedientes.set([...lista, exp].sort((a, b) => String(a.canal).localeCompare(String(b.canal))));
  }

  abrirCanal(canal: string) { this.abierto.set(this.abierto() === canal ? '' : canal); }

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
}
