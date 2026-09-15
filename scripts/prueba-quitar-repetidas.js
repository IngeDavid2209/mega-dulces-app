// ============================================================================
//  PRUEBA de `quitar-entregas-repetidas.js` — sin base real.
//
//  POR QUE EXISTE: este script BORRA (en blando) trabajo de 186 personas, solo,
//  contra produccion. Es la operacion mas destructiva del repo. Sus dos modos
//  de fallo no se parecen en gravedad:
//
//    · marcar de menos -> sobra una tarjeta. Molestia.
//    · marcar de mas   -> se le quita a alguien un turno que ya hizo. No se
//                         deshace con una disculpa.
//
//  Asi que lo que mas se prueba aqui NO es que borre bien: es que NO BORRE lo
//  que no debe. `fueTrabajado` se ejercita en sus DOCE senales, una por una,
//  porque basta que una falle para que ese caso se borre sin que nadie lo note.
//
//  Y la ultima seccion prueba la costura de la que depende todo: que el sello
//  `_asignadoAMano` SOBREVIVA al guardado. No comparando cadenas, sino metiendo
//  el sello por el camino real y mirando que sale al otro lado.
//
//  Corre con:  node scripts/prueba-quitar-repetidas.js
// ============================================================================
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const REGLA = path.join(RAIZ, 'dist/manual/emision-manual.util.js');

let fallos = 0, corridas = 0;
function afirmar(loQueMide, real, esperado) {
  corridas++;
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    fallos++;
    console.log('  FALLA  %s', loQueMide);
    console.log('         esperaba %s, medi %s', JSON.stringify(esperado), JSON.stringify(real));
  } else {
    console.log('  ok     %s', loQueMide);
  }
}
function abortar(msg) {
  console.error('\n[prueba-repetidas] ABORTA: ' + msg);
  process.exit(3);
}
if (!fs.existsSync(REGLA)) abortar('falta la regla compilada. `node scripts/compilar-manual.js`');

// La funcion REAL, compilada. Ya no se extrae del script: vive en la regla
// compartida y la usan el servidor y el script, asi que probar la de verdad es
// probar la que protege. (Antes se cortaba del archivo con `indexOf`, y un
// parser roto no da error: da una funcion que no es la que corre — §8.11 d.)
const fuente = fs.readFileSync(path.join(RAIZ, 'scripts/quitar-entregas-repetidas.js'), 'utf8');
const regla = require(REGLA);
const fueTrabajado = regla.fueTrabajado;
if (typeof fueTrabajado !== 'function') {
  abortar('la regla compilada no exporta `fueTrabajado`. Recompila con ' +
          '`node scripts/compilar-manual.js`; sin ella no hay guarda que probar.');
}
if (typeof regla.planDeLimpieza !== 'function') {
  abortar('la regla compilada no exporta `planDeLimpieza`.');
}

const limpio = () => ({ enviado: false, archivado: false, status: 'pendiente', datos: { items: [{ checked: false, photos: [] }] } });

console.log('\n=== LA GUARDA: que cuenta como "alguien lo trabajo" ===');
afirmar('un checklist intacto NO cuenta', fueTrabajado(limpio()), false);
const senales = [
  ['enviado', (c) => { c.enviado = true; }],
  ['archivado', (c) => { c.archivado = true; }],
  ['status completo', (c) => { c.status = 'completo'; }],
  ['una nota del colaborador', (c) => { c.datos.notaEmpleado = 'no hubo producto'; }],
  ['entrega con retraso', (c) => { c.datos.entregaConRetraso = true; }],
  ['un palomeo', (c) => { c.datos.items[0].checked = true; }],
  ['una foto', (c) => { c.datos.items[0].photo = 'http://x/f.jpg'; }],
  ['una galeria con algo', (c) => { c.datos.items[0].photos = ['http://x/1.jpg']; }],
  ['un comentario', (c) => { c.datos.items[0].comentario = 'ok'; }],
  ['un monto', (c) => { c.datos.items[0].monto = 120; }],
  ['un folio', (c) => { c.datos.items[0].folio = 'A-1'; }],
];
for (const [nombre, romper] of senales) {
  const c = limpio(); romper(c);
  afirmar('lo protege: ' + nombre, fueTrabajado(c), true);
}
// Un monto en CERO es un dato capturado, no la ausencia de uno: si se leyera
// como vacio, se borraria un arqueo de caja que dio cero.
const cero = limpio(); cero.datos.items[0].monto = 0;
afirmar('un monto de 0 tambien es trabajo capturado', fueTrabajado(cero), true);

