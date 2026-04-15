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

    // 🔥 AHORA EXPORTAMOS LOS COMENTARIOS AL EXCEL 🔥
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
        notas: c.notaEmpleado || 'Sin comentarios' // 🔥 SE AGREGAN LAS NOTAS AL EXCEL
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

      // 🔥 AGREGAMOS LA NOTA AL PDF SIMPLE 🔥
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

  async descargarPDFVisual() {
    if (this.resultados().length === 0) return;
    if (this.resultados().length > 30) {
      const result = await Swal.fire({
        title: 'Reporte Pesado', text: 'Estás intentando generar un reporte visual con más de 30 checklists. Esto procesará cientos de fotos y podría tomar varios minutos. ¿Deseas continuar?', icon: 'warning',
        showCancelButton: true, confirmButtonColor: '#0F172A', cancelButtonColor: '#64748B', confirmButtonText: 'Sí, generar PDF', cancelButtonText: 'Cancelar'
      });
      if (!result.isConfirmed) return;
    }

    this.generandoReporte.set(true);

    setTimeout(async () => {
      const contenedor = document.getElementById('reporte-imprimir-fotos');
      if (!contenedor) { this.generandoReporte.set(false); return; }

      try {
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        let currentY = 10; const margin = 10; const usableHeight = pdfHeight - (margin * 2); 
        const tarjetas = Array.from(contenedor.children) as HTMLElement[];

        for (let i = 0; i < tarjetas.length; i++) {
          const tarjetaHTML = tarjetas[i];
          const canvas = await html2canvas(tarjetaHTML, { scale: 1.5, useCORS: true, logging: false, backgroundColor: '#ffffff' });
          const imgData = canvas.toDataURL('image/jpeg', 0.8); 
          const imgHeight = (canvas.height * pdfWidth) / canvas.width;

          if (currentY + imgHeight > pdfHeight - margin) {
            if (imgHeight > usableHeight) {
              if (currentY > margin) { pdf.addPage(); currentY = margin; }
              let heightLeft = imgHeight; let positionShift = 0;
              while (heightLeft > 0) {
                pdf.addImage(imgData, 'JPEG', 0, currentY + positionShift, pdfWidth, imgHeight);
                heightLeft -= usableHeight;
                if (heightLeft > 0) { pdf.addPage(); positionShift -= usableHeight; currentY = margin; } 
                else { currentY = margin + (heightLeft + usableHeight); }
              }
            } else { pdf.addPage(); currentY = margin; pdf.addImage(imgData, 'JPEG', 0, currentY, pdfWidth, imgHeight); currentY += imgHeight; }
          } else { pdf.addImage(imgData, 'JPEG', 0, currentY, pdfWidth, imgHeight); currentY += imgHeight; }
          currentY += 5; 
        }
        pdf.save(`Corte_Mensual_Visual_${this.fechaInicio}_al_${this.fechaFin}.pdf`);
      } catch (error) {
        Swal.fire({ icon: 'error', title: 'Error de Procesamiento', text: 'Ocurrió un error al procesar las fotografías. Asegúrate de tener buena conexión.', confirmButtonColor: '#0F172A' });
      }
      this.generandoReporte.set(false);
    }, 500);
  }
}