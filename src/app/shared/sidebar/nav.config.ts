/**
 * 🧭 EL MENÚ, COMO DATO
 *
 * Antes las 19 entradas vivían escritas a mano en `sidebar.html`, cada una con
 * su `*ngIf` — doce condiciones de permiso distintas repartidas por el archivo.
 * El menú no estaba desordenado: estaba **ordenado por fecha de construcción**,
 * y eso es lo que hacía que la app se sintiera sin estructura aunque cada módulo
 * por separado estuviera bien hecho.
 *
 * ─── LAS CUATRO SECCIONES SON FIJAS ─────────────────────────────────────────
 * El mismo esqueleto y el mismo orden para toda la empresa, del anaquelista al
 * Director. Lo que cambia no son las secciones: es **qué cabe dentro de cada una
 * según quién entró**. Las secciones contestan «¿qué vengo a hacer?», nunca
 * «¿qué módulo es?».
 *
 * ─── ESTE ES EL PASO 1, Y ES DELIBERADAMENTE FEO POR DENTRO ─────────────────
 * Las condiciones de abajo son LAS MISMAS BANDERAS DE HOY (`grupoTec`,
 * `puedeVerEstadisticas`, `alcance`…), movidas del HTML a este archivo. No se
 * arreglaron aquí a propósito: el paso 2 las reemplaza por una función de
 * alcance sobre la plaza, y eso necesita que la plaza exista (Fase 3).
 *
 * Lo que sí se gana hoy: **una sola definición**. El HTML solo recorre lo que
 * este archivo devuelve, así que agregar una entrada es agregar una línea aquí —
 * y una entrada que no esté aquí, no existe. Fea por dentro, ordenada por fuera.
 *
 * ─── LA REGLA DE TAMAÑO ES UN LÍMITE DURO ───────────────────────────────────
 * Máximo **siete entradas visibles por nivel**. Si un módulo nuevo no cabe en
 * una sección existente, no es un módulo: es una pestaña de una pantalla que ya
 * existe. Así se llegó a 19.
 */

// El permiso del cascaron NO se repite aqui: se importa de su propia
// definicion, para que menu y guard cambien juntos o no cambien.
import { veControl } from '../../modules/dashboard/control/control.tabs';

export type SeccionNav = 'mi-trabajo' | 'verifico' | 'control' | 'definiciones';

export interface SeccionInfo {
  clave: SeccionNav;
  titulo: string;
  /** Para qué es la sección. Se muestra como ayuda, no como adorno. */
  proposito: string;
}

/** El orden NUNCA cambia, y no se agregan secciones nuevas. */
export const SECCIONES: SeccionInfo[] = [
  { clave: 'mi-trabajo',   titulo: 'Mi trabajo',
    proposito: 'Lo que debo hacer y probar hoy' },
  { clave: 'verifico',     titulo: 'Lo que verifico',
    proposito: 'La muestra que me toca comprobar' },
  { clave: 'control',      titulo: 'Control',
    proposito: 'Los números de mi alcance' },
  { clave: 'definiciones', titulo: 'Definiciones',
    proposito: 'Lo que se establece y casi no se toca' },
];

export interface EntradaNav {
  seccion: SeccionNav;
  etiqueta: string;
  ruta: string;
  /** Nombre del icono; el HTML lo resuelve contra su propio juego de SVG. */
  icono: string;
  /**
   * ¿Quién la ve? Recibe el usuario y devuelve true/false.
   *
   * PASO 1: son las banderas de hoy, tal cual estaban en el HTML. No se
   * inventó ni se endureció ninguna — cambiar quién ve qué en el mismo paso que
   * se reorganiza el menú haría imposible saber cuál de los dos cambios rompió
   * algo si algo se rompe.
   */
  ve: (u: any) => boolean;
  /**
   * Fuera del menú pero con la ruta viva. Son las huérfanas: existen, tienen
   * guard, y solo se llega por un enlace que alguien pasó por WhatsApp.
   * Se dejan visibles AQUÍ, en un solo lugar, en vez de repartidas en seis
   * rutas donde nadie recuerda que están — hasta que se decida su destino.
   */
  oculta?: boolean;
  /** Por qué está oculta, para que la decisión se pueda tomar informada. */
  nota?: string;
}

