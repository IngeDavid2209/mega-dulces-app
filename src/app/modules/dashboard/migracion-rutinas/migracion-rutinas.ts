/**
 * 🚚 MIGRACIÓN DE RUTINAS (Fase 5)
 *
 * Lee los `moldes_checklists` legacy y, por cada uno, crea:
 *   - 1 entrada en `catalogo_rutinas` (la plantilla)
 *   - 1 entrada en `asignaciones_rutinas` (a quién/dónde/cuándo)
 *
 * Política conservadora 1↔1:
 *   - Cada molde genera SU PROPIA rutina (con nombre desambiguado por
 *     sucursal + persona) y SU PROPIA asignación. El usuario consolida
 *     después si quiere.
 *
 * Para evitar duplicados en el robot:
 *   - Tras migrar, el molde se marca `_pausadoPorMigracion: true` →
 *     el Robot V1 lo skipea y solo el V2 genera checklists.
 *
 * Reversible:
 *   - Borrando `_pausadoPorMigracion` el molde vuelve a generar.
 *   - Borrando `_migradoA` se permite re-migrarlo.
 */

import { Component, signal, computed, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import {
  Firestore, collection, onSnapshot, doc, setDoc, getDoc
} from '@angular/fire/firestore';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal } from '../../../shared/permisos.util';
import {
  TipoRutina, NivelCritico, FrecuenciaRutina, TareaRutinaMaestra
} from '../../../shared/rutinas.types';

interface MoldeLegacy {
  id: string;
  name: string;
  assigned: string;
  store: string;
  frecuencia: string;
  diaSemana?: string;
  diaMes?: number | null;
  timestampCreacion?: number;
  createdBy?: string;
  items: any[];
  // Marcadores que añade la migración
  _migradoA?: { rutinaId: string; asignacionId: string; migradoEn: number };
  _pausadoPorMigracion?: boolean;
}

