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
  private destructoresRadares: (() => void)[] = [];

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
    }
    this.conectarRadarNube(); 
  }

  ngOnDestroy() {
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
  }

  conectarRadarNube() {
    const checklistsRef = collection(this.firestore, 'checklists');

    const radarChecklists = onSnapshot(checklistsRef, (snapshot) => {
      const listasCrudas: any[] = [];
      
      const offset = new Date().getTimezoneOffset() * 60000;
      const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];
      const limite24h = 24 * 60 * 60 * 1000;
      const ahora = Date.now();

      snapshot.forEach(docSnap => {
        const c: any = docSnap.data();
        
        // 🔥 1. Ignorar la basura eliminada
        if (c.eliminado === true) return;
        
        const tiempoCreacion = typeof c.id === 'number' ? c.id : (c.timestampCreacion || ahora);
        
        // 🔥 2. Solo agarrar listas de HOY o de las últimas 24 horas
        if (c.date === fechaHoyLocal || (ahora - tiempoCreacion) <= limite24h) {
          listasCrudas.push(c);
        }
      });

      // 🔥 3. ESCUDO ANTI-CLONES 🔥
      const listasSinClones = new Map();
      listasCrudas.forEach(c => {
        const marcados = c.items ? c.items.filter((i:any) => i.checked).length : 0;
        c.calcProgreso = c.items && c.items.length > 0 ? Math.round((marcados / c.items.length) * 100) : 0;

        const firma = `${c.name}_${c.assigned}_${c.store}_${c.date}`;
        if (!listasSinClones.has(firma)) {
          listasSinClones.set(firma, c);
        } else {
          const existente = listasSinClones.get(firma);
          if (c.calcProgreso > existente.calcProgreso) {
            listasSinClones.set(firma, c);
          }
        }
      });

      const listasFinales = Array.from(listasSinClones.values());

      const misListas = (this.currentUser?.rol === 'trabajador') 
        ? listasFinales.filter(c => c.assigned === this.currentUser.nombre)
        : listasFinales;

      this.totalChecklists.set(misListas.length);
      this.enProgreso.set(misListas.filter(c => c.status === 'en-progreso').length);
      this.pendientes.set(misListas.filter(c => c.status === 'pendiente').length);

      // 🔥 4. CALCULADORA MAESTRA DE PROGRESO 🔥
      let totalItems = 0;
      let itemsCompletados = 0;

      misListas.forEach(c => {
        if (c.items && Array.isArray(c.items)) {
          c.items.forEach((item: any) => {
            totalItems++;
            // Solo necesitamos que tenga la palomita, ¡no importa la foto!
            if (item.checked) {
              itemsCompletados++;
            }
          });
        }
      });

      const globalPct = totalItems > 0 ? Math.round((itemsCompletados / totalItems) * 100) : 0;
      this.progresoGlobal.set(globalPct);
    });
    
    this.destructoresRadares.push(radarChecklists);
  }
}