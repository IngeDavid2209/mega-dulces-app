// ============================================================================
//  BLOQUES — generador del dia.
//
//  Convierte cada bloque asignado en un checklist normal de `mdtask_checklists`,
//  con la hora del bloque y las tareas que aplican ese dia. A partir de ahi todo
//  lo demas funciona sin cambios: el radar del celular, el bot de WhatsApp, el
//  ranking, las estadisticas y los reportes ya leen esa tabla.
//
//  ⚠️ LO MAS IMPORTANTE DE ESTE ARCHIVO: NUNCA pisar un checklist que ya existe.
//
//  Ya nos paso (memoria del proyecto, commits 0fd34f1 / 8afd88e): el robot de
//  rutinas recreaba checklists vacios y la gente perdia su avance, porque cuando
//  la consulta de "¿ya existe?" fallaba, se asumia que NO existia y se creaba
//  encima. Aqui eso no puede pasar por diseño: se usa
//  `insert ... on conflict (id) do nothing` con un id DETERMINISTA, asi que si la
//  fila ya esta, la base misma se niega a tocarla. No hay consulta previa que
//  pueda fallar ni condicion de carrera que valga.
//
//  El id determinista es: blq_<asignacionId>_<uid>_<fecha>
//
//  Corre en el BACKEND (poll en server.js), no en el celular. El robot viejo
//  corria en el navegador de cada trabajador, y de ahi salieron varios de los
//  problemas de duplicados y de progreso perdido.
// ============================================================================
const { query, dbConfigurada } = require('./db');

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Fecha de hoy (YYYY-MM-DD) y dia de la semana, en hora de Mexico. */
function hoyMexico() {
  const fecha = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  // getUTCDay del "mediodia Mexico" evita que la zona horaria mueva el dia.
  const dow = new Date(fecha + 'T12:00:00Z').getUTCDay();
  return { fecha, dia: DIAS[dow] };
}

