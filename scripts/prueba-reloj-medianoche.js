// ============================================================================
//  PRUEBA del reloj de medianoche (`api/emitir-manual.js`) — sin base, sin esperar.
//
//  POR QUE EXISTE: este reloj decide A QUE HORA aparecen las tareas de 186
//  personas. Un error aqui no revienta nada — hace que el dia empiece tarde, o
//  que emita el dia equivocado, y las dos cosas se descubren por una queja, no
//  por un error en el log.
//
//  Y NO SE PUEDE PROBAR ESPERANDO. Un caso que comprobara «a medianoche emite»
//  tardaria hasta 24 horas en correr, o sea que no se correria nunca. Por eso
//  las tres piezas —cuanto falta para medianoche, cual es el dia anterior, y
//  que pasa cuando el modulo de cierre no esta— viven en funciones puras que se
//  pueden interrogar en milisegundos.
//
//  LO QUE COMPRUEBA:
//    1. `msHastaMedianoche` cae dentro de las proximas 24 h y NUNCA en cero o
//       negativo (un cero programaria la vuelta para AHORA, en bucle).
//    2. Que el colchon este DESPUES de medianoche y no antes, que es lo que
//       impide emitir el dia que acaba de terminar.
//    3. `ayerDe` en los tres bordes que rompen la aritmetica de cadenas:
//       primero de mes, primero de anio, y el 1 de marzo de un anio bisiesto.
//    4. Que la ausencia del modulo de cierre NO sea un error, y que un modulo
//       que existe y revienta SI lo sea. Son las dos lecturas de un require
//       fallido, y confundirlas dejaria un cierre roto pasando por «aun no».
//
//  Corre con:  node scripts/prueba-reloj-medianoche.js
// ============================================================================
const path = require('path');
const fs = require('fs');
const Module = require('module');

const RAIZ = path.resolve(__dirname, '..');

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
  console.error('\n[prueba-reloj] ABORTA: ' + msg);
  console.error('[prueba-reloj] No concluyas de esta corrida.');
  process.exit(3);
}

function sembrarModulo(ruta, exportaciones) {
  const resuelto = require.resolve(ruta);
  const m = new Module(resuelto, null);
  m.filename = resuelto;
  m.loaded = true;
  m.exports = exportaciones;
  require.cache[resuelto] = m;
}

