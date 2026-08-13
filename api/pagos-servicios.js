// ============================================================================
//  API de los PAGOS de servicios (una fila por servicio y periodo).
//
//    GET    /api/pagos-servicios                 -> pagos (filtros opcionales)
//    GET    /api/pagos-servicios?resumen=1       -> tablero: totales por sucursal
//    POST   /api/pagos-servicios                 -> registra/edita un pago
//    DELETE /api/pagos-servicios?id=..           -> marca eliminado
//
//  Filtros del GET: sucursal, estado, periodo, servicioId, desde, hasta.
//  `estado` acepta los estados VISIBLES ('vencido', 'por_vencer'), que no se
//  guardan en la base sino que se deducen de la fecha limite (ver
//  _pagos-periodos.js). Por eso el filtro por estado se aplica en memoria: son
//  cientos de filas al ano, no millones, y asi la regla vive en un solo lugar.
//
//  Las filas las CREA el generador (api/pagos-notificar.js) a partir del
//  catalogo. Este endpoint sirve para registrarles el pago desde la app cuando
//  no llego por WhatsApp, y para corregir lo que haga falta.
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');
const { exigirAccesoPagos } = require('./_pagos-acceso');
const { estadoVisible, diasFaltantes, hoyMexico } = require('./_pagos-periodos');

const FORMAS_PAGO = ['efectivo', 'tarjeta', 'transferencia'];
const ESTADOS_GUARDADOS = ['pendiente', 'pagado', 'cancelado'];

function fila(r) {
  return {
    id: r.id,
    servicioId: r.servicio_id,
    sucursal: r.sucursal,
    tipo: r.tipo,
    periodo: r.periodo,
    periodoTexto: r.periodo_texto,
    fechaLimite: r.fecha_limite,
    estado: r.estado,
    monto: r.monto == null ? null : Number(r.monto),
    formaPago: r.forma_pago,
    pagadoEn: r.pagado_en == null ? null : Number(r.pagado_en),
    comprobanteUrl: r.comprobante_url,
    comprobanteTipo: r.comprobante_tipo,
    registradoPor: r.registrado_por,
    canal: r.canal,
    // Como le fue al ultimo recordatorio. Se expone para que en el tablero se
    // distinga "ya le avise y no ha pagado" de "no tengo forma de avisarle",
    // que es un problema muy distinto y hoy solo se veia en los logs.
    avisoDia: (r.avisos || {}).ultimoDia || null,
    avisoMotivo: (r.avisos || {}).ultimoMotivo || null,
    creadoEn: r.creado_en == null ? null : Number(r.creado_en),
    actualizadoEn: r.actualizado_en == null ? null : Number(r.actualizado_en),
    // Datos del servicio (vienen del join): el tablero los necesita para
    // mostrar el proveedor y saber a quien reclamarle.
    proveedor: r.proveedor || null,
    referencia: r.referencia || null,
    departamento: r.departamento || null,
    periodicidad: r.periodicidad || null,
    diasAviso: r.dias_aviso == null ? null : Number(r.dias_aviso),
    responsableNombre: r.responsable_nombre || null,
    responsableTelefono: r.responsable_telefono || null,
    montoEstimado: r.monto_estimado == null ? null : Number(r.monto_estimado),
    ...(r.datos || {}),
  };
}

/** Cada pago con su estado visible y los dias que le faltan ya calculados. */
function conEstado(p, hoy) {
  const visible = estadoVisible(
    { estado: p.estado, fechaLimite: p.fechaLimite },
    { diasAviso: p.diasAviso },
    hoy
  );
  return { ...p, estadoVisible: visible, diasFaltantes: diasFaltantes(p.fechaLimite, hoy) };
}

