import { Component, signal, OnInit, OnDestroy, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router'; 
import { Firestore, collection, getDocs, doc, deleteDoc, onSnapshot } from '@angular/fire/firestore';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as ExcelJS from 'exceljs';
import html2canvas from 'html2canvas';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './reportes.html',
  styleUrls: ['./reportes.css'] 
})
export class ReportesComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null;
  fechaInicio = '';
  fechaFin = '';
  
  empleadoSeleccionado = '';
  textoBusquedaEmpleado = ''; 
  mostrarDropdownEmpleados = false; 
  
  empleados = signal<any[]>([]);
  resultados = signal<any[]>([]);
  buscando = signal(false);
  busquedaRealizada = signal(false);
  generandoReporte = signal(false);

  vistaActual = signal<'lista' | 'detalle'>('lista');
  checklistSeleccionado = signal<any>(null);

  isPasswordModalOpen = false;
  passwordInput = '';

  private firestore = inject(Firestore);
  private route = inject(ActivatedRoute); 
  private busquedaSub: any = null;

  @HostListener('document:click', ['$event'])
  onClickOutside(event: Event) {
    const target = event.target as HTMLElement;
    if (!target.closest('.autocomplete-container')) {
      this.mostrarDropdownEmpleados = false;
      if (this.empleadoSeleccionado !== this.textoBusquedaEmpleado) {
        this.textoBusquedaEmpleado = this.empleadoSeleccionado || 'Todos los empleados';
      }
    }
  }

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }
    
    const hoy = new Date();
    const offset = hoy.getTimezoneOffset() * 60000;
    const hoyLocal = new Date(hoy.getTime() - offset);
    
    this.fechaFin = hoyLocal.toISOString().split('T')[0];
    const primeroDeMes = new Date(hoyLocal.getFullYear(), hoyLocal.getMonth(), 1);
    this.fechaInicio = primeroDeMes.toISOString().split('T')[0];
    
    this.textoBusquedaEmpleado = 'Todos los empleados';

    this.cargarEmpleados().then(() => {
      this.route.queryParams.subscribe(params => {
        if (params['empleado']) {
          this.empleadoSeleccionado = params['empleado'];
          this.textoBusquedaEmpleado = this.empleadoSeleccionado;
          this.buscarReportes(); 
        }
      });
    });
  }

  ngOnDestroy() { if (this.busquedaSub) { this.busquedaSub(); } }

  async cargarEmpleados() {
    const usuariosRef = collection(this.firestore, 'usuarios');
    const snapshot = await getDocs(usuariosRef);
    const lista: any[] = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data['rol'] === 'trabajador') lista.push(data);
    });
    this.empleados.set(lista);
  }

  get empleadosFiltrados() {
    if (this.textoBusquedaEmpleado === 'Todos los empleados' || this.textoBusquedaEmpleado.trim() === '') {
      return this.empleados();
    }
    const termino = this.textoBusquedaEmpleado.toLowerCase();
    return this.empleados().filter(emp => emp.nombre.toLowerCase().includes(termino));
  }

  seleccionarEmpleado(nombreEmpleado: string) {
    if (nombreEmpleado === '') {
      this.empleadoSeleccionado = '';
      this.textoBusquedaEmpleado = 'Todos los empleados';
    } else {
      this.empleadoSeleccionado = nombreEmpleado;
      this.textoBusquedaEmpleado = nombreEmpleado;
    }
    this.mostrarDropdownEmpleados = false;
  }

  onInputBusqueda() {
    this.mostrarDropdownEmpleados = true;
    if (this.textoBusquedaEmpleado.trim() === '') {
      this.empleadoSeleccionado = '';
    }
  }

  onFocusBusqueda() {
    this.mostrarDropdownEmpleados = true;
    this.textoBusquedaEmpleado = ''; 
  }

  buscarReportes() {
    this.buscando.set(true);
    this.busquedaRealizada.set(true);
    if (this.busquedaSub) { this.busquedaSub(); }

    const checklistsRef = collection(this.firestore, 'checklists');
    
    this.busquedaSub = onSnapshot(checklistsRef, (snapshot) => {
      const listasSinClones = new Map();

      snapshot.forEach(docSnap => {
        const c = docSnap.data() as any;
        if (c.eliminado === true) return;

        if (c.date >= this.fechaInicio && c.date <= this.fechaFin) {
          if (!this.empleadoSeleccionado || c.assigned === this.empleadoSeleccionado) {
            const marcados = c.items ? c.items.filter((i:any) => i.checked).length : 0;
            c.calcProgreso = c.items && c.items.length > 0 ? Math.round((marcados / c.items.length) * 100) : 0;
            c.calcCompletados = marcados; 

            const firma = `${c.name}_${c.assigned}_${c.store}_${c.date}`;
            if (!listasSinClones.has(firma)) {
              listasSinClones.set(firma, c);
            } else {
              const existente = listasSinClones.get(firma) as any;
              if (existente && c.calcProgreso > existente.calcProgreso) {
                listasSinClones.set(firma, c);
              }
            }
          }
        }
      });

      const filtrados = Array.from(listasSinClones.values());
      filtrados.sort((a, b) => b.timestampCreacion - a.timestampCreacion);
      
      this.resultados.set(filtrados);
      this.buscando.set(false);
    }, (error) => {
      console.error("Error buscando el historial:", error);
      Swal.fire({ icon: 'error', title: 'Error de Red', text: 'Hubo un error de conexión al buscar el historial.', confirmButtonColor: '#0F172A' });
      this.buscando.set(false);
    });
  }

  verDetalle(checklist: any) { this.checklistSeleccionado.set(checklist); this.vistaActual.set('detalle'); }
  volverALista() { this.checklistSeleccionado.set(null); this.vistaActual.set('lista'); }

  abrirModalEliminarTodo() {
    if (this.resultados().length === 0) { 
      Swal.fire({ icon: 'info', title: 'Nada que borrar', text: 'No hay registros en pantalla.', confirmButtonColor: '#0F172A' });
      return; 
    }
    this.passwordInput = ''; this.isPasswordModalOpen = true;
  }
  
  cerrarPasswordModal() { this.isPasswordModalOpen = false; this.passwordInput = ''; }

  async confirmarEliminacionTodo() {
    if (this.passwordInput !== 'Mega2323') { 
      Swal.fire({ icon: 'error', title: 'Clave Incorrecta', text: 'La contraseña maestra no es válida.', confirmButtonColor: '#0F172A' });
      return; 
    }
    
    this.cerrarPasswordModal();

    const result = await Swal.fire({
      title: '⚠️ PELIGRO EXTREMO',
      text: `¿Borrar permanentemente los ${this.resultados().length} registros filtrados en pantalla?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#EF4444',
      cancelButtonColor: '#0F172A',
      confirmButtonText: 'Sí, borrar todo',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      this.buscando.set(true); 
      try {
        for (const checklist of this.resultados()) {
          const docId = checklist.id.toString();
          await deleteDoc(doc(this.firestore, 'checklists', docId));
        }
        Swal.fire({ icon: 'success', title: 'Limpieza Total', text: 'Historial eliminado con éxito.', confirmButtonColor: '#0F172A' });
      } catch (error) { 
        Swal.fire({ icon: 'error', title: 'Fallo al borrar', text: 'Ocurrió un error en la base de datos.', confirmButtonColor: '#0F172A' });
      } finally { 
        this.buscando.set(false); 
      }
    }
  }

  getDisplayStatus(checklist: any): string {
    const statusReal = (checklist.status || 'pendiente').toLowerCase();
    if (statusReal === 'completo') return 'completo';
    const hoy = new Date();
    const offset = hoy.getTimezoneOffset() * 60000;
    const hoyStr = new Date(hoy.getTime() - offset).toISOString().split('T')[0];
    if (checklist.date && checklist.date < hoyStr) { return 'vencido'; }
    return statusReal;
  }

  getProgreso(checklist: any): number {
    if (checklist.calcProgreso !== undefined) return checklist.calcProgreso;
    if (!checklist.items || checklist.items.length === 0) return 0;
    const marcados = checklist.items.filter((i:any) => i.checked).length;
    return Math.round((marcados / checklist.items.length) * 100) || 0;
  }

  getCompletados(checklist: any): number { 
    if (!checklist.items) return 0;
    return checklist.items.filter((i:any) => i.checked).length; 
  }

  tieneFotos(checklist: any): boolean {
    if (!checklist.items) return false;
    return checklist.items.some((item: any) => 
      (item.photo && item.photo.includes('http')) || 
      (item.photoAntes && item.photoAntes.includes('http')) || 
      (item.photoDespues && item.photoDespues.includes('http'))
    );
  }

  async descargarExcel() {
    if (this.resultados().length === 0) {
      Swal.fire({ icon: 'info', title: 'Sin Datos', text: 'No hay datos para exportar.', confirmButtonColor: '#0F172A' });
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reporte Auditoría');

    worksheet.columns = [
      { header: 'Nombre Operación', key: 'name', width: 40 },
      { header: 'Sucursal', key: 'store', width: 20 },
      { header: 'Trabajador Asignado', key: 'assigned', width: 35 },
      { header: 'Fecha Cierre', key: 'date', width: 15 },
      { header: 'Estatus', key: 'status', width: 15 },
      { header: 'Tareas Comp.', key: 'tareas', width: 15 },
      { header: 'Progreso', key: 'progreso', width: 15 },
      { header: 'Comentarios del Empleado', key: 'notas', width: 60 } 
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25; 

    this.resultados().forEach(c => {
      worksheet.addRow({
        name: c.name, store: c.store, assigned: c.assigned, date: c.date,
        status: this.getDisplayStatus(c).toUpperCase(),
        tareas: `${this.getCompletados(c)} de ${c.items?.length || 0}`,
        progreso: `${this.getProgreso(c)}%`,
        notas: c.notaEmpleado || 'Sin comentarios'
      });
    });

    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
        if (rowNumber > 1) {
          if (colNumber >= 4 && colNumber <= 7) { cell.alignment = { vertical: 'middle', horizontal: 'center' }; } 
          else { cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true }; }
        }
      });
    });

    try {
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Reporte_MegaDulces_${this.fechaInicio}_al_${this.fechaFin}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); window.URL.revokeObjectURL(url);
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Error de Exportación', text: 'Hubo un error al generar el archivo Excel.', confirmButtonColor: '#0F172A' });
    }
  }

  descargarReportePDF() {
    if (this.resultados().length === 0) { 
      Swal.fire({ icon: 'info', title: 'Sin Datos', text: 'No hay datos para generar el PDF.', confirmButtonColor: '#0F172A' });
      return; 
    }

    const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
    
    doc.setFillColor(15, 23, 42); 
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), 25, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(255, 255, 255); 
    doc.text('MEGA DULCES', 14, 16);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(200, 200, 200);
    doc.text('Panel Enterprise • Reporte de Auditoría Operativa', 75, 16);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(30, 41, 59); 
    doc.text('Detalles de la Consulta', 14, 36);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139); 
    doc.text(`Periodo analizado: ${this.fechaInicio} al ${this.fechaFin}`, 14, 42);
    doc.text(`Filtro de usuario: ${this.empleadoSeleccionado || 'Todos los colaboradores'}`, 14, 47);
    doc.text(`Fecha de emisión: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 14, 52);
    doc.text(`Total de registros: ${this.resultados().length}`, 14, 57);

    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.5); doc.line(14, 62, doc.internal.pageSize.getWidth() - 14, 62);

    const bodyData = this.resultados().map(c => {
      const tareasCumplidas = c.items ? c.items.filter((i:any) => i.checked) : [];
      let detalle = '';
      
      if (tareasCumplidas.length === 0) { detalle = 'Sin tareas completadas.'; } 
      else {
        detalle = tareasCumplidas.map((t:any) => {
          let texto = `• ${t.text}`;
          if (t.requiresPhoto && (!t.photo || t.photo === '')) { texto += ' (Falta Evidencia)'; }
          if (t.requiresAntesDespues && (!t.photoAntes || !t.photoDespues)) { texto += ' (Falta Evid. Antes/Después)'; }
          return texto;
        }).join('\n');
      }

      if (c.notaEmpleado) {
        detalle += `\n\n📌 NOTA DEL COLABORADOR:\n${c.notaEmpleado}`;
      }

      const marcados = c.items ? c.items.filter((i:any) => i.checked).length : 0;
      const total = c.items ? c.items.length : 0;
      const progreso = total > 0 ? Math.round((marcados / total) * 100) : 0;

      return [ 
        c.date || '-', (c.name || '-').toUpperCase(), c.store || '-', c.assigned || '-', 
        `${progreso}%`, this.getDisplayStatus(c).toUpperCase(), detalle 
      ];
    });

    autoTable(doc, {
      startY: 68,
      head: [['Fecha', 'Operación', 'Sucursal', 'Responsable', 'Avance', 'Estado', 'Resumen de Tareas y Notas']],
      body: bodyData, theme: 'plain', 
      headStyles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 9, cellPadding: 5, lineColor: [226, 232, 240], lineWidth: { bottom: 1 } },
      bodyStyles: { textColor: [51, 65, 85], fontSize: 8, cellPadding: 4, lineColor: [226, 232, 240], lineWidth: { bottom: 0.5 } },
      alternateRowStyles: { fillColor: [255, 255, 255] }, 
      columnStyles: { 
        0: { cellWidth: 22 }, 1: { cellWidth: 40, fontStyle: 'bold', textColor: [15, 23, 42] }, 2: { cellWidth: 25 }, 3: { cellWidth: 35 }, 4: { cellWidth: 18, halign: 'center', fontStyle: 'bold' }, 5: { cellWidth: 25 }, 6: { cellWidth: 100 } 
      },
      didParseCell: function(data) {
        if (data.section === 'body' && data.column.index === 5) {
          const estado = data.cell.raw as string;
          if (estado.includes('COMPLETO')) { data.cell.styles.textColor = [21, 128, 61]; data.cell.styles.fontStyle = 'bold'; } 
          else if (estado.includes('PROGRESO')) { data.cell.styles.textColor = [29, 78, 216]; } 
          else if (estado.includes('VENCIDO')) { data.cell.styles.textColor = [220, 38, 38]; data.cell.styles.fontStyle = 'bold'; }
        }
      }
    });

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(148, 163, 184); 
      doc.text(`Mega Dulces App - Documento Confidencial | Página ${i} de ${pageCount}`, doc.internal.pageSize.getWidth() / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
    }
    doc.save(`Reporte_MegaDulces_${this.fechaInicio}_al_${this.fechaFin}.pdf`);
  }
