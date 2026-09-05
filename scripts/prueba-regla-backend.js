#!/usr/bin/env node
/**
 * 🔒 FASE 2.2 · LA REGLA DEL BACKEND, QUE NO TENÍA NI UNA PRUEBA
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUÉ PREGUNTA CONTESTA
 * ═══════════════════════════════════════════════════════════════════════════
 * `itemHecho()` (api/asistente-chat.js:569) decide si un punto cuenta como
 * hecho por el camino de WhatsApp. De ahí comen DOS consumidores:
 *
 *   · el bot que entrega tareas por WhatsApp;
 *   · `api/tareas-notificar.js`, que lo IMPORTA (línea 33) y lo usa en cinco
 *     sitios — de ahí sale el aviso de «te faltan N tareas» y el resumen que
 *     le llega al jefe.
 *
 * Produce un número sobre una persona y no tenía una sola prueba. La §8.8 pide
 * exactamente lo contrario.
 *
 * Y su propia cabecera dice: «Espejo EXACTO de las reglas del front. Si cambias
 * un criterio aquí, cámbialo allá también». Esa frase es una invitación a
 * romperlo en la dirección equivocada, porque HOY las dos reglas del front no
 * son la misma cosa:
 *
 *     tieneEvidencia(item)          ESTRICTA · sin prueba no se cierra
 *     esItemHecho(item, checklist)  FLOJA    · una nota o un retraso lo cierran
 *
 * `itemHecho` es espejo de la ESTRICTA. Si alguien lo «sincroniza» con la floja
 * creyendo que cumple ese comentario, el bot empezaría a cerrar puntos sin
 * prueba y el aviso al jefe diría que está todo hecho. Esta prueba existe para
 * que eso no pueda pasar en silencio.
 *
 * ─── LAS DOS COSAS QUE AFIRMA ───────────────────────────────────────────────
 *  1. EL ESPEJO SE SOSTIENE: `itemHecho(item) === tieneEvidencia(item)` en toda
 *     la batería. No se transcribe ninguna de las dos: se compila el TS del
 *     front y se importa el JS del backend, y se comparan las funciones REALES.
 *     Esta afirmación sigue siendo cierta DESPUÉS de la Fase 2.1, así que la
 *     prueba no caduca con ella.
 *  2. DÓNDE SE SEPARAN HOY el tablero y el bot: los casos en que
 *     `esItemHecho` dice hecho y `itemHecho` dice que no. Ese conteo es la
 *     divergencia que ya existe en producción, y cuando la 2.1 la cierre este
 *     script lo dirá con código 3 en vez de fingir un fallo (§8.11e).
 *
 * No toca la base ni la red. Funciones puras sobre objetos de checklist.
 *
 *   node scripts/prueba-regla-backend.js
 *   → 0 todo bien · 1 no pudo medir · 2 falló una aserción · 3 control caducado
 */
process.env.TZ = 'America/Mexico_City';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');

function abortar(motivo) {
  console.error('\n[regla-back] ABORTA: ' + motivo);
  console.error('[regla-back] No concluyas de esta corrida.');
  process.exit(1);
}

// ── El backend, tal cual ────────────────────────────────────────────────────
// `api/db.js` crea el pool en diferido (`let pool = null`), así que importar el
// módulo NO abre ninguna conexión. Se comprobó antes de escribir esto.
let back;
try {
  back = require('../api/asistente-chat.js');
} catch (e) {
  abortar('no pude importar api/asistente-chat.js: ' + ((e && e.message) || e));
}
if (typeof back.itemHecho !== 'function') {
  abortar('api/asistente-chat.js ya no exporta itemHecho(). O cambió de nombre, o dejó de ' +
    'exportarse: en los dos casos esta prueba mediría otra cosa sin avisar.');
}

