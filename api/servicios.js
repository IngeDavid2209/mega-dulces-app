// ============================================================================
//  API del CATALOGO de servicios contratados (luz, agua, internet, renta...).
//
//    GET    /api/servicios          -> lista (activos e inactivos, sin borrados)
//    GET    /api/servicios?id=..    -> uno
//    POST   /api/servicios          -> crea o actualiza (merge en `datos`)
//    DELETE /api/servicios?id=..    -> marca eliminado (NO borra la fila)
//
//  Cada fila es un servicio que se paga cada mes o cada dos meses. El pago de
//  cada periodo NO se crea aqui: lo genera solo api/pagos-notificar.js a partir
//  de este catalogo (ver `dia_limite` y `periodicidad`).
//
//  El borrado es logico a proposito: al servicio le cuelgan pagos con
//  comprobantes; borrarlo de verdad dejaria huerfano el historial.
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');
const { exigirAccesoPagos } = require('./_pagos-acceso');

const TIPOS = ['luz', 'agua', 'internet', 'gas', 'telefono', 'renta', 'otro'];
const PERIODICIDADES = ['mensual', 'bimestral'];

/** Solo digitos, ultimos 10 (asi se guarda todo telefono en el sistema). */
function telefono10(v) {
  const n = String(v || '').replace(/\D/g, '');
  return n.length >= 10 ? n.slice(-10) : n;
}

function fila(r) {
  return {
    id: r.id,
    sucursal: r.sucursal,
    departamento: r.departamento,
    tipo: r.tipo,
    proveedor: r.proveedor,
    referencia: r.referencia,
    periodicidad: r.periodicidad,
    mesAncla: r.mes_ancla,
    diaLimite: r.dia_limite == null ? null : Number(r.dia_limite),
    diasAviso: r.dias_aviso == null ? null : Number(r.dias_aviso),
    horaAviso: r.hora_aviso || null,
    montoEstimado: r.monto_estimado == null ? null : Number(r.monto_estimado),
    responsableUid: r.responsable_uid,
    responsableNombre: r.responsable_nombre,
    responsableTelefono: r.responsable_telefono,
    activo: r.activo !== false,
    creadoEn: r.creado_en == null ? null : Number(r.creado_en),
    creadoPor: r.creado_por,
    actualizadoEn: r.actualizado_en == null ? null : Number(r.actualizado_en),
    ...(r.datos || {}),
  };
}

/**
 * Valida lo que llega del formulario. Devuelve { error } o { valor }.
 * Se valida en el servidor porque estos campos deciden CUANDO se le escribe a
 * la gente por WhatsApp: un `dia_limite` de 45 o un telefono a medias no se
 * notan al guardar, se notan el dia que el aviso no sale (o sale a un
 * desconocido).
 */
