// ============================================================================
//  CERRAR LAS FICHAS DUPLICADAS  —  EN SECO POR OMISION, Y SIN BORRAR
//
//  Orden de David (14/sep): «los usuarios duplicados bórralos».
//
//  ─── POR QUE DESACTIVA Y NO BORRA ─────────────────────────────────────────
//  Porque el §5.5 del CLAUDE.md lo prohibe, y aqui se ve por que no es
//  formalismo: la ficha de «Maria dolores berber tovar» tiene 84 checklists
//  colgando y la de «Yadira Campero Ortiz» 144. Borrar la fila deja esos
//  checklists sin a quien atribuir, el pase de lista sin a quien asignar, y el
//  historial de agosto apuntando al vacio. Desactivar consigue lo que se pide
//  —la persona desaparece como usuario, no entra, no recibe tareas— y se
//  deshace en un comando. Es lo mismo que hicieron las migraciones 051-053.
//
//  ─── COMO ELIGE CUAL SE QUEDA, y por que en ese orden ─────────────────────
//  El mismo criterio que `api/login.js` usa para desempatar, y por el mismo
//  motivo (bitacora del 31/ago): se ordena por ACCESO, no por historial.
//    1. activa antes que inactiva
//    2. CON puesto antes que sin puesto  ← el robot emite por `puestoId`: una
//       ficha sin puesto no recibe trabajo nuevo, asi que quedarse con ella
//       deja a la persona sin tareas
//    3. latido mas reciente
//    4. mas checklists asignados
//    5. id, para que el resultado sea reproducible
//
//  ─── LO QUE NO HACE, A PROPOSITO ──────────────────────────────────────────
//  · NO toca un grupo donde la perdedora tenga checklists ENVIADOS: eso es
//    trabajo real de una persona, y ahi el empate NO se resuelve solo (§8.5).
//  · NO toca un grupo donde no haya ninguna señal para elegir (ni puesto, ni
//    latido, ni trabajo en ninguna de las dos): elegir a ojo seria inventar.
//  · NO fusiona nada. Los checklists de la ficha cerrada se quedan donde estan.
//
//  Cada cierre deja `datos._duplicadoDe` (el id de la que se queda) y un evento
//  en `datos._historialPermisos`, para que en diciembre se pueda contestar
//  «¿por que esta ficha esta apagada?».
//
//  USO:
//    node scripts/desactivar-fichas-duplicadas.js              # en seco
//    node scripts/desactivar-fichas-duplicadas.js --aplicar
//    node scripts/desactivar-fichas-duplicadas.js --revertir <archivo.json>
// ============================================================================
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const APLICAR  = process.argv.includes('--aplicar');
const REVERTIR = process.argv.includes('--revertir') ? process.argv[process.argv.indexOf('--revertir') + 1] : null;
const CORREO_DUENO = 'davidcisneros2209@outlook.es';

function abortar(msg) {
  console.error('\n[duplicados] ABORTA: ' + msg);
  console.error('[duplicados] No se escribio nada.');
  process.exit(2);
}

function normalizar(n) {
  if (!n) return '';
  return String(n)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[ ​-‍﻿]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
}

async function schemaDeMdtask(c) {
  const cand = await c.query(
    `select table_schema from information_schema.tables where table_name = 'mdtask_usuarios'`);
  if (!cand.rows.length) abortar('no existe `mdtask_usuarios` en ningun schema.');
  const conteos = [];
  for (const r of cand.rows) {
    const n = await c.query(`select count(*)::int n from "${r.table_schema}".mdtask_usuarios`);
    conteos.push({ schema: r.table_schema, filas: n.rows[0].n });
  }
  conteos.sort((a, b) => b.filas - a.filas);
  console.log(`[duplicados] schemas: ${conteos.map(x => `${x.schema}=${x.filas}`).join(' · ')} → se usa ${conteos[0].schema}`);
  if (conteos[0].filas === 0) abortar('cero fichas: fallo de lectura, no "no hay nadie".');
  return conteos[0].schema;
}

