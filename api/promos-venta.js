// ============================================================================
//  VENTA DE PROMOS — el piso de venta, en vivo.
//
//    GET    /api/promos-venta              -> las promos + el acumulado de cada una
//    GET    /api/promos-venta?promo=<id>   -> una promo y su bitacora completa
//    GET    /api/promos-venta?panel=1      -> el tablero de quien monitorea
//    POST   /api/promos-venta              -> una accion (ver abajo)
//    DELETE /api/promos-venta?id=..        -> marca eliminada (no borra)
//
//  TRES OFICIOS, TRES PERMISOS. La seccion es una sola pero cada quien entra a
//  lo suyo, y el permiso se asigna usuario por usuario desde Personal:
//
//    ventaPromosVendedor  crea las promos (nombre, costo, descripcion, foto) y
//                         las vende.
//    ventaPromosCaja      la cajera: da la luz verde cuando la venta se cierra
//                         (o se asegura). Es lo unico que puede hacer.
//    ventaPromosMonitor   ve el tablero y recibe el aviso dentro de la app.
//
//  El POST trabaja por ACCIONES, no reemplazando objetos completos: varias cajas
//  escriben al mismo tiempo y un guardado del objeto entero pisaria lo del
//  vecino. Es el mismo criterio de api/promo-expedientes.js.
//
//    guardarPromo     { promo: { id?, nombre, descripcion, costo, foto, sucursales, ... } }
//    estadoPromo      { promoId, estado: 'activa'|'pausada'|'terminada' }
//    luzVerde         { promoId, sucursal, tipo: 'vendida'|'asegurada', piezas, importe, nota }
//    quitarLuz        { luzId }
//    encargar         { promoId, sucursal, piezas, cliente, nota }   <- el vendedor
//    confirmarEncargo { encargoId }                                  <- la cajera
//    cancelarEncargo  { encargoId, motivo }
//
//  EL CIRCUITO COMPLETO. El vendedor cierra el trato en el piso y manda el
//  ENCARGO ("Juan Perez lleva 3 del combo"). Le aparece a la caja de esa
//  sucursal. Cuando el cliente llega, la cajera confirma que si se las llevo, y
//  ESA confirmacion es la que genera la luz verde del tablero. Si el cliente se
//  arrepiente, se cancela y no cuenta como venta.
//
//  La caja tambien puede dar luz verde directa, sin encargo previo: no toda
//  venta pasa por un vendedor (el cliente que llega solo y la ve en el mostrador).
//
//  EL AVISO ES DENTRO DE LA APP, NO POR WHATSAPP. Se manda como push propio
//  (api/_push.js, el mismo canal de "nueva tarea asignada"): le llega a quien
//  monitorea aunque tenga la app cerrada, y al tocarlo abre /venta-promos.
//
//  Config por variables de entorno:
//    PROMOS_VENTA_AVISOS   'off' apaga los avisos de este modulo
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');
const { enviarPush } = require('./_push');

// Solo apaga los AVISOS. La luz verde se guarda siempre: el registro de la venta
// no depende de que el push salga.
const AVISOS_OFF = String(process.env.PROMOS_VENTA_AVISOS || '').toLowerCase() === 'off';

const ESTADOS = new Set(['activa', 'pausada', 'terminada']);
const TIPOS = new Set(['vendida', 'asegurada']);
/** Cuantos encargos ya resueltos se le devuelven a la caja (para poder deshacer
 *  el que se acaba de confirmar por error). No mas: es una pantalla de trabajo,
 *  no un historial. */
const ENCARGOS_RESUELTOS = 15;

/** Texto limpio (o null): no se guardan cadenas vacias ni undefined. */
function texto(v) {
  const s = String(v == null ? '' : v).trim();
  return s || null;
}

