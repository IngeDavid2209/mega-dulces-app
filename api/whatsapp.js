// Cliente de la WhatsApp Cloud API (Meta) para el asistente por WhatsApp.
// Modulo de utilidades (no es una ruta): lo usa api/whatsapp-webhook.js.
//
// Variables de entorno (Railway -> Variables):
//   WHATSAPP_TOKEN            token permanente (usuario del sistema)
//   WHATSAPP_PHONE_NUMBER_ID  id del numero que envia (Cloud API)
//   WHATSAPP_APP_SECRET       (opcional) para validar la firma del webhook
//   WHATSAPP_VERIFY_TOKEN     token de verificacion del webhook (GET)

const crypto = require('crypto');

const GRAPH_VERSION = 'v21.0';

// WhatsApp entrega los numeros de Mexico como 52 + "1" + 10 digitos
// (ej. 5213521231708); para RESPONDER hay que enviar SIN ese "1"
// (523521231708). Esta funcion lo quita en numeros MX de 13 digitos.
function normalizarTelefono(numero) {
  const n = String(numero || '').replace(/\D/g, '');
  const mx = n.match(/^521(\d{10})$/); // 521XXXXXXXXXX -> 52XXXXXXXXXX
  return mx ? '52' + mx[1] : n;
}

// Ultimos 10 digitos de un telefono (para comparar sin importar lada/formato).
function ultimos10(numero) {
  const n = String(numero || '').replace(/\D/g, '');
  return n.length >= 10 ? n.slice(-10) : n;
}

// Envia un mensaje de texto a un numero via la Cloud API.
async function enviarMensaje(telefono, texto) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.error('[whatsapp] Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID; no se envia el mensaje.');
    return null;
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const cuerpo = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizarTelefono(telefono),
    type: 'text',
    text: { body: String(texto || '').slice(0, 4096) }, // limite de WhatsApp
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`[whatsapp] Envio fallo (HTTP ${r.status}):`, JSON.stringify(datos));
      return null;
    }
    return datos;
  } catch (err) {
    console.error('[whatsapp] No se pudo contactar a la Graph API:', err.message);
    return null;
  }
}

// Valida la firma del webhook (X-Hub-Signature-256) con el APP SECRET.
// Necesita el cuerpo CRUDO (req.rawBody, capturado por express.json verify).
// Si no hay WHATSAPP_APP_SECRET configurado, no valida (devuelve true) para no
// bloquear durante la configuracion inicial.
function validarFirma(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // sin secreto configurado => no se valida
  const firma = String(req.headers['x-hub-signature-256'] || '');
  const raw = req.rawBody;
  if (!firma || !raw) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  // Comparacion en tiempo constante.
  const a = Buffer.from(firma);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Extrae el primer mensaje de texto entrante del payload del webhook.
// Devuelve { from, tipo, texto } o null si no hay mensaje de usuario
// (ej. cuando el webhook trae solo "statuses" de entrega).
function extraerMensaje(body) {
  try {
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return null;
    const from = msg.from; // ej. 5213521231708
    if (msg.type === 'text') return { from, tipo: 'text', texto: msg.text?.body || '' };
    // Otros tipos (audio, imagen, etc.) por ahora se reportan sin texto.
    return { from, tipo: msg.type, texto: '' };
  } catch (e) {
    return null;
  }
}

module.exports = { normalizarTelefono, ultimos10, enviarMensaje, validarFirma, extraerMensaje };
