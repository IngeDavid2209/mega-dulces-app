import { Component, signal, computed, OnInit, OnDestroy, inject, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { ApiService } from '../../../shared/api.service';
import { UsuariosService } from '../../../shared/usuarios.service';
import { BuscadorPersonaComponent } from '../../../shared/buscador-persona/buscador-persona';

/**
 * MODULO TICKETS — Vale de Servicio Operativo.
 *
 * Digitaliza el formato en papel del mismo nombre. Resuelve dos cosas que el
 * papel no puede: que las solicitudes no se pierdan (cada una tiene estado y
 * responsable) y que el vale firmado quede guardado y se pueda volver a imprimir.
 *
 * Ciclo de vida:
 *   abierto     -> alguien levantó la solicitud, nadie la ha tomado
 *   en_proceso  -> un responsable la está atendiendo
 *   completado  -> se documentó qué se hizo y se firmó
 *   cancelado   -> ya no se va a hacer (queda el registro con el motivo)
 *
 * Las tres firmas del formato (realizado / revisado / recibido) se dibujan con
 * el dedo en un canvas y se guardan como imagen en Cloudinary, igual que las
 * fotos de evidencia de los checklists.
 */
type Vista = 'lista' | 'vale';
type Firma = 'firmaRealizado' | 'firmaRevisado' | 'firmaRecibido';

const ESTATUS_TEXTO: Record<string, string> = {
  abierto: 'Abierto',
  en_proceso: 'En proceso',
  completado: 'Completado',
  cancelado: 'Cancelado',
};

@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent, BuscadorPersonaComponent],
  templateUrl: './tickets.html',
  styleUrls: ['./tickets.css'],
})
export class TicketsComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private usuariosSvc = inject(UsuariosService);
  private ruta = inject(ActivatedRoute);

  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null;
  vista = signal<Vista>('lista');

  tickets = signal<any[]>([]);
  cargando = signal<boolean>(true);
  guardando = false;

  // Filtros de la lista. Son signals porque los lee un computed.
  filtroEstatus = signal<string>('pendientes');
  filtroArea = signal<string>('');
  busqueda = signal<string>('');

  /** El vale que se está viendo o editando. */
  ticketAbierto = signal<any | null>(null);

  // Modal de alta
  modalNuevo = false;
  form: any = this.formVacio();
  folioSiguiente = signal<number | null>(null);

  // Modal de firma
  modalFirma: Firma | null = null;
  firmaNombre = '';
  firmaGuardando = false;
  @ViewChild('lienzo') lienzo?: ElementRef<HTMLCanvasElement>;
  private dibujando = false;
  private hayTrazo = false;

  /** Las tres firmas del formato, en el orden en que aparecen en el papel.
   *  Va tipada para que la plantilla no pase un string suelto. */
  readonly firmas: Firma[] = ['firmaRealizado', 'firmaRevisado', 'firmaRecibido'];

  get esAdmin(): boolean { return this.currentUser?.rol === 'admin'; }

  // --- Derivados -------------------------------------------------------------

  areas = computed<string[]>(() => {
    const set = new Set<string>();
    for (const t of this.tickets()) if (t.area) set.add(t.area);
    return Array.from(set).sort();
  });

  /** Áreas para el formulario: las de los tickets más las del personal. */
  areasSugeridas = computed<string[]>(() => {
    const set = new Set<string>(this.areas());
    for (const u of this.usuariosSvc.usuarios()) {
      for (const a of (u.areas || [])) {
        if (a && a !== 'Todas las áreas') set.add(String(a));
      }
    }
    return Array.from(set).sort();
  });

  personal = computed<any[]>(() =>
    this.usuariosSvc.usuarios()
      .filter(u => u.activo !== false)
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''))));

  ticketsFiltrados = computed(() => {
    const est = this.filtroEstatus();
    const area = this.filtroArea();
    const q = this.busqueda().trim().toLowerCase();
    return this.tickets().filter(t => {
      if (est === 'pendientes' && (t.estatus === 'completado' || t.estatus === 'cancelado')) return false;
      if (est !== 'pendientes' && est !== '' && t.estatus !== est) return false;
      if (area && t.area !== area) return false;
      if (q) {
        const heno = [t.folio, t.actividad, t.solicitante, t.responsable, t.area, t.lugar]
          .map(x => String(x == null ? '' : x).toLowerCase()).join(' ');
        if (!heno.includes(q)) return false;
      }
      return true;
    });
  });

  totalAbiertos = computed(() => this.tickets().filter(t => t.estatus === 'abierto').length);
  totalEnProceso = computed(() => this.tickets().filter(t => t.estatus === 'en_proceso').length);
  totalCompletados = computed(() => this.tickets().filter(t => t.estatus === 'completado').length);

  /** Los que me toca atender a mí (o que yo levanté), para verlos de un vistazo. */
  mios = computed(() => {
    const uid = this.currentUser?.uid || this.currentUser?.id;
    return this.tickets().filter(t =>
      (t.responsableUid === uid || t.solicitanteUid === uid) &&
      t.estatus !== 'completado' && t.estatus !== 'cancelado');
  });

  // --- Ciclo de vida ---------------------------------------------------------

  async ngOnInit() {
    try { this.currentUser = JSON.parse(localStorage.getItem('md_sesion_actual') || 'null'); }
    catch { this.currentUser = null; }
    this.usuariosSvc.iniciar();
    await this.cargar();

    // El aviso de WhatsApp manda un enlace con ?id=..., para caer directo en el
    // vale en vez de tener que buscarlo en la lista.
    const id = this.ruta.snapshot.queryParamMap.get('id');
    if (id) {
      const t = this.tickets().find(x => x.id === id);
      if (t) this.abrirVale(t);
      else {
        // Puede no estar en la lista (por filtros o por ser muy viejo): se pide.
        try {
          const r = await this.api.get('/api/tickets?id=' + encodeURIComponent(id));
          if (r?.ticket) this.abrirVale(r.ticket);
        } catch { /* si no existe, se queda en la lista */ }
      }
    }
  }

  ngOnDestroy() { this.usuariosSvc.detener(); }

  async cargar() {
    this.cargando.set(true);
    try {
      const r = await this.api.get('/api/tickets');
      this.tickets.set(r.tickets || []);
    } catch (e: any) {
      this.avisoError(e, 'No pude cargar los tickets.');
    } finally {
      this.cargando.set(false);
    }
  }

  private avisoError(e: any, encabezado: string) {
    const sinRed = e?.sinRed === true;
    Swal.fire({
      icon: sinRed ? 'warning' : 'error',
      title: sinRed ? 'Sin conexión' : 'Ups',
      text: sinRed
        ? `${encabezado} Revisa tu conexión e inténtalo de nuevo.`
        : `${encabezado} ${e?.message || ''}`.trim(),
    });
  }

  // --- Alta ------------------------------------------------------------------

  formVacio() {
    const hoy = new Date();
    const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    return {
      fecha,
      area: '', lugar: '', actividad: '',
      solicitante: '', solicitanteUid: '',
      responsable: '', responsableUid: '',
      supervisor: '', supervisorUid: '',
    };
  }

  async abrirNuevo() {
    this.form = this.formVacio();
    // Se prellena con quien está usando la app: casi siempre es el solicitante.
    this.form.solicitante = this.currentUser?.nombre || '';
    this.form.solicitanteUid = this.currentUser?.uid || this.currentUser?.id || '';
    const suyas = (this.currentUser?.areas || []).filter((a: string) => a && a !== 'Todas las áreas');
    if (suyas.length === 1) this.form.area = suyas[0];
    this.modalNuevo = true;
    // El folio se muestra antes de guardar para que se sepa qué número tocará.
    this.folioSiguiente.set(null);
    try {
      const r = await this.api.get('/api/tickets?siguienteFolio=1');
      this.folioSiguiente.set(r.folio ?? null);
    } catch { /* si falla, se muestra al guardar */ }
  }

  /** Al elegir a alguien en el buscador se copia su nombre y su uid. */
  elegirPersona(campo: 'solicitante' | 'responsable' | 'supervisor', persona: any | null) {
    this.form[campo + 'Uid'] = persona ? (persona.id || persona.uid || '') : '';
    this.form[campo] = persona ? (persona.nombre || '') : '';
  }

  async guardarNuevo() {
    if (this.guardando) return;
    if (!this.form.area.trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta el área', text: 'Dinos de qué área o departamento es la solicitud.' });
      return;
    }
    if (!this.form.actividad.trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta la actividad', text: 'Escribe qué servicio se necesita.' });
      return;
    }
    if (!this.form.solicitante.trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta el solicitante', text: 'Dinos quién está solicitando el servicio.' });
      return;
    }

    this.guardando = true;
    try {
      // Si ya se le puso responsable, nace "en proceso": alguien ya lo tomó.
      const estatus = this.form.responsableUid || this.form.responsable ? 'en_proceso' : 'abierto';
      const r = await this.api.post('/api/tickets', { ...this.form, estatus });
      this.modalNuevo = false;
      await this.cargar();
      // Se abre el vale recién creado: normalmente lo siguiente es trabajarlo.
      if (r?.ticket) this.abrirVale(r.ticket);
      Swal.fire({
        icon: 'success', title: `Ticket ${this.folioTexto(r?.ticket?.folio)} creado`,
        text: estatus === 'abierto'
          ? 'Queda abierto, esperando quién lo atienda.'
          : `Asignado a ${r.ticket.responsable}.`,
        timer: 2600, showConfirmButton: false,
      });
    } catch (e: any) {
      this.avisoError(e, 'No se pudo crear el ticket.');
    } finally {
      this.guardando = false;
    }
  }

  // --- El vale ---------------------------------------------------------------

  abrirVale(t: any) {
    // Copia para poder editar sin ensuciar la lista si al final no se guarda.
    this.ticketAbierto.set({ ...t });
    this.vista.set('vale');
  }

  cerrarVale() {
    this.ticketAbierto.set(null);
    this.vista.set('lista');
  }

  /** Guarda el vale tal como está, sin cambiar el estatus. */
  async guardarVale(nuevoEstatus?: string) {
    const t = this.ticketAbierto();
    if (!t || this.guardando) return;

    if (nuevoEstatus === 'completado' && !String(t.detalle || '').trim()) {
      Swal.fire({
        icon: 'warning', title: 'Falta el detalle',
        text: 'Para cerrar el vale hay que escribir qué se hizo (detalle de actividades realizadas).',
      });
      return;
    }

    this.guardando = true;
    try {
      const cuerpo: any = {
        id: t.id,
        estatus: nuevoEstatus || t.estatus,
        fecha: t.fecha, area: t.area, lugar: t.lugar,
        solicitante: t.solicitante, solicitanteUid: t.solicitanteUid,
        responsable: t.responsable, responsableUid: t.responsableUid,
        supervisor: t.supervisor, supervisorUid: t.supervisorUid,
        actividad: t.actividad,
        requiereSeguimiento: t.requiereSeguimiento === true,
        detalle: t.detalle, materiales: t.materiales, resultado: t.resultado,
        observacionesSeguimiento: t.observacionesSeguimiento,
        observacionesGenerales: t.observacionesGenerales,
      };
      const r = await this.api.post('/api/tickets', cuerpo);
      if (r?.ticket) this.ticketAbierto.set({ ...r.ticket });
      await this.cargar();
      if (nuevoEstatus === 'completado') {
        Swal.fire({
          icon: 'success', title: 'Vale cerrado',
          text: 'El servicio quedó documentado. Ya puedes descargar el vale en PDF.',
          timer: 2800, showConfirmButton: false,
        });
      }
    } catch (e: any) {
      this.avisoError(e, 'No se pudo guardar el vale.');
    } finally {
      this.guardando = false;
    }
  }

  /** Me hago cargo: pasa a "en proceso" conmigo como responsable. */
  async tomarTicket() {
    const t = this.ticketAbierto();
    if (!t) return;
    t.responsable = this.currentUser?.nombre || '';
    t.responsableUid = this.currentUser?.uid || this.currentUser?.id || '';
    this.ticketAbierto.set({ ...t });
    await this.guardarVale('en_proceso');
  }

  async cancelarTicket() {
    const t = this.ticketAbierto();
    if (!t) return;
    const { value: motivo } = await Swal.fire({
      icon: 'warning', title: '¿Cancelar este ticket?',
      input: 'text', inputPlaceholder: '¿Por qué se cancela?',
      showCancelButton: true, confirmButtonText: 'Cancelar el ticket', cancelButtonText: 'Volver',
      confirmButtonColor: '#DC2626',
      inputValidator: (v) => (!v || !v.trim()) ? 'Escribe el motivo' : null,
    });
    if (!motivo) return;
    this.guardando = true;
    try {
      const r = await this.api.post('/api/tickets', { id: t.id, estatus: 'cancelado', motivoCancelacion: motivo });
      if (r?.ticket) this.ticketAbierto.set({ ...r.ticket });
      await this.cargar();
    } catch (e: any) {
      this.avisoError(e, 'No se pudo cancelar el ticket.');
    } finally {
      this.guardando = false;
    }
  }

  async reabrirTicket() {
    const t = this.ticketAbierto();
    if (!t) return;
    const r0 = await Swal.fire({
      icon: 'question', title: '¿Reabrir el ticket?',
      text: 'Volverá a quedar en proceso para poder corregirlo.',
      showCancelButton: true, confirmButtonText: 'Reabrir', cancelButtonText: 'No',
    });
    if (!r0.isConfirmed) return;
    await this.guardarVale('en_proceso');
  }

  async borrarTicket(t: any) {
    const r = await Swal.fire({
      icon: 'warning', title: `¿Borrar el ticket ${this.folioTexto(t.folio)}?`,
      text: 'Se quita de la lista. El registro se conserva por si hay que recuperarlo.',
      showCancelButton: true, confirmButtonText: 'Borrar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#DC2626',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.del('/api/tickets?id=' + encodeURIComponent(t.id));
      if (this.ticketAbierto()?.id === t.id) this.cerrarVale();
      await this.cargar();
    } catch (e: any) {
      this.avisoError(e, 'No se pudo borrar el ticket.');
    }
  }

  // --- Firmas ----------------------------------------------------------------

  etiquetaFirma(f: Firma): string {
    return f === 'firmaRealizado' ? 'Realizado por'
      : f === 'firmaRevisado' ? 'Revisado por' : 'Recibido / seguimiento por';
  }

  abrirFirma(f: Firma) {
    const t = this.ticketAbierto();
    if (!t) return;
    this.modalFirma = f;
    // Se propone un nombre según el papel de cada firma, pero se puede cambiar:
    // quien firma no siempre es quien está usando la app.
    const propuesto = f === 'firmaRealizado' ? (t.responsable || this.currentUser?.nombre)
      : f === 'firmaRevisado' ? (t.supervisor || '')
        : (t.solicitante || '');
    this.firmaNombre = (t[f] && t[f].nombre) || propuesto || '';
    this.hayTrazo = false;
    // El canvas se prepara cuando ya está en pantalla.
    setTimeout(() => this.prepararLienzo(), 60);
  }

  cerrarFirma() {
    this.modalFirma = null;
    this.hayTrazo = false;
  }

  /**
   * Ajusta el canvas a su tamaño real en pantalla.
   *
   * Sin esto la firma sale desplazada del dedo: el canvas mide 300x150 "puntos"
   * internos por defecto y se estira por CSS, así que las coordenadas del dedo no
   * caen donde se dibuja. Se iguala el tamaño interno al que ocupa de verdad,
   * multiplicado por la densidad de la pantalla para que no se vea pixeleada.
   */
  private prepararLienzo() {
    const c = this.lienzo?.nativeElement;
    if (!c) return;
    const caja = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(caja.width * dpr);
    c.height = Math.round(caja.height * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F172A';
    ctx.clearRect(0, 0, caja.width, caja.height);
  }

  private puntoDe(ev: PointerEvent) {
    const c = this.lienzo!.nativeElement;
    const caja = c.getBoundingClientRect();
    return { x: ev.clientX - caja.left, y: ev.clientY - caja.top };
  }

  trazoInicia(ev: PointerEvent) {
    const c = this.lienzo?.nativeElement;
    if (!c) return;
    ev.preventDefault();
    c.setPointerCapture(ev.pointerId);
    const ctx = c.getContext('2d');
    const p = this.puntoDe(ev);
    ctx!.beginPath();
    ctx!.moveTo(p.x, p.y);
    this.dibujando = true;
  }

  trazoMueve(ev: PointerEvent) {
    if (!this.dibujando) return;
    ev.preventDefault();
    const ctx = this.lienzo!.nativeElement.getContext('2d');
    const p = this.puntoDe(ev);
    ctx!.lineTo(p.x, p.y);
    ctx!.stroke();
    this.hayTrazo = true;
  }

  trazoTermina() { this.dibujando = false; }

  limpiarFirma() {
    this.prepararLienzo();
    this.hayTrazo = false;
  }

  /** Sube la firma a Cloudinary (mismo camino que las fotos de los checklists). */
  private async subirFirma(blob: Blob): Promise<string | null> {
    const cloudName = 'duherjgyg';
    const uploadPreset = 'fotos_mega';
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const fd = new FormData();
        fd.append('file', blob);
        fd.append('upload_preset', uploadPreset);
        const r = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, { method: 'POST', body: fd });
        const d = await r.json();
        if (d && d.secure_url) return d.secure_url;
      } catch { /* se reintenta una vez */ }
    }
    return null;
  }

  async guardarFirma() {
    const f = this.modalFirma;
    const t = this.ticketAbierto();
    if (!f || !t || this.firmaGuardando) return;
    if (!this.hayTrazo) {
      Swal.fire({ icon: 'warning', title: 'Falta la firma', text: 'Dibuja la firma con el dedo antes de guardar.' });
      return;
    }
    if (!this.firmaNombre.trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta el nombre', text: 'Escribe el nombre de quien firma.' });
      return;
    }

    this.firmaGuardando = true;
    try {
      const c = this.lienzo!.nativeElement;
      const blob: Blob | null = await new Promise(res => c.toBlob(b => res(b), 'image/png'));
      if (!blob) throw new Error('No se pudo leer la firma del lienzo.');
      const url = await this.subirFirma(blob);
      if (!url) {
        Swal.fire({ icon: 'error', title: 'No se pudo guardar la firma', text: 'Falló la subida de la imagen. Inténtalo de nuevo.' });
        return;
      }
      const hoy = new Date();
      const firma = {
        nombre: this.firmaNombre.trim(),
        url,
        fecha: `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`,
      };
      const r = await this.api.post('/api/tickets', { id: t.id, [f]: firma });
      if (r?.ticket) this.ticketAbierto.set({ ...r.ticket });
      await this.cargar();
      this.cerrarFirma();
    } catch (e: any) {
      this.avisoError(e, 'No se pudo guardar la firma.');
    } finally {
      this.firmaGuardando = false;
    }
  }

  async quitarFirma(f: Firma) {
    const t = this.ticketAbierto();
    if (!t) return;
    const r0 = await Swal.fire({
      icon: 'question', title: '¿Quitar esta firma?',
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'No',
      confirmButtonColor: '#DC2626',
    });
    if (!r0.isConfirmed) return;
    try {
      const r = await this.api.post('/api/tickets', { id: t.id, [f]: null });
      if (r?.ticket) this.ticketAbierto.set({ ...r.ticket });
    } catch (e: any) {
      this.avisoError(e, 'No se pudo quitar la firma.');
    }
  }

  // --- Presentación ----------------------------------------------------------

  folioTexto(folio: any): string {
    const n = Number(folio);
    return Number.isFinite(n) ? 'No. ' + String(n).padStart(6, '0') : 'No. —';
  }

  etiquetaEstatus(e: string): string { return ESTATUS_TEXTO[e] || e; }

  fechaLegible(f: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(f || ''));
    if (!m) return String(f || '—');
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${Number(m[3])} ${meses[Number(m[2]) - 1]} ${m[1]}`;
  }

  /** Días que lleva abierto un ticket sin cerrarse (para la lista). */
  diasAbierto(t: any): number | null {
    if (!t.creadoEn) return null;
    const fin = t.completadoEn || Date.now();
    return Math.floor((fin - Number(t.creadoEn)) / 86400000);
  }

  // --- PDF -------------------------------------------------------------------

  /**
   * Carga una imagen de Cloudinary para poder meterla en el PDF.
   *
   * `addImage` de jsPDF NO acepta una URL remota: necesita un dataURL o un
   * elemento de imagen ya cargado. Pasarle la URL tal cual no dibuja nada (y con
   * el try/catch alrededor, fallaba en silencio: el vale salía con las firmas en
   * blanco). `crossOrigin` es imprescindible porque jsPDF dibuja la imagen en un
   * canvas por dentro, y sin permiso CORS el canvas queda "contaminado" y lanza.
   */
  private cargarImagen(url: string): Promise<HTMLImageElement | null> {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
      // Si la imagen no responde, no se deja el PDF colgado esperándola.
      setTimeout(() => resolve(img.complete && img.naturalWidth > 0 ? img : null), 6000);
    });
  }

  /**
   * Genera el vale en PDF replicando el formato en papel.
   *
   * Se dibuja a mano con jsPDF (rectángulos y texto) en vez de capturar la
   * pantalla: así el PDF sale nítido a cualquier tamaño, pesa poco y no depende
   * de cómo se vea la página en el dispositivo de quien lo descarga.
   */
  async descargarPdf() {
    const t = this.ticketAbierto();
    if (!t) return;
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });

      const AZUL: [number, number, number] = [31, 56, 100];
      const AZUL_CLARO: [number, number, number] = [225, 232, 243];
      // El folio va en ROJO (antes verde): es el numero del vale y se busca de
      // un tiron entre todos los papeles. Rojo claro para que se lea sobre la
      // banda azul marino del encabezado.
      const ROJO: [number, number, number] = [255, 106, 96];
      const GRIS: [number, number, number] = [120, 130, 145];

      const M = 12;                     // margen
      const A = 210 - M * 2;            // ancho util
      let y = M;

      const linea = (x1: number, y1: number, x2: number, y2: number) => {
        doc.setDrawColor(...AZUL); doc.setLineWidth(0.25); doc.line(x1, y1, x2, y2);
      };
      const marco = (x: number, yy: number, w: number, h: number) => {
        doc.setDrawColor(...AZUL); doc.setLineWidth(0.25); doc.rect(x, yy, w, h);
      };
      /** Banda azul con texto blanco (los títulos del formato). */
      const banda = (texto: string, alto = 7) => {
        doc.setFillColor(...AZUL); doc.rect(M, y, A, alto, 'F');
        doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
        doc.text(texto, M + 2, y + alto / 2 + 1.2);
        y += alto;
      };
      /** Renglón etiqueta (fondo azul claro) + valor. */
      const campo = (etiqueta: string, valor: string, alto = 7, anchoEtiqueta = 52) => {
        doc.setFillColor(...AZUL_CLARO); doc.rect(M, y, anchoEtiqueta, alto, 'F');
        marco(M, y, anchoEtiqueta, alto);
        marco(M + anchoEtiqueta, y, A - anchoEtiqueta, alto);
        doc.setTextColor(...AZUL); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
        doc.text(etiqueta, M + 1.6, y + alto / 2 + 1);
        doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        doc.text(String(valor || ''), M + anchoEtiqueta + 2, y + alto / 2 + 1.2, { maxWidth: A - anchoEtiqueta - 4 });
        y += alto;
      };
      /** Bloque de texto largo, con las líneas del formato. */
      const bloque = (etiqueta: string, valor: string, renglones = 4, anchoEtiqueta = 52) => {
        const alto = 4.6 * renglones + 2;
        doc.setFillColor(...AZUL_CLARO); doc.rect(M, y, anchoEtiqueta, alto, 'F');
        marco(M, y, anchoEtiqueta, alto);
        marco(M + anchoEtiqueta, y, A - anchoEtiqueta, alto);
        doc.setTextColor(...AZUL); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
        doc.text(doc.splitTextToSize(etiqueta, anchoEtiqueta - 3), M + 1.6, y + 4);
        doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6);
        const lineas = doc.splitTextToSize(String(valor || ''), A - anchoEtiqueta - 5);
        let yy = y + 4;
        for (let i = 0; i < renglones; i++) {
          if (lineas[i]) doc.text(lineas[i], M + anchoEtiqueta + 2, yy);
          else linea(M + anchoEtiqueta + 2, yy + 0.8, M + A - 2, yy + 0.8);
          yy += 4.6;
        }
        y += alto;
      };

      // ---------- Encabezado ----------
      doc.setFillColor(...AZUL); doc.rect(M, y, A, 12, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
      doc.text('VALE DE SERVICIO OPERATIVO', M + 3, y + 8);
      doc.setTextColor(...ROJO); doc.setFontSize(14);
      doc.text(this.folioTexto(t.folio).replace('No. ', 'No. '), M + A - 3, y + 8, { align: 'right' });
      y += 12;

      campo('FOLIO:', String(t.folio == null ? '' : String(t.folio).padStart(6, '0')), 7, 26);
      // La fecha va en el mismo renglón, a la derecha (como el formato).
      doc.setFillColor(...AZUL_CLARO); doc.rect(M + A / 2, y - 7, 24, 7, 'F');
      marco(M + A / 2, y - 7, 24, 7);
      doc.setTextColor(...AZUL); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
      doc.text('FECHA:', M + A / 2 + 1.6, y - 2.6);
      doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text(this.fechaLegible(t.fecha), M + A / 2 + 26, y - 2.6);

      campo('ÁREA / DEPARTAMENTO:', t.area);
      // Estatus, con la casilla marcada.
      const marca = (b: boolean) => (b ? '[X] ' : '[  ] ');
      campo('ESTATUS:', `${marca(t.estatus === 'completado')}COMPLETADO    ${marca(t.estatus === 'en_proceso')}EN PROCESO`
        + (t.estatus === 'abierto' ? '    [X] ABIERTO' : '')
        + (t.estatus === 'cancelado' ? '    [X] CANCELADO' : ''));
      campo('SOLICITANTE:', t.solicitante);
      campo('RESPONSABLE DEL SERVICIO:', t.responsable);
      campo('SUPERVISOR / JEFE INMEDIATO:', t.supervisor);
      campo('LUGAR / SUCURSAL / ÁREA:', t.lugar);

      y += 2;
      banda('INFORMACIÓN DEL SERVICIO REALIZADO');
      campo('ACTIVIDAD / SERVICIO REALIZADO:', t.actividad, 7, 56);
      bloque('DETALLE DE ACTIVIDADES REALIZADAS:', t.detalle, 5, 56);
      bloque('MATERIALES / REFACCIONES / RECURSOS UTILIZADOS:', t.materiales, 4, 56);
      bloque('RESULTADO / CONCLUSIÓN:', t.resultado, 3, 56);
      campo('¿REQUIERE SEGUIMIENTO?',
        `${marca(t.requiereSeguimiento === true)}SÍ   ${marca(t.requiereSeguimiento === false)}NO    `
        + (t.observacionesSeguimiento ? 'OBS: ' + t.observacionesSeguimiento : ''), 7, 56);

      // ---------- Firmas ----------
      y += 3;
      const anchoF = A / 3;
      const altoF = 30;
      const firmas: Array<{ t: string; d: any }> = [
        { t: 'REALIZADO POR:', d: t.firmaRealizado },
        { t: 'REVISADO POR:', d: t.firmaRevisado },
        { t: 'RECIBIDO / SEGUIMIENTO POR:', d: t.firmaRecibido },
      ];
      // Las imágenes se bajan ANTES de dibujar: addImage necesita la imagen ya
      // cargada, y hacerlo dentro del forEach no esperaría a que llegue.
      const imagenes = await Promise.all(
        firmas.map(f => (f.d && f.d.url) ? this.cargarImagen(f.d.url) : Promise.resolve(null))
      );
      firmas.forEach((f, i) => {
        const x = M + anchoF * i;
        doc.setFillColor(...AZUL); doc.rect(x, y, anchoF, 6, 'F');
        doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6);
        doc.text(f.t, x + anchoF / 2, y + 4, { align: 'center' });
        marco(x, y + 6, anchoF, altoF);
        doc.setTextColor(...GRIS); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.4);
        doc.text('(NOMBRE Y FIRMA)', x + anchoF / 2, y + 10, { align: 'center' });

        const img = imagenes[i];
        if (img) {
          try { doc.addImage(img, 'PNG', x + 4, y + 11, anchoF - 8, 13); }
          catch (e) { console.warn('[tickets] no se pudo dibujar la firma en el PDF:', e); }
        }
        linea(x + 4, y + 25, x + anchoF - 4, y + 25);
        doc.setTextColor(20, 20, 20); doc.setFontSize(7);
        doc.text(String((f.d && f.d.nombre) || ''), x + anchoF / 2, y + 28.4, { align: 'center', maxWidth: anchoF - 6 });
        doc.setTextColor(...GRIS); doc.setFontSize(6.4);
        doc.text('FECHA: ' + ((f.d && f.d.fecha) ? this.fechaLegible(f.d.fecha) : '____ / ____ / ________'),
          x + anchoF / 2, y + 33.4, { align: 'center' });
      });
      y += 6 + altoF + 6;

      banda('OBSERVACIONES GENERALES', 6);
      bloque('', t.observacionesGenerales, 3, 2);

      if (t.estatus === 'cancelado' && t.motivoCancelacion) {
        y += 2;
        doc.setTextColor(200, 30, 30); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
        doc.text('TICKET CANCELADO: ' + t.motivoCancelacion, M + 2, y + 4, { maxWidth: A - 4 });
      }

      doc.save(`vale-${String(t.folio || '').padStart(6, '0')}.pdf`);
    } catch (e: any) {
      console.error('[tickets] pdf:', e);
      Swal.fire({ icon: 'error', title: 'No se pudo generar el PDF', text: e?.message || 'Inténtalo de nuevo.' });
    }
  }
}
