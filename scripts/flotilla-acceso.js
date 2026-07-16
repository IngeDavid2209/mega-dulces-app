// ============================================================================
//  Activa (o inspecciona) el acceso al modulo FLOTILLA para usuarios concretos.
//
//  El modulo /flotilla es visible SOLO para quien tenga `grupoFlotilla: true`
//  en su perfil (ni siquiera los admins lo ven por ser admin). Este script
//  prende esa bandera para la lista de usuarios indicada.
//
//  Config por variables de entorno:
//    USUARIOS   lista separada por comas de "usuario" (el login), por defecto:
//               'admin,luis.lopez,guillermo.lopez'
//    APLICAR=1  para escribir de verdad (sin el, es DRY-RUN: solo muestra).
//
//  Uso (DATABASE_URL la inyecta Railway):
//    DRY-RUN:  railway run bash -c "node scripts/flotilla-acceso.js"
//    APLICAR:  railway run bash -c "APLICAR=1 node scripts/flotilla-acceso.js"
//    Otros:    railway run bash -c "APLICAR=1 USUARIOS=admin,otro.usuario node scripts/flotilla-acceso.js"
// ============================================================================
const { query, dbConfigurada } = require('../api/db');

const APLICAR = process.env.APLICAR === '1';
const USUARIOS = (process.env.USUARIOS || 'admin,luis.lopez,guillermo.lopez')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

(async () => {
  if (!dbConfigurada()) {
    console.error('DATABASE_URL no configurada. Corre con: railway run bash -c "node scripts/flotilla-acceso.js"');
    process.exit(1);
  }

  console.log(APLICAR ? '== MODO APLICAR (escribe) ==' : '== DRY-RUN (no cambia nada) ==');
  console.log('Usuarios objetivo:', USUARIOS.join(', '), '\n');

  // Busca por la COLUMNA `usuario` (el login), sin distinguir mayusculas. Trae
  // rol y grupoFlotilla actuales para saber en que estado esta. OJO: `usuario`,
  // `correo` y `rol` son columnas reales; las banderas (grupoTec/grupoFlotilla)
  // viven dentro del jsonb `datos`.
  const r = await query(
    `select id, nombre,
            lower(usuario) as usuario,
            rol,
            coalesce(datos->>'grupoFlotilla','') as grupo_flotilla
       from mdtask_usuarios
      where lower(usuario) = any($1)`,
    [USUARIOS]
  );

  const encontrados = new Set(r.rows.map(x => x.usuario));
  const faltan = USUARIOS.filter(u => !encontrados.has(u));

  console.log('Encontrados en la base:');
  r.rows.forEach(x => {
    console.log(`  - ${x.usuario} | ${x.nombre} | rol=${x.rol || '(sin rol)'} | grupoFlotilla=${x.grupo_flotilla || 'false'} | id=${x.id}`);
  });
  if (faltan.length) console.log('  (!) NO encontrados:', faltan.join(', '));
  console.log('');

  if (!APLICAR) {
    console.log('DRY-RUN: no se escribio nada. Vuelve a correr con APLICAR=1 para prender grupoFlotilla.');
    process.exit(0);
  }

  // Prende grupoFlotilla=true en el jsonb `datos`, conservando lo demas.
  const upd = await query(
    `update mdtask_usuarios
        set datos = jsonb_set(coalesce(datos,'{}'::jsonb), '{grupoFlotilla}', 'true'::jsonb)
      where lower(usuario) = any($1)
      returning lower(usuario) as usuario, datos->>'grupoFlotilla' as grupo_flotilla`,
    [USUARIOS]
  );
  console.log('Actualizados (grupoFlotilla=true):');
  upd.rows.forEach(x => console.log(`  - ${x.usuario} -> grupoFlotilla=${x.grupo_flotilla}`));
  console.log('\nListo. Los usuarios veran Flotilla en su proximo ingreso (o al refrescar sesion).');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e && e.message); process.exit(1); });
