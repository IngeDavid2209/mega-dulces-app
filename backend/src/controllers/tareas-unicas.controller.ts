// Tareas unicas: sub-recurso de Usuario. En Firestore era subcollection
// usuarios/{uid}/tareas_unicas. Aqui es tabla con FK a Usuario.
//
// Visibilidad: el dueno de la tarea siempre puede listar/crear/editar las suyas.
// Un admin puede listar/crear tareas para otro usuario.
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { parseBody } from '../utils/errors.js';
import { permisos } from '../middleware/roles.js';

const baseSchema = z.object({
  texto:         z.string().min(1).trim(),
  completada:    z.boolean().default(false),
  instrucciones: z.string().optional(),
  subtareas:     z.array(z.any()).default([]),
});

const updateSchema = baseSchema.partial();

/** True si el currentUser puede operar sobre tareas del usuarioId indicado. */
function puedeOperar(req: Request, usuarioId: string): boolean {
  if (!req.user) return false;
  if (req.user.id === usuarioId) return true;
  return permisos.esAdmin(req.user);
}

export async function list(req: Request, res: Response): Promise<void> {
  const usuarioId = req.params.usuarioId;
  if (!puedeOperar(req, usuarioId)) {
    res.status(403).json({ error: 'No puedes ver las tareas unicas de otro usuario' });
    return;
  }
  const tareas = await prisma.tareaUnica.findMany({
    where: { usuarioId },
    orderBy: { fechaCreacion: 'desc' },
  });
  res.json({ tareas });
}

export async function create(req: Request, res: Response): Promise<void> {
  const usuarioId = req.params.usuarioId;
  if (!puedeOperar(req, usuarioId)) {
    res.status(403).json({ error: 'No puedes crear tareas para otro usuario' });
    return;
  }
  const data = parseBody(req, res, baseSchema);
  if (!data) return;

  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }

  const creada = await prisma.tareaUnica.create({
    data: {
      ...data,
      usuarioId,
      fechaCreacion: BigInt(Date.now()),
    },
  });
  res.status(201).json({ tarea: creada });
}

export async function update(req: Request, res: Response): Promise<void> {
  const usuarioId = req.params.usuarioId;
  if (!puedeOperar(req, usuarioId)) {
    res.status(403).json({ error: 'No puedes editar tareas de otro usuario' });
    return;
  }
  const data = parseBody(req, res, updateSchema);
  if (!data) return;
  try {
    const actualizada = await prisma.tareaUnica.update({
      where: { id: req.params.id, /* sanity: usuarioId */ },
      data,
    });
    if (actualizada.usuarioId !== usuarioId) {
      res.status(404).json({ error: 'Tarea no encontrada para este usuario' });
      return;
    }
    res.json({ tarea: actualizada });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Tarea no encontrada' }); return; }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  const usuarioId = req.params.usuarioId;
  if (!puedeOperar(req, usuarioId)) {
    res.status(403).json({ error: 'No puedes borrar tareas de otro usuario' });
    return;
  }
  try {
    await prisma.tareaUnica.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Tarea no encontrada' }); return; }
    throw err;
  }
}
