// CRUD de usuarios. Create esta en /api/auth/register.
// Reglas Firestore:
//   - read auth, write admin.
// Politica adicional (replicando logica del front en personal.ts):
//   - Un admin limitado NO puede editar a otros admins (anti-escalada).
//   - Un admin limitado solo ve trabajadores de sus sucursales (filtro en list).
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { parseBody, parseQuery } from '../utils/errors.js';
import { permisos } from '../middleware/roles.js';
import { usuarioPublico } from '../utils/sanitize.js';
import { hashPassword } from '../utils/password.js';

const listSchema = z.object({
  rol: z.enum(['admin', 'trabajador']).optional(),
  q:   z.string().optional(),    // busqueda por nombre
});

const updateSchema = z.object({
  nombre:     z.string().min(2).optional(),
  correo:     z.string().email().toLowerCase().optional(),
  password:   z.string().min(6).optional(),    // reset de password por admin
  cargo:      z.string().optional(),
  rol:        z.enum(['admin', 'trabajador']).optional(),
  alcance:    z.enum(['global', 'sucursales']).optional(),
  sucursales: z.array(z.string()).optional(),
  areas:      z.array(z.string()).optional(),
  telefono:   z.string().optional(),
  puedeCrearChecklists:     z.boolean().optional(),
  puedeCrearRutinas:        z.boolean().optional(),
  puedeCrearTareasUnicas:   z.boolean().optional(),
  puedeVerCheckstore:       z.boolean().optional(),
  puedeVerEstadisticas:     z.boolean().optional(),
  puedeVerHistorial:        z.boolean().optional(),
  puedeAdministrarPersonal: z.boolean().optional(),
  puedeVerCalendario:       z.boolean().optional(),
  puedeAdministrarAreas:    z.boolean().optional(),
});

export async function list(req: Request, res: Response): Promise<void> {
  const q = parseQuery(req, res, listSchema);
  if (!q) return;

  const yo = req.user!;
  const visibilidad = construirFiltroVisibilidad(yo);

  const usuarios = await prisma.usuario.findMany({
    where: {
      ...visibilidad,
      ...(q.rol ? { rol: q.rol } : {}),
      ...(q.q ? { nombre: { contains: q.q, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ rol: 'asc' }, { nombre: 'asc' }],
  });
  res.json({ usuarios: usuarios.map(usuarioPublico) });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const u = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!u) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }
  res.json({ user: usuarioPublico(u) });
}

export async function update(req: Request, res: Response): Promise<void> {
  const target = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!target) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }

  // Anti-escalada: admin limitado NO puede editar a OTROS admins.
  if (permisos.esAdminLimitado(req.user) && target.rol === 'admin' && target.id !== req.user!.id) {
    res.status(403).json({ error: 'Como admin limitado no puedes editar a otros administradores' });
    return;
  }

  const data = parseBody(req, res, updateSchema);
  if (!data) return;

  // Si hay password, se hashea. Si no, se preserva el actual.
  const { password, ...resto } = data;
  const updateData: any = { ...resto };
  if (password) updateData.passwordHash = await hashPassword(password);

  // Conflicto de correo unico (solo si cambia)
  if (data.correo && data.correo !== target.correo) {
    const existe = await prisma.usuario.findUnique({ where: { correo: data.correo } });
    if (existe && existe.id !== target.id) {
      res.status(409).json({ error: 'Ya existe un usuario con ese correo' });
      return;
    }
  }

  const actualizado = await prisma.usuario.update({
    where: { id: req.params.id },
    data: updateData,
  });
  res.json({ user: usuarioPublico(actualizado) });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const target = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!target) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }

  // Anti-escalada: admin limitado no puede borrar admins.
  if (permisos.esAdminLimitado(req.user) && target.rol === 'admin') {
    res.status(403).json({ error: 'Como admin limitado no puedes borrar administradores' });
    return;
  }

  // No puedes auto-eliminarte
  if (target.id === req.user!.id) {
    res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    return;
  }

  await prisma.usuario.delete({ where: { id: req.params.id } });
  res.status(204).end();
}

// ----- helpers de visibilidad -----

/** Replica la logica de personal.ts: admin global ve todo, admin limitado solo
 *  ve trabajadores de sus sucursales (siempre se ve a si mismo). */
function construirFiltroVisibilidad(yo: NonNullable<Request['user']>) {
  if (permisos.esAdminGlobal(yo)) return {};
  if (permisos.esAdminLimitado(yo)) {
    const sucs = yo.sucursales ?? [];
    const general = sucs.includes('General (Acceso Total)');
    if (general) return {};
    if (sucs.length === 0) return { id: yo.id };    // solo a si mismo
    return {
      OR: [
        { id: yo.id },                              // siempre veo a mi mismo
        { rol: 'trabajador' as const, sucursales: { hasSome: sucs } },
        // tambien deja ver a otros admins con sucursal compartida (igual que en front)
        { rol: 'admin' as const, sucursales: { hasSome: sucs } },
      ],
    };
  }
  // Trabajador (no debe llegar aqui salvo que se le de el permiso): solo a si mismo
  return { id: yo.id };
}

export { construirFiltroVisibilidad };
