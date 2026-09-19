import {
  Component, Input, Output, EventEmitter, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  PUESTOS_ORGANIGRAMA, PuestoOrganigrama, NodoOrganigrama,
  UnidadOrganigrama, ETIQUETAS_UNIDAD, ORDEN_UNIDADES,
  arbolOrganigrama, puestosFueraDelArbol, puestoPorId
} from '../../../shared/organigrama.catalogo';
import {
  DestinoServido, clasificarDestino, esAtribucionCruzada, textoAtribucion
} from '../../../shared/unidad-servida.util';
import { AmbitoVisible, ambitoVisible, puestoPropio } from '../../../shared/rama-visible.util';
import { resolverPuesto } from '../../../shared/puesto.util';
import {
  ManualPuesto, TareaManual, manualDePuesto, tareasAutomaticasDePuesto, tareasDePuesto
} from '../../../shared/tareas-manual.catalogo';
import { normalizarNombre } from '../../../shared/permisos.util';
import {
  ResumenPendientes, resumenPendientes, textoResumen
} from '../../../shared/resumen-pendientes.util';

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
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  4/sep/2026 — POR QUÉ SE REDISEÑÓ LA NAVEGACIÓN DEL ÁRBOL
 * ═══════════════════════════════════════════════════════════════════════════
 * El árbol arrancaba con TODO cerrado, y como el organigrama tiene una sola
 * raíz, eso significaba que la pantalla abría con UNA fila: "Dirección
 * General". Medido sobre el catálogo: 53 de los 89 puestos (el 60%) viven en el
 * nivel 3, así que hacían falta 3 clics para que el puesto apareciera y 3 más
 * —puesto, sucursal, colaborador— para ver su primera tarea. SEIS clics, y
 * siete en el nivel 4.
 *
 * Arrancar cerrado seguía siendo correcto por la razón de siempre (abrirlo
 * entero son cientos de filas y la estructura se vuelve ruido); el error era
 * que la ÚNICA forma de llegar a un dato fuera cavar a mano. Se atacó por
 * cinco lados, en orden de cuánta espera quitan:
 *
 *  1. BUSCADOR QUE SE ABRE SOLO. Escribes un puesto, una sucursal o el nombre
 *     de una persona y el árbol se poda a las ramas que casan y se abre por sí
 *     mismo hasta el resultado, con la cadena de mando a la vista. Cero clics.
 *  2. SIEMBRA POR TRABAJO DEL DÍA. Al entrar se abren las ramas que tienen
 *     entregas hoy, con tope. Entras viendo la operación, no un título.
 *  3. PASILLOS. Una cadena de un solo hijo no es una decisión, es un trámite:
 *     se abre completa de un clic.
 *  4. ABRIR RAMA. Un botón en la fila abierta (y alt+clic) baja el subárbol.
 *  5. GUÍAS DE NIVEL. Líneas verticales en vez de solo sangría: con cinco
 *     niveles a 18px había que contar píxeles para saber de quién cuelga qué.
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
  /**
   * En cuántos lugares MÁS aparece esta misma persona dentro de este puesto.
   *
   * No es adorno: el robot entrega el manual completo UNA VEZ POR CADA entrada
   * de `sucursales[]` de la ficha (`robot-manual.service.ts`, el `for` de la
   * línea 175, con la sucursal metida en el id de idempotencia). Alguien con
   * tres áreas capturadas recibe su manual TRES veces, y su denominador queda
   * ×3. Antes eso se veía como el mismo nombre repetido en tres grupos, sin
   * ninguna pista de por qué. Ahora se nombra.
   */
  enOtrosLugares: number;
}

/** Un grupo de LUGAR dentro del puesto seleccionado. */
interface SucursalVista {
  sucursal: string;
  personas: PersonaVista[];
  completados: number;
  totalItems: number;
  porcentaje: number;
  /**
   * Qué clase de cosa es este lugar: sucursal con su zona, corporativo, el
   * canal de mantenimiento, o desconocido. Los cuatro se pintaban idénticos, y
   * por eso `COMPRAS` y `MANTENIMIENTO` se leían como si fueran plazas.
   */
  destino: DestinoServido;
  /** ¿Lo de aquí se le cuenta a otra unidad que a la del lugar? */
  cruzada: boolean;
  /** La frase que lo explica, para el `title`. Vacía si no hay cruce. */
  textoAtrib: string;
}

/**
 * Un puesto dentro de la PIRÁMIDE, con lo suyo y lo de todo lo que cuelga.
 *
 * Dos juegos de cifras a propósito: las `...Hoy` son del puesto solo, y las
 * `...Arbol` incluyen a sus subordinados. Un Gerente de Zona al 40% no dice lo
 * mismo si ese 40 es suyo o de las trece plazas que tiene debajo.
 */
interface FilaArbol {
  puesto: PuestoOrganigrama;
  /** 0 = Dirección General. Es lo que sangra la fila. */
  profundidad: number;
  /** Cuántas tareas manda su manual (0 = todavía no tiene manual). */
  tareasManual: number;
  tieneManual: boolean;

  /** Del puesto, sin contar a nadie debajo. */
  entregasHoy: number;
  pendientesVencidas: number;
  porcentaje: number | null;

  /** Del puesto MÁS todo su subárbol. */
  entregasArbol: number;
  vencidasArbol: number;
  puntosArbol: number;
  hechosArbol: number;
  porcentajeArbol: number | null;
  /** Cuántos puestos cuelgan debajo (a cualquier profundidad). */
  cuantosDebajo: number;

  /**
   * ¿Este puesto le REPORTA a quien está mirando?
   *
   * `false` NO quiere decir «escóndelo»: quiere decir que trabaja en su lugar
   * pero responde a otra unidad, así que se ve y se marca «servicio a» — y no
   * le cuenta. En Padre Hidalgo 15 de 38 personas son de Ventas: la Encargada
   * tiene que verlas sin que sus puntos caigan en su número (§5).
   */
  propio: boolean;

  hijos: FilaArbol[];
}

/**
 * Una fila del arbol unico. Cuatro tipos, un solo `*ngFor`.
 * `prof` es la sangria: 0 es Direccion General y crece con el organigrama y
 * luego con sucursal, persona y entrega.
 */
