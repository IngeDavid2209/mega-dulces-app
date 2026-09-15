// ============================================================================
//  DIAGNOSTICO — LAS TAREAS DEL DIA: ¿no se emitieron, o se emitieron y se borraron?
//
//  LA PREGUNTA QUE ESTE SCRIPT CONTESTA, y ninguna otra:
//
//      La pantalla dice «No tienes tareas hoy» y los dos badges dicen 0. Ese
//      cero tiene TRES causas posibles que en pantalla se ven IDENTICAS:
//
//        A  nunca se emitieron         -> no hay filas `man_` de ese dia
//        B  se emitieron y se borraron -> las filas existen con eliminado = true
//        C  existen y estan vivas      -> el cero es de la INTERFAZ, no de la emision
//
//      Distinguirlas cambia por completo el trabajo que sigue, y la B tiene una
//      consecuencia que nadie adivinaria: EL ROBOT NO LAS REPONE. Su
//      idempotencia lee /api/checklists?desde=hoy&hasta=hoy y esa respuesta
//      INCLUYE los eliminados (api/checklists.js:17 deja el filtro de
//      `eliminado` en el cliente). Un checklist de hoy marcado eliminado
//      bloquea su propia reemision el resto del dia. Manana vuelve solo,
//      porque cambia la llave de periodo.
//
//  POR QUE NO BASTA CON MIRAR HOY (§8.11 a): un «0 filas de hoy» y un «no pude
//  leer» se escriben igual. Por eso se imprimen SIEMPRE los siete dias
//  anteriores al lado. Un dia normal con sus cientos de filas es el control
//  positivo de que la tabla se lee de verdad; si TODA la ventana sale en cero,
//  el script ABORTA en vez de concluir que la empresa dejo de trabajar.
//
//  NO ESCRIBE NADA. Ni un insert, ni un update, ni un delete.
//
//  Como se corre (PowerShell, desde la raiz del repo):
//      $env:DATABASE_URL = "<URL PUBLICA de Postgres de Railway>"
//      node scripts/diagnostico-emision-hoy.js
//      node scripts/diagnostico-emision-hoy.js --fecha=2026-09-14
// ============================================================================
const { query, dbConfigurada } = require('../api/db');

const PREFIJO_MANUAL = 'man_';   // robot de manual (robot-manual.service.ts, idemKey)
const DIAS_VENTANA = 7;

function abortar(msg, detalle) {
  console.error('\n[emision] ABORTA: ' + msg);
  if (detalle) console.error(detalle);
  console.error('[emision] No concluyas de esta corrida.');
  process.exit(1);
}

/** Host, puerto y base de la URL. La contrasena se descarta aqui y no sale. */
function coordenadaSinSecreto(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      puerto: u.port || '5432',
      base: (u.pathname || '').replace(/^\//, '') || '(sin nombre)',
      usuario: u.username || '(sin usuario)',
      // u.password existe y NO se lee.
    };
  } catch { return null; }
}

/** 'YYYY-MM-DD' en hora LOCAL, que es como el front escribe la columna `fecha`. */
function ymd(d) {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().split('T')[0];
}

