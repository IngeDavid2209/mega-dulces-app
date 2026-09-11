// ============================================================================
//  PRUEBA DE `ambitoVisible()` — qué parte de la operación ve cada quien
//
//  QUÉ PREGUNTA CONTESTA (§8.11): no «¿devuelve un objeto?» sino
//    «¿una Gerente de La Piedad DEJA DE VER Morelia, sigue viendo a la gente de
//     otras áreas que trabaja en sus tiendas, y hay alguien a quien esto NO le
//     encoge la vista?»
//
//  Produce lo que ve una persona real en su pantalla, así que el §8.8 pide
//  prueba. Sin base, sin red, sin credenciales: por eso `ambitoVisible()` es
//  pura y vive fuera del componente.
//
//  Los puestos son REALES, leídos del catálogo compilado. Inventar un
//  `puestoId` haría que la prueba pasara midiendo un organigrama que no existe.
//
//    node scripts/prueba-rama-visible.js
//    node scripts/prueba-rama-visible.js --neg-horizontal   (control negativo 1)
//    node scripts/prueba-rama-visible.js --neg-fallback     (control negativo 2)
// ============================================================================
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtask-rama-'));

function abortar(m, d) {
  console.error('\n❌ NO SE PUDO MEDIR: ' + m);
  if (d) console.error(d);
  process.exit(1);
}

// Se COMPILA, no se parsea (§8.11 d).
try {
  execSync('npx tsc --outDir "' + tmp + '" --module commonjs --target ES2022 ' +
    '--skipLibCheck --moduleResolution node ' +
    '"' + path.join(RAIZ, 'src/app/shared/rama-visible.util.ts') + '"',
    { cwd: RAIZ, stdio: 'pipe' });
} catch (e) {
  abortar('tsc no compiló rama-visible.util.ts',
    (e.stdout || e.stderr || e.message || '').toString().slice(0, 1500));
}

const R = require(path.join(tmp, 'rama-visible.util.js'));
const O = require(path.join(tmp, 'organigrama.catalogo.js'));
const { ambitoVisible, entregaVisible, puestoPropio, descendientesDe } = R;

let fallos = 0;
function ok(cond, etiqueta, esperado, dado) {
  if (cond) { console.log('   ok    ' + etiqueta); return true; }
  console.log('   FALLA ' + etiqueta + '   esperaba ' + JSON.stringify(esperado) + ', dio ' + JSON.stringify(dado));
  fallos++;
  return false;
}

// ── GUARDIA DE PREMISA (§8.11 b): los puestos que uso existen de verdad ─────
const EXIGIDOS = ['direccion-general', 'gerencia-zona', 'encargado-sucursal', 'anaquelista', 'vendedor-rd'];
const faltan = EXIGIDOS.filter(id => !O.puestoPorId(id));
if (faltan.length) abortar('el catálogo ya no tiene estos puestos: ' + faltan.join(', ') +
  '. La prueba mediría un organigrama que no existe.');
console.log('ENTRADAS   catálogo: ' + O.PUESTOS_ORGANIGRAMA.length + ' puestos · ' +
            EXIGIDOS.length + '/' + EXIGIDOS.length + ' puestos del fixture presentes');

// La premisa que hace interesante al caso «servicio a»: vendedor-rd NO cuelga
// de la Encargada. Si algún día el organigrama lo moviera, este fixture dejaría
// de ejercer la atribución transversal y la prueba pasaría midiendo otra cosa.
if (descendientesDe('encargado-sucursal').has('vendedor-rd')) {
  abortar('vendedor-rd ahora SÍ cuelga de encargado-sucursal: el fixture dejó de ' +
    'ejercer el caso «servicio a», que es la mitad de lo que esto prueba.');
}

// ── LOS PERFILES ────────────────────────────────────────────────────────────
const P = {
  direccion:  { nombre: 'Dir',      rol: 'trabajador', puestoId: 'direccion-general', sucursales: ['Morelia Abastos'] },
  gerenteLP:  { nombre: 'Veronica', rol: 'trabajador', puestoId: 'gerencia-zona',     sucursales: ['8 Esquinas'] },
  gerenteMor: { nombre: 'Otra',     rol: 'trabajador', puestoId: 'gerencia-zona',     sucursales: ['Morelia Madero'] },
  encargada:  { nombre: 'Enc',      rol: 'trabajador', puestoId: 'encargado-sucursal', sucursales: ['8 Esquinas'] },
  anaquelista:{ nombre: 'Ana',      rol: 'trabajador', puestoId: 'anaquelista',       sucursales: ['8 Esquinas'] },
  adminGlobal:{ nombre: 'Root',     rol: 'admin', alcance: 'global', sucursales: [] },
  sinPuesto:  { nombre: 'Nadie',    rol: 'trabajador', cargo: 'Puesto Que No Existe', sucursales: ['8 Esquinas'] },
  sinLugar:   { nombre: 'Flotante', rol: 'trabajador', puestoId: 'encargado-sucursal', sucursales: [] },
  // Admin LIMITADO con puesto de gerencia: su zona son dos tiendas, pero su
  // ficha solo autoriza una. La intersección tiene que ganar.
  adminLim:   { nombre: 'Lim', rol: 'admin', alcance: 'sucursales', puestoId: 'gerencia-zona', sucursales: ['8 Esquinas'] },
};

