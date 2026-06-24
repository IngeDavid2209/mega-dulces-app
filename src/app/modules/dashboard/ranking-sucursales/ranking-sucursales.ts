import { Component, signal, computed, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Firestore, collection, onSnapshot, query, where } from '@angular/fire/firestore';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import { esItemHecho } from '../../../shared/item-completado.util';

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
  scoreRanking: number;     // 0..100 — score ajustado al volumen (para ordenar)
  muestraBaja: boolean;     // pocas tareas en la semana (poco confiable)
}

/** Tareas mínimas en la semana para considerar la muestra "confiable". */
const UMBRAL_MUESTRA = 5;
/** Suavizado bayesiano: cuántas "tareas prior" pesan hacia el promedio global. */
const SUAVIZADO = 10;

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

  private firestore = inject(Firestore);
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
    const refColl = collection(this.firestore, 'checklists');
    const q = query(refColl, where('date', '>=', desdeISO), where('date', '<=', hastaISO));
    const unsub = onSnapshot(q, (snap) => {
      const arr: any[] = [];
      snap.forEach(d => {
        const data = d.data() as any;
        if (data.eliminado === true || data.archivado === true) return;
        arr.push({ ...data, id: d.id });
      });
      this.checklistsSemana.set(arr);
      this.cargando.set(false);
    });
    this.destructores.push(unsub);
  }

  // ============================================================================
  // CÁLCULO DEL RANKING
  // ============================================================================
  /** Delega al helper compartido: evidencia real O justificación del checklist
   *  (nota del colaborador / entrega con retraso justificado). */
  private itemHecho(it: any, c?: any): boolean {
    return esItemHecho(it, c);
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
      filas.push({
        sucursal, dias: diasStat, totalSemana, completadosSemana,
        promedioSemana: promedio, scoreRanking: 0, muestraBaja: totalSemana < UMBRAL_MUESTRA
      });
    }

    // 🎯 Score ajustado al VOLUMEN (bayesiano): evita que una sucursal con 1 tarea
    // hecha (100%) supere a otra con 25/34 (74%). Cada sucursal se "jala" hacia el
    // promedio global según cuántas tareas tuvo; con muchas tareas su % real pesa
    // casi completo, con pocas pesa poco.
    const okGlobal = filas.reduce((s, f) => s + f.completadosSemana, 0);
    const totalGlobal = filas.reduce((s, f) => s + f.totalSemana, 0);
    const m = totalGlobal > 0 ? okGlobal / totalGlobal : 0;  // promedio global (0..1)
    for (const f of filas) {
      f.scoreRanking = Math.round(
        ((f.completadosSemana + SUAVIZADO * m) / (f.totalSemana + SUAVIZADO)) * 100
      );
    }

    return filas.sort((a, b) =>
      b.scoreRanking - a.scoreRanking ||
      b.completadosSemana - a.completadosSemana ||
      a.sucursal.localeCompare(b.sucursal)
    );
  });

  /** Promedio general de la organización (todas las sucursales). */
  promedioGeneral = computed<number>(() => {
    const filas = this.ranking();
    const total = filas.reduce((s, f) => s + f.totalSemana, 0);
    const ok = filas.reduce((s, f) => s + f.completadosSemana, 0);
    return total > 0 ? Math.round((ok / total) * 100) : 0;
  });

  /** Mejor sucursal de la semana (o null si no hay datos). */
  mejorSucursal = computed<RankingFila | null>(() => {
    const filas = this.ranking().filter(f => f.totalSemana > 0);
    return filas.length > 0 ? filas[0] : null;
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
