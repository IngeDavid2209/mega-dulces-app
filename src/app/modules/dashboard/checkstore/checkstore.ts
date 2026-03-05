import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router'; 

@Component({
  selector: 'app-checkstore',
  standalone: true,
  imports: [CommonModule, RouterModule], 
  templateUrl: './checkstore.html', 
  styleUrls: ['./checkstore.css']
})
export class CheckstoreComponent implements OnInit {
  isMenuOpen = false;
  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

  currentUser: any = null;

  stores = signal<any[]>([]);

  sucursalesBase = [
    { name: 'Canindo', location: 'Sucursal Canindo', icon: '🏪' },
    { name: 'La Piedad Abastos', location: 'Mercado de Abastos', icon: '🛍️' },
    { name: '8 Esquinas', location: 'Zona 8 Esquinas', icon: '🏬' },
    { name: 'Padre Hidalgo', location: 'Av. Padre Hidalgo', icon: '🏢' },
    { name: 'Morelia Madero', location: 'Av. Madero', icon: '🏛️' },
    { name: 'Morelia Abastos', location: 'Mercado de Abastos', icon: '🛒' },
    { name: 'Yurécuaro', location: 'Sucursal Yurécuaro', icon: '🏪' },
    { name: 'Zamora Centro', location: 'Centro, Zamora', icon: '🏙️' }
  ];

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
    }

    this.calcularCheckstore();
  }

  calcularCheckstore() {
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

    const datosCompletos = this.sucursalesBase.map(sucursal => {
      const storeChecklists = checklists.filter(c => c.store === sucursal.name);
      let totalItems = 0;
      let completedItems = 0;

      storeChecklists.forEach(c => {
        c.items.forEach((item: any) => {
          totalItems++;
          const completo = item.checked && (!item.requiresPhoto || item.photo !== null);
          if (completo) {
            completedItems++;
          }
        });
      });

      const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
      let color = 'var(--red)'; 
      if (progress >= 80) color = 'var(--green)'; 
      else if (progress >= 50) color = 'var(--gold)'; 

      return {
        ...sucursal,
        totalChecklists: storeChecklists.length,
        completedItems,
        totalItems,
        progress,
        color
      };
    });

    this.stores.set(datosCompletos);
  }
}