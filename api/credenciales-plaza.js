// ============================================================================
//  CREDENCIALES DE PLAZA — generar, regenerar y revocar el acceso «PH-ANA-1»
//
//  NO usa el factory `_crud.js` a propósito: aquí hay reglas que un CRUD
//  genérico no puede tener, y las tres importan.
//
//   1. EL PIN SE GENERA EN EL SERVIDOR, con `crypto.randomInt`. Si lo generara
//      el navegador saldría de `Math.random`, que no es criptográficamente
//      seguro: con la hora aproximada de creación, los PINs de toda una
//      sucursal se vuelven adivinables.
//   2. EL PIN SE DEVUELVE UNA SOLA VEZ, al crearlo. Después solo vive su hash
//      bcrypt. Un endpoint que pudiera «consultar el PIN» convertiría cualquier
//      token de admin robado en la llave de todas las sucursales.
//   3. SOLO ADMIN. Un CRUD genérico deja escribir a cualquiera con token, y
//      esto reparte accesos.
//
//  ─── LO QUE NO HACE, y es deliberado ──────────────────────────────────────
//  No autentica a nadie. Esto solo REPARTE credenciales; entrar con ellas es el
//  paso siguiente (el login), y hasta que exista, estas credenciales no abren
//  nada. Por eso esta pieza se puede desplegar sin riesgo para la operación.
// ============================================================================
const crypto = require('crypto');
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');
const { hashBcrypt } = require('./_password');

/** PIN de 6 dígitos, con ceros a la izquierda incluidos. */
function generarPin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function esAdmin(u) {
  return !!u && (u.rol === 'admin' || u.role === 'admin' || u.esAdmin === true);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  let user;
  try { user = await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  // La comprobación de admin va aquí y no solo en la pantalla: esconder un
  // botón es cosmética, y este endpoint reparte accesos a la operación.
  if (!esAdmin(user)) {
    return res.status(403).json({ error: 'Solo Dirección puede administrar los accesos de plaza.' });
  }

  try {
    // ── Listar: NUNCA incluye el PIN ni su hash ────────────────────────────
    if (req.method === 'GET') {
      const r = await query(
        `select id, plaza_id, codigo, activa, creada_en, creada_por, ultimo_acceso
           from mdtask_credenciales_plaza
          order by codigo asc`);
      return res.status(200).json({ items: r.rows.map(f => ({
        id: f.id, plazaId: f.plaza_id, codigo: f.codigo, activa: f.activa,
        creadaEn: f.creada_en ? Number(f.creada_en) : null,
        creadaPor: f.creada_por,
        ultimoAcceso: f.ultimo_acceso ? Number(f.ultimo_acceso) : null,
      })) });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

    const body = req.body || {};
    const accion = String(body.accion || '');

    // ── Generar en lote ────────────────────────────────────────────────────
    //
    // Recibe [{plazaId, codigo}] ya calculados por `codigo-plaza.util.ts`. El
    // código lo calcula el CLIENTE a propósito: esa lógica -con su desempate de
    // los dos surtidores- vive en un solo sitio y tiene pruebas. Reimplementarla
    // aquí sería una segunda versión libre de discrepar (§8.11 d). La unicidad
    // no se confía al cliente: la garantiza el índice único de la 058.
    if (accion === 'generar') {
      const plazas = Array.isArray(body.plazas) ? body.plazas : [];
      if (!plazas.length) return res.status(400).json({ error: 'No se recibió ninguna plaza.' });

      const creadas = [];
      const saltadas = [];
      for (const p of plazas) {
        const plazaId = String(p && p.plazaId || '');
        const codigo = String(p && p.codigo || '').trim().toUpperCase();
        if (!plazaId || !codigo) { saltadas.push({ plazaId, motivo: 'faltan datos' }); continue; }

        // Idempotente: una plaza que ya tiene credencial activa NO se
        // regenera por venir en el lote. Si lo hiciera, volver a pulsar
        // «generar» invalidaría los PINs que la sucursal ya tiene apuntados.
        const ya = await query(
          'select codigo from mdtask_credenciales_plaza where plaza_id = $1 and activa', [plazaId]);
        if (ya.rows.length) {
          saltadas.push({ plazaId, motivo: 'ya tiene credencial activa', codigo: ya.rows[0].codigo });
          continue;
        }

        const pin = generarPin();
        const hash = await hashBcrypt(pin);
        const id = plazaId + '|' + Date.now();
        try {
          await query(
            `insert into mdtask_credenciales_plaza
               (id, plaza_id, codigo, pin_hash, activa, creada_en, creada_por, datos)
             values ($1,$2,$3,$4,true,$5,$6,'{}'::jsonb)`,
            [id, plazaId, codigo, hash, Date.now(), String(user.nombre || user.usuario || '')]);
          // El PIN viaja en la RESPUESTA y en ningún otro sitio.
          creadas.push({ plazaId, codigo, pin });
        } catch (e) {
          // Choque de código: el índice único hizo su trabajo. Se reporta en
          // vez de tragarse el error, porque significa que el generador de
          // códigos del cliente produjo un duplicado.
          saltadas.push({ plazaId, motivo: 'el código ' + codigo + ' ya existe', codigo });
        }
      }
      return res.status(200).json({ creadas, saltadas });
    }

    // ── Regenerar el PIN de una plaza ──────────────────────────────────────
    //
    // Revoca la credencial anterior y crea una nueva CON EL MISMO CÓDIGO: lo que
    // cambia es el PIN. Así la hoja pegada en la sucursal sigue siendo válida en
    // su mitad pública y solo hay que dictar seis dígitos nuevos.
    if (accion === 'regenerar') {
      const plazaId = String(body.plazaId || '');
      if (!plazaId) return res.status(400).json({ error: 'Falta la plaza.' });
      const act = await query(
        'select id, codigo from mdtask_credenciales_plaza where plaza_id = $1 and activa', [plazaId]);
      if (!act.rows.length) return res.status(404).json({ error: 'Esa plaza no tiene credencial activa.' });

      const codigo = act.rows[0].codigo;
      const pin = generarPin();
      const hash = await hashBcrypt(pin);
      // La vieja se REVOCA, no se borra (§5.5): es la historia de quién tuvo
      // acceso y hasta cuándo.
      await query('update mdtask_credenciales_plaza set activa = false where id = $1', [act.rows[0].id]);
      await query(
        `insert into mdtask_credenciales_plaza
           (id, plaza_id, codigo, pin_hash, activa, creada_en, creada_por, datos)
         values ($1,$2,$3,$4,true,$5,$6, jsonb_build_object('regeneradaDe',$7::text))`,
        [plazaId + '|' + Date.now(), plazaId, codigo, hash, Date.now(),
         String(user.nombre || user.usuario || ''), act.rows[0].id]);
      return res.status(200).json({ codigo, pin });
    }

    // ── Revocar ────────────────────────────────────────────────────────────
    if (accion === 'revocar') {
      const plazaId = String(body.plazaId || '');
      if (!plazaId) return res.status(400).json({ error: 'Falta la plaza.' });
      const r = await query(
        'update mdtask_credenciales_plaza set activa = false where plaza_id = $1 and activa returning codigo',
        [plazaId]);
      return res.status(200).json({ revocadas: r.rows.length, codigo: r.rows[0] && r.rows[0].codigo });
    }

    return res.status(400).json({ error: 'Acción no reconocida: ' + accion });
  } catch (e) {
    console.error('[credenciales-plaza] error:', e && e.message);
    return res.status(500).json({ error: 'Error al administrar las credenciales.' });
  }
};
