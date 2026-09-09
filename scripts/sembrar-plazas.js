// ============================================================================
//  FASE 3 · PASO 3.1a — SEMBRAR LAS PLAZAS Y SUS COBERTURAS
//
//  QUÉ PREGUNTA CONTESTA (§8.11): no «¿corrió el insert?» sino
//    «¿cuántas plazas existen de verdad, cuántas necesitan que la Encargada
//     ordene su cuadrilla, y queda alguien fuera sin que se note?»
//
//  ─── POR QUÉ ES UN SCRIPT Y NO PARTE DE LA MIGRACIÓN 056 ──────────────────
//  Dos razones, y las dos solo se ven al intentar escribirlo en SQL (están
//  también en la cabecera de la 056):
//
//   1. SQL NO SABE RESOLVER UN PUESTO. `resolverPuesto()` tiene dos caminos: el
//      `puestoId` explícito y, si falta, el `cargo` de texto libre mapeado por
//      los `aliasCargos`. Un `insert ... where datos->>'puestoId' <> ''` deja
//      fuera a las fichas que hoy funcionan por alias, EN SILENCIO. Aquí se
//      llama a la función REAL, compilada: no hay una tercera versión de la
//      regla que pueda discrepar de la app (§8.11 d).
//
//   2. La `unidad` no está en la base: vive en `organigrama.catalogo.ts`
//      (hallazgo 5). Copiarla a un `VALUES` sería la lista local que el §4
//      prohíbe.
//
//  ─── ES IDEMPOTENTE, Y ESO NO ES DECORATIVO ───────────────────────────────
//  No re-siembra desde cero: lee lo que ya hay, respeta las coberturas abiertas
//  y solo crea lo que falta. Así una segunda corrida después de una contratación
//  agrega la plaza nueva sin renumerar ni duplicar las viejas — y sin pisar los
//  números que la Encargada ya haya confirmado.
//
//  ─── LO QUE NO HACE, A PROPÓSITO ──────────────────────────────────────────
//   · NO pone `numero`. Nace en NULL en todas. El orden de la cuadrilla lo tiene
//     la Encargada, no la base: ordenar por nombre o por uid sería inventarlo
//     (§8.5). Es el paso 3.1b.
//   · NO pone `ambito` ni `turno`. Ese inventario físico no existe en ningún
//     dato hoy. Es el paso 3.1c.
//   · NO cierra coberturas de gente que se fue. Cerrar exige fecha y motivo
//     (§5.5: corregir es un evento nuevo, no un borrado). Las REPORTA.
//   · NO toca `mdtask_usuarios` ni `mdtask_checklists`. Ni una escritura.
//
//  ─── SE CORRE ASÍ (las credenciales las pone David, §8.7) ─────────────────
//    $env:DATABASE_URL="postgresql://..."        # la PÚBLICA de Railway
//    node scripts/sembrar-plazas.js              # SOLO MIDE. No escribe nada.
//    node scripts/sembrar-plazas.js --aplicar    # ya con el censo revisado
//
//  ─── REVERSA ──────────────────────────────────────────────────────────────
//    delete from mdtask_coberturas; delete from mdtask_plazas;
//  Sin pérdida: todo lo de aquí es derivado de `mdtask_usuarios`, que no se
//  toca. Volver a correr el script lo reconstruye idéntico.
// ============================================================================
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { query, dbConfigurada } = require('../api/db');

const RAIZ = path.resolve(__dirname, '..');
const APLICAR = process.argv.includes('--aplicar');
const HOY = new Date().toISOString().slice(0, 10);

// Lo que midió el censo contra la nómina de agosto (semana 35). NO es la verdad
// de hoy —son 189 de nómina contra ~150 fichas activas— pero es el único punto
// de comparación que existe: si la base da algo MUY distinto, la lectura no es
// «la empresa cambió», es «algo no se leyó». Se imprime al lado, nunca se asume.
const NOMINA = { personas: 189, asignables: 174, pares: 97, multi: 35 };

