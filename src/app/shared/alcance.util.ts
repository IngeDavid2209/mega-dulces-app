/**
 * 🎚️ ALCANCE Y RANGO DESDE EL ORGANIGRAMA
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠ LA CABECERA ANTERIOR ESTÁ DEROGADA — decía lo contrario de lo que pasa
 * ═══════════════════════════════════════════════════════════════════════════
 * Este archivo nació el 2/sep diciendo, con estas palabras:
 *
 *     «ESTE ARCHIVO TODAVÍA NO CAMBIA LO QUE VE NADIE […] Nada de este archivo
 *      está enganchado a un guard, a un menú ni a una consulta.»
 *
 * Era verdad ese día y dejó de serlo el 13/sep, cuando `esJefatura`,
 * `hayTableroPara` y `veUsuarios` pasaron a gobernar el menú, `home.guard`,
 * `estructuraGuard` y `usuariosGuard`. **Nadie actualizó el texto**, así que
 * durante seis días el archivo afirmaba ser inerte mientras cerraba pantallas.
 * Se cita aquí en vez de borrarlo para que nadie lo relea como vigente, que es
 * exactamente lo que hizo la Fase 2.1 con la regla de cumplimiento.
 *
 * ─── QUÉ ESTÁ VIVO Y QUÉ SIGUE SIENDO CÁLCULO ─────────────────────────────
 *   VIVO      `esJefatura` · `hayTableroPara` · `verNivelEmpresa` · `veUsuarios`
 *             — los usan el menú, cuatro guards y el tablero.
 *   CÁLCULO   `Amplitud` · `alcancePropuesto` · `alcanceActual` ·
 *             `compararAlcance` — siguen sin engancharse a nada. Son la
 *             comparación que imprime `scripts/prueba-alcance-por-nivel.js`,
 *             para poder decidir el alcance por rango con la tabla enfrente en
 *             vez de cambiarle la vista a 186 personas de un golpe.
 *
 * ─── LO QUE SIGUE SIENDO CIERTO, Y ES EL PORQUÉ DE TODO ESTO ──────────────
 * El alcance sale de banderas: `rol`, `alcance`, `sucursales[]` y 19 `puedeXxx`.
 * Funciona y no dice nada de la estructura: un Gerente de Zona ve su zona
 * porque alguien le puso las sucursales a mano, no porque su puesto esté
 * arriba de ellas. El rango YA EXISTE en el catálogo —`nivel`, en los 89
 * puestos— y es de ahí de donde tiene que salir.
 */

import { NivelPuesto, puestoPorId, tieneSubordinados } from './organigrama.catalogo';
import { resolverPuesto } from './puesto.util';
import { esAdmin, esAdminGlobal, esSupervisor, sucursalesPermitidas, esDueno } from './permisos.util';

/**
 * Qué tanto ve alguien. Es una escala ordenada a propósito: comparar dos
 * alcances es comparar dos números, y eso hace trivial detectar una escalada
 * -alguien que pasa a ver MÁS- que es el único cambio verdaderamente peligroso.
 */
export type Amplitud =
  | 'empresa'    // todas las unidades
  | 'unidad'     // su bloque del organigrama (CEDIS, Administración…)
  | 'zona'       // su gerencia de zona y las sucursales que cuelgan
  | 'sucursal'   // su tienda
  | 'propio'     // solo lo suyo
  | 'ninguno';   // sin puesto: no se le adivina alcance

/** Orden de amplitud, de más a menos. Sirve para detectar escaladas. */
export const ORDEN_AMPLITUD: Amplitud[] = [
  'empresa', 'unidad', 'zona', 'sucursal', 'propio', 'ninguno',
];

export function indiceAmplitud(a: Amplitud): number {
  const i = ORDEN_AMPLITUD.indexOf(a);
  return i === -1 ? ORDEN_AMPLITUD.length : i;
}

