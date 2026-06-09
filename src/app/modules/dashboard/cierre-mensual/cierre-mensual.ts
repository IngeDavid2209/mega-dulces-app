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
  notaEmpleado?: string;             // comentario libre del colaborador
  entregaConRetraso?: boolean;
  motivoCategoria?: string;          // ej. "Falla de equipo"
  motivoComentario?: string;
}

interface TopEmpleado {
  nombre: string;
  hechas: number;
  totales: number;
  porcentaje: number;
}

interface SucursalAgrupada {
  sucursal: string;
  checklists: ChecklistResumen[];
  totalChecklists: number;
  totalTareas: number;
  totalHechas: number;
  totalFotos: number;
  porcentaje: number;
  topEmpleados: TopEmpleado[];        // top 3
  tendenciaDiaria: number[];          // % por día del mes (índice 0 = día 1)
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
    const [year, monthIdx0] = this.mesSeleccionado().split('-').map(Number);
    const diasEnMes = new Date(year, monthIdx0, 0).getDate();

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
        totalItems, itemsHechos, fotosTotales,
        notaEmpleado: c.notaEmpleado ? String(c.notaEmpleado).trim() : '',
        entregaConRetraso: c.entregaConRetraso === true,
        motivoCategoria: c.motivoRetraso?.categoria || '',
        motivoComentario: c.motivoRetraso?.comentario || ''
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

      // Top 3 empleados de la sucursal según % de cumplimiento
      const empMap = new Map<string, { hechas: number; totales: number }>();
      for (const c of lista) {
        if (!c.assigned) continue;
        if (!empMap.has(c.assigned)) empMap.set(c.assigned, { hechas: 0, totales: 0 });
        const e = empMap.get(c.assigned)!;
        e.totales += c.totalItems;
        e.hechas += c.itemsHechos;
      }
      const topEmpleados: TopEmpleado[] = Array.from(empMap.entries())
        .map(([nombre, v]) => ({
          nombre,
          hechas: v.hechas,
          totales: v.totales,
          porcentaje: v.totales > 0 ? Math.round((v.hechas / v.totales) * 100) : 0
        }))
        .filter(e => e.totales > 0)
        .sort((a, b) => b.porcentaje - a.porcentaje || b.hechas - a.hechas || a.nombre.localeCompare(b.nombre))
        .slice(0, 3);

      // Tendencia diaria: % de cumplimiento de los checklists con fecha == ese día
      const tendenciaDiaria: number[] = new Array(diasEnMes).fill(0);
      const tareasPorDia: number[] = new Array(diasEnMes).fill(0);
      const hechasPorDia: number[] = new Array(diasEnMes).fill(0);
      for (const c of lista) {
        // c.date es YYYY-MM-DD
        const diaStr = c.date?.split('-')?.[2];
        const dia = parseInt(diaStr || '0', 10);
        if (!dia || dia < 1 || dia > diasEnMes) continue;
        tareasPorDia[dia - 1] += c.totalItems;
        hechasPorDia[dia - 1] += c.itemsHechos;
      }
      for (let i = 0; i < diasEnMes; i++) {
        tendenciaDiaria[i] = tareasPorDia[i] > 0
          ? Math.round((hechasPorDia[i] / tareasPorDia[i]) * 100)
          : 0;
      }

