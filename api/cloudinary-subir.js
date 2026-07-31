// ============================================================================
//  Subida de archivos a Cloudinary DESDE EL SERVIDOR (firmada).
//
//  El front sube directo con un upload_preset sin firmar ('fotos_mega'), pero el
//  bot de WhatsApp recibe la foto en el backend (la baja de la Cloud API de Meta)
//  y la tiene que subir desde aqui. Se usa el SDK con api_key/api_secret, que ya
//  estan configurados en Railway para api/cloudinary-cleanup.js.
//
//  Variables de entorno (servicio MDTask):
//    CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
//    o bien CLOUDINARY_URL (cloudinary://<key>:<secret>@<cloud>), que es lo unico
//    que el panel de Cloudinary deja copiar hoy.
//
//  No es una ruta: es un modulo de utilidades.
// ============================================================================
const cloudinary = require('cloudinary').v2;

let configurado = false;

/** Configura el SDK (una sola vez). Devuelve false si faltan credenciales. */
function configurar() {
  if (configurado) return true;

  let cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  let apiKey = process.env.CLOUDINARY_API_KEY;
  let apiSecret = process.env.CLOUDINARY_API_SECRET;

  // Mismo fallback que cloudinary-cleanup.js: aceptar CLOUDINARY_URL completa.
  if ((!cloudName || !apiKey || !apiSecret) && process.env.CLOUDINARY_URL) {
    const m = String(process.env.CLOUDINARY_URL).trim().match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
    if (m) {
      apiKey = apiKey || m[1];
      apiSecret = apiSecret || m[2];
      cloudName = cloudName || m[3];
    } else {
      console.error('[cloudinary-subir] CLOUDINARY_URL con formato invalido');
    }
  }

  if (!cloudName || !apiKey || !apiSecret) {
    console.error('[cloudinary-subir] faltan credenciales de Cloudinary; no se puede subir.');
    return false;
  }

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  configurado = true;
  return true;
}

/**
 * Sube un Buffer y devuelve { url, publicId } o null si falla.
 * `carpeta` agrupa las fotos del bot para poder limpiarlas igual que las demas.
 */
async function subirBuffer(buffer, { carpeta = 'whatsapp', nombre = '' } = {}) {
  if (!configurar()) return null;
  if (!buffer || !buffer.length) return null;
  return new Promise((resolve) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: carpeta,
        resource_type: 'auto',          // imagen, video o raw segun el archivo
        public_id: nombre || undefined,
        overwrite: false,
      },
      (err, res) => {
        if (err || !res) {
          console.error('[cloudinary-subir] fallo la subida:', err && err.message);
          return resolve(null);
        }
        resolve({ url: res.secure_url, publicId: res.public_id });
      }
    );
    stream.end(buffer);
  });
}

module.exports = { subirBuffer };
