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
import { hayTableroPara, esJefatura, veUsuarios } from '../alcance.util';

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
  // ⚠ UNA SOLA ENTRADA desde el 14/sep/2026. Eran dos —«Tareas del Manual» y
  //   «Tareas fuera del manual»— y las dos con `ve: siempre`, así que fundirlas
  //   NO cambia la audiencia de nadie: quien veía las dos ve ésta.
  //
  //   El origen de la tarea dejó de ser una entrada de menú y pasó a ser un chip
  //   dentro de la pantalla (Todas · Del manual · Fuera del manual). Instrucción
  //   de David: «quiero que queden unidas […] solo que esté todo ahí».
  //
  //   Las dos rutas viejas siguen vivas como redirección, cada una a su chip.
  { seccion: 'mi-trabajo', etiqueta: 'Tareas', ruta: '/tareas',
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
  // ⚠️ EL DASHBOARD PASA A SER DE JEFATURAS. Es un CAMBIO INTENCIONAL de
  // audiencia — el primero del proyecto — y por eso la prueba de audiencias
  // lo lleva declarado en `CAMBIOS_INTENCIONALES`.
  //
  // El documento 4 ya lo pedia: el Dashboard es un tablero de control y «el
  // operador no deberia verlo». Se dejo para despues en el paso 4.1 porque ese
  // paso NO cambiaba quien ve que; ahora se hace a proposito.
  //
  // «Jefatura» = TIENE GENTE DEBAJO en el organigrama, no un nivel de una
  // lista: tomar el nivel `jefatura` literal dejaria fuera a Direccion y a las
  // Gerencias, que estan arriba. Sale del mismo `reportaA` que la piramide, asi
  // que se mueve solo cuando el organigrama cambie.
  //
  // OJO: la RUTA sigue abierta. Esto quita la entrada del menu, no el acceso —
  // quien caiga en /home por el aterrizaje por defecto la sigue viendo. Poner
  // el aterrizaje por nivel es el paso 4.4.
  { seccion: 'control', etiqueta: 'Dashboard', ruta: '/home',
    // EL MISMO predicado que el guard y que la pantalla. Con `esJefatura` la
    // entrada apuntaba a una pagina VACIA para gerencias y Encargadas: el
    // tablero solo se pinta con alcance global. Un menu que lleva a una
    // pantalla en blanco es peor que no tener la entrada.
    icono: 'inicio', ve: hayTableroPara },
  // UNA entrada por las cuatro pantallas de analisis —Estadisticas, Ranking,
  // Productividad y Sucursales—, que son cortes de la misma pregunta. Se ve si
  // se ve AL MENOS UNA pestaña; cada pestaña se gatea aparte por su propio
  // permiso. Entrar al cascaron nunca da acceso a una pestaña.
  { seccion: 'control', etiqueta: 'Control operativo', ruta: '/control',
    icono: 'grafica', ve: veControl },
  // Operacion de CADA DIA, por eso va en Control y no en Definiciones: la
  // Encargada entra aqui al abrir su turno, no una vez al mes.
  { seccion: 'control', etiqueta: 'Pase de lista', ruta: '/pase-lista',
    icono: 'gente', ve: esJefatura },
  { seccion: 'control', etiqueta: 'Auditoría', ruta: '/reportes',
    icono: 'lupa', ve: (u) => esAdmin(u) || u?.puedeVerHistorial },
  { seccion: 'control', etiqueta: 'Cierre Mensual', ruta: '/cierre-mensual',
    icono: 'pdf', ve: (u) => esAdmin(u) && (u?.alcance === 'global' || !u?.alcance) },

  // ── 4 · DEFINICIONES ──────────────────────────────────────────────────
  // Al fondo porque se visita una vez al mes, no diario.
  { seccion: 'definiciones', etiqueta: 'Manual por Puesto', ruta: '/manual-puestos',
    icono: 'libro', ve: (u) => esAdmin(u) || u?.puedeCrearRutinas },
  // La estructura de cada sucursal: cuantas plazas de cada puesto debe haber.
  // Va junto a Manual por Puesto y Usuarios porque es lo mismo que ellas: una
  // DEFINICION de como esta armada la empresa, no un corte de datos.
  { seccion: 'definiciones', etiqueta: 'Plantilla de sucursal', ruta: '/plantilla',
    icono: 'tienda', ve: esJefatura },
  // Solo el dueño y Direccion General (13/sep). Antes: cualquier admin o quien
  // trajera `puedeAdministrarPersonal` — una bandera que se otorga DESDE esta
  // misma pantalla, asi que el acceso se propagaba solo.
  { seccion: 'definiciones', etiqueta: 'Usuarios', ruta: '/personal',
    icono: 'gente', ve: veUsuarios },
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
