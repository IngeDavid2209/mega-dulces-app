// Traslado de la colección Firestore `notificaciones` a Postgres (idempotente).
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('./db');
const { autorizarMigracion } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-migracion-secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!dbConfigurada()) return res.status(503).json({ error: 'DATABASE_URL no configurada.' });

  try { await autorizarMigracion(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  try {
    const snap = await admin.firestore().collection('notificaciones').get();
    let copiadas = 0;
    for (const d of snap.docs) {
      const n = d.data() || {};
      await query(
        `insert into notificaciones (id, empleado, de, mensaje, leido, timestamp)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (id) do update set
           empleado = excluded.empleado, de = excluded.de, mensaje = excluded.mensaje,
           leido = excluded.leido, timestamp = excluded.timestamp`,
        [d.id, n.empleado || null, n.de || null, n.mensaje || '', !!n.leido, Number(n.timestamp) || null]
      );
      copiadas++;
    }
    return res.json({ ok: true, copiadas });
  } catch (e) {
    console.error('[migrar-notificaciones] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
