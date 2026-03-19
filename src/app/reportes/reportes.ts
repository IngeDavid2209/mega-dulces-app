import { Component, signal, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router'; 
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './reportes.html',
  styleUrls: ['./reportes.css'] 
})
export class ReportesComponent implements OnInit {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null;

  fechaInicio = '';
  fechaFin = '';
  empleadoSeleccionado = '';
  
  empleados = signal<any[]>([]);
  resultados = signal<any[]>([]);
  buscando = signal(false);
  busquedaRealizada = signal(false);

  private firestore = inject(Firestore);
  private route = inject(ActivatedRoute); 

  // Esta pantalla NO usa radares (onSnapshot), usa getDocs (petición única),
  // por lo tanto no requiere ngOnDestroy ni pre-cálculos de memoria. 😎

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
    }
    
    const hoy = new Date();
    const offset = hoy.getTimezoneOffset() * 60000;
    const hoyLocal = new Date(hoy.getTime() - offset);
    
    this.fechaFin = hoyLocal.toISOString().split('T')[0];
    
    const primeroDeMes = new Date(hoyLocal.getFullYear(), hoyLocal.getMonth(), 1);
    this.fechaInicio = primeroDeMes.toISOString().split('T')[0];

    this.cargarEmpleados().then(() => {
      this.route.queryParams.subscribe(params => {
        if (params['empleado']) {
          this.empleadoSeleccionado = params['empleado'];
          this.buscarReportes(); 
        }
      });
    });
  }

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

  async buscarReportes() {
    this.buscando.set(true);
    this.busquedaRealizada.set(true);
    this.resultados.set([]);

    try {
      const checklistsRef = collection(this.firestore, 'checklists');
      const snapshot = await getDocs(checklistsRef); 
      const filtrados: any[] = [];

      snapshot.forEach(doc => {
        const c = doc.data();
        if (c['date'] >= this.fechaInicio && c['date'] <= this.fechaFin) {
          if (!this.empleadoSeleccionado || c['assigned'] === this.empleadoSeleccionado) {
            filtrados.push(c);
          }
        }
      });

      filtrados.sort((a, b) => b.timestampCreacion - a.timestampCreacion);
      this.resultados.set(filtrados);

    } catch (error) {
      console.error("Error buscando el historial:", error);
      alert("Hubo un error de conexión al buscar el historial.");
    } finally {
      this.buscando.set(false);
    }
  }

  getProgreso(checklist: any): number {
    const completados = checklist.items.filter((i:any) => i.checked && (!i.requiresPhoto || (i.photo !== null && i.photo !== ''))).length;
    return Math.round((completados / checklist.items.length) * 100) || 0;
  }

  getCompletados(checklist: any): number { 
    return checklist.items.filter((i:any) => i.checked && (!i.requiresPhoto || (i.photo !== null && i.photo !== ''))).length; 
  }

  descargarReportePDF() {
    if (this.resultados().length === 0) {
      alert('No hay datos para generar el PDF.');
      return;
    }

    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(22);
    doc.setTextColor(101, 67, 33); 
    doc.text('MEGA DULCES DE LOS ALTOS', 14, 20);

    doc.setFontSize(14);
    doc.setTextColor(200, 127, 0); 
    doc.text('REPORTE DE AUDITORÍA OPERATIVA', 14, 28);

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100); 
    doc.text(`Generado el: ${new Date().toLocaleDateString()} a las ${new Date().toLocaleTimeString()}`, 14, 38);
    doc.text(`Periodo analizado: ${this.fechaInicio} al ${this.fechaFin}`, 14, 44);
    doc.text(`Empleado filtrado: ${this.empleadoSeleccionado || 'Todos los empleados'}`, 14, 50);

    const bodyData = this.resultados().map(c => {
      const fecha = c.date || '-';
      const empleado = c.assigned || 'Sin asignar';
      const puesto = 'Trabajador Operativo'; 
      const sucursal = c.store || '-';
      const nombreChecklist = c.name || '-';
      const estado = (c.status || 'pendiente').toUpperCase();
      
      const tareasCumplidas = c.items ? c.items.filter((i:any) => i.checked && (!i.requiresPhoto || (i.photo !== null && i.photo !== ''))) : [];
      const detalle = tareasCumplidas.map((t:any) => `• ${t.text}`).join('\n');

      return [ fecha, empleado, puesto, sucursal, nombreChecklist, estado, detalle || 'Ninguna tarea validada' ];
    });

    autoTable(doc, {
      startY: 58,
      head: [['Fecha', 'Empleado', 'Puesto', 'Sucursal', 'Checklist', 'Estado', 'Tareas Cumplidas (Evidencia Validada)']],
      body: bodyData,
      theme: 'grid',
      headStyles: { fillColor: [101, 67, 33], textColor: 255, fontStyle: 'bold', halign: 'center' }, 
      alternateRowStyles: { fillColor: [255, 243, 212] }, 
      styles: { fontSize: 8, cellPadding: 4, valign: 'middle' },
      columnStyles: { 5: { halign: 'center', fontStyle: 'bold' }, 6: { cellWidth: 100 } }
    });

    doc.save(`Auditoria_MegaDulces_${this.fechaInicio}.pdf`);
  }
}