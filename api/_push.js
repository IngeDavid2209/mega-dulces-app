// ============================================================================
//  PUSH VISIBLE — el aviso propio de la app (FCM), reutilizable desde el server.
//
//  Esto salio de api/notificar.js, que era el unico que sabia mandar un push y
//  solo se podia llamar por HTTP. Los modulos del backend (Venta de Promos, por
//  ejemplo) necesitan avisar SIN pasar por una peticion del navegador, asi que
//  la mecanica vive aqui y notificar.js se quedo con lo suyo: validar la sesion
//  y contestar. Una sola copia de la logica.
//
//  Es un push DATA-ONLY a proposito: lo pinta el Service Worker
//  (firebase-messaging-sw.js). Con `notification` el navegador ademas pinta el
//  suyo y en web salen DOS avisos por el mismo hecho.
//
//  Variables de entorno: FIREBASE_SERVICE_ACCOUNT.
// ============================================================================
const admin = require('firebase-admin');
const { query } = require('./db');

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

/** Nombre comparable: sin acentos, sin mayusculas, sin espacios de sobra. */
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Manda un push visible a los dispositivos registrados de unos destinatarios.
 *
 *   uids        lista de uids destino
 *   nombres     lista de nombres destino (compatibilidad con tokens viejos,
 *               que se indexaron por nombre y no por uid)
 *   excluirUid  a quien NO avisarle: normalmente quien provoco el aviso, que no
 *               tiene por que recibir noticia de lo que acaba de hacer
 *
 * Devuelve { enviados, fallidos, tokensLimpiados }. No lanza por un destinatario
 * sin dispositivo: eso es normal, no un error.
 */
async function enviarPush({ uids = [], nombres = [], titulo, cuerpo, url = '/', excluirUid = null }) {
  inicializar();

  const tit = String(titulo || '').trim();
  const cue = String(cuerpo || '').trim();
  if (!tit || !cue) throw new Error('Faltan titulo y/o cuerpo.');

  const uidsDestino = new Set((Array.isArray(uids) ? uids : []).filter(Boolean).map(String));
  const nombresDestino = new Set((Array.isArray(nombres) ? nombres : []).filter(Boolean).map(norm));
  if (uidsDestino.size === 0 && nombresDestino.size === 0) {
    return { enviados: 0, fallidos: 0, tokensLimpiados: 0, mensaje: 'Sin destinatarios.' };
  }

  // Tokens que coinciden por id de doc, por uid o por nombre.
  const tokensRes = await query('select id, uid, usuario, token from mdtask_usuarios_tokens');
  const tokens = [];
  const idsPorToken = new Map();
  tokensRes.rows.forEach(row => {
    const t = row.token;
    if (typeof t !== 'string' || t.length <= 20) return;

    const docUid = row.uid ? String(row.uid) : '';
    const docId = String(row.id);
    const docNombre = norm(row.usuario);

    if (excluirUid && ((docUid && docUid === excluirUid) || docId === excluirUid)) return;

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
    return {
      enviados: 0, fallidos: 0, tokensLimpiados: 0,
      mensaje: 'Los destinatarios no tienen dispositivos registrados.',
    };
  }

  let exitosos = 0, fallidos = 0;
  const tokensInvalidos = [];

  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const respuesta = await admin.messaging().sendEachForMulticast({
      tokens: chunk,
      data: {
        tipo: 'aviso',
        title: tit,
        body: cue,
        url: String(url || '/') || '/',
        timestamp: String(Date.now()),
      },
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

  // Limpiar tokens muertos (no bloqueante: si falla, se vuelve a intentar solo
  // la proxima vez que ese token rebote).
  for (const t of tokensInvalidos) {
    const id = idsPorToken.get(t);
    if (id) await query('delete from mdtask_usuarios_tokens where id = $1', [String(id)]).catch(() => {});
  }

  return { enviados: exitosos, fallidos, tokensLimpiados: tokensInvalidos.length };
}

module.exports = { enviarPush, norm };
