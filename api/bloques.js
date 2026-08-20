// ============================================================================
//  API de BLOQUES DE TRABAJO (tramos de horario con sus tareas).
//
//    GET    /api/bloques                 -> bloques con sus tareas y asignaciones
//    GET    /api/bloques?id=..           -> uno
//    POST   /api/bloques                 -> crea/actualiza un BLOQUE
//    POST   /api/bloques?recurso=tarea   -> crea/actualiza una TAREA del bloque
//    POST   /api/bloques?recurso=asignacion -> crea/actualiza una ASIGNACION
//    DELETE /api/bloques?id=..           -> borra el bloque (logico, con sus hijos)
//    DELETE /api/bloques?tarea=..        -> borra una tarea
//    DELETE /api/bloques?asignacion=..   -> borra una asignacion
//
//  El horario vive SOLO en el bloque: las tareas lo heredan. Ver SQL 031.
//
//  Quien puede escribir: admin, o quien tenga el permiso de crear checklists
//  (`puedeCrearChecklists`), que es el mismo criterio con el que hoy se asignan
//  tareas en la app. Leer lo puede hacer cualquiera con sesion: necesita ver sus
//  bloques del dia.
// ============================================================================
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

const FRECUENCIAS = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral', 'PorEvento'];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MODOS = ['porRol', 'porPersonas'];

function texto(v) {
  const s = String(v == null ? '' : v).trim();
  return s || null;
}
function horaValida(h) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ''));
}
function lista(v) {
  return Array.isArray(v) ? v.map(x => String(x)).filter(Boolean) : [];
}

/** ¿Este usuario puede CREAR o EDITAR bloques? (leer siempre se puede) */
async function puedeEscribir(usuario) {
  if (String(usuario.rol || '') === 'admin') return true;
  try {
    const r = await query(
      `select rol, coalesce(datos->>'puedeCrearChecklists','') as puede
         from mdtask_usuarios where id = $1`, [String(usuario.uid)]);
    const u = r.rows[0];
    if (!u) return false;
    return String(u.rol || '') === 'admin' || String(u.puede) === 'true';
  } catch (e) {
    console.error('[bloques] no se pudo revisar el permiso:', e && e.message);
    return false;   // ante la duda, no se deja escribir
  }
}

function filaBloque(r) {
  return {
    id: r.id, nombre: r.nombre, horaInicio: r.hora_inicio, horaFin: r.hora_fin,
    orden: r.orden == null ? null : Number(r.orden), color: r.color,
    activo: r.activo !== false,
    creadoEn: r.creado_en == null ? null : Number(r.creado_en),
    creadoPor: r.creado_por,
    actualizadoEn: r.actualizado_en == null ? null : Number(r.actualizado_en),
    ...(r.datos || {}),
  };
}
function filaTarea(r) {
  return {
    id: r.id, bloqueId: r.bloque_id, texto: r.texto,
    orden: r.orden == null ? null : Number(r.orden),
    tipo: r.tipo, fecha: r.fecha, frecuencia: r.frecuencia,
    diasSemana: r.dias_semana || [], diaMes: r.dia_mes == null ? null : Number(r.dia_mes),
    requiereFoto: r.requiere_foto === true,
    activo: r.activo !== false,
    creadoEn: r.creado_en == null ? null : Number(r.creado_en),
    ...(r.datos || {}),
  };
}
function filaAsignacion(r) {
  return {
    id: r.id, bloqueId: r.bloque_id,
    sucursales: r.sucursales || [], modo: r.modo,
    rolObjetivo: r.rol_objetivo, personas: r.personas || [],
    fechaInicio: r.fecha_inicio, fechaFin: r.fecha_fin,
    activa: r.activa !== false,
    creadoEn: r.creado_en == null ? null : Number(r.creado_en),
    ...(r.datos || {}),
  };
}

