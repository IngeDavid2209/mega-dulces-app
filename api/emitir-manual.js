// ============================================================================
//  EMISOR DE TAREAS DEL MANUAL — el reloj sale del navegador
//
//  ─── QUÉ RESUELVE ─────────────────────────────────────────────────────────
//  Hasta hoy, las tareas del día de 186 personas las creaba UN NAVEGADOR: el
//  robot vive en el componente de Checklist (`checklist.ts`, dispararRobotManual)
//  y se repite cada 5 min *mientras esa pestaña siga abierta*. Si nadie con la
//  plantilla cargada abría /tareas, nadie recibía nada — y el tablero leía ese
//  silencio como incumplimiento, que es exactamente el hueco que el modelo de
//  §5.2 prohíbe: la ausencia de datos no puede significar dos cosas distintas.
//
//  Este módulo hace lo mismo desde el servidor, cada pocos minutos, sin que
//  nadie tenga que abrir nada.
//
//  ─── LO QUE NO CAMBIA, Y ES LA MITAD DEL DISEÑO ───────────────────────────
//  La REGLA es la misma función, no una copia: `planDeEntregas` de
//  `src/app/shared/emision-manual.util.ts`, compilada al build por
//  `scripts/compilar-manual.js`. Si el servidor decidiera con su propia copia,
//  las dos divergirían en silencio y la misma persona tendría dos
//  denominadores según quién emitiera (§8.11 d).
//
//  Y la LLAVE es `idemKey`, la misma que usan el robot del navegador y la
//  asignación a mano. Por eso los tres pueden convivir sin duplicar: quien
//  llegue primero crea el documento y los otros dos lo encuentran tomado.
//
//  ─── POR QUÉ `on conflict do nothing` Y NO `do update` ────────────────────
//  El POST de /api/checklists hace `do update` porque es el guardado normal de
//  la app (equivale a un setDoc). Un EMISOR no puede hacer eso: corre solo,
//  cada pocos minutos, y un `do update` sobreescribiría con items en blanco un
//  checklist que alguien ya llenó. `insertarSiNoExiste` es la diferencia entre
//  «emitir» y «borrar el trabajo de la mañana».
//
//  ─── LA FECHA SE CALCULA EN HORA DE MÉXICO, A PROPÓSITO ───────────────────
//  El contenedor de Railway corre en UTC. Con `new Date()` a secas, a partir de
//  las 18:00 de México el servidor ya estaría en el día siguiente y emitiría
//  las tareas de mañana esta tarde —y las de hoy nunca—. El navegador nunca
//  tuvo este problema porque siempre estuvo en México; el servidor sí, y no se
//  ve hasta que pasa. Ver `ahoraEnZona`.
//
//  ─── SE APAGA SIN DESPLEGAR ───────────────────────────────────────────────
//  `EMISOR_MANUAL=off` en Railway y este módulo no emite nada. Es la reversa:
//  el robot del navegador sigue vivo, así que apagar esto devuelve la situación
//  exacta de antes.
// ============================================================================
const path = require('path');
const { query, dbConfigurada } = require('./db');
const { leerHorarios } = require('./horarios-sucursal');
const { insertarSiNoExiste } = require('./checklists');

const ZONA = process.env.ZONA_HORARIA || 'America/Mexico_City';
const APAGADO = String(process.env.EMISOR_MANUAL || '').toLowerCase() === 'off';
const INTERVALO_MS = Number(process.env.EMISOR_MANUAL_MIN || 10) * 60 * 1000;
// Colchón tras la medianoche. No es superstición: `setTimeout` puede despertar
// unos milisegundos ANTES de la hora pedida, y entonces `ahoraEnZona` devolvería
// todavía la fecha de AYER — la vuelta emitiría el día que acaba de terminar y
// el nuevo se quedaría sin nada hasta la vuelta de respaldo. Cinco segundos lo
// hacen imposible y nadie los nota.
const COLCHON_SEG = Number(process.env.EMISOR_MANUAL_COLCHON_SEG || 5);

// La regla compilada. Vive en `dist/` porque es lo único que la imagen final se
// lleva de la etapa de build (el Dockerfile no copia `src/` ni instala tsc).
const RUTA_REGLA = path.join(__dirname, '..', 'dist', 'manual', 'emision-manual.util.js');
const RUTA_DESCANSOS = path.join(__dirname, '..', 'dist', 'manual', 'descansos.util.js');

/**
 * «Ahora» con los campos locales puestos en la hora de México.
 *
 * Devuelve un Date cuyo getFullYear/getMonth/getDate/getDay/getHours son los de
 * México, sea cual sea la zona del contenedor. Eso importa porque la regla usa
 * `getDay()` para el día de la semana y `toYmd()` para la columna `fecha`: con
 * la fecha en UTC, un martes a las 19:00 de México el servidor creería que es
 * miércoles y las semanales caerían el día equivocado.
 */