// =======================================================================
  //  🔥  NUEVA GENERACIÓN DE PDF: MODO "1 TAREA POR HOJA" (ÁLBUM NATIVO)  🔥
  // =======================================================================
  async descargarPDFVisual() {
    if (this.resultados().length === 0) {
      Swal.fire({ icon: 'info', title: 'Sin Datos', text: 'No hay datos para generar el reporte visual.', confirmButtonColor: '#0F172A' });
      return;
    }

    if (this.resultados().length > 30) {
      const result = await Swal.fire({
        title: 'Reporte Pesado',
        text: 'Estás generando un reporte visual muy grande. Esto descargará muchas fotos y tomará algo de tiempo. ¿Deseas continuar?',
        icon: 'warning',
        showCancelButton: true, confirmButtonColor: '#0F172A', cancelButtonColor: '#64748B', confirmButtonText: 'Sí, generar PDF', cancelButtonText: 'Cancelar'
      });
      if (!result.isConfirmed) return;
    }

    this.generandoReporte.set(true);

    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // 🛠️ HELPER 1: DESCARGAR IMÁGENES SEGURAS EN BASE64
      const getBase64Image = (url: string): Promise<string | null> => {
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 600; // Mayor resolución para que se vean increíbles en hoja completa
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
          };
          img.onerror = () => resolve(null);
          img.src = url;
        });
      };

      // 🛠️ HELPER 2: ESCALAR FOTOS PERFECTAMENTE SIN DEFORMARLAS
      const calculateFit = (imgW: number, imgH: number, maxW: number, maxH: number) => {
        const imgRatio = imgW / imgH;
        const maxRatio = maxW / maxH;
        let finalW, finalH;
        if (imgRatio > maxRatio) {
          finalW = maxW;
          finalH = finalW / imgRatio;
        } else {
          finalH = maxH;
          finalW = finalH * imgRatio;
        }
        return { finalW, finalH };
      };

      // ================= 1. PORTADA CORPORATIVA =================
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, 28, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(255, 255, 255);
      doc.text('MEGA DULCES', 14, 15);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(200, 200, 200);
      doc.text('REPORTE DE AUDITORÍA VISUAL', 14, 22);

      const totalProgresos = this.resultados().reduce((sum, r) => sum + this.getProgreso(r), 0);
      const promedio = this.resultados().length > 0 ? Math.round(totalProgresos / this.resultados().length) : 0;
