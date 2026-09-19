#!/usr/bin/env node
// ============================================================================
//  ¿EL PRIVILEGIO QUE RECIBE CADA PUESTO COINCIDE CON SU LUGAR EN EL ORGANIGRAMA?
//
//  Esa es la pregunta, y NO es «¿cuántas entradas tiene el mapa?». El mapa
//  puede estar completo y repartir mal; puede tener 28 filas correctas y dejar
//  once puestos con gente a cargo sin definir. Contar filas no contesta nada.
//
//  Solo LEE. No toca la base, no escribe, no necesita credenciales.
//
//  ─── DE DÓNDE SALE CADA MITAD ─────────────────────────────────────────────
//  · El organigrama y las reglas de rango: COMPILADOS con `tsc` y llamados de
//    verdad (`esJefatura`, `alcancePropuesto`, `menuDe`). No se parsea el
//    catálogo ni se reimplementa ninguna regla — un verificador que parsea mide
//    su propio parser, y este repo ya pagó por eso (§8.11 d).
//  · El reparto de privilegios: `scripts/privilegios-por-puesto.js`, que es la
//    definición que aplica `ajustar-privilegios.js`.
//
//  ─── PARA QUÉ SIRVE, EN CONCRETO ──────────────────────────────────────────
//  Es el control del paso C (unificar el rango). Antes de mover lo que ve la
//  gente hay que poder enseñar la tabla de quién gana y quién pierde; y después
//  del cambio, estas cinco cuentas tienen que bajar. Hoy, 19/sep/2026, valen:
//
//      1. puestos con gente debajo y SIN perfil definido ....... 11
//      2. contradicciones entre el mapa y el nivel ............. 5 (+1 declarada)
//      3. discrepancias entre las dos reglas de rango .......... 6
//      4. puestos OPERATIVOS con menu de jefatura .............. 3
//      5. banderas de gestion que dan vista de supervisor ...... 9 de 9
//
//    node scripts/auditar-privilegios-por-puesto.js
// ============================================================================
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');

function abortar(motivo) {
  console.error('\n[privilegios] ABORTA: ' + motivo);
  console.error('[privilegios] No concluyas de esta corrida.');
  process.exit(3);
}

// ── Compilar los .ts reales ────────────────────────────────────────────────
const salida = fs.mkdtempSync(path.join(os.tmpdir(), 'md-priv-'));
try {
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc',
     'src/app/shared/alcance.util.ts',
     'src/app/shared/sidebar/nav.config.ts',
     '--outDir', salida,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe', shell: true, cwd: RAIZ });
} catch (e) {
  // tsc puede quejarse de tipos y aun asi emitir el JS. Lo que importa es que
  // los modulos existan, y eso se comprueba abajo.
}

function buscar(dir, nombre) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = buscar(p, nombre); if (r) return r; }
    else if (e.name === nombre) return p;
  }
  return null;
}

const fAlc = buscar(salida, 'alcance.util.js');
const fCat = buscar(salida, 'organigrama.catalogo.js');
const fNav = buscar(salida, 'nav.config.js');
const fPer = buscar(salida, 'permisos.util.js');
if (!fAlc || !fCat || !fNav || !fPer) {
  abortar('tsc no emitio los modulos (alcance / catalogo / nav / permisos). Nada que medir.');
}

const A = require(fAlc);
const C = require(fCat);
const NAV = require(fNav);
const PER = require(fPer);
const PRIV = require(path.join(RAIZ, 'scripts/privilegios-por-puesto.js'));

// ── LAS ENTRADAS, ANTES DE CONCLUIR NADA (§8.11 a) ─────────────────────────
const P = C.PUESTOS_ORGANIGRAMA.filter(p => p.vigente !== false);
const mapa = PRIV.POR_PUESTO;
if (P.length === 0) abortar('el catalogo llego VACIO. Un cero aqui seria de lectura, no de dato.');
if (!mapa || Object.keys(mapa).length === 0) abortar('el mapa de privilegios llego VACIO.');

console.log('\nENTRADAS: ' + P.length + ' puestos vigentes · ' +
            Object.keys(mapa).length + ' con perfil asignado · ' +
            Object.keys(PRIV.PERFILES).length + ' perfiles · ' +
            PRIV.GESTION.length + ' banderas de gestion');

// ── Ficha sintetica. `puestoId` va suelto Y dentro de `datos`: `resolverPuesto`
//    mira los dos sitios segun de donde venga el perfil, y sembrar solo uno
//    dejaria medir a medias sin que nada fallara.
function ficha(puestoId, banderas) {
  const u = {
    rol: 'trabajador', nombre: 'X', correo: 'x@md.com',
    sucursales: ['Canindo'], puestoId,
    datos: { puestoId, sucursales: ['Canindo'] },
  };
  for (const b of (banderas || [])) u[b] = true;
  return u;
}