/** ¿`a` ve MÁS que `b`? Es la pregunta que importa en una revisión. */
export function veMasQue(a: Amplitud, b: Amplitud): boolean {
  return indiceAmplitud(a) < indiceAmplitud(b);
}

/**
 * El rango de una persona, leído de su puesto en el organigrama.
 *
 * Devuelve null cuando el puesto no se puede resolver. NO se le asigna un nivel
 * por parecido de cargo: un rango inventado le da a alguien visibilidad que no
 * le toca, y eso es peor que no darle ninguna (§8.5). Quien caiga en null se
 * queda con el alcance de sus banderas, que es el de hoy.
 */
export function nivelDePersona(usuario: any): NivelPuesto | null {
  const r = resolverPuesto(usuario);
  if (!r.puestoId) return null;
  const p = puestoPorId(r.puestoId);
  return p ? p.nivel : null;
}

/**
 * El alcance que le tocaría por rango.
 *
 * ─── POR QUÉ ESTE MAPEO Y NO OTRO ─────────────────────────────────────────
 * · direccion  → la empresa. Es el único nivel que necesita el agregado de las
 *                diez unidades.
 * · gerencia   → su zona. Un Gerente de Zona responde por las sucursales que
 *                cuelgan de él, no por CEDIS ni por Sistemas.
 * · jefatura   → su unidad. Un Jefe de CEDIS responde por CEDIS completo, y no
 *                por las tiendas.
 * · coordinacion → su sucursal. Encargado(a) de Sucursal es `coordinacion`, y
 *                es quien verifica la muestra de su tienda.
 * · supervision → su zona ACOTADA a su función. Un Supervisor de Ventas Ruta
 *                Directa cubre varias tiendas pero solo su ruta; el modelo lo
 *                resolverá con el ámbito. Hoy se le da 'zona' y se marca como
 *                el caso que más hay que revisar contigo.
 * · operativo / practicante → lo suyo.
 *
 * `nivel === null` devuelve 'ninguno': sin puesto no se deriva alcance. Esa
 * persona conserva lo que le dan sus banderas hoy.
 */
export function alcanceDeNivel(nivel: NivelPuesto | null): Amplitud {
  switch (nivel) {
    case 'direccion':    return 'empresa';
    case 'gerencia':     return 'zona';
    case 'jefatura':     return 'unidad';
    case 'coordinacion': return 'sucursal';
    case 'supervision':  return 'zona';
    case 'operativo':    return 'propio';
    case 'practicante':  return 'propio';
    default:             return 'ninguno';
  }
}

/** El alcance propuesto para una persona, derivado de su rango. */
export function alcancePropuesto(usuario: any): Amplitud {
  return alcanceDeNivel(nivelDePersona(usuario));
}

/**
 * El alcance que la persona tiene HOY, traducido a la misma escala, para poder
 * compararlo con el propuesto.
 *
 * No es una reimplementación: llama a `esAdminGlobal` y `sucursalesPermitidas`,
 * que son las funciones que la app usa de verdad. Si se reescribiera la regla
 * aquí, la comparación mediría dos inventos en vez de medir el cambio.
 */
export function alcanceActual(usuario: any): Amplitud {
  if (!usuario) return 'ninguno';
  if (esAdminGlobal(usuario)) return 'empresa';
  const suc = sucursalesPermitidas(usuario);
  if (suc === null) return 'empresa';        // 'General (Acceso Total)'

  // ⚠️ TENER UNA SUCURSAL ASIGNADA NO ES VER LA SUCURSAL, y esta línea faltaba.
  //
  // La primera versión traducía `sucursales: ['8 Esquinas']` como alcance
  // 'sucursal' para cualquiera. Pero la carga de datos hace otra cosa
  // (`home.ts`, la rama `esTrabajadorPuro`): un trabajador SIN banderas de
  // supervisión ve solo lo asignado a su nombre, no lo de su tienda. Su
  // sucursal sirve para saber DÓNDE trabaja, no cuánto ve.
  //
  // Sin esta corrección la tabla comparativa inventaba una diferencia -el
  // Anaquelista "perdiendo" su sucursal- que no existe, porque nunca la tuvo.
  // Es la regla de medir la entrada que de verdad se usa, no un proxy de ella.
  if (!esAdmin(usuario) && !esSupervisor(usuario)) return 'propio';

  if (suc.length === 0) return 'propio';
  if (suc.length === 1) return 'sucursal';
  return 'zona';                              // varias tiendas ≈ alcance de zona
}

