// ============================================================================
//  FLOTILLA — Escalamiento de solicitudes por WhatsApp.
//
//  Cuando se crea una reserva 'pendiente':
//    1) Se manda un WhatsApp (PLANTILLA aprobada) al PRIMER aprobador.
//    2) A los N minutos sin respuesta, al SEGUNDO aprobador.
//    3) Luego se recuerda a AMBOS cada N minutos, hasta que alguien responda
//       o hasta un tope de M minutos (para no spamear si nadie contesta).
//
//  El aprobador responde por WhatsApp: "aprobar <CODIGO>" o "rechazar <CODIGO>".
//  Eso cambia el estatus (validando anti-choque) y avisa al solicitante por push.
//
//  El temporizador vive en el BACKEND (poll cada 30s en server.js) y guarda su
//  estado en la propia reserva (datos.flotillaEscala), asi que sobrevive a
//  reinicios y no depende del navegador de nadie.
//
//  Config por variables de entorno (con valores por defecto):
//    FLOTILLA_APROBADORES   lista de numeros separados por coma (orden = prioridad)
//    WA_TEMPLATE_SOLICITUD  nombre de la plantilla aprobada en Meta
//    WA_TEMPLATE_LANG       idioma de la plantilla (ej. es_MX)
//    FLOTILLA_INTERVALO_MIN minutos entre avisos (default 2)
//    FLOTILLA_TOPE_MIN      minutos maximos de recordatorios (default 30)
// ============================================================================
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('./db');
const { enviarPlantilla, ultimos10 } = require('./whatsapp');

// --- Configuracion -----------------------------------------------------------
const APROBADORES = String(process.env.FLOTILLA_APROBADORES || '3481054800,3521674905')
  .split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);
const TEMPLATE = process.env.WA_TEMPLATE_SOLICITUD || 'solicitud_vehiculo';
const LANG = process.env.WA_TEMPLATE_LANG || 'es_MX';
const INTERVALO_MS = Number(process.env.FLOTILLA_INTERVALO_MIN || 2) * 60 * 1000;
const TOPE_MS = Number(process.env.FLOTILLA_TOPE_MIN || 30) * 60 * 1000;

// Codigo corto sin caracteres ambiguos (nada de O/0/I/1).
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generarCodigo() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return s;
}

// Numero listo para la Cloud API: MX de 10 digitos -> 52 + 10.
function paraEnviar(num) {
  const n = String(num || '').replace(/\D/g, '');
  return n.length === 10 ? '52' + n : n;
}

// Rango de fecha/hora legible en zona de Mexico.
function fmtHorario(desde, hasta) {
  if (desde == null || hasta == null) return 'sin horario';
  const completo = (e) => new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(Number(e)));
  const soloHora = (e) => new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit',
  }).format(new Date(Number(e)));
  return `${completo(desde)} a ${soloHora(hasta)}`;
}

async function nombreVehiculo(id) {
  try {
    const r = await query('select nombre from vehiculos where id = $1', [String(id)]);
    return (r.rows[0] && r.rows[0].nombre) || 'Vehiculo';
  } catch { return 'Vehiculo'; }
}

// Merge parcial del jsonb `datos` (sin pisar el resto).
async function mergeDatos(id, obj) {
  await query(
    `update reservas_vehiculos set datos = coalesce(datos,'{}'::jsonb) || $2::jsonb where id = $1`,
    [String(id), JSON.stringify(obj)]
  );
}
async function setEstatus(id, estatus, datosMerge) {
  await query(
    `update reservas_vehiculos set estatus = $2, datos = coalesce(datos,'{}'::jsonb) || $3::jsonb where id = $1`,
    [String(id), String(estatus), JSON.stringify(datosMerge || {})]
  );
}

// Primer choque con una reserva APROBADA del mismo vehiculo (mismo criterio que
// api/reservas-vehiculos.js). Devuelve { desde, hasta } o null.
async function buscarChoque(vehiculoId, desde, hasta, exceptId) {
  if (vehiculoId == null || desde == null || hasta == null) return null;
  const r = await query(
    `select desde, hasta from reservas_vehiculos
      where vehiculo_id = $1 and estatus = 'aprobada' and desde < $3 and hasta > $2 and id <> $4
      order by desde asc limit 1`,
    [String(vehiculoId), Number(desde), Number(hasta), String(exceptId || '')]
  );
  return r.rows[0] ? { desde: Number(r.rows[0].desde), hasta: Number(r.rows[0].hasta) } : null;
}