// El join se repite en las dos consultas; se escribe una sola vez.
const SELECT_PAGOS = `
  select p.*, s.proveedor, s.referencia, s.departamento, s.periodicidad,
         s.dias_aviso, s.responsable_nombre, s.responsable_telefono, s.monto_estimado
    from mdtask_pagos_servicios p
    left join mdtask_servicios s on s.id = p.servicio_id
   where p.eliminado = false`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  let usuario = null;
  try { usuario = await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  if (!(await exigirAccesoPagos(usuario, res))) return;

  const hoy = hoyMexico();

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const cond = [];
      const args = [];

      if (q.id) { args.push(String(q.id)); cond.push(`p.id = $${args.length}`); }
      if (q.servicioId) { args.push(String(q.servicioId)); cond.push(`p.servicio_id = $${args.length}`); }
      if (q.sucursal) { args.push(String(q.sucursal)); cond.push(`p.sucursal = $${args.length}`); }
      if (q.periodo) { args.push(String(q.periodo)); cond.push(`p.periodo = $${args.length}`); }
      // Rango por fecha limite (para "que se vence esta semana").
      if (q.desde) { args.push(String(q.desde)); cond.push(`p.fecha_limite >= $${args.length}`); }
      if (q.hasta) { args.push(String(q.hasta)); cond.push(`p.fecha_limite <= $${args.length}`); }

      const sql = `${SELECT_PAGOS} ${cond.length ? 'and ' + cond.join(' and ') : ''}
                   order by p.fecha_limite desc nulls last, p.sucursal asc limit 2000`;
      const r = await query(sql, args);
      let pagos = r.rows.map(fila).map(p => conEstado(p, hoy));

      // El filtro por estado se aplica aqui porque 'vencido'/'por_vencer' son
      // calculados, no columnas.
      if (q.estado) {
        const quiere = String(q.estado).split(',').map(s => s.trim()).filter(Boolean);
        pagos = pagos.filter(p => quiere.includes(p.estadoVisible));
      }

      if (q.resumen) {
        // Tablero: un renglon por sucursal con el semaforo ya contado.
        const porSucursal = new Map();
        for (const p of pagos) {
          const clave = p.sucursal || p.departamento || 'Sin asignar';
          if (!porSucursal.has(clave)) {
            porSucursal.set(clave, {
              sucursal: clave, total: 0, pagados: 0, vencidos: 0, porVencer: 0,
              pendientes: 0, montoPagado: 0, montoVencido: 0,
            });
          }
          const acc = porSucursal.get(clave);
          acc.total++;
          if (p.estadoVisible === 'pagado') { acc.pagados++; acc.montoPagado += Number(p.monto || 0); }
          else if (p.estadoVisible === 'vencido') { acc.vencidos++; acc.montoVencido += Number(p.montoEstimado || 0); }
          else if (p.estadoVisible === 'por_vencer') acc.porVencer++;
          else if (p.estadoVisible === 'pendiente') acc.pendientes++;
        }
        const resumen = Array.from(porSucursal.values())
          .sort((a, b) => b.vencidos - a.vencidos || a.sucursal.localeCompare(b.sucursal));
        return res.json({ resumen, pagos, hoy });
      }

      return res.json({ pagos, hoy });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const id = String(b.id || '');
      if (!id) return res.status(400).json({ error: 'Falta el id del pago.' });

      // AVISAR AHORA (botón del tablero): manda el recordatorio en el momento,
      // sin esperar al poll ni a la hora del servicio. Va aquí y no en un
      // endpoint aparte porque es una acción sobre un pago concreto.
      if (b.accion === 'avisar') {
        const { avisarAhora } = require('./pagos-notificar');
        const r = await avisarAhora(id);
        // Siempre 200: el frontend necesita el texto y el motivo para ofrecer
        // mandarlo a mano. Un 500 aquí solo mostraría "error" y perdería el dato.
        return res.json(r);
      }

      const r0 = await query('select * from mdtask_pagos_servicios where id = $1 and eliminado = false', [id]);
      const actual = r0.rows[0];
      if (!actual) return res.status(404).json({ error: 'No existe ese pago.' });

      const ahora = Date.now();
      const quien = usuario?.uid || usuario?.email || null;

      // --- Validaciones de lo que puede cambiar desde la app ---
      let estado = actual.estado;
      if (b.estado !== undefined) {
        estado = String(b.estado);
        if (!ESTADOS_GUARDADOS.includes(estado)) {
          return res.status(400).json({ error: `Estado inválido. Usa: ${ESTADOS_GUARDADOS.join(', ')}.` });
        }
      }

      let monto = actual.monto == null ? null : Number(actual.monto);
      if (b.monto !== undefined) {
        monto = b.monto === '' || b.monto == null ? null : Number(b.monto);
        if (monto != null && (!Number.isFinite(monto) || monto < 0)) {
          return res.status(400).json({ error: 'El monto no es un número válido.' });
        }
      }

      let formaPago = actual.forma_pago;
      if (b.formaPago !== undefined) {
        formaPago = String(b.formaPago || '').toLowerCase() || null;
        if (formaPago && !FORMAS_PAGO.includes(formaPago)) {
          return res.status(400).json({ error: `Forma de pago inválida. Usa: ${FORMAS_PAGO.join(', ')}.` });
        }
      }

      // Marcar como pagado exige comprobante: es justo el descuido que este
      // modulo viene a resolver. Si se permitiera "pagado" a secas, en tres
      // meses el tablero estaria lleno de verdes sin un solo recibo detras.
      const comprobanteUrl = b.comprobanteUrl !== undefined
        ? (String(b.comprobanteUrl || '').trim() || null)
        : actual.comprobante_url;
      if (estado === 'pagado' && !comprobanteUrl) {
        return res.status(400).json({ error: 'Para marcar un pago como pagado hace falta el comprobante.' });
      }

      const comprobanteTipo = b.comprobanteTipo !== undefined
        ? (String(b.comprobanteTipo || '').trim() || null)
        : actual.comprobante_tipo;

      // `pagado_en` se pone la primera vez que pasa a pagado y se respeta si ya
      // lo traia (para no mover la fecha real cada vez que alguien edita algo).
      let pagadoEn = actual.pagado_en == null ? null : Number(actual.pagado_en);
      if (estado === 'pagado' && !pagadoEn) pagadoEn = ahora;
      if (estado !== 'pagado') pagadoEn = null;

      const extras = { ...(actual.datos || {}) };
      if (b.notas !== undefined) extras.notas = String(b.notas || '').trim() || null;

      await query(
        `update mdtask_pagos_servicios set
           estado = $2, monto = $3, forma_pago = $4, pagado_en = $5,
           comprobante_url = $6, comprobante_tipo = $7,
           registrado_por = coalesce($8, registrado_por),
           canal = coalesce($9, canal),
           datos = coalesce(datos,'{}'::jsonb) || $10::jsonb,
           actualizado_en = $11
         where id = $1`,
        [
          id, estado, monto, formaPago, pagadoEn, comprobanteUrl, comprobanteTipo,
          estado === 'pagado' ? quien : null,
          estado === 'pagado' ? (actual.canal || 'app') : actual.canal,
          JSON.stringify(extras), ahora,
        ]
      );

      const r = await query(`${SELECT_PAGOS} and p.id = $1`, [id]);
      return res.json({ ok: true, pago: conEstado(fila(r.rows[0]), hoy) });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '');
      if (!id) return res.status(400).json({ error: 'Falta el id del pago.' });
      const r = await query(
        `update mdtask_pagos_servicios set eliminado = true, actualizado_en = $2
          where id = $1 returning id`, [id, Date.now()]);
      if (!r.rows[0]) return res.status(404).json({ error: 'No existe ese pago.' });
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    console.error('[pagos-servicios]', e && e.message);
    return res.status(500).json({ error: 'Error del servidor: ' + (e && e.message) });
  }
};
