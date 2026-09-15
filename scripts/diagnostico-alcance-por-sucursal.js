// ============================================================================
//  DIAGNOSTICO — ¿A QUIEN LE QUITARIA ALGO EL CANDADO POR SUCURSAL?
//
//  LA REGLA QUE SE QUIERE APLICAR (David, 14/sep/2026):
//      Direccion General  -> todo
//      Jefe de Zona       -> solo SUS sucursales (avances y fichas)
//      Encargado          -> solo la suya
//      y nadie mas revisa avances ni tareas.
//
//  LA PREGUNTA QUE ESTE SCRIPT CONTESTA, y ninguna otra: **antes** de cerrar
//  nada, a quien se lo cerrariamos. Restringir es la direccion peligrosa —la
//  contraria a la de casi todo este repo—: un recorte de mas no produce un
//  numero feo, produce a alguien que abre la app y no puede trabajar, y «no veo
//  nada» y «no tengo nada que hacer» se ven IDENTICOS en pantalla (§5.2).
//
//  TRES COSAS QUE HAY QUE SABER ANTES DE TOCAR CODIGO:
//
//    1. QUIEN ES HOY ADMIN GLOBAL SIN DEBERLO. `esAdminGlobal` hace
//       `(user?.alcance ?? 'global') === 'global'`, asi que una ficha con
//       rol=admin y el campo `alcance` VACIO es global POR OMISION. Si un Jefe
//       de Zona esta capturado asi, ve toda la empresa porque su ficha lo dice
//       —no porque el codigo falle— y eso se arregla en Personal, sin codigo.
//
//    2. QUIEN SE QUEDARIA CIEGO. Toda ficha activa con la lista de sucursales
//       VACIA. Con un candado por sucursal a secas, esa persona no veria nada.
//
//    3. CUAL DE LAS DOS REGLAS SIRVE. Se comparan las dos, con su numero:
//         «solo sucursal»  -> ve lo de sus sucursales
//         «nombre O sucursal» -> ve ademas lo que lleva SU nombre
//       La diferencia son los checklists cuyo `store` no esta en las sucursales
//       de su propio dueño. Si ese numero no es cero, la primera regla le quita
//       a gente su PROPIO trabajo.
//
//  NO ESCRIBE NADA. Ni un insert, ni un update, ni un delete.
//
//  Como se corre (PowerShell, desde la raiz del repo):
//      $env:DATABASE_URL = "<URL PUBLICA de Postgres de Railway>"
//      node scripts/diagnostico-alcance-por-sucursal.js
// ============================================================================
const { query, dbConfigurada } = require('../api/db');
const { resolverUidDeNombre } = require('../api/checklists');

const DIAS = 30;
const CORREO_DUENO = 'davidcisneros2209@outlook.es';

function abortar(msg, detalle) {
  console.error('\n[alcance] ABORTA: ' + msg);
  if (detalle) console.error(detalle);
  console.error('[alcance] No concluyas de esta corrida.');
  process.exit(1);
}

/**
 * Padding hecho en JS, no con printf.
 *
 * `util.format` (lo que usa console.log) NO soporta el ancho de printf: un
 * '%-34s' se imprime LITERAL y el argumento se va al final de la linea. Ya
 * mordio tres veces en este repo, y en la tabla de un diagnostico es donde mas
 * duele: sale ilegible y parece que el DATO esta mal, no el formato.
 */
const izq = (s, n) => String(s == null ? '' : s).padEnd(n).slice(0, n);

/** Host, puerto y base de la URL. La contrasena se descarta aqui y no sale. */
function coordenadaSinSecreto(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname, puerto: u.port || '5432',
             base: (u.pathname || '').replace(/^\//, '') || '(sin nombre)',
             usuario: u.username || '(sin usuario)' };
  } catch { return null; }
}

function ymd(d) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().split('T')[0];
}

/** Las sucursales de una ficha, con los campos historicos normalizados. Es el
 *  mismo criterio que `sucursalesPermitidas` usa en el cliente. */
function sucursalesDe(f) {
  const d = f.datos || {};
  const lista = (Array.isArray(d.sucursales) && d.sucursales.length)
    ? d.sucursales
    : (d.sucursal ? [d.sucursal] : []);
  return [...new Set(lista.map(s => String(s || '').trim()).filter(Boolean))];
}

/** ¿Esta ficha es hoy admin GLOBAL? Replica exacta de `esAdminGlobal`,
 *  incluido el default a 'global' cuando el campo viene vacio — que es el
 *  hallazgo, no un detalle. */
