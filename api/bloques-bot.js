// ============================================================================
//  BLOQUES — lo que necesita el BOT de WhatsApp.
//
//  Va aparte de api/asistente-chat.js a proposito: ese archivo ya pasa de 2800
//  lineas y es el corazon del asistente; meterle las consultas de cada modulo
//  nuevo lo vuelve imposible de leer.
//
//  OJO con lo que el bot NO necesita de aqui: las tareas del dia ya las ve solo.
//  El generador (api/bloques-generar.js) reparte los bloques como checklists
//  normales, asi que `mis_pendientes`, `consultar_tareas`, `entregar_item` y
//  `enviar_checklist` funcionan con ellos sin una linea de codigo extra. Esto de
//  aqui es para CONSULTAR y ARMAR la estructura de bloques por voz o por chat.
// ============================================================================
const { query, dbConfigurada } = require('./db');

const FRECUENCIAS = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral', 'PorEvento'];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function normaliza(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
function horaValida(h) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ''));
}

/** Todos los bloques con sus tareas y a quien se le reparten. */
async function listarBloques() {
  if (!dbConfigurada()) return [];
  const b = await query(
    `select * from mdtask_bloques where eliminado = false
      order by coalesce(orden, 9999), hora_inicio nulls last`);
  if (!b.rows.length) return [];
  const ids = b.rows.map(r => r.id);
  const t = await query(
    `select * from mdtask_bloque_tareas where eliminado = false and bloque_id = any($1)
      order by coalesce(orden, 9999)`, [ids]);
  const a = await query(
    `select * from mdtask_bloque_asignaciones where eliminado = false and bloque_id = any($1)`, [ids]);

  return b.rows.map(r => ({
    id: r.id, nombre: r.nombre, horaInicio: r.hora_inicio, horaFin: r.hora_fin,
    activo: r.activo !== false,
    tareas: t.rows.filter(x => x.bloque_id === r.id).map(x => ({
      id: x.id, texto: x.texto, tipo: x.tipo, frecuencia: x.frecuencia,
      dias: x.dias_semana || [], diaMes: x.dia_mes, fecha: x.fecha,
      activo: x.activo !== false,
    })),
    asignaciones: a.rows.filter(x => x.bloque_id === r.id).map(x => ({
      sucursales: x.sucursales || [], modo: x.modo, rol: x.rol_objetivo,
      personas: (x.personas || []).length, activa: x.activa !== false,
    })),
  }));
}

/** Busca un bloque por nombre (tolerante a acentos y mayusculas). */
async function buscarBloque(nombre) {
  const todos = await listarBloques();
  const q = normaliza(nombre);
  if (!q) return { bloque: null, parecidos: todos.map(b => b.nombre) };
  const exacto = todos.find(b => normaliza(b.nombre) === q);
  if (exacto) return { bloque: exacto, parecidos: [] };
  const parciales = todos.filter(b => normaliza(b.nombre).includes(q) || q.includes(normaliza(b.nombre)));
  if (parciales.length === 1) return { bloque: parciales[0], parecidos: [] };
  return { bloque: null, parecidos: (parciales.length ? parciales : todos).map(b => b.nombre) };
}

/** Crea un bloque. Devuelve { ok, mensaje, bloque }. */
async function crearBloque({ nombre, horaInicio, horaFin, orden }, uid) {
  if (!dbConfigurada()) return { ok: false, mensaje: 'No hay conexión con la base.' };
  const nom = String(nombre || '').trim();
  if (!nom) return { ok: false, mensaje: 'Falta el nombre del bloque.' };
  if (!horaValida(horaInicio) || !horaValida(horaFin)) {
    return { ok: false, mensaje: 'Las horas deben ir como HH:mm (por ejemplo 07:00 y 11:00).' };
  }
  if (horaFin <= horaInicio) {
    return { ok: false, mensaje: 'La hora de fin tiene que ser posterior a la de inicio.' };
  }
  // No se crean dos bloques con el mismo nombre: confundirian a quien los asigna
  // despues y el bot no sabria a cual se refiere el admin.
  const ya = await buscarBloque(nom);
  if (ya.bloque) return { ok: false, mensaje: `Ya existe un bloque llamado "${ya.bloque.nombre}" (${ya.bloque.horaInicio}-${ya.bloque.horaFin}).` };

  const ahora = Date.now();
  const id = 'blq_' + ahora + '_' + Math.random().toString(36).slice(2, 6);
  await query(
    `insert into mdtask_bloques (id, nombre, hora_inicio, hora_fin, orden, activo, datos, creado_en, creado_por, actualizado_en, eliminado)
     values ($1,$2,$3,$4,$5,true,'{}'::jsonb,$6,$7,$6,false)`,
    [id, nom, horaInicio, horaFin, orden == null ? null : Number(orden), ahora, uid || null]);

  return {
    ok: true,
    mensaje: `Listo, creé el bloque "${nom}" de ${horaInicio} a ${horaFin}. Todavía no tiene tareas ni a quién repartirse.`,
    bloque: { id, nombre: nom, horaInicio, horaFin },
  };
}

