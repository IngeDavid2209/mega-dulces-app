// Endpoints internos servidor-a-servidor. Protegidos con SERVICE_SECRET
// (no con JWT). No los consume el frontend.
import { Router } from 'express';
import { prisma } from '../services/prisma.js';
import { requireServiceSecret } from '../middleware/service-secret.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

/**
 * GET /api/internal/tokens?usuario=NOMBRE
 *
 * Devuelve los tokens FCM activos. Si se omite `usuario` devuelve todos
 * (uso tipico: enviar push global de "actualizacion disponible" a TODOS los
 * dispositivos registrados).
 *
 * Lo consume `api/notify-update.js` (function de Vercel) para localizar a los
 * destinatarios del push antes de delegar el envio a firebase-admin.
 */
router.get('/tokens', requireServiceSecret, asyncHandler(async (req, res) => {
  const usuario = (req.query.usuario as string | undefined)?.trim();
  const tokens = await prisma.tokenFCM.findMany({
    where: usuario ? { usuario } : undefined,
    select: { token: true, usuario: true, usuarioUid: true, actualizado: true },
  });
  res.json({ tokens, total: tokens.length });
}));

export default router;