function ahoraEnZona(zona) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const parte of f.formatToParts(new Date())) p[parte.type] = parte.value;
  // `hour` puede venir '24' a medianoche en algunos ICU; el módulo lo normaliza.
  return new Date(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second)
  );
}

/** La ficha, con la MISMA forma que /api/usuarios entrega al navegador, para
 *  que `resolverPuesto` y `sucursalesDe` decidan igual en los dos lados. */
function fichaComoLaVeLaApp(r) {
  const datos = r.datos || {};
  return {
    uid: r.id, id: r.id,
    usuario: r.usuario || '', correo: r.correo || '', nombre: r.nombre || '',
    rol: r.rol || '', telefono: r.telefono || '', alcance: r.alcance || '',
    cargo: r.cargo || '', activo: r.activo !== false,
    ...datos,
  };
}

let regla = null;
let descansosUtil = null;
let avisoDeCarga = false;

function cargarRegla() {
  if (regla) return regla;
  try {
    regla = require(RUTA_REGLA);
    descansosUtil = require(RUTA_DESCANSOS);
    return regla;
  } catch (e) {
    if (!avisoDeCarga) {
      avisoDeCarga = true;
      console.error('[emisor-manual] NO SE PUDO CARGAR LA REGLA COMPILADA (%s): %s',
        RUTA_REGLA, (e && e.message) || e);
      console.error('[emisor-manual] Sin ella NO se emite nada. La genera ' +
        '`scripts/compilar-manual.js` al final de `npm run build`; si el build ' +
        'no la dejó en dist/manual, hay que revisar esa etapa.');
    }
    return null;
  }
}

/**
 * Una vuelta: mira qué falta para hoy y lo crea.
 *
 * Devuelve el resumen para que la prueba pueda afirmarlo sin leer el log.
 */
async function emitirDeHoy() {
  const r = cargarRegla();
  if (!r) return { estado: 'sin-regla' };
  if (!dbConfigurada()) return { estado: 'sin-base' };

  const fecha = ahoraEnZona(ZONA);
  const fechaYmd = r.toYmd(fecha);

  // ── Las fichas ────────────────────────────────────────────────────────────
  const filas = (await query(
    `select id, usuario, correo, nombre, rol, telefono, alcance, cargo, activo, datos
       from mdtask_usuarios
      where coalesce(activo, true) = true
      order by id`          // orden estable: una corrida tiene que ser repetible
  )).rows;

  // GUARDIA (§8.11 a). Cero fichas con la app en producción NO es «no hay
  // gente»: es «no leí». Y la diferencia importa porque las dos producen el
  // mismo resultado visible —cero tareas creadas— y el log diría «0 creadas»
  // como si todo estuviera bien. La 050 contó 150 activas.
  if (filas.length === 0) {
    console.error('[emisor-manual] ABORTA la vuelta: 0 fichas activas leídas. ' +
      'La migración 050 contó 150, así que esto es un fallo de lectura, no una ' +
      'empresa vacía. No se emite nada.');
    return { estado: 'sin-fichas' };
  }

  const usuarios = filas.map(fichaComoLaVeLaApp);

  // ── Lo que ya existe hoy ──────────────────────────────────────────────────
  // Incluye enviados, archivados Y ELIMINADOS. Un id tomado es un id tomado:
  // recrear encima de un eliminado resucitaría algo que alguien quitó a
  // propósito, y recrear encima de uno lleno borraría el trabajo.
  const idsExistentes = new Set(
    (await query('select id from mdtask_checklists where fecha = $1', [fechaYmd]))
      .rows.map(x => String(x.id))
  );

  // ── El contexto que la regla necesita ─────────────────────────────────────
  let configTurnos = null;
  try {
    const c = await query('select datos from mdtask_config where id = $1', ['turnos']);
    if (c.rows[0]) configTurnos = { ...(c.rows[0].datos || {}), id: 'turnos' };
  } catch { /* sin config => sin restricción por turno, como en el navegador */ }

  let descansosSemana = [];
  try {
    const semana = descansosUtil.obtenerSemanaISO(fecha);
    const d = await query(
      'select id, user_id, user_nombre, semana_iso, datos from mdtask_descansos_semanales where semana_iso = $1',
      [semana]
    );
    descansosSemana = d.rows.map(x => ({
      ...(x.datos || {}), id: x.id,
      userId: x.user_id, userNombre: x.user_nombre, semanaISO: x.semana_iso,
    }));
  } catch (e) {
    // Sin descansos no se omite a nadie: el error es hacia el lado de entregar
    // de más, que se corrige, en vez de dejar a alguien sin tareas.
    console.error('[emisor-manual] descansos:', (e && e.message) || e);
  }

  const horarios = await leerHorarios();

  // ── La decisión: la MISMA función que corre en el navegador ───────────────
  //
  // `esDiaCerrado` y `esSucursalAdministrativa` no se pasan a propósito: esos
  // dos ganchos viven en el componente de Checklist y dependen de datos que el
  // servidor no tiene. Omitirlos entrega de MÁS, no de menos — y ese es el lado
  // correcto del error: una tarea que sobra se ve y se cancela; una que falta
  // se lee como que la persona no trabajó. Queda anotado como pendiente.
  const plan = r.planDeEntregas({
    usuarios, fecha, horarios, configTurnos, descansosSemana, idsExistentes,
  });

  // ── La escritura ──────────────────────────────────────────────────────────
  let creadas = 0, yaEstaban = 0, fallidas = 0;
  for (const e of plan.entregas) {
    try {
      const nacio = await insertarSiNoExiste(e.payload);
      if (nacio) creadas++; else yaEstaban++;
    } catch (err) {
      fallidas++;
      console.error('[emisor-manual] no se pudo crear %s: %s', e.checklistId, (err && err.message) || err);
    }
  }

  const resumen = {
    estado: 'ok', fecha: fechaYmd, fichas: usuarios.length,
    planeadas: plan.entregas.length, creadas, yaEstaban, fallidas,
    omitidos: plan.omitidos,
  };

  // Solo se habla cuando hay algo que decir. Un log por vuelta cada 10 min
  // durante meses entierra lo que sí importa.
  if (creadas || fallidas) {
    console.log('[emisor-manual] %s: %d creada(s), %d ya estaban, %d fallida(s), de %d fichas',
      fechaYmd, creadas, yaEstaban, fallidas, usuarios.length);
    console.log('[emisor-manual] sin tareas hoy: %d persona(s) — %s',
      plan.omitidos.length, resumenDeMotivos(plan.omitidos));
  }
  return resumen;
}

