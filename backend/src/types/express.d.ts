// Extension del tipo Request para que req.user este tipado correctamente.
// El middleware requireAuth carga este campo con el doc fresco de la DB.
import type { Usuario } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: Usuario;
    }
  }
}

export {};