(async () => {
  if (!process.env.DATABASE_URL) abortar('falta DATABASE_URL en el entorno.');
  const esInterna = /railway\.internal/.test(process.env.DATABASE_URL);
  const c = new Client({ connectionString: process.env.DATABASE_URL,
                         ssl: esInterna ? false : { rejectUnauthorized: false } });
  await c.connect();
  const S = await schemaDeMdtask(c);

  if (REVERTIR) {
    const r = JSON.parse(fs.readFileSync(REVERTIR, 'utf8'));
    for (const f of r.fichas) {
      await c.query(`update "${S}".mdtask_usuarios set activo=$2, datos=$3 where id=$1`,
        [f.id, f.activo, f.datos]);
    }
    console.log(`[duplicados] reabiertas ${r.fichas.length} fichas. Estado identico al de antes.`);
    await c.end();
    return;
  }

  const q = await c.query(`
    select id, nombre, usuario, correo, rol, activo, cargo,
           datos->>'puestoId' as puesto_id, datos->>'ultimoLatido' as latido, datos
      from "${S}".mdtask_usuarios`);
  console.log(`[duplicados] fichas leidas: ${q.rows.length} (activas ${q.rows.filter(r => r.activo !== false).length})`);
  if (!q.rows.length) abortar('cero fichas.');

  // Trabajo por ficha. El total de ENVIADOS de la tabla se imprime como control:
  // si fuera cero, la señal estaria muerta y ningun "0 enviados" significaria nada.
  const ctrl = await c.query(
    `select count(*)::int total, count(*) filter (where enviado is true)::int enviados
       from "${S}".mdtask_checklists where eliminado is not true`);
  console.log(`[duplicados] control de la señal: ${ctrl.rows[0].enviados} enviados de ${ctrl.rows[0].total} checklists`);
  if (ctrl.rows[0].enviados === 0) {
    abortar('NINGUN checklist de la base esta enviado: "0 enviados" en una ficha no probaria nada.');
  }

  const tra = await c.query(`
    select coalesce(assigned_uid,'') uid, coalesce(assigned,'') nombre, count(*)::int total,
           count(*) filter (where enviado is true)::int enviados
      from "${S}".mdtask_checklists where eliminado is not true group by 1,2`);
  const porUid = new Map(tra.rows.filter(t => t.uid).map(t => [t.uid, t]));
  const porNombre = new Map();
  for (const t of tra.rows) {
    const k = normalizar(t.nombre); if (!k) continue;
    const p = porNombre.get(k);
    porNombre.set(k, p ? { total: p.total + t.total, enviados: p.enviados + t.enviados } : { total: t.total, enviados: t.enviados });
  }
  const trabajoDe = (r) => porUid.get(r.id) || porNombre.get(normalizar(r.nombre)) || { total: 0, enviados: 0 };

  // ── Agrupar por las tres llaves ──────────────────────────────────────────
  const grupos = new Map();
  const agrupar = (llave, valorDe) => {
    const m = new Map();
    for (const r of q.rows) {
      const v = valorDe(r); if (!v) continue;
      if (!m.has(v)) m.set(v, []);
      m.get(v).push(r);
    }
    for (const [v, fichas] of m) {
      if (fichas.length < 2) continue;
      const clave = fichas.map(f => f.id).sort().join('|');
      const g = grupos.get(clave) || { llaves: [], fichas };
      if (!g.llaves.includes(`${llave}="${v}"`)) g.llaves.push(`${llave}="${v}"`);
      grupos.set(clave, g);
    }
  };
  agrupar('nombre',  r => normalizar(r.nombre));
  agrupar('usuario', r => (r.usuario || '').trim().toLowerCase());
  agrupar('correo',  r => (r.correo || '').trim().toLowerCase());

  const fecha = (ms) => { const n = Number(ms); return n > 0 ? new Date(n).toISOString().slice(0,10) : 'nunca'; };
  const plan = [], sinDecidir = [];

  for (const g of grupos.values()) {
    const fichas = g.fichas.map(r => ({ ...r, t: trabajoDe(r) }));
    const activas = fichas.filter(f => f.activo !== false);
    if (activas.length < 2) continue;                       // ya resuelto: solo una viva

    if (fichas.some(f => f.correo && f.correo.trim().toLowerCase() === CORREO_DUENO)) {
      sinDecidir.push({ g, motivo: 'toca la cuenta dueña de la app' }); continue;
    }

    // Orden por ACCESO: activa → con puesto → latido → trabajo → id.
    const orden = [...activas].sort((a, b) =>
      (!!b.puesto_id - !!a.puesto_id) ||
      (Number(b.latido || 0) - Number(a.latido || 0)) ||
      (b.t.total - a.t.total) ||
      String(a.id).localeCompare(String(b.id)));
    const gana = orden[0];
    const pierden = orden.slice(1);

    // ─── CORREO COMPARTIDO: NO HAY GANADORA, SE CIERRAN LAS DOS ───────────
    // Dos fichas con nombres DISTINTOS y el MISMO correo no son un duplicado de
    // una persona: son una cuenta que varias personas podrian abrir, y su
    // evidencia no se puede atribuir a nadie. Es el caso de
    // `mataviejitas778@gmail.com` (migraciones 051-053): las dos fichas se
    // cierran, porque quedarse con una seria elegir a cual de las dos personas
    // posibles se le atribuye lo que haga la otra.
    const correos = new Set(activas.map(f => (f.correo || '').trim().toLowerCase()).filter(Boolean));
    const nombres = new Set(activas.map(f => normalizar(f.nombre)));
    const correoCompartido = correos.size === 1 && nombres.size > 1;
    if (correoCompartido) {
      const conTrabajo = activas.filter(f => f.t.enviados > 0);
      if (conTrabajo.length) { sinDecidir.push({ g, motivo: `cuenta compartida, pero ${conTrabajo[0].nombre} tiene trabajo ENVIADO` }); continue; }
      plan.push({ llaves: g.llaves, gana: null, pierden: activas, compartida: true });
      continue;
    }

    // Empate real: ninguna señal separa a las dos.
    const haySeñal = orden.some(f => f.puesto_id) || orden.some(f => Number(f.latido || 0) > 0)
                  || orden.some(f => f.t.total > 0);
    if (!haySeñal) { sinDecidir.push({ g, motivo: 'ninguna señal separa a las fichas (sin puesto, sin latido, sin trabajo)' }); continue; }

    // Trabajo real en la que se cerraria: no se toca.
    const conEnviados = pierden.filter(f => f.t.enviados > 0);
    if (conEnviados.length) { sinDecidir.push({ g, motivo: `la ficha a cerrar tiene ${conEnviados[0].t.enviados} checklists ENVIADOS` }); continue; }

    plan.push({ llaves: g.llaves, gana, pierden });
  }

  console.log(`\n══════ PLAN: ${plan.length} grupos se cierran · ${sinDecidir.length} sin decidir ══════`);
  for (const p of plan) {
    console.log(`\n── ${p.llaves.join('  ·  ')} ──`);
    if (p.compartida) console.log('   CUENTA COMPARTIDA: no hay ficha que conservar, se cierran todas.');
    else console.log(`   SE QUEDA:  ${p.gana.nombre}  (${p.gana.puesto_id || 'sin puesto'}, latido ${fecha(p.gana.latido)}, ${p.gana.t.total} checklists)`);
    for (const f of p.pierden) {
      console.log(`   SE CIERRA: ${f.nombre}  usuario=${f.usuario || '-'} correo=${f.correo || '-'}`);
      console.log(`              (${f.puesto_id || 'sin puesto'}, latido ${fecha(f.latido)}, ${f.t.total} checklists, ${f.t.enviados} enviados)`);
    }
  }
  if (sinDecidir.length) {
    console.log(`\n══════ SIN DECIDIR — NO SE TOCAN ══════`);
    for (const s of sinDecidir) {
      console.log(`   ${s.g.llaves.join(' · ')}`);
      console.log(`      motivo: ${s.motivo}`);
      s.g.fichas.forEach(f => console.log(`      · ${f.nombre}  id=${f.id}  ${f.puesto_id || 'sin puesto'}  latido ${fecha(f.latido)}`));
    }
  }

  if (!APLICAR) { console.log(`\n[duplicados] EN SECO. No se escribio nada. Para aplicar: --aplicar`); await c.end(); return; }

  const cerrar = plan.flatMap(p => p.pierden.map(f => ({ f, gana: p.gana })));
  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(__dirname, '..', `respaldo-duplicados-${sello}.json`);
  fs.writeFileSync(destino, JSON.stringify({
    generado: new Date().toISOString(), schema: S,
    fichas: cerrar.map(x => ({ id: x.f.id, nombre: x.f.nombre, activo: x.f.activo, datos: x.f.datos })),
  }, null, 2));
  console.log(`\n[duplicados] respaldo escrito: ${path.basename(destino)} (${cerrar.length} fichas)`);
  if (!fs.existsSync(destino)) abortar('el respaldo no quedo escrito.');

  for (const { f, gana } of cerrar) {
    const datos = { ...(f.datos || {}) };
    if (gana) datos._duplicadoDe = gana.id;
    else datos._cuentaCompartidaCerrada = true;
    datos._historialPermisos = [...(datos._historialPermisos || []), {
      fecha: new Date().toISOString(),
      autor: 'desactivar-fichas-duplicadas.js (orden de Direccion, 14/sep/2026)',
      accion: gana ? 'ficha cerrada por duplicada' : 'ficha cerrada: correo compartido, no atribuible',
      seQuedaLaFicha: gana ? gana.id : null, seQuedaElNombre: gana ? gana.nombre : null,
    }];
    await c.query(`update "${S}".mdtask_usuarios set activo=false, datos=$2, actualizado_en=$3 where id=$1`,
      [f.id, datos, Date.now()]);
  }
  console.log(`[duplicados] cerradas ${cerrar.length} fichas. Ninguna borrada.`);
  console.log(`[duplicados] para deshacer:  node scripts/desactivar-fichas-duplicadas.js --revertir ${path.basename(destino)}`);
  await c.end();
})().catch(e => { console.error('[duplicados] ABORTA por error:', e.message); process.exit(1); });
