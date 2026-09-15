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
import { ApiService } from '../../../shared/api.service';
import { conTope } from '../../../shared/con-tope.util';
import { cerrarSesionSegura } from '../../../shared/sesion.util';
import { normalizarNombre, esAdminGlobal, esDueno } from '../../../shared/permisos.util';
import {
  PuestoOrganigrama, puestosPorUnidad, UnidadOrganigrama,
} from '../../../shared/organigrama.catalogo';
import { resolverPuesto } from '../../../shared/puesto.util';
import {
  ManualPuesto, TareaManual, manualDePuesto, tareasDePuesto,
  totalTareasAutomaticas, MANUALES_POR_PUESTO,
} from '../../../shared/tareas-manual.catalogo';
import {
  TareaDePuesto, BorradorTarea, AvisoTarea, DiaSemanaManual,
  DIAS_CAPTURABLES, MOMENTOS_CAPTURABLES, FRECUENCIAS_CAPTURABLES,
  ETIQUETA_MOMENTO, declaradasDePuesto, revisarTareaPuesto, puedeGuardarse,
  nuevoIdTareaPuesto, aTareaManual,
} from '../../../shared/tareas-puesto.util';

/** Una fila de la hoja: el puesto con su manual y su gente. */
interface FilaPuesto {
  puesto: PuestoOrganigrama;
  manual: ManualPuesto | null;
  tareas: TareaManual[];
  /** Cuántas se entregan solas (excluye las de solo-evento). */
  automaticas: number;
  /** Personas activas que hoy tienen este puesto. */
  ocupantes: string[];
  /**
   * Las tareas CAPTURADAS para este puesto (Fase 7, paso 7.1a). Van aparte de
   * `tareas` a propósito: en pantalla se distinguen del manual publicado, y
   * quien las lee tiene que poder ver de dónde sale cada obligación.
   */
  propias: TareaDePuesto[];
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
  private api = inject(ApiService);

  isMenuOpen = false;
  currentUser: any = null;

  // ── LA NORMA COMO DATO (Fase 7 · paso 7.1a) ─────────────────────────────
  //
  // Medido el 14/sep: 70 de 89 puestos no tienen manual escrito, 38 de ellos
  // con gente, 104 personas. Esto es donde se les escribe.

  /** Lo capturado, de todos los puestos. Se filtra por puesto al usarlo. */
  declaradas = signal<TareaDePuesto[]>([]);
  cargandoNorma = signal(false);
  errorNorma = signal<string | null>(null);

  /** Listas del catálogo, para los selectores. */
  readonly DIAS = DIAS_CAPTURABLES;
  readonly MOMENTOS = MOMENTOS_CAPTURABLES;
  readonly FRECUENCIAS = FRECUENCIAS_CAPTURABLES;
  readonly ETIQUETA_MOMENTO = ETIQUETA_MOMENTO;

  /**
   * VER NO ES EDITAR, y aquí la distinción pesa más que en la plantilla: lo que
   * se escriba en esta pantalla se convierte en obligaciones diarias para
   * personas reales. Capturar queda en Dirección/dueño, igual que la plantilla.
   *
   * Se comprueba ANTES DE CADA ESCRITURA, no solo en el `*ngIf` del botón:
   * esconder un control es cosmética (lección del 13/sep, tres fugas
   * desplegadas).
   */
  get puedeEditarNorma(): boolean {
    return esAdminGlobal(this.currentUser) || esDueno(this.currentUser);
  }

