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
// El envío en sí vive en api/_push.js: los módulos del backend también avisan
// (Venta de Promos, por ejemplo) y no pueden pasar por aquí, que exige una
// petición del navegador con su sesión. Aquí queda lo propio del endpoint:
// validar quién llama, armar los destinatarios y contestar.
//
// Variables de entorno: FIREBASE_SERVICE_ACCOUNT.

const admin = require('firebase-admin');
const { query } = require('./db'); // FERROCARRIL Etapa 10: usuarios/tokens desde Postgres
const { enviarPush, norm } = require('./_push');

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

    const uids = (Array.isArray(body.uids) ? body.uids : []).filter(Boolean).map(String);
    const nombres = (Array.isArray(body.nombres) ? body.nombres : []).filter(Boolean).map(norm);

    // 3) grupoTec → sumar uids y nombres de todos los del grupo.
    if (body.grupoTec === true) {
      const tecRows = await query("select id, nombre from mdtask_usuarios where datos->>'grupoTec' = 'true'");
      tecRows.rows.forEach(u => {
        uids.push(String(u.id));
        if (u.nombre) nombres.push(norm(u.nombre));
      });
    }

    // 4) Enviar (nunca al emisor).
    const r = await enviarPush({
      uids, nombres, titulo, cuerpo, url, excluirUid: emisorUid,
    });

    if (r.mensaje) return res.json({ ok: true, enviados: 0, mensaje: r.mensaje });
    return res.json({
      ok: true, enviados: r.enviados, fallidos: r.fallidos,
      tokensLimpiados: r.tokensLimpiados,
    });
  } catch (e) {
    console.error('[notificar] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
