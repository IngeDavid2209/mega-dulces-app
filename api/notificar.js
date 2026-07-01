// Endpoint: NOTIFICAR — envía una notificación PUSH VISIBLE a usuarios concretos.
//
// Lo usa la app para avisos como "nueva tarea asignada" o "nuevo mensaje en el
// Espacio TEC". A diferencia de /api/notify-update (push SILENCIOSO de versión),
// este manda una notificación que el usuario VE en su celular aunque tenga la
// app cerrada.
//
// Body (JSON):
//   titulo   (string, requerido)  -> título de la notificación
//   cuerpo   (string, requerido)  -> texto de la notificación
//   url      (string, opcional)   -> ruta a abrir al tocarla (ej. "/checklist")
//   uids     (string[], opcional) -> uids destino
//   nombres  (string[], opcional) -> nombres destino (compatibilidad token viejo)
//   grupoTec (bool, opcional)     -> además, todos los del grupo TEC
//
// Al emisor NUNCA se le notifica a sí mismo.
//
// Variables de entorno: FIREBASE_SERVICE_ACCOUNT.

const admin = require('firebase-admin');

let inicializado = false;
function inicializar() {
  if (inicializado) return;
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Falta variable FIREBASE_SERVICE_ACCOUNT en las variables de entorno.');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  inicializado = true;
}

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    inicializar();

    // 1) Validar sesión (cualquier usuario autenticado puede disparar un aviso).
    const authHeader = String(req.headers['authorization'] || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Falta Authorization Bearer token' });
    const decoded = await admin.auth().verifyIdToken(idToken);
    const emisorUid = decoded.uid;

    const db = admin.firestore();

    // 2) Leer parámetros
    const body = req.body || {};
    const titulo = String(body.titulo || '').trim();
    const cuerpo = String(body.cuerpo || '').trim();
    const url = String(body.url || '/').trim() || '/';
    if (!titulo || !cuerpo) return res.status(400).json({ error: 'Faltan titulo y/o cuerpo.' });

    const uidsDestino = new Set((Array.isArray(body.uids) ? body.uids : []).filter(Boolean).map(String));
    const nombresDestino = new Set((Array.isArray(body.nombres) ? body.nombres : []).filter(Boolean).map(norm));

    // 3) grupoTec → sumar uids y nombres de todos los del grupo.
    if (body.grupoTec === true) {
      const tecSnap = await db.collection('usuarios').where('grupoTec', '==', true).get();
      tecSnap.forEach(d => {
        uidsDestino.add(String(d.id));
        const n = (d.data() || {}).nombre;
        if (n) nombresDestino.add(norm(n));
      });
    }

    if (uidsDestino.size === 0 && nombresDestino.size === 0) {
      return res.json({ ok: true, enviados: 0, mensaje: 'Sin destinatarios.' });
    }

    // 4) Buscar tokens que coincidan (por id de doc, por uid, o por nombre).
    //    Nunca al emisor.
    const tokensSnap = await db.collection('usuarios_tokens').get();
    const tokens = [];
    const idsPorToken = new Map();
    tokensSnap.forEach(d => {
      const data = d.data() || {};
      const t = data.token;
      if (typeof t !== 'string' || t.length <= 20) return;

      const docUid = data.uid ? String(data.uid) : '';
      const docId = String(d.id);
      const docNombre = norm(data.usuario);

      const esEmisor = (docUid && docUid === emisorUid) || docId === emisorUid;
      if (esEmisor) return;

      const coincide =
        (docUid && uidsDestino.has(docUid)) ||
        uidsDestino.has(docId) ||
        (docNombre && nombresDestino.has(docNombre));

      if (coincide) {
        tokens.push(t);
        idsPorToken.set(t, docId);
      }
    });

    if (tokens.length === 0) {
      return res.json({ ok: true, enviados: 0, mensaje: 'Los destinatarios no tienen dispositivos registrados.' });
    }

    // 5) Enviar notificación VISIBLE (data-only: el Service Worker la muestra).
    //    Usamos data en vez de "notification" para controlar el render en el SW
    //    y evitar notificaciones duplicadas en web.
    let exitosos = 0, fallidos = 0;
    const tokensInvalidos = [];

    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      const respuesta = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        data: {
          tipo: 'aviso',
          title: titulo,
          body: cuerpo,
          url,
          timestamp: String(Date.now())
        }
      });
      exitosos += respuesta.successCount;
      fallidos += respuesta.failureCount;
      respuesta.responses.forEach((r, idx) => {
        if (!r.success) {
          const codigo = (r.error && r.error.code) || '';
          if (codigo.indexOf('registration-token-not-registered') >= 0 ||
              codigo.indexOf('invalid-registration-token') >= 0) {
            tokensInvalidos.push(chunk[idx]);
          }
        }
      });
    }

    // 6) Limpiar tokens muertos (no bloqueante).
    if (tokensInvalidos.length > 0) {
      const batch = db.batch();
      tokensInvalidos.forEach(t => {
        const id = idsPorToken.get(t);
        if (id) batch.delete(db.collection('usuarios_tokens').doc(id));
      });
      batch.commit().catch(() => {});
    }

    return res.json({ ok: true, enviados: exitosos, fallidos, tokensLimpiados: tokensInvalidos.length });
  } catch (e) {
    console.error('[notificar] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
