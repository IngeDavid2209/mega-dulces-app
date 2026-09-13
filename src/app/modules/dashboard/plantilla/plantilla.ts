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
import { sucursalesElegibles } from '../../../shared/sucursales-elegibles.util';
import { conTope, mensajeDeFallo } from '../../../shared/con-tope.util';
import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import { esJefatura } from '../../../shared/alcance.util';
import { resolverPuesto } from '../../../shared/puesto.util';
import { PUESTOS_ORGANIGRAMA } from '../../../shared/organigrama.catalogo';
import {
  compararPlantilla, resumenPlantilla, revisarDeclaracion, idDeclarado,
  declaracionVigente, RenglonComparado, ResumenPlantilla,
  PuestoDeclarado, RenglonPlantilla, ProblemaDeclaracion,
} from '../../../shared/plantilla.util';
import { planDePlazas, PlanDePlazas, Plaza, nombrePlaza } from '../../../shared/cobertura.util';
import { generarCodigos } from '../../../shared/codigo-plaza.util';
import { nombrePuesto } from '../../../shared/organigrama.catalogo';

/** Una credencial tal como la devuelve `/api/credenciales-plaza` (sin PIN). */
interface Credencial {
  id: string; plazaId: string; codigo: string; activa: boolean;
  creadaEn: number | null; ultimoAcceso: number | null;
}

/** Lo que se muestra UNA vez tras generar. El PIN no vuelve a existir. */
interface PinRecienCreado { plazaId: string; codigo: string; pin: string; etiqueta: string; }

/** Hoy en 'YYYY-MM-DD', hora local. */
function hoyISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

@Component({
  selector: 'app-plantilla',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './plantilla.html',
  styleUrls: ['./plantilla.css'],
})
export class PlantillaComponent implements OnInit {
  private api = inject(ApiService);

  currentUser: any = null;

  /** El cajon del menu en movil. Lo monta esta pantalla desde que dejo
   *  de ser pestaña de /control. */
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  cargando = signal(true);
  error = signal<string | null>(null);
  guardando = signal(false);
  aviso = signal<string | null>(null);

  usuarios = signal<any[]>([]);
  plantillas = signal<any[]>([]);
  declarados = signal<PuestoDeclarado[]>([]);
  plazas = signal<Plaza[]>([]);
  sucursal = signal<string>('');

