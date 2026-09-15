#!/usr/bin/env node
/**
 * 🔁 ¿A CUÁNTA GENTE SE LE ESTÁ ENTREGANDO EL MISMO MANUAL VARIAS VECES?
 * ══════════════════════════════════════════════════════════════════════════
 *
 * David, 15/sep/2026, mirando su pantalla: *«hay módulos repetidos»* — y luego
 * *«quiero que revises en todos los usuarios que no hayan módulos repetidos»*.
 *
 * Una Encargada de 8 Esquinas veía NUEVE tareas pendientes y su manual son
 * TRES. No estaban duplicadas por un fallo de escritura: su ficha lleva
 * `8 Esquinas`, `MANTENIMIENTO` y `SISTEMAS`, y el emisor entregaba el manual
 * COMPLETO en cada entrada de esa lista. 3 tareas × 3 lugares = 9.
 *
 * La regla se corrigió el mismo día (`lugaresDeEmision`). Esto contesta la otra
 * mitad de lo que pidió: **a cuánta gente más le pasa**, y si quedan repetidos
 * ya escritos en la base.
 *
 * ─── SOLO LEE ─────────────────────────────────────────────────────────────
 * Ni un `insert`, ni un `update`, ni un `delete`. Lo que encuentre se decide
 * después: borrar checklists de gente que ya pudo haberlos contestado es
 * exactamente lo que el §5.5 prohíbe hacer sin pensarlo.
 *
 * ─── CÓMO SE CORRE ────────────────────────────────────────────────────────
 *   DATABASE_URL="postgres://..." node scripts/diagnostico-entregas-repetidas.js
 *
 * La credencial se toma del ENTORNO y nunca se imprime: de la URL solo se
 * muestran host, puerto y nombre de la base, con la contraseña descartada antes
 * de escribir nada (§8.7).
 *
 * ─── LO QUE VIGILA DE SÍ MISMO (§8.11) ────────────────────────────────────
 * · ABORTA sin `DATABASE_URL`: un cero por no haber consultado y un cero por no
 *   haber duplicados se ven idénticos, y son cosas opuestas.
 * · ABORTA si `mdtask_usuarios` devuelve 0 filas activas. Con la app en
 *   producción eso no es «no hay»: es «no leí» — o es otra base. La 050 contó
 *   150 activas, así que hay con qué comparar.
 * · Cada cifra sale con SU DENOMINADOR. «12 personas afectadas» no dice nada
 *   sin saber de cuántas.
 * · El cruce puesto→manual NO se escribe en SQL: se compila el catálogo real
 *   con `tsc` y se llama a las mismas funciones que usa la app. Una lista de
 *   puestos tecleada aquí sería una tercera versión de la regla, libre de
 *   discrepar en silencio (§4).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function abortar(motivo, extra) {
  console.error('');
  console.error('[repetidas] ABORTA: ' + motivo);
  if (extra) console.error('           ' + extra);
  console.error('[repetidas] No concluyas de esta corrida.');
  process.exit(3);
}

const URL_BD = process.env.DATABASE_URL;
if (!URL_BD) {
  abortar('falta DATABASE_URL.',
    'Córrelo así (la credencial NO se guarda ni se imprime):\n' +
    '           DATABASE_URL="postgres://..." node scripts/diagnostico-entregas-repetidas.js');
}

/** Host/puerto/base para poder decir A QUÉ BASE se le preguntó. Sin contraseña. */
function dondeEstoy(url) {
  try {
    const u = new URL(url);
    return u.hostname + ':' + (u.port || '5432') + '/' + String(u.pathname || '').replace(/^\//, '') +
           ' (usuario ' + (u.username || '?') + ')';
  } catch { return '(URL ilegible)'; }
}

// ── El catálogo y las reglas REALES, compiladas ──────────────────────────
function compilarReglas() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-rep-ts-'));
  const raiz = path.join(__dirname, '..');
  const fuentes = [
    'src/app/shared/tareas-manual.catalogo.ts',
    'src/app/shared/organigrama.catalogo.ts',
    'src/app/shared/puesto.util.ts',
    'src/app/shared/sucursales-elegibles.util.ts',
    'src/app/shared/emision-manual.util.ts',
  ].map((f) => path.join(raiz, f));
  try {
    execFileSync('npx', ['tsc', ...fuentes, '--outDir', tmp, '--module', 'commonjs',
      '--target', 'es2019', '--skipLibCheck', '--moduleResolution', 'node'],
      { stdio: 'pipe', shell: process.platform === 'win32' });
  } catch (e) {
    abortar('no pude compilar las reglas con tsc.', String(e.stdout || e.message).slice(0, 400));
  }
  return {
    cat: require(path.join(tmp, 'tareas-manual.catalogo.js')),
    puesto: require(path.join(tmp, 'puesto.util.js')),
    lugares: require(path.join(tmp, 'sucursales-elegibles.util.js')),
    emision: require(path.join(tmp, 'emision-manual.util.js')),
  };
}