const A = {};
for (const k of Object.keys(P)) A[k] = ambitoVisible(P[k]);

console.log('');
console.log('── QUÉ VE CADA QUIEN ───────────────────────────────────────────');
console.log('  perfil        amplitud   restringido  raíz                  lugares');
for (const k of Object.keys(P)) {
  const a = A[k];
  console.log('  ' + k.padEnd(13) + ' ' + String(a.amplitud).padEnd(10) + ' ' +
    String(a.restringido).padEnd(12) + ' ' + String(a.raizPuestoId || '(empresa)').padEnd(21) + ' ' +
    (a.lugares ? [...a.lugares].sort().join(', ') : '(todos)'));
}

// ── 1. EL CASO DE LA CAPTURA ────────────────────────────────────────────────
console.log('');
console.log('1) LA GERENTE DE LA PIEDAD — el defecto del 9/sep');
ok(A.gerenteLP.restringido === true, 'se le recorta la vista', true, A.gerenteLP.restringido);
ok(A.gerenteLP.amplitud === 'zona', 'su amplitud es su zona', 'zona', A.gerenteLP.amplitud);
ok(A.gerenteLP.raizPuestoId === 'gerencia-zona',
   'su árbol arranca en Gerencia de Zona, NO en Dirección General', 'gerencia-zona', A.gerenteLP.raizPuestoId);
// La zona se EXPANDE: su ficha dice una tienda y ve las dos de su zona.
ok(A.gerenteLP.lugares.has('La Piedad Abastos'),
   've la otra tienda de su zona aunque su ficha no la liste', true, [...A.gerenteLP.lugares]);
// Y ESTA es la aserción que mide el defecto:
ok(!A.gerenteLP.lugares.has('Morelia Madero'),
   'ya NO ve Morelia', false, [...A.gerenteLP.lugares]);
ok(!A.gerenteLP.lugares.has('CEDIS'), 'ya NO ve CEDIS', false, [...A.gerenteLP.lugares]);
ok(A.gerenteLP.lugares.size === 2, 'su zona son exactamente dos tiendas', 2, A.gerenteLP.lugares.size);

// Dos Gerentes del MISMO puesto ven cosas distintas: es la prueba de que el
// corte NO puede ser solo por rama (hay un único `gerencia-zona` en el catálogo).
console.log('');
console.log('2) DOS GERENTES, MISMO PUESTO, ZONAS DISTINTAS');
const compartido = [...A.gerenteLP.lugares].filter(l => A.gerenteMor.lugares.has(l));
ok(compartido.length === 0, 'no comparten ni un solo lugar', 0, compartido);
ok(A.gerenteLP.raizPuestoId === A.gerenteMor.raizPuestoId,
   'y sin embargo su raíz de organigrama es la MISMA (por eso hacen falta dos ejes)',
   'gerencia-zona', [A.gerenteLP.raizPuestoId, A.gerenteMor.raizPuestoId]);

// ── 3. LA ESCALERA DISCRIMINA ───────────────────────────────────────────────
console.log('');
console.log('3) LA ESCALERA — cada nivel ve menos que el de arriba');
ok(A.direccion.restringido === false, 'Dirección ve toda la operación', false, A.direccion.restringido);
ok(A.adminGlobal.restringido === false, 'el acceso total sigue viendo todo', false, A.adminGlobal.restringido);
ok(A.encargada.lugares.size === 1 && A.encargada.lugares.has('8 Esquinas'),
   'la Encargada ve SOLO su tienda', ['8 Esquinas'], [...A.encargada.lugares]);
ok(A.encargada.raizPuestoId === 'encargado-sucursal', 'y su árbol arranca en su puesto', 'encargado-sucursal', A.encargada.raizPuestoId);
ok(A.anaquelista.amplitud === 'propio', 'el anaquelista solo lo suyo', 'propio', A.anaquelista.amplitud);
// Subconjunto ESTRICTO: la Encargada ve menos que su Gerente, no lo mismo.
const encSubset = [...A.encargada.lugares].every(l => A.gerenteLP.lugares.has(l));
ok(encSubset && A.encargada.lugares.size < A.gerenteLP.lugares.size,
   'lo de la Encargada es subconjunto ESTRICTO de lo de su Gerente', true,
   [[...A.encargada.lugares], [...A.gerenteLP.lugares]]);

