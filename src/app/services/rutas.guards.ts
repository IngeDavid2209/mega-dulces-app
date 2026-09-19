/**
 * 🚦 LOS CINCO GUARDS QUE FALTABAN
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EL MENÚ NO ES UN PERMISO — la lección del 13/sep, barrida por fin
 * ═══════════════════════════════════════════════════════════════════════════
 * Ese día se cerró `/personal` porque «hasta hoy esta ruta solo pedía
 * `authGuard`, así que cualquiera con sesión entraba escribiendo la URL». Se
 * arregló esa ruta y se dio por cerrado el tema. El 19/sep se midió el resto de
 * la tabla de rutas y había **cinco más exactamente iguales**:
 *
 *     /reportes          Auditoría — y sin UNA sola comprobación en las 1 492
 *                        líneas del componente. Una anaquelista que en /tareas
 *                        solo ve lo suyo, aquí veía la auditoría de su tienda.
 *     /cierre-mensual    el PDF de la empresa (gateaba las ACCIONES, no entrar)
 *     /manual-puestos    la norma (gateaba EDITAR, no entrar)
 *     /descansos         se auto-gateaba… con una TERCERA copia de la regla
 *     /tareas-asignadas  huérfana, sin entrada de menú — que no es un permiso
 *
 * ─── LA CONDICIÓN NO SE ESCRIBE AQUÍ ──────────────────────────────────────
 * Se importa de `shared/audiencias.ts`, que es la misma que consulta el menú
 * para decidir si pinta la entrada. Escribirla otra vez en cada guard sería
 * volver a tener dos sitios donde se decide quién ve qué — y de ahí salen las
 * fugas. Es la misma regla que ya siguen `tabControlGuard` (importa de
 * `control.tabs`) y `usuariosGuard` (importa `veUsuarios`).
 *
 * ─── A DÓNDE VA QUIEN NO PASA ─────────────────────────────────────────────
 * A `/tareas`, su trabajo, con un `UrlTree` — no al login (tiene sesión válida,
 * mandarlo a autenticarse otra vez es mentirle sobre lo que pasó) y no a una
 * pantalla vacía. Mismo destino y misma forma que `estructuraGuard` y
 * `usuariosGuard`, que ya explican ahí por qué `UrlTree` y no `navigate()`.
 */

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import {
  veAuditoria, veCierreMensual, veManualPuestos, veDescansos, veTareasAsignadas,
} from '../shared/audiencias';

/** La sesión, de la MISMA clave que usa el resto de la app. */
function usuario(): any {
  try {
    const s = localStorage.getItem('md_sesion_actual');
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/**
 * Fabrica el guard a partir del predicado.
 *
 * Los cinco son la misma forma, así que se generan en vez de copiarse: cinco
 * copias de tres líneas es donde a la sexta se le olvida el `return` del caso
 * negativo y queda un guard que deja pasar a todo el mundo sin que nada falle.
 */
function guardDe(ve: (u: any) => boolean, cual: string): CanActivateFn {
  return () => {
    const router = inject(Router);
    if (ve(usuario())) return true;

    // ── UN REBOTE MUDO SE LEE COMO UN BUG ──────────────────────────────────
    //
    // Sin esta línea, alguien abre un enlace de WhatsApp a `/reportes`,
    // aterriza en sus tareas y no tiene forma de saber por qué. Lo va a
    // reportar como «la app me saca», y quien lo revise no va a encontrar
    // ningún error en ninguna parte — porque no lo hay.
    //
    // No se le pone un aviso en pantalla a propósito: esto pasa por seguir un
    // enlace que no le tocaba, no por un fallo suyo, y un cartel rojo en medio
    // del turno cuesta más de lo que explica. La consola basta para que el
    // reporte se pueda diagnosticar en treinta segundos.
    //
    // Y de paso es el marcador de despliegue de este paso: cerrar cinco rutas
    // es lógica pura y no introduce ninguna cadena propia, así que sin esto no
    // habría forma de comprobar que el cambio llegó a producción (la misma
    // situación que la Fase 2.1 el 13/sep).
    console.warn('[acceso] ruta-cerrada-para-tu-perfil: ' + cual + ' -> /tareas');
    return router.createUrlTree(['/tareas']);
  };
}

export const auditoriaGuard: CanActivateFn = guardDe(veAuditoria, '/reportes');
export const cierreMensualGuard: CanActivateFn = guardDe(veCierreMensual, '/cierre-mensual');
export const manualPuestosGuard: CanActivateFn = guardDe(veManualPuestos, '/manual-puestos');
export const descansosGuard: CanActivateFn = guardDe(veDescansos, '/descansos');
export const tareasAsignadasGuard: CanActivateFn = guardDe(veTareasAsignadas, '/tareas-asignadas');