/** Qué pasaría con esta persona si el alcance saliera del rango. */
export interface Diferencia {
  actual: Amplitud;
  propuesto: Amplitud;
  /** 'igual' | 'gana' (ve más) | 'pierde' (ve menos) */
  efecto: 'igual' | 'gana' | 'pierde';
  nivel: NivelPuesto | null;
}

export function compararAlcance(usuario: any): Diferencia {
  const actual = alcanceActual(usuario);
  const propuesto = alcancePropuesto(usuario);
  let efecto: Diferencia['efecto'] = 'igual';
  if (veMasQue(propuesto, actual)) efecto = 'gana';
  else if (veMasQue(actual, propuesto)) efecto = 'pierde';
  return { actual, propuesto, efecto, nivel: nivelDePersona(usuario) };
}


/**
 * ¿Es JEFATURA? Manda quien tiene gente debajo **Y** cuyo nivel es de mando.
 *
 * ─── POR QUE NO ES SOLO «TIENE GENTE DEBAJO» (corregido el 19/sep) ────────
 * Aqui decia: «la definicion que no envejece es la operativa: manda quien tiene
 * a alguien reportandole. Sale del mismo `reportaA` del que sale la piramide,
 * asi que el dia que Capital Humano publique un organigrama nuevo, esto se
 * mueve solo». El argumento es bueno y la mitad sigue en pie — pero medido,
 * esa arista sola alcanzaba a tres puestos OPERATIVOS por tener un practicante
 * colgando, y les daba `/pase-lista` y `/plantilla`. El detalle esta en el
 * cuerpo de la funcion, con las cifras.
 *
 * ─── POR QUE NO ES SOLO «SU NIVEL MANDA» ──────────────────────────────────
 * La objecion original a la lista de niveles tambien sigue en pie en parte:
 * tomar el nivel `jefatura` LITERAL dejaria fuera a Direccion y a las
 * Gerencias, que estan arriba. Por eso `NIVELES_DE_MANDO` no es una lista
 * suelta: es el mismo corte que ya hace `alcanceDeNivel()`, y hay una prueba
 * que revienta si el catalogo gana un nivel y nadie la actualiza.
 *
 * Y sola tampoco sirve: ENSANCHA. Medido sobre los 89 puestos, daria mando a
 * dos coordinadores con cero subordinados declarados.
 *
 * Los admins pasan siempre: el rol de sistema no depende del organigrama, y
 * dejar a un admin sin su tablero por una ficha sin puesto seria peor.
 */
/**
 * Los niveles que MANDAN.
 *
 * No es una lista escrita a mano fuera del catálogo: es el mismo corte que ya
 * hace `alcanceDeNivel()` doce líneas más arriba —los que reciben un ámbito
 * (empresa · unidad · zona · sucursal) contra los que reciben 'propio'—. Si
 * algún día el organigrama gana un nivel, los dos sitios se actualizan juntos
 * o la contradicción salta en las pruebas.
 */
export const NIVELES_DE_MANDO: NivelPuesto[] =
  ['direccion', 'gerencia', 'jefatura', 'coordinacion', 'supervision'];

