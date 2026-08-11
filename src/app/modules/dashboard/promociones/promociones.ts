import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { ApiService } from '../../../shared/api.service';

/** Un archivo de evidencia ya subido. */
interface Evidencia {
  url: string;
  nombre: string;
  tipo: string;
  pesoKB: number;
  subidoEn: number;
}

/** Los 11 canales del formato MKTN001, tal como estan impresos.
 *  Fijos a proposito: Mayoreo, Ruta Diaria y Ruta Vecinal NO son sucursales del
 *  sistema, y los nombres del papel (PH, ALP, Zam. Centro) no coinciden con los
 *  del catalogo. Amarrarlos a las sucursales solo traeria confusion. */
const CANALES = [
  'PH', '8 Esquinas', 'ALP', 'Yurécuaro', 'Morelia A.', 'Morelia M.',
  'Canindo', 'Zam. Centro', 'Mayoreo', 'Ruta Diaria', 'Ruta Vecinal'
] as const;

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
 */
@Component({
  selector: 'app-promociones',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './promociones.html',
  styleUrls: ['./promociones.css']
})
export class PromocionesComponent implements OnInit {
  currentUser: any = null;
  isMenuOpen = false;

  private router = inject(Router);
  private api = inject(ApiService);

  readonly CANALES = CANALES;
  readonly RECURSOS = RECURSOS;
  /** Tope real de Cloudinary en subida sin firma. No es un limite que yo invente. */
  readonly MAX_ARCHIVO_MB = 10;

  // ---------------- Vista ----------------
  vista = signal<'lista' | 'captura'>('lista');
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
  porCanal: Record<string, string> = {};
  rutaDiariaLP = '';
  rutaDiariaCAN = '';
  rutaDiariaMOR = '';
  autoriza = '';

