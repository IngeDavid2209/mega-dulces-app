// ============================================================================
//  Runner de migraciones SQL para Postgres.
//
//  Aplica, en orden, los archivos scripts/sql/*.sql que aún no se han corrido,
//  registrándolos en la tabla `_migraciones` (idempotente). Se ejecuta solo al
//  arrancar el server (server.js) si hay DATABASE_URL, así un redeploy crea las
//  tablas nuevas automáticamente. También se puede correr a mano:
//     node scripts/db-migrate.js
// ============================================================================
const fs = require('fs');
const path = require('path');
const { getPool, dbConfigurada } = require('../api/db');

async function migrar() {
  if (!dbConfigurada()) {
    console.log('[migrate] DATABASE_URL no configurada; se omite (la app sigue en Firebase).');
    return;
  }
  const pool = getPool();
  const client = await pool.connect();

  // Los `raise notice` de las migraciones se estaban PERDIENDO. Sin esto, el
  // unico rastro de una migracion era "aplicada", que solo dice que corrio sin
  // reventar — no si hizo algo. La 037 reparte puestos entre 186 personas y la
  // 038 corrige a una: "aplicada" se ve igual si acertaron a todas o a ninguna,
  // y una migracion que no encontro a nadie es exactamente el caso que hay que
  // detectar.
  client.on('notice', (n) => {
    const msg = (n && (n.message || n.detail)) || '';
    if (msg) console.log('[migrate][sql]', msg);
  });

  try {
    await client.query('create table if not exists _migraciones (id text primary key, aplicada_en bigint)');
    const dir = path.join(__dirname, 'sql');
    const archivos = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
      : [];
    for (const archivo of archivos) {
      const ya = await client.query('select 1 from _migraciones where id = $1', [archivo]);
      if (ya.rowCount > 0) continue;
      const sql = fs.readFileSync(path.join(dir, archivo), 'utf8');
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into _migraciones (id, aplicada_en) values ($1, $2)', [archivo, Date.now()]);
        await client.query('commit');
        console.log('[migrate] aplicada:', archivo);
      } catch (e) {
        await client.query('rollback').catch(() => {});
        console.error('[migrate] ERROR en', archivo, '-', e.message);
        throw e;
      }
    }
    console.log('[migrate] migraciones al día.');
  } finally {
    client.release();
  }
}

module.exports = { migrar };

if (require.main === module) {
  migrar().then(() => process.exit(0)).catch(() => process.exit(1));
}
