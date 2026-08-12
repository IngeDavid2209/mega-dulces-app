// ============================================================================
//  API CRUD de `checklists` sobre Postgres — Etapa 3 de la migración FERROCARRIL.
//
//  Reemplaza los accesos directos a Firestore de la colección `checklists`
//  (el mayor lector de la app). Protegido con el idToken de Firebase.
//    GET    /api/checklists?id=..                 -> uno por id  -> { checklist }
//    GET    /api/checklists?desde=YYYY-MM-DD       -> fecha >= desde
//           &hasta=YYYY-MM-DD                      -> ...y fecha <= hasta
//           &origenTec=true                        -> origen_tec = true
//           &entregaConRetraso=true                -> entrega_con_retraso = true
//           &asignacionId=.. &catalogoRutinaId=..  -> igualdad puntual
//    GET    /api/checklists                        -> todos -> { checklists }
//    POST   /api/checklists                        -> upsert completo (como setDoc). Requiere id.
//    PATCH  /api/checklists                        -> edita parcial { id, ...campos } (como updateDoc/merge)
//    DELETE /api/checklists?id=..                  -> borrado FÍSICO (o body { id })
//
//  El filtrado fino por rol/sucursal/enviado/eliminado se mantiene EN CLIENTE
//  (igual que ya lo hacía sobre el snapshot de Firestore); aquí solo se filtra
//  por lo que en Firestore era un where server-side.
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

// Mapa campo del front (camelCase, estilo Firestore) -> columna Postgres.
// Todo lo que NO esté aquí va al cajón `datos` jsonb (items[], subtareas[],
// mantenimiento, notaEmpleado, vistoPor, fechaInicio/Fin, flags de cierre...).
const MAP = {
  name: 'name', assigned: 'assigned', assignedUid: 'assigned_uid', store: 'store',
  date: 'fecha', time: 'hora', status: 'status',
  enviado: 'enviado', eliminado: 'eliminado', archivado: 'archivado',
  origenTec: 'origen_tec', entregaConRetraso: 'entrega_con_retraso',
  createdBy: 'created_by', timestampCreacion: 'timestamp_creacion',
  _asignacionId: 'asignacion_id', _catalogoRutinaId: 'catalogo_rutina_id',
};
const BOOL_COLS = new Set(['enviado', 'eliminado', 'archivado', 'origen_tec', 'entrega_con_retraso']);
// Ignorados al desglosar (id se maneja aparte; ambas grafías de campos).
const IGNORAR = new Set(['id', ...Object.values(MAP)]);

// Fila de Postgres -> objeto plano estilo Firestore que espera el frontend.
function fila(r) {
  const datos = r.datos || {};
  return {
    // datos primero; las columnas tipadas mandan si hubiera solape.
    ...datos,
    id: r.id,
    name: r.name || '', assigned: r.assigned || '', assignedUid: r.assigned_uid || null,
    store: r.store || '', date: r.fecha || '', time: r.hora || '',
    status: r.status || 'pendiente',
    enviado: !!r.enviado, eliminado: !!r.eliminado, archivado: !!r.archivado,
    origenTec: !!r.origen_tec, entregaConRetraso: !!r.entrega_con_retraso,
    createdBy: r.created_by || '',
    timestampCreacion: r.timestamp_creacion != null ? Number(r.timestamp_creacion) : null,
    _asignacionId: r.asignacion_id || null, _catalogoRutinaId: r.catalogo_rutina_id || null,
  };
}

// Objeto entrante -> { cols, datos }. `cols` usa NOMBRES DE COLUMNA (snake_case).
function desglosar(obj) {
  const cols = {}, datos = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === 'id') continue;
    const col = MAP[k];
    if (col) cols[col] = v;
    else if (!IGNORAR.has(k)) datos[k] = v;
  }
  return { cols, datos };
}

// Orden fijo de columnas para insert/update.
const COL_LIST = ['name', 'assigned', 'assigned_uid', 'store', 'fecha', 'hora', 'status',
  'enviado', 'eliminado', 'archivado', 'origen_tec', 'entrega_con_retraso',
  'created_by', 'timestamp_creacion', 'asignacion_id', 'catalogo_rutina_id'];

function valorCol(col, v) {
  if (v === undefined) return null;
  if (BOOL_COLS.has(col)) return !!v;
  if (col === 'timestamp_creacion') return v != null ? Number(v) : null;
  if (v === null) return null;
  return String(v);
}