// --- Push interno al solicitante (sin pasar por el endpoint con token) --------
let adminListo = false;
function initAdmin() {
  if (adminListo) return true;
  try {
    if (!admin.apps.length) {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!raw) return false;
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    }
    adminListo = true;
    return true;
  } catch (e) { console.error('[flotilla] initAdmin:', e && e.message); return false; }
}
async function enviarPushInterno(uids, titulo, cuerpo, url) {
  try {
    if (!initAdmin()) return;
    const set = new Set((uids || []).filter(Boolean).map(String));
    if (!set.size) return;
    const tk = await query('select id, uid, token from mdtask_usuarios_tokens');
    const tokens = [];
    tk.rows.forEach(r => {
      const t = r.token;
      if (typeof t !== 'string' || t.length <= 20) return;
      const uid = r.uid ? String(r.uid) : '';
      if ((uid && set.has(uid)) || set.has(String(r.id))) tokens.push(t);
    });
    if (!tokens.length) return;
    for (let i = 0; i < tokens.length; i += 500) {
      await admin.messaging().sendEachForMulticast({
        tokens: tokens.slice(i, i + 500),
        data: { tipo: 'aviso', title: titulo, body: cuerpo, url: url || '/flotilla', timestamp: String(Date.now()) },
      });
    }
  } catch (e) { console.error('[flotilla] push interno fallo:', e && e.message); }
}

// --- Inicio del escalamiento (al crear la reserva pendiente) ------------------
async function iniciarEscalacion(reserva) {
  try {
    if (!APROBADORES.length) { console.warn('[flotilla] sin aprobadores configurados; no se escala.'); return; }
    const codigo = generarCodigo();
    const veh = await nombreVehiculo(reserva.vehiculoId);
    const horario = fmtHorario(reserva.desde, reserva.hasta);
    const now = Date.now();
    const escala = { codigo, inicioEn: now, ticks: 1, proximoEn: now + INTERVALO_MS, terminado: false };
    await mergeDatos(reserva.id, { codigo, flotillaEscala: escala });
    const vars = [reserva.solicitante || 'Alguien', veh, horario, reserva.destino || '(sin destino)', codigo];
    await enviarPlantilla(paraEnviar(APROBADORES[0]), TEMPLATE, LANG, vars);
    console.log(`[flotilla] escalacion iniciada reserva=${reserva.id} codigo=${codigo} -> ${APROBADORES[0]}`);
  } catch (e) { console.error('[flotilla] iniciarEscalacion:', e && e.message); }
}

// --- Tick del poll: manda el siguiente aviso a quien toque -------------------
async function procesarEscalaciones() {
  if (!dbConfigurada() || !APROBADORES.length) return;
  let rows;
  try {
    const r = await query(
      `select id, vehiculo_id, usuario_uid, desde, hasta, datos
         from reservas_vehiculos
        where estatus = 'pendiente' and (datos->'flotillaEscala') is not null`
    );
    rows = r.rows;
  } catch (e) { console.error('[flotilla] poll query:', e && e.message); return; }

  const now = Date.now();
  for (const row of rows) {
    const datos = row.datos || {};
    const esc = datos.flotillaEscala;
    if (!esc || esc.terminado) continue;
    if (now < Number(esc.proximoEn || 0)) continue;

    // Tope: dejar de recordar (queda pendiente en la app).
    if (now - Number(esc.inicioEn || now) >= TOPE_MS) {
      await mergeDatos(row.id, { flotillaEscala: { ...esc, terminado: true } }).catch(() => {});
      console.log(`[flotilla] escalacion detenida por tope reserva=${row.id}`);
      continue;
    }

    const ticks = Number(esc.ticks || 1);
    // tick 1 -> segundo aprobador; de ahi en adelante -> todos.
    const destinatarios = ticks === 1 ? (APROBADORES[1] ? [APROBADORES[1]] : APROBADORES) : APROBADORES;
    const veh = await nombreVehiculo(row.vehiculo_id);
    const horario = fmtHorario(row.desde, row.hasta);
    const vars = [datos.solicitante || 'Alguien', veh, horario, datos.destino || '(sin destino)', esc.codigo];
    for (const tel of destinatarios) await enviarPlantilla(paraEnviar(tel), TEMPLATE, LANG, vars);

    await mergeDatos(row.id, { flotillaEscala: { ...esc, ticks: ticks + 1, proximoEn: now + INTERVALO_MS } }).catch(() => {});
    console.log(`[flotilla] recordatorio reserva=${row.id} ticks=${ticks} -> ${destinatarios.join(',')}`);
  }
}

