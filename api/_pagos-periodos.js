// ============================================================================
//  Calculo de PERIODOS y FECHAS LIMITE de los servicios recurrentes.
//
//  Modulo puro (no toca la base ni la red) para que la regla de "que periodo le
//  toca a este servicio" viva en UN solo lugar: la usan el generador de pagos,
//  el tablero y los recordatorios. Si esta cuenta se hiciera en tres lados,
//  tarde o temprano dirian cosas distintas.
//
//  Todo se calcula en hora de MEXICO. Usar `new Date()` a secas en Railway daria
//  UTC, y a las 6 de la tarde de Mexico ya seria el dia siguiente alla: los
//  avisos saldrian un dia antes de tiempo y los pagos se marcarian vencidos
//  cuando todavia estan a tiempo.
// ============================================================================

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** Fecha de hoy en Mexico como 'YYYY-MM-DD' (mismo formato que los checklists). */
function hoyMexico() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Cuantos dias tiene un mes (mes en base 1). */
function diasDelMes(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** 'YYYY-MM' -> { anio, mes } (mes en base 1). */
function partirPeriodo(periodo) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodo || ''));
  if (!m) return null;
  return { anio: Number(m[1]), mes: Number(m[2]) };
}

/** { anio, mes } -> 'YYYY-MM'. Normaliza meses fuera de rango (mes 13 -> enero del siguiente). */
function armarPeriodo(anio, mes) {
  const a = anio + Math.floor((mes - 1) / 12);
  const m = ((mes - 1) % 12 + 12) % 12 + 1;
  return `${a}-${String(m).padStart(2, '0')}`;
}

/** Suma (o resta) meses a un 'YYYY-MM'. */
function sumarMeses(periodo, n) {
  const p = partirPeriodo(periodo);
  if (!p) return periodo;
  return armarPeriodo(p.anio, p.mes + Number(n || 0));
}

/** Diferencia en meses entre dos 'YYYY-MM' (b - a). */
function mesesEntre(a, b) {
  const pa = partirPeriodo(a), pb = partirPeriodo(b);
  if (!pa || !pb) return 0;
  return (pb.anio - pa.anio) * 12 + (pb.mes - pa.mes);
}

/** El periodo 'YYYY-MM' al que pertenece una fecha 'YYYY-MM-DD'. */
function periodoDeFecha(fecha) {
  return String(fecha || hoyMexico()).slice(0, 7);
}

/**
 * Fecha limite real de un periodo.
 * Si el servicio vence el dia 31 y el mes tiene 30, se cobra el ultimo dia del
 * mes: no existe el 31 de abril y guardar '2026-04-31' romperia toda comparacion
 * de fechas mas adelante.
 */
function fechaLimiteDe(periodo, diaLimite) {
  const p = partirPeriodo(periodo);
  if (!p) return null;
  const tope = diasDelMes(p.anio, p.mes);
  const dia = Math.min(Math.max(Number(diaLimite) || 1, 1), tope);
  return `${periodo}-${String(dia).padStart(2, '0')}`;
}

/** Texto legible del periodo: "Julio 2026", o "Jul-Ago 2026" si es bimestral. */
function textoPeriodo(periodo, periodicidad) {
  const p = partirPeriodo(periodo);
  if (!p) return String(periodo || '');
  if (String(periodicidad) !== 'bimestral') return `${MESES[p.mes - 1]} ${p.anio}`;
  // El recibo bimestral ampara el mes anterior y el del vencimiento.
  const previo = sumarMeses(periodo, -1);
  const pp = partirPeriodo(previo);
  const mismoAnio = pp.anio === p.anio;
  return mismoAnio
    ? `${MESES_CORTO[pp.mes - 1]}-${MESES_CORTO[p.mes - 1]} ${p.anio}`
    : `${MESES_CORTO[pp.mes - 1]} ${pp.anio}-${MESES_CORTO[p.mes - 1]} ${p.anio}`;
}

/**
 * ¿A este servicio le toca pagar en ese periodo?
 * Mensual: siempre. Bimestral: solo los meses que caen de dos en dos a partir
 * del ancla (si no hay ancla, se toma el periodo mismo para no dejar de avisar).
 */