// ---------------------------------------------------------------------------
//  AMARRE DEL DUEÑO (assigned_uid)
//
//  El robot de rutinas copia del molde SOLO el nombre (`assigned`), sin uid.
//  Mientras el vínculo dependa del nombre escrito, cualquier variante lo rompe:
//  a Ana Paola Frausto sus tareas decían "Anna Paola Frausto Nava" y el bot le
//  contestó "no tienes tareas pendientes" teniéndolas asignadas.
//
//  Aquí, al guardar, se resuelve el nombre a un uid y se graba. A partir de
//  entonces el nombre da igual: la tarea queda amarrada a la persona.
//
//  REGLA DE ORO: solo se amarra cuando NO hay duda (una sola persona activa
//  empareja). Con cero o con varias se deja en null — es preferible que el bot
//  no vea la tarea que ensenarsela a otra persona. Hay hermanas con apellidos
//  casi iguales (Frausto Nava) donde adivinar seria peor que no amarrar.
// ---------------------------------------------------------------------------
// Se compara con el MISMO criterio que el bot. Se pide tarde (dentro de la
// función) porque `asistente-chat` es pesado y para no cerrar un ciclo de
// require, igual que se hace con `tareas-notificar` más abajo.
function compararNombres(a, b) {
  try { return require('./asistente-chat').mismoNombreEmpleado(a, b); }
  catch (e) { return false; }
}

