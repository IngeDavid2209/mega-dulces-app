// Catalogo de rutinas (Robot V2). Reglas Firestore: read/write autenticado.
// Pero por logica de negocio, solo admin o usuario con puedeCrearRutinas crea/edita.
//
// Cascada importante: al ARCHIVAR (activa=false) o ELIMINAR una rutina, se
// marcan como eliminado=true los checklists con catalogoRutinaId === idRutina
// que aun no se han enviado/eliminado/archivado. Replica rutinas-catalogo.ts.
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { parseBody } from '../utils/errors.js';

const baseSchema = z.object({
  nombre:               z.string().min(1).trim(),
  descripcion:          z.string().optional(),
  tipo:                 z.string().optional(),
  frecuencia:           z.string().optional(),
  diaSemana:            z.string().optional(),
  diaMes:               z.number().int().min(1).max(31).optional(),
  horaInicio:           z.string().optional(),
  horaLimite:           z.string().optional(),
  responsableSugerido:  z.string().optional(),
  nivelCritico:         z.string().optional(),
  evidencia:            z.enum(['ninguna', 'foto', 'antesDespues', 'variasFotos']).optional(),
  tiempoEstimado:       z.number().int().optional(),
  tareas:               z.array(z.any()).default([]),
  activa:               z.boolean().default(true),
});

const createSchema = baseSchema;
const updateSchema = baseSchema.partial();

export async function list(_req: Request, res: Response): Promise<void> {
  const rutinas = await prisma.rutinaCatalogo.findMany({
    orderBy: [{ activa: 'desc' }, { nombre: 'asc' }],
  });
  res.json({ rutinas });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const rutina = await prisma.rutinaCatalogo.findUnique({ where: { id: req.params.id } });
  if (!rutina) { res.status(404).json({ error: 'Rutina no encontrada' }); return; }
  res.json({ rutina });
}

export async function create(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, createSchema);
  if (!data) return;
  const creada = await prisma.rutinaCatalogo.create({
    data: {
      ...data,
      creadoPor: req.user?.nombre,
      creadoEn:  BigInt(Date.now()),
    },
  });
  res.status(201).json({ rutina: creada });
}

export async function update(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, updateSchema);
  if (!data) return;
  try {
    const actualizada = await prisma.rutinaCatalogo.update({
      where: { id: req.params.id },
      data: {
        ...data,
        actualizadoPor: req.user?.nombre,
        actualizadoEn:  BigInt(Date.now()),
      },
    });
    res.json({ rutina: actualizada });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Rutina no encontrada' }); return; }
    throw err;
  }
}

/**
 * Duplica una rutina existente con sufijo "(copia)" en el nombre.
 */
export async function duplicar(req: Request, res: Response): Promise<void> {
  const original = await prisma.rutinaCatalogo.findUnique({ where: { id: req.params.id } });
  if (!original) { res.status(404).json({ error: 'Rutina no encontrada' }); return; }

  const { id, docIdFirebase, createdAt, updatedAt, creadoPor, creadoEn, actualizadoPor, actualizadoEn, raw, ...resto } = original;
  const copia = await prisma.rutinaCatalogo.create({
    data: {
      ...resto,
      nombre: `${original.nombre} (copia)`,
      creadoPor: req.user?.nombre,
      creadoEn:  BigInt(Date.now()),
      activa: true,
    },
  });
  res.status(201).json({ rutina: copia });
}

/**
 * Archivar: activa=false + cascada de checklists pendientes a eliminado=true.
 */
export async function archivar(req: Request, res: Response): Promise<void> {
  const rutinaId = req.params.id;
  try {
    const r = await prisma.$transaction(async (tx) => {
      const rutina = await tx.rutinaCatalogo.update({
        where: { id: rutinaId },
        data: {
          activa: false,
          actualizadoPor: req.user?.nombre,
          actualizadoEn:  BigInt(Date.now()),
        },
      });
      const cascada = await tx.checklist.updateMany({
        where: {
          catalogoRutinaId: rutinaId,
          enviado: false,
          eliminado: false,
          archivado: false,
        },
        data: { eliminado: true },
      });
      return { rutina, checklistsCancelados: cascada.count };
    });
    res.json(r);
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Rutina no encontrada' }); return; }
    throw err;
  }
}

export async function restaurar(req: Request, res: Response): Promise<void> {
  try {
    const rutina = await prisma.rutinaCatalogo.update({
      where: { id: req.params.id },
      data: { activa: true, actualizadoPor: req.user?.nombre, actualizadoEn: BigInt(Date.now()) },
    });
    res.json({ rutina });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Rutina no encontrada' }); return; }
    throw err;
  }
}

/**
 * Eliminar definitivamente. Incluye la misma cascada que archivar.
 * Solo admin global puede ejecutar.
 */
export async function remove(req: Request, res: Response): Promise<void> {
  const rutinaId = req.params.id;
  try {
    const r = await prisma.$transaction(async (tx) => {
      const cascada = await tx.checklist.updateMany({
        where: {
          catalogoRutinaId: rutinaId,
          enviado: false,
          eliminado: false,
          archivado: false,
        },
        data: { eliminado: true },
      });
      await tx.rutinaCatalogo.delete({ where: { id: rutinaId } });
      return { checklistsCancelados: cascada.count };
    });
    res.json(r);
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Rutina no encontrada' }); return; }
    throw err;
  }
}
