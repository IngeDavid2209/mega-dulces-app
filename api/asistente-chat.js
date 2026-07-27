// Endpoint del ASISTENTE (chat con tool-use).
//
// Corre el BUCLE de herramientas de Claude: el modelo pide una herramienta, el
// servidor la ejecuta de verdad sobre Firestore (firebase-admin), le devuelve el
// resultado, y el modelo sigue hasta terminar.
//
// Herramientas:
//   TAREAS:   agregar_tarea, consultar_tareas, completar_tarea, editar_tarea, eliminar_tarea
//   RUTINAS:  crear_rutina (crea catalogo_rutinas + asignaciones_rutinas)
//   INFO:     consultar_rutinas, resumen_hoy, estadisticas
//
// Variables de entorno (Railway -> Variables):
//   ANTHROPIC_API_KEY, FIREBASE_SERVICE_ACCOUNT, ASISTENTE_MODELO (opcional)

const admin = require('firebase-admin');
const crypto = require('crypto');
const { query } = require('./db');

// firebase-admin solo se usa ya para VERIFICAR el idToken del endpoint web
// (Firebase Auth, ajeno a la cuota de Firestore). TODOS los datos del asistente
// (usuarios, agenda, checklists, rutinas, config, hilo del bot) viven en Postgres
// tras la migración FERROCARRIL; el bot ya NO toca Firestore.
let inicializado = false;
function inicializar() {
  if (inicializado) return;
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Falta variable FIREBASE_SERVICE_ACCOUNT en las variables de entorno.');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  inicializado = true;
}

// ---------------------------------------------------------------------------
// CAPA DE DATOS (Postgres) — reproduce el mapeo columna/jsonb de los endpoints
// api/usuarios.js, usuarios-agenda.js, checklists.js y _crud.js, pero consultando
// Postgres DIRECTO con query() (server-side, sin idToken). Si cambia el esquema
// de esos endpoints, refléjalo aquí también.
// ---------------------------------------------------------------------------

// -- usuarios (mdtask_usuarios) -> objeto estilo Firestore (igual que usuarios.js) --
function usuarioFila(r) {
  const datos = r.datos || {};
  return {
    uid: r.id, id: r.id,
    usuario: r.usuario || '', correo: r.correo || '', nombre: r.nombre || '',
    rol: r.rol || '', telefono: r.telefono || '', alcance: r.alcance || '',
    cargo: r.cargo || '', activo: r.activo !== false,
    creadoEn: r.creado_en != null ? Number(r.creado_en) : null,
    actualizadoEn: r.actualizado_en != null ? Number(r.actualizado_en) : null,
    ...datos,
  };
}
async function pgUsuarios() {
  const r = await query('select * from mdtask_usuarios order by nombre asc');
  return r.rows.map(usuarioFila);
}
async function pgUsuarioPorId(id) {
  const r = await query('select * from mdtask_usuarios where id = $1', [String(id)]);
  return r.rows[0] ? usuarioFila(r.rows[0]) : null;
}

// -- config (mdtask_config) leído por id; todo el doc vive en `datos` --
async function pgConfig(id) {
  const r = await query('select * from mdtask_config where id = $1', [String(id)]);
  return r.rows[0] ? (r.rows[0].datos || {}) : null;
}

