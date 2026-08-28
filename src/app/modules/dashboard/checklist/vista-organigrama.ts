import {
  Component, Input, Output, EventEmitter, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  PUESTOS_ORGANIGRAMA, PuestoOrganigrama, puestosPorUnidad, UnidadOrganigrama
} from '../../../shared/organigrama.catalogo';
import { resolverPuesto } from '../../../shared/puesto.util';
import {
  ManualPuesto, TareaManual, manualDePuesto, tareasAutomaticasDePuesto
} from '../../../shared/tareas-manual.catalogo';
import { normalizarNombre } from '../../../shared/permisos.util';

/**
 * 🏛️ VISTA POR ORGANIGRAMA del apartado "Tareas del Manual".
 *
 * Navegación por la estructura de la empresa: unidad → puesto. Al elegir un
 * puesto se ve LO QUE EL MANUAL MANDA y, debajo, QUIÉN LO ESTÁ CUMPLIENDO HOY,
 * separado por sucursal.
 *
 * Por qué las dos cosas juntas: el manual solo (sin gente) ya se consulta en
 * "Manual por Puesto"; el cumplimiento solo (sin manual) no dice si el pendiente
 * es un punto de control crítico o un detalle. Puestas una sobre otra, un
 * Encargado ve el estándar y su ejecución en la misma pantalla, que es
 * literalmente lo que el manual de Jefatura de Zona le pide: "validar controles
 * y registros".
 *
 * Por qué el corte por sucursal va ADENTRO del puesto y no como otro nivel del
 * menú: un Anaquelista existe en ocho sucursales, y el dato que sirve es
 * comparar cómo va el mismo puesto entre ellas. Con la sucursal como tercer
 * nivel habría que entrar ocho veces para saberlo.
 *
 * ALCANCE, igual que su hermano `panel-responsables`: esto es NAVEGACIÓN Y
 * LECTURA. Abrir una tarea emite `abrir` y lleva a la vista de detalle de
 * siempre —la de la evidencia y el botón de enviar—, que aquí no se toca.
 */

/** Una tarea entregada, lista para pintar. */
interface EntregaVista {
  ref: any;                 // el checklist original, se emite tal cual
  titulo: string;
  completados: number;
  totalItems: number;
  porcentaje: number;
  /** true si ya pasó su hora y sigue pendiente. */
  vencida: boolean;
  completa: boolean;
  hora: string;
}

/** Las entregas de una persona dentro de una sucursal. */
interface PersonaVista {
  nombre: string;
  iniciales: string;
  entregas: EntregaVista[];
  completados: number;
  totalItems: number;
  porcentaje: number;
}

/** Un grupo de sucursal dentro del puesto seleccionado. */
interface SucursalVista {
  sucursal: string;
  personas: PersonaVista[];
  completados: number;
  totalItems: number;
  porcentaje: number;
}

/** Una fila de puesto en el menú. */
interface FilaPuesto {
  puesto: PuestoOrganigrama;
  /** Cuántas tareas manda su manual (0 = todavía no tiene manual). */
  tareasManual: number;
  tieneManual: boolean;
  /** Cuántas entregas hay hoy para ese puesto. */
  entregasHoy: number;
  /** Avance agregado del puesto hoy (null si no hay entregas). */
  porcentaje: number | null;
  pendientesVencidas: number;
}

interface GrupoUnidad {
  unidad: UnidadOrganigrama;
  etiqueta: string;
  filas: FilaPuesto[];
  entregasHoy: number;
  conManual: number;
}

@Component({
  selector: 'app-vista-organigrama',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './vista-organigrama.html',
  styleUrls: ['./vista-organigrama.css']
})
export class VistaOrganigramaComponent {

  /** Checklists ya filtrados por permisos, pestaña y apartado. Los da el padre. */
  private lista = signal<any[]>([]);
  @Input() set checklists(v: any[]) { this.lista.set(Array.isArray(v) ? v : []); }

