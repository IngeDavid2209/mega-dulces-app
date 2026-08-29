/**
 * 📕 MANUAL POR PUESTO — pantalla de consulta
 *
 * Reemplaza a las cuatro pantallas de Rutinas (Catálogo, Asignación,
 * Programación, Migración) con una sola, y con una diferencia de fondo: aquí no
 * se captura nada. Es la hoja del organigrama: qué puesto existe, qué manual lo
 * gobierna y qué tareas recibe todos los días quien lo ocupa.
 *
 * Solo lectura, a propósito. Los checklists de manual son documentos
 * controlados; cambiarlos es publicar una versión nueva del manual, no editar
 * un campo. Esta pantalla sirve para verificar y para explicar, no para tocar.
 *
 * Lo que sí resuelve un problema real de operación: el tablero de cobertura de
 * arriba. Deja ver de un golpe cuánta gente activa está recibiendo sus tareas y
 * cuánta no, que es lo que se descompone en silencio cuando alguien entra sin
 * puesto capturado.
 */

import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { UsuariosService } from '../../../shared/usuarios.service';
import { cerrarSesionSegura } from '../../../shared/sesion.util';
import { normalizarNombre } from '../../../shared/permisos.util';
import {
  PuestoOrganigrama, puestosPorUnidad, UnidadOrganigrama,
} from '../../../shared/organigrama.catalogo';
import { resolverPuesto } from '../../../shared/puesto.util';
import {
  ManualPuesto, TareaManual, manualDePuesto, tareasDePuesto,
  totalTareasAutomaticas, MANUALES_POR_PUESTO,
} from '../../../shared/tareas-manual.catalogo';

/** Una fila de la hoja: el puesto con su manual y su gente. */
interface FilaPuesto {
  puesto: PuestoOrganigrama;
  manual: ManualPuesto | null;
  tareas: TareaManual[];
  /** Cuántas se entregan solas (excluye las de solo-evento). */
  automaticas: number;
  /** Personas activas que hoy tienen este puesto. */
  ocupantes: string[];
}

interface GrupoUnidad {
  unidad: UnidadOrganigrama;
  etiqueta: string;
  filas: FilaPuesto[];
}

