import { Component, signal, OnInit, OnDestroy, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, onSnapshot, doc, setDoc, deleteDoc, getDocs, query, where } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { RutinasNavComponent } from '../../../shared/rutinas-nav/rutinas-nav';
import {
  RutinaMaestra,
  TareaRutinaMaestra,
  TipoRutina,
  FrecuenciaRutina,
  NivelCritico,
  ROLES_RUTINA,
  ETIQUETAS_TIPO,
  ETIQUETAS_NIVEL,
  ETIQUETAS_FRECUENCIA
} from '../../../shared/rutinas.types';
import { PLANTILLAS_BASE, PlantillaRutina } from '../../../shared/plantillas-rutinas';
import { normalizarNombre } from '../../../shared/permisos.util';

@Component({
  selector: 'app-rutinas-catalogo',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent, RutinasNavComponent],
  templateUrl: './rutinas-catalogo.html',
  styleUrls: ['./rutinas-catalogo.css']
})
export class RutinasCatalogoComponent implements OnInit, OnDestroy {
  // -------- Estado UI --------
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  currentUser: any = null;

  // -------- Datos --------
  rutinas = signal<RutinaMaestra[]>([]);

  // Filtros
  terminoBusqueda = '';
  tipoFiltro: TipoRutina | 'todos' = 'todos';
  mostrarArchivadas = false;

  // Modal detalle
  rutinaDetalle = signal<RutinaMaestra | null>(null);
  isModalDetalleOpen = false;

  // -------- Plantillas base --------
  readonly plantillas = PLANTILLAS_BASE;
  isPlantillasOpen = false;
  activandoPlantilla = '';
  abrirPlantillas() { this.isPlantillasOpen = true; }
  cerrarPlantillas() { this.isPlantillasOpen = false; }

  /** Set de nombres de rutinas ya en el catálogo (activas), normalizados. */
  private nombresEnCatalogo(): Set<string> {
    return new Set(this.rutinas().filter(r => r.activa !== false).map(r => normalizarNombre(r.nombre)));
  }
  /** ¿Esta rutina de plantilla ya existe en el catálogo? */
  rutinaYaExiste(nombre: string): boolean {
    return this.nombresEnCatalogo().has(normalizarNombre(nombre));
  }
  /** Cuántas rutinas de la plantilla faltan por activar. */
  faltantesDePlantilla(p: PlantillaRutina): number {
    const ya = this.nombresEnCatalogo();
    return p.rutinas.filter(r => !ya.has(normalizarNombre(r.nombre))).length;
  }

