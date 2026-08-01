// ============================================================================
//  AVISOS DE TAREAS POR WHATSAPP (checklists).
//
//  Tres momentos, todos hacia el COLABORADOR:
//    1) AL ASIGNAR      -> avisarAsignacion(checklist). Lo llama crear_checklist
//                          (bot) y el POST de /api/checklists (app web).
//    2) EN LA MAÑANA    -> resumen de lo que le toca hoy (una sola vez al día).
//    3) ANTES DE LA HORA LÍMITE -> recordatorio si sigue sin entregar.
//  Y uno de vuelta hacia el JEFE:
//    4) AL ENTREGAR     -> avisarEntrega(checklist, ctx) avisa a quien lo asignó.
//
//  Los puntos 2 y 3 corren en un POLL cada minuto en el backend (server.js), con
//  bitácora en `mdtask_wa_avisos` (SQL 025) para no repetir avisos si el proceso
//  se reinicia. Mismo patrón que api/flotilla-notificar.js.
//
//  PLANTILLAS: fuera de la ventana de 24 h, WhatsApp solo deja iniciar
//  conversación con una plantilla APROBADA en Meta. Si la plantilla no existe o
//  falla, se manda texto normal (que sí llega si la persona escribió al bot en
//  las últimas 24 h). Así el módulo funciona hoy y mejora al aprobarse.
//
//  Variables de entorno (servicio MDTask):
//    WA_TEMPLATE_NUEVA_TAREA    default 'nueva_tarea'        (5 vars)
//    WA_TEMPLATE_RESUMEN        default 'resumen_tareas'     (3 vars)
//    WA_TEMPLATE_RECORDATORIO   default 'recordatorio_tarea' (4 vars)
//    WA_TEMPLATE_LANG           default 'es_MX'
//    TAREAS_RESUMEN_HORA        default '08:00'  (hora de México)
//    TAREAS_RECORDATORIO_MIN    default 30       (minutos antes del límite)
//    TAREAS_AVISOS              'off' apaga TODOS los avisos automáticos
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { enviarPlantilla, enviarMensaje, ultimos10 } = require('./whatsapp');
const {
  pgChecklistsPendientesDeFecha, itemHecho, mismoNombreEmpleado, epochDeMx, ahoraMexico,
} = require('./asistente-chat');

// --- Configuración -----------------------------------------------------------
const T_NUEVA = process.env.WA_TEMPLATE_NUEVA_TAREA || 'nueva_tarea';
const T_RESUMEN = process.env.WA_TEMPLATE_RESUMEN || 'resumen_tareas';
const T_RECORDATORIO = process.env.WA_TEMPLATE_RECORDATORIO || 'recordatorio_tarea';
const LANG = process.env.WA_TEMPLATE_LANG || 'es_MX';
const RESUMEN_HORA = String(process.env.TAREAS_RESUMEN_HORA || '08:00');
const RECORDATORIO_MIN = Number(process.env.TAREAS_RECORDATORIO_MIN || 30);
const APAGADO = String(process.env.TAREAS_AVISOS || '').toLowerCase() === 'off';

// Número listo para la Cloud API: MX de 10 dígitos -> 52 + 10.
function paraEnviar(num) {
  const n = String(num || '').replace(/\D/g, '');
  return n.length === 10 ? '52' + n : n;
}
function aMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : NaN;
}

// --- Bitácora de avisos (idempotencia) ---------------------------------------
// Reclama la clave de forma ATÓMICA: si devuelve true, este proceso es el que
// manda el aviso; si otro tick ya lo reclamó, devuelve false y no se repite.
async function reclamarAviso(clave) {
  try {
    const r = await query(
      `insert into mdtask_wa_avisos (clave, enviado_en) values ($1,$2)
       on conflict (clave) do nothing returning clave`,
      [String(clave), Date.now()]
    );
    return r.rowCount > 0;
  } catch (e) {
    console.error('[tareas-notificar] no se pudo registrar el aviso:', e && e.message);
    return false; // ante la duda NO mandamos (mejor callar que spamear)
  }
}
async function soltarAviso(clave) {
  try { await query('delete from mdtask_wa_avisos where clave = $1', [String(clave)]); }
  catch (e) { /* no es crítico */ }
}

