// Crea el PRIMER administrador del sistema. Solo necesario UNA VEZ, despues
// del primer despliegue. A partir de ese punto, los siguientes usuarios se
// crean desde la UI con el endpoint POST /api/auth/register (que requiere
// admin autenticado).
//
// Uso:
//   npm run seed:admin
// con variables de entorno SEED_USUARIO, SEED_NOMBRE, SEED_CORREO, SEED_PASSWORD.
// Si faltan, el script las pide por stdin (modo interactivo).
//
// Es idempotente: si el usuario ya existe NO lo sobreescribe — solo informa.
import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { prisma } from '../src/services/prisma.js';
import { hashPassword } from '../src/utils/password.js';

async function preguntar(rl: ReturnType<typeof createInterface>, mensaje: string, defecto?: string): Promise<string> {
  const sufijo = defecto ? ` [${defecto}]` : '';
  const respuesta = (await rl.question(`${mensaje}${sufijo}: `)).trim();
  return respuesta || defecto || '';
}

async function main(): Promise<void> {
  const env = process.env;
  let usuario  = env.SEED_USUARIO  || '';
  let nombre   = env.SEED_NOMBRE   || '';
  let correo   = env.SEED_CORREO   || '';
  let password = env.SEED_PASSWORD || '';

  // Modo interactivo si falta cualquiera
  if (!usuario || !nombre || !correo || !password) {
    const rl = createInterface({ input, output });
    if (!usuario)  usuario  = await preguntar(rl, 'Login del admin (ej. admin)',  'admin');
    if (!nombre)   nombre   = await preguntar(rl, 'Nombre completo',              'Administrador');
    if (!correo)   correo   = await preguntar(rl, 'Correo electronico',           '');
    if (!password) password = await preguntar(rl, 'Password (>= 6 chars)',         '');
    rl.close();
  }

  if (!usuario || !nombre || !password) {
    console.error('[seed-admin] usuario, nombre y password son obligatorios. Aborto.');
    process.exit(1);
  }

  const ya = await prisma.usuario.findUnique({ where: { usuario: usuario.toLowerCase() } });
  if (ya) {
    console.log(`[seed-admin] Ya existe un usuario con login "${usuario}" (id=${ya.id}, rol=${ya.rol}).`);
    console.log('[seed-admin] No se modifica nada. Si quieres resetear su password, hazlo desde la UI o por SQL.');
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await hashPassword(password);
  const creado = await prisma.usuario.create({
    data: {
      usuario: usuario.toLowerCase(),
      nombre,
      correo: correo || null,
      passwordHash,
      rol: 'admin',
      alcance: 'global',
    },
  });

  console.log('[seed-admin] Admin creado correctamente.');
  console.log(`  id:      ${creado.id}`);
  console.log(`  usuario: ${creado.usuario}`);
  console.log(`  nombre:  ${creado.nombre}`);
  console.log(`  rol:     ${creado.rol} (alcance ${creado.alcance})`);
  console.log('');
  console.log('Ahora puedes hacer login en POST /api/auth/login con:');
  console.log(`  { "usuario": "${creado.usuario}", "password": "***" }`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[seed-admin] Error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