  /**
   * Plantilla, para poder resolver el puesto de cada quien y para saber quién
   * OCUPA un puesto aunque hoy no tenga nada entregado.
   */
  private personal = signal<any[]>([]);
  @Input() set usuarios(v: any[]) { this.personal.set(Array.isArray(v) ? v : []); }

  /** Se emite al tocar una tarea: el padre abre la vista de detalle de siempre. */
  @Output() abrir = new EventEmitter<any>();

  /** Puesto abierto. null = solo el menú. */
  puestoActivo = signal<string | null>(null);

  /** Unidades desplegadas en el menú. */
  unidadesAbiertas = signal<Set<UnidadOrganigrama>>(new Set());

  /** Esconde los puestos que todavía no tienen manual (son 70 de 89). */
  soloConManual = signal(true);

  // ==========================================================================
  //  ÍNDICES
  // ==========================================================================

  /**
   * Checklists agrupados por el puesto de quien los tiene.
   *
   * El amarre se hace por `assignedUid` cuando existe y por nombre normalizado
   * cuando no —hay checklists viejos sin uid—, exactamente el mismo criterio con
   * el que el robot los entregó, para que lo que se ve aquí coincida con lo que
   * se entregó allá.
   */
  private porPuesto = computed(() => {
    const mapa = new Map<string, any[]>();

    // Índices de la plantilla: uid y nombre normalizado -> puestoId.
    const puestoPorUid = new Map<string, string>();
    const puestoPorNombre = new Map<string, string>();
    for (const u of this.personal()) {
      const pid = resolverPuesto(u).puestoId;
      if (!pid) continue;
      const uid = u.id || u.uid;
      if (uid) puestoPorUid.set(String(uid), pid);
      const n = normalizarNombre(u.nombre);
      if (n) puestoPorNombre.set(n, pid);
    }

    for (const c of this.lista()) {
      // El propio checklist trae el puesto con el que se generó: es la fuente
      // más fiel, porque es la que usó el robot en ese momento.
      let pid: string | undefined = c._puestoId || c?.datos?._puestoId;
      if (!pid && c.assignedUid) pid = puestoPorUid.get(String(c.assignedUid));
      if (!pid) pid = puestoPorNombre.get(normalizarNombre(c.assigned));
      if (!pid) continue;                     // sin puesto: no cae en el árbol
      const arr = mapa.get(pid) || [];
      arr.push(c);
      mapa.set(pid, arr);
    }
    return mapa;
  });

  // ==========================================================================
  //  EL MENÚ
  // ==========================================================================

  grupos = computed<GrupoUnidad[]>(() => {
    const porP = this.porPuesto();
    const soloManual = this.soloConManual();

    return puestosPorUnidad().map(g => {
      const filas: FilaPuesto[] = g.puestos.map(p => {
        const entregas = porP.get(p.id) || [];
        const tot = entregas.reduce((n, c) => n + (c.items?.length || 0), 0);
        const hechos = entregas.reduce((n, c) => n + (c.calcCompletados || 0), 0);
        return {
          puesto: p,
          tareasManual: tareasAutomaticasDePuesto(p.id).length,
          tieneManual: !!manualDePuesto(p.id),
          entregasHoy: entregas.length,
          porcentaje: entregas.length ? Math.round((hechos / (tot || 1)) * 100) : null,
          pendientesVencidas: entregas.filter(c => this.esVencida(c)).length,
        };
      }).filter(f => {
        // Un puesto sin manual y sin nada entregado no aporta: se esconde salvo
        // que se pida ver el organigrama completo.
        if (!soloManual) return true;
        return f.tieneManual || f.entregasHoy > 0;
      });

      return {
        unidad: g.unidad,
        etiqueta: g.etiqueta,
        filas,
        entregasHoy: filas.reduce((n, f) => n + f.entregasHoy, 0),
        conManual: filas.filter(f => f.tieneManual).length,
      };
    }).filter(g => g.filas.length > 0);
  });

