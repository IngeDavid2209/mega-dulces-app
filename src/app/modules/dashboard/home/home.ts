import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router'; 
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore'; 
// Asegúrate de que la ruta de tu servicio esté bien (si marcaba error sin el .service, pónselo)
import { NotificacionesService } from '../../../services/notificaciones';

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
  private notificacionesService = inject(NotificacionesService);
  private destructoresRadares: (() => void)[] = [];

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
      if (this.currentUser && this.currentUser.nombre) {
        this.notificacionesService.solicitarPermisos(this.currentUser.nombre);
      }
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
        
        // 🔥 CORRECCIÓN: Solo ignoramos los eliminados. 
        // Dejamos pasar los "enviados" para poder sumarlos al Progreso Global.
        if (c.eliminado === true) return;
        
        const tiempoCreacion = typeof c.id === 'number' ? c.id : (c.timestampCreacion || ahora);
        if (c.date === fechaHoyLocal || (ahora - tiempoCreacion) <= limite24h) {
          listasCrudas.push(c);
        }
      });

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

      // Filtramos las tareas del usuario actual
      const misListas = (this.currentUser?.rol === 'trabajador') 
        ? Array.from(listasSinClones.values()).filter(c => c.assigned === this.currentUser.nombre)
        : Array.from(listasSinClones.values());

      // =========================================================
      // 🧠 CEREBRO 1: PROGRESO GLOBAL (Toma en cuenta TODO lo del día)
      // =========================================================
      let totalItems = 0;
      let itemsCompletados = 0;

      misListas.forEach(c => {
        if (c.items && Array.isArray(c.items)) {
          c.items.forEach((item: any) => {
            totalItems++;
            if (item.checked) itemsCompletados++;
          });
        }
      });

      const globalPct = totalItems > 0 ? Math.round((itemsCompletados / totalItems) * 100) : 0;
      this.progresoGlobal.set(globalPct); // Este ya NUNCA se va a caer a 0%

      // =========================================================
      // 🧠 CEREBRO 2: CONTADORES (Oculta las tarjetas enviadas)
      // =========================================================
      // Para los contadores de arriba, separamos las tareas que AÚN NO SE ENVÍAN
      const listasActivas = misListas.filter(c => c.enviado !== true);
      
      this.totalChecklists.set(listasActivas.length);

      // 🔥 CORRECCIÓN "EN PROGRESO": Sumamos las que están a medias O que ya terminaste pero no has enviado
      const tareasEnProgreso = listasActivas.filter(c => {
        const stat = (c.status || '').toLowerCase();
        return stat === 'en-progreso' || stat === 'completo'; 
      }).length;
      
      this.enProgreso.set(tareasEnProgreso);
      this.pendientes.set(listasActivas.filter(c => (c.status || 'pendiente').toLowerCase() === 'pendiente').length);

    });
    
    this.destructoresRadares.push(radarChecklists);
  }
}