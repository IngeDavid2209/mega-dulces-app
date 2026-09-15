// ============================================================================
//  ¿A QUE BASE LE ESTOY HABLANDO?  —  diagnostico de conexion, SOLO LECTURA
//
//  POR QUE EXISTE. El 12/sep/2026 `diagnostico-regla-cumplimiento.js` y
//  `sembrar-plazas.js` abortaron los dos con CERO filas usando una DATABASE_URL
//  sacada de `railway variables -s Postgres`. Las guardias hicieron su trabajo
//  —distinguieron «no lei» de «no hay»— pero nadie podia decir POR QUE: un
//  `select ... from mdtask_usuarios` que devuelve 0 filas SIN error significa
//  que la tabla existe y esta vacia, o sea que la URL apunta a una base con el
//  esquema aplicado y sin datos. Eso no es produccion, y no habia forma de
//  confirmarlo sin abrir la credencial a mano.
//
//  Este script contesta esa pregunta y nada mas: nombre de la base, host,
//  puerto, usuario, y cuantas filas tiene cada tabla `mdtask_`. Con eso se
//  distingue en un vistazo la base buena (mdtask_usuarios ~150) de una vacia.
//
//  LO QUE NUNCA IMPRIME: la contrasena. La URL se parsea para sacar host,
//  puerto y base; el campo de password se descarta antes de imprimir nada.
//  (§8.7 del CLAUDE.md: las credenciales se toman del entorno en tiempo de
//  ejecucion, no se copian, no se registran.)
//
//  USO (PowerShell):
//    $env:DATABASE_URL = Read-Host "URL publica de Postgres"
//    node scripts/diagnostico-conexion.js
//
//  NO ESCRIBE NADA. Ni un insert, ni un update, ni un create.
// ============================================================================
const { query, dbConfigurada } = require('../api/db');
const { schemaDeMdtask } = require('./_schema-mdtask');

/**
 * Padding en JS, NO con printf.
 *
 * `util.format` (lo que usa console.log) no soporta el ancho de printf: un
 * '%-20s' se imprime LITERAL y el argumento se va al final de la linea. Este
 * archivo lo tenia en las dos lineas de la tabla de testigos, asi que la unica
 * tabla que el script produce salia ilegible — y una tabla rota se lee como un
 * dato malo, no como un formato malo. Es el mismo mordisco del 4/sep y el 7/sep.
 */
const izq = (s, n) => String(s == null ? '' : s).padEnd(n).slice(0, n);

// Las cinco que dicen si la base es la de produccion o una cascara vacia.
// `mdtask_usuarios` es la de referencia: la migracion 050 conto 150 activas.
const TESTIGO = [
  ['mdtask_usuarios', 150, 'la 050 conto 150 activas: aqui se ve si es la base buena'],
  ['mdtask_checklists', null, 'el trabajo emitido'],
  ['mdtask_plazas', 0, '3.1a las creo VACIAS a proposito: 0 es lo correcto hoy'],
  ['mdtask_coberturas', 0, 'igual que plazas'],
  ['_migraciones', null, 'cuantas migraciones corrio esta base'],
];

function abortar(msg) {
  console.error('\n[conexion] ABORTA: ' + msg);
  console.error('[conexion] No concluyas de esta corrida.');
  process.exit(1);
}

/** Host, puerto y base de la URL. La contrasena se descarta aqui y no sale. */
function coordenadaSinSecreto(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      puerto: u.port || '5432',
      base: (u.pathname || '').replace(/^\//, '') || '(sin nombre)',
      usuario: u.username || '(sin usuario)',
      // u.password existe y NO se lee.
    };
  } catch {
    return null;
  }
}