let pollIniciado = false;
function iniciarPoll() {
  if (pollIniciado) return;
  pollIniciado = true;
  const tick = () => procesarEscalaciones().catch(e => console.error('[flotilla] poll:', e && e.message));
  setInterval(tick, 30 * 1000);
  console.log('[flotilla] poll de escalaciones iniciado (cada 30s)');
}

// --- Respuesta del aprobador por WhatsApp ("aprobar/rechazar <CODIGO>") -------
// Devuelve el texto a responder, o null si el mensaje NO es un comando de flotilla
// (para que el webhook siga con el asistente normal).
const RE_CMD = /^\s*(aprobar|aprobado|rechazar|rechazado)\s+([a-z0-9]{3,8})\b\s*(.*)$/is;
async function resolverPorWhatsapp(from, texto) {
  const m = RE_CMD.exec(String(texto || ''));
  if (!m) return null;
  const accion = /^aprob/i.test(m[1]) ? 'aprobada' : 'rechazada';
  const codigo = m[2].toUpperCase();
  const motivo = (m[3] || '').trim();

  let row;
  try {
    const r = await query(
      `select * from reservas_vehiculos where estatus = 'pendiente' and upper(datos->>'codigo') = $1 limit 1`,
      [codigo]
    );
    row = r.rows[0];
  } catch (e) {
    console.error('[flotilla] buscar codigo:', e && e.message);
    return 'Tuve un problema buscando la solicitud. Intenta de nuevo en un momento.';
  }
  if (!row) return `No encontre una solicitud *pendiente* con el codigo *${codigo}*. Puede que ya la hayan atendido.`;

  // Autorizacion por telefono: numero en la cadena de aprobadores, o admin.
  const objetivo = ultimos10(from);
  const autorizados = new Set(APROBADORES.map(ultimos10));
  let autorizado = autorizados.has(objetivo);
  let nombreAprobador = null;
  try {
    const u = await query(
      `select nombre, rol from mdtask_usuarios
        where right(regexp_replace(coalesce(telefono,''), '[^0-9]', '', 'g'), 10) = $1 limit 1`,
      [objetivo]
    );
    if (u.rows[0]) { nombreAprobador = u.rows[0].nombre || null; if (u.rows[0].rol === 'admin') autorizado = true; }
  } catch { /* si falla, queda la autorizacion por numero */ }
  if (!autorizado) return 'Este numero no esta autorizado para aprobar o rechazar solicitudes de vehiculos.';

  const datos = row.datos || {};
  const veh = await nombreVehiculo(row.vehiculo_id);
  const horario = fmtHorario(row.desde, row.hasta);
  const quien = nombreAprobador || ('WhatsApp ' + objetivo);

  if (accion === 'aprobada') {
    const ch = await buscarChoque(row.vehiculo_id, row.desde, row.hasta, row.id);
    if (ch) return `No se puede aprobar *${codigo}*: ${veh} ya esta apartado en ese horario (${fmtHorario(ch.desde, ch.hasta)}).`;
    await setEstatus(row.id, 'aprobada', {
      aprobadoPor: quien, aprobadaEn: Date.now(),
      flotillaEscala: { ...(datos.flotillaEscala || {}), terminado: true },
    });
    await enviarPushInterno([row.usuario_uid], 'Vehiculo aprobado', `Tu solicitud de ${veh} (${horario}) fue APROBADA.`, '/flotilla');
    return `Listo, aprobaste la solicitud *${codigo}* (${veh}, ${horario}). Le avisamos al solicitante.`;
  } else {
    await setEstatus(row.id, 'rechazada', {
      rechazadoPor: quien, rechazadaEn: Date.now(), motivoRechazo: motivo || null,
      flotillaEscala: { ...(datos.flotillaEscala || {}), terminado: true },
    });
    await enviarPushInterno([row.usuario_uid], 'Vehiculo rechazado', `Tu solicitud de ${veh} fue rechazada.${motivo ? ' Motivo: ' + motivo : ''}`, '/flotilla');
    return `Ok, rechazaste la solicitud *${codigo}* (${veh}).${motivo ? ' Motivo: ' + motivo : ''} Le avisamos al solicitante.`;
  }
}

module.exports = { iniciarEscalacion, procesarEscalaciones, iniciarPoll, resolverPorWhatsapp };
