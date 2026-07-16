// Endpoint: RESERVAS DE VEHICULOS (Modulo Flotilla) sobre Postgres.
//
// Es un CRUD como los demas, PERO con dos reglas propias que resuelven el
// problema real de que "toman los coches sin permiso":
//
//   1) ANTI-CHOQUE: no se puede apartar un vehiculo en un rango de horas que se
//      traslape con otra reserva ya APROBADA del mismo vehiculo. Si choca, se
//      responde 409 con los datos del conflicto (quien lo tiene y a que hora).
//
//   2) AUTORIZACION: pasar una reserva a 'aprobada' o 'rechazada' solo lo puede
//      hacer un usuario con rol 'admin'. El trabajador solo crea 'pendiente' o
//      cancela la suya.
//
// Rutas:
//   GET    ?vehiculoId=&usuarioUid=&estatus=&rangoDesde=&rangoHasta=  -> { items }
//   POST   { id, vehiculoId, usuarioUid, desde, hasta, estatus?, ...} -> crea/edita
//   PATCH  { id, ...campos }                                          -> merge (aprobar/rechazar)
//   DELETE ?id=..                                                     -> elimina (cancelar)
//
// Protegido con el token propio (JWT) o el idToken de Firebase (transicion).
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

// Columnas tipadas (el resto del documento va a `datos`).
const MAP = {
  vehiculoId: 'vehiculo_id',
  usuarioUid: 'usuario_uid',
  desde: 'desde',
  hasta: 'hasta',
  estatus: 'estatus',
};
const COLS = Object.values(MAP);
const NUM = new Set(['desde', 'hasta']);

// Fila Postgres -> objeto estilo Firestore (esparce datos, promueve columnas).
function fila(r) {
  const o = { ...(r.datos || {}), id: r.id };
  o.vehiculoId = r.vehiculo_id;
  o.usuarioUid = r.usuario_uid;
  o.desde = r.desde != null ? Number(r.desde) : null;
  o.hasta = r.hasta != null ? Number(r.hasta) : null;
  o.estatus = r.estatus;
  return o;
}

// Objeto entrante -> { cols, datos } separando columnas del resto.
function desglosar(obj) {
  const cols = {}, datos = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === 'id') continue;
    const col = MAP[k];
    if (col) cols[col] = v; else datos[k] = v;
  }
  return { cols, datos };
}

function valorCol(col, v) {
  if (v === undefined || v === null) return null;
  if (NUM.has(col)) return Number(v);
  return String(v);
}

