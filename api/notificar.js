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
const { query } = require('./db'); // FERROCARRIL Etapa 10: usuarios/tokens desde Postgres

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
      const tecRows = await query("select id, nombre from mdtask_usuarios where datos->>'grupoTec' = 'true'");
      tecRows.rows.forEach(u => {
        uidsDestino.add(String(u.id));
        if (u.nombre) nombresDestino.add(norm(u.nombre));
      });
    }

    if (uidsDestino.size === 0 && nombresDestino.size === 0) {
      return res.json({ ok: true, enviados: 0, mensaje: 'Sin destinatarios.' });
    }

    // 4) Buscar tokens que coincidan (por id de doc, por uid, o por nombre).
    //    Nunca al emisor.
    const tokensRes = await query('select id, uid, usuario, token from mdtask_usuarios_tokens');
    const tokens = [];
    const idsPorToken = new Map();
    tokensRes.rows.forEach(row => {
      const t = row.token;
      if (typeof t !== 'string' || t.length <= 20) return;

      const docUid = row.uid ? String(row.uid) : '';
      const docId = String(row.id);
      const docNombre = norm(row.usuario);

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
      for (const t of tokensInvalidos) {
        const id = idsPorToken.get(t);
        if (id) await query('delete from mdtask_usuarios_tokens where id = $1', [String(id)]).catch(() => {});
      }
    }

    return res.json({ ok: true, enviados: exitosos, fallidos, tokensLimpiados: tokensInvalidos.length });
  } catch (e) {
    console.error('[notificar] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