/** Agrega una tarea a un bloque (por nombre del bloque). */
async function agregarTarea({ bloque, texto, tipo, frecuencia, dias, dia_mes, fecha, requiere_foto }, uid) {
  if (!dbConfigurada()) return { ok: false, mensaje: 'No hay conexión con la base.' };
  const txt = String(texto || '').trim();
  if (!txt) return { ok: false, mensaje: 'Falta qué hay que hacer en la tarea.' };

  const b = await buscarBloque(bloque);
  if (!b.bloque) {
    return {
      ok: false,
      mensaje: b.parecidos.length
        ? `No encontré el bloque "${bloque}". Los que hay son: ${b.parecidos.join(', ')}.`
        : 'Todavía no hay ningún bloque creado. Primero hay que crear uno (por ejemplo "Mañana" de 07:00 a 11:00).',
    };
  }

  const esUnica = String(tipo || 'rutina') === 'unica';
  let frec = null, diasSem = [], diaMes = null, fechaUnica = null;

  if (esUnica) {
    fechaUnica = String(fecha || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaUnica)) {
      return { ok: false, mensaje: 'Para una tarea de una sola vez necesito la fecha (AAAA-MM-DD).' };
    }
  } else {
    frec = FRECUENCIAS.includes(String(frecuencia)) ? String(frecuencia) : 'Diaria';
    diasSem = Array.isArray(dias) ? dias.filter(d => DIAS.includes(d)) : [];
    if ((frec === 'Semanal' || frec === 'Catorcenal') && !diasSem.length) {
      return { ok: false, mensaje: 'Para una rutina semanal necesito saber en qué días.' };
    }
    if (frec === 'Mensual' || frec === 'Trimestral') {
      diaMes = Number(dia_mes);
      if (!Number.isInteger(diaMes) || diaMes < 1 || diaMes > 31) {
        return { ok: false, mensaje: 'Para una rutina mensual necesito el día del mes (1 al 31).' };
      }
    }
  }

  const ahora = Date.now();
  const id = 'blqt_' + ahora + '_' + Math.random().toString(36).slice(2, 6);
  const orden = (b.bloque.tareas || []).length + 1;
  await query(
    `insert into mdtask_bloque_tareas
       (id, bloque_id, texto, orden, tipo, fecha, frecuencia, dias_semana, dia_mes,
        requiere_foto, activo, datos, creado_en, creado_por, actualizado_en, eliminado)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,true,'{}'::jsonb,$11,$12,$11,false)`,
    [id, b.bloque.id, txt, orden, esUnica ? 'unica' : 'rutina', fechaUnica, frec,
      JSON.stringify(diasSem), diaMes, requiere_foto === true, ahora, uid || null]);

  const cuando = esUnica ? `solo el ${fechaUnica}`
    : frec === 'Diaria' ? 'todos los días'
      : (frec === 'Semanal' || frec === 'Catorcenal') ? `${frec.toLowerCase()}: ${diasSem.join(', ')}`
        : `${frec.toLowerCase()}, día ${diaMes}`;

  return {
    ok: true,
    mensaje: `Agregué "${txt}" al bloque ${b.bloque.nombre} (${cuando}). Se entregará a las ${b.bloque.horaFin}.`
      + ((b.bloque.asignaciones || []).length ? '' : ' Ojo: ese bloque todavía no está asignado a nadie.'),
  };
}

module.exports = { listarBloques, buscarBloque, crearBloque, agregarTarea, FRECUENCIAS, DIAS };
