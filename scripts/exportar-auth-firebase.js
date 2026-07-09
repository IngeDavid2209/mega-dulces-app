// ============================================================================
//  Exporta las credenciales de Firebase Auth a Postgres (una sola vez, para el
//  cutover de auth). Usa admin.auth().listUsers() — es Firebase AUTH, ajeno a la
//  cuota de Firestore — y copia passwordHash + passwordSalt de cada usuario a
//  mdtask_usuarios (password_algo='firebase-scrypt'), casando por uid (= id).
//
//  Correr (una vez), con FIREBASE_SERVICE_ACCOUNT + DATABASE_URL en el entorno:
//    railway run --service MDTask -- node scripts/exportar-auth-firebase.js
//  o local contra la URL pública:
//    railway run --service MDTask -- bash -c 'export DATABASE_URL="<PUBLIC_URL>"; node scripts/exportar-auth-firebase.js'
//
//  Idempotente: solo pisa filas que aún no tienen bcrypt (no borra contraseñas
//  ya cambiadas tras el cutover).
// ============================================================================
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('../api/db');

async function main() {
  if (!dbConfigurada()) throw new Error('DATABASE_URL no configurada');
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }

  let nextPageToken;
  let total = 0, conHash = 0, actualizados = 0, sinFila = 0;
  do {
    const res = await admin.auth().listUsers(1000, nextPageToken);
    for (const u of res.users) {
      total++;
      if (!u.passwordHash || !u.passwordSalt) continue; // no creado con correo/contraseña
      conHash++;
      const upd = await query(
        `update mdtask_usuarios
           set password_hash = $2, password_salt = $3, password_algo = 'firebase-scrypt'
         where id = $1 and (password_algo is null or password_algo = 'firebase-scrypt')`,
        [u.uid, u.passwordHash, u.passwordSalt]
      );
      if (upd.rowCount) actualizados++; else sinFila++;
    }
    nextPageToken = res.pageToken;
  } while (nextPageToken);

  console.log(`[export-auth] usuarios en Firebase: ${total} | con hash: ${conHash} | filas PG actualizadas: ${actualizados} | sin fila PG o ya-bcrypt: ${sinFila}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌ [export-auth]', e && e.message); process.exit(1); });
