import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  Indicador, medir, sinDato, valorDe, esMedido, leyendaDe,
} from '../../../shared/indicador.util';
import {
  SILENCIO, CAUSAS, UNIDADES_TABLERO, ANCLAS_HOY, MINIMO_PUNTOS_PARA_DIBUJAR,
  OPERACION_COMPROBADA, FIDELIDAD_REGISTRO, Procedencia, ETIQUETA_CONFIANZA,
  DiaSerie,
} from '../../../shared/tablero-direccion.util';

/**
 * 🏛️ TABLERO DE DIRECCIÓN
 *
 * Sustituye la franja de cuatro medidores por la pregunta que le toca a este
 * nivel. Los cuatro medidores no desaparecen: bajan a ser componentes.
 *
 * ─── LO QUE ESTA PANTALLA HACE DISTINTO ────────────────────────────────────
 * · Publica DOS números, no cuatro, y hoy los dos son un guion.
 * · Ninguna cifra sale sin su denominador.
 * · Cada cifra declara su PROCEDENCIA: leído / medido con fecha / estimado /
 *   ausente. Un tablero que no dice de dónde salen sus números obliga a
 *   creerle.
 * · Un día sin muestra suficiente se dibuja como HUECO, no como cero.
 *
 * ─── LO QUE NO HACE, Y NO ES UN OLVIDO ─────────────────────────────────────
 * · No hay panel de hallazgos con ciclo hallazgo → acción → reverificación:
 *   eso necesita tabla propia y es Fase 5. Lo que se muestra es UN hallazgo
 *   agrupado por plaza-jornada, que es lo que sí se puede derivar hoy, con sus
 *   anclas para que se vea qué tan defendible es la prueba.
 * · El cierre diario NO está materializado: esto reduce en el navegador. El
 *   sello de cierre dice la hora del corte que se está mirando, no que exista
 *   una tabla inmutable. Eso es Fase 6 completa.
 * · No existen plaza, cobertura ni ámbito. Todo se agrupa por puesto y por
 *   texto de sucursal porque es lo que hay: Fase 3.
 */
@Component({
  selector: 'app-tablero-direccion',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tablero-direccion.html',
  styleUrls: ['./tablero-direccion.css'],
})
export class TableroDireccionComponent {

  /** El agregado del día que ya calcula home.ts. Se recibe, no se recalcula. */
  private agregado = signal<any>({});
  @Input() set agregadoHoy(v: any) { this.agregado.set(v || {}); }

  /** Nombre y alcance de quien mira, para la cabecera. */
  @Input() nombre = '';
  @Input() alcance = 'todas las unidades';

  /** Momento del corte que se está viendo. */
  @Input() selloCierre = '';

  /**
   * ¿Se pinta el nivel EMPRESA? Las diez unidades, el silencio, el reparto de
   * causas y la procedencia son cifras de compañia: una jefatura de sucursal ve
   * SUS numeros, no el agregado de la empresa.
   */
  @Input() verEmpresa = false;

  /** Serie de siete días: [{ etiqueta, cumplidos, emitidos }]. La da el padre. */
  private serie = signal<{ etiqueta: string; cumplidos: number; emitidos: number }[]>([]);
  @Input() set sieteDias(v: any[]) { this.serie.set(Array.isArray(v) ? v : []); }

  // ── constantes del modelo, expuestas a la plantilla ────────────────────
  readonly causas = CAUSAS;
  readonly unidades = UNIDADES_TABLERO;
  readonly anclas = ANCLAS_HOY;
  readonly silencio = SILENCIO;
  readonly etiquetaConfianza = ETIQUETA_CONFIANZA;
  readonly minimoPuntos = MINIMO_PUNTOS_PARA_DIBUJAR;

  readonly dosNumeros = [
    { titulo: 'Operación comprobada', ind: OPERACION_COMPROBADA, sello: 'No calculable hoy' },
    { titulo: 'Fidelidad del registro', ind: FIDELIDAD_REGISTRO, sello: 'Sin auditoría física' },
  ];

  // ── LO QUE SÍ SE SABE ──────────────────────────────────────────────────
  /**
   * Seis cifras, cada una con la cifra de la que sale. Las que vienen del
   * agregado son de HOY; el silencio va con su fecha porque es de una medición
   * puntual y presentarlo como de hoy sería el mismo error que un cero sin
   * denominador.
   */
  loQueSeSabe = computed(() => {
    const a = this.agregado();
    const emitidos = a.items || 0;
    const checklists = a.checklists || 0;
    const ejecutados = a.hechos || 0;
    const pidenFoto = a.pidenEvidencia || 0;
    const conFoto = a.conEvidencia || 0;
    return [
      { valor: this.miles(emitidos), etiqueta: `puntos emitidos hoy · ${checklists} checklists`,
        confianza: 'leido' as const },
      // LA UNICA cifra de empresa de las seis. Las otras cinco salen de
      // `agregado()`, que `home.ts` carga YA FILTRADO por el alcance de quien
      // mira: son sus numeros, no los de la empresa.
      // `esEmpresa` es explicito a proposito. Antes la plantilla la escondia por
      // `confianza === 'medido'`, que es un PROXY: el dia que se agregue otra
      // cifra medida y propia, ese proxy la esconde sin que nadie lo note.
      // La guardia va sobre la entrada que de verdad se usa (§8.11 b).
      { valor: `${this.silencio.porcentaje} %`,
        etiqueta: `de la emisión a plazas en silencio · ${this.silencio.fichasEnSilencio} de ${this.silencio.fichasConPuesto} fichas`,
        confianza: 'medido' as const, esEmpresa: true,
        nota: `${this.silencio.fuente} · ${this.silencio.medidoEl}` },
      { valor: this.miles(ejecutados), etiqueta: `puntos ejecutados · de ${this.miles(emitidos)}`,
        confianza: 'leido' as const },
      { valor: `${conFoto} / ${pidenFoto}`, etiqueta: 'evidencia entregada donde se exige',
        confianza: 'leido' as const },
      { valor: '—', etiqueta: 'infaltables caídos · la norma no marca cuáles lo son',
        confianza: 'ausente' as const, nota: 'Fase 7: la norma como dato' },
      { valor: '0', etiqueta: `puntos verificados con muestra · de ${this.miles(emitidos)}`,
        confianza: 'leido' as const, nota: 'cero real: el nivel 2 no existe' },
    ];
  });

