import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore';
import { NotificacionesService } from '../../../services/notificaciones'; // Ajusta la ruta si es diferente

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

  // Variables clásicas (Por si el que entra es Trabajador)
  totalChecklists = signal(0);
  sucursalesTotales = signal(17);
  enProgreso = signal(0);
  pendientes = signal(0);
  progresoGlobal = signal(0);

  // 🔥 NUEVAS VARIABLES DEL MONITOR DEL JEFE 🔥
  personalMonitoreo = signal<any[]>([]);
  metricasGlobales = signal({ activosHoy: 0, ausentes: 0, progresoGlobal: 0, totalTareas: 0, completadas: 0 });

  private firestore = inject(Firestore);
  private router = inject(Router);
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
    
    // Si es admin, iniciamos el Radar Jefe. Si es trabajador, usamos la vista tradicional.
    if (this.currentUser?.rol === 'admin' || this.currentUser?.puedeVerEstadisticas) {
      this.iniciarRadarJefe();
    } else {
      this.conectarRadarNormal();
    }
  }

  ngOnDestroy() { this.destructoresRadares.forEach(apagar => apagar()); }

  iniciarRadarJefe() {
    let usuariosCache: any[] = [];
    let checklistsCache: any[] = [];

    const actualizarVista = () => {
      const hoy = new Date();
      const offset = hoy.getTimezoneOffset() * 60000;
      const fechaHoyLocal = new Date(hoy.getTime() - offset).toISOString().split('T')[0];

      const listasDeHoy = checklistsCache.filter(c => c.date === fechaHoyLocal && !c.eliminado);

      let totalTareasGlobal = 0; let completadasGlobal = 0;
      let activosHoy = 0; let ausentes = 0;

      const monitor = usuariosCache.filter(u => u.rol === 'trabajador').map(u => {
        const listasUsuario = listasDeHoy.filter(c => c.assigned === u.nombre);
        let totalTareas = 0; let tareasCompletadas = 0;

        listasUsuario.forEach(lista => {
          if (lista.items) {
            totalTareas += lista.items.length;
            tareasCompletadas += lista.items.filter((i:any) => i.checked).length;
          }
        });

        totalTareasGlobal += totalTareas; completadasGlobal += tareasCompletadas;

        const progreso = totalTareas > 0 ? Math.round((tareasCompletadas / totalTareas) * 100) : 0;
        const inicioSesionHoy = this.haIniciadoSesionHoy(u.ultimoAcceso);

        if (inicioSesionHoy) activosHoy++; else ausentes++;

        return { ...u, totalTareas, tareasCompletadas, progreso, inicioSesionHoy, listasHoy: listasUsuario.length };
      });

      this.personalMonitoreo.set(monitor.sort((a,b) => b.progreso - a.progreso));
      this.metricasGlobales.set({
        activosHoy, ausentes, totalTareas: totalTareasGlobal, completadas: completadasGlobal,
        progresoGlobal: totalTareasGlobal > 0 ? Math.round((completadasGlobal / totalTareasGlobal) * 100) : 0
      });
    };

    const refUsuarios = collection(this.firestore, 'usuarios');
    const subUsu = onSnapshot(refUsuarios, (snap) => {
      usuariosCache = snap.docs.map(d => ({ idFirestore: d.id, ...d.data() }));
      actualizarVista();
    });
    this.destructoresRadares.push(subUsu);

    const refChecklists = collection(this.firestore, 'checklists');
    const subChk = onSnapshot(refChecklists, (snap) => {
      checklistsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      actualizarVista();
    });
    this.destructoresRadares.push(subChk);
  }

  conectarRadarNormal() {
    const checklistsRef = collection(this.firestore, 'checklists');
    const radarChecklists = onSnapshot(checklistsRef, (snapshot) => {
      const listasCrudas: any[] = [];
      const offset = new Date().getTimezoneOffset() * 60000;
      const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];
      const limite24h = 24 * 60 * 60 * 1000; const ahora = Date.now();

      snapshot.forEach(docSnap => {
        const c: any = docSnap.data();
        if (c.eliminado === true) return;
        const tiempoCreacion = typeof c.id === 'number' ? c.id : (c.timestampCreacion || ahora);
        if (c.date === fechaHoyLocal || (ahora - tiempoCreacion) <= limite24h) { listasCrudas.push(c); }
      });

      const listasSinClones = new Map();
      listasCrudas.forEach(c => {
        const marcados = c.items ? c.items.filter((i:any) => i.checked).length : 0;
        c.calcProgreso = c.items && c.items.length > 0 ? Math.round((marcados / c.items.length) * 100) : 0;
        const firma = `${c.name}_${c.assigned}_${c.store}_${c.date}`;
        if (!listasSinClones.has(firma)) { listasSinClones.set(firma, c); } 
        else { const existente = listasSinClones.get(firma); if (c.calcProgreso > existente.calcProgreso) { listasSinClones.set(firma, c); } }
      });

      const misListas = Array.from(listasSinClones.values()).filter(c => c.assigned === this.currentUser.nombre);
      
      let totalItems = 0; let itemsCompletados = 0;
      misListas.forEach(c => {
        if (c.items && Array.isArray(c.items)) {
          c.items.forEach((item: any) => { totalItems++; if (item.checked) itemsCompletados++; });
        }
      });

      this.progresoGlobal.set(totalItems > 0 ? Math.round((itemsCompletados / totalItems) * 100) : 0);
      const listasActivas = misListas.filter(c => c.enviado !== true);
      this.totalChecklists.set(listasActivas.length);
      this.enProgreso.set(listasActivas.filter(c => { const stat = (c.status || '').toLowerCase(); return stat === 'en-progreso' || stat === 'completo'; }).length);
      this.pendientes.set(listasActivas.filter(c => (c.status || 'pendiente').toLowerCase() === 'pendiente').length);
    });
    this.destructoresRadares.push(radarChecklists);
  }

  haIniciadoSesionHoy(ultimoAcceso: string): boolean {
    if(!ultimoAcceso) return false;
    const hoy = new Date(); const acceso = new Date(ultimoAcceso);
    return hoy.toDateString() === acceso.toDateString();
  }

  cerrarSesion() { localStorage.removeItem('md_sesion_actual'); this.router.navigate(['/login']); }
}