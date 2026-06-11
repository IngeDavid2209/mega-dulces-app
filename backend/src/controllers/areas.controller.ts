// CRUD de areas operativas (catalogo). Replica reglas:
//   read  → autenticado
//   write → admin
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { parseBody } from '../utils/errors.js';

const createSchema = z.object({
  nombre:            z.string().min(1).trim(),
  descripcion:       z.string().optional(),
  activa:            z.boolean().default(true),
  bloqueada:         z.boolean().default(false),
  fechaBloqueo:      z.string().date().optional(),
  // Campos de jornada (consumidos por la UI areas.ts):
  fechaAsignada:     z.string().optional(),
  horaEntrada:       z.string().optional(),
  horaSalida:        z.string().optional(),
  turnoAsignado:     z.string().optional(),
  esRecurrente:      z.boolean().default(false),
  fechaCreacion:     z.string().optional(),
  fechaModificacion: z.string().optional(),
});

const updateSchema = createSchema.partial();

export async function list(_req: Request, res: Response): Promise<void> {
  const areas = await prisma.area.findMany({ orderBy: { nombre: 'asc' } });
  res.json({ areas });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const area = await prisma.area.findUnique({ where: { id: req.params.id } });
  if (!area) { res.status(404).json({ error: 'Area no encontrada' }); return; }
  res.json({ area });
}

export async function create(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, createSchema);
  if (!data) return;

  const existe = await prisma.area.findUnique({ where: { nombre: data.nombre } });
  if (existe) { res.status(409).json({ error: 'Ya existe un area con ese nombre' }); return; }

  const creada = await prisma.area.create({
    data: {
      ...data,
      fechaBloqueo: data.fechaBloqueo ? new Date(data.fechaBloqueo) : null,
    },
  });
  res.status(201).json({ area: creada });
}

export async function update(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, updateSchema);
  if (!data) return;

  try {
    const actualizada = await prisma.area.update({
      where: { id: req.params.id },
      data: {
        ...data,
        fechaBloqueo: data.fechaBloqueo === undefined ? undefined
          : data.fechaBloqueo ? new Date(data.fechaBloqueo) : null,
      },
    });
    res.json({ area: actualizada });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Area no encontrada' }); return; }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    await prisma.area.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Area no encontrada' }); return; }
    throw err;
  }
}
