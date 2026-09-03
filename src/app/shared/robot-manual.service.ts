/**
 * 🤖 ROBOT DE TAREAS DE MANUAL
 *
 * Reemplaza al Robot de Rutinas V2. La diferencia no es técnica, es de fondo:
 *
 *   Robot V2 (retirado)   catálogo de rutinas + asignaciones → checklists
 *                         Alguien tenía que crear la rutina, asignarla a
 *                         sucursales y personas, y ponerle frecuencia. Tres
 *                         pantallas de captura y un montón de decisiones
 *                         humanas que se podían equivocar.
 *
 *   Robot de Manual       puesto de la persona → checklists
 *                         No hay nada que capturar. Si alguien es Cajera,
 *                         recibe el checklist de apertura y el de cierre que
 *                         dice su manual. Punto.
 *
 * Idempotente: si el checklist del periodo ya existe, no lo vuelve a crear.
 * Fail-safe: si la consulta de existencia falla, asume que SÍ existe y no
 * recrea, para no pisar con items vacíos un checklist ya entregado.
 *
 * Respeta las mismas reglas de convivencia que el robot anterior: no genera en
 * día cerrado de la sucursal, ni a quien descansa, ni fuera de turno.
 */

import { Injectable, inject } from '@angular/core';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';

import { ApiService } from './api.service';
import { normalizarNombre } from './permisos.util';
import { ConfigTurnos, fechaISO, rutinaPermitidaEnTurno } from './turnos.util';
import { esDiaDescansoEnFecha, obtenerSemanaISO } from './descansos.util';
import { puestoIdDe } from './puesto.util';
import { nombrePuesto } from './organigrama.catalogo';
import { HorarioSucursal, limiteAperturaDe, trabajaEsteDia } from './horarios-sucursal.util';
import { evidenciaDe } from './evidencia-manual';
import {
  TareaManual, FrecuenciaManual, manualDePuesto, tareasAutomaticasDePuesto,
} from './tareas-manual.catalogo';

/** Lógica que vive en el componente de checklist y el robot necesita consultar. */
export interface RobotManualHooks {
  esDiaCerrado?: (sucursal: string, fecha: Date) => boolean;
  esSucursalAdministrativa?: (sucursal: string) => boolean;
}

export interface ResultadoRobotManual {
  creados: number;
  /** Personas a las que no se les generó nada y por qué. Para diagnóstico. */
  omitidos: { nombre: string; motivo: string }[];
}

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

@Injectable({ providedIn: 'root' })
export class RobotManualService {
  private firestore = inject(Firestore);
  private api = inject(ApiService);

  /**
   * Horarios reales de las sucursales, leidos de Mega Talento UNA vez por
   * corrida. Si la lectura falla se queda vacio y todo sigue con las horas del
   * catalogo: que RH no conteste no puede dejar a nadie sin sus tareas.
   */
  private horarios: HorarioSucursal[] = [];

  private async cargarHorarios(): Promise<void> {
    try {
      const r: any = await this.api.get('/api/horarios-sucursal');
      this.horarios = Array.isArray(r?.items) ? r.items : [];
    } catch {
      this.horarios = [];
    }
  }

