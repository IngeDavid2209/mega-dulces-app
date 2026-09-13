/**
 * 👥 QUIÉN CUBRE QUÉ PLAZA, Y QUÉ PLAZAS EXISTEN
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DOS PREGUNTAS, Y LA SEGUNDA NO SE PUEDE CONTESTAR SIN LA PRIMERA
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. ¿Qué plazas debe haber?   → se derivan de la PLANTILLA autorizada.
 *  2. ¿Quién ocupa cada una?    → la COBERTURA, que la captura la Encargada.
 *
 * Es el §4 del CLAUDE.md: «la plaza es permanente; el titular rota vía
 * cobertura». Y es lo que David pidió el 13/sep: «en anaquelista, si hay 3, no
 * tienen que ser con nombre, solo con anaquelista 1, anaquelista 2».
 *
 * ─── EL NÚMERO YA NO ES UN PROBLEMA, Y VALE EXPLICAR POR QUÉ ──────────────
 * El paso 3.1a dejó las plazas naciendo con `numero` en NULL, y con razón: se
 * sembraban desde el CENSO, y ordenar personas por nombre o por uid para
 * repartir los números habría sido inventar la cuadrilla (§8.5).
 *
 * Generándolas desde la PLANTILLA eso desaparece. La plantilla dice «cuatro
 * anaquelistas», así que las plazas son 1, 2, 3 y 4 antes de que exista una
 * sola persona: el número sale de la AUTORIZACIÓN, no de la gente. Quién es el
 * Anaquelista 1 lo decide la Encargada al asignar, que es exactamente donde esa
 * decisión pertenece.
 *
 * ─── LA DISTINCIÓN QUE ESTE ARCHIVO DEFIENDE ──────────────────────────────
 * `sin_asignar` y `hueco` NO son lo mismo (§5.2, la ausencia de datos no puede
 * significar dos cosas distintas):
 *
 *   · `hueco`       — alguien MIRÓ la plaza y declaró que hoy no la cubre nadie.
 *                     Es un dato, tiene autor y fecha, y es accionable.
 *   · `sin_asignar` — nadie ha dicho nada todavía. Es una pregunta abierta.
 *
 * Si los dos se pintaran igual, una sucursal que nunca pasa lista se vería
 * idéntica a una que declara todos sus huecos — y la que hace el trabajo bien
 * saldría peor. Es la misma trampa que `sin_plantilla` contra `excedente`.
 */
import { esPuestoDeclarado } from './plantilla.util';

/** Una fila de `mdtask_plazas`. */
export interface Plaza {
  id: string;
  puestoId: string;
  lugar: string;
  numero: number | null;
  unidad?: string | null;
  ambito?: string | null;
  turno?: string | null;
  vigente?: boolean;
}

/** Una fila de `mdtask_coberturas`. */
export interface Cobertura {
  id: string;
  plazaId: string;
  /** null SOLO cuando tipo === 'hueco'. */
  uid: string | null;
  tipo: 'titular' | 'suplencia' | 'hueco';
  desde: string;
  /** null = sigue abierta. Cerrar es ponerle fecha, no borrar (§5.5). */
  hasta: string | null;
  motivo?: string | null;
}

export type EstadoPlaza = 'cubierta' | 'suplencia' | 'hueco' | 'sin_asignar';

export interface PlazaDelDia {
  plaza: Plaza;
  estado: EstadoPlaza;
  /** El uid de quien la cubre hoy, o null. */
  uid: string | null;
  /** La cobertura que decidió el estado, para poder editarla o cerrarla. */
  cobertura: Cobertura | null;
  motivo?: string | null;
}

/** ¿Esta cobertura está vigente en esta fecha? */
export function coberturaVigenteEn(c: Cobertura, fechaYmd: string): boolean {
  if (!c || !c.desde || !fechaYmd) return false;
  if (fechaYmd < c.desde) return false;
  if (c.hasta && fechaYmd > c.hasta) return false;
  return true;
}

/**
 * La cobertura que manda en una plaza un día concreto.
 *
 * LA SUPLENCIA GANA AL TITULAR, y ese orden es la única razón por la que esta
 * función existe en vez de un `find`. Si mandara el titular, un día en que
 * alguien cubre a otra persona, la evidencia de ese día quedaría firmada con el
 * nombre del titular —que no estuvo— y el sistema estaría registrando algo
 * falso con toda la apariencia de un dato bueno. Eso es `verificado_falso`, la
 * quinta causa del §4, producida por el propio software.
 *
 * Entre dos del mismo tipo gana la que empezó DESPUÉS: es la más reciente y la
 * que alguien capturó al final. Con empate en `desde`, el id decide, para que
 * dos corridas den lo mismo — el mismo motivo que el `order by` del sembrador.
 */
