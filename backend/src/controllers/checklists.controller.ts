// CRUD de checklists + agregaciones (ranking sucursales).
// Es el controlador mas grande porque concentra la operacion diaria.
//
// Visibilidad replicada de checklist.ts / home.ts / reportes.ts:
//   - admin global              → ve todo
//   - admin limitado/supervisor → ve solo de sus sucursales
//   - trabajador puro           → ve solo lo asignado a su nombre (mismoEmpleadoNombre)
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma.js';
import { parseBody, parseQuery } from '../utils/errors.js';
import { permisos } from '../middleware/roles.js';

// ============================================================================
// FILTROS DE VISIBILIDAD
// ============================================================================
function visibilidad(req: Request): Prisma.ChecklistWhereInput {
  const u = req.user!;
  if (permisos.esAdminGlobal(u)) return {};
  if (permisos.esAdminLimitado(u)) {
    const sucs = u.sucursales ?? [];
    const general = sucs.includes('General (Acceso Total)');
    if (general) return {};
    return sucs.length > 0 ? { store: { in: sucs } } : { id: '__none__' };
  }
  // Supervisor: igual que admin limitado si tiene sucursales
  if (u.rol === 'trabajador' && (u.sucursales ?? []).length > 0 &&
      (u.puedeAdministrarPersonal || u.puedeVerCheckstore || u.puedeVerEstadisticas ||
       u.puedeVerCalendario || u.puedeVerHistorial)) {
    return { store: { in: u.sucursales } };
  }
  // Trabajador puro: solo sus tareas
  return { assigned: u.nombre };
}

// ============================================================================
// SCHEMAS
// ============================================================================
const listSchema = z.object({
  fechaDesde: z.string().date().optional(),
  fechaHasta: z.string().date().optional(),
  store:      z.string().optional(),
  assigned:   z.string().optional(),
  enviado:    z.enum(['true', 'false']).optional(),
  archivado:  z.enum(['true', 'false']).optional(),
  eliminado:  z.enum(['true', 'false']).optional(),
  limit:      z.coerce.number().int().min(1).max(2000).default(500),
});

const baseSchema = z.object({
  name:               z.string().min(1).trim(),
  assigned:           z.string().min(1).trim(),
  store:              z.string().min(1).trim(),
  fecha:              z.string().date(),
  horaLimite:         z.string().optional(),
  status:             z.string().default('pendiente'),
  notaEmpleado:       z.string().optional(),
  entregaConRetraso:  z.boolean().default(false),
  motivoCategoria:    z.string().optional(),
  motivoComentario:   z.string().optional(),
  catalogoRutinaId:   z.string().optional(),
  asignacionId:       z.string().optional(),
  moldeId:            z.string().optional(),
  mantenimiento:      z.any().optional(),
  subtareas:          z.array(z.any()).default([]),
  items:              z.array(z.any()).default([]),
});

// Create acepta ademas `docIdFirebase` y `createdBy` opcionales. Sirve para
// idempotencia desde el Robot V2 — el robot genera un ID determinista por
// (asignacion, periodo, sucursal, empleado) y POSTea con ese id. Si el doc ya
// existe se devuelve sin duplicar. `createdBy` permite que el robot identifique
// sus checklists con "Robot V2" en lugar del nombre del usuario que dispara.
const createSchema = baseSchema.extend({
  docIdFirebase: z.string().optional(),
  createdBy:     z.string().optional(),
});
const updateSchema = baseSchema.partial();

const archivarMesSchema = z.object({
  mes: z.string().regex(/^\d{4}-\d{2}$/, 'formato esperado: YYYY-MM'),
});

const marcarFotosBorradasSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  fotosBorradasCount: z.number().int().nonnegative().optional(),
});

// ============================================================================
// CRUD
// ============================================================================
export async function list(req: Request, res: Response): Promise<void> {
  const q = parseQuery(req, res, listSchema);
  if (!q) return;

  const where: Prisma.ChecklistWhereInput = {
    ...visibilidad(req),
    ...(q.fechaDesde && q.fechaHasta
      ? { fecha: { gte: new Date(q.fechaDesde), lte: new Date(q.fechaHasta) } }
      : q.fechaDesde ? { fecha: { gte: new Date(q.fechaDesde) } }
      : q.fechaHasta ? { fecha: { lte: new Date(q.fechaHasta) } }
      : {}),
    ...(q.store    ? { store: q.store } : {}),
    ...(q.assigned ? { assigned: q.assigned } : {}),
    ...(q.enviado   === 'true'  ? { enviado: true }    : q.enviado   === 'false' ? { enviado: false }   : {}),
    ...(q.archivado === 'true'  ? { archivado: true }  : q.archivado === 'false' ? { archivado: false } : { archivado: false }),
    ...(q.eliminado === 'true'  ? { eliminado: true }  : q.eliminado === 'false' ? { eliminado: false } : { eliminado: false }),
  };

  const checklists = await prisma.checklist.findMany({
    where,
    orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
    take: q.limit,
  });
  res.json({ checklists });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const c = await prisma.checklist.findUnique({ where: { id: req.params.id } });
  if (!c) { res.status(404).json({ error: 'Checklist no encontrado' }); return; }
  res.json({ checklist: c });
}

