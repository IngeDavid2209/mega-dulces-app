// Endpoint serverless de Vercel para BORRAR fotos en Cloudinary.
//
// El front manda una lista de public_ids (max 100 por peticion) y este endpoint
// firma la peticion con el api_secret y los borra usando la Admin API.
//
// Variables de entorno requeridas (Vercel -> Settings -> Environment Variables):
//   CLOUDINARY_CLOUD_NAME = duherjgyg
//   CLOUDINARY_API_KEY    = (tu api key)
//   CLOUDINARY_API_SECRET = (tu api secret)
//
// Seguridad:
//   - El api_secret NUNCA va al front.
//   - El endpoint solo acepta POST y rechaza payloads malformados.
//   - Limite de 100 public_ids por peticion (limite duro de la Admin API).

const cloudinary = require('cloudinary').v2;

module.exports = async function handler(req, res) {
  // CORS (mismo dominio, pero por si acaso)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    // Produccion corre en Railway (no en Vercel): las variables se configuran
    // en el servicio MDTask. Decimos cual falta para no adivinar.
    const faltan = [
      !cloudName ? 'CLOUDINARY_CLOUD_NAME' : null,
      !apiKey ? 'CLOUDINARY_API_KEY' : null,
      !apiSecret ? 'CLOUDINARY_API_SECRET' : null,
    ].filter(Boolean);
    console.error('[cloudinary-cleanup] faltan variables de entorno:', faltan.join(', '));
    return res.status(500).json({
      error: 'No se puede borrar: falta configurar ' + faltan.join(', ') +
        ' en las variables de entorno del servidor. Las fotos NO se borraron.'
    });
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
  });

  let publicIds = req.body && req.body.publicIds;
  if (typeof req.body === 'string') {
    try { publicIds = JSON.parse(req.body).publicIds; } catch (e) { /* noop */ }
  }
  if (!Array.isArray(publicIds) || publicIds.length === 0) {
    return res.status(400).json({ error: 'publicIds debe ser un array no vacio.' });
  }
  if (publicIds.length > 100) {
    return res.status(400).json({ error: 'Maximo 100 public_ids por peticion (limite Cloudinary).' });
  }
  // Filtrar strings validos
  publicIds = publicIds.filter(p => typeof p === 'string' && p.length > 0);
  if (publicIds.length === 0) {
    return res.status(400).json({ error: 'No hay public_ids validos en el payload.' });
  }

  try {
    // delete_resources devuelve { deleted: { id: 'deleted'|'not_found' }, partial: bool, ... }
    const result = await cloudinary.api.delete_resources(publicIds, {
      type: 'upload',
      resource_type: 'image',
      invalidate: true
    });
    return res.status(200).json({
      ok: true,
      deleted: result.deleted || {},
      not_found: result.deleted_counts && result.deleted_counts.not_found || 0,
      partial: !!result.partial
    });
  } catch (e) {
    console.error('[cloudinary-cleanup]', e);
    return res.status(500).json({
      error: (e && e.message) || 'Error desconocido al borrar en Cloudinary.'
    });
  }
};
