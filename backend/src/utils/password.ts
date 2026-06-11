// Hash y verificacion de contrasenas con bcrypt.
// Antes la auth era Firebase Auth — ahora guardamos passwordHash en Postgres.
import bcrypt from 'bcryptjs';

// bcrypt rounds: 10 es el balance estandar entre seguridad y velocidad.
// Subir a 12 si el servidor lo soporta sin afectar UX de login.
const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  if (!plain || plain.length < 6) {
    throw new Error('La contrasena debe tener al menos 6 caracteres');
  }
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
}
