/**
 * 📈 PRODUCTIVIDAD CONTRA EL TURNO
 *
 * Lo que se hizo, cruzado con cuándo se debía estar trabajando. El horario sale
 * de `horarios_sucursal` de Mega Talento, que es donde RH lo captura.
 *
 * ─── QUÉ AÑADE SOBRE EL TABLERO QUE YA HABÍA ────────────────────────────────
 * El Dashboard dice cuántos puntos hay hechos. Eso deja tres situaciones muy
 * distintas viéndose idénticas:
 *
 *   · quien hizo sus 20 puntos a lo largo del turno,
 *   · quien palomeó los mismos 20 en dos minutos al final,
 *   · quien los marcó a las 23:40 en una plaza que cierra a las 18:00.
 *
 * Las tres salen al 100%. Con el horario enfrente, se separan.
 *
 * ─── LA PANTALLA NO ACUSA A NADIE ───────────────────────────────────────────
 * Y eso está en el diseño, no solo en este comentario. Las columnas dicen
 * "fuera de turno" y "de una sentada", no "sospechoso": marcar todo al final
 * puede ser lo que el trabajo exige —una cajera no va a sacar el teléfono entre
 * dos clientes— y trabajar fuera de horario puede ser un turno cubierto. Se
 * separa para que alguien mire, no para repartir culpas.
 */