  /** Activa una plantilla: copia al catálogo las rutinas que aún no existen. */
  async activarPlantilla(p: PlantillaRutina) {
    const ya = this.nombresEnCatalogo();
    const nuevas = p.rutinas.filter(r => !ya.has(normalizarNombre(r.nombre)));
    if (nuevas.length === 0) {
      Swal.fire('Ya está activada', 'Todas las rutinas de esta plantilla ya están en tu catálogo.', 'info');
      return;
    }
    const res = await Swal.fire({
      title: `Activar "${p.nombre}"`,
      html: `Se agregarán <strong>${nuevas.length}</strong> rutina(s) al catálogo:` +
        `<ul style="text-align:left;margin:12px auto;max-width:280px;padding-left:20px;">` +
        nuevas.map(r => `<li>${r.nombre}</li>`).join('') + `</ul>`,
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Sí, activar', cancelButtonText: 'Cancelar', confirmButtonColor: '#0F172A'
    });
    if (!res.isConfirmed) return;

    this.activandoPlantilla = p.id;
    const yo = this.currentUser?.nombre || this.currentUser?.usuario || 'desconocido';
    try {
      let i = 0;
      for (const r of nuevas) {
        const ahora = Date.now() + (i++);
        const id = 'rutina_' + ahora;
        const payload: any = {
          ...r, id, activa: true, creadoPor: yo, creadoEn: ahora
        };
        await setDoc(doc(this.firestore, 'catalogo_rutinas', id), payload);
      }
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 2800,
        icon: 'success', title: `${nuevas.length} rutina(s) agregadas al catálogo`
      });
    } catch (e: any) {
      console.error('Error activando plantilla:', e);
      Swal.fire('Error', e.message || 'No se pudo activar la plantilla.', 'error');
    } finally {
      this.activandoPlantilla = '';
    }
  }

  // -------- Wizard de creación / edición --------
  isWizardOpen = false;
  wizardStep = 1;
  readonly wizardTotalSteps = 5;
  isGuardando = false;

  // Si editandoId !== '', es edición; si es '', es creación.
  editandoId = '';

  // Form (todos los campos del wizard)
  formNombre = '';
  formTipo: TipoRutina = 'operacion';
  formDescripcion = '';
  formFrecuencia: FrecuenciaRutina = 'Diaria';
  formDiaSemana = 'Lunes';
  formDiaMes = 1;
  formHoraInicio = '';
  formHoraLimite = '';
  formResponsable: string = 'Encargado';
  formNivelCritico: NivelCritico = 'importante';
  formTareas: TareaRutinaMaestra[] = [];
  nuevaTareaTexto = '';

  // Constantes accesibles desde el HTML
  readonly tipos: TipoRutina[] = ['apertura', 'cierre', 'administracion', 'contabilidad', 'operacion'];
  readonly frecuencias: FrecuenciaRutina[] = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral', 'PorEvento'];
  readonly nivelesCriticos: NivelCritico[] = ['obligatorio', 'importante', 'informativo'];
  readonly roles = ROLES_RUTINA;
  readonly diasSemana = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  readonly diasDelMes = Array.from({ length: 31 }, (_, i) => i + 1);
  readonly etiquetasTipo = ETIQUETAS_TIPO;
  readonly etiquetasNivel = ETIQUETAS_NIVEL;
  readonly etiquetasFrecuencia = ETIQUETAS_FRECUENCIA;

  private firestore = inject(Firestore);
  private router = inject(Router);
  private radarRutinas: (() => void) | null = null;

  // ============================================================================
  // CICLO DE VIDA
  // ============================================================================
  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) this.currentUser = JSON.parse(sesion);
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeCrearRutinas) {
      this.router.navigate(['/home']);
      return;
    }
    this.conectarConLaNube();
  }

  ngOnDestroy() {
    if (this.radarRutinas) { this.radarRutinas(); this.radarRutinas = null; }
  }

  conectarConLaNube() {
    const ref = collection(this.firestore, 'catalogo_rutinas');
    this.radarRutinas = onSnapshot(ref, snap => {
      const arr: RutinaMaestra[] = [];
      snap.forEach(d => arr.push({ ...(d.data() as any), id: d.id }));
      arr.sort((a, b) => a.nombre.localeCompare(b.nombre));
      this.rutinas.set(arr);
    });
  }

  // ============================================================================
  // FILTRADO
  // ============================================================================
  rutinasFiltradas = computed(() => {
    let lista = this.rutinas();
    // Estado activa/archivada
    lista = lista.filter(r => this.mostrarArchivadas ? !r.activa : r.activa);
    // Tipo
    if (this.tipoFiltro !== 'todos') {
      lista = lista.filter(r => r.tipo === this.tipoFiltro);
    }
    // Búsqueda
    const t = this.terminoBusqueda.toLowerCase().trim();
    if (t) {
      lista = lista.filter(r =>
        r.nombre.toLowerCase().includes(t) ||
        (r.descripcion || '').toLowerCase().includes(t)
      );
    }
    return lista;
  });

  /** Rutinas agrupadas por departamento (tipo), para el acordeón del catálogo. */
  rutinasPorDepartamento = computed(() => {
    const orden: TipoRutina[] = ['apertura', 'operacion', 'cierre', 'administracion', 'contabilidad'];
    const mapa = new Map<string, RutinaMaestra[]>();
    for (const r of this.rutinasFiltradas()) {
      const k = r.tipo || 'operacion';
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k)!.push(r);
    }
    return orden.filter(t => mapa.has(t)).map(t => ({
      tipo: t,
      etiqueta: this.etiquetasTipo[t],
      rutinas: mapa.get(t)!.sort((a, b) => a.nombre.localeCompare(b.nombre))
    }));
  });

  gruposCatColapsados = new Set<string>();
  toggleGrupoCat(tipo: string) {
    if (this.gruposCatColapsados.has(tipo)) this.gruposCatColapsados.delete(tipo);
    else this.gruposCatColapsados.add(tipo);
  }
  grupoCatColapsado(tipo: string): boolean { return this.gruposCatColapsados.has(tipo); }

  /** ¿La rutina tiene asignación activa? (para el semáforo). Aprox por nombre. */
  iconoSemaforo(r: RutinaMaestra): 'on' | 'off' { return r.activa === false ? 'off' : 'on'; }

  // Recompute manual cuando cambien filtros (signals no reaccionan a primitivos)
  onCambioFiltro() {
    // Forzamos recálculo asignando el mismo signal (truco)
    this.rutinas.set([...this.rutinas()]);
  }

  // ============================================================================
  // ABRIR / CERRAR MODALES
  // ============================================================================
  abrirWizardNueva() {
    this.editandoId = '';
    this.resetForm();
    this.wizardStep = 1;
    this.isWizardOpen = true;
  }

  abrirWizardEditar(r: RutinaMaestra) {
    this.editandoId = r.id;
    this.formNombre = r.nombre;
    this.formTipo = r.tipo;
    this.formDescripcion = r.descripcion || '';
    this.formFrecuencia = r.frecuencia;
    this.formDiaSemana = r.diaSemana || 'Lunes';
    this.formDiaMes = r.diaMes || 1;
    this.formHoraInicio = r.horaInicio || '';
    this.formHoraLimite = r.horaLimite || '';
    this.formResponsable = r.responsableSugerido;
    this.formNivelCritico = r.nivelCritico;
    this.formTareas = JSON.parse(JSON.stringify(r.tareas || []));
    this.wizardStep = 1;
    this.isWizardOpen = true;
  }

  cerrarWizard() {
    this.isWizardOpen = false;
    this.editandoId = '';
  }

  abrirDetalle(r: RutinaMaestra) {
    this.rutinaDetalle.set(r);
    this.isModalDetalleOpen = true;
  }

  cerrarDetalle() {
    this.isModalDetalleOpen = false;
    this.rutinaDetalle.set(null);
  }

  /** Salta a la pantalla de asignaciones con la rutina pre-seleccionada. */
  irAAsignar(rutinaId: string) {
    this.cerrarDetalle();
    this.router.navigate(['/asignaciones-rutinas'], { queryParams: { rutina: rutinaId } });
  }

  resetForm() {
    this.formNombre = '';
    this.formTipo = 'operacion';
    this.formDescripcion = '';
    this.formFrecuencia = 'Diaria';
    this.formDiaSemana = 'Lunes';
    this.formDiaMes = 1;
    this.formHoraInicio = '';
    this.formHoraLimite = '';
    this.formResponsable = 'Encargado';
    this.formNivelCritico = 'importante';
    this.formTareas = [];
    this.nuevaTareaTexto = '';
  }

  // ============================================================================
  // WIZARD: NAVEGACIÓN
  // ============================================================================
  avanzarPaso() {
    if (!this.puedeAvanzar()) return;
    if (this.wizardStep < this.wizardTotalSteps) this.wizardStep++;
  }

  retrocederPaso() {
    if (this.wizardStep > 1) this.wizardStep--;
  }

  irAPaso(p: number) {
    if (p >= 1 && p <= this.wizardTotalSteps) this.wizardStep = p;
  }

  puedeAvanzar(): boolean {
    switch (this.wizardStep) {
      case 1: return !!this.formNombre.trim() && !!this.formTipo;
      case 2: return !!this.formFrecuencia;
      case 3: return this.formTareas.length > 0;
      case 4: return !!this.formResponsable && !!this.formNivelCritico;
      case 5: return true;
      default: return false;
    }
  }

  // ============================================================================
  // EDICIÓN DE TAREAS DENTRO DEL WIZARD
  // ============================================================================
  agregarTarea() {
    const txt = this.nuevaTareaTexto.trim();
    if (!txt) return;
    this.formTareas.push({
      id: 'tarea_' + Date.now() + '_' + this.formTareas.length,
      text: txt,
      requiresPhoto: false,
      requiresAntesDespues: false,
      requiresVariasFotos: false,
      permiteGaleria: false,
      permiteDocumentos: false
    });
    this.nuevaTareaTexto = '';
  }

  eliminarTarea(i: number) {
    this.formTareas.splice(i, 1);
  }

  /** Mutuamente excluyentes: solo un tipo de evidencia visual a la vez. */
  alCambiarEvidencia(t: TareaRutinaMaestra, campo: 'requiresPhoto' | 'requiresAntesDespues' | 'requiresVariasFotos') {
    if (t[campo]) {
      // Apaga los otros dos
      if (campo !== 'requiresPhoto') t.requiresPhoto = false;
      if (campo !== 'requiresAntesDespues') t.requiresAntesDespues = false;
      if (campo !== 'requiresVariasFotos') t.requiresVariasFotos = false;
    }
  }

  // ============================================================================
  // GUARDAR
  // ============================================================================
  async guardar() {
    if (this.isGuardando) return;
    if (!this.puedeAvanzar() && this.wizardStep < this.wizardTotalSteps) return;
    if (!this.formNombre.trim() || this.formTareas.length === 0) {
      Swal.fire('Faltan datos', 'La rutina necesita un nombre y al menos una tarea.', 'warning');
      return;
    }

    this.isGuardando = true;
    const ahora = Date.now();
    const id = this.editandoId || ('rutina_' + ahora);
    const yo = this.currentUser?.nombre || this.currentUser?.usuario || 'desconocido';

    const payload: any = {
      id,
      nombre: this.formNombre.trim(),
      tipo: this.formTipo,
      descripcion: this.formDescripcion.trim(),
      frecuencia: this.formFrecuencia,
      horaInicio: this.formHoraInicio || '',
      horaLimite: this.formHoraLimite || '',
      responsableSugerido: this.formResponsable,
      nivelCritico: this.formNivelCritico,
      tareas: this.formTareas,
      activa: true
    };

    if (this.formFrecuencia === 'Semanal' || this.formFrecuencia === 'Catorcenal') {
      payload.diaSemana = this.formDiaSemana;
    }
    if (this.formFrecuencia === 'Mensual' || this.formFrecuencia === 'Trimestral') {
      payload.diaMes = this.formDiaMes;
    }

    if (this.editandoId) {
      payload.actualizadoPor = yo;
      payload.actualizadoEn = ahora;
    } else {
      payload.creadoPor = yo;
      payload.creadoEn = ahora;
    }

    try {
      await setDoc(doc(this.firestore, 'catalogo_rutinas', id), payload, { merge: true });
      this.cerrarWizard();
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 2500,
        icon: 'success',
        title: this.editandoId ? 'Rutina actualizada ✏️' : 'Rutina creada en el catálogo ✅'
      });
    } catch (e: any) {
      console.error('Error guardando rutina:', e);
      Swal.fire('Error', e.message || 'No se pudo guardar la rutina.', 'error');
    } finally {
      this.isGuardando = false;
    }
  }

  // ============================================================================
  // ACCIONES DE LA TARJETA
  // ============================================================================
  async duplicar(r: RutinaMaestra, event: Event) {
    event.stopPropagation();
    const ahora = Date.now();
    const id = 'rutina_' + ahora;
    const yo = this.currentUser?.nombre || this.currentUser?.usuario || 'desconocido';
    const copia: any = {
      ...r,
      id,
      nombre: r.nombre + ' (copia)',
      creadoPor: yo,
      creadoEn: ahora,
      actualizadoPor: undefined,
      actualizadoEn: undefined
    };
    try {
      await setDoc(doc(this.firestore, 'catalogo_rutinas', id), copia);
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 2500,
        icon: 'success', title: 'Rutina duplicada'
      });
    } catch (e: any) {
      Swal.fire('Error', e.message || 'No se pudo duplicar.', 'error');
    }
  }

  async archivar(r: RutinaMaestra, event: Event) {
    event.stopPropagation();
    const confirma = await Swal.fire({
      title: '¿Archivar esta rutina?',
      text: `"${r.nombre}" dejará de aparecer en el catálogo activo, pero NO se borrará. Puedes restaurarla después.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, archivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#0F172A'
    });
    if (!confirma.isConfirmed) return;
    try {
      await setDoc(doc(this.firestore, 'catalogo_rutinas', r.id), { activa: false }, { merge: true });
      await this.cancelarChecklistsDeRutina(r.id);
    } catch (e: any) {
      Swal.fire('Error', e.message || 'No se pudo archivar.', 'error');
    }
  }

  async restaurar(r: RutinaMaestra, event: Event) {
    event.stopPropagation();
    try {
      await setDoc(doc(this.firestore, 'catalogo_rutinas', r.id), { activa: true }, { merge: true });
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 2000,
        icon: 'success', title: 'Rutina restaurada'
      });
    } catch (e: any) {
      Swal.fire('Error', e.message || 'No se pudo restaurar.', 'error');
    }
  }

  async eliminarDefinitivo(r: RutinaMaestra, event: Event) {
    event.stopPropagation();
    const confirma = await Swal.fire({
      title: '¿Eliminar definitivamente?',
      text: `"${r.nombre}" se borrará para siempre. Esta acción no se puede deshacer.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#EF4444'
    });
    if (!confirma.isConfirmed) return;
    try {
      await deleteDoc(doc(this.firestore, 'catalogo_rutinas', r.id));
      await this.cancelarChecklistsDeRutina(r.id);
    } catch (e: any) {
      Swal.fire('Error', e.message || 'No se pudo eliminar.', 'error');
    }
  }

  /**
   * Cancela (marca como eliminados) los checklists pendientes generados por esta
   * rutina del catálogo, para que no queden estancados contando. Respeta los ya
   * enviados (historial).
   */
  private async cancelarChecklistsDeRutina(catalogoRutinaId: string) {
    try {
      const q = query(collection(this.firestore, 'checklists'), where('_catalogoRutinaId', '==', catalogoRutinaId));
      const snap = await getDocs(q);
      const ops: Promise<any>[] = [];
      snap.forEach(d => {
        const c = d.data() as any;
        if (c.enviado === true || c.eliminado === true || c.archivado === true) return;
        ops.push(setDoc(doc(this.firestore, 'checklists', d.id), { eliminado: true }, { merge: true }));
      });
      await Promise.all(ops);
    } catch (e) {
      console.error('[cancelarChecklistsDeRutina]', e);
    }
  }

  trackById(_i: number, r: RutinaMaestra) { return r.id; }
}
