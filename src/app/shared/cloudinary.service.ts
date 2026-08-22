import { Injectable } from '@angular/core';

/** Un archivo ya subido, tal como se guarda en la base. */
export interface ArchivoSubido {
  url: string;
  nombre: string;
  tipo: string;
  pesoKB: number;
  subidoEn: number;
}

/**
 * SUBIDA DE ARCHIVOS A CLOUDINARY.
 *
 * Estaba escrita dentro del componente de promociones; se saco aqui porque el
 * seguimiento de promociones sube evidencia desde otras tres pantallas y el
 * nombre de la cuenta y el preset no pueden andar copiados en cada una.
 *
 * `auto/upload` acepta cualquier formato (pdf, excel, xml, foto), no solo
 * imagenes, que es lo que hace falta para los tickets y formatos de salida.
 */
@Injectable({ providedIn: 'root' })
export class CloudinaryService {
  /** Tope real de Cloudinary en subida sin firma. No es un limite inventado. */
  readonly MAX_ARCHIVO_MB = 10;

  private readonly CUENTA = 'duherjgyg';
  private readonly PRESET = 'fotos_mega';

  /** ¿Pesa mas de lo que Cloudinary acepta? Devuelve el mensaje, o null si va bien. */
  revisarPeso(archivo: File): string | null {
    const mb = archivo.size / 1024 / 1024;
    if (mb <= this.MAX_ARCHIVO_MB) return null;
    return `"${archivo.name}" pesa ${mb.toFixed(1)} MB. El tope por archivo son `
      + `${this.MAX_ARCHIVO_MB} MB. Puedes subir todos los que quieras, pero de `
      + 'uno en uno tienen ese límite.';
  }

  /**
   * Sube uno y devuelve el archivo ya guardado. Lanza error con el motivo.
   *
   * DOS COSAS QUE PARECEN DETALLE Y NO LO SON:
   *
   * 1) El `upload_preset` va ANTES del archivo. Cloudinary lee el multipart en
   *    orden: si la subida se corta a media transferencia (pasa con la señal de
   *    las sucursales), recibe el archivo incompleto y nunca llega al campo del
   *    final, y contesta "Upload preset must be specified when using unsigned
   *    upload" — que suena a que falta el preset, cuando en realidad lo que se
   *    corto fue la conexion. Con el preset primero, siempre llega.
   *
   * 2) Se reintenta una vez. Una foto tomada en el pasillo de una sucursal falla
   *    seguido en el primer intento y entra en el segundo.
   */
  async subir(archivo: File): Promise<ArchivoSubido> {
    const problema = this.revisarPeso(archivo);
    if (problema) throw new Error(problema);
    if (!archivo.size) {
      throw new Error('El archivo llegó vacío. Vuelve a tomar la foto o a elegirlo.');
    }

    const url = `https://api.cloudinary.com/v1_1/${this.CUENTA}/auto/upload`;
    let ultimoError = '';

    for (let intento = 1; intento <= 2; intento++) {
      try {
        const fd = new FormData();
        fd.append('upload_preset', this.PRESET);   // primero, ver el punto 1
        fd.append('file', archivo);

        const resp = await fetch(url, { method: 'POST', body: fd });
        const data = await resp.json().catch(() => null);
        if (data?.secure_url) {
          return {
            url: data.secure_url,
            nombre: archivo.name,
            tipo: archivo.type || '',
            pesoKB: Math.round(archivo.size / 1024),
            subidoEn: Date.now(),
          };
        }
        ultimoError = data?.error?.message
          ? 'Cloudinary: ' + data.error.message
          : 'Cloudinary respondió sin archivo (HTTP ' + resp.status + ')';
      } catch (e: any) {
        ultimoError = e?.message || 'Se cortó la conexión al subir';
      }
      if (intento < 2) await new Promise(r => setTimeout(r, 800));
    }

    // El peso va en el mensaje: casi siempre la pista es que la foto es enorme
    // y la señal mala.
    throw new Error(ultimoError + ' (' + Math.round(archivo.size / 1024) + ' KB). '
      + 'Revisa la señal e inténtalo otra vez.');
  }

  /** ¿Se puede mostrar como imagen? (para decidir miniatura o icono) */
  esImagen(a: { tipo?: string; nombre?: string }): boolean {
    if ((a.tipo || '').startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|avif|heic)$/i.test(a.nombre || '');
  }
}