function abortar(motivo, detalle) {
  console.error('');
  console.error('[plazas] ABORTA: ' + motivo);
  if (detalle) console.error(detalle);
  console.error('[plazas] No concluyas de esta corrida.');
  process.exit(2);
}

// ── Compilar el catálogo y la resolución de puesto ─────────────────────────
// Se COMPILA, no se parsea: un parser roto no da error, da una lista más corta
// y una conclusión falsa (§8.11 d, la prueba de audiencias del menú).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtask-plazas-'));
try {
  execSync('npx tsc --outDir "' + tmp + '" --module commonjs --target ES2022 ' +
    '--skipLibCheck --moduleResolution node ' +
    '"' + path.join(RAIZ, 'src/app/shared/puesto.util.ts') + '"',
    { cwd: RAIZ, stdio: 'pipe' });
} catch (e) {
  abortar('tsc no compiló puesto.util.ts', (e.stdout || e.stderr || e.message || '').toString().slice(0, 1500));
}
const fUtil = path.join(tmp, 'puesto.util.js');
if (!fs.existsSync(fUtil)) abortar('tsc no emitió puesto.util.js en ' + tmp);
const { resolverPuesto } = require(fUtil);
const { PUESTOS_ORGANIGRAMA } = require(path.join(tmp, 'organigrama.catalogo.js'));

const UNIDAD_DE = new Map(PUESTOS_ORGANIGRAMA.map(p => [p.id, p.unidad]));

/** Los lugares donde opera una ficha. Una persona con varias los recibe en todas. */
function lugaresDe(u) {
  const d = u.datos || {};
  const arr = Array.isArray(d.sucursales) ? d.sucursales : [];
  const uno = d.sucursal ? [d.sucursal] : [];
  return [...new Set([...arr, ...uno].map(s => String(s || '').trim()).filter(Boolean))];
}

const idPlaza = (lugar, puesto, slot) => lugar + '::' + puesto + '::' + slot;

/**
 * LA DECISIÓN, SEPARADA DE LA BASE.
 *
 * Todo lo que decide —quién tiene plaza, cuántas hay que numerar, quién queda
 * fuera— vive aquí, sin tocar Postgres. No es estética: esta función produce
 * NÚMEROS DE PERSONAS, así que el §8.8 pide prueba, y una prueba que necesite
 * credenciales de producción no se corre nunca. `scripts/prueba-sembrar-plazas.js`
 * la ejercita con fixtures, incluido el caso de los cinco anaquelistas.
 *
 * Devuelve el censo Y la lista de escrituras a hacer. `main()` solo las ejecuta.
 */
