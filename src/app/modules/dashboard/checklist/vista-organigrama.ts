import {
  Component, Input, Output, EventEmitter, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  PUESTOS_ORGANIGRAMA, PuestoOrganigrama, NodoOrganigrama,
  arbolOrganigrama, puestosFueraDelArbol
} from '../../../shared/organigrama.catalogo';
import { resolverPuesto } from '../../../shared/puesto.util';
import {
  ManualPuesto, TareaManual, manualDePuesto, tareasAutomaticasDePuesto
} from '../../../shared/tareas-manual.catalogo';
import { normalizarNombre } from '../../../shared/permisos.util';

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
}

/** Un grupo de sucursal dentro del puesto seleccionado. */
interface SucursalVista {
  sucursal: string;
  personas: PersonaVista[];
  completados: number;
  totalItems: number;
  porcentaje: number;
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

  hijos: FilaArbol[];
}

/**
 * Una fila del arbol unico. Cuatro tipos, un solo `*ngFor`.
 * `prof` es la sangria: 0 es Direccion General y crece con el organigrama y
 * luego con sucursal, persona y entrega.
 */
interface FilaVista {
  tipo: 'puesto' | 'sucursal' | 'persona' | 'entrega';
  /** Id unico y estable: sirve de llave de plegado y de trackBy. */
  clave: string;
  prof: number;
  tieneHijos: boolean;
  puesto?: FilaArbol;
  sucursal?: SucursalVista;
  persona?: PersonaVista;
  entrega?: EntregaVista;
}

/** Una persona con tareas cuyo puesto no se pudo resolver. */
interface HuerfanoVista {
  nombre: string;
  sucursal: string;
  entregas: number;
}

@Component({
  selector: 'app-vista-organigrama',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './vista-organigrama.html',
  styleUrls: ['./vista-organigrama.css']
})
export class VistaOrganigramaComponent {

  /** Checklists ya filtrados por permisos, pestaña y apartado. Los da el padre. */
  private lista = signal<any[]>([]);
  @Input() set checklists(v: any[]) { this.lista.set(Array.isArray(v) ? v : []); }

  /**
   * Plantilla, para poder resolver el puesto de cada quien y para saber quién
   * OCUPA un puesto aunque hoy no tenga nada entregado.
   */
  private personal = signal<any[]>([]);
  @Input() set usuarios(v: any[]) { this.personal.set(Array.isArray(v) ? v : []); }

  /** Se emite al tocar una tarea: el padre abre la vista de detalle de siempre. */
  @Output() abrir = new EventEmitter<any>();


  /** Esconde los puestos que todavía no tienen manual (son 70 de 89). */
  soloConManual = signal(true);

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
        hijos,
      };
    };

    let filas = arbolOrganigrama().map(construir);

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
   * TODO ARRANCA CERRADO. Con 89 puestos, abrirlo entero de entrada son
   * cientos de filas y nadie encuentra nada: la estructura se vuelve ruido.
   * Se guarda el conjunto de ABIERTOS y no de cerrados, justamente porque el
   * estado por defecto es cerrado y así el conjunto vacío es el estado inicial
   * correcto sin tener que enumerar los 89.
   */
  abiertos = signal<Set<string>>(new Set());

  /** Abre o cierra un nodo, sea puesto, sucursal o persona. */
  alternar(clave: string) {
    const s = new Set(this.abiertos());
    s.has(clave) ? s.delete(clave) : s.add(clave);
    this.abiertos.set(s);
  }
  abierto(clave: string): boolean { return this.abiertos().has(clave); }

  /** Cierra todo de golpe. Con el árbol muy abierto es la única salida rápida. */
  cerrarTodo() { this.abiertos.set(new Set()); }

  /**
   * Las sucursales de UN puesto, con su gente y sus entregas.
   *
   * Se calcula solo para los puestos ABIERTOS: hacerlo para los 89 en cada
   * recálculo recorrería la lista completa 89 veces por ciclo. El corte por
   * sucursal va dentro del puesto y no como nivel del árbol de arriba porque un
   * Anaquelista existe en ocho sucursales, y el dato que sirve es comparar el
   * mismo puesto entre ellas.
   */
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
        });
      }
      // Peor primero: lo que necesita atención va arriba.
      personas.sort((a, b) => a.porcentaje - b.porcentaje || a.nombre.localeCompare(b.nombre));
      const tot = personas.reduce((n, p) => n + p.totalItems, 0);
      const hec = personas.reduce((n, p) => n + p.completados, 0);
      out.push({
        sucursal, personas, completados: hec, totalItems: tot,
        porcentaje: tot ? Math.round((hec / tot) * 100) : 0,
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
   */
  filas = computed<FilaVista[]>(() => {
    const out: FilaVista[] = [];
    const rec = (fs: FilaArbol[]) => {
      for (const f of fs) {
        const clave = 'p:' + f.puesto.id;
        const sucs = this.abierto(clave) ? this.sucursalesDe(f.puesto.id) : [];
        out.push({
          tipo: 'puesto', clave, prof: f.profundidad, puesto: f,
          tieneHijos: f.hijos.length > 0 || f.entregasHoy > 0,
        });
        if (!this.abierto(clave)) continue;

        for (const su of sucs) {
          const cs = clave + '|s:' + su.sucursal;
          out.push({
            tipo: 'sucursal', clave: cs, prof: f.profundidad + 1, sucursal: su,
            tieneHijos: su.personas.length > 0,
          });
          if (!this.abierto(cs)) continue;

          for (const pe of su.personas) {
            const cp = cs + '|c:' + pe.nombre;
            out.push({
              tipo: 'persona', clave: cp, prof: f.profundidad + 2, persona: pe,
              tieneHijos: pe.entregas.length > 0,
            });
            if (!this.abierto(cp)) continue;

            for (const e of pe.entregas) {
              out.push({
                tipo: 'entrega', clave: cp + '|e:' + e.titulo + e.hora,
                prof: f.profundidad + 3, entrega: e, tieneHijos: false,
              });
            }
          }
        }
        rec(f.hijos);
      }
    };
    rec(this.arbol());
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
   */
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
}
