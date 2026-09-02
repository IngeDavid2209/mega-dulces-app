import {
  Component, Input, Output, EventEmitter, signal, computed, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type Estado = 'vencida' | 'hoy' | 'completada' | 'programada';
type Tipo = 'rutina' | 'unica';

/** Un checklist ya clasificado, listo para pintar. */
interface TareaVista {
  ref: any;               // el checklist original, para emitirlo tal cual
  titulo: string;
  sucursal: string;
  estado: Estado;
  tipo: Tipo;
  etiquetaTipo: string;   // 'Diaria', 'Semanal'... o 'Única'
  cuando: string;         // 'Hoy · 14:00', 'Venció 10:00 AM', 'Cerrada'...
  progreso: number;
  completados: number;
  totalItems: number;
}

interface PersonaVista {
  id: string;
  nombre: string;
  iniciales: string;
  colorFondo: string;
  colorTexto: string;
  tareas: TareaVista[];
  total: number;
  completadas: number;
  vencidas: number;
  hoy: number;
  programadas: number;
  porcentaje: number;
  mezcla: string;         // '3 rutinas · 1 única'
}

/**
 * Panel de responsables del apartado Checklist.
 *
 * Sustituye a la vista agrupada por persona que ya existia, con el diseño de
 * tablero: resumen del dia, filtros por estado y tipo, una tarjeta por
 * responsable y un panel que se abre con sus tareas.
 *
 * ALCANCE, a proposito: esto es la LISTA. Abrir una tarea sigue llevando a la
 * vista de detalle de siempre, la de las fotos y el boton de enviar, que es por
 * donde entregan los 154 trabajadores y que aqui no se toca ni un poco.
 *
 * Vive en su propio componente y no dentro de checklist.ts (3,700+ lineas) para
 * que un cambio de presentacion no pueda tumbar el flujo de entrega.
 *
 * Del boceto quedaron fuera dos cosas, y es intencional: el riel de iconos de la
 * izquierda (la app ya tiene su sidebar, seria navegacion duplicada) y el tema
 * oscuro (la app entera es clara; ponerlo solo aqui se veria como un parche).
 */
@Component({
  selector: 'app-panel-responsables',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './panel-responsables.html',
  styleUrls: ['./panel-responsables.css']
})
export class PanelResponsablesComponent implements OnDestroy {

  /** Lista ya filtrada por permisos y pestaña; llega del componente padre. */
  private lista = signal<any[]>([]);
  @Input() set checklists(v: any[]) { this.lista.set(Array.isArray(v) ? v : []); }

  /** Muestra los botones de alta (solo quien puede crear). */
  @Input() puedeCrear = false;
  /** Muestra la campana de aviso junto al nombre. */
  @Input() puedeNotificar = false;
  /** Permite editar y borrar desde la tarjeta de tarea. */
  @Input() puedeEditar = false;

  @Output() abrir = new EventEmitter<any>();
  @Output() crear = new EventEmitter<'unica' | 'rutina' | 'equipo'>();
  @Output() notificar = new EventEmitter<string>();
  @Output() editar = new EventEmitter<any>();
  @Output() eliminar = new EventEmitter<any>();

  // ---------------- Estado de la vista ----------------
  filtro = signal<'todas' | 'vencida' | 'hoy' | 'completada' | 'programada'>('todas');
  tipoFiltro = signal<'todos' | Tipo>('todos');
  orden = signal<'riesgo' | 'avance' | 'nombre'>('riesgo');
  abiertoId = signal<string | null>(null);
  // La búsqueda NO vive aquí: la pantalla ya tiene su buscador y filtra la lista
  // antes de pasármela. Tener dos cajas era confundir por gusto.

  /** El reloj entra en el cálculo de "vencida", así que hay que refrescarlo. */
  private ahora = signal<Date>(new Date());
  private reloj = setInterval(() => this.ahora.set(new Date()), 60000);

  ngOnDestroy() { clearInterval(this.reloj); }

  // ---------------- Clasificación ----------------
  private hoyISO(): string {
    const d = this.ahora();
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().split('T')[0];
  }

  private minutosDe24h(txt: any): number | null {
    if (typeof txt !== 'string' || !txt.includes(':')) return null;
    const [h, m] = txt.trim().split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }

  private readonly FRECUENCIAS = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral', 'Anual'];

  /**
   * Rutina o tarea única. Mismo criterio que ya usaba checklist.ts: el campo
   * `frecuencia`, y si no viene, el nombre suele traerla entre paréntesis.
   */
  private tipoDe(c: any): { tipo: Tipo; etiqueta: string } {
    const f = c?.frecuencia;
    if (typeof f === 'string' && this.FRECUENCIAS.includes(f)) return { tipo: 'rutina', etiqueta: f };
    const m = /\((Diaria|Semanal|Catorcenal|Mensual|Trimestral|Anual)\)\s*$/.exec(c?.name || '');
    if (m) return { tipo: 'rutina', etiqueta: m[1] };
    return { tipo: 'unica', etiqueta: 'Única' };
  }

  /** Hora límite más tardía del checklist, en minutos. null si no tiene ninguna. */
  private limiteDe(c: any): number | null {
    let max: number | null = null;
    for (const it of (c?.items || [])) {
      const m = this.minutosDe24h(it?.horaLimite || it?.time);
      if (m !== null && (max === null || m > max)) max = m;
    }
    return max;
  }

  private estadoDe(c: any): Estado {
    if (c?.enviado === true || c?.status === 'completo') return 'completada';
    if (c?.esFutura === true) return 'programada';

    const hoy = this.hoyISO();
    // De un día anterior y sin cerrar: vencida, sin necesidad de mirar la hora.
    if (typeof c?.date === 'string' && c.date < hoy) return 'vencida';

    const limite = this.limiteDe(c);
    if (limite !== null) {
      const d = this.ahora();
      if (d.getHours() * 60 + d.getMinutes() > limite) return 'vencida';
    }
    return 'hoy';
  }

  formatearHora(hora: string): string {
    if (!hora || !hora.includes(':')) return hora || '';
    const [h, m] = hora.split(':').map(Number);
    const suf = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')} ${suf}`;
  }

  /** '2026-07-29' → '29 de julio'. La fecha cruda se lee como dato de sistema. */
  private fechaCorta(iso: any): string {
    if (typeof iso !== 'string' || iso.length < 10) return String(iso || '');
    const [a, m, d] = iso.split('-').map(Number);
    if (!a || !m || !d) return iso;
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                   'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `${d} de ${meses[m - 1] || ''}`.trim();
  }

  private cuandoDe(c: any, estado: Estado): string {
    const limite = this.limiteDe(c);
    const textoLimite = limite !== null
      ? this.formatearHora(`${String(Math.floor(limite / 60)).padStart(2, '0')}:${String(limite % 60).padStart(2, '0')}`)
      : '';

    if (estado === 'completada') {
      return c?.horaEnvio ? `Cerrada · ${c.horaEnvio}` : 'Cerrada';
    }
    if (estado === 'programada') return `Programada · ${this.fechaCorta(c?.date)}`;
    if (estado === 'vencida') {
      const hoy = this.hoyISO();
      if (typeof c?.date === 'string' && c.date < hoy) return `Venció el ${this.fechaCorta(c.date)}`;
      return textoLimite ? `Venció a las ${textoLimite}` : 'Vencida';
    }
    return textoLimite ? `Hoy · ${textoLimite}` : 'Hoy · sin hora límite';
  }

  // ---------------- Avatares ----------------
  private readonly PALETA = [
    { bg: '#DFDBF7', fg: '#3A2F8C' }, { bg: '#C9E9DA', fg: '#0F5138' },
    { bg: '#F7D9C9', fg: '#8A3A16' }, { bg: '#FBE3B0', fg: '#7A5008' },
    { bg: '#CFE0F5', fg: '#1B4A7E' }, { bg: '#E3D6F0', fg: '#4E2A73' },
    { bg: '#F5D6E2', fg: '#8A2F4E' }, { bg: '#D6EAD2', fg: '#2C5B26' }
  ];

  /** Color estable por nombre: la misma persona siempre con el mismo color. */
  private colorDe(nombre: string) {
    let suma = 0;
    for (let i = 0; i < nombre.length; i++) suma = (suma + nombre.charCodeAt(i)) % 997;
    return this.PALETA[suma % this.PALETA.length];
  }

  private inicialesDe(nombre: string): string {
    const partes = (nombre || '?').split(' ').filter(Boolean);
    if (!partes.length) return '?';
    if (partes.length === 1) return partes[0].charAt(0).toUpperCase();
    return (partes[0].charAt(0) + partes[1].charAt(0)).toUpperCase();
  }

  // ---------------- Datos derivados ----------------
  /** Todas las personas con sus tareas ya clasificadas, sin filtros aplicados. */
  private personas = computed<PersonaVista[]>(() => {
    const mapa = new Map<string, PersonaVista>();

    for (const c of this.lista()) {
      const nombre = (c?.assigned || 'Sin asignar').trim();
      const clave = nombre.toLowerCase();

      if (!mapa.has(clave)) {
        const col = this.colorDe(nombre);
        mapa.set(clave, {
          id: clave, nombre, iniciales: this.inicialesDe(nombre),
          colorFondo: col.bg, colorTexto: col.fg, tareas: [],
          total: 0, completadas: 0, vencidas: 0, hoy: 0, programadas: 0,
          porcentaje: 0, mezcla: ''
        });
      }

      const p = mapa.get(clave)!;
      const estado = this.estadoDe(c);
      const { tipo, etiqueta } = this.tipoDe(c);

      p.tareas.push({
        ref: c,
        titulo: c?.name || 'Sin nombre',
        sucursal: c?.store || '',
        estado, tipo, etiquetaTipo: etiqueta,
        cuando: this.cuandoDe(c, estado),
        progreso: Number(c?.calcProgreso) || 0,
        completados: Number(c?.calcCompletados) || 0,
        totalItems: (c?.items || []).length
      });
    }

    for (const p of mapa.values()) {
      p.total = p.tareas.length;
      p.completadas = p.tareas.filter(t => t.estado === 'completada').length;
      p.vencidas = p.tareas.filter(t => t.estado === 'vencida').length;
      p.hoy = p.tareas.filter(t => t.estado === 'hoy').length;
      p.programadas = p.tareas.filter(t => t.estado === 'programada').length;
      p.porcentaje = p.total
        ? Math.round(p.tareas.reduce((a, t) => a + t.progreso, 0) / p.total)
        : 0;

      const rutinas = p.tareas.filter(t => t.tipo === 'rutina').length;
      const unicas = p.total - rutinas;
      const partes: string[] = [];
      if (rutinas) partes.push(`${rutinas} rutina${rutinas > 1 ? 's' : ''}`);
      if (unicas) partes.push(`${unicas} única${unicas > 1 ? 's' : ''}`);
      p.mezcla = partes.join(' · ');
    }

    return [...mapa.values()];
  });

  /** Resumen del día: conteo por estado sobre TODO, sin filtros. */
  resumen = computed(() => {
    let completada = 0, hoy = 0, vencida = 0, programada = 0;
    for (const p of this.personas()) {
      completada += p.completadas; hoy += p.hoy;
      vencida += p.vencidas; programada += p.programadas;
    }
    const total = completada + hoy + vencida + programada;
    return {
      total, completada, hoy, vencida, programada,
      // NULL y no 0 cuando no hay nada emitido: un 0% afirma "se midio y
      // salio cero", que se lee como "nadie trabajo". Sin emision no hubo
      // medicion, y son dos frases distintas.
      porcentaje: total ? Math.round((completada / total) * 100) : null
    };
  });

  /** Tareas de una persona que pasan los filtros actuales. */
  tareasVisibles(p: PersonaVista): TareaVista[] {
    const f = this.filtro();
    const tf = this.tipoFiltro();
    return p.tareas.filter(t => {
      if (f !== 'todas' && t.estado !== f) return false;
      if (tf !== 'todos' && t.tipo !== tf) return false;
      return true;
    });
  }

  /** Personas a mostrar, ya ordenadas y filtradas. */
  personasVisibles = computed<PersonaVista[]>(() => {
    const modo = this.orden();
    const lista = this.personas().filter(p => this.tareasVisibles(p).length > 0);

    return [...lista].sort((a, b) => {
      if (modo === 'nombre') return a.nombre.localeCompare(b.nombre);
      if (modo === 'avance') return a.porcentaje - b.porcentaje;
      // Riesgo: primero quien tiene vencidas, luego pendientes de hoy, luego peor avance.
      if (b.vencidas !== a.vencidas) return b.vencidas - a.vencidas;
      if (b.hoy !== a.hoy) return b.hoy - a.hoy;
      return a.porcentaje - b.porcentaje;
    });
  });

  /** Cuántas tareas caen en cada filtro, para los contadores de los chips. */
  conteoFiltros = computed(() => {
    const r = this.resumen();
    return {
      todas: r.total, vencida: r.vencida, hoy: r.hoy,
      completada: r.completada, programada: r.programada
    };
  });

  // ---------------- Interacción ----------------
  alternar(id: string) {
    this.abiertoId.set(this.abiertoId() === id ? null : id);
  }

  cerrar() { this.abiertoId.set(null); }

  claseEstado(e: Estado): string {
    return { vencida: 'rojo', hoy: 'ambar', completada: 'verde', programada: 'gris' }[e];
  }

  etiquetaEstado(e: Estado): string {
    return { vencida: 'Vencida', hoy: 'Hoy', completada: 'Completada', programada: 'Programada' }[e];
  }

  colorBarra(t: TareaVista): string {
    if (t.estado === 'completada') return '#1F7A4D';
    if (t.estado === 'vencida') return 'var(--bad-fg)';
    if (t.estado === 'programada') return '#CBD0CB';
    return '#E08A00';
  }

  colorMedidor(p: PersonaVista): string {
    if (p.vencidas) return 'var(--bad-fg)';
    if (p.porcentaje === 100) return '#1F7A4D';
    return '#E08A00';
  }

  /** trackBy para no repintar tarjetas en cada poll de 20 segundos. */
  trackPersona = (_: number, p: PersonaVista) => p.id;
  trackTarea = (_: number, t: TareaVista) => t.ref?.id || t.titulo;
}
