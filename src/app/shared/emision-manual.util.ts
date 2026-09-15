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
import { tieneCuadrilla } from './sucursales-elegibles.util';
import { puestoIdDe } from './puesto.util';
import { nombrePuesto } from './organigrama.catalogo';
import { HorarioSucursal, limiteAperturaDe, trabajaEsteDia } from './horarios-sucursal.util';
import { evidenciaDe } from './evidencia-manual';
import {
  TareaManual, FrecuenciaManual, manualDePuesto, tareasAutomaticasDePuesto,
} from './tareas-manual.catalogo';
import { TareaDePuesto, tareasAutomaticasCombinadas } from './tareas-puesto.util';

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
  /**
   * Gente a la que se le RECORTÓ algún lugar de su ficha (ver
   * `lugaresDeEmision`). NO son omitidos: éstos SÍ reciben sus tareas, solo que
   * en menos sitios de los que su ficha lista.
   *
   * Existe porque el recorte, sin esto, es mudo: el día que alguien pregunte
   * «¿por qué ya no me salen las de MANTENIMIENTO?», la respuesta tiene que
   * estar en algún sitio. Quien consuma el plan decide si lo registra.
   */
  recortes: { nombre: string; motivo: string }[];
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
  /**
   * Las tareas CAPTURADAS (`mdtask_tareas_puesto`), ya leídas por quien llama.
   *
   * Viajan como insumo en vez de leerse aquí porque esta función es PURA: no
   * conoce Postgres ni la API, y esa es la condición para que el navegador y
   * el servidor decidan idéntico. Si cada uno las leyera por su cuenta con su
   * propio criterio de «vigente», la misma persona tendría dos denominadores
   * según quién emitiera primero (§8.11 d).
   *
   * Vacío o ausente = solo se entrega el manual publicado, que es exactamente
   * el comportamiento anterior a este paso. La lectura falla hacia ese lado a
   * propósito: quitarle a una cajera sus 3 tareas de siempre porque una
   * consulta no respondió sería peor que no darle todavía las nuevas.
   */
  tareasDeclaradas?: TareaDePuesto[];
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
  /** Gente a la que se le recortó algún lugar. NO son omitidos: sí reciben. */
  const recortes: { nombre: string; motivo: string }[] = [];
  if (!e.usuarios?.length) return { entregas, omitidos, recortes };

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

    // Su manual publicado MÁS lo capturado para su puesto. Ver
    // `tareasAutomaticasCombinadas`: NO es la función que usa la pantalla para
    // mostrar la hoja del puesto, porque aquélla incluye las de solo-evento y
    // entregarlas daría trabajo que nadie puede anticipar.
    const tareas = tareasAutomaticasCombinadas(puestoId, e.tareasDeclaradas || []);
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

    // Dónde se le entrega. Ver `lugaresDeEmision`: NO es su lista de sucursales
    // tal cual, porque en esa lista conviven los sitios donde alguien trabaja
    // con las áreas a las que solo tiene acceso.
    const todosSusLugares = sucursalesDe(u);
    if (!todosSusLugares.length) {
      omitidos.push({ nombre, motivo: 'sin sucursal asignada' });
      continue;
    }
    const sucursales = lugaresDeEmision(todosSusLugares);

    // ⚠ UN RECORTE MUDO SE LEE COMO UN BUG. Si a alguien deja de entregársele su
    // manual en MANTENIMIENTO, la pregunta que llega es «¿por qué ya no me
    // salen?», y sin esto la respuesta no existe en ningún sitio. No es una
    // omisión —esa persona SÍ recibe sus tareas— así que va en su propia lista,
    // aparte de `omitidos`, que significa «no recibió nada».
    if (sucursales.length < todosSusLugares.length) {
      const quitados = todosSusLugares.filter(l => !sucursales.includes(l));
      recortes.push({
        nombre,
        motivo: `no se le entrega en ${quitados.join(', ')}: no son sitios con cuadrilla`,
      });
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

  return { entregas, omitidos, recortes };
}

// ============================================================================
//  LAS PIEZAS
// ============================================================================