  /** El puesto cuyo formulario está abierto, y el borrador en curso. */
  capturando = signal<string | null>(null);
  borrador = signal<BorradorTarea | null>(null);
  guardando = signal(false);

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
    this.cargarNorma();
  }

  /**
   * Trae lo capturado. CON TOPE: sin él, una petición que no vuelve deja la
   * pantalla en «Cargando…» para siempre — el «VERIFICANDO...» del 1/sep, que
   * ya se cobró en Pase de lista el 13/sep.
   */
  async cargarNorma() {
    this.cargandoNorma.set(true);
    this.errorNorma.set(null);
    try {
      const r: any = await conTope(
        this.api.get('/api/tareas-puesto'), 20000, 'leer las tareas capturadas');
      this.declaradas.set((r?.items || []).map((t: any) => ({
        ...t,
        items: Array.isArray(t.items) ? t.items : [],
      })));
    } catch (e: any) {
      // Se NOMBRA. Una lista vacía por fallo de red y un puesto sin tareas
      // capturadas se ven idénticos, y confundirlos haría que alguien capture
      // por segunda vez lo que ya existe (§5.2).
      this.errorNorma.set(
        'No se pudieron leer las tareas capturadas, así que esta pantalla puede ' +
        'estar mostrando de menos. ' + (e?.message || ''));
      console.error('[manual-puestos] no se pudo leer /api/tareas-puesto', e);
    } finally {
      this.cargandoNorma.set(false);
    }
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
    const propias = this.declaradas();
    let recibiendo = 0, sinPuesto = 0, sinManual = 0;
    // De los que reciben, cuántos lo hacen por norma CAPTURADA y no publicada.
    // Se cuenta aparte porque es el número que dice si este paso está sirviendo
    // para algo: arranca en 0 y sube conforme Dirección escribe.
    let porCaptura = 0;
    for (const u of act) {
      const id = resolverPuesto(u).puestoId;
      if (!id) { sinPuesto++; continue; }
      const publicada = tareasDePuesto(id).some(t => !t.soloPorEvento);
      const capturada = declaradasDePuesto(id, propias).length > 0;
      if (publicada || capturada) {
        recibiendo++;
        if (!publicada) porCaptura++;
      } else {
        sinManual++;
      }
    }
    return { total: act.length, recibiendo, sinPuesto, sinManual, porCaptura };
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

    const capturadas = this.declaradas();

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
          propias: declaradasDePuesto(p.id, capturadas),
        };
      }).filter(f => {
        // «Solo con manual» incluye ahora las capturadas: si no, un puesto al
        // que Dirección acaba de escribirle sus tareas desaparecería del filtro
        // justo después de dejar de estar sin norma.
        if (filtrarConManual && !f.manual && !f.propias.length) return false;
        if (!term) return true;
        // Busca en el puesto, el documento y los nombres de las tareas: es lo
        // que alguien teclea cuando anda buscando "cierre" o "caducidades".
        const heno = normalizarNombre([
          f.puesto.nombre,
          f.manual?.documento || '',
          f.manual?.codigo || '',
          ...f.tareas.map(t => t.nombre),
          ...f.propias.map(t => t.nombre),
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

  // ══════════════════════════════════════════════════════════════════════
  //  CAPTURA DE LA NORMA (Fase 7 · paso 7.1a)
  // ══════════════════════════════════════════════════════════════════════

  /** Los problemas del borrador en curso. Vacío = se puede guardar. */
  avisos = computed<AvisoTarea[]>(() => {
    const b = this.borrador();
    if (!b) return [];
    return revisarTareaPuesto(b, this.declaradas());
  });

  /** ¿El borrador de ahora se puede guardar? */
  get borradorValido(): boolean {
    return !!this.borrador() && puedeGuardarse(this.avisos());
  }

  avisosQueBloquean = computed(() => this.avisos().filter(a => a.nivel === 'bloquea'));
  avisosQueAvisan = computed(() => this.avisos().filter(a => a.nivel === 'avisa'));

  abrirCaptura(puestoId: string) {
    if (!this.puedeEditarNorma) return;
    this.capturando.set(puestoId);
    this.borrador.set({
      puestoId,
      nombre: '',
      momento: 'operacion',
      frecuencia: 'Diaria',
      diaSemana: null,
      diaMes: null,
      horaLimite: '19:00',
      // Arranca en 1.0 y quien captura la sube al publicar una corrección. No
      // se autogenera: la versión es una decisión de quien autoriza el
      // documento, no un contador (§5.4).
      version: '1.0',
      items: [{ texto: '' }],
    });
  }

  cancelarCaptura() {
    this.capturando.set(null);
    this.borrador.set(null);
  }

  estaCapturando(puestoId: string): boolean {
    return this.capturando() === puestoId;
  }

  /** Cambia un campo del borrador sin perder el resto. */
  editarBorrador(campo: keyof BorradorTarea, valor: any) {
    const b = this.borrador();
    if (!b) return;
    const siguiente: BorradorTarea = { ...b, [campo]: valor };
    // Al cambiar de frecuencia se limpia el día que ya no aplica: dejarlo
    // colgado guardaría un «Mensual, los Viernes», que no significa nada.
    if (campo === 'frecuencia') {
      if (valor !== 'Semanal') siguiente.diaSemana = null;
      if (valor !== 'Mensual') siguiente.diaMes = null;
    }
    this.borrador.set(siguiente);
  }

  editarPunto(i: number, texto: string) {
    const b = this.borrador();
    if (!b) return;
    const items = b.items.slice();
    items[i] = { texto };
    this.borrador.set({ ...b, items });
  }

  agregarPunto() {
    const b = this.borrador();
    if (!b) return;
    this.borrador.set({ ...b, items: [...b.items, { texto: '' }] });
  }

  quitarPunto(i: number) {
    const b = this.borrador();
    if (!b) return;
    const items = b.items.filter((_, k) => k !== i);
    this.borrador.set({ ...b, items: items.length ? items : [{ texto: '' }] });
  }

  /**
   * Guarda la tarea capturada.
   *
   * USA `api.post`, NO `api.guardar`. El helper se TRAGA el fallo (registra en
   * consola y vuelve sin lanzar), así que con él la pantalla diría «guardada»
   * aunque el servidor la hubiera rechazado — y aquí el rechazo es justo lo que
   * más importa: el 409 del candado anti-duplicado y el índice único de la
   * tabla. Quien captura se iría convencido y la tarea no existiría. Es el
   * defecto #1 del 14/sep, cobrado en otra pantalla.
   */
  async guardarTarea() {
    // Se comprueba aquí, no solo en el *ngIf del botón.
    if (!this.puedeEditarNorma) return;
    const b = this.borrador();
    if (!b || !this.borradorValido || this.guardando()) return;

    this.guardando.set(true);
    this.errorNorma.set(null);
    try {
      const id = nuevoIdTareaPuesto(
        b.puestoId, b.nombre, this.declaradas().map(t => t.id));
      const fila: TareaDePuesto = {
        id,
        puestoId: b.puestoId,
        nombre: b.nombre.trim(),
        momento: b.momento,
        frecuencia: b.frecuencia,
        diaSemana: b.frecuencia === 'Semanal' ? (b.diaSemana as DiaSemanaManual) : null,
        diaMes: b.frecuencia === 'Mensual' ? Number(b.diaMes) : null,
        horaLimite: b.horaLimite,
        version: b.version.trim(),
        documento: 'Capturado en MDTask',
        vigente: true,
        creadoEn: Date.now(),
        creadoPor: this.currentUser?.nombre || this.currentUser?.correo || '(sin nombre)',
        items: b.items
          .map(i => ({ texto: (i.texto || '').trim() }))
          .filter(i => i.texto),
      };
      await conTope(this.api.post('/api/tareas-puesto', fila), 20000, 'guardar la tarea');
      this.declaradas.update(lista => [...lista, fila]);
      this.cancelarCaptura();
    } catch (e: any) {
      this.errorNorma.set('No se guardó: ' + (e?.message || 'error desconocido'));
      console.error('[manual-puestos] no se pudo guardar la tarea', e);
    } finally {
      this.guardando.set(false);
    }
  }

  /**
   * Retira una tarea capturada. NO la borra (§5.5): los checklists ya emitidos
   * tienen que seguir teniendo a qué tarea apuntar, y en diciembre «¿por qué
   * este puesto dejó de tener esta tarea?» tiene que seguir teniendo respuesta.
   */
  async retirarTarea(t: TareaDePuesto) {
    if (!this.puedeEditarNorma || this.guardando()) return;
    const motivo = (prompt(
      `Retirar «${t.nombre}».\n\n` +
      'No se borra: deja de entregarse y su historia queda. ¿Por qué se retira?') || '').trim();
    if (!motivo) return;   // Sin motivo no se retira: en dos meses nadie sabría por qué.

    this.guardando.set(true);
    this.errorNorma.set(null);
    try {
      await conTope(
        this.api.patch('/api/tareas-puesto', { id: t.id, vigente: false, motivo }),
        20000, 'retirar la tarea');
      this.declaradas.update(lista =>
        lista.map(x => (x.id === t.id ? { ...x, vigente: false, motivo } : x)));
    } catch (e: any) {
      this.errorNorma.set('No se retiró: ' + (e?.message || 'error desconocido'));
      console.error('[manual-puestos] no se pudo retirar la tarea', e);
    } finally {
      this.guardando.set(false);
    }
  }

  /**
   * Sin esto, cada tecla reemplaza el arreglo de puntos, el *ngFor recrea los
   * inputs y el foco se pierde: habría que volver a hacer clic para escribir la
   * segunda letra. Por índice porque los puntos no tienen id propio todavía.
   */
  trackPorIndice(i: number): number { return i; }

  /** Etiqueta de periodicidad de una tarea capturada (reusa la del manual). */
  textoFrecuenciaPropia(t: TareaDePuesto): string {
    return this.textoFrecuencia(aTareaManual(t));
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