console.log('\n=== GUARDIA DE DISCRIMINACION ===');
// Sin esto, un `fueTrabajado` que devolviera siempre true pasaria las 12 de
// arriba — y ademas seria "seguro", porque no borraria nada nunca. Un script
// que no borra nada pasa por prudente y no hace su trabajo.
if (fueTrabajado(limpio()) !== false) {
  fallos++;
  console.log('  FALLA  la guarda dice que TODO esta trabajado: no borraria nunca');
} else {
  console.log('  ok     distingue: intacto=false y las %d senales=true', senales.length + 1);
}

console.log('\n=== EL PLAN: que se quita y que NO se toca ===');
const ck = (id, store, extra) => Object.assign({
  id, assigned: 'Veronica Magana Corona', store, fecha: '2026-09-15',
  enviado: false, archivado: false, status: 'pendiente',
  datos: { _tareaManualId: 'encargado-sucursal.apertura', items: [{ checked: false, photos: [] }] },
}, extra || {});
const lugares = new Map([['veronica magana corona', ['8 Esquinas', 'MANTENIMIENTO', 'SISTEMAS']]]);

const caso = regla.planDeLimpieza(
  [ck('man_a_8e', '8 Esquinas'), ck('man_a_mant', 'MANTENIMIENTO'), ck('man_a_sis', 'SISTEMAS')],
  lugares);
afirmar('de tres copias quita dos', caso.quitar.length, 2);
afirmar('y conserva la del sitio con cuadrilla',
  [...new Set(caso.quitar.map(q => q.conservaEn))], ['8 Esquinas']);
afirmar('las que quita son las dos administrativas',
  caso.quitar.map(q => q.store).sort(), ['MANTENIMIENTO', 'SISTEMAS']);
afirmar('sin conflictos', caso.conflictos.length, 0);

// EL CASO QUE MAS IMPORTA: si la copia que sobra ya se trabajo, NO se toca nada.
const trabajada = regla.planDeLimpieza(
  [ck('man_a_8e', '8 Esquinas'),
   ck('man_a_mant', 'MANTENIMIENTO', { datos: { _tareaManualId: 'encargado-sucursal.apertura', items: [{ checked: true }] } })],
  lugares);
afirmar('si la copia que sobra YA SE TRABAJO, no se quita nada', trabajada.quitar.length, 0);
afirmar('y sale como conflicto, con su motivo',
  /YA SE TRABAJ/.test((trabajada.conflictos[0] || {}).motivo || ''), true);

// La asignada A MANO nunca se toca: alguien la puso ahi a proposito.
const aMano = regla.planDeLimpieza(
  [ck('man_a_8e', '8 Esquinas'),
   ck('man_a_mant', 'MANTENIMIENTO', { datos: { _tareaManualId: 'encargado-sucursal.apertura', _asignadoAMano: true, items: [] } })],
  lugares);
afirmar('la asignada a mano queda fuera del grupo', aMano.quitar.length, 0);

// Una sola copia no se toca jamas, aunque su sitio no tenga cuadrilla: seria
// dejar a la persona sin la tarea, que es peor que la copia de mas.
const sola = regla.planDeLimpieza([ck('man_a_mant', 'MANTENIMIENTO')], lugares);
afirmar('una entrega sola nunca se quita', sola.quitar.length, 0);

