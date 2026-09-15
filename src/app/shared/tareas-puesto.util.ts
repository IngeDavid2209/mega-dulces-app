/**
 * 📋 LA NORMA COMO DATO — tareas capturadas para puestos sin manual
 *
 * Fase 7, paso 7.1a. Instrucción de David (14/sep/2026): «quiero que todos los
 * puestos tengan sus tareas propias activas». Medido antes de escribir esto:
 *
 *     19 de 89 puestos tienen manual escrito en `tareas-manual.catalogo.ts`
 *     70 no lo tienen · 38 de ellos CON GENTE · 104 personas (54% de la nómina)
 *
 * A esas 104 personas no se les podía «activar» nada: no existe el documento.
 * Escribírselo desde el código habría sido inventarles obligaciones (§8.5), y
 * cada corrección un despliegue (hallazgo 5). Así que la norma baja a dato: la
 * captura Dirección/Capital Humano y vive en `mdtask_tareas_puesto` (060).
 *
 * ─── ESTE ARCHIVO ES LA REGLA, NO EL FORMULARIO ────────────────────────────
 * Vive en `shared/` y no dentro del componente a propósito. La pantalla de
 * captura y —en el paso siguiente— el emisor tienen que juzgar «¿esta tarea se
 * repite?» con LA MISMA función. Dos implementaciones divergirían en silencio,
 * y la divergencia se vería como una persona con el denominador inflado sin
 * causa visible (§8.11 d).
 *
 * ─── «QUE NINGUNA TAREA SE REPITA» ES SEIS COMPROBACIONES, NO UNA ──────────
 * Instrucción expresa de David el mismo día. Medido sobre el catálogo en
 * código: está limpio en las seis clases (0 ids duplicados, 0 puntos repetidos
 * dentro de una tarea, 0 puntos repetidos entre tareas diarias del mismo
 * puesto, 0 nombres repetidos, 0 códigos repetidos dentro de su documento). La
 * única repetición real son las 3 tareas del Checador, que llegan a `checador`
 * y `checador-cedis` — no se duplican para nadie, pero suman dos veces al
 * agregar por unidad.
 *
 * Lo que este archivo impide es que la captura a mano introduzca lo que el
 * catálogo no tiene. Y el duplicado que de verdad llega NO viene escrito
 * idéntico: viene como «Apertura» contra «apertura », o con una tilde de
 * menos. Por eso todas las comparaciones pasan por `normalizarNombre()`, que
 * es la MISMA función con la que `resolverPuesto` arma su índice de alias —
 * no una segunda normalización libre de discrepar.
 *
 * ─── POR QUÉ UNAS COSAS BLOQUEAN Y OTRAS SOLO AVISAN ───────────────────────
 * Un duplicado exacto de nombre BLOQUEA: no hay lectura en la que dos tareas
 * con el mismo nombre en el mismo puesto sean correctas, y el índice único de
 * la tabla las rechazaría de todos modos (mejor decirlo antes que fallar al
 * guardar).
 *
 * Un punto repetido en DOS tareas distintas solo AVISA, y la distinción
 * importa: «Caja limpia» en la tarea de apertura y en la de cierre es correcto
 * — se verifica dos veces al día, a propósito. Bloquearlo obligaría a quien
 * captura a deformar el texto para esquivar la validación, que es peor que el
 * duplicado. El aviso nombra la otra tarea para que decida quien sabe.
 */

import { normalizarNombre } from './permisos.util';
import {
  FrecuenciaManual, MomentoManual, TareaManual, ItemManual,
  tareasDePuesto, tareasAutomaticasDePuesto,
} from './tareas-manual.catalogo';

/** Un día de la semana tal como lo acepta la tabla y el catálogo. */
export type DiaSemanaManual =
  'Lunes' | 'Martes' | 'Miércoles' | 'Jueves' | 'Viernes' | 'Sábado';

export const DIAS_CAPTURABLES: DiaSemanaManual[] =
  ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export const MOMENTOS_CAPTURABLES: MomentoManual[] =
  ['apertura', 'operacion', 'cierre', 'supervision', 'administrativo'];

export const FRECUENCIAS_CAPTURABLES: FrecuenciaManual[] =
  ['Diaria', 'Semanal', 'Quincenal', 'Mensual'];

