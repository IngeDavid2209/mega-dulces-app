// ============================================================================
//  COMPILA LA REGLA DE EMISIÓN PARA QUE EL SERVIDOR PUEDA LLAMARLA
//
//  El manual, el organigrama y la regla de «qué le toca hoy a quién» viven en
//  TypeScript dentro de `src/` (hallazgo 5 del CLAUDE.md). El servidor Express
//  es Node puro y, en la imagen de producción, NI SIQUIERA TIENE `src/`: el
//  Dockerfile solo copia `dist`, `server.js`, `api` y `scripts`, y la segunda
//  etapa instala `--omit=dev`, así que tampoco hay `tsc`.
//
//  Por eso la regla se compila AQUÍ, en la etapa de build, y viaja dentro de
//  `dist/` — que es lo único que la imagen final se lleva de la etapa que sí
//  tiene todo.
//
//  POR QUE SE COMPILA Y NO SE COPIA A MANO: una segunda implementación en JS
//  del «qué le toca hoy» divergiría en silencio de la que usa la app, y las dos
//  producirían denominadores distintos para la misma persona. Compilar la real
//  hace imposible esa divergencia (§8.11 d).
//
//  ORDEN EN `npm run build`: va DESPUÉS de `ng build`, a propósito. El builder
//  de Angular limpia su `outputPath` al arrancar; escribiendo después, lo que
//  este script deja en `dist/manual/` no puede ser borrado por él. No depende
//  de saber qué borra exactamente: depende del orden, que sí se controla.
//
//  ABORTA CON CÓDIGO ≠ 0 Y TUMBA EL BUILD si algo falla. Es a propósito: un
//  build verde que dejara el emisor sin regla desplegaría un servidor que no
//  emite nada y no lo dice. Más vale no desplegar que desplegar mudo.
// ============================================================================
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const SALIDA = path.join(RAIZ, 'dist/manual');

// ── LAS DOS ENTRADAS, Y POR QUÉ SON DOS ────────────────────────────────────
//
// La primera es la regla de emisión, que es para lo que nació este script.
//
// La segunda entró el 19/sep con la autorización del servidor: `api/_autorizar.js`
// necesita `esJefatura` para decidir quién puede escribir la plantilla de una
// sucursal, y esa función vive en `alcance.util.ts`. NO se reescribe en JS del
// lado del servidor — dos versiones de «hasta dónde manda esta persona» serían
// dos reglas libres de discrepar, y la que discrepara lo haría en silencio:
// alguien a quien la pantalla deja capturar y el endpoint rechaza, o al revés.
// Una definición, dos llamadores, que es lo mismo que ya se hizo con
// `planDeEntregas` (14/sep).
//
// `alcance.util.ts` importa organigrama, puesto.util y permisos.util, que ya
// se emitían: lo único que añade al bundle del servidor es su propio archivo.
const ENTRADAS = [
  path.join(RAIZ, 'src/app/shared/emision-manual.util.ts'),
  path.join(RAIZ, 'src/app/shared/alcance.util.ts'),
];

// Lo que el emisor del servidor va a requerir. Si tsc dejara de emitir alguno
// —porque alguien cambió un import—, el fallo tiene que verse aquí y no en
// producción a las 3 de la mañana.
const ESPERADOS = [
  'emision-manual.util.js',
  'tareas-manual.catalogo.js',
  'organigrama.catalogo.js',
  'puesto.util.js',
  'permisos.util.js',
  'turnos.util.js',
  'descansos.util.js',
  'horarios-sucursal.util.js',
  'evidencia-manual.js',
  // Los tres que entraron el 15/sep con `lugaresDeEmision`: la regla ahora
  // necesita saber que un lugar tenga cuadrilla, y esa definicion vive en
  // `sucursales-elegibles` (que a su vez clasifica el destino con las zonas).
  // Se listan aqui para que, si alguien cambia un import y tsc deja de
  // emitirlos, el build se detenga en vez de dejar al servidor sin la regla.
  // El que entro con 7.1b: la regla ahora suma las tareas CAPTURADAS desde la
  // app a las del manual publicado. Si tsc dejara de emitirlo, el emisor
  // arrancaria entregando SOLO lo publicado y nadie lo notaria hasta que
  // alguien preguntara por la tarea que capturo y no le llego.
  'tareas-puesto.util.js',
  'sucursales-elegibles.util.js',
  'unidad-servida.util.js',
  'zonas.util.js',
  // El que entró el 19/sep con la autorización del servidor. Si tsc dejara de
  // emitirlo, `api/_autorizar.js` no podría cargar `esJefatura` y —por su
  // propio diseño— fallaría ABIERTO: los endpoints de definición volverían a
  // aceptar cualquier token sin que nadie lo notara. Por eso el build se
  // detiene aquí en vez de dejar que eso pase en silencio.
  'alcance.util.js',
];

