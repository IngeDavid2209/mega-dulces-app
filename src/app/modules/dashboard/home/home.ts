import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router'; 

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule], 
  templateUrl: './home.html', 
  styleUrls: ['./home.css']
})
export class HomeComponent implements OnInit {
  isMenuOpen = false;
  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

  currentUser: any = null; 

  totalChecklists = signal(0);
  sucursalesTotales = signal(8); 
  enProgreso = signal(0);
  pendientes = signal(0);
  progresoGlobal = signal(0);

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
    }

    this.calcularResumen();
  }

  calcularResumen() {
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

    const misListas = this.currentUser?.rol === 'trabajador' 
      ? checklists.filter(c => c.assigned === this.currentUser.nombre)
      : checklists;

    this.totalChecklists.set(misListas.length);

    const activos = misListas.filter(c => c.status === 'en-progreso').length;
    const pend = misListas.filter(c => c.status === 'pendiente').length;
    
    this.enProgreso.set(activos);
    this.pendientes.set(pend);

    let totalItems = 0;
    let itemsCompletados = 0;

    misListas.forEach(c => {
      c.items.forEach((item: any) => {
        totalItems++;
        const completo = item.checked && (!item.requiresPhoto || item.photo !== null);
        if (completo) {
          itemsCompletados++;
        }
      });
    });

    const globalPct = totalItems > 0 ? Math.round((itemsCompletados / totalItems) * 100) : 0;
    this.progresoGlobal.set(globalPct);
  }
}