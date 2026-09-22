// ============================================================================
//  ⏰ ¿SE ESTÁ EMITIENDO CON LA VENTANA 06:00 → 23:00? — SOLO LEE
//
//  Contesta UNA pregunta: los puntos que el emisor creó para una fecha, ¿salen
//  todos dentro de la ventana, o quedó alguna tarea con su hora vieja?
//
//  ─── POR QUÉ EXISTE ───────────────────────────────────────────────────────
//  El 22/sep/2026 las 50 tareas del catálogo pasaron de NUEVE horas distintas
//  —9 949 puntos en una semana repartidos entre 09:00, 09:30, 10:00, 11:00,
//  12:00, 18:00, 19:00 y 23:59— a una sola ventana. La prueba unitaria fija el
//  catálogo; esto mide lo que de verdad se escribió en la base, que es otra
//  cosa: entre el catálogo y la fila hay un emisor, un `armarChecklist` y una
//  sobreescritura por horario de RH que se apagó ese día.
//
//  ─── LA VENTANA NO SE TECLEA AQUÍ, SE IMPORTA ─────────────────────────────
//  Se lee de `dist/manual`, que es la MISMA regla compilada que usa el emisor
//  del servidor. Escribir '06:00' y '23:00' a mano crearía una tercera versión
//  de la verdad, libre de discrepar de las otras dos, y este script diría que
//  todo está bien el día que alguien mueva la ventana y olvide este archivo
//  (§8.11 d). Sin `dist/manual` ABORTA: prefiere no medir a medir contra un
//  valor inventado.
//
//  ─── LOS CEROS NO CONCLUYEN SOLOS (§8.11 a) ───────────────────────────────
//  · sin DATABASE_URL           -> aborta (no es "no hay datos")
//  · 0 puntos leídos            -> aborta: con la app en producción eso no es
//                                  "no se emitió", es "no leí"
//  · schema equivocado          -> `mdtask_checklists` devuelve 0 SIN ERROR por
//                                  la URL pública (el search_path es
//                                  `"$user", public`). Por eso el schema se
//                                  BUSCA y se imprime cuál se eligió.
//
//  Uso:
//     railway run -s Postgres -- node scripts/diagnostico-ventana-entrega.js
//     node scripts/diagnostico-ventana-entrega.js 2026-09-23
//
//  Códigos: 0 todo dentro de la ventana · 2 hay puntos fuera · 3 no pude medir.
// ============================================================================
const path = require('path');
const { Client } = require('pg');

const FECHA = process.argv[2] || null;   // null = hoy, en la fecha de la base

function abortar(msg) {
  console.error('\n  ABORTA: ' + msg);
  process.exit(3);
}

// ── La ventana sale de la regla compilada, nunca de un literal de aquí ──────
let VENTANA;
try {
  VENTANA = require(path.join(__dirname, '..', 'dist', 'manual', 'tareas-manual.catalogo.js')).VENTANA_MANUAL;
} catch (e) {
  abortar('falta `dist/manual`. Corre `npm run build` primero: sin la regla ' +
          'compilada este script tendría que inventar la ventana, y entonces no ' +
          'estaría midiendo el sistema sino a sí mismo.');
}
if (!VENTANA || !VENTANA.inicio || !VENTANA.fin) {
  abortar('`dist/manual` no exporta VENTANA_MANUAL. ¿Se renombró? No se adivina.');
}

const URL = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!URL) {
  abortar('sin DATABASE_URL ni DATABASE_PUBLIC_URL. No se inventa una conexión ' +
          'ni se escribe aquí ninguna credencial: se corre con\n' +
          '  railway run -s Postgres -- node scripts/diagnostico-ventana-entrega.js');
}

