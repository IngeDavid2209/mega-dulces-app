import { Component, signal, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router'; 
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore'; 

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule], 
  templateUrl: './home.html', 
  styleUrls: ['./home.css']
})
export class HomeComponent implements OnInit {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null; 

  totalChecklists = signal(0);
  
  // 🔥 AQUÍ ACTUALIZAMOS A 17 SUCURSALES/ÁREAS EN TOTAL 🔥
  sucursalesTotales = signal(17);
  
  enProgreso = signal(0);
  pendientes = signal(0);
  progresoGlobal = signal(0);

  private firestore = inject(Firestore); 

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
    }

    this.conectarRadarNube(); 
  }

  conectarRadarNube() {
    const checklistsRef = collection(this.firestore, 'checklists');

    onSnapshot(checklistsRef, (snapshot) => {
      const checklists: any[] = [];
      
      // ESCUDO DE ZONA HORARIA Y TIEMPO
      const offset = new Date().getTimezoneOffset() * 60000;
      const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];
      const limite24h = 24 * 60 * 60 * 1000;
      const ahora = Date.now();

      snapshot.forEach(docSnap => {
        const c: any = docSnap.data();
        const tiempoCreacion = typeof c.id === 'number' ? c.id : (c.timestampCreacion || ahora);
        
        // Solo tomamos en cuenta checklists de hoy o creados hace menos de 24 horas
        if (c.date === fechaHoyLocal || (ahora - tiempoCreacion) <= limite24h) {
          checklists.push(c);
        }
      });

      // FILTRAR POR USUARIO (Si es trabajador, solo ve lo suyo)
      const misListas = (this.currentUser?.rol === 'trabajador') 
        ? checklists.filter(c => c.assigned === this.currentUser.nombre)
        : checklists;

      // ACTUALIZAR CONTADORES DEL DASHBOARD
      this.totalChecklists.set(misListas.length);

      // Contamos "En progreso" y "Pendientes"
      this.enProgreso.set(misListas.filter(c => c.status === 'en-progreso').length);
      this.pendientes.set(misListas.filter(c => c.status === 'pendiente').length);

      // CÁLCULO DE PROGRESO GLOBAL
      let totalItems = 0;
      let itemsCompletados = 0;

      misListas.forEach(c => {
        c.items.forEach((item: any) => {
          totalItems++;
          // Una tarea cuenta solo si está marcada Y (si requiere foto, la tiene)
          const completo = item.checked === true && (!item.requiresPhoto || (item.photo !== null && item.photo !== ''));
          if (completo) itemsCompletados++;
        });
      });

      const globalPct = totalItems > 0 ? Math.round((itemsCompletados / totalItems) * 100) : 0;
      this.progresoGlobal.set(globalPct);
    });
  }
}