export async function create(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, createSchema);
  if (!data) return;

  // Upsert por docIdFirebase: si llega con id y ya existe, ACTUALIZAMOS el
  // contenido. Esto es lo que necesitan el Robot V2 (idempotencia inicial) y
  // el flujo de "guardar progreso del checklist" del cliente — ambos pasan
  // el mismo docIdFirebase para conservar la identidad logica.
  if (data.docIdFirebase) {
    const existente = await prisma.checklist.findUnique({ where: { docIdFirebase: data.docIdFirebase } });
    if (existente) {
      const actualizado = await prisma.checklist.update({
        where: { id: existente.id },
        data: {
          ...data,
          fecha: new Date(data.fecha),
          createdBy: existente.createdBy ?? data.createdBy ?? req.user?.nombre,
          createdByUid: existente.createdByUid ?? req.user?.uidFirebase,
        },
      });
      res.status(200).json({ checklist: actualizado, idempotente: true });
      return;
    }
  }

  const creado = await prisma.checklist.create({
    data: {
      ...data,
      fecha: new Date(data.fecha),
      createdBy:        data.createdBy ?? req.user?.nombre,
      createdByUid:     req.user?.uidFirebase,
      timestampCreacion: BigInt(Date.now()),
    },
  });
  res.status(201).json({ checklist: creado });
}

export async function update(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, updateSchema);
  if (!data) return;
  try {
    const actualizado = await prisma.checklist.update({
      where: { id: req.params.id },
      data: {
        ...data,
        fecha: data.fecha ? new Date(data.fecha) : undefined,
      },
    });
    res.json({ checklist: actualizado });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Checklist no encontrado' }); return; }
    throw err;
  }
}

/**
 * Update parcial por `docIdFirebase`. Util cuando el cliente solo tiene el id
 * original de Firestore (caso de operaciones masivas tipo "reabrir", marcar
 * progreso desde modo offline, etc.) y NO quiere hacer un POST completo con
 * todos los campos requeridos del create.
 */
export async function updateByFirebaseId(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, updateSchema);
  if (!data) return;
  try {
    const actualizado = await prisma.checklist.update({
      where: { docIdFirebase: req.params.docIdFirebase },
      data: {
        ...data,
        fecha: data.fecha ? new Date(data.fecha) : undefined,
      },
    });
    res.json({ checklist: actualizado });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Checklist no encontrado' }); return; }
    throw err;
  }
}

/**
 * Soft-delete: marca eliminado=true en TODOS los checklists con
 * (name, assigned, store, date) iguales — replica el flujo de borrado en
 * cascada de reportes.ts. Tambien borra el molde V1 y desactiva la
 * asignacion V2 cuando aplica.
 */
const softDeleteSchema = z.object({
  cascada: z.boolean().default(true),
});
export async function softDelete(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, softDeleteSchema);
  if (!data) return;

  const c = await prisma.checklist.findUnique({ where: { id: req.params.id } });
  if (!c) { res.status(404).json({ error: 'Checklist no encontrado' }); return; }

  const result = await prisma.$transaction(async (tx) => {
    // Marcar todos los hermanos con misma firma como eliminados
    const cascada = data.cascada ? await tx.checklist.updateMany({
      where: {
        name: c.name,
        assigned: c.assigned,
        store: c.store,
        fecha: c.fecha,
        eliminado: false,
      },
      data: { eliminado: true },
    }) : { count: 0 };

    // Borrar molde V1 correspondiente (best effort)
    if (c.moldeId) {
      try { await tx.moldeChecklist.delete({ where: { id: c.moldeId } }); } catch {}
    }

    // Desactivar asignacion V2 si aplica
    if (c.asignacionId) {
      const asig = await tx.asignacionRutina.findUnique({ where: { id: c.asignacionId } });
      if (asig) {
        const asignados = asig.asignados.filter(n => n !== c.assigned);
        if (asignados.length === 0 || asig.modoAsignacion === 'porRol') {
          await tx.asignacionRutina.update({ where: { id: asig.id }, data: { activa: false } });
        } else {
          await tx.asignacionRutina.update({ where: { id: asig.id }, data: { asignados } });
        }
      }
    }

    return { checklistsAfectados: cascada.count };
  });

  res.json(result);
}

