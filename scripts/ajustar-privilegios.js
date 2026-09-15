// ============================================================================
//  BAJAR LOS PRIVILEGIOS AL PUESTO  —  EN SECO POR OMISION
//
//  Aplica `scripts/privilegios-por-puesto.js` a las fichas de `mdtask_usuarios`.
//  Instruccion de David (14/sep/2026): los administradores quedan «como usuarios
//  simples de acuerdo a su puesto».
//
//  ─── LA REVERSA SE ESCRIBE ANTES QUE LA IDA (§8.3) ────────────────────────
//  `--aplicar` guarda PRIMERO un respaldo JSON con el `datos`, `rol` y `alcance`
//  de cada ficha que va a tocar; si el respaldo no queda escrito, no escribe
//  nada en la base. `--revertir <archivo>` deja todo exactamente como estaba.
//  Ademas NO sobrescribe en silencio (§5.5): cada cambio deja un evento en
//  `datos._historialPermisos[]` con fecha, autor y que banderas se fueron.
//
//  ─── NO INVENTA PUESTOS (§8.5) ────────────────────────────────────────────
//  Una ficha sin `puestoId`, o con un puesto que no este en el mapa, NO SE
//  TOCA: sale listada como pendiente. Adivinar por el `cargo` —que es texto
//  libre— es como nacen los duplicados de identidad de este proyecto.
//
//  ─── GUARDIAS (§8.11) ─────────────────────────────────────────────────────
//  Imprime cuantas fichas leyo antes de concluir y aborta si son cero; busca el
//  schema (las tablas viven en `eajd`, no en `public`: ahi 0 filas no da error);
//  y aborta si el plan tocaria la ficha del dueño dejandola sin `rol: admin`,
//  porque esa es la unica cuenta nominal que va a quedar.
//
//  USO:
//    node scripts/ajustar-privilegios.js                 # plan en seco
//    node scripts/ajustar-privilegios.js --aplicar       # escribe, con respaldo
//    node scripts/ajustar-privilegios.js --revertir <archivo.json>
//  (necesita DATABASE_URL en el entorno; nunca la imprime)
// ============================================================================
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { GESTION, PERFILES, POR_PUESTO } = require('./privilegios-por-puesto');

const CORREO_DUENO = 'davidcisneros2209@outlook.es';
const APLICAR  = process.argv.includes('--aplicar');
// ─── SOLO QUITA, SALVO QUE SE PIDA LO CONTRARIO ───────────────────────────
// El primer plan en seco (14/sep) PONIA banderas a 17 personas que hoy no las
// tienen, porque el mapa describe un destino y el codigo lo aplicaba en las dos
// direcciones. Eso es una ESCALADA de privilegios colada en un paso que iba de
// bajarlos: David pidio dejar a los administradores como usuarios simples, no
// repartir accesos nuevos. Por omision el script solo QUITA lo que sobra; dar
// lo que falta exige pedirlo a proposito, y entonces se lista aparte.
const COMPLETAR = process.argv.includes('--completar');
// ─── LOS ADMINS SIN PUESTO, POR ORDEN EXPRESA ─────────────────────────────
// Por omision una ficha sin `puestoId` NO se toca (§8.5): el mapa no puede
// clasificarla y el `cargo` es texto libre. Pero cuatro de los seis admins del
// censo del 14/sep estan justo ahi —«Director General», «Trabajador General»,
// «Auxiliar de encargado»— asi que sin esta regla el paso no cumpliria lo que
// David pidio. Con este interruptor, un admin sin puesto mapeado pasa a
// trabajador SIN ninguna bandera de gestion. No adivina su puesto: lo deja como
// usuario simple, que es el lado seguro del error — y el puesto se le asigna
// despues, en su ficha, con la pantalla de Usuarios.
// El dueño NUNCA entra aqui: su ficha se reconoce por correo y conserva admin.
const BAJAR_SIN_PUESTO = process.argv.includes('--bajar-admins-sin-puesto');
const REVERTIR = process.argv.includes('--revertir') ? process.argv[process.argv.indexOf('--revertir') + 1] : null;

function abortar(msg) {
  console.error('\n[privilegios] ABORTA: ' + msg);
  console.error('[privilegios] No se escribio nada. No concluyas de esta corrida.');
  process.exit(2);
}

/** El schema donde de verdad viven las tablas. Ver la cabecera del censo. */
async function schemaDeMdtask(c) {
  const cand = await c.query(
    `select table_schema from information_schema.tables where table_name = 'mdtask_usuarios'`);
  if (!cand.rows.length) abortar('no existe `mdtask_usuarios` en ningun schema de esta base.');
  const conteos = [];
  for (const r of cand.rows) {
    const n = await c.query(`select count(*)::int n from "${r.table_schema}".mdtask_usuarios`);
    conteos.push({ schema: r.table_schema, filas: n.rows[0].n });
  }
  conteos.sort((a, b) => b.filas - a.filas);
  console.log(`[privilegios] schemas: ${conteos.map(x => `${x.schema}=${x.filas}`).join(' · ')} → se usa ${conteos[0].schema}`);
  if (conteos[0].filas === 0) abortar('cero fichas en todos los schemas: es un fallo de lectura, no "no hay nadie".');
  return conteos[0].schema;
}