/** Los motivos agrupados, para que el log diga QUIÉNES faltan y por qué, no
 *  solo cuántos. Un hueco sin motivo no lo arregla nadie. */
function resumenDeMotivos(omitidos) {
  const cuenta = new Map();
  for (const o of omitidos) cuenta.set(o.motivo, (cuenta.get(o.motivo) || 0) + 1);
  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([motivo, n]) => `${n}: ${motivo}`)
    .join(' | ') || '(ninguno)';
}

// ============================================================================
//  EL RELOJ: UN SOLO TEMPORIZADOR PARA EL CAMBIO DE DÍA
// ============================================================================
//
//  David pidió que las tareas estén activas «a las 12 a.m. en punto», no cuando
//  alguien entra. La primera mitad ya estaba (el servidor emite solo); esto es
//  la precisión.
//
//  POR QUÉ NO BASTABA CON BAJAR EL INTERVALO. El `setInterval` se ancla al
//  ARRANQUE DEL CONTENEDOR, así que con un despliegue a las 23:16 las vueltas
//  caen en :16, :26, :36… y el día nuevo aparece a las 00:06. Bajar el intervalo
//  estrecha la ventana pero NO la ancla: sigue siendo deriva del despliegue, y
//  la hora a la que la gente ve sus tareas dependería de a qué hora se desplegó
//  por última vez. Eso no se puede explicar a nadie.
//
//  POR QUÉ UN SOLO RELOJ PARA DOS TRABAJOS. El cierre del día (23:59) y la
//  emisión del nuevo (00:00) son la MISMA frontera con un minuto de diferencia.
//  Con dos temporizadores independientes, un contenedor que reinicie entre los
//  dos deja el día **cerrado y sin emitir** o **emitido y sin cerrar**, y desde
//  fuera las dos se ven igual. Aquí van en orden, en la misma vuelta: primero
//  se cierra el día que termina, después nace el nuevo. Es lo que David pidió
//  —«el día nuevo entra limpio sin arrastre»— y de paso hace que un reinicio a
//  cualquier hora recupere las dos mitades, porque las dos son idempotentes.

/** Milisegundos hasta la próxima medianoche de ZONA, más un colchón. */
function msHastaMedianoche(colchonSeg = 5) {
  const a = ahoraEnZona(ZONA);
  const transcurridoMs = ((a.getHours() * 60 + a.getMinutes()) * 60 + a.getSeconds()) * 1000;
  return (86400000 - transcurridoMs) + colchonSeg * 1000;
}

/** El día anterior a un 'YYYY-MM-DD', en el calendario y no en la aritmética de
 *  cadenas: restar 1 al día daría '2026-09-00' el primero de mes. */
