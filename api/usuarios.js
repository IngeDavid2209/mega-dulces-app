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

// ---------------------------------------------------------------------------
//  QUIEN PUEDE ESCRIBIR AQUI
//
//  Antes este endpoint no revisaba nada: con cualquier sesion valida se podia
//  editar a cualquiera, incluso ponerse rol=admin a uno mismo. Lo unico que
//  frenaba eso eran las reglas de Firestore, y Firestore ya solo es respaldo: el
//  login y el perfil salen de Postgres. Asi que la regla se pasa aqui, que es
//  donde ahora si manda.
//
//  Es la MISMA politica que ya decian las reglas de Firestore:
//   - Admin (rol en Postgres): crea, edita y borra a cualquiera.
//   - Los demas: solo su propia ficha y solo campos inofensivos. No pueden
//     tocar rol, permisos, sucursales, alcance ni activo.
// ---------------------------------------------------------------------------
const CAMPOS_PROPIOS = new Set([
  'correo', 'telefono', 'password', 'fotoPerfil',
  'ultimoLatido',   // el latido de presencia lo manda cada quien todo el tiempo
  'id', 'uid'       // no son cambios, identifican la fila
]);

//  IMPORTANTE — se falla ABIERTO con las identidades que no se reconocen.
//  La primera version bloqueaba a todo el que no dijera rol='admin', y dejo
//  fuera al administrador general: hay 5 filas con el rol vacio (entre ellas
//  ids 'admin' y 'admin-local') y cuentas de acceso sin fila en la base, asi que
//  "no dice admin" no significa "es un trabajador". Dejar sin trabajar a quien
//  manda es peor que el hueco que esto tapa, y el hueco llevaba meses abierto.
//
//  Ahora solo se frena a quien la base dice POSITIVAMENTE que es trabajador. Lo
//  demas pasa y se anota en el log, para poder cerrarlo bien despues.
async function permisoEscritura(uid) {
  if (!uid) return { puede: true, motivo: 'sin uid en el token' };
  const r = await query('select rol from mdtask_usuarios where id = $1', [String(uid)]);
  if (!r.rows[0]) return { puede: true, motivo: 'no tiene fila en la base' };
  const rol = String(r.rows[0].rol || '').trim();
  if (rol === 'admin') return { puede: true, motivo: 'admin' };
  if (!rol) return { puede: true, motivo: 'su fila no trae rol' };
  return { puede: false, motivo: 'rol ' + rol };
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

    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
      const permiso = await permisoEscritura(user.uid);
      // Se anota SIEMPRE que pase por una via distinta de "es admin": es la unica
      // forma de ver a quien habria bloqueado la regla estricta antes de cerrarla.
      if (permiso.puede && permiso.motivo !== 'admin') {
        console.warn(`[usuarios] escritura permitida por excepcion: uid=${user.uid} motivo="${permiso.motivo}" metodo=${req.method}`);
      }

      // Crear y borrar: solo quien puede.
      if (!permiso.puede && (req.method === 'POST' || req.method === 'DELETE')) {
        console.warn(`[usuarios] ${req.method} bloqueado: uid=${user.uid} (${permiso.motivo})`);
        return res.status(403).json({ error: 'Solo un administrador puede crear o eliminar usuarios.' });
      }

      // Editar: los que no pueden, solo su ficha y solo campos inofensivos.
      if (!permiso.puede && req.method === 'PATCH') {
        const b = req.body || {};
        const objetivo = String(b.id || b.uid || '').trim();
        if (objetivo !== String(user.uid)) {
          console.warn(`[usuarios] PATCH ajeno bloqueado: uid=${user.uid} (${permiso.motivo}) objetivo=${objetivo}`);
          return res.status(403).json({ error: 'Solo puedes editar tu propia ficha.' });
        }
        const prohibidos = Object.keys(b).filter(k => !CAMPOS_PROPIOS.has(k));
        if (prohibidos.length) {
          console.warn(`[usuarios] PATCH con campos vedados: uid=${user.uid} (${permiso.motivo}) campos=${prohibidos.join(',')}`);
          return res.status(403).json({
            error: 'No puedes cambiar estos datos de tu propia ficha: ' + prohibidos.join(', ')
          });
        }
      }
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