// --- Estado REAL de los envíos (acuses de Meta) -------------------------------
// La Cloud API acepta el envío con HTTP 200 y dice si falló DESPUÉS, por el
// webhook de `statuses`. Sin escuchar eso, el bot presume entregas que nunca
// ocurrieron (fue justo lo que pasó: "ya le avisé" con el mensaje rebotado por
// un pendiente de pago de la cuenta). Aquí se guarda el último veredicto real.
//
// Códigos de CUENTA (afectan a todos, no a un número): 131042 problema de pago,
// 131031 cuenta bloqueada. Ver https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const CODIGOS_CUENTA = new Set([131042, 131031]);
const CLAVE_ESTADO = 'wa_estado_envios';

async function guardarEstado(parcial) {
  await query(
    `insert into mdtask_config (id, datos) values ($1, $2::jsonb)
     on conflict (id) do update set datos = coalesce(mdtask_config.datos,'{}'::jsonb) || excluded.datos`,
    [CLAVE_ESTADO, JSON.stringify(parcial)]
  );
}

/** Procesa un `statuses` del webhook de WhatsApp. No lanza nunca. */
async function registrarAcuse(estatus) {
  try {
    if (!dbConfigurada() || !estatus || !estatus.status) return;
    const st = String(estatus.status);
    const tel = String(estatus.recipient_id || '');
    if (st === 'failed') {
      const err = (Array.isArray(estatus.errors) ? estatus.errors : [])[0] || {};
      const code = Number(err.code || 0);
      const deCuenta = CODIGOS_CUENTA.has(code);
      console.error(`[whatsapp] NO SE ENTREGO a ${tel}: ${err.title || 'error'} (code ${code})${deCuenta ? ' — es un problema de la CUENTA, afecta a todos los avisos' : ''}`);
      await guardarEstado({ ultimoFallo: { code, titulo: err.title || '', detalle: (err.error_data && err.error_data.details) || '', tel, en: Date.now(), deCuenta } });
    } else if (st === 'delivered') {
      await guardarEstado({ ultimaEntrega: { tel, en: Date.now() } });
    }
  } catch (e) { console.error('[tareas-notificar] registrarAcuse:', e && e.message); }
}

/**
 * ¿Los avisos del negocio están rebotando por un problema de CUENTA?
 * Devuelve null si todo bien, o { code, titulo, detalle } para poder decirlo.
 * Se considera resuelto en cuanto hay una entrega exitosa posterior al fallo.
 */
async function avisosRebotando() {
  try {
    if (!dbConfigurada()) return null;
    const r = await query('select datos from mdtask_config where id = $1', [CLAVE_ESTADO]);
    const d = (r.rows[0] && r.rows[0].datos) || {};
    const f = d.ultimoFallo, e = d.ultimaEntrega;
    if (!f || !f.deCuenta) return null;
    if (e && Number(e.en || 0) > Number(f.en || 0)) return null;   // ya se resolvio
    return { code: f.code, titulo: f.titulo, detalle: f.detalle };
  } catch (e) { return null; }
}

// --- ¿Está abierta la ventana de 24 h? ---------------------------------------
// Un mensaje de TEXTO libre solo llega si la persona nos escribió en las últimas
// 24 h. Fuera de esa ventana, Meta acepta la petición con HTTP 200 y DESPUÉS la
// rechaza de forma asíncrona (error 131047 "Re-engagement message"), así que el
// 200 NO es prueba de que llegó. Por eso preguntamos antes, con la última
// actividad del hilo (mdtask_wa_conversaciones.actualizado, que se toca cuando
// esa persona nos escribe). En frío, la ÚNICA vía es una plantilla aprobada.
const VENTANA_MS = 24 * 3600 * 1000 - 10 * 60 * 1000; // 10 min de margen
async function ventanaAbierta(telefono) {
  try {
    const r = await query('select actualizado from mdtask_wa_conversaciones where id = $1', [ultimos10(telefono)]);
    const t = r.rows[0] ? Number(r.rows[0].actualizado || 0) : 0;
    return t > 0 && (Date.now() - t) < VENTANA_MS;
  } catch (e) { return false; }
}

