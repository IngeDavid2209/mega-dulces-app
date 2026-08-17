// Endpoint del ASISTENTE (chat con tool-use).
//
// Corre el BUCLE de herramientas de Claude: el modelo pide una herramienta, el
// servidor la ejecuta de verdad sobre Firestore (firebase-admin), le devuelve el
// resultado, y el modelo sigue hasta terminar.
//
// Herramientas:
//   TAREAS:    consultar_tareas, completar_tarea, editar_tarea, eliminar_tarea
//   ENTREGA:   mis_pendientes, entregar_item, enviar_checklist  (para TODOS)
//   ASIGNAR:   crear_checklist, crear_rutina  (segun permisos del perfil)
//   INFO:      consultar_rutinas, resumen_hoy, estadisticas
//   FLOTILLA:  consultar_vehiculos, apartar_vehiculo, consultar_mis_reservas,
//              cancelar_reserva, registrar_salida/regreso, reservas_pendientes,
//              aprobar_reserva (estas dos, solo numeros aprobadores)
//   PAGOS:     consultar_mis_pagos (los recibos de los que uno es responsable;
//              reportar el pago no necesita herramienta: se manda la foto)
//
// PERMISOS: se toman del perfil de la app (rol/alcance/flags puede*), ver el
// bloque PERMISOS mas abajo. Regla: ENTREGAR es para todos; ASIGNAR y ver lo de
// otros dependen del rol.
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
// Ultimos 10 digitos de un telefono (misma normalizacion que whatsapp.js::ultimos10,
// para comparar sin importar lada ni formato).
function ultimos10Tel(numero) {
  const n = String(numero || '').replace(/\D/g, '');
  return n.length >= 10 ? n.slice(-10) : n;
}
// Guarda el telefono en el PERFIL (columna propia de mdtask_usuarios). Es el dato
// con el que el bot identifica a la persona en WhatsApp. `auditoria` deja rastro
// en el jsonb de quien y como se registro (importante cuando lo hace el propio
// interesado por WhatsApp).
async function pgUsuarioSetTelefono(id, telefono, auditoria) {
  const r = await query(
    `update mdtask_usuarios set telefono = $2, actualizado_en = $3
       ${auditoria ? ", datos = coalesce(datos,'{}'::jsonb) || $4::jsonb" : ''}
      where id = $1 returning id`,
    auditoria
      ? [String(id), String(telefono), Date.now(), JSON.stringify({ telefonoAltaPorBot: auditoria })]
      : [String(id), String(telefono), Date.now()]
  );
  return r.rowCount > 0;
}
// Completa campos del perfil. SOLO se usa para llenar huecos (nunca pisa datos
// existentes; eso lo decide un administrador en Personal).
async function pgUsuarioCompletar(id, { cargo, correo, sucursales } = {}) {
  const cur = await query('select cargo, correo, datos from mdtask_usuarios where id = $1', [String(id)]);
  if (cur.rowCount === 0) return null;
  const a = cur.rows[0], datos = a.datos || {};
  const puestas = [];
  const nuevoCargo = (!String(a.cargo || '').trim() && cargo) ? String(cargo).trim() : a.cargo;
  const nuevoCorreo = (!String(a.correo || '').trim() && correo) ? String(correo).trim() : a.correo;
  if (nuevoCargo !== a.cargo) puestas.push('cargo');
  if (nuevoCorreo !== a.correo) puestas.push('correo');
  const sucActuales = Array.isArray(datos.sucursales) ? datos.sucursales : (datos.sucursal ? [datos.sucursal] : []);
  const merge = {};
  if (!sucActuales.length && Array.isArray(sucursales) && sucursales.length) {
    merge.sucursales = sucursales; puestas.push('sucursales');
  }
  if (!puestas.length) return { puestas: [] };
  await query(
    `update mdtask_usuarios set cargo = $2, correo = $3, actualizado_en = $4,
            datos = coalesce(datos,'{}'::jsonb) || $5::jsonb
      where id = $1`,
    [String(id), nuevoCargo || null, nuevoCorreo || null, Date.now(), JSON.stringify(merge)]
  );
  return { puestas };
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
// Checklists de una fecha que siguen SIN ENVIAR (lo que revisa el poll de avisos).
async function pgChecklistsPendientesDeFecha(fecha) {
  const r = await query(
    `select * from mdtask_checklists
      where fecha = $1 and coalesce(enviado,false) = false
        and coalesce(eliminado,false) = false and coalesce(archivado,false) = false`,
    [String(fecha)]
  );
  return r.rows.map(checklistFila);
}
async function pgChecklistGet(id) {
  const r = await query('select * from mdtask_checklists where id = $1', [String(id)]);
  return r.rows[0] ? checklistFila(r.rows[0]) : null;
}
// Checklists asignados a una persona. Se busca por uid Y por nombre porque los
// checklists viejos (pre Robot V2) solo guardan el nombre en `assigned`.
// Por defecto: sin borrar, sin archivar y SIN ENVIAR (los que aun debe entregar).
//
// Al match exacto se le SUMA el comparador TOLERANTE de nombres (acentos, orden
// de apellidos, un apellido de mas), el mismo que usa el front.
//
// ⚠️ Antes el tolerante solo corria si el exacto venia vacio, y eso ESCONDIA
// tareas: a quien tenia sus tareas escritas de dos formas ("SILVIA ZAVALA" y
// "Silvia Zavala Ramirez") el bot le mostraba unas y se callaba las otras,
// mientras la app le mostraba todas. Ahora se juntan los dos resultados, con lo
// que el bot ve exactamente lo mismo que la app — ni mas, ni menos.
async function pgChecklistsDeUsuario({ uid, nombre, desde, hasta, incluirEnviados = false } = {}) {
  const comunes = [];
  const p2 = [];
  if (desde) { p2.push(String(desde)); comunes.push(`fecha >= $${p2.length}`); }
  if (hasta) { p2.push(String(hasta)); comunes.push(`fecha <= $${p2.length}`); }
  comunes.push('coalesce(eliminado,false) = false', 'coalesce(archivado,false) = false');
  if (!incluirEnviados) comunes.push('coalesce(enviado,false) = false');

  const ident = [], params = [...p2];
  if (uid) { params.push(String(uid)); ident.push(`assigned_uid = $${params.length}`); }
  if (nombre) { params.push(String(nombre)); ident.push(`lower(coalesce(assigned,'')) = lower($${params.length})`); }
  if (!ident.length) return [];

  // `id` en el orden: sin el, dos checklists con la misma fecha y hora podrian
  // salir en distinto orden entre dos consultas y la NUMERACION que ve el
  // colaborador ("ya hice la 3") apuntaria a otra tarea.
  const orden = 'order by fecha asc, hora asc, id asc';
  const r = await query(
    `select * from mdtask_checklists where ${comunes.join(' and ')} and (${ident.join(' or ')}) ${orden}`, params);
  if (!nombre) return r.rows.map(checklistFila);

  // Nombres escritos distinto: se piden solo los NOMBRES distintos de la ventana
  // (docenas de filas, no miles) y se filtran con el comparador tolerante.
  const nombres = await query(
    `select distinct assigned from mdtask_checklists where ${comunes.join(' and ')} and coalesce(assigned,'') <> ''`, p2);
  const parecidos = nombres.rows.map(x => x.assigned).filter(n => mismoNombreEmpleado(n, nombre));
  if (!parecidos.length) return r.rows.map(checklistFila);
  const t = await query(
    `select * from mdtask_checklists where ${comunes.join(' and ')} and assigned = any($${p2.length + 1}) ${orden}`,
    [...p2, parecidos]);

  // Union de los dos, sin repetir, respetando el mismo orden estable (la
  // NUMERACION que ve el colaborador depende de esto).
  const vistos = new Set();
  const juntos = [];
  for (const fila of [...r.rows, ...t.rows]) {
    if (vistos.has(fila.id)) continue;
    vistos.add(fila.id);
    juntos.push(fila);
  }
  juntos.sort((a, b) =>
    String(a.fecha || '').localeCompare(String(b.fecha || '')) ||
    String(a.hora || '').localeCompare(String(b.hora || '')) ||
    String(a.id).localeCompare(String(b.id)));
  return juntos.map(checklistFila);
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
    invitado: row.invitado || null,   // identidad de invitado (número no registrado)
    esperando: row.esperando || null, // ENTREGA: foto de evidencia pendiente (SQL 024)
  };
}
// ENTREGA DE TAREAS: deja (o limpia) la marca de "estoy esperando la foto de tal
// item". Va en la conversacion, no en el checklist, porque es estado del CHAT:
// asi la siguiente imagen que llegue sabe a que item pertenece.
async function pgConversacionEsperandoSet(id, esperando) {
  await query(
    `insert into mdtask_wa_conversaciones (id, actualizado, messages, esperando)
     values ($1,$2,'[]'::jsonb,$3)
     on conflict (id) do update set esperando=excluded.esperando, actualizado=excluded.actualizado`,
    [String(id), Date.now(), esperando ? JSON.stringify(esperando) : null]
  );
}
async function pgConversacionEsperandoGet(id) {
  const r = await query('select esperando from mdtask_wa_conversaciones where id = $1', [String(id)]);
  return (r.rows[0] && r.rows[0].esperando) || null;
}
// LISTA CONGELADA (SQL 026): el mapa numero -> (checklist, item) tal como se le
// mostro a la persona. Sin esto la numeracion se recalcula en cada llamada y un
// checklist nuevo a media conversacion renumera todo: "la 67" acaba apuntando a
// otra tarea (paso en produccion).
async function pgConversacionListaSet(id, lista) {
  await query(
    `insert into mdtask_wa_conversaciones (id, actualizado, messages, lista)
     values ($1,$2,'[]'::jsonb,$3)
     on conflict (id) do update set lista=excluded.lista, actualizado=excluded.actualizado`,
    [String(id), Date.now(), lista ? JSON.stringify(lista) : null]
  );
}
async function pgConversacionListaGet(id) {
  const r = await query('select lista from mdtask_wa_conversaciones where id = $1', [String(id)]);
  return (r.rows[0] && r.rows[0].lista) || null;
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

/**
 * Marca que ESTE NUMERO nos acaba de escribir, sin tocar el historial.
 *
 * `actualizado` es lo que usa `ventanaAbierta` (api/tareas-notificar.js) para
 * saber si se le puede mandar texto libre en las siguientes 24 h. Antes solo se
 * escribia al guardar el hilo del asistente, asi que un mensaje que se resolvia
 * por otro camino —aprobar un vehiculo, mandar el comprobante de un pago, una
 * foto, una ubicacion— dejaba la ventana sin registrar: el sistema la creia
 * cerrada e intentaba una plantilla (que hoy rebota) en vez del texto, que si
 * habria llegado. Por eso se toca en CUANTO entra el mensaje, pase por donde pase.
 */
async function pgConversacionTocar(id) {
  await query(
    `insert into mdtask_wa_conversaciones (id, actualizado)
     values ($1,$2)
     on conflict (id) do update set actualizado = excluded.actualizado`,
    [String(id), Date.now()]
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

// ---------------------------------------------------------------------------
// ENTREGA DE TAREAS POR WHATSAPP
//
// Espejo EXACTO de las reglas del front (src/app/shared/item-completado.util.ts
// y checklist.ts). Si cambias un criterio aqui, cambialo alla tambien:
//   - un item cuenta como hecho si trae su EVIDENCIA (foto / antes-despues /
//     varias fotos) o si quedo palomeado cuando no pedia evidencia;
//   - status del checklist: 0 hechos = pendiente, todos = completo, si no en-progreso;
//   - ENVIAR es un acto aparte (enviado=true + horaEnvio). Si al enviar alguna
//     hora limite ya paso, se exige justificante (entregaConRetraso + motivoRetraso).
// ---------------------------------------------------------------------------
const CATEGORIAS_RETRASO = ['Falla de equipo', 'Falta de personal', 'Cliente complicado', 'Otro'];

function itemPideEvidencia(it) {
  return !!(it && (it.requiresPhoto || it.requiresAntesDespues || it.requiresVariasFotos));
}
function subida(v) { return !!v && v !== 'subiendo...'; }
// Espejo de tieneEvidencia() del front.
function itemHecho(it) {
  if (!it) return false;
  if (it.requiresAntesDespues) return subida(it.photoAntes) && subida(it.photoDespues);
  if (it.requiresVariasFotos) return Array.isArray(it.photos) && it.photos.length > 0;
  if (it.requiresPhoto) return subida(it.photo);
  return it.checked === true;
}
// Espejo de motivoIncompleto() del front: que le falta a este item.
function itemFalta(it) {
  if (it.requiresAntesDespues) {
    const falta = [];
    if (!subida(it.photoAntes)) falta.push('foto ANTES');
    if (!subida(it.photoDespues)) falta.push('foto DESPUES');
    if (falta.length) return 'falta ' + falta.join(' y ');
  }
  if (it.requiresVariasFotos && !(Array.isArray(it.photos) && it.photos.length)) return 'falta subir fotos';
  if (it.requiresPhoto && !subida(it.photo)) return 'falta la foto';
  if (!itemPideEvidencia(it) && !it.checked) return 'falta marcarla como hecha';
  return 'incompleta';
}
// Modo de evidencia que pide el item (para saber cuantas fotos esperar).
function modoEvidencia(it) {
  if (it.requiresAntesDespues) return 'antesDespues';
  if (it.requiresVariasFotos) return 'varias';
  return 'simple';
}
// Espejo de isTareaVencida(): deadline = fecha del checklist + horaLimite del item
// (o su `time` legacy; por defecto 23:59), en hora de Mexico.
function itemVencido(it, fecha) {
  if (!fecha) return false;
  const limite = epochDeMx(fecha, String(it.horaLimite || it.time || '23:59'));
  return limite != null && Date.now() > limite + 59 * 1000;
}
function checklistConRetraso(ck) {
  return Array.isArray(ck.items) && ck.items.some(i => itemVencido(i, ck.date));
}
// Recalcula status igual que actualizarEstado() del front. Muta y devuelve el ck.
function recalcularStatus(ck) {
  const items = Array.isArray(ck.items) ? ck.items : [];
  const hechos = items.filter(itemHecho).length;
  if (!items.length || hechos === 0) ck.status = 'pendiente';
  else if (hechos === items.length) ck.status = 'completo';
  else ck.status = 'en-progreso';
  return ck;
}
// Espejo de mismoEmpleadoNombre() (src/app/shared/permisos.util.ts): tolera
// acentos, espacios y apellidos en otro orden, pero exige 2+ palabras en comun
// para no confundir a dos personas distintas.
function mismoNombreEmpleado(a, b) {
  const na = normaliza(a), nb = normaliza(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(' ').filter(Boolean), tb = nb.split(' ').filter(Boolean);
  const corto = ta.length <= tb.length ? ta : tb;
  const largo = ta.length <= tb.length ? tb : ta;
  if (corto.length < 2) return false;
  const set = new Set(largo);
  return corto.every(t => set.has(t));
}
// Espejo de esElDueno(): solo el responsable asignado entrega su checklist.
function esMiChecklist(ctx, ck) {
  if (!ck) return false;
  if (ck.assignedUid && ck.assignedUid === ctx.uid) return true;
  return mismoNombreEmpleado(ck.assigned, ctx.nombre);
}
// Vista compacta de un checklist para el asistente (items numerados del 1 a N;
// ese numero es el que el colaborador usa al hablar: "ya hice la 2").
function vistaChecklist(ck) {
  const items = Array.isArray(ck.items) ? ck.items : [];
  return {
    id: ck.id, nombre: ck.name || '(sin nombre)', sucursal: ck.store || '',
    fecha: ck.date || '', hora_limite: ck.time || '', status: ck.status || 'pendiente',
    hechos: items.filter(itemHecho).length, total: items.length,
    con_retraso: checklistConRetraso(ck),
    items: items.map((it, i) => ({
      n: i + 1, texto: String(it.text || '(sin nombre)'), hecho: itemHecho(it),
      pide_foto: itemPideEvidencia(it) ? modoEvidencia(it) : null,
      hora_limite: it.horaLimite || it.time || null,
      vencida: itemVencido(it, ck.date),
      falta: itemHecho(it) ? null : itemFalta(it),
    })),
  };
}
// Empareja lo que dijo el colaborador ("la 2", "la de la vitrina") con un item.
// Devuelve { idx, ambiguos }.
function resolverItem(ck, ref) {
  const items = Array.isArray(ck.items) ? ck.items : [];
  const txt = String(ref == null ? '' : ref).trim();
  if (!txt) return { idx: -1, ambiguos: [] };
  const num = /^#?(\d{1,3})$/.exec(txt);
  if (num) {
    const i = parseInt(num[1], 10) - 1;
    return { idx: i >= 0 && i < items.length ? i : -1, ambiguos: [] };
  }
  const objetivo = normaliza(txt);
  const exacto = items.findIndex(it => normaliza(it.text) === objetivo);
  if (exacto >= 0) return { idx: exacto, ambiguos: [] };
  const contiene = items.map((it, i) => ({ it, i }))
    .filter(({ it }) => { const n = normaliza(it.text); return n && (n.includes(objetivo) || objetivo.includes(n)); });
  if (contiene.length === 1) return { idx: contiene[0].i, ambiguos: [] };
  if (contiene.length > 1) return { idx: -1, ambiguos: contiene.map(({ it, i }) => `${i + 1}. ${it.text}`) };
  return { idx: -1, ambiguos: [] };
}
// Ventana por defecto: SOLO EL DIA DE HOY.
//
// Antes eran 14 dias hacia atras, para que nadie perdiera lo que arrastraba. En
// la practica hizo lo contrario: como casi nadie ENVIA sus checklists, el
// arrastre se acumulo y a quien preguntaba "¿que tengo hoy?" le caian 103 tareas
// de las ultimas dos semanas, todas marcadas "vencida". La lista dejo de servir
// justo para lo que era, y la gente pedia "solo dame las del lunes".
//
// Decision del usuario (17-ago-2026): de hoy en adelante; lo pasado ya no se
// muestra. Lo viejo NO se pierde —sigue en la app, y por chat se puede pedir con
// `mis_pendientes({fecha:'YYYY-MM-DD'})`—, simplemente deja de estorbar.
const DIAS_ARRASTRE = 0;

/**
 * La ventana de fechas con la que trabaja el bot.
 *
 * Vive en UNA sola funcion porque la usan cuatro caminos (la lista, resolver un
 * checklist, colocar una foto suelta y la entrega automatica al final de la
 * fila). Si cada uno mirara un rango distinto, el bot enseñaria una lista y
 * cerraria otra cosa —que es exactamente el bug que ya nos costo caro.
 */
function ventanaDeTrabajo(fechaHoy) {
  return { desde: restarDiasISO(fechaHoy, DIAS_ARRASTRE) || undefined, hasta: fechaHoy || undefined };
}
function restarDiasISO(fechaISO, dias) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fechaISO || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() - Number(dias || 0));
  return d.toISOString().slice(0, 10);
}
// Mismo formato de horaEnvio que guarda el front ("08:30 PM"), en hora de Mexico.
function horaEnvioMx() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date());
}