// La base y los horarios se simulan para que cargar el emisor no toque nada.
// La ficha es real (un anaquelista en Canindo tiene tareas diarias), porque el
// caso que importa mas abajo es «el cierre se cuelga y AUN ASI se emite», y con
// una base vacia la emision no crearia nada: el caso pasaria por no haber tenido
// nada que emitir, no por el tope. §8.11(c).
const FICHAS = [{
  id: 'u1', nombre: 'Ana Anaquelista', rol: 'trabajador', activo: true,
  datos: { puestoId: 'anaquelista', sucursales: ['Canindo'] },
}];
const creados = [];
sembrarModulo(path.join(RAIZ, 'api/db.js'), {
  dbConfigurada: () => true,
  query: async (sql, params) => {
    const s = String(sql);
    if (/from mdtask_usuarios/i.test(s)) return { rows: FICHAS, rowCount: FICHAS.length };
    if (/^\s*insert into mdtask_checklists/i.test(s)) {
      creados.push(String(params[0]));
      return { rows: [{ id: params[0] }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  },
});
sembrarModulo(path.join(RAIZ, 'api/horarios-sucursal.js'), { leerHorarios: async () => [] });

// El modulo del emisor no exporta las piezas internas (no tiene por que), asi
// que se leen del propio archivo y se evaluan. Es un parseo, y §8.11(d) dice
// que un parser se verifica: si el corte fallara, `eval` no daria una funcion y
// el script ABORTA en vez de concluir con un cero.
const fuente = fs.readFileSync(path.join(RAIZ, 'api/emitir-manual.js'), 'utf8');
function extraer(nombre) {
  const i = fuente.indexOf('function ' + nombre + '(');
  if (i === -1) abortar('no encontre `function ' + nombre + '` en api/emitir-manual.js. ' +
    'Si le cambiaste el nombre, actualiza esta prueba en el MISMO commit.');
  // Hasta el cierre de la funcion: la primera linea que empieza en '}' a nivel 0.
  const fin = fuente.indexOf('\n}\n', i);
  if (fin === -1) abortar('no encontre el cierre de `' + nombre + '`');
  return fuente.slice(i, fin + 3);
}

const ZONA = 'America/Mexico_City';
const src = extraer('ahoraEnZona') + extraer('msHastaMedianoche') + extraer('ayerDe');
let ahoraEnZona, msHastaMedianoche, ayerDe;
try {
  // eslint-disable-next-line no-eval
  const f = eval('(function(){ const ZONA = ' + JSON.stringify(ZONA) +
    '; const COLCHON_SEG = 5; ' + src +
    ' return { ahoraEnZona, msHastaMedianoche, ayerDe }; })');
  ({ ahoraEnZona, msHastaMedianoche, ayerDe } = f());
} catch (e) {
  abortar('el corte de las funciones no evalua: ' + ((e && e.message) || e));
}
if (typeof msHastaMedianoche !== 'function' || typeof ayerDe !== 'function') {
  abortar('el corte no produjo funciones. No concluyas nada de esta corrida.');
}

console.log('\n=== 1. CUANTO FALTA PARA MEDIANOCHE ===');
const ms = msHastaMedianoche(5);
const a = ahoraEnZona(ZONA);
const transcurrido = ((a.getHours() * 60 + a.getMinutes()) * 60 + a.getSeconds()) * 1000;
console.log('  ahora en %s: %s:%s:%s', ZONA,
  String(a.getHours()).padStart(2, '0'),
  String(a.getMinutes()).padStart(2, '0'),
  String(a.getSeconds()).padStart(2, '0'));
console.log('  faltan %d ms (%d min)', ms, Math.round(ms / 60000));

afirmar('nunca es cero ni negativo (un cero programaria la vuelta en bucle)', ms > 0, true);
afirmar('cabe dentro de las proximas 24 h + colchon', ms <= 86400000 + 5000, true);
// El colchon tiene que quedar DESPUES de medianoche: si cayera antes, la vuelta
// despertaria el dia que termina y emitiria otra vez el dia viejo.
afirmar('el instante programado cae DESPUES del cambio de dia',
  transcurrido + ms > 86400000, true);
afirmar('y el colchon es exactamente el pedido',
  (transcurrido + ms) - 86400000, 5000);

console.log('\n=== 2. EL COLCHON ES CONFIGURABLE Y SE RESPETA ===');
const ms30 = msHastaMedianoche(30);
afirmar('30 s de colchon dan 25 s mas que 5 s', ms30 - ms, 25000);

console.log('\n=== 3. `ayerDe` EN LOS BORDES QUE ROMPEN LA ARITMETICA DE CADENAS ===');
afirmar('un dia cualquiera', ayerDe('2026-09-15'), '2026-09-14');
afirmar('primero de mes (restar 1 daria "2026-09-00")', ayerDe('2026-09-01'), '2026-08-31');
afirmar('primero de anio', ayerDe('2026-01-01'), '2025-12-31');
afirmar('primero de marzo en anio NO bisiesto', ayerDe('2026-03-01'), '2026-02-28');
afirmar('primero de marzo en anio BISIESTO', ayerDe('2024-03-01'), '2024-02-29');

console.log('\n=== 4. EL MODULO DE CIERRE: ausente NO es lo mismo que roto ===');
const emisor = require(path.join(RAIZ, 'api/emitir-manual.js'));
afirmar('el emisor carga aunque el cierre no exista', typeof emisor.iniciarPoll, 'function');
const rutaCierre = path.join(RAIZ, 'api/cerrar-dia.js');
afirmar('hoy el modulo de cierre NO existe todavia (lo escribe otra sesion)',
  fs.existsSync(rutaCierre), false);
// Y que el emisor lo trate como pendiente, no como error: si gritara por cada
// vuelta, el log quedaria inservible antes de que el cierre se escriba.
const tieneDistincion = /MODULE_NOT_FOUND/.test(fuente) &&
  /el módulo de cierre EXISTE y no se pudo cargar/.test(fuente);
afirmar('distingue «aun no esta» de «esta y revienta»', tieneDistincion, true);

console.log('\n=== 5. EL TOPE DEL CIERRE: un cuelgue NO puede dejar el dia sin emitir ===');
// Lo pidio `mega-dulces-app-a3` al revisar el enganche, y tenia razon: el
// try/catch solo cubre lo que LANZA. Un cuelgue no lanza —una consulta que no
// vuelve, un pool agotado, un lock— y como el cierre va ANTES de emitir, ese
// `await` sin tope dejaria a 186 personas sin tareas ese dia, en silencio.
// Es el cuelgue del login del 1/sep con otra ropa.
(async () => {
  const { conTope, cambioDeDia } = emisor;

  // a) El tope relanza, no se traga, y NOMBRA el paso.
  const colgada = new Promise(() => { /* nunca resuelve, a proposito */ });
  let err = null;
  try { await conTope(colgada, 60, 'cerrar el dia 2026-09-14'); }
  catch (e) { err = e; }
  afirmar('un cuelgue vence y RELANZA (no se traga)', err !== null, true);
  afirmar('el error trae su codigo', err && err.codigo, 'TOPE');
  afirmar('y NOMBRA el paso abandonado',
    !!(err && /cerrar el dia 2026-09-14/.test(err.message)), true);

  // b) Lo que termina a tiempo pasa intacto.
  const rapida = await conTope(Promise.resolve({ cerrados: 7 }), 1000, 'algo rapido');
  afirmar('lo que responde a tiempo pasa sin tocarse', rapida, { cerrados: 7 });

  // c) EL CASO QUE IMPORTA, de punta a punta.
  process.env.EMISOR_CIERRE_TOPE_SEG = '0.2';
  const antes = creados.length;
  const cierreColgado = { cerrarDia: () => new Promise(() => {}) };
  const inicio = Date.now();
  await cambioDeDia('prueba', cierreColgado);
  const tardo = Date.now() - inicio;
  const nuevas = creados.length - antes;
  console.log('  el cierre colgado se abandono en %d ms y se crearon %d tarea(s)', tardo, nuevas);
  afirmar('con el cierre COLGADO, la emision ocurre igual', nuevas > 0, true);

  // d) Y el control por el otro lado: un cierre que responde NO estorba.
  const antes2 = creados.length;
  creados.length = 0;
  let llamado = false;
  const cierreBueno = { cerrarDia: async () => { llamado = true; return { cerrados: 3, yaCerrados: 1, saltados: 0 }; } };
  await cambioDeDia('prueba', cierreBueno);
  afirmar('un cierre sano SI se llama', llamado, true);
  afirmar('y la emision tambien ocurre', creados.length > 0, true);

  console.log('\n=== GUARDIA DE DISCRIMINACION ===');
// Sin esto, un `msHastaMedianoche` que devolviera siempre la misma constante
// pasaria los casos de arriba. Dos llamadas separadas por una espera real
// tienen que DECRECER.
const t0 = msHastaMedianoche(5);
const esperaMs = 1100;
const hasta = Date.now() + esperaMs;
while (Date.now() < hasta) { /* espera activa corta, a proposito: sin sleep */ }
const t1 = msHastaMedianoche(5);
if (!(t1 < t0)) {
  fallos++;
  console.log('  FALLA  el reloj no avanza: %d y despues %d. No esta midiendo la hora.', t0, t1);
} else {
  console.log('  ok     el reloj avanza: %d -> %d (%d ms menos en %d ms de espera)',
    t0, t1, t0 - t1, esperaMs);
}

console.log('');
if (fallos) {
  console.log('[prueba-reloj] %d FALLA(S) de %d afirmaciones.', fallos, corridas);
  process.exit(2);
}
  console.log('[prueba-reloj] %d afirmaciones en verde, mas las dos guardias.', corridas);
  process.exit(0);
})().catch(e => abortar('error no previsto: ' + ((e && e.stack) || e)));
