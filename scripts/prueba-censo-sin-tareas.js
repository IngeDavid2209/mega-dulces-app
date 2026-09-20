/**
 * 🧮 EL CENSO DE «QUIÉN NO TIENE TAREAS», CONTRA UNA BASE SIMULADA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Instrucción de David (20/sep/2026): «revisa el perfil de todos todos todos y
 * dame los nombres, y si tiene puesto dámelo también, de quienes no tengan
 * tareas asignadas».
 *
 * `diagnostico-sin-tareas.js --todos` contesta eso, pero corre contra
 * PRODUCCIÓN y lo ejecuta David con su credencial (§8.7: yo no la toco). O sea
 * que sin esta prueba yo le estaría mandando a correr contra la base de la
 * empresa un código que nunca se ha ejecutado — y si revienta en la línea 300
 * después de dos minutos, el que pierde la tarde es él.
 *
 * Aquí se ejecuta el camino completo con `api/db.js` sembrado en la caché de
 * `require`, que es la misma técnica de `prueba-emisor-servidor.js`.
 *
 * ─── LO QUE DE VERDAD SE PRUEBA ───────────────────────────────────────────
 * No «que no crashee»: que CLASIFIQUE. Cada ficha del fixture está construida
 * para caer en una cubeta distinta, y se exige que cada una aparezca donde le
 * toca. Un censo que metiera a todo el mundo en la misma cubeta no daría
 * ningún error y mandaría a capturar puestos a gente que ya los tiene.
 *
 * ⚠ Y LA FILA QUE MÁS PESA ES LA DE LA ENCARGADA. Es el caso que David
 * describió: tiene tareas, vivas, y aun así ve un cero. Esa NO puede salir en
 * la lista de «sin tareas» — si saliera, el reporte mandaría a arreglarle la
 * ficha a alguien cuya ficha está bien, y el problema real (la bandeja donde
 * aterriza) seguiría ahí.
 */

const path = require('path');
const fs = require('fs');
const Module = require('module');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');

function abortar(motivo) {
  console.error('');
  console.error('[censo] ABORTA: ' + motivo);
  console.error('[censo] "No pude medir" y "está roto" son dos cosas distintas.');
  process.exit(3);
}

if (!fs.existsSync(path.join(RAIZ, 'dist', 'manual', 'emision-manual.util.js'))) {
  abortar('no hay dist/manual. Corre `npm run build` antes: el diagnóstico llama a la regla COMPILADA.');
}

function hoyYmd() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}
const HOY = hoyYmd();

// ── LAS FICHAS, una por cubeta ────────────────────────────────────────────
// `anaquelista` y `encargado-sucursal` tienen manual; `vendedor-rd` no (es uno
// de los 70 sin norma escrita). Se eligen del catálogo real, no inventados.
const FICHAS = [
  { id: 'f1', nombre: 'Ana ConTareas', rol: 'trabajador', activo: true,
    datos: { puestoId: 'anaquelista', sucursales: ['8 Esquinas'] } },
  { id: 'f2', nombre: 'Vero Encargada', rol: 'trabajador', activo: true,
    // Supervisora: manda vista de gestión, así que aterriza en «Pendientes del
    // equipo», que EXCLUYE las suyas. Es el caso de la captura de David.
    datos: { puestoId: 'encargado-sucursal', sucursales: ['8 Esquinas'],
             puedeVerHistorial: true } },
  { id: 'f3', nombre: 'Caro SinPuesto', rol: 'trabajador', activo: true,
    datos: { sucursales: ['8 Esquinas'] } },
  { id: 'f4', nombre: 'Beto SinManual', rol: 'trabajador', activo: true,
    datos: { puestoId: 'vendedor-rd', sucursales: ['8 Esquinas'] } },
  { id: 'f5', nombre: 'Dani SinSucursal', rol: 'trabajador', activo: true,
    datos: { puestoId: 'anaquelista', sucursales: [] } },
  { id: 'f6', nombre: 'Eva Inactiva', rol: 'trabajador', activo: false,
    datos: { puestoId: 'anaquelista', sucursales: ['8 Esquinas'] } },
];