function abortar(motivo, detalle) {
  console.error('');
  console.error('[compilar-manual] ABORTA: ' + motivo);
  if (detalle) console.error(String(detalle).slice(0, 2000));
  console.error('[compilar-manual] El build se detiene: desplegar sin la regla de');
  console.error('[compilar-manual] emision dejaria al servidor sin poder entregar tareas.');
  process.exit(1);
}

for (const e of ENTRADAS) if (!fs.existsSync(e)) abortar('no existe ' + e);

try {
  execSync(
    'npx tsc --outDir "' + SALIDA + '" --module commonjs --target ES2022 ' +
    '--skipLibCheck --moduleResolution node --removeComments false ' +
    ENTRADAS.map(e => '"' + e + '"').join(' '),
    { cwd: RAIZ, stdio: 'pipe' }
  );
} catch (e) {
  abortar('tsc no compilo las entradas', (e.stdout || e.stderr || e.message || ''));
}

const faltan = ESPERADOS.filter(f => !fs.existsSync(path.join(SALIDA, f)));
if (faltan.length) abortar('tsc no emitio: ' + faltan.join(', '));

// ── CANARIO: no basta con que compile, tiene que DECIDIR ───────────────────
//
// Un modulo que compila y devuelve cero entregas se ve igual que uno que
// funciona el dia que nadie tiene tareas. Asi que aqui se le pide que decida
// sobre una ficha inventada y se comprueban dos cosas: que produzca entregas,
// y que la LLAVE tenga exactamente la forma que ya existe en produccion. Si la
// llave cambiara, el emisor dejaria de reconocer lo ya entregado y crearia un
// segundo documento por punto.
let emision;
try {
  emision = require(path.join(SALIDA, 'emision-manual.util.js'));
} catch (e) {
  abortar('el modulo compilado no se pudo cargar: ' + (e && e.message));
}

const llave = emision.idemKey('anaquelista.pasillo', '2026-9-14', 'Canindo', 'Ana Pérez');
const LLAVE_ESPERADA = 'man_anaquelista_pasillo_2026-9-14_canindo_ana_perez';
if (llave !== LLAVE_ESPERADA) {
  abortar('la llave de idempotencia cambio de forma.',
    '  esperaba: ' + LLAVE_ESPERADA + '\n  produjo:  ' + llave +
    '\n  Cambiarla crea un SEGUNDO documento por cada punto ya emitido.');
}

const plan = emision.planDeEntregas({
  usuarios: [{ id: 'canario', nombre: 'Canario', rol: 'trabajador', activo: true,
               puestoId: 'anaquelista', sucursales: ['Canindo'] }],
  fecha: new Date(2026, 8, 14, 10, 0, 0),
  horarios: [], configTurnos: null, descansosSemana: [],
  idsExistentes: new Set(),
});
if (!plan.entregas.length) {
  abortar('el canario no produjo una sola entrega.',
    '  Un anaquelista en Canindo un lunes TIENE tareas diarias en el catalogo.\n' +
    '  Cero aqui significa que el catalogo compilo vacio o que la regla no decide.');
}

// El tamano de lo que se compilo, para que el log del build no diga solo «ok».
const bytes = ESPERADOS.reduce((s, f) => s + fs.statSync(path.join(SALIDA, f)).size, 0);
console.log('[compilar-manual] %d archivos, %d KB -> dist/manual', ESPERADOS.length, Math.round(bytes / 1024));
console.log('[compilar-manual] canario: %d entrega(s), llave %s', plan.entregas.length, llave);
