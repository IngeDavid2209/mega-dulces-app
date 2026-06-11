// Moldes de checklists (Robot V1 - legacy). Se mantiene mientras conviva con V2.
// Reglas Firestore: read/write autenticado.
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { parseBody, parseQuery } from '../utils/errors.js';

const listSchema = z.object({
  activo: z.enum(['true', 'false']).optional(),
});

const baseSchema = z.object({
  name:        z.string().min(1).trim(),
  assigned:    z.string().min(1).trim(),
  store:       z.string().optional(),
  frecuencia:  z.string().optional(),
  diaSemana:   z.string().optional(),
  diaMes:      z.number().int().min(1).max(31).optional(),
  fechaInicio: z.string().date().optional(),
  fechaFin:    z.string().date().optional(),
  horaInicio:  z.string().optional(),
  horaLimite:  z.string().optional(),
  items:       z.array(z.any()).default([]),
  activo:      z.boolean().default(true),
});

const updateSchema = baseSchema.partial();

export async function list(req: Request, res: Response): Promise<void> {
  const q = parseQuery(req, res, listSchema);
  if (!q) return;
  const moldes = await prisma.moldeChecklist.findMany({
    where: {
      ...(q.activo === 'true'  ? { activo: true }  : {}),
      ...(q.activo === 'false' ? { activo: false } : {}),
    },
    orderBy: [{ activo: 'desc' }, { name: 'asc' }],
  });
  res.json({ moldes });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const molde = await prisma.moldeChecklist.findUnique({ where: { id: req.params.id } });
  if (!molde) { res.status(404).json({ error: 'Molde no encontrado' }); return; }
  res.json({ molde });
}

export async function create(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, baseSchema);
  if (!data) return;
  const creado = await prisma.moldeChecklist.create({
    data: {
      ...data,
      fechaInicio: data.fechaInicio ? new Date(data.fechaInicio) : null,
      fechaFin:    data.fechaFin    ? new Date(data.fechaFin)    : null,
    },
  });
  res.status(201).json({ molde: creado });
}

export async function update(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, updateSchema);
  if (!data) return;
  try {
    const actualizado = await prisma.moldeChecklist.update({
      where: { id: req.params.id },
      data: {
        ...data,
        fechaInicio: data.fechaInicio === undefined ? undefined : data.fechaInicio ? new Date(data.fechaInicio) : null,
        fechaFin:    data.fechaFin    === undefined ? undefined : data.fechaFin    ? new Date(data.fechaFin)    : null,
      },
    });
    res.json({ molde: actualizado });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Molde no encontrado' }); return; }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    await prisma.moldeChecklist.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Molde no encontrado' }); return; }
    throw err;
  }
}