export function esJefatura(usuario: any): boolean {
  if (esAdmin(usuario)) return true;
  const r = resolverPuesto(usuario);

  // ═══════════════════════════════════════════════════════════════════════
  //  TENER UN PRACTICANTE DEBAJO NO ES MANDAR (19/sep/2026)
  // ═══════════════════════════════════════════════════════════════════════
  // Aquí decía solo `if (tieneSubordinados(r.puestoId)) return true;`, y el
  // argumento escrito era bueno: la definición operativa —manda quien tiene a
  // alguien reportándole— no envejece cuando el organigrama cambia, mientras
  // que una lista de niveles hay que acordarse de actualizarla.
  //
  // Medido, esa arista resultó ser la equivocada. Tres puestos de nivel
  // OPERATIVO pasaban por jefatura solo porque el catálogo les cuelga un
  // practicante, y con eso se llevaban `/pase-lista` y `/plantilla`:
  //
  //     caja-general              operativo   1 directo (un practicante)
  //     servicios-al-personal     operativo   1
  //     reclutamiento-onboarding  operativo   1
  //
  // Un Analista de Caja General no decide cuántas plazas autoriza una
  // sucursal. El rango está en `nivel`, que también vive en el catálogo: no se
  // cambia una fuente automática por una lista a mano, se cambia una columna
  // del catálogo por otra del MISMO catálogo.
  //
  // ─── Y SE PIDEN LAS DOS COSAS, NO SOLO EL NIVEL ────────────────────────
  // La regla podría ser «su nivel manda» a secas. Medido, eso ENSANCHA:
  // `coordinador-cajas` y `coordinador-piso-ventas` son `coordinacion` con
  // CERO subordinados declarados, así que ganarían `/plantilla` — y dar la
  // definición de cuántas plazas autoriza una tienda es la dirección
  // peligrosa (11/sep). Exigir las dos deja este cambio en «solo quita»:
  // medido sobre los 89 puestos, **2 pierden y 0 ganan**.
  //
  // Si Dirección decide que esos dos coordinadores sí mandan, la respuesta no
  // es aflojar esto: es declarar sus subordinados en el organigrama, que es
  // donde esa verdad pertenece (§8.5).
  if (tieneSubordinados(r.puestoId)) {
    const p = r.puestoId ? puestoPorId(r.puestoId) : null;
    if (p && NIVELES_DE_MANDO.indexOf(p.nivel) !== -1) return true;
    // Cae a la red de abajo a propósito: si además trae banderas de gestión
    // sigue siendo supervisor, y eso es correcto por otra vía —es el caso de
    // `servicios-al-personal`, que administra fichas de personal de verdad.
  }

  // ── LA RED, y no es un parche: es lo que evita castigar un hueco de datos ──
  //
  // Medido con la prueba de audiencias: una Encargada SIN `puestoId` capturado
  // no resuelve puesto, asi que `tieneSubordinados` da false y perderia el
  // Dashboard. Y en la base hay DECENAS de fichas asi -es el hallazgo 1: la
  // identidad se cruza por texto y muchas nunca se completaron-.
  //
  // Quitarle el tablero a una Encargada real porque a su ficha le falta un
  // campo es castigar a la persona por un problema del sistema. `esSupervisor`
  // es la definicion que la app ya usa para «manda en su sucursal» (banderas
  // de supervision + sucursal asignada), asi que no se inventa un criterio
  // nuevo: se acepta el que ya existia mientras los puestos se completan.
  //
  // Esta red SE RETIRA cuando el marcador de fichas sin puesto llegue a cero.
  return esSupervisor(usuario);
}