function planear({ fichas, plazasExistentes = [], coberturasAbiertas = [], hoy, ahora }) {
  const sinPuesto = [], sinLugar = [], asignables = [];
  let porAlias = 0;

  for (const f of fichas) {
    const rp = resolverPuesto({ ...f, puestoId: (f.datos || {}).puestoId, cargo: f.cargo });
    if (!rp.puestoId) { sinPuesto.push(f); continue; }
    if (rp.origen === 'alias') porAlias++;
    const lugares = lugaresDe(f);
    if (!lugares.length) { sinLugar.push({ f, puestoId: rp.puestoId }); continue; }
    for (const lugar of lugares) asignables.push({ uid: f.id, nombre: f.nombre, puestoId: rp.puestoId, lugar });
  }

  const grupos = new Map();
  for (const a of asignables) {
    const k = a.lugar + '::' + a.puestoId;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a);
  }
  const multi = [...grupos.entries()].filter(([, g]) => g.length > 1).sort((a, b) => b[1].length - a[1].length);
  const unica = [...grupos.entries()].filter(([, g]) => g.length === 1);

  // ── Qué escribir ─────────────────────────────────────────────────────────
  const plazasDe = new Map();
  for (const p of plazasExistentes) {
    const k = p.lugar + '::' + p.puesto_id;
    if (!plazasDe.has(k)) plazasDe.set(k, []);
    plazasDe.get(k).push(p);
  }
  const cubiertaPor = new Map();
  const plazaDeUid = new Map();
  for (const c of coberturasAbiertas) {
    cubiertaPor.set(c.plaza_id, c.uid);
    if (!plazaDeUid.has(c.uid)) plazaDeUid.set(c.uid, new Set());
    plazaDeUid.get(c.uid).add(c.plaza_id);
  }

  const acciones = [];
  let yaEstaban = 0;

  for (const [k, gente] of grupos) {
    const [lugar, puestoId] = k.split('::');
    const unidad = UNIDAD_DE.get(puestoId) || null;   // null visible, no rellenado (§8.5)
    const existentes = (plazasDe.get(k) || []).slice();
    let maxSlot = existentes.reduce((m, p) => Math.max(m, Number((p.datos || {}).slot) || 0), 0);

    for (const persona of gente) {
      // ¿Esta persona ya cubre una plaza de este grupo? Entonces no se toca:
      // respetar la cobertura abierta es lo que hace inofensiva la re-corrida.
      const suyas = plazaDeUid.get(persona.uid);
      if (suyas && existentes.some(p => suyas.has(p.id))) { yaEstaban++; continue; }

      // Una plaza libre del grupo, o una nueva.
      let plaza = existentes.find(p => !cubiertaPor.has(p.id));
      if (!plaza) {
        maxSlot++;
        plaza = { id: idPlaza(lugar, puestoId, maxSlot), puesto_id: puestoId, lugar,
                  numero: null, datos: { slot: maxSlot } };
        acciones.push({ tipo: 'plaza', id: plaza.id, puestoId, lugar, unidad, slot: maxSlot, ahora, hoy });
        existentes.push(plaza);
      }

      acciones.push({ tipo: 'cobertura', id: plaza.id + '::' + persona.uid, plazaId: plaza.id,
                      uid: persona.uid, nombre: persona.nombre, hoy, ahora });
      cubiertaPor.set(plaza.id, persona.uid);
    }
    plazasDe.set(k, existentes);
  }

  const uidsVivos = new Set(asignables.map(a => a.uid));
  const huerfanas = coberturasAbiertas.filter(c => c.uid && !uidsVivos.has(c.uid));

  return { sinPuesto, sinLugar, asignables, grupos, multi, unica, porAlias,
           acciones, yaEstaban, huerfanas };
}