  /**
   * ¿Puede REPARTIR ACCESOS? Solo Dirección, y esto NO se relaja.
   *
   * Generar un código y un PIN es entregar la llave de una plaza. La plantilla
   * se abrió (ver abajo); los accesos no, porque una cosa es proponer cuánta
   * gente debe haber y otra muy distinta es crear credenciales.
   */
  esAdmin = false;

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
    this.esAdmin = esAdminGlobal(this.currentUser);
    this.cargar();
  }

  private async cargar() {
    this.cargando.set(true);
    this.error.set(null);
    try {
      // CON TOPE, y con el nombre del paso. Sin el, una de estas cuatro que no
      // vuelva deja la pantalla en «Cargando...» PARA SIEMPRE, sin un solo
      // error visible — que es exactamente lo que paso el 13/sep y lo que el
      // 1/sep costo cinco horas en el login.
      const [us, pl, de, pz] = await Promise.all([
        conTope(this.api.get('/api/usuarios'), 20000, 'leer las personas'),
        conTope(this.api.get('/api/plantillas'), 20000, 'leer la plantilla'),
        conTope(this.api.get('/api/puestos-declarados'), 20000, 'leer los puestos declarados'),
        conTope(this.api.get('/api/plazas'), 20000, 'leer las plazas'),
      ]);
      this.usuarios.set(us?.items || us || []);
      this.plantillas.set(pl?.items || pl || []);
      this.declarados.set((de?.items || de || []) as PuestoDeclarado[]);
      this.plazas.set((pz?.items || pz || []) as Plaza[]);
      // Las credenciales van aparte: quien no es admin recibe 403 y no debe
      // hacer fallar la carga de toda la pantalla por eso.
      await this.cargarCredenciales();

      const dispo = this.sucursales();
      if (dispo.length && !this.sucursal()) this.sucursal.set(dispo[0]);
    } catch (e: any) {
      // «No pude leer» y «no hay nada» se ven idénticos si esto se traga
      // (§8.11 a). Por eso el error se muestra y la tabla no se pinta vacía.
      this.error.set(mensajeDeFallo(e));
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Las sucursales que se pueden elegir.
   *
   * La regla vive en `sucursales-elegibles.util.ts` y NO se copia aquí: estaba
   * escrita dos veces —esta pantalla y la otra— y el mismo bug del selector
   * vacío se arregló dos veces sin quedar arreglado.
   */
  sucursales = computed<string[]>(() =>
    sucursalesElegibles(this.currentUser, this.plazas(), this.usuarios()));

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

  /**
   * ¿Puede capturar la plantilla de la sucursal elegida?
   *
   * ─── ESTO SE ABRIÓ A PROPÓSITO EL 13/sep/2026 ───────────────────────────
   * Nació como «solo Dirección captura», y David lo cambió con este motivo:
   * «necesito pedirle a RH cómo van a acomodar las plantillas; mientras, déjalo
   * libre — como crea tu plantilla de tu sucursal».
   *
   * O sea: mientras no exista el estándar de RH, cada sucursal propone la suya.
   * Es la decisión correcta para descubrir la realidad: obligar a que Dirección
   * capture 16 plantillas a ciegas habría producido 16 plantillas inventadas.
   *
   * Lo que NO se abrió es repartir accesos (`esAdmin`). Proponer cuánta gente
   * debe haber y crear las llaves de entrada son cosas distintas.
   *
   * Cuando RH entregue el estándar, esto se vuelve a cerrar — y entonces la
   * plantilla capturada por cada sucursal es justo el insumo de esa
   * conversación, no un trabajo perdido.
   */
  puedeEditar = computed<boolean>(() => {
    const suc = this.sucursal();
    if (!suc) return false;
    if (esAdminGlobal(this.currentUser)) return true;
    if (!esJefatura(this.currentUser)) return false;
    // La comprobación se repite aquí aunque el selector ya venga recortado: que
    // una sucursal no salga en un `<select>` no es un permiso.
    const permitidas = sucursalesPermitidas(this.currentUser);
    return !permitidas || permitidas.map(x => x.trim()).includes(suc);
  });

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
    if (!this.puedeEditar()) return;
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

  // ── Accesos: el código y el PIN con el que se entra a la plaza ───────────

  credenciales = signal<Credencial[]>([]);
  /** Los PINs recién creados. Se muestran UNA vez y se van al recargar. */
  pinsNuevos = signal<PinRecienCreado[]>([]);

  credencialDe(plazaId: string): Credencial | null {
    return this.credenciales().find(c => c.plazaId === plazaId && c.activa) || null;
  }

  /** Plazas de esta sucursal que todavía no tienen acceso. */
  plazasSinAcceso = computed<Plaza[]>(() =>
    this.plazasDeLaSucursal().filter(p => !this.credencialDe(p.id)));

  etiquetaPlaza(p: Plaza): string {
    return nombrePlaza(nombrePuesto(p.puestoId) || p.puestoId, p.numero);
  }

  /**
   * Genera el acceso de las plazas que no lo tienen.
   *
   * El CÓDIGO lo calcula aquí `generarCodigos()`, que sabe desempatar los dos
   * surtidores y tiene pruebas; el PIN lo genera el SERVIDOR con
   * `crypto.randomInt`, porque `Math.random` del navegador no es seguro y con
   * la hora de creación los PINs de una sucursal se volverían adivinables.
   *
   * Se le pasan los códigos YA USADOS —incluidos los de credenciales revocadas—
   * para que ninguno se recicle: una hoja impresa vieja no puede acabar
   * abriendo la plaza de otra persona.
   */
  async generarAccesos() {
    if (!this.esAdmin) return;
    const faltan = this.plazasSinAcceso();
    if (!faltan.length) return;

    const usados = new Set(this.credenciales().map(c => c.codigo));
    const codigos = generarCodigos(
      faltan.map(p => ({ id: p.id, lugar: p.lugar, puestoId: p.puestoId, numero: p.numero })),
      usados);

    this.guardando.set(true);
    this.error.set(null);
    try {
      const r = await this.api.post('/api/credenciales-plaza', {
        accion: 'generar',
        plazas: faltan.map(p => ({ plazaId: p.id, codigo: codigos.get(p.id) })),
      });
      const etiquetas = new Map(faltan.map(p => [p.id, this.etiquetaPlaza(p)]));
      this.pinsNuevos.set((r?.creadas || []).map((c: any) => ({
        plazaId: c.plazaId, codigo: c.codigo, pin: c.pin,
        etiqueta: etiquetas.get(c.plazaId) || c.plazaId,
      })));
      // Lo saltado se DICE. Un lote que crea 3 de 5 y calla las otras 2 deja a
      // dos personas sin acceso sin que nadie se entere hasta el primer turno.
      if (r?.saltadas?.length) {
        this.aviso.set(`${r.saltadas.length} plaza(s) no se generaron: ` +
          r.saltadas.map((s: any) => s.motivo).join(' · '));
      }
      await this.cargarCredenciales();
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudieron generar los accesos.');
    } finally { this.guardando.set(false); }
  }

  /** Nuevo PIN para una plaza, conservando su código. */
  async regenerarPin(p: Plaza) {
    if (!this.esAdmin) return;
    this.guardando.set(true);
    try {
      const r = await this.api.post('/api/credenciales-plaza', { accion: 'regenerar', plazaId: p.id });
      this.pinsNuevos.set([{ plazaId: p.id, codigo: r.codigo, pin: r.pin, etiqueta: this.etiquetaPlaza(p) }]);
      await this.cargarCredenciales();
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo regenerar el PIN.');
    } finally { this.guardando.set(false); }
  }

  private async cargarCredenciales() {
    try {
      const r = await this.api.get('/api/credenciales-plaza');
      this.credenciales.set((r?.items || []) as Credencial[]);
    } catch {
      // Silencio a propósito: quien no es admin recibe 403 aquí, y eso no es un
      // error que deba tapar la pantalla — simplemente no ve la sección.
      this.credenciales.set([]);
    }
  }

  imprimirAccesos() { window.print(); }

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
    if (!this.puedeEditar() || !this.sucursal() || !this.nuevoPuestoId()) return;
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
    if (!this.puedeEditar()) return;
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
    if (!this.puedeEditar()) return;
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
    if (!this.puedeEditar() || this.bloqueaDeclaracion()) return;
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
