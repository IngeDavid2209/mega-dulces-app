// API del apartado "Activacion de promociones" (formato MKTN001).
//
//   GET    /api/promociones                 -> lista (mas recientes primero)
//   GET    /api/promociones?id=..           -> una
//   GET    /api/promociones?siguienteFolio=1-> { folio } el que toca usar
//   POST   /api/promociones                 -> crea o actualiza (merge en `datos`)
//   DELETE /api/promociones?id=..           -> marca eliminada (NO borra la fila)
//
// El borrado es logico a proposito: una promocion trae dinero negociado y
// evidencia; si alguien se equivoca, se recupera.
//
// QUIEN PUEDE QUE:
//   GET             cualquiera que entre al apartado (los dos oficios).
//   POST y DELETE   SOLO `promocionesFormato`. El formato es el acuerdo con el
//                   proveedor: quien nada mas llena expedientes lo ve, lo baja
//                   en PDF y no le mueve nada. Ver api/_promo-acceso.js.
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');
const { permisosPromo, prohibido } = require('./_promo-acceso');

/** Primer folio si la tabla esta vacia. Se puede cambiar sin tocar codigo con
 *  la variable PROMO_FOLIO_INICIAL (David dijo que despues pasa el numero). */
function folioInicial() {
  const n = parseInt(process.env.PROMO_FOLIO_INICIAL || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function fila(r) {
  return {
    id: r.id,
    folio: r.folio,
    estado: r.estado,
    proveedor: r.proveedor,
    proveedorClave: r.proveedor_clave,
    agenteVentas: r.agente_ventas,
    fechaNegociacion: r.fecha_negociacion,
    periodo: r.periodo,
    vigenciaDel: r.vigencia_del,
    vigenciaAl: r.vigencia_al,
    monto: r.monto == null ? null : Number(r.monto),
    creadoEn: r.creado_en == null ? null : Number(r.creado_en),
    creadoPor: r.creado_por,
    actualizadoEn: r.actualizado_en == null ? null : Number(r.actualizado_en),
    ...(r.datos || {})
  };
}

/** El folio que toca: el mayor usado + 1, o el inicial si no hay ninguno. */
async function siguienteFolio() {
  const r = await query('select max(folio)::int as m from mdtask_promociones');
  const m = r.rows[0]?.m;
  return m == null ? folioInicial() : m + 1;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  let usuario = null;
  try { usuario = await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  try {
    if (req.method === 'GET') {
      if (req.query?.siguienteFolio) {
        return res.json({ folio: await siguienteFolio() });
      }
      if (req.query?.id) {
        const r = await query('select * from mdtask_promociones where id = $1', [String(req.query.id)]);
        if (!r.rows[0]) return res.status(404).json({ error: 'No existe esa promoción.' });
        return res.json({ promocion: fila(r.rows[0]) });
      }
      const r = await query(
        `select * from mdtask_promociones where eliminado = false
         order by coalesce(folio, 0) desc, creado_en desc nulls last limit 500`);
      return res.json({ promociones: r.rows.map(fila) });
    }

    if (req.method === 'POST') {
      // El alta y la edicion del formato son de un solo oficio.
      const perm = await permisosPromo(usuario);
      if (!perm.formato) return prohibido(res, 'dar de alta o editar el formato');

      const b = req.body || {};
      const id = String(b.id || ('promo_' + Date.now()));
      const ahora = Date.now();
      const quien = usuario?.email || usuario?.uid || null;

      // Lo que va en columnas propias se saca del cuerpo; TODO lo demas se
      // guarda en `datos` sin filtrar, para que el formato pueda crecer sin
      // migrar la tabla.
      const {
        folio, estado, proveedor, proveedorClave, agenteVentas, fechaNegociacion,
        periodo, vigenciaDel, vigenciaAl, monto,
        id: _id, creadoEn: _ce, creadoPor: _cp, actualizadoEn: _ae,
        ...datos
      } = b;

      const r = await query(
        `insert into mdtask_promociones
           (id, folio, estado, proveedor, proveedor_clave, agente_ventas, fecha_negociacion,
            periodo, vigencia_del, vigencia_al, monto, datos, creado_en, creado_por, actualizado_en)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$13)
         on conflict (id) do update set
           folio             = coalesce(excluded.folio, mdtask_promociones.folio),
           estado            = coalesce(excluded.estado, mdtask_promociones.estado),
           proveedor         = coalesce(excluded.proveedor, mdtask_promociones.proveedor),
           proveedor_clave   = coalesce(excluded.proveedor_clave, mdtask_promociones.proveedor_clave),
           agente_ventas     = coalesce(excluded.agente_ventas, mdtask_promociones.agente_ventas),
           fecha_negociacion = coalesce(excluded.fecha_negociacion, mdtask_promociones.fecha_negociacion),
           periodo           = coalesce(excluded.periodo, mdtask_promociones.periodo),
           vigencia_del      = coalesce(excluded.vigencia_del, mdtask_promociones.vigencia_del),
           vigencia_al       = coalesce(excluded.vigencia_al, mdtask_promociones.vigencia_al),
           monto             = coalesce(excluded.monto, mdtask_promociones.monto),
           -- merge, no reemplazo: guardar el paso 2 no debe borrar el paso 1
           datos             = mdtask_promociones.datos || excluded.datos,
           actualizado_en    = excluded.actualizado_en
         returning *`,
        [id, folio ?? null, estado || null, proveedor || null, proveedorClave || null,
         agenteVentas || null, fechaNegociacion || null, periodo || null,
         vigenciaDel || null, vigenciaAl || null,
         (monto === '' || monto == null) ? null : Number(monto),
         JSON.stringify(datos || {}), ahora, quien]
      );
      return res.json({ promocion: fila(r.rows[0]) });
    }

    if (req.method === 'DELETE') {
      const permDel = await permisosPromo(usuario);
      if (!permDel.formato) return prohibido(res, 'quitar promociones');

      const id = req.query?.id || (req.body || {}).id;
      if (!id) return res.status(400).json({ error: 'Falta id.' });
      await query(
        'update mdtask_promociones set eliminado = true, actualizado_en = $2 where id = $1',
        [String(id), Date.now()]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('[promociones] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