/**
 * 🏪 DÓNDE SE LE ENTREGA EL MANUAL A UNA PERSONA — y no es «en todos sus sitios».
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EL DEFECTO QUE ESTO ARREGLA, CON SU CIFRA
 * ═══════════════════════════════════════════════════════════════════════════
 * Reportado por David el 15/sep/2026 mirando su pantalla: *«hay módulos
 * repetidos»*. Una Encargada de 8 Esquinas tenía **9 tareas pendientes** y su
 * manual son **3**. No estaban repetidas por error: el emisor recorría su
 * `sucursales[]` y entregaba el manual completo EN CADA ENTRADA. Su ficha
 * decía `8 Esquinas`, `MANTENIMIENTO` y `SISTEMAS`, así que 3 × 3 = 9.
 *
 * Y el daño no es la molestia de ver tres tarjetas iguales: es que su
 * **denominador se triplica**. Con 3 hechas de 9 emitidas, una persona que
 * cumplió TODO su manual aparece al 33% en el tablero. Un número así no se lee
 * como un defecto de la app: se lee como una persona que no trabaja.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ LA LISTA NO SE PUEDE USAR TAL CUAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Porque `sucursales[]` hace DOS trabajos a la vez y la ficha no los distingue:
 * dice dónde trabaja alguien Y a qué áreas tiene acceso. MANTENIMIENTO y
 * SISTEMAS están en su ficha para que pueda levantar un ticket, no porque ahí
 * abra una tienda. Es el hallazgo 1 —la organización no existe como dato— en su
 * forma más cara: un campo que significa dos cosas.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA REGLA, Y SU RED DE SEGURIDAD
 * ═══════════════════════════════════════════════════════════════════════════
 * Se entrega en los lugares **con cuadrilla** (sucursales y CEDIS), usando
 * `tieneCuadrilla()` — que YA EXISTE y salió de una instrucción del propio
 * David sobre el pase de lista: «quítale esas dos», MANTENIMIENTO y SISTEMAS.
 * Una sola definición para las dos preguntas, que son la misma: ¿este sitio
 * tiene gente operando?
 *
 * ⚠ Y SI NO TIENE NINGUNO, SE ENTREGA EN EL PRIMERO DE LOS SUYOS. Esta línea
 * es la mitad del arreglo. El 84% del organigrama NO es de sucursal: toda la
 * gente de RH, FINANZAS, COMPRAS, MKT y CONTABILIDAD tiene como único sitio un
 * área administrativa. Sin esta caída, el «arreglo» les quitaría TODAS sus
 * tareas — cambiar un denominador inflado por un cero es un desastre peor y más
 * silencioso que el que se viene a resolver.
 *
 * La propiedad que deja, y es lo que permite desplegarla sin medir a quién
 * afecta: esto solo puede QUITAR copias de más. Nunca deja a nadie en cero.
 *
 * ─── LO QUE NO RESUELVE, DICHO PARA QUE NO SE LEA DE MÁS ──────────────────
 * MEDIDO, para que el límite no sea una sospecha: de los 19 lugares que la app
 * ofrece hoy, **2 no están en el mapa de zonas** —`ADMINISTRADORES DEL SISTEMA`
 * y `CAJA GENERAL`— así que `tieneCuadrilla` los da por NO operativos. Se probó
 * caso por caso con la lista real y ninguno se queda sin nada:
 *
 *     CAJA GENERAL                           -> CAJA GENERAL     (la red de seguridad)
 *     CAJA GENERAL + MANTENIMIENTO           -> CAJA GENERAL
 *     Canindo + CAJA GENERAL                 -> Canindo
 *     8 Esquinas + MANTENIMIENTO + SISTEMAS  -> 8 Esquinas       (el caso de la captura)
 *     CEDIS + SISTEMAS                       -> CEDIS
 *     Canindo + Padre Hidalgo                -> Canindo, Padre Hidalgo
 *
 * El único hueco que queda es una sucursal NUEVA que todavía no esté en
 * `zonas.util.ts` Y que su gente tenga además otro lugar mapeado: ahí sí se le
 * dejaría de entregar en la nueva. Si alguien abre una sucursal, el mapa hay que
 * tocarlo de todas formas —es la deuda de la Fase 3, el lugar como texto— y este
 * comentario es para que se sepa que también afecta a la emisión.
 *
 * Si alguien de verdad trabajara en un área administrativa ADEMÁS de en su
 * sucursal, recibiría una copia en vez de dos. No se puede distinguir: la ficha
 * no dice cuál de sus sitios es su trabajo y cuál es un permiso. Se elige este
 * lado del error porque el otro —inflar el denominador de todo el mundo— ya
 * está midiéndose en producción y hace que la gente parezca incumplida.
 */