function hhmm(epochMs) {
  if (epochMs == null) return '--:--';
  const d = new Date(Number(epochMs));
  if (isNaN(d.getTime())) return '--:--';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/**
 * Padding hecho en JS, no con printf.
 *
 * `util.format` (lo que usa console.log) NO soporta el ancho de printf: un
 * '%-12s' se imprime LITERAL y el argumento se va al final de la linea. Ya
 * mordio dos veces en este repo (el %4d del 4/sep y el del 7/sep), y la tabla
 * de un diagnostico es justo donde mas duele: sale ilegible y parece que el
 * dato esta mal, no el formato.
 */
const izq = (s, n) => String(s == null ? '' : s).padEnd(n).slice(0, n);
const der = (s, n) => String(s == null ? '' : s).padStart(n);

/**
 * Reparte las filas de un dia en las cubetas que importan.
 *
 * El orden de las condiciones NO es libre: es el MISMO que aplica el poll de
 * `checklist.ts` (descarta eliminado/archivado primero y enviado despues), para
 * que «vivas» signifique aqui exactamente lo que la pantalla pinta como
 * pendiente. Si se invirtiera, una fila enviada Y eliminada se contaria en la
 * cubeta que la app no usa y los dos numeros dejarian de ser comparables.
 */
function cubetas(filas) {
  const c = {
    total: 0, manual: 0, otras: 0,
    vivas: 0, enviadas: 0, eliminadas: 0, archivadas: 0,
    personas: new Set(),
  };
  for (const f of filas) {
    c.total++;
    if (String(f.id || '').startsWith(PREFIJO_MANUAL)) c.manual++; else c.otras++;
    if (f.assigned) c.personas.add(f.assigned);
    if (f.eliminado) c.eliminadas++;
    else if (f.archivado) c.archivadas++;
    else if (f.enviado) c.enviadas++;
    else c.vivas++;
  }
  return c;
}

/**
 * LA CONCLUSION, SEPARADA DE LA BASE.
 *
 * Vive aparte y devuelve una LETRA porque si no, no se puede probar: una
 * conclusion escrita dentro de `main()` solo se ejercita con credenciales de
 * produccion, o sea que no se ejercita nunca. Asi `prueba-diagnostico-emision.js`
 * la corre con fixtures y comprueba lo unico que importa de un diagnostico:
 * que los cuatro casos den CUATRO letras distintas. Un veredicto que siempre
 * dice lo mismo pasa cualquier corrida y no mide nada (§8.11 c).
 *
 *   A  no hay filas `man_`                  -> nunca se emitieron
 *   B  las hay, 0 vivas y alguna eliminada  -> se emitieron y se borraron
 *   C  hay vivas                            -> el cero es de la interfaz
 *   D  las hay, 0 vivas, 0 eliminadas       -> se trabajaron y se entregaron
 */
function veredicto(c) {
  if (c.manual === 0) return 'A';
  if (c.vivas === 0 && c.eliminadas > 0) return 'B';
  if (c.vivas > 0) return 'C';
  return 'D';
}

async function main() {
  if (!dbConfigurada()) {
    abortar('falta DATABASE_URL. Desde tu maquina usa la URL PUBLICA de Railway ' +
            '(railway.internal no resuelve fuera de la red de Railway). Este script SOLO LEE.');
  }
  const decl = coordenadaSinSecreto(process.env.DATABASE_URL);
  if (!decl) abortar('la DATABASE_URL no se pudo interpretar como URL.');

  const arg = (process.argv.find(a => a.startsWith('--fecha=')) || '').split('=')[1];
  if (arg && !/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    abortar('--fecha espera YYYY-MM-DD y llego "' + arg + '"');
  }
  const DIA = arg || ymd(new Date());

  console.log('\n=== A DONDE ESTOY PREGUNTANDO (sin la contrasena) ===');
  console.log('  %s:%s/%s como %s', decl.host, decl.puerto, decl.base, decl.usuario);
  console.log('  dia analizado: %s%s', DIA,
    arg ? '  (pedido con --fecha)' : '  (hoy, en la hora local de esta maquina)');

  // ── La ventana: el dia en cuestion y los DIAS_VENTANA anteriores ──────────
  // De UNA sola consulta, a proposito: asi el dia analizado y su control
  // positivo salen de la misma lectura. Si la consulta fallara, fallan los dos
  // a la vez y eso se ve; con dos consultas, una podria fallar sola y el cero
  // del dia pareceria un dato.
  const desde = ymd(new Date(new Date(DIA + 'T12:00:00').getTime() - DIAS_VENTANA * 86400000));
  let filas;
  try {
    filas = (await query(
      `select id, assigned, store, fecha, enviado, eliminado, archivado,
              timestamp_creacion, created_by
         from mdtask_checklists
        where fecha >= $1 and fecha <= $2
        order by fecha asc`,
      [desde, DIA]
    )).rows;
  } catch (e) {
    abortar('no se pudo leer mdtask_checklists: ' + (e && e.message));
  }

  // §8.11(a): el tamano de la entrada ANTES de concluir nada.
  console.log('\n=== TAMANO DE LA ENTRADA ===');
  console.log('  ventana leida ................... %s .. %s  (%d dias)', desde, DIA, DIAS_VENTANA + 1);
  console.log('  filas leidas en toda la ventana .. %d', filas.length);

  if (filas.length === 0) {
    abortar('CERO filas en ocho dias completos. Con la app en produccion eso no es ' +
            '«no hay trabajo»: es «no lei».',
            '  Comprueba a que base le estas hablando con:  node scripts/diagnostico-conexion.js');
  }

  // ── Dia por dia ───────────────────────────────────────────────────────────
  const porDia = new Map();
  for (const f of filas) {
    const k = String(f.fecha || '(sin fecha)');
    if (!porDia.has(k)) porDia.set(k, []);
    porDia.get(k).push(f);
  }

  console.log('\n=== DIA POR DIA  (los dias pasados son el CONTROL POSITIVO: prueban que la tabla se lee) ===');
  console.log('  ' + izq('fecha', 12) + der('total', 7) + der('manual', 7) +
    der('vivas', 7) + der('enviadas', 9) + der('eliminadas', 11) +
    der('archivadas', 11) + der('personas', 9));
  const dias = [...porDia.keys()].sort();
  for (const d of dias) {
    const c = cubetas(porDia.get(d));
    console.log('  ' + izq(d, 12) + der(c.total, 7) + der(c.manual, 7) +
      der(c.vivas, 7) + der(c.enviadas, 9) + der(c.eliminadas, 11) +
      der(c.archivadas, 11) + der(c.personas.size, 9) +
      (d === DIA ? '   <- el dia en cuestion' : ''));
  }
  if (!porDia.has(DIA)) {
    console.log('  ' + izq(DIA, 12) + der(0, 7) + der(0, 7) + der(0, 7) +
      der(0, 9) + der(0, 11) + der(0, 11) + der(0, 9) +
      '   <- el dia en cuestion (SIN UNA SOLA FILA)');
  }

  const deDia = porDia.get(DIA) || [];
  const h = cubetas(deDia);
  const pasados = dias.filter(d => d !== DIA);
  const totalPasado = pasados.reduce((s, d) => s + porDia.get(d).length, 0);
  const promPasado = pasados.length ? Math.round(totalPasado / pasados.length) : 0;

  console.log('\n=== %s CONTRA SU PROPIA HISTORIA ===', DIA);
  console.log('  filas de ese dia ..................... %d', h.total);
  console.log('  de ellas, del manual (`man_`) ........ %d', h.manual);
  console.log('  promedio de los %d dias con datos .... %d', pasados.length, promPasado);
  console.log('  personas alcanzadas ese dia .......... %d', h.personas.size);

  // ── La muestra que decide ─────────────────────────────────────────────────
  const eliminadasManual = deDia.filter(f => f.eliminado && String(f.id).startsWith(PREFIJO_MANUAL));
  if (eliminadasManual.length) {
    console.log('\n=== MUESTRA DE LAS `man_` ELIMINADAS DE ESE DIA (hasta 15 de %d) ===', eliminadasManual.length);
    console.log('  La hora es la de CREACION (timestamp_creacion). La tabla NO guarda cuando');
    console.log('  ni quien borro: `eliminado` es un booleano sin bitacora (009_checklists.sql),');
    console.log('  asi que esa pregunta no se puede contestar con estos datos y no se finge.');
    console.log('  ' + izq('creada', 7) + izq('persona', 29) + izq('sucursal', 21) + 'id');
    for (const f of eliminadasManual.slice(0, 15)) {
      console.log('  ' + izq(hhmm(f.timestamp_creacion), 7) +
        izq(f.assigned || '(sin asignado)', 29) +
        izq(f.store || '(sin sucursal)', 21) + f.id);
    }
  }

  // ── VEREDICTO: las tres lecturas, separadas ───────────────────────────────
  console.log('\n=== VEREDICTO ===');
  const letra = veredicto(h);
  if (letra === 'A') {
    console.log('  (A) NUNCA SE EMITIERON. No hay una sola fila `man_` con fecha %s.', DIA);
    console.log('      La emision del manual vive SOLO en el navegador de quien abre /tareas');
    console.log('      (checklist.ts:2055; se repite cada 5 min mientras esa pestana siga');
    console.log('      abierta). Si nadie la abrio ese dia, nadie recibio nada: no hay ningun');
    console.log('      proceso en el servidor que lo haga. Los cuatro polls de server.js son');
    console.log('      flotilla, avisos, bloques y pagos.');
  } else if (letra === 'B') {
    console.log('  (B) SE EMITIERON Y SE BORRARON: %d filas `man_` de ese dia, %d eliminadas,',
      h.manual, h.eliminadas);
    console.log('      CERO vivas. El robot NO las repone ese dia: su idempotencia lee la lista');
    console.log('      del dia, esa lista trae los eliminados, y sus ids ya estan tomados.');
    console.log('      Reponerlas es marcar eliminado = false. Este script NO lo hace.');
  } else if (letra === 'C') {
    console.log('  (C) EXISTEN Y ESTAN VIVAS: %d de %d filas `man_`.', h.vivas, h.manual);
    console.log('      Entonces el cero de la pantalla NO es de emision, es de la interfaz:');
    console.log('      el alcance de quien mira, el filtro de la bandeja, o un poll que no');
    console.log('      respondio. El siguiente paso esta en la pantalla, no en el robot.');
  } else {
    console.log('  Ese dia tiene %d filas `man_`: %d enviadas, %d archivadas, 0 vivas y 0',
      h.manual, h.enviadas, h.archivadas);
    console.log('      eliminadas. Es el unico caso en que un cero en pantalla es CORRECTO:');
    console.log('      se trabajaron y se entregaron.');
  }

  console.log('');
  process.exit(0);
}

// Solo arranca cuando se INVOCA; requerido como modulo (la prueba) no toca la base.
if (require.main === module) {
  main().catch(e => abortar('error no previsto: ' + ((e && e.stack) || e)));
}

module.exports = { cubetas, veredicto, ymd };