/** A quién le hay checklists vivos hoy. Ana y Vero: las demás, ninguno. */
const CHECKLISTS = [
  { id: 'man_x_1', assigned: 'Ana ConTareas', store: '8 Esquinas', fecha: HOY,
    eliminado: false, enviado: false, archivado: false, status: 'pendiente', datos: {} },
  { id: 'man_x_2', assigned: 'Vero Encargada', store: '8 Esquinas', fecha: HOY,
    eliminado: false, enviado: false, archivado: false, status: 'pendiente', datos: {} },
  { id: 'man_x_3', assigned: 'Vero Encargada', store: '8 Esquinas', fecha: HOY,
    eliminado: false, enviado: false, archivado: false, status: 'pendiente', datos: {} },
];

function queryFalsa(sql) {
  const s = String(sql);
  // El diagnóstico busca primero el schema con más filas; se le contesta que
  // todo vive en uno solo, que es lo que pasa en producción (`eajd`).
  if (/information_schema|pg_tables|table_schema/i.test(s)) {
    return { rows: [{ schema: 'eajd', tabla: 'mdtask_usuarios', n: FICHAS.length }] };
  }
  if (/count\(\*\)/i.test(s) && /mdtask_usuarios/i.test(s)) {
    return { rows: [{ n: FICHAS.length, count: FICHAS.length }] };
  }
  if (/from\s+"?\w*"?\.?mdtask_usuarios/i.test(s)) return { rows: FICHAS };
  if (/from\s+"?\w*"?\.?mdtask_checklists/i.test(s)) return { rows: CHECKLISTS };
  return { rows: [] };
}

function sembrarModulo(ruta, exportaciones) {
  const resuelto = require.resolve(ruta);
  const m = new Module(resuelto, null);
  m.filename = resuelto; m.loaded = true; m.exports = exportaciones;
  require.cache[resuelto] = m;
}

sembrarModulo(path.join(RAIZ, 'api/db.js'), {
  query: async (sql, params) => queryFalsa(sql, params),
  dbConfigurada: () => true,
});
// El buscador de schema hace sus propias consultas; se le da la respuesta
// directa para que el fixture no dependa de su forma interna.
sembrarModulo(path.join(RAIZ, 'scripts/_schema-mdtask.js'), {
  schemaDeMdtask: async () => 'eajd',
});

// ── Se captura todo lo que imprime el diagnóstico ─────────────────────────
const salida = [];
const logReal = console.log;
console.log = (...a) => {
  try { salida.push(require('util').format(...a)); } catch { salida.push(a.join(' ')); }
};

process.argv = [process.argv[0], 'diagnostico-sin-tareas.js', '--todos'];
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://simulada/local';

let salioMal = null;
const exitReal = process.exit;
process.exit = (c) => { salioMal = c; throw new Error('__salida__' + c); };

