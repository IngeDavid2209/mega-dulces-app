import { Component, signal, OnInit, OnDestroy, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router'; 
import { Firestore, collection, getDocs, doc, deleteDoc, onSnapshot } from '@angular/fire/firestore';

// Librerías de exportación
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';

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
  
  // 🔥 VARIABLES PARA EL AUTOCOMPLETE DE EMPLEADOS 🔥
  empleadoSeleccionado = '';
  textoBusquedaEmpleado = ''; // Lo que el usuario teclea
  mostrarDropdownEmpleados = false; // Controla si se ve la lista flotante
  
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

  // Cierra el dropdown si el usuario hace clic afuera de él
  @HostListener('document:click', ['$event'])
  onClickOutside(event: Event) {
    const target = event.target as HTMLElement;
    if (!target.closest('.autocomplete-container')) {
      this.mostrarDropdownEmpleados = false;
      // Si salió sin seleccionar nada y escribió algo, volvemos al estado seleccionado o limpiamos
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

  // 🔥 LÓGICA DEL BUSCADOR INTELIGENTE 🔥
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

  // 🔥 NUEVA FUNCIÓN PARA VACIAR EL CAMPO AL HACER CLIC 🔥
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
      alert("Hubo un error de conexión al buscar el historial.");
      this.buscando.set(false);
    });
  }

  verDetalle(checklist: any) { this.checklistSeleccionado.set(checklist); this.vistaActual.set('detalle'); }
  volverALista() { this.checklistSeleccionado.set(null); this.vistaActual.set('lista'); }

  abrirModalEliminarTodo() {
    if (this.resultados().length === 0) { alert('No hay registros en pantalla para borrar.'); return; }
    this.passwordInput = ''; this.isPasswordModalOpen = true;
  }
  cerrarPasswordModal() { this.isPasswordModalOpen = false; this.passwordInput = ''; }

  async confirmarEliminacionTodo() {
    if (this.passwordInput !== 'Mega2323') { alert('❌ Contraseña maestra incorrecta.'); return; }
    const confirmar = confirm(`⚠️ PELIGRO:\n¿Borrar permanentemente los ${this.resultados().length} registros en pantalla?`);
    if (confirmar) {
      this.buscando.set(true); 
      try {
        for (const checklist of this.resultados()) {
          const docId = checklist.id.toString();
          await deleteDoc(doc(this.firestore, 'checklists', docId));
        }
        alert('🗑️ Historial eliminado con éxito.');
      } catch (error) { alert('❌ Error al eliminar.'); } 
      finally { this.cerrarPasswordModal(); }
    } else { this.cerrarPasswordModal(); }
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

  descargarExcel() {
    if (this.resultados().length === 0) return;

    const datosPlanos = this.resultados().map(c => {
      return {
        'ID Checklist': c.id,
        'Nombre Operación': c.name,
        'Sucursal': c.store,
        'Trabajador Asignado': c.assigned,
        'Fecha Cierre': c.date,
        'Estatus': c.status,
        'Tareas Completadas': `${this.getCompletados(c)} de ${c.items?.length || 0}`,
        'Progreso (%)': `${this.getProgreso(c)}%`
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(datosPlanos);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte Auditoría');
    XLSX.writeFile(workbook, `Reporte_Datos_MegaDulces_${this.fechaInicio}_al_${this.fechaFin}.xlsx`);
  }

  descargarReportePDF() {
    if (this.resultados().length === 0) { alert('No hay datos para generar el PDF.'); return; }

    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(22); doc.setTextColor(101, 67, 33); doc.text('MEGA DULCES DE LOS ALTOS', 14, 20);
    doc.setFontSize(14); doc.setTextColor(200, 127, 0); doc.text('REPORTE DE AUDITORÍA OPERATIVA', 14, 28);
    doc.setFontSize(10); doc.setTextColor(100, 100, 100); 
    doc.text(`Generado: ${new Date().toLocaleDateString()} a las ${new Date().toLocaleTimeString()}`, 14, 38);
    doc.text(`Periodo: ${this.fechaInicio} al ${this.fechaFin}`, 14, 44);

    const bodyData = this.resultados().map(c => {
      const tareasCumplidas = c.items ? c.items.filter((i:any) => i.checked) : [];
      const detalle = tareasCumplidas.map((t:any) => {
        let texto = `• ${t.text}`;
        if (t.requiresPhoto && (!t.photo || t.photo === '')) { texto += ' [SIN FOTO]'; }
        return texto;
      }).join('\n');

      return [ c.date || '-', c.assigned || '-', c.store || '-', c.name || '-', (c.status || 'pendiente').toUpperCase(), detalle || 'Ninguna' ];
    });

    autoTable(doc, {
      startY: 50,
      head: [['Fecha', 'Empleado', 'Sucursal', 'Checklist', 'Estado', 'Tareas (Sin Evidencia Gráfica)']],
      body: bodyData,
      theme: 'grid',
      headStyles: { fillColor: [101, 67, 33], textColor: 255 }, 
      alternateRowStyles: { fillColor: [255, 243, 212] }, 
      styles: { fontSize: 8, cellPadding: 3, valign: 'middle' },
      columnStyles: { 4: { halign: 'center', fontStyle: 'bold' }, 5: { cellWidth: 100 } }
    });

    doc.save(`Auditoria_Textual_${this.fechaInicio}.pdf`);
  }

async descargarPDFVisual() {
    if (this.resultados().length === 0) return;
    
    if (this.resultados().length > 30) {
      const continuar = confirm('⚠️ ATENCIÓN: Estás intentando generar un reporte visual con más de 30 checklists. Esto procesará cientos de fotos y podría tomar varios minutos o trabar el navegador.\n\n¿Deseas continuar de todos modos?');
      if (!continuar) return;
    }

    this.generandoReporte.set(true);

    setTimeout(async () => {
      // 1. Buscamos el contenedor principal
      const contenedor = document.getElementById('reporte-imprimir-fotos');
      if (!contenedor) { this.generandoReporte.set(false); return; }

      try {
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        
        let currentY = 10; // Coordenada de altura inicial (Margen superior de 10mm)
        const margin = 10; // Margen estándar
        const usableHeight = pdfHeight - (margin * 2); // Altura que podemos usar sin salirnos de la hoja

        // 2. Extraemos a los "hijos" (Cada tarjeta individual de checklist)
        const tarjetas = Array.from(contenedor.children) as HTMLElement[];

        for (let i = 0; i < tarjetas.length; i++) {
          const tarjetaHTML = tarjetas[i];

          // 3. Le tomamos foto SOLO a esta tarjeta
          const canvas = await html2canvas(tarjetaHTML, { 
            scale: 1.5, 
            useCORS: true, 
            logging: false,
            backgroundColor: '#ffffff'
          });

          const imgData = canvas.toDataURL('image/jpeg', 0.8); 
          // Calculamos su altura en milímetros
          const imgHeight = (canvas.height * pdfWidth) / canvas.width;

          // 4. LÓGICA DE PAGINACIÓN INTELIGENTE
          // PREGUNTA A: ¿La tarjeta NO cabe en el espacio que sobra de esta hoja?
          if (currentY + imgHeight > pdfHeight - margin) {
            
            // PREGUNTA B: ¿La tarjeta es un "Monstruo" (Más alta que una hoja entera)?
            if (imgHeight > usableHeight) {
              // Es una tarjeta larguísima con muchas fotos. 
              // Empezamos en una hoja nueva para minimizar cortes.
              if (currentY > margin) {
                pdf.addPage();
                currentY = margin;
              }

              let heightLeft = imgHeight;
              let positionShift = 0;

              while (heightLeft > 0) {
                // Pegamos la imagen desplazada hacia arriba (con coordenada negativa)
                pdf.addImage(imgData, 'JPEG', 0, currentY + positionShift, pdfWidth, imgHeight);
                heightLeft -= usableHeight;

                if (heightLeft > 0) {
                  pdf.addPage(); // Falta foto, agregamos otra hoja
                  positionShift -= usableHeight; // Jalamos la foto más arriba
                  currentY = margin;
                } else {
                  // Terminamos de pegar al monstruo, guardamos dónde quedó el cursor
                  currentY = margin + (heightLeft + usableHeight);
                }
              }
            } else {
              // No es un monstruo, solo que ya no cabía en la hoja anterior.
              // Creamos hoja nueva, reiniciamos el cursor y la pegamos entera y bonita.
              pdf.addPage();
              currentY = margin;
              pdf.addImage(imgData, 'JPEG', 0, currentY, pdfWidth, imgHeight);
              currentY += imgHeight;
            }
          } else {
            // SÍ cabe perfectamente en la hoja actual sin cortarse.
            pdf.addImage(imgData, 'JPEG', 0, currentY, pdfWidth, imgHeight);
            currentY += imgHeight;
          }

          // Agregamos un pequeño espacio de 5 milímetros entre cada tarjeta
          currentY += 5; 
        }

        pdf.save(`Corte_Mensual_Visual_${this.fechaInicio}_al_${this.fechaFin}.pdf`);
      } catch (error) {
        console.error("Error generando PDF Visual:", error);
        alert('Ocurrió un error al procesar las fotografías. Asegúrate de tener buena conexión.');
      }
      
      this.generandoReporte.set(false);
    }, 500);
  }
}