/** Etiqueta legible del momento, para no repetirla en cada plantilla. */
export const ETIQUETA_MOMENTO: Record<MomentoManual, string> = {
  apertura: 'Apertura',
  operacion: 'Operación',
  cierre: 'Cierre',
  supervision: 'Supervisión',
  administrativo: 'Administrativo',
};

/** Una fila de `mdtask_tareas_puesto`, tal como la devuelve el endpoint. */
export interface TareaDePuesto {
  id: string;
  puestoId: string;
  nombre: string;
  momento: MomentoManual;
  frecuencia: FrecuenciaManual;
  diaSemana?: DiaSemanaManual | null;
  diaMes?: number | null;
  horaLimite: string;
  documento?: string | null;
  /** Con qué versión se juzga. Obligatoria: sin ella no hay hoja de auditoría. */
  version: string;
  vigente: boolean;
  /** Si corrige a otra, el id de la anterior (§5.5: corregir es evento nuevo). */
  reemplazaA?: string | null;
  creadoEn?: number | null;
  creadoPor?: string | null;
  motivo?: string | null;
  /** Los puntos de control. Viajan en `datos` jsonb. */
  items: ItemManual[];
}

/** El prefijo NO es convención: la tabla lo exige con un `check`. */
export const PREFIJO_TAREA_PUESTO = 'tp-';

/**
 * Convierte una tarea capturada en una `TareaManual`, que es el tipo que ya
 * entienden el emisor y todas las pantallas.
 *
 * La conversión existe para que el paso siguiente —que el emisor las
 * entregue— no tenga que aprender un segundo formato. Una tarea capturada y
 * una publicada se juzgan con el mismo código o acaban juzgándose distinto.
 */
export function aTareaManual(t: TareaDePuesto): TareaManual {
  return {
    id: t.id,
    nombre: t.nombre,
    momento: t.momento,
    frecuencia: t.frecuencia,
    ...(t.diaSemana ? { diaSemana: t.diaSemana } : {}),
    ...(t.diaMes != null ? { diaMes: t.diaMes } : {}),
    horaLimite: t.horaLimite,
    items: t.items || [],
    // ⚠ SU PROPIA NORMA VIAJA CON ELLA. Sin esto, el checklist que salga de
    // esta tarea se sellaría con el documento y la versión del manual
    // PUBLICADO del puesto —lo único que `armarChecklist` conoce— y afirmaría
    // venir de un documento en el que no está. Ver `selloPropio`.
    //
    // `version` es `not null` en la tabla (060) justo por esto; `documento`
    // puede venir vacío, y entonces se dice con todas sus letras en vez de
    // heredar el del manual publicado, que sería la mentira que se viene a
    // evitar.
    selloPropio: {
      documento: (t.documento || '').trim() || 'Tarea capturada (sin documento)',
      version: t.version,
    },
  };
}

/** Las capturadas y vigentes de un puesto. */
export function declaradasDePuesto(
  puestoId: string | undefined | null,
  todas: TareaDePuesto[],
): TareaDePuesto[] {
  if (!puestoId) return [];
  return (todas || []).filter(t => t.vigente && t.puestoId === puestoId);
}

/**
 * Todo lo que hoy le tocaría a un puesto: su manual publicado (si lo tiene)
 * MÁS lo capturado. En ese orden, porque el catálogo es la norma autorizada y
 * lo capturado la complementa.
 */
export function tareasCombinadasDePuesto(
  puestoId: string | undefined | null,
  declaradas: TareaDePuesto[],
): TareaManual[] {
  const publicadas = tareasDePuesto(puestoId);
  const propias = declaradasDePuesto(puestoId, declaradas).map(aTareaManual);
  return [...publicadas, ...propias];
}

/**
 * Lo que el EMISOR entrega hoy a un puesto: su manual publicado MÁS lo
 * capturado, quitando lo que depende de un evento impredecible.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ NO SE REUSA `tareasCombinadasDePuesto`, QUE PARECE LA MISMA
 * ═══════════════════════════════════════════════════════════════════════════
 * Porque contestan preguntas distintas y confundirlas entrega de más.
 * `tareasCombinadasDePuesto` es para MOSTRAR la hoja de un puesto, y ahí las
 * de solo-evento deben verse: existen en el manual y alguien las consulta.
 * Ésta es para ENTREGAR, y una tarea de solo-evento no se puede anticipar —
 * el disparador es un siniestro, un cambio de custodia, un alta de unidad.
 *
 * MEDIDO antes de escribir esto, para que no sea una precaución teórica: hay
 * exactamente **1** tarea `soloPorEvento` en el catálogo, en
 * `aux-logistica-flotilla`. Si el emisor hubiera pasado a la función de
 * mostrar, esa persona habría empezado a recibir una tarea que hoy no recibe,
 * sin que nadie lo pidiera y sin una línea en ningún log. Un cambio silencioso
 * de lo que se le exige a alguien es justo lo que este proyecto persigue.
 *
 * Las capturadas NO se filtran por evento: la tabla no tiene esa columna, así
 * que todas son automáticas. El día que la tenga, se filtra aquí.
 */
