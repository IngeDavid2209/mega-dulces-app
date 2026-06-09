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
      const margenX = 12;
      const sucursales = this.agrupadoPorSucursal();
      const fechaGen = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });

      // ========================================================================
      // PRE-CARGA DE FOTOS: descargamos todos los thumbnails una sola vez antes
      // de empezar a dibujar, para que el progreso sea visible y evitar reintentos
      // dentro del loop de tablas.
      // ========================================================================
      let totalFotosProcesadas = 0;
      // Mapa: itemId -> array de base64
      const fotosCache = new Map<string, string[]>();
      const itemKey = (suc: string, chkId: string, idx: number) => `${suc}|${chkId}|${idx}`;
      for (const s of sucursales) {
        for (const c of s.checklists) {
          for (let i = 0; i < c.itemsConFotos.length; i++) {
            const it = c.itemsConFotos[i];
            if (it.fotos.length === 0) continue;
            const thumbs: string[] = [];
            for (const fotoUrl of it.fotos) {
              const thumb = this.convertirAThumbnail(fotoUrl);
              const data = await this.cargarComoBase64(thumb);
              if (data) {
                thumbs.push(data);
                totalFotosProcesadas++;
                const elProgreso = document.getElementById('cm-progreso');
                if (elProgreso) elProgreso.textContent = `Cargando fotos: ${totalFotosProcesadas} de ${totales.totalFotos}...`;
              }
            }
            if (thumbs.length > 0) fotosCache.set(itemKey(s.sucursal, c.id, i), thumbs);
          }
        }
      }

      // ========================================================================
      // PORTADA: header oscuro + tabla ejecutiva + tabla resumen por sucursal
      // ========================================================================
      // Banda oscura superior
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageW, 22, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('MEGA DULCES · CIERRE MENSUAL', margenX, 9);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(180, 195, 220);
      doc.text(`Generado el ${fechaGen}`, pageW - margenX, 9, { align: 'right' });
      // Mes destacado
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
      doc.text(this.mesEtiqueta().toUpperCase(), margenX, 17);

      // Tabla ejecutiva (4 KPIs)
      autoTable(doc, {
        startY: 30,
        body: [[
          { content: totales.totalChecklists.toString(),
            styles: { halign: 'center', fontSize: 18, fontStyle: 'bold', textColor: [15, 23, 42] } },
          { content: `${totales.totalHechas} / ${totales.totalTareas}`,
            styles: { halign: 'center', fontSize: 18, fontStyle: 'bold', textColor: [15, 23, 42] } },
          { content: `${totales.porcentaje}%`,
            styles: { halign: 'center', fontSize: 22, fontStyle: 'bold', textColor: [16, 185, 129] } },
          { content: totales.totalFotos.toString(),
            styles: { halign: 'center', fontSize: 18, fontStyle: 'bold', textColor: [15, 23, 42] } }
        ], [
          { content: 'CHECKLISTS', styles: { halign: 'center', fontSize: 8, textColor: [100, 116, 139] } },
          { content: 'TAREAS HECHAS', styles: { halign: 'center', fontSize: 8, textColor: [100, 116, 139] } },
          { content: 'CUMPLIMIENTO', styles: { halign: 'center', fontSize: 8, textColor: [100, 116, 139] } },
          { content: 'FOTOS', styles: { halign: 'center', fontSize: 8, textColor: [100, 116, 139] } }
        ]],
        theme: 'grid',
        styles: { lineColor: [226, 232, 240], lineWidth: 0.3, cellPadding: { top: 4, bottom: 4 } },
        margin: { left: margenX, right: margenX }
      });

      // Tabla resumen por sucursal con barra de progreso
      const sucBody = sucursales.map(s => [
        s.sucursal,
        s.totalChecklists.toString(),
        s.totalTareas.toString(),
        s.totalHechas.toString(),
        s.totalFotos.toString(),
        `${s.porcentaje}%`
      ]);
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 8,
        head: [['SUCURSAL', 'CHK', 'TAREAS', 'HECHAS', 'FOTOS', 'CUMPL.']],
        body: sucBody,
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 9, halign: 'center' },
        bodyStyles: { fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 'auto', halign: 'left' },
          1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' },
          4: { halign: 'center' },
          5: { halign: 'center', fontStyle: 'bold' }
        },
        margin: { left: margenX, right: margenX },
        // Pinta de color la celda de cumplimiento según el porcentaje
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.column.index === 5) {
            const pct = parseInt((data.cell.text[0] || '0').replace('%', ''), 10) || 0;
            if (pct >= 80) data.cell.styles.textColor = [16, 185, 129];
            else if (pct >= 50) data.cell.styles.textColor = [245, 158, 11];
            else data.cell.styles.textColor = [239, 68, 68];
          }
        }
      });

      // ========================================================================
      // UNA PÁGINA POR SUCURSAL
      // ========================================================================
      for (let sIdx = 0; sIdx < sucursales.length; sIdx++) {
        const s = sucursales[sIdx];
        doc.addPage();

        // ---- Header oscuro: nombre + % grande + mini-gráfica ----
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, pageW, 38, 'F');
        // Nombre de sucursal
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
        doc.text(s.sucursal.toUpperCase(), margenX, 14);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(180, 195, 220);
        doc.text(`${s.totalChecklists} checklists · ${s.totalHechas}/${s.totalTareas} tareas · ${s.totalFotos} fotos`, margenX, 21);

        // Porcentaje grande
        const pctColor: [number, number, number] = s.porcentaje >= 80 ? [110, 231, 183]
                                                  : s.porcentaje >= 50 ? [253, 224, 71] : [252, 165, 165];
        doc.setTextColor(...pctColor);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(28);
        doc.text(`${s.porcentaje}%`, pageW - margenX, 16, { align: 'right' });
        doc.setFontSize(8); doc.setTextColor(180, 195, 220); doc.setFont('helvetica', 'normal');
        doc.text('CUMPLIMIENTO', pageW - margenX, 21, { align: 'right' });

        // Mini sparkline de tendencia diaria
        this.dibujarSparkline(doc, s.tendenciaDiaria, margenX, 26, pageW - margenX * 2, 8);

        let y = 44;

        // ---- Top 3 empleados del mes (si existen) ----
        if (s.topEmpleados.length > 0) {
          doc.setTextColor(15, 23, 42);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
          doc.text('TOP 3 DEL MES', margenX, y);
          y += 4;
          // 3 cajitas oro / plata / bronce
          const tw = (pageW - margenX * 2 - 8) / 3;
          const medallas = [
            { bg: [251, 191, 36], text: [120, 53, 15], label: 'Oro' },
            { bg: [203, 213, 225], text: [30, 41, 59], label: 'Plata' },
            { bg: [217, 119, 6], text: [255, 255, 255], label: 'Bronce' }
          ];
          for (let i = 0; i < 3; i++) {
            if (!s.topEmpleados[i]) continue;
            const emp = s.topEmpleados[i];
            const med = medallas[i];
            const x = margenX + i * (tw + 4);
            doc.setFillColor(med.bg[0], med.bg[1], med.bg[2]);
            doc.roundedRect(x, y, tw, 18, 2, 2, 'F');
            doc.setTextColor(med.text[0], med.text[1], med.text[2]);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
            doc.text(`#${i + 1} ${med.label.toUpperCase()}`, x + 3, y + 5);
            doc.setFontSize(11);
            const nombreCorto = emp.nombre.length > 26 ? emp.nombre.slice(0, 24) + '..' : emp.nombre;
            doc.text(nombreCorto, x + 3, y + 11);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
            doc.text(`${emp.porcentaje}% · ${emp.hechas}/${emp.totales}`, x + 3, y + 16);
          }
          y += 24;
        }

        // ---- Tabla principal: una fila por item ----
        // Aplanamos los items de todos los checklists con info de su parent
        type FilaItem = {
          numero: number;
          tarea: string;
          empleado: string;
          fecha: string;
          estado: string;
          comentario: string;
          fotosBase64: string[];
        };
        const filas: FilaItem[] = [];
        let n = 1;
        for (const c of s.checklists) {
          // Comentario / motivo a nivel del checklist
          let comentarioGlobal = '';
          if (c.entregaConRetraso) {
            const cat = c.motivoCategoria ? `[${c.motivoCategoria}] ` : '';
            comentarioGlobal = `RETRASO JUSTIFICADO ${cat}${c.motivoComentario || ''}`.trim();
          }
          if (c.notaEmpleado) {
            comentarioGlobal = (comentarioGlobal ? comentarioGlobal + '\n' : '') + `Nota: ${c.notaEmpleado}`;
          }
          for (let i = 0; i < c.itemsConFotos.length; i++) {
            const it = c.itemsConFotos[i];
            filas.push({
              numero: n++,
              tarea: `${c.name}\n${it.texto}`,
              empleado: c.assigned,
              fecha: c.date,
              estado: it.completado ? 'HECHO' : (c.entregaConRetraso ? 'RETRASO' : 'NO'),
              comentario: comentarioGlobal,
              fotosBase64: fotosCache.get(itemKey(s.sucursal, c.id, i)) || []
            });
          }
        }

        // Anchos por columna
        const colWidths = {
          numero: 8,
          tarea: 50,
          empleado: 28,
          fecha: 18,
          estado: 16,
          comentario: 32,
          fotos: pageW - margenX * 2 - (8 + 50 + 28 + 18 + 16 + 32)
        };

        autoTable(doc, {
          startY: y,
          head: [['#', 'CHECKLIST · TAREA', 'EMPLEADO', 'FECHA', 'EST.', 'NOTAS / RETRASO', 'EVIDENCIA']],
          body: filas.map(f => [f.numero, f.tarea, f.empleado, f.fecha, f.estado, f.comentario, '']),
          theme: 'grid',
          headStyles: {
            fillColor: [30, 58, 138], textColor: 255, fontSize: 8, halign: 'center',
            cellPadding: 2
          },
          bodyStyles: { fontSize: 8, cellPadding: 2, valign: 'top', lineColor: [226, 232, 240], lineWidth: 0.2 },
          columnStyles: {
            0: { cellWidth: colWidths.numero, halign: 'center' },
            1: { cellWidth: colWidths.tarea },
            2: { cellWidth: colWidths.empleado },
            3: { cellWidth: colWidths.fecha, halign: 'center' },
            4: { cellWidth: colWidths.estado, halign: 'center', fontStyle: 'bold' },
            5: { cellWidth: colWidths.comentario, fontSize: 7 },
            6: { cellWidth: colWidths.fotos }
          },
          margin: { left: margenX, right: margenX },
          // Colorea celda de estado según el valor
          didParseCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 4) {
              const v = (data.cell.text[0] || '').toString();
              if (v === 'HECHO') { data.cell.styles.fillColor = [220, 252, 231]; data.cell.styles.textColor = [22, 101, 52]; }
              else if (v === 'RETRASO') { data.cell.styles.fillColor = [254, 215, 170]; data.cell.styles.textColor = [154, 52, 18]; }
              else { data.cell.styles.fillColor = [254, 226, 226]; data.cell.styles.textColor = [153, 27, 27]; }
            }
          },
          // Calcula la altura mínima de la fila según número de fotos (para que quepan)
          willDrawCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 6) {
              const fila = filas[data.row.index];
              if (!fila) return;
              const n = fila.fotosBase64.length;
              if (n === 0) return;
              const fotosPorFila = 3;
              const filasFotos = Math.ceil(n / fotosPorFila);
              const altoFoto = 11; // mm
              const necesario = filasFotos * altoFoto + 2;
              if (data.row.height < necesario) data.row.height = necesario;
            }
          },
          // Dibuja las fotos dentro de la celda
          didDrawCell: (data: any) => {
            if (data.section !== 'body' || data.column.index !== 6) return;
            const fila = filas[data.row.index];
            if (!fila || fila.fotosBase64.length === 0) {
              // Marca "sin fotos" en gris claro
              doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
              doc.text('—', data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2 + 1, { align: 'center' });
              return;
            }
            const fotoW = (data.cell.width - 2) / 3 - 1;
            const fotoH = 10;
            let fx = data.cell.x + 1;
            let fy = data.cell.y + 1;
            for (let i = 0; i < fila.fotosBase64.length; i++) {
              if (i > 0 && i % 3 === 0) { fx = data.cell.x + 1; fy += fotoH + 1; }
              try { doc.addImage(fila.fotosBase64[i], 'JPEG', fx, fy, fotoW, fotoH); } catch { /* ignora */ }
              fx += fotoW + 1;
            }
          }
        });
      }

      // Pie de página con numeración
      const totalPag = doc.getNumberOfPages();
      for (let i = 1; i <= totalPag; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
        doc.text(`Cierre Mensual ${this.mesEtiqueta()}  ·  pág. ${i} de ${totalPag}`,
                 pageW / 2, pageH - 5, { align: 'center' });
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

  /**
   * Dibuja una mini-gráfica de líneas (sparkline) con los valores de % por día.
   * Se usa en el header de cada sucursal para mostrar la tendencia del mes.
   *  - Los días sin actividad (valor 0) se dibujan como puntitos planos.
   *  - Línea blanca delgada sobre fondo oscuro.
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