  /**
   * Genera los checklists de manual que corresponden a la fecha dada.
   *
   * @param usuarios Plantilla completa (trabajadores y admins: hay puestos
   *                 operativos como Encargado que tienen cuenta admin y aun
   *                 así les toca su checklist).
   * @returns cuántos se crearon y a quién se omitió.
   */
  async generarTareasDeFecha(
    usuarios: any[],
    fecha: Date = new Date(),
    hooks: RobotManualHooks = {}
  ): Promise<ResultadoRobotManual> {
    const omitidos: { nombre: string; motivo: string }[] = [];
    let creados = 0;
    if (!usuarios?.length) return { creados, omitidos };

    await this.cargarHorarios();

    const fechaYmd = this.toYmd(fecha);
    const diaHoy = DIAS_SEMANA[fecha.getDay()];
    const esDomingo = fecha.getDay() === 0;

    // ── Idempotencia: los ids que YA existen para hoy, en UNA sola consulta ──
    //
    // Antes esto se resolvía con un GET por cada tarea de cada persona. Con la
    // plantilla completa eso son cientos de peticiones cada vez que se refresca
    // la lista de usuarios, desde cada cliente abierto: insostenible.
    //
    // Todas las tareas que aplican hoy generan un checklist con `fecha` = hoy
    // (las semanales solo caen en su día, las mensuales en el suyo), así que la
    // lista de hoy contiene TODOS los ids con los que se podría chocar.
    //
    // FAIL-SAFE: si la consulta falla, se aborta la corrida sin crear nada. Un
    // upsert a ciegas sobreescribiría con items en blanco un checklist que el
    // trabajador ya llenó, y eso se lee como "se borró mi trabajo". Se reintenta
    // en el siguiente ciclo.
    let idsDeHoy: Set<string>;
    try {
      const r = await this.api.get(
        `/api/checklists?desde=${fechaYmd}&hasta=${fechaYmd}`
      );
      idsDeHoy = new Set<string>((r?.checklists || []).map((c: any) => String(c.id)));
    } catch (e) {
      console.error('[Robot Manual] No se pudo leer los checklists de hoy; no se genera nada esta vuelta.', e);
      return { creados, omitidos };
    }

    // Config de turnos (Canindo): para no entregar una tarea a quien a esa hora
    // ya no está en su turno.
    let configTurnos: ConfigTurnos | null = null;
    try {
      const r = await this.api.get('/api/config?id=turnos').catch(() => null);
      if (r?.item) configTurnos = r.item as ConfigTurnos;
    } catch { /* sin config => sin restricción por turno */ }
    const diaISO = fechaISO(fecha);

    // Días de descanso de la semana: a quien descansa no se le entrega nada.
    let descansosSemana: any[] = [];
    try {
      const sem = obtenerSemanaISO(fecha);
      const r = await this.api.get('/api/descansos-semanales?semanaISO=' + encodeURIComponent(sem));
      descansosSemana = r?.items || [];
    } catch { /* sin descansos => no se omite a nadie por descanso */ }

    for (const u of usuarios) {
      if (u.rol !== 'trabajador' && u.rol !== 'admin') continue;
      if (u.activo === false) continue;

      const nombre: string = u.nombre || '';
      if (!nombre) continue;

      const puestoId = puestoIdDe(u);
      if (!puestoId) {
        omitidos.push({ nombre, motivo: 'sin puesto del organigrama' });
        continue;
      }

      const tareas = tareasAutomaticasDePuesto(puestoId);
      if (!tareas.length) {
        omitidos.push({ nombre, motivo: `el puesto "${nombrePuesto(puestoId)}" aún no tiene manual` });
        continue;
      }

      const uid: string | undefined = u.id || u.uid;

      // Descanso: aplica a la persona completa, sin importar la tarea.
      if (uid && esDiaDescansoEnFecha(fecha, descansosSemana.filter(d => d.userId === uid))) {
        omitidos.push({ nombre, motivo: 'día de descanso' });
        continue;
      }

      // La sucursal donde se le entrega. Una persona con varias sucursales
      // recibe su checklist en cada una: su manual aplica en todas donde opera.
      const sucursales = this.sucursalesDe(u);
      if (!sucursales.length) {
        omitidos.push({ nombre, motivo: 'sin sucursal asignada' });
        continue;
      }

      for (const sucursal of sucursales) {
        if (hooks.esDiaCerrado?.(sucursal, fecha)) continue;

        for (const tarea of tareas) {
          if (!this.tareaAplicaEnFecha(tarea, fecha, diaHoy)) continue;

          // Domingo en sucursal administrativa: misma regla que traía el robot
          // anterior, no se entregan las diarias.
          if (esDomingo && tarea.frecuencia === 'Diaria' && hooks.esSucursalAdministrativa?.(sucursal)) continue;

          // Y el día que RH tiene capturado como cerrado. El horario del
          // checador dice que ninguna plaza trabaja en domingo; entregar ahí
          // llena el lunes de incumplidas que nadie pudo hacer.
          //
          // Solo se omite cuando el dato EXISTE y dice que no. Si la sucursal
          // no tiene horario capturado, `trabajaEsteDia` devuelve null y aquí
          // no se hace nada: sin dato no se inventa un cierre, porque dejar sin
          // tareas a una plaza que sí abrió es peor que la molestia contraria.
          if (tarea.frecuencia === 'Diaria' && trabajaEsteDia(sucursal, fecha.getDay(), this.horarios) === false) continue;

          // Fuera de turno a la hora en que vence la tarea.
          if (configTurnos?.habilitado && uid &&
              !rutinaPermitidaEnTurno(configTurnos, uid, diaISO, tarea.horaLimite)) {
            continue;
          }

          const periodo = this.llavePeriodo(tarea.frecuencia, fecha);
          const checklistId = this.idemKey(tarea.id, periodo, sucursal, nombre);

          if (idsDeHoy.has(checklistId)) continue;
          // Se apunta de inmediato: si dos sucursales de la misma persona o dos
          // vueltas del bucle produjeran el mismo id, no se escribe dos veces.
          idsDeHoy.add(checklistId);

          const payload = this.armarChecklist({
            checklistId, tarea, puestoId, sucursal,
            destinatario: nombre, destinatarioUid: uid || null, fechaYmd,
          });

          await setDoc(doc(this.firestore, 'checklists', checklistId), payload);
          await this.api.guardarChecklist(payload);
          creados++;
        }
      }
    }

    return { creados, omitidos };
  }