/** Numero >= 0. Nunca NaN, que envenena las sumas del tablero. */
function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Entero >= 1. Una luz verde sin piezas sigue siendo una venta: minimo 1. */
function piezasDe(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Id nuevo: reloj + contador local. Sin Math.random, que no aporta nada aqui. */
let secuencia = 0;
function nuevoId(prefijo) {
  secuencia = (secuencia + 1) % 100000;
  return prefijo + '-' + Date.now().toString(36) + '-' + secuencia.toString(36);
}

function filaPromo(r) {
  const datos = r.datos || {};
  return {
    id: r.id,
    nombre: r.nombre || '',
    descripcion: r.descripcion || '',
    costo: r.costo == null ? null : Number(r.costo),
    fotoUrl: r.foto_url || '',
    estado: r.estado || 'activa',
    vigenciaDel: r.vigencia_del || '',
    vigenciaAl: r.vigencia_al || '',
    sucursales: Array.isArray(datos.sucursales) ? datos.sucursales : [],
    foto: datos.foto || null,
    creadoEn: r.creado_en == null ? null : Number(r.creado_en),
    creadoPor: r.creado_por || null,
    creadoPorNombre: r.creado_por_nombre || '',
    actualizadoEn: r.actualizado_en == null ? null : Number(r.actualizado_en),
  };
}

function filaLuz(r) {
  return {
    id: r.id,
    promoId: r.promo_id,
    promoNombre: r.promo_nombre || '',
    sucursal: r.sucursal,
    tipo: r.tipo || 'vendida',
    piezas: Number(r.piezas || 0),
    importe: r.importe == null ? 0 : Number(r.importe),
    nota: r.nota || '',
    creadoEn: Number(r.creado_en || 0),
    creadoPor: r.creado_por || null,
    creadoPorNombre: r.creado_por_nombre || '',
  };
}

function filaEncargo(r) {
  return {
    id: r.id,
    promoId: r.promo_id,
    promoNombre: r.promo_nombre || '',
    promoFotoUrl: r.promo_foto_url || '',
    promoCosto: r.promo_costo == null ? null : Number(r.promo_costo),
    sucursal: r.sucursal,
    piezas: Number(r.piezas || 0),
    cliente: r.cliente || '',
    estado: r.estado || 'pendiente',
    nota: r.nota || '',
    creadoEn: Number(r.creado_en || 0),
    creadoPor: r.creado_por || null,
    creadoPorNombre: r.creado_por_nombre || '',
    resueltoEn: r.resuelto_en == null ? null : Number(r.resuelto_en),
    resueltoPorNombre: r.resuelto_por_nombre || '',
    motivo: r.motivo || '',
    luzId: r.luz_id || null,
  };
}

// --- Quien es y que puede ----------------------------------------------------
/**
 * Los tres permisos del usuario que llama, leidos de la BASE y no del token: el
 * navegador manda su propia copia de la sesion y esa copia se puede editar.
 *
 * Se FALLA ABIERTO con las identidades que la base no reconoce, por el mismo
 * motivo ya documentado en api/usuarios.js: hay cuentas de acceso sin fila (el
 * administrador general entre ellas) y dejarlas fuera es peor que el hueco. A
 * quien SI tiene fila se le aplica su permiso al pie de la letra.
 */
async function permisos(uid) {
  const abierto = {
    vendedor: true, caja: true, monitor: true, nombre: '',
    sucursales: [], alcanzaTodas: true, desconocido: true,
  };
  if (!uid) return abierto;
  const r = await query(
    'select nombre, rol, alcance, datos from mdtask_usuarios where id = $1', [String(uid)]);
  const fila = r.rows[0];
  if (!fila) return abierto;

  const d = fila.datos || {};
  // Las sucursales del usuario mandan tambien en el TABLERO: quien monitorea
  // Padre Hidalgo ve el tablero de Padre Hidalgo, no el de toda la empresa.
  // Sin sucursales asignadas, o con acceso total, alcanza todas: es la misma
  // convencion que ya usa la caja para elegir desde donde reporta.
  const sucursales = Array.isArray(d.sucursales) ? d.sucursales : [];
  const alcanzaTodas =
    String(fila.alcance || '') === 'global' ||
    !sucursales.length ||
    sucursales.some(x => String(x || '').trim().toLowerCase() === 'general (acceso total)');
  return {
    // NINGUN permiso se le regala al rol admin, ni aqui ni en la pantalla.
    // Antes el admin pasaba de largo "para que pudiera arreglar cosas", y eso
    // hacia que a quien solo monitorea le apareciera el boton de dar luz verde
    // por el simple hecho de ser administrador. La regla es la misma para
    // todos: se tiene el permiso o no se tiene.
    //
    // Al administrador general no lo deja fuera: las cuentas SIN fila en la
    // base (admin, admin-local) siguen fallando abierto mas arriba, por el
    // motivo documentado en api/usuarios.js.
    vendedor: d.ventaPromosVendedor === true,
    caja: d.ventaPromosCaja === true,
    monitor: d.ventaPromosMonitor === true,
    nombre: fila.nombre || '',
    sucursales, alcanzaTodas,
    desconocido: false,
  };
}

function prohibido(res, que) {
  return res.status(403).json({ error: 'No tienes el permiso de ' + que + ' en Venta de Promos.' });
}

// --- Aviso a quien monitorea -------------------------------------------------
/**
 * Le avisa a los monitores, DENTRO DE LA APP, que una caja dio luz verde.
 *
 * Push propio (FCM), no WhatsApp: le entra en el celular aunque tenga la app
 * cerrada y al tocarlo cae directo en el tablero.
 *
 * Es BEST EFFORT y sale DESPUES de contestarle a la cajera: ella esta con un
 * cliente enfrente y no tiene por que esperar a que Firebase conteste. Si el
 * aviso falla queda en el log y la luz verde ya quedo guardada, que es lo unico
 * que no se puede perder. Ademas el tablero se refresca solo, asi que un push
 * perdido no deja a nadie sin enterarse.
 */
async function avisarMonitores(luz, promo, emisorUid) {
  if (AVISOS_OFF) return;

  let destinos = [];
  try {
    const r = await query(
      "select id, nombre from mdtask_usuarios" +
      " where activo is not false" +
      "   and datos->>'ventaPromosMonitor' = 'true'");
    destinos = r.rows;
  } catch (e) {
    console.error('[promos-venta] no se pudo buscar a los monitores:', e.message);
    return;
  }
  if (!destinos.length) return;

  const verbo = luz.tipo === 'asegurada' ? 'apartó' : 'vendió';
  const cuanto = luz.importe > 0
    ? luz.piezas + ' pza(s) · $' + luz.importe.toFixed(2)
    : luz.piezas + ' pza(s)';
  const quien = luz.creadoPorNombre || 'la caja';

  try {
    const r = await enviarPush({
      uids: destinos.map(d => String(d.id)),
      nombres: destinos.map(d => d.nombre).filter(Boolean),
      titulo: '🟢 ' + luz.sucursal + ' ' + verbo + ' ' + promo.nombre,
      cuerpo: cuanto + ' · ' + quien + (luz.nota ? ' · ' + luz.nota : ''),
      url: '/venta-promos',
      excluirUid: emisorUid,
    });
    if (r && r.mensaje) console.log('[promos-venta] aviso:', r.mensaje);
  } catch (e) {
    console.error('[promos-venta] el aviso a los monitores no salio:', e.message);
  }
}

/**
 * Le avisa a las cajas de UNA sucursal que el vendedor mando un encargo.
 *
 * Solo a las de esa sucursal: a la cajera de Morelia no le sirve saber que en
 * Padre Hidalgo viene un cliente, y si le llegara todo acabaria ignorando los
 * avisos. Quien tiene "General (Acceso Total)" si los recibe todos, porque esa
 * es justo la gente que cubre varias.
 *
 * Best effort, igual que el aviso a los monitores: el encargo ya quedo guardado
 * y la caja lo ve en su pantalla aunque el push no salga.
 */
async function avisarCajas(encargo, promo, emisorUid) {
  if (AVISOS_OFF) return;

  let destinos = [];
  try {
    const r = await query(
      `select id, nombre from mdtask_usuarios
        where activo is not false
          and datos->>'ventaPromosCaja' = 'true'
          and (datos->'sucursales' @> $1::jsonb
               or datos->'sucursales' @> '["General (Acceso Total)"]'::jsonb
               or datos->'sucursales' is null
               or jsonb_array_length(coalesce(datos->'sucursales', '[]'::jsonb)) = 0)`,
      [JSON.stringify([encargo.sucursal])]);
    destinos = r.rows;
  } catch (e) {
    console.error('[promos-venta] no se pudo buscar a las cajas:', e.message);
    return;
  }
  if (!destinos.length) return;

  const cliente = encargo.cliente || 'un cliente';
  try {
    await enviarPush({
      uids: destinos.map(d => String(d.id)),
      nombres: destinos.map(d => d.nombre).filter(Boolean),
      titulo: '🛎️ ' + cliente + ' lleva ' + encargo.piezas + ' × ' + promo.nombre,
      cuerpo: 'Lo mandó ' + (encargo.creadoPorNombre || 'un vendedor') +
              ' · confírmalo cuando pase a caja',
      url: '/venta-promos',
      excluirUid: emisorUid,
    });
  } catch (e) {
    console.error('[promos-venta] el aviso a las cajas no salio:', e.message);
  }
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
    const puede = await permisos(quien);

    // ------------------------------------------------------------------ GET
    if (req.method === 'GET') {
      // --- El tablero de quien monitorea --------------------------------
      if (q.panel) {
        const desde = Number(q.desde) || (Date.now() - 7 * 24 * 60 * 60 * 1000);

        // EL TABLERO SE ACOTA A LAS SUCURSALES DEL QUE MIRA.
        //
        // Quien monitorea Padre Hidalgo ve el tablero de Padre Hidalgo: sus
        // cifras, sus vendedores y su pulso. No las de toda la empresa. Quien
        // trae acceso total (o no tiene sucursales asignadas) sigue viendolo
        // todo, que es la misma convencion que usa la caja para elegir desde
        // donde reporta.
        //
        // El filtro va en el SQL y no en el navegador a proposito: filtrar al
        // pintar significa que los numeros de las demas sucursales YA viajaron
        // hasta el celular, y ahi ya no es un candado, es un adorno.
        const soloMias = !puede.alcanzaTodas;
        const mias = puede.sucursales;
        const arg = soloMias ? [desde, mias] : [desde];
        //  ...and sucursal = any($2)  — vacio cuando alcanza todas.
        const filtroLuz = soloMias ? ' and l.sucursal = any($2)' : '';
        const filtroLuzSolo = soloMias ? ' and sucursal = any($2)' : '';
        const filtroEnc = soloMias ? ' and e.sucursal = any($2)' : '';

        const porPromo = await query(
          `select p.id, p.nombre, p.foto_url, p.costo, p.estado,
                  count(l.id) filter (where l.tipo = 'vendida')::int   as vendidas,
                  count(l.id) filter (where l.tipo = 'asegurada')::int as aseguradas,
                  coalesce(sum(l.piezas)  filter (where l.tipo = 'vendida'), 0)::int     as piezas,
                  coalesce(sum(l.importe) filter (where l.tipo = 'vendida'), 0)::numeric as importe,
                  max(l.creado_en) as ultima
             from mdtask_promos_venta p
             left join mdtask_promos_luzverde l
                    on l.promo_id = p.id and l.eliminado = false and l.creado_en >= $1
                       ${filtroLuz}
            where p.eliminado = false
            group by p.id, p.nombre, p.foto_url, p.costo, p.estado
            order by piezas desc, p.nombre asc`, arg);

        const porSucursal = await query(
          `select sucursal,
                  count(*) filter (where tipo = 'vendida')::int   as vendidas,
                  count(*) filter (where tipo = 'asegurada')::int as aseguradas,
                  coalesce(sum(piezas)  filter (where tipo = 'vendida'), 0)::int     as piezas,
                  coalesce(sum(importe) filter (where tipo = 'vendida'), 0)::numeric as importe,
                  max(creado_en) as ultima
             from mdtask_promos_luzverde
            where eliminado = false and creado_en >= $1${filtroLuzSolo}
            group by sucursal
            order by piezas desc`, arg);

        // QUIEN VENDE MAS. Sale de los ENCARGOS, no de las luces verdes, y la
        // diferencia importa: en la luz verde queda anotada la CAJERA que
        // cobro, no quien hizo la venta. El vendedor solo aparece en el
        // encargo que mando desde el piso.
        //
        // Se cuentan tambien las canceladas a proposito. Sin ellas, quien manda
        // encargos que despues nadie recoge se ve igual de bien que quien
        // cierra de verdad, y esa es justo la diferencia que quien monitorea
        // necesita ver.
        const porVendedor = await query(
          `select e.creado_por, e.creado_por_nombre,
                  count(*) filter (where e.estado = 'confirmado')::int as ventas,
                  count(*) filter (where e.estado = 'cancelado')::int  as canceladas,
                  count(*) filter (where e.estado = 'pendiente')::int  as pendientes,
                  coalesce(sum(e.piezas) filter (where e.estado = 'confirmado'), 0)::int as piezas,
                  coalesce(sum(l.importe), 0)::numeric as importe,
                  max(e.creado_en) as ultima
             from mdtask_promos_encargos e
             left join mdtask_promos_luzverde l
                    on l.id = e.luz_id and l.eliminado = false
            where e.eliminado = false and e.creado_en >= $1${filtroEnc}
              and coalesce(e.creado_por_nombre, '') <> ''
            group by e.creado_por, e.creado_por_nombre
            order by piezas desc, importe desc`, arg);

        // El pulso: lo ultimo que entro, que es lo que de verdad se mira.
        const recientes = await query(
          `select l.*, p.nombre as promo_nombre
             from mdtask_promos_luzverde l
             join mdtask_promos_venta p on p.id = l.promo_id
            where l.eliminado = false and l.creado_en >= $1${filtroLuz}
            order by l.creado_en desc limit 100`, arg);

        return res.json({
          desde,
          porPromo: porPromo.rows.map(r => ({
            id: r.id, nombre: r.nombre, fotoUrl: r.foto_url || '', estado: r.estado,
            costo: r.costo == null ? null : Number(r.costo),
            vendidas: Number(r.vendidas || 0), aseguradas: Number(r.aseguradas || 0),
            piezas: Number(r.piezas || 0), importe: Number(r.importe || 0),
            ultima: r.ultima == null ? null : Number(r.ultima),
          })),
          porSucursal: porSucursal.rows.map(r => ({
            sucursal: r.sucursal,
            vendidas: Number(r.vendidas || 0), aseguradas: Number(r.aseguradas || 0),
            piezas: Number(r.piezas || 0), importe: Number(r.importe || 0),
            ultima: r.ultima == null ? null : Number(r.ultima),
          })),
          porVendedor: porVendedor.rows.map(r => {
            const ventas = Number(r.ventas || 0);
            const canceladas = Number(r.canceladas || 0);
            const cerradas = ventas + canceladas;
            return {
              uid: r.creado_por, nombre: r.creado_por_nombre,
              ventas, canceladas, pendientes: Number(r.pendientes || 0),
              piezas: Number(r.piezas || 0), importe: Number(r.importe || 0),
              // De lo que ya se resolvio, cuanto acabo en venta. Las pendientes
              // NO cuentan: todavia no se sabe en que van a quedar, y meterlas
              // castigaria al que acaba de mandar un encargo hace un minuto.
              efectividad: cerradas ? Math.round((ventas / cerradas) * 100) : null,
              ultima: r.ultima == null ? null : Number(r.ultima),
            };
          }),
          recientes: recientes.rows.map(filaLuz),
        });
      }

      // --- Una promo con su bitacora completa ---------------------------
      if (q.promo) {
        const p = await query(
          'select * from mdtask_promos_venta where id = $1 and eliminado = false',
          [String(q.promo)]);
        if (!p.rows[0]) return res.status(404).json({ error: 'No existe esa promo.' });
        const l = await query(
          `select l.*, p.nombre as promo_nombre
             from mdtask_promos_luzverde l
             join mdtask_promos_venta p on p.id = l.promo_id
            where l.promo_id = $1 and l.eliminado = false
            order by l.creado_en desc limit 500`, [String(q.promo)]);
        return res.json({ promo: filaPromo(p.rows[0]), luces: l.rows.map(filaLuz) });
      }

      // --- La lista, con el acumulado de cada promo ---------------------
      const promos = await query(
        `select p.*,
                coalesce(sum(l.piezas)  filter (where l.tipo = 'vendida'), 0)::int     as piezas,
                coalesce(sum(l.importe) filter (where l.tipo = 'vendida'), 0)::numeric as importe,
                count(l.id) filter (where l.tipo = 'vendida')::int   as vendidas,
                count(l.id) filter (where l.tipo = 'asegurada')::int as aseguradas,
                max(l.creado_en) as ultima
           from mdtask_promos_venta p
           left join mdtask_promos_luzverde l on l.promo_id = p.id and l.eliminado = false
          where p.eliminado = false
          group by p.id
          order by (p.estado = 'activa') desc, p.creado_en desc`);

      // Los encargos que la caja tiene que atender. Se piden con la sucursal
      // porque la caja solo trabaja la suya; sin sucursal no se devuelve nada,
      // que es lo correcto: una lista de encargos de toda la cadena no le
      // sirve a nadie y solo confundiria a quien esta en el mostrador.
      let encargos = [];
      const suc = texto(q.sucursal);
      if (suc) {
        const e = await query(
          `select e.*, p.nombre as promo_nombre, p.foto_url as promo_foto_url,
                  p.costo as promo_costo
             from mdtask_promos_encargos e
             join mdtask_promos_venta p on p.id = e.promo_id
            where e.sucursal = $1 and e.eliminado = false
              and (e.estado = 'pendiente' or e.resuelto_en > $2)
            order by (e.estado = 'pendiente') desc, e.creado_en asc
            limit 100`,
          [suc, Date.now() - 12 * 60 * 60 * 1000]);
        encargos = e.rows.map(filaEncargo);
      }

      // Lo que el vendedor mando, para que vea en que quedo.
      let mios = [];
      if (puede.vendedor && quien) {
        const m = await query(
          `select e.*, p.nombre as promo_nombre, p.foto_url as promo_foto_url,
                  p.costo as promo_costo
             from mdtask_promos_encargos e
             join mdtask_promos_venta p on p.id = e.promo_id
            where e.creado_por = $1 and e.eliminado = false
            order by e.creado_en desc limit 30`, [quien]);
        mios = m.rows.map(filaEncargo);
      }

      return res.json({
        promos: promos.rows.map(r => Object.assign(filaPromo(r), {
          piezas: Number(r.piezas || 0), importe: Number(r.importe || 0),
          vendidas: Number(r.vendidas || 0), aseguradas: Number(r.aseguradas || 0),
          ultima: r.ultima == null ? null : Number(r.ultima),
        })),
        encargos,
        misEncargos: mios,
        permisos: { vendedor: puede.vendedor, caja: puede.caja, monitor: puede.monitor },
      });
    }

    // ----------------------------------------------------------------- POST
    if (req.method === 'POST') {
      const cuerpo = req.body || {};
      const accion = String(cuerpo.accion || '');
      const ahora = Date.now();

      // --- Crear o editar una promo (solo el vendedor) ------------------
      if (accion === 'guardarPromo') {
        if (!puede.vendedor) return prohibido(res, 'crear promos');
        const p = cuerpo.promo || {};
        const nombre = texto(p.nombre);
        if (!nombre) return res.status(400).json({ error: 'La promo necesita un nombre.' });

        const datos = {
          sucursales: Array.isArray(p.sucursales) ? p.sucursales.filter(Boolean) : [],
          foto: p.foto || null,
        };
        const estado = ESTADOS.has(String(p.estado)) ? String(p.estado) : 'activa';
        const costo = (p.costo == null || p.costo === '') ? null : numero(p.costo);
        const fotoUrl = texto(p.foto && p.foto.url) || texto(p.fotoUrl);

        if (texto(p.id)) {
          const r = await query(
            `update mdtask_promos_venta
                set nombre = $2, descripcion = $3, costo = $4, foto_url = $5,
                    estado = $6, vigencia_del = $7, vigencia_al = $8,
                    datos = $9, actualizado_en = $10
              where id = $1 and eliminado = false
              returning *`,
            [texto(p.id), nombre, texto(p.descripcion), costo, fotoUrl, estado,
              texto(p.vigenciaDel), texto(p.vigenciaAl), JSON.stringify(datos), ahora]);
          if (!r.rows[0]) return res.status(404).json({ error: 'No existe esa promo.' });
          return res.json({ promo: filaPromo(r.rows[0]) });
        }

        const r = await query(
          `insert into mdtask_promos_venta
             (id, nombre, descripcion, costo, foto_url, estado, vigencia_del, vigencia_al,
              datos, creado_en, creado_por, creado_por_nombre, actualizado_en)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$10)
           returning *`,
          [nuevoId('pv'), nombre, texto(p.descripcion), costo, fotoUrl, estado,
            texto(p.vigenciaDel), texto(p.vigenciaAl), JSON.stringify(datos),
            ahora, quien, puede.nombre]);
        return res.json({ promo: filaPromo(r.rows[0]) });
      }

      // --- Prender / pausar / terminar una promo ------------------------
      if (accion === 'estadoPromo') {
        if (!puede.vendedor) return prohibido(res, 'administrar promos');
        const estado = String(cuerpo.estado || '');
        if (!ESTADOS.has(estado)) return res.status(400).json({ error: 'Estado no válido.' });
        const r = await query(
          `update mdtask_promos_venta set estado = $2, actualizado_en = $3
            where id = $1 and eliminado = false returning *`,
          [String(cuerpo.promoId || ''), estado, ahora]);
        if (!r.rows[0]) return res.status(404).json({ error: 'No existe esa promo.' });
        return res.json({ promo: filaPromo(r.rows[0]) });
      }

      // --- LA LUZ VERDE (la caja) ---------------------------------------
      if (accion === 'luzVerde') {
        if (!puede.caja) return prohibido(res, 'dar luz verde');
        const promoId = texto(cuerpo.promoId);
        const sucursal = texto(cuerpo.sucursal);
        if (!promoId || !sucursal) {
          return res.status(400).json({ error: 'Falta la promo o la sucursal.' });
        }
        const tipo = TIPOS.has(String(cuerpo.tipo)) ? String(cuerpo.tipo) : 'vendida';

        // La promo tiene que existir y estar VIVA. Dar luz verde a una promo ya
        // terminada es justo el error que despues nadie sabe explicar cuando el
        // tablero no cuadra.
        const p = await query(
          'select * from mdtask_promos_venta where id = $1 and eliminado = false',
          [promoId]);
        if (!p.rows[0]) return res.status(404).json({ error: 'No existe esa promo.' });
        const promo = filaPromo(p.rows[0]);
        if (promo.estado !== 'activa') {
          return res.status(409).json({ error: 'Esa promo está ' + promo.estado + '. No se puede reportar venta.' });
        }

        const cuantas = piezasDe(cuerpo.piezas);
        // Si no capturan importe se calcula con el costo de la promo: es lo que
        // hace que el tablero sirva sin obligar a la cajera a teclear nada.
        const importe = (cuerpo.importe != null && cuerpo.importe !== '')
          ? numero(cuerpo.importe)
          : (promo.costo != null ? Math.round(promo.costo * cuantas * 100) / 100 : 0);

        const r = await query(
          `insert into mdtask_promos_luzverde
             (id, promo_id, sucursal, tipo, piezas, importe, nota,
              creado_en, creado_por, creado_por_nombre)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           returning *`,
          [nuevoId('lv'), promoId, sucursal, tipo, cuantas, importe,
            texto(cuerpo.nota), ahora, quien, puede.nombre]);

        const luz = filaLuz(Object.assign({}, r.rows[0], { promo_nombre: promo.nombre }));

        // Se contesta YA; el aviso sale despues (ver avisarMonitores).
        res.json({ luz });
        avisarMonitores(luz, promo, quien).catch(e =>
          console.error('[promos-venta] avisarMonitores:', e.message));
        return;
      }

      // --- EL VENDEDOR MANDA EL ENCARGO ---------------------------------
      if (accion === 'encargar') {
        if (!puede.vendedor) return prohibido(res, 'mandar encargos a caja');
        const promoId = texto(cuerpo.promoId);
        const sucursal = texto(cuerpo.sucursal);
        if (!promoId || !sucursal) {
          return res.status(400).json({ error: 'Falta la promo o la sucursal.' });
        }

        const p = await query(
          'select * from mdtask_promos_venta where id = $1 and eliminado = false',
          [promoId]);
        if (!p.rows[0]) return res.status(404).json({ error: 'No existe esa promo.' });
        const promo = filaPromo(p.rows[0]);
        if (promo.estado !== 'activa') {
          return res.status(409).json({ error: 'Esa promo está ' + promo.estado + '. No se puede vender.' });
        }

        const r = await query(
          `insert into mdtask_promos_encargos
             (id, promo_id, sucursal, piezas, cliente, estado, nota,
              creado_en, creado_por, creado_por_nombre)
           values ($1,$2,$3,$4,$5,'pendiente',$6,$7,$8,$9)
           returning *`,
          [nuevoId('en'), promoId, sucursal, piezasDe(cuerpo.piezas),
            texto(cuerpo.cliente), texto(cuerpo.nota), ahora, quien, puede.nombre]);

        const encargo = filaEncargo(Object.assign({}, r.rows[0], {
          promo_nombre: promo.nombre, promo_foto_url: promo.fotoUrl, promo_costo: promo.costo,
        }));

        // Se contesta YA; el aviso a la caja sale despues.
        res.json({ encargo });
        avisarCajas(encargo, promo, quien).catch(e =>
          console.error('[promos-venta] avisarCajas:', e.message));
        return;
      }

      // --- LA CAJERA CONFIRMA QUE EL CLIENTE SI SE LAS LLEVO -------------
      if (accion === 'confirmarEncargo') {
        if (!puede.caja) return prohibido(res, 'confirmar encargos');
        const encargoId = texto(cuerpo.encargoId);
        if (!encargoId) return res.status(400).json({ error: 'Falta el encargo.' });

        // Se toma el encargo SOLO si sigue pendiente. Si dos cajeras le pican
        // al mismo tiempo, la segunda no encuentra fila y no se duplica la
        // venta: el candado es el `estado = 'pendiente'` del update, no una
        // lectura previa (que si dejaria pasar a las dos).
        const tomado = await query(
          `update mdtask_promos_encargos
              set estado = 'confirmado', resuelto_en = $2,
                  resuelto_por = $3, resuelto_por_nombre = $4
            where id = $1 and estado = 'pendiente' and eliminado = false
            returning *`,
          [encargoId, ahora, quien, puede.nombre]);
        if (!tomado.rows[0]) {
          return res.status(409).json({ error: 'Ese encargo ya fue atendido por alguien más.' });
        }
        const enc = tomado.rows[0];

        const p = await query(
          'select * from mdtask_promos_venta where id = $1', [enc.promo_id]);
        const promo = p.rows[0] ? filaPromo(p.rows[0]) : { nombre: '', costo: null };

        // La confirmacion es la que produce la venta del tablero.
        const cuantas = Number(enc.piezas) || 1;
        const importe = promo.costo != null
          ? Math.round(promo.costo * cuantas * 100) / 100 : 0;
        const lz = await query(
          `insert into mdtask_promos_luzverde
             (id, promo_id, sucursal, tipo, piezas, importe, nota,
              creado_en, creado_por, creado_por_nombre)
           values ($1,$2,$3,'vendida',$4,$5,$6,$7,$8,$9)
           returning *`,
          [nuevoId('lv'), enc.promo_id, enc.sucursal, cuantas, importe,
            enc.cliente ? 'Cliente: ' + enc.cliente : null,
            ahora, quien, puede.nombre]);

        await query('update mdtask_promos_encargos set luz_id = $2 where id = $1',
          [encargoId, lz.rows[0].id]);

        const luz = filaLuz(Object.assign({}, lz.rows[0], { promo_nombre: promo.nombre }));
        const encargo = filaEncargo(Object.assign({}, enc, {
          luz_id: lz.rows[0].id, promo_nombre: promo.nombre,
          promo_foto_url: promo.fotoUrl, promo_costo: promo.costo,
        }));

        res.json({ encargo, luz });
        avisarMonitores(luz, promo, quien).catch(e =>
          console.error('[promos-venta] avisarMonitores:', e.message));
        return;
      }

      // --- EL CLIENTE NO SE LAS LLEVO -----------------------------------
      if (accion === 'cancelarEncargo') {
        const encargoId = texto(cuerpo.encargoId);
        if (!encargoId) return res.status(400).json({ error: 'Falta el encargo.' });

        // La cajera cancela cualquiera de su mostrador; el vendedor solo lo
        // suyo (se equivoco al mandarlo y lo corrige el mismo).
        const r = puede.caja
          ? await query(
            `update mdtask_promos_encargos
                set estado = 'cancelado', resuelto_en = $2, resuelto_por = $3,
                    resuelto_por_nombre = $4, motivo = $5
              where id = $1 and estado = 'pendiente' and eliminado = false
              returning *`,
            [encargoId, ahora, quien, puede.nombre, texto(cuerpo.motivo)])
          : await query(
            `update mdtask_promos_encargos
                set estado = 'cancelado', resuelto_en = $2, resuelto_por = $3,
                    resuelto_por_nombre = $4, motivo = $5
              where id = $1 and estado = 'pendiente' and eliminado = false
                and creado_por = $6
              returning *`,
            [encargoId, ahora, quien, puede.nombre, texto(cuerpo.motivo), quien]);

        if (!r.rows[0]) {
          return res.status(409).json({ error: 'Ese encargo ya fue atendido, o no es tuyo.' });
        }
        return res.json({ encargo: filaEncargo(r.rows[0]) });
      }

      // --- Deshacer una luz verde ---------------------------------------
      if (accion === 'quitarLuz') {
        const luzId = texto(cuerpo.luzId);
        if (!luzId) return res.status(400).json({ error: 'Falta la luz verde.' });
        // La cajera deshace LO SUYO (se equivoco de promo y lo ve al momento);
        // quien monitorea puede quitar cualquiera, que es parte de su trabajo.
        const r = puede.monitor
          ? await query(
            `update mdtask_promos_luzverde set eliminado = true
              where id = $1 and eliminado = false returning id`, [luzId])
          : await query(
            `update mdtask_promos_luzverde set eliminado = true
              where id = $1 and eliminado = false and creado_por = $2 returning id`,
            [luzId, quien]);
        if (!r.rows[0]) {
          return res.status(404).json({ error: 'Esa luz verde ya no está, o no es tuya.' });
        }
        // Si esa venta salio de un encargo, el encargo vuelve a quedar
        // PENDIENTE. Dejarlo como "confirmado" con su venta ya borrada seria
        // mentir: la caja lo veria atendido y el cliente se quedaria sin que
        // nadie le cobre la promo.
        await query(
          `update mdtask_promos_encargos
              set estado = 'pendiente', resuelto_en = null, resuelto_por = null,
                  resuelto_por_nombre = null, luz_id = null
            where luz_id = $1 and eliminado = false`, [luzId]).catch(e =>
          console.error('[promos-venta] no se pudo revertir el encargo:', e.message));
        return res.json({ ok: true, id: luzId });
      }

      return res.status(400).json({ error: 'Acción no reconocida: ' + accion });
    }

    // --------------------------------------------------------------- DELETE
    if (req.method === 'DELETE') {
      if (!puede.vendedor) return prohibido(res, 'eliminar promos');
      const id = texto(q.id);
      if (!id) return res.status(400).json({ error: 'Falta el id.' });
      await query(
        'update mdtask_promos_venta set eliminado = true, actualizado_en = $2 where id = $1',
        [id, Date.now()]);
      return res.json({ ok: true, id });
    }

    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    console.error('[promos-venta]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