function validar(b, existente) {
  const sucursal = String(b.sucursal ?? existente?.sucursal ?? '').trim();
  const departamento = String(b.departamento ?? existente?.departamento ?? '').trim();
  if (!sucursal && !departamento) {
    return { error: 'Dinos de qué sucursal o departamento es el servicio.' };
  }

  const tipo = String(b.tipo ?? existente?.tipo ?? '').trim().toLowerCase();
  if (!TIPOS.includes(tipo)) {
    return { error: `Tipo de servicio inválido. Usa uno de: ${TIPOS.join(', ')}.` };
  }

  const periodicidad = String(b.periodicidad ?? existente?.periodicidad ?? 'mensual').trim().toLowerCase();
  if (!PERIODICIDADES.includes(periodicidad)) {
    return { error: 'La periodicidad debe ser mensual o bimestral.' };
  }

  const diaLimite = Number(b.diaLimite ?? existente?.dia_limite);
  if (!Number.isInteger(diaLimite) || diaLimite < 1 || diaLimite > 31) {
    return { error: 'El día límite debe ser un número del 1 al 31.' };
  }

  // Dias de aviso previo: 0 significa "avisar solo el mismo dia". A partir de
  // ese dia se recuerda TODOS los dias hasta que llegue el comprobante.
  const diasAvisoRaw = b.diasAviso ?? existente?.dias_aviso ?? 3;
  const diasAviso = Number(diasAvisoRaw);
  if (!Number.isInteger(diasAviso) || diasAviso < 0 || diasAviso > 30) {
    return { error: 'Los días de aviso deben ir de 0 a 30.' };
  }

  // Hora del recordatorio (HH:mm en hora de Mexico). Vacio = la hora general.
  let horaAviso = String(b.horaAviso ?? existente?.hora_aviso ?? '').trim();
  if (horaAviso) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(horaAviso);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
      return { error: 'La hora del aviso debe ir en formato HH:mm (por ejemplo 09:00).' };
    }
    horaAviso = String(Number(m[1])).padStart(2, '0') + ':' + m[2];
  }

  // El ancla solo aplica (y solo se exige) en los bimestrales.
  let mesAncla = String(b.mesAncla ?? existente?.mes_ancla ?? '').trim();
  if (periodicidad === 'bimestral') {
    if (!/^\d{4}-\d{2}$/.test(mesAncla)) {
      return { error: 'En un servicio bimestral dinos un mes de referencia (AAAA-MM) en el que sí toca pagar.' };
    }
  } else {
    mesAncla = '';
  }

  const tel = telefono10(b.responsableTelefono ?? existente?.responsable_telefono);
  if (tel && tel.length !== 10) {
    return { error: 'El teléfono del responsable debe tener 10 dígitos.' };
  }

  const montoRaw = b.montoEstimado ?? existente?.monto_estimado;
  const montoEstimado = montoRaw == null || montoRaw === '' ? null : Number(montoRaw);
  if (montoEstimado != null && (!Number.isFinite(montoEstimado) || montoEstimado < 0)) {
    return { error: 'El monto estimado no es un número válido.' };
  }

  return {
    valor: {
      sucursal, departamento, tipo, periodicidad, mesAncla: mesAncla || null,
      diaLimite, diasAviso, horaAviso: horaAviso || null, montoEstimado,
      proveedor: String(b.proveedor ?? existente?.proveedor ?? '').trim(),
      referencia: String(b.referencia ?? existente?.referencia ?? '').trim(),
      responsableUid: String(b.responsableUid ?? existente?.responsable_uid ?? '').trim() || null,
      responsableNombre: String(b.responsableNombre ?? existente?.responsable_nombre ?? '').trim() || null,
      responsableTelefono: tel || null,
      activo: b.activo == null ? (existente ? existente.activo !== false : true) : b.activo !== false,
    },
  };
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

  if (!(await exigirAccesoPagos(usuario, res))) return;

  try {
    if (req.method === 'GET') {
      if (req.query?.id) {
        const r = await query('select * from mdtask_servicios where id = $1 and eliminado = false', [String(req.query.id)]);
        if (!r.rows[0]) return res.status(404).json({ error: 'No existe ese servicio.' });
        return res.json({ servicio: fila(r.rows[0]) });
      }
      const r = await query(
        `select * from mdtask_servicios where eliminado = false
          order by sucursal asc nulls last, departamento asc nulls last, tipo asc`);
      return res.json({ servicios: r.rows.map(fila) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const ahora = Date.now();
      const quien = usuario?.uid || usuario?.email || null;
      const id = String(b.id || ('svc_' + ahora + '_' + Math.random().toString(36).slice(2, 7)));

      // Al editar se parte de lo que ya existe: el formulario puede mandar solo
      // los campos que cambiaron y no queremos borrar el resto sin querer.
      let existente = null;
      if (b.id) {
        const r = await query('select * from mdtask_servicios where id = $1', [String(b.id)]);
        existente = r.rows[0] || null;
      }

      const v = validar(b, existente);
      if (v.error) return res.status(400).json({ error: v.error });
      const s = v.valor;

      // Todo lo que no es columna propia se guarda en `datos` (mismo criterio
      // que promociones): asi el formato puede crecer sin migrar la tabla.
      const extras = { ...(existente?.datos || {}) };
      if (b.notas !== undefined) extras.notas = String(b.notas || '').trim() || null;

      await query(
        `insert into mdtask_servicios
           (id, sucursal, departamento, tipo, proveedor, referencia, periodicidad, mes_ancla,
            dia_limite, dias_aviso, hora_aviso, monto_estimado, responsable_uid, responsable_nombre,
            responsable_telefono, activo, datos, creado_en, creado_por, actualizado_en, eliminado)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$20,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,false)
         on conflict (id) do update set
           sucursal = excluded.sucursal,
           departamento = excluded.departamento,
           tipo = excluded.tipo,
           proveedor = excluded.proveedor,
           referencia = excluded.referencia,
           periodicidad = excluded.periodicidad,
           mes_ancla = excluded.mes_ancla,
           dia_limite = excluded.dia_limite,
           dias_aviso = excluded.dias_aviso,
           hora_aviso = excluded.hora_aviso,
           monto_estimado = excluded.monto_estimado,
           responsable_uid = excluded.responsable_uid,
           responsable_nombre = excluded.responsable_nombre,
           responsable_telefono = excluded.responsable_telefono,
           activo = excluded.activo,
           datos = coalesce(mdtask_servicios.datos,'{}'::jsonb) || excluded.datos,
           actualizado_en = excluded.actualizado_en,
           eliminado = false`,
        [
          id, s.sucursal || null, s.departamento || null, s.tipo, s.proveedor || null,
          s.referencia || null, s.periodicidad, s.mesAncla, s.diaLimite, s.diasAviso,
          s.montoEstimado, s.responsableUid, s.responsableNombre, s.responsableTelefono,
          s.activo, JSON.stringify(extras),
          // $20 (hora_aviso) va al final del arreglo para no renumerar todos los
          // demas parametros; en el INSERT esta en su lugar por nombre de columna.
          existente ? Number(existente.creado_en || ahora) : ahora,
          existente ? existente.creado_por : quien,
          ahora,
          s.horaAviso,   // $20
        ]
      );

      const r = await query('select * from mdtask_servicios where id = $1', [id]);
      return res.json({ ok: true, servicio: fila(r.rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '');
      if (!id) return res.status(400).json({ error: 'Falta el id del servicio.' });
      const r = await query(
        `update mdtask_servicios set eliminado = true, actualizado_en = $2
          where id = $1 returning id`, [id, Date.now()]);
      if (!r.rows[0]) return res.status(404).json({ error: 'No existe ese servicio.' });
      // Los pagos YA REGISTRADOS se conservan (son el historial con sus
      // comprobantes); solo se dan de baja los que seguian pendientes, para que
      // el bot deje de recordar un servicio que ya no se paga.
      await query(
        `update mdtask_pagos_servicios set estado = 'cancelado', actualizado_en = $2
          where servicio_id = $1 and estado = 'pendiente'`, [id, Date.now()]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    console.error('[servicios]', e && e.message);
    return res.status(500).json({ error: 'Error del servidor: ' + (e && e.message) });
  }
};
