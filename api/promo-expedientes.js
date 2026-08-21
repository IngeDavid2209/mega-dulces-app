// ============================================================================
//  EXPEDIENTES DE PROMOCION (protocolo de seguimiento del MKTN001).
//
//    GET    /api/promo-expedientes?promo=<id>  -> los de esa promocion + sus canales
//    GET    /api/promo-expedientes?ranking=1   -> ranking general y por canal
//    POST   /api/promo-expedientes             -> una accion sobre un expediente
//    DELETE /api/promo-expedientes?id=..       -> lo marca eliminado (no borra)
//
//  Cada expediente es UNA PROMOCION EN UN CANAL, y guarda las tres pruebas de
//  que la promocion si se ejecuto ahi: la salida de la mercancia, la exhibicion
//  y los tickets de venta. Ver la cabecera de scripts/sql/032_promo_expedientes.sql.
//
//  El POST trabaja por ACCIONES y no reemplazando el expediente completo, a
//  proposito: varias personas de distintas sucursales suben evidencia el mismo
//  dia, y un guardado que mandara el objeto entero pisaria lo que acaba de subir
//  el de al lado. Cada accion toca solo su parte:
//
//    agregarEvidencia { seccion: 'salida'|'exhibicion', evidencia }
//    quitarEvidencia  { seccion, url }
//    agregarVenta     { venta: { url, nombre, piezas, importe, ... } }
//    editarVenta      { ventaId, piezas, importe, confirmado }
//    quitarVenta      { ventaId }
//    nota             { nota }
//
//  Los totales (piezas, importe, cuantos tickets) los recalcula SIEMPRE el
//  servidor sumando las ventas guardadas; nunca se toma el total que mande el
//  navegador. Es lo que alimenta el KPI y el ranking, y si el cliente pudiera
//  mandarlo, un reenvio o una pantalla vieja lo dejaria mal.
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

const SECCIONES = ['salida', 'exhibicion'];

/** Texto limpio (o null) para no guardar cadenas vacias ni undefined. */
function texto(v) {
  const s = String(v == null ? '' : v).trim();
  return s || null;
}