// ── El front, compilado ─────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtask-regla-back-'));
let front;
try {
  execSync('npx tsc --outDir "' + tmp + '" --module commonjs --target ES2022 ' +
    '--skipLibCheck --moduleResolution node ' +
    '"' + path.join(RAIZ, 'src', 'app', 'shared', 'item-completado.util.ts') + '"',
    { cwd: RAIZ, stdio: 'pipe' });
  front = require(path.join(tmp, 'item-completado.util.js'));
} catch (e) {
  abortar('tsc no compiló item-completado.util.ts:\n' +
    (e.stdout || e.stderr || e.message || '').toString().slice(0, 1200));
}
for (const f of ['tieneEvidencia', 'esItemHecho']) {
  if (typeof front[f] !== 'function') abortar('el front ya no exporta ' + f + '()');
}

// ══════════════════════════════════════════════════════════════════════════
//  LA BATERÍA
//
//  Cubre las cuatro formas de evidencia y sus medios caminos. El caso de
//  `'subiendo...'` no es teórico: es el marcador que deja la subida a Cloudinary
//  mientras va en camino, y darlo por bueno cerraría el punto con una foto que
//  todavía no existe.
// ══════════════════════════════════════════════════════════════════════════
const ITEMS = [
  ['sin banderas, palomeado',            { checked: true }],
  ['sin banderas, sin palomear',         { checked: false }],
  ['sin banderas, checked ausente',      {}],
  ['pide 1 foto, la tiene',              { requiresPhoto: true, photo: 'http://x' }],
  ['pide 1 foto, no la tiene',           { requiresPhoto: true, photo: null }],
  ['pide 1 foto, subiendo...',           { requiresPhoto: true, photo: 'subiendo...' }],
  ['pide 1 foto, palomeado sin foto',    { requiresPhoto: true, photo: null, checked: true }],
  ['pide varias, tiene una',             { requiresVariasFotos: true, photos: [{ url: 'a' }] }],
  ['pide varias, tiene tres',            { requiresVariasFotos: true, photos: [{ url: 'a' }, { url: 'b' }, { url: 'c' }] }],
  ['pide varias, arreglo vacío',         { requiresVariasFotos: true, photos: [] }],
  ['pide varias, no es arreglo',         { requiresVariasFotos: true, photos: null }],
  ['pide varias, palomeado sin fotos',   { requiresVariasFotos: true, photos: [], checked: true }],
  ['antes/después, las dos',             { requiresAntesDespues: true, photoAntes: 'a', photoDespues: 'b' }],
  ['antes/después, solo antes',          { requiresAntesDespues: true, photoAntes: 'a', photoDespues: null }],
  ['antes/después, solo después',        { requiresAntesDespues: true, photoAntes: null, photoDespues: 'b' }],
  ['antes/después, la de después subiendo', { requiresAntesDespues: true, photoAntes: 'a', photoDespues: 'subiendo...' }],
  ['antes/después, ninguna, palomeado',  { requiresAntesDespues: true, checked: true }],
];

const CHECKLISTS = [
  ['sin nota ni retraso', { notaEmpleado: '', entregaConRetraso: false }],
  ['con nota',            { notaEmpleado: 'se acabó el papel', entregaConRetraso: false }],
  ['con retraso',         { notaEmpleado: '', entregaConRetraso: true }],
  ['nota de puros espacios', { notaEmpleado: '   ', entregaConRetraso: false }],
];

let fallos = 0;
const vistas = { hecho: 0, noHecho: 0 };

// ── 1 · EL ESPEJO ───────────────────────────────────────────────────────────
console.log('1) EL ESPEJO · itemHecho (backend) === tieneEvidencia (front)\n');
for (const [etiqueta, item] of ITEMS) {
  const b = back.itemHecho(item);
  const f = front.tieneEvidencia(item);
  if (b === f) {
    console.log('   ok    ' + etiqueta.padEnd(40) + (b ? 'hecho' : 'no hecho'));
  } else {
    console.log('   FALLA ' + etiqueta.padEnd(40) + 'backend=' + b + '  front=' + f +
      '   ← el espejo se rompió');
    fallos++;
  }
  if (b) vistas.hecho++; else vistas.noHecho++;
}

