// Endpoint: TAREAS ASIGNADAS (panel del admin).
//
// Devuelve todas las tareas que el admin ha repartido a otras personas
// (las que tienen "asignadaPor"), leyendo todas las agendas con firebase-admin.
// Para admin limitado, solo las de personal de sus sucursales.
//
// Variables de entorno: FIREBASE_SERVICE_ACCOUNT.

const admin = require('firebase-admin');

let inicializado = false;
function inicializar() {
  if (inicializado) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta variable FIREBASE_SERVICE_ACCOUNT en las variables de entorno.');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  inicializado = true;
}

function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
function sucursalesDe(u) { return u.sucursales || (u.sucursal ? [u.sucursal] : []); }
function esAdminGlobal(p) {
  const a = (p.alcance || '').toLowerCase();
  return p.rol === 'admin' && (a === 'global' || a === '' || (p.sucursales || []).includes('General (Acceso Total)'));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    inicializar();
    const authHeader = String(req.headers['authorization'] || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Falta Authorization Bearer token' });
    const decoded = await admin.auth().verifyIdToken(idToken);

    const db = admin.firestore();
    const perfil = (await db.collection('usuarios').doc(decoded.uid).get()).data() || {};
    if (perfil.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores.' });

    // Mapa uid -> datos del usuario
    const us = await db.collection('usuarios').get();
    const info = {};
    us.forEach(d => { const u = d.data() || {}; info[d.id] = { nombre: u.nombre || u.correo || d.id, sucursales: sucursalesDe(u) }; });

    const global = esAdminGlobal(perfil);
    const permitidas = global ? null : sucursalesDe(perfil).filter(s => s && s !== 'General (Acceso Total)').map(norm);

    // Todas las agendas
    const snap = await db.collectionGroup('agenda').get();
    const tareas = [];
    snap.forEach(d => {
      const t = d.data() || {};
      if (!t.asignadaPor) return; // solo las repartidas a alguien
      const uid = d.ref.parent.parent.id;
      const persona = info[uid] || { nombre: uid, sucursales: [] };
      // Filtro de alcance para admin limitado
      if (!global) {
        const enScope = persona.sucursales.some(s => permitidas.includes(norm(s)));
        if (!enScope) return;
      }
      tareas.push({
        id: d.id,
        persona: persona.nombre,
        sucursal: persona.sucursales[0] || '',
        texto: t.texto || '',
        fecha: t.fecha || '',
        horaInicio: t.horaInicio || '',
        prioridad: t.prioridad || '',
        completada: !!t.completada,
        asignadaPor: t.asignadaPor || '',
        fechaCreacion: t.fechaCreacion || 0
      });
    });

    tareas.sort((a, b) => (b.fechaCreacion || 0) - (a.fechaCreacion || 0));

    // Listas para los filtros
    const personas = Array.from(new Set(tareas.map(t => t.persona))).sort();
    const sucursales = Array.from(new Set(tareas.map(t => t.sucursal).filter(Boolean))).sort();

    return res.status(200).json({ total: tareas.length, tareas, personas, sucursales });
  } catch (e) {
    console.error('[tareas-asignadas] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