// Busca la primera reserva APROBADA del mismo vehiculo que se traslape con el
// rango [desde, hasta). Traslape estandar de intervalos: A empieza antes de que
// B termine Y A termina despues de que B empiece. Excluye la propia reserva
// (exceptId) para que editar/aprobar la misma no choque consigo misma.
async function buscarChoque(vehiculoId, desde, hasta, exceptId) {
  const r = await query(
    `select * from reservas_vehiculos
      where vehiculo_id = $1
        and estatus = 'aprobada'
        and desde < $3
        and hasta > $2
        and id <> $4
      order by desde asc
      limit 1`,
    [String(vehiculoId), Number(desde), Number(hasta), String(exceptId || '')]
  );
  return r.rows[0] ? fila(r.rows[0]) : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  let user;
  try { user = await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }
  const esAdmin = user && user.rol === 'admin';

  try {
    // ── LISTAR ────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const q = req.query || {};
      if (q.id) {
        const r = await query('select * from reservas_vehiculos where id = $1', [String(q.id)]);
        return res.json({ item: r.rows[0] ? fila(r.rows[0]) : null });
      }
      const conds = [], params = [];
      const igual = { vehiculoId: 'vehiculo_id', usuarioUid: 'usuario_uid', estatus: 'estatus' };
      for (const [param, col] of Object.entries(igual)) {
        if (q[param] != null && q[param] !== '') {
          params.push(String(q[param]));
          conds.push(`${col} = $${params.length}`);
        }
      }
      // Rango del itinerario: reservas que se traslapen con [rangoDesde, rangoHasta).
      if (q.rangoDesde != null && q.rangoHasta != null && q.rangoDesde !== '' && q.rangoHasta !== '') {
        params.push(Number(q.rangoDesde));
        const iDesde = params.length;
        params.push(Number(q.rangoHasta));
        const iHasta = params.length;
        conds.push(`desde < $${iHasta} and hasta > $${iDesde}`);
      }
      const where = conds.length ? 'where ' + conds.join(' and ') : '';
      const r = await query(`select * from reservas_vehiculos ${where} order by desde asc`, params);
      return res.json({ items: r.rows.map(fila) });
    }

    // ── CREAR / EDITAR (upsert) ─────────────────────────────────────────────
    if (req.method === 'POST') {
      const b = req.body || {};
      const id = String(b.id || '').trim();
      if (!id) return res.status(400).json({ error: 'Falta id.' });

      const vehiculoId = b.vehiculoId != null ? String(b.vehiculoId) : '';
      const desde = b.desde != null ? Number(b.desde) : null;
      const hasta = b.hasta != null ? Number(b.hasta) : null;
      if (!vehiculoId) return res.status(400).json({ error: 'Falta el vehiculo.' });
      if (desde == null || hasta == null) return res.status(400).json({ error: 'Falta la fecha/hora de salida o regreso.' });
      if (!(hasta > desde)) return res.status(400).json({ error: 'La hora de regreso debe ser posterior a la de salida.' });

      // Solo un admin puede crear una reserva ya aprobada; el trabajador crea pendiente.
      let estatus = b.estatus ? String(b.estatus) : 'pendiente';
      if ((estatus === 'aprobada' || estatus === 'rechazada') && !esAdmin) estatus = 'pendiente';

      // ANTI-CHOQUE: no dejar apartar un rango ya tomado por una reserva aprobada.
      const conflicto = await buscarChoque(vehiculoId, desde, hasta, id);
      if (conflicto) {
        return res.status(409).json({
          error: 'Ese vehiculo ya esta apartado en ese horario.',
          conflicto,
        });
      }

      const { cols, datos } = desglosar({ ...b, estatus });
      const valores = [id, ...COLS.map(c => valorCol(c, cols[c])), JSON.stringify(datos)];
      const placeholders = valores.map((_, i) => `$${i + 1}`).join(',');
      const sets = COLS.map(c => `${c}=excluded.${c}`).concat('datos=excluded.datos').join(', ');
      const r = await query(
        `insert into reservas_vehiculos (${['id', ...COLS, 'datos'].join(', ')})
         values (${placeholders})
         on conflict (id) do update set ${sets}
         returning *`,
        valores
      );
      return res.json({ item: fila(r.rows[0]) });
    }

    // ── MERGE PARCIAL (aprobar / rechazar / cancelar) ───────────────────────
    if (req.method === 'PATCH') {
      const b = req.body || {};
      const id = String(b.id || '').trim();
      if (!id) return res.status(400).json({ error: 'Falta id.' });

      const cur = await query('select * from reservas_vehiculos where id = $1', [id]);
      if (cur.rowCount === 0) return res.status(404).json({ error: 'Reserva no encontrada.' });
      const actual = cur.rows[0];

      // Cambiar el estatus a aprobada/rechazada es exclusivo de admins.
      const nuevoEstatus = b.estatus != null ? String(b.estatus) : null;
      if (nuevoEstatus && nuevoEstatus !== actual.estatus &&
          (nuevoEstatus === 'aprobada' || nuevoEstatus === 'rechazada') && !esAdmin) {
        return res.status(403).json({ error: 'Solo un administrador puede aprobar o rechazar reservas.' });
      }

      const { cols, datos } = desglosar(b);
      const finalCol = (c) => (c in cols ? valorCol(c, cols[c]) : actual[c]);
      const resultVehiculo = finalCol('vehiculo_id');
      const resultDesde = finalCol('desde');
      const resultHasta = finalCol('hasta');
      const resultEstatus = finalCol('estatus');

      // Si la reserva queda APROBADA, revalidar anti-choque (otra pudo aprobarse
      // en el mismo horario mientras esta estaba pendiente).
      if (resultEstatus === 'aprobada' && resultVehiculo && resultDesde != null && resultHasta != null) {
        const conflicto = await buscarChoque(resultVehiculo, resultDesde, resultHasta, id);
        if (conflicto) {
          return res.status(409).json({
            error: 'No se puede aprobar: el vehiculo ya esta apartado en ese horario.',
            conflicto,
          });
        }
      }

      const mergedDatos = { ...(actual.datos || {}), ...datos };
      const sets = COLS.map((c, i) => `${c}=$${i + 2}`).concat(`datos=$${COLS.length + 2}`).join(', ');
      const valores = [id, ...COLS.map(finalCol), JSON.stringify(mergedDatos)];
      const r = await query(`update reservas_vehiculos set ${sets} where id=$1 returning *`, valores);
      return res.json({ item: fila(r.rows[0]) });
    }

    // ── BORRAR (cancelar) ───────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const id = req.query?.id || (req.body || {}).id;
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      await query('delete from reservas_vehiculos where id = $1', [String(id)]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Metodo no permitido' });
  } catch (e) {
    console.error('[reservas-vehiculos] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
