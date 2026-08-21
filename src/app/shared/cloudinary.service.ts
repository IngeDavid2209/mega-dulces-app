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

  /** Sube uno y devuelve el archivo ya guardado. Lanza error con el motivo. */
  async subir(archivo: File): Promise<ArchivoSubido> {
    const problema = this.revisarPeso(archivo);
    if (problema) throw new Error(problema);

    const fd = new FormData();
    fd.append('file', archivo);
    fd.append('upload_preset', this.PRESET);

    const resp = await fetch(`https://api.cloudinary.com/v1_1/${this.CUENTA}/auto/upload`,
      { method: 'POST', body: fd });
    const data = await resp.json().catch(() => null);
    if (!data?.secure_url) {
      throw new Error(data?.error?.message || 'Cloudinary no devolvió el archivo');
    }

    return {
      url: data.secure_url,
      nombre: archivo.name,
      tipo: archivo.type || '',
      pesoKB: Math.round(archivo.size / 1024),
      subidoEn: Date.now(),
    };
  }

  /** ¿Se puede mostrar como imagen? (para decidir miniatura o icono) */
  esImagen(a: { tipo?: string; nombre?: string }): boolean {
    if ((a.tipo || '').startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|avif|heic)$/i.test(a.nombre || '');
  }
}
