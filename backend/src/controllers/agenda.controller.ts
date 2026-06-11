// Agenda: sub-recurso de Usuario (subcollection en Firestore).
// Visibilidad similar a tareas-unicas: dueno o admin.
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { parseBody } from '../utils/errors.js';
import { permisos } from '../middleware/roles.js';

const baseSchema = z.object({
  texto:         z.string().min(1).trim(),
  completada:    z.boolean().default(false),
  instrucciones: z.string().optional(),
  comentarios:   z.string().optional(),
  adjunto:       z.string().optional(),
});
const updateSchema = baseSchema.partial();

function puedeOperar(req: Request, usuarioId: string): boolean {
  if (!req.user) return false;
  if (req.user.id === usuarioId) return true;
  return permisos.esAdmin(req.user);
}

export async function list(req: Request, res: Response): Promise<void> {
  const usuarioId = req.params.usuarioId;
  if (!puedeOperar(req, usuarioId)) {
    res.status(403).json({ error: 'No puedes ver la agenda de otro usuario' });
    return;
  }
  const items = await prisma.agendaItem.findMany({
    where: { usuarioId },
    orderBy: { fechaCreacion: 'desc' },
  });
  res.json({ items });
}

export async function create(req: Request, res: Response): Promise<void> {
  const usuarioId = req.params.usuarioId;
  if (!puedeOperar(req, usuarioId)) { res.status(403).json({ error: 'No puedes crear agenda para otro' }); return; }
  const data = parseBody(req, res, baseSchema);
  if (!data) return;
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }
  const creado = await prisma.agendaItem.create({
    data: { ...data, usuarioId, fechaCreacion: BigInt(Date.now()) },
  });
  res.status(201).json({ item: creado });
}

export async function update(req: Request, res: Response): Promise<void> {
  const usuarioId = req.params.usuarioId;
  if (!puedeOperar(req, usuarioId)) { res.status(403).json({ error: 'No puedes editar agenda de otro' }); return; }
  const data = parseBody(req, res, updateSchema);
  if (!data) return;
  try {
    const actualizado = await prisma.agendaItem.update({
      where: { id: req.params.id },
      data,
    });
    if (actualizado.usuarioId !== usuarioId) {
      res.status(404).json({ error: 'Item no encontrado para este usuario' });
      return;
    }
    res.json({ item: actualizado });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Item no encontrado' }); return; }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  const usuarioId = req.params.usuarioId;
  if (!puedeOperar(req, usuarioId)) { res.status(403).json({ error: 'No puedes borrar agenda de otro' }); return; }
  try {
    await prisma.agendaItem.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Item no encontrado' }); return; }
    throw err;
  }
}
