#!/usr/bin/env node
/**
 * PRUEBA · el eje transversal: qué es cada lugar, y a quién se le cuenta.
 *
 * QUÉ PREGUNTA CONTESTA (§8.11): no «¿compila?» sino «¿DISCRIMINA?». Una regla
 * de atribución que marcara TODO, o NADA, pasaría cualquier prueba escrita como
 * "encuentra el caso conocido". Por eso cada eje lleva su caso positivo Y su
 * negativo, y el script ABORTA si algún eje sale con todos los casos del mismo
 * lado: un control correcto sobre una muestra que no discrimina no discrimina.
 *
 * No necesita base ni credenciales. Compila el TypeScript real y llama a las
 * funciones del proyecto: no se transcribe la lógica a este archivo, porque una
 * copia que diverge es lo que dejó al spec del tablero midiendo otra cosa
 * durante un día (bitácora 3/sep).
 *
 *   node scripts/prueba-unidad-servida.js
 *   → 0 todo bien · 1 no pudo medir · 2 alguna aserción falló
 */
// `execSync` con cadena y no `execFileSync`: en Windows npx es un `.cmd` y
// lanzarlo sin shell devuelve EINVAL. Es lo que ya hace prueba-menu-audiencias.js.
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtask-eje-'));

function abortar(msg) { console.error('\n❌ NO SE PUDO MEDIR: ' + msg); process.exit(1); }

// ── Compilar ───────────────────────────────────────────────────────────────
try {
  execSync('npx tsc --outDir "' + tmp + '" --module commonjs --target ES2022 ' +
    '--skipLibCheck --moduleResolution node ' +
    '"' + path.join(RAIZ, 'src', 'app', 'shared', 'unidad-servida.util.ts') + '" ' +
    '"' + path.join(RAIZ, 'src', 'app', 'shared', 'nomina-puestos.ts') + '"',
    { cwd: RAIZ, stdio: 'pipe' });
} catch (e) {
  abortar('tsc no compiló:\n' + (e.stdout || e.stderr || e.message || '').toString().slice(0, 1500));
}

const fUtil = path.join(tmp, 'unidad-servida.util.js');
if (!fs.existsSync(fUtil)) abortar('tsc no emitió unidad-servida.util.js en ' + tmp);

const U = require(fUtil);
const N = require(path.join(tmp, 'nomina-puestos.js'));
const O = require(path.join(tmp, 'organigrama.catalogo.js'));

let fallos = 0;
const marcas = { tipoSucursal: 0, tipoNoSucursal: 0, cruzadaSi: 0, cruzadaNo: 0 };

function ok(cond, etiqueta, esperado, dado) {
  if (cond) { console.log('   ok   ' + etiqueta); return true; }
  console.log('   FALLA ' + etiqueta + '  esperaba ' + JSON.stringify(esperado) + ', dio ' + JSON.stringify(dado));
  fallos++;
  return false;
}

// ── 1. Clasificación del lugar ─────────────────────────────────────────────
console.log('\n1) QUÉ ES CADA LUGAR');
const casosTipo = [
  ['Morelia Madero',    'sucursal',    'morelia'],
  ['Padre Hidalgo',     'sucursal',    'padre-hidalgo'],
  ['Canindo',           'sucursal',    'zamora'],
  ['CEDIS',             'corporativo', 'corporativo'],
  ['COMPRAS',           'corporativo', 'corporativo'],
  ['RH',                'corporativo', 'corporativo'],
  ['MANTENIMIENTO',     'canal',       null],
  ['Sucursal Inventada','desconocido', null],   // NEGATIVO: no se acomoda por parecido
  ['',                  'desconocido', null],
];
for (const [store, tipo, zona] of casosTipo) {
  const d = U.clasificarDestino(store);
  ok(d.tipo === tipo, '"' + (store || '(vacío)') + '" → ' + tipo, tipo, d.tipo);
  if (zona !== null) ok(d.zona === zona, '   zona de "' + store + '"', zona, d.zona);
  if (d.tipo === 'sucursal') marcas.tipoSucursal++; else marcas.tipoNoSucursal++;
}

// El canal NO puede salir como sucursal: es el defecto que se vino a arreglar.
ok(U.clasificarDestino('MANTENIMIENTO').tipo !== 'sucursal',
   'MANTENIMIENTO no se pinta como sucursal', 'no sucursal', U.clasificarDestino('MANTENIMIENTO').tipo);