interface FilaVista {
  tipo: 'puesto' | 'sucursal' | 'persona' | 'entrega' | 'tarea';
  /** Id unico y estable: sirve de llave de plegado y de trackBy. */
  clave: string;
  prof: number;
  tieneHijos: boolean;
  /**
   * Si esta fila se pinta abierta. Se RESUELVE aquí, no en la plantilla.
   *
   * Antes la plantilla llamaba `abierto(f.clave)` hasta cuatro veces por fila.
   * Con el estado abierto ya combinando tres fuentes —lo que abriste tú, lo que
   * abre la búsqueda y lo que sembró el día— eso serían doce llamadas por fila
   * en cada ciclo de detección de cambios. Es la misma lección que tumbó el
   * sidebar el 1/sep: lo que la plantilla llama en cada ciclo se paga en cada
   * ciclo.
   */
  abierta: boolean;
  /** Guías de nivel a pintar. Arreglos COMPARTIDOS por profundidad (ver GUIAS). */
  guias: number[];
  puesto?: FilaArbol;
  sucursal?: SucursalVista;
  persona?: PersonaVista;
  entrega?: EntregaVista;
  /** La tarea que MANDA el manual de este puesto. Ver `tareasDelPuesto`. */
  tarea?: TareaVista;
}

/**
 * Una tarea del manual de un puesto, para desglosar la pastilla del número.
 *
 * ─── POR QUÉ ESTO NO ES LO MISMO QUE UNA «ENTREGA» ────────────────────────
 * Una ENTREGA es un checklist que el robot ya emitió hoy a una persona: existe
 * porque alguien la recibió. Una TAREA es lo que el manual MANDA, exista o no
 * alguien que la reciba.
 *
 * La diferencia importa justo donde más duele: un puesto con 3 tareas y sin
 * nadie asignado mostraba el «3» y, al abrirlo, NADA — porque no hay entregas
 * que listar. Se leía como que el número mentía. Ahora se ven las tres, y
 * debajo, si las hay, quién las tiene y cómo va.
 */
interface TareaVista {
  id: string;
  nombre: string;
  momento: string;
  frecuencia: string;
  horaLimite: string;
  puntos: number;
  /** El manual la tiene, pero el robot NO la entrega periódicamente. */
  soloPorEvento: boolean;
  codigoFormato?: string;
}

/** Una persona con tareas cuyo puesto no se pudo resolver. */
interface HuerfanoVista {
  nombre: string;
  sucursal: string;
  entregas: number;
}

/** Un atajo a una unidad de control del organigrama. */
interface ChipUnidad {
  unidad: UnidadOrganigrama;
  /** Corta, para que quepa en el chip. */
  etiqueta: string;
  /** La oficial del catálogo, va en el `title`. */
  oficial: string;
  puestos: number;
}

@Component({
  selector: 'app-vista-organigrama',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './vista-organigrama.html',
  styleUrls: ['./vista-organigrama.css']
})
export class VistaOrganigramaComponent {

  /**
   * Guías de nivel precalculadas y COMPARTIDAS: la de profundidad 3 es siempre
   * el mismo arreglo. Si se construyeran al vuelo (`guias(n)` devolviendo un
   * arreglo nuevo), el `*ngFor` que las pinta vería un arreglo distinto en cada
   * ciclo de detección y destruiría y recrearía las guías de las 300 filas.
   * Eso es exactamente lo que congeló el sidebar el 1/sep/2026.
   */
  private static readonly GUIAS: number[][] =
    Array.from({ length: 14 }, (_, n) => Array.from({ length: n }, (_, i) => i));

  /**
   * Etiqueta CORTA de cada unidad, solo para que el chip quepa. La oficial
   * sigue siendo `ETIQUETAS_UNIDAD` del catálogo y es la que va en el `title`:
   * aquí no se renombra ninguna unidad, se abrevia su rótulo.
   *
   * Si algún día el catálogo gana una unidad que no esté en este mapa, el chip
   * cae a la etiqueta oficial en vez de desaparecer. Una unidad que se pierde
   * en silencio es el modo de fallo que este repo persigue.
   */
  private static readonly ETIQUETA_CORTA: Partial<Record<UnidadOrganigrama, string>> = {
    'direccion': 'Dirección',
    'zona': 'Zonas',
    'staff-zona': 'Staff de zona',
    'ventas': 'Ventas',
    'sucursal': 'Sucursal',
    'operaciones-zona': 'Operaciones',
    'cedis': 'CEDIS',
    'administrativa': 'Administrativa',
    'capital-humano': 'Capital Humano',
    'comercial-marketing': 'Comercial',
    'sistemas': 'Sistemas',
  };

  /**
   * Topes de la siembra y de la apertura automática por búsqueda.
   *
   * No son adornos: sin ellos, "abrir lo que tiene trabajo" con un día cargado
   * o un chip ancho como Sucursal abriría cientos de filas, que es justo el
   * ruido del que se venía huyendo.
   */
  private static readonly TOPE_FILAS_SIEMBRA = 50;
  private static readonly TOPE_RESULTADOS_ABIERTOS = 8;

  /** Checklists ya filtrados por permisos, pestaña y apartado. Los da el padre. */
  private lista = signal<any[]>([]);
  @Input() set checklists(v: any[]) {
    this.lista.set(Array.isArray(v) ? v : []);
    // La siembra se hace aquí, al llegar el dato, y NO con un `effect`: es el
    // único momento en que se sabe que la lista cambió de verdad. Mientras
    // nadie haya tocado el árbol se resiembra, para que la vista siga la carga
    // en dos tandas (primero caché, luego red) sin quedarse con la primera.
    if (!this.tocado()) this.sembrar();
  }

  /**
   * Plantilla, para poder resolver el puesto de cada quien y para saber quién
   * OCUPA un puesto aunque hoy no tenga nada entregado.
   */
  private personal = signal<any[]>([]);
  @Input() set usuarios(v: any[]) { this.personal.set(Array.isArray(v) ? v : []); }

  /**
   * 👁️ Hasta dónde ve quien está mirando. Lo calcula el padre desde su puesto.
   *
   * El padre ya recortó `checklists` por LUGAR (eje horizontal). Aquí se usa
   * para dos cosas que solo pueden hacerse con la estructura enfrente: enraizar
   * el árbol en su puesto, y marcar «servicio a» lo que trabaja en su lugar
   * pero le reporta a otra unidad.
   *
   * Por omisión, SIN restricción: si el padre no lo pasa, el árbol se comporta
   * como antes. Un componente que se recorta solo cuando le falta un dato es un
   * componente que se queda en blanco el día que alguien olvida el binding.
   */
  private ambito = signal<AmbitoVisible>(ambitoVisible(null));
  @Input() set ambitoVisibleDe(v: AmbitoVisible | null) {
    this.ambito.set(v || ambitoVisible(null));
  }

