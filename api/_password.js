// ============================================================================
//  Verificación de contraseñas para la auth propia (reemplazo de Firebase Auth).
//
//  Dos algoritmos coexisten durante y después de la migración:
//   - 'firebase-scrypt': hashes EXPORTADOS de Firebase Auth (scrypt de Firebase).
//     Verificados con `firebase-scrypt` usando los parámetros del proyecto
//     (env FB_SCRYPT_*). Requiere el password_salt del usuario.
//   - 'bcrypt': usuarios nuevos o que cambiaron su contraseña tras el cutover.
//
//  Env necesarias para verificar los hashes de Firebase (de la consola:
//  Authentication -> Password hash parameters):
//    FB_SCRYPT_SIGNER_KEY, FB_SCRYPT_SALT_SEP, FB_SCRYPT_ROUNDS, FB_SCRYPT_MEM_COST
// ============================================================================
const bcrypt = require('bcryptjs');
const { FirebaseScrypt } = require('firebase-scrypt');

let scrypt = null;
function getScrypt() {
  if (scrypt) return scrypt;
  const signerKey = process.env.FB_SCRYPT_SIGNER_KEY;
  const saltSeparator = process.env.FB_SCRYPT_SALT_SEP;
  if (!signerKey || !saltSeparator) return null; // sin params no se pueden verificar los hashes de Firebase
  const rounds = parseInt(process.env.FB_SCRYPT_ROUNDS || '8', 10);
  const memCost = parseInt(process.env.FB_SCRYPT_MEM_COST || '14', 10);
  scrypt = new FirebaseScrypt({ signerKey, saltSeparator, rounds, memCost });
  return scrypt;
}

/** Hash bcrypt para guardar (usuarios nuevos / cambios de contraseña). */
async function hashBcrypt(pw) {
  return bcrypt.hash(String(pw), 10);
}

/**
 * Verifica `pw` contra la fila cruda de mdtask_usuarios (columnas
 * password_hash / password_salt / password_algo). Devuelve boolean.
 */
async function verificarPassword(row, pw) {
  if (!row || !pw || !row.password_hash) return false;
  if (row.password_algo === 'bcrypt') {
    try { return await bcrypt.compare(String(pw), row.password_hash); }
    catch (_) { return false; }
  }
  // Por defecto: hash de Firebase (scrypt).
  const s = getScrypt();
  if (!s || !row.password_salt) return false;
  try { return await s.verify(String(pw), row.password_salt, row.password_hash); }
  catch (_) { return false; }
}

module.exports = { hashBcrypt, verificarPassword };