async function main() {
  if (!dbConfigurada()) {
    abortar('falta DATABASE_URL. Desde tu máquina usa la URL PÚBLICA de Railway (railway.internal no resuelve fuera).');
  }

  console.log('[plazas] catálogo compilado → %d puestos', PUESTOS_ORGANIGRAMA.length);
  if (!PUESTOS_ORGANIGRAMA.length) abortar('el catálogo compiló vacío');

  // El `order by id` no es adorno. Sin él Postgres devuelve las filas en el
  // orden que se le antoje, y ese orden decide qué slot le toca a quién: dos
  // corridas sobre la misma base darían repartos distintos. Es la misma familia
  // del `limit 1` sin `order by` de `api/login.js` que hizo que una persona
  // entrara a dos cuentas según el día. El slot no significa nada, pero tiene
  // que ser REPRODUCIBLE para poder auditar la siembra.
  const fichas = (await query(
    'select id, nombre, cargo, activo, datos from mdtask_usuarios where activo is not false order by id')).rows;

  // §8.11(a): el tamaño de la entrada ANTES de concluir. «No pude leer» y «no
  // hay nada» se ven idénticos, y aquí un cero se leería como «no hay plazas».
  console.log('[plazas] fichas activas leídas de la base → %d', fichas.length);
  if (!fichas.length) abortar('cero fichas activas. La 050 contó 150, así que esto es un fallo de lectura, no un dato.');

  const plazasExistentes = (await query('select id, puesto_id, lugar, numero, datos from mdtask_plazas')).rows;
  const coberturasAbiertas = (await query('select id, plaza_id, uid, tipo from mdtask_coberturas where hasta is null')).rows;
  console.log('[plazas] ya existen → plazas: %d · coberturas abiertas: %d', plazasExistentes.length, coberturasAbiertas.length);

  const P = planear({ fichas, plazasExistentes, coberturasAbiertas, hoy: HOY, ahora: Date.now() });

  // ── El censo, con su comparación al lado ─────────────────────────────────
  console.log('');
  console.log('── CENSO ───────────────────────────  base      nómina/ago');
  console.log('  personas ......................... %s        %s', String(fichas.length).padStart(4), NOMINA.personas);
  console.log('  sin puesto resoluble ............. %s        —', String(P.sinPuesto.length).padStart(4));
  console.log('  con puesto pero sin lugar ........ %s        —', String(P.sinLugar.length).padStart(4));
  console.log('  asignaciones (persona x lugar) ... %s        %s', String(P.asignables.length).padStart(4), NOMINA.asignables);
  console.log('  pares puesto x lugar ............. %s        %s', String(P.grupos.size).padStart(4), NOMINA.pares);
  console.log('   · con UNA persona ............... %s        %s', String(P.unica.length).padStart(4), NOMINA.pares - NOMINA.multi);
  console.log('   · con VARIAS → hay que numerar .. %s        %s', String(P.multi.length).padStart(4), NOMINA.multi);
  console.log('  resueltos por ALIAS de cargo ..... %s        —   <- los que un insert en SQL habria perdido', String(P.porAlias).padStart(4));

  if (P.multi.length) {
    console.log('');
    console.log('── LAS QUE HAY QUE NUMERAR ─────────────────────────────────');
    for (const [k, g] of P.multi.slice(0, 20)) {
      const [lugar, pid] = k.split('::');
      console.log('  ' + lugar.padEnd(24) + ' ' + pid.padEnd(30) + ' ' + String(g.length).padStart(2) + '  ' + (UNIDAD_DE.get(pid) || '?'));
    }
    if (P.multi.length > 20) console.log('  … y ' + (P.multi.length - 20) + ' más');
  }

  // ── LO QUE QUEDA FUERA, NOMBRADO ─────────────────────────────────────────
  // Un pendiente que no se ve es un pendiente que no existe (§8.5). Es gente
  // real que NO va a recibir plaza: tiene que estar a la vista, no en un conteo.
  if (P.sinPuesto.length) {
    console.log('');
    console.log('── SIN PUESTO: no reciben plaza (no se les inventa uno) ────');
    for (const f of P.sinPuesto.slice(0, 25)) console.log('  ' + String(f.nombre || '(sin nombre)').padEnd(40) + ' cargo: ' + (f.cargo || '—'));
    if (P.sinPuesto.length > 25) console.log('  … y ' + (P.sinPuesto.length - 25) + ' más');
  }
  if (P.sinLugar.length) {
    console.log('');
    console.log('── CON PUESTO PERO SIN LUGAR: tampoco reciben plaza ────────');
    for (const x of P.sinLugar.slice(0, 25)) console.log('  ' + String(x.f.nombre || '(sin nombre)').padEnd(40) + ' ' + x.puestoId);
    if (P.sinLugar.length > 25) console.log('  … y ' + (P.sinLugar.length - 25) + ' más');
  }

  // ── GUARDIA DE DISCRIMINACIÓN (§8.11 c) ──────────────────────────────────
  if (!P.multi.length) abortar('ningún lugar tiene dos personas en el mismo puesto. O la agrupación está rota, o esto no es la base de producción — el caso que motiva el paso (5 anaquelistas en Canindo) no aparece.');
  if (!P.unica.length) abortar('TODOS los grupos salieron con varias personas: la llave de agrupación probablemente colapsó lugares distintos.');
  console.log('');
  console.log('✔ discrimina: %d grupos con varias y %d con una.', P.multi.length, P.unica.length);

  // ── GUARDIA DE ORDEN DE MAGNITUD ─────────────────────────────────────────
  // No exige coincidir con la nómina —son fuentes y fechas distintas— pero sí que
  // no sea absurdo. Un 30% de diferencia es la empresa; un 90% es un fallo de
  // lectura disfrazado de resultado.
  const desvio = Math.abs(P.asignables.length - NOMINA.asignables) / NOMINA.asignables;
  if (desvio > 0.5) {
    abortar('las asignaciones de la base (' + P.asignables.length + ') se apartan ' +
      Math.round(desvio * 100) + '% de la nómina (' + NOMINA.asignables + '). ' +
      'Eso no es deriva de plantilla, es que algo no se leyó. Revisa antes de sembrar.');
  }

  const nPlazas = P.acciones.filter(a => a.tipo === 'plaza').length;
  const nCob = P.acciones.filter(a => a.tipo === 'cobertura').length;
  console.log('');
  console.log('[plazas] plan: %d plaza(s) nueva(s) · %d cobertura(s) nueva(s) · %d ya estaban', nPlazas, nCob, P.yaEstaban);

  if (!APLICAR) {
    console.log('');
    console.log('[plazas] MODO MEDICIÓN. No se escribió nada.');
    console.log('[plazas] Si el censo cuadra: node scripts/sembrar-plazas.js --aplicar');
    return;
  }

  // ── EJECUTAR EL PLAN ─────────────────────────────────────────────────────
  for (const a of P.acciones) {
    if (a.tipo === 'plaza') {
      await query(
        'insert into mdtask_plazas (id, puesto_id, lugar, numero, unidad, vigente, creada_en, datos)' +
        ' values ($1,$2,$3,null,$4,true,$5,$6) on conflict (id) do nothing',
        [a.id, a.puestoId, a.lugar, a.unidad, a.ahora,
         JSON.stringify({ slot: a.slot, origen: 'siembra-3.1a', sembrada_en: a.hoy })]);
    } else {
      await query(
        'insert into mdtask_coberturas (id, plaza_id, uid, tipo, desde, hasta, motivo, creada_en, datos)' +
        " values ($1,$2,$3,'titular',$4,null,$5,$6,$7) on conflict (id) do nothing",
        [a.id, a.plazaId, a.uid, a.hoy,
         'siembra inicial 3.1a: titular deducido de la ficha vigente', a.ahora,
         JSON.stringify({ nombre_al_sembrar: a.nombre })]);
    }
  }

  const tot = await query('select (select count(*) from mdtask_plazas) p, (select count(*) from mdtask_coberturas) c');
  console.log('');
  console.log('[plazas] SEMBRADO');
  console.log('  plazas nuevas .............. %d', nPlazas);
  console.log('  coberturas nuevas .......... %d', nCob);
  console.log('  ya estaban (no se tocaron) . %d', P.yaEstaban);
  console.log('  TOTAL plazas ............... %s', tot.rows[0].p);
  console.log('  TOTAL coberturas ........... %s', tot.rows[0].c);
  console.log('  sin numerar: TODAS, y es lo esperado. El numero lo pone la Encargada (3.1b).');
  if (P.huerfanas.length) {
    console.log('');
    console.log('  ⚠ %d cobertura(s) abierta(s) de fichas que ya no están activas.', P.huerfanas.length);
    console.log('    NO se cerraron: cerrar exige fecha y motivo (§5.5). Quedan a la vista.');
  }
}

module.exports = { planear, lugaresDe, idPlaza };

if (require.main === module) {
  main().catch(e => abortar('excepción', (e && e.stack) || String(e))).then(() => process.exit(0));
}
