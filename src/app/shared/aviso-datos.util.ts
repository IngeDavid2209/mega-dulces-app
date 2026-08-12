/**
 * Texto del aviso cuando una pantalla no pudo refrescar sus datos y está
 * mostrando los guardados.
 *
 * Existe porque el aviso decía "Sin conexión" pasara lo que pasara, y eso manda
 * a revisar el internet cuando el problema es otro. Si la respuesta LLEGÓ (con
 * error o no), entonces hay internet y decir lo contrario es mentira.
 *
 * Lo usan Home, Checklist y Ranking para que digan lo mismo.
 */
import { ErrorApi } from './api.service';

export interface AvisoDatos {
  titulo: string;
  detalle: string;
}

export function avisoDeFalla(error: any): AvisoDatos {
  const e = error as ErrorApi | undefined;

  // Sin ninguna respuesta del servidor: esto sí es falta de conexión.
  if (!e || e.sinRed !== false) {
    return {
      titulo: 'Sin conexión',
      detalle: 'Se actualizarán solos al volver el internet.'
    };
  }

  // Llegó respuesta, pero rechazó la sesión.
  if (e.status === 401 || e.status === 403) {
    return {
      titulo: 'Tu sesión venció',
      detalle: 'Hay internet, pero tu acceso ya no es válido. Vuelve a entrar para ver los datos al día.'
    };
  }

  // Llegó respuesta, pero el servidor tronó.
  return {
    titulo: 'No se pudieron actualizar',
    detalle: 'Hay internet, pero el servidor no respondió bien. Se sigue intentando solo.'
  };
}
