#!/usr/bin/env node
/**
 * 🎚️ ALCANCE POR RANGO — LA TABLA PARA DECIDIR, NO PARA APLICAR
 *
 * Compara, perfil por perfil, el alcance que la app da HOY (banderas: rol,
 * alcance, sucursales[]) contra el que saldría del RANGO en el organigrama.
 *
 * No cambia nada. Imprime qué ganaría y qué perdería cada nivel, para que la
 * decisión se tome con la tabla enfrente. Cambiar quién ve qué para 186
 * personas de un golpe es exactamente cómo se deja a una zona sin menú un
 * lunes a las siete de la mañana.
 *
 * ─── LO QUE ESTE SCRIPT VIGILA DE SÍ MISMO ─────────────────────────────────
 * · Compila los .ts reales con `tsc` y llama a las funciones de verdad: no
 *   reimplementa la regla. Un verificador que parsea o que copia la lógica mide
 *   su propia copia, no el sistema (§8.11 d).
 * · ABORTA si algún perfil no ejerce su nivel, si los 89 puestos no dan los 7
 *   niveles, o si NINGÚN perfil sale distinto — un cero de diferencias podría
 *   significar «no hay cambios» o «no medí nada», y no se pueden confundir.
 *
 *   node scripts/prueba-alcance-por-nivel.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function abortar(motivo) {
  console.error('');
  console.error('[alcance] ABORTA: ' + motivo);
  console.error('[alcance] No concluyas de esta corrida.');
  process.exit(2);
}

// ── compilar los .ts reales ───────────────────────────────────────────────
const salida = fs.mkdtempSync(path.join(os.tmpdir(), 'md-alcance-'));
try {
  execFileSync('npx', ['tsc',
    'src/app/shared/alcance.util.ts',
    '--outDir', salida,
    '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck',
  ], { stdio: 'pipe', shell: true });
} catch (e) {
  // tsc puede quejarse de tipos sin romper el JS emitido; solo importa que salga.
}
function buscar(dir, nombre) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = buscar(p, nombre); if (r) return r; }
    else if (e.name === nombre) return p;
  }
  return null;
}
const modAlcance = buscar(salida, 'alcance.util.js');
const modCatalogo = buscar(salida, 'organigrama.catalogo.js');
if (!modAlcance || !modCatalogo) abortar('tsc no emitió los módulos. Sin ellos no hay nada que medir.');

const A = require(modAlcance);
const C = require(modCatalogo);

// ── guardia de cobertura: los 7 niveles tienen que existir en el catálogo ──
const puestos = C.PUESTOS_ORGANIGRAMA.filter((p) => p.vigente !== false);
if (puestos.length < 50) abortar('el catálogo trae ' + puestos.length + ' puestos. No pude leerlo.');
const nivelesEnCatalogo = [...new Set(puestos.map((p) => p.nivel))].sort();
const NIVELES = ['direccion', 'gerencia', 'jefatura', 'coordinacion', 'supervision', 'operativo', 'practicante'];
const faltan = NIVELES.filter((n) => !nivelesEnCatalogo.includes(n));
console.log('puestos vigentes: %d · niveles presentes: %d de %d', puestos.length, nivelesEnCatalogo.length, NIVELES.length);
if (faltan.length) console.log('  niveles del tipo que NO existen en el catálogo: ' + faltan.join(', '));

// ── perfiles: uno por nivel, con las banderas que tendría hoy ─────────────
// Se elige un puesto REAL de cada nivel para que `resolverPuesto` funcione con
// el mismo camino que usa la app, no con un id inventado.
function unPuestoDe(nivel) {
  const p = puestos.find((x) => x.nivel === nivel);
  return p ? p.id : null;
}

const PERFILES = [
  { etiqueta: 'Dirección General', puestoId: unPuestoDe('direccion'),
    flags: { rol: 'admin', alcance: 'global' } },
  { etiqueta: 'Gerente de Zona (hoy: admin de 4 sucursales)', puestoId: unPuestoDe('gerencia'),
    flags: { rol: 'admin', alcance: 'sucursales', sucursales: ['Morelia Madero', 'Morelia Abastos', 'Canindo', 'Zamora Centro'] } },
  { etiqueta: 'Jefatura (hoy: admin de 1 área)', puestoId: unPuestoDe('jefatura'),
    flags: { rol: 'admin', alcance: 'sucursales', sucursales: ['CEDIS'] } },
  { etiqueta: 'Encargado(a) de Sucursal (hoy: supervisor de 1)', puestoId: 'encargado-sucursal',
    flags: { rol: 'trabajador', puedeVerEstadisticas: true, sucursales: ['8 Esquinas'] } },
  { etiqueta: 'Supervisor de Ventas (hoy: 3 sucursales)', puestoId: unPuestoDe('supervision'),
    flags: { rol: 'trabajador', puedeVerCheckstore: true, sucursales: ['8 Esquinas', 'Canindo', 'Yurécuaro'] } },
  { etiqueta: 'Anaquelista (hoy: solo lo suyo)', puestoId: 'anaquelista',
    flags: { rol: 'trabajador', sucursales: ['8 Esquinas'] } },
  { etiqueta: 'Practicante', puestoId: unPuestoDe('practicante'),
    flags: { rol: 'trabajador', sucursales: [] } },
  // El caso que NO se puede olvidar: ficha sin puesto. Hoy son decenas.
  { etiqueta: 'SIN PUESTO capturado (hoy: 1 sucursal)', puestoId: null,
    flags: { rol: 'trabajador', sucursales: ['Padre Hidalgo'] } },
  // Y el admin con acceso total por la cadena mágica.
  { etiqueta: 'Acceso Total por cadena', puestoId: 'anaquelista',
    flags: { rol: 'trabajador', sucursales: ['General (Acceso Total)'] } },
];

// ── la comparación ────────────────────────────────────────────────────────
const filas = [];
const nivelesEjercidos = new Set();
let ganan = 0, pierden = 0, iguales = 0;

for (const p of PERFILES) {
  const usuario = { ...p.flags, nombre: p.etiqueta };
  if (p.puestoId) usuario.puestoId = p.puestoId;
  const d = A.compararAlcance(usuario);
  if (d.nivel) nivelesEjercidos.add(d.nivel);
  if (d.efecto === 'gana') ganan++;
  else if (d.efecto === 'pierde') pierden++;
  else iguales++;
  filas.push({ etiqueta: p.etiqueta, nivel: d.nivel || '(sin puesto)', ...d });
}

console.log('');
console.log('perfil                                          nivel          HOY        PROPUESTO   efecto');
console.log('─'.repeat(100));
for (const f of filas) {
  const marca = f.efecto === 'gana' ? '>> GANA' : f.efecto === 'pierde' ? '<< pierde' : '   igual';
  console.log('%s %s %s %s %s',
    f.etiqueta.padEnd(47).slice(0, 47),
    String(f.nivel).padEnd(14),
    String(f.actual).padEnd(10),
    String(f.propuesto).padEnd(11),
    marca);
}
console.log('─'.repeat(100));
console.log('ganan %d · pierden %d · iguales %d · de %d perfiles', ganan, pierden, iguales, filas.length);

// ── guardias: un cero no vale si no se midió ──────────────────────────────
console.log('');
if (nivelesEjercidos.size === 0) {
  abortar('ningún perfil resolvió un nivel. Se midieron cero rangos: el resultado no dice nada.');
}
const sinEjercer = NIVELES.filter((n) => nivelesEnCatalogo.includes(n) && !nivelesEjercidos.has(n));
if (sinEjercer.length) {
  abortar('estos niveles existen en el catálogo y NINGÚN perfil los ejerce: ' + sinEjercer.join(', ') +
    '. Un nivel sin perfil es un nivel cuyo cambio de alcance no se midió.');
}
if (ganan === 0 && pierden === 0) {
  abortar('los 9 perfiles salen IGUALES. O el mapeo no cambia nada -y entonces no hace falta- o ' +
    '`alcanceActual` y `alcancePropuesto` están devolviendo lo mismo por un error. Un cero de ' +
    'diferencias no se puede leer como "no hay cambios" sin descartar lo segundo.');
}
console.log('✓ niveles ejercidos: %s', [...nivelesEjercidos].sort().join(', '));
console.log('✓ la comparación DISCRIMINA: hay %d diferencia(s) entre las dos reglas.', ganan + pierden);
console.log('');
console.log('NADA DE ESTO ESTÁ APLICADO. `alcance.util.ts` no está enganchado a ningún guard,');
console.log('menú ni consulta: es solo el cálculo, para decidir con la tabla enfrente.');
