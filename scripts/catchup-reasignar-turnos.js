// ============================================================================
//  CATCH-UP de una sola vez: reasigna las TAREAS pendientes de ESTA SEMANA
//  (de hoy en adelante) cuyo asignado quedo fuera de turno o en descanso, al
//  primer disponible de la misma sucursal. Replica la logica del feature de
//  reasignacion (reasignacion-turnos.util.ts) portada a JS.
//
//  Alcance: tareas NO rutina y NO propias (wizard de Checklist + Espacio TEC).
//  Solo pendientes (no enviadas, no completadas, no eliminadas/archivadas).
//  NO envia notificaciones (es un ajuste masivo); reporta lo que cambia.
//
//  Uso:
//    DRY-RUN (no escribe):  railway run bash -c "DATABASE_URL='<publica>' node scripts/catchup-reasignar-turnos.js"
//    APLICAR:               ...misma linea... APLICAR=1 node scripts/catchup-reasignar-turnos.js
// ============================================================================
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('../api/db');

const APLICAR = process.env.APLICAR === '1';

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT.');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

// ---- helpers portados (permisos.util / descansos.util / turnos.util) ----
function normalizarNombre(n) {
  if (!n) return '';
  return String(n).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}
function obtenerSemanaISO(fecha) {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-${String(weekNum).padStart(2, '0')}`;
}
function obtenerNombreDia(fecha) {
  return ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][fecha.getDay()];
}
function esDiaDescansoEnFecha(fecha, descansosDelUsuario) {
  const semana = obtenerSemanaISO(fecha), nombreDia = obtenerNombreDia(fecha);
  const doc = descansosDelUsuario.find(d => d.semanaISO === semana);
  return !!(doc && doc.dias && doc.dias.includes(nombreDia));
}
function fechaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function aMinutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : NaN;
}
function lunesISO(iso) {
  const [y, m, dia] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dia));
  const dow = dt.getUTCDay(); const diff = dow === 0 ? 6 : dow - 1;
  dt.setUTCDate(dt.getUTCDate() - diff);
  return dt.toISOString().split('T')[0];
}
function semanasEntre(aISO, bISO) {
  const a = new Date(lunesISO(aISO) + 'T00:00:00Z').getTime();
  const b = new Date(lunesISO(bISO) + 'T00:00:00Z').getTime();
  return Math.round((b - a) / (7 * 24 * 3600 * 1000));
}
function grupoBaseDeUsuario(config, uid) {
  if (!config || !uid) return null;
  if ((config.grupoManana || []).some(m => m.uid === uid)) return 'manana';
  if ((config.grupoTarde || []).some(m => m.uid === uid)) return 'tarde';
  return null;
}
function excepcionActiva(config, uid, diaISO) {
  if (!config || !config.excepciones) return null;
  return config.excepciones.find(e => e.uid === uid && e.desde <= diaISO && diaISO <= e.hasta) || null;
}
function turnoEfectivo(config, uid, diaISO) {
  const base = grupoBaseDeUsuario(config, uid);
  if (base === null) return null;
  const exc = excepcionActiva(config, uid, diaISO);
  if (exc) return exc.turno;
  if (config.rotacionAutomatica) {
    const semanas = semanasEntre(config.semanaBase, diaISO);
    if ((((semanas % 2) + 2) % 2) === 1) return base === 'manana' ? 'tarde' : 'manana';
  }
  return base;
}
function rutinaPermitidaEnTurno(config, uid, diaISO, hora) {
  if (!config || !config.habilitado) return true;
  const turno = turnoEfectivo(config, uid, diaISO);
  if (turno === null) return true;
  const min = aMinutos(hora || '');
  if (isNaN(min) || (hora || '').trim() === '23:59') return true;
  const h = config.horarios && config.horarios[turno];
  const ini = aMinutos(h && h.inicio), fin = aMinutos(h && h.fin);
  if (isNaN(ini) || isNaN(fin)) return true;
  return min >= ini && min <= fin;
}

// ---- carga de datos ----
async function cargarUsuarios() {
  const r = await query('select id, nombre, rol, cargo, datos from mdtask_usuarios');
  return r.rows.map(u => {
    const d = u.datos || {};
    return { id: u.id, nombre: u.nombre, rol: u.rol, cargo: u.cargo, sucursales: d.sucursales, sucursal: d.sucursal };
  });
}
async function cargarDescansos(semanaISO) {
  const r = await query('select user_id, semana_iso, datos from mdtask_descansos_semanales where semana_iso = $1', [semanaISO]);
  return r.rows.map(x => ({ userId: x.user_id, semanaISO: x.semana_iso, dias: (x.datos || {}).dias || [] }));
}

function esRutinaOPropia(c) {
  const d = c.datos || {};
  if (c.asignacion_id || c.catalogo_rutina_id || d._v2 || d._asignacionId || d._catalogoRutinaId) return true; // robot
  if (d.esTareaPropia === true || d._rutinaPersonalId) return true; // personal
  if (/\((Diaria|Semanal|Catorcenal|Mensual|Trimestral)\)$/.test(c.name || '')) return true; // rutina V1
  return false;
}

async function main() {
  if (!dbConfigurada()) throw new Error('DATABASE_URL no configurada.');
  initAdmin();

  // Rango: de HOY al domingo de esta semana (las que ya pasaron no tiene caso mover).
  const now = new Date();
  const hoyStr = fechaISO(now);
  const domingo = new Date(now); domingo.setDate(now.getDate() + (7 - (now.getDay() || 7)));
  const hastaStr = fechaISO(domingo);
  const semana = obtenerSemanaISO(now);

  const usuarios = await cargarUsuarios();
  const nombreAUid = new Map();
  for (const u of usuarios) { if (u.id && u.nombre) nombreAUid.set(normalizarNombre(u.nombre), u.id); }
  const descansos = await cargarDescansos(semana);

  // config/turnos desde Postgres (Etapa 9): ya no depende de la cuota de Firestore.
  let configTurnos = null;
  try {
    const cf = await query("select datos from mdtask_config where id = 'turnos'");
    if (cf.rows[0]) configTurnos = cf.rows[0].datos;
  } catch (e) { console.error('config/turnos (pg):', e.message); }

  const r = await query(
    `select * from mdtask_checklists
      where fecha >= $1 and fecha <= $2
        and coalesce(enviado,false) = false
        and coalesce(eliminado,false) = false
        and coalesce(archivado,false) = false
        and coalesce(status,'') <> 'completo'`,
    [hoyStr, hastaStr]
  );

  const disponible = (nombre, fechaDate, hora) => {
    const uid = nombreAUid.get(normalizarNombre(nombre));
    if (uid && esDiaDescansoEnFecha(fechaDate, descansos.filter(d => d.userId === uid))) return false;
    if (configTurnos && configTurnos.habilitado && uid && !rutinaPermitidaEnTurno(configTurnos, uid, fechaISO(fechaDate), hora)) return false;
    return true;
  };
  const primerDisponible = (sucursal, fechaDate, hora) => {
    const objetivo = normalizarNombre(sucursal), comodin = normalizarNombre('General (Acceso Total)');
    for (const u of usuarios) {
      if (u.rol !== 'trabajador' && u.rol !== 'admin') continue;
      const sucs = (u.sucursales && u.sucursales.length) ? u.sucursales : (u.sucursal ? [u.sucursal] : []);
      if (!sucs.some(s => { const n = normalizarNombre(s); return n === objetivo || n === comodin; })) continue;
      if (!disponible(u.nombre, fechaDate, hora)) continue;
      return u.nombre;
    }
    return null;
  };

  const cambios = [];
  let sinReemplazo = 0, revisadas = 0;
  for (const c of r.rows) {
    if (esRutinaOPropia(c)) continue;
    if (!c.assigned) continue;
    revisadas++;
    const fechaDate = new Date((c.fecha || hoyStr) + 'T12:00:00');
    const hora = c.hora || '23:59';
    if (disponible(c.assigned, fechaDate, hora)) continue;      // el asignado si puede -> nada
    const nuevo = primerDisponible(c.store, fechaDate, hora);
    if (!nuevo || normalizarNombre(nuevo) === normalizarNombre(c.assigned)) { sinReemplazo++; continue; }
    cambios.push({ id: c.id, name: c.name, store: c.store, fecha: c.fecha, hora: c.hora, de: c.assigned, a: nuevo,
      nuevoUid: nombreAUid.get(normalizarNombre(nuevo)) || null });
  }

  console.log(`[catchup] rango ${hoyStr}..${hastaStr} (semana ${semana}) | tareas candidatas: ${revisadas} | a reasignar: ${cambios.length} | sin reemplazo: ${sinReemplazo}`);
  for (const x of cambios) console.log(`  - [${x.store}] "${x.name}" (${x.fecha} ${x.hora || ''}) : ${x.de} -> ${x.a}`);

  if (!APLICAR) { console.log('\n[catchup] DRY-RUN (no se escribio nada). Para aplicar: APLICAR=1'); return; }

  let ok = 0;
  for (const x of cambios) {
    const extra = JSON.stringify({ reasignadoTurno: true, asignadoOriginal: x.de });
    await query('update mdtask_checklists set assigned=$1, assigned_uid=$2, datos = coalesce(datos,\'{}\'::jsonb) || $3::jsonb where id=$4',
      [x.a, x.nuevoUid, extra, String(x.id)]);
    await admin.firestore().collection('checklists').doc(String(x.id))
      .set({ assigned: x.a, assignedUid: x.nuevoUid, reasignadoTurno: true, asignadoOriginal: x.de }, { merge: true });
    ok++;
  }
  console.log(`\n[catchup] APLICADO. tareas reasignadas: ${ok}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[catchup] ERROR:', e.message); process.exit(1); });