async function resolverUidDeNombre(nombre) {
  const n = String(nombre || '').trim();
  if (!n) return null;
  // 1) Nombre idéntico (sin distinguir mayúsculas/espacios de sobra).
  const exacto = await query(
    `select id from mdtask_usuarios
      where coalesce(activo, true) = true
        and lower(btrim(coalesce(nombre,''))) = lower(btrim($1))`, [n]);
  if (exacto.rowCount === 1) return String(exacto.rows[0].id);
  if (exacto.rowCount > 1) return null;              // homónimos: no adivinar
  // 2) Tolerante (acentos, apellidos al revés, un apellido de más/de menos).
  //    Es el MISMO criterio que usan la app y el bot, así que no abre la puerta
  //    a nada que la app no permitiera ya.
  const todos = await query(
    `select id, nombre from mdtask_usuarios
      where coalesce(activo, true) = true and coalesce(nombre,'') <> ''`);
  const cal = todos.rows.filter(u => compararNombres(u.nombre, n));
  return cal.length === 1 ? String(cal[0].id) : null;
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
      const q = req.query || {};
      // Uno por id (getDoc puntual).
      if (q.id) {
        const r = await query('select * from mdtask_checklists where id = $1', [String(q.id)]);
        return res.json({ checklist: r.rows[0] ? fila(r.rows[0]) : null });
      }
      // WHERE dinámico: combina cualquier filtro presente (equivalente a los
      // where server-side que existían en Firestore).
      const conds = [], params = [];
      if (q.desde) { params.push(String(q.desde)); conds.push(`fecha >= $${params.length}`); }
      if (q.hasta) { params.push(String(q.hasta)); conds.push(`fecha <= $${params.length}`); }
      if (String(q.origenTec) === 'true') conds.push('origen_tec = true');
      if (String(q.entregaConRetraso) === 'true') conds.push('entrega_con_retraso = true');
      if (q.asignacionId) { params.push(String(q.asignacionId)); conds.push(`asignacion_id = $${params.length}`); }
      if (q.catalogoRutinaId) { params.push(String(q.catalogoRutinaId)); conds.push(`catalogo_rutina_id = $${params.length}`); }
      const where = conds.length ? 'where ' + conds.join(' and ') : '';
      const r = await query(`select * from mdtask_checklists ${where} order by fecha asc`, params);
      return res.json({ checklists: r.rows.map(fila) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const id = String(b.id || '').trim();
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      const { cols, datos } = desglosar(b);
      // Si viene sin dueño amarrado (el caso del robot de rutinas), se resuelve
      // aquí. Si no se puede sin ambigüedad, se avisa en el log: esa tarea queda
      // "huérfana" y el bot no podrá ligarla con nadie.
      if (!cols.assigned_uid && cols.assigned) {
        cols.assigned_uid = await resolverUidDeNombre(cols.assigned);
        if (!cols.assigned_uid) {
          console.warn(`[checklists] tarea SIN dueño amarrado: "${cols.assigned}" no empareja con un solo usuario activo (checklist ${id}). El bot no se la va a mostrar a nadie.`);
        }
      }
      // insert ... on conflict (id) do update (como setDoc; reemplaza el doc).
      const valores = [id, ...COL_LIST.map(c => valorCol(c, cols[c])), JSON.stringify(datos)];
      const placeholders = valores.map((_, i) => `$${i + 1}`).join(',');
      const sets = COL_LIST.map(c => `${c}=excluded.${c}`).concat('datos=excluded.datos').join(', ');
      // `xmax = 0` distingue un INSERT real de un UPDATE en el mismo upsert. Lo
      // necesitamos porque el front usa este POST para TODO guardado (setDoc), y
      // el aviso de WhatsApp solo debe salir cuando el checklist NACE.
      const r = await query(
        `insert into mdtask_checklists (id, ${COL_LIST.join(', ')}, datos)
         values (${placeholders})
         on conflict (id) do update set ${sets}
         returning *, (xmax = 0) as _insertado`,
        valores
      );
      const guardado = fila(r.rows[0]);
      const esNuevo = r.rows[0]._insertado === true;
      // Las tareas RECURRENTES llegan por decenas cada dia (hoy 144 de 179): esas
      // NO se avisan una por una, las cubre el resumen de la manana. Solo se avisa
      // lo que un humano asigno a mano.
      //
      // OJO con la deteccion: los checklists que salen de un MOLDE no traen
      // _asignacionId ni _catalogoRutinaId, y su createdBy es la persona que
      // aplico el molde (un humano). Lo unico que los delata es el prefijo
      // `molde_` de su id, que arma el robot del front. Si cambia ese formato,
      // hay que actualizar esto o volveran los avisos en masa.
      const deRobot = !!(guardado._asignacionId || guardado._catalogoRutinaId || guardado._rutinaPersonalId)
        || /^molde_/i.test(id)
        || /robot/i.test(String(guardado.createdBy || ''));
      if (esNuevo && !deRobot && !guardado.enviado) {
        // Sin await: la respuesta no espera a WhatsApp (Railway es un proceso
        // vivo, no serverless, asi que el envio termina igual).
        require('./tareas-notificar').avisarAsignacion(guardado)
          .catch(e => console.error('[checklists] aviso de asignacion:', e && e.message));
      }
      return res.json({ checklist: guardado });
    }

    if (req.method === 'PATCH') {
      const b = req.body || {};
      const id = String(b.id || '').trim();
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      const cur = await query('select * from mdtask_checklists where id = $1', [id]);
      if (cur.rowCount === 0) return res.status(404).json({ error: 'Checklist no encontrado.' });
      const actual = cur.rows[0];
      const { cols, datos } = desglosar(b);
      // Si reasignan la tarea a otra persona sin mandar el uid, se vuelve a
      // amarrar; si no, quedaría con el dueño anterior.
      //
      // OJO con el caso de en medio: solo se re-amarra cuando el nombre CAMBIÓ
      // de verdad. Muchas ediciones (marcar un ítem, subir una foto) reenvían el
      // mismo `assigned`, y si en esas se volviera a resolver, un nombre ambiguo
      // dejaría en null un amarre que ya estaba bien y el bot dejaría de
      // mostrarle la tarea a su dueño: exactamente lo que esto vino a arreglar.
      //
      // Cuando el nombre SÍ cambió y no se puede resolver, se deja en null a
      // propósito (misma regla que al crear): es mejor una tarea sin dueño que
      // una amarrada a la persona equivocada, que ya no es la asignada.
      if ('assigned' in cols && !('assigned_uid' in cols)) {
        const nombreNuevo = String(cols.assigned || '').trim();
        const nombreAntes = String(actual.assigned || '').trim();
        const cambioDeDueno = nombreNuevo.toLowerCase() !== nombreAntes.toLowerCase();
        if (cambioDeDueno) {
          cols.assigned_uid = await resolverUidDeNombre(nombreNuevo);
          if (!cols.assigned_uid) {
            console.warn(`[checklists] reasignada a "${nombreNuevo}" pero sin dueño amarrado (checklist ${id}). El bot no se la va a mostrar a nadie.`);
          }
        } else if (!actual.assigned_uid) {
          // Mismo nombre y nunca se amarró: buen momento para intentarlo, y si
          // no se puede se queda como estaba (null), sin perder nada.
          const encontrado = await resolverUidDeNombre(nombreNuevo);
          if (encontrado) cols.assigned_uid = encontrado;
        }
        // Mismo nombre y ya tenía dueño: no se toca.
      }
      // Merge: columnas presentes se pisan; el resto conserva el valor actual.
      const finalCol = (c) => (c in cols ? valorCol(c, cols[c]) : actual[c]);
      const mergedDatos = { ...(actual.datos || {}), ...datos };
      const sets = COL_LIST.map((c, i) => `${c}=$${i + 2}`).concat(`datos=$${COL_LIST.length + 2}`).join(', ');
      const valores = [id, ...COL_LIST.map(finalCol), JSON.stringify(mergedDatos)];
      const r = await query(
        `update mdtask_checklists set ${sets} where id=$1 returning *`,
        valores
      );
      return res.json({ checklist: fila(r.rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id || (req.body || {}).id;
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      await query('delete from mdtask_checklists where id = $1', [String(id)]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('[checklists] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
