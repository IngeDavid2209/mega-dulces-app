// ============================================================================
//  API de TICKETS (Vale de Servicio Operativo).
//
//    GET    /api/tickets                  -> lista (filtros opcionales)
//    GET    /api/tickets?id=..            -> uno
//    GET    /api/tickets?siguienteFolio=1 -> { folio } el que toca usar
//    POST   /api/tickets                  -> crea o actualiza (merge en `datos`)
//    DELETE /api/tickets?id=..            -> marca eliminado (NO borra la fila)
//
//  Filtros del GET: estatus, area, mios=1 (los que levante o me toca atender),
//  desde, hasta (por fecha).
//
//  El folio se asigna al CREAR y no se vuelve a tocar: es el numero del vale, y
//  si cambiara al editar, dos papeles impresos distintos tendrian el mismo
//  numero. Arranca en TICKETS_FOLIO_INICIAL (513, como el bloque en papel).
//
//  El borrado es logico a proposito: el vale respalda un trabajo hecho y las
//  firmas de quien lo autorizo.
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');
const { exigirAccesoTickets } = require('./_tickets-acceso');

const ESTATUS = ['abierto', 'en_proceso', 'completado', 'cancelado'];

/** Primer folio si la tabla esta vacia (el bloque en papel iba en 000513). */
function folioInicial() {
  const n = parseInt(process.env.TICKETS_FOLIO_INICIAL || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 513;
}

/** El folio que toca: el mayor usado + 1, o el inicial si no hay ninguno. */
async function siguienteFolio() {
  const r = await query('select max(folio)::int as m from mdtask_tickets');
  const m = r.rows[0] && r.rows[0].m;
  return m == null ? folioInicial() : m + 1;
}

function fila(r) {
  return {
    id: r.id,
    folio: r.folio,
    estatus: r.estatus,
    fecha: r.fecha,
    area: r.area,
    lugar: r.lugar,
    solicitante: r.solicitante,
    solicitanteUid: r.solicitante_uid,
    responsable: r.responsable,
    responsableUid: r.responsable_uid,
    supervisor: r.supervisor,
    supervisorUid: r.supervisor_uid,
    actividad: r.actividad,
    requiereSeguimiento: r.requiere_seguimiento,
    tomadoEn: r.tomado_en == null ? null : Number(r.tomado_en),
    completadoEn: r.completado_en == null ? null : Number(r.completado_en),
    creadoEn: r.creado_en == null ? null : Number(r.creado_en),
    creadoPor: r.creado_por,
    actualizadoEn: r.actualizado_en == null ? null : Number(r.actualizado_en),
    // Del jsonb salen los campos largos del formato y las tres firmas:
    // detalle, materiales, resultado, observacionesSeguimiento,
    // observacionesGenerales, firmaRealizado/Revisado/Recibido, motivoCancelacion.
    ...(r.datos || {}),
  };
}

/** Texto limpio (o null) para no guardar cadenas vacias ni undefined. */
function texto(v) {
  const s = String(v == null ? '' : v).trim();
  return s || null;
}

/**
 * Valida lo que llega. Se valida en el servidor porque un vale con folio y
 * firmas es un documento: si se guarda a medias, se imprime a medias.
 */
function validar(b, existente) {
  const esNuevo = !existente;

  const area = texto(b.area !== undefined ? b.area : (existente && existente.area));
  const actividad = texto(b.actividad !== undefined ? b.actividad : (existente && existente.actividad));
  const solicitante = texto(b.solicitante !== undefined ? b.solicitante : (existente && existente.solicitante));

  if (esNuevo) {
    if (!area) return { error: 'Dinos de qué área o departamento es la solicitud.' };
    if (!actividad) return { error: 'Escribe qué servicio se necesita (actividad).' };
    if (!solicitante) return { error: 'Falta el nombre del solicitante.' };
  }

  const estatus = String(b.estatus !== undefined ? b.estatus : ((existente && existente.estatus) || 'abierto'));
  if (!ESTATUS.includes(estatus)) {
    return { error: 'Estatus inválido. Usa: ' + ESTATUS.join(', ') + '.' };
  }

  const fecha = texto(b.fecha !== undefined ? b.fecha : (existente && existente.fecha));
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { error: 'La fecha debe ir en formato AAAA-MM-DD.' };
  }

  return {
    valor: {
      estatus, fecha, area, actividad, solicitante,
      lugar: texto(b.lugar !== undefined ? b.lugar : (existente && existente.lugar)),
      solicitanteUid: texto(b.solicitanteUid !== undefined ? b.solicitanteUid : (existente && existente.solicitante_uid)),
      responsable: texto(b.responsable !== undefined ? b.responsable : (existente && existente.responsable)),
      responsableUid: texto(b.responsableUid !== undefined ? b.responsableUid : (existente && existente.responsable_uid)),
      supervisor: texto(b.supervisor !== undefined ? b.supervisor : (existente && existente.supervisor)),
      supervisorUid: texto(b.supervisorUid !== undefined ? b.supervisorUid : (existente && existente.supervisor_uid)),
      requiereSeguimiento: b.requiereSeguimiento == null
        ? (existente ? existente.requiere_seguimiento : null)
        : b.requiereSeguimiento === true,
    },
  };
}

