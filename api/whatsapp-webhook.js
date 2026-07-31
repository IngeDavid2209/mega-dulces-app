// Webhook del ASISTENTE por WhatsApp.
//
// GET  -> verificacion del webhook (Meta manda hub.challenge).
// POST -> mensajes entrantes: identifica al usuario por su TELEFONO (mapea a la
//         coleccion `usuarios`), corre el MISMO asistente que la web
//         (api/asistente-chat.js) con los permisos de ese usuario, y responde
//         por WhatsApp. Mantiene el hilo de conversacion por numero en Firestore.
//
// Variables de entorno (Railway -> Variables):
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN,
//   WHATSAPP_APP_SECRET (opcional), ANTHROPIC_API_KEY, ASISTENTE_MODELO (opcional),
//   FIREBASE_SERVICE_ACCOUNT

const {
  construirContexto, procesarChat, pgUsuarios, pgConversacionGet, pgConversacionSet,
  registrarUbicacion, registrarFotoEvidencia, pgConversacionEsperandoGet,
} = require('./asistente-chat');
const { enviarMensaje, enviarSolicitudUbicacion, descargarMedia, ultimos10, validarFirma, extraerMensaje } = require('./whatsapp');
const { resolverPorWhatsapp } = require('./flotilla-notificar');
const { subirBuffer } = require('./cloudinary-subir');

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const HORAS_RESET = 3;         // reinicia el hilo tras N horas de inactividad
const MAX_HISTORIAL = 30;      // maximo de mensajes guardados por conversacion
const COMANDOS_RESET = ['reiniciar', 'reset', 'nueva conversacion', 'nueva conversación', 'empezar de nuevo', 'borrar'];

// Fecha (YYYY-MM-DD) y dia de la semana en hora de Mexico.
function fechaMexico() {
  const fmtFecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });
  const fechaHoy = fmtFecha.format(new Date());
  // getUTCDay del "medio dia Mexico" evita saltos por zona horaria.
  const dow = new Date(fechaHoy + 'T12:00:00Z').getUTCDay();
  return { fechaHoy, diaSemana: DIAS[dow] };
}

// Recorta el historial dejando la cola, empezando en un mensaje de usuario de
// texto (para no romper el emparejamiento tool_use/tool_result de Claude).
function recortarHistorial(messages) {
  if (messages.length <= MAX_HISTORIAL) return messages;
  let ini = messages.length - MAX_HISTORIAL;
  while (ini < messages.length && !(messages[ini].role === 'user' && typeof messages[ini].content === 'string')) ini++;
  return ini < messages.length ? messages.slice(ini) : messages.slice(-MAX_HISTORIAL);
}

// Hora HH:mm en zona de Mexico (para confirmar salida/regreso).
function horaMexico(epoch) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' }).format(new Date(Number(epoch || Date.now())));
}

