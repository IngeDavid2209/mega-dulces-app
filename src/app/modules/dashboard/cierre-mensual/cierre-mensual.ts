import { Component, signal, computed, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Firestore, collection, getDocs, query, where } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import { tieneEvidencia } from '../../../shared/item-completado.util';

interface ItemConFotos {
  texto: string;
  asignado: string;
  fotos: string[];          // urls de Cloudinary (originales)
  completado: boolean;
}

interface ChecklistResumen {
  id: string;
  name: string;
  assigned: string;
  date: string;
  enviado: boolean;
  itemsConFotos: ItemConFotos[];
  totalItems: number;
  itemsHechos: number;
  fotosTotales: number;
}

interface SucursalAgrupada {
  sucursal: string;
  checklists: ChecklistResumen[];
  totalChecklists: number;
  totalTareas: number;
  totalHechas: number;
  totalFotos: number;
  porcentaje: number;
}

@Component({
  selector: 'app-cierre-mensual',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './cierre-mensual.html',
  styleUrls: ['./cierre-mensual.css']
})
export class CierreMensualComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  currentUser: any = null;

  /** Mes seleccionado en formato YYYY-MM. Default: mes actual. */
  mesSeleccionado = signal<string>(this.mesActualISO());

  /** Checklists del mes (ya filtrados por permisos del usuario). */
  private checklistsDelMes = signal<any[]>([]);
  cargando = signal<boolean>(false);
  generandoPDF = signal<boolean>(false);

  /** Texto humano del mes (Ej: "Junio 2026"). */
  mesEtiqueta = computed(() => {
    const [y, m] = this.mesSeleccionado().split('-').map(Number);
    if (!y || !m) return '';
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  });

  private firestore = inject(Firestore);

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) this.currentUser = JSON.parse(sesion);
    this.cargarMes();
  }
  ngOnDestroy() { /* no listener vivo, los datos se piden por mes */ }

  // ============================================================================
  // FECHAS
  // ============================================================================
  private mesActualISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  private primerDiaDelMes(yyyymm: string): string {
    return `${yyyymm}-01`;
  }
  private ultimoDiaDelMes(yyyymm: string): string {
    const [y, m] = yyyymm.split('-').map(Number);
    const ultimo = new Date(y, m, 0).getDate();
    return `${yyyymm}-${String(ultimo).padStart(2, '0')}`;
  }

  cambiarMes(event: any) {
    const valor = event?.target?.value;
    if (!valor) return;
    this.mesSeleccionado.set(valor);
    this.cargarMes();
  }
  mesAnterior() {
    const [y, m] = this.mesSeleccionado().split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    this.mesSeleccionado.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    this.cargarMes();
  }
  mesSiguiente() {
    const [y, m] = this.mesSeleccionado().split('-').map(Number);
    const d = new Date(y, m, 1);
    this.mesSeleccionado.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    this.cargarMes();
  }

  // ============================================================================
  // CARGA DESDE FIRESTORE (one-shot, no snapshot — es un reporte estático)
  // ============================================================================
  private async cargarMes() {
    this.cargando.set(true);
    try {
      const desde = this.primerDiaDelMes(this.mesSeleccionado());
      const hasta = this.ultimoDiaDelMes(this.mesSeleccionado());
      const ref = collection(this.firestore, 'checklists');
      const q = query(ref, where('date', '>=', desde), where('date', '<=', hasta));
      const snap = await getDocs(q);

      const permitidas = sucursalesPermitidas(this.currentUser);
      const arr: any[] = [];
      snap.forEach(d => {
        const data = d.data() as any;
        if (data.eliminado === true) return;
        if (permitidas !== null && !permitidas.includes(data.store)) return;
        arr.push({ ...data, id: d.id });
      });
      this.checklistsDelMes.set(arr);
    } catch (e) {
      console.error('[cierre-mensual]', e);
      Swal.fire({ icon: 'error', title: 'Error al cargar', text: 'No se pudo leer los checklists del mes.', confirmButtonColor: '#0F172A' });
    } finally {
      this.cargando.set(false);
    }
  }

  // ============================================================================
  // AGRUPACIÓN
  // ============================================================================
  /** Lista agrupada por sucursal, ordenada por % de cumplimiento descendente. */
  agrupadoPorSucursal = computed<SucursalAgrupada[]>(() => {
    const checklists = this.checklistsDelMes();
    const mapa = new Map<string, ChecklistResumen[]>();
    for (const c of checklists) {
      const store = c.store || 'Sin sucursal';
      const items: ItemConFotos[] = (c.items || []).map((it: any) => ({
        texto: it.text || '(sin texto)',
        asignado: c.assigned || '',
        fotos: this.extraerFotos(it),
        completado: tieneEvidencia(it)
      }));
      const totalItems = items.length;
      const itemsHechos = items.filter(i => i.completado).length;
      const fotosTotales = items.reduce((s, i) => s + i.fotos.length, 0);

      const resumen: ChecklistResumen = {
        id: c.id,
        name: c.name || '(sin nombre)',
        assigned: c.assigned || '',
        date: c.date || '',
        enviado: c.enviado === true,
        itemsConFotos: items,
        totalItems, itemsHechos, fotosTotales
      };
      if (!mapa.has(store)) mapa.set(store, []);
      mapa.get(store)!.push(resumen);
    }

    const filas: SucursalAgrupada[] = [];
    for (const [sucursal, lista] of mapa) {
      const totalTareas = lista.reduce((s, c) => s + c.totalItems, 0);
      const totalHechas = lista.reduce((s, c) => s + c.itemsHechos, 0);
      const totalFotos = lista.reduce((s, c) => s + c.fotosTotales, 0);
      const porcentaje = totalTareas > 0 ? Math.round((totalHechas / totalTareas) * 100) : 0;
      // Ordena los checklists dentro de la sucursal por fecha y luego por nombre
      lista.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
      filas.push({
        sucursal,
        checklists: lista,
        totalChecklists: lista.length,
        totalTareas, totalHechas, totalFotos,
        porcentaje
      });
    }
    return filas.sort((a, b) => b.porcentaje - a.porcentaje || a.sucursal.localeCompare(b.sucursal));
  });

  /** Totales globales del mes (todas las sucursales). */
  totalesGlobales = computed(() => {
    const filas = this.agrupadoPorSucursal();
    const totalChecklists = filas.reduce((s, f) => s + f.totalChecklists, 0);
    const totalTareas = filas.reduce((s, f) => s + f.totalTareas, 0);
    const totalHechas = filas.reduce((s, f) => s + f.totalHechas, 0);
    const totalFotos = filas.reduce((s, f) => s + f.totalFotos, 0);
    const porcentaje = totalTareas > 0 ? Math.round((totalHechas / totalTareas) * 100) : 0;
    return { totalChecklists, totalTareas, totalHechas, totalFotos, porcentaje };
  });

  /** Extrae todas las URLs de fotos de un item (varias formas posibles). */
  private extraerFotos(item: any): string[] {
    const urls: string[] = [];
    if (item.photo && typeof item.photo === 'string' && item.photo !== 'subiendo...') urls.push(item.photo);
    if (item.photoAntes && item.photoAntes !== 'subiendo...') urls.push(item.photoAntes);
    if (item.photoDespues && item.photoDespues !== 'subiendo...') urls.push(item.photoDespues);
    if (Array.isArray(item.photos)) {
      for (const p of item.photos) {
        const u = (p && p.url) ? p.url : p;
        if (u && typeof u === 'string') urls.push(u);
      }
    }
    return urls;
  }

  // ============================================================================
  // GENERACIÓN DEL PDF (lazy-load jsPDF + autotable)
  // ============================================================================
  async generarPDF() {
    if (this.generandoPDF()) return;
    const totales = this.totalesGlobales();
    if (totales.totalChecklists === 0) {
      Swal.fire({ icon: 'info', title: 'Sin datos', text: 'No hay checklists en el mes seleccionado.', confirmButtonColor: '#0F172A' });
      return;
    }
    // Aviso explícito si hay muchas fotos (PDF pesado / tiempo)
    if (totales.totalFotos > 200) {
      const r = await Swal.fire({
        title: 'Reporte grande',
        html: `Vas a generar un PDF con <strong>${totales.totalFotos}</strong> fotos.<br>
               Puede pesar 30-80 MB y tardar 1-3 minutos.<br>
               ¿Continuar?`,
        icon: 'warning', showCancelButton: true,
        confirmButtonText: 'Sí, generar', cancelButtonText: 'Cancelar',
        confirmButtonColor: '#0F172A'
      });
      if (!r.isConfirmed) return;
    }

    this.generandoPDF.set(true);
    Swal.fire({
      title: 'Generando PDF mensual...',
      html: '<p>Descargando librerías y comprimiendo fotos. No cierres la pestaña.</p><div id="cm-progreso" style="font-size:12px;color:#64748B;margin-top:8px"></div>',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');

      const doc = new jsPDF('p', 'mm', 'a4');
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margenX = 14;
      const sucursales = this.agrupadoPorSucursal();
      const fechaGen = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });

      // --- PORTADA ---
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageW, 50, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(26);
      doc.text('MEGA DULCES', margenX, 22);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(13);
      doc.text('Cierre Mensual de Operaciones', margenX, 32);
      doc.setFontSize(10); doc.setTextColor(200, 210, 230);
      doc.text(`Generado el ${fechaGen}`, margenX, 42);

      // Bloque de KPIs centrado
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
      doc.text(this.mesEtiqueta().toUpperCase(), pageW / 2, 78, { align: 'center' });

      const startY = 95;
      const kpiBoxes = [
        { label: 'Checklists', val: totales.totalChecklists.toString() },
        { label: 'Tareas hechas', val: `${totales.totalHechas} / ${totales.totalTareas}` },
        { label: 'Cumplimiento', val: `${totales.porcentaje}%` },
        { label: 'Fotos', val: totales.totalFotos.toString() }
      ];
      const boxW = (pageW - margenX * 2) / 4 - 4;
      for (let i = 0; i < kpiBoxes.length; i++) {
        const x = margenX + i * (boxW + 5);
        doc.setFillColor(241, 245, 249);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(x, startY, boxW, 26, 3, 3, 'FD');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(15, 23, 42);
        doc.text(kpiBoxes[i].val, x + boxW / 2, startY + 12, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
        doc.text(kpiBoxes[i].label, x + boxW / 2, startY + 21, { align: 'center' });
      }

      // Tabla resumen por sucursal
      autoTable(doc, {
        startY: startY + 38,
        head: [['Sucursal', 'Checklists', 'Tareas', 'Hechas', 'Cumplimiento']],
        body: sucursales.map(s => [
          s.sucursal,
          s.totalChecklists.toString(),
          s.totalTareas.toString(),
          s.totalHechas.toString(),
          `${s.porcentaje}%`
        ]),
        headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 10 },
        bodyStyles: { fontSize: 10 },
        margin: { left: margenX, right: margenX }
      });

      // --- UNA SECCIÓN POR SUCURSAL ---
      let totalFotosProcesadas = 0;
      for (let sIdx = 0; sIdx < sucursales.length; sIdx++) {
        const s = sucursales[sIdx];
        doc.addPage();
        // Encabezado de sucursal
        doc.setFillColor(30, 58, 138);
        doc.rect(0, 0, pageW, 24, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
        doc.text(s.sucursal, margenX, 16);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
        doc.text(`${s.totalChecklists} checklists · ${s.totalHechas}/${s.totalTareas} tareas · ${s.porcentaje}%`,
                 pageW - margenX, 16, { align: 'right' });

        let y = 32;
        for (const c of s.checklists) {
          // Título del checklist + meta
          if (y > pageH - 40) { doc.addPage(); y = 20; }
          doc.setTextColor(15, 23, 42);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
          doc.text(c.name, margenX, y);
          y += 5;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
          doc.text(`${c.assigned} · ${c.date} · ${c.itemsHechos}/${c.totalItems} hechas${c.enviado ? ' · Enviado' : ''}`, margenX, y);
          y += 6;

          // Items y fotos
          for (const it of c.itemsConFotos) {
            if (y > pageH - 50) { doc.addPage(); y = 20; }
            // Texto del item
            doc.setTextColor(30, 41, 59);
            doc.setFont('helvetica', it.completado ? 'bold' : 'normal'); doc.setFontSize(10);
            const marcador = it.completado ? '[X]' : '[ ]';
            const txt = doc.splitTextToSize(`${marcador} ${it.texto}`, pageW - margenX * 2);
            doc.text(txt, margenX, y);
            y += txt.length * 5 + 2;
            // Fotos del item: thumbnails 600px
            if (it.fotos.length > 0) {
              const thumbs: string[] = [];
              for (const fotoUrl of it.fotos) {
                const thumb = this.convertirAThumbnail(fotoUrl);
                const data = await this.cargarComoBase64(thumb);
                if (data) {
                  thumbs.push(data);
                  totalFotosProcesadas++;
                  const elProgreso = document.getElementById('cm-progreso');
                  if (elProgreso) elProgreso.textContent = `Foto ${totalFotosProcesadas} de ${totales.totalFotos}...`;
                }
              }
              if (thumbs.length > 0) {
                const fotoW = 55; const fotoH = 41;
                let fx = margenX; let nFila = 0;
                for (const thumb of thumbs) {
                  if (fx + fotoW > pageW - margenX) { fx = margenX; y += fotoH + 4; nFila++; }
                  if (y + fotoH > pageH - 12) { doc.addPage(); y = 20; fx = margenX; }
                  try { doc.addImage(thumb, 'JPEG', fx, y, fotoW, fotoH); } catch { /* ignora si falla */ }
                  fx += fotoW + 4;
                }
                y += fotoH + 6;
              }
            }
          }
          // Separador entre checklists
          doc.setDrawColor(226, 232, 240);
          doc.line(margenX, y, pageW - margenX, y);
          y += 6;
        }
      }

      // Pie de páginas con numeración
      const totalPag = doc.getNumberOfPages();
      for (let i = 1; i <= totalPag; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(148, 163, 184);
        doc.text(`Cierre Mensual ${this.mesEtiqueta()} · pág. ${i}/${totalPag}`,
                 pageW / 2, pageH - 6, { align: 'center' });
      }

      const nombreArchivo = `Cierre_Mensual_${this.mesSeleccionado()}.pdf`;
      doc.save(nombreArchivo);
      Swal.fire({
        icon: 'success', title: 'PDF generado',
        html: `Se descargó <strong>${nombreArchivo}</strong> con <strong>${totalFotosProcesadas}</strong> fotos.`,
        confirmButtonColor: '#0F172A'
      });
    } catch (e: any) {
      console.error('[generarPDF]', e);
      Swal.fire({
        icon: 'error', title: 'No se pudo generar el PDF',
        html: `<p>Intenta recargar la página y vuelve a intentar.</p>
               <p style="font-size:11px;color:#64748B"><strong>Detalle:</strong> <code>${(e?.message || e || '').toString().slice(0, 240)}</code></p>`,
        confirmButtonColor: '#0F172A'
      });
    } finally {
      this.generandoPDF.set(false);
    }
  }

  /** Convierte una URL de Cloudinary a su versión thumbnail 600px con compresión auto.
   *  Si no es URL de Cloudinary se regresa tal cual (intento normal). */
  private convertirAThumbnail(url: string): string {
    if (!url || !url.includes('/upload/')) return url;
    if (url.includes('/upload/w_') || url.includes('/upload/c_')) return url; // ya tiene transformación
    return url.replace('/upload/', '/upload/w_600,q_auto,f_jpg/');
  }

  /** Carga una imagen y la convierte a base64 para meterla en el PDF. */
  private cargarComoBase64(url: string): Promise<string | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 600;
          canvas.height = img.naturalHeight || 400;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /** ¿El usuario actual puede ver esta pantalla? (admin global o limitado). */
  get puedeUsar(): boolean {
    return this.currentUser?.rol === 'admin';
  }
  esAdminGlobal = computed(() => esAdminGlobal(this.currentUser));
}
