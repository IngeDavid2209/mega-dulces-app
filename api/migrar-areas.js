// Traslado de datos de la colección Firestore `areas` a Postgres (idempotente).
// Autorizado por secreto de migración (o token admin). Corre dentro de Railway.
//   curl -X POST -H "x-migracion-secret: <SECRET>" \
//        https://mdtask-production.up.railway.app/api/migrar-areas
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
    const snap = await admin.firestore().collection('areas').get();
    let copiadas = 0;
    for (const d of snap.docs) {
      const data = d.data() || {};
      const nombre = data.nombre || data.name || null;
      await query(
        `insert into areas (id, nombre, datos) values ($1, $2, $3)
         on conflict (id) do update set nombre = excluded.nombre, datos = excluded.datos`,
        [d.id, nombre, JSON.stringify(data)]
      );
      copiadas++;
    }
    return res.json({ ok: true, copiadas });
  } catch (e) {
    console.error('[migrar-areas] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
