// ============================================================================
//  Factory de endpoints CRUD sobre Postgres (Etapas 4-8 FERROCARRIL).
//
//  Las colecciones catalogo_rutinas, asignaciones_rutinas, moldes_checklists,
//  descansos_semanales, tareas_equipo y rutinas_personales siguen el mismo
//  patrón: columnas tipadas (buscables/ordenables) + `datos` jsonb para el
//  resto del documento. En vez de 6 archivos casi idénticos, este factory
//  genera el handler a partir de una config declarativa.
//
//  Respuesta uniforme:
//    GET ?id=..            -> { item:  obj|null }
//    GET (filtros / todo)  -> { items: [...] }
//    POST                  -> upsert (como setDoc)     -> { item }
//    PATCH { id, ...campos}-> merge parcial (updateDoc) -> { item }
//    DELETE ?id=..         -> borrado físico            -> { ok:true }
//
//  Protegido con el idToken de Firebase (el login sigue en Firebase Auth).
//
//  cfg = {
//    tabla:    'mdtask_xxx',
//    map:      { campoFront: 'columna', ... },   // el resto del doc va a `datos`
//    boolCols: ['activa', ...],                  // columnas booleanas
//    numCols:  ['creado_en', ...],               // columnas numéricas (bigint)
//    orderBy:  'creado_en desc',                 // orden del listado
//    filtros:  { uid: 'uid', semanaISO: 'semana_iso' }, // ?param -> columna (igualdad)
//    autorizar: async ({user, metodo, cuerpo, req}) => null | {status, error},
//  }
//
//  ─── `autorizar` ES OPCIONAL, Y ESO ES LA MITAD DEL DISEÑO ────────────────
//  Hasta el 19/sep/2026 este factory AUTENTICABA y no AUTORIZABA: pasaba de
//  `verificarToken` directo al SQL, así que cualquier sesión válida podía
//  escribir en cualquiera de las 14 tablas que se generan aquí.
//
//  El gancho se añade como OPCIONAL a propósito: los endpoints que no lo
//  declaren se comportan EXACTAMENTE igual que antes. Cerrar los catorce de un
//  golpe habría sido cambiar quién puede escribir en tablas que se usan todos
//  los días (rutinas, descansos, tareas de equipo, vehículos) sin haber medido
//  quién escribe hoy en cada una — y un 403 en medio de un turno se lee como
//  «la app se rompió». Se cierran de a poco, cada uno con su medición.
//
//  Solo gobierna las ESCRITURAS (POST/PATCH/DELETE). Leer no se toca: las
//  pantallas ya recortan lo que enseñan, y gatear los GET aquí rompería lecturas
//  legítimas sin cerrar nada que no estuviera abierto por otro lado.
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

