// ============================================================================
//  LA FECHA DE HOY, EN HORA DE MÉXICO — una sola definición
//
//  ─── EL DEFECTO QUE ESTO CIERRA (medido el 19/sep/2026) ───────────────────
//  `api/login-plaza.js` calculaba «hoy» así:
//
//      const d = new Date();
//      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
//      return local.toISOString().split('T')[0];
//
//  y el comentario de al lado decía «hora de México». **No lo es.** El
//  contenedor corre en UTC, así que `getTimezoneOffset()` vale 0 y esa cuenta
//  devuelve la fecha UTC. Medido sobre instantes fijos:
//
//      18:30 MX (00:30 UTC del día siguiente) -> devolvía MAÑANA
//      20:00 MX                               -> devolvía MAÑANA
//      23:59 MX                               -> devolvía MAÑANA
//      09:00 MX                               -> correcto
//
//  O sea **seis horas al día**, de 18:00 a medianoche, el login por plaza
//  buscaba la cobertura de MAÑANA. Como no la encuentra, le pregunta «¿quién
//  eres?» a todo el turno de cierre aunque la Encargada haya pasado lista — y
//  la suplencia que registre queda fechada mañana, así que la Encargada la ve
//  en el día equivocado. Es exactamente el defecto que el emisor del manual ya
//  había cazado el 14/sep («el servidor habría emitido el día equivocado»),
//  vivo en otro archivo.
//
//  ─── POR QUÉ UN ARCHIVO PROPIO ───────────────────────────────────────────
//  Porque desde hoy lo miran DOS sitios: el login por plaza, que escribe la
//  fecha de la suplencia, y `_autorizar.js`, que comprueba que una cuenta de
//  plaza solo pueda registrar la de HOY. Si cada uno calculara la suya y se
//  apartaran un día, la guardia rechazaría escrituras legítimas cada tarde y
//  el error se leería como «el login por plaza no funciona».
//
//  `emitir-manual.js` tiene su propio `ahoraEnZona`, que ya estaba bien y
//  devuelve un Date completo (necesita la hora para el reloj de medianoche).
//  No se toca: funciona, está probado, y unificarlo es un paso aparte.
// ============================================================================

const ZONA = process.env.ZONA_HORARIA || 'America/Mexico_City';

/**
 * Hoy en 'YYYY-MM-DD' según la zona indicada (por omisión, México).
 *
 * `en-CA` da exactamente 'YYYY-MM-DD', que es el formato en que la columna
 * `desde`/`hasta` de `mdtask_coberturas` guarda las fechas. Construirlo a mano
 * con `padStart` funcionaría igual, pero esto no puede equivocarse de orden.
 */
function hoyEnZona(zona) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona || ZONA,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Azúcar: hoy en México. Es lo que quiere el 99 % de las llamadas. */
function hoyEnMexico() {
  return hoyEnZona(ZONA);
}

module.exports = { hoyEnZona, hoyEnMexico, ZONA };
