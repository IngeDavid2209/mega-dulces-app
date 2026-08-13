// ============================================================================
//  PAGOS DE SERVICIOS — motor de recordatorios y captura por WhatsApp.
//
//  Hace tres cosas:
//
//   1) GENERAR. A partir del catalogo (mdtask_servicios) crea la fila de pago de
//      cada periodo que toca. Es idempotente (indice unico servicio+periodo), asi
//      que puede correr cada rato sin duplicar nada.
//
//   2) RECORDAR. Le escribe por WhatsApp al responsable de cada servicio: unos
//      dias antes, el dia del vencimiento, y todos los dias mientras no llegue el
//      comprobante (con tope, para no volverse spam). A los supervisores les
//      manda un resumen de lo atrasado.
//
//   3) RECIBIR. Cuando el responsable manda la foto o el PDF del comprobante por
//      el mismo chat, lo guarda en el pago que corresponde y le pregunta cuanto
//      pago y con que. Todo esto es DETERMINISTA (no pasa por Claude), igual que
//      la aprobacion de vehiculos: en un flujo de dinero se prefiere un camino
//      predecible a uno que interpreta.
//
//  Config por variables de entorno (con valores por defecto):
//    WA_TEMPLATE_PAGO       plantilla aprobada en Meta (default 'recordatorio_pago')
//    WA_TEMPLATE_LANG       idioma de la plantilla (default 'es_MX')
//    PAGOS_HORA             hora de Mexico a la que salen los avisos (default '09:00')
//    PAGOS_TOPE_INSISTENCIA dias que insiste tras el vencimiento (default 15)
//    PAGOS_SUPERVISORES     telefonos que reciben el resumen de atrasados (coma)
//    PAGOS_AVISOS           'off' apaga los avisos de este modulo
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { enviarMensaje, ultimos10 } = require('./whatsapp');
const { mandar } = require('./tareas-notificar');
const {
  hoyMexico, periodosAGenerar, diasFaltantes, fechaLegible, fechaDeEpoch,
} = require('./_pagos-periodos');

// --- Configuracion -----------------------------------------------------------
const T_PAGO = process.env.WA_TEMPLATE_PAGO || 'recordatorio_pago';
const HORA_AVISO = String(process.env.PAGOS_HORA || '09:00');
const TOPE_INSISTENCIA = Number(process.env.PAGOS_TOPE_INSISTENCIA || 15);
const SUPERVISORES = String(process.env.PAGOS_SUPERVISORES || '')
  .split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);
const APAGADO = String(process.env.PAGOS_AVISOS || '').toLowerCase() === 'off';

// Un hilo de captura abandonado no puede quedarse abierto para siempre: si la
// persona mando una foto y nunca dijo el monto, a las 3 horas el bot vuelve a
// tratar sus mensajes como conversacion normal.
const ESPERA_VIGENCIA_MS = 3 * 3600 * 1000;

// Reintentos del recordatorio dentro del mismo dia cuando el envio falla (ver
// recordatoriosDelDia). Con el poll de 10 min, 12 intentos cubren unas 2 horas
// de oportunidad para que la persona abra su ventana de 24 h escribiendole al bot.
const MAX_INTENTOS_DIA = 12;

const NOMBRE_TIPO = {
  luz: 'Luz', agua: 'Agua', internet: 'Internet', gas: 'Gas',
  telefono: 'Teléfono', renta: 'Renta', otro: 'Servicio',
};

/** Nombre corto y legible de un servicio: "Luz de Morelia Madero". */
function nombreServicio(s) {
  const tipo = NOMBRE_TIPO[String(s.tipo || '').toLowerCase()] || 'Servicio';
  const donde = s.sucursal || s.departamento || '';
  return donde ? `${tipo} de ${donde}` : tipo;
}