const hijos = id => P.filter(x => x.reportaA === id);
const PERFIL_MANDO = new Set(['direccion', 'gerencia_zona', 'mando_sucursal',
                              'jefatura_area', 'capital_humano']);
const NIVEL_MANDO = ['direccion', 'gerencia', 'jefatura', 'coordinacion', 'supervision'];

// Excepciones DECLARADAS: no son hallazgos, son decisiones con su motivo.
// Se listan para que el numero de arriba no sea ruido — y para que quitarlas
// sea una decision consciente y no un descuido.
const DECLARADAS = {
  'full-stack-developer': 'es la cuenta del dueño (perfil `direccion` a proposito)',
};

// ══ 1 · PUESTOS CON GENTE DEBAJO Y SIN PERFIL ══════════════════════════════
console.log('\n=== 1. CON SUBORDINADOS Y SIN PERFIL DEFINIDO ===');
console.log('    `ajustar-privilegios.js` los reporta «pendientes» y NO los toca:');
console.log('    conservan lo que traiga su ficha, sea lo que sea.\n');
const sinPerfil = P.filter(p => !mapa[p.id] && hijos(p.id).length > 0);
for (const p of sinPerfil) {
  console.log('   ' + p.id.padEnd(34) + 'nivel=' + String(p.nivel).padEnd(13) +
              'directos=' + String(hijos(p.id).length).padStart(2));
}
console.log('\n   -> ' + sinPerfil.length + ' puesto(s)');

// ══ 2 · EL PERFIL CONTRADICE AL NIVEL ══════════════════════════════════════
console.log('\n=== 2. EL PERFIL CONTRADICE AL NIVEL DEL ORGANIGRAMA ===\n');
const contradicen = [];
for (const p of P) {
  const perfil = mapa[p.id];
  if (!perfil) continue;
  const esMando = PERFIL_MANDO.has(perfil);
  const nivelMando = NIVEL_MANDO.indexOf(p.nivel) !== -1;
  const tieneGente = hijos(p.id).length > 0;
  let motivo = null;
  if (esMando && !nivelMando && !tieneGente) motivo = 'MANDO a un operativo sin gente';
  if (!esMando && nivelMando) motivo = 'OPERATIVO a un nivel de mando';
  if (!motivo) continue;
  const declarada = DECLARADAS[p.id];
  console.log('   ' + p.id.padEnd(34) + 'nivel=' + String(p.nivel).padEnd(13) +
              'perfil=' + String(perfil).padEnd(16) + motivo +
              (declarada ? '   [DECLARADA: ' + declarada + ']' : ''));
  if (!declarada) contradicen.push(p.id);
}
console.log('\n   -> ' + contradicen.length + ' sin declarar');

// ══ 3 · LAS DOS REGLAS DE RANGO NO DICEN LO MISMO ══════════════════════════
console.log('\n=== 3. `esJefatura` (tiene subordinados) CONTRA el NIVEL del puesto ===');
console.log('    Son dos lecturas del MISMO organigrama, y discrepan.\n');
const discrepan = [];
for (const p of P) {
  const u = ficha(p.id, []);
  const jef = A.esJefatura(u);                 // abre Dashboard, Pase de lista, Plantilla
  const amp = A.alcancePropuesto(u);           // alcance derivado del nivel
  const ampMando = ['empresa', 'unidad', 'zona', 'sucursal'].indexOf(amp) !== -1;
  if (jef === ampMando) continue;
  discrepan.push(p.id);
  console.log('   ' + p.id.padEnd(34) + 'nivel=' + String(p.nivel).padEnd(13) +
              'esJefatura=' + String(jef).padEnd(6) + 'alcance=' + amp);
}
console.log('\n   -> ' + discrepan.length + ' puesto(s)');

// ══ 4 · QUE ABRE `esJefatura` A UN OPERATIVO ═══════════════════════════════
console.log('\n=== 4. PUESTOS OPERATIVOS CON MENU DE JEFATURA ===');
console.log('    Pasan `esJefatura` por tener un practicante colgando.\n');
const operativosJefes = P.filter(p => p.nivel === 'operativo' && A.esJefatura(ficha(p.id, [])));
const rutasDe = u => NAV.menuDe(u).reduce((a, s) => a.concat(s.entradas.map(e => e.ruta)), []);
for (const p of operativosJefes) {
  console.log('   ' + p.id.padEnd(34) + rutasDe(ficha(p.id, [])).join(' '));
}
const rutasAnaq = rutasDe(ficha('anaquelista', []));
console.log('   ' + 'anaquelista (CONTRASTE)'.padEnd(34) + rutasAnaq.join(' '));
console.log('\n   -> ' + operativosJefes.length + ' puesto(s)');

