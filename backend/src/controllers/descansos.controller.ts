// Descansos semanales: dia de descanso por empleado por semana ISO (2026-W23).
// Reglas Firestore: read auth, write admin.
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { parseBody, parseQuery } from '../utils/errors.js';

const listSchema = z.object({
  empleado: z.string().optional(),
  semana: z.string().regex(/^\d{4}-W\d{2}$/, 'formato esperado: YYYY-Wnn').optional(),
});

const upsertSchema = z.object({
  empleado:    z.string().min(1).trim(),
  userId:      z.string().optional(),
  semanaIso:   z.string().regex(/^\d{4}-W\d{2}$/, 'formato esperado: YYYY-Wnn'),
  dias:        z.array(z.string()).default([]),
});

export async function list(req: Request, res: Response): Promise<void> {
  const q = parseQuery(req, res, listSchema);
  if (!q) return;
  const descansos = await prisma.descansoSemanal.findMany({
    where: {
      ...(q.empleado ? { empleado: q.empleado } : {}),
      ...(q.semana   ? { semanaIso: q.semana }  : {}),
    },
    orderBy: [{ semanaIso: 'desc' }, { empleado: 'asc' }],
  });
  res.json({ descansos });
}

/**
 * Upsert: si ya existe (empleado, semanaIso) se actualiza el diaDescanso;
 * si no existe se crea. Replica el patron del front de "guardar descanso
 * de la semana" sin distinguir create vs update.
 */
export async function upsert(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, upsertSchema);
  if (!data) return;

  // Si el front envia dias=[] interpretamos como "borrar el descanso de la
  // semana" (no dejar registro vacio). Esto simplifica el flujo de UI.
  if (data.dias.length === 0) {
    await prisma.descansoSemanal.deleteMany({
      where: { empleado: data.empleado, semanaIso: data.semanaIso },
    });
    res.json({ descanso: null, borrado: true });
    return;
  }

  const actualizadoPor = req.user?.nombre ?? null;
  const result = await prisma.descansoSemanal.upsert({
    where: { empleado_semanaIso: { empleado: data.empleado, semanaIso: data.semanaIso } },
    update: {
      dias: data.dias,
      userId: data.userId ?? undefined,
      actualizadoPor,
      actualizadoEn: BigInt(Date.now()),
    },
    create: {
      empleado: data.empleado,
      userId: data.userId ?? null,
      semanaIso: data.semanaIso,
      dias: data.dias,
      actualizadoPor,
      actualizadoEn: BigInt(Date.now()),
    },
  });
  res.json({ descanso: result });
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    await prisma.descansoSemanal.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Descanso no encontrado' }); return; }
    throw err;
  }
}