// ── 2. Atribución cruzada: el mecanismo, no la apariencia ──────────────────
console.log('\n2) A QUIÉN SE LE CUENTA');
const enSucursal = U.clasificarDestino('Padre Hidalgo');
const enCorporativo = U.clasificarDestino('COMPRAS');
const enCanal = U.clasificarDestino('MANTENIMIENTO');

const casosAtrib = [
  // [unidad del puesto, destino, esperado, por qué]
  ['ventas',           enSucursal,    true,  'los 15 vendedores de Padre Hidalgo son de Ventas'],
  ['operaciones-zona', enSucursal,    true,  'operaciones de zona hospedada en una sucursal'],
  ['cedis',            enSucursal,    true,  'CEDIS trabajando en una plaza'],
  ['sucursal',         enSucursal,    false, 'NEGATIVO: la gente de la sucursal SÍ es de la sucursal'],
  ['ventas',           enCorporativo, false, 'NEGATIVO: no se afirma lo que no se puede saber'],
  ['ventas',           enCanal,       false, 'NEGATIVO: el canal no es un lugar'],
  [null,               enSucursal,    false, 'NEGATIVO: sin puesto no se atribuye nada'],
];
for (const [unidad, destino, esperado, porque] of casosAtrib) {
  const dado = U.esAtribucionCruzada(unidad, destino);
  ok(dado === esperado, '[' + (unidad || 'sin puesto') + '] en "' + destino.nombre + '" → ' + esperado + '   (' + porque + ')', esperado, dado);
  if (dado) marcas.cruzadaSi++; else marcas.cruzadaNo++;
}

// El texto tiene que NOMBRAR a la unidad responsable, no solo existir.
const txt = U.textoAtribucion('ventas', enSucursal);
ok(txt.includes('Padre Hidalgo'), 'el texto nombra el lugar que hospeda', 'contiene "Padre Hidalgo"', txt);
ok(/venta/i.test(txt), 'el texto nombra la unidad responsable', 'menciona Ventas', txt);
ok(U.textoAtribucion('sucursal', enSucursal) === '', 'sin cruce no hay texto', '""', U.textoAtribucion('sucursal', enSucursal));

// ── 3. GUARDIA DE COBERTURA sobre la entrada que de verdad se usa ──────────
// No «¿el mapa tiene N entradas?» sino «¿todo lugar donde hay gente de verdad
// se clasifica?». Un lugar que caiga en 'desconocido' es una Gerencia que deja
// de ver a los suyos, y tiene que salir con nombre y apellido.
console.log('\n3) COBERTURA (los lugares donde hay gente real)');
const filas = N.NOMINA_PUESTOS || [];
if (!filas.length) abortar('nomina-puestos vino vacía: 0 filas. «No pude leer» y «no hay» se ven igual.');
const lugares = [...new Set(filas.map(f => (f.sucursal || '').trim()).filter(Boolean))].sort();
console.log('   filas de nómina: ' + filas.length + ' | lugares distintos: ' + lugares.length);
if (!lugares.length) abortar('0 lugares distintos en la nómina');

const sinClasificar = lugares.filter(l => U.clasificarDestino(l).tipo === 'desconocido');
ok(sinClasificar.length === 0,
   'los ' + lugares.length + ' lugares con gente se clasifican',
   0, sinClasificar);

// ── 4. Guardia de discriminación (§8.11c) ──────────────────────────────────
console.log('\n4) ¿LA MUESTRA DISCRIMINA?');
console.log('   tipos: sucursal ' + marcas.tipoSucursal + ' / no-sucursal ' + marcas.tipoNoSucursal +
            '   |   atribución: cruzada ' + marcas.cruzadaSi + ' / no cruzada ' + marcas.cruzadaNo);
if (!marcas.tipoSucursal || !marcas.tipoNoSucursal) abortar('ningún eje de TIPO discrimina: todos los casos cayeron del mismo lado');
if (!marcas.cruzadaSi || !marcas.cruzadaNo) abortar('la regla de atribución no discrimina: marcaría todo o nada, y eso pasa cualquier prueba');

// ── Cierre ─────────────────────────────────────────────────────────────────
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* da igual */ }
if (fallos) { console.error('\n❌ ' + fallos + ' aserción(es) fallaron'); process.exit(2); }
console.log('\n✅ todo verde, y la muestra discrimina en los dos ejes');
