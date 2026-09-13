// ============================================================================
//  LOGIN POR PLAZA — «PH-ANA-1» + PIN
//
//  Parte B del acceso por plaza (13/sep/2026). La A repartió credenciales; esto
//  las hace servir para entrar.
//
//  ═══════════════════════════════════════════════════════════════════════════
//   LO QUE ESTE ENDPOINT NO HACE, Y ES LA MITAD DEL DISEÑO
//  ═══════════════════════════════════════════════════════════════════════════
//  NO decide quién es la persona. Autentica una PLAZA y devuelve, junto a la
//  sesión, la cobertura del día: «hoy esta plaza la cubre María». Quién es de
//  verdad lo confirma la persona en la pantalla siguiente, y si no coincide se
//  registra una suplencia.
//
//  Si esto devolviera una sesión anónima de plaza, sería exactamente el correo
//  compartido de las migraciones 051-053: evidencia que no se puede atribuir a
//  nadie. La diferencia entera está en que la sesión viaja SIEMPRE con una
//  persona, aunque sea una elegida por quien entra y marcada como no
//  confirmada.
//
//  ─── CONVIVE CON EL LOGIN DE SIEMPRE ──────────────────────────────────────
//  `api/login.js` no se toca. Mientras las cuentas de persona sigan vivas, los
//  dos caminos funcionan: si esto falla, nadie se queda fuera. Apagar las
//  cuentas es la parte C, y solo cuando esto esté probado con gente real.
//
//  ─── POR QUÉ EL MENSAJE DE ERROR DISTINGUE ────────────────────────────────
//  «Ese código no existe» y «el PIN no coincide» son mensajes distintos A
//  PROPÓSITO, al revés de lo que pide el manual de seguridad clásico. El
//  razonamiento: el código NO es un secreto —va impreso en una hoja pegada en
//  la sucursal— así que ocultar su existencia no protege nada, y en cambio
//  mandar a una persona a dudar de su PIN cuando lo que tecleó mal fue el
//  código le cuesta el turno. El secreto es el PIN, y de ese no se filtra nada.
// ============================================================================
const bcrypt = require('bcryptjs');
const { query, dbConfigurada } = require('./db');
const { firmarToken } = require('./_auth');

/** Hoy en 'YYYY-MM-DD', hora de México. La cobertura se busca por este día. */
function hoyISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().split('T')[0];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  try {
    const codigo = String((req.body && req.body.codigo) || '').trim().toUpperCase().replace(/\s+/g, '');
    const pin = String((req.body && req.body.pin) || '').trim();
    if (!codigo || !pin) return res.status(400).json({ error: 'Faltan el código y el PIN.' });

    const cred = await query(
      `select id, plaza_id, codigo, pin_hash, activa
         from mdtask_credenciales_plaza
        where codigo = $1 and activa`, [codigo]);

    if (!cred.rows.length) {
      // Ver la nota de la cabecera: el código no es secreto.
      return res.status(401).json({ error: 'Ese código no existe o ya no está activo.', campo: 'codigo' });
    }

    const fila = cred.rows[0];
    let ok = false;
    try { ok = await bcrypt.compare(pin, fila.pin_hash); } catch (_) { ok = false; }
    if (!ok) return res.status(401).json({ error: 'El PIN no coincide.', campo: 'pin' });

    // ── La plaza ────────────────────────────────────────────────────────────
    const pz = await query(
      `select id, puesto_id, lugar, numero, unidad, ambito, turno, vigente
         from mdtask_plazas where id = $1`, [fila.plaza_id]);
    if (!pz.rows.length || pz.rows[0].vigente === false) {
      // Una credencial viva sobre una plaza retirada. Se dice lo que pasa, en
      // vez de un «error de acceso» que mandaría a revisar el PIN.
      return res.status(403).json({ error: 'Esa plaza ya no está vigente. Avisa a Dirección.' });
    }
    const plaza = pz.rows[0];

    // ── Quién la cubre HOY ──────────────────────────────────────────────────
    //
    // Se traen TODAS las coberturas vigentes de la plaza y decide el cliente con
    // `coberturaDelDia()` — la misma función que ya usa el pase de lista y que
    // tiene pruebas, incluida la regla de que la suplencia gana al titular.
    // Reimplementar ese desempate aquí sería una segunda versión libre de
    // discrepar (§8.11 d), y discreparía justo en de quién es la evidencia.
    const hoy = hoyISO();
    const cob = await query(
      `select c.id, c.plaza_id, c.uid, c.tipo, c.desde, c.hasta, c.motivo, c.creada_en,
              u.nombre as nombre_persona
         from mdtask_coberturas c
         left join mdtask_usuarios u on u.id = c.uid
        where c.plaza_id = $1
          and c.desde <= $2
          and (c.hasta is null or c.hasta >= $2)`, [plaza.id, hoy]);

    // Huella de uso: permite decir «esta plaza nunca ha entrado», que es
    // distinto de «entró y no hizo nada» (§5.2).
    await query('update mdtask_credenciales_plaza set ultimo_acceso = $1 where id = $2',
      [Date.now(), fila.id]);

    // El JWT lleva la PLAZA como sujeto, no una persona: la persona todavía no
    // está confirmada en este punto del flujo.
    const token = firmarToken({ uid: 'plaza:' + plaza.id, rol: 'plaza' });

    return res.json({
      token,
      plaza: {
        id: plaza.id, puestoId: plaza.puesto_id, lugar: plaza.lugar,
        numero: plaza.numero != null ? Number(plaza.numero) : null,
        unidad: plaza.unidad, ambito: plaza.ambito, turno: plaza.turno,
      },
      codigo: fila.codigo,
      fecha: hoy,
      coberturas: cob.rows.map(c => ({
        id: c.id, plazaId: c.plaza_id, uid: c.uid, tipo: c.tipo,
        desde: c.desde, hasta: c.hasta, motivo: c.motivo,
        creadaEn: c.creada_en != null ? Number(c.creada_en) : null,
        nombre: c.nombre_persona || null,
      })),
    });
  } catch (e) {
    console.error('[login-plaza] error:', e && e.message);
    return res.status(500).json({ error: 'Error al entrar. Intenta de nuevo.' });
  }
};