export function coberturaDelDia(
  coberturas: Cobertura[], plazaId: string, fechaYmd: string,
): Cobertura | null {
  const candidatas = (coberturas || [])
    .filter(c => c && c.plazaId === plazaId && coberturaVigenteEn(c, fechaYmd));
  if (!candidatas.length) return null;

  const peso = (c: Cobertura) => (c.tipo === 'suplencia' ? 2 : c.tipo === 'hueco' ? 1 : 0);
  candidatas.sort((a, b) => {
    if (peso(a) !== peso(b)) return peso(b) - peso(a);
    if (a.desde !== b.desde) return a.desde < b.desde ? 1 : -1;
    return String(a.id).localeCompare(String(b.id));
  });
  return candidatas[0];
}

/**
 * El pase de lista de un día: cada plaza con quién la cubre.
 *
 * Devuelve TODAS las plazas vigentes, incluidas las que nadie ha tocado. Una
 * plaza que no aparece es una plaza que nadie va a llenar.
 */
export function pasarLista(
  plazas: Plaza[], coberturas: Cobertura[], fechaYmd: string,
): PlazaDelDia[] {
  const vigentes = (plazas || []).filter(p => p && p.vigente !== false);
  return vigentes.map(plaza => {
    const c = coberturaDelDia(coberturas, plaza.id, fechaYmd);
    if (!c) {
      // Nadie ha dicho nada. NO es un hueco: es una pregunta sin contestar.
      return { plaza, estado: 'sin_asignar' as EstadoPlaza, uid: null, cobertura: null };
    }
    if (c.tipo === 'hueco') {
      return { plaza, estado: 'hueco' as EstadoPlaza, uid: null, cobertura: c, motivo: c.motivo };
    }
    // Una cobertura de persona SIN uid no puede resolverse: se trata como lo
    // que es —un dato incompleto— y no como si la plaza estuviera cubierta.
    if (!c.uid) {
      return { plaza, estado: 'sin_asignar' as EstadoPlaza, uid: null, cobertura: c };
    }
    return {
      plaza,
      estado: (c.tipo === 'suplencia' ? 'suplencia' : 'cubierta') as EstadoPlaza,
      uid: c.uid, cobertura: c, motivo: c.motivo,
    };
  }).sort(ordenarPlazas);
}

/** Por puesto y luego por número. El orden de la cuadrilla, que es como se lee. */
function ordenarPlazas(a: PlazaDelDia, b: PlazaDelDia): number {
  if (a.plaza.puestoId !== b.plaza.puestoId) {
    return a.plaza.puestoId.localeCompare(b.plaza.puestoId);
  }
  const na = a.plaza.numero ?? Number.MAX_SAFE_INTEGER;
  const nb = b.plaza.numero ?? Number.MAX_SAFE_INTEGER;
  if (na !== nb) return na - nb;
  return String(a.plaza.id).localeCompare(String(b.plaza.id));
}

export interface ResumenDia {
  plazas: number;
  cubiertas: number;
  suplencias: number;
  huecos: number;
  sinAsignar: number;
  /** Personas asignadas a más de una plaza el mismo día. */
  duplicadas: string[];
}

/**
 * Los totales del día.
 *
 * `duplicadas` no es cosmética: una misma persona en dos plazas el mismo día
 * significa que su evidencia va a contar dos veces, y que una de las dos plazas
 * en realidad está sola. Es exactamente el defecto que la plaza vino a romper
 * —«los tres anaquelistas reciben la MISMA tarea»— reapareciendo por la puerta
 * de la cobertura, así que se detecta y se nombra en vez de sumarse.
 */
export function resumenDelDia(lista: PlazaDelDia[]): ResumenDia {
  const r: ResumenDia = {
    plazas: lista.length, cubiertas: 0, suplencias: 0, huecos: 0, sinAsignar: 0, duplicadas: [],
  };
  const porUid = new Map<string, number>();
  for (const p of lista) {
    if (p.estado === 'cubierta') r.cubiertas++;
    else if (p.estado === 'suplencia') r.suplencias++;
    else if (p.estado === 'hueco') r.huecos++;
    else r.sinAsignar++;
    if (p.uid) porUid.set(p.uid, (porUid.get(p.uid) || 0) + 1);
  }
  r.duplicadas = [...porUid.entries()].filter(([, n]) => n > 1).map(([uid]) => uid).sort();
  return r;
}