// ══ 5 · UNA SOLA BANDERA CONVIERTE EN SUPERVISOR ═══════════════════════════
console.log('\n=== 5. QUE GANA UN ANAQUELISTA CON UNA SOLA BANDERA ===');
console.log('    Las etiquetas prometen cosas distintas. Miden lo que conceden.\n');
const base = new Set(rutasAnaq);
let equivalentes = 0;
for (const b of PRIV.GESTION) {
  const u = ficha('anaquelista', [b]);
  const gana = rutasDe(u).filter(r => !base.has(r));
  const sup = PER.esSupervisor(u);
  if (sup) equivalentes++;
  console.log('   ' + b.padEnd(28) + 'esSupervisor=' + String(sup).padEnd(6) +
              'gana: ' + (gana.length ? gana.join(' ') : '(nada en el menu)'));
}
console.log('\n   -> ' + equivalentes + ' de ' + PRIV.GESTION.length +
            ' banderas dan vista de supervisor (ve las tareas de TODA su sucursal)');

// ══ LOS CONTROLES ══════════════════════════════════════════════════════════
//
// Cinco cuentas seguidas no valen hasta saber que el instrumento distingue.
console.log('\n=== CONTROLES ===\n');
let malos = 0;
function control(nombre, real, esperado) {
  const ok = real === esperado;
  if (!ok) malos++;
  console.log('   ' + (ok ? 'ok  ' : 'FALLA') + ' ' + nombre +
              (ok ? '' : ' (esperaba ' + esperado + ', dio ' + real + ')'));
}

// POSITIVO, y afirma el MECANISMO: un puesto operativo SIN gente al que se le
// diera perfil de mando tiene que caer en la cubeta 2 — no basta con que «suba
// algun numero», tiene que subir ESE.
const cobaya = P.find(p => p.nivel === 'operativo' && hijos(p.id).length === 0 && !mapa[p.id]);
if (!cobaya) abortar('no encontre un puesto operativo sin gente y sin perfil para el control positivo.');
const mapaSembrado = Object.assign({}, mapa, { [cobaya.id]: 'jefatura_area' });
const contraSembrado = P.filter(p => {
  const perfil = mapaSembrado[p.id];
  if (!perfil) return false;
  if (DECLARADAS[p.id]) return false;
  const esMando = PERFIL_MANDO.has(perfil);
  const nivelMando = NIVEL_MANDO.indexOf(p.nivel) !== -1;
  return (esMando && !nivelMando && hijos(p.id).length === 0) || (!esMando && nivelMando);
}).length;
control('POSITIVO · sembrar mando en «' + cobaya.id + '» sube la cubeta 2',
        contraSembrado, contradicen.length + 1);

// NEGATIVO: un puesto correcto NO debe aparecer. Sin esto, una regla que
// marcara TODO pasaria el positivo.
const sano = P.find(p => p.nivel === 'operativo' && hijos(p.id).length === 0 &&
                         mapa[p.id] === 'operativo');
if (!sano) abortar('no encontre un puesto operativo bien clasificado para el control negativo.');
control('NEGATIVO · «' + sano.id + '» (operativo, perfil operativo) NO se reporta',
        contradicen.indexOf(sano.id) === -1, true);

// DISCRIMINACION: el menu tiene que distinguir. Si un operativo con jefatura y
// un anaquelista vieran lo mismo, la cubeta 4 no mediria nada.
if (operativosJefes.length > 0) {
  const conJefatura = rutasDe(ficha(operativosJefes[0].id, [])).length;
  control('DISCRIMINA · operativo-con-jefatura (' + conJefatura + ' rutas) > anaquelista (' +
          rutasAnaq.length + ')', conJefatura > rutasAnaq.length, true);
} else {
  console.log('   ok   la cubeta 4 esta en CERO: ningun operativo pasa `esJefatura`.');
  console.log('        (si esto sale tras el paso C, es el arreglo funcionando)');
}

console.log('');
if (malos) {
  console.log('[privilegios] ' + malos + ' control(es) FALLARON. Las cinco cuentas de arriba');
  console.log('[privilegios] no valen: el instrumento no esta distinguiendo.');
  process.exit(2);
}
console.log('[privilegios] los controles pasan: las cinco cuentas de arriba son medibles.');
