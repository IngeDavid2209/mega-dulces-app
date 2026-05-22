import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router'; 
import { FormsModule } from '@angular/forms';
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';

@Component({
  selector: 'app-estadisticas',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, SidebarComponent], 
  templateUrl: './estadisticas.html', 
  styleUrls: ['./estadisticas.css']
})
export class EstadisticasComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null;
  sucursalesPermitidas: string[] = [];

  globalProgress = signal(0);
  completedItems = signal(0);
  allItems = signal(0);

  checklistsByStatus = signal({
    completo: { count: 0, percent: 0, color: '#2ecc71' },
    enProgreso: { count: 0, percent: 0, color: '#f1c40f' },
    pendiente: { count: 0, percent: 0, color: '#e74c3c' }
  });

  nombresSucursales = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 
    'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
  ];

  storeStats = signal<any[]>([]);
  sucursalSeleccionadaParaEmpleados = signal('');
  empleadosStats = signal<any[]>([]);
  
  todosLosChecklists: any[] = []; 
  todosLosUsuariosNube: any[] = []; 

  private firestore = inject(Firestore);
  private destructoresRadares: (() => void)[] = [];

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
      this.determinarSucursalesPermitidas();
    }
    this.conectarRadarNube(); 
  }

  ngOnDestroy() {
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
  }

  determinarSucursalesPermitidas() {
    if (!this.currentUser) return;

    // Admin global: ve todas. Admin limitado y trabajador: solo sus sucursales asignadas.
    if (esAdminGlobal(this.currentUser) || (this.currentUser.sucursales && this.currentUser.sucursales.includes('Todas las sucursales'))) {
      this.sucursalesPermitidas = [...this.nombresSucursales];
    } else {
      const permitidas = sucursalesPermitidas(this.currentUser);
      this.sucursalesPermitidas = permitidas ?? (this.currentUser.sucursales || [this.currentUser.sucursal || '']);
    }

    this.storeStats.set(
      this.sucursalesPermitidas.map(suc => ({ name: suc, progress: 0, color: 'var(--brown)' }))
    );

    if (this.sucursalesPermitidas.length > 0) {
      this.sucursalSeleccionadaParaEmpleados.set(this.sucursalesPermitidas[0]);
    }
  }

  // 🔥 FIX UX: Cuenta como completado con el simple hecho de tener la palomita
  esItemMarcado(item: any): boolean {
    return item.checked === true;
  }

  conectarRadarNube() {
    const radarUsuarios = onSnapshot(collection(this.firestore, 'usuarios'), (snapshot) => {
      this.todosLosUsuariosNube = snapshot.docs.map(doc => doc.data());
      this.calcularEstadisticasEmpleados(); 
    });
    this.destructoresRadares.push(radarUsuarios);

    const checklistsRef = collection(this.firestore, 'checklists');
    const radarChecklists = onSnapshot(checklistsRef, (snapshot) => {
      const listasCrudas: any[] = [];
      
      // 🔥 REGLA ESTRICTA DE HOY: Para que las estadísticas no arrastren fantasmas de ayer
      const offset = new Date().getTimezoneOffset() * 60000;
      const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];

      snapshot.forEach(docSnap => {
        const c: any = docSnap.data();
        
        if (c.eliminado === true) return;

        // SOLO contamos las rutinas que estén etiquetadas con la fecha de HOY
        if (c.date === fechaHoyLocal && this.sucursalesPermitidas.includes(c.store)) {
          listasCrudas.push(c);
        }
      });

      // 🔥 ESCUDO ANTI-CLONES EN ESTADÍSTICAS 🔥
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

      this.todosLosChecklists = Array.from(listasSinClones.values());
      this.calcularEstadisticasGenerales();
      this.calcularEstadisticasEmpleados();
    });
    this.destructoresRadares.push(radarChecklists);
  }

  calcularEstadisticasGenerales() {
    const checklists = this.todosLosChecklists;
    let totalGlobalItems = 0;
    let totalGlobalCompletados = 0;

    let c_completos = 0;
    let c_progreso = 0;
    let c_pendientes = 0;

    checklists.forEach(c => {
      if (c.status === 'completo' || c.enviado) c_completos++;
      else if (c.status === 'en-progreso') c_progreso++;
      else c_pendientes++;

      if (c.items && Array.isArray(c.items)) {
        c.items.forEach((item: any) => {
          totalGlobalItems++;
          // Sumamos progreso real
          if (this.esItemMarcado(item)) totalGlobalCompletados++;
        });
      }
    });

    this.allItems.set(totalGlobalItems);
    this.completedItems.set(totalGlobalCompletados);
    this.globalProgress.set(totalGlobalItems > 0 ? Math.round((totalGlobalCompletados / totalGlobalItems) * 100) : 0);

    const total = checklists.length;
    this.checklistsByStatus.set({
      completo: { count: c_completos, percent: total > 0 ? Math.round((c_completos / total) * 100) : 0, color: '#2ecc71' },
      enProgreso: { count: c_progreso, percent: total > 0 ? Math.round((c_progreso / total) * 100) : 0, color: '#f1c40f' },
      pendiente: { count: c_pendientes, percent: total > 0 ? Math.round((c_pendientes / total) * 100) : 0, color: '#e74c3c' }
    });

    this.storeStats.set(this.sucursalesPermitidas.map(suc => {
      const filtradas = checklists.filter(c => c.store === suc);
      let sTotal = 0;
      let sOk = 0;
      filtradas.forEach(c => {
        if (c.items && Array.isArray(c.items)) {
          c.items.forEach((i: any) => { 
            sTotal++; 
            if (this.esItemMarcado(i)) sOk++; 
          });
        }
      });
      return { name: suc, progress: sTotal > 0 ? Math.round((sOk / sTotal) * 100) : 0, color: 'var(--brown)' };
    }));
  }

  calcularEstadisticasEmpleados() {
    const suc = this.sucursalSeleccionadaParaEmpleados();
    if (!suc || !this.sucursalesPermitidas.includes(suc)) {
        this.empleadosStats.set([]);
        return;
    }

    const empleados = this.todosLosUsuariosNube.filter((u: any) => {
      const susSucursales = u.sucursales || [u.sucursal || ''];
      return u.rol === 'trabajador' && susSucursales.includes(suc);
    });

    const stats = empleados.map((emp: any) => {
      const susListas = this.todosLosChecklists.filter(c => c.assigned === emp.nombre && c.store === suc);
      let eTotal = 0;
      let eOk = 0;

      susListas.forEach(c => {
        if (c.items && Array.isArray(c.items)) {
          c.items.forEach((i: any) => {
            eTotal++;
            if (this.esItemMarcado(i)) eOk++;
          });
        }
      });

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