@Component({
  selector: 'app-manual-puestos',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './manual-puestos.html',
  styleUrls: ['./manual-puestos.css'],
})
export class ManualPuestosComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private usuariosSvc = inject(UsuariosService);

  isMenuOpen = false;
  currentUser: any = null;

  /**
   * Plantilla, leída del listener compartido. Es la señal del service, no una
   * copia: si se copiara, la cobertura se quedaría congelada en el primer
   * render y diría que falta gente que ya se corrigió.
   */
  usuarios = this.usuariosSvc.usuarios;

  /** Texto del buscador (puesto, manual o nombre de tarea). */
  busqueda = signal('');

  /** Puesto abierto en el detalle. */
  puestoAbierto = signal<string | null>(null);

  /** Solo los puestos que ya tienen manual. */
  soloConManual = signal(false);

  // ── Totales del catálogo (constantes: salen del código, no de la base) ──
  readonly totalPuestos = puestosPorUnidad().reduce((n, g) => n + g.puestos.length, 0);
  readonly totalManuales = MANUALES_POR_PUESTO.length;
  readonly totalTareas = totalTareasAutomaticas();

  /** Puestos que ya tienen manual publicado. */
  readonly puestosConManual = MANUALES_POR_PUESTO
    .reduce((n, m) => n + m.puestoIds.length, 0);

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (!sesion) { this.router.navigate(['/login']); return; }
    this.currentUser = JSON.parse(sesion);

    // La plantilla llega por el listener compartido; aquí solo se lee.
    this.usuariosSvc.iniciar();
  }

  ngOnDestroy() {
    // Baja el refcount del listener compartido: si nadie más lo usa, se apaga.
    this.usuariosSvc.detener();
  }

  /** Personas activas, que son las que cuentan para cobertura. */
  private activos = computed(() =>
    this.usuarios().filter(u => u.activo !== false && (u.rol === 'trabajador' || u.rol === 'admin'))
  );

  /** Cuánta gente activa está recibiendo tareas de su manual. */
  cobertura = computed(() => {
    const act = this.activos();
    let recibiendo = 0, sinPuesto = 0, sinManual = 0;
    for (const u of act) {
      const id = resolverPuesto(u).puestoId;
      if (!id) { sinPuesto++; continue; }
      if (tareasDePuesto(id).some(t => !t.soloPorEvento)) recibiendo++;
      else sinManual++;
    }
    return { total: act.length, recibiendo, sinPuesto, sinManual };
  });

  // ── QUIENES NO TIENEN PUESTO ────────────────────────────────────────────
  //
  // El numero solo dice cuanta gente esta fuera; para arreglarlo hace falta
  // saber QUIENES son y, sobre todo, QUE dice su ficha. Casi siempre el
  // problema no es que el campo este vacio, sino que el cargo escrito a mano
  // ("Ayudante General", "Implementacion Kepler") no coincide con ningun
  // puesto ni alias del organigrama. Sin ver ese texto, la correccion es a
  // ciegas.
  verSinPuesto = signal(false);

  alternarSinPuesto() { this.verSinPuesto.update(v => !v); }

  sinPuesto = computed(() => {
    const filas = this.activos()
      .filter(u => !resolverPuesto(u).puestoId)
      .map(u => ({
        nombre: u.nombre || '(sin nombre)',
        // Lo que trae la ficha hoy. Es el texto que hay que hacer coincidir.
        cargo: (u.cargo || '').trim(),
        sucursal: (u.sucursal || (u.sucursales && u.sucursales[0]) || '').trim(),
        rol: u.rol || '',
      }));

    // Por sucursal y luego por nombre: la correccion se hace plaza por plaza.
    return filas.sort((a, b) =>
      (a.sucursal || 'zzz').localeCompare(b.sucursal || 'zzz') ||
      a.nombre.localeCompare(b.nombre));
  });

  /** La hoja completa, agrupada por unidad del organigrama. */
  grupos = computed<GrupoUnidad[]>(() => {
    const term = normalizarNombre(this.busqueda());
    const filtrarConManual = this.soloConManual();

    // Ocupantes por puesto, resueltos una sola vez.
    const ocupantesPorPuesto = new Map<string, string[]>();
    for (const u of this.activos()) {
      const id = resolverPuesto(u).puestoId;
      if (!id) continue;
      const lista = ocupantesPorPuesto.get(id) || [];
      if (u.nombre) lista.push(u.nombre);
      ocupantesPorPuesto.set(id, lista);
    }

    return puestosPorUnidad().map(g => {
      const filas: FilaPuesto[] = g.puestos.map(p => {
        const manual = manualDePuesto(p.id);
        const tareas = tareasDePuesto(p.id);
        return {
          puesto: p,
          manual,
          tareas,
          automaticas: tareas.filter(t => !t.soloPorEvento).length,
          ocupantes: (ocupantesPorPuesto.get(p.id) || []).sort((a, b) => a.localeCompare(b)),
        };
      }).filter(f => {
        if (filtrarConManual && !f.manual) return false;
        if (!term) return true;
        // Busca en el puesto, el documento y los nombres de las tareas: es lo
        // que alguien teclea cuando anda buscando "cierre" o "caducidades".
        const heno = normalizarNombre([
          f.puesto.nombre,
          f.manual?.documento || '',
          f.manual?.codigo || '',
          ...f.tareas.map(t => t.nombre),
        ].join(' '));
        return heno.includes(term);
      });

      return { unidad: g.unidad, etiqueta: g.etiqueta, filas };
    }).filter(g => g.filas.length > 0);
  });

  /** ¿Hay algo que mostrar con los filtros puestos? */
  hayResultados = computed(() => this.grupos().length > 0);

  alternarDetalle(puestoId: string) {
    this.puestoAbierto.set(this.puestoAbierto() === puestoId ? null : puestoId);
  }

  esAbierto(puestoId: string): boolean {
    return this.puestoAbierto() === puestoId;
  }

  /** Etiqueta legible de la periodicidad, incluyendo el día. */
  textoFrecuencia(t: TareaManual): string {
    switch (t.frecuencia) {
      case 'Diaria':    return 'Todos los días';
      case 'Semanal':   return t.diaSemana ? `Cada semana, los ${t.diaSemana}` : 'Cada semana';
      case 'Quincenal': return 'Días 1 y 16 de cada mes';
      case 'Mensual':   return `Día ${t.diaMes || 1} de cada mes`;
      default:          return t.frecuencia;
    }
  }

  /** Etiqueta del momento de la jornada. */
  textoMomento(t: TareaManual): string {
    const m: Record<string, string> = {
      apertura: '🌅 Apertura',
      operacion: '⚙️ Operación',
      cierre: '🌇 Cierre',
      supervision: '🔎 Supervisión',
      administrativo: '📋 Administrativo',
    };
    return m[t.momento] || t.momento;
  }

  limpiarFiltros() {
    this.busqueda.set('');
    this.soloConManual.set(false);
  }

  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  async cerrarSesion() {
    await cerrarSesionSegura();
    this.router.navigate(['/login']);
  }
}