/**
 * LISTA PLANA DE TAREAS del dia (la vista que necesita quien trabaja por RUTINAS).
 *
 * Motivo: las tareas recurrentes llegan como MUCHOS checklists de UN item cada
 * uno (hoy 144 de 179). Para la persona son "sus 17 tareas", no 17 checklists,
 * y numerarlas 1..N por checklist las volvia todas "la 1".
 *
 * La numeracion incluye las tareas YA HECHAS a proposito: si solo contara las
 * pendientes, al cerrar la 1 todas se recorrerian y "ya hice la 3" apuntaria a
 * otra cosa. Numerando todo, los numeros aguantan toda la conversacion.
 */
async function tareasPlanas(ctx, { uid, nombre, fecha } = {}) {
  const filtros = fecha ? { desde: fecha, hasta: fecha } : ventanaDeTrabajo(ctx.fechaHoy);
  const checklists = await pgChecklistsDeUsuario({
    uid: uid || ctx.uid, nombre: nombre || ctx.nombre, ...filtros,
  });
  const tareas = [];
  for (const ck of checklists) {
    const items = Array.isArray(ck.items) ? ck.items : [];
    items.forEach((it, i) => {
      tareas.push({
        n: tareas.length + 1,
        texto: String(it.text || '(sin nombre)'),
        hecho: itemHecho(it),
        pide_foto: itemPideEvidencia(it) ? modoEvidencia(it) : null,
        hora_limite: it.horaLimite || it.time || ck.time || null,
        vencida: itemVencido(it, ck.date),
        sucursal: ck.store || '',
        checklist: ck.name || '',
        checklist_id: ck.id,
        item_id: it.id,
        _idx: i,
      });
    });
  }
  return { checklists, tareas };
}

/**
 * Marca un checklist como ENTREGADO (enviado=true + horaEnvio), con su
 * justificante si va con retraso, y avisa a quien lo asigno. Una sola definicion
 * para la entrega de uno y la de todos.
 * `quien` es { uid, nombre } (el ctx normal, o una identidad minima cuando el
 * envio lo dispara la ultima foto de la fila, fuera de Claude).
 */
async function marcarEnviado(quien, ck, { categoria, comentario, nota } = {}) {
  if (categoria) {
    ck.entregaConRetraso = true;
    ck.motivoRetraso = { categoria, comentario: comentario || '', reportadoPor: quien.nombre, timestamp: Date.now() };
  }
  if (nota) ck.notaEmpleado = String(nota).trim();
  ck.enviado = true;
  ck.horaEnvio = horaEnvioMx();
  ck.enviadoPor = 'whatsapp';
  ck.enviadoEn = Date.now();
  recalcularStatus(ck);
  await pgChecklistUpsert(ck.id, ck);
  // Avisar a quien lo asigno (mejor esfuerzo: nunca tumba la entrega).
  try { await require('./tareas-notificar').avisarEntrega(ck, quien); }
  catch (e) { console.error('[entrega] no se pudo avisar al admin:', e && e.message); }
  return ck;
}

// Resuelve sobre QUE checklist se va a trabajar: el que digan por id, o el unico
// que la persona tenga pendiente. Devuelve { ck } o { error, opciones }.
async function resolverChecklistDestino(ctx, checklistId) {
  if (checklistId) {
    const ck = await pgChecklistGet(String(checklistId));
    if (!ck) return { error: 'No encontre ese checklist.' };
    if (!esMiChecklist(ctx, ck)) return { error: 'Ese checklist no esta asignado a ti, asi que no lo puedes entregar.' };
    if (ck.eliminado || ck.archivado) return { error: 'Ese checklist ya no esta activo.' };
    if (ck.enviado) return { error: `El checklist "${ck.name}" ya fue enviado${ck.horaEnvio ? ' a las ' + ck.horaEnvio : ''}.` };
    return { ck };
  }
  const lista = await pgChecklistsDeUsuario({
    uid: ctx.uid, nombre: ctx.nombre, ...ventanaDeTrabajo(ctx.fechaHoy),
  });
  if (!lista.length) return { error: 'No tienes checklists pendientes por entregar.' };
  if (lista.length === 1) return { ck: lista[0] };
  return {
    error: 'Tienes varios checklists pendientes; pregunta a cual se refiere.',
    opciones: lista.map(c => ({ id: c.id, nombre: c.name, sucursal: c.store, fecha: c.date })),
  };
}

/**
 * Tareas de esta persona que PIDEN evidencia y siguen sin ella. Es el respaldo
 * cuando llega una foto y la fila esta vacia: la foto ya esta tomada y hay que
 * colocarla o al menos preguntar bien, nunca tirarla.
 * Se ordena poniendo primero las YA MARCADAS (esas son las que estaba
 * entregando) y luego el resto, de la mas reciente a la mas vieja.
 */