export function lugaresDeEmision(lugares: string[]): string[] {
  const conCuadrilla = lugares.filter(l => tieneCuadrilla(l));
  if (conCuadrilla.length) return conCuadrilla;

  // Sin ningún sitio operativo: su área ES su trabajo, y se entrega en UNO.
  //
  // ⚠ CUÁL de ellos no puede depender del orden de captura, y esto es la misma
  // falla que el bucle de arriba en pequeño. El lugar entra en `idemKey`
  // (`man_<tarea>_<periodo>_<LUGAR>_<persona>`), así que si la ficha de alguien
  // con «RH, FINANZAS» se reordenara a «FINANZAS, RH» —al reeditarla en
  // Personal, o porque un script reescriba su `datos`— la MISMA tarea del MISMO
  // día saldría con otro id y se crearía un SEGUNDO documento. Su denominador
  // volvería a inflarse, por la puerta de al lado.
  //
  // Se ordena, entonces. Cuál gane es arbitrario —la ficha no dice cuál de sus
  // áreas es «la suya»— pero arbitrario y ESTABLE no es lo mismo que arbitrario
  // y dependiente del orden. Es la lección del `order by` que le faltaba a la
  // siembra de plazas: el slot no significa nada, y aun así tiene que ser
  // reproducible para poder auditarlo.
  return [...lugares].sort((a, b) => a.localeCompare(b)).slice(0, 1);
}

// ============================================================================
//  LA LIMPIEZA: quitar las copias que el bucle viejo dejó de más
// ============================================================================
//
//  `lugaresDeEmision` impide que nazcan copias nuevas, pero las que ya
//  existían siguen ahí — y siguen inflando el denominador de quien las tiene.
//  Esto decide cuáles sobran. Vive AQUÍ, junto a la regla que emite, para que
//  las dos preguntas —«¿dónde se entrega?» y «¿qué sobra?»— las conteste la
//  MISMA función. Si la limpieza tuviera su propio criterio de qué sitio vale,
//  podría borrar justo lo que la emisión vuelve a crear diez minutos después.
//
//  Es pura: recibe lo leído y devuelve el plan. No borra nada; quien la llame
//  decide si escribe (el servidor en cada cambio de día, o el script a mano).

export interface ChecklistParaLimpiar {
  id: string;
  assigned: string;
  store: string;
  fecha: string;
  enviado?: boolean;
  archivado?: boolean;
  status?: string;
  datos?: any;
}

export interface PlanDeLimpieza {
  /** Las que sobran, cada una diciendo cuál se conserva en su lugar. */
  quitar: { id: string; assigned: string; store: string; fecha: string; conserva: string; conservaEn: string }[];
  /** Grupos que NO se tocan, con el motivo. Se reportan; no se resuelven solos. */
  conflictos: { assigned: string; fecha: string; lugares: string[]; motivo: string }[];
}

/**
 * ¿Alguien tocó este checklist?
 *
 * Deliberadamente AMPLIA: cualquier señal cuenta. El error se comete hacia el
 * lado de NO borrar, porque las consecuencias no son simétricas — dejar una
 * tarjeta de más es una molestia; borrar el turno que alguien ya hizo no se
 * deshace con una disculpa.
 *
 * Incluye el palomeo aunque no tenga foto: que la regla de cumplimiento no lo
 * cuente (Fase 2.1) no significa que la persona no lo haya hecho, y aquí la
 * pregunta es «¿trabajó en esto?», no «¿cumplió?».
 */
export function fueTrabajado(c: ChecklistParaLimpiar): boolean {
  if (!c) return true;                       // sin dato, no se toca
  if (c.enviado || c.archivado) return true;
  if (String(c.status || '') === 'completo') return true;
  const d = c.datos || {};
  if (String(d.notaEmpleado || '').trim()) return true;
  if (d.entregaConRetraso) return true;
  const items = Array.isArray(d.items) ? d.items : [];
  for (const it of items) {
    if (!it) continue;
    if (it.checked === true) return true;
    if (it.photo || it.photoAntes || it.photoDespues) return true;
    if (Array.isArray(it.photos) && it.photos.length) return true;
    if (String(it.comentario || '').trim()) return true;
    // Un monto de 0 es un arqueo que dio cero, no un campo vacío.
    if (it.monto !== undefined && it.monto !== null && it.monto !== '') return true;
    if (String(it.folio || '').trim()) return true;
  }
  return false;
}

/**
 * Qué copias sobran, agrupando por persona × tarea × día.
 *
 * La llave NO incluye el lugar, que es justo el eje por el que se duplicaron.
 *
 * @param checklists Solo del manual (`man_`), vivos, de hoy en adelante.
 * @param lugaresPorPersona Nombre normalizado → sucursales de su ficha.
 */
