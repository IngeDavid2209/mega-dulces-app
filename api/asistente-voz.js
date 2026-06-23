// Endpoint serverless de Vercel para el ASISTENTE DE VOZ.
//
// Recibe el texto que dictó el trabajador (ya convertido de voz a texto en el
// celular), se lo manda a la IA de Claude para que entienda la intencion en
// lenguaje natural, y devuelve una accion estructurada que el frontend ejecuta.
//
// Fase 1: solo se ACTUA sobre la accion "crear" (agendar una tarea propia).
// La IA igual clasifica "consultar" y "asignar" para las siguientes fases.
//
// Variables de entorno requeridas (Railway -> tu proyecto -> Variables):
//   ANTHROPIC_API_KEY        = llave de la API de Claude (Anthropic).
//   FIREBASE_SERVICE_ACCOUNT = JSON del service account.
//   ASISTENTE_MODELO         = opcional. Por defecto "claude-opus-4-8".
//                              Para abaratar ~5x se puede poner "claude-haiku-4-5".

const admin = require('firebase-admin');

let inicializado = false;
function inicializar() {
  if (inicializado) return;
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Falta variable FIREBASE_SERVICE_ACCOUNT en las variables de entorno.');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  inicializado = true;
}

// Extrae el primer objeto JSON valido del texto que devuelve la IA.
// (Por si acaso viniera envuelto en ``` o con texto alrededor.)
function extraerJSON(texto) {
  if (!texto) return null;
  let t = String(texto).trim();
  // Quitar cercas de codigo ```json ... ```
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(t);
  } catch (_) {
    const ini = t.indexOf('{');
    const fin = t.lastIndexOf('}');
    if (ini >= 0 && fin > ini) {
      try { return JSON.parse(t.slice(ini, fin + 1)); } catch (_) { return null; }
    }
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    inicializar();

    // 1) Validar que sea un usuario autenticado (no abierto al publico)
    const authHeader = String(req.headers['authorization'] || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Falta Authorization Bearer token' });
    await admin.auth().verifyIdToken(idToken);

    // 2) Datos de entrada
    const body = req.body || {};
    const transcript = String(body.transcript || '').trim();
    const fechaHoy = String(body.fechaHoy || '').trim(); // YYYY-MM-DD del celular
    const diaSemana = String(body.diaSemana || '').trim(); // ej "lunes"
    if (!transcript) return res.status(400).json({ error: 'Falta el texto (transcript).' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY en las variables de entorno.' });

    const modelo = process.env.ASISTENTE_MODELO || 'claude-opus-4-8';

    // 3) Instrucciones para la IA
    const system = [
      'Eres el cerebro de un asistente de voz para trabajadores de una dulceria llamada Mega Dulces.',
      'Tu trabajo es convertir lo que dijo el trabajador en una accion estructurada para su lista de tareas/pendientes.',
      `Hoy es ${fechaHoy || '(desconocido)'}${diaSemana ? ' (' + diaSemana + ')' : ''}.`,
      '',
      'Devuelve UNICAMENTE un objeto JSON valido, sin texto adicional y sin markdown, con esta forma exacta:',
      '{',
      '  "accion": "crear" | "consultar" | "asignar" | "desconocido",',
      '  "texto": string,        // descripcion corta y clara de la tarea (solo para crear)',
      '  "fecha": string,        // "YYYY-MM-DD" o "" si no se menciono',
      '  "instrucciones": string,// detalle extra o ""',
      '  "asignadoA": string,    // nombre de la persona si quiere asignar a otro, o ""',
      '  "filtro": string,       // solo para consultar: "hoy" | "pendientes" | "vencidas" | "fecha" | "todas"',
      '  "respuesta": string     // frase corta y natural en espanol para leerle en voz alta',
      '}',
      '',
      'Reglas:',
      '- "crear": el trabajador quiere agregar/agendar/recordar una tarea o pendiente.',
      '- "consultar": pregunta que tareas o pendientes tiene. Elige "filtro":',
      '    "hoy" si pregunta por hoy; "vencidas" si pregunta por atrasadas/vencidas;',
      '    "fecha" si pregunta por un dia especifico (pon ese dia en "fecha");',
      '    "todas" si quiere ver todo; "pendientes" en cualquier otro caso.',
      '- "asignar": quiere darle una tarea a OTRA persona (pon su nombre en asignadoA).',
      '- "desconocido": si no entiendes la intencion.',
      '- Resuelve fechas relativas (hoy, manana, pasado manana, el viernes, en 3 dias) a formato YYYY-MM-DD usando la fecha de hoy. Si no hay fecha, deja "".',
      '- "texto" debe ser claro y breve, sin la palabra "recuerdame" ni relleno. Ej: "Reporte de ventas".',
      '- "respuesta" confirma de forma amable lo que entendiste. Ej: "Listo, te agende: Reporte de ventas para el viernes."',
      '- No inventes datos que el trabajador no dijo.'
    ].join('\n');

    // 4) Llamada a la API de Claude (HTTP directo, sin dependencias)
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 500,
        system,
        messages: [{ role: 'user', content: transcript }]
      })
    });

    if (!r.ok) {
      const detalle = await r.text().catch(() => '');
      console.error('[asistente-voz] Claude error', r.status, detalle);
      return res.status(502).json({ error: 'La IA no respondio bien.', status: r.status });
    }

    const data = await r.json();
    const texto = Array.isArray(data.content)
      ? data.content.filter(b => b && b.type === 'text').map(b => b.text).join('\n')
      : '';

    const intencion = extraerJSON(texto);
    if (!intencion || typeof intencion.accion !== 'string') {
      console.error('[asistente-voz] No se pudo interpretar:', texto);
      return res.status(200).json({
        accion: 'desconocido',
        texto: '',
        fecha: '',
        instrucciones: '',
        asignadoA: '',
        filtro: '',
        respuesta: 'Perdon, no te entendi bien. Intenta de nuevo.'
      });
    }

    // Normalizar para que el frontend siempre reciba todos los campos
    return res.status(200).json({
      accion: intencion.accion || 'desconocido',
      texto: String(intencion.texto || '').trim(),
      fecha: String(intencion.fecha || '').trim(),
      instrucciones: String(intencion.instrucciones || '').trim(),
      asignadoA: String(intencion.asignadoA || '').trim(),
      filtro: String(intencion.filtro || '').trim(),
      respuesta: String(intencion.respuesta || '').trim()
    });
  } catch (e) {
    console.error('[asistente-voz] error:', e);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
