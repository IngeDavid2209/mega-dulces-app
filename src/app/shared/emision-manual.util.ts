/**
 * 📐 LA DECISIÓN DE QUÉ SE ENTREGA HOY, SEPARADA DE QUIÉN LA ESCRIBE.
 *
 * Todo lo de este archivo salió tal cual de `robot-manual.service.ts`: mismos
 * cuerpos, mismos comentarios. No es un refactor de gusto, y el motivo importa.
 *
 * HASTA HOY LA EMISIÓN DEL MANUAL VIVÍA DENTRO DE UN NAVEGADOR. El robot corre
 * en el componente de Checklist (`checklist.ts:2055`) y se repite cada 5 min
 * *mientras esa pestaña siga abierta*. O sea que las tareas del día de 186
 * personas dependen de que alguien con la plantilla cargada abra `/tareas`. Si
 * nadie la abre, nadie recibe nada, y el tablero lee ese silencio como
 * incumplimiento — que es exactamente el hallazgo 6 del CLAUDE.md («los relojes
 * viven dentro del servidor web») un peldaño más abajo: este reloj vive dentro
 * de un CLIENTE.
 *
 * Para que el servidor pueda emitir también, la regla tiene que poder llamarse
 * desde Node. Y NO puede copiarse: dos implementaciones de «qué le toca hoy a
 * quién» divergen en silencio y producen dos denominadores distintos para la
 * misma persona (§8.11 d — la prueba de audiencias que parseaba el menú con
 * expresiones regulares y reportaba como perdidas cinco rutas que sí estaban).
 *
 * LA LLAVE DE IDEMPOTENCIA ES LA PIEZA QUE NO SE TOCA. `idemKey` es
 * `man_<tarea>_<periodo>_<sucursal>_<persona>` y deliberadamente NO lleva el
 * puesto dentro: así, si alguien asigna a mano una tarea que el puesto de esa
 * persona ya recibe, sale la misma llave y no se duplica. Quien emita —el
 * navegador, el servidor o una asignación manual— tiene que calcularla con
 * ESTA función. Un emisor que se hiciera la suya crearía dos documentos para el
 * mismo punto y el denominador de esa persona subiría sin que nadie lo viera.
 *
 * Este archivo NO ESCRIBE NADA: no conoce Firestore, ni la API, ni Postgres.
 * Devuelve el plan y quien lo llame decide dónde guardarlo. Por eso se puede
 * probar sin credenciales, que es la condición para que se pruebe alguna vez.
 */

import { ConfigTurnos, fechaISO, rutinaPermitidaEnTurno } from './turnos.util';
import { esDiaDescansoEnFecha } from './descansos.util';
import { puestoIdDe } from './puesto.util';
import { nombrePuesto } from './organigrama.catalogo';
import { HorarioSucursal, limiteAperturaDe, trabajaEsteDia } from './horarios-sucursal.util';
import { evidenciaDe } from './evidencia-manual';
import {
  TareaManual, FrecuenciaManual, manualDePuesto, tareasAutomaticasDePuesto,
} from './tareas-manual.catalogo';

export const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Una entrega decidida: su id idempotente y el documento listo para guardar. */
export interface EntregaPlaneada {
  checklistId: string;
  payload: any;
}

/** A quién no se le entregó nada y por qué. Se reporta; no se tira. */
export interface OmitidoManual {
  nombre: string;
  motivo: string;
}

export interface PlanDeEntregas {
  entregas: EntregaPlaneada[];
  omitidos: OmitidoManual[];
}

export interface EntradaPlanEntregas {
  /** Plantilla completa (trabajadores y admins: hay puestos operativos como
   *  Encargado que tienen cuenta admin y aun así les toca su checklist). */
  usuarios: any[];
  fecha: Date;
  /** Horarios reales de sucursal (Mega Talento). Vacío = se usan las horas del
   *  catálogo: que RH no conteste no puede dejar a nadie sin sus tareas. */
  horarios: HorarioSucursal[];
  configTurnos: ConfigTurnos | null;
  descansosSemana: any[];
  /** Los ids que YA existen para esa fecha. Incluye enviados, archivados Y
   *  ELIMINADOS a propósito: un id tomado es un id tomado, y recrearlo pisaría
   *  con items en blanco un checklist que alguien ya contestó. */
  idsExistentes: Set<string>;
  esDiaCerrado?: (sucursal: string, fecha: Date) => boolean;
  esSucursalAdministrativa?: (sucursal: string) => boolean;
}

