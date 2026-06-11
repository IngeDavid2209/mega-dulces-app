// Middleware que autentica peticiones SERVIDOR-A-SERVIDOR (no usuarios).
// Sirve para que funciones serverless como api/notify-update.js (Vercel)
// llamen al backend Node con un secret compartido (env var SERVICE_SECRET).
//
// NO debe usarse en endpoints que el frontend consuma — el secret no debe
// llegar al navegador. Solo para tareas internas (cron, webhooks, scripts).
import type { Request, Response, NextFunction } from 'express';

export function requireServiceSecret(req: Request, res: Response, next: NextFunction): void {
  const enviado = req.header('x-service-secret') || '';
  const esperado = process.env.SERVICE_SECRET || '';
  if (!esperado) {
    res.status(500).json({ error: 'Servidor mal configurado: falta SERVICE_SECRET en env.' });
    return;
  }
  if (enviado !== esperado) {
    res.status(401).json({ error: 'Service secret invalido' });
    return;
  }
  next();
}

/**
 * Helper para endpoints que aceptan JWT (caso usuario) O service secret
 * (caso server-a-server). Util en endpoints que ambos consumen, ej. borrar
 * un token FCM muerto: el dueno desde su app, o la function notify-update.js
 * tras detectar un envio fallido.
 */
export function tieneServiceSecretValido(req: Request): boolean {
  const enviado = req.header('x-service-secret') || '';
  const esperado = process.env.SERVICE_SECRET || '';
  return !!esperado && enviado === esperado;
}