  /**
   * El rótulo oficial de una unidad, para la pastilla «servicio a».
   *
   * Se lee de `ETIQUETAS_UNIDAD`, nunca de una lista local (§4), y cae al id
   * crudo si el catálogo gana una unidad que este mapa no tenga: una unidad que
   * desaparece en silencio es el modo de fallo que este repo persigue.
   */
  etiquetaUnidad(u: UnidadOrganigrama): string {
    return ETIQUETAS_UNIDAD[u] || String(u);
  }

  /**
   * La frase que dice qué parte de la operación estás viendo.
   *
   * Solo se pinta cuando hay algo que explicar: a un acceso total no se le
   * anuncia que ve todo —sería ruido permanente— pero a quien SÍ tiene un
   * recorte, o a quien se le dejó sin recortar por falta de puesto, se le dice.
   */
  textoAmbito = computed<string>(() => {
    const a = this.ambito();
    if (a.restringido) return a.motivo;
    // El único «sin restricción» que hay que anunciar es el que viene de un
    // dato incompleto: ahí el motivo es una instrucción, no una obviedad.
    return /Pídele/.test(a.motivo) ? a.motivo : '';
  });

  /** Se emite al tocar una tarea: el padre abre la vista de detalle de siempre. */
  @Output() abrir = new EventEmitter<any>();


  /** Esconde los puestos que todavía no tienen manual (son 70 de 89). */
  soloConManual = signal(true);

  /**
   * Como se llama el arbol para quien lo esta mirando.
   *
   * Es una CADENA y no un objeto: la plantilla la lee en cada ciclo de
   * deteccion y un objeto nuevo cada vez es la familia del sidebar del 1/sep.
   */
  tituloArbol(): string {
    const amb = this.ambito();
    if (!amb?.restringido) return 'Organigrama 2026';
    return 'Mi equipo';
  }

  /** Texto del buscador. Casa contra puesto, unidad, sucursal, persona y tarea. */
  busqueda = signal('');

  /** Chip de unidad activo, o null. Es el atajo a los 14 puestos de sucursal. */
  unidadFiltro = signal<UnidadOrganigrama | null>(null);