/** Hora actual HH:mm en Mexico. */
function horaMexico() {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

/** 'HH:mm' -> minutos desde medianoche (null si no es hora valida). */
function aMinutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Numero listo para la Cloud API: MX de 10 digitos -> 52 + 10. */
function paraEnviar(num) {
  const n = String(num || '').replace(/\D/g, '');
  return n.length === 10 ? '52' + n : n;
}

/** Importe con formato de pesos, para los mensajes y el tablero. */
function pesos(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return '$' + v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
//  1) GENERACION de los pagos de cada periodo
// ---------------------------------------------------------------------------

/**
 * Crea las filas de pago que falten segun el catalogo. Idempotente: el indice
 * unico (servicio_id, periodo) hace que el insert repetido no haga nada.
 * Devuelve cuantas filas nuevas se crearon.
 */
async function generarPagosPendientes() {
  if (!dbConfigurada()) return 0;
  const hoy = hoyMexico();
  let servicios;
  try {
    const r = await query(
      `select * from mdtask_servicios where eliminado = false and activo = true`);
    servicios = r.rows;
  } catch (e) {
    console.error('[pagos] no se pudo leer el catálogo:', e && e.message);
    return 0;
  }

  let creados = 0;
  for (const s of servicios) {
    const servicio = {
      periodicidad: s.periodicidad, mesAncla: s.mes_ancla,
      diaLimite: s.dia_limite, diasAviso: s.dias_aviso,
    };
    // No se generan recibos que vencieron ANTES de dar de alta el servicio.
    // Si no, al registrar un servicio nuevo apareceria de golpe el recibo del
    // mes pasado marcado como atrasado (uno que casi seguro ya se pago, antes de
    // que este modulo existiera) y el bot se lo empezaria a reclamar a la gente.
    const desde = fechaDeEpoch(s.creado_en);

    for (const p of periodosAGenerar(servicio, hoy)) {
      if (!p.fechaLimite) continue;
      if (desde && p.fechaLimite < desde) continue;
      const id = `pago_${s.id}_${p.periodo}`;
      try {
        const r = await query(
          `insert into mdtask_pagos_servicios
             (id, servicio_id, sucursal, tipo, periodo, periodo_texto, fecha_limite,
              estado, creado_en, actualizado_en)
           values ($1,$2,$3,$4,$5,$6,$7,'pendiente',$8,$8)
           on conflict (servicio_id, periodo) do nothing
           returning id`,
          [id, s.id, s.sucursal || s.departamento || null, s.tipo, p.periodo,
            p.periodoTexto, p.fechaLimite, Date.now()]
        );
        if (r.rows[0]) creados++;
      } catch (e) {
        console.error(`[pagos] no se pudo generar ${s.id}/${p.periodo}:`, e && e.message);
      }
    }
  }
  if (creados) console.log(`[pagos] ${creados} pago(s) generado(s) del catálogo.`);
  return creados;
}

// ---------------------------------------------------------------------------
//  2) RECORDATORIOS
// ---------------------------------------------------------------------------

// Pagos abiertos (sin pagar) con los datos de su servicio.
const SELECT_ABIERTOS = `
  select p.*, s.proveedor, s.referencia, s.departamento, s.periodicidad, s.dias_aviso,
         s.hora_aviso, s.responsable_nombre, s.responsable_telefono, s.monto_estimado, s.activo
    from mdtask_pagos_servicios p
    join mdtask_servicios s on s.id = p.servicio_id
   where p.eliminado = false and s.eliminado = false
     and p.estado = 'pendiente'`;

function pagoConServicio(r) {
  return {
    id: r.id, servicioId: r.servicio_id, sucursal: r.sucursal, tipo: r.tipo,
    periodo: r.periodo, periodoTexto: r.periodo_texto, fechaLimite: r.fecha_limite,
    estado: r.estado, avisos: r.avisos || {},
    departamento: r.departamento, proveedor: r.proveedor, referencia: r.referencia,
    diasAviso: r.dias_aviso == null ? 3 : Number(r.dias_aviso),
    horaAviso: r.hora_aviso || null,
    responsableNombre: r.responsable_nombre, responsableTelefono: r.responsable_telefono,
    montoEstimado: r.monto_estimado == null ? null : Number(r.monto_estimado),
    activo: r.activo !== false,
  };
}

/** Merge parcial del jsonb `avisos` de un pago (sin pisar lo demas). */
async function marcarAviso(pagoId, obj) {
  await query(
    `update mdtask_pagos_servicios
        set avisos = coalesce(avisos,'{}'::jsonb) || $2::jsonb, actualizado_en = $3
      where id = $1`,
    [String(pagoId), JSON.stringify(obj), Date.now()]
  );
}

/** El texto del recordatorio segun que tan cerca (o lejos) esta el vencimiento. */
function textoRecordatorio(pago, dias) {
  const nombre = nombreServicio(pago);
  const quien = (pago.responsableNombre || '').split(' ')[0];
  const saludo = quien ? `Hola ${quien} 👋` : 'Hola 👋';
  const monto = pago.montoEstimado ? ` (suele venir en ${pesos(pago.montoEstimado)})` : '';
  const ref = pago.referencia ? `\nReferencia: ${pago.referencia}` : '';
  const cierre = '\n\nCuando lo pagues, mándame aquí la *foto o el PDF del comprobante* 📄';

  if (dias > 0) {
    return `${saludo}\n\nTe recuerdo el pago de *${nombre}* del periodo ${pago.periodoTexto}${monto}.`
      + `\nVence el *${fechaLegible(pago.fechaLimite)}* (en ${dias} día${dias === 1 ? '' : 's'}).${ref}${cierre}`;
  }
  if (dias === 0) {
    return `${saludo}\n\n⏰ *Hoy vence* el pago de *${nombre}* (${pago.periodoTexto})${monto}.${ref}${cierre}`;
  }
  const atraso = Math.abs(dias);
  return `${saludo}\n\n🔴 El pago de *${nombre}* (${pago.periodoTexto}) está *atrasado ${atraso} día${atraso === 1 ? '' : 's'}*.`
    + `\nVencía el ${fechaLegible(pago.fechaLimite)}.${ref}${cierre}`;
}

/**
 * Manda los recordatorios que tocan hoy.
 *
 * Se avisa TODOS LOS DIAS de la cuenta regresiva, uno por dia: si el pago vence
 * el 30 y el servicio dice "3 dias antes", se recuerda el 27, el 28, el 29 y el
 * 30. Si aun asi no llega el comprobante, se sigue insistiendo a diario hasta el
 * tope (PAGOS_TOPE_INSISTENCIA).
 *
 * Regla: MAXIMO un recordatorio por pago y por dia (se guarda la fecha del
 * ultimo en `avisos.ultimoDia`). Se manda cuando:
 *   - faltan `dias_aviso` dias o menos, o
 *   - ya vencio y no se ha pasado del tope de insistencia.
 *
 * La HORA la decide cada servicio (`hora_aviso`); si no tiene, se usa la general
 * (PAGOS_HORA). Nunca antes de esa hora, para no escribirle a nadie de
 * madrugada. Si el servidor se reinicia mas tarde, el poll lo manda en cuanto
 * levanta y la bitacora evita repetirlo.
 */
async function recordatoriosDelDia() {
  if (!dbConfigurada() || APAGADO) return;

  const hoy = hoyMexico();
  const ahoraMin = aMinutos(horaMexico());
  if (ahoraMin == null) return;

  let filas;
  try {
    const r = await query(SELECT_ABIERTOS);
    filas = r.rows.map(pagoConServicio);
  } catch (e) {
    console.error('[pagos] no se pudieron leer los pendientes:', e && e.message);
    return;
  }

  for (const pago of filas) {
    if (!pago.activo) continue;
    const dias = diasFaltantes(pago.fechaLimite, hoy);
    if (dias == null) continue;

    // Todavia no entra en la ventana de aviso.
    if (dias > pago.diasAviso) continue;
    // Todavia no es la hora que pidieron para este servicio.
    const horaDelServicio = aMinutos(pago.horaAviso || HORA_AVISO);
    if (horaDelServicio != null && ahoraMin < horaDelServicio) continue;
    // Vencido hace demasiado: se deja de insistir (sigue en rojo en el tablero).
    if (dias < 0 && Math.abs(dias) > TOPE_INSISTENCIA) continue;
    // Ya se le aviso hoy.
    if (String(pago.avisos.ultimoDia || '') === hoy) continue;

    const tel = pago.responsableTelefono;
    if (!tel) {
      // Sin telefono no hay a quien escribirle. Se anota una sola vez al dia
      // para que quede en el log sin llenarlo cada vuelta del poll.
      await marcarAviso(pago.id, { ultimoDia: hoy, ultimoMotivo: 'sin_telefono' }).catch(() => {});
      console.warn(`[pagos] ${nombreServicio(pago)} (${pago.periodoTexto}) no tiene responsable con teléfono.`);
      continue;
    }

    const texto = textoRecordatorio(pago, dias);
    const vars = [
      pago.responsableNombre || 'Hola',
      nombreServicio(pago),
      pago.periodoTexto || pago.periodo || '',
      fechaLegible(pago.fechaLimite),
    ];
    const res = await mandar(paraEnviar(tel), T_PAGO, vars, texto);
    const ahora = Date.now();

    if (res.ok) {
      await marcarAviso(pago.id, {
        ultimoDia: hoy, ultimoEn: ahora, ultimoMotivo: res.motivo,
        enviados: Number(pago.avisos.enviados || 0) + 1,
      }).catch(() => {});
    } else {
      // NO se da por avisado: se reintenta en los siguientes ticks del dia.
      //
      // Esto importa mientras no haya plantilla aprobada en Meta: en frio el
      // mensaje no sale, pero en cuanto esa persona le escribe al bot por
      // cualquier motivo se abre su ventana de 24 h y el texto si se entrega.
      // Si diéramos el aviso por hecho al primer intento fallido, ese momento
      // se perderia y el recordatorio no llegaria nunca.
      //
      // Con tope, para no pegarle a la API de Meta todo el dia por algo que no
      // va a cambiar: tras MAX_INTENTOS_DIA se deja para mañana.
      const previos = pago.avisos.intentosDia && pago.avisos.intentosDia.dia === hoy
        ? Number(pago.avisos.intentosDia.n || 0) : 0;
      const intentos = previos + 1;
      const seRinde = intentos >= MAX_INTENTOS_DIA;
      await marcarAviso(pago.id, {
        ...(seRinde ? { ultimoDia: hoy } : {}),
        ultimoEn: ahora, ultimoMotivo: 'fallo:' + res.motivo,
        intentosDia: { dia: hoy, n: intentos },
      }).catch(() => {});
      console.log(`[pagos] recordatorio ${pago.id} -> ${tel} NO SALIO (${res.motivo}), intento ${intentos}/${MAX_INTENTOS_DIA}${seRinde ? ' — se deja para mañana' : ''}`);
      continue;
    }

    console.log(`[pagos] recordatorio ${pago.id} -> ${tel} (${dias} día(s)): ${res.motivo}`);
  }
}

/**
 * Resumen diario de lo ATRASADO para los supervisores (PAGOS_SUPERVISORES).
 * Va aparte de los recordatorios: al responsable se le pide su pago, al
 * supervisor se le da la foto completa de lo que nadie ha pagado.
 */
async function resumenSupervisores() {
  if (!dbConfigurada() || APAGADO || !SUPERVISORES.length) return;

  const hoy = hoyMexico();
  const ahoraMin = aMinutos(horaMexico());
  const desdeMin = aMinutos(HORA_AVISO);
  if (ahoraMin == null || desdeMin == null || ahoraMin < desdeMin) return;

  // Bitacora compartida con el resto de avisos de WhatsApp (SQL 025).
  const clave = `pagos-resumen:${hoy}`;
  try {
    const ya = await query('select 1 from mdtask_wa_avisos where clave = $1', [clave]);
    if (ya.rowCount > 0) return;
    await query('insert into mdtask_wa_avisos (clave, enviado_en) values ($1,$2) on conflict do nothing', [clave, Date.now()]);
  } catch (e) {
    console.error('[pagos] bitácora del resumen:', e && e.message);
    return;
  }

  let filas;
  try {
    const r = await query(SELECT_ABIERTOS);
    filas = r.rows.map(pagoConServicio);
  } catch (e) { return; }

  const activos = filas.filter(p => p.activo);
  const vencidos = activos
    .map(p => ({ p, dias: diasFaltantes(p.fechaLimite, hoy) }))
    .filter(x => x.dias != null && x.dias < 0)
    .sort((a, b) => a.dias - b.dias);

  // Pagos a los que HOY no se les pudo hacer llegar el recordatorio (sin
  // plantilla y sin ventana abierta, o sin telefono). Se reportan aparte: si no,
  // el silencio se confunde con "ya les avise y no han pagado", que es muy
  // distinto de "no tengo forma de avisarles".
  const noAvisados = activos.filter(p =>
    String(p.avisos.ultimoMotivo || '').startsWith('fallo:') || p.avisos.ultimoMotivo === 'sin_telefono');

  if (!vencidos.length && !noAvisados.length) return;

  const partes = [];
  if (vencidos.length) {
    const lista = vencidos.slice(0, 15)
      .map(x => `• ${nombreServicio(x.p)} — ${x.p.periodoTexto} (${Math.abs(x.dias)} día${Math.abs(x.dias) === 1 ? '' : 's'} de atraso)`)
      .join('\n');
    const extra = vencidos.length > 15 ? `\n...y ${vencidos.length - 15} más.` : '';
    partes.push(`📋 *Pagos de servicios atrasados* (${vencidos.length})\n\n${lista}${extra}`);
  }
  if (noAvisados.length) {
    const lista = noAvisados.slice(0, 10)
      .map(p => `• ${nombreServicio(p)} — ${p.responsableNombre || 'sin responsable'}`)
      .join('\n');
    const extra = noAvisados.length > 10 ? `\n...y ${noAvisados.length - 10} más.` : '';
    partes.push(`⚠️ *No les pudo llegar el recordatorio* (${noAvisados.length})\n\n${lista}${extra}\n\n`
      + 'Suele ser porque no tienen conversación abierta con el bot y la cuenta de WhatsApp no puede escribir en frío.');
  }
  const texto = partes.join('\n\n');

  for (const tel of SUPERVISORES) {
    await mandar(paraEnviar(tel), T_PAGO, ['Resumen', 'Pagos atrasados', hoy, String(vencidos.length)], texto);
  }
  console.log(`[pagos] resumen de ${vencidos.length} atrasado(s) enviado a ${SUPERVISORES.length} supervisor(es).`);
}

// ---------------------------------------------------------------------------
//  3) CAPTURA POR WHATSAPP
// ---------------------------------------------------------------------------

/** Estado del hilo de captura de una persona (null si no hay o ya caduco). */
async function esperaGet(telefono) {
  try {
    const r = await query('select * from mdtask_pagos_espera where telefono = $1', [ultimos10(telefono)]);
    const e = r.rows[0];
    if (!e) return null;
    if (Date.now() - Number(e.actualizado_en || 0) > ESPERA_VIGENCIA_MS) {
      await esperaSet(telefono, null).catch(() => {});
      return null;
    }
    return { pagoId: e.pago_id, paso: e.paso, datos: e.datos || {} };
  } catch (e) { return null; }
}

async function esperaSet(telefono, estado) {
  const tel = ultimos10(telefono);
  if (!estado) {
    await query('delete from mdtask_pagos_espera where telefono = $1', [tel]);
    return;
  }
  await query(
    `insert into mdtask_pagos_espera (telefono, pago_id, paso, datos, actualizado_en)
     values ($1,$2,$3,$4::jsonb,$5)
     on conflict (telefono) do update set
       pago_id = excluded.pago_id, paso = excluded.paso,
       datos = excluded.datos, actualizado_en = excluded.actualizado_en`,
    [tel, estado.pagoId || null, estado.paso || null, JSON.stringify(estado.datos || {}), Date.now()]
  );
}

/**
 * Pagos que este telefono puede reportar: los pendientes de los servicios en
 * los que es responsable, cuya ventana de aviso ya empezo (o que ya vencieron).
 * Los mas urgentes primero.
 *
 * Se compara por los ultimos 10 digitos y no por el texto tal cual: en la base
 * hay telefonos guardados con lada, con +52, con espacios y con guiones.
 */
async function pagosAbiertosDe(telefono) {
  const tel = ultimos10(telefono);
  if (!tel || tel.length < 10) return [];
  let filas;
  try {
    const r = await query(
      `${SELECT_ABIERTOS}
        and s.activo = true
        and right(regexp_replace(coalesce(s.responsable_telefono,''), '[^0-9]', '', 'g'), 10) = $1`,
      [tel]
    );
    filas = r.rows.map(pagoConServicio);
  } catch (e) {
    console.error('[pagos] no se pudieron leer los pagos del responsable:', e && e.message);
    return [];
  }
  const hoy = hoyMexico();
  return filas
    .map(p => ({ ...p, dias: diasFaltantes(p.fechaLimite, hoy) }))
    // Se aceptan los que ya entraron en ventana de aviso. Si alguien paga muy
    // por adelantado, igual se le deja reportar: mas vale recibir el
    // comprobante antes de tiempo que rechazarlo.
    .filter(p => p.dias == null || p.dias <= Math.max(p.diasAviso, 7))
    .sort((a, b) => (a.dias ?? 999) - (b.dias ?? 999));
}

/**
 * ¿Esta persona tiene algo de pagos a lo que pueda corresponder un archivo?
 *
 * Sirve para decidir ANTES de subir a Cloudinary si el archivo es comprobante o
 * evidencia de tarea. Sin esto habria que subirlo dos veces (una a cada carpeta)
 * y quedaria basura suelta en Cloudinary cada vez que la adivinanza falla.
 */
async function hayPagoEsperando(telefono) {
  if (!dbConfigurada()) return false;
  const tel = ultimos10(telefono);
  const espera = await esperaGet(tel);
  if (espera && (espera.paso === 'comprobante' || espera.paso === 'elegir')) return true;
  const abiertos = await pagosAbiertosDe(tel);
  return abiertos.length > 0;
}

/**
 * Guarda el comprobante y da el pago por PAGADO en ese mismo momento.
 *
 * El monto y la forma de pago se preguntan despues, pero el pago NO se queda
 * pendiente esperando esa respuesta: si se quedara, al dia siguiente el bot le
 * volveria a reclamar a alguien que ya mando su comprobante, y en el tablero
 * apareceria en rojo un recibo que si se pago. El comprobante es la prueba;
 * el monto es un dato que se completa despues (aqui o desde MD Task).
 */
async function guardarComprobante(pagoId, url, tipo, quien) {
  await query(
    `update mdtask_pagos_servicios
        set comprobante_url = $2, comprobante_tipo = $3, canal = 'whatsapp',
            estado = 'pagado', pagado_en = coalesce(pagado_en, $5),
            registrado_por = $4, actualizado_en = $5
      where id = $1`,
    [String(pagoId), String(url), String(tipo || 'imagen'), quien || null, Date.now()]
  );
}

/** Cierra el pago: monto, forma de pago y estado 'pagado'. */
async function cerrarPago(pagoId, { monto, formaPago, quien }) {
  await query(
    `update mdtask_pagos_servicios
        set estado = 'pagado', monto = $2, forma_pago = $3,
            pagado_en = coalesce(pagado_en, $4),
            registrado_por = coalesce(registrado_por, $5),
            canal = coalesce(canal, 'whatsapp'), actualizado_en = $4
      where id = $1`,
    [String(pagoId), monto == null ? null : Number(monto), formaPago || null, Date.now(), quien || null]
  );
}

/** Lee un pago con los datos de su servicio (para armar los mensajes). */
async function leerPago(pagoId) {
  try {
    const r = await query(
      `select p.*, s.proveedor, s.referencia, s.departamento, s.periodicidad, s.dias_aviso,
              s.responsable_nombre, s.responsable_telefono, s.monto_estimado, s.activo
         from mdtask_pagos_servicios p
         join mdtask_servicios s on s.id = p.servicio_id
        where p.id = $1 and p.eliminado = false`, [String(pagoId)]);
    return r.rows[0] ? pagoConServicio(r.rows[0]) : null;
  } catch (e) { return null; }
}

/** Lista numerada de pagos, para pedirle a la persona que elija uno. */
function listaNumerada(pagos) {
  return pagos.slice(0, 5)
    .map((p, i) => `${i + 1}. ${nombreServicio(p)} — ${p.periodoTexto}`)
    .join('\n');
}

/**
 * Interpreta "cuanto pagaste y con que".
 * Acepta cosas como "1250 efectivo", "$1,250.50 con tarjeta", "pague 980 en
 * transferencia", "tarjeta" (sin monto) o "no se".
 * Devuelve { monto, formaPago, sinDato }.
 */
function leerMontoYForma(texto) {
  const t = String(texto || '').toLowerCase();

  let formaPago = null;
  if (/\btarjeta|tdc|tdd|credito|débito|debito\b/.test(t)) formaPago = 'tarjeta';
  else if (/\btransferencia|transfer|spei|deposito|depósito\b/.test(t)) formaPago = 'transferencia';
  else if (/\befectivo|cash|contado\b/.test(t)) formaPago = 'efectivo';

  // El monto: el primer numero con pinta de importe. Se quitan las comas de
  // millares antes de convertir ("1,250.50" -> 1250.50).
  let monto = null;
  const m = /(\d[\d,]*(?:\.\d{1,2})?)/.exec(t.replace(/\s/g, ''));
  if (m) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) monto = n;
  }

  const sinDato = /\bno s[eé]\b|\bno recuerdo\b|\bdespu[eé]s\b|\bluego\b/.test(t);
  return { monto, formaPago, sinDato };
}

