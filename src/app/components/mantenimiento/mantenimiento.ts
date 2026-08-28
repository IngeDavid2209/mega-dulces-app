/**
 * 🚧 PANTALLA DE MANTENIMIENTO
 *
 * Lo que ve todo el que no está en la lista de exentos mientras el interruptor
 * de `mantenimiento.util.ts` está prendido.
 *
 * Dos decisiones de fondo:
 *
 *  1. Dice que su trabajo está a salvo. La gente que usa esto son cajeras y
 *     anaquelistas en media jornada; una pantalla que solo diga "no disponible"
 *     se lee como que se perdió lo que ya habían subido.
 *
 *  2. Muestra con qué identidad la ve la app. Es el diagnóstico de un solo
 *     paso: si el desarrollador se queda fuera por un correo distinto al de la
 *     lista, lo lee en pantalla y sabe exactamente qué agregar, en vez de
 *     desplegar a ciegas.
 */

import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import { cerrarSesionSegura } from '../../shared/sesion.util';
import {
  MANTENIMIENTO_TITULO, MANTENIMIENTO_MENSAJE, identidadVisible,
} from '../../shared/mantenimiento.util';
import { APP_BUILD_SELLO } from '../../shared/version';

@Component({
  selector: 'app-mantenimiento',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mantenimiento.html',
  styleUrls: ['./mantenimiento.css'],
})
export class MantenimientoComponent {
  private router = inject(Router);

  readonly titulo = MANTENIMIENTO_TITULO;
  readonly mensaje = MANTENIMIENTO_MENSAJE;
  readonly sello = APP_BUILD_SELLO;

  /** Con qué identidad ve la app a quien está enfrente. */
  get identidad(): string {
    let sesion: any = null;
    try { sesion = JSON.parse(localStorage.getItem('md_sesion_actual') || 'null'); }
    catch { sesion = null; }
    return identidadVisible(sesion);
  }

  /** ¿Hay alguien con sesión abierta? (decide si se ofrece cerrarla). */
  get haySesion(): boolean {
    try { return !!localStorage.getItem('md_sesion_actual'); }
    catch { return false; }
  }

  /**
   * Recarga limpia. Sirve cuando el mantenimiento ya se levantó: el navegador
   * puede tener la versión anterior en caché y un botón es más claro que
   * pedirle a la gente que "actualice la página".
   */
  reintentar() {
    window.location.reload();
  }

  /**
   * Cerrar sesión y volver al login. Es la salida para la cuenta exenta cuando
   * el dispositivo quedó con la sesión de otra persona.
   */
  async cambiarDeCuenta() {
    await cerrarSesionSegura();
    await this.router.navigate(['/login']);
    // La app decide qué pintar por ruta y sesión; tras el cambio ya no aplica
    // el aviso en /login, así que basta con navegar.
  }
}