export function tareasAutomaticasCombinadas(
  puestoId: string | undefined | null,
  declaradas: TareaDePuesto[],
): TareaManual[] {
  const publicadas = tareasAutomaticasDePuesto(puestoId);
  const propias = declaradasDePuesto(puestoId, declaradas).map(aTareaManual);
  return [...publicadas, ...propias];
}

/**
 * Un id único para una tarea nueva.
 *
 * Base 36 del epoch COMPLETO, no `String(epoch).slice(-6)`: esa forma colisionó
 * de verdad el 13/sep en `idDeclarado` — seis dígitos de milisegundos solo
 * distinguen dentro de ~16 minutos, y dos tareas con el mismo id habrían hecho
 * que los checklists de una apuntaran a la otra (§5.5, historia reescrita en
 * silencio).
 *
 * Y aun así se comprueba contra los ya usados y se alarga hasta ser único,
 * como `generarCodigos()` de las plazas: en el mismo milisegundo dos capturas
 * producirían el mismo sufijo, y el índice de la tabla lo rechazaría con un
 * error que nadie sabría leer.
 */
export function nuevoIdTareaPuesto(
  puestoId: string,
  nombre: string,
  yaUsados: Iterable<string>,
  ahora: number = Date.now(),
): string {
  const usados = new Set(yaUsados);
  const slug = (s: string) => normalizarNombre(s).replace(/\s+/g, '-').slice(0, 24) || 'x';
  const base = `${PREFIJO_TAREA_PUESTO}${slug(puestoId)}-${slug(nombre)}`;
  let sufijo = ahora.toString(36);
  let id = `${base}-${sufijo}`;
  let n = 0;
  while (usados.has(id)) {
    n++;
    id = `${base}-${sufijo}${n.toString(36)}`;
  }
  return id;
}

/** Un problema encontrado al revisar un borrador. */
export interface AvisoTarea {
  /** `bloquea` impide guardar; `avisa` se muestra y deja decidir. */
  nivel: 'bloquea' | 'avisa';
  campo: 'nombre' | 'items' | 'frecuencia' | 'horaLimite' | 'version';
  texto: string;
}

/** Lo que se está capturando, antes de tener id. */
export interface BorradorTarea {
  puestoId: string;
  nombre: string;
  momento: MomentoManual;
  frecuencia: FrecuenciaManual;
  diaSemana?: DiaSemanaManual | null;
  diaMes?: number | null;
  horaLimite: string;
  version: string;
  items: { texto: string }[];
}

/**
 * LAS SEIS COMPROBACIONES. Devuelve la lista de problemas; vacía = se puede
 * guardar. Ver la cabecera para por qué unas bloquean y otras avisan.
 *
 * `declaradas` son TODAS las capturadas (de cualquier puesto): se filtran aquí
 * por el puesto del borrador, para que quien llama no pueda pasar una lista ya
 * recortada por un criterio distinto.
 *
 * `idEditando` permite revisar una tarea contra las demás sin que se choque
 * consigo misma al publicar una versión nueva.
 */