/**
 * Hard-delete del checklist puntual. Solo admin.
 */
export async function remove(req: Request, res: Response): Promise<void> {
  try {
    await prisma.checklist.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Checklist no encontrado' }); return; }
    throw err;
  }
}

// ============================================================================
// ARCHIVAR MES (replica cierre-mensual.archivarMes)
// ============================================================================
export async function archivarMes(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, archivarMesSchema);
  if (!data) return;

  const [yy, mm] = data.mes.split('-').map(Number);
  const desde = new Date(yy, mm - 1, 1);
  const hasta = new Date(yy, mm, 0);

  const result = await prisma.checklist.updateMany({
    where: {
      fecha: { gte: desde, lte: hasta },
      archivado: false,
    },
    data: {
      archivado: true,
      archivadoEn: new Date(),
      archivadoPor: req.user?.nombre,
      archivadoMes: data.mes,
    },
  });
  res.json({ mes: data.mes, archivados: result.count });
}

// ============================================================================
// MARCAR FOTOS BORRADAS (despues de limpiar Cloudinary)
// ============================================================================
export async function marcarFotosBorradas(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, marcarFotosBorradasSchema);
  if (!data) return;

  const result = await prisma.checklist.updateMany({
    where: { id: { in: data.ids }, fotosBorradas: false },
    data: {
      fotosBorradas: true,
      fotosBorradasEn: new Date(),
      fotosBorradasCount: data.fotosBorradasCount,
    },
  });
  res.json({ marcados: result.count });
}

// ============================================================================
// RANKING SEMANAL POR SUCURSAL
// (replica ranking-sucursales.ts: agrupa por sucursal y dia, calcula promedio)
// ============================================================================
const rankingSchema = z.object({
  desde: z.string().date(),    // inicio de semana (lunes)
  hasta: z.string().date(),    // fin de semana (domingo)
});

export async function ranking(req: Request, res: Response): Promise<void> {
  const q = parseQuery(req, res, rankingSchema);
  if (!q) return;

  const checklists = await prisma.checklist.findMany({
    where: {
      ...visibilidad(req),
      fecha: { gte: new Date(q.desde), lte: new Date(q.hasta) },
      eliminado: false,
      archivado: false,
    },
    select: {
      store: true,
      fecha: true,
      items: true,
      notaEmpleado: true,
      entregaConRetraso: true,
      enviado: true,
    },
  });

  // Agregar por sucursal × dia. esItemHecho = tiene evidencia O nota O retraso justificado.
  type FilaSucursal = { sucursal: string; porDia: Map<string, { hechos: number; total: number }>; promedio: number; totalChecklists: number };
  const mapa = new Map<string, FilaSucursal>();

  for (const c of checklists) {
    const fechaStr = c.fecha.toISOString().split('T')[0];
    const items = Array.isArray(c.items) ? (c.items as any[]) : [];
    const hayNota = !!(c.notaEmpleado && c.notaEmpleado.trim());
    const conRetraso = c.entregaConRetraso === true;

    let hechos = 0;
    for (const it of items) {
      const evid = !!(it.photo || it.photoAntes || it.photoDespues || it.checked === true ||
        (Array.isArray(it.photos) && it.photos.length > 0));
      if (evid || hayNota || conRetraso) hechos++;
    }
    const total = items.length || 0;

    if (!mapa.has(c.store)) mapa.set(c.store, { sucursal: c.store, porDia: new Map(), promedio: 0, totalChecklists: 0 });
    const fila = mapa.get(c.store)!;
    fila.totalChecklists++;
    const acc = fila.porDia.get(fechaStr) ?? { hechos: 0, total: 0 };
    acc.hechos += hechos;
    acc.total  += total;
    fila.porDia.set(fechaStr, acc);
  }

  // Calcular promedio por sucursal
  const ranking: any[] = [];
  for (const f of mapa.values()) {
    const dias = Array.from(f.porDia.entries()).map(([fecha, v]) => ({
      fecha,
      hechos: v.hechos,
      total: v.total,
      porcentaje: v.total > 0 ? Math.round((v.hechos / v.total) * 100) : 0,
    }));
    const sumaPcts = dias.reduce((s, d) => s + d.porcentaje, 0);
    const promedio = dias.length > 0 ? Math.round(sumaPcts / dias.length) : 0;
    ranking.push({
      sucursal: f.sucursal,
      promedio,
      totalChecklists: f.totalChecklists,
      dias,
    });
  }

  ranking.sort((a, b) => b.promedio - a.promedio || b.totalChecklists - a.totalChecklists || a.sucursal.localeCompare(b.sucursal));
  res.json({ desde: q.desde, hasta: q.hasta, ranking });
}
