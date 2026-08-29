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
const { query, dbConfigurada } = require('./db');

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

  if (!dbConfigurada()) {
    return res.json({ ok: false, configured: false, items: [] });
  }

  try {
    const r = await query(`
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
        baseCompartida: false,
        items: [],
        mensaje: 'La tabla horarios_sucursal no está en esta base: Mega Talento usa otra.',
      });
    }
    return res.status(500).json({ ok: false, configured: true, error: msg });
  }
};