@Component({
  selector: 'app-migracion-rutinas',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './migracion-rutinas.html',
  styleUrls: ['./migracion-rutinas.css']
})
export class MigracionRutinasComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  currentUser: any = null;

  moldes = signal<MoldeLegacy[]>([]);
  terminoBusqueda = '';
  filtroEstado: 'todos' | 'pendientes' | 'migrados' = 'pendientes';
  migrando = signal(false);
  ultimaCorrida = signal<{ exitosos: number; saltados: number; errores: number } | null>(null);

  private firestore = inject(Firestore);
  private router = inject(Router);
  private radarMoldes: (() => void) | null = null;

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) this.currentUser = JSON.parse(sesion);
    // SOLO admin global puede ejecutar la migración
    if (!esAdminGlobal(this.currentUser)) {
      this.router.navigate(['/home']);
      return;
    }
    this.conectarConLaNube();
  }

  ngOnDestroy() {
    if (this.radarMoldes) { this.radarMoldes(); this.radarMoldes = null; }
  }

  conectarConLaNube() {
    const refMoldes = collection(this.firestore, 'moldes_checklists');
    this.radarMoldes = onSnapshot(refMoldes, snap => {
      const arr: MoldeLegacy[] = [];
      snap.forEach(d => arr.push({ ...(d.data() as any), id: d.id }));
      arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      this.moldes.set(arr);
    });
  }

  // ============================================================================
  // FILTRADO Y KPIs
  // ============================================================================
  moldesFiltrados = computed<MoldeLegacy[]>(() => {
    let arr = this.moldes();
    if (this.filtroEstado === 'pendientes') arr = arr.filter(m => !m._migradoA);
    else if (this.filtroEstado === 'migrados') arr = arr.filter(m => !!m._migradoA);

    const t = this.terminoBusqueda.toLowerCase().trim();
    if (t) {
      arr = arr.filter(m =>
        (m.name || '').toLowerCase().includes(t) ||
        (m.assigned || '').toLowerCase().includes(t) ||
        (m.store || '').toLowerCase().includes(t)
      );
    }
    return arr;
  });

  kpiTotal = computed(() => this.moldes().length);
  kpiPendientes = computed(() => this.moldes().filter(m => !m._migradoA).length);
  kpiMigrados = computed(() => this.moldes().filter(m => !!m._migradoA).length);
  porcentajeAvance = computed(() => {
    const total = this.kpiTotal();
    if (total === 0) return 0;
    return Math.round((this.kpiMigrados() / total) * 100);
  });

  onCambioFiltro() {
    this.moldes.set([...this.moldes()]);
  }
  trackById(_i: number, m: MoldeLegacy) { return m.id; }

  // ============================================================================
  // MIGRACIÓN
  // ============================================================================
  async migrarUno(molde: MoldeLegacy) {
    if (molde._migradoA) {
      Swal.fire('Ya migrado', 'Este molde ya fue migrado anteriormente.', 'info');
      return;
    }
    const confirma = await Swal.fire({
      title: '¿Migrar este molde?',
      html: `
        <div style="text-align:left">
          <p><strong>${this.escHtml(molde.name)}</strong></p>
          <p>📍 ${this.escHtml(molde.store)} · 👤 ${this.escHtml(molde.assigned)}</p>
          <p>Se creará 1 rutina en el catálogo y 1 asignación. El molde quedará pausado para evitar duplicados.</p>
        </div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, migrar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#0F766E'
    });
    if (!confirma.isConfirmed) return;

    this.migrando.set(true);
    try {
      await this.ejecutarMigracion(molde);
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 2200,
        icon: 'success', title: 'Migrado ✅'
      });
    } catch (e: any) {
      Swal.fire('Error', e?.message || 'No se pudo migrar.', 'error');
    } finally {
      this.migrando.set(false);
    }
  }

  async migrarTodosLosPendientes() {
    const pendientes = this.moldes().filter(m => !m._migradoA);
    if (pendientes.length === 0) {
      Swal.fire('Sin pendientes', 'No hay moldes por migrar.', 'info');
      return;
    }
    const confirma = await Swal.fire({
      title: `¿Migrar ${pendientes.length} moldes?`,
      html: `
        <div style="text-align:left">
          <p>Esta acción:</p>
          <ul>
            <li>Crea <strong>${pendientes.length}</strong> rutinas en el catálogo</li>
            <li>Crea <strong>${pendientes.length}</strong> asignaciones nuevas</li>
            <li>Pausa los moldes legacy para evitar duplicados</li>
          </ul>
          <p style="color:#B45309;"><strong>⚠ Reversible</strong> borrando los campos <code>_migradoA</code> y <code>_pausadoPorMigracion</code> del documento.</p>
        </div>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '🚚 Sí, migrar todo',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#0F766E'
    });
    if (!confirma.isConfirmed) return;

    this.migrando.set(true);
    let exitosos = 0, saltados = 0, errores = 0;

    for (const m of pendientes) {
      try {
        const ok = await this.ejecutarMigracion(m);
        if (ok) exitosos++; else saltados++;
      } catch (e) {
        console.error('[Migración] fallo en molde', m.id, e);
        errores++;
      }
    }

    this.ultimaCorrida.set({ exitosos, saltados, errores });
    this.migrando.set(false);

    Swal.fire({
      icon: errores === 0 ? 'success' : 'warning',
      title: 'Migración terminada',
      html: `
        <div style="text-align:left">
          <p>✅ Migrados: <strong>${exitosos}</strong></p>
          <p>⏭ Saltados: <strong>${saltados}</strong> (ya estaban migrados)</p>
          <p>❌ Errores: <strong>${errores}</strong></p>
        </div>`
    });
  }

  /**
   * Ejecuta la migración de UN molde. Idempotente: si ya está migrado, devuelve false.
   */
  private async ejecutarMigracion(molde: MoldeLegacy): Promise<boolean> {
    if (molde._migradoA) return false;

    const ahora = Date.now();
    const yo = this.currentUser?.nombre || 'Migración';

    const rutinaId = `cat_mig_${molde.id}`;
    const asignacionId = `asig_mig_${molde.id}`;

    // --- Verificar que no exista ya (por si hubo migración previa fallida) ---
    const refRut = doc(this.firestore, 'catalogo_rutinas', rutinaId);
    const refAsig = doc(this.firestore, 'asignaciones_rutinas', asignacionId);
    const [snapRut, snapAsig] = await Promise.all([getDoc(refRut), getDoc(refAsig)]);

    // --- 1. Construir RUTINA MAESTRA ---
    const tareas: TareaRutinaMaestra[] = (molde.items || []).map((it: any, idx: number) => ({
      id: it.id?.toString() || `t_${idx}_${ahora}`,
      text: it.text || `(sin texto ${idx + 1})`,
      requiresPhoto: !!it.requiresPhoto,
      requiresAntesDespues: !!it.requiresAntesDespues,
      requiresVariasFotos: !!it.requiresVariasFotos,
      permiteGaleria: !!it.permiteGaleria,
      permiteDocumentos: !!it.permiteDocumentos,
      tiempoEstimadoMin: typeof it.tiempoEstimado === 'number' ? it.tiempoEstimado : undefined,
      requiereMonto: !!it.requiereMonto,
      requiereFolio: !!it.requiereFolio,
      requiereComentario: !!it.requiereComentario
    }));

    const horaInicio = molde.items?.[0]?.horaInicio || '';
    const horaLimite = molde.items?.[0]?.horaLimite || '';
    const nombreDesambiguado = `${molde.name} — ${molde.store} — ${molde.assigned}`;

    const rutinaMaestra = {
      id: rutinaId,
      nombre: nombreDesambiguado,
      tipo: 'operacion' as TipoRutina,
      descripcion: `Migrado del molde legacy "${molde.id}" el ${new Date(ahora).toLocaleDateString()}.`,
      frecuencia: (molde.frecuencia || 'Diaria') as FrecuenciaRutina,
      diaSemana: molde.diaSemana || undefined,
      diaMes: molde.diaMes ?? undefined,
      horaInicio,
      horaLimite,
      responsableSugerido: 'Encargado',
      nivelCritico: 'importante' as NivelCritico,
      tareas,
      activa: true,
      creadoPor: molde.createdBy || yo,
      creadoEn: molde.timestampCreacion || ahora
    };

    // --- 2. Construir ASIGNACIÓN ---
    const hoyYmd = this.toYmd(new Date());
    const asignacion: any = {
      id: asignacionId,
      catalogoRutinaId: rutinaId,
      nombreRutina: nombreDesambiguado,
      sucursales: [molde.store],
      modoAsignacion: 'porPersonas',
      empleadosNombres: [molde.assigned],
      frecuencia: rutinaMaestra.frecuencia,
      diaSemana: rutinaMaestra.diaSemana,
      diaMes: rutinaMaestra.diaMes,
      horaInicio: rutinaMaestra.horaInicio,
      horaLimite: rutinaMaestra.horaLimite,
      fechaInicio: hoyYmd,
      fechaFin: null,
      activa: true,
      creadoPor: yo,
      creadoEn: ahora
    };

    // Limpieza: Firestore no acepta `undefined`
    this.limpiarUndefined(rutinaMaestra);
    this.limpiarUndefined(asignacion);

    // --- 3. Escribir TODO (solo si no existían ya) ---
    const escrituras: Promise<any>[] = [];
    if (!snapRut.exists()) escrituras.push(setDoc(refRut, rutinaMaestra));
    if (!snapAsig.exists()) escrituras.push(setDoc(refAsig, asignacion));
    await Promise.all(escrituras);

    // --- 4. Marcar el molde como migrado + pausado ---
    await setDoc(doc(this.firestore, 'moldes_checklists', molde.id), {
      _migradoA: { rutinaId, asignacionId, migradoEn: ahora },
      _pausadoPorMigracion: true
    }, { merge: true });

    return true;
  }

  // ============================================================================
  // REVERTIR (botón de "deshacer" individual)
  // ============================================================================
  async revertirMigracion(molde: MoldeLegacy) {
    if (!molde._migradoA) return;
    const confirma = await Swal.fire({
      title: '¿Revertir la migración?',
      html: `
        <div style="text-align:left">
          <p>Esto:</p>
          <ul>
            <li>Elimina la rutina <code>${this.escHtml(molde._migradoA.rutinaId)}</code> del catálogo</li>
            <li>Elimina la asignación <code>${this.escHtml(molde._migradoA.asignacionId)}</code></li>
            <li>Reactiva el molde legacy (Robot V1 lo volverá a usar)</li>
          </ul>
        </div>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, revertir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#EF4444'
    });
    if (!confirma.isConfirmed) return;

    try {
      // Borrar rutina y asignación (las hicimos solo nosotros, así que es seguro)
      const { rutinaId, asignacionId } = molde._migradoA;
      // Importamos deleteDoc on-demand para no inflar el bundle si nunca se usa
      const { deleteDoc } = await import('@angular/fire/firestore');
      await Promise.all([
        deleteDoc(doc(this.firestore, 'catalogo_rutinas', rutinaId)),
        deleteDoc(doc(this.firestore, 'asignaciones_rutinas', asignacionId))
      ]);
      // Limpiar marcas del molde
      await setDoc(doc(this.firestore, 'moldes_checklists', molde.id), {
        _migradoA: null,
        _pausadoPorMigracion: false
      }, { merge: true });
      Swal.fire('Revertido ✅', 'El molde volvió a su estado original.', 'success');
    } catch (e: any) {
      Swal.fire('Error', e?.message || 'No se pudo revertir.', 'error');
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================
  /**
   * Escapa HTML para interpolar datos de usuario dentro de un Swal `html:`.
   * Evita XSS si un nombre de molde/rutina trae algo como `<img onerror=...>`.
   */
  private escHtml(s: any): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private limpiarUndefined(obj: any) {
    Object.keys(obj).forEach(k => {
      if (obj[k] === undefined) delete obj[k];
    });
  }

  private toYmd(d: Date): string {
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
  }

  resumenItemsMolde(m: MoldeLegacy): string {
    const n = m.items?.length || 0;
    return `${n} ${n === 1 ? 'tarea' : 'tareas'}`;
  }

  irACatalogo() { this.router.navigate(['/rutinas']); }
  irAAsignaciones() { this.router.navigate(['/asignaciones-rutinas']); }
}