const siempre = () => true;
const esAdmin = (u: any) => u?.rol === 'admin';

export const NAV: EntradaNav[] = [
  // ── 1 · MI TRABAJO ────────────────────────────────────────────────────
  // Todos la tienen y nunca está vacía. Es siempre la primera.
  { seccion: 'mi-trabajo', etiqueta: 'Tareas del Manual', ruta: '/tareas-manual',
    icono: 'manual', ve: siempre },
  { seccion: 'mi-trabajo', etiqueta: 'Tareas fuera del manual', ruta: '/checklist',
    icono: 'check', ve: siempre },
  { seccion: 'mi-trabajo', etiqueta: 'Agenda Personal', ruta: '/agenda',
    icono: 'agenda', ve: siempre },

  // Los cinco SERVICIOS. Salen de la raíz: no son secciones de la operación,
  // son servicios con dueño. Aparecen en «Mi trabajo» de quien los opera.
  { seccion: 'mi-trabajo', etiqueta: 'Espacio TEC', ruta: '/tec',
    icono: 'tec', ve: (u) => u?.grupoTec === true },
  { seccion: 'mi-trabajo', etiqueta: 'Tickets', ruta: '/tickets',
    icono: 'ticket', ve: (u) => u?.grupoTickets === true || esAdmin(u) },
  { seccion: 'mi-trabajo', etiqueta: 'Pagos', ruta: '/pagos',
    icono: 'pago', ve: (u) => u?.grupoPagos === true || esAdmin(u) },

  // Promociones y Venta de Promos NO se resolvian con una bandera sino con dos
  // getters del componente: basta CUALQUIERA de sus tres permisos porque la
  // seccion es una sola y adentro se decide que puede hacer cada quien. La
  // logica se copia tal cual — cambiar quien ve que en el mismo paso que se
  // reorganiza el menu haria imposible saber cual de los dos rompio algo.
  { seccion: 'mi-trabajo', etiqueta: 'Promociones', ruta: '/promociones',
    icono: 'promo',
    ve: (u) => u?.promocionesFormato === true
            || u?.promocionesExpediente === true
            || u?.grupoPromociones === true },
  { seccion: 'mi-trabajo', etiqueta: 'Venta de Promos', ruta: '/venta-promos',
    icono: 'venta',
    ve: (u) => u?.ventaPromosCaja === true
            || u?.ventaPromosVendedor === true
            || u?.ventaPromosMonitor === true },

  // ── 2 · LO QUE VERIFICO ───────────────────────────────────────────────
  // La sección que HOY NO EXISTE. Queda declarada y vacía a propósito: sin
  // plaza no hay «muestra del nivel de abajo» que mostrar, y llenarla con lo que
  // hay sería fingir que el nivel 3 de la pirámide ya ocurre. La sección no se
  // pinta si no tiene entradas visibles.

  // ── 3 · CONTROL ───────────────────────────────────────────────────────
  // El Dashboard sigue visible para TODOS, como hoy. El documento 4 lo parte en
  // «Tablero de unidades» (dirección) y «Mi zona / Mi sucursal» (gerencia,
  // encargado), y dice que el operador no deberia verlo — pero eso es cambiar
  // quien ve que, y no va en este paso.
  { seccion: 'control', etiqueta: 'Dashboard', ruta: '/home',
    icono: 'inicio', ve: siempre },
  // Los cuatro de análisis son cortes de la misma pregunta. Se funden en una
  // pantalla con pestañas en el paso 4.1b; hoy siguen separados pero YA
  // agrupados, que es lo que se puede hacer sin tocar cuatro componentes.
  { seccion: 'control', etiqueta: 'Sucursales', ruta: '/checkstore',
    icono: 'tienda', ve: (u) => esAdmin(u) || u?.puedeVerCheckstore },
  // Control operativo: una entrada por las cuatro pantallas de analisis. Se ve
  // si se ve AL MENOS UNA pestaña; cada pestaña se gatea aparte por su propio
  // permiso. Entrar al cascaron nunca da acceso a una pestaña.
  { seccion: 'control', etiqueta: 'Control operativo', ruta: '/control',
    icono: 'grafica', ve: veControl },
  { seccion: 'control', etiqueta: 'Productividad y turno', ruta: '/productividad',
    icono: 'reloj', ve: (u) => esAdmin(u) || u?.puedeVerEstadisticas || u?.puedeVerCheckstore },
  { seccion: 'control', etiqueta: 'Auditoría', ruta: '/reportes',
    icono: 'lupa', ve: (u) => esAdmin(u) || u?.puedeVerHistorial },
  { seccion: 'control', etiqueta: 'Cierre Mensual', ruta: '/cierre-mensual',
    icono: 'pdf', ve: (u) => esAdmin(u) && (u?.alcance === 'global' || !u?.alcance) },

  // ── 4 · DEFINICIONES ──────────────────────────────────────────────────
  // Al fondo porque se visita una vez al mes, no diario.
  { seccion: 'definiciones', etiqueta: 'Manual por Puesto', ruta: '/manual-puestos',
    icono: 'libro', ve: (u) => esAdmin(u) || u?.puedeCrearRutinas },
  { seccion: 'definiciones', etiqueta: 'Usuarios', ruta: '/personal',
    icono: 'gente', ve: (u) => esAdmin(u) || u?.puedeAdministrarPersonal },
  { seccion: 'definiciones', etiqueta: 'Días de Descanso', ruta: '/descansos',
    icono: 'calendario', ve: (u) => esAdmin(u) || u?.puedeAdministrarPersonal },

  // ── LAS SEIS HUÉRFANAS ────────────────────────────────────────────────
  // Existen, tienen ruta y guard, y NUNCA han tenido entrada de menú. Se
  // registran aquí ocultas para que la decisión —darles lugar o retirarlas
  // formalmente— se tome en UN lugar y con la lista enfrente, en vez de seguir
  // repartida en seis rutas que nadie recuerda. Nadie la ha tomado todavía.
  { seccion: 'control', etiqueta: 'Calendario', ruta: '/calendario', icono: 'calendario',
    ve: esAdmin, oculta: true, nota: 'huérfana · el documento la ubica en Definiciones (gerencia)' },
  { seccion: 'definiciones', etiqueta: 'Áreas', ruta: '/areas', icono: 'area',
    ve: esAdmin, oculta: true, nota: 'huérfana · se absorbe en Estructura y plazas: las áreas son ámbitos' },
  { seccion: 'definiciones', etiqueta: 'Turnos', ruta: '/turnos', icono: 'reloj',
    ve: esAdmin, oculta: true, nota: 'huérfana · se funde con Días de Descanso' },
  { seccion: 'definiciones', etiqueta: 'Bloques', ruta: '/bloques', icono: 'bloque',
    ve: esAdmin, oculta: true, nota: 'huérfana · es un generador, no una pantalla de operación · SIN DECIDIR' },
  { seccion: 'mi-trabajo', etiqueta: 'Flotilla', ruta: '/flotilla', icono: 'camion',
    ve: esAdmin, oculta: true, nota: 'huérfana · servicio · SIN DECIDIR si sigue en uso' },
  { seccion: 'verifico', etiqueta: 'Tareas asignadas', ruta: '/tareas-asignadas', icono: 'check',
    ve: esAdmin, oculta: true, nota: 'huérfana · es la muestra del que asignó: pertenece a Lo que verifico' },
];

/** Las entradas visibles para este usuario, agrupadas por sección. */
export function menuDe(u: any): { seccion: SeccionInfo; entradas: EntradaNav[] }[] {
  return SECCIONES
    .map(seccion => ({
      seccion,
      entradas: NAV.filter(e => e.seccion === seccion.clave && !e.oculta && e.ve(u)),
    }))
    // Una sección sin entradas no se pinta. Es lo que mantiene «Lo que
    // verifico» invisible hasta que exista la plaza que la llene.
    .filter(g => g.entradas.length > 0);
}

/** Cuántas entradas ve alguien. Sirve para vigilar el límite de siete. */
export function totalVisible(u: any): number {
  return NAV.filter(e => !e.oculta && e.ve(u)).length;
}
