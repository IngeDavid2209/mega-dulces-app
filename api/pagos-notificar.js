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
// Dos interruptores distintos, y los dos apagan SOLO los mensajes:
//   PAGOS_AVISOS=off   apaga los avisos de este modulo;
//   AVISOS_APAGADOS=1  es el interruptor general del servidor (tareas, flotilla).
// La GENERACION de recibos no se apaga con ninguno: crear la fila del mes no le
// escribe a nadie, y si no se generara, dar de alta un servicio no mostraria
// nada en el tablero y el modulo pareceria roto.
const PAGOS_AVISOS = String(process.env.PAGOS_AVISOS || '').toLowerCase();
// `PAGOS_AVISOS` MANDA sobre el interruptor general cuando trae un valor:
//   'off' -> apagados aunque el general este encendido;
//   'on'  -> encendidos aunque el general este apagado (es lo que hay hoy en
//            MDTask: AVISOS_APAGADOS=1 dejaba mudo tambien a este modulo, y los
//            recibos de luz no pueden esperar a que se prendan los de tareas);
//   sin valor -> se sigue al general, como antes.
// OJO si algun dia se levanta una SEGUNDA copia de la app: el general existe para
// que dos servidores no le manden el mismo aviso a la misma persona, asi que en
// esa copia hay que poner PAGOS_AVISOS=off explicitamente.
const APAGADO = PAGOS_AVISOS === 'off'
  || (PAGOS_AVISOS !== 'on' && process.env.AVISOS_APAGADOS === '1');

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

/**
 * Las 5 variables de la plantilla `recordatorio_pago`, en su orden:
 *   {{1}} nombre  {{2}} servicio  {{3}} periodo  {{4}} fecha limite  {{5}} monto
 *
 * Va en UNA sola funcion porque la usan el poll y el boton "Avisar" del tablero:
 * si se arman por separado, tarde o temprano una queda con 4 y Meta rechaza el
 * envio entero (error 132000, "number of parameters does not match").
 *
 * Ninguna puede ir VACIA (Meta tambien lo rechaza) ni con saltos de linea, de ahi
 * los respaldos. El monto es el estimado del catalogo, no lo que se pagara.
 */
