// ============================================================================
//  FICHAS DUPLICADAS DE UNA MISMA PERSONA  —  SOLO LECTURA
//
//  POR QUE EXISTE. El hallazgo 1 del proyecto es que la identidad se cruza por
//  TEXTO: un typo, un espacio de mas o un apellido invertido crean una segunda
//  persona que el sistema trata como real (marcador del §9: seis correcciones
//  en un dia). El 14/sep, bajando privilegios, volvio a aparecer —«Luis David
//  Navarro Alvarado» con dos fichas activas— y David pidio resolverlas.
//
//  QUE MIDE, y por que estas tres llaves y no una:
//    · nombre normalizado  → caza «Yadira/Yaadira» y los espacios dobles
//    · usuario             → COLISION EXACTA en la llave de acceso: dos fichas
//                            con el mismo `usuario` hacen que una persona entre
//                            a una u otra segun el dia (bitacora del 31/ago)
//    · correo              → lo mismo por el otro camino del login
//
//  Y LAS SEÑALES PARA PODER DECIDIR, que es lo que falto en mayo: de cada ficha
//  se imprime si tiene puesto, su ultimo latido, cuantos checklists tiene
//  ASIGNADOS y cuantos TRABAJADOS (enviados), y el rango de fechas. Una ficha
//  con cero trabajados y solo fechas de hoy es el robot repartiendo, no una
//  persona usando la app.
//
//  NO DECIDE NADA Y NO ESCRIBE NADA. Cuando las dos fichas tienen trabajo real,
//  el empate NO SE RESUELVE (§8.5): se le pregunta a la persona o a su Gerente.
//
//  USO:  DATABASE_URL=... node scripts/diagnostico-fichas-duplicadas.js
// ============================================================================
const { Client } = require('pg');

function abortar(msg) {
  console.error('\n[duplicados] ABORTA: ' + msg);
  console.error('[duplicados] No concluyas de esta corrida.');
  process.exit(2);
}

/** Misma normalizacion que `permisos.util.ts`: sin tildes, sin puntuacion, sin espacios de mas. */
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
  if (conteos[0].filas === 0) abortar('cero fichas: es un fallo de lectura, no "no hay nadie".');
  return conteos[0].schema;
}

(async () => {
  if (!process.env.DATABASE_URL) abortar('falta DATABASE_URL en el entorno.');
  const esInterna = /railway\.internal/.test(process.env.DATABASE_URL);
  const c = new Client({ connectionString: process.env.DATABASE_URL,
                         ssl: esInterna ? false : { rejectUnauthorized: false } });
  await c.connect();
  const S = await schemaDeMdtask(c);

  const q = await c.query(`
    select id, nombre, usuario, correo, rol, alcance, activo, cargo,
           datos->>'puestoId' as puesto_id, datos->>'ultimoLatido' as latido,
           datos->'sucursales' as sucursales
      from "${S}".mdtask_usuarios`);
  console.log(`[duplicados] fichas leidas: ${q.rows.length} (activas ${q.rows.filter(r => r.activo !== false).length})`);
  if (!q.rows.length) abortar('cero fichas.');

  // Trabajo por ficha: asignados (por uid Y por nombre, porque los viejos no traen uid)
  // y trabajados (enviados). Sin esto, "duplicada" no se puede decidir.
  const tra = await c.query(`
    select coalesce(assigned_uid, '') as uid, coalesce(assigned, '') as nombre,
           count(*)::int total,
           count(*) filter (where enviado is true)::int enviados,
           min(fecha) as desde, max(fecha) as hasta
      from "${S}".mdtask_checklists
     where eliminado is not true
     group by 1, 2`);
  console.log(`[duplicados] grupos de checklists leidos: ${tra.rows.length}`);

  const porUid = new Map();
  const porNombre = new Map();
  for (const t of tra.rows) {
    if (t.uid) porUid.set(t.uid, t);
    const k = normalizar(t.nombre);
    if (!k) continue;
    const prev = porNombre.get(k);
    porNombre.set(k, prev
      ? { total: prev.total + t.total, enviados: prev.enviados + t.enviados,
          desde: [prev.desde, t.desde].filter(Boolean).sort()[0],
          hasta: [prev.hasta, t.hasta].filter(Boolean).sort().pop() }
      : { total: t.total, enviados: t.enviados, desde: t.desde, hasta: t.hasta });
  }
  const trabajoDe = (r) => porUid.get(r.id) || porNombre.get(normalizar(r.nombre))
                        || { total: 0, enviados: 0, desde: null, hasta: null };

  // ── Los tres cruces ──────────────────────────────────────────────────────
  const grupos = new Map();   // clave -> { llave, fichas[] }
  const agrupar = (llave, valorDe) => {
    const m = new Map();
    for (const r of q.rows) {
      const v = valorDe(r);
      if (!v) continue;
      (m.get(v) || m.set(v, []).get(v)).push(r);
    }
    for (const [v, fichas] of m) {
      if (fichas.length < 2) continue;
      const clave = fichas.map(f => f.id).sort().join('|');
      const g = grupos.get(clave) || { llaves: [], fichas };
      if (!g.llaves.includes(llave)) g.llaves.push(`${llave}="${v}"`);
      grupos.set(clave, g);
    }
  };
  agrupar('nombre',  r => normalizar(r.nombre));
  agrupar('usuario', r => (r.usuario || '').trim().toLowerCase());
  agrupar('correo',  r => (r.correo || '').trim().toLowerCase());

  const fecha = (ms) => { const n = Number(ms); return n > 0 ? new Date(n).toISOString().slice(0, 10) : 'nunca'; };

  console.log(`\n══════ ${grupos.size} GRUPOS DE FICHAS QUE PARECEN LA MISMA PERSONA ══════`);
  let decidibles = 0, empates = 0;
  for (const g of grupos.values()) {
    console.log(`\n── ${g.llaves.join('  ·  ')} ──`);
    const conTrabajo = [];
    for (const r of g.fichas) {
      const t = trabajoDe(r);
      if (t.enviados > 0) conTrabajo.push(r);
      console.log(`   ${r.activo === false ? '[INACTIVA] ' : '[activa]   '}${r.nombre}`);
      console.log(`      id=${r.id}  usuario=${r.usuario || '-'}  correo=${r.correo || '-'}`);
      console.log(`      puesto=${r.puesto_id || '(sin puesto)'}  rol=${r.rol}  latido=${fecha(r.latido)}`);
      console.log(`      checklists: ${t.total} asignados · ${t.enviados} ENVIADOS · ${t.desde || '-'} → ${t.hasta || '-'}`);
    }
    if (conTrabajo.length >= 2) { empates++; console.log('      ⚠ EMPATE: dos o mas fichas con trabajo ENVIADO. No se resuelve solo (§8.5).'); }
    else decidibles++;
  }
  console.log(`\n══════ RESUMEN ══════`);
  console.log(`  grupos: ${grupos.size}  ·  decidibles: ${decidibles}  ·  empates que NO se tocan: ${empates}`);
  await c.end();
})().catch(e => { console.error('[duplicados] ABORTA por error:', e.message); process.exit(1); });
