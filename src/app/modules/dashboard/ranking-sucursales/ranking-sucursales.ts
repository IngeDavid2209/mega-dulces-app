import { Component, signal, computed, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import { esItemHecho } from '../../../shared/item-completado.util';
import { ApiService } from '../../../shared/api.service';

interface DiaStat {
  fechaISO: string;     // YYYY-MM-DD
  etiqueta: string;     // 'Lun', 'Mar', ...
  diaNumero: number;    // 1..31
  completados: number;
  total: number;
  porcentaje: number;
  esFuturo: boolean;    // si la fecha aún no llega
  esHoy: boolean;
}

interface RankingFila {
  sucursal: string;
  dias: DiaStat[];
  totalSemana: number;
  completadosSemana: number;
  promedioSemana: number;   // 0..100 — porcentaje REAL (hechas/total)
  scoreRanking: number;     // 0..100 — puntuación combinada (para ordenar)
  muestraBaja: boolean;     // pocas tareas en la semana (poco confiable)
  constancia: number;       // 0..1 — días activos ÷ días evaluados
  diasActivos: number;      // días (ya transcurridos) con actividad real
  diasEvaluados: number;    // días de lun a hoy que ya transcurrieron
}

/** Tareas ASIGNADAS mínimas en la semana para competir en el ranking principal.
 *  Las sucursales por debajo salen a la sección "Sucursales con poca carga"
 *  (un 100% de 3 tareas no debe encabezar el ranking). Ajusta aquí el mínimo. */
const MIN_TAREAS_RANKING = 10;

/** Pesos de la PUNTUACIÓN COMBINADA con la que se ordena el ranking.
 *  Deben sumar 1. Ajusta aquí el balance entre los tres factores:
 *   - PESO_CUMPLIMIENTO: qué tanto pesa el % (tareas hechas ÷ asignadas).
 *   - PESO_VOLUMEN:      qué tanto pesa cuántas tareas completó de verdad.
 *   - PESO_CONSTANCIA:   qué tanto pesa trabajar TODOS los días (no solo uno).
 *  La constancia es el más alto: castiga fuerte la falta de constancia. */
const PESO_CUMPLIMIENTO = 0.35;
const PESO_VOLUMEN = 0.25;
const PESO_CONSTANCIA = 0.40;

/** % mínimo de tareas de un día para contar ese día como "activo".
 *  Un día por debajo (incluido 0%) NO cuenta y baja la constancia. */
const UMBRAL_DIA_ACTIVO = 0.10;

@Component({
  selector: 'app-ranking-sucursales',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './ranking-sucursales.html',
  styleUrls: ['./ranking-sucursales.css']
})
export class RankingSucursalesComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null;

  /** Lista cruda de checklists de la semana actual (lunes-domingo). */
  private checklistsSemana = signal<any[]>([]);
  /** Indicador visual de carga. */
  cargando = signal<boolean>(true);

  /** Fecha "ancla" para calcular la semana (por defecto hoy). */
  fechaAncla = signal<Date>(new Date());

  /** Mínimo de tareas asignadas para competir en el ranking (expuesto al HTML). */
  readonly minTareasRanking = MIN_TAREAS_RANKING;

  private api = inject(ApiService);
  private destructores: (() => void)[] = [];

  // ============================================================================
  // CICLO DE VIDA
  // ============================================================================
  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) this.currentUser = JSON.parse(sesion);
    this.conectarConLaNube();
  }
  ngOnDestroy() {
    this.destructores.forEach(d => d());
  }

  // ============================================================================
  // FECHAS DE LA SEMANA
  // ============================================================================
  /** Lunes de la semana activa (00:00). */
  private lunesDeLaSemana(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const dow = x.getDay();             // 0=domingo, 1=lunes, ...
    const diffLunes = dow === 0 ? -6 : 1 - dow;
    x.setDate(x.getDate() + diffLunes);
    return x;
  }
  /** YYYY-MM-DD local de una fecha. */
  private toYmd(d: Date): string {
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
  }
  /** Etiqueta corta del día (Lun, Mar, ...). */
  private etiquetaDia(d: Date): string {
    return d.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '');
  }

  /** Lista de 7 fechas (lunes a domingo) de la semana activa. */
  private diasDeLaSemana(): Date[] {
    const lunes = this.lunesDeLaSemana(this.fechaAncla());
    const arr: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(lunes);
      d.setDate(lunes.getDate() + i);
      arr.push(d);
    }
    return arr;
  }

  rangoSemanaTexto = computed(() => {
    const dias = this.diasDeLaSemana();
    const ini = dias[0];
    const fin = dias[6];
    const fmt = (d: Date) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    return `${fmt(ini)} — ${fmt(fin)}`;
  });

  // ============================================================================
  // FIRESTORE
  // ============================================================================
  private conectarConLaNube() {
    this.cargando.set(true);
    const dias = this.diasDeLaSemana();
    const desdeISO = this.toYmd(dias[0]);
    const hastaISO = this.toYmd(dias[6]);
    // FERROCARRIL Etapa 3: antes onSnapshot(checklists); ahora poll a Postgres.
    const recargar = async () => {
      const resp = await this.api.get('/api/checklists?desde=' + encodeURIComponent(desdeISO) + '&hasta=' + encodeURIComponent(hastaISO))
        .catch((e: any) => { console.error('[ranking-sucursales] poll PG', e); return null; });
      if (!resp) { this.cargando.set(false); return; }
      const filas: any[] = resp.checklists || [];
      const arr: any[] = [];
      filas.forEach((c: any) => {
        if (c.eliminado === true || c.archivado === true) return;
        arr.push({ ...c });
      });
      this.checklistsSemana.set(arr);
      this.cargando.set(false);
    };
    recargar();
    const idPoll = setInterval(recargar, 20000);
    this.destructores.push(() => clearInterval(idPoll));
  }

  // ============================================================================
  // CÁLCULO DEL RANKING
  // ============================================================================
  /** Delega al helper compartido: evidencia real O justificación del checklist
   *  (nota del colaborador / entrega con retraso justificado). */
  private itemHecho(it: any, c?: any): boolean {
    return esItemHecho(it, c);
  }

  /**
   * PUNTUACIÓN COMBINADA para ORDENAR el ranking (no es el %).
   * Mezcla tres factores:
   *
   *   puntuacion = (cumplimiento × PESO_CUMPLIMIENTO)
   *              + (volumen      × PESO_VOLUMEN)
   *              + (constancia   × PESO_CONSTANCIA)
   *
   *  - cumplimiento01: tareas hechas ÷ asignadas (0 a 1).
   *  - hechas:         tareas completadas por la sucursal.
   *  - maxHechas:      la mayor cantidad de tareas completadas por UNA sucursal
   *                    esa semana (entre las que compiten). La que más trabajó
   *                    vale 1.0 en volumen (volumen_normalizado = hechas ÷ maxHechas).
   *  - constancia01:   días activos ÷ días evaluados (0 a 1). Trabajar 1 de 4
   *                    días = 0.25 y arrastra la puntuación hacia abajo.
   *
   * Devuelve 0..1. Para cambiar el balance, ajusta los PESO_* de arriba.
   */
  private calcularPuntuacion(cumplimiento01: number, hechas: number, maxHechas: number, constancia01: number): number {
    const volumenNormalizado = maxHechas > 0 ? (hechas / maxHechas) : 0;
    return (cumplimiento01 * PESO_CUMPLIMIENTO)
         + (volumenNormalizado * PESO_VOLUMEN)
         + (constancia01 * PESO_CONSTANCIA);
  }

  /** Ranking ya calculado y ordenado por promedio descendente. */
  ranking = computed<RankingFila[]>(() => {
    const checklists = this.checklistsSemana();
    const dias = this.diasDeLaSemana();
    const hoyISO = this.toYmd(new Date());

    // Filtra por sucursales permitidas (admin global ve todas).
    const permitidas = sucursalesPermitidas(this.currentUser);

    // Agrupa por sucursal × día.
    const mapa = new Map<string, Map<string, { ok: number; total: number }>>();

    for (const c of checklists) {
      const store = c.store;
      if (!store) continue;
      if (permitidas !== null && !permitidas.includes(store)) continue;
      if (!c.items || !Array.isArray(c.items)) continue;
      const fechaISO = c.date;
      if (!fechaISO) continue;

      if (!mapa.has(store)) mapa.set(store, new Map());
      const porDia = mapa.get(store)!;
      if (!porDia.has(fechaISO)) porDia.set(fechaISO, { ok: 0, total: 0 });
      const acc = porDia.get(fechaISO)!;
      for (const it of c.items) {
        acc.total++;
        if (this.itemHecho(it, c)) acc.ok++;
      }
    }

    // Construye filas del ranking. Incluye sucursales que tengan AL MENOS un
    // día con actividad esta semana.
    const filas: RankingFila[] = [];
    for (const [sucursal, porDia] of mapa) {
      const diasStat: DiaStat[] = dias.map(d => {
        const iso = this.toYmd(d);
        const acc = porDia.get(iso) || { ok: 0, total: 0 };
        const pct = acc.total > 0 ? Math.round((acc.ok / acc.total) * 100) : 0;
        return {
          fechaISO: iso,
          etiqueta: this.etiquetaDia(d),
          diaNumero: d.getDate(),
          completados: acc.ok,
          total: acc.total,
          porcentaje: pct,
          esFuturo: iso > hoyISO,
          esHoy: iso === hoyISO
        };
      });
      const totalSemana = diasStat.reduce((s, x) => s + x.total, 0);
      const completadosSemana = diasStat.reduce((s, x) => s + x.completados, 0);
      const promedio = totalSemana > 0 ? Math.round((completadosSemana / totalSemana) * 100) : 0;

      // CONSTANCIA: días activos ÷ días evaluados.
      //  - Días evaluados = todos los días de lun a hoy que YA transcurrieron
      //    (no cuenta el futuro).
      //  - Día activo = ese día completó al menos UMBRAL_DIA_ACTIVO de sus tareas.
      //    Un día en 0% (o sin tareas asignadas) NO cuenta y baja la constancia.
      const diasTranscurridos = diasStat.filter(d => !d.esFuturo);
      const diasEvaluados = diasTranscurridos.length;
      const diasActivos = diasTranscurridos
        .filter(d => d.total > 0 && (d.completados / d.total) >= UMBRAL_DIA_ACTIVO).length;
      const constancia = diasEvaluados > 0 ? (diasActivos / diasEvaluados) : 0;

      filas.push({
        sucursal, dias: diasStat, totalSemana, completadosSemana,
        promedioSemana: promedio, scoreRanking: 0,
        muestraBaja: totalSemana < MIN_TAREAS_RANKING,
        constancia, diasActivos, diasEvaluados
      });
    }

    // Máximo de tareas COMPLETADAS entre las sucursales que compiten (>= mínimo).
    // Es la referencia del volumen: esa sucursal vale 1.0 y el resto se mide contra ella.
    const maxHechas = filas
      .filter(f => !f.muestraBaja)
      .reduce((m, f) => Math.max(m, f.completadosSemana), 0);

    // Puntuación combinada de cada fila (0..100 para mostrar y ordenar).
    for (const f of filas) {
      const cumplimiento01 = f.totalSemana > 0 ? f.completadosSemana / f.totalSemana : 0;
      f.scoreRanking = Math.round(
        this.calcularPuntuacion(cumplimiento01, f.completadosSemana, maxHechas, f.constancia) * 100
      );
    }

    // Orden: primero las que compiten (>= mínimo), por PUNTUACIÓN combinada de
    // mayor a menor (ya no por % puro, para no premiar a quien hizo poquito con
    // buen %). Después, aparte, las de poca carga ordenadas por % (informativo).
    const porPuntuacion = (a: RankingFila, b: RankingFila) =>
      b.scoreRanking - a.scoreRanking ||
      b.completadosSemana - a.completadosSemana ||
      a.sucursal.localeCompare(b.sucursal);
    const porPorcentaje = (a: RankingFila, b: RankingFila) =>
      b.promedioSemana - a.promedioSemana ||
      b.completadosSemana - a.completadosSemana ||
      a.sucursal.localeCompare(b.sucursal);

    const confiables = filas.filter(f => !f.muestraBaja).sort(porPuntuacion);
    const pocasTareas = filas.filter(f => f.muestraBaja).sort(porPorcentaje);
    return [...confiables, ...pocasTareas];
  });

  /** Promedio general de la organización (todas las sucursales). */
  promedioGeneral = computed<number>(() => {
    const filas = this.ranking();
    const total = filas.reduce((s, f) => s + f.totalSemana, 0);
    const ok = filas.reduce((s, f) => s + f.completadosSemana, 0);
    return total > 0 ? Math.round((ok / total) * 100) : 0;
  });

  /** MAYOR CUMPLIMIENTO: mejor % entre las que superan el mínimo (compiten). */
  mayorCumplimiento = computed<RankingFila | null>(() => {
    const aptas = this.ranking().filter(f => !f.muestraBaja && f.totalSemana > 0);
    if (aptas.length === 0) return null;
    return aptas.reduce((mej, f) =>
      (f.promedioSemana > mej.promedioSemana ||
        (f.promedioSemana === mej.promedioSemana && f.completadosSemana > mej.completadosSemana))
        ? f : mej);
  });

  /** MAYOR VOLUMEN: la sucursal que más tareas completó en la semana. */
  mayorVolumen = computed<RankingFila | null>(() => {
    const activas = this.ranking().filter(f => f.completadosSemana > 0);
    if (activas.length === 0) return null;
    return activas.reduce((mej, f) => f.completadosSemana > mej.completadosSemana ? f : mej);
  });

  /** MÁS CONSTANTE: mayor constancia entre las que superan el mínimo (compiten). */
  masConstante = computed<RankingFila | null>(() => {
    const aptas = this.ranking().filter(f => !f.muestraBaja && f.diasEvaluados > 0);
    if (aptas.length === 0) return null;
    return aptas.reduce((mej, f) =>
      (f.constancia > mej.constancia ||
        (f.constancia === mej.constancia && f.completadosSemana > mej.completadosSemana))
        ? f : mej);
  });

  // ============================================================================
  // NAVEGACIÓN DE SEMANAS
  // ============================================================================
  semanaAnterior() {
    const d = new Date(this.fechaAncla());
    d.setDate(d.getDate() - 7);
    this.cambiarSemana(d);
  }
  semanaSiguiente() {
    const d = new Date(this.fechaAncla());
    d.setDate(d.getDate() + 7);
    this.cambiarSemana(d);
  }
  semanaActual() {
    this.cambiarSemana(new Date());
  }
  private cambiarSemana(d: Date) {
    // Cierra el listener viejo y reconecta con el rango nuevo.
    this.destructores.forEach(x => x());
    this.destructores = [];
    this.fechaAncla.set(d);
    this.conectarConLaNube();
  }

  // ============================================================================
  // HELPERS DE PRESENTACIÓN
  // ============================================================================
  /** Color del badge/barra según porcentaje. */
  colorPct(p: number, total: number): string {
    if (total === 0) return '#E2E8F0';
    if (p >= 80) return '#10B981';
    if (p >= 50) return '#F59E0B';
    return '#EF4444';
  }
  /** Texto del puesto (1°, 2°, 3°). */
  puesto(i: number): string { return `${i + 1}°`; }
  /** Clase para colorear top 3. */
  claseTop(i: number): string {
    if (i === 0) return 'top-oro';
    if (i === 1) return 'top-plata';
    if (i === 2) return 'top-bronce';
    return '';
  }
}
