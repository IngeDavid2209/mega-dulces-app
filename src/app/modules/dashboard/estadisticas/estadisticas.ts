import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router'; 

@Component({
  selector: 'app-estadisticas',
  standalone: true,
  imports: [CommonModule, RouterModule], 
  templateUrl: './estadisticas.html', 
  styleUrls: ['./estadisticas.css']
})
export class EstadisticasComponent implements OnInit {
  isMenuOpen = false;
  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

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

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
    }

    this.calcularEstadisticas();
  }

  calcularEstadisticas() {
    const guardados = localStorage.getItem('md_checklists');
    let checklists: any[] = guardados ? JSON.parse(guardados) : [];

    // 🔥 AUTO-LIMPIEZA DE 24 HORAS 🔥
    const limite24h = 24 * 60 * 60 * 1000; 
    const ahora = Date.now();
    const listasVigentes = checklists.filter((c: any) => (ahora - c.id) <= limite24h);

    if (listasVigentes.length !== checklists.length) {
      localStorage.setItem('md_checklists', JSON.stringify(listasVigentes));
      checklists = listasVigentes;
    }

    if (checklists.length === 0) {
      this.storeStats.set(this.nombresSucursales.map(name => ({
        name, progress: 0, color: 'var(--coral)'
      })));
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
}