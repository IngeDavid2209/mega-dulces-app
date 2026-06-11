// =============================================================================
// Variables de entorno del frontend
// =============================================================================
// Estas variables las consume el cliente Angular. La estrategia es runtime
// (no usa fileReplacements de angular.json) porque mantiene un solo source of
// truth y permite que el flag `useBackend` se cambie sin redeployar — para
// pruebas A/B durante la migracion a backend propio.
//
// Las decisiones se documentan inline para que cualquiera que toque este
// archivo entienda por que valen lo que valen.

import { isDevMode } from '@angular/core';

/** URL base del backend Node + Express + Postgres. */
function detectarApiUrl(): string {
  // Override por hostname → permite que un mismo build sirva a varios dominios
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3000/api';
  }
  // En produccion el backend vive bajo el mismo dominio (o subdominio configurado).
  // Cambiar este valor cuando se decida el host de produccion del backend.
  return 'https://mega-dulces-backend.vercel.app/api';
}

export const environment = {
  production: !isDevMode(),
  apiUrl: detectarApiUrl(),

  /**
   * Feature flag de cutover. Cuando es FALSE, el frontend sigue trabajando
   * contra Firestore + Firebase Auth (estado actual). Cuando es TRUE, los
   * servicios HTTP del backend toman control.
   *
   * Mientras hacemos la migracion archivo por archivo en sub-fases B...G,
   * este flag permite probar el backend sin romper produccion. Cutover de
   * sub-fase H = poner en TRUE.
   *
   * Override opcional por localStorage para hacer pruebas rapidas sin redeploy:
   *   localStorage.setItem('md_use_backend', 'true')   → forzar backend
   *   localStorage.setItem('md_use_backend', 'false')  → forzar Firestore (rollback)
   *
   * Estado actual: TRUE por default (cutover Fase 5-H completado). Para
   * volver a Firestore en cliente, ejecutar el segundo override y recargar.
   * Tambien hay que abrir las reglas de Firestore (ver firestore.rules) y
   * verificar que la coleccion `usuarios_tokens` siga existiendo si quieres
   * que FCM tradicional funcione.
   */
  useBackend: (() => {
    if (typeof window === 'undefined') return true;
    const override = window.localStorage?.getItem('md_use_backend');
    if (override === 'true')  return true;
    if (override === 'false') return false;
    return true;   // default tras cutover Fase 5-H
  })(),
};