function crearCrud(cfg) {
  const COL_LIST = Object.values(cfg.map);
  const boolCols = new Set(cfg.boolCols || []);
  const numCols = new Set(cfg.numCols || []);
  const filtros = cfg.filtros || {};
  const orderBy = cfg.orderBy || 'id asc';

  // Fila Postgres -> objeto estilo Firestore (esparce datos, promueve columnas).
  function fila(r) {
    const o = { ...(r.datos || {}), id: r.id };
    for (const [campo, col] of Object.entries(cfg.map)) {
      let v = r[col];
      if (boolCols.has(col)) v = !!v;
      else if (numCols.has(col)) v = v != null ? Number(v) : null;
      o[campo] = v;
    }
    return o;
  }

  // Objeto entrante -> { cols, datos } separando columnas del resto.
  function desglosar(obj) {
    const cols = {}, datos = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (k === 'id') continue;
      const col = cfg.map[k];
      if (col) cols[col] = v; else datos[k] = v;
    }
    return { cols, datos };
  }

  function valorCol(col, v) {
    if (v === undefined || v === null) return null;
    if (boolCols.has(col)) return !!v;
    if (numCols.has(col)) return Number(v);
    return String(v);
  }

  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();

    if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

    let user;
    try { user = await verificarToken(req); }
    catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

    // ── Autorización de escritura ──────────────────────────────────────────
    //
    // Va DESPUÉS de autenticar (hace falta saber quién es) y ANTES del try del
    // SQL, para que un fallo de la guardia no se confunda con un error de base
    // en el catch de abajo y acabe devolviendo un 500 que nadie sabe leer.
    //
    // Si la propia guardia revienta, se DENIEGA: una guardia que no pudo
    // decidir no es una guardia que autoriza. Es el lado opuesto al de una
    // identidad no reconocida (que sí pasa, ver `_autorizar.js`), y la
    // diferencia es real: allá el dato falta, aquí el candado está roto.
    if (cfg.autorizar && (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE')) {
      let veredicto;
      try {
        veredicto = await cfg.autorizar({
          user, metodo: req.method, cuerpo: req.body || {}, req,
        });
      } catch (e) {
        console.error(`[${cfg.tabla}] la guardia de autorizacion fallo:`, e && e.message);
        return res.status(500).json({ error: 'No se pudo comprobar tu permiso para esta operación.' });
      }
      if (veredicto) {
        return res.status(veredicto.status || 403).json({ error: veredicto.error || 'Sin permiso.' });
      }
    }

    try {
      if (req.method === 'GET') {
        const q = req.query || {};
        if (q.id) {
          const r = await query(`select * from ${cfg.tabla} where id = $1`, [String(q.id)]);
          return res.json({ item: r.rows[0] ? fila(r.rows[0]) : null });
        }
        const conds = [], params = [];
        for (const [param, col] of Object.entries(filtros)) {
          if (q[param] != null && q[param] !== '') {
            params.push(String(q[param]));
            conds.push(`${col} = $${params.length}`);
          }
        }
        const where = conds.length ? 'where ' + conds.join(' and ') : '';
        const r = await query(`select * from ${cfg.tabla} ${where} order by ${orderBy}`, params);
        return res.json({ items: r.rows.map(fila) });
      }

      if (req.method === 'POST') {
        const b = req.body || {};
        const id = String(b.id || '').trim();
        if (!id) return res.status(400).json({ error: 'Falta id.' });
        const { cols, datos } = desglosar(b);
        const valores = [id, ...COL_LIST.map(c => valorCol(c, cols[c])), JSON.stringify(datos)];
        const placeholders = valores.map((_, i) => `$${i + 1}`).join(',');
        const sets = COL_LIST.map(c => `${c}=excluded.${c}`).concat('datos=excluded.datos').join(', ');
        const r = await query(
          `insert into ${cfg.tabla} (${['id', ...COL_LIST, 'datos'].join(', ')})
           values (${placeholders})
           on conflict (id) do update set ${sets}
           returning *`,
          valores
        );
        return res.json({ item: fila(r.rows[0]) });
      }

      if (req.method === 'PATCH') {
        // Semántica de setDoc({merge:true}) de Firestore: si la fila existe,
        // mezcla; si NO existe, la crea (upsert). Esto cubre el caso del wizard
        // de rutinas/asignaciones, que usa merge tanto para crear como editar.
        const b = req.body || {};
        const id = String(b.id || '').trim();
        if (!id) return res.status(400).json({ error: 'Falta id.' });
        const cur = await query(`select * from ${cfg.tabla} where id = $1`, [id]);
        const { cols, datos } = desglosar(b);
        if (cur.rowCount === 0) {
          // Insert (como POST): la fila aún no existe en Postgres.
          const valores = [id, ...COL_LIST.map(c => valorCol(c, cols[c])), JSON.stringify(datos)];
          const placeholders = valores.map((_, i) => `$${i + 1}`).join(',');
          const sets = COL_LIST.map(c => `${c}=excluded.${c}`).concat('datos=excluded.datos').join(', ');
          const r = await query(
            `insert into ${cfg.tabla} (${['id', ...COL_LIST, 'datos'].join(', ')})
             values (${placeholders}) on conflict (id) do update set ${sets} returning *`,
            valores
          );
          return res.json({ item: fila(r.rows[0]) });
        }
        const actual = cur.rows[0];
        const finalCol = (c) => (c in cols ? valorCol(c, cols[c]) : actual[c]);
        const mergedDatos = { ...(actual.datos || {}), ...datos };
        const sets = COL_LIST.map((c, i) => `${c}=$${i + 2}`).concat(`datos=$${COL_LIST.length + 2}`).join(', ');
        const valores = [id, ...COL_LIST.map(finalCol), JSON.stringify(mergedDatos)];
        const r = await query(`update ${cfg.tabla} set ${sets} where id=$1 returning *`, valores);
        return res.json({ item: fila(r.rows[0]) });
      }

      if (req.method === 'DELETE') {
        const id = req.query?.id || (req.body || {}).id;
        if (!id) return res.status(400).json({ error: 'Falta id.' });
        await query(`delete from ${cfg.tabla} where id = $1`, [String(id)]);
        return res.json({ ok: true });
      }

      return res.status(405).json({ error: 'Método no permitido' });
    } catch (e) {
      console.error(`[${cfg.tabla}] error:`, e && e.message);
      return res.status(500).json({ error: (e && e.message) || 'Error interno' });
    }
  };
}

module.exports = { crearCrud };
