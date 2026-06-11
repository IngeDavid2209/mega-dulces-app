// Middleware de autorizacion por rol y permisos granulares.
//
// Replica las reglas de firestore.rules:
//   - esAdmin()              → requireAdmin
//   - autenticado()          → requireAuth (en middleware/auth.ts)
//
// Y la jerarquia interna del front (esAdminGlobal, esAdminLimitado, supervisor):
//   - admin global           → requireAdminGlobal
//   - admin (cualquier)      → requireAdmin
//   - permiso especifico     → requirePermiso('puedeCrearChecklists' | ...)
//   - acceso a sucursal      → requireSucursalAcceso(req.params.store)
//
// IMPORTANTE: requireAuth debe ejecutarse ANTES en la cadena para que req.user
// este cargado. Si no, estos middlewares devuelven 401.

import type { Request, Response, NextFunction } from 'express';

// --- Helpers internos (logica de permisos compartida) ---

function esAdmin(user: Request['user']): boolean {
  return user?.rol === 'admin';
}

function esAdminGlobal(user: Request['user']): boolean {
  if (!user || user.rol !== 'admin') return false;
  // Igual que en src/app/shared/permisos.util.ts: undefined === 'global' por compat.
  return (user.alcance ?? 'global') === 'global';
}

function esAdminLimitado(user: Request['user']): boolean {
  return !!user && user.rol === 'admin' && user.alcance === 'sucursales';
}

function tieneAccesoASucursal(user: Request['user'], store: string): boolean {
  if (!user) return false;
  if (esAdminGlobal(user)) return true;
  const lista = user.sucursales ?? [];
  if (lista.includes('General (Acceso Total)')) return true;
  return lista.includes(store);
}

// --- Middlewares ---

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }
  if (!esAdmin(req.user)) {
    res.status(403).json({ error: 'Requiere rol admin' });
    return;
  }
  next();
}

export function requireAdminGlobal(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }
  if (!esAdminGlobal(req.user)) {
    res.status(403).json({ error: 'Requiere admin global (sin restriccion de sucursal)' });
    return;
  }
  next();
}

// Flags de permisos que existen en el modelo Usuario.
type PermisoFlag =
  | 'puedeCrearChecklists'
  | 'puedeCrearRutinas'
  | 'puedeCrearTareasUnicas'
  | 'puedeVerCheckstore'
  | 'puedeVerEstadisticas'
  | 'puedeVerHistorial'
  | 'puedeAdministrarPersonal'
  | 'puedeVerCalendario'
  | 'puedeAdministrarAreas';

/**
 * Permite a admins (sin importar alcance) O a trabajadores que tengan el flag activo.
 * Replica el patron del front: `currentUser.rol === 'admin' || currentUser[flag]`.
 */
export function requirePermiso(flag: PermisoFlag) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado' });
      return;
    }
    if (esAdmin(req.user) || (req.user[flag] as boolean)) {
      next();
      return;
    }
    res.status(403).json({ error: `Requiere permiso: ${flag}` });
  };
}

/**
 * Verifica que el usuario tenga acceso a la sucursal indicada en el path
 * (ej. /api/checklists/store/:store). Admin global pasa siempre.
 */
export function requireSucursalAcceso(paramName: string = 'store') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado' });
      return;
    }
    const store = req.params[paramName];
    if (!store) {
      res.status(400).json({ error: `Falta parametro ${paramName}` });
      return;
    }
    if (tieneAccesoASucursal(req.user, store)) {
      next();
      return;
    }
    res.status(403).json({ error: `Sin acceso a la sucursal ${store}` });
  };
}

// Exporto los helpers para usar dentro de controladores cuando se necesite
// logica condicional (ej. filtrar query por sucursales permitidas).
export const permisos = {
  esAdmin,
  esAdminGlobal,
  esAdminLimitado,
  tieneAccesoASucursal,
};