// ---------------------------------------------------------------------------
//  Validaciones
// ---------------------------------------------------------------------------
function validarBloque(b, existente) {
  const nombre = texto(b.nombre !== undefined ? b.nombre : (existente && existente.nombre));
  if (!nombre) return { error: 'Ponle nombre al bloque (por ejemplo "Mañana").' };

  const horaInicio = texto(b.horaInicio !== undefined ? b.horaInicio : (existente && existente.hora_inicio));
  const horaFin = texto(b.horaFin !== undefined ? b.horaFin : (existente && existente.hora_fin));
  if (!horaValida(horaInicio)) return { error: 'La hora de inicio debe ir en formato HH:mm (por ejemplo 07:00).' };
  if (!horaValida(horaFin)) return { error: 'La hora de fin debe ir en formato HH:mm (por ejemplo 11:00).' };
  // Un bloque que termina antes de empezar dejaria a sus tareas con una hora
  // limite imposible, y el radar las marcaria vencidas desde que nacen.
  if (horaFin <= horaInicio) {
    return { error: 'La hora de fin tiene que ser posterior a la de inicio.' };
  }

  const ordenRaw = b.orden !== undefined ? b.orden : (existente && existente.orden);
  const orden = ordenRaw == null || ordenRaw === '' ? null : Number(ordenRaw);
  if (orden != null && !Number.isFinite(orden)) return { error: 'El orden debe ser un número.' };

  // ---- Dias en que opera el bloque ----
  // Viven en el jsonb `datos` (no en columnas) para no migrar la tabla.
  //   diasModo 'diario'  -> se reparte todos los dias MENOS los de diasExcluidos
  //   diasModo 'algunos' -> se reparte SOLO los dias de diasSemana
  // Un bloque viejo no trae nada de esto y se comporta como 'diario' sin
  // excepciones, que es exactamente como se comportaba antes.
  const previos = (existente && existente.datos) || {};
  const diasModo = String(
    b.diasModo !== undefined ? b.diasModo : (previos.diasModo || 'diario'));
  if (diasModo !== 'diario' && diasModo !== 'algunos') {
    return { error: 'Los días del bloque deben ser "diario" o "algunos".' };
  }

  const diasExcluidos = b.diasExcluidos !== undefined
    ? lista(b.diasExcluidos) : lista(previos.diasExcluidos);
  const diasSemana = b.diasSemana !== undefined
    ? lista(b.diasSemana) : lista(previos.diasSemana);

  for (const d of diasExcluidos.concat(diasSemana)) {
    if (!DIAS.includes(d)) return { error: 'Día no reconocido: ' + d + '.' };
  }
  if (diasModo === 'diario' && diasExcluidos.length === DIAS.length) {
    return { error: 'Así el bloque no se repartiría ningún día. Deja al menos uno sin excluir.' };
  }
  if (diasModo === 'algunos' && !diasSemana.length) {
    return { error: 'Elige al menos un día en que se haga el bloque.' };
  }

  return {
    valor: {
      nombre, horaInicio, horaFin, orden,
      color: texto(b.color !== undefined ? b.color : (existente && existente.color)),
      activo: b.activo == null ? (existente ? existente.activo !== false : true) : b.activo !== false,
      // Lo que se guarda en `datos`. Se limpia el array del modo que no aplica
      // para no dejar configuraciones contradictorias guardadas.
      datos: {
        diasModo,
        diasExcluidos: diasModo === 'diario' ? diasExcluidos : [],
        diasSemana: diasModo === 'algunos' ? diasSemana : [],
      },
    },
  };
}

function validarTarea(b, existente) {
  const bloqueId = texto(b.bloqueId !== undefined ? b.bloqueId : (existente && existente.bloque_id));
  if (!bloqueId) return { error: 'Falta decir a qué bloque pertenece la tarea.' };

  const txt = texto(b.texto !== undefined ? b.texto : (existente && existente.texto));
  if (!txt) return { error: 'Escribe qué hay que hacer en la tarea.' };

  const tipo = String(b.tipo !== undefined ? b.tipo : ((existente && existente.tipo) || 'rutina'));
  if (tipo !== 'unica' && tipo !== 'rutina') return { error: 'El tipo de tarea debe ser "unica" o "rutina".' };

  let fecha = texto(b.fecha !== undefined ? b.fecha : (existente && existente.fecha));
  let frecuencia = texto(b.frecuencia !== undefined ? b.frecuencia : (existente && existente.frecuencia));
  let diasSemana = b.diasSemana !== undefined ? lista(b.diasSemana) : lista(existente && existente.dias_semana);
  let diaMes = b.diaMes !== undefined ? b.diaMes : (existente && existente.dia_mes);
  diaMes = diaMes == null || diaMes === '' ? null : Number(diaMes);

  if (tipo === 'unica') {
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return { error: 'Una tarea de una sola vez necesita su fecha (AAAA-MM-DD).' };
    }
    // Se limpian los campos de rutina para que no queden datos contradictorios.
    frecuencia = null; diasSemana = []; diaMes = null;
  } else {
    if (!frecuencia || !FRECUENCIAS.includes(frecuencia)) {
      return { error: 'Elige cada cuándo se repite: ' + FRECUENCIAS.join(', ') + '.' };
    }
    if ((frecuencia === 'Semanal' || frecuencia === 'Catorcenal') && !diasSemana.length) {
      return { error: 'En una rutina semanal hay que decir qué días.' };
    }
    const malos = diasSemana.filter(d => !DIAS.includes(d));
    if (malos.length) return { error: 'Estos días no los reconozco: ' + malos.join(', ') + '.' };
    if ((frecuencia === 'Mensual' || frecuencia === 'Trimestral')) {
      if (!Number.isInteger(diaMes) || diaMes < 1 || diaMes > 31) {
        return { error: 'En una rutina mensual hay que decir el día del mes (1 al 31).' };
      }
    } else {
      diaMes = null;
    }
    fecha = null;
  }

  const ordenRaw = b.orden !== undefined ? b.orden : (existente && existente.orden);
  return {
    valor: {
      bloqueId, texto: txt, tipo, fecha, frecuencia, diasSemana, diaMes,
      orden: ordenRaw == null || ordenRaw === '' ? null : Number(ordenRaw),
      requiereFoto: b.requiereFoto == null
        ? (existente ? existente.requiere_foto === true : false)
        : b.requiereFoto === true,
      activo: b.activo == null ? (existente ? existente.activo !== false : true) : b.activo !== false,
    },
  };
}

