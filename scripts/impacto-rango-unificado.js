#!/usr/bin/env node
// ============================================================================
//  PASO C · ¿QUIÉN GANA Y QUIÉN PIERDE SI EL RANGO SALE DEL NIVEL?
//
//  Hoy `esJefatura` = admin · TIENE SUBORDINADOS · esSupervisor(banderas).
//  La regla que se quiere  = admin · SU NIVEL ES DE MANDO · esSupervisor.
//
//  Las dos leen el MISMO organigrama y discrepan en 6 puestos, porque
//  `tieneSubordinados` mira la arista equivocada: colgarle un practicante a un
//  analista lo convierte en jefatura, y un Jefe de Mantenimiento sin nadie
//  debajo no lo es.
//
//  Esto NO cambia nada. Imprime la tabla para decidir con ella enfrente, que es
//  lo que este repo exige antes de mover lo que ve la gente (§8.1, §8.5).
//
//  ─── LA PARTE QUE HACE QUE LA TABLA VALGA ─────────────────────────────────
//  No se evalúa una ficha en blanco. A cada puesto se le dan LAS BANDERAS QUE
//  SU PERFIL LE OTORGA según `privilegios-por-puesto.js`, que es lo que de
//  verdad tiene la gente tras el ajuste del 14/sep. Con una ficha vacía la
//  tabla diría que tres puestos pierden el tablero cuando en realidad lo
//  conservan por `esSupervisor` — o sea, inventaría un impacto que no existe.
//  Es la lección del fixture del 19/sep: un fixture con una forma que el
//  sistema no produce no solo deja de encontrar bugs, FABRICA bugs.
//
//    node scripts/impacto-rango-unificado.js
// ============================================================================
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');

function abortar(m) {
  console.error('\n[impacto] ABORTA: ' + m);
  console.error('[impacto] No concluyas de esta corrida.');
  process.exit(3);
}

const salida = fs.mkdtempSync(path.join(os.tmpdir(), 'md-imp-'));
try {
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc', 'src/app/shared/alcance.util.ts', 'src/app/shared/sidebar/nav.config.ts',
     '--outDir', salida, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { stdio: 'pipe', shell: true, cwd: RAIZ });
} catch (e) {}

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
if (!fAlc || !fCat || !fNav || !fPer) abortar('tsc no emitio los modulos.');

const A = require(fAlc);
const C = require(fCat);
const NAV = require(fNav);
const PER = require(fPer);
const PRIV = require(path.join(RAIZ, 'scripts/privilegios-por-puesto.js'));

const P = C.PUESTOS_ORGANIGRAMA.filter(p => p.vigente !== false);
if (P.length === 0) abortar('catalogo vacio');

// Los niveles que MANDAN. No es una lista escrita a mano fuera del catalogo:
// son los valores del propio tipo `NivelPuesto`, partidos donde el organigrama
// ya los parte. `alcanceDeNivel` usa exactamente este corte.
const NIVEL_MANDO = ['direccion', 'gerencia', 'jefatura', 'coordinacion', 'supervision'];

/** La regla propuesta: el rango sale del NIVEL, no de quien cuelgue de ti. */
function esJefaturaPorNivel(u) {
  if (PER.esAdmin(u)) return true;
  const nivel = A.nivelDePersona(u);
  if (nivel && NIVEL_MANDO.indexOf(nivel) !== -1) return true;
  // LA RED SE CONSERVA. El 15/sep se midieron 44 fichas activas SIN puesto.
  // Quitarla aqui les cambiaria el acceso a todas ellas de golpe, y eso no es
  // este paso.
  return PER.esSupervisor(u);
}

/** Las banderas que el perfil de ese puesto le da hoy. */
function banderasDe(puestoId) {
  const perfil = PRIV.POR_PUESTO[puestoId];
  if (!perfil) return null;                    // sin perfil: no se toco su ficha
  return PRIV.PERFILES[perfil].banderas || [];
}

function ficha(puestoId, banderas, rol, alcance) {
  const u = {
    rol: rol || 'trabajador', nombre: 'X', correo: 'x@md.com',
    sucursales: ['Canindo'], puestoId,
    datos: { puestoId, sucursales: ['Canindo'] },
  };
  if (alcance) u.alcance = alcance;
  for (const b of (banderas || [])) u[b] = true;
  return u;
}

const rutasDe = u => NAV.menuDe(u).reduce((a, s) => a.concat(s.entradas.map(e => e.ruta)), []);

