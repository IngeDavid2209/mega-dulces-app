/**
 * Compresor de imágenes para subida.
 *
 * Antes: las fotos del celular subían a Firebase/Cloudinary en su tamaño
 * original (4-6 MB en JPG). En 4G mala eso son 30+ segundos por foto.
 *
 * Ahora: en el cliente, antes de subir, dibujamos la imagen en un canvas
 * a máx 1280px de ancho y la exportamos como JPEG con 80% de calidad.
 * Resultado típico: 4 MB → ~300 KB (más de 90% menos datos = subida casi
 * inmediata sin pérdida visible de calidad).
 *
 * Si el archivo no es imagen (ej. PDF), se devuelve sin tocar.
 */

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.8;

/**
 * Comprime una imagen para subida. Si no es imagen, la devuelve tal cual.
 *
 * @param file Archivo seleccionado por el usuario.
 * @returns Promise que resuelve a un File listo para subir.
 */
export async function comprimirImagenSiAplica(file: File): Promise<File> {
  if (!file) return file;
  // Sólo comprimimos JPEG/PNG/WebP. Si es PDF u otro tipo, lo dejamos pasar.
  if (!file.type.startsWith('image/')) return file;
  // Si ya es pequeña no vale la pena gastar CPU en el celular.
  if (file.size < 300 * 1024) return file;

  try {
    const bitmap = await cargarComoBitmap(file);
    const { width, height } = dimensionesObjetivo(bitmap.width, bitmap.height, MAX_DIMENSION);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob: Blob | null = await new Promise(resolve =>
      canvas.toBlob(b => resolve(b), 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob) return file;

    // Si el "comprimido" salió más pesado que el original (raro pero pasa con
    // imágenes ya muy comprimidas), devolvemos el original.
    if (blob.size >= file.size) return file;

    const nuevoNombre = file.name.replace(/\.(png|webp|heic|heif)$/i, '.jpg');
    return new File([blob], nuevoNombre, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (e) {
    // Cualquier error de canvas: fallback al original para no bloquear la subida.
    console.warn('[comprimirImagen] fallback al original:', e);
    return file;
  }
}

/** Carga un File como ImageBitmap (rápido) o, si no hay soporte, como HTMLImageElement. */
async function cargarComoBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fallthrough a HTMLImageElement
    }
  }
  return await cargarComoImg(file);
}

function cargarComoImg(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

/**
 * Calcula el tamaño final manteniendo aspect ratio. Si la imagen ya es más chica
 * que max en ambas dimensiones, devuelve las originales (no la agrandamos).
 */
function dimensionesObjetivo(srcW: number, srcH: number, max: number): { width: number; height: number } {
  if (srcW <= max && srcH <= max) return { width: srcW, height: srcH };
  const ratio = Math.min(max / srcW, max / srcH);
  return { width: Math.round(srcW * ratio), height: Math.round(srcH * ratio) };
}
