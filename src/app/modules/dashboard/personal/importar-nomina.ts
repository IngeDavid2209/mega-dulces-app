import { Component, Input, Output, EventEmitter, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { nominaEfectiva } from '../../../shared/nomina-puestos';
import { Cruce, ResumenCruce, cruzarNomina, recalcular } from '../../../shared/nomina-cruce.util';

/** Lo que se le pide al padre que escriba. */
export interface CambioPuesto {
  usuario: any;
  puestoId: string;
  /** Nombre oficial del puesto; se guarda también en `cargo`. */
  cargo: string;
  /** Solo cuando la persona no tenía ninguna sucursal. */
  sucursal: string | null;
}

/**
 * 📋 ASIGNAR PUESTOS DESDE LA NÓMINA — vista previa
 *
 * Cruza la Lista de Raya contra la plantilla de la app y MUESTRA el resultado
 * antes de escribir nada. Existe por una razón concreta: el puesto decide qué
 * checklists del manual recibe cada persona, y un amarre equivocado le entrega
 * a alguien las obligaciones de otro puesto sin que nadie se entere.
 *
 * Tres grupos, y solo el primero se aplica:
 *   · Amarre claro   un único candidato gana con ventaja
 *   · Con duda       empate, o dos filas apuntan al mismo usuario → se elige a mano
 *   · No encontrado  nadie en la app se parece; no se toca
 *
 * Este componente NO escribe. Emite la lista aprobada y el padre (personal.ts,
 * que ya tiene Firestore y la API) hace el guardado con su dual-write de
 * siempre. Mismo criterio que `panel-responsables`: la presentación aparte del
 * flujo que persiste.
 */
@Component({
  selector: 'app-importar-nomina',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './importar-nomina.html',
  styleUrls: ['./importar-nomina.css'],
})
export class ImportarNominaComponent implements OnInit {

  /** Plantilla de la app. */
  @Input() usuarios: any[] = [];
  /** Se emite con la lista aprobada. */
  @Output() aplicar = new EventEmitter<CambioPuesto[]>();
  @Output() cerrar = new EventEmitter<void>();

  resumen = signal<ResumenCruce | null>(null);

  /** Filas de "amarre claro" desmarcadas a mano. */
  private excluidas = signal<Set<Cruce>>(new Set());
  /** Para forzar el recálculo de los contadores al resolver una duda. */
  private version = signal(0);

  /** ¿Se llena también la sucursal donde falta? */
  llenarSucursales = signal(true);

  ngOnInit() {
    // `nominaEfectiva()` y no `NOMINA_PUESTOS`: trae las correcciones encimadas.
    this.resumen.set(cruzarNomina(nominaEfectiva(), this.usuarios));
  }

  // ── Selección ─────────────────────────────────────────────────────────────

  estaIncluida(c: Cruce): boolean { return !this.excluidas().has(c); }

  alternar(c: Cruce) {
    const s = new Set(this.excluidas());
    s.has(c) ? s.delete(c) : s.add(c);
    this.excluidas.set(s);
  }

  /** Resuelve una duda eligiendo candidato. */
  elegirCandidato(c: Cruce, indice: string) {
    const i = parseInt(indice, 10);
    c.elegido = (i >= 0 && c.candidatos[i]) ? c.candidatos[i].usuario : null;
    recalcular(c);
    this.version.update(v => v + 1);
  }

  /** Todo lo que se va a escribir: los claros incluidos + las dudas resueltas. */
  aAplicar = computed<Cruce[]>(() => {
    this.version();
    const r = this.resumen();
    if (!r) return [];
    const excl = this.excluidas();
    return [
      ...r.claros.filter(c => !excl.has(c) && c.elegido),
      ...r.dudas.filter(c => !excl.has(c) && c.elegido),
    ];
  });

  /** Cuántas de las que se van a escribir CAMBIAN un puesto ya capturado. */
  cuantosCambian = computed(() => this.aAplicar().filter(c => c.cambiaPuesto).length);

  /** Cuántas sucursales se llenarían. */
  cuantasSucursales = computed(() =>
    this.llenarSucursales() ? this.aAplicar().filter(c => c.sucursalAllenar).length : 0
  );

  marcarTodos() { this.excluidas.set(new Set()); }

  desmarcarTodos() {
    const r = this.resumen();
    if (!r) return;
    this.excluidas.set(new Set([...r.claros, ...r.dudas]));
  }

  // ── Aplicar ───────────────────────────────────────────────────────────────

  confirmar() {
    const llenar = this.llenarSucursales();
    const cambios: CambioPuesto[] = this.aAplicar()
      .filter(c => c.elegido && c.fila.puestoId)
      .map(c => ({
        usuario: c.elegido,
        puestoId: c.fila.puestoId!,
        cargo: c.puestoNuevo,
        sucursal: llenar ? c.sucursalAllenar : null,
      }));
    this.aplicar.emit(cambios);
  }

  // ── Auxiliares de plantilla ───────────────────────────────────────────────

  nombreApp(c: Cruce): string { return c.elegido?.nombre || '—'; }

  trackCruce(_: number, c: Cruce) { return c.fila.nombre; }
}