// Procesa un mensaje entrante (async, despues de haber respondido 200 a Meta).
async function procesarMensaje(msg) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('[wa-webhook] Falta ANTHROPIC_API_KEY.'); return; }
  const modelo = process.env.ASISTENTE_MODELO || 'claude-opus-4-8';

  // Tipos soportados: texto (asistente), ubicacion (flotilla: salida/regreso) e
  // imagen (foto de evidencia al entregar una tarea).
  if (msg.tipo !== 'text' && msg.tipo !== 'location' && msg.tipo !== 'image') {
    await enviarMensaje(msg.from, 'Por ahora entiendo mensajes de *texto*, *fotos* y *ubicación*. Escríbeme qué necesitas 🙂');
    return;
  }
  if (msg.tipo === 'text' && !String(msg.texto || '').trim()) {
    await enviarMensaje(msg.from, 'Escríbeme qué necesitas 🙂');
    return;
  }

  // FLOTILLA: si el mensaje es "aprobar/rechazar <CODIGO>", lo resuelve el modulo
  // de flotilla (autoriza por telefono) y NO pasa al asistente de IA. Se checa
  // antes de identificar al usuario, porque un aprobador podria no estar
  // registrado como usuario y aun asi tener permiso por su numero.
  if (msg.tipo === 'text') {
    let respFlotilla = null;
    try { respFlotilla = await resolverPorWhatsapp(msg.from, msg.texto); }
    catch (e) { console.error('[wa-webhook] flotilla:', e && e.message); }
    if (respFlotilla) { await enviarMensaje(msg.from, respFlotilla); return; }
  }

  // Identificar al usuario por su telefono (ultimos 10 digitos, sin importar formato).
  const objetivo = ultimos10(msg.from);
  const usuarios = await pgUsuarios();
  const yo = usuarios.find(u => u.telefono && ultimos10(u.telefono) === objetivo);

  // Resolver IDENTIDAD. Si el número NO está registrado en MD Task, se atiende
  // como INVITADO (no crea cuenta): se le pide nombre y apellido y solo puede
  // usar la flotilla. La identidad de invitado se guarda en el hilo.
  let identidad;
  if (yo) {
    identidad = { uid: yo.id, nombre: yo.nombre || yo.correo || 'Usuario', perfil: yo, esInvitado: false, invitadoNombre: null };
  } else {
    let invitado = null;
    try { const c = await pgConversacionGet(objetivo); invitado = c && c.invitado; } catch (e) { /* sin identidad guardada */ }
    const invitadoNombre = invitado && invitado.nombre ? invitado.nombre : null;
    identidad = {
      uid: 'wa-' + objetivo,
      nombre: invitadoNombre || 'Invitado',
      perfil: { nombre: invitadoNombre || '', rol: 'invitado' },
      esInvitado: true, invitadoNombre,
    };
  }

  // ── UBICACION entrante (respuesta a "comparte tu ubicacion" de salida/regreso) ──
  if (msg.tipo === 'location') {
    if (identidad.esInvitado && !identidad.invitadoNombre) {
      await enviarMensaje(msg.from, 'Antes necesito saber quién eres. Dime tu *nombre y apellido*, por favor 🙂');
      return;
    }
    if (!msg.ubicacion || msg.ubicacion.lat == null) {
      await enviarMensaje(msg.from, 'No pude leer tu ubicación 😕. Inténtalo de nuevo con el botón de *Ubicación*.');
      return;
    }
    let res;
    try { res = await registrarUbicacion(identidad.uid, msg.ubicacion); }
    catch (e) { console.error('[wa-webhook] error registrando ubicacion:', e && e.message); res = null; }
    if (!res) { await enviarMensaje(msg.from, 'Uy, no pude guardar tu ubicación 😕. Inténtalo de nuevo en un momento.'); return; }
    if (!res.ok) {
      await enviarMensaje(msg.from, 'Recibí tu ubicación, pero ahora mismo no tienes ninguna salida o regreso esperándola. Si vas a usar un coche, dime "voy a usar [coche]".');
      return;
    }
    const veh = res.reserva.vehiculo || 'el vehículo';
    const hora = horaMexico(res.punto && res.punto.hora);
    const texto = res.accion === 'salida'
      ? `¡Listo! Registré tu *salida* con ${veh} 🚗 a las ${hora} desde tu ubicación. Cuando regreses, avísame "ya lo entregué".`
      : `¡Gracias! Registré el *regreso* de ${veh} 🅿️ a las ${hora}. Uso cerrado. 👍`;
    await enviarMensaje(msg.from, texto);
    return;
  }

  // ── FOTO entrante (evidencia de la tarea que quedo esperando su foto) ──
  // Se resuelve FUERA de Claude: el asistente ya dejo apuntado que item espera
  // foto (entregar_item -> requiere_foto), aqui solo se baja, se sube a
  // Cloudinary y se guarda. Mismo patron que la ubicacion de flotilla.
  if (msg.tipo === 'image') {
    if (identidad.esInvitado) {
      await enviarMensaje(msg.from, 'Recibí tu foto 📷, pero como invitado solo te puedo ayudar con los *vehículos*.');
      return;
    }
    let esp = null;
    try { esp = await pgConversacionEsperandoGet(objetivo); } catch (e) { /* sin estado */ }
    if (!esp || esp.tipo !== 'foto') {
      await enviarMensaje(msg.from, 'Recibí tu foto 📷 pero no sé de qué tarea es. Dime primero cuál entregas (ej. *"ya hice la 2"*) y te la pido 🙂');
      return;
    }

    const media = await descargarMedia(msg.mediaId);
    if (!media) {
      await enviarMensaje(msg.from, 'No pude descargar tu foto 😕. ¿Me la mandas otra vez?');
      return;
    }
    const subida = await subirBuffer(media.buffer, { carpeta: 'whatsapp/evidencias' });
    if (!subida) {
      await enviarMensaje(msg.from, 'Recibí tu foto pero no la pude guardar 😕. Inténtalo de nuevo en un momento.');
      return;
    }

    let res;
    try { res = await registrarFotoEvidencia(objetivo, subida.url); }
    catch (e) { console.error('[wa-webhook] error guardando evidencia:', e && e.message); res = null; }
    if (!res || !res.ok) {
      await enviarMensaje(msg.from, 'Guardé la foto pero ya no encontré la tarea que la esperaba 😕. Dime otra vez cuál entregas.');
      return;
    }

    const tarea = res.item.texto;
    const ck = res.checklist;
    let respuesta;
    if (res.fase === 'antes') {
      respuesta = `Guardé la foto de *ANTES* de "${tarea}" 📷. Ahora mándame la de *DESPUÉS*.`;
    } else if (res.fase === 'varias') {
      respuesta = `Guardé la foto de "${tarea}" 📷 (${res.totalFotos} en total). Puedes mandar más o decirme *listo*.`;
    } else if (res.todosHechos) {
      respuesta = `¡Listo! Guardé la evidencia de "${tarea}" ✅. Ya completaste las ${ck.total} tareas de "${ck.nombre}". ¿Lo envío? Contéstame *enviar*.`;
    } else {
      respuesta = `¡Listo! Guardé la evidencia de "${tarea}" ✅. Te faltan ${ck.pendientes} de ${ck.total} en "${ck.nombre}".`;
    }
    await enviarMensaje(msg.from, respuesta);
    return;
  }

  const texto = msg.texto.trim();

  // Comando para reiniciar el hilo.
  if (COMANDOS_RESET.includes(texto.toLowerCase())) {
    await pgConversacionSet(objetivo, { messages: [], uid: identidad.uid });
    await enviarMensaje(msg.from, 'Listo, empezamos de nuevo 🧹. ¿En qué te ayudo?');
    return;
  }

  // Cargar historial (se reinicia si estuvo inactivo demasiado tiempo).
  let messages = [];
  try {
    const conv = await pgConversacionGet(objetivo);
    if (conv) {
      const inactivo = Date.now() - (conv.actualizado || 0) > HORAS_RESET * 3600 * 1000;
      if (!inactivo && Array.isArray(conv.messages)) messages = conv.messages;
    }
  } catch (e) { /* si falla la lectura, arrancamos con historial vacio */ }

  messages.push({ role: 'user', content: texto });

  // Contexto del usuario (registrado) o del invitado (solo flotilla) + asistente.
  const { fechaHoy, diaSemana } = fechaMexico();
  const ctx = await construirContexto(null, identidad.uid, identidad.perfil, {
    fechaHoy, diaSemana, usuarios, canal: 'whatsapp',
    esInvitado: identidad.esInvitado, invitadoNombre: identidad.invitadoNombre,
    convKey: objetivo, telefono: objetivo,
  });

  let respuesta, pideUbicacion = false;
  try {
    const salida = await procesarChat({ apiKey, modelo, db: null, ctx, messages });
    respuesta = salida.respuesta;
    messages = recortarHistorial(salida.messages);
    // Si una herramienta (registrar_salida/regreso) pidio ubicacion, mandamos el
    // boton nativo de WhatsApp en vez de un texto normal.
    pideUbicacion = (salida.acciones || []).some(a => a && a.requiere_ubicacion);
  } catch (e) {
    console.error('[wa-webhook] error del asistente:', e && e.message, e && e.detalle);
    await enviarMensaje(msg.from, 'Uy, tuve un problema procesando tu mensaje 😕. Inténtalo de nuevo en un momento.');
    return;
  }

  // Guardar hilo y responder por WhatsApp.
  try { await pgConversacionSet(objetivo, { messages, uid: identidad.uid }); }
  catch (e) { console.error('[wa-webhook] no se guardo el hilo:', e && e.message); }

  if (pideUbicacion) await enviarSolicitudUbicacion(msg.from, respuesta);
  else await enviarMensaje(msg.from, respuesta);
}

// ---------------------------------------------------------------------------
// Handler de la ruta /api/whatsapp-webhook
// ---------------------------------------------------------------------------
module.exports = async (req, res) => {
  // Verificacion del webhook (Meta -> GET con hub.*).
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(String(challenge || ''));
    }
    return res.sendStatus(403);
  }

  // Mensajes entrantes.
  if (req.method === 'POST') {
    if (!validarFirma(req)) {
      console.warn('[wa-webhook] firma invalida; se ignora el evento.');
      return res.sendStatus(403);
    }
    // TEMP DIAGNÓSTICO: registrar eventos de ESTADO (entrega/fallo) de mensajes.
    try {
      const val = req.body?.entry?.[0]?.changes?.[0]?.value;
      if (val?.statuses?.length) console.log('[wa-webhook] STATUS:', JSON.stringify(val.statuses));
    } catch (e) { /* noop */ }
    const msg = extraerMensaje(req.body || {});
    // Responder 200 de inmediato para que Meta no reintente; procesar aparte.
    res.sendStatus(200);
    if (msg && msg.from) {
      procesarMensaje(msg).catch(e => console.error('[wa-webhook] fallo al procesar:', e && e.message));
    }
    return;
  }

  return res.sendStatus(405);
};
