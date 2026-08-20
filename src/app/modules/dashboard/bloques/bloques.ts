import { Component, signal, computed, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { ApiService } from '../../../shared/api.service';
import { UsuariosService } from '../../../shared/usuarios.service';

/**
 * MODULO BLOQUES DE TRABAJO — creación de tareas por tramos de horario.
 *
 * El día se parte en bloques (Mañana 07:00-11:00, Tarde...), sin límite de
 * cuántos. El HORARIO lo manda el bloque y las tareas de dentro lo heredan: así
 * no hay que ponerle hora a cada tarea.
 *
 * Cada tarea puede ser de UNA VEZ (con su fecha) o RUTINA (con su frecuencia),
 * igual que las tareas normales de la app.
 *
 * Los bloques se asignan como las rutinas: sucursales + por rol o por personas.
 * El backend (api/bloques-generar.js) los reparte cada día como checklists
 * normales, así que el radar del celular, el bot de WhatsApp, el ranking y las
 * estadísticas los ven sin cambios.
 */
const FRECUENCIAS = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral', 'PorEvento'];
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const ROLES = ['trabajador', 'supervisor', 'admin'];

@Component({
  selector: 'app-bloques',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './bloques.html',
  styleUrls: ['./bloques.css'],
})
export class BloquesComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private usuariosSvc = inject(UsuariosService);

  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null;
  bloques = signal<any[]>([]);
  cargando = signal<boolean>(true);
  guardando = false;

  frecuencias = FRECUENCIAS;
  dias = DIAS;
  roles = ROLES;

  readonly todasLasSucursales = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD',
    'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO', 'CEDIS'
  ];

  // Modales
  modalBloque = false;
  formBloque: any = this.bloqueVacio();
  modalTarea = false;
  formTarea: any = this.tareaVacia();
  modalAsignacion = false;
  formAsignacion: any = this.asignacionVacia();

  /** Qué bloque se está tocando en los modales de tarea/asignación. */
  bloqueActual: any = null;

  get esAdmin(): boolean { return this.currentUser?.rol === 'admin'; }
  /** Mismo criterio que el backend: admin o quien pueda crear checklists. */
  get puedeEditar(): boolean {
    return this.esAdmin || this.currentUser?.puedeCrearChecklists === true;
  }

  personal = computed<any[]>(() =>
    this.usuariosSvc.usuarios()
      .filter(u => u.activo !== false)
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''))));

  /** Sucursales que este usuario puede tocar (los globales ven todas). */
  sucursalesDisponibles = computed<string[]>(() => {
    const u = this.currentUser;
    if (!u) return [];
    if (u.rol === 'admin' && (u.alcance !== 'sucursales')) return [...this.todasLasSucursales];
    const permitidas = (u.sucursales || []).map(String);
    if (permitidas.includes('General (Acceso Total)')) return [...this.todasLasSucursales];
    return this.todasLasSucursales.filter(s => permitidas.includes(s));
  });

  totalTareas = computed(() =>
    this.bloques().reduce((n, b) => n + (b.tareas || []).length, 0));
  bloquesActivos = computed(() => this.bloques().filter(b => b.activo !== false).length);
  sinAsignar = computed(() =>
    this.bloques().filter(b => b.activo !== false && !(b.asignaciones || []).length));

  async ngOnInit() {
    try { this.currentUser = JSON.parse(localStorage.getItem('md_sesion_actual') || 'null'); }
    catch { this.currentUser = null; }
    this.usuariosSvc.iniciar();
    await this.cargar();
  }

  ngOnDestroy() { this.usuariosSvc.detener(); }

  async cargar() {
    this.cargando.set(true);
    try {
      const r = await this.api.get('/api/bloques');
      this.bloques.set(r.bloques || []);
    } catch (e: any) {
      this.avisoError(e, 'No pude cargar los bloques.');
    } finally {
      this.cargando.set(false);
    }
  }

  private avisoError(e: any, encabezado: string) {
    const sinRed = e?.sinRed === true;
    Swal.fire({
      icon: sinRed ? 'warning' : 'error',
      title: sinRed ? 'Sin conexión' : 'Ups',
      text: sinRed
        ? `${encabezado} Revisa tu conexión e inténtalo de nuevo.`
        : `${encabezado} ${e?.message || ''}`.trim(),
    });
  }

  // --- BLOQUE ----------------------------------------------------------------

  bloqueVacio() {
    return {
      id: '', nombre: '', horaInicio: '07:00', horaFin: '11:00',
      activo: true,
      // Dias en que opera el bloque. 'diario' con nada excluido = los siete,
      // que es como se comportaban los bloques antes de esta opcion.
      diasModo: 'diario' as 'diario' | 'algunos',
      diasExcluidos: [] as string[],
      diasSemana: [] as string[],
    };
  }

  abrirNuevoBloque() {
    this.formBloque = this.bloqueVacio();
    // Se propone el siguiente hueco del día: el bloque nuevo arranca donde
    // termina el último, que es como se suele armar la jornada.
    const ultimo = [...this.bloques()].sort((a, b) => String(a.horaFin || '').localeCompare(String(b.horaFin || ''))).pop();
    if (ultimo?.horaFin) {
      this.formBloque.horaInicio = ultimo.horaFin;
      const h = Number(String(ultimo.horaFin).slice(0, 2));
      this.formBloque.horaFin = String(Math.min(h + 4, 23)).padStart(2, '0') + ':00';
    }
    this.modalBloque = true;
  }

  editarBloque(b: any) {
    this.formBloque = {
      id: b.id, nombre: b.nombre || '', horaInicio: b.horaInicio || '07:00',
      horaFin: b.horaFin || '11:00', activo: b.activo !== false,
      diasModo: b.diasModo === 'algunos' ? 'algunos' : 'diario',
      diasExcluidos: [...(b.diasExcluidos || [])],
      diasSemana: [...(b.diasSemana || [])],
    };
    this.modalBloque = true;
  }

  /** Marca/desmarca un dia en el que el bloque NO se hace (modo diario). */
  alternarDiaExcluido(d: string) {
    const i = this.formBloque.diasExcluidos.indexOf(d);
    if (i >= 0) this.formBloque.diasExcluidos.splice(i, 1);
    else this.formBloque.diasExcluidos.push(d);
  }

  /** Marca/desmarca un dia en el que el bloque SI se hace (modo algunos). */
  alternarDiaBloque(d: string) {
    const i = this.formBloque.diasSemana.indexOf(d);
    if (i >= 0) this.formBloque.diasSemana.splice(i, 1);
    else this.formBloque.diasSemana.push(d);
  }

  /** Resumen de los dias de un bloque, para la tarjeta de la lista. */
  diasDelBloque(b: any): string {
    if (b?.diasModo === 'algunos') {
      const d = (b.diasSemana || []).filter((x: string) => DIAS.includes(x));
      if (!d.length) return 'Sin días: no se reparte';
      // En el orden de la semana, no en el que se fueron marcando.
      return 'Solo ' + DIAS.filter(x => d.includes(x)).map(x => x.slice(0, 3)).join(', ');
    }
    const ex = (b?.diasExcluidos || []).filter((x: string) => DIAS.includes(x));
    if (!ex.length) return 'Diario';
    return 'Diario, menos ' + DIAS.filter(x => ex.includes(x)).map(x => x.slice(0, 3)).join(', ');
  }

  async guardarBloque() {
    if (this.guardando) return;
    if (!this.formBloque.nombre.trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta el nombre', text: 'Ponle nombre al bloque (por ejemplo "Mañana").' });
      return;
    }
    if (this.formBloque.horaFin <= this.formBloque.horaInicio) {
      Swal.fire({ icon: 'warning', title: 'Revisa el horario', text: 'La hora de fin tiene que ser posterior a la de inicio.' });
      return;
    }
    if (this.formBloque.diasModo === 'algunos' && !this.formBloque.diasSemana.length) {
      Swal.fire({
        icon: 'warning', title: 'Faltan los días',
        text: 'Elige al menos un día en que se haga el bloque, o déjalo en Diario.',
      });
      return;
    }
    if (this.formBloque.diasModo === 'diario'
        && this.formBloque.diasExcluidos.length === this.dias.length) {
      Swal.fire({
        icon: 'warning', title: 'Así no se repartiría nunca',
        text: 'Excluiste los siete días. Deja al menos uno sin excluir.',
      });
      return;
    }
    this.guardando = true;
    try {
      await this.api.post('/api/bloques', { ...this.formBloque, id: this.formBloque.id || undefined });
      this.modalBloque = false;
      await this.cargar();
    } catch (e: any) {
      this.avisoError(e, 'No se pudo guardar el bloque.');
    } finally {
      this.guardando = false;
    }
  }

  async borrarBloque(b: any) {
    const r = await Swal.fire({
      icon: 'warning', title: `¿Borrar el bloque "${b.nombre}"?`,
      html: 'Se van con él sus tareas y sus asignaciones, y dejará de repartirse.<br><br>'
        + 'Las tareas <b>ya repartidas</b> de días anteriores se conservan.',
      showCancelButton: true, confirmButtonText: 'Borrar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#DC2626',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.del('/api/bloques?id=' + encodeURIComponent(b.id));
      await this.cargar();
    } catch (e: any) {
      this.avisoError(e, 'No se pudo borrar el bloque.');
    }
  }

  async alternarBloque(b: any) {
    try {
      await this.api.post('/api/bloques', { id: b.id, activo: b.activo === false });
      await this.cargar();
    } catch (e: any) {
      this.avisoError(e, 'No se pudo cambiar el bloque.');
    }
  }

  // --- TAREA -----------------------------------------------------------------

  tareaVacia() {
    const hoy = new Date();
    const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    return {
      id: '', bloqueId: '', texto: '', tipo: 'rutina',
      frecuencia: 'Diaria', diasSemana: [] as string[], diaMes: null as number | null,
      fecha, requiereFoto: false, orden: null as number | null, activo: true,
    };
  }

  abrirNuevaTarea(b: any) {
    this.bloqueActual = b;
    this.formTarea = this.tareaVacia();
    this.formTarea.bloqueId = b.id;
    this.formTarea.orden = (b.tareas || []).length + 1;
    this.modalTarea = true;
  }

  editarTarea(b: any, t: any) {
    this.bloqueActual = b;
    this.formTarea = {
      id: t.id, bloqueId: b.id, texto: t.texto || '', tipo: t.tipo || 'rutina',
      frecuencia: t.frecuencia || 'Diaria', diasSemana: [...(t.diasSemana || [])],
      diaMes: t.diaMes ?? null, fecha: t.fecha || this.tareaVacia().fecha,
      requiereFoto: t.requiereFoto === true, orden: t.orden ?? null, activo: t.activo !== false,
    };
    this.modalTarea = true;
  }

  alternarDia(d: string) {
    const i = this.formTarea.diasSemana.indexOf(d);
    if (i >= 0) this.formTarea.diasSemana.splice(i, 1);
    else this.formTarea.diasSemana.push(d);
  }

  /**
   * Vinetas y numeracion que se le quitan a cada renglon pegado.
   *
   * Esta escrita para NO comerse texto de verdad: exige espacio despues del
   * guion suelto, para que "5-6 vitrinas" o "20 cajas al anden" queden
   * intactos. Probado con 16 casos.
   */
  private static readonly VINETA = /^\s*(?:[-*•·]+\s*|\d+\s*[.)]\s*-?\s*|\d+\s*-\s+)/;

  /**
   * Las tareas que se van a crear con lo que hay escrito: UNA POR RENGLON.
   *
   * Asi se puede pegar la lista completa de una vez en vez de abrir el modal
   * veinte veces. Se limpian las vinetas y la numeracion porque lo normal es
   * pegar desde Word o WhatsApp ("1.- Barrer", "- Trapear"), y se quitan los
   * repetidos para no crear la misma tarea dos veces por un descuido.
   */
  textosDeTarea(): string[] {
    const vistos = new Set<string>();
    const salida: string[] = [];
    for (const renglon of String(this.formTarea.texto || '').split('\n')) {
      const limpio = renglon.replace(BloquesComponent.VINETA, '').trim();
      if (!limpio) continue;
      const llave = limpio.toLowerCase();
      if (vistos.has(llave)) continue;
      vistos.add(llave);
      salida.push(limpio);
    }
    return salida;
  }

  /** Cuantas se crearian ahora mismo (para el contador del modal). */
  cuantasTareas(): number {
    return this.formTarea.id ? 1 : this.textosDeTarea().length;
  }

  async guardarTarea(seguirAgregando = false) {
    if (this.guardando) return;
    if (!this.formTarea.texto.trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta la tarea', text: 'Escribe qué hay que hacer.' });
      return;
    }
    if (this.formTarea.tipo === 'rutina') {
      const f = this.formTarea.frecuencia;
      if ((f === 'Semanal' || f === 'Catorcenal') && !this.formTarea.diasSemana.length) {
        Swal.fire({ icon: 'warning', title: 'Faltan los días', text: 'Elige en qué días se repite.' });
        return;
      }
      if ((f === 'Mensual' || f === 'Trimestral') && !this.formTarea.diaMes) {
        Swal.fire({ icon: 'warning', title: 'Falta el día del mes', text: 'Dinos qué día del mes (1 al 31).' });
        return;
      }
    }
    // Editar es siempre UNA tarea; crear pueden ser todas las que se escribieron.
    const textos = this.formTarea.id
      ? [String(this.formTarea.texto || '').trim()]
      : this.textosDeTarea();
    if (!textos.length) {
      Swal.fire({ icon: 'warning', title: 'Falta la tarea', text: 'Escribe qué hay que hacer.' });
      return;
    }

    this.guardando = true;
    let creadas = 0;
    try {
      // De una en una y en orden, para que queden en la secuencia en que se
      // escribieron. Si una truena, las anteriores YA quedaron guardadas: por eso
      // el aviso de error dice cuantas alcanzaron a entrar.
      const base = (this.bloqueActual?.tareas || []).length;
      for (let i = 0; i < textos.length; i++) {
        await this.api.post('/api/bloques?recurso=tarea', {
          ...this.formTarea,
          id: this.formTarea.id || undefined,
          texto: textos[i],
          orden: this.formTarea.id ? this.formTarea.orden : base + i + 1,
        });
        creadas++;
      }

      if (seguirAgregando) {
        // Se queda abierto y con la misma configuracion: solo se limpia el texto,
        // que es lo que cambia de una tarea a otra.
        this.formTarea.texto = '';
        await this.cargar();
        this.bloqueActual = this.bloques().find(b => b.id === this.formTarea.bloqueId) || this.bloqueActual;
      } else {
        this.modalTarea = false;
        await this.cargar();
      }

      if (creadas > 1) {
        Swal.fire({
          icon: 'success', title: `${creadas} tareas agregadas`,
          timer: 1400, showConfirmButton: false,
        });
      }
    } catch (e: any) {
      this.avisoError(e, creadas
        ? `Se agregaron ${creadas} de ${textos.length} tareas; la siguiente no se pudo guardar.`
        : 'No se pudo guardar la tarea.');
      if (creadas) await this.cargar();
    } finally {
      this.guardando = false;
    }
  }

  async borrarTarea(t: any) {
    const r = await Swal.fire({
      icon: 'warning', title: '¿Borrar esta tarea?', text: t.texto,
      showCancelButton: true, confirmButtonText: 'Borrar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#DC2626',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.del('/api/bloques?tarea=' + encodeURIComponent(t.id));
      await this.cargar();
    } catch (e: any) {
      this.avisoError(e, 'No se pudo borrar la tarea.');
    }
  }

  // --- ASIGNACION ------------------------------------------------------------

  asignacionVacia() {
    return {
      id: '', bloqueId: '', sucursales: [] as string[], modo: 'porRol',
      rolObjetivo: 'trabajador', personas: [] as string[],
      fechaInicio: '', fechaFin: '', activa: true,
    };
  }

  abrirNuevaAsignacion(b: any) {
    this.bloqueActual = b;
    this.formAsignacion = this.asignacionVacia();
    this.formAsignacion.bloqueId = b.id;
    this.modalAsignacion = true;
  }

  editarAsignacion(b: any, a: any) {
    this.bloqueActual = b;
    this.formAsignacion = {
      id: a.id, bloqueId: b.id, sucursales: [...(a.sucursales || [])],
      modo: a.modo || 'porRol', rolObjetivo: a.rolObjetivo || 'trabajador',
      personas: [...(a.personas || [])],
      fechaInicio: a.fechaInicio || '', fechaFin: a.fechaFin || '', activa: a.activa !== false,
    };
    this.modalAsignacion = true;
  }

  alternarSucursal(s: string) {
    const i = this.formAsignacion.sucursales.indexOf(s);
    if (i >= 0) this.formAsignacion.sucursales.splice(i, 1);
    else this.formAsignacion.sucursales.push(s);
  }
  todasLas() { this.formAsignacion.sucursales = [...this.sucursalesDisponibles()]; }
  ninguna() { this.formAsignacion.sucursales = []; }

  alternarPersona(uid: string) {
    const i = this.formAsignacion.personas.indexOf(uid);
    if (i >= 0) this.formAsignacion.personas.splice(i, 1);
    else this.formAsignacion.personas.push(uid);
  }

  async guardarAsignacion() {
    if (this.guardando) return;
    if (!this.formAsignacion.sucursales.length) {
      Swal.fire({ icon: 'warning', title: 'Faltan sucursales', text: 'Elige al menos una sucursal.' });
      return;
    }
    if (this.formAsignacion.modo === 'porPersonas' && !this.formAsignacion.personas.length) {
      Swal.fire({ icon: 'warning', title: 'Faltan personas', text: 'Elige a quién se le asigna.' });
      return;
    }
    this.guardando = true;
    try {
      const cuerpo: any = { ...this.formAsignacion, id: this.formAsignacion.id || undefined };
      if (!cuerpo.fechaInicio) delete cuerpo.fechaInicio;
      if (!cuerpo.fechaFin) delete cuerpo.fechaFin;
      await this.api.post('/api/bloques?recurso=asignacion', cuerpo);
      this.modalAsignacion = false;
      await this.cargar();
      Swal.fire({
        icon: 'success', title: 'Asignado',
        text: 'El bloque se empezará a repartir en el siguiente reparto (cada 15 minutos).',
        timer: 2800, showConfirmButton: false,
      });
    } catch (e: any) {
      this.avisoError(e, 'No se pudo guardar la asignación.');
    } finally {
      this.guardando = false;
    }
  }

  async borrarAsignacion(a: any) {
    const r = await Swal.fire({
      icon: 'warning', title: '¿Quitar esta asignación?',
      text: 'El bloque dejará de repartirse a esas personas.',
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#DC2626',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.del('/api/bloques?asignacion=' + encodeURIComponent(a.id));
      await this.cargar();
    } catch (e: any) {
      this.avisoError(e, 'No se pudo quitar la asignación.');
    }
  }

  // --- Presentación ----------------------------------------------------------

  /** Cuánto dura el bloque, en texto ("4 h", "1 h 30 min"). */
  duracion(b: any): string {
    const min = (h: string) => Number(String(h || '0').slice(0, 2)) * 60 + Number(String(h || '0').slice(3, 5));
    const d = min(b.horaFin) - min(b.horaInicio);
    if (!Number.isFinite(d) || d <= 0) return '';
    const h = Math.floor(d / 60), m = d % 60;
    return (h ? h + ' h' : '') + (m ? (h ? ' ' : '') + m + ' min' : '');
  }

  /** Cómo se repite una tarea, en una frase corta. */
  cuando(t: any): string {
    if (t.tipo === 'unica') return 'Solo el ' + this.fechaCorta(t.fecha);
    const f = t.frecuencia || 'Diaria';
    if (f === 'Diaria') return 'Todos los días';
    if (f === 'Semanal' || f === 'Catorcenal') {
      const dias = (t.diasSemana || []).join(', ');
      return (f === 'Catorcenal' ? 'Cada 14 días: ' : 'Cada semana: ') + (dias || 'sin días');
    }
    if (f === 'Mensual') return 'Cada mes, el día ' + (t.diaMes ?? '?');
    if (f === 'Trimestral') return 'Cada 3 meses, el día ' + (t.diaMes ?? '?');
    return 'Cuando se indique (por evento)';
  }

  /** A quién le toca, en una frase. */
  aQuien(a: any): string {
    const donde = (a.sucursales || []).length > 3
      ? `${a.sucursales.length} sucursales`
      : (a.sucursales || []).join(', ');
    if (a.modo === 'porPersonas') {
      const nombres = (a.personas || [])
        .map((uid: string) => this.personal().find(p => (p.id || p.uid) === uid)?.nombre)
        .filter(Boolean);
      const quien = nombres.length > 2 ? `${nombres.length} personas` : nombres.join(', ');
      return `${quien || 'nadie'} — ${donde}`;
    }
    return `Todos los ${a.rolObjetivo || '?'} — ${donde}`;
  }

  nombreDe(uid: string): string {
    return this.personal().find(p => (p.id || p.uid) === uid)?.nombre || uid;
  }

  fechaCorta(f: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(f || ''));
    if (!m) return String(f || '');
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${Number(m[3])} ${meses[Number(m[2]) - 1]}`;
  }
}
