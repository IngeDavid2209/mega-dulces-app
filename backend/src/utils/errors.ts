// Helpers compartidos para validacion zod y manejo de errores en controladores.
import type { Request, Response } from 'express';
import type { ZodSchema } from 'zod';

/**
 * Valida el body del request contra un schema zod.
 * Si falla envia 400 y devuelve null. Si pasa devuelve los datos parseados.
 *
 * Uso:
 *   const data = parseBody(req, res, mySchema);
 *   if (!data) return;
 *   // ahora `data` esta tipado segun el schema
 */
export function parseBody<T>(req: Request, res: Response, schema: ZodSchema<T>): T | null {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    res.status(400).json({ error: 'Body invalido', detalle: r.error.format() });
    return null;
  }
  return r.data;
}

/** Igual que parseBody pero para query params (?foo=bar). */
export function parseQuery<T>(req: Request, res: Response, schema: ZodSchema<T>): T | null {
  const r = schema.safeParse(req.query);
  if (!r.success) {
    res.status(400).json({ error: 'Query invalido', detalle: r.error.format() });
    return null;
  }
  return r.data;
}

/**
 * Wrapper async para que errores no manejados lleguen al error handler global.
 * Sin esto, una promesa rechazada dentro de un handler async no se captura.
 *
 * Uso en rutas:
 *   router.get('/foo', asyncHandler(miHandler));
 */
export function asyncHandler<T extends (req: Request, res: Response, next?: any) => Promise<any>>(fn: T) {
  return (req: Request, res: Response, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