// --- Envío con plantilla y respaldo en texto ---------------------------------
// Devuelve { ok, motivo }. `motivo`: 'plantilla' | 'texto' | 'sin_telefono' |
// 'sin_plantilla_ni_ventana' | 'cuenta_bloqueada' | 'fallo_envio'. Nunca miente: si
// que el mensaje llegue, devuelve ok:false en vez de dar un falso positivo.
async function mandar(telefono, plantilla, variables, textoRespaldo) {
  const tel = paraEnviar(telefono);
  if (!tel) return { ok: false, motivo: 'sin_telefono' };

  const bloqueo = await avisosRebotando();
  const ventana = await ventanaAbierta(tel);

  // 1) PLANTILLA: la única vía para escribir en frío. Se salta si la cuenta las
  //    viene rebotando (ej. sin método de pago): el envío se aceptaría con 200 y
  //    Meta lo tiraría después, y encima nos quedaríamos sin intentar el texto,
  //    que a quien tiene la ventana abierta SÍ le llega.
  if (!bloqueo && await enviarPlantilla(tel, plantilla, LANG, variables)) {
    return { ok: true, motivo: 'plantilla' };
  }

  // 2) TEXTO libre: solo dentro de la ventana de 24 h, pero ahí es gratis y seguro.
  if (ventana) {
    if (bloqueo) console.warn(`[tareas-notificar] la cuenta viene rebotando plantillas; mando texto a ${tel} (su ventana esta abierta).`);
    else console.warn(`[tareas-notificar] plantilla "${plantilla}" no disponible; mando texto normal (ventana de 24h abierta).`);
    const t = await enviarMensaje(tel, textoRespaldo);
    return { ok: !!t, motivo: t ? (bloqueo ? 'texto_por_bloqueo' : 'texto') : 'fallo_envio' };
  }

  // 3) Ni plantilla ni ventana: no hay forma de llegarle. Se dice, no se finge.
  if (bloqueo) {
    console.warn(`[tareas-notificar] NO se pudo avisar a ${tel}: la cuenta de WhatsApp esta rebotando (${bloqueo.titulo}) y esa persona no le ha escrito al bot en 24h.`);
    return { ok: false, motivo: 'cuenta_bloqueada' };
  }
  console.warn(`[tareas-notificar] NO se pudo avisar a ${tel}: la plantilla "${plantilla}" no esta aprobada en Meta y esa persona no le ha escrito al bot en 24h.`);
  return { ok: false, motivo: 'sin_plantilla_ni_ventana' };
}

// Motivos que NO cambian en lo que queda del día: no vale la pena que el poll
// (cada minuto) reintente y falle 60 veces por hora.
const MOTIVOS_SIN_REINTENTO = new Set(['sin_plantilla_ni_ventana', 'cuenta_bloqueada']);

// --- Personal (teléfono por uid o por nombre) --------------------------------
async function cargarPersonal() {
  const r = await query('select id, nombre, correo, telefono from mdtask_usuarios');
  return r.rows.map(u => ({
    id: u.id, nombre: u.nombre || u.correo || '', telefono: u.telefono || '',
  }));
}
// Encuentra a la persona de un checklist (assignedUid primero, luego el nombre).
function personaDeChecklist(personal, ck) {
  const uid = ck.assignedUid || ck.assigned_uid;
  if (uid) {
    const porUid = personal.find(p => p.id === uid);
    if (porUid) return porUid;
  }
  return personal.find(p => mismoNombreEmpleado(p.nombre, ck.assigned)) || null;
}

// Hora límite EFECTIVA de un checklist: la más próxima de sus items sin hacer
// (o la general del checklist). Devuelve 'HH:mm' o null.
function limitePendiente(ck) {
  const items = Array.isArray(ck.items) ? ck.items : [];
  const sinHacer = items.filter(i => !itemHecho(i));
  if (!sinHacer.length) return null;
  const horas = sinHacer
    .map(i => String(i.horaLimite || i.time || ck.time || '23:59'))
    .map(h => ({ h, m: aMin(h) }))
    .filter(x => !isNaN(x.m))
    .sort((a, b) => a.m - b.m);
  return horas.length ? horas[0].h : (ck.time || null);
}
function listaItems(ck, max = 5) {
  const items = Array.isArray(ck.items) ? ck.items : [];
  const txt = items.slice(0, max).map(i => '• ' + String(i.text || '')).join('\n');
  return items.length > max ? `${txt}\n• ...y ${items.length - max} más` : txt;
}