async function candidatosFoto(identidad) {
  try {
    const hoy = ahoraMexico().fechaISO;
    const cks = await pgChecklistsDeUsuario({
      uid: (identidad && identidad.uid) || undefined,
      nombre: (identidad && identidad.nombre) || undefined,
      ...ventanaDeTrabajo(hoy),
    });
    const out = [];
    for (const ck of cks) {
      (Array.isArray(ck.items) ? ck.items : []).forEach((it) => {
        if (!itemPideEvidencia(it) || itemHecho(it)) return;
        out.push({
          checklistId: ck.id, itemId: it.id, texto: String(it.text || ''),
          modo: modoEvidencia(it), fase: modoEvidencia(it) === 'antesDespues' ? 'antes' : null,
          _marcada: it.checked === true, _fecha: ck.date || '',
        });
      });
    }
    out.sort((a, b) => (b._marcada - a._marcada) || String(b._fecha).localeCompare(String(a._fecha)));
    return out;
  } catch (e) {
    console.error('[entrega] no pude buscar candidatas para la foto:', e && e.message);
    return [];
  }
}

/**
 * Guarda una FOTO que acaba de llegar por WhatsApp en el item que la estaba
 * esperando. La llama el webhook (fuera de Claude) despues de subirla a
 * Cloudinary, igual que registrarUbicacion() en flotilla.
 * Devuelve { ok, sinPendiente?, item, checklist, fase, faltaOtra, todosHechos }.
 */
