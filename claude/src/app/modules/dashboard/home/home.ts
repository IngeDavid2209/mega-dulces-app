import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
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
export class HomeComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null; 

  totalChecklists = signal(0);
  sucursalesTotales = signal(17);
  enProgreso = signal(0);
  pendientes = signal(0);
  progresoGlobal = signal(0);

  private firestore = inject(Firestore); 
  
  // 🧹 ARREGLO DE DESTRUCTORES DE RADARES
  private destructoresRadares: (() => void)[] = [];

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
    }
    this.conectarRadarNube(); 
  }

  // 🧹 APAGAMOS LOS RADARES AL SALIR DE LA PANTALLA
  ngOnDestroy() {
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
  }

  conectarRadarNube() {
    const checklistsRef = collection(this.firestore, 'checklists');

    const radarChecklists = onSnapshot(checklistsRef, (snapshot) => {
      const checklists: any[] = [];
      
      const offset = new Date().getTimezoneOffset() * 60000;
      const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];
      const limite24h = 24 * 60 * 60 * 1000;
      const ahora = Date.now();

      snapshot.forEach(docSnap => {
        const c: any = docSnap.data();
        const tiempoCreacion = typeof c.id === 'number' ? c.id : (c.timestampCreacion || ahora);
        
        if (c.date === fechaHoyLocal || (ahora - tiempoCreacion) <= limite24h) {
          checklists.push(c);
        }
      });

      const misListas = (this.currentUser?.rol === 'trabajador') 
        ? checklists.filter(c => c.assigned === this.currentUser.nombre)
        : checklists;

      this.totalChecklists.set(misListas.length);
      this.enProgreso.set(misListas.filter(c => c.status === 'en-progreso').length);
      this.pendientes.set(misListas.filter(c => c.status === 'pendiente').length);

      let totalItems = 0;
      let itemsCompletados = 0;

      misListas.forEach(c => {
        c.items.forEach((item: any) => {
          totalItems++;
          const completo = item.checked === true && (!item.requiresPhoto || (item.photo !== null && item.photo !== ''));
          if (completo) itemsCompletados++;
        });
      });

      const globalPct = totalItems > 0 ? Math.round((itemsCompletados / totalItems) * 100) : 0;
      this.progresoGlobal.set(globalPct);
    });
    
    this.destructoresRadares.push(radarChecklists);
  }
}