// `esJefatura` gobierna estas tres entradas. Se derivan del NAV para que el dia
// que alguien cuelgue otra de `esJefatura`, esta tabla la incluya sola.
const RUTAS_DE_JEFATURA = NAV.NAV
  .filter(e => !e.oculta && e.ve === A.esJefatura)
  .map(e => e.ruta);

console.log('\nENTRADAS: ' + P.length + ' puestos vigentes · ' +
            Object.keys(PRIV.POR_PUESTO).length + ' con perfil · ' +
            'rutas que gobierna `esJefatura` en el menu: ' +
            (RUTAS_DE_JEFATURA.length ? RUTAS_DE_JEFATURA.join(' ') : '(ninguna)'));
if (RUTAS_DE_JEFATURA.length === 0) {
  abortar('ninguna entrada del menu cuelga de `esJefatura`. O cambio el NAV, o esta ' +
          'comparacion dejo de medir lo que cree medir.');
}

// ══ LA TABLA ═══════════════════════════════════════════════════════════════
const ganan = [], pierden = [], sinPerfil = [];

for (const p of P) {
  const bs = banderasDe(p.id);
  // Direccion conserva rol admin en el mapa; hay que reproducirlo o la fila
  // saldria como si perdiera todo.
  const perfilNombre = PRIV.POR_PUESTO[p.id];
  const cfg = perfilNombre ? PRIV.PERFILES[perfilNombre] : null;
  const u = ficha(p.id, bs || [], cfg && cfg.rol, cfg && cfg.alcance);

  const hoy = A.esJefatura(u);
  const prop = esJefaturaPorNivel(u);
  if (hoy === prop) continue;

  const fila = {
    id: p.id, nivel: p.nivel, unidad: p.unidad,
    directos: P.filter(x => x.reportaA === p.id).length,
    perfil: perfilNombre || '(sin perfil)',
    banderas: bs ? bs.length : null,
    rutasHoy: rutasDe(u),
  };
  if (prop && !hoy) ganan.push(fila); else pierden.push(fila);
  if (!bs) sinPerfil.push(p.id);
}

function imprimir(titulo, filas, nota) {
  console.log('\n=== ' + titulo + ' (' + filas.length + ') ===');
  if (nota) console.log('    ' + nota);
  if (filas.length === 0) { console.log('\n   (ninguno)'); return; }
  console.log('');
  console.log('   ' + 'puesto'.padEnd(30) + 'nivel'.padEnd(14) + 'dir'.padEnd(5) +
              'perfil'.padEnd(17) + 'banderas');
  for (const f of filas) {
    console.log('   ' + f.id.padEnd(30) + String(f.nivel).padEnd(14) +
                String(f.directos).padEnd(5) + String(f.perfil).padEnd(17) +
                (f.banderas === null ? 'SIN PERFIL (ficha sin tocar)' : f.banderas + ' de 9'));
  }
}

imprimir('PIERDEN mando  —  la direccion SEGURA', pierden,
  'Dejan de pasar `esJefatura`: se les quitan ' + RUTAS_DE_JEFATURA.join(' ') + '.');
imprimir('GANAN mando  —  ESCALADA, y eso lo decide David', ganan,
  'Su nivel manda pero el catalogo no les declara subordinados. Ensanchar es la');

if (ganan.length) {
  console.log('\n    direccion peligrosa (11/sep): dar `/plantilla` es dar la definicion de');
  console.log('    cuantas plazas autoriza una sucursal. NO se aplica sin que lo pidas.');
}

// ══ LO QUE NO SE MUEVE, que es lo que hay que comprobar de verdad ══════════
console.log('\n=== LO QUE NO SE MUEVE ===\n');
let igual = 0, jefHoy = 0;
for (const p of P) {
  const perfilNombre = PRIV.POR_PUESTO[p.id];
  const cfg = perfilNombre ? PRIV.PERFILES[perfilNombre] : null;
  const u = ficha(p.id, banderasDe(p.id) || [], cfg && cfg.rol, cfg && cfg.alcance);
  if (A.esJefatura(u)) jefHoy++;
  if (A.esJefatura(u) === esJefaturaPorNivel(u)) igual++;
}
console.log('   ' + igual + ' de ' + P.length + ' puestos no cambian');
console.log('   ' + jefHoy + ' puestos pasan `esJefatura` HOY · ' +
            (jefHoy - pierden.length + ganan.length) + ' pasarian con la regla nueva');