async function registrarFotoEvidencia(convKey, urlFoto, identidad) {
  if (!convKey || !urlFoto) return { ok: false, sinPendiente: true };
  let esp = await pgConversacionEsperandoGet(convKey);

  // SIN FILA: la persona ya tomo la foto en el piso, no se puede tirar. Se busca
  // a que tarea pertenece entre las que le piden evidencia y siguen sin ella.
  // Si hay UNA sola, ahi va (y se le dice cual). Si hay varias, se le pregunta
  // con sus numeros. Antes se contestaba "no se de que tarea es" y la foto se
  // perdia: el usuario reportaba justo eso desde el piso.
  if (!esp || esp.tipo !== 'foto' || !(Array.isArray(esp.cola) ? esp.cola.length : esp.checklistId)) {
    const cand = await candidatosFoto(identidad);
    if (cand.length === 1) {
      console.log(`[entrega] foto sin fila: hay una sola tarea esperando evidencia ("${cand[0].texto}"), la pongo ahi`);
      esp = { tipo: 'foto', cola: [cand[0]], idx: 0, pedidoEn: Date.now(), deducida: true };
    } else {
      console.warn(`[entrega] foto sin fila y ${cand.length} candidatas: hay que preguntarle`);
      return { ok: false, sinPendiente: true, candidatos: cand.slice(0, 8) };
    }
  }

  // Formato con FILA (varias tareas con foto, una tras otra) o el de una sola
  // tarea (compatibilidad con lo que quedara apuntado antes de este cambio).
  const enFila = Array.isArray(esp.cola) && esp.cola.length > 0;
  const cola = enFila ? esp.cola : [{ checklistId: esp.checklistId, itemId: esp.itemId, texto: esp.itemTexto, modo: esp.modo, fase: esp.fase }];
  let cursor = enFila ? Number(esp.idx || 0) : 0;
  if (cursor >= cola.length) { await pgConversacionEsperandoSet(convKey, null); return { ok: false, sinPendiente: true }; }
  const actual = cola[cursor];
  if (!actual || !actual.checklistId) return { ok: false, sinPendiente: true };

  // Si la entrada de la fila ya no cuadra (el checklist se envio, se borro o el
  // item cambio), se DESCARTA SOLO ESA y se sigue con las demas. Antes se borraba
  // la fila completa: un tropiezo tiraba las 3 fotos que la persona traia en cola
  // y el bot volvia a pedirlas todas desde cero.
  const saltar = async (motivo) => {
    const resto = cola.slice(cursor + 1);
    console.warn(`[entrega] descarto una entrada de la fila (${motivo}); quedan ${resto.length}`);
    if (resto.length) {
      await pgConversacionEsperandoSet(convKey, { tipo: 'foto', cola: resto, idx: 0, pedidoEn: Date.now() });
      return { ok: false, saltada: true, texto: actual.texto, siguiente: { texto: resto[0].texto, fase: resto[0].fase, n: resto[0].n } };
    }
    await pgConversacionEsperandoSet(convKey, null);
    return { ok: false, sinPendiente: true, texto: actual.texto };
  };

  const ck = await pgChecklistGet(actual.checklistId);
  if (!ck) return saltar('el checklist ya no existe');
  if (ck.enviado) return saltar('el checklist ya se entrego');
  const items = Array.isArray(ck.items) ? ck.items : [];
  const idx = items.findIndex(it => String(it.id) === String(actual.itemId));
  if (idx < 0) return saltar('el item ya no esta en el checklist');

  const modoActual = actual.modo || 'simple';
  const faseActual = actual.fase || null;
  const it = items[idx];
  const ahora = Date.now();
  const hora = fmtHoraMx(ahora);
  let fase = null, faltaOtra = false;

  if (modoActual === 'antesDespues') {
    if (faseActual === 'antes') {
      it.photoAntes = urlFoto; it.photoAntesTime = hora; it.photoAntesTimestamp = ahora;
      fase = 'antes'; faltaOtra = true;
    } else {
      it.photoDespues = urlFoto; it.photoDespuesTime = hora;
      fase = 'despues';
    }
  } else if (modoActual === 'varias') {
    it.photos = Array.isArray(it.photos) ? it.photos : [];
    it.photos.push({ url: urlFoto, time: hora, timestamp: ahora });
    fase = 'varias';
  } else {
    it.photo = urlFoto; it.photoTime = hora;
    fase = 'simple';
  }
  if (itemHecho(it)) { it.checked = true; it.checkedEn = ahora; it.checkedPor = 'whatsapp'; }

  ck.items = items;
  recalcularStatus(ck);
  await pgChecklistUpsert(ck.id, ck);

  // ¿Esta tarea ya quedo lista, o todavia le falta otra foto?
  const estaListo = itemHecho(it);
  const sigueEnLaMisma = (modoActual === 'antesDespues' && fase === 'antes') || (modoActual === 'varias' && !estaListo);

  let siguiente = null, entregados = [];
  if (sigueEnLaMisma) {
    // Misma tarea: se guarda la fase que toca (la foto de DESPUES).
    const nuevaCola = cola.slice();
    nuevaCola[cursor] = { ...actual, fase: fase === 'antes' ? 'despues' : actual.fase };
    await pgConversacionEsperandoSet(convKey, { tipo: 'foto', cola: nuevaCola, idx: cursor, pedidoEn: ahora });
  } else {
    cursor += 1;
    if (cursor < cola.length) {
      siguiente = cola[cursor];
      await pgConversacionEsperandoSet(convKey, { tipo: 'foto', cola, idx: cursor, pedidoEn: ahora });
    } else {
      // FIN DE LA FILA: ya no falta ninguna foto. Se entrega TODO lo que quedo
      // completo y a tiempo, no solo los de la fila: en un dia de rutinas tambien
      // quedaron cerradas las tareas que NO pedian foto, y dejarlas sin enviar
      // seria entregar a medias. Lo que va con RETRASO no se manda solo, porque
      // necesita que la persona de el motivo (misma regla que la app).
      await pgConversacionEsperandoSet(convKey, null);
      const quien = { uid: identidad && identidad.uid ? identidad.uid : ck.assignedUid || '', nombre: (identidad && identidad.nombre) || ck.assigned || '' };
      const hoyISO = ahoraMexico().fechaISO;
      let candidatos = [];
      try {
        candidatos = await pgChecklistsDeUsuario({
          uid: quien.uid || undefined, nombre: quien.nombre || undefined,
          ...ventanaDeTrabajo(hoyISO),
        });
      } catch (e) { console.error('[entrega] no pude leer los pendientes:', e && e.message); }
      // Respaldo: si la consulta falla, al menos los de la propia fila.
      if (!candidatos.length) {
        const ids = Array.from(new Set(cola.map(c => String(c.checklistId))));
        for (const id of ids) {
          const c = String(id) === String(ck.id) ? ck : await pgChecklistGet(id);
          if (c) candidatos.push(c);
        }
      }
      for (const c of candidatos) {
        if (!c || c.enviado) continue;
        const its = Array.isArray(c.items) ? c.items : [];
        if (!its.length || !its.every(itemHecho)) continue;
        if (checklistConRetraso(c)) continue;          // necesita justificante
        await marcarEnviado(quien, c, {});
        entregados.push({ id: c.id, nombre: c.name || '' });
      }
    }
  }

  const pendientes = items.filter(i => !itemHecho(i)).length;
  return {
    ok: true, fase, faltaOtra: sigueEnLaMisma,
    totalFotos: Array.isArray(it.photos) ? it.photos.length : (subida(it.photo) ? 1 : 0),
    item: { n: actual.n || idx + 1, texto: String(it.text || '') },
    checklist: { id: ck.id, nombre: ck.name || '', status: ck.status, pendientes, total: items.length },
    todosHechos: pendientes === 0,
    // Progreso de la FILA de fotos (lo usa el webhook para ir contando). `cursor`
    // solo avanza cuando una tarea queda cerrada, asi que es el numero de listas.
    fila: { hechas: cursor, total: cola.length, restantes: Math.max(0, cola.length - cursor) },
    siguiente: siguiente ? { texto: siguiente.texto, fase: siguiente.fase, n: siguiente.n } : null,
    entregados,
  };
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

  // --- PERSONAL: telefono (sin el, el bot no le puede avisar a nadie) ---
  {
    name: 'registrar_telefono',
    description: 'Guarda o corrige el TELEFONO de WhatsApp de una persona del personal. Usala cuando el usuario te dicte un numero ("el numero de Fatima es 352..."). Sin telefono el bot no le puede avisar de sus tareas ni ella puede usar el bot. Requiere permiso de administrar personal.',
    input_schema: {
      type: 'object',
      properties: {
        persona: { type: 'string', description: 'Nombre de la persona.' },
        telefono: { type: 'string', description: 'Numero tal como lo dicto el usuario (10 digitos de Mexico; se aceptan espacios, guiones o +52).' },
        reemplazar: { type: 'boolean', description: 'true SOLO si ya tenia otro numero distinto y el usuario confirmo que quiere cambiarlo.' }
      },
      required: ['persona', 'telefono']
    }
  },
  {
    name: 'completar_mi_perfil',
    description: 'Completa datos que le FALTAN al perfil de quien te escribe (su sucursal, su puesto o su correo). Usala cuando el sistema te diga que faltan datos, o cuando la persona te los diga. Solo llena huecos: lo que ya tiene registrado no se toca.',
    input_schema: {
      type: 'object',
      properties: {
        sucursal: { type: 'string', description: 'Sucursal donde trabaja (una de las de la empresa).' },
        puesto: { type: 'string', description: 'Su puesto o cargo (ej. Cajero, Auxiliar, Encargado).' },
        correo: { type: 'string', description: 'Su correo, si lo da.' }
      },
      required: []
    }
  },
  {
    name: 'personal_sin_telefono',
    description: 'Lista al personal que NO tiene telefono registrado (por eso no recibe avisos ni puede usar el bot). Usala cuando pregunten a quien le falta el numero.',
    input_schema: {
      type: 'object',
      properties: { sucursal: { type: 'string', description: 'Filtrar por una sucursal. Opcional.' } },
      required: []
    }
  },

  // --- ENTREGA DE TAREAS (los checklists que le toca hacer al colaborador) ---
  {
    name: 'mis_pendientes',
    description: 'Las tareas que esta persona tiene HOY, numeradas 1..N. Usala cuando pregunte "que tengo que hacer", "mis tareas de hoy", "que me falta", y SIEMPRE antes de entregar o enviar algo (de aqui salen el checklist_id y el numero de cada item). Solo trae las de HOY: para otro dia hay que pasar `fecha`.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'YYYY-MM-DD para ver OTRO dia (ej. "las del lunes que no entregue"). Vacio = las de hoy.' },
        persona: { type: 'string', description: 'Solo admin: ver los pendientes de otra persona.' }
      },
      required: []
    }
  },
  {
    name: 'entregar_item',
    description: 'Marca tareas como hechas. Acepta UNA ("ya hice la 2"), VARIAS ("ya hice la 1, 3 y 7" -> tareas:["1","3","7"]) o TODAS ("ya termine todo" -> todas:true). Los numeros son los de la lista de mis_pendientes. Las tareas que piden foto NO se cierran aqui: entran a una fila y hay que pedirle las fotos una por una (cada imagen que mande se guarda sola en la que toca).',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Una tarea: su numero ("2") o su texto.' },
        tareas: { type: 'array', items: { type: 'string' }, description: 'Varias tareas por numero o texto. Ej. ["1","3","7"].' },
        todas: { type: 'boolean', description: 'true = todas las tareas pendientes del dia.' },
        checklist_id: { type: 'string', description: 'Solo si te refieres a un checklist concreto y su numeracion interna.' }
      },
      required: []
    }
  },
  {
    name: 'enviar_checklist',
    description: 'ENTREGA lo trabajado (es el acto de enviarlo; queda en el historial del admin). Con todos=true envia TODO lo que ya este completo (lo normal en quien trabaja por rutinas y tiene muchos checklists). Si faltan tareas avisa cuales y solo manda si el colaborador confirma con forzar=true. Si ya paso la hora limite exige justificante (categoria + comentario).',
    input_schema: {
      type: 'object',
      properties: {
        todos: { type: 'boolean', description: 'true = enviar todos los checklists que ya esten completos.' },
        checklist_id: { type: 'string', description: 'Id de uno en concreto. Si solo tiene uno pendiente, se puede omitir.' },
        forzar: { type: 'boolean', description: 'true = enviar aunque falten tareas (solo despues de que el colaborador lo confirme).' },
        categoria: { type: 'string', enum: CATEGORIAS_RETRASO, description: 'Motivo del retraso. Obligatorio si va con retraso.' },
        comentario: { type: 'string', description: 'Explicacion del retraso (minimo 5 caracteres). Obligatorio si va con retraso.' },
        nota: { type: 'string', description: 'Nota opcional del colaborador para el admin (queda como notaEmpleado).' }
      },
      required: []
    }
  },

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
  },
  {
    name: 'consultar_mis_pagos',
    description: 'Los PAGOS DE SERVICIOS (luz, agua, internet, gas, renta) de los que el usuario es responsable y siguen sin pagarse. Usala cuando pregunte si debe algun recibo o servicio ("tengo algun pago pendiente", "que recibos me tocan", "ya pague todo?"). NO es para las tareas ni para su sueldo: si pregunta por sus pendientes de trabajo, usa mis_pendientes.',
    input_schema: { type: 'object', properties: {}, required: [] }
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
// ---------------------------------------------------------------------------
// PERMISOS — espejo de src/app/shared/permisos.util.ts. El bot NO inventa roles:
// usa los MISMOS del perfil de la app (rol, alcance, sucursales y los flags
// puede* que el admin activa en la pantalla de Personal).
//
// Regla de oro de este modulo:
//   ENTREGAR (mis_pendientes propias, entregar_item, enviar_checklist) es para
//   TODOS: si alguien tiene un checklist asignado, puede entregarlo. Punto.
//   ASIGNAR y VER LO DE OTROS si dependen del rol/permisos.
// ---------------------------------------------------------------------------
// Flags de gestion que convierten a un trabajador en "supervisor/encargado"
// (misma lista que esSupervisor() del front).
const FLAGS_GESTION = [
  'puedeAdministrarPersonal', 'puedeVerEstadisticas', 'puedeVerCheckstore',
  'puedeVerCalendario', 'puedeVerHistorial', 'puedeCrearChecklists',
  'puedeCrearRutinas', 'puedeCrearTareasUnicas', 'puedeAdministrarAreas',
];
function esSupervisorPerfil(perfil) {
  if (!perfil || perfil.rol !== 'trabajador') return false;
  if (sucursalesDe(perfil).length === 0) return false;
  return FLAGS_GESTION.some(f => perfil[f] === true);
}
// Espejo de tieneVistaDeGestion(): admin (cualquier alcance) o supervisor.
function tieneVistaDeGestion(perfil) {
  return !!perfil && (perfil.rol === 'admin' || esSupervisorPerfil(perfil));
}
// ¿Esta persona cae dentro del alcance de sucursales de quien pregunta?
// Mismo criterio que el enScope de personalAsignable().
function enMiAlcance(ctx, user) {
  if (esAdminGlobal(ctx.perfil)) return true;
  const permitidas = sucursalesPermitidas(ctx);
  return sucursalesDe(user).some(s => permitidas.some(p => normaliza(p) === normaliza(s)));
}
// Sucursales en las que este usuario puede operar (todas, si es admin global).
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
    // ¿Es PERSONAL de MegaDulces al que solo le falta su telefono en el perfil?
    // Con 127 de 154 sin numero registrado, este es el caso mas comun: la persona
    // si trabaja aqui y tiene tareas, pero el bot no la reconoce porque su perfil
    // no trae telefono. Decirle "eres un invitado, solo coches" seria mentirle.
    // NO se le da acceso por decir un nombre (cualquiera podria); se le explica
    // como arreglarlo y quien puede hacerlo.
    const coincidencias = (ctx.usuarios || []).filter(u => (u.rol === 'trabajador' || u.rol === 'admin')
      && u.activo !== false && mismoNombreEmpleado(u.nombre, n));

    // Dos personas con nombres parecidos: NO se puede adivinar, se pregunta.
    if (coincidencias.length > 1) {
      return {
        ok: false,
        mensaje: `Hay varias personas con un nombre parecido al tuyo: ${coincidencias.slice(0, 4).map(u => u.nombre).join(', ')}. Dime tu nombre COMPLETO como aparece en tu recibo para no confundirte con un compañero.`
      };
    }

    const empleado = coincidencias[0];
    if (empleado) {
      const telActual = String(empleado.telefono || '').trim();

      // ALTA AUTOMATICA: es personal y su perfil NO tiene telefono. Se registra
      // este numero al instante y desde aqui ya trabaja normal. Queda auditoria
      // en su perfil (`telefonoAltaPorBot`) de que lo hizo el propio interesado.
      if (!telActual) {
        await pgUsuarioSetTelefono(empleado.id, ultimos10Tel(ctx.telefono || ''), {
          en: Date.now(), telefono: ultimos10Tel(ctx.telefono || ''), nombreQueDijo: n, via: 'whatsapp-autoalta',
        });
        console.warn(`[bot] ALTA AUTOMATICA: ${empleado.nombre} registro el numero ${ctx.telefono} por WhatsApp (dijo "${n}").`);
        // Se limpia la identidad de invitado y se convierte el contexto en el
        // usuario real, para que en este MISMO mensaje ya vea sus tareas.
        if (ctx.convKey) await pgConversacionInvitadoSet(ctx.convKey, null);
        empleado.telefono = ultimos10Tel(ctx.telefono || '');
        ctx.esInvitado = false; ctx.invitadoNombre = null; ctx.invitadoEsEmpleado = null;
        ctx.uid = empleado.id; ctx.perfil = empleado;
        ctx.nombre = empleado.nombre || empleado.correo || n;
        ctx.esAdmin = empleado.rol === 'admin';
        ctx.esGestor = tieneVistaDeGestion(empleado);
        ctx.puedeAsignar = ctx.esAdmin || empleado.puedeCrearChecklists === true;
        ctx.puedeCrearRutinas = ctx.esAdmin || empleado.puedeCrearRutinas === true;

        const faltan = [];
        if (!sucursalesDe(empleado).length) faltan.push('sucursal');
        if (!String(empleado.cargo || '').trim()) faltan.push('puesto');
        return {
          ok: true, alta_automatica: true, usuario: ctx.nombre, faltan_datos: faltan,
          mensaje: `Listo, ${ctx.nombre}: ya registre este numero en tu perfil, asi que desde aqui ya puedes ver y entregar tus tareas 🙌`
            + (faltan.length ? ` Aprovechando: en la app te falta ${faltan.join(' y ')}; preguntaselo y guardalo con completar_mi_perfil.` : '')
            + ' Ahora usa mis_pendientes para decirle que le toca hoy.'
        };
      }

      // Su perfil YA tiene otro numero: eso no es llenar un hueco, seria quitarle
      // la cuenta a quien la tiene. Lo cambia un administrador, no el bot.
      if (ctx.convKey) {
        await pgConversacionInvitadoSet(ctx.convKey, {
          nombre: n, telefono: ctx.telefono || '', identificadoEn: Date.now(),
          empleadoDetectado: empleado.nombre, sinTelefono: false,
        });
      }
      ctx.invitadoNombre = n; ctx.nombre = n;
      console.warn(`[bot] ${empleado.nombre} escribio desde ${ctx.telefono} pero su perfil tiene otro numero (${telActual}).`);
      return {
        ok: true, invitado_nombre: n, empleado_sin_telefono: empleado.nombre,
        mensaje: `Con ese nombre apareces como personal (${empleado.nombre}), pero tu perfil tiene registrado OTRO numero, y por seguridad no puedo cambiarlo yo. `
          + `Pidele a tu encargado o a un administrador que lo actualice: puede hacerlo aqui mismo diciendole al bot "el numero de ${empleado.nombre} es ${ctx.telefono || '...'}". `
          + `Mientras, si necesitas un vehiculo si te puedo ayudar 🚗.`
      };
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
      if (!ctx.puedeAsignar) return { ok: false, mensaje: 'No tienes permiso para asignar tareas a otras personas.' };
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
      // MISMO permiso que en la app: la agenda de otra persona solo la ve quien
      // tiene vista de gestion (admin o supervisor) y solo de sus sucursales.
      if (!ctx.esGestor) return { ok: false, mensaje: 'Solo puedes consultar TUS tareas. Las de otras personas las ve un administrador o tu encargado.' };
      const r = resolverPersona(ctx, input.persona);
      if (!r.user) {
        if (r.ambiguos.length) return { ok: false, mensaje: `Hay varias personas que coinciden con "${input.persona}": ${r.ambiguos.slice(0, 6).join(', ')}. Dime el nombre completo.` };
        return { ok: false, mensaje: `No encontre a "${input.persona}" en el personal.` };
      }
      if (!enMiAlcance(ctx, r.user)) return { ok: false, mensaje: `${r.user.nombre || 'Esa persona'} no esta en tus sucursales, no puedo mostrarte sus tareas.` };
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

  // ---- PERSONAL: telefono ----
  if (nombre === 'registrar_telefono') {
    // Permiso: quien administra personal (o admin). Es un dato del PERFIL, no una tarea.
    if (!ctx.esAdmin && ctx.perfil.puedeAdministrarPersonal !== true) {
      return { ok: false, mensaje: 'No tienes permiso para editar los datos del personal. Ese permiso (*Administrar personal*) lo activa un administrador.' };
    }
    const r = resolverPersona(ctx, input.persona);
    if (!r.user) {
      if (r.ambiguos.length) return { ok: false, mensaje: `Hay varias personas que coinciden con "${input.persona}": ${r.ambiguos.slice(0, 6).join(', ')}. ¿A cual?` };
      return { ok: false, mensaje: `No encontre a "${input.persona}" en el personal.` };
    }
    if (!enMiAlcance(ctx, r.user)) {
      return { ok: false, mensaje: `${r.user.nombre || 'Esa persona'} no esta en tus sucursales, no puedes editar sus datos.` };
    }

    // Normalizacion: se guardan 10 digitos (Mexico), tolerando +52 / 521 / espacios.
    const crudo = String(input.telefono || '').replace(/\D/g, '');
    const tel = /^52\d{10}$/.test(crudo) ? crudo.slice(2)
      : /^521\d{10}$/.test(crudo) ? crudo.slice(3)
        : crudo;
    if (tel.length !== 10) {
      return { ok: false, mensaje: `"${input.telefono}" no parece un numero de 10 digitos. Dictamelo completo con lada (ej. 352 157 2972).` };
    }

    // NO duplicados: el bot identifica por telefono, dos perfiles con el mismo
    // numero harian que uno de los dos nunca sea reconocido.
    const dueno = ctx.usuarios.find(u => u.id !== r.user.id && u.telefono && ultimos10Tel(u.telefono) === tel);
    if (dueno) {
      return { ok: false, mensaje: `Ese numero ya esta registrado en el perfil de ${dueno.nombre || dueno.correo}. Un numero no puede estar en dos personas (el bot identifica por telefono). Verifica cual es el correcto.` };
    }

    const actual = ctx.usuarios.find(u => u.id === r.user.id) || r.user;
    const anterior = String(actual.telefono || '');
    if (anterior && ultimos10Tel(anterior) === tel) {
      return { ok: true, sin_cambios: true, mensaje: `${r.user.nombre} ya tenia registrado ese numero (${tel}).` };
    }
    if (anterior && !input.reemplazar) {
      return {
        ok: false, requiere_confirmacion: true, telefono_actual: anterior, telefono_nuevo: tel,
        mensaje: `${r.user.nombre} ya tiene el numero ${anterior}. Preguntale al usuario si lo reemplaza por ${tel}; si dice que si, vuelve a llamar con reemplazar=true.`
      };
    }

    await pgUsuarioSetTelefono(r.user.id, tel);
    r.user.telefono = tel; actual.telefono = tel;  // refresca la lista en memoria
    return {
      ok: true, persona: r.user.nombre, telefono: tel, reemplazo: !!anterior,
      mensaje: `Listo, registre el ${tel} para ${r.user.nombre}. Ya le puedo avisar de sus tareas por WhatsApp`
        + ' (el primer aviso en frio necesita la plantilla aprobada; si ella le escribe al bot, le llega de inmediato).'
    };
  }

  if (nombre === 'completar_mi_perfil') {
    // Cada quien completa LO SUYO, y solo lo que este vacio. Nada de pisar datos
    // ya registrados (eso es de un administrador, en Personal).
    if (ctx.esInvitado) return { ok: false, mensaje: 'Primero necesito saber quien eres.' };
    const yo = (ctx.usuarios || []).find(u => u.id === ctx.uid) || ctx.perfil;
    let sucursales = null;
    if (input.sucursal) {
      const todas = new Set();
      (ctx.usuarios || []).forEach(u => sucursalesDe(u).forEach(s => { if (s && s !== 'General (Acceso Total)') todas.add(s); }));
      const lista = Array.from(todas);
      const match = lista.find(s => normaliza(s) === normaliza(input.sucursal))
        || lista.find(s => normaliza(s).includes(normaliza(input.sucursal)) || normaliza(input.sucursal).includes(normaliza(s)));
      if (!match) {
        return { ok: false, mensaje: `No reconozco la sucursal "${input.sucursal}". Las que hay son: ${lista.slice(0, 15).join(', ')}. ¿En cual trabaja?` };
      }
      sucursales = [match];
    }
    const r = await pgUsuarioCompletar(ctx.uid, { cargo: input.puesto, correo: input.correo, sucursales });
    if (!r) return { ok: false, mensaje: 'No encontre tu perfil.' };
    if (!r.puestas.length) {
      return { ok: true, sin_cambios: true, mensaje: 'Esos datos ya los tenias registrados, no cambie nada.' };
    }
    // Refresca lo que ya esta en memoria para este mismo mensaje.
    if (sucursales && yo) yo.sucursales = sucursales;
    if (input.puesto && yo && !String(yo.cargo || '').trim()) yo.cargo = String(input.puesto).trim();
    return {
      ok: true, guardado: r.puestas,
      mensaje: `Guardado: ${r.puestas.join(', ')}. Gracias, con eso tu perfil queda completo en la app.`
    };
  }

  if (nombre === 'personal_sin_telefono') {
    // Es informacion del personal: solo para quien tiene vista de gestion.
    if (!ctx.esGestor) return { ok: false, mensaje: 'Esa informacion del personal la ve un administrador o tu encargado.' };
    const permitidas = esAdminGlobal(ctx.perfil) ? null : sucursalesPermitidas(ctx);
    let gente = ctx.usuarios.filter(u => (u.rol === 'trabajador' || u.rol === 'admin') && u.activo !== false && !String(u.telefono || '').trim());
    if (permitidas) gente = gente.filter(u => sucursalesDe(u).some(s => permitidas.some(p => normaliza(p) === normaliza(s))));
    if (input.sucursal) gente = gente.filter(u => sucursalesDe(u).some(s => normaliza(s) === normaliza(input.sucursal)));
    return {
      ok: true, total: gente.length,
      personas: gente.slice(0, 40).map(u => ({ nombre: u.nombre || u.correo, sucursales: sucursalesDe(u) })),
      mensaje: gente.length
        ? `${gente.length} persona(s) sin telefono registrado: no reciben avisos ni pueden usar el bot. Dictame los numeros y los doy de alta.`
        : 'Todo el personal de tu alcance ya tiene telefono registrado.'
    };
  }

  // ---- ENTREGA DE TAREAS (checklists asignados al colaborador) ----
  if (nombre === 'mis_pendientes') {
    let uid = ctx.uid, quien = ctx.nombre, deOtro = false;
    if (input.persona && normaliza(input.persona) !== normaliza(ctx.nombre)) {
      // Ver lo de OTROS es de gestion (admin o supervisor con permisos), y solo
      // dentro de sus sucursales. Entregar lo propio no pasa por aqui.
      if (!ctx.esGestor) return { ok: false, mensaje: 'Solo puedes ver TUS tareas. Las de otras personas las ve un administrador o tu encargado.' };
      const r = resolverPersona(ctx, input.persona);
      if (!r.user) {
        if (r.ambiguos.length) return { ok: false, mensaje: `Hay varias personas que coinciden con "${input.persona}": ${r.ambiguos.slice(0, 6).join(', ')}. ¿A cual?` };
        return { ok: false, mensaje: `No encontre a "${input.persona}" en el personal.` };
      }
      if (!enMiAlcance(ctx, r.user)) return { ok: false, mensaje: `${r.user.nombre || 'Esa persona'} no esta en tus sucursales, no puedo mostrarte sus tareas.` };
      uid = r.user.id; quien = r.user.nombre || r.user.correo; deOtro = true;
    }
    const { checklists: lista, tareas } = await tareasPlanas(ctx, { uid, nombre: quien, fecha: input.fecha });
    if (!lista.length) {
      return {
        ok: true, total_checklists: 0, total_tareas: 0, pendientes: 0, checklists: [], tareas: [],
        mensaje: (deOtro ? `${quien} no tiene tareas por entregar` : 'No tienes tareas por entregar')
          + (input.fecha ? ` el ${input.fecha}` : ' hoy')
          + (deOtro ? '.' : ' 🎉')
      };
    }
    // CONGELA la numeracion que se le va a leer: "la 67" tiene que seguir siendo
    // esta tarea aunque entre un checklist nuevo en los proximos minutos.
    if (ctx.convKey && !deOtro) {
      try {
        await pgConversacionListaSet(ctx.convKey, {
          en: Date.now(),
          tareas: tareas.map(t => ({ n: t.n, ck: t.checklist_id, it: t.item_id, texto: t.texto })),
        });
      } catch (e) { console.error('[entrega] no pude congelar la lista:', e && e.message); }
    }

    const vistas = lista.map(vistaChecklist);
    const pendientes = tareas.filter(t => !t.hecho);
    const conFoto = pendientes.filter(t => t.pide_foto).length;
    return {
      ok: true, de: quien,
      // `tareas` es la lista que se le debe leer al colaborador: numerada de
      // corrido, sin importar en cuantos checklists vengan repartidas.
      tareas: tareas.map(({ _idx, item_id, ...t }) => t),
      // `total_checklists` y no `total`: el modelo leia `total` (que eran los
      // CHECKLISTS, 14) y le decia a la persona "tienes 14 tareas" cuando en la
      // lista habia 55. Un numero mal nombrado se convierte en un dato falso.
      total_tareas: tareas.length, pendientes: pendientes.length, con_foto: conFoto,
      checklists: vistas, total_checklists: vistas.length,
      mensaje: pendientes.length === 0
        ? `${deOtro ? quien + ' ya' : 'Ya'} tiene todo hecho; falta enviarlo.`
        : `${pendientes.length} tarea(s) pendiente(s)${conFoto ? `, ${conFoto} con foto` : ''}. Leele la lista con SUS numeros.`
    };
  }

  if (nombre === 'entregar_item') {
    // Puede venir: una tarea ("item"), varias ("tareas": ["1","3","7"]) o todas.
    const refs = [];
    if (Array.isArray(input.tareas)) refs.push(...input.tareas);
    if (input.item != null && String(input.item).trim()) refs.push(input.item);
    const quiereTodas = input.todas === true
      || refs.some(x => ['todas', 'todo', 'todos'].includes(normaliza(x)));

    // Con checklist_id explicito y una sola referencia, se trabaja DENTRO de ese
    // checklist (numeracion local, como antes). Si no, se usa la lista PLANA del
    // dia, que es la que ve quien tiene muchas tareas de rutina.
    const local = !!input.checklist_id && !quiereTodas && refs.length <= 1;
    let objetivo = [];   // [{ ck, idx }]
    const cache = new Map();
    const cargar = async (id) => {
      if (!cache.has(String(id))) {
        const ck = await pgChecklistGet(String(id));
        cache.set(String(id), ck);
      }
      return cache.get(String(id));
    };

    if (local) {
      const r = await resolverChecklistDestino(ctx, input.checklist_id);
      if (r.error) return { ok: false, mensaje: r.error, opciones: r.opciones };
      cache.set(String(r.ck.id), r.ck);
      const { idx, ambiguos } = resolverItem(r.ck, refs[0]);
      if (idx < 0) {
        if (ambiguos.length) return { ok: false, mensaje: `¿Cual de estas? ${ambiguos.join(' | ')}` };
        return { ok: false, mensaje: `No encontre esa tarea en "${r.ck.name}".`, checklist: vistaChecklist(r.ck) };
      }
      objetivo.push({ ck: r.ck, idx });
    } else {
      const { tareas } = await tareasPlanas(ctx, {});
      if (!tareas.length) return { ok: false, mensaje: 'No tienes tareas pendientes por entregar.' };

      // Los NUMEROS se resuelven contra la lista CONGELADA (la que la persona
      // acaba de leer). Si se recalculara aqui, un checklist nuevo entrado en
      // los ultimos minutos correria la numeracion y "la 67" cerraria otra cosa.
      let congelada = null;
      if (ctx.convKey) {
        try {
          const l = await pgConversacionListaGet(ctx.convKey);
          // 12 h de vigencia: mas alla de eso la lista ya no es la que vio.
          if (l && Array.isArray(l.tareas) && l.tareas.length && (Date.now() - Number(l.en || 0)) < 12 * 3600 * 1000) {
            congelada = l.tareas;
          }
        } catch (e) { /* sin lista congelada, se usa la de ahora */ }
      }
      const porNumero = (n) => {
        if (congelada) {
          const f = congelada.find(x => Number(x.n) === n);
          if (f) {
            // Se reubica en la lista de AHORA por (checklist, item), no por posicion.
            const t = tareas.find(x => String(x.checklist_id) === String(f.ck) && String(x.item_id) === String(f.it));
            if (t) return { ...t, n };            // conserva el numero que ella leyo
            return { _perdida: true, texto: f.texto, n };
          }
        }
        return tareas.find(x => x.n === n) || null;
      };

      const elegidas = [];
      if (quiereTodas) {
        elegidas.push(...tareas.filter(t => !t.hecho));
        if (!elegidas.length) return { ok: true, ya_estaba: true, mensaje: 'Ya tenias todas hechas; solo falta enviarlas.' };
      } else {
        for (const ref of refs) {
          const txt = String(ref).trim();
          const num = /^#?(\d{1,3})$/.exec(txt);
          let t = null;
          if (num) t = porNumero(parseInt(num[1], 10));
          else {
            // Por TEXTO se busca en la lista de ahora: los nombres no se mueven.
            const obj = normaliza(txt);
            const cands = tareas.filter(x => { const n = normaliza(x.texto); return n === obj || n.includes(obj) || obj.includes(n); });
            if (cands.length > 1) return { ok: false, mensaje: `"${txt}" coincide con varias: ${cands.slice(0, 6).map(c => c.n + '. ' + c.texto).join(' | ')}. ¿Cual?` };
            t = cands[0] || null;
          }
          if (t && t._perdida) {
            return {
              ok: false,
              mensaje: `La ${t.n} ("${t.texto}") ya no está en tu lista de pendientes (puede que ya se haya entregado). Vuelve a leerle sus pendientes con mis_pendientes y confirma el número.`
            };
          }
          if (!t) return { ok: false, mensaje: `No encontre la tarea "${txt}" en tu lista. Vuelve a leerle sus pendientes con mis_pendientes.` };
          elegidas.push(t);
        }
      }
      for (const t of elegidas) {
        const ck = await cargar(t.checklist_id);
        if (!ck || !esMiChecklist(ctx, ck)) continue;
        if (ck.enviado) continue;
        objetivo.push({ ck, idx: t._idx, n: t.n });
      }
      if (!objetivo.length) return { ok: false, mensaje: 'Esas tareas ya se enviaron o no son tuyas.' };
    }

    // Reparto: lo que no pide foto se cierra ya; lo que pide foto entra a la COLA.
    const cerradas = [], yaEstaban = [], cola = [];
    for (const { ck, idx, n } of objetivo) {
      const items = Array.isArray(ck.items) ? ck.items : [];
      const it = items[idx];
      if (!it) continue;
      const etiqueta = { n: n || idx + 1, texto: String(it.text || ''), checklist_id: ck.id };
      if (itemHecho(it)) { yaEstaban.push(etiqueta); continue; }
      if (itemPideEvidencia(it)) {
        const modo = modoEvidencia(it);
        if (!ctx.convKey) {
          return { ok: false, mensaje: `"${it.text}" necesita foto de evidencia, y la foto se manda por WhatsApp o desde la app. Desde aqui no puedo cerrarla.` };
        }
        cola.push({ checklistId: ck.id, itemId: it.id, texto: String(it.text || ''), modo, fase: modo === 'antesDespues' ? 'antes' : null, n: etiqueta.n });
        continue;
      }
      it.checked = true; it.checkedEn = Date.now(); it.checkedPor = 'whatsapp';
      ck.items = items;
      cerradas.push(etiqueta);
    }

    // Un solo guardado por checklist tocado.
    for (const ck of new Set(cerradas.map(c => cache.get(String(c.checklist_id))))) {
      if (!ck) continue;
      recalcularStatus(ck);
      await pgChecklistUpsert(ck.id, ck);
    }

    // La COLA de fotos vive en la conversacion: cada imagen que llegue cierra la
    // siguiente de la fila (lo hace el webhook con registrarFotoEvidencia).
    //
    // OJO: se ACUMULA con lo que ya estuviera esperando. La gente va diciendo
    // "ya hice la 9"... "la 10 y 11"... "la 13" de a poco, y si cada llamada
    // reemplazara la fila, solo la ultima tarea quedaria esperando su foto y las
    // demas se perderian en silencio (paso en produccion).
    // Se lee la fila que YA estaba SIEMPRE, no solo cuando esta llamada agrega
    // fotos: si no, al cerrar una tarea sin evidencia se reportaba "0 en cola"
    // aunque hubiera 3 esperando, y los mensajes del bot se contradecian.
    let previas = [];
    if (ctx.convKey) {
      try {
        const esp = await pgConversacionEsperandoGet(ctx.convKey);
        if (esp && esp.tipo === 'foto' && Array.isArray(esp.cola)) {
          previas = esp.cola.slice(Number(esp.idx || 0));   // las que aun no tienen foto
        }
      } catch (e) { /* sin fila previa */ }
    }
    const llave = (c) => `${c.checklistId}|${c.itemId}`;
    const yaEnFila = new Set(previas.map(llave));
    let colaFinal = [...previas, ...cola.filter(c => !yaEnFila.has(llave(c)))];
    if (cola.length) {
      await pgConversacionEsperandoSet(ctx.convKey, { tipo: 'foto', cola: colaFinal, idx: 0, pedidoEn: Date.now() });
    }

    const { tareas: despues } = await tareasPlanas(ctx, {});
    const faltan = despues.filter(t => !t.hecho).length;
    const primera = colaFinal[0];
    const nuevasEnCola = cola.length;
    return {
      ok: true,
      cerradas, ya_estaban: yaEstaban,
      requiere_foto: colaFinal.length ? (colaFinal.length === 1 ? colaFinal[0].modo : 'varias_tareas') : null,
      fotos_en_cola: colaFinal.length, fotos_agregadas: nuevasEnCola,
      siguiente_foto: primera ? { n: primera.n, texto: primera.texto, fase: primera.fase } : null,
      pendientes: faltan,
      mensaje: [
        cerradas.length ? `Cerre ${cerradas.length} tarea(s): ${cerradas.map(c => c.texto).join(', ')}.` : '',
        yaEstaban.length ? `${yaEstaban.length} ya estaban listas.` : '',
        colaFinal.length === 1
          ? `Falta la FOTO de "${primera.texto}"${primera.fase === 'antes' ? ' (primero la de ANTES)' : ''}: pidesela y la siguiente imagen que mande se guarda ahi.`
          : colaFinal.length > 1
            ? `Hay ${colaFinal.length} tareas esperando FOTO${nuevasEnCola < colaFinal.length ? ' (contando las de antes)' : ''}. Pidele que te las mande UNA POR UNA; la que sigue es "${primera.texto}". Yo las voy colocando en orden y le confirmo cada una.`
            : '',
        !colaFinal.length && faltan === 0 ? 'Ya no le falta nada: preguntale si lo envia (enviar_checklist con todos=true).' : '',
      ].filter(Boolean).join(' ')
    };
  }

  if (nombre === 'enviar_checklist') {
    // --- ENVIAR TODO lo que ya este completo (el caso de quien trabaja por rutinas
    //     y arrastra muchos checklists de una sola tarea cada uno) ---
    if (input.todos === true) {
      const { checklists } = await tareasPlanas(ctx, {});
      if (!checklists.length) return { ok: false, mensaje: 'No tienes nada pendiente por enviar.' };
      const completo = (ck) => { const it = ck.items || []; return it.length > 0 && it.every(itemHecho); };
      const subiendo = checklists.some(ck => (ck.items || []).some(i => i.photo === 'subiendo...' || i.photoAntes === 'subiendo...' || i.photoDespues === 'subiendo...'));
      if (subiendo) return { ok: false, mensaje: 'Hay una foto subiendo todavia. Espera unos segundos e intenta de nuevo.' };

      const listos = checklists.filter(completo);
      const incompletos = checklists.filter(ck => !completo(ck));
      const aEnviar = input.forzar ? checklists : listos;
      if (!aEnviar.length) {
        const queFalta = incompletos.slice(0, 8).flatMap(ck => (ck.items || []).filter(i => !itemHecho(i)).map(i => `${i.text} (${itemFalta(i)})`));
        return {
          ok: false, confirmar: true, faltan: queFalta, total_faltan: incompletos.length,
          mensaje: `Todavia no hay nada completo para enviar. Falta: ${queFalta.join('; ')}. Si aun asi quiere entregar lo que hay, vuelve a llamar con forzar=true.`
        };
      }
      // Justificante: una sola vez, si alguno de los que se van va con retraso.
      const conRetraso = aEnviar.filter(checklistConRetraso);
      let cat = null, com = '';
      if (conRetraso.length) {
        cat = CATEGORIAS_RETRASO.find(c => normaliza(c) === normaliza(input.categoria));
        com = String(input.comentario || '').trim();
        if (!cat || com.length < 5) {
          return {
            ok: false, requiere_justificante: true, categorias: CATEGORIAS_RETRASO, con_retraso: conRetraso.length,
            mensaje: `${conRetraso.length} de esas tareas van con RETRASO (ya paso su hora limite). Para entregarlas necesito el motivo (${CATEGORIAS_RETRASO.join(', ')}) y un comentario de al menos 5 caracteres. Con eso entrego todo de una vez.`
          };
        }
      }
      const enviados = [];
      for (const ck of aEnviar) {
        await marcarEnviado(ctx, ck, { categoria: cat, comentario: com, nota: input.nota });
        enviados.push({ id: ck.id, nombre: ck.name, con_retraso: !!ck.entregaConRetraso });
      }
      // La fila de fotos NO se borra completa: solo salen las entradas de los
      // checklists que de verdad se acabaron de entregar. Antes se limpiaba de
      // golpe, asi que un "Enviar" tiraba las fotos que la persona traia
      // pendientes de OTRAS tareas y el bot se las volvia a pedir desde cero.
      if (ctx.convKey) {
        try {
          const idsEnviados = new Set(enviados.map(e => String(e.id)));
          const esp = await pgConversacionEsperandoGet(ctx.convKey);
          if (esp && Array.isArray(esp.cola)) {
            const quedan = esp.cola.slice(Number(esp.idx || 0)).filter(c => !idsEnviados.has(String(c.checklistId)));
            await pgConversacionEsperandoSet(ctx.convKey, quedan.length ? { tipo: 'foto', cola: quedan, idx: 0, pedidoEn: Date.now() } : null);
            if (quedan.length) console.log(`[entrega] tras enviar quedan ${quedan.length} foto(s) en la fila`);
          }
        } catch (e) { console.error('[entrega] no pude depurar la fila:', e && e.message); }
      }
      const quedan = incompletos.filter(ck => !aEnviar.includes(ck)).length;
      return {
        ok: true, enviados: enviados.length, con_retraso: enviados.filter(e => e.con_retraso).length,
        detalle: enviados.slice(0, 10), pendientes: quedan,
        mensaje: `ENTREGADAS ${enviados.length} tarea(s) a las ${horaEnvioMx()}`
          + (enviados.some(e => e.con_retraso) ? ' (con justificante de retraso).' : '.')
          + (quedan ? ` Le quedan ${quedan} sin completar.` : ' Ya no le queda nada pendiente 🎉')
      };
    }

    // --- Un checklist en concreto ---
    const r = await resolverChecklistDestino(ctx, input.checklist_id);
    if (r.error) return { ok: false, mensaje: r.error, opciones: r.opciones };
    const ck = r.ck;
    const items = Array.isArray(ck.items) ? ck.items : [];

    const subiendo = items.some(i => i.photo === 'subiendo...' || i.photoAntes === 'subiendo...' || i.photoDespues === 'subiendo...');
    if (subiendo) return { ok: false, mensaje: 'Hay una foto subiendo todavia. Espera unos segundos e intenta de nuevo.' };

    // Igual que el front: si faltan items se avisa QUE falta y solo se manda si
    // el colaborador confirma (forzar=true).
    const faltantes = items.map((it, i) => ({ n: i + 1, texto: String(it.text || ''), falta: itemFalta(it), hecho: itemHecho(it) }))
      .filter(x => !x.hecho);
    if (faltantes.length && !input.forzar) {
      return {
        ok: false, confirmar: true, faltan: faltantes.slice(0, 8), total_faltan: faltantes.length,
        mensaje: `Le faltan ${faltantes.length} tarea(s) de "${ck.name}". Dile cuales y preguntale si asi lo envia; si dice que si, vuelve a llamar enviar_checklist con forzar=true.`
      };
    }

    // Retraso: mismo criterio que hayRetrasoEnChecklist() -> justificante obligatorio.
    let cat1 = null, com1 = '';
    if (checklistConRetraso(ck)) {
      cat1 = CATEGORIAS_RETRASO.find(c => normaliza(c) === normaliza(input.categoria));
      com1 = String(input.comentario || '').trim();
      if (!cat1 || com1.length < 5) {
        return {
          ok: false, requiere_justificante: true, categorias: CATEGORIAS_RETRASO,
          mensaje: `"${ck.name}" va con RETRASO (paso la hora limite). Para enviarlo necesito el motivo (una de estas categorias: ${CATEGORIAS_RETRASO.join(', ')}) y un comentario de al menos 5 caracteres explicando que paso.`
        };
      }
    }

    await marcarEnviado(ctx, ck, { categoria: cat1, comentario: com1, nota: input.nota });

    // Si quedo alguna foto "esperando" de este checklist, ya no aplica.
    if (ctx.convKey) {
      try {
        const esp = await pgConversacionEsperandoGet(ctx.convKey);
        const dela = esp && (String(esp.checklistId) === String(ck.id)
          || (Array.isArray(esp.cola) && esp.cola.some(c => String(c.checklistId) === String(ck.id))));
        if (dela) await pgConversacionEsperandoSet(ctx.convKey, null);
      } catch (e) { /* no es critico */ }
    }

    return {
      ok: true, checklist_id: ck.id, status: ck.status,
      con_retraso: !!ck.entregaConRetraso, hora_envio: ck.horaEnvio,
      completadas: items.filter(itemHecho).length, total: items.length,
      mensaje: `Checklist "${ck.name}" ENVIADO a las ${ck.horaEnvio}` +
        (ck.entregaConRetraso ? ' con justificante de retraso.' : '.') +
        ` (${items.filter(itemHecho).length} de ${items.length} tareas)`
    };
  }

  // ---- CHECKLIST ----
  if (nombre === 'crear_checklist') {
    // PERMISO DE ASIGNAR: admin, o quien tenga activado "Crear checklists" en su
    // perfil (mismo flag que usa la app). Entregar no necesita permiso; asignar si.
    if (!ctx.puedeAsignar) {
      return { ok: false, mensaje: 'No tienes permiso para asignar tareas. Un administrador te lo puede activar en Personal (permiso *Crear checklists*). Tus propias tareas si las puedes ver y entregar.' };
    }
    const nombreCk = String(input.nombre || '').trim();
    if (!nombreCk) return { ok: false, mensaje: 'Falta el nombre del checklist.' };

    // Persona responsable
    const r = resolverPersona(ctx, input.para_quien);
    if (!r.user) {
      if (r.ambiguos.length) return { ok: false, mensaje: `Hay varias personas que coinciden con "${input.para_quien}": ${r.ambiguos.slice(0, 6).join(', ')}. ¿A cuál?` };
      return { ok: false, mensaje: `No encontre a "${input.para_quien}" en el personal.` };
    }
    // ALCANCE: quien no es admin global solo asigna a personal de SUS sucursales.
    if (!enMiAlcance(ctx, r.user)) {
      return { ok: false, mensaje: `${r.user.nombre || 'Esa persona'} no esta en tus sucursales, asi que no le puedes asignar tareas.` };
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
      // assignedUid ademas del nombre: hace la entrega por WhatsApp inmune a
      // diferencias de escritura del nombre (el front ya lo prioriza igual).
      assigned, assignedUid: r.user.id, store, date: fecha,
      time: input.hora_limite || '23:59', status: 'pendiente', enviado: false,
      createdBy: ctx.nombre, createdByUid: ctx.uid, notaEmpleado: '', items, subtareas: []
    };
    await pgChecklistUpsert(id, checklist);

    // AVISO AUTOMATICO por WhatsApp al colaborador (plantilla aprobada; si no se
    // puede, texto normal). Mejor esfuerzo: si falla, el checklist ya quedo.
    let avisado = false, avisosOff = false, motivoAviso = null, rebote = null;
    try {
      const notif = require('./tareas-notificar');
      avisosOff = notif.avisosApagados();
      const res = await notif.avisarAsignacion({ ...checklist, id });
      avisado = !!(res && res.ok);
      motivoAviso = res && res.motivo;
      // Meta acepta el envio y avisa el fallo despues. Si la CUENTA viene
      // rebotando (pago pendiente, cuenta bloqueada), no se puede prometer que
      // llego: se dice tal cual en vez de cantar victoria.
      if (avisado && motivoAviso === 'plantilla') rebote = await notif.avisosRebotando();
    } catch (e) { console.error('[tareas-notificar] aviso de asignacion fallo:', e && e.message); }

    // Si el aviso automatico NO salio, dejamos el boton manual de WhatsApp que ya
    // usaba el asistente web (acciones[].whatsapp): asi el admin lo manda a mano.
    let tel = String(r.user.telefono || '').replace(/[^\d]/g, '');
    if (tel.length === 10) tel = '52' + tel;   // Mexico: agrega lada si falta
    const tieneTel = !!tel;
    let whatsapp = null;
    if (!avisado && tieneTel) {
      const appUrl = process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '');
      whatsapp = {
        telefono: tel, nombre: assigned,
        texto: `Hola ${assigned}, te asignaron el checklist "${nombreCk}"${fecha ? ' para el ' + fecha : ''} en ${store}.\n`
          + items.map(i => '- ' + i.text).join('\n')
          + (appUrl ? `\n\nEntra a la app: ${appUrl}` : ''),
      };
    }

    return {
      ok: true, id, avisado, whatsapp,
      mensaje: `Checklist "${nombreCk}" creado para ${assigned} en ${store} el ${fecha} con ${items.length} tarea(s).`
        + (avisado && rebote
          ? ` OJO: mande el aviso a ${assigned}, pero los mensajes del negocio estan REBOTANDO en WhatsApp (${rebote.titulo || 'error ' + rebote.code}${rebote.detalle ? ': ' + rebote.detalle : ''}), asi que seguramente NO le llego. Hay que resolver eso en la cuenta de Meta; mientras, si ${assigned} le escribe al bot, la conversacion si funciona.`
          : avisado ? ` Ya le avise a ${assigned} por WhatsApp.`
          : avisosOff ? ' (Los avisos automaticos por WhatsApp estan apagados ahora mismo, asi que no se le notifico.)'
            : motivoAviso === 'sin_telefono' || !tieneTel
              ? ` (Ojo: ${assigned} NO tiene telefono registrado, asi que NO se le aviso. Si me dictas su numero lo doy de alta con registrar_telefono y desde ahi ya le llegan los avisos.)`
              : motivoAviso === 'sin_plantilla_ni_ventana'
                ? ` (IMPORTANTE: NO se le pudo avisar. WhatsApp no deja escribirle "en frio" mientras la plantilla no este aprobada en Meta, y ${assigned} no le ha escrito al bot en las ultimas 24 horas. Si ella le manda cualquier mensaje al bot, el aviso le llega de inmediato. El checklist SI quedo guardado.)`
                : ` (No se pudo mandar el WhatsApp a ${assigned}; el checklist si quedo guardado.)`)
    };
  }

  // ---- RUTINAS ----
  if (nombre === 'crear_rutina') {
    // PERMISO: admin o quien tenga activado "Crear rutinas" en su perfil.
    if (!ctx.puedeCrearRutinas) {
      return { ok: false, mensaje: 'No tienes permiso para crear rutinas. Un administrador te lo puede activar en Personal (permiso *Crear rutinas*).' };
    }
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
    // Alcance: quien no es admin global solo ve las rutinas de sus sucursales.
    if (!esAdminGlobal(ctx.perfil)) {
      const permitidas = sucursalesPermitidas(ctx);
      lista = lista.filter(a => (a.sucursales || []).some(s => permitidas.some(p => normaliza(p) === normaliza(s))));
    }
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
    // Es informacion de EQUIPO: solo para quien tiene vista de gestion, y a un
    // supervisor/admin limitado se le acota a SUS sucursales.
    let checklists = null;
    const fecha = (input.fecha || ctx.fechaHoy);
    if (fecha && ctx.esGestor) {
      const permitidas = esAdminGlobal(ctx.perfil) ? null : sucursalesPermitidas(ctx);
      if (input.sucursal && permitidas && !permitidas.some(p => normaliza(p) === normaliza(input.sucursal))) {
        return { ok: false, mensaje: `No tienes acceso a la sucursal "${input.sucursal}". Las tuyas son: ${permitidas.join(', ') || '(ninguna)'}.` };
      }
      let docs = (await pgChecklistsPorFecha(fecha)).filter(c => !c.eliminado && !c.archivado);
      if (permitidas) docs = docs.filter(c => permitidas.some(p => normaliza(p) === normaliza(c.store || '')));
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

  if (nombre === 'consultar_mis_pagos') {
    // El modulo de pagos se pide AQUI dentro y no arriba a proposito: hay un
    // ciclo de requires (pagos-notificar -> tareas-notificar -> este archivo) y
    // pedirlo al cargar dejaria uno de los dos a medio construir.
    const { resumenPagosDe, esResponsableDeAlgo } = require('./pagos-notificar');
    // Los pagos se amarran al TELEFONO del responsable, no al usuario de la app:
    // por WhatsApp es el numero de quien escribe; desde la web, el de su perfil.
    const tel = ctx.telefono || (ctx.perfil && ctx.perfil.telefono) || '';
    if (!tel) {
      return { ok: false, mensaje: 'No tengo un teléfono con el que buscar sus pagos. Los recibos se asignan por número: pídele a quien lleva el control de pagos que lo registre.' };
    }
    const r = await resumenPagosDe(tel);
    if (!r.total) {
      // Al corriente y "esto no va contigo" no son lo mismo, y confundirlos hace
      // que alguien se quede tranquilo creyendo que no debe nada.
      const responsable = await esResponsableDeAlgo(tel);
      return responsable
        ? { ok: true, total: 0, mensaje: 'No tiene ningún pago de servicios pendiente: está al corriente 👌' }
        : { ok: true, total: 0, sin_servicios: true, mensaje: 'No aparece como responsable de ningún servicio (luz, agua, internet...), así que no tiene recibos que pagar. Si debería tenerlos, quien lleva el control de pagos se los puede asignar.' };
    }
    return { ok: true, total: r.total, pagos: r.pagos, texto_sugerido: r.texto };
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
    // PERMISOS tomados del perfil de la app (ver bloque PERMISOS arriba).
    // ENTREGAR no lleva permiso: cualquiera entrega lo que le asignaron.
    esGestor: tieneVistaDeGestion(perfil),                    // ve lo de su equipo
    puedeAsignar: perfil.rol === 'admin' || perfil.puedeCrearChecklists === true,
    puedeCrearRutinas: perfil.rol === 'admin' || perfil.puedeCrearRutinas === true,
    canal: opts.canal || 'web', // 'whatsapp' | 'web' — solo por WhatsApp se puede compartir ubicacion
    porVoz: !!opts.porVoz,      // el ultimo mensaje llego como nota de voz transcrita
    // INVITADO: número no registrado en MD Task. Acceso SOLO a flotilla.
    esInvitado: !!opts.esInvitado,
    invitadoNombre: opts.invitadoNombre || null, // null = aún no nos ha dado su nombre
    // Nombre real si resultó ser PERSONAL sin teléfono registrado (no un externo).
    invitadoEsEmpleado: opts.invitadoEsEmpleado || null,
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
      ...(ctx.porVoz ? [
        '- OJO, te habló por NOTA DE VOZ y los nombres son lo que peor se transcribe. Con el nombre se le da de alta en el sistema, así que ANTES de llamar identificar_invitado repítele el nombre y apellido tal como lo entendiste y pídele que confirme. Si te corrige, usa lo que él diga. NUNCA registres un nombre que no te haya confirmado.',
      ] : []),
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
      ctx.invitadoEsEmpleado
        ? `IMPORTANTE: esta persona SÍ es personal de MegaDulces (${ctx.invitadoEsEmpleado}); lo único que pasa es que este número NO está registrado en su perfil, y por eso no puedo ver sus tareas. Si pregunta por sus tareas, NO le digas que no es del personal: explícale que falta dar de alta su número y que su encargado o un administrador puede hacerlo escribiéndole al bot "el numero de ${ctx.invitadoEsEmpleado} es ${ctx.telefono || '...'}"; en cuanto lo hagan verá sus tareas en este mismo chat.`
        : 'NO tiene tareas, checklists ni rutinas. Si pide algo de eso, dile con amabilidad que eso es solo para personal registrado de MD Task.',
      '',
      'Reglas de flotilla:',
      '- Apartar CONFIRMA antes: resume vehículo, fecha, hora de salida y regreso y destino, y pide confirmación. La reserva queda PENDIENTE de que un encargado la apruebe.',
      '- Para salir con un coche debe estar APROBADO. "ya voy a usar el coche" -> registrar_salida; "ya lo entregué" -> registrar_regreso.',
      '- Al registrar salida o regreso se le pedirá su UBICACIÓN por WhatsApp (obligatoria). Solo dile que comparta su ubicación; el botón aparece automáticamente. NO des por hecha la salida/regreso hasta que la comparta.',
      '- Muestra fechas/horas tal como vienen de las herramientas; no inventes horarios.',
      '- Resuelve fechas relativas a YYYY-MM-DD usando la fecha de hoy.',
      ...(ctx.porVoz ? [
        '- Te habló por NOTA DE VOZ (transcrita, puede traer errores): antes de apartar o cancelar algo, repite en una frase lo que entendiste (vehículo, horario, destino) y pide un sí. Para consultas contesta directo.',
      ] : []),
      '- Responde SIEMPRE en español, breve y claro.'
    ].join('\n');
  }

  const sucs = sucursalesPermitidas(ctx);
  // Los permisos vienen del PERFIL de la app (rol + flags puede*), no se inventan
  // aqui. ENTREGAR siempre esta permitido; ASIGNAR y VER LO DE OTROS dependen.
  const global = esAdminGlobal(ctx.perfil);
  const reglaAcceso = [
    global
      ? '- El usuario es ADMINISTRADOR con ACCESO TOTAL: puede asignar a cualquiera, consultar las tareas de cualquier persona (consultar_tareas / mis_pendientes con "persona") y ver estadisticas de cualquier sucursal o de toda la operacion. No digas que no puedes por sucursal: usa los parametros.'
      : ctx.esGestor
        ? `- El usuario es ENCARGADO/SUPERVISOR: puede ver y gestionar lo de SU equipo, pero SOLO en sus sucursales (${sucs.length ? sucs.join(', ') : 'ninguna asignada'}). Si pregunta por alguien de otra sucursal, la herramienta lo va a rechazar: explicaselo con naturalidad.`
        : '- El usuario es COLABORADOR: solo lo SUYO. Puede ver y ENTREGAR sus tareas (mis_pendientes, entregar_item, enviar_checklist) y manejar sus pendientes personales (consultar_tareas sin "persona", completar_tarea, editar_tarea, eliminar_tarea, resumen_hoy). No puede ver las tareas de otras personas ni estadisticas del equipo.',
    ctx.puedeAsignar
      ? '- SI puede ASIGNAR tareas a otros (crear_checklist)' + (global ? '.' : ', pero solo a personal de sus sucursales.')
      : '- NO puede asignar tareas a otras personas ni crear checklists. Si lo pide, dile con amabilidad que ese permiso lo activa un administrador en la pantalla de Personal, y ofrecele lo que si puede: ver y entregar SUS tareas.',
    ctx.puedeCrearRutinas
      ? '- SI puede crear RUTINAS recurrentes (crear_rutina).'
      : '- NO puede crear rutinas recurrentes. Mismo caso: ese permiso lo activa un administrador.',
    '- ENTREGAR SIEMPRE SE PUEDE: cualquier persona, sin importar su rol, puede ver y entregar las tareas que le asignaron. Nunca le digas que necesita permiso para entregar lo suyo.',
  ].join('\n');
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
    '- CONFIRMA ANTES DE ESCRIBIR: antes de crear o asignar (crear_checklist y crear_rutina) RESUME en una frase que haras y a quien, y pide confirmacion. Ej: "Voy a crear el checklist [nombre] para [persona] en [sucursal] el [fecha] con estos items: ... ¿Confirmo?". Llama la herramienta SOLO despues de que el usuario diga si/confirme. Si menciona a una persona y no estas 100% seguro de quien es, di a quien entendiste y pide que confirme. Para consultas, resumenes y estadisticas (solo lectura) NO pidas confirmacion: hazlo directo.',
    '- CREAR siempre es un CHECKLIST: para crear cualquier cosa usa crear_checklist (escribe en la coleccion checklists, NUNCA en la agenda). Arma los items de lo que el admin dicte: una tarea suelta = item tipo "manual"; una rutina (ej. "todos los lunes...") = item tipo "rutina" con frecuencia y dia_semana. Pide nombre, persona, sucursal, fecha e items si faltan, antes de confirmar.',
    '- Usa las herramientas para EJECUTAR de verdad; no digas que hiciste algo sin llamarlas.',
    '- Para completar/editar/eliminar una tarea, primero usa consultar_tareas para obtener el id.',
    '- Para crear_rutina necesitas: nombre, frecuencia, sucursales y modo (porRol con rol_objetivo, o porPersonas con personas). Si falta algo, preguntalo corto antes de crear.',
    '- TURNOS (Canindo): algunas personas solo pueden recibir tareas dentro de su turno (manana/tarde). Si crear_checklist devuelve que la persona esta "fuera de turno", NO insistas: explicale al admin que esta fuera de su horario y que, si por necesidad debe trabajar otro turno, puede registrar una excepcion en la pantalla de Turnos de Canindo.',
    '- Al crear un checklist el sistema le AVISA SOLO por WhatsApp a la persona asignada. No le digas al admin que lo reenvie a mano; si el aviso no salio (avisado=false), dilo tal cual.',
    '- TELEFONO: sin numero registrado esa persona NO recibe avisos ni puede usar el bot. Si te dictan un numero ("el de Fatima es 352..."), NO lo ignores: confirma el nombre y el numero en una frase y usa registrar_telefono. Si te preguntan a quien le falta, usa personal_sin_telefono.',
    '- SI FALTAN DATOS DE SU PERFIL (te lo dice el sistema): preguntaselos con naturalidad, de uno en uno y sin interrogar, y guardalos con completar_mi_perfil. Es para llenar huecos de SU propio perfil; lo que ya tiene registrado no se toca.',
    '',
    'ENTREGAR TAREAS (lo que el colaborador tiene que hacer hoy):',
    '- "que tengo que hacer", "mis tareas", "que me falta" -> mis_pendientes. Leele la lista de "tareas" con SUS numeros y su hora limite; esa numeracion es la unica que debes usar. NO le hables de "checklists": para el son TAREAS (las rutinas llegan como muchos checklists de una sola tarea).',
    '- La lista trae SOLO LAS DE HOY. Si te pide las de otro dia ("las del lunes", "las que no entregue el sabado"), llama mis_pendientes con `fecha` en YYYY-MM-DD. Nunca le digas que arrastra tareas viejas si no se lo has consultado con fecha.',
    '- Cuando cuentes cuantas tiene, usa `pendientes` (las tareas que le faltan), NO `total_checklists`: son cosas distintas y confundirlas le da un numero falso.',
    '- "ya hice la 2" -> entregar_item item:"2". "ya hice la 1, 3 y 7" -> entregar_item tareas:["1","3","7"]. "ya termine todo" -> entregar_item todas:true. Si no tienes los numeros frescos, llama mis_pendientes primero.',
    '- FOTOS EN FILA: las tareas que piden foto NO se cierran al marcarlas; entran a una fila. Si te devuelve fotos_en_cola, pidele las fotos UNA POR UNA empezando por siguiente_foto. Cada imagen que mande se guarda sola y el sistema le confirma el avance ("3 de 12") y le pide la siguiente: TU no tienes que hacer nada entre fotos. Si es antes/despues, primero la de ANTES.',
    '- Cuando termina la fila de fotos, el sistema ENTREGA SOLO todo lo que quedo completo y a tiempo. No prometas que lo enviaras tu ni vuelvas a llamar enviar_checklist si el sistema ya lo entrego.',
    '- ENVIAR a mano: si ya no le falta nada y no hubo fila de fotos, usa enviar_checklist con todos=true (entrega todo lo que este completo). Si faltan cosas y aun asi quiere entregar, vuelve a llamar con forzar=true.',
    '- Si pide justificante (ya paso la hora limite), pidele el MOTIVO (una de las categorias que te devuelve) y una explicacion corta, y vuelve a llamar con categoria y comentario. Con eso entrega todo de una vez.',
    '- Nunca marques ni envies tareas de otra persona: cada quien entrega las suyas.',
    ...(ctx.porVoz ? [
      '',
      'LLEGO POR NOTA DE VOZ (transcrita, puede traer errores):',
      '- Los NUMEROS y los NOMBRES son lo que peor se transcribe ("la 3" vs "la 13", "Fatima" vs "Fabiola"). Antes de CERRAR, ENVIAR, APARTAR o ASIGNAR algo, repite en una frase corta lo que entendiste y pide un si. Ej: "Entendi que ya hiciste la 3 y la 7, ¿va?".',
      '- Para consultas y resumenes (solo leer) NO confirmes nada: contesta directo.',
      '- Si la transcripcion quedo confusa o incompleta, no adivines: di lo que alcanzaste a entender y preguntale.',
    ] : []),
    '',
    'FLOTILLA (vehiculos):',
    '- Cualquier colaborador puede: ver los coches (consultar_vehiculos), APARTAR uno (apartar_vehiculo), ver/cancelar SUS reservas (consultar_mis_reservas, cancelar_reserva) y registrar su salida/regreso (registrar_salida, registrar_regreso).',
    '- Apartar CONFIRMA antes: resume vehiculo, fecha, hora de salida y regreso y destino, y pide confirmacion. La reserva nace PENDIENTE y el sistema avisa AUTOMATICAMENTE a los encargados autorizados para que la aprueben; NO hace falta que tu hagas nada mas.',
    '- APROBAR/RECHAZAR solicitudes SOLO lo pueden hacer los encargados autorizados (por su numero de WhatsApp), y NUNCA el propio solicitante. NO ofrezcas aprobar las reservas del usuario ni uses aprobar_reserva por el; si te lo pide, explicale que su solicitud ya fue enviada a los encargados y que ellos la autorizan. Las herramientas reservas_pendientes/aprobar_reserva solo funcionan si quien escribe es un encargado autorizado.',
    '- Para salir con un coche debe estar APROBADO. "ya voy a usar el coche/la camioneta" -> registrar_salida; "ya lo entregue/regrese" -> registrar_regreso.',
    ctx.canal === 'whatsapp'
      ? '- Al registrar salida o regreso, el sistema le pedira su UBICACION por WhatsApp (es obligatoria para dejar constancia). Solo dile con naturalidad que comparta su ubicacion; el boton para enviarla aparece automaticamente. NO registres la salida/regreso como hecha hasta que comparta la ubicacion.'
      : '- Registrar salida/regreso con ubicacion se hace desde WhatsApp (ahi el colaborador comparte su ubicacion). Desde aqui solo consulta o gestiona reservas.',
    '',
    'PAGOS DE SERVICIOS (luz, agua, internet, gas, renta):',
    '- Si pregunta si debe algun recibo o servicio ("tengo algun pago pendiente", "que recibos me tocan", "ya pague todo"), usa consultar_mis_pagos. NUNCA contestes de memoria: los recibos cambian cada mes.',
    '- Solo ves los servicios de los que ESA persona es responsable. Si no es responsable de ninguno, dilo tal cual; no inventes recibos ni prometas revisarlo despues.',
    '- Para REPORTAR un pago no necesitas herramienta: dile que mande aqui mismo la *foto o el PDF del comprobante* y el sistema lo guarda y le pregunta el monto.',
    '- No confundas esto con las TAREAS: "que tengo pendiente" del trabajo es mis_pendientes; los recibos son consultar_mis_pagos. Si no queda claro cual pregunta, pregunta tu.',
    '',
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
module.exports.pgConversacionTocar = pgConversacionTocar;
// Flotilla: finalizar captura de ubicacion cuando llega un mensaje `location`.
module.exports.registrarUbicacion = registrarUbicacion;
// ENTREGA DE TAREAS: guardar la foto de evidencia cuando llega un mensaje `image`.
module.exports.registrarFotoEvidencia = registrarFotoEvidencia;
module.exports.pgConversacionEsperandoGet = pgConversacionEsperandoGet;
module.exports.pgConversacionEsperandoSet = pgConversacionEsperandoSet;
// Datos y criterios que reusa el modulo de avisos (api/tareas-notificar.js), para
// que "item hecho", "vencido" y la hora de Mexico tengan UNA sola definicion.
module.exports.pgChecklistsDeUsuario = pgChecklistsDeUsuario;
module.exports.pgChecklistsPendientesDeFecha = pgChecklistsPendientesDeFecha;
module.exports.itemHecho = itemHecho;
module.exports.itemVencido = itemVencido;
module.exports.mismoNombreEmpleado = mismoNombreEmpleado;
module.exports.epochDeMx = epochDeMx;
module.exports.ahoraMexico = ahoraMexico;
// Expuesto para pruebas/arneses server-side (no lo usa el flujo normal).
module.exports.ejecutarHerramienta = ejecutarHerramienta;
