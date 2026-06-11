// Tareas de equipo (proyectos colaborativos). Filtro de visibilidad:
//   - admin global → ve todas
//   - admin limitado → solo las de sus sucursales
//   - trabajador → solo las donde es jefeEquipo o integrante
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { parseBody, parseQuery } from '../utils/errors.js';
import { permisos } from '../middleware/roles.js';

const listSchema = z.object({
  cerrado: z.enum(['true', 'false']).optional(),
});

const baseSchema = z.object({
  titulo:       z.string().min(1).trim(),
  descripcion:  z.string().optional(),
  jefeEquipo:   z.string().optional(),
  integrantes:  z.array(z.string()).default([]),
  store:        z.string().optional(),
  fechaInicio:  z.string().date().optional(),
  fechaFin:     z.string().date().optional(),
  cerrado:      z.boolean().default(false),
  fases:        z.array(z.any()).default([]),
});

const updateSchema = baseSchema.partial();

function visibilidad(req: Request) {
  const u = req.user!;
  if (permisos.esAdminGlobal(u)) return {};
  if (permisos.esAdminLimitado(u)) {
    const sucs = u.sucursales ?? [];
    return sucs.length > 0 ? { store: { in: sucs } } : { id: '__none__' };
  }
  // Trabajador: solo donde es jefe o integrante (campo array contains)
  return {
    OR: [
      { jefeEquipo: u.nombre },
      { integrantes: { has: u.nombre } },
    ],
  };
}

export async function list(req: Request, res: Response): Promise<void> {
  const q = parseQuery(req, res, listSchema);
  if (!q) return;
  const tareas = await prisma.tareaEquipo.findMany({
    where: {
      ...visibilidad(req),
      ...(q.cerrado === 'true'  ? { cerrado: true }  : {}),
      ...(q.cerrado === 'false' ? { cerrado: false } : {}),
    },
    orderBy: [{ timestampCreacion: 'desc' }],
  });
  res.json({ tareas });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const tarea = await prisma.tareaEquipo.findUnique({ where: { id: req.params.id } });
  if (!tarea) { res.status(404).json({ error: 'Tarea no encontrada' }); return; }
  res.json({ tarea });
}

export async function create(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, baseSchema);
  if (!data) return;
  const creada = await prisma.tareaEquipo.create({
    data: {
      ...data,
      fechaInicio: data.fechaInicio ? new Date(data.fechaInicio) : null,
      fechaFin:    data.fechaFin    ? new Date(data.fechaFin)    : null,
      timestampCreacion: BigInt(Date.now()),
    },
  });
  res.status(201).json({ tarea: creada });
}

export async function update(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, updateSchema);
  if (!data) return;
  try {
    const actualizada = await prisma.tareaEquipo.update({
      where: { id: req.params.id },
      data: {
        ...data,
        fechaInicio: data.fechaInicio === undefined ? undefined : data.fechaInicio ? new Date(data.fechaInicio) : null,
        fechaFin:    data.fechaFin    === undefined ? undefined : data.fechaFin    ? new Date(data.fechaFin)    : null,
      },
    });
    res.json({ tarea: actualizada });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Tarea no encontrada' }); return; }
    throw err;
  }
}

export async function cerrar(req: Request, res: Response): Promise<void> {
  try {
    const tarea = await prisma.tareaEquipo.update({
      where: { id: req.params.id },
      data: { cerrado: true },
    });
    res.json({ tarea });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Tarea no encontrada' }); return; }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    await prisma.tareaEquipo.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Tarea no encontrada' }); return; }
    throw err;
  }
}