function ayerDe(fechaYmd) {
  const [y, m, d] = fechaYmd.split('-').map(Number);
  const dia = new Date(y, m - 1, d);
  dia.setDate(dia.getDate() - 1);
  const off = dia.getTimezoneOffset() * 60000;
  return new Date(dia.getTime() - off).toISOString().split('T')[0];
}

/**
 * El cierre del día, que lo escribe otra sesión en su propio módulo.
 *
 * Su AUSENCIA es normal mientras no exista y no se dice nada: el emisor tiene
 * que seguir emitiendo aunque el cierre no esté escrito todavía. Pero un módulo
 * que EXISTE y revienta al cargarse es otra cosa —un error de programación, no
 * una pieza pendiente— y ese sí se grita. Son las dos lecturas de un require
 * fallido, y confundirlas dejaría un cierre roto pasando por «aún no está».
 */
function cargarCierre() {
  try {
    return require('./cerrar-dia');
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND' && /cerrar-dia/.test(String(e.message))) return null;
    console.error('[emisor-manual] el módulo de cierre EXISTE y no se pudo cargar: %s',
      (e && e.message) || e);
    return null;
  }
}

/**
 * La vuelta del cambio de día: cierra el que termina y emite el que empieza.
 *
 * El orden no es negociable. Si se emitiera primero, el cierre de ayer correría
 * con las tareas de hoy ya en la tabla y cualquier error de fecha las alcanzaría
 * — se cerraría como no ejecutado algo que nace en ese instante.
 */
async function cambioDeDia(motivo) {
  const hoy = regla ? regla.toYmd(ahoraEnZona(ZONA)) : null;
  if (!hoy) return;

  const cierre = cargarCierre();
  if (cierre && typeof cierre.cerrarDia === 'function') {
    const ayer = ayerDe(hoy);
    try {
      const r = await cierre.cerrarDia(ayer);
      console.log('[emisor-manual] cierre de %s (%s): %d cerrados, %d ya lo estaban, %d saltados',
        ayer, motivo, r?.cerrados ?? 0, r?.yaCerrados ?? 0, r?.saltados ?? 0);
    } catch (e) {
      // Que el cierre falle NO puede impedir que la gente reciba sus tareas.
      console.error('[emisor-manual] el cierre de %s falló, sigo emitiendo: %s',
        ayer, (e && e.message) || e);
    }
  }

  await emitirDeHoy().catch(e =>
    console.error('[emisor-manual] emisión del cambio de día:', (e && e.stack) || e));
}

/** Programa la vuelta de medianoche y se REPROGRAMA cada noche. Devuelve los ms
 *  que va a esperar, para poder decirlo en el log y para poder probarlo. */
function programarMedianoche() {
  const ms = msHastaMedianoche(COLCHON_SEG);
  const t = setTimeout(() => {
    cambioDeDia('medianoche').finally(() => programarMedianoche());
  }, ms);
  // Que un temporizador de 24 h no sea lo que mantiene vivo al proceso.
  if (typeof t.unref === 'function') t.unref();
  return ms;
}

function iniciarPoll() {
  if (APAGADO) {
    console.log('[emisor-manual] APAGADO por EMISOR_MANUAL=off: las tareas del día ' +
      'solo las va a crear el navegador de quien abra /tareas, como antes.');
    return;
  }
  if (!cargarRegla()) return;   // ya explicó por qué en el log

  const ahora = ahoraEnZona(ZONA);
  // `util.format` NO soporta el padding de printf: un '%02d' se imprime literal.
  // Ya pasó dos veces en este repo (4/sep y 7/sep), así que el cero va a mano.
  const dosDigitos = (n) => String(n).padStart(2, '0');
  console.log('[emisor-manual] arranca. Ahora en %s: %s %s:%s',
    ZONA, regla.toYmd(ahora), dosDigitos(ahora.getHours()), dosDigitos(ahora.getMinutes()));

  // Una al arrancar, que además RECUPERA el cambio de día si el contenedor
  // estuvo caído a medianoche: `cerrarDia` es idempotente, así que cerrar ayer
  // otra vez no escribe nada nuevo.
  cambioDeDia('arranque');

  // La de medianoche, y la red de seguridad detrás.
  const ms = programarMedianoche();
  console.log('[emisor-manual] siguiente cambio de día en %s min (a las 00:00 de %s); ' +
    'respaldo cada %d min por si el contenedor reinicia', Math.round(ms / 60000), ZONA,
    INTERVALO_MS / 60000);

  setInterval(() => emitirDeHoy().catch(e =>
    console.error('[emisor-manual] vuelta de respaldo:', (e && e.stack) || e)), INTERVALO_MS);
}

module.exports = { iniciarPoll, emitirDeHoy, ahoraEnZona, resumenDeMotivos };
