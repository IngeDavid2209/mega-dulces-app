// ============================================================================
//  API CRUD de `usuarios` sobre Postgres — Etapa 1 de la migración FERROCARRIL.
//
//  Reemplaza los accesos directos a Firestore de la colección `usuarios`.
//  Protegido con el idToken de Firebase (el login sigue en Firebase Auth).
//    GET    /api/usuarios              -> lista todos (o ?telefono=.. para uno)
//    POST   /api/usuarios              -> crea/reemplaza (upsert, como setDoc). Requiere id (uid).
//    PATCH  /api/usuarios              -> edita parcial { id, ...campos } (como updateDoc)
//    DELETE /api/usuarios?id=..        -> elimina (o body { id })
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

// Campos que van como COLUMNAS (buscables). El resto va en `datos` jsonb.
const COLS = ['usuario', 'correo', 'nombre', 'rol', 'telefono', 'alcance', 'cargo', 'activo'];
const IGNORAR = new Set(['id', 'uid', 'creadoEn', 'actualizadoEn', 'creado_en', 'actualizado_en']);

// Fila de Postgres -> objeto plano estilo Firestore (lo que espera el frontend).
function fila(r) {
  const datos = r.datos || {};
  return {
    uid: r.id, id: r.id,
    usuario: r.usuario || '', correo: r.correo || '', nombre: r.nombre || '',
    rol: r.rol || '', telefono: r.telefono || '', alcance: r.alcance || '',
    cargo: r.cargo || '', activo: r.activo !== false,
    creadoEn: r.creado_en != null ? Number(r.creado_en) : null,
    actualizadoEn: r.actualizado_en != null ? Number(r.actualizado_en) : null,
    ...datos, // sucursales[], areas[], puede*, grupoTec, fotoPerfil, ultimoLatido, password...
  };
}

// Objeto entrante -> { cols, datos } separando columnas de lo demás.
function desglosar(obj) {
  const cols = {}, datos = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (IGNORAR.has(k)) continue;
    if (COLS.includes(k)) cols[k] = v;
    else datos[k] = v;
  }
  return { cols, datos };
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

  try {
    if (req.method === 'GET') {
      // Buscar uno por id (uid). Lo usa la sincronización de sesión (app.ts).
      const idBuscado = req.query?.id;
      if (idBuscado) {
        const r = await query('select * from mdtask_usuarios where id = $1', [String(idBuscado)]);
        return res.json({ usuario: r.rows[0] ? fila(r.rows[0]) : null });
      }
      // Buscar uno por teléfono (últimos 10 dígitos, sin importar formato).
      const tel = req.query?.telefono;
      if (tel) {
        const d = String(tel).replace(/\D/g, '').slice(-10);
        const r = await query(
          `select * from mdtask_usuarios
             where right(regexp_replace(coalesce(telefono,''), '[^0-9]', '', 'g'), 10) = $1
             limit 1`,
          [d]
        );
        return res.json({ usuario: r.rows[0] ? fila(r.rows[0]) : null });
      }
      const r = await query('select * from mdtask_usuarios order by nombre asc');
      return res.json({ usuarios: r.rows.map(fila) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const id = String(b.id || b.uid || '').trim();
      if (!id) return res.status(400).json({ error: 'Falta id (uid de Firebase).' });
      const { cols, datos } = desglosar(b);
      const ahora = Date.now();
      // Upsert (como setDoc): inserta o reemplaza; creado_en se conserva al actualizar.
      const r = await query(
        `insert into mdtask_usuarios (id, usuario, correo, nombre, rol, telefono, alcance, cargo, activo, creado_en, actualizado_en, datos)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11)
         on conflict (id) do update set
           usuario = excluded.usuario, correo = excluded.correo, nombre = excluded.nombre,
           rol = excluded.rol, telefono = excluded.telefono, alcance = excluded.alcance,
           cargo = excluded.cargo, activo = excluded.activo,
           actualizado_en = excluded.actualizado_en, datos = excluded.datos
         returning *`,
        [id, cols.usuario ?? null, cols.correo ?? null, cols.nombre ?? null, cols.rol ?? null,
         cols.telefono ?? null, cols.alcance ?? null, cols.cargo ?? null,
         cols.activo !== false, ahora, JSON.stringify(datos)]
      );
      return res.json({ usuario: fila(r.rows[0]) });
    }

    if (req.method === 'PATCH') {
      const b = req.body || {};
      const id = String(b.id || b.uid || '').trim();
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      const cur = await query('select * from mdtask_usuarios where id = $1', [id]);
      if (cur.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
      const actual = cur.rows[0];
      const { cols, datos } = desglosar(b);
      const val = (k) => (k in cols ? cols[k] : actual[k]);
      const mergedDatos = { ...(actual.datos || {}), ...datos };
      const r = await query(
        `update mdtask_usuarios set usuario=$2, correo=$3, nombre=$4, rol=$5, telefono=$6,
           alcance=$7, cargo=$8, activo=$9, actualizado_en=$10, datos=$11 where id=$1 returning *`,
        [id, val('usuario'), val('correo'), val('nombre'), val('rol'), val('telefono'),
         val('alcance'), val('cargo'), ('activo' in cols ? cols.activo : actual.activo),
         Date.now(), JSON.stringify(mergedDatos)]
      );
      return res.json({ usuario: fila(r.rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id || (req.body || {}).id;
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      await query('delete from mdtask_usuarios where id = $1', [String(id)]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('[usuarios] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