(async () => {
  const R = compilarReglas();
  if (typeof R.emision.lugaresDeEmision !== 'function') {
    abortar('la regla `lugaresDeEmision` no existe en el módulo compilado.',
      'Sin ella este diagnóstico compararía contra nada.');
  }

  let Client;
  try { ({ Client } = require('pg')); }
  catch { abortar('falta el paquete `pg`. Corre `npm install` en el repo.'); }

  const cli = new Client({ connectionString: URL_BD, ssl: { rejectUnauthorized: false } });
  try { await cli.connect(); }
  catch (e) { abortar('no pude conectar a la base.', e.message); }

  console.log('');
  console.log('[repetidas] base: %s', dondeEstoy(URL_BD));

  // ── 1 · LAS FICHAS ──────────────────────────────────────────────────────
  const rs = await cli.query(
    `select id, nombre, rol, cargo, activo, datos
       from mdtask_usuarios
      where activo is not false
      order by nombre`);
  const fichas = rs.rows;
  console.log('[repetidas] fichas activas leídas: %d', fichas.length);
  if (fichas.length === 0) {
    await cli.end();
    abortar('cero fichas activas.',
      'Con la app en producción eso no es «no hay»: es «no leí», o es otra base. ' +
      'La migración 050 contó 150 activas.');
  }

  // ── 2 · A QUIÉN LE SOBRAN LUGARES ───────────────────────────────────────
  const filas = [];
  let sinPuesto = 0, sinManual = 0, sinLugar = 0;

  for (const f of fichas) {
    const d = f.datos || {};
    const u = { ...f, ...d, nombre: f.nombre, rol: f.rol, cargo: f.cargo };
    const puestoId = R.puesto.resolverPuesto(u).puestoId;
    if (!puestoId) { sinPuesto++; continue; }

    const tareas = R.cat.tareasAutomaticasDePuesto(puestoId).length;
    if (!tareas) { sinManual++; continue; }

    const lugares = R.emision.sucursalesDe(u);
    if (!lugares.length) { sinLugar++; continue; }

    const antes = lugares.length;                              // lo que se entregaba
    const ahora = R.emision.lugaresDeEmision(lugares).length;  // lo que se entrega
    if (antes === ahora) continue;

    filas.push({
      nombre: f.nombre || '(sin nombre)',
      puesto: R.cat.manualDePuesto(puestoId) ? puestoId : puestoId,
      tareas,
      lugares,
      sobran: lugares.filter((l) => !R.lugares.tieneCuadrilla(l)),
      antes: tareas * antes,
      ahora: tareas * ahora,
    });
  }

  console.log('[repetidas] de esas %d: %d sin puesto · %d con puesto sin manual · %d sin lugar',
    fichas.length, sinPuesto, sinManual, sinLugar);
  const conManual = fichas.length - sinPuesto - sinManual - sinLugar;
  console.log('[repetidas] RECIBEN MANUAL: %d · de ellas, con lugares de más: %d',
    conManual, filas.length);

  if (conManual === 0) {
    await cli.end();
    abortar('nadie recibe manual según el catálogo.',
      'Eso contradice que la app esté entregando tareas: revisa el cruce puesto→manual ' +
      'antes de creer el cero de abajo.');
  }

  console.log('');
  if (filas.length === 0) {
    console.log('✓ NINGUNA ficha activa tiene áreas de más en su lista: nadie recibiría el');
    console.log('  manual repetido. (Medido sobre %d personas que sí reciben manual.)', conManual);
  } else {
    filas.sort((a, b) => (b.antes - b.ahora) - (a.antes - a.ahora));
    console.log('PERSONAS A LAS QUE SE LES ENTREGABA DE MÁS');
    console.log('persona                         puesto                    tareas  antes  ahora  lugares de más');
    console.log('─'.repeat(118));
    for (const r of filas) {
      console.log('%s %s %s %s %s %s',
        String(r.nombre).slice(0, 30).padEnd(31), String(r.puesto).slice(0, 24).padEnd(25),
        String(r.tareas).padEnd(7), String(r.antes).padEnd(6), String(r.ahora).padEnd(6),
        r.sobran.join(', '));
    }
    console.log('─'.repeat(118));
    const deMas = filas.reduce((n, r) => n + (r.antes - r.ahora), 0);
    console.log('TOTAL: %d entregas de más al día, repartidas en %d persona(s) de %d que reciben manual.',
      deMas, filas.length, conManual);
  }

  // ── 3 · Y LO QUE YA ESTÁ ESCRITO: duplicados REALES de los últimos días ──
  //
  // Lo de arriba es el MODELO (qué produciría la regla). Esto es el HECHO: la
  // misma tarea, la misma persona y el mismo día, en dos sitios distintos. Los
  // dos tienen que mirarse: el modelo puede estar bien y la base traer basura
  // de antes, y al revés.
  const rd = await cli.query(
    `select assigned,
            datos->>'_tareaManualId' as tarea,
            fecha,
            count(*)                as copias,
            string_agg(distinct store, ', ' order by store) as lugares
       from mdtask_checklists
      where datos->>'_origenManual' = 'true'
        and eliminado is not true
        and fecha >= to_char(now() - interval '7 days', 'YYYY-MM-DD')
      group by assigned, datos->>'_tareaManualId', fecha
     having count(*) > 1
      order by count(*) desc, assigned
      limit 60`);

  const rTot = await cli.query(
    `select count(*)::int as n
       from mdtask_checklists
      where datos->>'_origenManual' = 'true'
        and eliminado is not true
        and fecha >= to_char(now() - interval '7 days', 'YYYY-MM-DD')`);
  const totalSemana = rTot.rows[0] ? rTot.rows[0].n : 0;

  console.log('');
  console.log('[repetidas] checklists de manual en los últimos 7 días: %d', totalSemana);
  if (totalSemana === 0) {
    await cli.end();
    abortar('cero checklists de manual en una semana.',
      'Con el emisor corriendo eso es «no leí» o un cambio de nombre de campo ' +
      '(§12: `date` en Firestore es `fecha` en Postgres), no «no hay».');
  }

  if (rd.rows.length === 0) {
    console.log('✓ NINGUNA persona tiene la misma tarea del manual el mismo día en dos sitios.');
    console.log('  (Medido sobre los %d checklists de manual de la semana.)', totalSemana);
  } else {
    console.log('');
    console.log('YA ESCRITOS EN LA BASE — misma persona, misma tarea, mismo día, varios sitios');
    console.log('persona                         tarea                          fecha       copias  sitios');
    console.log('─'.repeat(118));
    for (const r of rd.rows) {
      console.log('%s %s %s %s %s',
        String(r.assigned || '(sin asignar)').slice(0, 30).padEnd(31),
        String(r.tarea || '(sin id)').slice(0, 29).padEnd(30),
        String(r.fecha).padEnd(11), String(r.copias).padEnd(7), r.lugares);
    }
    console.log('─'.repeat(118));
    const extra = rd.rows.reduce((n, r) => n + (Number(r.copias) - 1), 0);
    console.log('%d grupo(s) con copias de más · %d checklists sobrantes de %d de la semana (%s%%).',
      rd.rows.length, extra, totalSemana, ((extra / totalSemana) * 100).toFixed(1));
    console.log('');
    console.log('⚠ NO SE BORRA NADA DESDE AQUÍ. Algunas de esas copias pueden estar contestadas,');
    console.log('  y borrar evidencia de alguien es lo que el §5.5 prohíbe. Con esta lista');
    console.log('  enfrente se decide qué hacer, que es distinto de decidirlo a ciegas.');
  }

  await cli.end();
  console.log('');
  console.log('Lo que esto NO mide: las tareas creadas A MANO (sin `_origenManual`). Esas no las');
  console.log('emite el robot, así que repetirlas es una decisión de quien las asignó.');
})();
