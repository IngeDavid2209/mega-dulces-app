// Asignaciones de rutinas (Robot V2). Conecta rutinas del catalogo con
// personas/sucursales con regla de frecuencia.
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { parseBody, parseQuery } from '../utils/errors.js';

const listSchema = z.object({
  activa: z.enum(['true', 'false']).optional(),
  store:  z.string().optional(),
});

const baseSchema = z.object({
  rutinaId:       z.string().uuid().optional(),
  rutinaIdLegacy: z.string().optional(),
  rutinaNombre:   z.string().optional(),
  modoAsignacion: z.string().optional(),
  asignados:      z.array(z.string()).default([]),
  rolObjetivo:    z.string().optional(),
  store:          z.string().optional(),
  area:           z.string().optional(),
  frecuencia:     z.string().optional(),
  diaSemana:      z.string().optional(),
  diaMes:         z.number().int().min(1).max(31).optional(),
  fechaInicio:    z.string().date().optional(),
  fechaFin:       z.string().date().optional(),
  horaInicio:     z.string().optional(),
  horaLimite:     z.string().optional(),
  activa:         z.boolean().default(true),
});

const updateSchema = baseSchema.partial();

export async function list(req: Request, res: Response): Promise<void> {
  const q = parseQuery(req, res, listSchema);
  if (!q) return;
  const asignaciones = await prisma.asignacionRutina.findMany({
    where: {
      ...(q.activa === 'true'  ? { activa: true }  : {}),
      ...(q.activa === 'false' ? { activa: false } : {}),
      ...(q.store ? { store: q.store } : {}),
    },
    orderBy: [{ activa: 'desc' }, { rutinaNombre: 'asc' }],
  });
  res.json({ asignaciones });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const asignacion = await prisma.asignacionRutina.findUnique({ where: { id: req.params.id } });
  if (!asignacion) { res.status(404).json({ error: 'Asignacion no encontrada' }); return; }
  res.json({ asignacion });
}

export async function create(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, baseSchema);
  if (!data) return;
  const creada = await prisma.asignacionRutina.create({
    data: {
      ...data,
      fechaInicio: data.fechaInicio ? new Date(data.fechaInicio) : null,
      fechaFin:    data.fechaFin    ? new Date(data.fechaFin)    : null,
    },
  });
  res.status(201).json({ asignacion: creada });
}

export async function update(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, updateSchema);
  if (!data) return;
  try {
    const actualizada = await prisma.asignacionRutina.update({
      where: { id: req.params.id },
      data: {
        ...data,
        fechaInicio: data.fechaInicio === undefined ? undefined : data.fechaInicio ? new Date(data.fechaInicio) : null,
        fechaFin:    data.fechaFin    === undefined ? undefined : data.fechaFin    ? new Date(data.fechaFin)    : null,
      },
    });
    res.json({ asignacion: actualizada });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Asignacion no encontrada' }); return; }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    await prisma.asignacionRutina.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Asignacion no encontrada' }); return; }
    throw err;
  }
}