async function main() {
  if (!dbConfigurada()) {
    abortar('falta DATABASE_URL. Desde tu maquina usa la URL PUBLICA de Railway ' +
            '(railway.internal no resuelve fuera). Este script SOLO LEE.');
  }

  const decl = coordenadaSinSecreto(process.env.DATABASE_URL);
  if (!decl) abortar('la DATABASE_URL no se pudo interpretar como URL.');

  console.log('\n=== A DONDE APUNTA LA VARIABLE (segun la URL, sin la contrasena) ===');
  console.log('  host    %s', decl.host);
  console.log('  puerto  %s', decl.puerto);
  console.log('  base    %s', decl.base);
  console.log('  usuario %s', decl.usuario);

  // Lo que la base dice de si misma. Si no coincide con lo de arriba, hay un
  // proxy o un redirect de por medio y conviene verlo.
  let ident;
  try {
    ident = (await query(
      'select current_database() as base, current_user as usuario, version() as version'
    )).rows[0];
  } catch (e) {
    abortar('no se pudo conectar ni ejecutar la consulta mas simple: ' + (e && e.message));
  }

  console.log('\n=== LO QUE LA BASE DICE DE SI MISMA ===');
  console.log('  base    %s', ident.base);
  console.log('  usuario %s', ident.usuario);
  console.log('  version %s', String(ident.version).split(',')[0]);
  if (ident.base !== decl.base) {
    console.log('  OJO: la URL dice "%s" y la base responde "%s".', decl.base, ident.base);
  }

  // ── EL SCHEMA SE BUSCA. Este era EL defecto de este archivo ───────────────
  // Hasta el 15/sep esta consulta filtraba por `table_schema = 'public'`, y por
  // eso el 14/sep este script llego a decir «ESTA NO ES LA BASE DE PRODUCCION»
  // sobre la base que SI lo era: las tablas de MDTask viven en `eajd` y en
  // `public` quedaron 13 cascaras vacias con migraciones de mayo. El script
  // escrito para resolver la duda la estaba CREANDO.
  let S;
  try {
    S = (await schemaDeMdtask(query, { prefijo: '[conexion]' })).schema;
  } catch (e) {
    console.log('\n=== ESQUEMA ===');
    console.log('  ' + e.message);
    abortar('no hay un schema de MDTask utilizable en esta base.');
  }

  const tablas = (await query(
    `select table_name from information_schema.tables
      where table_schema = $1 and table_name like 'mdtask\\_%'
      order by table_name`, [S]
  )).rows.map(r => r.table_name);

  console.log('\n=== ESQUEMA ===');
  console.log('  schema en uso .............. %s', S);
  console.log('  tablas mdtask_ ahi ......... %d', tablas.length);
  if (tablas.length === 0) {
    console.log('  CERO tablas mdtask_. Esta base no es de MDTask: puede ser la de otra');
    console.log('  app del Postgres compartido, o la de Mega Talento (que NO se toca).');
  }

  console.log('\n=== FILAS EN LAS TABLAS TESTIGO ===');
  let usuarios = null;
  for (const [tabla, esperado, nota] of TESTIGO) {
    let n;
    try {
      n = Number((await query('select count(*)::int as n from "' + S + '".' + tabla)).rows[0].n);
    } catch (e) {
      console.log('  ' + izq(tabla, 20) + '  NO EXISTE  (' + (e && e.message || '').split('\n')[0] + ')');
      continue;
    }
    if (tabla === 'mdtask_usuarios') usuarios = n;
    const ref = esperado === null ? '' : '  [se esperaba ~' + esperado + ']';
    console.log('  ' + izq(tabla, 20) + '  ' + String(n).padStart(7) + ref + '  · ' + nota);
  }

  // El veredicto, que es la unica razon de ser del script. Se apoya en la tabla
  // de usuarios porque es la que la 050 dejo medida: 150 activas.
  console.log('\n=== VEREDICTO ===');
  if (usuarios === null) {
    console.log('  NO SE PUDO LEER mdtask_usuarios. Esta base no sirve para los diagnosticos.');
    process.exit(2);
  }
  // Desde el 15/sep este caso es DEFENSA EN PROFUNDIDAD, no el camino normal:
  // `schemaDeMdtask` mide por `mdtask_usuarios` y ya aborta con TODOS_VACIOS
  // antes de llegar aqui. Se conserva porque vuelve a ser alcanzable en cuanto
  // alguien le cambie la tabla testigo al modulo, y porque un veredicto que
  // depende de que otro archivo siga comportandose igual es justo el que hay
  // que dejar escrito. Queda anotado para que nadie lo lea como la via principal.
  if (usuarios === 0) {
    console.log('  ESTA NO ES LA BASE DE PRODUCCION: el esquema esta aplicado (%d tablas)', tablas.length);
    console.log('  pero mdtask_usuarios tiene CERO filas. Es una base migrada y vacia.');
    console.log('  Busca otro servicio Postgres o otro entorno en el proyecto de Railway.');
    process.exit(2);
  }
  if (usuarios < 50) {
    console.log('  DUDOSA: %d usuarios. La 050 conto 150 activas sobre ~189 filas de nomina.', usuarios);
    console.log('  Con esta distancia no corras los diagnosticos: revisa primero cual base es.');
    process.exit(2);
  }
  console.log('  PARECE LA BUENA: %d usuarios, %d tablas mdtask_.', usuarios, tablas.length);
  console.log('  Ya puedes correr diagnostico-regla-cumplimiento.js y sembrar-plazas.js.');
}

main().catch(e => abortar('excepcion: ' + ((e && e.stack) || String(e))));
