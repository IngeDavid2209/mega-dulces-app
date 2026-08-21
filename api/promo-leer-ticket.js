// ============================================================================
//  LEER EL TICKET DE VENTA CON LA IA.
//
//    POST /api/promo-leer-ticket   { url }  ->  { importe, importes[], ... }
//
//  Le pasa a Claude la foto del ticket que se acaba de subir a Cloudinary y le
//  pide las CANTIDADES DE DINERO que aparecen. Devuelve el total que reconocio y
//  todos los importes que vio, para que la persona confirme o corrija.
//
//  LA IA PROPONE, LA PERSONA CONFIRMA. Este endpoint NO guarda nada: solo lee y
//  contesta. Quien guarda es /api/promo-expedientes con la venta ya revisada, y
//  ahi queda tambien lo que habia leido la IA (campo `leidoIA`) para poder ver
//  despues si acerto. Se hizo asi porque de estos numeros salen el KPI y el
//  ranking: un cero mal leido cambia el lugar de una promocion.
//
//  Se manda la URL, no la foto: Cloudinary ya la tiene publica y la API de
//  Claude acepta imagenes por URL, asi que el archivo no viaja dos veces ni hay
//  que cargarlo en memoria del servidor.
//
//  Variables de entorno (Railway -> Variables):
//    ANTHROPIC_API_KEY   la misma que ya usa el asistente
//    PROMO_MODELO        opcional, para cambiar de modelo sin tocar codigo
// ============================================================================
const { verificarToken } = require('./_auth');

/** Modelo por defecto. Leer una foto torcida y borrosa de un ticket es justo
 *  donde un modelo chico se equivoca, y aqui un digito mal cambia el ranking. */
const MODELO = process.env.PROMO_MODELO || 'claude-opus-5';

/** La herramienta con la que el modelo entrega los numeros. Se pide por
 *  herramienta y no como texto libre para que la respuesta venga siempre con la
 *  misma forma y no haya que adivinar como escribio el JSON. */
const HERRAMIENTA = {
  name: 'reportar_importes',
  description: 'Entrega las cantidades de dinero que aparecen en el ticket de venta.',
  input_schema: {
    type: 'object',
    properties: {
      total: {
        type: ['number', 'null'],
        description: 'El TOTAL de la venta en pesos, solo el numero (sin $ ni comas). null si no se alcanza a leer.',
      },
      importes: {
        type: 'array',
        items: { type: 'number' },
        description: 'Todas las cantidades de dinero que se ven en el ticket, en el orden en que aparecen.',
      },
      piezas: {
        type: ['integer', 'null'],
        description: 'Cuantas piezas o articulos se vendieron, si el ticket lo dice. null si no aparece.',
      },
      legible: {
        type: 'boolean',
        description: 'false si la foto esta tan borrosa, cortada u oscura que no se puede leer con confianza.',
      },
      nota: {
        type: 'string',
        description: 'Una linea en espanol sobre lo que se vio, o por que no se pudo leer.',
      },
    },
    required: ['total', 'importes', 'legible', 'nota'],
  },
};

const SYSTEM = [
  'Lees fotos de tickets de venta de una dulceria mexicana para registrar cuanto se vendio.',
  'Los importes vienen en PESOS MEXICANOS: el punto separa los centavos y la coma los miles',
  '($1,234.50 son mil doscientos treinta y cuatro pesos con cincuenta centavos).',
  '',
  'Reglas:',
  '- El "total" es el total que se cobro. Si el ticket trae subtotal, IVA y total, el total es el ultimo.',
  '- Si ves varios totales (por ejemplo una copia doble del mismo ticket), reporta UNO solo.',
  '- No inventes. Si un numero no se alcanza a leer con seguridad, pon legible en false y explica por que.',
  '- Un numero que no sea dinero (folio, caja, fecha, telefono, RFC) NO va en importes.',
  '- Contesta siempre llamando a la herramienta reportar_importes.',
].join('\n');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

  try { await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Falta ANTHROPIC_API_KEY en las variables del servidor.' });
  }

  const url = String((req.body || {}).url || '').trim();
  if (!/^https:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Falta la foto del ticket (URL https).' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 2048,
        system: SYSTEM,
        // Esfuerzo bajo: leer los numeros de un ticket no necesita que el modelo
        // le de muchas vueltas, y asi el costo por foto se queda en centavos.
        output_config: { effort: 'low' },
        tools: [HERRAMIENTA],
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url } },
            { type: 'text', text: 'Dime las cantidades de dinero de este ticket.' },
          ],
        }],
      }),
    });

    if (!r.ok) {
      const detalle = await r.text().catch(() => '');
      console.error('[promo-leer-ticket] Claude respondio', r.status, detalle.slice(0, 400));
      // 401/403 son de la llave; el resto casi siempre es la imagen o un limite.
      const mensaje = r.status === 401 || r.status === 403
        ? 'La llave de la IA no es válida.'
        : 'La IA no pudo leer el ticket ahora (código ' + r.status + '). Captura el importe a mano.';
      return res.status(502).json({ error: mensaje });
    }

    const data = await r.json();
    const bloques = Array.isArray(data.content) ? data.content : [];
    const llamada = bloques.find(b => b && b.type === 'tool_use' && b.name === 'reportar_importes');

    if (!llamada) {
      // El modelo contesto en texto en vez de usar la herramienta. No se intenta
      // adivinar el numero de un parrafo: se pide capturarlo a mano.
      const dijo = bloques.filter(b => b && b.type === 'text').map(b => b.text).join(' ').trim();
      console.error('[promo-leer-ticket] sin llamada a la herramienta:', dijo.slice(0, 200));
      return res.json({
        legible: false, total: null, importes: [], piezas: null,
        nota: 'No se pudo leer el ticket automáticamente. Captura el importe a mano.',
      });
    }

    const x = llamada.input || {};
    const aNumero = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const importes = Array.isArray(x.importes)
      ? x.importes.map(aNumero).filter(v => v !== null) : [];

    return res.json({
      total: aNumero(x.total),
      importes,
      piezas: x.piezas == null ? null : aNumero(x.piezas),
      legible: x.legible !== false,
      nota: String(x.nota || '').trim(),
      modelo: MODELO,
      // Para poder ver despues cuanto costo la lectura.
      uso: data.usage
        ? { entrada: data.usage.input_tokens, salida: data.usage.output_tokens }
        : null,
    });
  } catch (e) {
    console.error('[promo-leer-ticket]', e && e.message);
    return res.status(500).json({
      error: 'No se pudo leer el ticket: ' + (e && e.message) + '. Captura el importe a mano.',
    });
  }
};
