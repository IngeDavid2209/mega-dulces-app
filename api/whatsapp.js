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

// Envia un mensaje de PLANTILLA (template) aprobada. Es la unica forma de
// iniciar una conversacion "en frio" (fuera de la ventana de 24h de atencion).
// `variables` son los valores para {{1}}, {{2}}, ... del cuerpo, en orden.
async function enviarPlantilla(telefono, nombrePlantilla, idioma, variables) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.error('[whatsapp] Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID; no se envia la plantilla.');
    return null;
  }
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const params = (Array.isArray(variables) ? variables : []).map(v => ({
    type: 'text', text: String(v == null ? '' : v).slice(0, 1024),
  }));
  const cuerpo = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizarTelefono(telefono),
    type: 'template',
    template: {
      name: String(nombrePlantilla || ''),
      language: { code: String(idioma || 'es_MX') },
      components: params.length ? [{ type: 'body', parameters: params }] : [],
    },
  };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`[whatsapp] Envio de plantilla fallo (HTTP ${r.status}):`, JSON.stringify(datos));
      return null;
    }
    return datos;
  } catch (err) {
    console.error('[whatsapp] No se pudo enviar la plantilla:', err.message);
    return null;
  }
}

// Envia un mensaje interactivo que le PIDE al usuario compartir su ubicacion.
// WhatsApp muestra el boton nativo "Enviar ubicacion"; cuando el usuario lo usa,
// llega un mensaje entrante de tipo `location` (ver extraerMensaje).
async function enviarSolicitudUbicacion(telefono, texto) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.error('[whatsapp] Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID; no se pide ubicacion.');
    return null;
  }
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const cuerpo = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizarTelefono(telefono),
    type: 'interactive',
    interactive: {
      type: 'location_request_message',
      body: { text: String(texto || 'Compárteme tu ubicación 📍').slice(0, 1024) },
      action: { name: 'send_location' },
    },
  };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`[whatsapp] Solicitud de ubicacion fallo (HTTP ${r.status}):`, JSON.stringify(datos));
      // Fallback: al menos manda el texto para que el usuario sepa que hacer.
      return enviarMensaje(telefono, texto);
    }
    return datos;
  } catch (err) {
    console.error('[whatsapp] No se pudo pedir la ubicacion:', err.message);
    return enviarMensaje(telefono, texto);
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
    if (msg.type === 'location' && msg.location) {
      return {
        from, tipo: 'location', texto: '',
        ubicacion: {
          lat: msg.location.latitude, lng: msg.location.longitude,
          nombre: msg.location.name || '', direccion: msg.location.address || '',
        },
      };
    }
    // Otros tipos (audio, imagen, etc.) por ahora se reportan sin texto.
    return { from, tipo: msg.type, texto: '' };
  } catch (e) {
    return null;
  }
}

module.exports = { normalizarTelefono, ultimos10, enviarMensaje, enviarPlantilla, enviarSolicitudUbicacion, validarFirma, extraerMensaje };