  /** Totales del encabezado. */
  resumen = computed(() => {
    const gs = this.grupos();
    return {
      unidades: gs.length,
      puestos: gs.reduce((n, g) => n + g.filas.length, 0),
      entregas: gs.reduce((n, g) => n + g.entregasHoy, 0),
      puestosSinManual: PUESTOS_ORGANIGRAMA.filter(
        p => p.vigente !== false && !manualDePuesto(p.id)
      ).length,
    };
  });

  // ==========================================================================
  //  EL PUESTO ABIERTO
  // ==========================================================================

  /** El manual del puesto abierto (null si no hay puesto abierto o no tiene). */
  manualActivo = computed<ManualPuesto | null>(() => manualDePuesto(this.puestoActivo()));

  /** Las tareas que manda el manual del puesto abierto. */
  tareasDelManual = computed<TareaManual[]>(() => {
    const m = this.manualActivo();
    return m ? m.tareas : [];
  });

  puestoActivoNombre = computed(() => {
    const id = this.puestoActivo();
    const p = PUESTOS_ORGANIGRAMA.find(x => x.id === id);
    return p ? p.nombre : '';
  });

  /** Quién cumple hoy el puesto abierto, agrupado por sucursal. */
  cumplimiento = computed<SucursalVista[]>(() => {
    const id = this.puestoActivo();
    if (!id) return [];
    const entregas = this.porPuesto().get(id) || [];

    // sucursal -> persona -> entregas
    const porSuc = new Map<string, Map<string, EntregaVista[]>>();
    for (const c of entregas) {
      const suc = (c.store || 'Sin sucursal').trim();
      const per = (c.assigned || 'Sin asignar').trim();
      const total = c.items?.length || 0;
      const hechos = c.calcCompletados || 0;
      const vista: EntregaVista = {
        ref: c,
        titulo: c.name || '(sin nombre)',
        completados: hechos,
        totalItems: total,
        porcentaje: total ? Math.round((hechos / total) * 100) : 0,
        vencida: this.esVencida(c),
        completa: total > 0 && hechos >= total,
        hora: c.time || '',
      };
      if (!porSuc.has(suc)) porSuc.set(suc, new Map());
      const mp = porSuc.get(suc)!;
      mp.set(per, [...(mp.get(per) || []), vista]);
    }

    const out: SucursalVista[] = [];
    for (const [sucursal, mp] of porSuc) {
      const personas: PersonaVista[] = [];
      for (const [nombre, evs] of mp) {
        const tot = evs.reduce((n, e) => n + e.totalItems, 0);
        const hec = evs.reduce((n, e) => n + e.completados, 0);
        personas.push({
          nombre,
          iniciales: this.iniciales(nombre),
          entregas: evs,
          completados: hec,
          totalItems: tot,
          porcentaje: tot ? Math.round((hec / tot) * 100) : 0,
        });
      }
      personas.sort((a, b) => a.porcentaje - b.porcentaje || a.nombre.localeCompare(b.nombre));
      const tot = personas.reduce((n, p) => n + p.totalItems, 0);
      const hec = personas.reduce((n, p) => n + p.completados, 0);
      out.push({
        sucursal,
        personas,
        completados: hec,
        totalItems: tot,
        porcentaje: tot ? Math.round((hec / tot) * 100) : 0,
      });
    }
    // Peor primero: lo que necesita atención va arriba.
    out.sort((a, b) => a.porcentaje - b.porcentaje || a.sucursal.localeCompare(b.sucursal));
    return out;
  });