/** Mensaje de confirmacion final de un pago cerrado. */
function textoConfirmacion(pago, monto, formaPago) {
  const partes = [`✅ Listo, registré el pago de *${nombreServicio(pago)}* (${pago.periodoTexto}).`];
  if (monto != null) partes.push(`Monto: ${pesos(monto)}`);
  if (formaPago) partes.push(`Forma de pago: ${formaPago}`);
  partes.push('El comprobante ya quedó guardado. ¡Gracias! 🙌');
  return partes.join('\n');
}

/**
 * COMPROBANTE ENTRANTE (foto o PDF) que llego por WhatsApp.
 *
 * Lo llama el webhook DESPUES de subir el archivo a Cloudinary. Devuelve el
 * texto a responder, o null si esta persona no tiene ningun pago abierto (y
 * entonces el archivo sigue su camino normal: evidencia de tarea).
 *
 * Ojo con el orden: nunca se descarta el archivo. Si no se sabe a que pago va,
 * se guarda en el hilo y se pregunta; tirar un comprobante que la persona ya
 * mando es lo peor que podria hacer este modulo.
 */
async function recibirComprobante(telefono, url, tipo, identidad) {
  if (!dbConfigurada()) return null;
  const tel = ultimos10(telefono);
  const quien = (identidad && (identidad.uid || identidad.nombre)) || tel;

  const espera = await esperaGet(tel);

  // Ya se le habia pedido el comprobante de un pago concreto: va derecho ahi.
  if (espera && espera.paso === 'comprobante' && espera.pagoId) {
    const pago = await leerPago(espera.pagoId);
    if (pago && pago.estado === 'pendiente') {
      await guardarComprobante(pago.id, url, tipo, quien);
      await esperaSet(tel, { pagoId: pago.id, paso: 'monto', datos: {} });
      return `Recibí el comprobante de *${nombreServicio(pago)}* (${pago.periodoTexto}) 📄\n`
        + 'Ya quedó registrado como pagado ✅\n\n'
        + 'Para terminar: ¿cuánto pagaste y de qué forma? Ejemplo: *1250 efectivo*';
    }
  }

  const abiertos = await pagosAbiertosDe(tel);
  if (!abiertos.length) return null;   // que siga el flujo normal (tareas)

  if (abiertos.length === 1) {
    const pago = abiertos[0];
    await guardarComprobante(pago.id, url, tipo, quien);
    await esperaSet(tel, { pagoId: pago.id, paso: 'monto', datos: {} });
    return `Recibí el comprobante de *${nombreServicio(pago)}* (${pago.periodoTexto}) 📄\n\n`
      + '¿Cuánto pagaste y de qué forma? Ejemplo: *1250 efectivo*';
  }

  // Varios pagos abiertos: se guarda el archivo en el hilo y se pregunta cual.
  await esperaSet(tel, {
    pagoId: null, paso: 'elegir',
    datos: { url, tipo, opciones: abiertos.slice(0, 5).map(p => p.id) },
  });
  return `Recibí tu comprobante 📄 pero tienes varios pagos abiertos. ¿De cuál es?\n\n`
    + `${listaNumerada(abiertos)}\n\nRespóndeme con el *número*.`;
}

