// Sanea objetos Usuario antes de enviarlos por HTTP para no filtrar
// passwordHash ni el blob raw del doc Firestore original.
import type { Usuario } from '@prisma/client';

export type UsuarioPublico = Omit<Usuario, 'passwordHash' | 'raw'>;

export function usuarioPublico(u: Usuario): UsuarioPublico {
  const { passwordHash, raw, ...rest } = u;
  return rest;
}
