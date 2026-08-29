// ============================================================================
//  HORARIOS REALES DE LAS SUCURSALES · leídos de Mega Talento
//
//  ─── QUÉ RESUELVE ─────────────────────────────────────────────────────────
//  El robot del manual necesita saber a qué hora abre cada sucursal para poner
//  la hora límite de las tareas de apertura. Hasta hoy usaba las 12:00, que NO
//  salió de ningún manual: la inventé yo. Con una hora inventada, media
//  plantilla amanece con tareas vencidas que nunca llegaron tarde.
//
//  La hora real ya existe y es de RH: la tabla `horarios_sucursal` del módulo
//  de checador de Mega Talento, que vive en ESTA MISMA base de Postgres
//  (mismo proyecto de Railway, mismo DATABASE_URL — lo dice su DEPLOY).
//
//  ─── ESTE ENDPOINT SOLO LEE ───────────────────────────────────────────────
//  Y es a propósito. Esa tabla es de RH y de ella cuelga el control de
//  asistencia de la empresa: si MDTask pudiera escribirle, un error de esta app
//  se convertiría en un descuento mal hecho en la nómina de alguien. Cualquier
//  método que no sea GET se rechaza aquí mismo, antes de tocar la base.
//
//  Los horarios de apertura no son dato personal —están en la puerta—, así que
//  esto devuelve horarios y nada más: ni checadas, ni empleados, ni códigos de
//  reloj. Nada de lo que hay en las otras tablas del checador pasa por aquí.
// ============================================================================
const { Pool } = require('pg');

// ─── DE DONDE SE LEEN ───────────────────────────────────────────────────────
// Mega Talento NO comparte la base de MDTask, aunque vivan en el mismo proyecto
// de Railway: el 2026-08-29 este mismo endpoint lo comprobo devolviendo 42P01
// (la tabla no existe aqui). Necesita su propia cadena.
//
// TALENTO_DATABASE_URL se pone en Railway como REFERENCIA —${{Postgres.DATABASE_URL}}—
// para que la contrasena nunca pase por un archivo, un chat ni un historial de
// comandos: Railway la resuelve en el arranque y nadie llega a verla.
//
// Sin la variable esto no truena: contesta que no esta configurado y el robot
// sigue con su hora por defecto. Un horario que falta no puede tumbar la app.
const TALENTO_URL = process.env.TALENTO_DATABASE_URL || '';

let pool = null;
function talento() {
  if (!TALENTO_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: TALENTO_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,                          // esto solo lee un punado de filas al dia
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 8000,
    });
    pool.on('error', (e) => console.error('[horarios-sucursal] pool:', e.message));
  }
  return pool;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Candado de solo lectura. La tabla es de RH.
  if (req.method !== 'GET') {
    return res.status(405).json({
      ok: false,
      error: 'Solo lectura: los horarios se editan en Mega Talento, no aquí.',
    });
  }

  const p = talento();
  if (!p) {
    return res.json({
      ok: false,
      configured: false,
      items: [],
      mensaje: 'Falta TALENTO_DATABASE_URL: todavia no hay lectura de horarios.',
    });
  }

  try {
    const r = await p.query(`
      SELECT sucursal_id, area_id, nombre, dias, entrada,
             inicio_comida, fin_comida, salida, tolerancia_min, activo
        FROM horarios_sucursal
       WHERE activo = TRUE
       ORDER BY sucursal_id, area_id NULLS FIRST, entrada
    `);
    return res.json({ ok: true, configured: true, items: r.rows });
  } catch (e) {
    const msg = (e && e.message) || 'Error de consulta';

    // 42P01 = la tabla no existe. Significa que Mega Talento NO comparte esta
    // base, y entonces esto necesita otra vía (su API). Se dice con claridad en
    // vez de devolver un 500 que parecería una caída.
    if (e && e.code === '42P01') {
      return res.json({
        ok: false,
        configured: true,
        tablaPresente: false,
        items: [],
        mensaje: 'TALENTO_DATABASE_URL apunta a una base que no tiene horarios_sucursal.',
      });
    }
    return res.status(500).json({ ok: false, configured: true, error: msg });
  }
};