import { Component, signal, computed, effect, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { ApiService } from '../../../shared/api.service';
import { UsuariosService } from '../../../shared/usuarios.service';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import { fueraDeOperacion } from '../../../shared/medicion.util';
import { guardarListaCache, leerListaCache } from '../../../shared/lista-cache.util';
import { avisoDeFalla, AvisoDatos } from '../../../shared/aviso-datos.util';
import { HorarioSucursal, SUCURSAL_A_TALENTO } from '../../../shared/horarios-sucursal.util';
import { resolverPuesto } from '../../../shared/puesto.util';
import { nombrePuesto } from '../../../shared/organigrama.catalogo';
import { medir, pct, Medicion, ventanaDeTurno } from '../../../shared/productividad.util';

@Component({
  selector: 'app-productividad',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './productividad.html',
  styleUrls: ['./productividad.css'],
})
export class ProductividadComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private usuariosSvc = inject(UsuariosService);

  currentUser: any = null;
  isMenuOpen = false;

  cargando = signal(true);
  sinConexion = signal(false);
  aviso = signal<AvisoDatos>({ titulo: '', detalle: '' });

  private checklists = signal<any[]>([]);
  private horarios = signal<HorarioSucursal[]>([]);
  private usuarios = signal<any[]>([]);

  /** Cuántos días atrás se mide. 7 por defecto: una semana da patrón sin diluir. */
  dias = signal(7);
  /** 'sucursal' | 'persona' */
  vista = signal<'sucursal' | 'persona'>('sucursal');
  busqueda = signal('');

  private destructores: (() => void)[] = [];

  /**
   * Los usuarios se siguen, no se leen una vez. Leerlos en ngOnInit dejaba el
   * mapa de puestos vacio cuando el servicio contestaba despues -que es lo
   * normal- y la columna del puesto salia en blanco sin ninguna senal de por que.
   */
  private _usuariosEffect = effect(() => {
    this.usuarios.set(this.usuariosSvc.usuarios() || []);
  });

  ngOnInit() {
    try { this.currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch { this.currentUser = null; }
    this.cargar();
  }

  ngOnDestroy() { this.destructores.forEach(f => f()); }

  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  // ==========================================================================
  //  DATOS
  // ==========================================================================
  private toYmd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private async cargar() {
    this.cargando.set(true);

    // Los horarios primero y una sola vez: sin ellos la mitad de la pantalla no
    // tiene sentido, pero su falta NO impide mostrar cumplimiento.
    this.api.get('/api/horarios-sucursal')
      .then((r: any) => this.horarios.set(Array.isArray(r?.items) ? r.items : []))
      .catch(() => this.horarios.set([]));

    const hasta = new Date();
    const desde = new Date();
    desde.setDate(desde.getDate() - (this.dias() - 1));
    const desdeISO = this.toYmd(desde);
    const hastaISO = this.toYmd(hasta);

    const claveCache = 'productividad_' + desdeISO + '_' + this.dias();
    const claveUsuario = String(this.currentUser?.uid || this.currentUser?.id || this.currentUser?.usuario || 'anon');

    const recargar = async () => {
      let falla: any = null;
      const resp = await this.api
        .get('/api/checklists?desde=' + encodeURIComponent(desdeISO) + '&hasta=' + encodeURIComponent(hastaISO))
        .catch((e: any) => { falla = e; console.error('[productividad] poll', e); return null; });

      if (!resp) {
        // No se vacía la tabla por una falla de red: se avisa y, si no hay nada,
        // se hidrata del último buen dato de este mismo rango.
        this.sinConexion.set(true);
        this.aviso.set(avisoDeFalla(falla));
        if (this.checklists().length === 0) {
          const cache = leerListaCache(claveCache, claveUsuario, 24 * 7);
          if (cache && cache.length) this.checklists.set(cache);
        }
        this.cargando.set(false);
        return;
      }

      this.sinConexion.set(false);
      const arr = (resp.checklists || []).filter((c: any) => !fueraDeOperacion(c));
      this.checklists.set(arr);
      guardarListaCache(claveCache, claveUsuario, arr);
      this.cargando.set(false);
    };

    if (this.checklists().length === 0) {
      const ini = leerListaCache(claveCache, claveUsuario, 24 * 7);
      if (ini && ini.length) this.checklists.set(ini);
    }
    recargar();
    const id = setInterval(recargar, 30000);
    this.destructores.push(() => clearInterval(id));
  }

  cambiarDias(n: number) {
    this.dias.set(n);
    this.destructores.forEach(f => f());
    this.destructores = [];
    this.checklists.set([]);
    this.cargar();
  }

  // ==========================================================================
  //  MEDICIÓN
  // ==========================================================================
  /** Puesto por nombre, para poner al lado de cada colaborador. */
  private puestoPorNombre = computed(() => {
    const m = new Map<string, string>();
    for (const u of this.usuarios()) {
      if (!u?.nombre) continue;
      const r = resolverPuesto(u);
      const p = r.puestoId ? nombrePuesto(r.puestoId) : (u.cargo || '');
      if (p) m.set((u.nombre || '').trim().toLowerCase(), p);
    }
    return m;
  });

  /** Solo lo que este usuario tiene permitido ver. */
  private visibles = computed(() => {
    const todo = this.checklists();
    if (esAdminGlobal(this.currentUser)) return todo;
    const permitidas = sucursalesPermitidas(this.currentUser) || [];
    if (!permitidas.length) return todo;
    const set = new Set(permitidas.map((s: string) => (s || '').trim().toLowerCase()));
    return todo.filter(c => set.has((c.store || '').trim().toLowerCase()));
  });

  porSucursal = computed<Medicion[]>(() =>
    medir(this.visibles(), this.horarios(), c => c.store || '')
      .sort((a, b) => (pct(b.hechos, b.asignados) ?? -1) - (pct(a.hechos, a.asignados) ?? -1))
  );

  porPersona = computed<Medicion[]>(() => {
    const fichas = this.puestoPorNombre();
    const term = this.busqueda().trim().toLowerCase();
    const filas = medir(
      this.visibles(), this.horarios(),
      c => c.assigned || '',
      c => c._puestoId ? nombrePuesto(c._puestoId) : (fichas.get((c.assigned || '').trim().toLowerCase()) || ''),
    );
    const f = term ? filas.filter(x => x.clave.toLowerCase().includes(term)
      || (x.puesto || '').toLowerCase().includes(term)) : filas;
    return f.sort((a, b) => (pct(b.hechos, b.asignados) ?? -1) - (pct(a.hechos, a.asignados) ?? -1));
  });

  /**
   * Los colaboradores AGRUPADOS POR SUCURSAL.
   *
   * Una lista plana de 150 nombres no se lee: para saber como va una plaza hay
   * que ir cazando sus filas entre las de las demas. Agrupada, cada Encargada ve
   * su gente junta y se puede comparar plaza contra plaza sin cambiar de vista.
   *
   * El grupo trae su propio resumen para no obligar a sumar de cabeza.
   */
  gruposPersona = computed(() => {
    const filas = this.porPersona();
    const mapa = new Map<string, Medicion[]>();
    for (const m of filas) {
      const k = (m.sucursal || '(sin sucursal)').trim();
      const arr = mapa.get(k) || [];
      arr.push(m);
      mapa.set(k, arr);
    }

    const grupos = [...mapa.entries()].map(([sucursal, gente]) => {
      const asignados = gente.reduce((a, m) => a + m.asignados, 0);
      const hechos = gente.reduce((a, m) => a + m.hechos, 0);
      const fuera = gente.reduce((a, m) => a + m.fueraTurno, 0);
      const sentadas = gente.filter(m => this.deUnaSentada(m)).length;
      return {
        sucursal,
        gente: gente.slice().sort((a, b) =>
          (pct(b.hechos, b.asignados) ?? -1) - (pct(a.hechos, a.asignados) ?? -1)
          || a.clave.localeCompare(b.clave)),
        personas: gente.length,
        asignados, hechos, fuera, sentadas,
        cumplimiento: pct(hechos, asignados),
        horario: this.horarioTexto(sucursal),
      };
    });

    // Lo que va peor arriba, como el Dashboard tras la observacion del jefe.
    // '(sin sucursal)' al final: no es una plaza, es un dato que falta.
    return grupos.sort((a, b) => {
      if (a.sucursal === '(sin sucursal)') return 1;
      if (b.sucursal === '(sin sucursal)') return -1;
      return (a.cumplimiento ?? 101) - (b.cumplimiento ?? 101);
    });
  });

  /** Resumen honesto de qué tan medible es lo que se está viendo. */
  cobertura = computed(() => {
    const filas = this.porSucursal();
    const conHorario = filas.filter(f => !!SUCURSAL_A_TALENTO[(f.clave || '').trim()]
      && f.diasSinHorario < f.dias);
    const sinHorario = filas.filter(f => !conHorario.includes(f));
    const hechos = filas.reduce((a, f) => a + f.hechos, 0);
    const conSello = filas.reduce((a, f) => a + f.conSello, 0);
    return {
      sucursales: filas.length,
      conHorario: conHorario.length,
      sinHorario: sinHorario.map(f => f.clave),
      hechos,
      conSello,
      sinSello: hechos - conSello,
      pctSello: pct(conSello, hechos),
    };
  });

  // ==========================================================================
  //  AYUDAS DE PLANTILLA
  // ==========================================================================
  pct(parte: number, total: number): number | null { return pct(parte, total); }

  /** El horario que se está usando para esa sucursal, para mostrarlo. */
  horarioTexto(sucursal: string): string {
    const hoy = this.toYmd(new Date());
    const v = ventanaDeTurno(sucursal, hoy, this.horarios());
    if (!v) return 'sin horario capturado';
    return v.textoEntrada + ' – ' + v.textoSalida;
  }

  /**
   * ¿Esta fila tiene horario capturado en Mega Talento?
   *
   * Hace falta distinguirlo de "no hay nada hecho todavia". Las dos cosas
   * dejaban la columna de turno sin numero, y al ponerles la misma etiqueta la
   * tabla se contradecia a si misma: la fila de Morelia Madero mostraba
   * "08:00 - 18:00" en una columna y "sin horario" en la siguiente.
   */
  tieneHorario(m: Medicion): boolean {
    return m.dias > 0 && m.diasSinHorario < m.dias;
  }

  /** Clase de color por porcentaje. Sin dato NO se pinta de rojo. */
  claseNivel(p: number | null): string {
    if (p == null) return 'pr-nd';
    if (p >= 85) return 'pr-bien';
    if (p >= 60) return 'pr-medio';
    return 'pr-mal';
  }

  /**
   * ¿Los sellos del día caben en una sentada? Menos de 5 minutos para 5+ puntos
   * es la firma de haber palomeado todo junto. NO se llama trampa: se marca.
   */
  deUnaSentada(m: Medicion): boolean {
    return m.minutosActividad != null && m.minutosActividad < 5 && m.conSello >= 5;
  }

  trackClave = (_: number, m: Medicion) => m.clave;
}