// ============================================================================
//  LA DECISIÓN
// ============================================================================

/**
 * Qué entregas corresponden a esta fecha, y a quién no le tocó nada y por qué.
 *
 * Pura: no lee la red ni escribe nada. Todo lo que necesita del mundo —los
 * horarios, la config de turnos, los descansos y los ids ya existentes— entra
 * por parámetro, porque así el navegador y el servidor pueden alimentarla cada
 * uno con sus propias lecturas y aun así decidir IGUAL.
 */
export function planDeEntregas(e: EntradaPlanEntregas): PlanDeEntregas {
  const entregas: EntregaPlaneada[] = [];
  const omitidos: OmitidoManual[] = [];
  if (!e.usuarios?.length) return { entregas, omitidos };

  const fecha = e.fecha;
  const fechaYmd = toYmd(fecha);
  const diaHoy = DIAS_SEMANA[fecha.getDay()];
  const esDomingo = fecha.getDay() === 0;
  const diaISO = fechaISO(fecha);

  // Copia: esta función no ensucia el Set de quien la llamó. Dentro sí se va
  // apuntando cada id decidido, para que dos sucursales de la misma persona o
  // dos vueltas del bucle no produzcan el mismo documento dos veces.
  const idsTomados = new Set<string>(e.idsExistentes);

  for (const u of e.usuarios) {
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
    if (uid && esDiaDescansoEnFecha(fecha, e.descansosSemana.filter(d => d.userId === uid))) {
      omitidos.push({ nombre, motivo: 'día de descanso' });
      continue;
    }

    // La sucursal donde se le entrega. Una persona con varias sucursales
    // recibe su checklist en cada una: su manual aplica en todas donde opera.
    const sucursales = sucursalesDe(u);
    if (!sucursales.length) {
      omitidos.push({ nombre, motivo: 'sin sucursal asignada' });
      continue;
    }

    // Cuántas entregas le salieron a ESTA persona. Si termina en cero teniendo
    // puesto, manual y sucursal, es que todas sus tareas cayeron fuera por
    // turno, cierre o frecuencia — y eso hay que poder decirlo, no dejarlo como
    // un hueco mudo que se lee igual que «no tiene manual».
    let suyas = 0;
    let ultimoMotivo = '';

    for (const sucursal of sucursales) {
      if (e.esDiaCerrado?.(sucursal, fecha)) { ultimoMotivo = `${sucursal} está cerrada ese día`; continue; }

      for (const tarea of tareas) {
        if (!tareaAplicaEnFecha(tarea, fecha, diaHoy)) continue;

        // Domingo en sucursal administrativa: misma regla que traía el robot
        // anterior, no se entregan las diarias.
        if (esDomingo && tarea.frecuencia === 'Diaria' && e.esSucursalAdministrativa?.(sucursal)) {
          ultimoMotivo = 'domingo en sucursal administrativa';
          continue;
        }

        // Y el día que RH tiene capturado como cerrado. El horario del
        // checador dice que ninguna plaza trabaja en domingo; entregar ahí
        // llena el lunes de incumplidas que nadie pudo hacer.
        //
        // Solo se omite cuando el dato EXISTE y dice que no. Si la sucursal
        // no tiene horario capturado, `trabajaEsteDia` devuelve null y aquí
        // no se hace nada: sin dato no se inventa un cierre, porque dejar sin
        // tareas a una plaza que sí abrió es peor que la molestia contraria.
        if (tarea.frecuencia === 'Diaria' && trabajaEsteDia(sucursal, fecha.getDay(), e.horarios) === false) {
          ultimoMotivo = `el horario de RH dice que ${sucursal} no trabaja ese día`;
          continue;
        }

        // Fuera de turno a la hora en que vence la tarea.
        if (e.configTurnos?.habilitado && uid &&
            !rutinaPermitidaEnTurno(e.configTurnos, uid, diaISO, tarea.horaLimite)) {
          ultimoMotivo = 'la hora de esas tareas cae fuera de su turno';
          continue;
        }

        const periodo = llavePeriodo(tarea.frecuencia, fecha);
        const checklistId = idemKey(tarea.id, periodo, sucursal, nombre);

        if (idsTomados.has(checklistId)) { suyas++; continue; }
        idsTomados.add(checklistId);

        entregas.push({
          checklistId,
          payload: armarChecklist({
            checklistId, tarea, puestoId, sucursal,
            destinatario: nombre, destinatarioUid: uid || null, fechaYmd,
          }, e.horarios),
        });
        suyas++;
      }
    }

    if (suyas === 0) {
      omitidos.push({ nombre, motivo: ultimoMotivo || 'ninguna de sus tareas aplica en esa fecha' });
    }
  }

  return { entregas, omitidos };
}