autoTable(doc, {
        startY: 35,
        head: [['Resumen Ejecutivo', '']],
        body: [
          ['Período analizado', `${this.fechaInicio} al ${this.fechaFin}`],
          ['Filtro aplicado', this.empleadoSeleccionado || 'Todos los colaboradores'],
          ['Total de registros', `${this.resultados().length} checklists validados`],
          ['Cumplimiento general', `${promedio}% de efectividad`]
        ],
        theme: 'grid',
        headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 14, cellPadding: 8 },
        bodyStyles: { textColor: [51, 65, 85], fontSize: 12, cellPadding: 8 }, // cellPadding: 8 las hace más altas
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80 } } // Hacemos la primera columna un poco más ancha
      });

      // ================= 2. RECORRIDO DE CHECKLISTS =================
      for (let i = 0; i < this.resultados().length; i++) {
        const checklist = this.resultados()[i];

        // 📄 HOJA DE CARÁTULA DEL CHECKLIST
        doc.addPage();
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, pageWidth, 25, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(`AUDITORÍA: ${checklist.name.toUpperCase()}`, 14, 16);

        doc.setTextColor(15, 23, 42);
        doc.setFontSize(14);
        doc.text('DATOS DE LA EVALUACIÓN', 14, 40);

        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(14, 44, pageWidth - 14, 44);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Responsable:', 14, 55);
        doc.setFont('helvetica', 'normal');
        doc.text(checklist.assigned || 'No asignado', 50, 55);

        doc.setFont('helvetica', 'bold');
        doc.text('Sucursal/Zona:', 14, 65);
        doc.setFont('helvetica', 'normal');
        doc.text(checklist.store || 'General', 50, 65);

        doc.setFont('helvetica', 'bold');
        doc.text('Fecha:', 14, 75);
        doc.setFont('helvetica', 'normal');
        doc.text(checklist.date || '--', 50, 75);

        const progreso = this.getProgreso(checklist);
        doc.setFont('helvetica', 'bold');
        doc.text('Avance Global:', 14, 85);
        doc.setTextColor(progreso === 100 ? 16 : 29, progreso === 100 ? 185 : 78, progreso === 100 ? 129 : 216);
        doc.text(`${progreso}% COMPLETADO`, 50, 85);

        if (checklist.notaEmpleado) {
          doc.setTextColor(217, 119, 6);
          doc.text('COMENTARIOS DEL COLABORADOR:', 14, 105);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(51, 65, 85);
          const notes = doc.splitTextToSize(checklist.notaEmpleado, pageWidth - 28);
          doc.text(notes, 14, 113);
        }

        // 📄 HOJAS INDIVIDUALES POR CADA TAREA
        if (checklist.items && checklist.items.length > 0) {
          for (let j = 0; j < checklist.items.length; j++) {
            const item = checklist.items[j];
            
            // 🔥 AQUÍ ESTÁ LA MAGIA: 1 HOJA ENTERA NUEVA POR CADA TAREA
            doc.addPage();

            // ENCABEZADO DE TAREA
            doc.setFillColor(241, 245, 249);
            doc.rect(0, 0, pageWidth, 20, 'F');
            doc.setTextColor(100, 116, 139);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.text(`${checklist.name.toUpperCase()}  |  TAREA ${j + 1} DE ${checklist.items.length}`, 14, 13);

            // NOMBRE DE LA TAREA
            doc.setTextColor(15, 23, 42);
            doc.setFontSize(14);
            const checkIcon = item.checked ? '[ ✓ ] ' : '[ X ] ';
            const taskText = doc.splitTextToSize(checkIcon + item.text, pageWidth - 28);
            doc.text(taskText, 14, 35);

            let currentY = 35 + (taskText.length * 7) + 5;

            // ALERTAS DE ESTADO
            doc.setFontSize(10);
            if (!item.checked) {
              doc.setTextColor(220, 38, 38);
              doc.text('⚠️ TAREA NO COMPLETADA', 14, currentY);
              currentY += 12;
            } else if (item.requiresPhoto && !item.photo && !item.requiresAntesDespues) {
              doc.setTextColor(220, 38, 38);
              doc.text('⚠️ TAREA COMPLETADA SIN EVIDENCIA FOTOGRÁFICA', 14, currentY);
              currentY += 12;
            } else if (item.requiresAntesDespues && (!item.photoAntes || !item.photoDespues)) {
              doc.setTextColor(220, 38, 38);
              doc.text('⚠️ FALTAN EVIDENCIAS DE ANTES Y/O DESPUÉS', 14, currentY);
              currentY += 12;
            }

            // DIBUJAR FOTOS GIGANTES
            const availableHeight = pageHeight - currentY - 20; // 20 margen abajo para pie de página

            if (item.requiresAntesDespues) {
              const photoWidth = (pageWidth - 42) / 2; // Partimos la pantalla a la mitad
              const maxPhotoHeight = availableHeight - 15;

              let imgAntes = item.photoAntes ? await getBase64Image(item.photoAntes) : null;
              let imgDespues = item.photoDespues ? await getBase64Image(item.photoDespues) : null;

              // RENDERIZAR FOTO ANTES
              doc.setTextColor(15, 23, 42);
              doc.setFont('helvetica', 'bold');
              doc.text(`EVIDENCIA: ANTES ${item.photoAntesTime ? '('+item.photoAntesTime+')' : ''}`, 14, currentY + 5);
              if (imgAntes) {
                const imgProps = doc.getImageProperties(imgAntes);
                const { finalW, finalH } = calculateFit(imgProps.width, imgProps.height, photoWidth, maxPhotoHeight);
                const x = 14 + (photoWidth - finalW) / 2; // Centrar foto en su mitad
                doc.addImage(imgAntes, 'JPEG', x, currentY + 10, finalW, finalH);
              } else {
                doc.setTextColor(220, 38, 38);
                doc.setFont('helvetica', 'normal');
                doc.text('Sin imagen de "Antes"', 14, currentY + 15);
              }

              // RENDERIZAR FOTO DESPUÉS
              doc.setTextColor(16, 185, 129); // Verde
              doc.setFont('helvetica', 'bold');
              doc.text(`EVIDENCIA: DESPUÉS ${item.photoDespuesTime ? '('+item.photoDespuesTime+')' : ''}`, 14 + photoWidth + 14, currentY + 5);
              if (imgDespues) {
                const imgProps = doc.getImageProperties(imgDespues);
                const { finalW, finalH } = calculateFit(imgProps.width, imgProps.height, photoWidth, maxPhotoHeight);
                const x = 14 + photoWidth + 14 + (photoWidth - finalW) / 2;
                doc.addImage(imgDespues, 'JPEG', x, currentY + 10, finalW, finalH);
              } else {
                doc.setTextColor(220, 38, 38);
                doc.setFont('helvetica', 'normal');
                doc.text('Sin imagen de "Después"', 14 + photoWidth + 14, currentY + 15);
              }

            } else if (item.requiresPhoto || item.photo) {
              // RENDERIZAR 1 FOTO GIGANTE AL CENTRO
              const photoWidth = pageWidth - 28;
              const maxPhotoHeight = availableHeight - 15;

              let img = item.photo ? await getBase64Image(item.photo) : null;
              if (img) {
                doc.setTextColor(15, 23, 42);
                doc.setFont('helvetica', 'bold');
                doc.text(`EVIDENCIA FOTOGRÁFICA ${item.photoTime ? '('+item.photoTime+')' : ''}`, 14, currentY + 5);
                
                const imgProps = doc.getImageProperties(img);
                const { finalW, finalH } = calculateFit(imgProps.width, imgProps.height, photoWidth, maxPhotoHeight);
                const x = 14 + (photoWidth - finalW) / 2;
                doc.addImage(img, 'JPEG', x, currentY + 10, finalW, finalH);
              }
            }
          }
        }
      }

      // ================= 3. PIE DE PÁGINA GLOBAL =================
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(`Mega Dulces App - Página ${i} de ${pageCount}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
      }

      doc.save(`Auditoria_Visual_${this.fechaInicio}_al_${this.fechaFin}.pdf`);
    } catch (error) {
      console.error(error);
      Swal.fire({ icon: 'error', title: 'Error de Procesamiento', text: 'Ocurrió un error al generar el PDF.', confirmButtonColor: '#0F172A' });
    } finally {
      this.generandoReporte.set(false);
    }
  }
}