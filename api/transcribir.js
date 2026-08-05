// ============================================================================
//  TRANSCRIPCION de notas de voz de WhatsApp (voz -> texto).
//
//  La API de Claude NO acepta audio (solo texto, imagenes y PDFs), asi que las
//  notas de voz se transcriben aparte y el texto entra al asistente como si la
//  persona lo hubiera escrito. Con eso TODO el bot funciona por voz sin cambiar
//  ninguna herramienta.
//
//  Se usa Groq (whisper-large-v3-turbo): el mas rapido y barato, y su API es
//  compatible con la de OpenAI, asi que cambiar de proveedor es cambiar la URL y
//  el modelo. El audio de WhatsApp llega en OGG/Opus y se manda TAL CUAL (no hay
//  ffmpeg en el contenedor y no hace falta convertirlo).
//
//  Variables de entorno (servicio MDTask):
//    GROQ_API_KEY          llave de groq.com. SIN ella no se transcribe: el bot
//                          avisa con amabilidad y pide que le escriban (no truena).
//    GROQ_MODELO_AUDIO     default 'whisper-large-v3-turbo'
//    TRANSCRIPCION_URL     default el endpoint de Groq (para cambiar proveedor)
//    TRANSCRIPCION_IDIOMA  default 'es'
// ============================================================================
const { query, dbConfigurada } = require('./db');

const URL = process.env.TRANSCRIPCION_URL || 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODELO = process.env.GROQ_MODELO_AUDIO || 'whisper-large-v3-turbo';
const IDIOMA = process.env.TRANSCRIPCION_IDIOMA || 'es';
const LIMITE_BYTES = 20 * 1024 * 1024;   // una nota de voz queda muy por debajo

/** ¿Se puede transcribir? (sin llave configurada, no). */
function transcripcionDisponible() {
  return !!process.env.GROQ_API_KEY;
}

// --- PISTA de contexto --------------------------------------------------------
// Whisper acepta un texto con las palabras que espera oir. Darle los nombres
// REALES de las sucursales y el vocabulario del trabajo evita que escriba
// "Padre Idalgo" o "Canindó", que rompe el emparejamiento por nombre. Se cachea
// porque cambia poquisimo.
const VOCABULARIO = [
  'checklist', 'sucursal', 'tarea', 'pendiente', 'evidencia', 'entregar', 'terminé',
  'barrer', 'trapear', 'vitrina', 'mostrador', 'bodega', 'carretas', 'kileado',
  'caducidades', 'inventario', 'apertura', 'cierre', 'rack', 'mercancía', 'camión',
  'Jetta', 'Ram 700', 'Toyota', 'vehículo', 'salida', 'regreso',
].join(', ');
let pistaCache = { texto: '', en: 0 };
const PISTA_TTL = 30 * 60 * 1000;

async function pistaTranscripcion() {
  if (pistaCache.texto && Date.now() - pistaCache.en < PISTA_TTL) return pistaCache.texto;
  let sucursales = [];
  try {
    if (dbConfigurada()) {
      const r = await query(
        `select distinct store from mdtask_checklists
          where coalesce(store,'') <> ''
            and fecha >= to_char(now() - interval '30 days','YYYY-MM-DD')
          limit 30`);
      sucursales = r.rows.map(x => x.store).filter(Boolean);
    }
  } catch (e) { /* sin sucursales la pista igual sirve */ }
  const texto = `Mensaje de trabajo de una dulcería en México. Sucursales: ${sucursales.join(', ')}. Palabras frecuentes: ${VOCABULARIO}.`;
  pistaCache = { texto: texto.slice(0, 900), en: Date.now() };   // Whisper corta ~224 tokens
  return pistaCache.texto;
}

/**
 * Transcribe un audio. Devuelve { ok, texto } o { ok:false, motivo }.
 * `motivo`: 'sin_llave' | 'vacio' | 'muy_grande' | 'fallo'. Nunca lanza.
 */
async function transcribir(buffer, { mime = 'audio/ogg', nombre = 'nota.ogg' } = {}) {
  if (!transcripcionDisponible()) return { ok: false, motivo: 'sin_llave' };
  if (!buffer || !buffer.length) return { ok: false, motivo: 'vacio' };
  if (buffer.length > LIMITE_BYTES) return { ok: false, motivo: 'muy_grande' };

  try {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), nombre);
    form.append('model', MODELO);
    form.append('language', IDIOMA);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    form.append('prompt', await pistaTranscripcion());

    const r = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`[transcribir] fallo (HTTP ${r.status}):`, JSON.stringify(d).slice(0, 300));
      return { ok: false, motivo: 'fallo' };
    }
    const texto = String(d.text || '').trim();
    if (!texto) return { ok: false, motivo: 'vacio' };
    console.log(`[transcribir] ${buffer.length} bytes -> "${texto.slice(0, 80)}"`);
    return { ok: true, texto };
  } catch (err) {
    console.error('[transcribir] error:', err.message);
    return { ok: false, motivo: 'fallo' };
  }
}

module.exports = { transcribir, transcripcionDisponible, pistaTranscripcion };