/** Numero >= 0, o 0 si no vino nada usable. Nunca NaN, que rompe las sumas. */
function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** El canal, como parte de un id: sin acentos, sin espacios ni puntos. */
function slugCanal(canal) {
  return String(canal || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function fila(r) {
  const datos = r.datos || {};
  return {
    id: r.id,
    promoId: r.promo_id,
    canal: r.canal,
    estado: r.estado,
    piezasTotal: r.piezas_total == null ? 0 : Number(r.piezas_total),
    importeTotal: r.importe_total == null ? 0 : Number(r.importe_total),
    ventasTotal: r.ventas_total == null ? 0 : Number(r.ventas_total),
    salida: Array.isArray(datos.salida) ? datos.salida : [],
    exhibicion: Array.isArray(datos.exhibicion) ? datos.exhibicion : [],
    ventas: Array.isArray(datos.ventas) ? datos.ventas : [],
    nota: datos.nota || null,
    creadoEn: r.creado_en == null ? null : Number(r.creado_en),
    creadoPor: r.creado_por,
    actualizadoEn: r.actualizado_en == null ? null : Number(r.actualizado_en),
  };
}

/** Una evidencia, con solo los campos que nos sirven del subidor. */
function limpiarEvidencia(e, quien, ahora) {
  const url = texto(e && e.url);
  if (!url) return null;
  return {
    url,
    nombre: texto(e.nombre) || 'evidencia',
    tipo: texto(e.tipo) || '',
    pesoKB: numero(e.pesoKB),
    subidoEn: ahora,
    subidoPor: quien || null,
  };
}

/**
 * El expediente esta COMPLETO cuando tiene las tres pruebas. Es lo que pinta el
 * avance ("4 de 8 sucursales completas"), asi que se calcula aqui y no en el
 * navegador: la regla tiene que ser la misma para todos.
 */
function calcularEstado(datos) {
  const tiene = (k) => Array.isArray(datos[k]) && datos[k].length > 0;
  return (tiene('salida') && tiene('exhibicion') && tiene('ventas'))
    ? 'completo' : 'pendiente';
}

/** Suma de las ventas guardadas. Los totales salen SIEMPRE de aqui. */
function totales(datos) {
  const ventas = Array.isArray(datos.ventas) ? datos.ventas : [];
  let piezas = 0, importe = 0;
  for (const v of ventas) {
    piezas += numero(v.piezas);
    importe += numero(v.importe);
  }
  // El importe se redondea a centavos: sumar decimales de coma flotante deja
  // colas como 1234.5600000000002 y eso acaba impreso en el KPI.
  return { piezas: Math.round(piezas), importe: Math.round(importe * 100) / 100, ventas: ventas.length };
}

/** Los canales que la promocion tiene MARCADOS: solo esos llevan expediente. */
async function canalesDeLaPromo(promoId) {
  const r = await query(
    'select datos from mdtask_promociones where id = $1 and eliminado = false',
    [String(promoId)]);
  if (!r.rows[0]) return null;                 // la promocion no existe
  const canales = (r.rows[0].datos || {}).canales || {};
  return Object.keys(canales).filter(c => canales[c] === true);
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

  const quien = usuario.uid || null;
  const q = req.query || {};

  try {
    // ------------------------------------------------------------------ GET
    if (req.method === 'GET') {
      // --- Ranking: las promociones mas vendidas, en general y por canal ---
      if (q.ranking) {
        const general = await query(
          `select e.promo_id,
                  p.folio, p.proveedor, p.vigencia_del, p.vigencia_al,
                  sum(e.piezas_total)::int   as piezas,
                  sum(e.importe_total)::numeric as importe,
                  sum(e.ventas_total)::int   as tickets,
                  count(*)::int              as expedientes,
                  count(*) filter (where e.estado = 'completo')::int as completos
             from mdtask_promo_expedientes e
             join mdtask_promociones p on p.id = e.promo_id and p.eliminado = false
            where e.eliminado = false
            group by e.promo_id, p.folio, p.proveedor, p.vigencia_del, p.vigencia_al
            order by piezas desc, importe desc
            limit 200`);

        // Por canal: dentro de cada sucursal, que promocion vendio mas.
        const porCanal = await query(
          `select e.canal, e.promo_id, p.folio, p.proveedor,
                  e.piezas_total::int as piezas, e.importe_total::numeric as importe,
                  e.ventas_total::int as tickets
             from mdtask_promo_expedientes e
             join mdtask_promociones p on p.id = e.promo_id and p.eliminado = false
            where e.eliminado = false and e.piezas_total > 0
            order by e.canal asc, e.piezas_total desc, e.importe_total desc`);

        return res.json({
          general: general.rows.map(r => ({
            promoId: r.promo_id, folio: r.folio, proveedor: r.proveedor,
            vigenciaDel: r.vigencia_del, vigenciaAl: r.vigencia_al,
            piezas: Number(r.piezas || 0), importe: Number(r.importe || 0),
            tickets: Number(r.tickets || 0),
            expedientes: Number(r.expedientes || 0), completos: Number(r.completos || 0),
          })),
          porCanal: porCanal.rows.map(r => ({
            canal: r.canal, promoId: r.promo_id, folio: r.folio, proveedor: r.proveedor,
            piezas: Number(r.piezas || 0), importe: Number(r.importe || 0),
            tickets: Number(r.tickets || 0),
          })),
        });
      }

      // --- Los expedientes de una promocion ---
      if (q.promo) {
        const canales = await canalesDeLaPromo(q.promo);
        if (canales === null) return res.status(404).json({ error: 'No existe esa promoción.' });
        const r = await query(
          `select * from mdtask_promo_expedientes
            where promo_id = $1 and eliminado = false order by canal asc`,
          [String(q.promo)]);
        // Se devuelven los canales marcados aparte: el frontend arma la lista
        // completa (canal marcado sin expediente = todavia sin evidencia).
        return res.json({ canales, expedientes: r.rows.map(fila) });
      }

      // --- Resumen para la lista de promociones (avance de cada una) ---
      const r = await query(
        `select promo_id,
                count(*)::int as expedientes,
                count(*) filter (where estado = 'completo')::int as completos,
                sum(piezas_total)::int as piezas,
                sum(importe_total)::numeric as importe,
                sum(ventas_total)::int as tickets
           from mdtask_promo_expedientes
          where eliminado = false group by promo_id`);
      return res.json({
        resumen: r.rows.map(x => ({
          promoId: x.promo_id,
          expedientes: Number(x.expedientes || 0), completos: Number(x.completos || 0),
          piezas: Number(x.piezas || 0), importe: Number(x.importe || 0),
          tickets: Number(x.tickets || 0),
        })),
      });
    }

    // ----------------------------------------------------------------- POST
    if (req.method === 'POST') {
      const b = req.body || {};
      const ahora = Date.now();
      const promoId = texto(b.promoId);
      const canal = texto(b.canal);
      const accion = texto(b.accion);

      if (!promoId || !canal) return res.status(400).json({ error: 'Faltan la promoción y el canal.' });
      if (!accion) return res.status(400).json({ error: 'Falta decir qué se va a hacer (accion).' });

      // El canal tiene que estar MARCADO en el formato de la promocion: el
      // expediente existe porque el formato lo autorizo ahi.
      const canales = await canalesDeLaPromo(promoId);
      if (canales === null) return res.status(404).json({ error: 'No existe esa promoción.' });
      if (!canales.includes(canal)) {
        return res.status(400).json({
          error: 'La promoción no tiene marcado el canal "' + canal + '" en su formato.',
        });
      }

      const id = 'exp_' + promoId + '_' + slugCanal(canal);

      // Se crea si no existe. `do nothing` y no `do update`: si ya esta, no se
      // toca nada de lo que otro haya subido.
      await query(
        `insert into mdtask_promo_expedientes
           (id, promo_id, canal, estado, piezas_total, importe_total, ventas_total,
            datos, creado_en, creado_por, actualizado_en, eliminado)
         values ($1,$2,$3,'pendiente',0,0,0,'{}'::jsonb,$4,$5,$4,false)
         on conflict (id) do nothing`,
        [id, promoId, canal, ahora, quien]);

      const actual = await query('select * from mdtask_promo_expedientes where id = $1', [id]);
      const datos = { ...((actual.rows[0] && actual.rows[0].datos) || {}) };
      datos.salida = Array.isArray(datos.salida) ? datos.salida : [];
      datos.exhibicion = Array.isArray(datos.exhibicion) ? datos.exhibicion : [];
      datos.ventas = Array.isArray(datos.ventas) ? datos.ventas : [];

      if (accion === 'agregarEvidencia') {
        const seccion = texto(b.seccion);
        if (!SECCIONES.includes(seccion)) {
          return res.status(400).json({ error: 'La sección debe ser: ' + SECCIONES.join(' o ') + '.' });
        }
        const ev = limpiarEvidencia(b.evidencia, quien, ahora);
        if (!ev) return res.status(400).json({ error: 'Falta el archivo de la evidencia.' });
        datos[seccion] = [...datos[seccion], ev];

      } else if (accion === 'quitarEvidencia') {
        const seccion = texto(b.seccion);
        if (!SECCIONES.includes(seccion)) {
          return res.status(400).json({ error: 'La sección debe ser: ' + SECCIONES.join(' o ') + '.' });
        }
        const url = texto(b.url);
        if (!url) return res.status(400).json({ error: 'Falta cuál evidencia quitar.' });
        datos[seccion] = datos[seccion].filter(e => e.url !== url);

      } else if (accion === 'agregarVenta') {
        const v = b.venta || {};
        const url = texto(v.url);
        if (!url) return res.status(400).json({ error: 'La prueba de venta necesita la foto del ticket.' });
        datos.ventas = [...datos.ventas, {
          id: 'vta_' + ahora + '_' + Math.random().toString(36).slice(2, 8),
          url,
          nombre: texto(v.nombre) || 'ticket',
          fecha: texto(v.fecha),
          piezas: numero(v.piezas),
          importe: numero(v.importe),
          // Lo que leyo la IA se guarda TAL CUAL y aparte de lo confirmado, para
          // poder comparar despues si acerto y para no perder el dato original
          // cuando alguien corrige a mano.
          leidoIA: v.leidoIA || null,
          confirmado: v.confirmado === true,
          subidoEn: ahora,
          subidoPor: quien || null,
        }];

      } else if (accion === 'editarVenta') {
        const ventaId = texto(b.ventaId);
        if (!ventaId) return res.status(400).json({ error: 'Falta cuál venta se edita.' });
        let encontrada = false;
        datos.ventas = datos.ventas.map(v => {
          if (v.id !== ventaId) return v;
          encontrada = true;
          return {
            ...v,
            piezas: b.piezas === undefined ? numero(v.piezas) : numero(b.piezas),
            importe: b.importe === undefined ? numero(v.importe) : numero(b.importe),
            confirmado: b.confirmado === undefined ? v.confirmado === true : b.confirmado === true,
            editadoEn: ahora,
            editadoPor: quien || null,
          };
        });
        if (!encontrada) return res.status(404).json({ error: 'No existe esa venta en el expediente.' });

      } else if (accion === 'quitarVenta') {
        const ventaId = texto(b.ventaId);
        if (!ventaId) return res.status(400).json({ error: 'Falta cuál venta quitar.' });
        datos.ventas = datos.ventas.filter(v => v.id !== ventaId);

      } else if (accion === 'nota') {
        datos.nota = texto(b.nota);

      } else {
        return res.status(400).json({ error: 'Acción desconocida: ' + accion });
      }

      const t = totales(datos);
      const r = await query(
        `update mdtask_promo_expedientes
            set datos = $2::jsonb, estado = $3,
                piezas_total = $4, importe_total = $5, ventas_total = $6,
                actualizado_en = $7, eliminado = false
          where id = $1 returning *`,
        [id, JSON.stringify(datos), calcularEstado(datos),
          t.piezas, t.importe, t.ventas, ahora]);

      return res.json({ ok: true, expediente: fila(r.rows[0]) });
    }

    // --------------------------------------------------------------- DELETE
    if (req.method === 'DELETE') {
      const id = texto(q.id);
      if (!id) return res.status(400).json({ error: 'Falta el id del expediente.' });
      const r = await query(
        `update mdtask_promo_expedientes set eliminado = true, actualizado_en = $2
          where id = $1 returning id`, [id, Date.now()]);
      if (!r.rows[0]) return res.status(404).json({ error: 'No existe ese expediente.' });
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    console.error('[promo-expedientes]', e && e.message);
    return res.status(500).json({ error: 'Error del servidor: ' + (e && e.message) });
  }
};

// Los calculos que alimentan el KPI y el ranking se exponen para poder probarlos
// sin base de datos (mismo patron que api/bloques-generar.js con tocaHoy).
module.exports.calculos = { totales, calcularEstado, slugCanal };
