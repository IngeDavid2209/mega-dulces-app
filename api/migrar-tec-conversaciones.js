// Traslado de la colección Firestore `tec_conversaciones` a Postgres (idempotente).
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
    const snap = await admin.firestore().collection('tec_conversaciones').get();
    let copiadas = 0;
    for (const d of snap.docs) {
      const n = d.data() || {};
      await query(
        `insert into tec_conversaciones (id, texto, autor, autor_uid, creado_en, editado_en, respuestas)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (id) do update set
           texto = excluded.texto, autor = excluded.autor, autor_uid = excluded.autor_uid,
           creado_en = excluded.creado_en, editado_en = excluded.editado_en, respuestas = excluded.respuestas`,
        [d.id, n.texto || '', n.autor || null, n.autorUid || null,
         Number(n.creadoEn) || null, Number(n.editadoEn) || null,
         JSON.stringify(Array.isArray(n.respuestas) ? n.respuestas : [])]
      );
      copiadas++;
    }
    return res.json({ ok: true, copiadas });
  } catch (e) {
    console.error('[migrar-tec-conversaciones] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