// Campos largos y firmas que viven en `datos`. Se listan para no guardar
// cualquier cosa que llegue en el body.
const CAMPOS_DATOS = [
  'detalle', 'materiales', 'resultado', 'observacionesSeguimiento',
  'observacionesGenerales', 'motivoCancelacion',
  'firmaRealizado', 'firmaRevisado', 'firmaRecibido',
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  let usuario = null;
  try { usuario = await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  if (!(await exigirAccesoTickets(usuario, res))) return;

  try {
    if (req.method === 'GET') {
      if (req.query && req.query.siguienteFolio) {
        return res.json({ folio: await siguienteFolio() });
      }
      if (req.query && req.query.id) {
        const r = await query('select * from mdtask_tickets where id = $1 and eliminado = false', [String(req.query.id)]);
        if (!r.rows[0]) return res.status(404).json({ error: 'No existe ese ticket.' });
        return res.json({ ticket: fila(r.rows[0]) });
      }

      const q = req.query || {};
      const cond = [];
      const args = [];
      if (q.estatus) {
        const lista = String(q.estatus).split(',').map(s => s.trim()).filter(Boolean);
        args.push(lista); cond.push('estatus = any($' + args.length + ')');
      }
      if (q.area) { args.push(String(q.area)); cond.push('area = $' + args.length); }
      if (q.desde) { args.push(String(q.desde)); cond.push('fecha >= $' + args.length); }
      if (q.hasta) { args.push(String(q.hasta)); cond.push('fecha <= $' + args.length); }
      if (q.mios) {
        args.push(String(usuario.uid));
        cond.push('(solicitante_uid = $' + args.length + ' or responsable_uid = $' + args.length + ')');
      }

      const r = await query(
        'select * from mdtask_tickets where eliminado = false '
        + (cond.length ? 'and ' + cond.join(' and ') + ' ' : '')
        + 'order by coalesce(folio, 0) desc limit 1000', args);
      return res.json({ tickets: r.rows.map(fila) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const ahora = Date.now();
      const quien = usuario.uid || null;

      let existente = null;
      if (b.id) {
        const r = await query('select * from mdtask_tickets where id = $1', [String(b.id)]);
        existente = r.rows[0] || null;
        if (!existente) return res.status(404).json({ error: 'No existe ese ticket.' });
      }

      const v = validar(b, existente);
      if (v.error) return res.status(400).json({ error: v.error });
      const t = v.valor;

      const datosPrevios = (existente && existente.datos) || {};

      // Para cerrar un vale hace falta documentar el servicio: si no, quedarian
      // vales "completados" en blanco, que es justo lo que el formato evita.
      const detalle = b.detalle !== undefined ? texto(b.detalle) : datosPrevios.detalle;
      if (t.estatus === 'completado' && !detalle) {
        return res.status(400).json({ error: 'Para cerrar el vale hay que escribir el detalle de las actividades realizadas.' });
      }
      if (t.estatus === 'cancelado') {
        const motivo = b.motivoCancelacion !== undefined
          ? texto(b.motivoCancelacion) : datosPrevios.motivoCancelacion;
        if (!motivo) return res.status(400).json({ error: 'Dinos por qué se cancela el ticket.' });
      }

      // `datos`: se parte de lo que ya habia y solo se pisa lo que llego.
      const extras = {};
      for (const c of CAMPOS_DATOS) {
        if (b[c] === undefined) continue;
        if (c.indexOf('firma') === 0) extras[c] = b[c] || null;   // {nombre, url, fecha}
        else extras[c] = texto(b[c]);
      }

      // Sellos del ciclo: se ponen la primera vez que se entra al estado y no se
      // mueven despues, para que la fecha real del trabajo no cambie al editar.
      const tomadoEn = t.estatus === 'abierto' ? null
        : Number((existente && existente.tomado_en) || ahora);
      const completadoEn = t.estatus === 'completado'
        ? Number((existente && existente.completado_en) || ahora) : null;

      const id = String(b.id || ('tkt_' + ahora + '_' + Math.random().toString(36).slice(2, 7)));
      // El folio se asigna SOLO al crear (ver cabecera).
      const folio = existente ? existente.folio : await siguienteFolio();

      await query(
        `insert into mdtask_tickets
           (id, folio, estatus, fecha, area, lugar, solicitante, solicitante_uid,
            responsable, responsable_uid, supervisor, supervisor_uid, actividad,
            requiere_seguimiento, tomado_en, completado_en, datos,
            creado_en, creado_por, actualizado_en, eliminado)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,false)
         on conflict (id) do update set
           estatus = excluded.estatus,
           fecha = excluded.fecha,
           area = excluded.area,
           lugar = excluded.lugar,
           solicitante = excluded.solicitante,
           solicitante_uid = excluded.solicitante_uid,
           responsable = excluded.responsable,
           responsable_uid = excluded.responsable_uid,
           supervisor = excluded.supervisor,
           supervisor_uid = excluded.supervisor_uid,
           actividad = excluded.actividad,
           requiere_seguimiento = excluded.requiere_seguimiento,
           tomado_en = excluded.tomado_en,
           completado_en = excluded.completado_en,
           datos = coalesce(mdtask_tickets.datos,'{}'::jsonb) || excluded.datos,
           actualizado_en = excluded.actualizado_en,
           eliminado = false`,
        [
          id, folio, t.estatus, t.fecha, t.area, t.lugar, t.solicitante,
          t.solicitanteUid || (existente ? existente.solicitante_uid : quien),
          t.responsable, t.responsableUid, t.supervisor, t.supervisorUid,
          t.actividad, t.requiereSeguimiento, tomadoEn, completadoEn,
          JSON.stringify(extras),
          existente ? Number(existente.creado_en || ahora) : ahora,
          existente ? existente.creado_por : quien,
          ahora,
        ]
      );

      const r = await query('select * from mdtask_tickets where id = $1', [id]);
      const guardado = fila(r.rows[0]);

      // AVISOS por WhatsApp. Se disparan solo cuando la situacion CAMBIA, para no
      // repetir el mensaje cada vez que se guarda el vale:
      //   - se le acaba de asignar un responsable distinto al que tenia;
      //   - el vale acaba de pasar a completado.
      // Van sin await a proposito: el ticket ya esta guardado y un problema de
      // WhatsApp no debe retrasar ni tumbar la respuesta.
      try {
        const antes = existente || {};
        const cambioResponsable = guardado.responsableUid
          && guardado.responsableUid !== (antes.responsable_uid || null);
        const seAcabaDeCerrar = guardado.estatus === 'completado'
          && antes.estatus !== 'completado';
        const avisos = require('./tickets-notificar');
        if (cambioResponsable) {
          avisos.avisarAsignacion(guardado).catch(e => console.error('[tickets] aviso asignacion:', e && e.message));
        }
        if (seAcabaDeCerrar) {
          avisos.avisarCierre(guardado).catch(e => console.error('[tickets] aviso cierre:', e && e.message));
        }
      } catch (e) {
        console.error('[tickets] no se pudieron disparar los avisos:', e && e.message);
      }

      return res.json({ ok: true, ticket: guardado });
    }

    if (req.method === 'DELETE') {
      const id = String((req.query && req.query.id) || '');
      if (!id) return res.status(400).json({ error: 'Falta el id del ticket.' });
      const r = await query(
        `update mdtask_tickets set eliminado = true, actualizado_en = $2
          where id = $1 returning id`, [id, Date.now()]);
      if (!r.rows[0]) return res.status(404).json({ error: 'No existe ese ticket.' });
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    console.error('[tickets]', e && e.message);
    return res.status(500).json({ error: 'Error del servidor: ' + (e && e.message) });
  }
};
