/**
 * 🧩 PLANTILLA DE SUCURSAL — lo que debe haber contra lo que hay
 *
 * Paso 3.1b. Instrucción de David (13/sep/2026): «cada sucursal va a tener su
 * propia plantilla de cómo debería estar acomodada su zona de trabajo».
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUIÉN VE QUÉ, Y QUIÉN PUEDE GUARDAR — son dos preguntas distintas
 * ═══════════════════════════════════════════════════════════════════════════
 * Es la lección del 3/sep y del 11/sep, que en este proyecto ya costó tres
 * fugas de privilegio desplegadas: gatear la pantalla no basta, hay que gatear
 * lo que se ve DENTRO y lo que se puede TOCAR.
 *
 *   · VER   — quien es jefatura entra. La lista de sucursales se recorta con
 *             `sucursalesPermitidas()`, que es la misma función que usa el
 *             resto de la app. Una Encargada ve la suya y nada más.
 *   · EDITAR — solo `esAdminGlobal`. Dirección captura la plantilla; el resto
 *             la lee. Un renglón que no se puede guardar se muestra como texto,
 *             no como un campo que al tocarlo no hace nada.
 *
 * La segunda regla NO se apoya en esconder el botón: `puedeEditar` se comprueba
 * también antes de cada escritura. Esconder un control es cosmética; la
 * comprobación es la que cuenta.
 *
 * ─── LO QUE ESTA PANTALLA NO DECIDE ───────────────────────────────────────
 * No crea plazas ni toca `mdtask_plazas`. La plantilla es la AUTORIZACIÓN; de
 * ella se generarán las plazas numeradas en el paso siguiente. Y no toca el
 * acceso de nadie: el «entrar como Anaquelista 1» es el paso 3, y necesita
 * antes el pase de lista, para que cada evidencia siga teniendo un nombre
 * detrás (§4: la identidad sale de la cobertura).
 */
import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../../shared/api.service';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import { resolverPuesto } from '../../../shared/puesto.util';
import { PUESTOS_ORGANIGRAMA } from '../../../shared/organigrama.catalogo';
import {
  compararPlantilla, resumenPlantilla, revisarDeclaracion, idDeclarado,
  declaracionVigente, RenglonComparado, ResumenPlantilla,
  PuestoDeclarado, RenglonPlantilla, ProblemaDeclaracion,
} from '../../../shared/plantilla.util';
import { planDePlazas, PlanDePlazas, Plaza } from '../../../shared/cobertura.util';

/** Hoy en 'YYYY-MM-DD', hora local. */
function hoyISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

@Component({
  selector: 'app-plantilla',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './plantilla.html',
  styleUrls: ['./plantilla.css'],
})
export class PlantillaComponent implements OnInit {
  private api = inject(ApiService);

  currentUser: any = null;
  cargando = signal(true);
  error = signal<string | null>(null);
  guardando = signal(false);

  usuarios = signal<any[]>([]);
  plantillas = signal<any[]>([]);
  declarados = signal<PuestoDeclarado[]>([]);
  plazas = signal<Plaza[]>([]);
  sucursal = signal<string>('');

  /** Solo Dirección captura. Ver la cabecera. */
  puedeEditar = false;

  // ── Formulario de renglón nuevo ──────────────────────────────────────────
  nuevoPuestoId = signal<string>('');
  nuevaCantidad = signal<number>(1);

  // ── Formulario de puesto declarado ("de temporada") ──────────────────────
  declarando = signal(false);
  decNombre = signal('');
  decHasta = signal('');
  decMotivo = signal('');

  ngOnInit() {
    // La clave es 'md_sesion_actual'. Ver el comentario de productividad.ts:
    // con 'currentUser' queda en null y la pantalla se comporta como si nadie
    // hubiera entrado, sin un solo error en consola.
    const sesion = localStorage.getItem('md_sesion_actual');
    try { this.currentUser = sesion ? JSON.parse(sesion) : null; } catch { this.currentUser = null; }
    this.puedeEditar = esAdminGlobal(this.currentUser);
    this.cargar();
  }