(async () => {
  try {
    require(path.join(RAIZ, 'scripts/diagnostico-sin-tareas.js'));
    // El script es async por dentro; se le da tiempo a terminar.
    await new Promise((r) => setTimeout(r, 3000));
  } catch (e) {
    if (!String(e.message).startsWith('__salida__')) {
      console.log = logReal; process.exit = exitReal;
      abortar('el diagnóstico reventó: ' + e.message + '\n' + String(e.stack).split('\n').slice(1, 4).join('\n'));
    }
  }
  console.log = logReal; process.exit = exitReal;

  const texto = salida.join('\n');
  if (salioMal && salioMal !== 0) {
    logReal(texto);
    abortar('el diagnóstico salió con código ' + salioMal + ' (ver arriba).');
  }
  if (texto.length < 300) {
    abortar('el diagnóstico imprimió ' + texto.length + ' bytes: no llegó a hacer el censo.');
  }

  logReal('');
  logReal('  🧮 CENSO CONTRA BASE SIMULADA — %s fichas, %s checklists vivos',
    FICHAS.length, CHECKLISTS.length);
  logReal('  ──────────────────────────────────────────────────────────────');

  let fallos = 0;
  const exige = (que, cond, pista) => {
    if (cond) { logReal('  ✓ %s', que); return; }
    logReal('  ✗ %s%s', que, pista ? '  — ' + pista : '');
    fallos++;
  };

  // El bloque de «sin tareas» y el de «las tienen y no las ven», por separado.
  const iSinTareas = texto.indexOf('POR QUE NO TIENEN');
  const iNoLasVe = texto.indexOf('Y ESTOS SI TIENEN TAREAS');
  if (iSinTareas < 0) abortar('no encontré el bloque del censo en la salida.');
  const bloqueSin = iNoLasVe > 0 ? texto.slice(iSinTareas, iNoLasVe) : texto.slice(iSinTareas);
  const bloqueVe = iNoLasVe > 0 ? texto.slice(iNoLasVe) : '';

  exige('cuenta las 6 fichas', /CENSO DE 6 FICHAS/.test(texto),
    'el denominador es lo que hace que los ceros valgan');
  exige('Caro (sin puesto) sale en la cubeta A', /A ·[\s\S]*?Caro SinPuesto/.test(bloqueSin)
    || /Caro SinPuesto[\s\S]*?SIN PUESTO/.test(bloqueSin));
  exige('Beto sale por «su puesto no tiene manual» y CON su puesto escrito',
    /Beto SinManual\s+vendedor-rd/.test(bloqueSin),
    'David pidió el puesto junto al nombre: sin él no se sabe a quién reclamarle');
  exige('Dani sale por «sin sucursal»', /Dani SinSucursal/.test(bloqueSin));
  exige('Eva (inactiva) sale como inactiva y no como un problema de captura',
    /Eva Inactiva/.test(bloqueSin) && /B0/.test(bloqueSin));

  // ⚠ LA FILA QUE MÁS PESA.
  exige('Ana (con tareas) NO sale en la lista de sin tareas',
    !/Ana ConTareas/.test(bloqueSin),
    'estaría mandando a arreglar la ficha de alguien que sí tiene trabajo');
  exige('VERO (Encargada) NO sale como «sin tareas»: las tiene y no las ve',
    !/Vero Encargada/.test(bloqueSin),
    'es el caso de David: su ficha está bien y el cero es de la PANTALLA');
  exige('y SÍ sale en la lista de «las tienen y no las ven», con sus 2',
    /Vero Encargada\s+encargado-sucursal\s+2/.test(bloqueVe));
  // ⚠ LA QUE DISCRIMINA. Sin ella, esa lista la pasaba un filtro que metiera a
  // TODO el que tiene tareas -que es lo que hacia, y se vio MIRANDO la salida
  // con las nueve aserciones en verde-. Ana tiene tareas y NO manda vista de
  // gestion: las ve en «Mis tareas», asi que no pinta nada en esa lista.
  exige('Ana (con tareas, sin vista de gestion) NO sale en esa segunda lista',
    !/Ana ConTareas/.test(bloqueVe),
    'esa lista saldria con las 154 personas que trabajan, bajo un titulo falso');

  // GUARDIA DE DISCRIMINACIÓN (§8.11 c). Sin esto, un censo que metiera a todos
  // en una sola cubeta pasaría media lista de arriba por vacuidad.
  const cubetas = (texto.match(/cubetas distintas encontradas: (\d+)/) || [])[1];
  if (!cubetas || Number(cubetas) < 4) {
    abortar('el censo encontró ' + (cubetas || '0') + ' cubetas distintas sobre 6 fichas ' +
            'construidas para caer en cinco: no está clasificando, está etiquetando.');
  }
  logReal('  ✓ discrimina: %s cubetas distintas sobre 6 fichas', cubetas);

  logReal('  ──────────────────────────────────────────────────────────────');
  logReal('  %s fallo(s)', fallos);
  logReal('');
  logReal('  Lo que esto NO prueba: los datos de producción. Prueba que el censo');
  logReal('  CLASIFICA y que separa «no tiene tareas» de «las tiene y no las ve».');
  logReal('  La corrida real la hace David con la credencial (§8.7).');
  logReal('');
  // VER=1 imprime la salida completa del censo, para poder ensenarle a David
  // exactamente lo que va a ver antes de que lo corra contra produccion.
  if (fallos || process.env.VER) { logReal(texto); }
  process.exit(fallos ? 2 : 0);
})();