// ============================================================================
//  1) AVISO AL ASIGNAR
// ============================================================================
/**
 * Avisa por WhatsApp a la persona asignada. Idempotente por checklist.
 * Devuelve { ok, motivo }. Nunca lanza: un aviso fallido NO debe tumbar la
 * creación del checklist.
 */
async function avisarAsignacion(ck) {
  try {
    if (APAGADO || !dbConfigurada() || !ck || !ck.id) return { ok: false, motivo: 'apagado' };
    const clave = 'asig:' + ck.id;
    if (!await reclamarAviso(clave)) return { ok: false, motivo: 'ya_avisado' };

    const personal = await cargarPersonal();
    const persona = personaDeChecklist(personal, ck);
    if (!persona || !persona.telefono) {
      await soltarAviso(clave); // sin teléfono: que se pueda reintentar si lo registran
      return { ok: false, motivo: 'sin_telefono' };
    }

    const nombre = (persona.nombre || '').split(' ')[0] || 'Hola';
    const items = Array.isArray(ck.items) ? ck.items.length : 0;
    const vars = [nombre, ck.name || 'una tarea', ck.store || 'tu sucursal', ck.date || 'hoy', ck.time || '23:59'];
    const respaldo =
      `Hola ${nombre} 👋\nTe asignaron *${ck.name || 'una tarea'}* en ${ck.store || 'tu sucursal'}` +
      `\n📅 ${ck.date || 'hoy'} · ⏰ antes de las ${ck.time || '23:59'}` +
      (items ? `\n\n${listaItems(ck)}` : '') +
      `\n\nCuando la termines contéstame por aquí (ej. *"ya hice la 1"*) y la vamos cerrando 👍`;

    const res = await mandar(persona.telefono, T_NUEVA, vars, respaldo);
    // Si no salió, se libera la clave: nadie reintenta las asignaciones en bucle,
    // así que dejarla marcada solo taparía el aviso si el checklist se re-guarda.
    if (!res.ok) await soltarAviso(clave);
    else console.log(`[tareas-notificar] aviso de asignacion checklist=${ck.id} -> ${persona.nombre} (via ${res.motivo})`);
    return { ...res, persona: persona.nombre };
  } catch (e) {
    console.error('[tareas-notificar] avisarAsignacion:', e && e.message);
    return { ok: false, motivo: 'error' };
  }
}

// ============================================================================
//  2) RESUMEN DE LA MAÑANA
// ============================================================================
async function resumenMatutino() {
  const { fechaISO, minutos } = ahoraMexico();
  const inicio = aMin(RESUMEN_HORA);
  if (isNaN(inicio)) return;
  // Ventana de una hora: si el server se reinició justo a esa hora, el siguiente
  // tick todavía alcanza a mandarlo (la clave del día evita duplicados).
  if (minutos < inicio || minutos > inicio + 59) return;

  const pendientes = await pgChecklistsPendientesDeFecha(fechaISO);
  if (!pendientes.length) return;
  const personal = await cargarPersonal();

  // Agrupar por persona.
  const porPersona = new Map();
  for (const ck of pendientes) {
    const p = personaDeChecklist(personal, ck);
    if (!p || !p.telefono) continue;
    if (!porPersona.has(p.id)) porPersona.set(p.id, { persona: p, cks: [] });
    porPersona.get(p.id).cks.push(ck);
  }

  for (const { persona, cks } of porPersona.values()) {
    const clave = `resumen:${persona.id}:${fechaISO}`;
    if (!await reclamarAviso(clave)) continue;
    const nombre = (persona.nombre || '').split(' ')[0] || 'Hola';
    // Se cuentan TAREAS, no checklists: las rutinas llegan como muchos checklists
    // de una sola tarea, y "hoy tienes 17 checklists" no significa nada para ella.
    const tareas = cks.flatMap(c => (Array.isArray(c.items) ? c.items : [])
      .filter(i => !itemHecho(i))
      .map(i => ({ texto: String(i.text || c.name || 'tarea'), hora: i.horaLimite || i.time || c.time || '23:59' })));
    const total = tareas.length || cks.length;
    const muestra = tareas.slice(0, 4).map(t => `${t.texto} (${t.hora})`);
    // Los parámetros de plantilla no aceptan saltos de línea: se separa con " | ".
    const lista = muestra.join(' | ') + (tareas.length > 4 ? ` | y ${tareas.length - 4} más` : '');
    const vars = [nombre, String(total), lista || 'tus pendientes del día'];
    const respaldo = `¡Buen día, ${nombre}! ☀️\nHoy tienes *${total}* ${total === 1 ? 'tarea' : 'tareas'}:\n`
      + muestra.map(t => '• ' + t).join('\n')
      + (tareas.length > 4 ? `\n• ...y ${tareas.length - 4} más` : '')
      + `\n\nEscríbeme *"qué tengo hoy"* para verlas numeradas y las vamos cerrando 👍`;
    const res = await mandar(persona.telefono, T_RESUMEN, vars, respaldo);
    // Solo se libera la clave ante un fallo pasajero. Si es que no hay plantilla
    // ni ventana, se deja marcada: el poll corre cada minuto y reintentarlo seria
    // fallar igual 60 veces por hora.
    if (!res.ok && !MOTIVOS_SIN_REINTENTO.has(res.motivo)) await soltarAviso(clave);
    else if (res.ok) console.log(`[tareas-notificar] resumen ${fechaISO} -> ${persona.nombre} (${cks.length})`);
  }
}