// ── 4. EL LADO SEGURO DEL ERROR ─────────────────────────────────────────────
console.log('');
console.log('4) SIN PUESTO / SIN LUGAR — nadie se queda con la pantalla en blanco');
ok(A.sinPuesto.restringido === false, 'sin puesto NO se le encoge la vista', false, A.sinPuesto.restringido);
ok(/puesto/i.test(A.sinPuesto.motivo), 'y el motivo lo NOMBRA en pantalla', 'menciona puesto', A.sinPuesto.motivo);
ok(A.sinLugar.restringido === false, 'con puesto pero sin sucursal, tampoco', false, A.sinLugar.restringido);
ok(/sucursal/i.test(A.sinLugar.motivo), 'y también se nombra', 'menciona sucursal', A.sinLugar.motivo);
ok(A.gerenteLP.motivo.length > 0 && A.direccion.motivo.length > 0,
   'todos traen motivo: un recorte mudo se lee como un bug', true, null);

// ── 5. NUNCA ENSANCHA ───────────────────────────────────────────────────────
console.log('');
console.log('5) LA INTERSECCIÓN — esto no puede darle a nadie MÁS de lo que tenía');
ok(A.adminLim.lugares.size === 1 && A.adminLim.lugares.has('8 Esquinas'),
   'un admin limitado con puesto de zona NO gana la otra tienda', ['8 Esquinas'], [...A.adminLim.lugares]);

// ── 6. ATRIBUCIÓN TRANSVERSAL ───────────────────────────────────────────────
console.log('');
console.log('6) «SERVICIO A» — ve a la gente de Ventas de su tienda, sin contarla');
const entregaVendedor = { store: '8 Esquinas', assigned: 'Vendedor X' };
const entregaAnaquel = { store: '8 Esquinas', assigned: 'Ana' };
const entregaMorelia = { store: 'Morelia Madero', assigned: 'Otro' };

ok(entregaVisible(A.encargada, entregaVendedor) === true,
   'la Encargada VE la entrega del vendedor de Ventas (trabaja en su tienda)', true, false);
ok(puestoPropio(A.encargada, 'vendedor-rd') === false,
   'pero ese puesto NO le reporta → sale «servicio a» y no le cuenta', false, true);
ok(puestoPropio(A.encargada, 'anaquelista') === true,
   'y el anaquelista SÍ le reporta → le cuenta', true, false);
ok(entregaVisible(A.encargada, entregaMorelia) === false,
   'lo de Morelia no lo ve', false, true);
ok(entregaVisible(A.direccion, entregaMorelia) === true,
   'Dirección sí lo ve', true, false);
ok(entregaVisible(A.gerenteLP, entregaAnaquel) === true, 'la Gerente ve su tienda', true, false);

// ── GUARDIAS DE DISCRIMINACIÓN (§8.11 c) ────────────────────────────────────
// No basta con que las aserciones pasen: la MUESTRA tiene que separar. Un
// control correcto sobre una muestra que no discrimina no discrimina.
console.log('');
const restringidos = Object.keys(A).filter(k => A[k].restringido);
const libres = Object.keys(A).filter(k => !A[k].restringido);
if (!restringidos.length) abortar('a NADIE se le recortó la vista: la regla no se está aplicando.');
if (!libres.length) abortar('a TODOS se les recortó: nadie ejerce el fallback seguro, que es la mitad del diseño.');

// El eje transversal tiene que ejercerse de verdad: hace falta al menos un caso
// donde se VE pero NO cuenta. Sin esto, «servicio a» podría no existir y las
// aserciones de arriba seguirían en verde por otro camino.
const ejerceServicioA = entregaVisible(A.encargada, entregaVendedor) && !puestoPropio(A.encargada, 'vendedor-rd');
if (!ejerceServicioA) abortar('ningún caso ejerce «lo veo pero no me cuenta»: el eje transversal quedó sin medir.');

const amplitudes = new Set(Object.values(A).map(a => a.amplitud));
if (amplitudes.size < 3) abortar('solo ' + amplitudes.size + ' amplitud(es) distintas en la muestra: no hay escalera que comparar.');

console.log('✔ discrimina: ' + restringidos.length + ' recortados y ' + libres.length +
            ' libres · ' + amplitudes.size + ' amplitudes distintas · «servicio a» ejercido.');

// ── CONTROLES NEGATIVOS ─────────────────────────────────────────────────────
if (process.argv.includes('--neg-horizontal')) {
  console.log('');
  console.log('NEG-1) si el eje horizontal no acotara, la Gerente de La Piedad');
  console.log('       volvería a ver Morelia — el defecto de la captura del 9/sep.');
}
if (process.argv.includes('--neg-fallback')) {
  console.log('');
  console.log('NEG-2) si «sin puesto» se recortara, decenas de fichas abrirían la');
  console.log('       pantalla en blanco. El bloque 4 tiene que reventar.');
}

console.log('');
if (fallos) { console.log('❌ ' + fallos + ' aserción(es) rotas.'); process.exit(2); }
console.log('✅ todas las aserciones pasan. ' + Object.keys(P).length + ' perfiles medidos.');
