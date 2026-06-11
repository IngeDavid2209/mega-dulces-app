// Notificaciones in-app. Reglas Firestore originales: read/write autenticado.
// Politica de visibilidad: cada usuario solo ve SUS notificaciones (filtradas
// por empleado === currentUser.nombre). Admin global puede listar todas si
// pasa ?all=true (util para soporte).
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { parseBody, parseQuery } from '../utils/errors.js';
import { permisos } from '../middleware/roles.js';
import { tieneServiceSecretValido } from '../middleware/service-secret.js';

const listSchema = z.object({
  leido: z.enum(['true', 'false']).optional(),
  all:   z.enum(['true', 'false']).optional(),
});

const createSchema = z.object({
  empleado:    z.string().min(1).trim(),
  empleadoUid: z.string().optional(),
  remitente:   z.string().optional(),
  titulo:      z.string().optional(),
  mensaje:     z.string().optional(),
});

export async function list(req: Request, res: Response): Promise<void> {
  const q = parseQuery(req, res, listSchema);
  if (!q) return;
  const verTodas = q.all === 'true' && permisos.esAdminGlobal(req.user);

  const notificaciones = await prisma.notificacion.findMany({
    where: {
      ...(verTodas ? {} : { empleado: req.user?.nombre ?? '__nadie__' }),
      ...(q.leido === 'true'  ? { leido: true }  : {}),
      ...(q.leido === 'false' ? { leido: false } : {}),
    },
    orderBy: { fechaCreacion: 'desc' },
    take: 200,   // cap de seguridad
  });
  res.json({ notificaciones });
}

export async function create(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, createSchema);
  if (!data) return;
  const noti = await prisma.notificacion.create({
    data: {
      ...data,
      remitente: data.remitente ?? req.user?.nombre,
    },
  });
  res.status(201).json({ notificacion: noti });
}

export async function marcarLeida(req: Request, res: Response): Promise<void> {
  try {
    const actualizada = await prisma.notificacion.update({
      where: { id: req.params.id },
      data: { leido: true },
    });
    res.json({ notificacion: actualizada });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Notificacion no encontrada' }); return; }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    await prisma.notificacion.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Notificacion no encontrada' }); return; }
    throw err;
  }
}

// =============================================================================
// TOKENS FCM
// =============================================================================
// Antes vivian en Firestore (`usuarios_tokens`). Ahora viven aqui para cerrar
// Firestore por completo. FCM sigue siendo el transporte de los push; lo unico
// que cambia es donde se guardan los tokens que se entregan al servicio push.

const tokenSchema = z.object({
  token:      z.string().min(20),
  usuario:    z.string().min(1).trim(),
  usuarioUid: z.string().optional(),
  userAgent:  z.string().optional(),
});

export async function registrarToken(req: Request, res: Response): Promise<void> {
  const data = parseBody(req, res, tokenSchema);
  if (!data) return;
  const result = await prisma.tokenFCM.upsert({
    where: { token: data.token },
    update: {
      usuario: data.usuario,
      usuarioUid: data.usuarioUid ?? null,
      userAgent: data.userAgent ?? null,
      actualizado: BigInt(Date.now()),
    },
    create: {
      token: data.token,
      usuario: data.usuario,
      usuarioUid: data.usuarioUid ?? null,
      userAgent: data.userAgent ?? null,
      actualizado: BigInt(Date.now()),
    },
  });
  res.status(201).json({ token: result });
}

export async function listarTokens(req: Request, res: Response): Promise<void> {
  const usuario = (req.query.usuario as string | undefined)?.trim();
  const tokens = await prisma.tokenFCM.findMany({
    where: usuario ? { usuario } : undefined,
    orderBy: { actualizado: 'desc' },
  });
  res.json({ tokens });
}

export async function borrarToken(req: Request, res: Response): Promise<void> {
  // Acepta JWT (usuario que se desloguea o admin) o service secret (limpieza
  // automatica de tokens muertos por la function notify-update.js de Vercel).
  if (!req.user && !tieneServiceSecretValido(req)) {
    res.status(401).json({ error: 'Requiere JWT o service secret' });
    return;
  }
  try {
    await prisma.tokenFCM.delete({ where: { token: req.params.token } });
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Token no encontrado' }); return; }
    throw err;
  }
}
