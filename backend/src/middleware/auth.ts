// Middleware de autenticacion: valida el JWT del header Authorization y
// carga req.user con la version FRESCA del usuario desde la DB.
//
// Usar `requireAuth` en CUALQUIER endpoint que necesite identidad.
// Para autorizacion por rol/permiso, encadenar con `requireAdmin` o
// `requirePermiso(flag)` definidos en roles.ts.
import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { prisma } from '../services/prisma.js';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Falta el header Authorization: Bearer <token>' });
    return;
  }

  let payload;
  try {
    payload = verifyToken(match[1]);
  } catch (err: any) {
    res.status(401).json({ error: 'Token invalido o expirado' });
    return;
  }

  // Cargamos el usuario fresco de la DB.
  // Esto cubre el caso de que un admin haya cambiado rol/permisos al usuario
  // despues de emitir el token — el nuevo estado se aplica de inmediato.
  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    res.status(401).json({ error: 'Usuario no encontrado' });
    return;
  }

  req.user = usuario;
  next();
}
