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

// --- Envío con plantilla y respaldo en texto ---------------------------------
// Devuelve true si WhatsApp aceptó alguno de los dos.
async function mandar(telefono, plantilla, variables, textoRespaldo) {
  const tel = paraEnviar(telefono);
  if (!tel) return false;
  const r = await enviarPlantilla(tel, plantilla, LANG, variables);
  if (r) return true;
  // La plantilla puede no existir/estar sin aprobar todavía: al menos intentamos
  // texto normal (llega si la persona escribió al bot en las últimas 24 h).
  console.warn(`[tareas-notificar] plantilla "${plantilla}" no salió; intento texto normal.`);
  const t = await enviarMensaje(tel, textoRespaldo);
  return !!t;
}

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
 * Devuelve true si el mensaje salió. Nunca lanza: un aviso fallido NO debe
 * tumbar la creación del checklist.
 */
async function avisarAsignacion(ck) {
  try {
    if (APAGADO || !dbConfigurada() || !ck || !ck.id) return false;
    const clave = 'asig:' + ck.id;
    if (!await reclamarAviso(clave)) return false;   // ya se avisó antes

    const personal = await cargarPersonal();
    const persona = personaDeChecklist(personal, ck);
    if (!persona || !persona.telefono) {
      await soltarAviso(clave); // sin teléfono: que se pueda reintentar si lo registran
      return false;
    }

    const nombre = (persona.nombre || '').split(' ')[0] || 'Hola';
    const items = Array.isArray(ck.items) ? ck.items.length : 0;
    const vars = [nombre, ck.name || 'una tarea', ck.store || 'tu sucursal', ck.date || 'hoy', ck.time || '23:59'];
    const respaldo =
      `Hola ${nombre} 👋\nTe asignaron *${ck.name || 'una tarea'}* en ${ck.store || 'tu sucursal'}` +
      `\n📅 ${ck.date || 'hoy'} · ⏰ antes de las ${ck.time || '23:59'}` +
      (items ? `\n\n${listaItems(ck)}` : '') +
      `\n\nCuando la termines contéstame por aquí (ej. *"ya hice la 1"*) y la vamos cerrando 👍`;

    const ok = await mandar(persona.telefono, T_NUEVA, vars, respaldo);
    if (!ok) await soltarAviso(clave);               // para reintentar en otro momento
    else console.log(`[tareas-notificar] aviso de asignacion checklist=${ck.id} -> ${persona.nombre}`);
    return ok;
  } catch (e) {
    console.error('[tareas-notificar] avisarAsignacion:', e && e.message);
    return false;
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
    const lista = cks.slice(0, 5).map(c => `• ${c.name || 'tarea'} (${c.store || 's/suc'}, ${c.time || '23:59'})`).join('\n')
      + (cks.length > 5 ? `\n• ...y ${cks.length - 5} más` : '');
    const vars = [nombre, String(cks.length), lista.replace(/\n/g, ' | ')];
    const respaldo = `¡Buen día, ${nombre}! ☀️\nHoy tienes *${cks.length}* ${cks.length === 1 ? 'tarea' : 'tareas'}:\n${lista}\n\nEscríbeme *"qué tengo hoy"* para verlas con detalle 👍`;
    const ok = await mandar(persona.telefono, T_RESUMEN, vars, respaldo);
    if (!ok) await soltarAviso(clave);
    else console.log(`[tareas-notificar] resumen ${fechaISO} -> ${persona.nombre} (${cks.length})`);
  }
}

// ============================================================================
//  3) RECORDATORIO ANTES DE LA HORA LÍMITE
// ============================================================================
async function recordatoriosLimite() {
  const { fechaISO } = ahoraMexico();
  const pendientes = await pgChecklistsPendientesDeFecha(fechaISO);
  if (!pendientes.length) return;
  const personal = await cargarPersonal();
  const ahora = Date.now();

  for (const ck of pendientes) {
    const hora = limitePendiente(ck);
    if (!hora) continue;                       // ya no le falta nada por hacer
    const limite = epochDeMx(ck.date || fechaISO, hora);
    if (limite == null) continue;
    const faltan = Math.round((limite - ahora) / 60000);
    if (faltan <= 0 || faltan > RECORDATORIO_MIN) continue;   // aún no toca, o ya venció

    const persona = personaDeChecklist(personal, ck);
    if (!persona || !persona.telefono) continue;

    const clave = 'limite:' + ck.id;
    if (!await reclamarAviso(clave)) continue;

    const items = Array.isArray(ck.items) ? ck.items : [];
    const sinHacer = items.filter(i => !itemHecho(i)).length;
    const nombre = (persona.nombre || '').split(' ')[0] || 'Hola';
    const vars = [nombre, ck.name || 'tu tarea', String(faltan), String(sinHacer)];
    const respaldo = `⏰ ${nombre}, te ${faltan === 1 ? 'queda 1 minuto' : 'quedan ' + faltan + ' minutos'} para entregar *${ck.name || 'tu tarea'}*`
      + ` y te ${sinHacer === 1 ? 'falta 1 tarea' : 'faltan ' + sinHacer + ' tareas'}.\nSi ya las hiciste, dime *"ya terminé"* y lo enviamos 🙌`;
    const ok = await mandar(persona.telefono, T_RECORDATORIO, vars, respaldo);
    if (!ok) await soltarAviso(clave);
    else console.log(`[tareas-notificar] recordatorio checklist=${ck.id} (${faltan} min) -> ${persona.nombre}`);
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

module.exports = { avisarAsignacion, avisarEntrega, resumenMatutino, recordatoriosLimite, tick, iniciarPoll };
