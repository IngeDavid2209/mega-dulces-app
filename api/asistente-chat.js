// Endpoint del ASISTENTE (chat con tool-use).
//
// A diferencia de api/asistente-voz.js (una sola llamada que devuelve JSON),
// aqui corre el BUCLE de herramientas de Claude: el modelo pide una herramienta,
// el servidor la ejecuta de verdad sobre Firestore (con firebase-admin), le
// devuelve el resultado, y el modelo sigue hasta terminar.
//
// Fase 1: herramientas de TAREAS personales (subcoleccion usuarios/{uid}/agenda).
//
// Variables de entorno (Railway -> Variables):
//   ANTHROPIC_API_KEY        = llave de Claude.
//   FIREBASE_SERVICE_ACCOUNT = JSON del service account.
//   ASISTENTE_MODELO         = opcional (por defecto claude-opus-4-8).

const admin = require('firebase-admin');

let inicializado = false;
function inicializar() {
  if (inicializado) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta variable FIREBASE_SERVICE_ACCOUNT en las variables de entorno.');
  const sa = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  inicializado = true;
}

const MAX_ITERACIONES = 6; // tope de vueltas del bucle de herramientas (anti-loop)

// ---------------------------------------------------------------------------
// Definicion de herramientas (lo que el modelo puede pedir)
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: 'agregar_tarea',
    description: 'Crea una nueva tarea/pendiente en la agenda. Usala cuando el usuario quiera agendar, recordar o anotar algo que hacer. Resuelve fechas relativas (manana, el viernes) a formato YYYY-MM-DD usando la fecha de hoy del contexto.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Descripcion corta y clara de la tarea.' },
        fecha: { type: 'string', description: 'Dia de la tarea en formato YYYY-MM-DD. Vacio si no se menciona.' },
        hora_inicio: { type: 'string', description: 'Hora de inicio HH:mm (24h). Opcional.' },
        fecha_fin: { type: 'string', description: 'Fecha de fin YYYY-MM-DD. Opcional.' },
        hora_fin: { type: 'string', description: 'Hora de fin HH:mm. Opcional.' },
        prioridad: { type: 'string', enum: ['alta', 'media', 'baja'], description: 'Prioridad. Opcional.' },
        para_quien: { type: 'string', description: 'Nombre de otra persona si la tarea es para alguien mas. Vacio = para uno mismo.' }
      },
      required: ['titulo']
    }
  },
  {
    name: 'consultar_tareas',
    description: 'Consulta las tareas/pendientes del usuario. Usala cuando pregunte que tiene pendiente, que hay para hoy, que esta vencido, etc. Tambien usala ANTES de completar/editar/eliminar para conocer el id de la tarea.',
    input_schema: {
      type: 'object',
      properties: {
        filtro: { type: 'string', enum: ['hoy', 'pendientes', 'vencidas', 'todas'], description: 'Que tareas traer. Por defecto pendientes.' },
        fecha: { type: 'string', description: 'Si pregunta por un dia especifico, YYYY-MM-DD.' }
      },
      required: []
    }
  },
  {
    name: 'completar_tarea',
    description: 'Marca una tarea como completada/hecha. Requiere el id de la tarea (obtenlo primero con consultar_tareas).',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Id de la tarea.' } },
      required: ['id']
    }
  },
  {
    name: 'editar_tarea',
    description: 'Modifica una tarea existente (titulo, fecha, horas, prioridad, instrucciones). Requiere el id (obtenlo con consultar_tareas). Solo manda los campos que cambian.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id de la tarea.' },
        titulo: { type: 'string' },
        fecha: { type: 'string', description: 'YYYY-MM-DD' },
        hora_inicio: { type: 'string', description: 'HH:mm' },
        fecha_fin: { type: 'string', description: 'YYYY-MM-DD' },
        hora_fin: { type: 'string', description: 'HH:mm' },
        prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
        instrucciones: { type: 'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'eliminar_tarea',
    description: 'Elimina una tarea. Requiere el id (obtenlo con consultar_tareas). Confirma con el usuario antes si no esta seguro.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Id de la tarea.' } },
      required: ['id']
    }
  }
];

