/**
 * Endpoint serverless de Vercel para empujar "actualización disponible" a todos
 * los dispositivos vía Firebase Cloud Messaging (FCM).
 *
 * Solo admins pueden invocarlo: el cliente debe enviar su Firebase Auth ID Token
 * en el header Authorization. El endpoint lo verifica con firebase-admin y luego
 * consulta el rol del usuario en Firestore.
 *
 * Variable de entorno requerida (configurada en Vercel):
 *   FIREBASE_SERVICE_ACCOUNT = JSON completo del service account.
 */
import * as admin from 'firebase-admin';

// Tipo genérico para evitar dependencia de @vercel/node (Vercel infla req/res
// con los métodos típicos de Node http.IncomingMessage / ServerResponse).
type Req = any;
type Res = any;

let inicializado = false;
function inicializar() {
  if (inicializado) return;
  const raw = process.env['FIREBASE_SERVICE_ACCOUNT'];
  if (!raw) throw new Error('Falta variable de entorno FIREBASE_SERVICE_ACCOUNT en Vercel.');
  const sa = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  inicializado = true;
}

export default async function handler(req: Req, res: Res) {
  // CORS básico (la app y el endpoint viven en el mismo dominio de Vercel,
  // pero por si acaso permitimos preflight).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    inicializar();

    // 1) Verificar que quien llama es un admin autenticado.
    const authHeader = String(req.headers['authorization'] || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Falta Authorization Bearer token' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const perfilSnap = await admin.firestore().collection('usuarios').doc(decoded.uid).get();
    const perfil: any = perfilSnap.data() || {};
    if (perfil.rol !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden enviar push de actualización.' });
    }

    // 2) Cargar todos los tokens FCM guardados.
    const tokensSnap = await admin.firestore().collection('usuarios_tokens').get();
    const tokens: string[] = [];
    const idsPorToken = new Map<string, string>();
    tokensSnap.forEach(d => {
      const t = (d.data() as any)?.token;
      if (typeof t === 'string' && t.length > 20) {
        tokens.push(t);
        idsPorToken.set(t, d.id);
      }
    });

    if (tokens.length === 0) {
      return res.json({ ok: true, enviados: 0, mensaje: 'No hay dispositivos registrados.' });
    }

    // 3) Enviar push SILENCIOSO (solo data, sin notification visible).
    //    El SW de FCM (firebase-messaging-sw.js) lo recibe y avisa al cliente
    //    para que active la actualización del SW de Angular.
    let exitosos = 0;
    let fallidos = 0;
    const tokensInvalidos: string[] = [];

    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      const respuesta = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        data: { tipo: 'actualizacion', timestamp: String(Date.now()) }
      });
      exitosos += respuesta.successCount;
      fallidos += respuesta.failureCount;
      respuesta.responses.forEach((r, idx) => {
        if (!r.success) {
          const codigo = r.error?.code || '';
          // Si el token ya no es válido, lo marcamos para limpieza.
          if (codigo.includes('registration-token-not-registered') ||
              codigo.includes('invalid-registration-token')) {
            tokensInvalidos.push(chunk[idx]);
          }
        }
      });
    }

    // 4) Limpieza de tokens muertos (no bloqueante).
    if (tokensInvalidos.length > 0) {
      const batch = admin.firestore().batch();
      for (const t of tokensInvalidos) {
        const id = idsPorToken.get(t);
        if (id) batch.delete(admin.firestore().collection('usuarios_tokens').doc(id));
      }
      batch.commit().catch(() => {});
    }

    return res.json({
      ok: true,
      enviados: exitosos,
      fallidos,
      tokensLimpiados: tokensInvalidos.length
    });
  } catch (e: any) {
    console.error('[notify-update] error:', e);
    return res.status(500).json({ error: e?.message || 'Error interno' });
  }
}
