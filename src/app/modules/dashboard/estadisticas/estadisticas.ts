import { Component, signal, computed, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Firestore, collection, onSnapshot, query, where } from '@angular/fire/firestore';
import { esAdminGlobal, sucursalesPermitidas, normalizarNombre } from '../../../shared/permisos.util';
import { nivelDeCargo } from '../../../shared/nivel-jerarquico.util';
import { esItemHecho } from '../../../shared/item-completado.util';

/** Una fila agregada para los rankings de retrasos. */
interface FilaRanking {
  nombre: string;
  total: number;
  porcentaje: number;
}

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
  /** Sub-listas separadas por nivel jerárquico, ordenadas por progreso descendente. */
  empleadosStatsMandos = computed(() => this.empleadosStats().filter(e => e.nivel === 'mando'));
  empleadosStatsOperativos = computed(() => this.empleadosStats().filter(e => e.nivel === 'operativo'));

  /** trackBy para las barras del ranking individual — evita recrear todos los nodos
   *  cuando solo cambia el progreso de uno. */
  trackByEmpStat(_: number, e: any): any { return e?.nombre || _; }

  todosLosChecklists: any[] = [];
  todosLosUsuariosNube: any[] = [];

  // ⏰ RETRASOS JUSTIFICADOS — datos crudos y filtros
  retrasosCrudos = signal<any[]>([]);
  rangoRetrasoDias = signal<number>(30); // 7 | 30 | 90 | 0 (todo)
  readonly opcionesRangoRetraso = [
    { dias: 7,  label: '7 días' },
    { dias: 30, label: '30 días' },
    { dias: 90, label: '90 días' },
    { dias: 0,  label: 'Todo' }
  ];

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

  /**
   * ¿La tarea está hecha? Cuenta evidencia REAL, no el palomeo:
   *  - Antes/Después: ambas fotos subidas.
   *  - Varias fotos: al menos una.
   *  - Una foto: subida.
   *  - Sin evidencia: requiere palomeado manual.
   * Antes solo miraba item.checked y daba 0% aunque hubiera fotos subidas.
   */
  /** Delega al helper compartido: evidencia real O justificación del checklist. */
  esItemMarcado(item: any, c?: any): boolean {
    return esItemHecho(item, c);
  }

  conectarRadarNube() {
    const radarUsuarios = onSnapshot(collection(this.firestore, 'usuarios'), (snapshot) => {
      this.todosLosUsuariosNube = snapshot.docs.map(doc => doc.data());
      this.calcularEstadisticasEmpleados();
    });
    this.destructoresRadares.push(radarUsuarios);

    // ⏰ Radar específico para retrasos: query filtrada → solo trae docs con
    // entregaConRetraso === true. Reduce muchísimo reads vs traer TODO el histórico.
    const queryRetrasos = query(
      collection(this.firestore, 'checklists'),
      where('entregaConRetraso', '==', true)
    );
    const radarRetrasos = onSnapshot(queryRetrasos, (snapshot) => {
      const arr: any[] = [];
      snapshot.forEach(d => {
        const data: any = d.data();
        if (data.eliminado === true) return;
        if (!this.sucursalesPermitidas.includes(data.store)) return; // respeta scope del admin
        arr.push(data);
      });
      this.retrasosCrudos.set(arr);
    });
    this.destructoresRadares.push(radarRetrasos);

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
        const marcados = c.items ? c.items.filter((i:any) => this.esItemMarcado(i, c)).length : 0;
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
          if (this.esItemMarcado(item, c)) totalGlobalCompletados++;
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
            if (this.esItemMarcado(i, c)) sOk++;
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
      const empNorm = normalizarNombre(emp.nombre);
      const susListas = this.todosLosChecklists.filter(c => normalizarNombre(c.assigned) === empNorm && c.store === suc);
      let eTotal = 0;
      let eOk = 0;

      susListas.forEach(c => {
        if (c.items && Array.isArray(c.items)) {
          c.items.forEach((i: any) => {
            eTotal++;
            if (this.esItemMarcado(i, c)) eOk++;
          });
        }
      });

      const pct = eTotal > 0 ? Math.round((eOk / eTotal) * 100) : 0;
      return {
        nombre: emp.nombre,
        cargo: emp.cargo || '',
        nivel: nivelDeCargo(emp.cargo),
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

  // ============================================================================
  // ⏰ RETRASOS JUSTIFICADOS — agregados
  // ============================================================================

  /** Filtra los retrasos al rango elegido (7/30/90 días, o todo). */
  retrasosEnRango = computed<any[]>(() => {
    const dias = this.rangoRetrasoDias();
    if (dias === 0) return this.retrasosCrudos();
    const corte = Date.now() - dias * 24 * 60 * 60 * 1000;
    return this.retrasosCrudos().filter(r => (r.motivoRetraso?.timestamp || 0) >= corte);
  });

  /** Total de retrasos en el rango. */
  totalRetrasos = computed<number>(() => this.retrasosEnRango().length);

  /** Ranking por categoría del motivo (Falla equipo, etc.). */
  rankingCategorias = computed<FilaRanking[]>(() => {
    return this.contarPor(c => c.motivoRetraso?.categoria || 'Sin categoría');
  });

  /** Ranking por sucursal. */
  rankingSucursales = computed<FilaRanking[]>(() => {
    return this.contarPor(c => c.store || 'Sin sucursal');
  });

  /** Ranking por persona (top 10). */
  rankingPersonas = computed<FilaRanking[]>(() => {
    return this.contarPor(c => c.assigned || 'Sin asignar').slice(0, 10);
  });

  /** Helper: cuenta retrasos agrupando por una key y devuelve ranking ordenado. */
  private contarPor(keyFn: (c: any) => string): FilaRanking[] {
    const lista = this.retrasosEnRango();
    const total = lista.length;
    if (total === 0) return [];

    const conteo = new Map<string, number>();
    lista.forEach(r => {
      const k = keyFn(r);
      conteo.set(k, (conteo.get(k) || 0) + 1);
    });

    return Array.from(conteo.entries())
      .map(([nombre, n]) => ({
        nombre,
        total: n,
        porcentaje: Math.round((n / total) * 100)
      }))
      .sort((a, b) => b.total - a.total);
  }

  cambiarRangoRetraso(dias: number) {
    this.rangoRetrasoDias.set(dias);
  }
}