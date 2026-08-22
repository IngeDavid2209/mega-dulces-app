// ============================================================================
//  SUBIR UN ARCHIVO A CLOUDINARY, PERO DESDE EL SERVIDOR.
//
//    POST /api/subir-archivo   { nombre, tipo, base64 }  ->  { url, ... }
//
//  Es el CAMINO DE RESPALDO de la subida. Lo normal es que el celular suba
//  directo a Cloudinary (mas rapido y no gasta ancho de banda del servidor);
//  esto entra cuando esa subida directa falla.
//
//  Por que existe: en el iPhone de David, la subida directa desde la PWA fallaba
//  con "Upload preset must be specified when using unsigned upload" aunque el
//  preset SI iba en la peticion (se verifico en el bundle en vivo). Algo entre la
//  pagina y Cloudinary se estaba quedando con los campos del formulario. Desde
//  aqui la peticion la arma Node, sin service worker ni navegador en medio, asi
//  que ese camino no puede volver a romperse igual.
//
//  El archivo llega en base64 dentro de un JSON. Es ~33% mas grande que el
//  binario, y por eso esta ruta se monta con su propio limite de tamano en
//  server.js (el global de la app son 2 MB).
// ============================================================================
const { verificarToken } = require('./_auth');

const CUENTA = process.env.CLOUDINARY_CUENTA || 'duherjgyg';
const PRESET = process.env.CLOUDINARY_PRESET || 'fotos_mega';

/** Tope de lo que se acepta por archivo, ya en base64. */
const MAX_BASE64_MB = 14;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

  try { await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const b = req.body || {};
  const nombre = String(b.nombre || 'archivo').slice(0, 200);
  const tipo = String(b.tipo || '').slice(0, 100);
  let base64 = String(b.base64 || '');

  if (!base64) return res.status(400).json({ error: 'No llegó el archivo.' });

  // Se acepta con o sin el prefijo "data:...;base64,".
  const yaEsDataUri = /^data:[^;]+;base64,/i.test(base64);
  const soloDatos = yaEsDataUri ? base64.split(',')[1] || '' : base64;
  if (soloDatos.length / 1024 / 1024 > MAX_BASE64_MB) {
    return res.status(413).json({
      error: 'El archivo es demasiado grande para subirlo por esta vía.',
    });
  }

  // Cloudinary acepta el archivo como data URI en el campo `file`.
  const dataUri = yaEsDataUri
    ? base64
    : 'data:' + (tipo || 'application/octet-stream') + ';base64,' + soloDatos;

  try {
    // Los campos van como formulario urlencoded: el preset PRIMERO, igual que en
    // el navegador, y sin multipart que se pueda quedar a medias.
    const cuerpo = new URLSearchParams();
    cuerpo.append('upload_preset', PRESET);
    cuerpo.append('file', dataUri);

    const r = await fetch(`https://api.cloudinary.com/v1_1/${CUENTA}/auto/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: cuerpo,
    });

    const data = await r.json().catch(() => null);
    if (!data || !data.secure_url) {
      const motivo = (data && data.error && data.error.message) || ('HTTP ' + r.status);
      console.error('[subir-archivo] Cloudinary:', motivo);
      return res.status(502).json({ error: 'Cloudinary no aceptó el archivo: ' + motivo });
    }

    return res.json({
      url: data.secure_url,
      nombre,
      tipo,
      pesoKB: Math.round((soloDatos.length * 3 / 4) / 1024),
      subidoEn: Date.now(),
      via: 'servidor',
    });
  } catch (e) {
    console.error('[subir-archivo]', e && e.message);
    return res.status(500).json({ error: 'No se pudo subir: ' + (e && e.message) });
  }
};
