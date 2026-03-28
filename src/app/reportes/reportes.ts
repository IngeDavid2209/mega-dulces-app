import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router'; 
import { Firestore, collection, getDocs, doc, deleteDoc, onSnapshot } from '@angular/fire/firestore';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
  
  empleados = signal<any[]>([]);
  resultados = signal<any[]>([]);
  buscando = signal(false);
  busquedaRealizada = signal(false);

  // Variables para controlar la vista de las fotos
  vistaActual = signal<'lista' | 'detalle'>('lista');
  checklistSeleccionado = signal<any>(null);

  isPasswordModalOpen = false;
  passwordInput = '';

  private firestore = inject(Firestore);
  private route = inject(ActivatedRoute); 
  
  private busquedaSub: any = null;

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

  ngOnDestroy() {
    if (this.busquedaSub) {
      this.busquedaSub();
    }
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

  buscarReportes() {
    this.buscando.set(true);
    this.busquedaRealizada.set(true);
    
    if (this.busquedaSub) {
      this.busquedaSub();
    }

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

  // Funciones para abrir y cerrar el detalle con fotos
  verDetalle(checklist: any) {
    this.checklistSeleccionado.set(checklist);
    this.vistaActual.set('detalle');
  }

  volverALista() {
    this.checklistSeleccionado.set(null);
    this.vistaActual.set('lista');
  }

  formatearHora(hora24: string): string {
    if (!hora24) return '';
    const partes = hora24.split(':');
    if (partes.length !== 2) return hora24;
    let horas = parseInt(partes[0], 10);
    const minutos = partes[1];
    const ampm = horas >= 12 ? 'PM' : 'AM';
    horas = horas % 12;
    horas = horas ? horas : 12; 
    return `${horas < 10 ? '0' + horas : horas}:${minutos} ${ampm}`;
  }

  abrirModalEliminarTodo() {
    if (this.resultados().length === 0) {
      alert('No hay registros en pantalla para borrar.');
      return;
    }
    this.passwordInput = '';
    this.isPasswordModalOpen = true;
  }

  cerrarPasswordModal() {
    this.isPasswordModalOpen = false;
    this.passwordInput = '';
  }

  async confirmarEliminacionTodo() {
    if (this.passwordInput !== 'Mega2323') {
      alert('❌ Contraseña maestra incorrecta. Operación cancelada.');
      return;
    }

    const confirmar = confirm(`⚠️ PELIGRO:\nEstás a punto de borrar permanentemente los ${this.resultados().length} registros que aparecen en pantalla.\n\n¿Estás completamente seguro? Esta acción NO se puede deshacer.`);
    
    if (confirmar) {
      this.buscando.set(true); 
      try {
        for (const checklist of this.resultados()) {
          const docId = checklist.id.toString();
          await deleteDoc(doc(this.firestore, 'checklists', docId));
        }
        alert('🗑️ Historial eliminado de la base de datos con éxito.');
      } catch (error) {
        console.error("Error al eliminar: ", error);
        alert('❌ Hubo un error al intentar eliminar el historial.');
      } finally {
        this.cerrarPasswordModal();
      }
    } else {
      this.cerrarPasswordModal();
    }
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
      
      // 🔥 REGLA RELAJADA PDF: Mostramos todas las que tienen palomita, pero acusamos si falta foto.
      const tareasCumplidas = c.items ? c.items.filter((i:any) => i.checked) : [];
      
      const detalle = tareasCumplidas.map((t:any) => {
        let texto = `• ${t.text}`;
        if (t.requiresPhoto && (!t.photo || t.photo === '')) {
          texto += ' (⚠️ Marcada SIN FOTO)';
        }
        return texto;
      }).join('\n');

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