  ngOnInit() {
    const s = localStorage.getItem('md_sesion_actual');
    if (s) { try { this.currentUser = JSON.parse(s); } catch { } }
    this.cargarTodo();
  }

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
      const [p, pr] = await Promise.all([
        this.api.get('/api/promociones').catch(() => ({ promociones: [] })),
        this.api.get('/api/promo-proveedores').catch(() => ({ proveedores: [] }))
      ]);
      this.promociones.set(p?.promociones || []);
      this.proveedores.set(pr?.proveedores || []);
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
    this.paso.set(n);
  }

  // ================= Alta y edición =================
  async nueva() {
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
    this.codigos = Array.from({ length: 6 }, () => ({ codigo: '', descripcion: '' }));
    this.presupuestoTopado = ''; this.recurso = ''; this.recursoOtros = '';
    this.conceptos = ''; this.monto = null;
    this.distribucionDe = ''; this.distribucionCod = ''; this.cargo = '';
    this.porCanal = {};
    this.rutaDiariaLP = ''; this.rutaDiariaCAN = ''; this.rutaDiariaMOR = '';
    this.autoriza = '';
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
    if (Array.isArray(p.codigos) && p.codigos.length) {
      this.codigos = p.codigos.concat(
        Array.from({ length: Math.max(0, 6 - p.codigos.length) }, () => ({ codigo: '', descripcion: '' })));
    }
    this.presupuestoTopado = p.presupuestoTopado || '';
    this.recurso = p.recurso || '';
    this.recursoOtros = p.recursoOtros || '';
    this.conceptos = p.conceptos || '';
    this.monto = p.monto ?? null;
    this.distribucionDe = p.distribucionDe || '';
    this.distribucionCod = p.distribucionCod || '';
    this.cargo = p.cargo || '';
    this.porCanal = { ...(p.porCanal || {}) };
    this.rutaDiariaLP = p.rutaDiariaLP || '';
    this.rutaDiariaCAN = p.rutaDiariaCAN || '';
    this.rutaDiariaMOR = p.rutaDiariaMOR || '';
    this.autoriza = p.autoriza || '';
    this.vista.set('captura');
    this.paso.set(this.pasoDesbloqueado(3) ? 3 : (this.pasoDesbloqueado(2) ? 2 : 1));
  }

  volverALista() { this.vista.set('lista'); this.cargarTodo(); }

  /** Estado que se guarda, para saber en que quedo cada promocion. */
  private estadoActual(): string {
    if (this.pasoDesbloqueado(3)) return 'paso3';
    if (this.pasoDesbloqueado(2)) return 'paso2';
    return 'paso1';
  }

  async guardar(avanzarA?: 1 | 2 | 3) {
    if (!this.proveedor.trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta el proveedor', confirmButtonColor: '#0F172A' });
      return;
    }
    if (this.subiendo() > 0) {
      Swal.fire({ icon: 'info', title: 'Espera a que terminen de subir los archivos', confirmButtonColor: '#0F172A' });
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
        porCanal: this.porCanal,
        rutaDiariaLP: this.rutaDiariaLP,
        rutaDiariaCAN: this.rutaDiariaCAN,
        rutaDiariaMOR: this.rutaDiariaMOR,
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
        confirmButtonColor: '#0F172A'
      });
    } finally {
      this.guardando.set(false);
    }
  }

  async eliminar(p: any) {
    const r = await Swal.fire({
      icon: 'warning', title: '¿Quitar esta promoción?',
      text: `Folio ${p.folio ?? '(sin folio)'} · ${p.proveedor || ''}. Se puede recuperar después.`,
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#C7382E'
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.del('/api/promociones?id=' + encodeURIComponent(p.id));
      this.cargarTodo();
    } catch (e: any) {
      Swal.fire({ icon: 'error', title: 'No se pudo quitar', text: e?.message || '', confirmButtonColor: '#0F172A' });
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
    const mb = archivo.size / 1024 / 1024;
    if (mb > this.MAX_ARCHIVO_MB) {
      Swal.fire({
        icon: 'warning', title: 'Archivo demasiado pesado',
        text: `"${archivo.name}" pesa ${mb.toFixed(1)} MB. El tope por archivo son ${this.MAX_ARCHIVO_MB} MB. ` +
              'Puedes adjuntar todos los archivos que quieras, pero de uno en uno tienen ese límite.',
        confirmButtonColor: '#0F172A'
      });
      return;
    }

    this.subiendo.set(this.subiendo() + 1);
    try {
      const fd = new FormData();
      fd.append('file', archivo);
      fd.append('upload_preset', 'fotos_mega');
      // 'auto' acepta cualquier formato, no solo imagenes (pdf, excel, xml...).
      const resp = await fetch('https://api.cloudinary.com/v1_1/duherjgyg/auto/upload', {
        method: 'POST', body: fd
      });
      const data = await resp.json().catch(() => null);
      if (!data?.secure_url) throw new Error(data?.error?.message || 'Cloudinary no devolvió el archivo');

      this.evidencias = [...this.evidencias, {
        url: data.secure_url,
        nombre: archivo.name,
        tipo: archivo.type || '',
        pesoKB: Math.round(archivo.size / 1024),
        subidoEn: Date.now()
      }];
    } catch (e: any) {
      Swal.fire({
        icon: 'error', title: 'No se pudo subir el archivo',
        text: `"${archivo.name}": ${e?.message || 'revisa tu conexión'}`,
        confirmButtonColor: '#0F172A'
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

  get proveedoresSugeridos(): any[] {
    const q = this.proveedor.trim().toLowerCase();
    const todos = this.proveedores();
    if (!q) return todos.slice(0, 8);
    return todos.filter(p => (p.nombre || '').toLowerCase().includes(q)).slice(0, 8);
  }

  elegirProveedor(nombre: string) { this.proveedor = nombre; }

  etiquetaEstado(e: string): string {
    return { paso1: 'Solo proveedor', paso2: 'Con oferta', paso3: 'Formato completo', cerrada: 'Cerrada' }[e] || e || '—';
  }

  folioTexto(f: number | null | undefined): string {
    if (f == null) return '—';
    return String(f).padStart(4, '0');
  }

  // ================= El PDF =================
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
      doc.setFillColor(...AZUL); doc.rect(M, y, W * 0.55, 9, 'F');
      doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text('APOYO PARA SELL OUT', M + 3, y + 6.4);
      doc.setDrawColor(...AZUL); doc.rect(M + W * 0.56, y, W * 0.22, 9);
      doc.setTextColor(...AZUL); doc.setFontSize(9);
      doc.text('FORMATO: MKTN001', M + W * 0.565, y + 6);
      doc.rect(M + W * 0.79, y, W * 0.21, 9);
      doc.setFontSize(11);
      doc.text('Folio: ' + this.folioTexto(this.folio), M + W * 0.80, y + 6.2);
      doc.setTextColor(0);
      y += 11;

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

      for (const c of this.CANALES) {
        const texto = c === 'Ruta Diaria'
          ? [this.rutaDiariaLP && ('LP: ' + this.rutaDiariaLP),
             this.rutaDiariaCAN && ('CAN: ' + this.rutaDiariaCAN),
             this.rutaDiariaMOR && ('MOR: ' + this.rutaDiariaMOR)].filter(Boolean).join('   ')
          : (this.porCanal[c] || '');
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
        text: e?.message || 'Inténtalo de nuevo.', confirmButtonColor: '#0F172A'
      });
    }
  }
}