function leTocaPeriodo(servicio, periodo) {
  if (String(servicio.periodicidad) !== 'bimestral') return true;
  const ancla = servicio.mesAncla || servicio.mes_ancla;
  if (!partirPeriodo(ancla)) return true;
  return Math.abs(mesesEntre(ancla, periodo)) % 2 === 0;
}

/**
 * Los periodos que un servicio deberia tener generados a dia de hoy.
 *
 * Devuelve desde `mesesAtras` meses atras hasta `mesesAdelante` adelante, para
 * que el tablero pueda mostrar el historial reciente y para que el proximo
 * recibo aparezca ANTES de vencerse (si solo generaramos el mes en curso, un
 * servicio que vence el dia 2 no daria tiempo de avisar).
 */
function periodosAGenerar(servicio, fechaRef, { mesesAtras = 1, mesesAdelante = 1 } = {}) {
  const base = periodoDeFecha(fechaRef || hoyMexico());
  const salida = [];
  for (let i = -Math.abs(mesesAtras); i <= Math.abs(mesesAdelante); i++) {
    const periodo = sumarMeses(base, i);
    if (!leTocaPeriodo(servicio, periodo)) continue;
    salida.push({
      periodo,
      periodoTexto: textoPeriodo(periodo, servicio.periodicidad),
      fechaLimite: fechaLimiteDe(periodo, servicio.diaLimite || servicio.dia_limite),
    });
  }
  return salida;
}

/** Un epoch en milisegundos -> 'YYYY-MM-DD' en hora de Mexico. */
function fechaDeEpoch(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(n));
}

/** Dias que faltan (negativo = ya vencio) entre hoy y una fecha 'YYYY-MM-DD'. */
function diasFaltantes(fechaLimite, hoy) {
  const a = String(hoy || hoyMexico());
  const b = String(fechaLimite || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  // Mediodia UTC en ambos: evita que el horario de verano mueva la cuenta un dia.
  const ms = Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z');
  return Math.round(ms / 86400000);
}

/**
 * Estado que se MUESTRA de un pago. El 'vencido' se deduce aqui y no se guarda:
 * asi no puede existir una fila diciendo "al corriente" solo porque un proceso
 * no corrio.
 *   'pagado' | 'vencido' | 'por_vencer' (dentro de los dias de aviso) | 'pendiente'
 */
function estadoVisible(pago, servicio, hoy) {
  if (pago.estado === 'pagado') return 'pagado';
  if (pago.estado === 'cancelado') return 'cancelado';
  const dias = diasFaltantes(pago.fechaLimite || pago.fecha_limite, hoy);
  if (dias == null) return 'pendiente';
  if (dias < 0) return 'vencido';
  // OJO con el cero: `diasAviso: 0` significa «avisar SOLO el dia del
  // vencimiento», y es un valor que el formulario acepta a proposito. Con la
  // cadena de `||` que habia aqui, ese 0 es falsy y se convertia en 3, asi que
  // el tablero pintaba «Por vencer» tres dias antes mientras el recordatorio
  // —que si respeta el 0 (`pagoConServicio` usa `== null ? 3 :`)— se callaba.
  // La misma regla leida de dos maneras segun quien pregunte.
  const crudo = servicio == null ? null
    : (servicio.diasAviso != null ? servicio.diasAviso : servicio.dias_aviso);
  const aviso = crudo == null || crudo === '' ? 3 : Number(crudo);
  return dias <= (Number.isFinite(aviso) ? aviso : 3) ? 'por_vencer' : 'pendiente';
}

/** Fecha 'YYYY-MM-DD' -> "15 de julio de 2026" (para los mensajes del bot). */
function fechaLegible(fecha) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha || ''));
  if (!m) return String(fecha || '');
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1].toLowerCase()}`;
}

module.exports = {
  MESES, MESES_CORTO,
  hoyMexico, diasDelMes, partirPeriodo, armarPeriodo, sumarMeses, mesesEntre,
  periodoDeFecha, fechaLimiteDe, textoPeriodo, leTocaPeriodo, periodosAGenerar,
  diasFaltantes, estadoVisible, fechaLegible, fechaDeEpoch,
};
