import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

/** Un archivo ya subido, tal como se guarda en la base. */
export interface ArchivoSubido {
  url: string;
  nombre: string;
  tipo: string;
  pesoKB: number;
  subidoEn: number;
}

/**
 * SUBIDA DE ARCHIVOS (fotos de evidencia, tickets, documentos).
 *
 * Tres cosas, en este orden:
 *
 *   1. Si es una FOTO, se reduce antes de subirla. Las camaras de los celulares
 *      sacan fotos de 2 a 5 MB y para leer un ticket o ver un exhibidor sobra
 *      con 1600 px: baja a unos cientos de KB, sube mucho mas rapido con la
 *      senal de las sucursales y le cuesta menos a la lectura con IA.
 *
 *   2. Se intenta subir DIRECTO a Cloudinary, dos veces.
 *
 *   3. Si eso falla, se sube POR EL SERVIDOR (/api/subir-archivo).
 *
 * El punto 3 existe por un caso real: en el iPhone de David la subida directa
 * desde la PWA contestaba "Upload preset must be specified when using unsigned
 * upload" aunque el preset SI iba en la peticion (verificado en el bundle en
 * vivo, con el campo puesto de primero). Algo entre la pagina y Cloudinary se
 * quedaba con los campos del formulario. En vez de seguir adivinando que es, la
 * subida ahora tiene una segunda puerta que no depende del navegador.
 */
@Injectable({ providedIn: 'root' })
export class CloudinaryService {
  private api = inject(ApiService);

  /** Tope real de Cloudinary en subida sin firma. No es un limite inventado. */
  readonly MAX_ARCHIVO_MB = 10;

  private readonly CUENTA = 'duherjgyg';
  private readonly PRESET = 'fotos_mega';

  /** Lado mayor al que se reducen las fotos. Suficiente para leer un ticket. */
  private readonly LADO_MAX = 1600;

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
    if (!archivo.size) {
      throw new Error('El archivo llegó vacío. Vuelve a tomar la foto o a elegirlo.');
    }

    const listo = await this.reducirSiEsFoto(archivo);
    const url = `https://api.cloudinary.com/v1_1/${this.CUENTA}/auto/upload`;
    let ultimoError = '';

    // --- Camino normal: directo a Cloudinary ---
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const fd = new FormData();
        // El preset primero: si la subida se corta a medias, Cloudinary ya lo leyo.
        fd.append('upload_preset', this.PRESET);
        fd.append('file', listo.blob, listo.nombre);

        const resp = await fetch(url, { method: 'POST', body: fd });
        const data = await resp.json().catch(() => null);
        if (data?.secure_url) return this.armar(data.secure_url, listo);

        ultimoError = data?.error?.message || ('HTTP ' + resp.status);
      } catch (e: any) {
        ultimoError = e?.message || 'Se cortó la conexión al subir';
      }
      if (intento < 2) await new Promise(r => setTimeout(r, 700));
    }

    // --- Respaldo: que lo suba el servidor ---
    try {
      const base64 = await this.aBase64(listo.blob);
      const r = await this.api.post('/api/subir-archivo', {
        nombre: listo.nombre, tipo: listo.tipo, base64,
      });
      if (r?.url) return this.armar(r.url, listo);
      ultimoError = r?.error || ultimoError;
    } catch (e: any) {
      // Se guarda el motivo del respaldo, que suele ser mas claro que el directo.
      ultimoError = e?.message || ultimoError;
    }

    throw new Error(ultimoError + ' (' + Math.round(listo.blob.size / 1024) + ' KB). '
      + 'Revisa la señal e inténtalo otra vez.');
  }

  private armar(url: string, listo: { blob: Blob; nombre: string; tipo: string }): ArchivoSubido {
    return {
      url,
      nombre: listo.nombre,
      tipo: listo.tipo,
      pesoKB: Math.round(listo.blob.size / 1024),
      subidoEn: Date.now(),
    };
  }

  /**
   * Reduce la foto a LADO_MAX y la vuelve JPEG. Si por lo que sea no se puede
   * (un formato que el navegador no dibuja, poca memoria), se sube el archivo
   * original: mas vale una foto pesada que ninguna.
   */
  private async reducirSiEsFoto(archivo: File): Promise<{ blob: Blob; nombre: string; tipo: string }> {
    const original = { blob: archivo as Blob, nombre: archivo.name, tipo: archivo.type || '' };
    if (!this.esImagen({ tipo: archivo.type, nombre: archivo.name })) return original;

    try {
      const img = await this.cargarImagen(archivo);
      const lado = Math.max(img.width, img.height);
      if (!lado) return original;

      // Ya es chica: no se vuelve a comprimir (perderia calidad sin ganar nada).
      if (lado <= this.LADO_MAX && archivo.size <= 900 * 1024) return original;

      const escala = Math.min(1, this.LADO_MAX / lado);
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(img.width * escala);
      lienzo.height = Math.round(img.height * escala);
      const ctx = lienzo.getContext('2d');
      if (!ctx) return original;
      ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);

      const blob = await new Promise<Blob | null>(listo =>
        lienzo.toBlob(b => listo(b), 'image/jpeg', 0.82));
      if (!blob || !blob.size || blob.size >= archivo.size) return original;

      const nombre = archivo.name.replace(/\.[^.]+$/, '') + '.jpg';
      return { blob, nombre, tipo: 'image/jpeg' };
    } catch {
      return original;
    }
  }

  private cargarImagen(archivo: File): Promise<HTMLImageElement> {
    return new Promise((listo, falla) => {
      const url = URL.createObjectURL(archivo);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); listo(img); };
      img.onerror = () => { URL.revokeObjectURL(url); falla(new Error('no se pudo leer la imagen')); };
      img.src = url;
    });
  }

  /** El archivo como base64 sin el prefijo data:, para mandarlo en JSON. */
  private aBase64(blob: Blob): Promise<string> {
    return new Promise((listo, falla) => {
      const lector = new FileReader();
      lector.onload = () => {
        const s = String(lector.result || '');
        listo(s.includes(',') ? s.split(',')[1] : s);
      };
      lector.onerror = () => falla(new Error('no se pudo leer el archivo'));
      lector.readAsDataURL(blob);
    });
  }

  /** ¿Se puede mostrar como imagen? (para decidir miniatura o icono) */
  esImagen(a: { tipo?: string; nombre?: string }): boolean {
    if ((a.tipo || '').startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|avif|heic|heif)$/i.test(a.nombre || '');
  }
}