/**
 * ¿Hay algo que ver en `/home` para esta persona?
 *
 * ─── POR QUE VIVE AQUI Y NO EN EL GUARD ────────────────────────────────────
 * Lo puse primero en `services/home.guard.ts`, y `nav.config.ts` lo importaba
 * de ahi. Eso le metio al MENU una dependencia de `@angular/router`, y la
 * prueba de audiencias -que compila `nav.config.ts` sola con tsc- dejo de
 * poder cargarlo: MODULE_NOT_FOUND. La prueba cazo una dependencia mala antes
 * de que se desplegara.
 *
 * Ademas de romper la prueba, la direccion estaba mal: el menu es DATO y no
 * debe depender de un guard del router. Aqui el archivo es puro, y tanto el
 * guard como el menu lo importan.
 *
 * Es deliberadamente el MISMO predicado que decide pintar el tablero
 * (`esAdminGlobal`). Si el guard, el menu y la pantalla usaran criterios
 * distintos, volveriamos a tener a alguien parado frente a una pagina en
 * blanco — que es el bug que esto vino a cerrar: `/home` solo conserva el
 * encabezado sin gate, las pestañas de supervisor y el tablero de alcance
 * global, asi que para una colaboradora era el titulo y NADA MAS.
 *
 * El dia que exista el tablero por nivel («Mi zona», «Mi sucursal» del
 * documento 4, Fase 6), este predicado se amplia UNA vez y los tres siguen de
 * acuerdo por construccion.
 */
export function hayTableroPara(usuario: any): boolean {
  // JEFATURA, no solo alcance global. Al principio puse `esAdminGlobal` y la
  // prueba de audiencias mostro la consecuencia: de 15 perfiles solo UNO
  // conservaba el Dashboard. Gerencias y Encargadas perdian su tablero, y eso
  // es quitar funcion, no ordenarla.
  //
  // Lo que NO puede ver una jefatura de sucursal es la ESTRUCTURA de la
  // empresa -las diez unidades, el silencio, el reparto de causas-. Eso se
  // gatea aparte con `verNivelEmpresa`. Sus CIFRAS si son suyas: el agregado
  // ya viene filtrado por sucursal desde la carga de datos.
  return esJefatura(usuario);
}

/**
 * ¿Puede ver el nivel EMPRESA del tablero?
 *
 * Las diez unidades de control, el 62 % del silencio, el reparto de causas y la
 * tabla de procedencia son cifras de compañia. Una Encargada tiene que ver SUS
 * numeros, no el agregado de la empresa — un dato agregado no deja de ser
 * informacion de la empresa porque no traiga nombres.
 */
export function verNivelEmpresa(usuario: any): boolean {
  return esAdminGlobal(usuario);
}

/** El puesto del organigrama que manda en la empresa. */
export const PUESTO_DIRECCION = 'direccion-general';

/**
 * ¿Puede entrar a la sección de Usuarios?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ESTO SE ESTRECHÓ EL 13/sep/2026, POR INSTRUCCIÓN DE DAVID
 * ═══════════════════════════════════════════════════════════════════════════
 * «Quienes solo pueden ver los usuarios es mi perfil y los de Dirección
 * General; los demás no tendrán acceso a esa sección.»
 *
 * Antes bastaba con ser admin **de cualquier alcance** o traer la bandera
 * `puedeAdministrarPersonal`. Esa pantalla da de alta gente, cambia puestos y
 * reparte permisos: es la llave de todo lo demás, y el 31/ago ya se vio a dónde
 * lleva tenerla repartida — una Encargada podía asignarle trabajo a fichas de
 * otra plaza, incluidas cuentas de prueba.
 *
 * Ahora son dos, y ninguna es una bandera editable desde esa misma pantalla:
 *   · el DUEÑO, reconocido por su correo, y
 *   · quien tenga el puesto `direccion-general` en el organigrama.
 *
 * ─── EL DETALLE QUE LA HACE SEGURA ────────────────────────────────────────
 * `puedeAdministrarPersonal` se otorga DESDE la pantalla de Usuarios. O sea que
 * quien entrara podía dar acceso a esa misma pantalla, y eso se propaga solo.
 * El puesto del organigrama no: sale del catálogo, que es código.
 */
export function veUsuarios(usuario: any): boolean {
  if (esDueno(usuario)) return true;
  return resolverPuesto(usuario).puestoId === PUESTO_DIRECCION;
}