  /**
   * Gente que TIENE este puesto pero hoy no recibió nada.
   *
   * Es la mitad que un tablero de cumplimiento normalmente esconde: si alguien
   * no aparece, no se sabe si va bien o si nunca le llegó su checklist. Aquí se
   * dice, porque casi siempre significa descanso, fuera de turno, o que su
   * sucursal no está capturada.
   */
  sinEntrega = computed<{ nombre: string; sucursales: string }[]>(() => {
    const id = this.puestoActivo();
    if (!id) return [];
    const conEntrega = new Set(
      (this.porPuesto().get(id) || []).map(c => normalizarNombre(c.assigned))
    );
    return this.personal()
      .filter(u => u.activo !== false)
      .filter(u => resolverPuesto(u).puestoId === id)
      .filter(u => !conEntrega.has(normalizarNombre(u.nombre)))
      .map(u => ({
        nombre: u.nombre || '(sin nombre)',
        sucursales: (u.sucursales && u.sucursales.length ? u.sucursales : (u.sucursal ? [u.sucursal] : []))
          .join(', ') || 'sin sucursal',
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  // ==========================================================================
  //  ACCIONES
  // ==========================================================================

  alternarUnidad(u: UnidadOrganigrama) {
    const s = new Set(this.unidadesAbiertas());
    s.has(u) ? s.delete(u) : s.add(u);
    this.unidadesAbiertas.set(s);
  }
  unidadAbierta(u: UnidadOrganigrama): boolean {
    return this.unidadesAbiertas().has(u);
  }

  elegirPuesto(id: string) {
    this.puestoActivo.set(this.puestoActivo() === id ? null : id);
  }

  volverAlMenu() { this.puestoActivo.set(null); }

  abrirEntrega(e: EntregaVista) { this.abrir.emit(e.ref); }

  // ==========================================================================
  //  AUXILIARES
  // ==========================================================================

  /** ¿Ya pasó su hora y sigue sin completarse? */
  private esVencida(c: any): boolean {
    if (c.status === 'completo' || c.enviado === true) return false;
    const total = c.items?.length || 0;
    if (total > 0 && (c.calcCompletados || 0) >= total) return false;
    const hoy = this.hoyYmd();
    if ((c.date || '') < hoy) return true;             // de un día anterior
    if ((c.date || '') > hoy) return false;            // programada
    const hora = String(c.time || '23:59');
    const ahora = new Date();
    const hhmm = String(ahora.getHours()).padStart(2, '0') + ':' + String(ahora.getMinutes()).padStart(2, '0');
    return hora < hhmm;
  }

  private hoyYmd(): string {
    const d = new Date();
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().split('T')[0];
  }

  private iniciales(nombre: string): string {
    const p = (nombre || '').trim().split(/\s+/);
    if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
    return (p[0]?.substring(0, 2) || '??').toUpperCase();
  }

  /** Etiqueta de periodicidad, igual que en Manual por Puesto. */
  textoFrecuencia(t: TareaManual): string {
    switch (t.frecuencia) {
      case 'Diaria':    return 'Todos los días';
      case 'Semanal':   return t.diaSemana ? `Cada semana, los ${t.diaSemana}` : 'Cada semana';
      case 'Quincenal': return 'Días 1 y 16';
      case 'Mensual':   return `Día ${t.diaMes || 1} de cada mes`;
      default:          return t.frecuencia;
    }
  }

  textoMomento(t: TareaManual): string {
    const m: Record<string, string> = {
      apertura: '🌅 Apertura', operacion: '⚙️ Operación', cierre: '🌇 Cierre',
      supervision: '🔎 Supervisión', administrativo: '📋 Administrativo',
    };
    return m[t.momento] || t.momento;
  }

  /** Clase de color según avance, para no repetir el ternario en la plantilla. */
  claseAvance(p: number | null): string {
    if (p === null) return 'av-nada';
    if (p >= 100) return 'av-bien';
    if (p > 0) return 'av-medio';
    return 'av-cero';
  }

  trackPuesto(_: number, f: FilaPuesto) { return f.puesto.id; }
  trackSucursal(_: number, s: SucursalVista) { return s.sucursal; }
  trackPersona(_: number, p: PersonaVista) { return p.nombre; }
  trackTarea(_: number, t: TareaManual) { return t.id; }
}