function esGlobalHoy(f) {
  if (String(f.correo || '').trim().toLowerCase() === CORREO_DUENO) return true;
  if (String(f.rol || '') !== 'admin') return false;
  const alcance = (f.alcance == null || f.alcance === '') ? 'global' : f.alcance;
  return alcance === 'global';
}

async function main() {
  if (!dbConfigurada()) {
    abortar('falta DATABASE_URL. Desde tu maquina usa la URL PUBLICA de Railway ' +
            '(railway.internal no resuelve fuera). Este script SOLO LEE.');
  }
  const decl = coordenadaSinSecreto(process.env.DATABASE_URL);
  if (!decl) abortar('la DATABASE_URL no se pudo interpretar como URL.');

  console.log('\n=== A DONDE ESTOY PREGUNTANDO (sin la contrasena) ===');
  console.log('  %s:%s/%s como %s', decl.host, decl.puerto, decl.base, decl.usuario);

  // ── Las fichas ────────────────────────────────────────────────────────────
  const fichas = (await query(
    `select id, nombre, correo, rol, alcance, cargo, activo, datos
       from mdtask_usuarios
      where coalesce(activo, true) = true
      order by nombre`
  )).rows;

  console.log('\n=== TAMANO DE LA ENTRADA ===');
  console.log('  fichas activas leidas: %d', fichas.length);
  if (fichas.length === 0) {
    abortar('CERO fichas activas. La migracion 050 conto 150, asi que esto es un ' +
            'fallo de lectura, no una empresa vacia.',
            '  Comprueba la base con:  node scripts/diagnostico-conexion.js');
  }

  // ── 1. Quien ve TODO hoy ──────────────────────────────────────────────────
  const globales = fichas.filter(esGlobalHoy);
  const porOmision = globales.filter(f =>
    String(f.correo || '').trim().toLowerCase() !== CORREO_DUENO &&
    (f.alcance == null || f.alcance === ''));

  console.log('\n=== 1. QUIEN VE TODA LA EMPRESA HOY ===');
  console.log('  fichas con acceso global .................. %d de %d', globales.length, fichas.length);
  console.log('  de ellas, global POR OMISION (alcance vacio) %d', porOmision.length);
  console.log('');
  console.log('  Estas son las que hay que revisar una por una: si alguna es Jefe de');
  console.log('  Zona o Encargado, ve todo porque su FICHA lo dice, y se corrige en');
  console.log('  Personal sin tocar codigo.');
  console.log('');
  console.log('  ' + izq('nombre', 35) + izq('rol', 9) + izq('alcance', 13) + 'sucursales en su ficha');
  for (const f of globales) {
    const suc = sucursalesDe(f);
    console.log('  ' + izq(f.nombre || '(sin nombre)', 35) +
      izq(f.rol || '(sin rol)', 9) +
      izq((f.alcance == null || f.alcance === '') ? '(VACIO)' : f.alcance, 13) +
      (suc.length ? suc.join(', ').slice(0, 60) : '(ninguna)'));
  }

  // ── 2. Quien se quedaria ciego ────────────────────────────────────────────
  const sinSucursal = fichas.filter(f => !esGlobalHoy(f) && sucursalesDe(f).length === 0);
  const sinSucursalPorRol = {};
  for (const f of sinSucursal) {
    const r = f.rol || '(sin rol)';
    sinSucursalPorRol[r] = (sinSucursalPorRol[r] || 0) + 1;
  }

  console.log('\n=== 2. QUIEN SE QUEDARIA CIEGO CON UN CANDADO POR SUCURSAL ===');
  console.log('  fichas activas SIN una sola sucursal: %d de %d',
    sinSucursal.length, fichas.length);
  for (const [r, n] of Object.entries(sinSucursalPorRol)) {
    console.log('    ' + izq(r, 13) + n);
  }
  if (sinSucursal.length) {
    console.log('  primeras 15:');
    for (const f of sinSucursal.slice(0, 15)) {
      console.log('    ' + izq(f.nombre || '', 35) + (f.cargo || '(sin cargo)'));
    }
  }
  console.log('');
  console.log('  A estas, «solo mi sucursal» les deja la pantalla en blanco. Es el');
  console.log('  motivo por el que la regla tiene que ser «su nombre O su sucursal».');

  // ── 3. Cual de las dos reglas sirve ───────────────────────────────────────
  const desde = ymd(new Date(Date.now() - DIAS * 86400000));
  const cks = (await query(
    `select id, assigned, store, fecha
       from mdtask_checklists
      where fecha >= $1 and coalesce(eliminado,false) = false
      order by fecha desc`, [desde]
  )).rows;

  console.log('\n=== 3. LA REGLA, DECIDIDA CON SU NUMERO ===');
  console.log('  checklists leidos (desde %s, sin eliminados): %d', desde, cks.length);
  if (cks.length === 0) {
    abortar('CERO checklists en ' + DIAS + ' dias. Con la app en produccion eso no ' +
            'es «no hubo trabajo»: es «no lei».');
  }

  // Nombre -> ficha, con el MISMO criterio que usa la app para amarrar dueño.
  // Se cachea por nombre: `resolverUidDeNombre` hace dos consultas por llamada.
  const porId = new Map(fichas.map(f => [String(f.id), f]));
  const cacheUid = new Map();
  async function fichaDe(nombre) {
    const k = String(nombre || '').trim().toLowerCase();
    if (!k) return null;
    if (!cacheUid.has(k)) cacheUid.set(k, await resolverUidDeNombre(nombre));
    const uid = cacheUid.get(k);
    return uid ? (porId.get(String(uid)) || null) : null;
  }

  let fuera = 0, dentro = 0, sinDueno = 0, dueñoGlobal = 0, dueñoSinSucursal = 0;
  const muestra = [];
  for (const c of cks) {
    const f = await fichaDe(c.assigned);
    if (!f) { sinDueno++; continue; }
    if (esGlobalHoy(f)) { dueñoGlobal++; continue; }
    const suc = sucursalesDe(f);
    if (suc.length === 0) { dueñoSinSucursal++; continue; }
    if (suc.includes(c.store)) dentro++;
    else {
      fuera++;
      if (muestra.length < 12) muestra.push({ n: c.assigned, store: c.store, suc: suc.join(', ') });
    }
  }

  console.log('');
  console.log('  De esos %d checklists, mirando la ficha de su propio dueño:', cks.length);
  console.log('    su `store` SI esta en sus sucursales .......... %d', dentro);
  console.log('    su `store` NO esta en sus sucursales .......... %d   <- ESTE es el numero', fuera);
  console.log('    el dueño es admin global (no aplica) .......... %d', dueñoGlobal);
  console.log('    el dueño no tiene sucursales en su ficha ...... %d', dueñoSinSucursal);
  console.log('    no se pudo amarrar el nombre a una ficha ...... %d', sinDueno);
  const suma = dentro + fuera + dueñoGlobal + dueñoSinSucursal + sinDueno;
  console.log('    ---------------------------------------------- %d (cuadra: %s)',
    suma, suma === cks.length ? 'si' : 'NO, revisar');

  if (muestra.length) {
    console.log('\n  Muestra de los que quedarian FUERA (hasta 12):');
    console.log('    ' + izq('persona', 29) + izq('store del checklist', 21) + 'sucursales de su ficha');
    for (const m of muestra) {
      console.log('    ' + izq(m.n || '', 29) + izq(m.store || '', 21) + m.suc.slice(0, 40));
    }
  }

  // ── VEREDICTO ─────────────────────────────────────────────────────────────
  const enRiesgo = fuera + dueñoSinSucursal + sinDueno;
  console.log('\n=== VEREDICTO ===');
  console.log('  Con «SOLO SU SUCURSAL», dejarian de ver trabajo PROPIO: %d checklists', enRiesgo);
  console.log('    (%d por store ajeno + %d sin sucursal en la ficha + %d sin dueño amarrado)',
    fuera, dueñoSinSucursal, sinDueno);
  console.log('  Con «SU NOMBRE O SU SUCURSAL», dejarian de ver trabajo propio: 0');
  console.log('    — porque todo checklist lleva el nombre de su dueño en `assigned`.');
  console.log('');
  if (enRiesgo === 0) {
    console.log('  Las dos reglas dan lo mismo HOY. Aun asi conviene la segunda: el dia');
    console.log('  que alguien capture una ficha sin sucursal, la primera lo deja fuera');
    console.log('  en silencio y la segunda no.');
  } else {
    console.log('  La regla tiene que ser «SU NOMBRE O SU SUCURSAL». La otra le quitaria');
    console.log('  a gente real su propio trabajo, y en pantalla se veria como que la app');
    console.log('  perdio sus tareas.');
  }
  console.log('');
  process.exit(0);
}

// Solo arranca cuando se INVOCA; requerido como modulo (la prueba) no toca la base.
if (require.main === module) {
  main().catch(e => abortar('error no previsto: ' + ((e && e.stack) || e)));
}

module.exports = { esGlobalHoy, sucursalesDe };