// ---------------------------------------------------------------------------
// Ejecutores de herramientas (Firestore con firebase-admin)
// ---------------------------------------------------------------------------
function normaliza(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function agendaRef(db, uid) {
  return db.collection('usuarios').doc(uid).collection('agenda');
}

// Busca el uid de otra persona por nombre (para "para_quien").
async function resolverPersona(db, nombre) {
  const objetivo = normaliza(nombre);
  if (!objetivo) return null;
  const snap = await db.collection('usuarios').get();
  let mejor = null;
  snap.forEach(d => {
    const u = d.data() || {};
    const n = normaliza(u.nombre || u.correo || '');
    if (!n) return;
    if (n === objetivo || n.includes(objetivo) || objetivo.includes(n) || n.split(' ')[0] === objetivo.split(' ')[0]) {
      if (!mejor) mejor = { id: d.id, nombre: u.nombre || u.correo };
    }
  });
  return mejor;
}

async function ejecutarHerramienta(db, ctx, nombre, input) {
  input = input || {};

  if (nombre === 'agregar_tarea') {
    let uidDestino = ctx.uid;
    let etiquetaDestino = 'tu agenda';
    if (input.para_quien && ctx.esAdmin) {
      const persona = await resolverPersona(db, input.para_quien);
      if (!persona) return { ok: false, mensaje: `No encontre a "${input.para_quien}" en el personal.` };
      uidDestino = persona.id;
      etiquetaDestino = persona.nombre;
    }
    const doc = {
      texto: String(input.titulo || '').trim(),
      completada: false,
      fechaCreacion: Date.now(),
      fecha: input.fecha || '',
      fechaInicio: input.fecha || '',
      horaInicio: input.hora_inicio || '',
      fechaFin: input.fecha_fin || '',
      horaFin: input.hora_fin || '',
      prioridad: input.prioridad || '',
      instrucciones: '',
      comentarios: '',
      adjunto: null,
      creadaPorVoz: true
    };
    if (uidDestino !== ctx.uid) doc.asignadaPor = ctx.nombre || 'Un jefe';
    const ref = await agendaRef(db, uidDestino).add(doc);
    return { ok: true, id: ref.id, mensaje: `Tarea creada en ${etiquetaDestino}.`, tarea: { id: ref.id, titulo: doc.texto, fecha: doc.fecha } };
  }

  if (nombre === 'consultar_tareas') {
    const filtro = input.filtro || 'pendientes';
    const hoy = ctx.fechaHoy;
    const snap = await agendaRef(db, ctx.uid).get();
    let lista = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    if (filtro === 'hoy') lista = lista.filter(t => !t.completada && t.fecha === hoy);
    else if (filtro === 'vencidas') lista = lista.filter(t => !t.completada && t.fecha && t.fecha < hoy);
    else if (filtro === 'todas') { /* todas */ }
    else if (input.fecha) lista = lista.filter(t => !t.completada && t.fecha === input.fecha);
    else lista = lista.filter(t => !t.completada); // pendientes
    // Devolver solo lo util para el modelo.
    const tareas = lista.map(t => ({
      id: t.id, titulo: t.texto, fecha: t.fecha || '', hora_inicio: t.horaInicio || '',
      prioridad: t.prioridad || '', completada: !!t.completada
    }));
    return { ok: true, total: tareas.length, tareas };
  }

  if (nombre === 'completar_tarea') {
    if (!input.id) return { ok: false, mensaje: 'Falta el id de la tarea.' };
    await agendaRef(db, ctx.uid).doc(input.id).update({ completada: true, completadaEn: Date.now() });
    return { ok: true, mensaje: 'Tarea marcada como completada.' };
  }

  if (nombre === 'editar_tarea') {
    if (!input.id) return { ok: false, mensaje: 'Falta el id de la tarea.' };
    const cambios = {};
    if (input.titulo != null) cambios.texto = input.titulo;
    if (input.fecha != null) { cambios.fecha = input.fecha; cambios.fechaInicio = input.fecha; }
    if (input.hora_inicio != null) cambios.horaInicio = input.hora_inicio;
    if (input.fecha_fin != null) cambios.fechaFin = input.fecha_fin;
    if (input.hora_fin != null) cambios.horaFin = input.hora_fin;
    if (input.prioridad != null) cambios.prioridad = input.prioridad;
    if (input.instrucciones != null) cambios.instrucciones = input.instrucciones;
    if (Object.keys(cambios).length === 0) return { ok: false, mensaje: 'No indicaste que cambiar.' };
    await agendaRef(db, ctx.uid).doc(input.id).update(cambios);
    return { ok: true, mensaje: 'Tarea actualizada.' };
  }

  if (nombre === 'eliminar_tarea') {
    if (!input.id) return { ok: false, mensaje: 'Falta el id de la tarea.' };
    await agendaRef(db, ctx.uid).doc(input.id).delete();
    return { ok: true, mensaje: 'Tarea eliminada.' };
  }

  return { ok: false, mensaje: 'Herramienta desconocida: ' + nombre };
}

// ---------------------------------------------------------------------------
// Llamada a Claude
// ---------------------------------------------------------------------------
async function llamarClaude(apiKey, modelo, system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ model: modelo, max_tokens: 1024, system, tools: TOOLS, messages })
  });
  if (!r.ok) {
    const detalle = await r.text().catch(() => '');
    const err = new Error('Claude respondio ' + r.status);
    err.detalle = detalle;
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// ---------------------------------------------------------------------------
// Handler HTTP
// ---------------------------------------------------------------------------
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    inicializar();

    // 1) Validar sesion
    const authHeader = String(req.headers['authorization'] || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Falta Authorization Bearer token' });
    const decoded = await admin.auth().verifyIdToken(idToken);

    const db = admin.firestore();
    const perfilSnap = await db.collection('usuarios').doc(decoded.uid).get();
    const perfil = perfilSnap.data() || {};

    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) return res.status(400).json({ error: 'Faltan mensajes.' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY en las variables de entorno.' });
    const modelo = process.env.ASISTENTE_MODELO || 'claude-opus-4-8';

    const ctx = {
      uid: decoded.uid,
      nombre: perfil.nombre || perfil.correo || 'Usuario',
      esAdmin: perfil.rol === 'admin',
      fechaHoy: String(body.fechaHoy || '').trim(),
      diaSemana: String(body.diaSemana || '').trim()
    };

    const system = [
      'Eres el asistente de Mega Dulces Task, una app de tareas para una dulceria.',
      `Hablas con ${ctx.nombre}${ctx.esAdmin ? ' (administrador)' : ''}.`,
      `Hoy es ${ctx.fechaHoy || '(desconocido)'}${ctx.diaSemana ? ' (' + ctx.diaSemana + ')' : ''}.`,
      '',
      'Ayudas a gestionar tareas/pendientes usando las herramientas disponibles.',
      'Reglas:',
      '- Usa las herramientas para EJECUTAR acciones reales; no inventes que hiciste algo sin llamarlas.',
      '- Para completar, editar o eliminar una tarea necesitas su id: primero llama a consultar_tareas, identifica la correcta y luego actua.',
      '- Resuelve fechas relativas (hoy, manana, el viernes, en 3 dias) a YYYY-MM-DD usando la fecha de hoy.',
      '- Responde SIEMPRE en espanol, breve y claro. Confirma lo que hiciste en una frase.',
      '- Si una accion falla, explica el problema con amabilidad y sugiere que hacer.',
      '- No pidas datos que no necesitas; si falta algo importante, pregunta corto.'
    ].join('\n');

    // 2) Bucle de herramientas
    const acciones = [];
    let respuestaTexto = '';
    let data;

    for (let i = 0; i < MAX_ITERACIONES; i++) {
      data = await llamarClaude(apiKey, modelo, system, messages);

      // Guardar el turno del asistente en el historial.
      messages.push({ role: 'assistant', content: data.content });

      if (data.stop_reason === 'tool_use') {
        const toolResults = [];
        for (const block of (data.content || [])) {
          if (block.type !== 'tool_use') continue;
          let resultado;
          try {
            resultado = await ejecutarHerramienta(db, ctx, block.name, block.input);
          } catch (e) {
            resultado = { ok: false, mensaje: (e && e.message) || 'Error ejecutando la herramienta.' };
          }
          if (resultado && resultado.ok) acciones.push({ herramienta: block.name, ...resultado });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(resultado),
            is_error: !(resultado && resultado.ok)
          });
        }
        messages.push({ role: 'user', content: toolResults });
        continue; // volver a llamar a Claude con los resultados
      }

      // Sin tool_use: respuesta final.
      respuestaTexto = (data.content || [])
        .filter(b => b && b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
      break;
    }

    if (!respuestaTexto) respuestaTexto = 'Listo.';

    return res.status(200).json({ respuesta: respuestaTexto, acciones, messages });
  } catch (e) {
    console.error('[asistente-chat] error:', e && e.message, e && e.detalle);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