// La ficha SIN puesto es el caso que no puede moverse: son 44 activas (15/sep).
const sinPuesto = { rol: 'trabajador', nombre: 'Y', sucursales: ['Canindo'],
                    puedeCrearChecklists: true, datos: { sucursales: ['Canindo'] } };
const sinPuestoNiBanderas = { rol: 'trabajador', nombre: 'Z', sucursales: ['Canindo'],
                              datos: { sucursales: ['Canindo'] } };
console.log('   ficha SIN puesto y CON bandera:  hoy=' + A.esJefatura(sinPuesto) +
            ' propuesto=' + esJefaturaPorNivel(sinPuesto) +
            (A.esJefatura(sinPuesto) === esJefaturaPorNivel(sinPuesto) ? '  (la red aguanta)' : '  ⚠ SE MUEVE'));
console.log('   ficha SIN puesto y SIN bandera:  hoy=' + A.esJefatura(sinPuestoNiBanderas) +
            ' propuesto=' + esJefaturaPorNivel(sinPuestoNiBanderas) +
            (A.esJefatura(sinPuestoNiBanderas) === esJefaturaPorNivel(sinPuestoNiBanderas) ? '  (la red aguanta)' : '  ⚠ SE MUEVE'));

// ══ CONTROLES ══════════════════════════════════════════════════════════════
console.log('\n=== CONTROLES ===\n');
let malos = 0;
function control(n, real, esp) {
  const ok = real === esp;
  if (!ok) malos++;
  console.log('   ' + (ok ? 'ok  ' : 'FALLA') + ' ' + n + (ok ? '' : ' (esperaba ' + esp + ', dio ' + real + ')'));
}
// DISCRIMINA: si las dos reglas coincidieran en los 89, esta tabla no mediria
// nada y todas sus conclusiones («no se mueve nadie») serian vacias.
control('la comparacion DISCRIMINA: hay al menos una diferencia',
        (ganan.length + pierden.length) > 0, true);
// POSITIVO POR MECANISMO — y la primera version de este control estaba MAL.
//
// Decia «los 3 operativos con gente debajo tienen que estar entre los que
// pierden» y FALLO: solo pierden 2. Medido el porque antes de tocar la
// expectativa (que es lo contrario de ajustarla al artefacto): a
// `servicios-al-personal` su perfil de Capital Humano le da CINCO banderas,
// asi que conserva el mando por `esSupervisor` — por otra puerta, legitima,
// porque esa area SI administra fichas.
//
// Lo que hay que afirmar, entonces, no es «pierde», sino el mecanismo:
// NINGUNO de ellos puede seguir mandando POR TENER GENTE DEBAJO. O lo pierde,
// o lo conserva por una bandera. Esta version distingue las dos cosas; la
// anterior las confundia.
const opConGente = P.filter(p => p.nivel === 'operativo' &&
                                 P.some(x => x.reportaA === p.id)).map(p => p.id);
const pierdenIds = pierden.map(f => f.id);
const porBandera = [];
const sigueMandandoSinMotivo = opConGente.filter(id => {
  const perfilNombre = PRIV.POR_PUESTO[id];
  const cfg = perfilNombre ? PRIV.PERFILES[perfilNombre] : null;
  const u = ficha(id, banderasDe(id) || [], cfg && cfg.rol, cfg && cfg.alcance);
  if (pierdenIds.indexOf(id) !== -1) return false;      // lo pierde: correcto
  if (PER.esSupervisor(u)) { porBandera.push(id); return false; }  // por bandera: correcto
  return true;                                           // sigue por la arista mala
});
control('POSITIVO · ninguno de los ' + opConGente.length + ' operativos con gente debajo ' +
        'manda POR tener gente debajo (' + pierdenIds.filter(id => opConGente.indexOf(id) !== -1).length +
        ' lo pierden, ' + porBandera.length + ' lo conserva(n) por bandera)',
        sigueMandandoSinMotivo.length, 0);
// NEGATIVO: un Encargado de Sucursal NO puede aparecer en ninguna de las dos
// listas. Si se moviera, la regla estaria tocando a quien no debe.
control('NEGATIVO · `encargado-sucursal` no se mueve',
        pierdenIds.indexOf('encargado-sucursal') === -1 &&
        ganan.map(f => f.id).indexOf('encargado-sucursal') === -1, true);

console.log('');
if (malos) {
  console.log('[impacto] ' + malos + ' control(es) FALLARON. La tabla de arriba no vale.');
  process.exit(2);
}
console.log('[impacto] los controles pasan. NADA DE ESTO ESTA APLICADO.');