/** Numero de semana ISO, para las rutinas catorcenales. */
function semanaIso(fecha) {
  const d = new Date(fecha + 'T12:00:00Z');
  const jueves = new Date(d);
  jueves.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const inicio = new Date(Date.UTC(jueves.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((jueves - inicio) / 86400000 - 3 + ((inicio.getUTCDay() + 6) % 7)) / 7);
}

/**
 * ¿Esta tarea del bloque toca hoy?
 *
 * Las frecuencias son las mismas del resto de la app. Nota sobre Catorcenal: se
 * usa la paridad de la semana ISO, que es la misma regla que ya se aplica en el
 * front; no hay una fecha de anclaje guardada por tarea.
 */
function tocaHoy(tarea, fecha, dia) {
  if (tarea.activo === false) return false;

  if (tarea.tipo === 'unica') return tarea.fecha === fecha;

  const frec = String(tarea.frecuencia || 'Diaria');
  const dias = Array.isArray(tarea.diasSemana) ? tarea.diasSemana : [];
  const diaMes = Number(fecha.slice(8, 10));
  const mes = Number(fecha.slice(5, 7));

  switch (frec) {
    case 'Diaria': return true;
    case 'Semanal': return dias.includes(dia);
    case 'Catorcenal': return dias.includes(dia) && semanaIso(fecha) % 2 === 0;
    case 'Mensual': return Number(tarea.diaMes) === diaMes;
    case 'Trimestral':
      // Trimestres naturales: enero, abril, julio y octubre.
      return Number(tarea.diaMes) === diaMes && [1, 4, 7, 10].includes(mes);
    case 'PorEvento': return false;   // se reparte a mano, no por calendario
    default: return false;
  }
}

/**
 * ¿Este BLOQUE opera en ese dia de la semana?
 *
 * Es distinto de la frecuencia de cada tarea: esto manda sobre el bloque
 * completo. Si el bloque no opera el domingo, ese dia no se reparte ninguna de
 * sus tareas, aunque una de ellas sea diaria.
 *
 * La configuracion vive en el jsonb `datos` del bloque:
 *   diasModo 'diario'  -> todos los dias MENOS los de diasExcluidos
 *   diasModo 'algunos' -> SOLO los dias de diasSemana
 *
 * Un bloque sin nada de esto (los creados antes de la opcion) opera todos los
 * dias, que es como se comportaba antes.
 */
function bloqueOperaEl(bloque, dia) {
  const d = (bloque && bloque.datos) || {};
  const modo = String(d.diasModo || 'diario');

  if (modo === 'algunos') {
    const dias = Array.isArray(d.diasSemana) ? d.diasSemana : [];
    // Sin dias elegidos no se reparte nada: es justo lo que se pidio al guardar,
    // y es mas seguro que repartir los siete por descuido.
    return dias.includes(dia);
  }

  const excluidos = Array.isArray(d.diasExcluidos) ? d.diasExcluidos : [];
  return !excluidos.includes(dia);
}

/** ¿La asignacion esta vigente en esa fecha? */
function vigente(asig, fecha) {
  if (asig.activa === false) return false;
  if (asig.fecha_inicio && fecha < asig.fecha_inicio) return false;
  if (asig.fecha_fin && fecha > asig.fecha_fin) return false;
  return true;
}

/** Sucursales de un usuario (viven en el jsonb `datos`). */
function sucursalesDe(u) {
  const s = (u.datos && u.datos.sucursales) || [];
  return Array.isArray(s) ? s.map(String) : [];
}

/**
 * A quien le toca una asignacion en una sucursal.
 *   porPersonas -> los uids elegidos (si trabajan en esa sucursal)
 *   porRol      -> todo el personal activo de ese rol en esa sucursal
 */
function destinatarios(asig, sucursal, personal) {
  const activos = personal.filter(u => u.activo !== false);
  if (asig.modo === 'porPersonas') {
    const elegidos = Array.isArray(asig.personas) ? asig.personas.map(String) : [];
    return activos.filter(u => elegidos.includes(String(u.id)));
  }
  const rol = String(asig.rol_objetivo || '');
  return activos.filter(u => {
    if (String(u.rol || '') !== rol) return false;
    const sucs = sucursalesDe(u);
    // "General (Acceso Total)" y "Todas las áreas" son los comodines que ya usa
    // la app para el personal que cubre cualquier sucursal.
    return sucs.includes(sucursal) || sucs.includes('General (Acceso Total)');
  });
}

/** Los items del checklist, con la hora del BLOQUE (no de cada tarea). */
function armarItems(tareas, bloque, ahora) {
  return tareas.map((t, i) => ({
    id: ahora + i,
    text: String(t.texto || ''),
    checked: false,
    tipo: t.tipo === 'unica' ? 'manual' : 'rutina',
    requiresPhoto: t.requiereFoto === true,
    requiresAntesDespues: t.requiereAntesDespues === true,
    requiresVariasFotos: t.requiereVariasFotos === true,
    permiteGaleria: false,
    permiteDocumentos: false,
    // AQUI esta la idea del modulo: la hora la manda el bloque y las tareas la
    // heredan, en vez de que cada tarea traiga la suya.
    horaInicio: bloque.hora_inicio || null,
    horaLimite: bloque.hora_fin || null,
    frecuencia: t.tipo === 'rutina' ? (t.frecuencia || 'Diaria') : null,
    diaSemana: (Array.isArray(t.diasSemana) && t.diasSemana.length === 1) ? t.diasSemana[0] : null,
    diaMes: t.diaMes == null ? null : Number(t.diaMes),
    fechaInicio: null, fechaFin: null,
    tiempoEstimado: t.tiempoEstimado == null ? null : t.tiempoEstimado,
    photo: null, photoTime: null,
    photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null,
    photoDespues: null, photoDespuesTime: null, photos: [],
    _bloqueTareaId: t.id,
  }));
}

/**
 * Genera los checklists de una fecha. Devuelve { creados, saltados, revisados }.
 * `saltados` son los que ya existian: no se tocan.
 */
async function generarDeFecha(fechaPedida) {
  if (!dbConfigurada()) return { creados: 0, saltados: 0, revisados: 0 };

  const hoy = hoyMexico();
  const fecha = fechaPedida || hoy.fecha;
  const dia = DIAS[new Date(fecha + 'T12:00:00Z').getUTCDay()];

  let bloques, tareas, asignaciones, personal;
  try {
    const b = await query(
      `select * from mdtask_bloques where eliminado = false and activo = true`);
    bloques = b.rows;
    if (!bloques.length) return { creados: 0, saltados: 0, revisados: 0 };

    const ids = bloques.map(x => x.id);
    const t = await query(
      `select * from mdtask_bloque_tareas where eliminado = false and activo = true
         and bloque_id = any($1) order by coalesce(orden, 9999), creado_en nulls last`, [ids]);
    tareas = t.rows.map(r => ({
      id: r.id, bloqueId: r.bloque_id, texto: r.texto, tipo: r.tipo,
      fecha: r.fecha, frecuencia: r.frecuencia,
      diasSemana: r.dias_semana || [], diaMes: r.dia_mes,
      requiereFoto: r.requiere_foto === true, activo: r.activo !== false,
      ...(r.datos || {}),
    }));

    const a = await query(
      `select * from mdtask_bloque_asignaciones where eliminado = false and activa = true
         and bloque_id = any($1)`, [ids]);
    asignaciones = a.rows;

    const p = await query('select id, nombre, correo, rol, activo, datos from mdtask_usuarios');
    personal = p.rows;
  } catch (e) {
    // Si no se pudo leer la configuracion, NO se genera nada. Generar a ciegas
    // es lo que hacia el robot viejo cuando fallaba una consulta.
    console.error('[bloques] no se pudo leer la configuracion, no se genera nada:', e && e.message);
    return { creados: 0, saltados: 0, revisados: 0, error: true };
  }

  let creados = 0, saltados = 0, revisados = 0;
  const ahora = Date.now();

  for (const bloque of bloques) {
    // Primero el dia del BLOQUE: si hoy no opera, ni se miran sus tareas.
    if (!bloqueOperaEl(bloque, dia)) continue;

    const suyas = tareas.filter(t => t.bloqueId === bloque.id && tocaHoy(t, fecha, dia));
    if (!suyas.length) continue;   // hoy este bloque no tiene nada que repartir

    for (const asig of asignaciones.filter(a => a.bloque_id === bloque.id)) {
      if (!vigente(asig, fecha)) continue;
      const sucursales = Array.isArray(asig.sucursales) ? asig.sucursales : [];

      for (const sucursal of sucursales) {
        for (const persona of destinatarios(asig, sucursal, personal)) {
          revisados++;
          const id = `blq_${asig.id}_${persona.id}_${fecha}`;
          const items = armarItems(suyas, bloque, ahora);
          const datos = {
            items,
            _bloqueId: bloque.id,
            _bloqueNombre: bloque.nombre,
            _bloqueAsignacionId: asig.id,
            _generadoPorBloques: true,
          };

          try {
            // `do nothing` es el seguro: si ya existe, la base no lo toca. Nunca
            // se pisa el avance de nadie, ni aunque dos polls corran a la vez.
            const r = await query(
              `insert into mdtask_checklists
                 (id, name, assigned, assigned_uid, store, fecha, hora, status,
                  enviado, eliminado, archivado, created_by, timestamp_creacion, datos)
               values ($1,$2,$3,$4,$5,$6,$7,'pendiente',false,false,false,$8,$9,$10::jsonb)
               on conflict (id) do nothing
               returning id`,
              [id, bloque.nombre || 'Bloque', persona.nombre || persona.correo || '',
                persona.id, sucursal, fecha, bloque.hora_fin || '23:59',
                'bloques', ahora, JSON.stringify(datos)]);
            if (r.rows[0]) creados++; else saltados++;
          } catch (e) {
            console.error(`[bloques] no se pudo generar ${id}:`, e && e.message);
          }
        }
      }
    }
  }

  if (creados) console.log(`[bloques] ${fecha}: ${creados} checklist(s) generado(s), ${saltados} ya existian.`);
  return { creados, saltados, revisados };
}

/** Tick del poll: genera hoy y mañana (para que el dia arranque ya repartido). */
async function tick() {
  const hoy = hoyMexico();
  await generarDeFecha(hoy.fecha);
  // Mañana: asi a primera hora la gente ya tiene su bloque, sin esperar al poll.
  const manana = new Date(Date.parse(hoy.fecha + 'T12:00:00Z') + 86400000)
    .toISOString().slice(0, 10);
  await generarDeFecha(manana);
}

let pollIniciado = false;
function iniciarPoll() {
  if (pollIniciado) return;
  pollIniciado = true;
  const correr = () => tick().catch(e => console.error('[bloques] poll:', e && e.message));
  // Cada 15 min: alcanza para que un bloque recien creado se reparta pronto, y
  // no hace falta mas porque las tareas del dia no cambian a cada rato.
  setInterval(correr, 15 * 60 * 1000);
  correr();
  console.log('[bloques] generador iniciado (cada 15 min, hoy y mañana)');
}

module.exports = {
  generarDeFecha, tick, iniciarPoll, tocaHoy, bloqueOperaEl, semanaIso,
  destinatarios, hoyMexico,
};
