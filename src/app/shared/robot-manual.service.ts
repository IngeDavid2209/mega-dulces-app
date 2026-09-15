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
import { conTope, pasoAgotado } from './con-tope.util';
import { ConfigTurnos } from './turnos.util';
import { obtenerSemanaISO } from './descansos.util';
import { HorarioSucursal } from './horarios-sucursal.util';
import { TareaManual, FrecuenciaManual, tareaManualPorId } from './tareas-manual.catalogo';

// LA REGLA. Vive fuera del service para que el emisor del servidor pueda
// llamarla (api/emitir-manual.js la requiere compilada desde dist/manual). Los
// imports que este archivo tenia de `puesto.util`, `organigrama.catalogo`,
// `evidencia-manual` y compania se fueron con ella: los usaba el bucle de
// decision, y ese bucle ya no esta aqui.
import {
  planDeEntregas, armarChecklist, idemKey, llavePeriodo, weekNumber,
  slug, toYmd, sucursalesDe, tareaAplicaEnFecha,
} from './emision-manual.util';

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
    let creados = 0;
    if (!usuarios?.length) return { creados, omitidos: [] };

    await this.cargarHorarios();

    const fechaYmd = this.toYmd(fecha);

    // -- Idempotencia: los ids que YA existen para hoy, en UNA sola consulta --
    //
    // Antes esto se resolvia con un GET por cada tarea de cada persona. Con la
    // plantilla completa eso son cientos de peticiones cada vez que se refresca
    // la lista de usuarios, desde cada cliente abierto: insostenible.
    //
    // Todas las tareas que aplican hoy generan un checklist con `fecha` = hoy
    // (las semanales solo caen en su dia, las mensuales en el suyo), asi que la
    // lista de hoy contiene TODOS los ids con los que se podria chocar.
    //
    // FAIL-SAFE: si la consulta falla, se aborta la corrida sin crear nada. Un
    // upsert a ciegas sobreescribiria con items en blanco un checklist que el
    // trabajador ya lleno, y eso se lee como "se borro mi trabajo". Se reintenta
    // en el siguiente ciclo.
    let idsDeHoy: Set<string>;
    try {
      const r = await this.api.get(
        `/api/checklists?desde=${fechaYmd}&hasta=${fechaYmd}`
      );
      idsDeHoy = new Set<string>((r?.checklists || []).map((c: any) => String(c.id)));
    } catch (e) {
      console.error('[Robot Manual] No se pudo leer los checklists de hoy; no se genera nada esta vuelta.', e);
      return { creados, omitidos: [] };
    }

    // Config de turnos (Canindo): para no entregar una tarea a quien a esa hora
    // ya no esta en su turno.
    let configTurnos: ConfigTurnos | null = null;
    try {
      const r = await this.api.get('/api/config?id=turnos').catch(() => null);
      if (r?.item) configTurnos = r.item as ConfigTurnos;
    } catch { /* sin config => sin restriccion por turno */ }

    // Dias de descanso de la semana: a quien descansa no se le entrega nada.
    let descansosSemana: any[] = [];
    try {
      const sem = obtenerSemanaISO(fecha);
      const r = await this.api.get('/api/descansos-semanales?semanaISO=' + encodeURIComponent(sem));
      descansosSemana = r?.items || [];
    } catch { /* sin descansos => no se omite a nadie por descanso */ }

    // -- LA DECISION YA NO VIVE AQUI --------------------------------------
    //
    // `planDeEntregas` es la MISMA funcion que llama el emisor del servidor
    // (api/emitir-manual.js). Antes este bucle era la unica copia de la regla y
    // por eso la emision dependia de que alguien tuviera esta pantalla abierta.
    // Con la regla fuera, el navegador y el servidor deciden identico y lo unico
    // que cambia es quien escribe.
    const plan = planDeEntregas({
      usuarios, fecha,
      horarios: this.horarios,
      configTurnos, descansosSemana,
      idsExistentes: idsDeHoy,
      esDiaCerrado: hooks.esDiaCerrado,
      esSucursalAdministrativa: hooks.esSucursalAdministrativa,
    });

    // -- LA ESCRITURA, Y POR QUE CAMBIO DE ORDEN Y DE BLINDAJE -------------
    //
    // Antes eran dos `await` desnudos dentro del bucle: `setDoc` y despues la
    // API. Dos defectos, y los dos dejaban a TODA la plantilla sin tareas:
    //
    //  1. Sin try/catch, el primer fallo reventaba la corrida entera. La tarea
    //     numero 3 de 112 tumbaba las 109 restantes.
    //  2. `setDoc` NO RECHAZA sin red: se queda pendiente. Asi que la corrida no
    //     solo podia reventar, podia quedarse colgada en la primera escritura y
    //     no emitir nada, sin un solo error en ningun lado.
    //
    // Ahora cada entrega va aislada y con tope. Y PRIMERO LA API: la app lee de
    // Postgres, asi que un documento que solo llegue a Firestore no lo ve nadie
    // — se contaria como creado y la persona seguiria sin su tarea.
    for (const e of plan.entregas) {
      try {
        await conTope(this.api.post('/api/checklists', e.payload), 20000, 'guardar la tarea');
        creados++;
      } catch (err) {
        console.error('[Robot Manual] no se pudo crear %s:', e.checklistId, pasoAgotado(err) || err);
        continue;   // la siguiente persona no paga el fallo de esta
      }
      // Firestore va en segundo lugar y best-effort: es el lado del ferrocarril
      // que ya no lee nadie (hallazgo 2). Que falle no invalida la entrega.
      try {
        await conTope(setDoc(doc(this.firestore, 'checklists', e.checklistId), e.payload), 15000, 'copiar a Firestore');
      } catch { /* la entrega ya esta en Postgres, que es de donde se lee */ }
    }

    return { creados, omitidos: plan.omitidos };
  }

  // ==========================================================================
  //  ENTREGA A MANO DESDE EL CATALOGO
  // ==========================================================================

  /**
   * 📕 DARLE A UNA PERSONA UNA TAREA DEL MANUAL QUE SU PUESTO NO RECIBE.
   *
   * Instrucción de David (14/sep/2026): «los catálogos que creaste de acuerdo a
   * los puestos, los dejarás creados como un catálogo para poder agregarlo a
   * cualquier trabajador».
   *
   * ─── POR QUÉ VIVE AQUÍ Y NO EN LA PANTALLA ──────────────────────────────
   * Porque tiene que producir EXACTAMENTE el mismo documento que el robot. Si
   * la pantalla armara su propio payload, habría dos versiones de la regla de
   * evidencia, dos de la hora límite y dos del sellado de norma, libres de
   * discrepar — y la que discrepara lo haría en silencio, produciendo tareas
   * que se ven iguales y se juzgan distinto. Aquí se reusan `idemKey` y
   * `armarChecklist`, que son las mismas dos funciones que usa la entrega
   * automática.
   *
   * ─── ES UNA ENTREGA PUNTUAL, NO UNA APLICABILIDAD ───────────────────────
   * Decisión de David entre las dos opciones que se le plantearon: esto crea UN
   * checklist para UNA fecha. No declara que a esa persona le aplique ese
   * manual, así que mañana no vuelve sola. Lo permanente —norma → aplicabilidad
   * del §4— necesita tabla y robot, y es otro paso.
   *
   * ─── LA LLAVE ES LA DEL ROBOT, Y ESO NO ES UN DETALLE ───────────────────
   * `idemKey` no incluye el puesto: es `tarea × periodo × sucursal × persona`.
   * Dos consecuencias, las dos buscadas:
   *   · Si se asigna a mano una tarea que el puesto de esa persona YA recibe,
   *     sale la misma llave, así que no se duplica: o ya existe y se dice, o se
   *     crea y el robot la ve y la salta.
   *   · Volver a asignar lo mismo el mismo día no escribe nada. Sin esto, dos
   *     clics crearían dos documentos y el denominador de esa persona subiría
   *     por una torpeza de la interfaz.
   *
   * @returns `creado` con el id, o el motivo por el que no se creó. Nunca lanza
   *          por «ya existe»: eso no es un error, es el resultado correcto.
   */
  async entregarDelCatalogo(args: {
    tareaId: string;
    puestoId: string;
    sucursal: string;
    destinatario: string;
    destinatarioUid: string | null;
    fecha: Date;
    /** Quién lo asignó. Va sellado en el documento: sin autor no es auditable. */
    autor: string;
  }): Promise<{ estado: 'creado' | 'ya-existia' | 'sin-tarea' | 'error'; id?: string; detalle?: string }> {
    const tarea = tareaManualPorId(args.tareaId);
    if (!tarea) return { estado: 'sin-tarea' };
    if (!args.destinatario || !args.sucursal) {
      return { estado: 'error', detalle: 'Falta la persona o la sucursal.' };
    }

    // Las horas de apertura salen de Mega Talento y `armarChecklist` las lee de
    // `this.horarios`. Sin esta línea, una tarea de apertura entregada a mano
    // vencería a la hora del catálogo y no a la que esa sucursal abre de verdad
    // — la misma tarea, dos horas límite distintas según quién la emitió.
    await this.cargarHorarios();

    const fechaYmd = this.toYmd(args.fecha);
    const periodo = this.llavePeriodo(tarea.frecuencia, args.fecha);
    const checklistId = this.idemKey(tarea.id, periodo, args.sucursal, args.destinatario);

    // ¿Ya existe? Se pregunta por la FECHA, que es donde el robot también mira.
    // Un fallo de lectura NO se trata como «no existe»: eso escribiría encima
    // de lo que alguien pudo haber contestado ya, y ese es el daño que no se
    // puede deshacer (§5.5).
    try {
      const r: any = await this.api.get(
        `/api/checklists?desde=${fechaYmd}&hasta=${fechaYmd}`
      );
      const ids = new Set<string>((r?.checklists || []).map((c: any) => String(c.id)));
      if (ids.has(checklistId)) return { estado: 'ya-existia', id: checklistId };
    } catch (e: any) {
      return {
        estado: 'error',
        detalle: 'No pude comprobar si ya existe, así que no escribo nada. ' +
                 'Revisa tu conexión y vuelve a intentar.',
      };
    }

    const payload = this.armarChecklist({
      checklistId, tarea, puestoId: args.puestoId, sucursal: args.sucursal,
      destinatario: args.destinatario, destinatarioUid: args.destinatarioUid, fechaYmd,
    });

    // El sello de que esto lo decidió una persona, no el reloj. `createdBy` se
    // queda en «Manual Corporativo» a propósito —el documento SIGUE siendo del
    // manual, y hay reportes que separan por ese campo— y el autor va aparte,
    // donde no se confunde con la autoría de la norma.
    payload._asignadoAMano = true;
    payload._asignadoPor = args.autor || '(sin autor)';
    payload._asignadoEn = Date.now();

    // ══════════════════════════════════════════════════════════════════════
    //  EL ORDEN DE LAS DOS ESCRITURAS, Y POR QUE AQUI ES AL REVES QUE ARRIBA
    // ══════════════════════════════════════════════════════════════════════
    // El robot escribe Firestore y despues la API. Aqui va primero la API, y
    // no es un descuido:
    //
    //  1. LA APP LEE DE POSTGRES (§3, hallazgo 2: las lecturas ya migraron).
    //     Un documento que solo esta en Firestore NO LO VE NADIE; uno que solo
    //     esta en Postgres se ve y se cumple. De las dos escrituras, la que
    //     decide si esto sirvio es la de la API.
    //
    //  2. ESTO LO DISPARA UNA PERSONA Y SE QUEDA MIRANDO. El robot corre solo
    //     en un bucle: si una vuelta falla, la siguiente lo arregla. Aqui hay
    //     alguien esperando, asi que el resultado tiene que llegar pronto y ser
    //     honesto.
    //
    // ── Y LOS DOS TOPES, QUE SON LA LECCION DEL 1/sep ─────────────────────
    // `setDoc` de Firestore NO RESUELVE mientras no haya red: la promesa se
    // queda pendiente para siempre. Sin tope, quien pulse «Asignar» con mala
    // senal se queda en «Asignando...» eternamente — que es, exactamente, el
    // «VERIFICANDO...» que costo cinco horas de diagnostico. Nada opcional
    // merece bloquear a nadie.
    let idServidor = '';
    try {
      // ⚠ `post` Y NO `guardarChecklist`, Y ESTO IMPORTA. `guardarChecklist`
      //   reintenta tres veces y, si las tres fallan, REGISTRA EN CONSOLA Y
      //   DEVUELVE — no lanza. O sea que envolverla en un try/catch da un
      //   «creado» aunque no se haya guardado nada: el peor resultado posible,
      //   porque quien asignó se va convencido y la persona nunca ve la tarea.
      //   Un tope no se traga, y un fallo tampoco (lección del 1/sep).
      //   Perder los reintentos es aceptable: la llave es idempotente, así que
      //   volver a pulsar no puede duplicar nada.
      await conTope(this.api.post('/api/checklists', payload), 20000, 'guardar la tarea');
      idServidor = checklistId;
    } catch (e: any) {
      const paso = pasoAgotado(e);
      return {
        estado: 'error',
        detalle: paso
          ? 'Se agoto el tiempo al ' + paso + '. No se creo nada: vuelve a intentar.'
          : (e?.message || 'No se pudo guardar.'),
      };
    }

    // Firestore es la segunda base que la Fase 1 viene a retirar. Se sigue
    // escribiendo para que el historial no se parta mientras exista, pero su
    // fallo NO cambia el resultado: la tarea ya esta donde la app la lee. Se
    // registra en consola, que es donde se puede ver si empieza a fallar
    // siempre.
    try {
      await conTope(
        setDoc(doc(this.firestore, 'checklists', checklistId), payload),
        15000, 'copiar a la base vieja');
    } catch (e) {
      console.warn('[manual] la copia a Firestore no se pudo hacer; la tarea SI quedo ' +
        'guardada en la base que lee la app.', e);
    }

    return { estado: 'creado', id: idServidor };
  }

  // ==========================================================================
  //  INTERNO
  // ==========================================================================

  /**
   * Las piezas siguen aqui como metodos DELGADOS, no se borraron.
   *
   * Dos razones. La primera es que las llama `entregarDelCatalogo` de aqui
   * arriba. La segunda es la que importa: desde que el servidor tambien emite
   * (api/emitir-manual.js), la regla tiene que ser UNA. Si el service
   * conservara su propia copia, dos implementaciones de "que le toca hoy a
   * quien" divergirian en silencio y la misma persona tendria dos
   * denominadores segun quien emitiera primero.
   *
   * La llave de idempotencia es el caso mas caro: `idemKey` produce
   * `man_<tarea>_<periodo>_<sucursal>_<persona>` y NO lleva el puesto dentro a
   * proposito, para que una entrega a mano y la automatica de la misma tarea
   * colapsen en un solo documento. Esta fijada contra un literal en
   * `emision-manual.util.spec.ts`.
   */
  private sucursalesDe(u: any): string[] {
    return sucursalesDe(u);
  }

  private tareaAplicaEnFecha(tarea: TareaManual, fecha: Date, diaHoy: string): boolean {
    return tareaAplicaEnFecha(tarea, fecha, diaHoy);
  }

  private llavePeriodo(frecuencia: FrecuenciaManual, fecha: Date): string {
    return llavePeriodo(frecuencia, fecha);
  }

  private weekNumber(d: Date): number {
    return weekNumber(d);
  }

  private idemKey(tareaId: string, periodo: string, sucursal: string, empleado: string): string {
    return idemKey(tareaId, periodo, sucursal, empleado);
  }

  private slug(s: string): string {
    return slug(s);
  }

  private toYmd(d: Date): string {
    return toYmd(d);
  }

  /** El payload. `this.horarios` se le pasa explicito: la funcion es pura y no
   *  puede leer el estado del service. */
  private armarChecklist(args: {
    checklistId: string;
    tarea: TareaManual;
    puestoId: string;
    sucursal: string;
    destinatario: string;
    destinatarioUid: string | null;
    fechaYmd: string;
  }): any {
    return armarChecklist(args, this.horarios);
  }
}