(async () => {
  if (!process.env.DATABASE_URL) abortar('falta DATABASE_URL en el entorno.');
  const esInterna = /railway\.internal/.test(process.env.DATABASE_URL);
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: esInterna ? false : { rejectUnauthorized: false },
  });
  await c.connect();
  const S = await schemaDeMdtask(c);

  // ── REVERTIR ────────────────────────────────────────────────────────────
  if (REVERTIR) {
    const respaldo = JSON.parse(fs.readFileSync(REVERTIR, 'utf8'));
    console.log(`[privilegios] revirtiendo ${respaldo.fichas.length} fichas del respaldo ${path.basename(REVERTIR)}`);
    let n = 0;
    for (const f of respaldo.fichas) {
      await c.query(`update "${S}".mdtask_usuarios set rol=$2, alcance=$3, datos=$4 where id=$1`,
        [f.id, f.rol, f.alcance, f.datos]);
      n++;
    }
    console.log(`[privilegios] revertidas ${n} fichas. Estado identico al de antes de aplicar.`);
    await c.end();
    return;
  }

  const q = await c.query(`
    select id, nombre, usuario, correo, rol, alcance, activo, cargo,
           datos->>'puestoId' as puesto_id, datos
      from "${S}".mdtask_usuarios
     where activo is not false
     order by lower(coalesce(nombre,''))`);
  console.log(`[privilegios] fichas activas leidas: ${q.rows.length}`);
  if (q.rows.length === 0) abortar('cero fichas activas.');

  const plan = [];
  const pendientes = [];
  const faltantes = [];   // les FALTA algo del perfil: se reporta, no se aplica
  for (const r of q.rows) {
    const esDueno = String(r.correo || '').trim().toLowerCase() === CORREO_DUENO;
    const puesto = (r.puesto_id || '').trim();
    const perfilId = POR_PUESTO[puesto];
    if (!perfilId) {
      const tiene = GESTION.filter(b => r.datos && r.datos[b] === true);
      // Admin sin puesto + orden expresa: baja a usuario simple.
      if (r.rol === 'admin' && !esDueno && BAJAR_SIN_PUESTO) {
        plan.push({ id: r.id, nombre: r.nombre, puesto: puesto || '(sin puesto)',
                    perfilId: 'operativo', etiqueta: PERFILES.operativo.etiqueta, faltan: [],
                    rolAntes: r.rol, rolDespues: 'trabajador',
                    alcAntes: r.alcance, alcDespues: null,
                    quitar: tiene, poner: [], datos: r.datos, esDueno: false });
        continue;
      }
      // Sin puesto o puesto fuera del mapa: NO SE TOCA. Solo se reporta.
      if (r.rol === 'admin' || tiene.length) {
        pendientes.push({ ...r, motivo: puesto ? `puesto "${puesto}" no esta en el mapa` : 'sin puestoId', tiene });
      }
      continue;
    }
    const p = PERFILES[perfilId];
    const tiene = GESTION.filter(b => r.datos && r.datos[b] === true);
    const debe  = p.banderas;
    const quitar = tiene.filter(b => !debe.includes(b));
    const faltan = debe.filter(b => !tiene.includes(b));
    const poner  = COMPLETAR ? faltan : [];
    const rolNuevo = p.rol;
    // `alcance` SOLO significa algo en un admin (`permisos.util.ts`: "solo aplica
    // a rol === 'admin'"). En un trabajador es ruido heredado, y normalizarlo
    // tocaria 70 fichas para no cambiar ni un permiso — mas riesgo que valor.
    const tocaAlcance = r.rol === 'admin' || rolNuevo === 'admin';
    const alcNuevo = tocaAlcance ? p.alcance : (r.alcance || null);
    const cambiaRol = (r.rol || '') !== rolNuevo || (r.alcance || null) !== alcNuevo;
    if (!quitar.length && !poner.length && !cambiaRol) {
      if (faltan.length) faltantes.push({ nombre: r.nombre, puesto, faltan });
      continue;
    }

    // GUARDIA: el dueño no puede salir de aqui sin rol admin.
    if (esDueno && rolNuevo !== 'admin') {
      abortar(`el plan dejaria a la cuenta dueña (${r.nombre}) sin rol admin. Es la unica cuenta nominal.`);
    }
    plan.push({ id: r.id, nombre: r.nombre, puesto, perfilId, etiqueta: p.etiqueta, faltan,
                rolAntes: r.rol, rolDespues: rolNuevo, alcAntes: r.alcance, alcDespues: alcNuevo,
                quitar, poner, datos: r.datos, esDueno });
  }

  // ── GUARDIA: LA APP NO PUEDE QUEDARSE SIN ADMINISTRADORES ───────────────
  // Quitar el rol a granel es exactamente como se deja a una empresa fuera de su
  // propia app. Se cuenta cuantos admins quedarian DESPUES de aplicar el plan, y
  // si no queda ninguno, no se escribe nada. El dueño cuenta aparte porque se
  // reconoce por correo, no por el rol de su ficha.
  const adminsAhora = q.rows.filter(r => r.rol === 'admin').length;
  const bajados = plan.filter(p => p.rolAntes === 'admin' && p.rolDespues !== 'admin').length;
  const subidos = plan.filter(p => p.rolAntes !== 'admin' && p.rolDespues === 'admin').length;
  const adminsDespues = adminsAhora - bajados + subidos;
  console.log(`[privilegios] administradores: ${adminsAhora} ahora → ${adminsDespues} despues (bajan ${bajados}, suben ${subidos})`);
  if (adminsDespues < 1) abortar('el plan dejaria la app SIN NINGUN administrador.');

  // ── EL PLAN, SIEMPRE IMPRESO ────────────────────────────────────────────
  console.log(`\n══════ PLAN: ${plan.length} fichas cambian · ${pendientes.length} quedan pendientes ══════`);
  const porPerfil = {};
  plan.forEach(p => (porPerfil[p.perfilId] = porPerfil[p.perfilId] || []).push(p));
  for (const [perfilId, filas] of Object.entries(porPerfil)) {
    console.log(`\n── ${PERFILES[perfilId].etiqueta} (${filas.length}) ──`);
    for (const f of filas) {
      const rol = f.rolAntes !== f.rolDespues ? `  ROL ${f.rolAntes} → ${f.rolDespues}` : '';
      const alc = (f.alcAntes || null) !== f.alcDespues ? `  alcance ${f.alcAntes || '(ausente)'} → ${f.alcDespues || '(ninguno)'}` : '';
      console.log(`   ${f.nombre}  [${f.puesto}]${rol}${alc}`);
      if (f.quitar.length) console.log(`      − quita: ${f.quitar.join(', ')}`);
      if (f.poner.length)  console.log(`      + pone:  ${f.poner.join(', ')}`);
      if (!COMPLETAR && f.faltan.length) console.log(`      (le falta, NO se le da: ${f.faltan.join(', ')})`);
    }
  }
  if (pendientes.length) {
    console.log(`\n══════ PENDIENTES — NO SE TOCAN (§8.5) ══════`);
    for (const r of pendientes) {
      console.log(`   ${r.nombre}  rol=${r.rol}  ${r.motivo}  ·  cargo="${r.cargo || '-'}"  ·  gestion: ${r.tiene.length ? r.tiene.length + ' banderas' : '-'}`);
    }
    console.log('   → hay que decidir su puesto antes de poder aplicarles nada.');
  }

  if (faltantes.length) {
    console.log(`
══════ LES FALTA ALGO DE SU PERFIL — NO SE LES DA (seria escalada) ══════`);
    faltantes.forEach(f => console.log(`   ${f.nombre}  [${f.puesto}]  le falta: ${f.faltan.join(', ')}`));
    console.log('   → si Direccion quiere darselo, se corre con --completar.');
  }

  if (!APLICAR) {
    console.log(`\n[privilegios] EN SECO. No se escribio nada. Para aplicar: --aplicar`);
    await c.end();
    return;
  }

  // ── APLICAR, con el respaldo ESCRITO ANTES ──────────────────────────────
  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(__dirname, '..', `respaldo-privilegios-${sello}.json`);
  fs.writeFileSync(destino, JSON.stringify({
    generado: new Date().toISOString(), schema: S,
    fichas: plan.map(p => ({ id: p.id, nombre: p.nombre, rol: p.rolAntes, alcance: p.alcAntes, datos: p.datos })),
  }, null, 2));
  console.log(`\n[privilegios] respaldo escrito: ${path.basename(destino)} (${plan.length} fichas)`);
  if (!fs.existsSync(destino)) abortar('el respaldo no quedo escrito.');

  let n = 0;
  for (const f of plan) {
    const datos = { ...(f.datos || {}) };
    for (const b of f.quitar) datos[b] = false;
    for (const b of f.poner)  datos[b] = true;
    datos._historialPermisos = [...(datos._historialPermisos || []), {
      fecha: new Date().toISOString(),
      autor: 'ajustar-privilegios.js (instruccion de Direccion, 14/sep/2026)',
      perfil: f.perfilId, quitadas: f.quitar, puestas: f.poner,
      rolAntes: f.rolAntes, rolDespues: f.rolDespues,
      alcanceAntes: f.alcAntes || null, alcanceDespues: f.alcDespues,
    }];
    await c.query(
      `update "${S}".mdtask_usuarios set rol=$2, alcance=$3, datos=$4, actualizado_en=$5 where id=$1`,
      [f.id, f.rolDespues, f.alcDespues, datos, Date.now()]);
    n++;
  }
  console.log(`[privilegios] aplicadas ${n} fichas.`);
  console.log(`[privilegios] para deshacer:  node scripts/ajustar-privilegios.js --revertir ${path.basename(destino)}`);
  await c.end();
})().catch(e => { console.error('[privilegios] ABORTA por error:', e.message); process.exit(1); });