export function revisarTareaPuesto(
  b: BorradorTarea,
  declaradas: TareaDePuesto[],
  idEditando?: string | null,
): AvisoTarea[] {
  const avisos: AvisoTarea[] = [];
  const norm = (s: string) => normalizarNombre(s);

  // ── 1 · El nombre existe y no está repetido en ese puesto ───────────────
  const nombre = (b.nombre || '').trim();
  if (!nombre) {
    avisos.push({ nivel: 'bloquea', campo: 'nombre', texto: 'La tarea necesita un nombre.' });
  } else {
    const nn = norm(nombre);
    // Contra el manual publicado: una tarea capturada que se llame igual que
    // una del documento haría que la persona reciba las dos y no sepa cuál es.
    const chocaPublicada = tareasDePuesto(b.puestoId).find(t => norm(t.nombre) === nn);
    if (chocaPublicada) {
      avisos.push({
        nivel: 'bloquea', campo: 'nombre',
        texto: `El manual publicado de este puesto ya tiene una tarea llamada «${chocaPublicada.nombre}». ` +
               `Si hay que cambiarla, se publica una versión del manual, no se captura otra encima.`,
      });
    }
    const chocaDeclarada = declaradasDePuesto(b.puestoId, declaradas)
      .find(t => t.id !== idEditando && norm(t.nombre) === nn);
    if (chocaDeclarada) {
      avisos.push({
        nivel: 'bloquea', campo: 'nombre',
        texto: `Este puesto ya tiene una tarea vigente llamada «${chocaDeclarada.nombre}».`,
      });
    }
  }

  // ── 2 · Tiene puntos de control ─────────────────────────────────────────
  const textos = (b.items || []).map(i => (i.texto || '').trim()).filter(Boolean);
  if (!textos.length) {
    avisos.push({
      nivel: 'bloquea', campo: 'items',
      texto: 'Una tarea sin puntos de control no se puede cumplir ni incumplir: no se emite.',
    });
  }

  // ── 3 · Sus puntos no se repiten entre sí ───────────────────────────────
  const vistos = new Map<string, string>();
  for (const t of textos) {
    const k = norm(t);
    if (!k) continue;
    if (vistos.has(k)) {
      avisos.push({
        nivel: 'bloquea', campo: 'items',
        texto: `El punto «${t}» está dos veces en esta misma tarea.`,
      });
    } else {
      vistos.set(k, t);
    }
  }

  // ── 4 · Sus puntos no están ya en otra tarea del mismo puesto ───────────
  //
  // AVISA, no bloquea: «Caja limpia» en apertura y en cierre es correcto. Ver
  // la cabecera.
  const otras: { nombre: string; items: ItemManual[] }[] = [
    ...tareasDePuesto(b.puestoId).map(t => ({ nombre: t.nombre, items: t.items || [] })),
    ...declaradasDePuesto(b.puestoId, declaradas)
      .filter(t => t.id !== idEditando)
      .map(t => ({ nombre: t.nombre, items: t.items || [] })),
  ];
  for (const [k, original] of vistos) {
    const otra = otras.find(o => (o.items || []).some(i => norm(i.texto) === k));
    if (otra) {
      avisos.push({
        nivel: 'avisa', campo: 'items',
        texto: `«${original}» ya es un punto de «${otra.nombre}». Si es a propósito ` +
               `(verificar dos veces al día), déjalo; si no, la persona lo haría dos veces.`,
      });
    }
  }

  // ── 5 · La frecuencia está completa ─────────────────────────────────────
  //
  // Una Semanal sin día y una Mensual sin día del mes NO SE EMITEN NUNCA, y eso
  // se ve exactamente igual que «esa persona no tiene nada que hacer». La tabla
  // también lo rechaza; aquí se dice antes, en el campo.
  if (b.frecuencia === 'Semanal' && !b.diaSemana) {
    avisos.push({
      nivel: 'bloquea', campo: 'frecuencia',
      texto: 'Una tarea semanal necesita su día, o no se entrega ningún día.',
    });
  }
  if (b.frecuencia === 'Mensual' && !(b.diaMes && b.diaMes >= 1 && b.diaMes <= 31)) {
    avisos.push({
      nivel: 'bloquea', campo: 'frecuencia',
      texto: 'Una tarea mensual necesita su día del mes (1 a 31), o no se entrega ningún mes.',
    });
  }

  // ── 6 · La hora límite y la versión son legibles ────────────────────────
  if (!/^\d{2}:\d{2}$/.test(String(b.horaLimite || ''))) {
    avisos.push({
      nivel: 'bloquea', campo: 'horaLimite',
      texto: 'La hora límite va en formato HH:mm (por ejemplo 19:00).',
    });
  }
  if (!String(b.version || '').trim()) {
    avisos.push({
      nivel: 'bloquea', campo: 'version',
      texto: 'Sin versión no se puede saber después con qué regla se juzgó un día pasado.',
    });
  }

  return avisos;
}

/** ¿Este borrador se puede guardar? */
export function puedeGuardarse(avisos: AvisoTarea[]): boolean {
  return !avisos.some(a => a.nivel === 'bloquea');
}
