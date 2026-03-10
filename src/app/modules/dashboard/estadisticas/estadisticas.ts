import { Component, signal, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router'; 
import { FormsModule } from '@angular/forms';
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore';

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

  checklistsByStatus = signal({
    completo: { count: 0, percent: 0, color: 'var(--green)' },
    enProgreso: { count: 0, percent: 0, color: 'var(--gold)' },
    pendiente: { count: 0, percent: 0, color: 'var(--red)' }
  });

  storeStats = signal<any[]>([]);

  nombresSucursales = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro'
  ];

  sucursalSeleccionadaParaEmpleados = signal('Canindo');
  empleadosStats = signal<any[]>([]);
  
  todosLosChecklists: any[] = []; 
  todosLosUsuariosNube: any[] = []; 

  private firestore = inject(Firestore);

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
    }
    this.conectarRadarNube(); 
  }

  conectarRadarNube() {
    // 1. ESCUCHAR USUARIOS
    const usuariosRef = collection(this.firestore, 'usuarios');
    onSnapshot(usuariosRef, (snapshot) => {
      this.todosLosUsuariosNube = [];
      snapshot.forEach(docSnap => this.todosLosUsuariosNube.push(docSnap.data()));
      this.calcularEstadisticasEmpleados(); 
    });

    // 2. ESCUCHAR CHECKLISTS (CON ESCUDO DE ZONA HORARIA 🔥)
    const checklistsRef = collection(this.firestore, 'checklists');
    onSnapshot(checklistsRef, (snapshot) => {
      const listasVigentes: any[] = [];
      
      // Magia para obtener la fecha exacta local sin que la hora de Londres nos afecte
      const offset = new Date().getTimezoneOffset() * 60000;
      const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];
      const limite24h = 24 * 60 * 60 * 1000;
      const ahora = Date.now();

      snapshot.forEach(docSnap => {
        const c: any = docSnap.data();
        
        // El checklist entra a la estadística si tiene fecha de HOY o si tiene menos de 24h de creado
        const tiempoCreacion = typeof c.id === 'number' ? c.id : (c.timestampCreacion || ahora);
        const esReciente = (ahora - tiempoCreacion) <= limite24h;
        const esDeHoy = c.date === fechaHoyLocal;

        if (esDeHoy || esReciente) {
          listasVigentes.push(c);
        }
      });

      this.todosLosChecklists = listasVigentes;
      this.calcularEstadisticasGenerales();
      this.calcularEstadisticasEmpleados();
    });
  }

  calcularEstadisticasGenerales() {
    const checklists = this.todosLosChecklists;

    if (checklists.length === 0) {
      this.storeStats.set(this.nombresSucursales.map(name => ({
        name, progress: 0, color: 'var(--coral)'
      })));
      this.globalProgress.set(0);
      this.completedItems.set(0);
      this.allItems.set(0);
      this.checklistsByStatus.set({
        completo: { count: 0, percent: 0, color: 'var(--green)' },
        enProgreso: { count: 0, percent: 0, color: 'var(--gold)' },
        pendiente: { count: 0, percent: 0, color: 'var(--red)' }
      });
      return;
    }

    let totalItems = 0;
    let itemsCompletados = 0;

    checklists.forEach(c => {
      c.items.forEach((item: any) => {
        totalItems++;
        const completo = item.checked && (!item.requiresPhoto || item.photo !== null);
        if (completo) itemsCompletados++;
      });
    });

    this.allItems.set(totalItems);
    this.completedItems.set(itemsCompletados);
    const globalPct = totalItems > 0 ? Math.round((itemsCompletados / totalItems) * 100) : 0;
    this.globalProgress.set(globalPct);

    const completos = checklists.filter(c => c.status === 'completo').length;
    const enProgreso = checklists.filter(c => c.status === 'en-progreso').length;
    const pendientes = checklists.filter(c => c.status === 'pendiente').length;
    const totalC = checklists.length;

    this.checklistsByStatus.set({
      completo: { count: completos, percent: Math.round((completos / totalC) * 100) || 0, color: 'var(--green)' },
      enProgreso: { count: enProgreso, percent: Math.round((enProgreso / totalC) * 100) || 0, color: 'var(--gold)' },
      pendiente: { count: pendientes, percent: Math.round((pendientes / totalC) * 100) || 0, color: 'var(--red)' }
    });

    const statsPorSucursal = this.nombresSucursales.map(storeName => {
      const storeChecklists = checklists.filter(c => c.store === storeName);
      let sTotalItems = 0;
      let sCompletedItems = 0;

      storeChecklists.forEach(c => {
        c.items.forEach((item: any) => {
          sTotalItems++;
          if (item.checked && (!item.requiresPhoto || item.photo !== null)) {
            sCompletedItems++;
          }
        });
      });

      const progress = sTotalItems > 0 ? Math.round((sCompletedItems / sTotalItems) * 100) : 0;
      let color = 'var(--red)'; 
      if (progress >= 80) color = 'var(--green)'; 
      else if (progress >= 50) color = 'var(--gold)'; 

      return { name: storeName, progress, color };
    });

    this.storeStats.set(statsPorSucursal);
  }

  calcularEstadisticasEmpleados() {
    const sucursalElegida = this.sucursalSeleccionadaParaEmpleados();
    
    const trabajadoresSucursal = this.todosLosUsuariosNube.filter((u: any) => {
      if (u.rol !== 'trabajador') return false;
      const susSucursales = u.sucursales || [u.sucursal || ''];
      return susSucursales.includes(sucursalElegida);
    });

    const estadisticasPorEmpleado: { [nombre: string]: { totalItems: number, itemsCompletados: number } } = {};
    
    trabajadoresSucursal.forEach((t: any) => {
      estadisticasPorEmpleado[t.nombre] = { totalItems: 0, itemsCompletados: 0 };
    });

    const checklistsSucursal = this.todosLosChecklists.filter(c => c.store === sucursalElegida);
    
    checklistsSucursal.forEach(c => {
      if (!estadisticasPorEmpleado[c.assigned]) {
        estadisticasPorEmpleado[c.assigned] = { totalItems: 0, itemsCompletados: 0 };
      }
      
      c.items.forEach((item: any) => {
        estadisticasPorEmpleado[c.assigned].totalItems++;
        if (item.checked && (!item.requiresPhoto || item.photo !== null)) {
          estadisticasPorEmpleado[c.assigned].itemsCompletados++;
        }
      });
    });

    const listaFinal = Object.keys(estadisticasPorEmpleado).map(nombre => {
      const datos = estadisticasPorEmpleado[nombre];
      const progress = datos.totalItems > 0 ? Math.round((datos.itemsCompletados / datos.totalItems) * 100) : 0;
      
      let color = 'var(--red)'; 
      if (progress >= 80) color = 'var(--green)'; 
      else if (progress >= 50) color = 'var(--gold)'; 
      
      if (datos.totalItems === 0) color = '#E0E0E0'; 

      return {
        nombre: nombre,
        progress: progress,
        color: color,
        completados: datos.itemsCompletados,
        total: datos.totalItems
      };
    });

    listaFinal.sort((a, b) => a.nombre.localeCompare(b.nombre));
    this.empleadosStats.set(listaFinal);
  }

  alCambiarSucursalEmpleados(event: any) {
    this.sucursalSeleccionadaParaEmpleados.set(event.target.value);
    this.calcularEstadisticasEmpleados();
  }
}