(async () => {
  const c = new Client({ connectionString: URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // ── 1 · el schema, BUSCADO y dicho en voz alta ────────────────────────────
  const sch = await c.query(
    `select table_schema, count(*)::int n from information_schema.tables
      where table_name like 'mdtask_%' group by 1 order by 2 desc`);
  if (!sch.rowCount) abortar('no hay una sola tabla `mdtask_` en esta base. ¿Es la de MDTask?');
  console.log('\n  schemas con tablas mdtask_: ' +
    sch.rows.map(r => r.table_schema + '=' + r.n).join(' · '));
  const schema = sch.rows[0].table_schema;
  console.log('  usando: ' + schema + '  (el de más tablas; los otros se descartaron)');
  await c.query('set search_path to ' + schema);

  // ── 2 · el denominador, ANTES de cualquier conclusión ─────────────────────
  const dia = FECHA
    ? { sql: '$1', args: [FECHA] }
    : { sql: `to_char(now(), 'YYYY-MM-DD')`, args: [] };

  const tot = await c.query(
    `select count(*)::int ck,
            coalesce(sum(jsonb_array_length(coalesce(datos->'items','[]'::jsonb))),0)::int pts
       from mdtask_checklists
      where id like 'man_%' and eliminado is not true and fecha = ` + dia.sql, dia.args);
  const { ck, pts } = tot.rows[0];
  console.log('  fecha medida: ' + (FECHA || 'hoy') +
    '  ·  ' + ck + ' checklists del manual  ·  ' + pts + ' puntos');

  if (!pts) {
    abortar('0 puntos emitidos para esa fecha. Con la app en producción eso NO es\n' +
            '  «no se emitió»: es «no leí» hasta que se demuestre. Comprueba el schema, la\n' +
            '  fecha y que el emisor haya dado su vuelta de medianoche.');
  }

  // ── 3 · la tabla, por momento y por ventana ───────────────────────────────
  const r = await c.query(
    `select coalesce(datos->>'_momento','(sin momento)') mom,
            coalesce(it->>'horaInicio','(sin)') ini,
            coalesce(it->>'horaLimite', it->>'time','(sin)') fin,
            count(*)::int n
       from mdtask_checklists ck,
            lateral jsonb_array_elements(coalesce(ck.datos->'items','[]'::jsonb)) it
      where ck.id like 'man_%' and ck.eliminado is not true and ck.fecha = ` + dia.sql + `
      group by 1,2,3 order by 1, 4 desc`, dia.args);

  console.log('\n  momento          inicio   limite   puntos');
  console.log('  ' + '─'.repeat(44));
  let dentro = 0, fuera = 0;
  const culpables = [];
  for (const x of r.rows) {
    const ok = x.ini === VENTANA.inicio && x.fin === VENTANA.fin;
    if (ok) dentro += x.n; else { fuera += x.n; culpables.push(x); }
    console.log('  ' + String(x.mom).padEnd(16) + String(x.ini).padEnd(8) +
      String(x.fin).padEnd(8) + String(x.n).padStart(6) + (ok ? '' : '   <- FUERA'));
  }

  // ── 4 · el veredicto, con su cifra ────────────────────────────────────────
  console.log('\n  ventana esperada: ' + VENTANA.inicio + ' -> ' + VENTANA.fin +
    '   (leída de dist/manual, no tecleada aquí)');
  console.log('  dentro: ' + dentro + '  ·  fuera: ' + fuera + '  ·  de ' + pts + ' puntos');
  console.log('  combinaciones distintas: ' + r.rowCount + '  (lo bueno es UNA por momento)');

  await c.end();

  if (fuera) {
    console.error('\n  ✗ ' + fuera + ' punto(s) fuera de la ventana, en ' +
      culpables.length + ' combinación(es).');
    console.error('    No es cosmético: esas plazas se juzgan con un reloj distinto al resto.');
    console.error('    Si son de una fecha ANTERIOR al 22/sep/2026 es lo esperado — lo ya');
    console.error('    emitido no se reescribe (§5.5). Si son de hoy, hay una tarea que se');
    console.error('    quedó con su hora vieja, o un camino que sobreescribe la del catálogo.');
    process.exit(2);
  }
  console.log('\n  ✓ los ' + dentro + ' puntos salieron dentro de la ventana.');
})().catch(e => { console.error('\n  FALLO: ' + e.message); process.exit(3); });