// Comandos de texto que este modulo atiende sin pasar por el asistente.
const RE_CONSULTA = /^\s*(mis\s+)?(pagos|servicios|recibos)\s*(pendientes|abiertos)?\s*[?¿!.]*\s*$/i;
const RE_YA_PAGUE = /\b(ya\s+)?(pagu[eé]|pague|pagamos|se\s+pag[oó]|pagado)\b/i;

/**
 * TEXTO ENTRANTE. Devuelve el texto a responder, o null si el mensaje no tiene
 * nada que ver con pagos (para que el webhook siga con el asistente normal).
 *
 * Solo se mete cuando hay una conversacion de pago EN CURSO o cuando el mensaje
 * es claramente de pagos. Un "ya terminé" suelto no debe caer aqui: seria
 * robarle mensajes al asistente de tareas.
 */
async function resolverPorWhatsapp(telefono, texto) {
  if (!dbConfigurada()) return null;
  const tel = ultimos10(telefono);
  const t = String(texto || '').trim();
  if (!t) return null;

  const espera = await esperaGet(tel);

  // ── Paso "elegir": mando comprobante y hay varios pagos abiertos ──
  if (espera && espera.paso === 'elegir') {
    const opciones = Array.isArray(espera.datos.opciones) ? espera.datos.opciones : [];
    let elegido = null;

    const num = /^\s*(\d{1,2})\s*$/.exec(t);
    if (num) {
      const i = Number(num[1]) - 1;
      if (i >= 0 && i < opciones.length) elegido = opciones[i];
    }
    if (!elegido) {
      // Tambien vale escribir el tipo ("la luz") o la sucursal.
      const pagos = (await Promise.all(opciones.map(id => leerPago(id)))).filter(Boolean);
      const busca = t.toLowerCase();
      const coincide = pagos.filter(p =>
        busca.includes(String(p.tipo || '').toLowerCase()) ||
        (p.sucursal && busca.includes(String(p.sucursal).toLowerCase())));
      if (coincide.length === 1) elegido = coincide[0].id;
    }

    if (!elegido) {
      const pagos = (await Promise.all(opciones.map(id => leerPago(id)))).filter(Boolean);
      return `No te entendí 🤔. Respóndeme con el número del pago:\n\n${listaNumerada(pagos)}`;
    }

    const pago = await leerPago(elegido);
    if (!pago || pago.estado !== 'pendiente') {
      await esperaSet(tel, null);
      return 'Ese pago ya está registrado. Si necesitas corregir algo, avísale a quien lleva el control 🙂';
    }
    await guardarComprobante(pago.id, espera.datos.url, espera.datos.tipo, tel);
    await esperaSet(tel, { pagoId: pago.id, paso: 'monto', datos: {} });
    return `Perfecto, lo guardé en *${nombreServicio(pago)}* (${pago.periodoTexto}) 📄\n`
      + 'Ya quedó registrado como pagado ✅\n\n'
      + 'Para terminar: ¿cuánto pagaste y de qué forma? Ejemplo: *1250 efectivo*';
  }

  // ── Paso "monto": ya hay comprobante, falta cuanto y como ──
  if (espera && espera.paso === 'monto' && espera.pagoId) {
    const pago = await leerPago(espera.pagoId);
    if (!pago) { await esperaSet(tel, null); return null; }

    const { monto, formaPago, sinDato } = leerMontoYForma(t);

    // No quiere o no puede dar el dato: se cierra igual. El comprobante, que es
    // lo importante, ya esta guardado; obligarla a contestar solo lograria que
    // el pago se quedara "pendiente" para siempre.
    if (sinDato && monto == null) {
      await esperaSet(tel, null);
      return `Sin problema, el pago de *${nombreServicio(pago)}* (${pago.periodoTexto}) ya quedó con su comprobante ✅\n`
        + 'El monto lo pueden completar desde MD Task.';
    }

    if (monto == null && !formaPago) {
      return 'No alcancé a entender el monto 🤔. Mándamelo así: *1250 efectivo* '
        + '(o dime *no sé* y lo dejo solo con el comprobante).';
    }

    // Falta la forma de pago: se pregunta una vez, sin trabar el flujo.
    if (monto != null && !formaPago) {
      await esperaSet(tel, { pagoId: pago.id, paso: 'monto', datos: { monto } });
      return `Anotado: ${pesos(monto)}. ¿Fue en *efectivo*, *tarjeta* o *transferencia*?`;
    }

    // Llega la forma de pago y el monto venia del mensaje anterior.
    const montoFinal = monto != null ? monto : (espera.datos.monto ?? null);
    await cerrarPago(pago.id, { monto: montoFinal, formaPago, quien: tel });
    await esperaSet(tel, null);
    return textoConfirmacion(pago, montoFinal, formaPago);
  }

  // ── Paso "comprobante": se le pidio la foto y mando texto ──
  if (espera && espera.paso === 'comprobante' && espera.pagoId) {
    const pago = await leerPago(espera.pagoId);
    if (pago) {
      return `Sigo esperando la *foto o el PDF* del comprobante de ${nombreServicio(pago)} 📄\n`
        + 'Si todavía no lo tienes a la mano, no hay prisa: mándamelo cuando puedas.';
    }
  }

  // ── Sin hilo abierto: solo comandos claros de pagos ──
  if (RE_CONSULTA.test(t)) {
    const abiertos = await pagosAbiertosDe(tel);
    if (!abiertos.length) return 'No tienes pagos de servicios pendientes por ahora 👌';
    const lista = abiertos.slice(0, 8).map(p => {
      const d = p.dias;
      const cuando = d == null ? '' : d < 0
        ? ` — 🔴 atrasado ${Math.abs(d)} día${Math.abs(d) === 1 ? '' : 's'}`
        : d === 0 ? ' — ⏰ vence hoy' : ` — vence en ${d} día${d === 1 ? '' : 's'}`;
      return `• ${nombreServicio(p)} (${p.periodoTexto})${cuando}`;
    }).join('\n');
    return `Tus pagos pendientes:\n\n${lista}\n\nCuando pagues alguno, mándame aquí su comprobante 📄`;
  }

  if (RE_YA_PAGUE.test(t)) {
    const abiertos = await pagosAbiertosDe(tel);
    if (!abiertos.length) return null;  // no es de pagos: que lo vea el asistente

    if (abiertos.length === 1) {
      const pago = abiertos[0];
      await esperaSet(tel, { pagoId: pago.id, paso: 'comprobante', datos: {} });
      return `¡Qué bien! Mándame la *foto o el PDF* del comprobante de ${nombreServicio(pago)} (${pago.periodoTexto}) 📄`;
    }

    // Si nombro el servicio ("ya pagué la luz"), no hay que preguntarle nada.
    const busca = t.toLowerCase();
    const coincide = abiertos.filter(p =>
      busca.includes(String(p.tipo || '').toLowerCase()) ||
      (p.sucursal && busca.includes(String(p.sucursal).toLowerCase())));
    if (coincide.length === 1) {
      const pago = coincide[0];
      await esperaSet(tel, { pagoId: pago.id, paso: 'comprobante', datos: {} });
      return `Perfecto. Mándame la *foto o el PDF* del comprobante de ${nombreServicio(pago)} (${pago.periodoTexto}) 📄`;
    }

    await esperaSet(tel, { pagoId: null, paso: 'elegir', datos: { opciones: abiertos.slice(0, 5).map(p => p.id) } });
    return `¿Cuál de estos pagaste?\n\n${listaNumerada(abiertos)}\n\nRespóndeme con el *número* y luego mándame el comprobante.`;
  }

  return null;
}

