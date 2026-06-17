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

// Normaliza nombres igual que el front (src/app/shared/permisos.util.ts):
// quita tildes/puntuacion, colapsa espacios y pasa a minusculas.
function normalizarNombre(n: string | null | undefined): string {
  if (!n) return '';
  return n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// Comparacion tolerante de nombres (mismoEmpleadoNombre del front): identicos,
// o uno es prefijo exacto del otro compartiendo al menos 2 palabras.
function nombresIguales(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizarNombre(a);
  const nb = normalizarNombre(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const corto = na.length < nb.length ? na : nb;
  const largo = na.length < nb.length ? nb : na;
  if (!largo.startsWith(corto + ' ')) return false;
  return corto.split(' ').filter(Boolean).length >= 2;
}

type TareaParaAutorizar = { jefeEquipo: string | null; integrantes: string[]; store: string | null };

// ¿El usuario es participante de ESTA tarea? (admin con acceso, jefe o integrante).
// Replica puedeMonitorearEquipo + esIntegranteEquipo del front. Sustituye al
// permiso global puedeCrearTareasUnicas para no bloquear a integrantes/jefes
// que solo completan o se agregan tareas propias.
function esParticipante(req: Request, tarea: TareaParaAutorizar): boolean {
  const u = req.user;
  if (!u) return false;
  if (permisos.esAdminGlobal(u)) return true;
  if (permisos.esAdminLimitado(u)) {
    const sucs = u.sucursales ?? [];
    return !!tarea.store && sucs.includes(tarea.store);
  }
  if (nombresIguales(u.nombre, tarea.jefeEquipo)) return true;
  return (tarea.integrantes ?? []).some((n) => nombresIguales(u.nombre, n));
}

// Autorizacion "legacy" que existia antes (requirePermiso('puedeCrearTareasUnicas')):
// admin de cualquier alcance O trabajador con el flag. Se mantiene como fallback
// para NO quitarle acceso a quien ya lo tenia (ej. el creador con permiso que no
// es el jefe). Las reglas nuevas (participacion) solo AMPLIAN el acceso.
function tienePermisoLegacy(req: Request): boolean {
  const u = req.user;
  if (!u) return false;
  return permisos.esAdmin(u) || u.puedeCrearTareasUnicas === true;
}

// ¿El usuario puede monitorear (cerrar fases/proyecto)? Admin o jefe designado.
function esMonitor(req: Request, tarea: TareaParaAutorizar): boolean {
  const u = req.user;
  if (!u) return false;
  if (permisos.esAdminGlobal(u)) return true;
  if (permisos.esAdminLimitado(u)) {
    const sucs = u.sucursales ?? [];
    return !!tarea.store && sucs.includes(tarea.store);
  }
  return nombresIguales(u.nombre, tarea.jefeEquipo);
}

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
  // Autorizacion por participacion (no por permiso global): el integrante debe
  // poder completar sus items y agregarse tareas propias en la fase activa.
  const existente = await prisma.tareaEquipo.findUnique({ where: { id: req.params.id } });
  if (!existente) { res.status(404).json({ error: 'Tarea no encontrada' }); return; }
  if (!esParticipante(req, existente) && !tienePermisoLegacy(req)) {
    res.status(403).json({ error: 'No formas parte de esta tarea de equipo' });
    return;
  }
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
  // Cerrar el proyecto es accion de monitor (admin con acceso o jefe designado).
  const existente = await prisma.tareaEquipo.findUnique({ where: { id: req.params.id } });
  if (!existente) { res.status(404).json({ error: 'Tarea no encontrada' }); return; }
  if (!esMonitor(req, existente) && !tienePermisoLegacy(req)) {
    res.status(403).json({ error: 'Solo el jefe de equipo o un admin puede cerrar el proyecto' });
    return;
  }
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