// ============================================================================
//  GENERAR LAS PLAZAS A PARTIR DE LA PLANTILLA
// ============================================================================

export interface PlanDePlazas {
  /** Plazas que hay que crear, ya numeradas y con su id. */
  crear: Plaza[];
  /**
   * Plazas que sobran respecto a la plantilla. NO se borran: se proponen para
   * retirar, y la decisión es de quien mira — puede haber gente dentro.
   */
  retirar: Plaza[];
  /** Puestos con plazas y sin renglón de plantilla. Ni se crean ni se retiran. */
  sinPlantilla: string[];
}

/** El id de una plaza. Estable y legible: 'Canindo::anaquelista::2'. */
export function idPlaza(lugar: string, puestoId: string, numero: number): string {
  return `${lugar}::${puestoId}::${numero}`;
}

/**
 * Qué plazas faltan y cuáles sobran para que el lugar cuadre con su plantilla.
 *
 * ─── POR QUÉ NUMERA BUSCANDO HUECOS Y NO CONTINUANDO LA SERIE ─────────────
 * Si existen las plazas 1, 2 y 4 y la plantilla pide cuatro, lo que falta es la
 * 3 — no una quinta. Continuar la serie dejaría una cuadrilla numerada
 * 1, 2, 4, 5 después de una sola baja, y a los dos meses los números no
 * significarían nada. Se rellena el primer número libre.
 *
 * ─── Y POR QUÉ NO BORRA NADA ──────────────────────────────────────────────
 * Cuando sobran plazas, las devuelve en `retirar` y ahí se acaba su trabajo.
 * Retirar una plaza ocupada dejaría a una persona sin sitio sin que nadie lo
 * decidiera; quien mire la pantalla tiene el dato y decide. Es el §8.5 aplicado
 * a una acción destructiva: si falta una decisión, se deja pendiente y visible.
 */
export function planDePlazas(
  lugar: string,
  plantilla: { puestoId: string; cantidad: number }[],
  plazasActuales: Plaza[],
): PlanDePlazas {
  const vigentes = (plazasActuales || []).filter(p => p && p.vigente !== false && p.lugar === lugar);
  const plan: PlanDePlazas = { crear: [], retirar: [], sinPlantilla: [] };

  const autorizado = new Map<string, number>();
  for (const r of plantilla || []) {
    if (!r || !r.puestoId) continue;
    autorizado.set(r.puestoId, Math.max(0, Math.trunc(Number(r.cantidad) || 0)));
  }

  const porPuesto = new Map<string, Plaza[]>();
  for (const p of vigentes) {
    const arr = porPuesto.get(p.puestoId) || [];
    arr.push(p); porPuesto.set(p.puestoId, arr);
  }

  for (const [puestoId, cantidad] of autorizado) {
    const actuales = (porPuesto.get(puestoId) || []).slice()
      .sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));

    if (actuales.length < cantidad) {
      const usados = new Set(actuales.map(p => p.numero).filter(n => n != null) as number[]);
      let n = 1;
      for (let i = actuales.length; i < cantidad; i++) {
        while (usados.has(n)) n++;
        usados.add(n);
        plan.crear.push({
          id: idPlaza(lugar, puestoId, n),
          puestoId, lugar, numero: n, vigente: true,
          // `ambito` y `turno` se quedan vacíos a propósito: ese inventario
          // físico no existe en ningún dato todavía (paso 3.1c).
          ambito: null, turno: null,
        });
      }
    } else if (actuales.length > cantidad) {
      // Sobran: se proponen las de número más alto, que son las últimas que se
      // crearon. Nunca se elige por quién está dentro.
      plan.retirar.push(...actuales.slice(cantidad));
    }
  }

  for (const puestoId of porPuesto.keys()) {
    if (!autorizado.has(puestoId)) plan.sinPlantilla.push(puestoId);
  }
  plan.sinPlantilla.sort();

  return plan;
}

/**
 * El nombre para mostrar de una plaza: «Anaquelista 2».
 *
 * Sin número devuelve solo el puesto, y NO inventa un «1»: una plaza sin número
 * es una plaza que nadie ha ordenado, y ponerle uno aquí sería fabricar la
 * cuadrilla en la capa de presentación, que es el peor sitio para inventar un
 * dato porque nadie lo audita.
 */
export function nombrePlaza(nombrePuesto: string, numero: number | null): string {
  return numero == null ? nombrePuesto : `${nombrePuesto} ${numero}`;
}

/** ¿Esta plaza es de un puesto declarado (de temporada)? */
export function plazaDeTemporada(p: Plaza): boolean {
  return esPuestoDeclarado(p?.puestoId);
}
