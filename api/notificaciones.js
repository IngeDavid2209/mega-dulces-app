// API de `notificaciones` (campana de alertas/zumbidos) sobre Postgres.
//   GET    /api/notificaciones?empleado=NOMBRE -> alertas NO leídas de ese empleado
//   POST   /api/notificaciones                 -> crea { empleado, mensaje, de }
//   PATCH  /api/notificaciones                 -> { id } marca como leída
const crypto = require('crypto');
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

function fila(r) {
  return { id: r.id, empleado: r.empleado, de: r.de, mensaje: r.mensaje, leido: r.leido, timestamp: r.timestamp != null ? Number(r.timestamp) : null };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  try { await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  try {
    if (req.method === 'GET') {
      const empleado = req.query?.empleado;
      if (!empleado) return res.json({ notificaciones: [] });
      const r = await query(
        'select * from notificaciones where empleado = $1 and leido = false order by timestamp asc',
        [String(empleado)]
      );
      return res.json({ notificaciones: r.rows.map(fila) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      if (!b.empleado || !String(b.mensaje || '').trim()) return res.status(400).json({ error: 'Faltan datos.' });
      const id = 'noti_' + Date.now() + '_' + crypto.randomUUID().slice(0, 8);
      const r = await query(
        `insert into notificaciones (id, empleado, de, mensaje, leido, timestamp)
         values ($1,$2,$3,$4,false,$5) returning *`,
        [id, String(b.empleado), b.de || null, String(b.mensaje).trim(), Date.now()]
      );
      return res.json({ notificacion: fila(r.rows[0]) });
    }

    if (req.method === 'PATCH') {
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ error: 'Falta id.' });
      await query('update notificaciones set leido = true where id = $1', [String(b.id)]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('[notificaciones] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