function validarAsignacion(b, existente) {
  const bloqueId = texto(b.bloqueId !== undefined ? b.bloqueId : (existente && existente.bloque_id));
  if (!bloqueId) return { error: 'Falta decir de qué bloque es la asignación.' };

  const sucursales = b.sucursales !== undefined ? lista(b.sucursales) : lista(existente && existente.sucursales);
  if (!sucursales.length) return { error: 'Elige al menos una sucursal.' };

  const modo = String(b.modo !== undefined ? b.modo : ((existente && existente.modo) || 'porRol'));
  if (!MODOS.includes(modo)) return { error: 'El modo debe ser porRol o porPersonas.' };

  const rolObjetivo = texto(b.rolObjetivo !== undefined ? b.rolObjetivo : (existente && existente.rol_objetivo));
  const personas = b.personas !== undefined ? lista(b.personas) : lista(existente && existente.personas);
  if (modo === 'porRol' && !rolObjetivo) return { error: 'Dinos a qué rol se le asigna el bloque.' };
  if (modo === 'porPersonas' && !personas.length) return { error: 'Elige a las personas a las que se les asigna.' };

  const fechaInicio = texto(b.fechaInicio !== undefined ? b.fechaInicio : (existente && existente.fecha_inicio));
  const fechaFin = texto(b.fechaFin !== undefined ? b.fechaFin : (existente && existente.fecha_fin));
  for (const [f, comoSeLlama] of [[fechaInicio, 'de inicio'], [fechaFin, 'de fin']]) {
    if (f && !/^\d{4}-\d{2}-\d{2}$/.test(f)) return { error: `La fecha ${comoSeLlama} debe ir en formato AAAA-MM-DD.` };
  }
  if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
    return { error: 'La vigencia termina antes de empezar: revisa las fechas.' };
  }

  return {
    valor: {
      bloqueId, sucursales, modo,
      rolObjetivo: modo === 'porRol' ? rolObjetivo : null,
      personas: modo === 'porPersonas' ? personas : [],
      fechaInicio, fechaFin,
      activa: b.activa == null ? (existente ? existente.activa !== false : true) : b.activa !== false,
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

  const q = req.query || {};

  try {
    // ---------------------------------------------------------------- GET
    if (req.method === 'GET') {
      const cond = q.id ? 'and id = $1' : '';
      const args = q.id ? [String(q.id)] : [];
      const bl = await query(
        `select * from mdtask_bloques where eliminado = false ${cond}
          order by hora_inicio nulls last, coalesce(orden, 9999)`, args);
      if (q.id && !bl.rows[0]) return res.status(404).json({ error: 'No existe ese bloque.' });

      const ids = bl.rows.map(r => r.id);
      let tareas = [], asignaciones = [];
      if (ids.length) {
        const t = await query(
          `select * from mdtask_bloque_tareas where eliminado = false and bloque_id = any($1)
            order by coalesce(orden, 9999), creado_en nulls last`, [ids]);
        tareas = t.rows.map(filaTarea);
        const a = await query(
          `select * from mdtask_bloque_asignaciones where eliminado = false and bloque_id = any($1)
            order by creado_en nulls last`, [ids]);
        asignaciones = a.rows.map(filaAsignacion);
      }

      // Se devuelve cada bloque con lo suyo dentro: la pantalla lo pinta asi y
      // evita que el frontend tenga que cruzar tres listas a mano.
      const bloques = bl.rows.map(filaBloque).map(b => ({
        ...b,
        tareas: tareas.filter(t => t.bloqueId === b.id),
        asignaciones: asignaciones.filter(a => a.bloqueId === b.id),
      }));

      if (q.id) return res.json({ bloque: bloques[0] });
      return res.json({ bloques });
    }

    // De aqui en adelante se escribe: hace falta permiso.
    if (!(await puedeEscribir(usuario))) {
      return res.status(403).json({
        error: 'No tienes permiso para crear o editar bloques. Un administrador te puede activar "Crear checklists" en Personal.',
      });
    }

    // --------------------------------------------------------------- POST
    if (req.method === 'POST') {
      const b = req.body || {};
      const ahora = Date.now();
      const quien = usuario.uid || null;
      const recurso = String(q.recurso || 'bloque');

      if (recurso === 'bloque') {
        let existente = null;
        if (b.id) {
          const r = await query('select * from mdtask_bloques where id = $1', [String(b.id)]);
          existente = r.rows[0] || null;
          if (!existente) return res.status(404).json({ error: 'No existe ese bloque.' });
        }
        const v = validarBloque(b, existente);
        if (v.error) return res.status(400).json({ error: v.error });
        const x = v.valor;
        const id = String(b.id || ('blq_' + ahora + '_' + Math.random().toString(36).slice(2, 6)));

        await query(
          `insert into mdtask_bloques
             (id, nombre, hora_inicio, hora_fin, orden, color, activo, datos,
              creado_en, creado_por, actualizado_en, eliminado)
           values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,false)
           on conflict (id) do update set
             nombre = excluded.nombre, hora_inicio = excluded.hora_inicio,
             hora_fin = excluded.hora_fin, orden = excluded.orden, color = excluded.color,
             activo = excluded.activo, actualizado_en = excluded.actualizado_en,
             -- merge, no reemplazo: guardar el horario no debe borrar los dias
             datos = coalesce(mdtask_bloques.datos,'{}'::jsonb) || excluded.datos,
             eliminado = false`,
          [id, x.nombre, x.horaInicio, x.horaFin, x.orden, x.color, x.activo,
            JSON.stringify(x.datos || {}),
            existente ? Number(existente.creado_en || ahora) : ahora,
            existente ? existente.creado_por : quien, ahora]);

        const r = await query('select * from mdtask_bloques where id = $1', [id]);
        return res.json({ ok: true, bloque: filaBloque(r.rows[0]) });
      }

      if (recurso === 'tarea') {
        let existente = null;
        if (b.id) {
          const r = await query('select * from mdtask_bloque_tareas where id = $1', [String(b.id)]);
          existente = r.rows[0] || null;
          if (!existente) return res.status(404).json({ error: 'No existe esa tarea.' });
        }
        const v = validarTarea(b, existente);
        if (v.error) return res.status(400).json({ error: v.error });
        const x = v.valor;

        // El bloque tiene que existir: si no, quedaria una tarea huerfana que
        // nadie ve y que el generador nunca reparte.
        const bq = await query('select id from mdtask_bloques where id = $1 and eliminado = false', [x.bloqueId]);
        if (!bq.rows[0]) return res.status(400).json({ error: 'Ese bloque no existe.' });

        const id = String(b.id || ('blqt_' + ahora + '_' + Math.random().toString(36).slice(2, 6)));
        const extras = { ...((existente && existente.datos) || {}) };
        for (const c of ['requiereAntesDespues', 'requiereVariasFotos', 'tiempoEstimado', 'nota']) {
          if (b[c] !== undefined) extras[c] = b[c];
        }

        await query(
          `insert into mdtask_bloque_tareas
             (id, bloque_id, texto, orden, tipo, fecha, frecuencia, dias_semana, dia_mes,
              requiere_foto, activo, datos, creado_en, creado_por, actualizado_en, eliminado)
           values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14,$15,false)
           on conflict (id) do update set
             bloque_id = excluded.bloque_id, texto = excluded.texto, orden = excluded.orden,
             tipo = excluded.tipo, fecha = excluded.fecha, frecuencia = excluded.frecuencia,
             dias_semana = excluded.dias_semana, dia_mes = excluded.dia_mes,
             requiere_foto = excluded.requiere_foto, activo = excluded.activo,
             datos = coalesce(mdtask_bloque_tareas.datos,'{}'::jsonb) || excluded.datos,
             actualizado_en = excluded.actualizado_en, eliminado = false`,
          [id, x.bloqueId, x.texto, x.orden, x.tipo, x.fecha, x.frecuencia,
            JSON.stringify(x.diasSemana), x.diaMes, x.requiereFoto, x.activo,
            JSON.stringify(extras),
            existente ? Number(existente.creado_en || ahora) : ahora,
            existente ? existente.creado_por : quien, ahora]);

        const r = await query('select * from mdtask_bloque_tareas where id = $1', [id]);
        return res.json({ ok: true, tarea: filaTarea(r.rows[0]) });
      }

      if (recurso === 'asignacion') {
        let existente = null;
        if (b.id) {
          const r = await query('select * from mdtask_bloque_asignaciones where id = $1', [String(b.id)]);
          existente = r.rows[0] || null;
          if (!existente) return res.status(404).json({ error: 'No existe esa asignación.' });
        }
        const v = validarAsignacion(b, existente);
        if (v.error) return res.status(400).json({ error: v.error });
        const x = v.valor;

        const bq = await query('select id from mdtask_bloques where id = $1 and eliminado = false', [x.bloqueId]);
        if (!bq.rows[0]) return res.status(400).json({ error: 'Ese bloque no existe.' });

        const id = String(b.id || ('blqa_' + ahora + '_' + Math.random().toString(36).slice(2, 6)));
        await query(
          `insert into mdtask_bloque_asignaciones
             (id, bloque_id, sucursales, modo, rol_objetivo, personas, fecha_inicio, fecha_fin,
              activa, datos, creado_en, creado_por, actualizado_en, eliminado)
           values ($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7,$8,$9,'{}'::jsonb,$10,$11,$12,false)
           on conflict (id) do update set
             bloque_id = excluded.bloque_id, sucursales = excluded.sucursales,
             modo = excluded.modo, rol_objetivo = excluded.rol_objetivo,
             personas = excluded.personas, fecha_inicio = excluded.fecha_inicio,
             fecha_fin = excluded.fecha_fin, activa = excluded.activa,
             actualizado_en = excluded.actualizado_en, eliminado = false`,
          [id, x.bloqueId, JSON.stringify(x.sucursales), x.modo, x.rolObjetivo,
            JSON.stringify(x.personas), x.fechaInicio, x.fechaFin, x.activa,
            existente ? Number(existente.creado_en || ahora) : ahora,
            existente ? existente.creado_por : quien, ahora]);

        const r = await query('select * from mdtask_bloque_asignaciones where id = $1', [id]);
        return res.json({ ok: true, asignacion: filaAsignacion(r.rows[0]) });
      }

      return res.status(400).json({ error: 'Recurso no válido. Usa bloque, tarea o asignacion.' });
    }

    // ------------------------------------------------------------- DELETE
    if (req.method === 'DELETE') {
      const ahora = Date.now();
      if (q.tarea) {
        const r = await query(
          `update mdtask_bloque_tareas set eliminado = true, actualizado_en = $2
            where id = $1 returning id`, [String(q.tarea), ahora]);
        if (!r.rows[0]) return res.status(404).json({ error: 'No existe esa tarea.' });
        return res.json({ ok: true });
      }
      if (q.asignacion) {
        const r = await query(
          `update mdtask_bloque_asignaciones set eliminado = true, actualizado_en = $2
            where id = $1 returning id`, [String(q.asignacion), ahora]);
        if (!r.rows[0]) return res.status(404).json({ error: 'No existe esa asignación.' });
        return res.json({ ok: true });
      }
      if (q.id) {
        // Al borrar el bloque se van con el sus tareas y asignaciones: dejarlas
        // sueltas haria que el generador siguiera repartiendo tareas de un bloque
        // que ya no existe.
        const r = await query(
          `update mdtask_bloques set eliminado = true, actualizado_en = $2
            where id = $1 returning id`, [String(q.id), ahora]);
        if (!r.rows[0]) return res.status(404).json({ error: 'No existe ese bloque.' });
        await query('update mdtask_bloque_tareas set eliminado = true, actualizado_en = $2 where bloque_id = $1', [String(q.id), ahora]);
        await query('update mdtask_bloque_asignaciones set eliminado = true, actualizado_en = $2 where bloque_id = $1', [String(q.id), ahora]);
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: 'Falta decir qué borrar (id, tarea o asignacion).' });
    }

    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    console.error('[bloques]', e && e.message);
    return res.status(500).json({ error: 'Error del servidor: ' + (e && e.message) });
  }
};

module.exports.FRECUENCIAS = FRECUENCIAS;
module.exports.DIAS = DIAS;
