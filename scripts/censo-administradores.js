// ============================================================================
//  ¿QUIEN TIENE HOY PRIVILEGIOS DE ADMINISTRACION?  —  SOLO LECTURA
//
//  POR QUE EXISTE. El 14/sep/2026 David pidio la lista de administradores para
//  bajarlos a usuario simple segun su puesto. Esa lista NO esta en el codigo:
//  el rol y las banderas viven en `mdtask_usuarios` (columna `rol` y el jsonb
//  `datos`), asi que la unica forma de contestarlo es preguntarle a la base.
//
//  QUE CONTESTA, y nada mas:
//    1. quien tiene `rol = 'admin'` (con su alcance: global o por sucursales),
//    2. quien NO es admin pero trae banderas de gestion — esos son los
//       "supervisores" de facto de `esSupervisor()`, que ven la gestion de su
//       sucursal sin aparecer en ninguna lista de administradores,
//    3. que banderas exactas trae cada uno, para poder decidir cuales conserva.
//
//  GUARDIAS (§8.11 a). Imprime el tamaño de sus entradas ANTES de concluir y
//  ABORTA si `mdtask_usuarios` viene en cero: la migracion 050 conto 150 fichas
//  activas, asi que un cero aqui es "no pude leer" o "base equivocada", nunca
//  "no hay administradores". Las dos lecturas se ven identicas sin esta guardia.
//
//  LO QUE NUNCA IMPRIME: la contraseña de la conexion (se parsea la URL y ese
//  campo se descarta), ni el hash de password espejo de ninguna ficha.
//
//  NO ESCRIBE NADA. Ni un insert, ni un update, ni un create.
//
//  USO (PowerShell, con la URL PUBLICA del Postgres de produccion):
//    $env:DATABASE_URL = "<url publica>"
//    node scripts/censo-administradores.js
//    Remove-Item Env:DATABASE_URL
// ============================================================================
const { Client } = require('pg');

// Las banderas que la pantalla de Usuarios otorga (formPuedeXxx / formGrupoXxx)
// mas las dos de flotilla/promociones que se otorgan por script. Si mañana
// aparece otra, agregala aqui: lo que no este en esta lista no se reporta.
const BANDERAS = [
  'puedeAdministrarPersonal', 'puedeAdministrarAreas',
  'puedeCrearChecklists', 'puedeCrearRutinas', 'puedeCrearTareasUnicas',
  'puedeVerCalendario', 'puedeVerCheckstore', 'puedeVerEstadisticas', 'puedeVerHistorial',
  'grupoTec', 'grupoTickets', 'grupoPagos', 'grupoFlotilla', 'grupoPromociones',
  'promocionesFormato', 'promocionesExpediente',
  'ventaPromosCaja', 'ventaPromosVendedor', 'ventaPromosMonitor',
];