// Sin ficha no se decide.
const sinFicha = regla.planDeLimpieza(
  [ck('man_a_8e', '8 Esquinas'), ck('man_a_mant', 'MANTENIMIENTO')], new Map());
afirmar('sin ficha resoluble no se toca nada', sinFicha.quitar.length, 0);
afirmar('y se reporta', sinFicha.conflictos.length, 1);

console.log('\n=== EL SELLO SOBREVIVE AL GUARDADO (la costura de la que depende la guarda) ===');
// La exclusion de arriba lee `datos._asignadoAMano`. Pero quien decide si ese
// campo acaba en el jsonb es `desglosar()` de api/checklists.js, y hoy acaba
// ahi porque el campo NO esta en su mapa de columnas: la proteccion descansa en
// una AUSENCIA, que es justo lo que nadie nota cuando desaparece.
//
// Otra sesion lo cazo y lo fijo comparando cadenas. Esto lo comprueba de la
// forma fuerte: mete el sello por el camino de guardado REAL y mira que sale al
// otro lado. Si algun dia `desglosar` cambia, esto falla aunque el nombre del
// campo siga escrito en todas partes.
const Module = require('module');
function sembrarModulo(ruta, exportaciones) {
  const resuelto = require.resolve(ruta);
  const m = new Module(resuelto, null);
  m.filename = resuelto; m.loaded = true; m.exports = exportaciones;
  require.cache[resuelto] = m;
}
let jsonbCapturado = null;
sembrarModulo(path.join(RAIZ, 'api/db.js'), {
  dbConfigurada: () => true,
  query: async (sql, p) => {
    if (/^\s*insert into mdtask_checklists/i.test(String(sql))) {
      jsonbCapturado = p[p.length - 1];
      return { rows: [{ id: p[0] }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  },
});
const errReal = console.error, warnReal = console.warn;
console.error = () => {}; console.warn = () => {};
require(path.join(RAIZ, 'api/checklists')).insertarSiNoExiste({
  id: 'man_prueba_sello', name: 'X', assigned: 'Nadie Existente',
  store: 'MANTENIMIENTO', date: '2026-09-15',
  _tareaManualId: 't.x', _asignadoAMano: true, _asignadoPor: 'David', items: [],
}).then(() => {
  console.error = errReal; console.warn = warnReal;
  const d = JSON.parse(jsonbCapturado || '{}');
  afirmar('el sello de asignacion a mano llega al jsonb', d._asignadoAMano, true);
  afirmar('y tambien el id de tarea, que es lo que agrupa', d._tareaManualId, 't.x');
  cerrar();
}).catch(e => {
  console.error = errReal; console.warn = warnReal;
  abortar('el guardado real no se pudo ejercitar: ' + ((e && e.message) || e));
});

function cerrar() {
console.log('\n=== EL SCRIPT NO ESCRIBE SIN --aplicar ===');
// Se corre de verdad, sin DATABASE_URL: tiene que ABORTAR y no intentar nada.
let salida = '', codigo = 0;
try {
  const env = { ...process.env }; delete env.DATABASE_URL;
  salida = execFileSync(process.execPath, [path.join(RAIZ, 'scripts/quitar-entregas-repetidas.js')],
    { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  codigo = e.status; salida = (e.stdout || '') + (e.stderr || '');
}
afirmar('sin DATABASE_URL aborta con codigo 1', codigo, 1);
afirmar('y lo dice', /falta DATABASE_URL/.test(salida), true);
afirmar('no hay un solo `delete` en el script', /\bdelete\s+from\b/i.test(fuente), false);
afirmar('la reversa existe', /--revertir/.test(fuente), true);

console.log('');
if (fallos) {
  console.log('[prueba-repetidas] %d FALLA(S) de %d afirmaciones.', fallos, corridas);
  process.exit(2);
}
console.log('[prueba-repetidas] %d afirmaciones en verde, mas la guardia.', corridas);
process.exit(0);
}
