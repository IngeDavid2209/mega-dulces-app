// ============================================================================
//  Capa de acceso a Postgres (node-postgres / pg) — Fase 0 de la migración.
//
//  LAZY y a prueba de fallos: si no existe la variable DATABASE_URL todavía,
//  NO crea el pool ni truena el arranque del servidor. Así podemos desplegar
//  este código antes de que el Postgres exista, y se activa solo cuando se
//  configure DATABASE_URL en Railway.
//
//  La base de datos convivirá con Firestore durante la migración por fases.
// ============================================================================
const { Pool } = require('pg');

let pool = null;

/** ¿Ya está configurada la conexión a Postgres? */
function dbConfigurada() {
  return !!process.env.DATABASE_URL;
}

/** Devuelve el pool (creándolo la primera vez) o null si no hay DATABASE_URL. */
function getPool() {
  if (!dbConfigurada()) return null;
  if (!pool) {
    const url = process.env.DATABASE_URL;
    // En Railway, la conexión interna (host *.railway.internal) NO usa SSL;
    // una URL pública sí lo requiere.
    const esInterna = /railway\.internal/.test(url);
    pool = new Pool({
      connectionString: url,
      ssl: esInterna ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', (e) => console.error('[db] error en el pool de Postgres:', e.message));
  }
  return pool;
}

/** Ejecuta una consulta parametrizada. Lanza si no hay DATABASE_URL. */
async function query(text, params) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL no configurada');
  return p.query(text, params);
}

module.exports = { getPool, query, dbConfigurada };