// GUARDIA DE DISCRIMINACIÓN (§8.11c): si toda la batería cayera del mismo lado,
// un `itemHecho` que devolviera siempre lo mismo pasaría esta prueba entera.
if (!vistas.hecho || !vistas.noHecho) {
  abortar('la batería no discrimina: ' + vistas.hecho + ' hechos y ' + vistas.noHecho +
    ' no hechos. Con todos del mismo lado, una función constante pasaría en verde.');
}
console.log('\n   reparto: ' + vistas.hecho + ' hechos · ' + vistas.noHecho + ' no hechos (discrimina)');

// ── 2 · EL BACKEND NO MIRA LA JUSTIFICACIÓN ────────────────────────────────
// Estructuralmente no puede —`itemHecho` recibe solo el item— pero eso es hoy.
// Si mañana alguien le pasara el checklist «para alinearlo con el front», esto
// lo caza: el resultado tiene que ser el MISMO con cualquier checklist.
console.log('\n2) EL BACKEND IGNORA LA NOTA Y EL RETRASO (invariante §5.3)\n');
for (const [etiqueta, item] of ITEMS) {
  const base = back.itemHecho(item);
  for (const [ec, ck] of CHECKLISTS) {
    const conCk = back.itemHecho(item, ck);
    if (conCk !== base) {
      console.log('   FALLA ' + etiqueta.padEnd(34) + ' cambia con "' + ec + '": ' +
        base + ' → ' + conCk + '   ← el backend adquirió el hueco de la justificación');
      fallos++;
    }
  }
}
console.log('   ok    ninguno de los ' + ITEMS.length + ' puntos cambia con ninguno de los ' +
  CHECKLISTS.length + ' checklists');

// ── 3 · DÓNDE SE SEPARAN HOY EL TABLERO Y EL BOT ───────────────────────────
console.log('\n3) LA DIVERGENCIA QUE YA EXISTE EN PRODUCCIÓN\n');
const separan = [];
for (const [ei, item] of ITEMS) {
  for (const [ec, ck] of CHECKLISTS) {
    const tablero = front.esItemHecho(item, ck);
    const bot = back.itemHecho(item);
    if (tablero !== bot) separan.push({ item: ei, ck: ec, tablero, bot });
  }
}
console.log('   combinaciones probadas: ' + (ITEMS.length * CHECKLISTS.length));
console.log('   el TABLERO dice hecho y el BOT dice que no: ' + separan.length);
for (const s of separan.slice(0, 8)) {
  console.log('      · ' + s.item.padEnd(34) + ' + ' + s.ck);
}
if (separan.length > 8) console.log('      … y ' + (separan.length - 8) + ' más');

// El control que puede caducar, y que lo dice en vez de fingir un fallo (§8.11e).
if (separan.length === 0) {
  const sigueFloja = front.esItemHecho({ checked: false }, { notaEmpleado: 'x' }) === true;
  if (!sigueFloja) {
    console.log('');
    console.log('[regla-back] CONTROL CADUCADO, y por la buena razón: `esItemHecho` ya no cae');
    console.log('             en la justificación, así que la Fase 2.1 entró y las dos reglas');
    console.log('             CONVERGIERON. El bloque 3 medía la divergencia anterior y hay que');
    console.log('             actualizarlo en el mismo commit que cerró la 2.1.');
    console.log('             Los bloques 1 y 2 siguen siendo válidos y pasaron.');
    if (fallos) process.exit(2);
    process.exit(3);
  }
  abortar('cero divergencias pero `esItemHecho` SIGUE siendo floja. Eso no cuadra: o la ' +
    'batería dejó de ejercer el caso, o una de las dos funciones cambió de forma. ' +
    'Es la diferencia entre «el fixture cambió» y «la medición está rota».');
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* da igual */ }

console.log('');
if (fallos) {
  console.error('❌ ' + fallos + ' aserción(es) fallaron.');
  process.exit(2);
}
console.log('✅ el espejo se sostiene, el backend ignora la justificación, y la divergencia');
console.log('   con el tablero está medida en ' + separan.length + ' combinación(es).');
console.log('');
console.log('   Léelo así: esas ' + separan.length + ' NO son un defecto de esta prueba. Son puntos');
console.log('   que el tablero da por hechos y el bot no. La Fase 2.1 las lleva a cero.');