// ============================================================================
//  3) RECORDATORIO ANTES DE LA HORA LÍMITE
// ============================================================================
// Se agrupa por PERSONA y hora límite: quien trabaja por rutinas arrastra
// decenas de checklists de una sola tarea, todos con el mismo límite. Uno por
// checklist serían 17 mensajes seguidos; así recibe UNO con el total.
async function recordatoriosLimite() {
  const { fechaISO } = ahoraMexico();
  const pendientes = await pgChecklistsPendientesDeFecha(fechaISO);
  if (!pendientes.length) return;
  const personal = await cargarPersonal();
  const ahora = Date.now();

  const grupos = new Map();  // persona + hora límite -> lo que le falta
  for (const ck of pendientes) {
    const hora = limitePendiente(ck);
    if (!hora) continue;                       // ya no le falta nada por hacer
    const limite = epochDeMx(ck.date || fechaISO, hora);
    if (limite == null) continue;
    const faltanMin = Math.round((limite - ahora) / 60000);
    if (faltanMin <= 0 || faltanMin > RECORDATORIO_MIN) continue;   // aún no toca, o ya venció

    const persona = personaDeChecklist(personal, ck);
    if (!persona || !persona.telefono) continue;

    const clave = `${persona.id}|${hora}`;
    if (!grupos.has(clave)) grupos.set(clave, { persona, hora, faltanMin, cks: [], tareas: 0 });
    const g = grupos.get(clave);
    g.cks.push(ck);
    g.tareas += (Array.isArray(ck.items) ? ck.items : []).filter(i => !itemHecho(i)).length;
    g.faltanMin = Math.min(g.faltanMin, faltanMin);
  }

  for (const g of grupos.values()) {
    // La clave incluye la hora: si tiene tareas para las 14:00 y otras para las
    // 20:00, recibe un recordatorio por cada bloque, no uno por tarea.
    const clave = `limite:${g.persona.id}:${fechaISO}:${g.hora}`;
    if (!await reclamarAviso(clave)) continue;

    const nombre = (g.persona.nombre || '').split(' ')[0] || 'Hola';
    const unaSola = g.tareas === 1;
    const primera = (g.cks[0].items || []).find(i => !itemHecho(i));
    const que = unaSola
      ? ((primera && primera.text) || g.cks[0].name || 'tu tarea')
      : `${g.tareas} tareas de tu rutina`;
    const vars = [nombre, que, String(g.faltanMin), String(g.tareas)];
    const respaldo = `⏰ ${nombre}, ${g.faltanMin === 1 ? 'te queda 1 minuto' : 'te quedan ' + g.faltanMin + ' minutos'} (hasta las ${g.hora}) y `
      + (unaSola ? `te falta *${que}*.` : `te faltan *${g.tareas} tareas*.`)
      + `\nSi ya las hiciste, dime *"ya terminé"* y las entregamos 🙌`;
    const res = await mandar(g.persona.telefono, T_RECORDATORIO, vars, respaldo);
    if (!res.ok && !MOTIVOS_SIN_REINTENTO.has(res.motivo)) await soltarAviso(clave);
    else if (res.ok) console.log(`[tareas-notificar] recordatorio ${g.hora} -> ${g.persona.nombre} (${g.tareas} tareas en ${g.cks.length} checklist)`);
  }
}

