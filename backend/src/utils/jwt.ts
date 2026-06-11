// Firmado y verificacion de JSON Web Tokens.
// El token llega en el header Authorization: Bearer <token> en cada request.
import jwt from 'jsonwebtoken';

export interface JwtPayload {
  sub: string;         // Usuario.id (uuid)
  usuario: string;     // login (Usuario.usuario)
  rol: 'admin' | 'trabajador';
  iat?: number;
  exp?: number;
}

function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET ausente o demasiado corto. Configurarlo en .env (>= 32 chars).');
  }
  return s;
}

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign(payload, getSecret(), { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret()) as JwtPayload;
}
