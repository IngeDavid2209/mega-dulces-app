// ============================================================================
//  TICKETS — avisos por WhatsApp.
//
//  Dos momentos, los dos del ciclo del vale:
//    1) AL ASIGNAR   -> se le dice al responsable que le toca un servicio, con el
//                       folio, qué es y un enlace que le abre el vale.
//    2) AL CERRAR    -> se le dice al solicitante que su servicio ya se atendió.
//
//  Usa el MISMO bot de MD Task y el mismo helper de envio que tareas y pagos
//  (api/tareas-notificar.js -> `mandar`), que ya sabe cuándo se puede mandar
//  texto libre y cuándo hace falta plantilla. Ojo con la realidad de hoy: la
//  cuenta de Meta no puede iniciar conversaciones (falta metodo de pago), asi que
//  estos avisos solo llegan a quien le haya escrito al bot en las ultimas 24 h.
//  Cuando no se puede entregar, se anota y NO se finge que llego.
//
//  Es best-effort a proposito: si el aviso falla, el ticket se guarda igual. Un
//  problema de WhatsApp no debe impedir que se registre un servicio.
//
//  Variables de entorno:
//    WA_TEMPLATE_TICKET   plantilla aprobada en Meta (default 'nuevo_ticket')
//    TICKETS_URL          base de los enlaces (default la URL de produccion)
//    AVISOS_APAGADOS=1 / TICKETS_AVISOS=off  apagan estos avisos
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { mandar } = require('./tareas-notificar');

const T_TICKET = process.env.WA_TEMPLATE_TICKET || 'nuevo_ticket';
const BASE_URL = process.env.TICKETS_URL || 'https://mdtask-production-ed88.up.railway.app';
const APAGADO = String(process.env.TICKETS_AVISOS || '').toLowerCase() === 'off'
  || process.env.AVISOS_APAGADOS === '1';

/** Numero listo para la Cloud API: MX de 10 digitos -> 52 + 10. */
function paraEnviar(num) {
  const n = String(num || '').replace(/\D/g, '');
  return n.length === 10 ? '52' + n : n;
}

function folioTexto(folio) {
  const n = Number(folio);
  return Number.isFinite(n) ? String(n).padStart(6, '0') : '—';
}

/** El teléfono de un usuario de MD Task (10 digitos) o null. */
async function telefonoDe(uid) {
  if (!uid) return null;
  try {
    const r = await query(
      `select right(regexp_replace(coalesce(telefono,''), '[^0-9]', '', 'g'), 10) as tel
         from mdtask_usuarios where id = $1`, [String(uid)]);
    const t = r.rows[0] && r.rows[0].tel;
    return t && String(t).length === 10 ? String(t) : null;
  } catch (e) {
    console.error('[tickets-notificar] no se pudo leer el telefono:', e && e.message);
    return null;
  }
}

/** Enlace que abre ese vale directo en la app. */
function enlaceDe(ticket) {
  return `${BASE_URL}/tickets?id=${encodeURIComponent(ticket.id)}`;
}

/**
 * AL ASIGNAR: avisa al responsable que le toca atender un servicio.
 * Devuelve { ok, motivo } y nunca lanza: el ticket ya se guardó.
 */
async function avisarAsignacion(ticket) {
  if (!dbConfigurada() || APAGADO) return { ok: false, motivo: 'apagado' };
  const tel = await telefonoDe(ticket.responsableUid);
  if (!tel) return { ok: false, motivo: 'sin_telefono' };

  const quien = String(ticket.responsable || '').split(' ')[0];
  const texto = `${quien ? 'Hola ' + quien : 'Hola'} 👋\n\n`
    + `Te asignaron un *servicio* (vale No. ${folioTexto(ticket.folio)}):\n`
    + `*${ticket.actividad}*\n`
    + `Área: ${ticket.area || '—'}`
    + (ticket.lugar ? `\nLugar: ${ticket.lugar}` : '')
    + (ticket.solicitante ? `\nLo pidió: ${ticket.solicitante}` : '')
    + `\n\nAbre el vale para llenarlo y firmarlo:\n${enlaceDe(ticket)}`;

  const vars = [
    ticket.responsable || 'Hola',
    folioTexto(ticket.folio),
    ticket.actividad || '',
    ticket.area || '',
  ];
  try {
    const res = await mandar(paraEnviar(tel), T_TICKET, vars, texto);
    console.log(`[tickets] aviso de asignacion ${folioTexto(ticket.folio)} -> ${tel}: ${res.ok ? res.motivo : 'NO SALIO (' + res.motivo + ')'}`);
    return res;
  } catch (e) {
    console.error('[tickets-notificar] asignacion:', e && e.message);
    return { ok: false, motivo: 'error' };
  }
}

/**
 * AL CERRAR: avisa al solicitante que su servicio ya quedó atendido.
 * No se le manda al responsable: él es quien acaba de cerrarlo.
 */
async function avisarCierre(ticket) {
  if (!dbConfigurada() || APAGADO) return { ok: false, motivo: 'apagado' };
  const tel = await telefonoDe(ticket.solicitanteUid);
  if (!tel) return { ok: false, motivo: 'sin_telefono' };

  const quien = String(ticket.solicitante || '').split(' ')[0];
  const texto = `${quien ? 'Hola ' + quien : 'Hola'} 👋\n\n`
    + `Ya se atendió tu solicitud (vale No. ${folioTexto(ticket.folio)}):\n`
    + `*${ticket.actividad}*\n`
    + (ticket.responsable ? `Lo hizo: ${ticket.responsable}\n` : '')
    + (ticket.resultado ? `Resultado: ${ticket.resultado}\n` : '')
    + `\nPuedes ver el vale aquí:\n${enlaceDe(ticket)}`;

  const vars = [
    ticket.solicitante || 'Hola',
    folioTexto(ticket.folio),
    ticket.actividad || '',
    ticket.responsable || '',
  ];
  try {
    const res = await mandar(paraEnviar(tel), T_TICKET, vars, texto);
    console.log(`[tickets] aviso de cierre ${folioTexto(ticket.folio)} -> ${tel}: ${res.ok ? res.motivo : 'NO SALIO (' + res.motivo + ')'}`);
    return res;
  } catch (e) {
    console.error('[tickets-notificar] cierre:', e && e.message);
    return { ok: false, motivo: 'error' };
  }
}

module.exports = { avisarAsignacion, avisarCierre, enlaceDe, folioTexto };
