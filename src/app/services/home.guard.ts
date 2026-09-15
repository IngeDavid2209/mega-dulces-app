/**
 * 🚪 GUARD DE /home — nadie aterriza en una pantalla vacía
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ EXISTE, y es un problema que yo introduje
 * ═══════════════════════════════════════════════════════════════════════════
 * `/home` tenía un tablero con cuatro medidores, alertas, mapa y tendencia que
 * veía todo el mundo. Lo retiré al poner el Tablero de Dirección (commit
 * 1c9873c) y ese nuevo quedó gateado a alcance global. Resultado medido en la
 * plantilla: de `/home` solo sobreviven tres bloques —el encabezado sin gate,
 * las pestañas de `puedeFiltrarVista()` y el tablero de `esAdminGlobal()`—.
 *
 * Así que una colaboradora entraba, caía en `/home` y veía el título, el saludo
 * y NADA MÁS. Y no era solo ella: gerencias y Encargadas también.
 *
 * Esconder la entrada del menú no arregla eso, porque `/home` es el aterrizaje
 * por defecto: se llega sin tocar el menú. Hacía falta el guard.
 *
 * ─── LO QUE ESTE GUARD NO ARREGLA ──────────────────────────────────────────
 * Que gerencias y Encargadas se queden sin tablero propio es una PÉRDIDA REAL
 * de función que tenían esta mañana. Este guard solo evita que aterricen en el
 * vacío: en vez de una pantalla en blanco, van a su trabajo. El tablero por
 * nivel —«Mi zona» y «Mi sucursal» del documento 4— es Fase 6 y sigue
 * pendiente. Queda escrito aquí para que no se lea como resuelto.
 */

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { hayTableroPara } from '../shared/alcance.util';

export { hayTableroPara };

/** La sesión, de la MISMA clave que usa el resto de la app. */
function usuario(): any {
  try {
    const s = localStorage.getItem('md_sesion_actual');
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** A dónde va quien no tiene tablero: a su trabajo del día. */
const DESTINO_SIN_TABLERO = '/tareas';

export const homeGuard: CanActivateFn = () => {
  const router = inject(Router);
  const u = usuario();
  if (hayTableroPara(u)) return true;

  // UrlTree y no `navigate() + false`: cancela y redirige en UNA operación, sin
  // arrancar una segunda navegación mientras la primera se cancela.
  return router.parseUrl(DESTINO_SIN_TABLERO);
};
