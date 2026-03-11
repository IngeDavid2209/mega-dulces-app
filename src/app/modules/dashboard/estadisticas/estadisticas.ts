import { Component, signal, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router'; 
import { FormsModule } from '@angular/forms';
import { Firestore, collection, onSnapshot, query, orderBy } from '@angular/fire/firestore';

@Component({
  selector: 'app-estadisticas',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule], 
  templateUrl: './estadisticas.html', 
  styleUrls: ['./estadisticas.css']
})
export class EstadisticasComponent implements OnInit {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null;

  globalProgress = signal(0);
  completedItems = signal(0);
  allItems = signal(0);

  // Mantenemos sincronizados los nombres de los estatus con la base de datos
  checklistsByStatus = signal({
    completo: { count: 0, percent: 0, color: '#2ecc71' },
    enProgreso: { count: 0, percent: 0, color: '#f1c40f' },
    pendiente: { count: 0, percent: 0, color: '#e74c3c' }
  });

  storeStats = signal<any[]>([]);
  nombresSucursales = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro'
  ];

  sucursalSeleccionadaParaEmpleados = signal('Morelia Abastos');
  empleadosStats = signal<any[]>([]);
  
  todosLosChecklists: any[] = []; 
  todosLosUsuariosNube: any[] = []; 

  private firestore = inject(Firestore);

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) this.currentUser = JSON.parse(sesion);
    this.conectarRadarNube(); 
  }

  // Función auxiliar para validar si una tarea está realmente terminada
  esItemValido(item: any): boolean {
    // Una tarea cuenta como "validada" si está marcada Y (si pide foto, tiene la foto)
    return item.checked === true && (!item.requiresPhoto || (item.photo !== null && item.photo !== ''));
  }

  conectarRadarNube() {
    // 1. ESCUCHAR USUARIOS
    onSnapshot(collection(this.firestore, 'usuarios'), (snapshot) => {
      this.todosLosUsuariosNube = snapshot.docs.map(doc => doc.data());
      this.calcularEstadisticasEmpleados(); 
    });

    // 2. ESCUCHAR CHECKLISTS (Sin filtros de tiempo agresivos para las estadísticas)
    const checklistsRef = collection(this.firestore, 'checklists');
    onSnapshot(checklistsRef, (snapshot) => {
      const listas: any[] = [];
      const ahora = Date.now();
      const sieteDias = 7 * 24 * 60 * 60 * 1000; // Ampliamos a 7 días para ver historial

      snapshot.forEach(docSnap => {
        const c: any = docSnap.data();
        const timestamp = c.id || c.timestampCreacion || ahora;
        
        // Solo ignoramos lo que sea más viejo de una semana
        if ((ahora - timestamp) <= sieteDias) {
          listas.push(c);
        }
      });

      this.todosLosChecklists = listas;
      this.calcularEstadisticasGenerales();
      this.calcularEstadisticasEmpleados();
    });
  }

  calcularEstadisticasGenerales() {
    const checklists = this.todosLosChecklists;
    if (checklists.length === 0) return;

    let totalGlobalItems = 0;
    let totalGlobalCompletados = 0;

    // Contadores de estatus
    let c_completos = 0;
    let c_progreso = 0;
    let c_pendientes = 0;

    checklists.forEach(c => {
      // 1. Contar estatus (Normalizamos para que coincida con los badges)
      if (c.status === 'completo' || c.enviado) c_completos++;
      else if (c.status === 'en-progreso') c_progreso++;
      else c_pendientes++;

      // 2. Contar progreso de items individuales
      c.items.forEach((item: any) => {
        totalGlobalItems++;
        if (this.esItemValido(item)) totalGlobalCompletados++;
      });
    });

    this.allItems.set(totalGlobalItems);
    this.completedItems.set(totalGlobalCompletados);
    this.globalProgress.set(totalGlobalItems > 0 ? Math.round((totalGlobalCompletados / totalGlobalItems) * 100) : 0);

    const total = checklists.length;
    this.checklistsByStatus.set({
      completo: { count: c_completos, percent: Math.round((c_completos / total) * 100), color: '#2ecc71' },
      enProgreso: { count: c_progreso, percent: Math.round((c_progreso / total) * 100), color: '#f1c40f' },
      pendiente: { count: c_pendientes, percent: Math.round((c_pendientes / total) * 100), color: '#e74c3c' }
    });

    // Estadísticas por sucursal
    this.storeStats.set(this.nombresSucursales.map(suc => {
      const filtradas = checklists.filter(c => c.store === suc);
      let sTotal = 0;
      let sOk = 0;
      filtradas.forEach(c => c.items.forEach((i: any) => { 
        sTotal++; 
        if (this.esItemValido(i)) sOk++; 
      }));
      return { name: suc, progress: sTotal > 0 ? Math.round((sOk / sTotal) * 100) : 0, color: 'var(--brown)' };
    }));
  }

  calcularEstadisticasEmpleados() {
    const suc = this.sucursalSeleccionadaParaEmpleados();
    const empleados = this.todosLosUsuariosNube.filter((u: any) => {
      const susSucursales = u.sucursales || [u.sucursal || ''];
      return u.rol === 'trabajador' && susSucursales.includes(suc);
    });

    const stats = empleados.map((emp: any) => {
      const susListas = this.todosLosChecklists.filter(c => c.assigned === emp.nombre && c.store === suc);
      let eTotal = 0;
      let eOk = 0;

      susListas.forEach(c => c.items.forEach((i: any) => {
        eTotal++;
        if (this.esItemValido(i)) eOk++;
      }));

      const pct = eTotal > 0 ? Math.round((eOk / eTotal) * 100) : 0;
      return {
        nombre: emp.nombre,
        progress: pct,
        color: pct >= 90 ? '#2ecc71' : pct >= 50 ? '#f1c40f' : '#e74c3c',
        completados: eOk,
        total: eTotal
      };
    });

    this.empleadosStats.set(stats.sort((a, b) => b.progress - a.progress));
  }

  alCambiarSucursalEmpleados(event: any) {
    this.sucursalSeleccionadaParaEmpleados.set(event.target.value);
    this.calcularEstadisticasEmpleados();
  }
}