  /** Puntos emitidos y checklists del corte, para la cabecera. */
  emitidos = computed(() => this.agregado().items || 0);
  checklistsCorte = computed(() => this.agregado().checklists || 0);

  /** Puntos sin cumplir: el total del que salen las causas. */
  puntosSinCumplir = computed(() => {
    const a = this.agregado();
    return Math.max(0, (a.items || 0) - (a.hechos || 0));
  });

  /**
   * Los puntos de cada causa.
   *
   * `no_verificado` devuelve el TOTAL EMITIDO, no una porción: es una capa
   * sobre todo, incluido lo que sí se ejecutó bien. Las dos primeras salen en
   * guion con su motivo, porque separarlas exige el campo de causa (Fase 5) y
   * el script del silencio por unidad, que no se ha corrido.
   */
  puntosDeCausa(clave: string): string {
    const a = this.agregado();
    switch (clave) {
      case 'sin_prueba':    return this.miles(a.hechos || 0);
      case 'no_verificado': return this.miles(a.items || 0);
      default:              return '—';
    }
  }

  // ── SIETE DÍAS ─────────────────────────────────────────────────────────
  /**
   * Cada día es un Indicador, no un número. Un día con menos del mínimo sale
   * 'sin_muestra' y la plantilla lo pinta RAYADO Y SIN VALOR.
   *
   * Un tablero normal pintaría cero y la línea bajaría bonito hasta el piso.
   * Eso es una mentira con forma de gráfica: afirma que hubo medición.
   */
  dias = computed<DiaSerie[]>(() =>
    this.serie().map(d => ({
      etiqueta: d.etiqueta,
      ind: medir(d.cumplidos, d.emitidos, this.minimoPuntos),
    })),
  );

  /** Cuántos días de los siete tuvieron muestra. Es la cifra de aceptación. */
  diasConMuestra = computed(() => this.dias().filter(d => esMedido(d.ind)).length);

  /**
   * La escala se DECLARA y se ajusta al máximo real, redondeado hacia arriba a
   * la decena. Con escala 0–100 una barra de 5 % mide cinco píxeles y equivale
   * a no dibujarla: la gráfica anterior tenía ese problema al revés, saltando a
   * 100 % en días de tres tareas.
   */
  escalaMax = computed(() => {
    const vals = this.dias().map(d => valorDe(d.ind)).filter((v): v is number => v !== null);
    if (!vals.length) return 10;
    return Math.max(10, Math.ceil(Math.max(...vals) / 10) * 10);
  });

  alturaDe(d: DiaSerie): number {
    const v = valorDe(d.ind);
    if (v === null) return 0;
    return Math.round((v / this.escalaMax()) * 100);
  }

  // ── PROCEDENCIA ────────────────────────────────────────────────────────
  procedencia = computed<Procedencia[]>(() => {
    const a = this.agregado();
    return [
      { cifra: `${this.miles(a.items || 0)} puntos · ${a.checklists || 0} checklists · ${a.hechos || 0} ejecutados · ${a.conEvidencia || 0}/${a.pidenEvidencia || 0} evidencia`,
        origen: 'reducido en el navegador desde /api/checklists', confianza: 'leido' },
      { cifra: `${this.silencio.porcentaje} % · ${this.silencio.fichasEnSilencio} de ${this.silencio.fichasConPuesto}`,
        origen: `${this.silencio.fuente} — denominador = fichas activas con puesto · ${this.silencio.medidoEl}`,
        confianza: 'medido' },
      { cifra: 'reparto entre no_asignado y no_ejecutado',
        origen: 'diagnostico-silencio-por-unidad.js, sin correr', confianza: 'estimado' },
      { cifra: 'cortes por unidad',
        origen: 'el mismo script; hasta entonces cada unidad va sin porcentaje', confianza: 'estimado' },
      { cifra: '14 de 89 puestos son de sucursal', origen: 'organigrama.catalogo.ts', confianza: 'contado' },
      { cifra: 'los dos números y las cinco anclas',
        origen: 'no existen como dato — se muestran como ausencia, no como cero', confianza: 'ausente' },
      { cifra: 'distorsión de «hecho»',
        origen: 'migración 045: por_justificacion = 1 punto en toda la empresa', confianza: 'medido' },
    ];
  });

  // ── auxiliares ─────────────────────────────────────────────────────────
  /** Separador de miles. Las cifras grandes sin él se leen mal de un vistazo. */
  miles(n: number): string { return (n || 0).toLocaleString('es-MX'); }

  iniciales(nombre: string): string {
    const p = (nombre || '').trim().split(/\s+/);
    if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
    return (p[0]?.substring(0, 2) || '??').toUpperCase();
  }

  valorDe = valorDe;
  esMedido = esMedido;
  leyendaDe = leyendaDe;

  trackCausa(_: number, c: any) { return c.clave; }
  trackUnidad(_: number, u: any) { return u.clave; }
  trackDia(_: number, d: DiaSerie) { return d.etiqueta; }
}