export function planDeLimpieza(
  checklists: ChecklistParaLimpiar[],
  lugaresPorPersona: Map<string, string[]>
): PlanDeLimpieza {
  const quitar: PlanDeLimpieza['quitar'] = [];
  const conflictos: PlanDeLimpieza['conflictos'] = [];
  const norm = (s: string) => String(s || '').trim().toLowerCase();

  const grupos = new Map<string, ChecklistParaLimpiar[]>();
  for (const c of checklists) {
    const tareaId = (c.datos || {})._tareaManualId;
    if (!tareaId) continue;                   // no es del emisor: no se toca
    // ⚠ LA ASIGNADA A MANO NUNCA SE TOCA. `entregarDelCatalogo` permite dar una
    // tarea del manual a alguien en el sitio que quien asigna elija, y ese sitio
    // puede no tener cuadrilla A PROPÓSITO. Borrarla sería deshacer la decisión
    // de una persona con un criterio pensado para las del robot.
    if ((c.datos || {})._asignadoAMano) continue;
    const k = norm(c.assigned) + '||' + tareaId + '||' + c.fecha;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(c);
  }

  for (const lista of grupos.values()) {
    if (lista.length < 2) continue;           // sin repetición no hay nada que quitar
    const base = lista[0];
    const lugares = lugaresPorPersona.get(norm(base.assigned));
    const info = { assigned: base.assigned, fecha: base.fecha, lugares: lista.map(c => c.store) };

    // Sin ficha no se decide: no se sabe cuáles son sus lugares.
    if (!lugares) {
      conflictos.push({ ...info, motivo: 'no encuentro su ficha activa por nombre' });
      continue;
    }
    const validos = new Set(lugaresDeEmision(lugares));
    const conservar = lista.filter(c => validos.has(c.store));
    const sobran = lista.filter(c => !validos.has(c.store));

    // Si no sobreviviría ninguna, no se borra el grupo entero: la persona se
    // quedaría sin la tarea. Puede pasar si su ficha cambió tras la emisión.
    if (conservar.length === 0) {
      conflictos.push({ ...info, motivo: 'la regla no conserva ninguna de las ' + lista.length });
      continue;
    }
    // Si una de las que sobran ya se trabajó, el grupo entero se mira a mano:
    // borrar la trabajada pierde el trabajo, y borrar la otra deja la tarjeta
    // en un sitio que la regla no reconoce. Ninguna de las dos la decide esto.
    const trabajadas = sobran.filter(fueTrabajado);
    if (trabajadas.length) {
      conflictos.push({
        ...info,
        motivo: 'una copia que sobra YA SE TRABAJÓ (' + trabajadas.map(c => c.store).join(', ') + ')',
      });
      continue;
    }

    for (const c of sobran) {
      quitar.push({
        id: c.id, assigned: c.assigned, store: c.store, fecha: c.fecha,
        conserva: conservar[0].id, conservaEn: conservar[0].store,
      });
    }
  }

  return { quitar, conflictos };
}

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
    // ⚠ LA NORMA CON LA QUE SE JUZGA, y cuál gana.
    //
    // Una tarea CAPTURADA (`tp-…`) trae su propio documento y su propia
    // versión en `selloPropio`, y esos mandan. Sin esa preferencia se sellaría
    // con los del manual PUBLICADO del puesto —lo único que esta función
    // conoce— y el checklist afirmaría venir de un documento en el que esa
    // tarea no está: para una cajera, «Manual Corporativo de Operación —
    // Cajera de Sucursal · v1.1». El `|| ''` hace que eso no falle, así que se
    // emitiría igual y simplemente no se podría auditar — el invariante §5.4
    // perdido justo en el paso que viene a cumplirlo.
    //
    // El código de formato NO se hereda: es el anexo del manual publicado y
    // una tarea capturada no tiene anexo. Heredarlo la haría citar un formato
    // que no le corresponde.
    _manualDocumento: tarea.selloPropio?.documento || manual?.documento || '',
    _manualCodigo: tarea.selloPropio ? '' : (manual?.codigo || ''),
    _manualVersion: tarea.selloPropio?.version || manual?.version || '',
    _formatoCodigo: tarea.codigoFormato || '',
    _momento: tarea.momento,
    _porEvento: !!tarea.porEvento,
    _nota: tarea.nota || '',
  };
}
