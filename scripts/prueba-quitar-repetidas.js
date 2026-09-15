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
//  que no debe. La guarda `fueTrabajado` se ejercita en las seis senales, una
//  por una, porque basta que una falle para que ese caso pase desapercibido.
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

// ── `fueTrabajado`, extraida del propio script ──────────────────────────────
// Se compila la funcion real en vez de reescribirla: una copia aqui podria
// discrepar de la que de verdad protege, y entonces la prueba diria que hay
// guarda donde no la hay. Si el corte falla, ABORTA (no concluye con un cero).
const fuente = fs.readFileSync(path.join(RAIZ, 'scripts/quitar-entregas-repetidas.js'), 'utf8');
const i = fuente.indexOf('function fueTrabajado(');
if (i === -1) abortar('no encontre `fueTrabajado` en el script. Si le cambiaste el nombre, actualiza esta prueba en el MISMO commit.');
const fin = fuente.indexOf('\n}\n', i);
if (fin === -1) abortar('no encontre el cierre de `fueTrabajado`');
let fueTrabajado;
try {
  // eslint-disable-next-line no-eval
  fueTrabajado = eval('(function(){ ' + fuente.slice(i, fin + 3) + ' return fueTrabajado; })')();
} catch (e) { abortar('el corte no evalua: ' + ((e && e.message) || e)); }
if (typeof fueTrabajado !== 'function') abortar('el corte no produjo una funcion');

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