// ============================================================================
//  4) AVISO DE VUELTA: le entregaron al jefe
// ============================================================================
/**
 * Le avisa por WhatsApp a quien asignó el checklist que ya se lo entregaron.
 * Mejor esfuerzo: va como texto normal (el admin suele estar en la ventana de
 * 24 h porque él mismo usa el bot). Nunca lanza.
 */
async function avisarEntrega(ck, ctx) {
  try {
    if (APAGADO || !dbConfigurada() || !ck) return false;
    const creador = ck.createdByUid || null;
    const nombreCreador = ck.createdBy || '';
    if (!creador && !nombreCreador) return false;

    const personal = await cargarPersonal();
    const jefe = (creador && personal.find(p => p.id === creador))
      || personal.find(p => mismoNombreEmpleado(p.nombre, nombreCreador));
    if (!jefe || !jefe.telefono) return false;
    // Va como texto libre (no hay plantilla para esto): solo sirve si el jefe
    // escribió al bot en las últimas 24 h. Normalmente sí: él mismo lo usa.
    if (!(await ventanaAbierta(jefe.telefono))) {
      console.warn(`[tareas-notificar] no aviso la entrega a ${jefe.nombre}: su ventana de 24h esta cerrada.`);
      return false;
    }
    // No avisarse a sí mismo (un admin que entrega su propio checklist).
    if (ctx && (jefe.id === ctx.uid || ultimos10(jefe.telefono) === ultimos10(ctx.telefono || ''))) return false;

    const items = Array.isArray(ck.items) ? ck.items : [];
    const hechas = items.filter(itemHecho).length;
    const quien = (ctx && ctx.nombre) || ck.assigned || 'alguien';
    const texto = `✅ *${quien}* entregó "${ck.name || 'un checklist'}" (${ck.store || 's/sucursal'})`
      + `\n${hechas} de ${items.length} tareas${ck.entregaConRetraso ? ' · ⚠️ con retraso' : ''}`
      + (ck.entregaConRetraso && ck.motivoRetraso ? `\nMotivo: ${ck.motivoRetraso.categoria} — ${ck.motivoRetraso.comentario}` : '')
      + (ck.notaEmpleado ? `\nNota: ${ck.notaEmpleado}` : '');
    const r = await enviarMensaje(paraEnviar(jefe.telefono), texto);
    return !!r;
  } catch (e) {
    console.error('[tareas-notificar] avisarEntrega:', e && e.message);
    return false;
  }
}

// --- Poll --------------------------------------------------------------------
async function tick() {
  if (APAGADO || !dbConfigurada()) return;
  try { await resumenMatutino(); } catch (e) { console.error('[tareas-notificar] resumen:', e && e.message); }
  try { await recordatoriosLimite(); } catch (e) { console.error('[tareas-notificar] recordatorios:', e && e.message); }
}

let pollIniciado = false;
function iniciarPoll() {
  if (pollIniciado) return;
  if (APAGADO) { console.log('[tareas-notificar] avisos APAGADOS (TAREAS_AVISOS=off).'); return; }
  pollIniciado = true;
  setInterval(() => { tick().catch(e => console.error('[tareas-notificar] poll:', e && e.message)); }, 60 * 1000);
  console.log(`[tareas-notificar] poll iniciado (cada 60s) — resumen ${RESUMEN_HORA}, recordatorio ${RECORDATORIO_MIN} min antes`);
}

// ¿Los avisos estan apagados por configuracion? (para no confundir "apagado"
// con "fallo el envio" en los mensajes del bot).
function avisosApagados() { return APAGADO; }

module.exports = {
  avisarAsignacion, avisarEntrega, resumenMatutino, recordatoriosLimite,
  tick, iniciarPoll, avisosApagados,
  // Acuses de Meta (los alimenta el webhook) para no presumir entregas falsas.
  registrarAcuse, avisosRebotando,
};