  private async cargar() {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [us, pl, de, pz] = await Promise.all([
        this.api.get('/api/usuarios'),
        this.api.get('/api/plantillas'),
        this.api.get('/api/puestos-declarados'),
        this.api.get('/api/plazas'),
      ]);
      this.usuarios.set(us?.items || us || []);
      this.plantillas.set(pl?.items || pl || []);
      this.declarados.set((de?.items || de || []) as PuestoDeclarado[]);
      this.plazas.set((pz?.items || pz || []) as Plaza[]);

      const dispo = this.sucursales();
      if (dispo.length && !this.sucursal()) this.sucursal.set(dispo[0]);
    } catch (e: any) {
      // «No pude leer» y «no hay nada» se ven idénticos si esto se traga
      // (§8.11 a). Por eso el error se muestra y la tabla no se pinta vacía.
      this.error.set(e?.message || 'No se pudieron cargar los datos.');
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Las sucursales que este usuario puede mirar.
   *
   * `sucursalesPermitidas` devuelve null cuando no hay techo declarado (un
   * admin global). En ese caso la lista sale de los datos, no de una lista
   * escrita a mano aquí: una lista local se queda atrás el día que abra una
   * sucursal nueva, y esa sucursal desaparecería de la pantalla sin ruido.
   */
  sucursales = computed<string[]>(() => {
    const permitidas = sucursalesPermitidas(this.currentUser);
    const vistas = new Set<string>();
    for (const u of this.usuarios()) {
      for (const s of (u?.datos?.sucursales || u?.sucursales || [])) {
        const n = String(s || '').trim();
        if (n) vistas.add(n);
      }
    }
    for (const p of this.plantillas()) {
      const n = String(p?.sucursal || '').trim();
      if (n) vistas.add(n);
    }
    const todas = [...vistas].sort((a, b) => a.localeCompare(b));
    if (!permitidas) return todas;
    const set = new Set(permitidas.map(s => s.trim()));
    return todas.filter(s => set.has(s));
  });

  /** Puestos declarados que siguen vigentes hoy. */
  declaradosVigentes = computed<PuestoDeclarado[]>(() =>
    this.declarados().filter(d => declaracionVigente(d, hoyISO())));

  /**
   * El censo de la sucursal elegida: cuántas personas hay por puesto.
   *
   * El puesto sale de `resolverPuesto()`, que es la función real y la única —
   * incluye el camino por `aliasCargos`, que es como funcionan hoy muchas
   * fichas. Contar aquí mirando solo `datos.puestoId` dejaría fuera a esas
   * personas EN SILENCIO y la sucursal parecería tener menos gente de la que
   * tiene (§8.11 d).
   */
  censo = computed<Map<string, number>>(() => {
    const suc = this.sucursal();
    const m = new Map<string, number>();
    if (!suc) return m;
    for (const u of this.usuarios()) {
      if (u?.activo === false) continue;
      const suyas = (u?.datos?.sucursales || u?.sucursales || [])
        .map((s: any) => String(s || '').trim());
      if (!suyas.includes(suc)) continue;
      const r = resolverPuesto(u);
      if (!r.puestoId) continue;   // sin puesto: se cuenta aparte, ver `sinPuesto`
      m.set(r.puestoId, (m.get(r.puestoId) || 0) + 1);
    }
    return m;
  });

  /**
   * Gente de esta sucursal a la que no se le pudo resolver el puesto.
   *
   * Se muestra SIEMPRE, aunque sea cero. Son personas que existen y que la
   * comparación no puede colocar en ningún renglón: si se omitieran, los
   * totales cuadrarían y esas personas desaparecerían de la pantalla, que es
   * justo lo que el hallazgo 1 produce.
   */
  sinPuesto = computed<any[]>(() => {
    const suc = this.sucursal();
    if (!suc) return [];
    return this.usuarios().filter(u => {
      if (u?.activo === false) return false;
      const suyas = (u?.datos?.sucursales || u?.sucursales || [])
        .map((s: any) => String(s || '').trim());
      if (!suyas.includes(suc)) return false;
      return !resolverPuesto(u).puestoId;
    });
  });

  /** Los renglones de la plantilla de la sucursal elegida. */
  renglones = computed<RenglonPlantilla[]>(() => {
    const suc = this.sucursal();
    return this.plantillas()
      .filter(p => String(p?.sucursal || '').trim() === suc && p?.vigente !== false)
      .map(p => ({ puestoId: p.puestoId, cantidad: Number(p.cantidad) || 0, vigente: true }));
  });

  comparado = computed<RenglonComparado[]>(() =>
    compararPlantilla(this.renglones(), this.censo(), this.declaradosVigentes()));

  resumen = computed<ResumenPlantilla>(() => resumenPlantilla(this.comparado()));

  /** Puestos que todavía no están en la plantilla de esta sucursal. */
  puestosDisponibles = computed(() => {
    const ya = new Set(this.renglones().map(r => r.puestoId));
    const delCatalogo = PUESTOS_ORGANIGRAMA.map(p => ({ id: p.id, nombre: p.nombre }));
    const declarados = this.declaradosVigentes().map(d => ({ id: d.id, nombre: d.nombre + ' (temporada)' }));
    return [...delCatalogo, ...declarados]
      .filter(p => !ya.has(p.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  // ── De la plantilla a las plazas ─────────────────────────────────────────

  /**
   * Qué plazas faltan para que esta sucursal cuadre con su plantilla.
   *
   * Se calcula SIEMPRE, se aplique o no: ver «faltan 4 plazas por crear» es la
   * mitad del valor de la pantalla, aunque quien mira no pueda crearlas.
   */
  plan = computed<PlanDePlazas>(() =>
    planDePlazas(this.sucursal(), this.renglones(), this.plazas()));

  /** Las plazas vigentes de esta sucursal, para poder decir cuántas hay ya. */
  plazasDeLaSucursal = computed<Plaza[]>(() =>
    this.plazas().filter(p => p?.lugar === this.sucursal() && p?.vigente !== false));

  /**
   * Crea las plazas que faltan. NO retira las que sobran: el plan las reporta
   * y la decisión es de quien mira, porque puede haber una persona dentro.
   * Automatizar el retiro dejaría a alguien sin sitio sin que nadie lo
   * decidiera (§8.5 aplicado a una acción destructiva).
   */
  async generarPlazas() {
    if (!this.puedeEditar) return;
    const aCrear = this.plan().crear;
    if (!aCrear.length) return;
    this.guardando.set(true);
    try {
      for (const p of aCrear) {
        await this.api.guardar('/api/plazas', {
          id: p.id, puestoId: p.puestoId, lugar: p.lugar, numero: p.numero,
          vigente: true, creadaEn: Date.now(),
          creadaPor: this.currentUser?.nombre || this.currentUser?.usuario || '',
        });
      }
      await this.cargar();
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudieron crear las plazas.');
    } finally { this.guardando.set(false); }
  }

  // ── Escrituras ───────────────────────────────────────────────────────────

  /** La fila de `mdtask_plantillas` de un puesto en la sucursal elegida. */
  private filaDe(puestoId: string): any | null {
    const suc = this.sucursal();
    return this.plantillas().find(p =>
      String(p?.sucursal || '').trim() === suc && p?.puestoId === puestoId && p?.vigente !== false) || null;
  }

  async agregarRenglon() {
    // La comprobación va aquí, no solo en el `*ngIf` del botón: esconder un
    // control es cosmética.
    if (!this.puedeEditar || !this.sucursal() || !this.nuevoPuestoId()) return;
    const cant = Math.max(0, Math.trunc(Number(this.nuevaCantidad()) || 0));
    await this.escribir({
      id: `${this.sucursal()}|${this.nuevoPuestoId()}|${Date.now()}`,
      sucursal: this.sucursal(),
      puestoId: this.nuevoPuestoId(),
      cantidad: cant,
      vigente: true,
      creadoEn: Date.now(),
      creadoPor: this.currentUser?.nombre || this.currentUser?.usuario || '',
    });
    this.nuevoPuestoId.set('');
    this.nuevaCantidad.set(1);
  }

  async cambiarCantidad(puestoId: string, valor: any) {
    if (!this.puedeEditar) return;
    const cant = Math.max(0, Math.trunc(Number(valor) || 0));
    const fila = this.filaDe(puestoId);
    if (!fila) return;
    this.guardando.set(true);
    try {
      await this.api.parchar('/api/plantillas', fila.id, { cantidad: cant });
      await this.cargar();
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo guardar.');
    } finally { this.guardando.set(false); }
  }

  /**
   * Retirar un renglón NO lo borra: lo marca `vigente = false` (§5.5). Así, en
   * diciembre, la pregunta «¿por qué esta sucursal pasó de cinco a cuatro?»
   * sigue teniendo respuesta, con su autor y su fecha.
   */
  async retirarRenglon(puestoId: string) {
    if (!this.puedeEditar) return;
    const fila = this.filaDe(puestoId);
    if (!fila) return;
    this.guardando.set(true);
    try {
      await this.api.parchar('/api/plantillas', fila.id, { vigente: false });
      await this.cargar();
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo retirar.');
    } finally { this.guardando.set(false); }
  }

  private async escribir(obj: any) {
    this.guardando.set(true);
    try {
      await this.api.guardar('/api/plantillas', obj);
      await this.cargar();
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo guardar.');
    } finally { this.guardando.set(false); }
  }

  // ── Declarar un puesto de temporada ──────────────────────────────────────

  problemasDeclaracion = computed<ProblemaDeclaracion[]>(() =>
    revisarDeclaracion(this.decNombre(), this.decHasta()));

  bloqueaDeclaracion = computed(() =>
    this.problemasDeclaracion().some(p => p.gravedad === 'bloquea'));

  async declararPuesto() {
    if (!this.puedeEditar || this.bloqueaDeclaracion()) return;
    const id = idDeclarado(this.decNombre());
    this.guardando.set(true);
    try {
      await this.api.guardar('/api/puestos-declarados', {
        id,
        nombre: this.decNombre().trim(),
        tipo: 'temporada',
        desde: hoyISO(),
        hasta: this.decHasta(),
        vigente: true,
        creadoEn: Date.now(),
        creadoPor: this.currentUser?.nombre || this.currentUser?.usuario || '',
        motivo: this.decMotivo().trim(),
      });
      this.decNombre.set('');
      this.decHasta.set('');
      this.decMotivo.set('');
      this.declarando.set(false);
      await this.cargar();
      // Queda declarado pero NO en la plantilla: agregarlo es un segundo acto
      // deliberado. Declarar un puesto y autorizar plazas de él son dos
      // decisiones distintas.
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo declarar el puesto.');
    } finally { this.guardando.set(false); }
  }

  // ── Ayudas de plantilla ──────────────────────────────────────────────────
  claseEstado(e: string): string { return 'pl-' + e; }

  textoEstado(r: RenglonComparado): string {
    switch (r.estado) {
      case 'vacante':       return `faltan ${r.vacantes}`;
      case 'excedente':     return `sobra${r.excedente === 1 ? '' : 'n'} ${r.excedente}`;
      case 'cuadra':        return 'completo';
      // NO dice "sobran": nadie ha autorizado un número todavía.
      case 'sin_plantilla': return 'sin plantilla';
    }
  }

  /**
   * Los primeros nombres sin puesto, para poder ir a buscarlos. Se topan en
   * seis y se dice cuántos faltan: una lista de treinta nombres no se lee, y
   * esconder el resto en silencio dejaría creer que son solo seis.
   */
  nombresSinPuesto(): string {
    const todos = this.sinPuesto().map(u => String(u?.nombre || u?.usuario || '(sin nombre)'));
    const seis = todos.slice(0, 6).join(' · ');
    return todos.length > 6 ? `${seis} y ${todos.length - 6} más` : seis;
  }

  trackPuesto = (_: number, r: RenglonComparado) => r.puestoId;
}