  /**
   * ¿La persona ya tocó el árbol?
   *
   * Desde que lo toca, la siembra deja de pisarle su estado. Sin esta bandera,
   * cada llegada de datos —y los polls traen datos— le volvería a abrir lo que
   * acababa de cerrar, que es la clase de pelea con la interfaz que hace que
   * alguien deje de usar una pantalla.
   */
  private tocado = signal(false);

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
    /**
     * Lo que NO cruzó a ningún puesto. Antes se descartaba con un `continue` y
     * desaparecía sin dejar rastro — que es el modo de fallo del hallazgo 1: un
     * apellido mal escrito y esa persona deja de existir para el tablero, en
     * silencio. Ahora se junta aquí y se pinta al pie de la pirámide.
     */
    const huerfanos: any[] = [];

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
      if (!pid) { huerfanos.push(c); continue; }   // sin puesto: se cuenta aparte
      const arr = mapa.get(pid) || [];
      arr.push(c);
      mapa.set(pid, arr);
    }
    return { mapa, huerfanos };
  });

  /**
   * Texto buscable de cada puesto: su nombre, su unidad, y QUIÉN Y DÓNDE lo
   * está cumpliendo hoy.
   *
   * Que la gente y la sucursal entren en el índice del puesto es lo que permite
   * escribir "Canindo" o un apellido y aterrizar en la rama correcta sin saber
   * de qué puesto cuelga. Buscar por estructura ya se podía; buscar por persona
   * es lo que la operación hace de verdad.
   */
  private buscablePorPuesto = computed(() => {
    const { mapa } = this.porPuesto();
    const out = new Map<string, string>();
    for (const p of PUESTOS_ORGANIGRAMA) {
      const partes: string[] = [p.nombre, ETIQUETAS_UNIDAD[p.unidad] || ''];
      for (const c of mapa.get(p.id) || []) {
        partes.push(c.assigned || '', c.store || '', c.name || '');
      }
      out.set(p.id, normalizarNombre(partes.join(' ')));
    }
    return out;
  });

  /** El texto de búsqueda ya normalizado (sin acentos ni puntuación). */
  private textoBuscado = computed(() => normalizarNombre(this.busqueda()));

  /** ¿Hay algún filtro activo? Cambia el modo del árbol a "abrirse solo". */
  hayCriterio = computed(() => !!this.textoBuscado() || !!this.unidadFiltro());

  /**
   * Los atajos por unidad de control, en el orden del organigrama.
   *
   * ─── SOLO LAS UNIDADES QUE ESTA PERSONA PUEDE VER ─────────────────────────
   * Esto contaba SIEMPRE los 89 puestos del catálogo, y la medición del 11/sep
   * lo destapó: con el árbol ya recortado a su rama, una Gerente de Zona seguía
   * viendo los ONCE chips —«Dirección 1», «CEDIS 15», «Administrativa 14»—.
   * Eran botones que ofrecían recorrer unidades cuyo contenido ya no está en su
   * árbol: al pulsarlos no aparece nada, y una lista vacía se lee como que el
   * sistema está roto, no como que no te toca.
   *
   * El conteo también se acota: un chip que dice «14» y destapa 2 es un número
   * sin su denominador, que es justo lo que este repo persigue.
   */
  chips = computed<ChipUnidad[]>(() => {
    const amb = this.ambito();
    const visible = (p: PuestoOrganigrama) =>
      p.vigente !== false && puestoPropio(amb, p.id);
    return ORDEN_UNIDADES.map(u => ({
      unidad: u,
      etiqueta: VistaOrganigramaComponent.ETIQUETA_CORTA[u] || ETIQUETAS_UNIDAD[u],
      oficial: ETIQUETAS_UNIDAD[u],
      puestos: PUESTOS_ORGANIGRAMA.filter(p => p.unidad === u && visible(p)).length,
    })).filter(c => c.puestos > 0);
  });

  // ==========================================================================
  //  EL MENÚ
  // ==========================================================================

  /**
   * 🔺 LA PIRÁMIDE. Un puesto por nodo, colgando de quien le manda.
   *
   * ─── EL NÚMERO DE UN NODO ES LA SUMA DE LO QUE CUELGA, PONDERADA ──────────
   * Se suman PUNTOS DE CONTROL —los items de cada checklist—, no porcentajes.
   * Promediar los porcentajes de los hijos haría que un puesto con 3 puntos
   * pesara igual que uno con 60, y el número de la zona dejaría de significar
   * nada. Es el invariante de agregación del modelo: nunca promediar promedios.
   */
  arbol = computed<FilaArbol[]>(() => {
    const { mapa } = this.porPuesto();
    const soloManual = this.soloConManual();
    const amb = this.ambito();

    const construir = (n: NodoOrganigrama): FilaArbol => {
      const entregas = mapa.get(n.puesto.id) || [];
      const puntos = entregas.reduce((s, c) => s + (c.items?.length || 0), 0);
      const hechos = entregas.reduce((s, c) => s + (c.calcCompletados || 0), 0);
      const vencidas = entregas.filter(c => this.esVencida(c)).length;
      const hijos = n.hijos.map(construir);

      const puntosArbol = hijos.reduce((s, h) => s + h.puntosArbol, puntos);
      const hechosArbol = hijos.reduce((s, h) => s + h.hechosArbol, hechos);

      return {
        puesto: n.puesto,
        profundidad: n.profundidad,
        tareasManual: tareasAutomaticasDePuesto(n.puesto.id).length,
        tieneManual: !!manualDePuesto(n.puesto.id),

        entregasHoy: entregas.length,
        pendientesVencidas: vencidas,
        porcentaje: entregas.length ? Math.round((hechos / (puntos || 1)) * 100) : null,

        entregasArbol: hijos.reduce((s, h) => s + h.entregasArbol, entregas.length),
        vencidasArbol: hijos.reduce((s, h) => s + h.vencidasArbol, vencidas),
        puntosArbol,
        hechosArbol,
        porcentajeArbol: puntosArbol ? Math.round((hechosArbol / puntosArbol) * 100) : null,
        cuantosDebajo: hijos.reduce((s, h) => s + h.cuantosDebajo + 1, 0),
        propio: puestoPropio(amb, n.puesto.id),
        hijos,
      };
    };

    let filas = arbolOrganigrama().map(construir);

    // ══════════════════ EL ÁRBOL ARRANCA EN SU PUESTO ══════════════════════
    // Sin esto, una Gerente de Zona abre sus tareas y lo primero que lee es
    // «Dirección General», con toda la cadena de mando encima suyo y un 0% que
    // no es de nadie. Su pirámide empieza donde empieza su responsabilidad.
    //
    // Se PODA, no se reconstruye: `construir` ya sumó el subárbol completo, así
    // que levantar el nodo conserva sus totales sin recalcular nada.
    //
    // Lo que NO cuelga de su raíz pero SÍ ocurre en sus lugares —Ventas en la
    // tienda de una Encargada— sobrevive como raíz aparte, marcado «servicio a».
    // Tirarlo dejaría a una Encargada viendo 20 personas donde trabajan 38, y
    // eso se lee como que el sistema está incompleto.
    if (amb.restringido && amb.raizPuestoId) {
      const raiz = amb.raizPuestoId;
      const suyo: FilaArbol[] = [];
      const ajenos: FilaArbol[] = [];

      // ⚠ 18/sep/2026 — LA SALIDA DE «SERVICIO A» SE TRAGABA EL ÁRBOL ENTERO
      //
      // Medido con el control que lo nombra: misma sesión de Encargada, mismos
      // usuarios, cambiando SOLO el número de entregas del día —
      //
      //     0 entregas  ->  raíz «Encargado(a) de Sucursal»                ✓
      //     6 entregas  ->  raíz «Dirección General», «servicio a …»       ✗
      //
      // El motivo NO es que el padre herede mal el conteo: `entregasArbol`
      // cuenta la rama y eso es correcto, es lo que alimenta la columna RAMA.
      // Es el ORDEN DE LA PREGUNTA. La salida de «servicio a» se evaluaba
      // antes de bajar, así que el PRIMER nodo del recorrido —Dirección
      // General— cumplía las dos condiciones en cuanto había una sola entrega
      // en toda la empresa: no es propio de una Encargada, y su rama contiene
      // el trabajo de su propio equipo. Se marcaba como ajeno, el recorrido se
      // detenía ahí, y la Encargada aterrizaba en la cadena de mando completa.
      //
      // Un ancestro del propio puesto NUNCA es «servicio a»: es el camino a
      // casa. Se precalcula el conjunto de los que llevan a la raíz —de una
      // pasada, no preguntando por cada nodo, que sería O(n²)— y se les deja
      // bajar. Lo que de verdad es ajeno (Ventas en la tienda de una Encargada)
      // no está en ese camino y sigue saliendo marcado, que era el propósito.
      //
      // Y por qué ninguna prueba lo vio: `prueba-vista-por-nivel.js` sirve
      // `/api` VACÍO a propósito, y cero entregas es justo el único estado en
      // el que el enraizado funcionaba. El control pasaba por un camino donde
      // el caso no podía ocurrir (§8.11 c). Lo cubre ahora
      // `prueba-rama-visible-con-datos.js`, que sirve entregas.
      const llevanALaRaiz = new Set<string>();
      const marcarCamino = (f: FilaArbol): boolean => {
        let dentro = f.puesto.id === raiz;
        for (const h of f.hijos) if (marcarCamino(h)) dentro = true;
        if (dentro) llevanALaRaiz.add(f.puesto.id);
        return dentro;
      };
      filas.forEach(marcarCamino);

      const recorrer = (f: FilaArbol) => {
        if (f.puesto.id === raiz) { suyo.push(f); return; }   // no se baja más: ya lo trae entero
        if (!f.propio && f.entregasArbol > 0 && !llevanALaRaiz.has(f.puesto.id)) {
          ajenos.push(f); return;
        }
        f.hijos.forEach(recorrer);
      };
      filas.forEach(recorrer);
      // Si su puesto no apareció (retirado del catálogo, o fuera del árbol), se
      // deja el árbol completo en vez de devolver vacío: una pantalla en blanco
      // y «no tienes nada» se ven idénticas (§5.2).
      if (suyo.length || ajenos.length) {
        // La profundidad es LA SANGRÍA, y venía contada desde Dirección General.
        // Sin rebajarla, la raíz de una Encargada (profundidad 2) abriría
        // sangrada dos niveles contra el borde izquierdo, como si colgara de algo
        // que ya no está en pantalla. Se rebaja el subárbol entero, no solo la
        // raíz, o los hijos quedarían pegados a su padre.
        const rebajar = (f: FilaArbol, delta: number): FilaArbol => ({
          ...f,
          profundidad: f.profundidad - delta,
          hijos: f.hijos.map(h => rebajar(h, delta)),
        });
        filas = [...suyo, ...ajenos].map(f => rebajar(f, f.profundidad));
      }
    }

    // El filtro PODA DE ABAJO HACIA ARRIBA. Un jefe sin manual propio pero con
    // gente debajo que sí lo tiene se conserva: quitarlo cortaría la rama y sus
    // subordinados desaparecerían de la pirámide sin que nadie lo note.
    if (soloManual) {
      const podar = (f: FilaArbol): FilaArbol | null => {
        const hijos = f.hijos.map(podar).filter((h): h is FilaArbol => h !== null);
        if (!f.tieneManual && f.entregasHoy === 0 && hijos.length === 0) return null;
        return { ...f, hijos };
      };
      filas = filas.map(podar).filter((f): f is FilaArbol => f !== null);
    }
    return filas;
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  EL ÁRBOL YA FILTRADO, MÁS LO QUE HAY QUE ABRIR PARA VER EL RESULTADO
   * ═══════════════════════════════════════════════════════════════════════
   * Una sola máquina para las dos formas de filtrar —el texto y el chip de
   * unidad—, porque las dos hacen la misma pregunta: "enséñame solo esto".
   * Tener dos caminos distintos para eso terminaría en dos criterios de
   * coincidencia que discrepan.
   *
   * DOS REGLAS, y las dos importan:
   *
   *  · SE CONSERVA UN PUESTO SI CASA O SI ALGUIEN DEBAJO CASA. Sin la segunda
   *    mitad, buscar "anaquelista" devolvería el puesto colgando de la nada y
   *    la pirámide dejaría de decir de quién depende — que es la mitad del
   *    valor de esta pantalla.
   *
   *  · EL RESULTADO SE ABRE SOLO, PERO CON TOPE. Un chip ancho como "Sucursal"
   *    casa 14 puestos: abrirlos todos destapa sus sucursales y son cientos de
   *    filas otra vez. Pasando de `TOPE_RESULTADOS_ABIERTOS` se abren solo los
   *    ANCESTROS, así que se ven los 14 resultados y se baja al que interese.
   */
  private vista = computed<{ filas: FilaArbol[]; autoAbrir: Set<string>; casan: number }>(() => {
    const base = this.arbol();
    const texto = this.textoBuscado();
    const uni = this.unidadFiltro();
    if (!texto && !uni) return { filas: base, autoAbrir: new Set<string>(), casan: 0 };

    const buscable = this.buscablePorPuesto();
    const casa = (f: FilaArbol) =>
      (!uni || f.puesto.unidad === uni) &&
      (!texto || (buscable.get(f.puesto.id) || '').includes(texto));

    const autoAbrir = new Set<string>();   // los ancestros: hay que abrirlos
    const resultados: string[] = [];       // los que casan: se abren si son pocos

    const podar = (f: FilaArbol, ruta: string[]): FilaArbol | null => {
      const mia = 'p:' + f.puesto.id;
      const hijos = f.hijos
        .map(h => podar(h, [...ruta, mia]))
        .filter((h): h is FilaArbol => h !== null);
      const propio = casa(f);
      if (!propio && hijos.length === 0) return null;

      // Se conserva: toda su cadena de mando tiene que quedar abierta o esta
      // fila no se vería nunca.
      for (const c of ruta) autoAbrir.add(c);
      if (hijos.length > 0) autoAbrir.add(mia);
      if (propio) resultados.push(mia);
      return { ...f, hijos };
    };

    const filas = base
      .map(f => podar(f, []))
      .filter((f): f is FilaArbol => f !== null);

    if (resultados.length <= VistaOrganigramaComponent.TOPE_RESULTADOS_ABIERTOS) {
      for (const r of resultados) autoAbrir.add(r);
    }
    return { filas, autoAbrir, casan: resultados.length };
  });

  /**
   * ═════════════════════════════════════════════════════════════════════
   *  UN SOLO ÁRBOL: organigrama → puesto → sucursal → colaborador
   * ═════════════════════════════════════════════════════════════════════
   * Antes había DOS vistas —«Por persona» y «Por organigrama»— y eran la misma
   * pregunta contestada dos veces: quién tiene qué. Tenerlas separadas obligaba
   * a elegir antes de ver, y la de personas era una lista plana de 100 tarjetas
   * donde la estructura de la empresa no aparecía.
   *
   * Ahora es un árbol. Se abre por niveles y cada nivel contesta una cosa:
   *   puesto      → qué manda el manual y cómo va toda su rama
   *   sucursal    → cómo va el MISMO puesto entre tiendas (ahí está el dato)
   *   colaborador → quién lo está cumpliendo hoy
   *   entrega     → la tarea, que se abre en la vista de detalle de siempre
   *
   * Se guarda el conjunto de ABIERTOS y no de cerrados, porque el estado por
   * defecto es cerrado y así el conjunto vacío es el estado inicial correcto
   * sin tener que enumerar los 89 puestos.
   */
  abiertos = signal<Set<string>>(new Set());

  /**
   * Abre o cierra una fila.
   *
   * Recibe la FILA y no solo su clave porque abrir un puesto tiene que poder
   * arrastrar su pasillo, y para eso hace falta ver sus hijos.
   */
  alternar(f: FilaVista) {
    this.tocado.set(true);
    const s = new Set(this.abiertos());
    if (s.has(f.clave)) {
      s.delete(f.clave);
    } else {
      s.add(f.clave);
      if (f.tipo === 'puesto' && f.puesto) {
        for (const c of this.cadenaPasillo(f.puesto)) s.add(c);
      }
    }
    this.abiertos.set(s);
  }

  /**
   * EL PASILLO: los eslabones de una cadena de un solo hijo.
   *
   * Un nodo con un único subordinado y sin trabajo propio no ofrece ninguna
   * decisión — abrirlo solo sirve para volver a hacer clic. Se abre la cadena
   * completa hasta la primera bifurcación o hasta el primer nodo que sí tenga
   * algo que leer. Con 53 puestos en el nivel 3, esto es lo que convierte tres
   * clics de trámite en uno.
   *
   * No puede ciclar: el catálogo garantiza un árbol acíclico (lo verifica
   * `puestosFueraDelArbol`) y el recorrido siempre baja.
   */
  private cadenaPasillo(f: FilaArbol): string[] {
    const out: string[] = [];
    let n = f;
    while (n.hijos.length === 1 && n.entregasHoy === 0) {
      n = n.hijos[0];
      out.push('p:' + n.puesto.id);
      if (n.entregasHoy > 0) break;      // aquí ya hay dato: se detiene
    }
    return out;
  }

  /** Baja el subárbol completo de un puesto. Es el alt+clic y el botón «rama». */
  abrirRama(f: FilaVista, ev?: Event) {
    ev?.stopPropagation();
    if (!f.puesto) return;
    this.tocado.set(true);
    const s = new Set(this.abiertos());
    const rec = (n: FilaArbol) => { s.add('p:' + n.puesto.id); n.hijos.forEach(rec); };
    rec(f.puesto);
    this.abiertos.set(s);
  }

  /**
   * Abre todos los PUESTOS del árbol visible (no las sucursales ni las
   * personas: eso sí serían cientos de filas y ningún dato encontrable).
   */
  abrirTodo() {
    this.tocado.set(true);
    const s = new Set<string>();
    const rec = (fs: FilaArbol[]) => {
      for (const f of fs) { s.add('p:' + f.puesto.id); rec(f.hijos); }
    };
    rec(this.vista().filas);
    this.abiertos.set(s);
  }

  /** Cierra todo de golpe. Con el árbol muy abierto es la única salida rápida. */
  cerrarTodo() {
    this.tocado.set(true);          // cerrar es una decisión: la siembra no la pisa
    this.abiertos.set(new Set());
  }

  /** Quita texto y chip de una vez. */
  limpiarFiltros() {
    this.busqueda.set('');
    this.unidadFiltro.set(null);
  }

  /** El chip es un interruptor: volver a tocarlo lo apaga. */
  alternarUnidad(u: UnidadOrganigrama) {
    this.unidadFiltro.set(this.unidadFiltro() === u ? null : u);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  LA SIEMBRA: al entrar se ve la operación del día, no un título
   * ═══════════════════════════════════════════════════════════════════════
   * El organigrama tiene UNA raíz, así que "todo cerrado" era literalmente una
   * fila en pantalla: «Dirección General». Correcto y useless — el 60% de los
   * puestos están tres niveles más abajo.
   *
   * Se abren los ANCESTROS de cada puesto que tiene entregas hoy. Los puestos
   * con trabajo quedan VISIBLES pero CERRADOS: se ve de un golpe dónde hay
   * operación y se baja de un clic a la que interese.
   *
   * Dos caídas, y las dos son a propósito:
   *  · si no hay nada con trabajo (el caso del silencio: 60 de 97 fichas), no
   *    hay nada que sembrar y se abre solo el primer nivel;
   *  · si la siembra pasaría de `TOPE_FILAS_SIEMBRA` filas, tampoco: un día
   *    cargado no puede convertir la pantalla en el muro de ruido que se vino
   *    a evitar.
   *
   * El tope se mide contando LAS FILAS QUE QUEDARÍAN, no cuántas llaves tiene
   * el conjunto. Son dos números distintos —una llave abierta arrastra a todos
   * sus hijos— y usar el segundo como proxy del primero es la clase de guardia
   * sobre un proxy que este repo ya se cobró una vez.
   */
  private sembrar() {
    const filas = this.arbol();
    const abrir = new Set<string>();
    let conTrabajo = 0;

    const rec = (fs: FilaArbol[], ruta: string[]) => {
      for (const f of fs) {
        const mia = 'p:' + f.puesto.id;
        if (f.entregasHoy > 0) {
          conTrabajo++;
          for (const c of ruta) abrir.add(c);
        }
        rec(f.hijos, [...ruta, mia]);
      }
    };
    rec(filas, []);

    const visibles = (fs: FilaArbol[]): number => fs.reduce(
      (n, f) => n + 1 + (abrir.has('p:' + f.puesto.id) ? visibles(f.hijos) : 0), 0);

    if (conTrabajo === 0 || visibles(filas) > VistaOrganigramaComponent.TOPE_FILAS_SIEMBRA) {
      abrir.clear();
      for (const f of filas) abrir.add('p:' + f.puesto.id);   // solo el primer nivel
    }
    this.abiertos.set(abrir);
  }

  /**
   * Las sucursales de UN puesto, con su gente y sus entregas.
   *
   * Se calcula solo para los puestos ABIERTOS: hacerlo para los 89 en cada
   * recálculo recorrería la lista completa 89 veces por ciclo. El corte por
   * sucursal va dentro del puesto y no como nivel del árbol de arriba porque un
   * Anaquelista existe en ocho sucursales, y el dato que sirve es comparar el
   * mismo puesto entre ellas.
   */
  /**
   * Las tareas que el manual le manda a un puesto, listas para pintar.
   *
   * Se piden a `tareasDePuesto()` -la función real del catálogo- y NO se filtran
   * las de solo-evento: el manual las tiene y quien mira la hoja de un puesto
   * necesita verlas. Se marcan aparte, porque el robot no las entrega y sin esa
   * marca alguien esperaría un checklist que nunca va a llegar.
   *
   * OJO con el número de la pastilla: cuenta `tareasAutomaticasDePuesto`, que
   * EXCLUYE las de solo-evento. Así que aquí pueden salir MÁS filas que el
   * número — y está bien, pero hay que decirlo en pantalla en vez de dejar que
   * parezca un descuadre.
   */
  private tareasDelPuesto(puestoId: string): TareaVista[] {
    return tareasDePuesto(puestoId).map(t => ({
      id: t.id,
      nombre: t.nombre,
      momento: String(t.momento || ''),
      frecuencia: String(t.frecuencia || ''),
      horaLimite: String(t.horaLimite || ''),
      puntos: (t.items || []).length,
      soloPorEvento: !!t.soloPorEvento,
      codigoFormato: t.codigoFormato,
    }));
  }

  private sucursalesDe(puestoId: string): SucursalVista[] {
    const entregas = this.porPuesto().mapa.get(puestoId) || [];
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

    // EJE TRANSVERSAL. La unidad responsable sale del PUESTO, nunca del lugar:
    // medido el 4/sep, 8 de 16 stores mezclan unidades (Padre Hidalgo tiene
    // cinco), así que el lugar no dice de qué departamento es quien trabaja ahí.
    const unidad: UnidadOrganigrama | null = puestoPorId(puestoId)?.unidad || null;

    // En cuántos lugares distintos aparece cada persona DENTRO de este puesto.
    // Se cuenta antes de armar las filas porque el dato es del conjunto, no del
    // grupo: mirando un solo grupo es imposible saber que hay dos más.
    const lugaresPorPersona = new Map<string, number>();
    for (const [, mp] of porSuc) {
      for (const nombre of mp.keys()) {
        lugaresPorPersona.set(nombre, (lugaresPorPersona.get(nombre) || 0) + 1);
      }
    }

    const out: SucursalVista[] = [];
    for (const [sucursal, mp] of porSuc) {
      const personas: PersonaVista[] = [];
      for (const [nombre, evs] of mp) {
        const tot = evs.reduce((n, e) => n + e.totalItems, 0);
        const hec = evs.reduce((n, e) => n + e.completados, 0);
        personas.push({
          nombre, iniciales: this.iniciales(nombre), entregas: evs,
          completados: hec, totalItems: tot,
          porcentaje: tot ? Math.round((hec / tot) * 100) : 0,
          enOtrosLugares: (lugaresPorPersona.get(nombre) || 1) - 1,
        });
      }
      // Peor primero: lo que necesita atención va arriba.
      personas.sort((a, b) => a.porcentaje - b.porcentaje || a.nombre.localeCompare(b.nombre));
      const tot = personas.reduce((n, p) => n + p.totalItems, 0);
      const hec = personas.reduce((n, p) => n + p.completados, 0);
      const destino = clasificarDestino(sucursal);
      out.push({
        sucursal, personas, completados: hec, totalItems: tot,
        porcentaje: tot ? Math.round((hec / tot) * 100) : 0,
        destino,
        cruzada: esAtribucionCruzada(unidad, destino),
        textoAtrib: textoAtribucion(unidad, destino),
      });
    }
    out.sort((a, b) => a.porcentaje - b.porcentaje || a.sucursal.localeCompare(b.sucursal));
    return out;
  }

  /**
   * El árbol aplanado en el orden en que se pinta, con CUATRO tipos de fila.
   *
   * Se aplana en vez de usar plantillas recursivas: con hasta ocho niveles
   * -cinco de organigrama más sucursal, persona y entrega- la recursión monta
   * un componente por nivel para no ganar nada, y plegar obligaría a recalcular
   * el árbol entero.
   *
   * Al abrir un puesto salen PRIMERO sus sucursales -su trabajo propio- y
   * luego los puestos que le reportan. Ese orden importa: un Encargado abre su
   * fila para ver su turno, no para ver el organigrama.
   *
   * CON BÚSQUEDA ACTIVA la apertura la manda el criterio y no el estado manual.
   * Es deliberado: mientras filtras, lo que quieres ver es el resultado, y el
   * conjunto filtrado es chico por definición. Al limpiar el filtro vuelve tal
   * cual el estado que tenías abierto.
   */
  filas = computed<FilaVista[]>(() => {
    const { filas: arbol, autoAbrir } = this.vista();
    const manual = this.abiertos();
    const texto = this.textoBuscado();
    const guia = (n: number) =>
      VistaOrganigramaComponent.GUIAS[Math.min(n, VistaOrganigramaComponent.GUIAS.length - 1)];

    // Un puesto se pinta abierto por el criterio o por tu propio clic.
    const estaAbierto = (clave: string) => autoAbrir.has(clave) || manual.has(clave);

    // Con texto, la sucursal y la persona que casan también se abren solas: si
    // buscas un apellido, lo que quieres ver son SUS tareas, no el puesto del
    // que cuelga. Sin esto la búsqueda por persona seguiría costando dos clics.
    const sucCasa = (su: SucursalVista) => !!texto && (
      normalizarNombre(su.sucursal).includes(texto) ||
      su.personas.some(p => normalizarNombre(p.nombre).includes(texto))
    );
    const perCasa = (pe: PersonaVista) => !!texto && normalizarNombre(pe.nombre).includes(texto);

    const out: FilaVista[] = [];
    const rec = (fs: FilaArbol[]) => {
      for (const f of fs) {
        const clave = 'p:' + f.puesto.id;
        const abierta = estaAbierto(clave);
        const sucs = abierta ? this.sucursalesDe(f.puesto.id) : [];
        out.push({
          tipo: 'puesto', clave, prof: f.profundidad, puesto: f, abierta,
          guias: guia(f.profundidad),
          // Un puesto CON manual siempre tiene algo que desplegar, aunque no
          // haya nadie asignado: sus tareas. Antes `tieneHijos` solo miraba
          // ramas y entregas, así que un puesto con «3» y sin gente se pintaba
          // como hoja — el número prometía un desglose que no existía.
          tieneHijos: f.hijos.length > 0 || f.entregasHoy > 0 || f.tieneManual,
        });
        if (!abierta) continue;

        // ── LO QUE EL MANUAL LE MANDA A ESTE PUESTO ─────────────────────────
        // Va ARRIBA de las sucursales a propósito: primero la norma («qué debe
        // hacer este puesto»), después la realidad («quién la tiene y cómo
        // va»). Al revés, un puesto sin gente asignada seguiría sin explicar su
        // propio número.
        for (const t of this.tareasDelPuesto(f.puesto.id)) {
          out.push({
            tipo: 'tarea', clave: clave + '|t:' + t.id,
            prof: f.profundidad + 1, tarea: t, abierta: false,
            guias: guia(f.profundidad + 1), tieneHijos: false,
          });
        }

        for (const su of sucs) {
          const cs = clave + '|s:' + su.sucursal;
          const sa = manual.has(cs) || sucCasa(su);
          out.push({
            tipo: 'sucursal', clave: cs, prof: f.profundidad + 1, sucursal: su,
            abierta: sa, guias: guia(f.profundidad + 1),
            tieneHijos: su.personas.length > 0,
          });
          if (!sa) continue;

          for (const pe of su.personas) {
            const cp = cs + '|c:' + pe.nombre;
            const pa = manual.has(cp) || perCasa(pe);
            out.push({
              tipo: 'persona', clave: cp, prof: f.profundidad + 2, persona: pe,
              abierta: pa, guias: guia(f.profundidad + 2),
              tieneHijos: pe.entregas.length > 0,
            });
            if (!pa) continue;

            for (const e of pe.entregas) {
              out.push({
                tipo: 'entrega', clave: cp + '|e:' + e.titulo + e.hora,
                prof: f.profundidad + 3, entrega: e, abierta: false,
                guias: guia(f.profundidad + 3), tieneHijos: false,
              });
            }
          }
        }
        rec(f.hijos);
      }
    };
    rec(arbol);
    return out;
  });

  /** Cuántos nodos hay abiertos. Sirve para ofrecer "cerrar todo". */
  cuantosAbiertos = computed(() => this.abiertos().size);

  /**
   * Las tareas de gente cuyo puesto no se pudo resolver, agrupadas por persona.
   *
   * Van al pie de la pirámide y NO se reparten por parecido: un puesto adivinado
   * le entrega a una persona real obligaciones que no le tocan. Verlas aquí es
   * además la lista de a quién le falta ficha.
   */
  huerfanos = computed<HuerfanoVista[]>(() => {
    const { huerfanos } = this.porPuesto();
    const mapa = new Map<string, HuerfanoVista>();
    for (const c of huerfanos) {
      const nombre = (c.assigned || 'Sin asignar').trim();
      const k = nombre.toLowerCase();
      const h = mapa.get(k) || { nombre, sucursal: (c.store || 'sin sucursal').trim(), entregas: 0 };
      h.entregas++;
      mapa.set(k, h);
    }
    return [...mapa.values()].sort((a, b) => b.entregas - a.entregas || a.nombre.localeCompare(b.nombre));
  });

  /**
   * Totales del encabezado.
   *
   * `entregas + huerfanas` tiene que dar EXACTAMENTE el total de la pestaña. Si
   * no cuadra, alguien se está contando dos veces o se está perdiendo, y los dos
   * números están a la vista justo para que eso no pase inadvertido.
   *
   * Y CON FILTRO ACTIVO SIEMPRE VA EL DENOMINADOR: «3 de 89». Una lista filtrada
   * sin su total es la forma más fácil de leer un vacío como un cero.
   */
  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  🎯 CAPA 1 — LA LINEA QUE CONTESTA LA PREGUNTA DE LAS 8 DE LA MAÑANA
   * ═══════════════════════════════════════════════════════════════════════
   * Sale de `lista()`, que es LA MISMA señal de la que cuelga `arbol()`. No es
   * una comodidad: derivarlo de otro sitio —o de una peticion propia— abriria
   * la puerta a que la linea de arriba diga un numero y las filas de abajo
   * otro, y en la misma pantalla. Aqui no puede pasar: es el mismo dato.
   *
   * Y por eso no hay llamada nueva al backend ni hace falta: al ser un
   * `computed` sobre una señal, se recalcula solo cuando la lista cambia —
   * incluido el momento en que alguien termina una tarea y el poll la trae.
   *
   * ⚠ SE LE PASA `esVencida`, LA REGLA DE ESTE ARBOL, no la de la tarjeta del
   * trabajador. En el modulo conviven tres definiciones de «vencida» (ver la
   * cabecera de `resumen-pendientes.util.ts`); mientras sea asi, lo unico
   * inaceptable es que el resumen contradiga a las filas que tiene debajo.
   */
  resumenDia = computed<ResumenPendientes>(() =>
    resumenPendientes(this.lista(), (c) => this.esVencida(c)));

  /** La frase de la izquierda. El util la arma para no partir el texto en dos. */
  textoResumenDia = computed<string>(() => textoResumen(this.resumenDia()));

  resumen = computed(() => {
    const planas: FilaArbol[] = [];
    const recorrer = (fs: FilaArbol[]) => { for (const f of fs) { planas.push(f); recorrer(f.hijos); } };
    recorrer(this.arbol());
    const huer = this.huerfanos();
    return {
      puestos: planas.length,
      entregas: planas.reduce((n, f) => n + f.entregasHoy, 0),
      huerfanas: huer.reduce((n, h) => n + h.entregas, 0),
      personasSinPuesto: huer.length,
      fueraDelArbol: puestosFueraDelArbol().length,
      puestosSinManual: PUESTOS_ORGANIGRAMA.filter(
        p => p.vigente !== false && !manualDePuesto(p.id)
      ).length,
      /** Cuántos puestos casan con el filtro de hoy (0 si no hay filtro). */
      casan: this.vista().casan,
    };
  });

  /**
   * Gente que TIENE este puesto pero hoy no recibió nada.
   *
   * Es la mitad que un tablero de cumplimiento normalmente esconde: si alguien
   * no aparece, no se sabe si va bien o si nunca le llegó su checklist. Aquí se
   * dice, porque casi siempre significa descanso, fuera de turno, o que su
   * sucursal no está capturada.
   */
  sinEntregaDe(puestoId: string): { nombre: string; sucursales: string }[] {
    const id = puestoId;
    if (!id) return [];
    const conEntrega = new Set(
      (this.porPuesto().mapa.get(id) || []).map(c => normalizarNombre(c.assigned))
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
  }

  // ==========================================================================
  //  ACCIONES
  // ==========================================================================




  abrirEntrega(e: EntregaVista) { this.abrir.emit(e.ref); }

  /**
   * Un clic en una fila. Alt (u Option) abre la RAMA en vez del nodo.
   *
   * El atajo existe porque el botón «rama» solo aparece en la fila abierta, y
   * quien ya sabe a dónde va no debería tener que abrirla primero.
   */
  clicFila(f: FilaVista, ev: Event) {
    // Las filas son `div[role=treeitem]` y no `<button>`, porque el botón
    // «rama» vive DENTRO de la fila y un botón anidado en otro botón es HTML
    // inválido. Por eso el teclado se atiende a mano: `preventDefault` en la
    // barra espaciadora, o la página haría scroll en vez de abrir el nodo.
    //
    // El parámetro va como `Event` y no como `MouseEvent | KeyboardEvent`
    // porque es lo que Angular tipa para `(keydown.enter)`: pedir el tipo
    // estrecho aquí no compila. Se estrecha adentro, que es donde se sabe.
    if (ev instanceof KeyboardEvent) ev.preventDefault();
    if (f.tipo === 'entrega') { this.abrirEntrega(f.entrega!); return; }
    const alt = (ev as MouseEvent | KeyboardEvent).altKey === true;
    if (alt && f.tipo === 'puesto') { this.abrirRama(f); return; }
    this.alternar(f);
  }

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

  trackFila(_: number, f: FilaVista) { return f.clave; }
  trackHuerfano(_: number, h: HuerfanoVista) { return h.nombre; }
  trackTarea(_: number, t: TareaManual) { return t.id; }
  trackChip(_: number, c: ChipUnidad) { return c.unidad; }
}
