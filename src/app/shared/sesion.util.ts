// ============================================================================
//  Cierre de sesión SEGURO (compartido).
//
//  Problema que resuelve: había tres botones de "Cerrar sesión" que solo
//  borraban `md_sesion_actual` de localStorage pero NO cerraban la sesión de
//  Firebase Auth. En dispositivos compartidos (tablets de sucursal) eso dejaba
//  a Firebase logueado como el usuario ANTERIOR: como api.service.ts firma cada
//  llamada con `getAuth().currentUser`, el siguiente usuario podía terminar
//  operando —o viendo— la cuenta de otra persona.
//
//  Regla: SIEMPRE cerrar ambas identidades a la vez. Best-effort en Firebase
//  (si falla la red igual limpiamos lo local y mandamos al login).
// ============================================================================
import { getAuth, signOut } from '@angular/fire/auth';

/** Cierra la sesión de Firebase y borra la sesión local. No navega. */
export async function cerrarSesionSegura(): Promise<void> {
  try {
    await signOut(getAuth());
  } catch (_) {
    // Sin red / sesión ya cerrada: no bloquea el cierre local.
  }
  try {
    localStorage.removeItem('md_sesion_actual');
  } catch (_) { /* noop */ }
}
