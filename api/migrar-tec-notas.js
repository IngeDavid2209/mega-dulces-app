// ============================================================================
//  Traslado de datos de la colección Firestore `tec_notas` a Postgres.
//  Fase 1 de la migración. Se corre UNA vez (idempotente: upsert por id) cuando
//  ya existe el Postgres. Solo administradores.
//
//  Corre DENTRO de Railway (tiene DATABASE_URL interno + FIREBASE_SERVICE_ACCOUNT):
//     curl -X POST -H "Authorization: Bearer <idToken-admin>" \
//          https://mdtask-production.up.railway.app/api/migrar-tec-notas
// ============================================================================
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!dbConfigurada()) return res.status(503).json({ error: 'DATABASE_URL no configurada.' });

  // 1) Validar admin (verificarToken ya inicializa firebase-admin).
  let user;
  try { user = await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }
  const perfil = (await admin.firestore().collection('usuarios').doc(user.uid).get()).data() || {};
  if (perfil.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores.' });

  try {
    // 2) Leer todas las notas de Firestore.
    const snap = await admin.firestore().collection('tec_notas').get();
    let copiadas = 0;
    for (const d of snap.docs) {
      const n = d.data() || {};
      // 3) Upsert por id (idempotente: se puede correr varias veces sin duplicar).
      await query(
        `insert into tec_notas (id, titulo, texto, autor, autor_uid, creado_en, actualizado_en)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (id) do update set
           titulo = excluded.titulo, texto = excluded.texto, autor = excluded.autor,
           autor_uid = excluded.autor_uid, creado_en = excluded.creado_en,
           actualizado_en = excluded.actualizado_en`,
        [d.id, n.titulo || '', n.texto || '', n.autor || null, n.autorUid || null,
         Number(n.creadoEn) || null, Number(n.actualizadoEn) || Number(n.creadoEn) || null]
      );
      copiadas++;
    }
    return res.json({ ok: true, copiadas });
  } catch (e) {
    console.error('[migrar-tec-notas] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