const CORREO_DUENO = 'davidcisneros2209@outlook.es';

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[censo] ABORTA: no hay DATABASE_URL en el entorno. No concluyas de esta corrida.');
    process.exit(1);
  }
  let donde = '(URL no parseable)';
  try { const u = new URL(url); donde = `${u.hostname}:${u.port}${u.pathname} usuario=${u.username}`; } catch {}
  console.log(`[censo] base: ${donde}`);

  const esInterna = /railway\.internal/.test(url);
  const c = new Client({ connectionString: url, ssl: esInterna ? false : { rejectUnauthorized: false } });
  await c.connect();

  // ─── EL SCHEMA NO ES `public`, Y ESO CUESTA UNA TARDE ──────────────────
  // El 14/sep/2026 este censo dio CERO fichas contra la base BUENA. La causa:
  // este Postgres esta compartido (§1) y las tablas de MDTask viven en el
  // schema `eajd`, no en `public` — donde quedaron 13 tablas vacias con 26
  // migraciones de mayo. Un `select ... from mdtask_usuarios` sin schema
  // resuelve por `search_path`, encuentra las vacias y devuelve 0 SIN ERROR:
  // exactamente el modo de fallo del §12 (el nombre equivocado no falla, miente).
  //
  // Por eso el schema se BUSCA en vez de escribirse: se elige el que mas fichas
  // tiene, y se imprime cual fue junto con los descartados. Si mañana se
  // consolidan los schemas, esto sigue funcionando sin editar nada.
  const cand = await c.query(
    `select table_schema from information_schema.tables where table_name = 'mdtask_usuarios'`);
  if (cand.rows.length === 0) {
    console.error('[censo] ABORTA: no existe `mdtask_usuarios` en ningun schema de esta base.');
    process.exit(2);
  }
  const conteos = [];
  for (const r of cand.rows) {
    const n = await c.query(`select count(*)::int n from "${r.table_schema}".mdtask_usuarios`);
    conteos.push({ schema: r.table_schema, filas: n.rows[0].n });
  }
  conteos.sort((a, b) => b.filas - a.filas);
  const SCHEMA = conteos[0].schema;
  console.log(`[censo] schemas con mdtask_usuarios: ${conteos.map(x => `${x.schema}=${x.filas}`).join(' · ')}`);
  console.log(`[censo] se usa el schema: ${SCHEMA}`);

  const tot = await c.query(
    `select count(*)::int n, count(*) filter (where activo is not false)::int act from "${SCHEMA}".mdtask_usuarios`);
  console.log(`[censo] entrada: ${tot.rows[0].n} fichas en mdtask_usuarios (${tot.rows[0].act} activas)`);
  if (tot.rows[0].n === 0) {
    console.error('[censo] ABORTA: cero fichas. La 050 conto 150 activas, asi que esto es un fallo');
    console.error('[censo] de lectura o una base que no es la de produccion — no es "no hay nadie".');
    process.exit(2);
  }

  const q = await c.query(`
    select id, nombre, usuario, correo, rol, alcance, activo, cargo,
           datos->>'puestoId'      as puesto_id,
           datos->'sucursales'     as sucursales,
           datos->>'ultimoLatido'  as latido,
           datos
      from "${SCHEMA}".mdtask_usuarios
     order by (activo is not false) desc, lower(coalesce(nombre,''))
  `);
  console.log(`[censo] filas leidas: ${q.rows.length}`);

  const banderasDe = (d) => BANDERAS.filter(b => d && d[b] === true);
  const fecha = (ms) => { const n = Number(ms); return n > 0 ? new Date(n).toISOString().slice(0, 10) : 'nunca'; };
  const lista = (s) => Array.isArray(s) && s.length ? s.join(' · ') : '(ninguna)';

  const pinta = (r, i) => {
    const b = banderasDe(r.datos);
    const dueno = String(r.correo || '').trim().toLowerCase() === CORREO_DUENO ? '   *** DUEÑO ***' : '';
    console.log(`\n ${String(i + 1).padStart(2)}. ${r.activo === false ? '[INACTIVA] ' : ''}${r.nombre || '(sin nombre)'}${dueno}`);
    console.log(`     usuario=${r.usuario || '-'}   correo=${r.correo || '-'}`);
    console.log(`     rol=${r.rol || '-'}   alcance=${r.alcance || '(ausente = GLOBAL)'}   puestoId=${r.puesto_id || '(sin puesto)'}   cargo=${r.cargo || '-'}`);
    console.log(`     sucursales: ${lista(r.sucursales)}`);
    console.log(`     ultimo latido: ${fecha(r.latido)}`);
    console.log(`     banderas (${b.length}): ${b.length ? b.join(', ') : '(ninguna)'}`);
  };

  const admins = q.rows.filter(r => r.rol === 'admin');
  const supervisores = q.rows.filter(r => r.rol !== 'admin' && banderasDe(r.datos).length > 0);

  console.log(`\n══════════ 1 · ADMINISTRADORES (rol = 'admin'): ${admins.length} ══════════`);
  admins.forEach(pinta);

  console.log(`\n══════════ 2 · SIN rol admin PERO CON BANDERAS DE GESTION: ${supervisores.length} ══════════`);
  console.log('    (esSupervisor() les da vista de gestion de TODA su sucursal, no solo lo suyo)');
  supervisores.forEach(pinta);

  const globales = admins.filter(r => (r.alcance || 'global') === 'global');
  const activos = admins.filter(r => r.activo !== false);
  console.log(`\n══════════ RESUMEN ══════════`);
  console.log(`  fichas totales:                 ${tot.rows[0].n}  (activas ${tot.rows[0].act})`);
  console.log(`  administradores:                ${admins.length}  (activos ${activos.length})`);
  console.log(`   · de alcance GLOBAL:           ${globales.length}   <- ven y tocan TODA la empresa`);
  console.log(`   · limitados a sucursales:      ${admins.length - globales.length}`);
  console.log(`  supervisores por banderas:      ${supervisores.length}`);
  await c.end();
})().catch(e => {
  console.error('[censo] ABORTA por error de conexion o consulta:', e.message);
  console.error('[censo] No concluyas de esta corrida.');
  process.exit(1);
});