// ============================================================================
//  LAS PIEZAS
// ============================================================================

/** Sucursales donde opera el usuario, normalizando los campos históricos. */
export function sucursalesDe(u: any): string[] {
  const lista: string[] = (u.sucursales && u.sucursales.length)
    ? u.sucursales
    : (u.sucursal ? [u.sucursal] : []);
  // Quita duplicados conservando el orden de captura.
  return Array.from(new Set(lista.filter(Boolean)));
}

/** ¿A esta tarea le toca hoy? */
export function tareaAplicaEnFecha(tarea: TareaManual, fecha: Date, diaHoy: string): boolean {
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
export function llavePeriodo(frecuencia: FrecuenciaManual, fecha: Date): string {
  const y = fecha.getFullYear();
  const m = fecha.getMonth() + 1;
  const d = fecha.getDate();
  switch (frecuencia) {
    case 'Diaria':    return `${y}-${m}-${d}`;
    case 'Semanal':   return `${y}-W${weekNumber(fecha)}`;
    case 'Quincenal': return `${y}-${m}-${d <= 15 ? 'Q1' : 'Q2'}`;
    case 'Mensual':   return `${y}-${m}`;
    default:          return `${y}-${m}-${d}`;
  }
}

/** Número de semana ISO. */
export function weekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Id idempotente. El prefijo `man_` lo distingue de los checklists del robot
 * viejo (`asigv2_`) y de los manuales (`molde_`), para que el historial siga
 * siendo legible y las consultas puedan separarlos.
 *
 * ⚠ NO LLEVA EL PUESTO DENTRO, y es a propósito: una tarea asignada a mano y la
 * misma tarea entregada por el puesto producen la MISMA llave, así que no se
 * duplican. Quien cambie esta función rompe esa propiedad en silencio.
 */
export function idemKey(tareaId: string, periodo: string, sucursal: string, empleado: string): string {
  return `man_${slug(tareaId)}_${periodo}_${slug(sucursal)}_${slug(empleado)}`;
}

export function slug(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

/** 'YYYY-MM-DD' en hora LOCAL, que es como se guarda la columna `fecha`. */
export function toYmd(d: Date): string {
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
export function armarChecklist(args: {
  checklistId: string;
  tarea: TareaManual;
  puestoId: string;
  sucursal: string;
  destinatario: string;
  destinatarioUid: string | null;
  fechaYmd: string;
}, horarios: HorarioSucursal[]): any {
  const { checklistId, tarea, puestoId, sucursal, destinatario, destinatarioUid, fechaYmd } = args;
  const manual = manualDePuesto(puestoId);

  // La apertura vence en funcion de la hora a la que ESTA sucursal abre de
  // verdad, no de una hora igual para todos. Solo la apertura: mover el
  // cierre a la hora de salida volveria vencidas de golpe las tareas de todo
  // el que termina a esa hora, que es justo el dano que esto viene a evitar.
  // Sin horario capturado se queda la del catalogo, sin inventar nada.
  const real = tarea.momento === 'apertura' ? limiteAperturaDe(sucursal, horarios) : null;
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