// ---------------------------------------------------------------------------
//  Poll
// ---------------------------------------------------------------------------
async function tick() {
  try { await generarPagosPendientes(); } catch (e) { console.error('[pagos] generar:', e && e.message); }
  try { await recordatoriosDelDia(); } catch (e) { console.error('[pagos] recordatorios:', e && e.message); }
  try { await resumenSupervisores(); } catch (e) { console.error('[pagos] resumen:', e && e.message); }
}

let pollIniciado = false;
function iniciarPoll() {
  if (pollIniciado) return;
  if (APAGADO) { console.log('[pagos] avisos APAGADOS (PAGOS_AVISOS=off).'); return; }
  pollIniciado = true;
  // Cada 5 min: cada servicio puede pedir su propia hora de aviso, y con un poll
  // mas lento un recordatorio puesto a las 09:00 podria salir bastante despues.
  // Mas rapido no aporta (los avisos son diarios) y solo gastaria consultas.
  const correr = () => tick().catch(e => console.error('[pagos] poll:', e && e.message));
  setInterval(correr, 5 * 60 * 1000);
  correr();
  console.log(`[pagos] poll iniciado (cada 5 min) — hora por servicio (general ${HORA_AVISO}), insiste hasta ${TOPE_INSISTENCIA} días`);
}

module.exports = {
  generarPagosPendientes, recordatoriosDelDia, resumenSupervisores, tick, iniciarPoll,
  recibirComprobante, resolverPorWhatsapp, pagosAbiertosDe, hayPagoEsperando,
  // Exportadas para pruebas y para reusar el formato en otros modulos.
  nombreServicio, leerMontoYForma, esperaGet, esperaSet,
};
