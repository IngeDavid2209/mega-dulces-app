import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore';

@Component({
  selector: 'app-calendario',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './calendario.html',
  styleUrls: ['./calendario.css']
})
export class CalendarioComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  currentUser: any = null;

  empleados = signal<any[]>([]);
  checklistsGlobales: any[] = [];
  empleadoSeleccionado = 'Todos';
  
  fechaActual = new Date();
  mesActualNombre = '';
  anioActual = 0;
  diasCalendario = signal<any[]>([]);
  diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  // Para el modal de detalles
  diaSeleccionado = signal<any>(null);
  isModalOpen = false;

  private firestore = inject(Firestore);
  private router = inject(Router);
  private destructores: (() => void)[] = [];

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeVerEstadisticas) {
      this.router.navigate(['/home']); return;
    }
    this.conectarDatos();
    this.actualizarMes(0); // Genera el mes actual
  }

  ngOnDestroy() { this.destructores.forEach(d => d()); }

  conectarDatos() {
    const usuariosRef = collection(this.firestore, 'usuarios');
    this.destructores.push(onSnapshot(usuariosRef, (snap) => {
      const trabajadores = snap.docs.map(d => d.data()).filter((u: any) => u.rol === 'trabajador');
      this.empleados.set(trabajadores.sort((a: any, b: any) => (a.nombre || '').localeCompare(b.nombre || '')));
    }));

    const checklistsRef = collection(this.firestore, 'checklists');
    this.destructores.push(onSnapshot(checklistsRef, (snap) => {
      this.checklistsGlobales = snap.docs.map(d => d.data()).filter((c:any) => !c.eliminado);
      this.generarCalendario();
    }));
  }

  cambiarMes(incremento: number) {
    this.actualizarMes(incremento);
    this.generarCalendario();
  }

  actualizarMes(incremento: number) {
    this.fechaActual.setMonth(this.fechaActual.getMonth() + incremento);
    this.anioActual = this.fechaActual.getFullYear();
    const opcionesMes: Intl.DateTimeFormatOptions = { month: 'long' };
    this.mesActualNombre = this.fechaActual.toLocaleDateString('es-ES', opcionesMes).toUpperCase();
  }

  cambiarEmpleado() { this.generarCalendario(); }

  generarCalendario() {
    const year = this.fechaActual.getFullYear();
    const month = this.fechaActual.getMonth();
    const primerDia = new Date(year, month, 1).getDay();
    const diasEnMes = new Date(year, month + 1, 0).getDate();

    let grid = [];
    const hoyStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

    // Espacios en blanco para los días antes del inicio del mes
    for (let i = 0; i < primerDia; i++) { grid.push(null); }

    // Días reales del mes
    for (let i = 1; i <= diasEnMes; i++) {
      // Ajuste de zona horaria usando las 12 PM para evitar desfases
      const fechaLocal = new Date(year, month, i, 12);
      const fechaStr = fechaLocal.toISOString().split('T')[0];
      
      let tareasDelDia = this.checklistsGlobales.filter(c => c.date === fechaStr);
      if (this.empleadoSeleccionado !== 'Todos') {
        tareasDelDia = tareasDelDia.filter(c => c.assigned === this.empleadoSeleccionado);
      }

      let completadas = 0;
      let pendientes = 0;
      let vencidas = 0;

      tareasDelDia.forEach(tarea => {
        const tareasMarcadas = tarea.items ? tarea.items.filter((item:any) => item.checked).length : 0;
        const totalItems = tarea.items ? tarea.items.length : 0;
        
        if (tareasMarcadas === totalItems && totalItems > 0) { completadas++; }
        else if (fechaStr < hoyStr) { vencidas++; } // Ya pasó el día y no la completó
        else { pendientes++; }
      });

      grid.push({
        numero: i,
        fechaStr: fechaStr,
        esHoy: fechaStr === hoyStr,
        tareas: tareasDelDia,
        completadas, pendientes, vencidas,
        total: tareasDelDia.length
      });
    }
    this.diasCalendario.set(grid);
  }

  abrirDetalleDia(dia: any) {
    if (!dia || dia.total === 0) return;
    this.diaSeleccionado.set(dia);
    this.isModalOpen = true;
  }
  
  cerrarDetalle() {
    this.isModalOpen = false;
    this.diaSeleccionado.set(null);
  }

  cerrarSesion() {
    localStorage.removeItem('md_sesion_actual');
    this.router.navigate(['/login']);
  }
}