
import { Component, signal, computed, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import { nivelDeCargo } from '../../../shared/nivel-jerarquico.util';
import { esItemHecho } from '../../../shared/item-completado.util';
 
import { SidebarComponent } from '../../../shared/sidebar/sidebar';

@Component({
  selector: 'app-checkstore',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './checkstore.html',
  styleUrls: ['./checkstore.css']
})
export class CheckstoreComponent implements OnInit, OnDestroy {
 
  // ----------------- ESTADO BÁSICO -----------------
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  currentUser: any = null;
  sucursalesPermitidas: string[] = [];
 
  // Reloj que se refresca cada minuto (para que las "alertas vencidas" sean dinámicas)
  horaActual = signal<Date>(new Date());
  private clockInterval: any = null;
 
  // ----------------- FILTROS / BÚSQUEDA / ORDEN -----------------
  terminoBusqueda  = signal<string>('');
  ordenamiento     = signal<'avance' | 'alertas' | 'alfabetico' | 'tareas'>('avance');
  soloConAlertas   = signal<boolean>(false);
 
  // ----------------- DATOS RAW (signals) -----------------
  private rawComerciales      = signal<any[]>([]);
  private rawAdministrativas  = signal<any[]>([]);
  private rawAreasTrabajo     = signal<any[]>([]);
 
  // Catálogos hardcoded (igual que tu versión)
  sucursalesComerciales = [
    { name: 'Canindo',           location: 'Sucursal Canindo',   icon: '🏪' },
    { name: 'La Piedad Abastos', location: 'Mercado de Abastos', icon: '🛍️' },
    { name: '8 Esquinas',        location: 'Zona 8 Esquinas',    icon: '🏬' },
    { name: 'Padre Hidalgo',     location: 'Av. Padre Hidalgo',  icon: '🏢' },
    { name: 'Morelia Madero',    location: 'Av. Madero',         icon: '🏛️' },
    { name: 'Morelia Abastos',   location: 'Mercado de Abastos', icon: '🛒' },
    { name: 'Yurécuaro',         location: 'Sucursal Yurécuaro', icon: '🏪' },
    { name: 'Zamora Centro',     location: 'Centro, Zamora',     icon: '🏙️' }
  ];
 
  sucursalesAdministrativas = [
    { name: 'OFICINAS CORPORATIVAS', location: 'Dirección General',           icon: '💼' },
    { name: 'CAJA GENERAL',          location: 'Finanzas y Valores',          icon: '💰' },
    { name: 'COMPRAS',               location: 'Proveedores e Insumos',       icon: '📦' },
    { name: 'CONTABILIDAD',          location: 'Gestión Fiscal',              icon: '📈' },
    { name: 'FINANZAS',              location: 'Estrategia y Capital',        icon: '🏦' },
    { name: 'SISTEMAS',              location: 'Soporte y TI',                icon: '💻' },
    { name: 'RH',                    location: 'Recursos Humanos',            icon: '👥' },
    { name: 'MKT',                   location: 'Mercadotecnia y Publicidad',  icon: '📢' },
    { name: 'MANTENIMIENTO',         location: 'Soporte de Infraestructura',  icon: '🛠️' }
  ];
 
  // Bufer de datos de Firebase
  areasDesdeFirebase: any[] = [];
  checklistsDesdeFirebase: any[] = [];
  // Map nombreNormalizado -> nivel ('mando' | 'operativo'). Se llena con el snapshot de usuarios
  // y nos permite clasificar los `assigned` de cada checklist sin recargar usuarios.
  private nivelPorNombre = new Map<string, 'mando' | 'operativo'>();
 
  private firestore = inject(Firestore);
  private destructoresRadares: (() => void)[] = [];
 
  // ============================================================================
  //  COMPUTED: aplica filtros/búsqueda/orden a cada lista
  // ============================================================================
  private aplicarFiltros(lista: any[]): any[] {
    const term = this.terminoBusqueda().toLowerCase().trim();
    const soloAlertas = this.soloConAlertas();
 
    let resultado = lista.filter(s => {
      if (term && !s.name.toLowerCase().includes(term) && !s.location.toLowerCase().includes(term)) {
        return false;
      }
      if (soloAlertas && (s.alertas || 0) === 0) return false;
      return true;
    });
 
    const orden = this.ordenamiento();
    resultado.sort((a, b) => {
      switch (orden) {
        case 'avance':     return b.progress - a.progress;
        case 'alertas':    return (b.alertas || 0) - (a.alertas || 0);
        case 'alfabetico': return a.name.localeCompare(b.name);
        case 'tareas':     return b.totalItems - a.totalItems;
        default:           return 0;
      }
    });
 
    return resultado;
  }
 
  comerciales      = computed(() => this.aplicarFiltros(this.rawComerciales()));
  administrativas  = computed(() => this.aplicarFiltros(this.rawAdministrativas()));
  areasTrabajo     = computed(() => this.aplicarFiltros(this.rawAreasTrabajo()));
 
  // ----------------- RESUMEN GENERAL (header KPIs) -----------------
  private todasLasSucursales = computed(() => [
    ...this.rawComerciales(),
    ...this.rawAdministrativas(),
    ...this.rawAreasTrabajo()
  ]);
 
  totalSucursales       = computed(() => this.todasLasSucursales().length);
  totalActivas          = computed(() => this.todasLasSucursales().filter(s => s.totalChecklists > 0).length);
  totalAlertas          = computed(() => this.todasLasSucursales().reduce((a, s) => a + (s.alertas || 0), 0));
 
  promedioGeneral = computed(() => {
    const lista = this.todasLasSucursales().filter(s => s.totalItems > 0);
    if (lista.length === 0) return 0;
    const suma = lista.reduce((a, s) => a + s.progress, 0);
    return Math.round(suma / lista.length);
  });
 
  promedioColor = computed(() => {
    const p = this.promedioGeneral();
    if (p >= 80) return 'pct-ok';
    if (p >= 50) return 'pct-warn';
    return 'pct-bad';
  });
 
  mejorSucursal = computed(() => {
    const lista = this.todasLasSucursales().filter(s => s.totalItems > 0);
    if (lista.length === 0) return null;
    return [...lista].sort((a, b) => b.progress - a.progress)[0];
  });
 
  peorSucursal = computed(() => {
    const lista = this.todasLasSucursales().filter(s => s.totalItems > 0);
    if (lista.length === 0) return null;
    return [...lista].sort((a, b) => a.progress - b.progress)[0];
  });
 
  // ============================================================================
  //  LIFECYCLE
  // ============================================================================
  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
      this.determinarSucursalesPermitidas();
    }
    this.conectarRadaresNube();
 
    // Reloj cada minuto para refrescar alertas vencidas
    this.clockInterval = setInterval(() => {
      this.horaActual.set(new Date());
      this.procesarMatematicas();
    }, 60000);
  }
 
  ngOnDestroy() {
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
    if (this.clockInterval) clearInterval(this.clockInterval);
  }
 
  // ============================================================================
  //  PERMISOS
  // ============================================================================
  determinarSucursalesPermitidas() {
    if (!this.currentUser) return;
    // Admin global: ve todas. Admin limitado y trabajador: ve solo las suyas.
    if (
      esAdminGlobal(this.currentUser) ||
      (this.currentUser.sucursales && this.currentUser.sucursales.includes('Todas las sucursales'))
    ) {
      this.sucursalesPermitidas = [
        ...this.sucursalesComerciales.map(s => s.name),
        ...this.sucursalesAdministrativas.map(s => s.name)
      ];
    } else {
      const permitidas = sucursalesPermitidas(this.currentUser);
      this.sucursalesPermitidas = permitidas ?? (this.currentUser.sucursales || [this.currentUser.sucursal || '']);
    }
  }
 
  // ============================================================================
  //  FIRESTORE
  // ============================================================================
  conectarRadaresNube() {
    // Radar 1: áreas dinámicas
    const areasRef = collection(this.firestore, 'areas');
    const radarAreas = onSnapshot(areasRef, snap => {
      const areasTemp: any[] = [];
      snap.forEach(docSnap => {
        const data = docSnap.data();
        const nombreArea = (data as any)['nombre'] || (data as any)['name'] || 'Área Desconocida';
        areasTemp.push({
          name: nombreArea,
          location: 'Área Interna',
          icon: '📍',
          color: '#D97706',
          progress: 0, totalChecklists: 0, completedItems: 0, totalItems: 0, alertas: 0
        });
      });
      this.areasDesdeFirebase = areasTemp;
 
      // Admin global o trabajador con acceso total: agrega TODAS las áreas dinámicas.
      // Admin limitado y trabajador normal: solo las áreas que coincidan con sus sucursales asignadas.
      if (
        esAdminGlobal(this.currentUser) ||
        (this.currentUser?.sucursales && this.currentUser?.sucursales.includes('Todas las sucursales'))
      ) {
        areasTemp.forEach(a => {
          if (!this.sucursalesPermitidas.includes(a.name)) {
            this.sucursalesPermitidas.push(a.name);
          }
        });
      }
      this.procesarMatematicas();
    });
 
    // Radar 2: checklists
    const checklistsRef = collection(this.firestore, 'checklists');
    const radarChecklists = onSnapshot(checklistsRef, snap => {
      const checklistsTemp: any[] = [];
      const ahora = Date.now();
      const limite24h = 24 * 60 * 60 * 1000;
      const offset = new Date().getTimezoneOffset() * 60000;
      const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];
 
      snap.forEach(docSnap => {
        const c: any = docSnap.data();
        if (c.eliminado === true) return;
        const tiempoCreacion = typeof c.id === 'number' ? c.id : (c.timestampCreacion || ahora);
        if (c.date === fechaHoyLocal || (ahora - tiempoCreacion) <= limite24h) {
          checklistsTemp.push(c);
        }
      });
 
      // Escudo anti-clones
      const listasSinClones = new Map<string, any>();
      checklistsTemp.forEach(c => {
        const marcados = c.items ? c.items.filter((i: any) => this.itemHecho(i, c)).length : 0;
        c.calcProgreso = c.items && c.items.length > 0
          ? Math.round((marcados / c.items.length) * 100) : 0;
        const firma = `${c.name}_${c.assigned}_${c.store}_${c.date}`;
        if (!listasSinClones.has(firma)) {
          listasSinClones.set(firma, c);
        } else {
          const existente = listasSinClones.get(firma);
          if (c.calcProgreso > existente.calcProgreso) listasSinClones.set(firma, c);
        }
      });
 
      this.checklistsDesdeFirebase = Array.from(listasSinClones.values());
      this.procesarMatematicas();
    });
 
    // Radar 3: usuarios → carga el cargo de cada empleado para clasificar
    // cada checklist por nivel jerárquico (mando / operativo) del asignado.
    const usuariosRef = collection(this.firestore, 'usuarios');
    const radarUsuarios = onSnapshot(usuariosRef, snap => {
      const mapa = new Map<string, 'mando' | 'operativo'>();
      snap.forEach(docSnap => {
        const u: any = docSnap.data();
        if (!u?.nombre) return;
        const nivel = nivelDeCargo(u.cargo);
        mapa.set(this.normalizarNombreParaMatch(u.nombre), nivel);
      });
      this.nivelPorNombre = mapa;
      this.procesarMatematicas();
    });

    this.destructoresRadares.push(radarAreas);
    this.destructoresRadares.push(radarChecklists);
    this.destructoresRadares.push(radarUsuarios);
  }

  /** Versión ligera de normalización: lowercase + sin tildes + colapsa espacios.
   *  Suficiente para el lookup del cargo desde el `assigned` de un checklist. */
  private normalizarNombreParaMatch(n: string): string {
    return (n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /** trackBy para los grids de sucursales — usa el nombre como clave estable. */
  trackByStore(_: number, s: any): any { return s?.name || _; }

  /** Devuelve el nivel del empleado dueño del assigned, según el cargo cargado. */
  nivelDelAssigned(assigned: string | undefined | null): 'mando' | 'operativo' {
    if (!assigned) return 'operativo';
    return this.nivelPorNombre.get(this.normalizarNombreParaMatch(assigned)) || 'operativo';
  }
 
  /**
   * ¿Esta tarea está hecha? Cuenta por EVIDENCIA real, no por palomeo:
   *  - Antes/Después: ambas fotos subidas.
   *  - Varias fotos: al menos una.
   *  - Una foto: subida.
   *  - Sin evidencia: requiere palomeado manual.
   * Antes solo miraba item.checked → daba 0% aunque hubiera fotos.
   */
  /** Delega al helper compartido: evidencia real O justificación del checklist
   *  (nota del colaborador / entrega con retraso justificado). */
  private itemHecho(it: any, c?: any): boolean {
    return esItemHecho(it, c);
  }

  // ============================================================================
  //  MATEMÁTICAS — calcula progress, alertas y stats por sucursal
  // ============================================================================
  procesarMatematicas() {
    const ahora = this.horaActual();
 
    const calcularDatos = (listaBase: any[], colorDefault: string) => {
      const listaPermitida = listaBase.filter(item => this.sucursalesPermitidas.includes(item.name));
 
      return listaPermitida.map(sucursal => {
        const storeChecklists = this.checklistsDesdeFirebase.filter(c => c.store === sucursal.name);
        let totalItems = 0;
        let completedItems = 0;
        let alertas = 0;
        // Desglose por nivel jerárquico del asignado de cada checklist.
        const personasMandos = new Set<string>();
        const personasOperativos = new Set<string>();
        let checklistsMandos = 0;
        let checklistsOperativos = 0;

        storeChecklists.forEach(c => {
          const nivel = this.nivelDelAssigned(c.assigned);
          if (nivel === 'mando') {
            checklistsMandos++;
            if (c.assigned) personasMandos.add(c.assigned);
          } else {
            checklistsOperativos++;
            if (c.assigned) personasOperativos.add(c.assigned);
          }
          if (c.items && Array.isArray(c.items)) {
            c.items.forEach((item: any) => {
              totalItems++;
              const hecha = this.itemHecho(item, c);
              if (hecha) completedItems++;
              // contar vencidas: no hechas + horaLimite/time < ahora
              if (!hecha) {
                const hl = item.horaLimite || item.time;
                if (hl && hl.includes(':')) {
                  const [h, m] = hl.split(':').map(Number);
                  const limite = new Date(ahora);
                  limite.setHours(h, m, 0, 0);
                  if (ahora > limite) alertas++;
                }
              }
            });
          }
        });

        const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

        // Color semáforo
        let finalColor = colorDefault;
        if (colorDefault === 'semaforo') {
          if (progress >= 80)      finalColor = '#10B981';
          else if (progress >= 50) finalColor = '#F59E0B';
          else if (totalItems > 0) finalColor = '#EF4444';
          else                     finalColor = '#94A3B8'; // gris para sin actividad
        }

        return {
          ...sucursal,
          totalChecklists: storeChecklists.length,
          completedItems,
          totalItems,
          progress,
          alertas,
          color: finalColor,
          // Desglose de personas y checklists por nivel — para mostrar en la tarjeta.
          personasMandos: personasMandos.size,
          personasOperativos: personasOperativos.size,
          checklistsMandos,
          checklistsOperativos
        };
      });
    };
 
    this.rawComerciales.set(calcularDatos(this.sucursalesComerciales, 'semaforo'));
    this.rawAdministrativas.set(calcularDatos(this.sucursalesAdministrativas, 'semaforo'));
    this.rawAreasTrabajo.set(calcularDatos(this.areasDesdeFirebase, '#D97706'));
  }
 
  // ============================================================================
  //  HELPERS
  // ============================================================================
  badgeProgreso(p: number, totalItems: number): string {
    if (totalItems === 0) return 'pct-empty';
    if (p >= 80) return 'pct-ok';
    if (p >= 50) return 'pct-warn';
    return 'pct-bad';
  }
 
  cambiarOrden(orden: 'avance' | 'alertas' | 'alfabetico' | 'tareas') {
    this.ordenamiento.set(orden);
  }
 
  toggleSoloAlertas() {
    this.soloConAlertas.set(!this.soloConAlertas());
  }
}