// -- agenda personal (mdtask_agenda) (igual que usuarios-agenda.js) --
const AGENDA_COLS = new Set(['texto', 'completada', 'fecha', 'prioridad']);
const AGENDA_IGNORAR = new Set(['id', 'uid', 'fechaCreacion', 'completadaEn', 'fecha_creacion', 'completada_en']);
function agendaFila(r) {
  const datos = r.datos || {};
  return {
    id: r.id, uid: r.uid,
    texto: r.texto || '', completada: !!r.completada,
    fecha: r.fecha || '', prioridad: r.prioridad || '',
    fechaCreacion: r.fecha_creacion != null ? Number(r.fecha_creacion) : null,
    completadaEn: r.completada_en != null ? Number(r.completada_en) : null,
    ...datos,
  };
}
async function pgAgendaList(uid) {
  const r = await query('select * from mdtask_agenda where uid = $1 order by fecha_creacion asc', [String(uid)]);
  return r.rows.map(agendaFila);
}
async function pgAgendaAdd(uid, doc) {
  const cols = {}, datos = {};
  for (const [k, v] of Object.entries(doc || {})) {
    if (AGENDA_IGNORAR.has(k)) continue;
    if (AGENDA_COLS.has(k)) cols[k] = v; else datos[k] = v;
  }
  const id = crypto.randomUUID();
  await query(
    `insert into mdtask_agenda (id, uid, texto, completada, fecha, prioridad, fecha_creacion, completada_en, datos)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, String(uid), String(cols.texto || ''), !!cols.completada, String(cols.fecha || ''),
     String(cols.prioridad || ''), doc.fechaCreacion != null ? Number(doc.fechaCreacion) : Date.now(),
     doc.completadaEn != null ? Number(doc.completadaEn) : null, JSON.stringify(datos)]
  );
  return id;
}
// Actualiza una tarea de la agenda del PROPIO usuario (scope por uid). Mezcla
// las claves de `datos`. Devuelve true si existía. `colChanges` usa nombres de
// columna; `datosChanges` va al jsonb.
async function pgAgendaUpdate(id, uid, colChanges, datosChanges) {
  const cur = await query('select * from mdtask_agenda where id = $1 and uid = $2', [String(id), String(uid)]);
  if (cur.rowCount === 0) return false;
  const actual = cur.rows[0];
  const val = (c) => (c in colChanges ? colChanges[c] : actual[c]);
  const mergedDatos = { ...(actual.datos || {}), ...(datosChanges || {}) };
  await query(
    `update mdtask_agenda set texto=$2, completada=$3, fecha=$4, prioridad=$5, completada_en=$6, datos=$7
       where id=$1`,
    [String(id), String(val('texto') || ''),
     ('completada' in colChanges ? !!colChanges.completada : actual.completada),
     String(val('fecha') || ''), String(val('prioridad') || ''),
     ('completada_en' in colChanges ? colChanges.completada_en : actual.completada_en),
     JSON.stringify(mergedDatos)]
  );
  return true;
}
async function pgAgendaDelete(id, uid) {
  const r = await query('delete from mdtask_agenda where id = $1 and uid = $2', [String(id), String(uid)]);
  return r.rowCount > 0;
}

// -- checklists (mdtask_checklists) (igual que checklists.js) --
const CK_MAP = {
  name: 'name', assigned: 'assigned', assignedUid: 'assigned_uid', store: 'store',
  date: 'fecha', time: 'hora', status: 'status',
  enviado: 'enviado', eliminado: 'eliminado', archivado: 'archivado',
  origenTec: 'origen_tec', entregaConRetraso: 'entrega_con_retraso',
  createdBy: 'created_by', timestampCreacion: 'timestamp_creacion',
  _asignacionId: 'asignacion_id', _catalogoRutinaId: 'catalogo_rutina_id',
};
const CK_BOOL = new Set(['enviado', 'eliminado', 'archivado', 'origen_tec', 'entrega_con_retraso']);
const CK_COL_LIST = ['name', 'assigned', 'assigned_uid', 'store', 'fecha', 'hora', 'status',
  'enviado', 'eliminado', 'archivado', 'origen_tec', 'entrega_con_retraso',
  'created_by', 'timestamp_creacion', 'asignacion_id', 'catalogo_rutina_id'];
function ckValorCol(col, v) {
  if (v === undefined) return null;
  if (CK_BOOL.has(col)) return !!v;
  if (col === 'timestamp_creacion') return v != null ? Number(v) : null;
  if (v === null) return null;
  return String(v);
}
function checklistFila(r) {
  const datos = r.datos || {};
  return {
    ...datos,
    id: r.id,
    name: r.name || '', assigned: r.assigned || '', assignedUid: r.assigned_uid || null,
    store: r.store || '', date: r.fecha || '', time: r.hora || '',
    status: r.status || 'pendiente',
    enviado: !!r.enviado, eliminado: !!r.eliminado, archivado: !!r.archivado,
    origenTec: !!r.origen_tec, entregaConRetraso: !!r.entrega_con_retraso,
    createdBy: r.created_by || '',
    timestampCreacion: r.timestamp_creacion != null ? Number(r.timestamp_creacion) : null,
    _asignacionId: r.asignacion_id || null, _catalogoRutinaId: r.catalogo_rutina_id || null,
  };
}
async function pgChecklistUpsert(id, obj) {
  const cols = {}, datos = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === 'id') continue;
    const col = CK_MAP[k];
    if (col) cols[col] = v; else datos[k] = v;
  }
  const valores = [String(id), ...CK_COL_LIST.map(c => ckValorCol(c, cols[c])), JSON.stringify(datos)];
  const placeholders = valores.map((_, i) => `$${i + 1}`).join(',');
  const sets = CK_COL_LIST.map(c => `${c}=excluded.${c}`).concat('datos=excluded.datos').join(', ');
  await query(
    `insert into mdtask_checklists (id, ${CK_COL_LIST.join(', ')}, datos)
     values (${placeholders})
     on conflict (id) do update set ${sets}`,
    valores
  );
}
async function pgChecklistsPorFecha(fecha) {
  const r = await query('select * from mdtask_checklists where fecha = $1', [String(fecha)]);
  return r.rows.map(checklistFila);
}

// -- CRUD genérico (catalogo_rutinas / asignaciones_rutinas) (igual que _crud.js) --
function crudFila(r, map, boolCols, numCols) {
  const o = { ...(r.datos || {}), id: r.id };
  for (const [campo, col] of Object.entries(map)) {
    let v = r[col];
    if (boolCols.has(col)) v = !!v;
    else if (numCols.has(col)) v = v != null ? Number(v) : null;
    o[campo] = v;
  }
  return o;
}
async function pgCrudUpsert(tabla, map, boolCols, numCols, id, obj) {
  const COL_LIST = Object.values(map);
  const cols = {}, datos = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === 'id') continue;
    const col = map[k];
    if (col) cols[col] = v; else datos[k] = v;
  }
  const valorCol = (col, v) => {
    if (v === undefined || v === null) return null;
    if (boolCols.has(col)) return !!v;
    if (numCols.has(col)) return Number(v);
    return String(v);
  };
  const valores = [String(id), ...COL_LIST.map(c => valorCol(c, cols[c])), JSON.stringify(datos)];
  const placeholders = valores.map((_, i) => `$${i + 1}`).join(',');
  const sets = COL_LIST.map(c => `${c}=excluded.${c}`).concat('datos=excluded.datos').join(', ');
  await query(
    `insert into ${tabla} (${['id', ...COL_LIST, 'datos'].join(', ')})
     values (${placeholders}) on conflict (id) do update set ${sets}`,
    valores
  );
}
const ASIG_MAP = { catalogoRutinaId: 'catalogo_rutina_id', nombreRutina: 'nombre_rutina', modoAsignacion: 'modo_asignacion', activa: 'activa', creadoEn: 'creado_en' };
async function pgAsignacionesList() {
  const r = await query('select * from mdtask_asignaciones_rutinas order by creado_en desc');
  return r.rows.map(row => crudFila(row, ASIG_MAP, new Set(['activa']), new Set(['creado_en'])));
}

// -- hilo de conversación del bot (mdtask_wa_conversaciones) --
async function pgConversacionGet(id) {
  const r = await query('select * from mdtask_wa_conversaciones where id = $1', [String(id)]);
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  return {
    messages: Array.isArray(row.messages) ? row.messages : [],
    actualizado: row.actualizado != null ? Number(row.actualizado) : 0,
    uid: row.uid || null,
    invitado: row.invitado || null, // identidad de invitado (número no registrado)
  };
}
// Guarda/actualiza SOLO la identidad de invitado del hilo (sin tocar messages).
async function pgConversacionInvitadoSet(id, invitado) {
  await query(
    `insert into mdtask_wa_conversaciones (id, actualizado, messages, invitado)
     values ($1,$2,'[]'::jsonb,$3)
     on conflict (id) do update set invitado=excluded.invitado, actualizado=excluded.actualizado`,
    [String(id), Date.now(), JSON.stringify(invitado || null)]
  );
}
async function pgConversacionSet(id, { messages, uid }) {
  await query(
    `insert into mdtask_wa_conversaciones (id, uid, actualizado, messages)
     values ($1,$2,$3,$4)
     on conflict (id) do update set uid=excluded.uid, actualizado=excluded.actualizado, messages=excluded.messages`,
    [String(id), uid != null ? String(uid) : null, Date.now(), JSON.stringify(Array.isArray(messages) ? messages : [])]
  );
}

// -- FLOTILLA: vehiculos + reservas_vehiculos (mismo mapeo que api/vehiculos.js
//    y api/reservas-vehiculos.js, pero consultando Postgres DIRECTO). OJO: estas
//    dos tablas NO llevan el prefijo mdtask_ (asi estan creadas en 020/021). --
const RES_COLS = ['vehiculo_id', 'usuario_uid', 'desde', 'hasta', 'estatus'];
const RES_MAP = { vehiculoId: 'vehiculo_id', usuarioUid: 'usuario_uid', desde: 'desde', hasta: 'hasta', estatus: 'estatus' };
const RES_NUM = new Set(['desde', 'hasta']);

function vehiculoFila(r) {
  return { id: r.id, nombre: r.nombre || '', sucursal: r.sucursal || '', activo: r.activo !== false, ...(r.datos || {}) };
}
function reservaFila(r) {
  const o = { ...(r.datos || {}), id: r.id };
  o.vehiculoId = r.vehiculo_id;
  o.usuarioUid = r.usuario_uid;
  o.desde = r.desde != null ? Number(r.desde) : null;
  o.hasta = r.hasta != null ? Number(r.hasta) : null;
  o.estatus = r.estatus;
  return o;
}
function resValCol(c, v) { if (v === undefined || v === null) return null; return RES_NUM.has(c) ? Number(v) : String(v); }

async function pgVehiculosList() {
  const r = await query('select * from vehiculos order by nombre asc');
  return r.rows.map(vehiculoFila);
}
async function pgReservasList({ usuarioUid, vehiculoId, estatus } = {}) {
  const conds = [], params = [];
  if (usuarioUid) { params.push(String(usuarioUid)); conds.push(`usuario_uid=$${params.length}`); }
  if (vehiculoId) { params.push(String(vehiculoId)); conds.push(`vehiculo_id=$${params.length}`); }
  if (estatus) { params.push(String(estatus)); conds.push(`estatus=$${params.length}`); }
  const where = conds.length ? 'where ' + conds.join(' and ') : '';
  const r = await query(`select * from reservas_vehiculos ${where} order by desde asc`, params);
  return r.rows.map(reservaFila);
}
async function pgReservaGet(id) {
  const r = await query('select * from reservas_vehiculos where id = $1', [String(id)]);
  return r.rows[0] ? reservaFila(r.rows[0]) : null;
}
// Anti-choque: primera reserva APROBADA del mismo vehiculo que se traslape con
// [desde, hasta) (igual que buscarChoque en reservas-vehiculos.js).
async function pgReservaChoque(vehiculoId, desde, hasta, exceptId) {
  const r = await query(
    `select * from reservas_vehiculos
      where vehiculo_id = $1 and estatus = 'aprobada' and desde < $3 and hasta > $2 and id <> $4
      order by desde asc limit 1`,
    [String(vehiculoId), Number(desde), Number(hasta), String(exceptId || '')]
  );
  return r.rows[0] ? reservaFila(r.rows[0]) : null;
}
// Crea/reemplaza una reserva (datos = jsonb completo, sin merge).
async function pgReservaUpsert(doc) {
  const cols = {}, datos = {};
  for (const [k, v] of Object.entries(doc || {})) { if (k === 'id') continue; const c = RES_MAP[k]; if (c) cols[c] = v; else datos[k] = v; }
  const valores = [String(doc.id), ...RES_COLS.map(c => resValCol(c, cols[c])), JSON.stringify(datos)];
  const ph = valores.map((_, i) => `$${i + 1}`).join(',');
  const sets = RES_COLS.map(c => `${c}=excluded.${c}`).concat('datos=excluded.datos').join(', ');
  const r = await query(
    `insert into reservas_vehiculos (id, ${RES_COLS.join(', ')}, datos) values (${ph})
     on conflict (id) do update set ${sets} returning *`, valores);
  return reservaFila(r.rows[0]);
}
// Merge parcial: mezcla claves de `datos` (una clave con valor null la borra del
// jsonb en la practica: datos->>clave devuelve NULL) y opcionalmente columnas.
async function pgReservaMergeDatos(id, datosChanges, colChanges) {
  const cur = await query('select * from reservas_vehiculos where id = $1', [String(id)]);
  if (cur.rowCount === 0) return null;
  const actual = cur.rows[0];
  const cc = colChanges || {};
  const finalCol = (c) => (c in cc ? resValCol(c, cc[c]) : actual[c]);
  const merged = { ...(actual.datos || {}), ...(datosChanges || {}) };
  const sets = RES_COLS.map((c, i) => `${c}=$${i + 2}`).concat(`datos=$${RES_COLS.length + 2}`).join(', ');
  const valores = [String(id), ...RES_COLS.map(finalCol), JSON.stringify(merged)];
  const r = await query(`update reservas_vehiculos set ${sets} where id=$1 returning *`, valores);
  return reservaFila(r.rows[0]);
}
// Reserva del usuario que quedo ESPERANDO que comparta su ubicacion (salida/regreso).
async function pgReservaEsperandoUbicacion(uid) {
  const r = await query(
    `select * from reservas_vehiculos
      where usuario_uid = $1 and datos->>'esperandoUbicacion' is not null
      order by desde desc limit 1`, [String(uid)]);
  return r.rows[0] ? reservaFila(r.rows[0]) : null;
}
// Finaliza la captura de ubicacion: mueve salidaPendiente/regresoPendiente a
// salida/regreso con el punto compartido y limpia el flag. Lo usa el webhook al
// recibir un mensaje de tipo `location`.
async function registrarUbicacion(uid, ubicacion) {
  const r = await pgReservaEsperandoUbicacion(uid);
  if (!r) return { ok: false, sinPendiente: true };
  const accion = r.esperandoUbicacion; // 'salida' | 'regreso'
  const prev = accion === 'salida' ? r.salidaPendiente : r.regresoPendiente;
  const punto = {
    lat: ubicacion.lat, lng: ubicacion.lng,
    direccion: ubicacion.direccion || ubicacion.nombre || '',
    hora: (prev && prev.hora) || Date.now(),
  };
  const cambios = { esperandoUbicacion: null };
  if (accion === 'salida') { cambios.salida = punto; cambios.salidaPendiente = null; }
  else { cambios.regreso = punto; cambios.regresoPendiente = null; }
  await pgReservaMergeDatos(r.id, cambios);
  return { ok: true, accion, reserva: { id: r.id, vehiculo: r.vehiculoNombre || '', destino: r.destino || '' }, punto };
}

const MAX_ITERACIONES = 8;

const ROLES = ['Cajero', 'Encargado', 'Auxiliar', 'Supervisor', 'Almacenista', 'Limpieza', 'Vendedor', 'Contador'];
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const FRECUENCIAS = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral', 'PorEvento'];
const TIPOS = ['apertura', 'cierre', 'administracion', 'contabilidad', 'operacion'];
const NIVELES = ['obligatorio', 'importante', 'informativo'];

// ---------------------------------------------------------------------------
// TURNOS (Canindo) — misma logica que src/app/shared/turnos.util.ts.
// Si cambias una regla aqui, cambiala alla tambien.
// ---------------------------------------------------------------------------
function aMinTurno(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : NaN;
}
function lunesISOTurno(fechaISO) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const diff = dow === 0 ? 6 : dow - 1;
  dt.setUTCDate(dt.getUTCDate() - diff);
  return dt.toISOString().split('T')[0];
}
function semanasEntreTurno(aISO, bISO) {
  const a = new Date(lunesISOTurno(aISO) + 'T00:00:00Z').getTime();
  const b = new Date(lunesISOTurno(bISO) + 'T00:00:00Z').getTime();
  return Math.round((b - a) / (7 * 24 * 3600 * 1000));
}
// "Ahora" en hora de Mexico (Railway corre en UTC).
function ahoraMexico() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  return { fechaISO: `${p.year}-${p.month}-${p.day}`, minutos: parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10) };
}
function grupoBaseTurno(config, uid) {
  if (!config || !uid) return null;
  if ((config.grupoManana || []).some(m => m.uid === uid)) return 'manana';
  if ((config.grupoTarde || []).some(m => m.uid === uid)) return 'tarde';
  return null;
}
function excepcionActivaTurno(config, uid, diaISO) {
  if (!config || !config.excepciones) return null;
  return config.excepciones.find(e => e.uid === uid && e.desde <= diaISO && diaISO <= e.hasta) || null;
}
function turnoEfectivoTurno(config, uid, diaISO) {
  const base = grupoBaseTurno(config, uid);
  if (base === null) return null;
  const exc = excepcionActivaTurno(config, uid, diaISO);
  if (exc) return exc.turno;
  if (config.rotacionAutomatica) {
    const semanas = semanasEntreTurno(config.semanaBase, diaISO);
    if ((((semanas % 2) + 2) % 2) === 1) return base === 'manana' ? 'tarde' : 'manana';
  }
  return base;
}
/** Evalua si a `uid` se le puede asignar AHORA. { restringido, permitido, turno }. */
function evaluarTurno(config, uid) {
  if (!config || !config.habilitado) return { restringido: false, permitido: true, turno: null };
  const { fechaISO, minutos } = ahoraMexico();
  const turno = turnoEfectivoTurno(config, uid, fechaISO);
  if (turno === null) return { restringido: false, permitido: true, turno: null };
  const h = (config.horarios || {})[turno] || {};
  const ini = aMinTurno(h.inicio), fin = aMinTurno(h.fin);
  const dentro = !isNaN(ini) && !isNaN(fin) && minutos >= ini && minutos <= fin;
  return { restringido: true, permitido: dentro, turno };
}

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------
const TOOLS = [
  // --- TAREAS (agenda: solo consultar/editar; la CREACION ahora es crear_checklist) ---
  {
    name: 'consultar_tareas',
    description: 'Consulta tareas. Por defecto las tuyas; con "persona" puedes ver las de cualquier trabajador (admin). Usala ANTES de completar/editar/eliminar para conocer el id.',
    input_schema: {
      type: 'object',
      properties: {
        filtro: { type: 'string', enum: ['hoy', 'pendientes', 'vencidas', 'todas'] },
        fecha: { type: 'string' },
        persona: { type: 'string', description: 'Nombre de otra persona para ver SUS tareas. Vacio = las tuyas.' }
      },
      required: []
    }
  },
  { name: 'completar_tarea', description: 'Marca una tarea como completada. Requiere id (de consultar_tareas).', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'editar_tarea', description: 'Modifica una tarea. Requiere id. Solo manda lo que cambia.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, titulo: { type: 'string' }, fecha: { type: 'string' }, hora_inicio: { type: 'string' }, fecha_fin: { type: 'string' }, hora_fin: { type: 'string' }, prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] }, instrucciones: { type: 'string' } }, required: ['id'] }
  },
  { name: 'eliminar_tarea', description: 'Elimina una tarea. Requiere id (de consultar_tareas).', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },

  // --- CHECKLIST ---
  {
    name: 'crear_checklist',
    description: 'Crea un CHECKLIST operativo (lista de tareas por sucursal, ej. checklist de cierre/limpieza) para una persona en una sucursal y fecha. Distinto de agregar_tarea (pendiente personal en la agenda). Pide sucursal e items si faltan.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre del checklist.' },
        para_quien: { type: 'string', description: 'Persona responsable (nombre).' },
        sucursal: { type: 'string', description: 'Sucursal (store).' },
        fecha: { type: 'string', description: 'YYYY-MM-DD. Por defecto hoy.' },
        hora_limite: { type: 'string', description: 'HH:mm limite general. Opcional.' },
        items: {
          type: 'array',
          description: 'Tareas del checklist (al menos una).',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Descripcion de la tarea.' },
              tipo: { type: 'string', enum: ['manual', 'rutina'], description: 'manual = tarea suelta; rutina = recurrente.' },
              frecuencia: { type: 'string', enum: FRECUENCIAS, description: 'Solo si tipo=rutina.' },
              dia_semana: { type: 'string', enum: DIAS, description: 'Solo si rutina semanal.' },
              requiere_foto: { type: 'boolean', description: 'Si pide foto de evidencia.' },
              hora_inicio: { type: 'string', description: 'HH:mm opcional.' },
              hora_limite: { type: 'string', description: 'HH:mm opcional.' }
            },
            required: ['text']
          }
        }
      },
      required: ['nombre', 'para_quien', 'sucursal', 'items']
    }
  },

  // --- RUTINAS ---
  {
    name: 'crear_rutina',
    description: 'Crea una rutina recurrente (ej. "todos los lunes y miercoles hacer inventario a las 8am"). Crea la plantilla y la asignacion para que el sistema genere los checklists. Pregunta lo que falte (sucursales y a quien) antes de crear.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre de la rutina.' },
        frecuencia: { type: 'string', enum: FRECUENCIAS, description: 'Diaria, Semanal, Catorcenal, Mensual, Trimestral o PorEvento.' },
        dias_semana: { type: 'array', items: { type: 'string', enum: DIAS }, description: 'Dias (para Semanal/Catorcenal). Ej: ["Lunes","Miércoles"].' },
        dia_mes: { type: 'integer', description: 'Dia del mes (1-31) para Mensual/Trimestral.' },
        hora_inicio: { type: 'string', description: 'HH:mm' },
        hora_limite: { type: 'string', description: 'HH:mm' },
        tipo: { type: 'string', enum: TIPOS, description: 'Tipo de rutina. Por defecto operacion.' },
        nivel_critico: { type: 'string', enum: NIVELES, description: 'Por defecto importante.' },
        sucursales: { type: 'array', items: { type: 'string' }, description: 'Sucursales donde aplica. Usa "todas" para todas las permitidas.' },
        modo: { type: 'string', enum: ['porRol', 'porPersonas'], description: 'Como se asigna.' },
        rol_objetivo: { type: 'string', enum: ROLES, description: 'Si modo=porRol.' },
        personas: { type: 'array', items: { type: 'string' }, description: 'Nombres, si modo=porPersonas.' },
        tareas: { type: 'array', items: { type: 'string' }, description: 'Lista de pasos/tareas del checklist. Opcional.' }
      },
      required: ['nombre', 'frecuencia', 'sucursales', 'modo']
    }
  },

  // --- INFO ---
  {
    name: 'consultar_rutinas',
    description: 'Lista las rutinas activas (asignadas). Usala cuando pregunten que rutinas hay activas o programadas.',
    input_schema: { type: 'object', properties: { sucursal: { type: 'string', description: 'Filtrar por una sucursal. Opcional.' } }, required: [] }
  },
  {
    name: 'resumen_hoy',
    description: 'Da un resumen del dia del usuario: cuantas tareas pendientes tiene para hoy y cuales.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'estadisticas',
    description: 'Estadisticas (admin: acceso a TODO). Cumplimiento de checklists por SUCURSAL o de TODA la operacion en un dia (completados, pendientes, % cumplimiento). Tambien estadisticas personales de tus tareas.',
    input_schema: {
      type: 'object',
      properties: {
        sucursal: { type: 'string', description: 'Sucursal para el cumplimiento de checklists. Vacio = toda la operacion.' },
        fecha: { type: 'string', description: 'YYYY-MM-DD de los checklists. Por defecto hoy.' },
        dias: { type: 'integer', description: 'Ventana en dias para TUS tareas completadas (por defecto 7).' }
      },
      required: []
    }
  },

  // --- INVITADOS (números no registrados) ---
  {
    name: 'identificar_invitado',
    description: 'Guarda el NOMBRE y APELLIDO de una persona que NO está registrada en el sistema, para poder atenderla como invitada. Úsala SOLO cuando el usuario es invitado y te da su nombre completo.',
    input_schema: { type: 'object', properties: { nombre: { type: 'string', description: 'Nombre y apellido completos.' } }, required: ['nombre'] }
  },

  // --- FLOTILLA (vehiculos) ---
  {
    name: 'consultar_vehiculos',
    description: 'Lista los vehiculos de la empresa y su estado AHORA (libre o en uso, por quien, y proximas reservas). Usala cuando pregunten que coches hay o cuales estan disponibles.',
    input_schema: { type: 'object', properties: { sucursal: { type: 'string', description: 'Filtrar por sucursal. Opcional.' } }, required: [] }
  },
  {
    name: 'apartar_vehiculo',
    description: 'Aparta (reserva) un vehiculo en un rango de horas. Crea una solicitud PENDIENTE que un encargado debe aprobar. CONFIRMA los datos antes de llamarla.',
    input_schema: {
      type: 'object',
      properties: {
        vehiculo: { type: 'string', description: 'Nombre del vehiculo (ej. "Nissan NP300 blanca").' },
        fecha: { type: 'string', description: 'YYYY-MM-DD de la salida. Por defecto hoy.' },
        hora_salida: { type: 'string', description: 'HH:mm de salida.' },
        hora_regreso: { type: 'string', description: 'HH:mm de regreso.' },
        fecha_regreso: { type: 'string', description: 'YYYY-MM-DD del regreso si es otro dia. Por defecto igual a fecha.' },
        destino: { type: 'string', description: 'A donde va. Opcional pero recomendado.' },
        motivo: { type: 'string', description: 'Motivo del uso. Opcional.' }
      },
      required: ['vehiculo', 'hora_salida', 'hora_regreso']
    }
  },
  {
    name: 'consultar_mis_reservas',
    description: 'Muestra MIS reservas de vehiculos (pendientes, aprobadas y las que tengo en uso). Usala antes de cancelar para conocer el id.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'cancelar_reserva',
    description: 'Cancela una reserva de vehiculo. Requiere id (de consultar_mis_reservas). Solo puedes cancelar las tuyas.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'registrar_salida',
    description: 'Registra que el usuario YA VA A SALIR con un vehiculo que tiene APROBADO ("ya voy a usar el coche", "voy a salir con la camioneta"). El sistema le pedira su UBICACION para dejar registrada la salida. Si tiene varias reservas aprobadas, pasa "vehiculo".',
    input_schema: { type: 'object', properties: { vehiculo: { type: 'string', description: 'Nombre del vehiculo, si tiene varios apartados.' } }, required: [] }
  },
  {
    name: 'registrar_regreso',
    description: 'Registra que el usuario YA REGRESO / entrego un vehiculo que tiene en uso ("ya lo entregue", "ya regrese el coche"). El sistema le pedira su UBICACION de regreso y cierra el uso.',
    input_schema: { type: 'object', properties: { vehiculo: { type: 'string', description: 'Nombre del vehiculo, si tiene varios en uso.' } }, required: [] }
  },
  {
    name: 'reservas_pendientes',
    description: 'ADMIN: lista las solicitudes de vehiculos PENDIENTES de aprobar. Usala antes de aprobar/rechazar para conocer el id.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'aprobar_reserva',
    description: 'ADMIN: aprueba o rechaza una solicitud de vehiculo. Requiere id (de reservas_pendientes). aprobar=false para rechazar.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, aprobar: { type: 'boolean', description: 'true=aprobar (por defecto), false=rechazar.' }, motivo: { type: 'string', description: 'Motivo del rechazo. Opcional.' } }, required: ['id'] }
  }
];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function normaliza(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
function esAdminGlobal(perfil) {
  const alc = (perfil.alcance || '').toLowerCase();
  return perfil.rol === 'admin' && (alc === 'global' || alc === '' || (perfil.sucursales || []).includes('General (Acceso Total)'));
}
function sucursalesDe(u) {
  return u.sucursales || (u.sucursal ? [u.sucursal] : []);
}
// Sucursales a las que este admin puede asignar.
function sucursalesPermitidas(ctx) {
  if (esAdminGlobal(ctx.perfil)) {
    const set = new Set();
    ctx.usuarios.forEach(u => sucursalesDe(u).forEach(s => { if (s) set.add(s); }));
    return Array.from(set);
  }
  return sucursalesDe(ctx.perfil).filter(s => s && s !== 'General (Acceso Total)');
}
// Distancia de edicion (para tolerar errores de dictado/tipeo).
function levenshtein(a, b) {
  a = a || ''; b = b || '';
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const fila = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = fila[0]; fila[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return fila[n];
}
// ¿Dos palabras se parecen? (tolera 1-2 letras de diferencia segun el largo).
function palabrasParecidas(a, b) {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  const tol = Math.max(a.length, b.length) >= 6 ? 2 : 1;
  return levenshtein(a, b) <= tol;
}

// Empareja un nombre dictado con un usuario. Devuelve { user, ambiguos }:
//   - user: el usuario si hay UN match claro; null si no.
//   - ambiguos: candidatos cuando hay varios (para que el bot PREGUNTE cual).
// Es estricto para no asignar al equivocado, pero tolera errores de dictado.
function resolverPersona(ctx, nombre) {
  const objetivo = normaliza(nombre);
  if (!objetivo) return { user: null, ambiguos: [] };
  const nombreDe = u => u.nombre || u.correo || '';
  const palabras = objetivo.split(/\s+/).filter(Boolean);

  // 1) Match exacto del nombre completo.
  const exacto = ctx.usuarios.find(u => normaliza(nombreDe(u)) === objetivo);
  if (exacto) return { user: exacto, ambiguos: [] };

  // 2) Match fuerte: el nombre contiene lo dictado (o viceversa), o coinciden
  //    al menos 2 palabras exactas (tipo nombre + apellido).
  const fuertes = ctx.usuarios.filter(u => {
    const n = normaliza(nombreDe(u));
    if (!n) return false;
    if (n.includes(objetivo) || objetivo.includes(n)) return true;
    const set = new Set(n.split(/\s+/));
    return palabras.filter(p => set.has(p)).length >= 2;
  });
  if (fuertes.length === 1) return { user: fuertes[0], ambiguos: [] };
  if (fuertes.length > 1) return { user: null, ambiguos: fuertes.map(nombreDe) };

  // 3) Fuzzy: tolera errores de dictado ("Fransisco" ~ "Francisco"). Cuenta
  //    cuantas palabras dictadas se parecen a alguna palabra del nombre.
  const puntajes = ctx.usuarios.map(u => {
    const tokens = normaliza(nombreDe(u)).split(/\s+/).filter(Boolean);
    let pts = 0;
    for (const p of palabras) if (tokens.some(t => palabrasParecidas(p, t))) pts++;
    return { u, pts };
  });
  const minPts = palabras.length >= 2 ? 2 : 1; // si dictan 2+ palabras, exige 2
  const candidatos = puntajes.filter(c => c.pts >= minPts).sort((a, b) => b.pts - a.pts);
  if (candidatos.length === 1) return { user: candidatos[0].u, ambiguos: [] };
  if (candidatos.length > 1) {
    // Ganador claro por puntaje -> proponerlo (la confirmacion lo valida);
    // empate -> devolver candidatos para que el bot pregunte.
    if (candidatos[0].pts > candidatos[1].pts) return { user: candidatos[0].u, ambiguos: [] };
    return { user: null, ambiguos: candidatos.slice(0, 6).map(c => nombreDe(c.u)) };
  }

  return { user: null, ambiguos: [] };
}

// Personal al que el admin puede asignar (dentro de sus privilegios/sucursales),
// opcionalmente filtrado por sucursal y/o rol(cargo).
function personalAsignable(ctx, opts) {
  opts = opts || {};
  const permitidas = sucursalesPermitidas(ctx);
  const global = esAdminGlobal(ctx.perfil);
  const sNorm = opts.sucursal ? normaliza(opts.sucursal) : null;
  const rNorm = opts.rol ? normaliza(opts.rol) : null;
  return ctx.usuarios.filter(u => {
    if (u.rol !== 'trabajador' && u.rol !== 'admin') return false;
    if (u.id === ctx.uid) return false; // no a uno mismo
    const sus = sucursalesDe(u);
    const enScope = global || sus.some(s => permitidas.some(p => normaliza(p) === normaliza(s)));
    if (!enScope) return false;
    if (sNorm && !sus.some(s => { const x = normaliza(s); return x === sNorm || x.includes(sNorm) || sNorm.includes(x); })) return false;
    if (rNorm && !normaliza(u.cargo || '').includes(rNorm)) return false;
    return true;
  });
}

// Nombre legible de un usuario por su uid (usa la lista ya cargada en ctx).
function nombreUsuario(ctx, uid) {
  const u = (ctx.usuarios || []).find(x => x.id === uid || x.uid === uid);
  return u ? (u.nombre || u.correo || 'alguien') : 'alguien';
}
// Empareja un nombre dictado con un vehiculo del catalogo. { vehiculo, ambiguos }.
function resolverVehiculo(vehiculos, nombre) {
  const objetivo = normaliza(nombre);
  if (!objetivo) return { vehiculo: null, ambiguos: [] };
  const exacto = vehiculos.find(v => normaliza(v.nombre) === objetivo);
  if (exacto) return { vehiculo: exacto, ambiguos: [] };
  const contiene = vehiculos.filter(v => { const n = normaliza(v.nombre); return n && (n.includes(objetivo) || objetivo.includes(n)); });
  if (contiene.length === 1) return { vehiculo: contiene[0], ambiguos: [] };
  if (contiene.length > 1) return { vehiculo: null, ambiguos: contiene.map(v => v.nombre) };
  const palabras = objetivo.split(/\s+/).filter(Boolean);
  const cand = vehiculos.filter(v => { const toks = normaliza(v.nombre).split(/\s+/); return palabras.some(p => toks.some(t => palabrasParecidas(p, t))); });
  if (cand.length === 1) return { vehiculo: cand[0], ambiguos: [] };
  if (cand.length > 1) return { vehiculo: null, ambiguos: cand.map(v => v.nombre) };
  return { vehiculo: null, ambiguos: [] };
}
// fecha (YYYY-MM-DD) + hora (HH:mm) en hora de Mexico -> epoch ms.
// Mexico ya no aplica horario de verano (UTC-6 todo el ano) => offset fijo.
function epochDeMx(fecha, hora) {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha || '').trim());
  const h = /^(\d{1,2}):(\d{2})$/.exec(String(hora || '').trim());
  if (!f || !h) return null;
  const iso = `${f[1]}-${f[2]}-${f[3]}T${String(h[1]).padStart(2, '0')}:${h[2]}:00-06:00`;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : t;
}
function fmtMx(epoch) {
  if (epoch == null) return '';
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(Number(epoch)));
}
function fmtHoraMx(epoch) {
  if (epoch == null) return '';
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' }).format(new Date(Number(epoch)));
}

// ---------------------------------------------------------------------------
// Ejecutores
// ---------------------------------------------------------------------------
async function ejecutarHerramienta(db, ctx, nombre, input) {
  input = input || {};

  // ---- INVITADO (número no registrado): solo flotilla, y solo tras identificarse ----
  if (ctx.esInvitado) {
    const PERMITIDAS_INVITADO = new Set([
      'identificar_invitado', 'consultar_vehiculos', 'apartar_vehiculo',
      'consultar_mis_reservas', 'cancelar_reserva', 'registrar_salida', 'registrar_regreso',
    ]);
    if (!ctx.invitadoNombre && nombre !== 'identificar_invitado') {
      return { ok: false, mensaje: 'Antes de continuar necesito tu *nombre y apellido*. ¿Cómo te llamas?' };
    }
    if (!PERMITIDAS_INVITADO.has(nombre)) {
      return { ok: false, mensaje: 'Como invitado solo puedo ayudarte con los *vehículos*: ver coches, apartar y registrar salida/regreso. Lo demás es solo para personal de MD Task.' };
    }
  }

  if (nombre === 'identificar_invitado') {
    if (!ctx.esInvitado) return { ok: false, mensaje: 'Ya estás identificado.' };
    const n = String(input.nombre || '').trim().replace(/\s+/g, ' ');
    const palabras = n.split(' ').filter(w => (w.match(/\p{L}/gu) || []).length >= 2);
    if (n.length < 3 || palabras.length < 2) {
      return { ok: false, mensaje: 'Necesito tu *nombre y apellido* completos para poder ayudarte. ¿Cómo te llamas?' };
    }
    if (ctx.convKey) await pgConversacionInvitadoSet(ctx.convKey, { nombre: n, telefono: ctx.telefono || '', identificadoEn: Date.now() });
    ctx.invitadoNombre = n; ctx.nombre = n; // ya identificado en esta misma conversación
    return { ok: true, invitado_nombre: n, mensaje: `Gracias, ${n}. Ya te puedo ayudar con los vehículos 🚗.` };
  }

  // ---- TAREAS ----
  if (nombre === 'agregar_tarea') {
    const titulo = String(input.titulo || '').trim();
    if (!titulo) return { ok: false, mensaje: 'Falta el titulo de la tarea.' };
    const construirDoc = (asignadaPor) => ({
      texto: titulo, completada: false, fechaCreacion: Date.now(),
      fecha: input.fecha || '', fechaInicio: input.fecha || '', horaInicio: input.hora_inicio || '',
      fechaFin: input.fecha_fin || '', horaFin: input.hora_fin || '', prioridad: input.prioridad || '',
      instrucciones: '', comentarios: '', adjunto: null, creadaPorVoz: true,
      ...(asignadaPor ? { asignadaPor } : {})
    });

    // Asignacion en GRUPO (sucursal, rol o todos)
    if (input.para_todos || input.para_sucursal || input.para_rol) {
      if (!ctx.esAdmin) return { ok: false, mensaje: 'Solo los administradores pueden asignar a varias personas.' };
      const rol = input.para_rol ? (ROLES.find(r => normaliza(r) === normaliza(input.para_rol)) || input.para_rol) : null;
      const destinatarios = personalAsignable(ctx, { sucursal: input.para_sucursal, rol });
      if (destinatarios.length === 0) return { ok: false, mensaje: 'No encontre personal que coincida con ese grupo en tus sucursales.' };
      for (const u of destinatarios) await pgAgendaAdd(u.id, construirDoc(ctx.nombre));
      const partes = [];
      if (input.para_todos) partes.push('todo tu personal');
      if (rol) partes.push('rol ' + rol);
      if (input.para_sucursal) partes.push('sucursal ' + input.para_sucursal);
      return { ok: true, total: destinatarios.length, mensaje: `Tarea asignada a ${destinatarios.length} persona(s) (${partes.join(', ')}).` };
    }

    // Una sola persona (o uno mismo)
    let uidDestino = ctx.uid, etiqueta = 'tu agenda';
    if (input.para_quien) {
      const r = resolverPersona(ctx, input.para_quien);
      if (!r.user) {
        if (r.ambiguos.length) return { ok: false, mensaje: `Hay varias personas que coinciden con "${input.para_quien}": ${r.ambiguos.slice(0, 6).join(', ')}. ¿A cuál te refieres? Dime el nombre completo.` };
        return { ok: false, mensaje: `No encontre a "${input.para_quien}" en el personal. Verifica el nombre.` };
      }
      uidDestino = r.user.id; etiqueta = r.user.nombre || r.user.correo;
    }
    const nuevoId = await pgAgendaAdd(uidDestino, construirDoc(uidDestino !== ctx.uid ? ctx.nombre : null));
    return { ok: true, id: nuevoId, mensaje: `Tarea creada en ${etiqueta}.` };
  }

  if (nombre === 'consultar_tareas') {
    const filtro = input.filtro || 'pendientes', hoy = ctx.fechaHoy;
    let uidConsulta = ctx.uid;
    if (input.persona) {
      const r = resolverPersona(ctx, input.persona);
      if (!r.user) {
        if (r.ambiguos.length) return { ok: false, mensaje: `Hay varias personas que coinciden con "${input.persona}": ${r.ambiguos.slice(0, 6).join(', ')}. Dime el nombre completo.` };
        return { ok: false, mensaje: `No encontre a "${input.persona}" en el personal.` };
      }
      uidConsulta = r.user.id;
    }
    let lista = await pgAgendaList(uidConsulta);
    if (filtro === 'hoy') lista = lista.filter(t => !t.completada && t.fecha === hoy);
    else if (filtro === 'vencidas') lista = lista.filter(t => !t.completada && t.fecha && t.fecha < hoy);
    else if (filtro === 'todas') { /* todas */ }
    else if (input.fecha) lista = lista.filter(t => !t.completada && t.fecha === input.fecha);
    else lista = lista.filter(t => !t.completada);
    return { ok: true, total: lista.length, tareas: lista.map(t => ({ id: t.id, titulo: t.texto, fecha: t.fecha || '', hora_inicio: t.horaInicio || '', prioridad: t.prioridad || '', completada: !!t.completada })) };
  }

  if (nombre === 'completar_tarea') {
    if (!input.id) return { ok: false, mensaje: 'Falta el id.' };
    const ok = await pgAgendaUpdate(input.id, ctx.uid, { completada: true, completada_en: Date.now() }, {});
    if (!ok) return { ok: false, mensaje: 'No encontre esa tarea en tu agenda.' };
    return { ok: true, mensaje: 'Tarea completada.' };
  }

  if (nombre === 'editar_tarea') {
    if (!input.id) return { ok: false, mensaje: 'Falta el id.' };
    const cols = {}, datos = {};
    if (input.titulo != null) cols.texto = input.titulo;
    if (input.fecha != null) { cols.fecha = input.fecha; datos.fechaInicio = input.fecha; }
    if (input.hora_inicio != null) datos.horaInicio = input.hora_inicio;
    if (input.fecha_fin != null) datos.fechaFin = input.fecha_fin;
    if (input.hora_fin != null) datos.horaFin = input.hora_fin;
    if (input.prioridad != null) cols.prioridad = input.prioridad;
    if (input.instrucciones != null) datos.instrucciones = input.instrucciones;
    if (!Object.keys(cols).length && !Object.keys(datos).length) return { ok: false, mensaje: 'No indicaste que cambiar.' };
    const ok = await pgAgendaUpdate(input.id, ctx.uid, cols, datos);
    if (!ok) return { ok: false, mensaje: 'No encontre esa tarea en tu agenda.' };
    return { ok: true, mensaje: 'Tarea actualizada.' };
  }

  if (nombre === 'eliminar_tarea') {
    if (!input.id) return { ok: false, mensaje: 'Falta el id.' };
    const ok = await pgAgendaDelete(input.id, ctx.uid);
    if (!ok) return { ok: false, mensaje: 'No encontre esa tarea en tu agenda.' };
    return { ok: true, mensaje: 'Tarea eliminada.' };
  }

  // ---- CHECKLIST ----
  if (nombre === 'crear_checklist') {
    if (!ctx.esAdmin) return { ok: false, mensaje: 'Solo los administradores pueden crear checklists.' };
    const nombreCk = String(input.nombre || '').trim();
    if (!nombreCk) return { ok: false, mensaje: 'Falta el nombre del checklist.' };

    // Persona responsable
    const r = resolverPersona(ctx, input.para_quien);
    if (!r.user) {
      if (r.ambiguos.length) return { ok: false, mensaje: `Hay varias personas que coinciden con "${input.para_quien}": ${r.ambiguos.slice(0, 6).join(', ')}. ¿A cuál?` };
      return { ok: false, mensaje: `No encontre a "${input.para_quien}" en el personal.` };
    }

    // Restriccion de TURNO: no asignar a alguien fuera de su turno.
    const evT = evaluarTurno(ctx.configTurnos, r.user.id);
    if (evT.restringido && !evT.permitido) {
      return { ok: false, mensaje: `${r.user.nombre} esta fuera de su turno (${evT.turno}) en este momento, no se le puede asignar la tarea. Si por necesidad de la empresa debe trabajar en otro turno, un admin de Canindo puede registrar una excepcion en la pantalla de Turnos.` };
    }

    // Sucursal valida
    const permitidas = sucursalesPermitidas(ctx);
    const s = normaliza(input.sucursal);
    const store = permitidas.find(p => normaliza(p) === s) || permitidas.find(p => normaliza(p).includes(s) || s.includes(normaliza(p)));
    if (!store) return { ok: false, mensaje: 'Sucursal no valida. Disponibles: ' + permitidas.join(', ') };

    // Items
    const itemsIn = Array.isArray(input.items) ? input.items.filter(it => it && it.text) : [];
    if (itemsIn.length === 0) return { ok: false, mensaje: 'Faltan los items (tareas) del checklist.' };

    const ahora = Date.now();
    const items = itemsIn.map((it, idx) => {
      const esRutina = it.tipo === 'rutina';
      return {
        id: ahora + idx,
        text: String(it.text),
        checked: false,
        tipo: esRutina ? 'rutina' : 'manual',
        requiresPhoto: !!it.requiere_foto,
        requiresAntesDespues: false,
        requiresVariasFotos: false,
        permiteGaleria: false,
        permiteDocumentos: false,
        horaInicio: it.hora_inicio || null,
        horaLimite: it.hora_limite || input.hora_limite || null,
        frecuencia: esRutina ? (FRECUENCIAS.includes(it.frecuencia) ? it.frecuencia : 'Diaria') : null,
        diaSemana: esRutina && DIAS.includes(it.dia_semana) ? it.dia_semana : null,
        diaMes: null,
        fechaInicio: null, fechaFin: null, tiempoEstimado: null,
        photo: null, photoTime: null, photoAntes: null, photoAntesTime: null,
        photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null, photos: []
      };
    });

    const id = String(ahora);
    const fecha = input.fecha || ctx.fechaHoy || '';
    const assigned = r.user.nombre || r.user.correo;
    const checklist = {
      id: ahora, timestampCreacion: ahora, name: nombreCk,
      assigned, store, date: fecha,
      time: input.hora_limite || '23:59', status: 'pendiente', enviado: false,
      createdBy: ctx.nombre, notaEmpleado: '', items, subtareas: []
    };
    await pgChecklistUpsert(id, checklist);

    // WhatsApp: enlace wa.me con mensaje listo (el admin lo envia con un toque).
    let tel = String(r.user.telefono || '').replace(/[^\d]/g, '');
    if (tel.length === 10) tel = '52' + tel;   // Mexico: agrega lada si falta
    const appUrl = process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '');
    const textoWA = `Hola ${assigned}, te asignaron el checklist "${nombreCk}"${fecha ? ' para el ' + fecha : ''} en ${store}.\n`
      + items.map(i => '- ' + i.text).join('\n')
      + (appUrl ? `\n\nEntra a la app: ${appUrl}` : '');
    const whatsapp = tel ? { telefono: tel, nombre: assigned, texto: textoWA } : null;

    return {
      ok: true, id, whatsapp,
      mensaje: `Checklist "${nombreCk}" creado para ${assigned} en ${store} el ${fecha} con ${items.length} tarea(s).`
        + (whatsapp ? '' : ' (Nota: esa persona no tiene telefono registrado, no podre ofrecer el WhatsApp.)')
    };
  }

  // ---- RUTINAS ----
  if (nombre === 'crear_rutina') {
    if (ctx.perfil.rol !== 'admin') return { ok: false, mensaje: 'Solo los administradores pueden crear rutinas.' };
    const nombreR = String(input.nombre || '').trim();
    if (!nombreR) return { ok: false, mensaje: 'Falta el nombre de la rutina.' };
    const frecuencia = FRECUENCIAS.includes(input.frecuencia) ? input.frecuencia : 'Diaria';

    // Sucursales (resolver "todas")
    const permitidas = sucursalesPermitidas(ctx);
    let sucursales = Array.isArray(input.sucursales) ? input.sucursales : [];
    if (sucursales.some(s => normaliza(s) === 'todas') || sucursales.length === 0) sucursales = permitidas;
    // Conservar solo las permitidas (match flexible)
    sucursales = sucursales.filter(s => permitidas.some(p => normaliza(p) === normaliza(s)))
      .map(s => permitidas.find(p => normaliza(p) === normaliza(s)) || s);
    sucursales = Array.from(new Set(sucursales));
    if (sucursales.length === 0) return { ok: false, mensaje: 'No identifique sucursales validas. Sucursales disponibles: ' + permitidas.join(', ') };

    const modo = input.modo === 'porPersonas' ? 'porPersonas' : 'porRol';
    let rolObjetivo = '', empleadosNombres = [];
    if (modo === 'porRol') {
      rolObjetivo = ROLES.find(r => normaliza(r) === normaliza(input.rol_objetivo)) || input.rol_objetivo || 'Encargado';
    } else {
      const nombres = Array.isArray(input.personas) ? input.personas : [];
      if (nombres.length === 0) return { ok: false, mensaje: 'No indicaste a que personas asignar la rutina.' };
      for (const n of nombres) {
        const r = resolverPersona(ctx, n);
        if (!r.user) {
          if (r.ambiguos.length) return { ok: false, mensaje: `Hay varias personas que coinciden con "${n}": ${r.ambiguos.slice(0, 6).join(', ')}. Dime el nombre completo.` };
          return { ok: false, mensaje: `No encontre a "${n}" en el personal.` };
        }
        empleadosNombres.push(r.user.nombre || r.user.correo);
      }
    }

    const dias = Array.isArray(input.dias_semana) ? input.dias_semana.filter(d => DIAS.includes(d)) : [];
    const ahora = Date.now();

    // 1) Plantilla en el catalogo
    const tareasTxt = Array.isArray(input.tareas) && input.tareas.length ? input.tareas : [nombreR];
    const catId = crypto.randomUUID();
    await pgCrudUpsert('mdtask_catalogo_rutinas',
      { nombre: 'nombre', tipo: 'tipo', frecuencia: 'frecuencia', activa: 'activa', creadoPor: 'creado_por', creadoEn: 'creado_en' },
      new Set(['activa']), new Set(['creado_en']), catId, {
        id: catId, nombre: nombreR,
        tipo: TIPOS.includes(input.tipo) ? input.tipo : 'operacion',
        descripcion: '',
        frecuencia,
        diaSemana: dias[0] || '',
        diaMes: input.dia_mes || null,
        horaInicio: input.hora_inicio || '', horaLimite: input.hora_limite || '',
        responsableSugerido: rolObjetivo || 'Encargado',
        nivelCritico: NIVELES.includes(input.nivel_critico) ? input.nivel_critico : 'importante',
        tareas: tareasTxt.map((t, i) => ({
          id: 't' + i + '_' + ahora, text: String(t),
          requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
          permiteGaleria: true, permiteDocumentos: true
        })),
        activa: true, creadoPor: ctx.nombre, creadoEn: ahora
      });

    // 2) Asignacion(es). Para Semanal/Catorcenal con varios dias, una por dia.
    const base = {
      catalogoRutinaId: catId, nombreRutina: nombreR,
      sucursales, modoAsignacion: modo, frecuencia,
      horaInicio: input.hora_inicio || '', horaLimite: input.hora_limite || '',
      fechaInicio: ctx.fechaHoy || '', fechaFin: null,
      activa: true, creadoPor: ctx.nombre, creadoEn: ahora
    };
    if (modo === 'porRol') base.rolObjetivo = rolObjetivo; else base.empleadosNombres = empleadosNombres;
    if (frecuencia === 'Mensual' || frecuencia === 'Trimestral') base.diaMes = input.dia_mes || 1;

    const crearAsignacion = async (extra) => {
      const aid = crypto.randomUUID();
      await pgCrudUpsert('mdtask_asignaciones_rutinas', ASIG_MAP,
        new Set(['activa']), new Set(['creado_en']), aid, { id: aid, ...base, ...extra });
    };
    let creadas = 0;
    if ((frecuencia === 'Semanal' || frecuencia === 'Catorcenal') && dias.length) {
      for (const d of dias) { await crearAsignacion({ diaSemana: d }); creadas++; }
    } else {
      const extra = (frecuencia === 'Semanal' || frecuencia === 'Catorcenal') ? { diaSemana: dias[0] || 'Lunes' } : {};
      await crearAsignacion(extra); creadas++;
    }

    const aQuien = modo === 'porRol' ? `rol ${rolObjetivo}` : empleadosNombres.join(', ');
    return { ok: true, mensaje: `Rutina "${nombreR}" creada (${frecuencia}${dias.length ? ' ' + dias.join(', ') : ''}) para ${aQuien} en ${sucursales.join(', ')}.` };
  }

  // ---- INFO ----
  if (nombre === 'consultar_rutinas') {
    let lista = (await pgAsignacionesList()).filter(a => a.activa !== false);
    if (input.sucursal) lista = lista.filter(a => (a.sucursales || []).some(s => normaliza(s) === normaliza(input.sucursal)));
    return {
      ok: true, total: lista.length,
      rutinas: lista.slice(0, 40).map(a => ({
        nombre: a.nombreRutina, frecuencia: a.frecuencia, dia: a.diaSemana || a.diaMes || '',
        asignado: a.modoAsignacion === 'porRol' ? ('rol ' + (a.rolObjetivo || '')) : (a.empleadosNombres || []).join(', '),
        sucursales: a.sucursales || []
      }))
    };
  }

  if (nombre === 'resumen_hoy') {
    const hoy = ctx.fechaHoy;
    const todas = await pgAgendaList(ctx.uid);
    const deHoy = todas.filter(t => !t.completada && t.fecha === hoy);
    const vencidas = todas.filter(t => !t.completada && t.fecha && t.fecha < hoy);
    return {
      ok: true,
      pendientes_hoy: deHoy.length, vencidas: vencidas.length,
      tareas_hoy: deHoy.map(t => t.texto), tareas_vencidas: vencidas.map(t => t.texto)
    };
  }

  if (nombre === 'estadisticas') {
    // Cumplimiento de checklists del dia (por sucursal o toda la operacion).
    let checklists = null;
    const fecha = input.fecha || ctx.fechaHoy;
    if (fecha) {
      let docs = (await pgChecklistsPorFecha(fecha)).filter(c => !c.eliminado && !c.archivado);
      if (input.sucursal) {
        const s = normaliza(input.sucursal);
        docs = docs.filter(c => { const st = normaliza(c.store || ''); return st === s || st.includes(s) || s.includes(st); });
      }
      const total = docs.length;
      const completados = docs.filter(c => c.enviado === true).length;
      checklists = {
        fecha, sucursal: input.sucursal || 'toda la operacion',
        total, completados, pendientes: total - completados,
        cumplimiento_pct: total ? Math.round(completados * 100 / total) : 0
      };
    }
    // Estadisticas personales del usuario.
    const dias = input.dias && input.dias > 0 ? input.dias : 7;
    const desde = Date.now() - dias * 24 * 60 * 60 * 1000;
    const todas = await pgAgendaList(ctx.uid);
    const mis_tareas = {
      ventana_dias: dias,
      completadas_en_ventana: todas.filter(t => t.completada && (t.completadaEn || 0) >= desde).length,
      pendientes_totales: todas.filter(t => !t.completada).length
    };
    return { ok: true, checklists, mis_tareas };
  }

  // ---- FLOTILLA (vehiculos) ----
  if (nombre === 'consultar_vehiculos') {
    let vehiculos = (await pgVehiculosList()).filter(v => v.activo !== false);
    if (input.sucursal) {
      const s = normaliza(input.sucursal);
      vehiculos = vehiculos.filter(v => { const x = normaliza(v.sucursal || ''); return x === s || x.includes(s) || s.includes(x); });
    }
    const ahora = Date.now();
    const reservas = await pgReservasList({});
    const lista = vehiculos.map(v => {
      const rs = reservas.filter(r => r.vehiculoId === v.id);
      const enUso = rs.find(r => r.estatus === 'aprobada' && r.salida && !r.regreso);
      const activaAhora = rs.find(r => r.estatus === 'aprobada' && r.desde <= ahora && r.hasta > ahora);
      const quien = enUso || activaAhora;
      const proximas = rs.filter(r => r.estatus === 'aprobada' && r.desde > ahora)
        .slice(0, 3).map(r => ({ de: nombreUsuario(ctx, r.usuarioUid), desde: fmtMx(r.desde), hasta: fmtHoraMx(r.hasta) }));
      return {
        nombre: v.nombre, sucursal: v.sucursal,
        estado: quien ? 'en uso' : 'libre',
        usa_ahora: quien ? nombreUsuario(ctx, quien.usuarioUid) : null,
        proximas
      };
    });
    return { ok: true, total: lista.length, vehiculos: lista };
  }

  if (nombre === 'apartar_vehiculo') {
    const vehiculos = (await pgVehiculosList()).filter(v => v.activo !== false);
    const rv = resolverVehiculo(vehiculos, input.vehiculo);
    if (!rv.vehiculo) {
      if (rv.ambiguos.length) return { ok: false, mensaje: `¿Cuál vehículo? Coinciden: ${rv.ambiguos.join(', ')}.` };
      return { ok: false, mensaje: `No encontré el vehículo "${input.vehiculo || ''}". Pregúntame "¿qué coches hay?" para ver la lista.` };
    }
    const fecha = input.fecha || ctx.fechaHoy;
    const desde = epochDeMx(fecha, input.hora_salida);
    const hasta = epochDeMx(input.fecha_regreso || fecha, input.hora_regreso);
    if (desde == null || hasta == null) return { ok: false, mensaje: 'Necesito fecha y horas válidas de salida y regreso (formato HH:mm).' };
    if (!(hasta > desde)) return { ok: false, mensaje: 'La hora de regreso debe ser posterior a la de salida.' };
    const conflicto = await pgReservaChoque(rv.vehiculo.id, desde, hasta, '');
    if (conflicto) return { ok: false, mensaje: `Ese vehículo ya está apartado de ${fmtMx(conflicto.desde)} a ${fmtHoraMx(conflicto.hasta)} (${nombreUsuario(ctx, conflicto.usuarioUid)}). Elige otro horario u otro coche.` };
    const id = crypto.randomUUID();
    const item = await pgReservaUpsert({
      id, vehiculoId: rv.vehiculo.id, usuarioUid: ctx.uid, desde, hasta, estatus: 'pendiente',
      vehiculoNombre: rv.vehiculo.nombre, sucursal: rv.vehiculo.sucursal, solicitante: ctx.nombre, solicitanteUid: ctx.uid,
      destino: input.destino || '', motivo: input.motivo || '', creadaEn: Date.now(), origen: 'whatsapp'
    });
    // Avisar por WhatsApp a los aprobadores y arrancar el escalamiento. Igual que
    // el endpoint web (reservas-vehiculos.js): una reserva creada por el BOT no
    // pasa por ese endpoint, asi que hay que dispararlo aqui tambien. Best-effort.
    try { require('./flotilla-notificar').iniciarEscalacion(item).catch(() => {}); }
    catch (e) { console.error('[apartar_vehiculo] no se pudo iniciar escalacion:', e && e.message); }
    return { ok: true, id, mensaje: `Solicitud registrada: ${rv.vehiculo.nombre}, ${fmtMx(desde)} → ${fmtHoraMx(hasta)}${input.destino ? `, destino ${input.destino}` : ''}. Queda *pendiente* de que un encargado la apruebe; te avisaré cuando pase.` };
  }

  if (nombre === 'consultar_mis_reservas') {
    const ahora = Date.now();
    const vmap = Object.fromEntries((await pgVehiculosList()).map(v => [v.id, v.nombre]));
    let rs = await pgReservasList({ usuarioUid: ctx.uid });
    rs = rs.filter(r => r.estatus !== 'rechazada' && r.estatus !== 'cancelada' &&
      (r.estatus === 'pendiente' || r.hasta > ahora || (r.salida && !r.regreso)));
    return {
      ok: true, total: rs.length,
      reservas: rs.map(r => ({
        id: r.id, vehiculo: r.vehiculoNombre || vmap[r.vehiculoId] || '?',
        desde: fmtMx(r.desde), hasta: fmtHoraMx(r.hasta), estatus: r.estatus,
        en_uso: !!(r.salida && !r.regreso), destino: r.destino || ''
      }))
    };
  }

  if (nombre === 'cancelar_reserva') {
    if (!input.id) return { ok: false, mensaje: 'Falta el id de la reserva (usa consultar_mis_reservas).' };
    const r = await pgReservaGet(input.id);
    if (!r) return { ok: false, mensaje: 'No encontré esa reserva.' };
    if (r.usuarioUid !== ctx.uid && !ctx.esAdmin) return { ok: false, mensaje: 'Solo puedes cancelar tus propias reservas.' };
    await pgReservaMergeDatos(input.id, { canceladaEn: Date.now(), canceladaPor: ctx.nombre }, { estatus: 'cancelada' });
    return { ok: true, mensaje: 'Reserva cancelada.' };
  }

  if (nombre === 'registrar_salida') {
    const rs = await pgReservasList({ usuarioUid: ctx.uid, estatus: 'aprobada' });
    let cand = rs.filter(r => !r.salida);
    if (input.vehiculo) {
      const rv = resolverVehiculo(await pgVehiculosList(), input.vehiculo);
      if (rv.vehiculo) cand = cand.filter(r => r.vehiculoId === rv.vehiculo.id);
    }
    if (cand.length === 0) return { ok: false, mensaje: 'No tienes ninguna reserva *aprobada* lista para salir. Primero aparta el coche y espera a que tu encargado la apruebe.' };
    const ahora = Date.now();
    cand.sort((a, b) => Math.abs(a.desde - ahora) - Math.abs(b.desde - ahora));
    const r = cand[0];
    await pgReservaMergeDatos(r.id, { esperandoUbicacion: 'salida', salidaPendiente: { hora: Date.now() } });
    const vname = r.vehiculoNombre || 'el vehículo';
    return { ok: true, requiere_ubicacion: true, accion: 'salida', reserva_id: r.id, mensaje: `¡Va! Para dejar registrada tu salida con *${vname}*, compárteme tu *ubicación* 📍 (toca el clip 📎 → Ubicación → Enviar tu ubicación actual).` };
  }

  if (nombre === 'registrar_regreso') {
    const rs = await pgReservasList({ usuarioUid: ctx.uid, estatus: 'aprobada' });
    let cand = rs.filter(r => r.salida && !r.regreso);
    if (input.vehiculo) {
      const rv = resolverVehiculo(await pgVehiculosList(), input.vehiculo);
      if (rv.vehiculo) cand = cand.filter(r => r.vehiculoId === rv.vehiculo.id);
    }
    if (cand.length === 0) return { ok: false, mensaje: 'No veo ningún vehículo que tengas ahorita en uso. Si ya lo tenías fuera, avísale a tu encargado.' };
    const r = cand[0];
    await pgReservaMergeDatos(r.id, { esperandoUbicacion: 'regreso', regresoPendiente: { hora: Date.now() } });
    const vname = r.vehiculoNombre || 'el vehículo';
    return { ok: true, requiere_ubicacion: true, accion: 'regreso', reserva_id: r.id, mensaje: `Perfecto, para cerrar el uso de *${vname}* compárteme tu *ubicación* 📍 de regreso (clip 📎 → Ubicación).` };
  }

  if (nombre === 'reservas_pendientes') {
    if (!require('./flotilla-notificar').esAprobador(ctx.telefono)) {
      return { ok: false, mensaje: 'Solo los encargados autorizados (por su número) pueden ver o aprobar las solicitudes de vehículos.' };
    }
    const vmap = Object.fromEntries((await pgVehiculosList()).map(v => [v.id, v.nombre]));
    const rs = await pgReservasList({ estatus: 'pendiente' });
    return {
      ok: true, total: rs.length,
      pendientes: rs.map(r => ({
        id: r.id, vehiculo: r.vehiculoNombre || vmap[r.vehiculoId] || '?',
        de: r.solicitante || nombreUsuario(ctx, r.usuarioUid),
        desde: fmtMx(r.desde), hasta: fmtHoraMx(r.hasta), destino: r.destino || ''
      }))
    };
  }

  if (nombre === 'aprobar_reserva') {
    if (!require('./flotilla-notificar').esAprobador(ctx.telefono)) {
      return { ok: false, mensaje: 'Solo los encargados autorizados (por su número) pueden aprobar o rechazar reservas.' };
    }
    if (!input.id) return { ok: false, mensaje: 'Falta el id (usa reservas_pendientes).' };
    const r = await pgReservaGet(input.id);
    if (!r) return { ok: false, mensaje: 'No encontré esa solicitud.' };
    if (r.usuarioUid === ctx.uid) return { ok: false, mensaje: 'No puedes aprobar tu *propia* solicitud. Debe autorizarla otro encargado.' };
    const aprobar = input.aprobar !== false;
    if (aprobar) {
      const conflicto = await pgReservaChoque(r.vehiculoId, r.desde, r.hasta, r.id);
      if (conflicto) return { ok: false, mensaje: `No puedo aprobar: choca con otra reserva ya aprobada de ${nombreUsuario(ctx, conflicto.usuarioUid)} (${fmtMx(conflicto.desde)} → ${fmtHoraMx(conflicto.hasta)}).` };
      await pgReservaMergeDatos(input.id, { aprobadoPor: ctx.nombre, aprobadaEn: Date.now() }, { estatus: 'aprobada' });
      return { ok: true, mensaje: `Reserva de ${r.vehiculoNombre || 'vehículo'} aprobada.` };
    }
    await pgReservaMergeDatos(input.id, { rechazadaPor: ctx.nombre, motivoRechazo: input.motivo || '' }, { estatus: 'rechazada' });
    return { ok: true, mensaje: 'Reserva rechazada.' };
  }

  return { ok: false, mensaje: 'Herramienta desconocida: ' + nombre };
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------
async function llamarClaude(apiKey, modelo, system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelo, max_tokens: 1024, system, tools: TOOLS, messages })
  });
  if (!r.ok) {
    const detalle = await r.text().catch(() => '');
    const err = new Error('Claude respondio ' + r.status); err.detalle = detalle; err.status = r.status;
    throw err;
  }
  return r.json();
}

// ---------------------------------------------------------------------------
// Contexto + bucle REUTILIZABLES (compartidos por el endpoint web y el webhook
// de WhatsApp). El endpoint web identifica al usuario por token de Firebase; el
// webhook lo identifica por su numero de telefono. Ambos arman `ctx` y llaman a
// procesarChat(). Asi la logica de herramientas y permisos es una sola.
// ---------------------------------------------------------------------------

// Carga usuarios + config de turnos y arma el contexto de un usuario YA
// identificado. (El parametro `db` queda por compatibilidad de firma; los datos
// se leen de Postgres, ya no de Firestore.)
async function construirContexto(db, uid, perfil, opts) {
  opts = opts || {};
  // Si quien llama ya cargo la lista de usuarios (ej. el webhook de WhatsApp la
  // usa para identificar por telefono), la reutilizamos para no leerla 2 veces.
  let usuarios = Array.isArray(opts.usuarios) ? opts.usuarios : null;
  if (!usuarios) usuarios = await pgUsuarios();
  let configTurnos = null;
  try {
    configTurnos = await pgConfig('turnos');
  } catch (e) { /* sin config => sin restriccion */ }
  return {
    uid, perfil, usuarios, configTurnos,
    nombre: perfil.nombre || perfil.correo || 'Usuario',
    esAdmin: perfil.rol === 'admin',
    canal: opts.canal || 'web', // 'whatsapp' | 'web' — solo por WhatsApp se puede compartir ubicacion
    // INVITADO: número no registrado en MD Task. Acceso SOLO a flotilla.
    esInvitado: !!opts.esInvitado,
    invitadoNombre: opts.invitadoNombre || null, // null = aún no nos ha dado su nombre
    convKey: opts.convKey || null,               // clave del hilo (para guardar la identidad)
    telefono: opts.telefono || null,
    fechaHoy: String(opts.fechaHoy || '').trim(),
    diaSemana: String(opts.diaSemana || '').trim()
  };
}

// System prompt segun el rol: admin = acceso total; colaborador = solo lo suyo.
function construirSystem(ctx) {
  // INVITADO sin identificar: SOLO pedir nombre y apellido, sin dejarlo continuar.
  if (ctx.esInvitado && !ctx.invitadoNombre) {
    return [
      'Eres el asistente de Mega Dulces Task por WhatsApp.',
      'Quien te escribe NO está registrado en el sistema y todavía no sabes quién es.',
      'Tu ÚNICA tarea ahora es conseguir su NOMBRE y APELLIDO completos.',
      'Reglas ESTRICTAS:',
      '- Salúdalo breve y pídele su nombre y apellido.',
      '- NO uses ninguna herramienta ni lo ayudes con NADA (coches, tareas, etc.) hasta que te dé su nombre COMPLETO (nombre y apellido).',
      '- En cuanto te dé un nombre y apellido válidos, llama a la herramienta identificar_invitado con ese nombre.',
      '- Si te escribe cualquier otra cosa sin darte su nombre, vuelve a pedírselo con amabilidad. NO lo dejes continuar sin nombre.',
      '- Responde SIEMPRE en español, breve.'
    ].join('\n');
  }
  // INVITADO ya identificado: acceso SOLO a flotilla (vehículos).
  if (ctx.esInvitado) {
    return [
      'Eres el asistente de flotilla de Mega Dulces Task por WhatsApp.',
      `Hablas con ${ctx.nombre}, que NO es personal de MD Task (invitado).`,
      `Hoy es ${ctx.fechaHoy || '(desconocido)'}${ctx.diaSemana ? ' (' + ctx.diaSemana + ')' : ''}.`,
      '',
      'SOLO puedes ayudarle con VEHÍCULOS: ver coches (consultar_vehiculos), apartar (apartar_vehiculo), ver/cancelar sus reservas (consultar_mis_reservas, cancelar_reserva) y registrar salida/regreso (registrar_salida, registrar_regreso).',
      'NO tiene tareas, checklists ni rutinas. Si pide algo de eso, dile con amabilidad que eso es solo para personal registrado de MD Task.',
      '',
      'Reglas de flotilla:',
      '- Apartar CONFIRMA antes: resume vehículo, fecha, hora de salida y regreso y destino, y pide confirmación. La reserva queda PENDIENTE de que un encargado la apruebe.',
      '- Para salir con un coche debe estar APROBADO. "ya voy a usar el coche" -> registrar_salida; "ya lo entregué" -> registrar_regreso.',
      '- Al registrar salida o regreso se le pedirá su UBICACIÓN por WhatsApp (obligatoria). Solo dile que comparta su ubicación; el botón aparece automáticamente. NO des por hecha la salida/regreso hasta que la comparta.',
      '- Muestra fechas/horas tal como vienen de las herramientas; no inventes horarios.',
      '- Resuelve fechas relativas a YYYY-MM-DD usando la fecha de hoy.',
      '- Responde SIEMPRE en español, breve y claro.'
    ].join('\n');
  }

  const sucs = sucursalesPermitidas(ctx);
  const reglaAcceso = ctx.esAdmin
    ? '- El usuario es administrador con ACCESO TOTAL: puedes consultar tareas de cualquier persona (consultar_tareas con "persona") y estadisticas de cualquier sucursal o de toda la operacion (estadisticas con "sucursal"). No digas que algo es solo personal o que no puedes por sucursal: usa los parametros.'
    : '- El usuario es un COLABORADOR (no administrador): solo puede ver y gestionar SUS propias tareas (consultar_tareas sin "persona", completar_tarea, editar_tarea, eliminar_tarea, resumen_hoy). NO puede crear checklists ni rutinas ni asignar tareas a otros; si lo pide, explicale con amabilidad que eso lo hace un administrador.';
  return [
    'Eres el asistente de Mega Dulces Task, una app de tareas para una dulceria.',
    `Hablas con ${ctx.nombre}${ctx.esAdmin ? ' (administrador)' : ''}.`,
    `Hoy es ${ctx.fechaHoy || '(desconocido)'}${ctx.diaSemana ? ' (' + ctx.diaSemana + ')' : ''}.`,
    '',
    'Puedes gestionar TAREAS, crear RUTINAS recurrentes y dar INFORMACION, usando las herramientas.',
    'Contexto para rutinas:',
    '- Sucursales disponibles: ' + (sucs.length ? sucs.join(', ') : '(ninguna)') + '.',
    '- Roles validos: ' + ROLES.join(', ') + '.',
    '- Frecuencias: ' + FRECUENCIAS.join(', ') + '. Dias: ' + DIAS.join(', ') + '.',
    '',
    'Reglas:',
    reglaAcceso,
    '- CONFIRMA ANTES DE ESCRIBIR: antes de crear o asignar (agregar_tarea individual o en grupo, crear_checklist y crear_rutina) RESUME en una frase que haras y a quien, y pide confirmacion. Ej: "Voy a crear el checklist [nombre] para [persona] en [sucursal] el [fecha] con estos items: ... ¿Confirmo?". Llama la herramienta SOLO despues de que el usuario diga si/confirme. Si menciona a una persona y no estas 100% seguro de quien es, di a quien entendiste y pide que confirme. Para consultas, resumenes y estadisticas (solo lectura) NO pidas confirmacion: hazlo directo.',
    '- CREAR siempre es un CHECKLIST: para crear cualquier cosa usa crear_checklist (escribe en la coleccion checklists, NUNCA en la agenda). Arma los items de lo que el admin dicte: una tarea suelta = item tipo "manual"; una rutina (ej. "todos los lunes...") = item tipo "rutina" con frecuencia y dia_semana. Pide nombre, persona, sucursal, fecha e items si faltan, antes de confirmar.',
    '- Usa las herramientas para EJECUTAR de verdad; no digas que hiciste algo sin llamarlas.',
    '- Para completar/editar/eliminar una tarea, primero usa consultar_tareas para obtener el id.',
    '- Para crear_rutina necesitas: nombre, frecuencia, sucursales y modo (porRol con rol_objetivo, o porPersonas con personas). Si falta algo, preguntalo corto antes de crear.',
    '- TURNOS (Canindo): algunas personas solo pueden recibir tareas dentro de su turno (manana/tarde). Si crear_checklist devuelve que la persona esta "fuera de turno", NO insistas: explicale al admin que esta fuera de su horario y que, si por necesidad debe trabajar otro turno, puede registrar una excepcion en la pantalla de Turnos de Canindo.',
    '',
    'FLOTILLA (vehiculos):',
    '- Cualquier colaborador puede: ver los coches (consultar_vehiculos), APARTAR uno (apartar_vehiculo), ver/cancelar SUS reservas (consultar_mis_reservas, cancelar_reserva) y registrar su salida/regreso (registrar_salida, registrar_regreso).',
    '- Apartar CONFIRMA antes: resume vehiculo, fecha, hora de salida y regreso y destino, y pide confirmacion. La reserva nace PENDIENTE y el sistema avisa AUTOMATICAMENTE a los encargados autorizados para que la aprueben; NO hace falta que tu hagas nada mas.',
    '- APROBAR/RECHAZAR solicitudes SOLO lo pueden hacer los encargados autorizados (por su numero de WhatsApp), y NUNCA el propio solicitante. NO ofrezcas aprobar las reservas del usuario ni uses aprobar_reserva por el; si te lo pide, explicale que su solicitud ya fue enviada a los encargados y que ellos la autorizan. Las herramientas reservas_pendientes/aprobar_reserva solo funcionan si quien escribe es un encargado autorizado.',
    '- Para salir con un coche debe estar APROBADO. "ya voy a usar el coche/la camioneta" -> registrar_salida; "ya lo entregue/regrese" -> registrar_regreso.',
    ctx.canal === 'whatsapp'
      ? '- Al registrar salida o regreso, el sistema le pedira su UBICACION por WhatsApp (es obligatoria para dejar constancia). Solo dile con naturalidad que comparta su ubicacion; el boton para enviarla aparece automaticamente. NO registres la salida/regreso como hecha hasta que comparta la ubicacion.'
      : '- Registrar salida/regreso con ubicacion se hace desde WhatsApp (ahi el colaborador comparte su ubicacion). Desde aqui solo consulta o gestiona reservas.',
    '- Muestra fechas/horas ya formateadas tal como vienen de las herramientas; no inventes horarios.',
    '- Resuelve fechas relativas a YYYY-MM-DD usando la fecha de hoy.',
    '- Responde SIEMPRE en espanol, breve y claro. Confirma lo hecho en una frase.',
    '- Si una accion falla, dilo con amabilidad y ofrece reintentar.'
  ].join('\n');
}

// Corre el bucle de herramientas de Claude. Muta `messages` (agrega el historial)
// y devuelve { respuesta, acciones, messages }.
async function procesarChat({ apiKey, modelo, db, ctx, messages }) {
  const system = construirSystem(ctx);
  const acciones = [];
  let respuestaTexto = '', data;

  for (let i = 0; i < MAX_ITERACIONES; i++) {
    data = await llamarClaude(apiKey, modelo, system, messages);
    messages.push({ role: 'assistant', content: data.content });

    if (data.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of (data.content || [])) {
        if (block.type !== 'tool_use') continue;
        let resultado;
        console.log('[asistente] herramienta:', block.name, '| datos:', JSON.stringify(block.input || {}));
        try { resultado = await ejecutarHerramienta(db, ctx, block.name, block.input); }
        catch (e) { resultado = { ok: false, mensaje: (e && e.message) || 'Error ejecutando la herramienta.' }; }
        console.log('[asistente] resultado:', JSON.stringify(resultado));
        if (resultado && resultado.ok) acciones.push({ herramienta: block.name, ...resultado });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultado), is_error: !(resultado && resultado.ok) });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    respuestaTexto = (data.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
    break;
  }

  if (!respuestaTexto) respuestaTexto = 'Listo.';
  return { respuesta: respuestaTexto, acciones, messages };
}

// ---------------------------------------------------------------------------
// Handler (endpoint web: POST /api/asistente-chat, autenticado con Firebase)
// ---------------------------------------------------------------------------
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    inicializar();

    const authHeader = String(req.headers['authorization'] || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Falta Authorization Bearer token' });
    const decoded = await admin.auth().verifyIdToken(idToken);

    // Perfil del usuario desde Postgres (los datos ya no viven en Firestore).
    const perfil = (await pgUsuarioPorId(decoded.uid)) || {};

    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) return res.status(400).json({ error: 'Faltan mensajes.' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY en las variables de entorno.' });
    const modelo = process.env.ASISTENTE_MODELO || 'claude-opus-4-8';

    const ctx = await construirContexto(null, decoded.uid, perfil, { fechaHoy: body.fechaHoy, diaSemana: body.diaSemana });
    const salida = await procesarChat({ apiKey, modelo, db: null, ctx, messages });
    return res.status(200).json(salida);
  } catch (e) {
    console.error('[asistente-chat] error:', e && e.message, e && e.detalle);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};

// Exponer las piezas reutilizables para el webhook de WhatsApp (que identifica
// al usuario por telefono en vez de por token de Firebase).
module.exports.inicializar = inicializar;
module.exports.construirContexto = construirContexto;
module.exports.procesarChat = procesarChat;
// Datos en Postgres que el webhook necesita (identidad por telefono + hilo).
module.exports.pgUsuarios = pgUsuarios;
module.exports.pgConversacionGet = pgConversacionGet;
module.exports.pgConversacionSet = pgConversacionSet;
// Flotilla: finalizar captura de ubicacion cuando llega un mensaje `location`.
module.exports.registrarUbicacion = registrarUbicacion;
// Expuesto para pruebas/arneses server-side (no lo usa el flujo normal).
module.exports.ejecutarHerramienta = ejecutarHerramienta;