  // ==========================================================================
  //  INTERNO
  // ==========================================================================

  /** Sucursales donde opera el usuario, normalizando los campos históricos. */
  private sucursalesDe(u: any): string[] {
    const lista: string[] = (u.sucursales && u.sucursales.length)
      ? u.sucursales
      : (u.sucursal ? [u.sucursal] : []);
    // Quita duplicados conservando el orden de captura.
    return Array.from(new Set(lista.filter(Boolean)));
  }

  /** ¿A esta tarea le toca hoy? */
  private tareaAplicaEnFecha(tarea: TareaManual, fecha: Date, diaHoy: string): boolean {
    switch (tarea.frecuencia) {
      case 'Diaria':
        return true;
      case 'Semanal':
        // El día por omisión es lunes, NO "cualquier día". Si una semanal
        // aplicara todos los días, su llave de periodo (la semana) daría el
        // mismo id el martes que el lunes, y el checklist del lunes ya no
        // estaría en la lista de hoy: se recrearía en blanco encima de lo que
        // la persona ya contestó. El día fijo es lo que amarra id y fecha.
        return (tarea.diaSemana || 'Lunes') === diaHoy;
      case 'Quincenal': {
        // Días 1 y 16: dos entregas al mes, estables mes con mes.
        const d = fecha.getDate();
        return d === 1 || d === 16;
      }
      case 'Mensual': {
        const objetivo = tarea.diaMes || 1;
        const ultimoDia = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0).getDate();
        // Un día 31 en un mes de 30 se entrega el último día del mes, no se pierde.
        return fecha.getDate() === Math.min(objetivo, ultimoDia);
      }
      default:
        return false;
    }
  }

  /** Llave del periodo, para que la idempotencia dure lo que dura la tarea. */
  private llavePeriodo(frecuencia: FrecuenciaManual, fecha: Date): string {
    const y = fecha.getFullYear();
    const m = fecha.getMonth() + 1;
    const d = fecha.getDate();
    switch (frecuencia) {
      case 'Diaria':    return `${y}-${m}-${d}`;
      case 'Semanal':   return `${y}-W${this.weekNumber(fecha)}`;
      case 'Quincenal': return `${y}-${m}-${d <= 15 ? 'Q1' : 'Q2'}`;
      case 'Mensual':   return `${y}-${m}`;
      default:          return `${y}-${m}-${d}`;
    }
  }

  /** Número de semana ISO. */
  private weekNumber(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  /**
   * Id idempotente. El prefijo `man_` lo distingue de los checklists del robot
   * viejo (`asigv2_`) y de los manuales (`molde_`), para que el historial siga
   * siendo legible y las consultas puedan separarlos.
   */
  private idemKey(tareaId: string, periodo: string, sucursal: string, empleado: string): string {
    return `man_${this.slug(tareaId)}_${periodo}_${this.slug(sucursal)}_${this.slug(empleado)}`;
  }

  private slug(s: string): string {
    return (s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48);
  }

  private toYmd(d: Date): string {
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
  }

  /**
   * Payload del checklist, con el mismo shape que la UI ya conoce más los
   * metadatos que la marcan como tarea de manual.
   *
   * `_origenManual: true` es la bandera que la pantalla de Checklist lee para
   * poner el candado: sin ella la tarea se podría editar como cualquier otra.
   */
  private armarChecklist(args: {
    checklistId: string;
    tarea: TareaManual;
    puestoId: string;
    sucursal: string;
    destinatario: string;
    destinatarioUid: string | null;
    fechaYmd: string;
  }): any {
    const { checklistId, tarea, puestoId, sucursal, destinatario, destinatarioUid, fechaYmd } = args;
    const manual = manualDePuesto(puestoId);

    // La apertura vence en funcion de la hora a la que ESTA sucursal abre de
    // verdad, no de una hora igual para todos. Solo la apertura: mover el
    // cierre a la hora de salida volveria vencidas de golpe las tareas de todo
    // el que termina a esa hora, que es justo el dano que esto viene a evitar.
    // Sin horario capturado se queda la del catalogo, sin inventar nada.
    const real = tarea.momento === 'apertura' ? limiteAperturaDe(sucursal, this.horarios) : null;
    const horaLimite = real ? real.hora : tarea.horaLimite;

    const items = tarea.items.map((it, i) => {
      // Que evidencia pide ESTE punto. Viene de evidencia-manual.ts, aparte del
      // catalogo, porque no sale del documento sino de una decision de la app.
      const ev = evidenciaDe(tarea.id, i, it.texto);

      return {
      id: `${tarea.id}_${i}`,
      // El bloque de la jornada va como prefijo para no perder el dato que
      // trae el anexo (Inicio, Surtido, Checado...).
      text: it.bloque ? `${it.bloque}: ${it.texto}` : it.texto,
      checked: false,
      photo: null,
      photoTime: null,
      photoAntes: null,
      photoAntesTime: null,
      photoAntesTimestamp: null,
      photos: [],
      horaInicio: null,
      horaLimite,
      // ── EVIDENCIA ────────────────────────────────────────────────────────
      // TODOS LOS PUNTOS PIDEN FOTO, Y MAS DE UNA.
      //
      // Decision de Direccion, relevada por David el 3/sep/2026: "el jefe quiere
      // que todas las tareas tengan evidencia, entonces a todas activale la
      // evidencia fotografica, que solo se pueda tomar la foto al instante" y
      // "que sea mas de una foto".
      //
      // QUEDA ESCRITO QUE CONTRADICE LA REGLA 1 de evidencia-manual.ts, que dice
      // que las declaraciones no piden nada porque no hay objeto que fotografiar
      // ("Cobre siempre con mi usuario propio", "No otorgue descuentos"). Se
      // midio: de los 377 puntos, al menos 62 son declaraciones en primera
      // persona del pasado. En esos, la foto no prueba el enunciado. Se planteo
      // la alternativa de dejarlos fuera (315 en vez de 377) y Direccion eligio
      // los 377. Se implementa como se pidio; el riesgo queda registrado aqui y
      // en el CLAUDE.md para que dentro de tres meses se sepa de quien fue la
      // decision, no para volver a discutirla.
      //
      // POR QUE `requiresVariasFotos` Y NO `requiresPhoto`:
      // 1. Es lo que pidio: mas de una foto. La galeria acepta cuantas quiera,
      //    cada una con su hora de captura.
      // 2. LAS DOS JUNTAS BLOQUEARIAN LA OPERACION ENTERA. `tieneEvidencia`
      //    exige `photos.length > 0` cuando hay variasFotos, y ADEMAS
      //    `item.photo` cuando hay requiresPhoto; pero la plantilla ESCONDE el
      //    bloque de foto unica si variasFotos esta encendida (su *ngIf lleva
      //    `&& !item.requiresVariasFotos`). Con las dos, `item.photo` no se
      //    podria llenar nunca y ningun punto se completaria jamas.
      // 3. Y es lo BARATO en DOM. Medido en Chrome con un checklist de 23
      //    puntos: 294 nodos hoy (3 de 23 con foto) -> 374 con los 23. +27%, no
      //    x4. El x4 de la 046 lo causaba el bloque de FOTO UNICA, que son ~200
      //    lineas por punto; la galeria vacia es compacta. Con tres fotos por
      //    punto ya subidas -el final del turno- son 926 nodos y 69 miniaturas,
      //    y por eso las miniaturas llevan `loading="lazy"`.
      requiresPhoto: false,
      requiresVariasFotos: true,
      // Antes/despues no lo pide ningun punto de estos manuales.
      requiresAntesDespues: false,
      // Sigue en false y ya no cambia nada: `permiteFotos` era la foto OPCIONAL,
      // y hoy la galeria la enciende `requiresVariasFotos` para todos. Se deja
      // apagada para que la tarea libre hecha a mano (`tareaDiaPermiteFotos`)
      // siga siendo la unica que la usa, que es de quien era esa funcion.
      permiteFotos: false,
      // El punto se refiere a un documento que YA existe (factura, poliza,
      // tarjeta de circulacion): se adjunta el archivo, no se fotografia.
      // SIGUE VIVO Y AHORA IMPORTA MAS: son 45 puntos, y ahora todos caen en la
      // galeria. Sin esta bandera el input seria `accept="image/*"` con camara
      // forzada y la persona NO PODRIA adjuntar el PDF que se le pide. La
      // plantilla la honra en el input de la galeria.
      permiteDocumentos: !!ev?.documento,
      tiempoEstimadoMin: null,
      requiereMonto: !!ev?.monto,
      requiereFolio: !!ev?.folio,
      requiereComentario: !!ev?.comentario,
      };
    });

    return {
      id: checklistId,
      timestampCreacion: Date.now(),
      name: tarea.nombre,
      assigned: destinatario,
      assignedUid: destinatarioUid,
      store: sucursal,
      date: fechaYmd,
      time: horaLimite,
      status: 'pendiente',
      enviado: false,
      createdBy: 'Manual Corporativo',
      notaEmpleado: '',
      items,
      frecuencia: tarea.frecuencia,

      // ── Metadatos de manual ────────────────────────────────────────────────
      /** Bandera del candado: la UI no permite editar ni borrar. */
      _origenManual: true,
      _puestoId: puestoId,
      _tareaManualId: tarea.id,
      _manualDocumento: manual?.documento || '',
      _manualCodigo: manual?.codigo || '',
      _manualVersion: manual?.version || '',
      _formatoCodigo: tarea.codigoFormato || '',
      _momento: tarea.momento,
      _porEvento: !!tarea.porEvento,
      _nota: tarea.nota || '',
    };
  }
}