      filas.push({
        sucursal,
        checklists: lista,
        totalChecklists: lista.length,
        totalTareas, totalHechas, totalFotos,
        porcentaje,
        topEmpleados,
        tendenciaDiaria
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
    if (totales.totalFotos > 200) {
      const r = await Swal.fire({
        title: 'Reporte grande',
        html: `Vas a generar un PDF con <strong>${totales.totalFotos}</strong> fotos. Puede tardar 1-3 minutos. ¿Continuar?`,
        icon: 'warning', showCancelButton: true,
        confirmButtonText: 'Sí, generar', cancelButtonText: 'Cancelar',
        confirmButtonColor: '#0F172A'
      });
      if (!r.isConfirmed) return;
    }

    this.generandoPDF.set(true);
    Swal.fire({
      title: 'Generando reporte...',
      html: '<p style="font-size:13px;color:#475569">Preparando el documento, no cierres la pestaña.</p><div id="cm-progreso" style="font-size:12px;color:#64748B;margin-top:8px"></div>',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');

      const doc = new jsPDF('p', 'mm', 'a4');
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const M = 18; // margen lateral generoso
      const sucursales = this.agrupadoPorSucursal();
      const fechaGen = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });

      // Paleta corporativa unificada
      const C = {
        navy:  [15, 23, 42] as [number, number, number],
        ink:   [30, 41, 59] as [number, number, number],
        gray:  [100, 116, 139] as [number, number, number],
        soft:  [148, 163, 184] as [number, number, number],
        line:  [226, 232, 240] as [number, number, number],
        bg:    [248, 250, 252] as [number, number, number],
        ok:    [16, 185, 129] as [number, number, number],
        warn:  [245, 158, 11] as [number, number, number],
        bad:   [239, 68, 68] as [number, number, number]
      };

      // ----- PRE-CARGA DE FOTOS -----
      let totalFotosProcesadas = 0;
      const fotosCache = new Map<string, string[]>();
      const itemKey = (suc: string, chkId: string, idx: number) => `${suc}|${chkId}|${idx}`;
      for (const s of sucursales) {
        for (const c of s.checklists) {
          for (let i = 0; i < c.itemsConFotos.length; i++) {
            const it = c.itemsConFotos[i];
            if (it.fotos.length === 0) continue;
            const thumbs: string[] = [];
            for (const fotoUrl of it.fotos) {
              const data = await this.cargarComoBase64(this.convertirAThumbnail(fotoUrl));
              if (data) {
                thumbs.push(data);
                totalFotosProcesadas++;
                const elProgreso = document.getElementById('cm-progreso');
                if (elProgreso) elProgreso.textContent = `Procesando fotos: ${totalFotosProcesadas} de ${totales.totalFotos}`;
              }
            }
            if (thumbs.length > 0) fotosCache.set(itemKey(s.sucursal, c.id, i), thumbs);
          }
        }
      }

      // =====================================================================
      // PÁGINA 1 — PORTADA (estilo libro / annual report)
      // =====================================================================
      // Marca discreta arriba
      doc.setDrawColor(...C.navy);
      doc.setLineWidth(0.5);
      doc.line(M, 30, M + 16, 30);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.gray);
      doc.text('MEGA DULCES', M, 36);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text('Reporte ejecutivo', M, 41);

      // Título principal — mucho aire, tipografía dominante
      doc.setTextColor(...C.navy);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(56);
      doc.text('Cierre', M, pageH * 0.42);
      doc.text('Mensual', M, pageH * 0.42 + 22);

      // Subtítulo
      doc.setFont('helvetica', 'normal'); doc.setFontSize(16); doc.setTextColor(...C.gray);
      doc.text(this.mesEtiqueta(), M, pageH * 0.42 + 36);

      // Línea separadora
      doc.setDrawColor(...C.navy); doc.setLineWidth(1);
      doc.line(M, pageH * 0.42 + 44, M + 30, pageH * 0.42 + 44);

      // Pie de portada
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.gray);
      doc.text(`Generado el ${fechaGen}`, M, pageH - 30);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C.navy);
      doc.text('MEGA DULCES DE LOS ALTOS', M, pageH - 24);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.soft);
      doc.text(`Documento confidencial · uso interno`, M, pageH - 18);

      // =====================================================================
      // PÁGINA 2 — RESUMEN EJECUTIVO
      // =====================================================================
      doc.addPage();
      this.dibujarHeaderPagina(doc, pageW, M, this.mesEtiqueta(), 'Resumen ejecutivo', C);

      // KPIs en 2x2 grandes, con tipografía generosa
      const kpiY = 48;
      const kpiW = (pageW - M * 2 - 8) / 2;
      const kpiH = 30;
      const kpis = [
        { num: `${totales.porcentaje}%`,  label: 'Cumplimiento general',     color: totales.porcentaje >= 80 ? C.ok : (totales.porcentaje >= 50 ? C.warn : C.bad) },
        { num: totales.totalChecklists.toString(), label: 'Checklists procesados', color: C.navy },
        { num: `${totales.totalHechas}`,  label: `Tareas validadas (de ${totales.totalTareas})`, color: C.navy },
        { num: totales.totalFotos.toString(), label: 'Fotografías de evidencia', color: C.navy }
      ];
      for (let i = 0; i < kpis.length; i++) {
        const k = kpis[i];
        const x = M + (i % 2) * (kpiW + 8);
        const y = kpiY + Math.floor(i / 2) * (kpiH + 8);
        // Borde superior fino navy + número grande
        doc.setDrawColor(...C.navy); doc.setLineWidth(0.8);
        doc.line(x, y, x + kpiW, y);
        doc.setTextColor(...k.color);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(30);
        doc.text(k.num, x, y + 14);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.gray);
        doc.text(k.label.toUpperCase(), x, y + 22);
      }

      // Sección "Por sucursal" con barras horizontales (sin tabla apretada)
      let yResumen = kpiY + 2 * (kpiH + 8) + 10;
      doc.setTextColor(...C.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('DESEMPEÑO POR SUCURSAL', M, yResumen);
      doc.setDrawColor(...C.line); doc.setLineWidth(0.3);
      doc.line(M, yResumen + 1.5, pageW - M, yResumen + 1.5);
      yResumen += 8;

      // Lista visual con barras grandes
      const maxLabelW = 60; // mm
      const barX = M + maxLabelW + 4;
      const barTotalW = pageW - M - barX - 18;
      const rowH = 9;
      for (const s of sucursales) {
        if (yResumen + rowH > pageH - 20) { doc.addPage(); yResumen = 30; }
        // Nombre
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...C.ink);
        doc.text(s.sucursal.length > 32 ? s.sucursal.slice(0, 30) + '…' : s.sucursal, M, yResumen + 4);
        // Sub-meta
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.soft);
        doc.text(`${s.totalChecklists} chk · ${s.totalHechas}/${s.totalTareas} tareas`, M, yResumen + 8);
        // Barra fondo
        doc.setFillColor(...C.line);
        doc.roundedRect(barX, yResumen + 2, barTotalW, 4, 1, 1, 'F');
        // Barra fill
        const fillW = (s.porcentaje / 100) * barTotalW;
        const c = s.porcentaje >= 80 ? C.ok : (s.porcentaje >= 50 ? C.warn : C.bad);
        if (fillW > 0) {
          doc.setFillColor(...c);
          doc.roundedRect(barX, yResumen + 2, Math.max(fillW, 1), 4, 1, 1, 'F');
        }
        // %
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...c);
        doc.text(`${s.porcentaje}%`, pageW - M, yResumen + 5, { align: 'right' });
        yResumen += rowH + 2;
      }

      // =====================================================================
      // POR CADA SUCURSAL — portadilla + páginas de detalle
      // =====================================================================
      for (const s of sucursales) {

        // ----- PORTADILLA DE LA SUCURSAL -----
        doc.addPage();
        this.dibujarHeaderPagina(doc, pageW, M, this.mesEtiqueta(), 'Sucursal · ' + s.sucursal, C);

        // Nombre de la sucursal gigante
        doc.setTextColor(...C.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(36);
        const nameLines = doc.splitTextToSize(s.sucursal, pageW - M * 2);
        doc.text(nameLines, M, 70);

        // Porcentaje gigante a la derecha
        const pctColor = s.porcentaje >= 80 ? C.ok : (s.porcentaje >= 50 ? C.warn : C.bad);
        doc.setTextColor(...pctColor); doc.setFont('helvetica', 'bold'); doc.setFontSize(80);
        doc.text(`${s.porcentaje}%`, pageW - M, 100, { align: 'right' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.gray);
        doc.text('CUMPLIMIENTO DEL MES', pageW - M, 108, { align: 'right' });

        // Sparkline tendencia diaria con etiqueta clara
        const sparkY = 130;
        doc.setTextColor(...C.gray); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        doc.text('TENDENCIA DIARIA', M, sparkY);
        doc.setDrawColor(...C.line); doc.line(M, sparkY + 1, pageW - M, sparkY + 1);
        this.dibujarSparklinePro(doc, s.tendenciaDiaria, M, sparkY + 5, pageW - M * 2, 14, C);

        // KPIs secundarios en línea
        const kY = sparkY + 28;
        const kpisSec = [
          { num: s.totalChecklists.toString(), label: 'Checklists' },
          { num: `${s.totalHechas}/${s.totalTareas}`, label: 'Tareas validadas' },
          { num: s.totalFotos.toString(), label: 'Fotografías' }
        ];
        const kSecW = (pageW - M * 2) / kpisSec.length;
        for (let i = 0; i < kpisSec.length; i++) {
          const x = M + i * kSecW;
          doc.setDrawColor(...C.navy); doc.setLineWidth(0.6);
          doc.line(x, kY, x + 22, kY);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...C.navy);
          doc.text(kpisSec[i].num, x, kY + 10);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
          doc.text(kpisSec[i].label.toUpperCase(), x, kY + 16);
        }

        // Top 3 empleados con barras horizontales (no medallas chillonas)
        if (s.topEmpleados.length > 0) {
          const tY = kY + 30;
          doc.setTextColor(...C.gray); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
          doc.text('TOP 3 DEL MES', M, tY);
          doc.setDrawColor(...C.line); doc.line(M, tY + 1, pageW - M, tY + 1);
          let ty = tY + 8;
          for (let i = 0; i < Math.min(3, s.topEmpleados.length); i++) {
            const e = s.topEmpleados[i];
            // Número grande gris
            doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...C.soft);
            doc.text(`${i + 1}`, M, ty + 7);
            // Nombre
            doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...C.ink);
            doc.text(e.nombre, M + 10, ty + 4);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
            doc.text(`${e.hechas} de ${e.totales} tareas`, M + 10, ty + 9);
            // %
            doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...C.navy);
            doc.text(`${e.porcentaje}%`, pageW - M, ty + 7, { align: 'right' });
            ty += 13;
          }
        }

        // ----- PÁGINAS DE DETALLE DE LA SUCURSAL -----
        // Lista de checklists, uno por bloque, con sus tareas y fotos.
        // Estilo de "tarjeta limpia": cada item es un bloque, sin tabla apretada.
        doc.addPage();
        this.dibujarHeaderPagina(doc, pageW, M, this.mesEtiqueta(), 'Detalle · ' + s.sucursal, C);
        let y = 38;

        for (const c of s.checklists) {
          const altoEstimado = 22 + (c.itemsConFotos.length * 16);
          if (y + 40 > pageH - 20) {
            doc.addPage();
            this.dibujarHeaderPagina(doc, pageW, M, this.mesEtiqueta(), 'Detalle · ' + s.sucursal, C);
            y = 38;
          }

          // Encabezado del checklist
          doc.setFillColor(...C.bg);
          doc.rect(M, y, pageW - M * 2, 14, 'F');
          doc.setDrawColor(...C.navy); doc.setLineWidth(1);
          doc.line(M, y, M, y + 14);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...C.navy);
          doc.text(c.name.length > 70 ? c.name.slice(0, 68) + '…' : c.name, M + 3, y + 6);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
          doc.text(`${c.assigned}  ·  ${c.date}  ·  ${c.itemsHechos}/${c.totalItems} tareas hechas`, M + 3, y + 11);
          // Badge de estado a la derecha
          let badgeTxt = 'ENVIADO';
          let badgeColor = C.ok;
          if (!c.enviado) { badgeTxt = 'SIN ENVIAR'; badgeColor = C.soft; }
          else if (c.entregaConRetraso) { badgeTxt = 'RETRASO JUSTIFICADO'; badgeColor = C.warn; }
          doc.setFillColor(...badgeColor);
          const bw = doc.getStringUnitWidth(badgeTxt) * 7 / doc.internal.scaleFactor + 6;
          doc.roundedRect(pageW - M - bw, y + 3, bw, 8, 1.5, 1.5, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
          doc.text(badgeTxt, pageW - M - bw / 2, y + 8.5, { align: 'center' });
          y += 16;

          // Nota / motivo (si existe)
          if (c.notaEmpleado || c.entregaConRetraso) {
            const texto = [
              c.entregaConRetraso ? `Motivo del retraso: ${c.motivoCategoria || '—'} — ${c.motivoComentario || '(sin detalle)'}` : '',
              c.notaEmpleado ? `Comentario del colaborador: ${c.notaEmpleado}` : ''
            ].filter(Boolean).join('\n');
            const lines = doc.splitTextToSize(texto, pageW - M * 2 - 6);
            const h = lines.length * 4 + 4;
            if (y + h > pageH - 20) { doc.addPage(); this.dibujarHeaderPagina(doc, pageW, M, this.mesEtiqueta(), 'Detalle · ' + s.sucursal, C); y = 38; }
            doc.setFillColor(255, 251, 235);
            doc.setDrawColor(245, 158, 11); doc.setLineWidth(0.2);
            doc.roundedRect(M, y, pageW - M * 2, h, 1, 1, 'FD');
            doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(146, 64, 14);
            doc.text(lines, M + 3, y + 4);
            y += h + 3;
          }

          // Items del checklist con sus fotos
          for (let idx = 0; idx < c.itemsConFotos.length; idx++) {
            const it = c.itemsConFotos[idx];
            const fotos = fotosCache.get(itemKey(s.sucursal, c.id, idx)) || [];
            // alto del bloque: depende de cuántas fotos
            const fotosPorFila = 4;
            const filasFotos = fotos.length > 0 ? Math.ceil(fotos.length / fotosPorFila) : 0;
            const altoFila = filasFotos * 22; // 20mm alto + 2 separación
            const altoBloque = 10 + altoFila;

            if (y + altoBloque > pageH - 20) {
              doc.addPage();
              this.dibujarHeaderPagina(doc, pageW, M, this.mesEtiqueta(), 'Detalle · ' + s.sucursal, C);
              y = 38;
            }

            // Punto de estado a la izquierda
            doc.setFillColor(...(it.completado ? C.ok : C.soft));
            doc.circle(M + 2, y + 3, 1.4, 'F');
            // Texto del item
            doc.setFont('helvetica', it.completado ? 'normal' : 'normal'); doc.setFontSize(9.5); doc.setTextColor(...C.ink);
            const textoItem = doc.splitTextToSize(it.texto, pageW - M * 2 - 10);
            doc.text(textoItem, M + 7, y + 4);
            // Etiqueta lateral derecha del estado
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...(it.completado ? C.ok : C.soft));
            doc.text(it.completado ? 'HECHO' : 'PENDIENTE', pageW - M, y + 4, { align: 'right' });
            y += Math.max(7, textoItem.length * 4 + 3);

            // Fotos
            if (fotos.length > 0) {
              const fotoW = (pageW - M * 2 - (fotosPorFila - 1) * 3) / fotosPorFila;
              const fotoH = 20;
              let fx = M + 7;
              let fy = y;
              for (let i = 0; i < fotos.length; i++) {
                if (i > 0 && i % fotosPorFila === 0) { fx = M + 7; fy += fotoH + 2; }
                try {
                  // Marco blanco sutil
                  doc.setFillColor(255, 255, 255);
                  doc.setDrawColor(...C.line);
                  doc.setLineWidth(0.2);
                  doc.roundedRect(fx - 0.5, fy - 0.5, fotoW + 1, fotoH + 1, 0.5, 0.5, 'FD');
                  doc.addImage(fotos[i], 'JPEG', fx, fy, fotoW, fotoH);
                } catch { /* ignora */ }
                fx += fotoW + 3;
              }
              y = fy + fotoH + 3;
            }

            // Separador fino entre items
            doc.setDrawColor(...C.line); doc.setLineWidth(0.1);
            doc.line(M + 7, y, pageW - M, y);
            y += 2;
          }

          // Espacio entre checklists
          y += 6;
        }
      }

      // =====================================================================
      // FOOTERS — pie consistente en TODAS las páginas excepto portada
      // =====================================================================
      const totalPag = doc.getNumberOfPages();
      for (let i = 2; i <= totalPag; i++) {
        doc.setPage(i);
        doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
        doc.line(M, pageH - 12, pageW - M, pageH - 12);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.soft);
        doc.text('MEGA DULCES · Cierre Mensual · ' + this.mesEtiqueta(), M, pageH - 7);
        doc.text(`${i} / ${totalPag}`, pageW - M, pageH - 7, { align: 'right' });
      }

      const nombreArchivo = `Cierre_Mensual_${this.mesSeleccionado()}.pdf`;
      doc.save(nombreArchivo);
      Swal.fire({
        icon: 'success', title: 'Reporte generado',
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

  /**
   * Header consistente de página interior (estilo libro): nombre del documento
   * a la izquierda, sección a la derecha, línea inferior fina.
   */
  private dibujarHeaderPagina(doc: any, pageW: number, M: number, mes: string, seccion: string, C: any): void {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.soft);
    doc.text(`MEGA DULCES  ·  Cierre Mensual  ·  ${mes}`, M, 14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C.gray);
    doc.text(seccion.toUpperCase(), pageW - M, 14, { align: 'right' });
    doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
    doc.line(M, 18, pageW - M, 18);
  }

  /**
   * Sparkline profesional: línea limpia navy sobre fondo claro, gradiente
   * sutil bajo la línea (poligono relleno), etiquetas de inicio/fin del mes.
   * Sin puntos chillones; los días sin actividad bajan a 0%.
   */
  private dibujarSparklinePro(doc: any, valores: number[], x: number, y: number, ancho: number, alto: number, C: any): void {
    if (!valores || valores.length === 0) return;
    const n = valores.length;
    // Fondo plano gris muy claro
    doc.setFillColor(248, 250, 252);
    doc.rect(x, y, ancho, alto, 'F');
    // Líneas guía 50% y 100%
    doc.setDrawColor(...C.line); doc.setLineWidth(0.1);
    doc.line(x, y + alto / 2, x + ancho, y + alto / 2);
    doc.line(x, y, x + ancho, y);
    // Construye puntos
    const dx = ancho / Math.max(1, n - 1);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(100, valores[i] || 0));
      pts.push({ x: x + i * dx, y: y + alto - (v / 100) * alto });
    }
    // Polígono relleno (área bajo la curva) — gris muy claro
    doc.setFillColor(219, 234, 254);
    const polyPath = pts.concat([{ x: x + ancho, y: y + alto }, { x: x, y: y + alto }]);
    doc.lines(
      polyPath.slice(1).map((p, i) => [p.x - polyPath[i].x, p.y - polyPath[i].y]),
      polyPath[0].x, polyPath[0].y,
      [1, 1], 'F'
    );
    // Línea sobre el polígono
    doc.setDrawColor(...C.navy); doc.setLineWidth(0.6);
    for (let i = 0; i < pts.length - 1; i++) {
      doc.line(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    }
    // Labels
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...C.soft);
    doc.text(`día 1`, x, y + alto + 4);
    doc.text(`día ${n}`, x + ancho, y + alto + 4, { align: 'right' });
    doc.text(`100%`, x + ancho + 1, y + 2);
    doc.text(`0%`, x + ancho + 1, y + alto);
  }

  /**
   * Sparkline legacy — se mantiene por compatibilidad con eventuales callers.
   * (Versión más simple, no se usa en el PDF nuevo).
   */
  private dibujarSparkline(doc: any, valores: number[], x: number, y: number, ancho: number, alto: number): void {
    if (!valores || valores.length === 0) return;
    const n = valores.length;
    // Línea base sutil
    doc.setDrawColor(180, 195, 220);
    doc.setLineWidth(0.1);
    doc.line(x, y + alto, x + ancho, y + alto);
    // Etiqueta "Tendencia"
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(180, 195, 220);
    doc.text(`Tendencia diaria · ${n} días`, x, y - 1);
    // Puntos
    const dx = ancho / Math.max(1, n - 1);
    doc.setDrawColor(110, 231, 183); // verde claro
    doc.setLineWidth(0.4);
    let prevX: number | null = null; let prevY: number | null = null;
    for (let i = 0; i < n; i++) {
      const v = valores[i] || 0;
      const px = x + i * dx;
      const py = y + alto - (v / 100) * alto;
      if (prevX !== null && prevY !== null) doc.line(prevX, prevY, px, py);
      // Pequeño círculo en cada punto
      doc.setFillColor(110, 231, 183);
      doc.circle(px, py, 0.5, 'F');
      prevX = px; prevY = py;
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
