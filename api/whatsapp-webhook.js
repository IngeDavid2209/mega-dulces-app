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

const { construirContexto, procesarChat, pgUsuarios, pgConversacionGet, pgConversacionSet } = require('./asistente-chat');
const { enviarMensaje, ultimos10, validarFirma, extraerMensaje } = require('./whatsapp');

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

// Procesa un mensaje entrante (async, despues de haber respondido 200 a Meta).
async function procesarMensaje(msg) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('[wa-webhook] Falta ANTHROPIC_API_KEY.'); return; }
  const modelo = process.env.ASISTENTE_MODELO || 'claude-opus-4-8';

  // Solo texto por ahora.
  if (msg.tipo !== 'text' || !String(msg.texto || '').trim()) {
    await enviarMensaje(msg.from, 'Por ahora solo entiendo mensajes de *texto*. Escríbeme qué necesitas 🙂');
    return;
  }
  const texto = msg.texto.trim();

  // Identificar al usuario por su telefono (ultimos 10 digitos, sin importar formato).
  const objetivo = ultimos10(msg.from);
  const usuarios = await pgUsuarios();
  const yo = usuarios.find(u => u.telefono && ultimos10(u.telefono) === objetivo);

  if (!yo) {
    await enviarMensaje(msg.from,
      'Hola 👋 No encuentro tu número en el sistema de *Mega Dulces Task*.\n' +
      'Pídele a tu encargado(a) que registre tu WhatsApp en tu perfil de la app y vuelve a escribirme.');
    return;
  }

  // Comando para reiniciar el hilo.
  if (COMANDOS_RESET.includes(texto.toLowerCase())) {
    await pgConversacionSet(objetivo, { messages: [], uid: yo.id });
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

  // Contexto del usuario identificado (mismos permisos que en la web) + asistente.
  const { fechaHoy, diaSemana } = fechaMexico();
  // Reutilizamos la lista de usuarios ya cargada (evita una 2ª lectura a Firestore).
  const ctx = await construirContexto(null, yo.id, yo, { fechaHoy, diaSemana, usuarios });

  let respuesta;
  try {
    const salida = await procesarChat({ apiKey, modelo, db: null, ctx, messages });
    respuesta = salida.respuesta;
    messages = recortarHistorial(salida.messages);
  } catch (e) {
    console.error('[wa-webhook] error del asistente:', e && e.message, e && e.detalle);
    await enviarMensaje(msg.from, 'Uy, tuve un problema procesando tu mensaje 😕. Inténtalo de nuevo en un momento.');
    return;
  }

  // Guardar hilo y responder por WhatsApp.
  try { await pgConversacionSet(objetivo, { messages, uid: yo.id }); }
  catch (e) { console.error('[wa-webhook] no se guardo el hilo:', e && e.message); }

  await enviarMensaje(msg.from, respuesta);
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