function varsPlantilla(pago) {
  return [
    pago.responsableNombre || 'Hola',
    nombreServicio(pago),
    pago.periodoTexto || pago.periodo || 'este periodo',
    fechaLegible(pago.fechaLimite) || 'por definir',
    pago.montoEstimado ? pesos(pago.montoEstimado) : 'por confirmar',
  ];
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
      await marcarAviso(pago.id, { ultimoDia: hoy, ultimoEn: Date.now(), ultimoMotivo: 'sin_telefono' }).catch(() => {});
      console.warn(`[pagos] ${nombreServicio(pago)} (${pago.periodoTexto}) no tiene responsable con teléfono.`);
      continue;
    }

    const texto = textoRecordatorio(pago, dias);
    const res = await mandar(paraEnviar(tel), T_PAGO, varsPlantilla(pago), texto);
    const ahora = Date.now();

    if (res.ok && res.prueba) {
      // Fue la plantilla de PRUEBA DE VIDA (la cuenta venia rebotando): salio
      // hacia Meta, pero el 200 no prueba entrega. Se anota sin `ultimoDia`, para
      // que el dia siga vivo y el recordatorio se reintente en los proximos
      // ticks — si la persona abre su ventana escribiendole al bot, ahi si llega.
      await marcarAviso(pago.id, {
        ultimoEn: ahora, ultimoMotivo: 'plantilla_prueba',
      }).catch(() => {});
      console.log(`[pagos] recordatorio ${pago.id} -> ${tel}: plantilla de prueba (la cuenta venía rebotando); no se da por avisado.`);
    } else if (res.ok) {
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
 * AVISAR AHORA: manda el recordatorio de UN pago en este momento, sin esperar al
 * poll ni a la hora configurada. Lo dispara el boton del tablero.
 *
 * Devuelve { ok, motivo, texto, telefono, nombre } — y `texto` va SIEMPRE, haya
 * salido o no: si el envio no se pudo (la cuenta no puede escribir en frio y esa
 * persona no tiene conversacion abierta), el tablero ofrece abrir WhatsApp con el
 * mensaje ya escrito para mandarlo a mano. Vale mas eso que un "no se pudo".
 */
async function avisarAhora(pagoId) {
  if (!dbConfigurada()) return { ok: false, motivo: 'sin_base' };
  const pago = await leerPago(pagoId);
  if (!pago) return { ok: false, motivo: 'no_existe' };
  // 'cancelado' y 'pagado' se contestaban igual, y a un cancelado el tablero le
  // decia "ya esta registrado como pagado", que es sencillamente falso.
  if (pago.estado === 'cancelado') return { ok: false, motivo: 'cancelado' };
  if (pago.estado !== 'pendiente') return { ok: false, motivo: 'ya_pagado' };

  const tel = pago.responsableTelefono;
  const dias = diasFaltantes(pago.fechaLimite, hoyMexico());
  const texto = textoRecordatorio(pago, dias == null ? 0 : dias);
  const base = { texto, telefono: tel || null, nombre: pago.responsableNombre || null, servicio: nombreServicio(pago) };

  if (!tel) return { ok: false, motivo: 'sin_telefono', ...base };

  // A PROPOSITO no se respeta aqui el interruptor de avisos (PAGOS_AVISOS /
  // AVISOS_APAGADOS): ese apaga los avisos AUTOMATICOS, y esto es una persona
  // pulsando un boton porque quiere mandar ese recordatorio ahora. Bloquearlo
  // seria tratar una decision deliberada como si fuera spam del sistema.
  if (APAGADO) console.log(`[pagos] aviso MANUAL de ${pago.id}: los avisos automaticos estan apagados, pero este lo pidio una persona.`);

  const res = await mandar(paraEnviar(tel), T_PAGO, varsPlantilla(pago), texto);

  // Queda anotado igual que un aviso del poll, para que el tablero muestre como
  // le fue y para no repetirlo automaticamente el mismo dia si este si salio.
  const hoy = hoyMexico();
  if (res.ok && res.prueba) {
    // Prueba de vida: se mando, pero la cuenta venia rebotando y el 200 de Meta
    // no prueba entrega. No se marca `ultimoDia` (el dia sigue vivo) y el tablero
    // recibe `prueba:true` para ofrecerle igual la salida a mano a quien lo pidio.
    await marcarAviso(pago.id, { ultimoEn: Date.now(), ultimoMotivo: 'plantilla_prueba', aMano: true }).catch(() => {});
  } else if (res.ok) {
    await marcarAviso(pago.id, {
      ultimoDia: hoy, ultimoEn: Date.now(), ultimoMotivo: res.motivo,
      enviados: Number(pago.avisos.enviados || 0) + 1, aMano: true,
    }).catch(() => {});
  } else {
    await marcarAviso(pago.id, {
      ultimoEn: Date.now(), ultimoMotivo: 'fallo:' + res.motivo,
    }).catch(() => {});
  }
  console.log(`[pagos] aviso MANUAL ${pago.id} -> ${tel}: ${res.ok ? (res.prueba ? 'plantilla de PRUEBA (cuenta rebotando)' : res.motivo) : 'NO SALIO (' + res.motivo + ')'}`);
  return { ok: res.ok, motivo: res.motivo, prueba: !!res.prueba, ...base };
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
  // Solo cuentan los intentos RECIENTES. Sin la cota, un `fallo:` de hace tres
  // semanas se quedaba pegado para siempre (tras el tope de insistencia el motivo
  // ya no se vuelve a escribir) y el mismo servicio salia en este resumen todos
  // los dias hasta que alguien lo pagara. Un aviso que siempre dice lo mismo es
  // un aviso que se deja de leer.
  const HACE_48H = Date.now() - 48 * 3600 * 1000;
  const noAvisados = activos.filter(p => {
    const fallo = String(p.avisos.ultimoMotivo || '').startsWith('fallo:')
      || p.avisos.ultimoMotivo === 'sin_telefono';
    return fallo && Number(p.avisos.ultimoEn || 0) >= HACE_48H;
  });

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

  // Se reusa la plantilla del recordatorio (no hay una de resumen aprobada), asi
  // que hay que darle sus 5 variables en el mismo orden. Solo importa en frio: si
  // el supervisor tiene su ventana abierta, lo que recibe es el `texto` de arriba.
  for (const tel of SUPERVISORES) {
    await mandar(paraEnviar(tel), T_PAGO,
      ['Resumen', 'Pagos atrasados', hoy, fechaLegible(hoy) || hoy, `${vencidos.length} pendiente(s)`], texto);
  }
  console.log(`[pagos] resumen de ${vencidos.length} atrasado(s) enviado a ${SUPERVISORES.length} supervisor(es).`);
}

// ---------------------------------------------------------------------------
//  3) CAPTURA POR WHATSAPP
// ---------------------------------------------------------------------------

/**
 * Estado del hilo de captura de una persona (null si no hay o ya caduco).
 *
 * ATENCION AL CADUCADO: cuando el hilo va en el paso 'elegir' porque llego una
 * foto y no supimos de que pago era, la URL del archivo YA SUBIDO A CLOUDINARY
 * vive UNICAMENTE en esta fila. Borrarla a las 3 horas era tirar un comprobante
 * que la persona ya mando — exactamente lo que la cabecera de este modulo dice
 * que es lo peor que podria hacer. Ahora el hilo deja de secuestrar mensajes
 * (que es para lo que existe la caducidad) pero el archivo se CONSERVA en
 * `datos.huerfanos`, y el tablero lo enseña para que alguien lo asigne a mano.
 */
async function esperaGet(telefono) {
  try {
    const r = await query('select * from mdtask_pagos_espera where telefono = $1', [ultimos10(telefono)]);
    const e = r.rows[0];
    if (!e) return null;
    // Un hilo sin paso es solo el buzon de huerfanos: no hay conversacion viva.
    if (!e.paso) return null;
    if (Date.now() - Number(e.actualizado_en || 0) > ESPERA_VIGENCIA_MS) {
      const datos = e.datos || {};
      if (e.paso === 'elegir' && datos.url) {
        await archivarHuerfano(telefono, datos).catch(() => {});
        console.warn(`[pagos] ${ultimos10(telefono)} mando un comprobante y nunca dijo de cual era; queda en el buzon: ${datos.url}`);
      } else {
        await esperaSet(telefono, null).catch(() => {});
      }
      return null;
    }
    return { pagoId: e.pago_id, paso: e.paso, datos: e.datos || {} };
  } catch (e) { return null; }
}

/** Mueve el archivo sin destino al buzon de la fila y apaga la conversacion. */
async function archivarHuerfano(telefono, datos) {
  const tel = ultimos10(telefono);
  const entrada = [{
    url: String(datos.url), tipo: String(datos.tipo || 'imagen'),
    en: Date.now(), opciones: Array.isArray(datos.opciones) ? datos.opciones : [],
  }];
  await query(
    `update mdtask_pagos_espera
        set pago_id = null, paso = null, actualizado_en = $3,
            datos = jsonb_build_object(
              'huerfanos', coalesce(datos->'huerfanos','[]'::jsonb) || $2::jsonb)
      where telefono = $1`,
    [tel, JSON.stringify(entrada), Date.now()]
  );
}

/**
 * Comprobantes que llegaron por WhatsApp y nadie dijo a que pago iban.
 * Los lee el tablero: el archivo existe, no se perdio, y solo le falta dueño.
 */
async function comprobantesHuerfanos() {
  if (!dbConfigurada()) return [];
  try {
    const r = await query(
      `select e.telefono, e.datos,
              (select s.responsable_nombre from mdtask_servicios s
                where s.eliminado = false
                  and right(regexp_replace(coalesce(s.responsable_telefono,''), '[^0-9]', '', 'g'), 10) = e.telefono
                limit 1) as nombre
         from mdtask_pagos_espera e
        where jsonb_array_length(coalesce(e.datos->'huerfanos','[]'::jsonb)) > 0`);
    const salida = [];
    for (const f of r.rows) {
      for (const h of (f.datos || {}).huerfanos || []) {
        salida.push({ telefono: f.telefono, nombre: f.nombre || null, url: h.url, tipo: h.tipo, en: h.en });
      }
    }
    return salida.sort((a, b) => Number(b.en || 0) - Number(a.en || 0));
  } catch (e) {
    console.error('[pagos] no se pudo leer el buzon de huerfanos:', e && e.message);
    return [];
  }
}

/**
 * Guarda el paso del hilo.
 *
 * El buzon de huerfanos (`datos.huerfanos`) se ARRASTRA en cada escritura y
 * sobrevive al cierre del hilo: si no, el siguiente pago que reporte esa persona
 * borraria el comprobante que quedo sin dueño, que es el mismo agujero por otra
 * puerta.
 */
async function esperaSet(telefono, estado) {
  const tel = ultimos10(telefono);
  let huerfanos = [];
  try {
    const r = await query(`select coalesce(datos->'huerfanos','[]'::jsonb) as h
                             from mdtask_pagos_espera where telefono = $1`, [tel]);
    if (r.rows[0]) huerfanos = r.rows[0].h || [];
  } catch (e) { /* sin fila previa */ }

  if (!estado) {
    if (huerfanos.length) {
      await query(
        `update mdtask_pagos_espera set pago_id = null, paso = null, actualizado_en = $2
          where telefono = $1`, [tel, Date.now()]);
    } else {
      await query('delete from mdtask_pagos_espera where telefono = $1', [tel]);
    }
    return;
  }
  const datos = { ...(estado.datos || {}) };
  if (huerfanos.length) datos.huerfanos = huerfanos;
  await query(
    `insert into mdtask_pagos_espera (telefono, pago_id, paso, datos, actualizado_en)
     values ($1,$2,$3,$4::jsonb,$5)
     on conflict (telefono) do update set
       pago_id = excluded.pago_id, paso = excluded.paso,
       datos = excluded.datos, actualizado_en = excluded.actualizado_en`,
    [tel, estado.pagoId || null, estado.paso || null, JSON.stringify(datos), Date.now()]
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
async function pagosAbiertosDe(telefono, { todos = false } = {}) {
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
    //
    // `todos:true` se salta ese filtro, y es lo que se usa cuando la persona
    // PREGUNTA que debe: contestarle "no tienes pagos pendientes" porque el
    // recibo vence en tres semanas seria mentirle. Para REPORTAR un comprobante
    // se sigue usando la lista corta, que es la que evita ambiguedades.
    // La ventana era de 7 dias y el comentario de arriba decia lo contrario de lo
    // que hacia el codigo: a los 8 dias de anticipacion el comprobante SE RECHAZABA
    // (lista vacia) y la foto se iba por el camino de evidencias de tarea.
    // 21 dias cubre a quien paga con dos o tres semanas de adelanto sin abrir la
    // puerta a un recibo que vence en dos meses, que es lo que haria que una foto
    // de tarea se capturara como comprobante.
    .filter(p => todos || p.dias == null || p.dias <= Math.max(p.diasAviso, 21))
    .sort((a, b) => (a.dias ?? 999) - (b.dias ?? 999));
}

/**
 * ¿Este telefono es responsable de algun servicio? (aunque ahorita no deba nada)
 *
 * Sirve para distinguir dos silencios muy distintos: "eres responsable y estas
 * al corriente" (hay que decirselo) y "esto no va contigo" (mejor callarse y
 * dejar que el asistente atienda lo que en realidad preguntaba).
 */
async function esResponsableDeAlgo(telefono) {
  const tel = ultimos10(telefono);
  if (!tel || tel.length < 10) return false;
  try {
    const r = await query(
      `select 1 from mdtask_servicios
        where eliminado = false and activo = true
          and right(regexp_replace(coalesce(responsable_telefono,''), '[^0-9]', '', 'g'), 10) = $1
        limit 1`, [tel]);
    return r.rows.length > 0;
  } catch (e) { return false; }
}

/** Como se lee un vencimiento en el chat: "vence en 2 días", "atrasado 5 días". */
function cuandoVence(dias) {
  if (dias == null) return '';
  if (dias < 0) return ` — 🔴 atrasado ${Math.abs(dias)} día${Math.abs(dias) === 1 ? '' : 's'}`;
  if (dias === 0) return ' — ⏰ vence hoy';
  return ` — vence en ${dias} día${dias === 1 ? '' : 's'}`;
}

/**
 * Lo que este telefono debe, listo para contestar por WhatsApp.
 *
 * Lo usan los DOS caminos —el comando de texto ("mis pagos") y la herramienta
 * del asistente— para que la respuesta sea la misma sin importar como pregunten.
 * Devuelve tambien los datos sueltos, porque el asistente necesita razonar sobre
 * ellos y no solo repetir un parrafo.
 */
async function resumenPagosDe(telefono) {
  const abiertos = await pagosAbiertosDe(telefono, { todos: true });
  if (!abiertos.length) {
    return { total: 0, pagos: [], texto: 'No tienes pagos de servicios pendientes por ahora 👌' };
  }
  const lista = abiertos.slice(0, 8)
    .map(p => `• ${nombreServicio(p)} (${p.periodoTexto})${cuandoVence(p.dias)}`)
    .join('\n');
  const extra = abiertos.length > 8 ? `\n...y ${abiertos.length - 8} más.` : '';
  return {
    total: abiertos.length,
    pagos: abiertos.map(p => ({
      servicio: nombreServicio(p), periodo: p.periodoTexto, proveedor: p.proveedor || '',
      vence: fechaLegible(p.fechaLimite), dias: p.dias,
      atrasado: p.dias != null && p.dias < 0,
      monto_estimado: p.montoEstimado ? pesos(p.montoEstimado) : null,
    })),
    texto: `Tus pagos pendientes:\n\n${lista}${extra}\n\nCuando pagues alguno, mándame aquí su comprobante 📄`,
  };
}

/**
 * ¿Esta persona tiene algo de pagos a lo que pueda corresponder un archivo?
 *
 * Sirve para decidir ANTES de subir a Cloudinary si el archivo es comprobante o
 * evidencia de tarea. Sin esto habria que subirlo dos veces (una a cada carpeta)
 * y quedaria basura suelta en Cloudinary cada vez que la adivinanza falla.
 */
async function hayPagoEsperando(telefono, { explicito = false } = {}) {
  if (!dbConfigurada()) return false;
  const tel = ultimos10(telefono);
  const espera = await esperaGet(tel);
  if (espera && (espera.paso === 'comprobante' || espera.paso === 'elegir')) return true;
  // Si estamos preguntando el monto, una imagen mas es del MISMO pago (el recibo
  // y el voucher): tiene que entrar por aqui para que `recibirComprobante` la
  // anexe en vez de dejarla caer al camino de evidencias de tarea.
  if (espera && espera.paso === 'monto' && espera.pagoId) return true;
  // `explicito` = la persona escribio "comprobante"/"recibo" en el pie de foto.
  // Cuando lo DICE se le cree y se miran todos sus recibos abiertos; cuando el
  // sistema lo esta adivinando, se queda con la ventana corta. Es la diferencia
  // entre creerle a alguien y suponer por su cuenta.
  const abiertos = await pagosAbiertosDe(tel, { todos: !!explicito });
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


/**
 * Una imagen MAS sobre un pago que ya tiene su comprobante.
 *
 * No pisa el comprobante bueno: se anexa en `datos.comprobantesExtra`. El caso
 * normal es el recibo y el voucher del banco, o la foto por delante y por
 * detras, y tirar la segunda seria perder prueba que la persona ya mando.
 */
async function anexarComprobante(pagoId, url, tipo) {
  await query(
    `update mdtask_pagos_servicios
        set datos = coalesce(datos,'{}'::jsonb) || jsonb_build_object(
              'comprobantesExtra',
              coalesce(datos->'comprobantesExtra','[]'::jsonb) || $2::jsonb),
            actualizado_en = $3
      where id = $1`,
    [String(pagoId), JSON.stringify([{ url: String(url), tipo: String(tipo || 'imagen'), en: Date.now() }]), Date.now()]
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

// ── Lectura del monto: por que NO vale "el primer numero del mensaje" ────────
//
// La version anterior hacia `t.replace(/\s/g,'')` y se quedaba con el primer
// numero que encontrara. Medido, eso registraba cifras que nadie pago:
//
//   «referencia 0450123 pague 1250 efectivo»          -> $450,123.00
//   «pague con la tarjeta terminacion 4021, fueron 850» -> $4,021.00
//   «el 12/09 pague 1250 en efectivo»                 -> $12.00
//
// Y lo hacia EN SILENCIO: el pago se cerraba con ese monto y el tablero lo daba
// por bueno. Ahora cada numero del mensaje se mira con lo que tiene alrededor:
// se descartan los que no pueden ser un importe (fechas, folios, terminaciones
// de tarjeta, conteos) y se PREFIERE el que trae senal de importe ($ delante, o
// "pague/fueron/total/monto" justo antes). Si despues de eso quedan dos
// candidatos y ninguno gana, se devuelve `ambiguo` y el bot PREGUNTA en vez de
// elegir por su cuenta: equivocarse callado es peor que preguntar una vez mas.

/** Tras estas palabras, un numero es una REFERENCIA, no un importe. */
const ANTES_NO_IMPORTE = /(?:referencia|ref|folio|terminaci[oó]n|contrato|medidor|cuenta|clave|servicio|n[uú]mero|num|no|el|los|d[ií]a|tarjeta)\s*\.?\s*:?\s*(?:de\s+|con\s+)?$/i;
/** Tras estas, un numero SI es el importe. */
const ANTES_IMPORTE = /(?:\$|pagu[eé]|pagamos|pag[oó]|fueron|fue|son|total|monto|cost[oó]|sali[oó]|vinieron|lleg[oó]|llegaron)\s*(?:de\s+|:\s*)?\$?\s*$/i;
/** Un numero seguido de esto es un CONTEO ("fueron 2 recibos"), no un importe. */
const DESPUES_CONTEO = /^\s*(?:recibos?|pagos?|facturas?|meses|mes|veces|partes|servicios?)\b/i;

/**
 * Los numeros del mensaje que de verdad pueden ser un importe.
 * Devuelve { candidatos, preferidos } con el valor ya normalizado.
 */
function candidatosDeMonto(t) {
  const candidatos = [], preferidos = [];
  const re = /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const crudo = m[0];
    const i = m.index, fin = i + crudo.length;
    const antes = t.slice(Math.max(0, i - 28), i);
    const despues = t.slice(fin, fin + 18);

    // Fecha: el numero toca una barra o un guion con otro numero al lado.
    if (/[\/\-]\s*$/.test(antes) || /^\s*[\/\-]\s*\d/.test(despues)) continue;
    // Hora: «a las 9:30».
    if (/:\s*$/.test(antes) && !/\$/.test(antes)) continue;
    // Conteo: «fueron 2 recibos».
    if (DESPUES_CONTEO.test(despues)) continue;
    // Referencia con cero a la izquierda: los importes no se escriben «0450123».
    if (/^0\d/.test(crudo) && !crudo.includes('.')) continue;
    // Tras una palabra de referencia, folio o dia.
    if (ANTES_NO_IMPORTE.test(antes)) continue;

    const valor = Number(crudo.replace(/,/g, ''));
    if (!Number.isFinite(valor) || valor <= 0) continue;

    const preferido = ANTES_IMPORTE.test(antes);
    // Siete cifras o mas sin senal de importe es una referencia, no un recibo.
    const digitos = crudo.replace(/[^0-9]/g, '').length;
    if (!preferido && digitos >= 7) continue;

    candidatos.push({ valor, i, fin, preferido });
    if (preferido) preferidos.push(valor);
  }
  return { candidatos, preferidos };
}

/**
 * ¿Los numeros vienen unidos por una disyuncion? («pague 1250 o 1300»)
 * Ese "o" es la persona diciendo que no esta segura, y hay que preguntarle: sin
 * esto ganaba el que llevara "pague" delante y el otro se perdia en silencio.
 */
function hayDisyuncion(t, candidatos) {
  for (let k = 1; k < candidatos.length; k++) {
    const entre = t.slice(candidatos[k - 1].fin, candidatos[k].i);
    if (/^\s*(?:o|u|ó)\s*\$?\s*$/i.test(entre)) return true;
  }
  return false;
}

/**
 * Interpreta "cuanto pagaste y con que".
 * Acepta cosas como "1250 efectivo", "$1,250.50 con tarjeta", "pague 980 en
 * transferencia", "tarjeta" (sin monto) o "no se".
 * Devuelve { monto, formaPago, sinDato, ambiguo }.
 */
function leerMontoYForma(texto) {
  const t = String(texto || '').toLowerCase();

  // Las alternativas van AGRUPADAS: sin los parentesis, `\btarjeta|credito|...`
  // se lee como "(\btarjeta) o (credito) o (...)", asi que solo la primera
  // llevaba frontera y "acredito" contaba como pago con tarjeta.
  let formaPago = null;
  if (/(?:^|[^\p{L}])(?:tarjeta|tdc|tdd|cr[eé]dito|d[eé]bito)(?![\p{L}])/u.test(t)) formaPago = 'tarjeta';
  else if (/(?:^|[^\p{L}])(?:transferencia|transfer|spei|dep[oó]sito)(?![\p{L}])/u.test(t)) formaPago = 'transferencia';
  else if (/(?:^|[^\p{L}])(?:efectivo|cash|contado)(?![\p{L}])/u.test(t)) formaPago = 'efectivo';

  const { candidatos, preferidos } = candidatosDeMonto(t);
  let monto = null, ambiguo = false;
  if (hayDisyuncion(t, candidatos)) ambiguo = true;
  else if (preferidos.length === 1) monto = preferidos[0];
  else if (preferidos.length > 1) ambiguo = true;
  else if (candidatos.length === 1) monto = candidatos[0].valor;
  else if (candidatos.length > 1) ambiguo = true;

  // "no sé" es la respuesta mas comun de todas, y con `\bno s[eé]\b` NO casaba
  // (la frontera despues de la "é" no existe): el bot se quedaba pidiendole el
  // monto una y otra vez a quien acababa de decirle que no lo sabia.
  const sinDato = /(?:^|[^\p{L}])(?:no\s+s[eé]|no\s+recuerdo|despu[eé]s|luego)(?![\p{L}])/u.test(t);
  // Si dijo "no se", no hay nada ambiguo que preguntar.
  if (sinDato && monto == null) ambiguo = false;
  return { monto, formaPago, sinDato, ambiguo };
}

/**
 * ¿La cifra que dijo la persona esta muy lejos de lo que suele venir?
 *
 * Solo opina cuando el catalogo trae `monto_estimado`: sin punto de comparacion
 * no hay nada que decir, y un rango inventado seria peor que callarse. Los
 * factores son anchos a proposito (un recibo de luz de verano puede triplicar al
 * de invierno); esto no busca el error de $50, busca el $450,123.00 de un folio
 * leido como importe.
 */
function esMontoRaro(pago, monto) {
  const est = Number(pago && pago.montoEstimado);
  const m = Number(monto);
  if (!Number.isFinite(est) || est <= 0 || !Number.isFinite(m) || m <= 0) return false;
  return m > est * 8 || m < est / 8;
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
async function recibirComprobante(telefono, url, tipo, identidad, { explicito = false } = {}) {
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

  // ATENCION: ya recibimos su comprobante y le estamos preguntando el monto.
  //
  // Una SEGUNDA imagen aqui casi siempre es el MISMO pago: el recibo y el
  // voucher del banco, o la foto por delante y por detras. Antes este caso caia
  // de largo a `pagosAbiertosDe` y, si a esa persona le quedaba exactamente un
  // pago abierto, lo marcaba PAGADO con una imagen que no era suya — un
  // servicio cerrado con la prueba de otro, y en el tablero se ve verde.
  //
  // Se anexa al pago en curso y se deja la puerta abierta por si de verdad era
  // de otro: la persona escribe "otro" y se le vuelve a preguntar.
  if (espera && espera.paso === 'monto' && espera.pagoId) {
    const pago = await leerPago(espera.pagoId);
    if (pago) {
      await anexarComprobante(pago.id, url, tipo);
      return `Guardé también esta imagen en *${nombreServicio(pago)}* (${pago.periodoTexto}) 📎\n`
        + 'Si era de *otro* pago, escríbeme _otro_ y te digo cuáles tienes abiertos.\n\n'
        + '¿Cuánto pagaste y de qué forma? Ejemplo: *1250 efectivo*';
    }
  }
  const abiertos = await pagosAbiertosDe(tel, { todos: !!explicito });
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
//
// La consulta se reconoce de dos formas, y las dos exigen la palabra pago/recibo:
//   1) el mensaje ES la pregunta ("mis pagos", "pagos pendientes?");
//   2) una frase natural de pregunta ("¿tengo algun pago pendiente?", "que
//      recibos me tocan", "cuanto debo de pagos").
// Antes solo valia la forma 1, asi que la manera normal de preguntarlo se le
// escapaba al modulo y caia en el asistente, que no sabe nada de pagos.
//
// A PROPOSITO no entra un "¿que tengo pendiente?" a secas: eso es del asistente
// de TAREAS, que es lo que la gente pregunta cien veces al dia. Para esos casos
// esta la herramienta `consultar_mis_pagos`, y ahi decide el asistente.
// ⚠️ `\b` es ASCII en JavaScript, asi que /pagu[eé]\b/ NO casa con "pagué": la
// "é" no cuenta como letra, no hay frontera y el patron falla en silencio. Es un
// detalle caro aqui, porque la gente escribe con acentos y las notas de voz se
// transcriben CON acentos. Por eso el final de palabra se marca con (?![\p{L}])
// y la bandera /u.
const RE_CONSULTA = /^\s*(mis\s+)?(pagos|servicios|recibos)\s*(pendientes|abiertos)?\s*[?¿!.]*\s*$/i;
const RE_CONSULTA_FRASE = /(?:^|[^\p{L}])(?:tengo|tenemos|hay|falta|faltan|debo|debemos|adeudo|toca|tocan|cu[aá]les|qu[eé]|cu[aá]nto)(?![\p{L}])[^]{0,40}(?:^|[^\p{L}])(?:pagos?|recibos?)(?![\p{L}])|(?:^|[^\p{L}])(?:pagos?|recibos?)(?![\p{L}])[^]{0,25}(?:pendientes?|por\s+pagar|atrasad[oa]s?|vencid[oa]s?|abiert[oa]s?)(?![\p{L}])/iu;
// Lo que NO es una consulta aunque traiga la palabra: reportar que ya se pago.
// Sin esto, "¿ya pagué la luz?" no, pero "ya pagué el recibo" si caeria en la
// consulta y el bot contestaria una lista en vez de pedir el comprobante.
// Y lo que NO es de ESTE modulo aunque traiga la palabra "pago": aqui solo se
// habla de RECIBOS DE SERVICIOS (luz, agua, internet, renta). Medido, la frase
// natural se llevaba mensajes que son del asistente:
//
//   «cuanto le pago a Juan de la semana?»  -> contestaba la lista de recibos
//   «me falta el pago de mi bono»          -> idem
//
// Solo le pasa a quien ES responsable de algun servicio (a los demas ya se les
// devolvia null), asi que era silencioso y dificil de reportar: la persona
// preguntaba una cosa y le contestaban otra.
const RE_NO_ES_SERVICIO = /(?:^|[^\p{L}])(?:n[oó]mina|nomina|bono|sueldo|salario|aguinaldo|finiquito|comisi[oó]n|comisiones|proveedor(?:es)?|quincena|semana|raya|anticipo|pr[eé]stamo|vale)(?![\p{L}])|(?:le|les)\s+pago|pago\s+a\s+\p{Lu}/u;
function esConsultaDePagos(t) {
  if (RE_YA_PAGUE.test(t)) return false;
  if (RE_NO_ES_SERVICIO.test(String(t || ''))) return false;
  return RE_CONSULTA.test(t) || RE_CONSULTA_FRASE.test(t);
}
// Mismo cuidado con los acentos: la version anterior (`...|pagu[eé]|...\b`) NO
// reconocia "ya pagué la luz" —el caso mas comun de todos— y esa persona se iba
// al asistente en vez de que le pidieran el comprobante.
const RE_YA_PAGUE = /(?:^|[^\p{L}])(?:ya\s+)?(?:pagu[eé]|pagamos|pagad[oa]|se\s+pag[oó])(?![\p{L}])/iu;

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
    // ATENCION: el paso 'elegir' nace por DOS caminos y solo uno trae el archivo:
    //
    //   a) llego una foto y hay varios pagos abiertos -> `datos.url` existe;
    //   b) la persona escribio "ya pague" con varios abiertos -> NO existe, y su
    //      propio mensaje le dijo <<respondeme con el numero y LUEGO mandame el
    //      comprobante>>.
    //
    // Sin esta bifurcacion, el caso (b) llamaba a `guardarComprobante` con
    // `undefined`: el pago quedaba PAGADO con la cadena literal "undefined" en
    // `comprobante_url`, sin que nadie hubiera mandado una sola foto, y el bot
    // contestaba <<Ya quedo registrado como pagado>>. Es el mismo candado que el
    // endpoint de la app SI exige ("para marcar pagado hace falta el
    // comprobante", pagos-servicios.js), saltado por la puerta de al lado.
    if (!espera.datos.url) {
      await esperaSet(tel, { pagoId: pago.id, paso: 'comprobante', datos: {} });
      return `Anotado: *${nombreServicio(pago)}* (${pago.periodoTexto}) 👍\n\n`
        + 'Ahora sí, mándame la *foto o el PDF* del comprobante 📄';
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

    const { monto, formaPago, sinDato, ambiguo } = leerMontoYForma(t);

    // "otro": la imagen que acabo de anexar no era de este pago. Se le vuelve a
    // preguntar en vez de dejarla pegada donde no va.
    if (/^\s*(?:otro|es de otro|no,? es de otro|otro pago)\b/i.test(t)) {
      const otros = await pagosAbiertosDe(tel, { todos: true });
      if (otros.length) {
        await esperaSet(tel, { pagoId: null, paso: 'elegir', datos: { opciones: otros.slice(0, 5).map(p => p.id) } });
        return `De acuerdo. ¿De cuál era?\n\n${listaNumerada(otros)}\n\nRespóndeme con el *número*.`;
      }
    }

    // Confirmacion de un monto que la persona ya dijo y que NO cuadra con lo que
    // suele venir. No se rechaza —hay recibos que llegan altisimos de verdad—:
    // se le repite la cifra para que la vea escrita antes de que quede guardada.
    if (espera.datos.porConfirmar != null) {
      if (/(?:^|[^\p{L}])(?:s[ií]|correcto|exacto|as[ií] es|confirmo|sip|va)(?![\p{L}])/iu.test(t)) {
        const f = formaPago || espera.datos.formaPago || null;
        await cerrarPago(pago.id, { monto: Number(espera.datos.porConfirmar), formaPago: f, quien: tel });
        await esperaSet(tel, null);
        return textoConfirmacion(pago, Number(espera.datos.porConfirmar), f);
      }
      if (monto == null && !sinDato) {
        return `Para estar seguros: ¿el monto fue ${pesos(espera.datos.porConfirmar)}? Contéstame *sí*, o mándame la cifra correcta.`;
      }
    }

    // No se entendio CUAL de los numeros era el importe. Preguntar cuesta un
    // mensaje; adivinar cuesta un monto falso en el tablero que nadie revisa.
    if (ambiguo && !sinDato) {
      return 'Vi más de una cifra en tu mensaje y no quiero anotar la que no es 🤔.\n'
        + 'Mándame solo el monto, así: *1250* (o *1250 efectivo*).';
    }

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

    // Ultimo filtro antes de guardar: una cifra muy lejos de lo que suele venir
    // se le REPITE a la persona antes de darla por buena. No se rechaza (hay
    // recibos que de verdad llegan altisimos) y solo aplica cuando el catalogo
    // trae un estimado con el que comparar: sin estimado no hay nada que decir,
    // y callarse es mejor que inventar un rango.
    if (montoFinal != null && esMontoRaro(pago, montoFinal) && espera.datos.porConfirmar == null) {
      await esperaSet(tel, { pagoId: pago.id, paso: 'monto', datos: { porConfirmar: montoFinal, formaPago } });
      return `Anoté ${pesos(montoFinal)}, pero *${nombreServicio(pago)}* suele venir en `
        + `${pesos(pago.montoEstimado)} 🤔.\n¿Confirmas que fueron ${pesos(montoFinal)}? `
        + 'Contéstame *sí*, o mándame la cifra correcta.';
    }

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
  if (esConsultaDePagos(t)) {
    // Si esta persona no es responsable de NINGUN servicio, no se le contesta
    // "no tienes pagos": se devuelve null y que lo atienda el asistente. Puede
    // estar preguntando por el pago de otra cosa (una tarea, un proveedor).
    const resumen = await resumenPagosDe(tel);
    if (!resumen.total && !(await esResponsableDeAlgo(tel))) return null;
    return resumen.texto;
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
  pollIniciado = true;
  if (APAGADO) {
    // El poll SIGUE corriendo: genera los recibos de cada periodo para que el
    // tablero este al dia. Lo unico que no hace es mandar WhatsApps.
    console.log('[pagos] avisos APAGADOS: se generan los recibos, pero NO se manda ningun WhatsApp.');
  }
  // Cada 5 min: cada servicio puede pedir su propia hora de aviso, y con un poll
  // mas lento un recordatorio puesto a las 09:00 podria salir bastante despues.
  // Mas rapido no aporta (los avisos son diarios) y solo gastaria consultas.
  const correr = () => tick().catch(e => console.error('[pagos] poll:', e && e.message));
  setInterval(correr, 5 * 60 * 1000);
  correr();
  console.log(`[pagos] poll iniciado (cada 5 min) — avisos ${APAGADO ? 'APAGADOS' : `activos, hora por servicio (general ${HORA_AVISO}), insiste hasta ${TOPE_INSISTENCIA} días`}`);
}

module.exports = {
  generarPagosPendientes, recordatoriosDelDia, resumenSupervisores, tick, iniciarPoll,
  avisarAhora,
  recibirComprobante, resolverPorWhatsapp, pagosAbiertosDe, hayPagoEsperando,
  // Consulta "¿tengo algo que pagar?": la usan el comando de texto y la
  // herramienta `consultar_mis_pagos` del asistente, para que contesten igual.
  resumenPagosDe, esResponsableDeAlgo, esConsultaDePagos, comprobantesHuerfanos,
  // Exportadas para pruebas y para reusar el formato en otros modulos.
  nombreServicio, leerMontoYForma, esperaGet, esperaSet,
};
