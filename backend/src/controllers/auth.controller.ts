// Controlador de autenticacion.
//   POST /api/auth/register  → solo admin (replica regla `esAdmin()` de Firestore)
//   POST /api/auth/login     → publico
//   GET  /api/auth/me        → cualquier sesion valida
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { usuarioPublico } from '../utils/sanitize.js';

// --- Schemas de validacion ---

const rolEnum = z.enum(['admin', 'trabajador']);
const alcanceEnum = z.enum(['global', 'sucursales']);

const flagsPermisos = z.object({
  puedeCrearChecklists:     z.boolean().optional(),
  puedeCrearRutinas:        z.boolean().optional(),
  puedeCrearTareasUnicas:   z.boolean().optional(),
  puedeVerCheckstore:       z.boolean().optional(),
  puedeVerEstadisticas:     z.boolean().optional(),
  puedeVerHistorial:        z.boolean().optional(),
  puedeAdministrarPersonal: z.boolean().optional(),
  puedeVerCalendario:       z.boolean().optional(),
  puedeAdministrarAreas:    z.boolean().optional(),
}).partial();

const registerSchema = z.object({
  usuario:    z.string().min(3, 'usuario debe tener al menos 3 caracteres').toLowerCase().trim(),
  nombre:     z.string().min(2, 'nombre requerido').trim(),
  correo:     z.string().email().toLowerCase().optional(),
  password:   z.string().min(6, 'password debe tener al menos 6 caracteres'),
  rol:        rolEnum.default('trabajador'),
  alcance:    alcanceEnum.optional(),
  cargo:      z.string().optional(),
  telefono:   z.string().optional(),
  sucursales: z.array(z.string()).default([]),
  areas:      z.array(z.string()).default([]),
}).merge(flagsPermisos);

const loginSchema = z.object({
  usuario:  z.string().min(1, 'usuario o correo requerido').trim(),
  password: z.string().min(1, 'password requerido'),
});

// --- Handlers ---

/**
 * POST /api/auth/register
 * Solo admin puede crear usuarios (replica regla `esAdmin()` de firestore.rules).
 * Body: ver registerSchema.
 */
export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Body invalido', detalle: parsed.error.format() });
    return;
  }
  const { password, ...datos } = parsed.data;

  // Conflictos: usuario duplicado o correo duplicado
  const existente = await prisma.usuario.findFirst({
    where: {
      OR: [
        { usuario: datos.usuario },
        ...(datos.correo ? [{ correo: datos.correo }] : []),
      ],
    },
  });
  if (existente) {
    res.status(409).json({ error: 'Ya existe un usuario con ese login o correo' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const creado = await prisma.usuario.create({
    data: {
      ...datos,
      passwordHash,
    },
  });

  res.status(201).json({ user: usuarioPublico(creado) });
}

/**
 * POST /api/auth/login
 * Body: { usuario, password }. `usuario` puede ser login (`tania.sanchez`) o
 * correo completo (`tania@megadulces.mx`) — replica el comportamiento del front.
 */
export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Body invalido', detalle: parsed.error.format() });
    return;
  }
  const entrada = parsed.data.usuario.toLowerCase().trim();
  const esCorreo = entrada.includes('@');

  const usuario = await prisma.usuario.findFirst({
    where: esCorreo ? { correo: entrada } : { usuario: entrada },
  });

  // Para no filtrar si el usuario existe o no, devolvemos un 401 generico
  // tanto si el usuario no existe como si la contrasena no coincide.
  if (!usuario || !usuario.passwordHash) {
    res.status(401).json({ error: 'Credenciales invalidas' });
    return;
  }

  const ok = await verifyPassword(parsed.data.password, usuario.passwordHash);
  if (!ok) {
    res.status(401).json({ error: 'Credenciales invalidas' });
    return;
  }

  const token = signToken({
    sub: usuario.id,
    usuario: usuario.usuario,
    rol: usuario.rol,
  });

  res.json({ token, user: usuarioPublico(usuario) });
}

/**
 * GET /api/auth/me
 * Requiere JWT. Devuelve el perfil COMPLETO Y FRESCO del usuario (carga req.user
 * desde la DB, no del payload del token). Asi cambios de rol o permisos se ven
 * de inmediato sin necesidad de reloguear.
 */
export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }
  res.json({ user: usuarioPublico(req.user) });
}
