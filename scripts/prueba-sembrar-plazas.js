// ============================================================================
//  PRUEBA DE `planear()` — el reparto de plazas
//
//  QUÉ PREGUNTA CONTESTA (§8.11): no «¿corre sin reventar?» sino
//    «¿le da a CADA anaquelista su propia plaza, respeta lo ya sembrado al
//     re-correr, y deja fuera —VISIBLEMENTE— a quien no se le puede asignar?»
//
//  Produce números de personas, así que el §8.8 pide prueba. Y la prueba no
//  puede necesitar credenciales de producción, o no se corre nunca: `planear()`
//  está separada de Postgres justo para eso. Aquí no hay base ni red.
//
//  Los puestos y los cargos de los fixtures son REALES —salen del catálogo, no
//  inventados— porque la resolución por alias es una de las cosas que se prueba.
//
//    node scripts/prueba-sembrar-plazas.js
//    node scripts/prueba-sembrar-plazas.js --neg-libre     (control negativo 1)
//    node scripts/prueba-sembrar-plazas.js --neg-idempot   (control negativo 2)
// ============================================================================
const { planear, lugaresDe } = require('./sembrar-plazas');

const NEG_LIBRE = process.argv.includes('--neg-libre');
const NEG_IDEMPOT = process.argv.includes('--neg-idempot');

let fallos = 0;
function ok(cond, etiqueta, esperado, dado) {
  if (cond) { console.log('   ok    ' + etiqueta); return true; }
  console.log('   FALLA ' + etiqueta + '   esperaba ' + JSON.stringify(esperado) + ', dio ' + JSON.stringify(dado));
  fallos++;
  return false;
}
function abortar(m) { console.error('\n❌ NO SE PUDO MEDIR: ' + m); process.exit(1); }

const HOY = '2026-09-09';
const AHORA = 1757000000000;

// ── EL FIXTURE ──────────────────────────────────────────────────────────────
// El caso que motiva el paso entero: CINCO anaquelistas en el mismo lugar.
// Más un cajero solo (para que la muestra discrimine), una persona en DOS
// sucursales, una que resuelve por ALIAS de cargo, una sin puesto y una sin
// lugar. Sin estos cuatro últimos la prueba recorrería sin comparar nada.
const suc = s => ({ sucursales: [s] });
const FICHAS = [
  { id: 'u1', nombre: 'Ana',    cargo: '', datos: { puestoId: 'anaquelista', ...suc('Canindo') } },
  { id: 'u2', nombre: 'Beto',   cargo: '', datos: { puestoId: 'anaquelista', ...suc('Canindo') } },
  { id: 'u3', nombre: 'Carla',  cargo: '', datos: { puestoId: 'anaquelista', ...suc('Canindo') } },
  { id: 'u4', nombre: 'Diana',  cargo: '', datos: { puestoId: 'anaquelista', ...suc('Canindo') } },
  { id: 'u5', nombre: 'Elena',  cargo: '', datos: { puestoId: 'anaquelista', ...suc('Canindo') } },
  // Sola en su puesto: su plaza NO necesita número. Es el lado que discrimina.
  { id: 'u6', nombre: 'Fabiola', cargo: '', datos: { puestoId: 'encargado-sucursal', ...suc('Canindo') } },
  // Dos sucursales: DOS plazas, DOS coberturas. Hoy el robot ya le emite dos veces.
  { id: 'u7', nombre: 'Gabriel', cargo: '', datos: { puestoId: 'anaquelista', sucursales: ['Canindo', '8 Esquinas'] } },
  // Sin `puestoId`: resuelve por el ALIAS del cargo viejo. Es exactamente la
  // ficha que un `insert ... where datos->>'puestoId' <> ''` habría perdido.
  { id: 'u8', nombre: 'Hilda',  cargo: 'Cajera', datos: { ...suc('8 Esquinas') } },
  // Sin puesto resoluble: NO recibe plaza, y tiene que salir nombrada.
  { id: 'u9', nombre: 'Ivan',   cargo: 'Ayudante General', datos: { ...suc('Canindo') } },
  // Con puesto pero sin lugar: tampoco recibe plaza.
  { id: 'u10', nombre: 'Julia', cargo: '', datos: { puestoId: 'anaquelista' } },
];

// ── GUARDIA DE FIXTURE (§8.11 c) ────────────────────────────────────────────
// Si el alias dejara de resolver, `u8` caería en «sin puesto» y la prueba
// seguiría en verde midiendo otra cosa. Se comprueba la premisa, no el total.
{
  const base = planear({ fichas: FICHAS, hoy: HOY, ahora: AHORA });
  if (base.porAlias !== 1) {
    abortar('el fixture ya no ejerce la resolución por alias (porAlias=' + base.porAlias +
      ', esperaba 1). «Cajera» dejó de ser alias de un puesto, o el catálogo cambió: ' +
      'sin ese caso la prueba NO mide el camino que SQL habría perdido.');
  }
  if (!base.multi.length || !base.unica.length) {
    abortar('el fixture dejó de discriminar: grupos con varias=' + base.multi.length +
      ', con una=' + base.unica.length + '. Un control correcto sobre una muestra que no ' +
      'discrimina no discrimina.');
  }
}

console.log('ENTRADAS   fichas del fixture: ' + FICHAS.length);
console.log('');

// ── 1. SIEMBRA EN LIMPIO ────────────────────────────────────────────────────
console.log('1) SIEMBRA EN LIMPIO — base vacía');
let P = planear({ fichas: FICHAS, hoy: HOY, ahora: AHORA });

const plazas = P.acciones.filter(a => a.tipo === 'plaza');
const cobs = P.acciones.filter(a => a.tipo === 'cobertura');

// 8 asignables: u1..u5 (5) + u6 (1) + u7 en dos lugares (2) + u8 (1) = 9.
ok(P.asignables.length === 9, 'asignaciones persona x lugar', 9, P.asignables.length);
ok(P.sinPuesto.length === 1 && P.sinPuesto[0].id === 'u9', 'Ivan queda fuera por no tener puesto', 'u9', P.sinPuesto.map(f => f.id));
ok(P.sinLugar.length === 1 && P.sinLugar[0].f.id === 'u10', 'Julia queda fuera por no tener lugar', 'u10', P.sinLugar.map(x => x.f.id));

// ESTA ES LA ASERCIÓN DEL PASO. Cinco anaquelistas en Canindo + Gabriel = SEIS
// plazas distintas en ese grupo. Si diera 1, el modelo no habría cambiado nada.
const anaqCanindo = plazas.filter(p => p.lugar === 'Canindo' && p.puestoId === 'anaquelista');
ok(anaqCanindo.length === 6, 'CADA anaquelista de Canindo tiene su propia plaza', 6, anaqCanindo.length);
ok(new Set(anaqCanindo.map(p => p.slot)).size === 6, 'sus seis slots son distintos', 6, new Set(anaqCanindo.map(p => p.slot)).size);
ok(new Set(anaqCanindo.map(p => p.id)).size === 6, 'sus seis ids son distintos', 6, new Set(anaqCanindo.map(p => p.id)).size);

ok(plazas.length === 9, 'plazas creadas en total', 9, plazas.length);
ok(cobs.length === 9, 'coberturas creadas en total', 9, cobs.length);
ok(plazas.every(p => p.slot >= 1), 'ningún slot en cero', true, plazas.map(p => p.slot));

// Ninguna nace numerada: el número es de la Encargada, no de la base.
ok(plazas.every(p => !('numero' in p) || p.numero === null || p.numero === undefined),
   'NINGUNA plaza nace con número (lo pone la Encargada, 3.1b)', true, plazas.filter(p => p.numero).length);

// Una plaza por cobertura, sin plaza compartida.
ok(new Set(cobs.map(c => c.plazaId)).size === cobs.length,
   'dos personas nunca comparten plaza abierta', cobs.length, new Set(cobs.map(c => c.plazaId)).size);

// Gabriel: dos lugares, dos plazas.
const gab = cobs.filter(c => c.uid === 'u7');
ok(gab.length === 2, 'Gabriel (dos sucursales) recibe DOS plazas', 2, gab.length);
ok(new Set(gab.map(c => c.plazaId.split('::')[0])).size === 2, 'y en lugares distintos', 2, new Set(gab.map(c => c.plazaId.split('::')[0])).size);

// La unidad se DERIVA del catálogo, no se escribe a mano.
ok(anaqCanindo.every(p => p.unidad === 'sucursal'), 'la unidad sale del catálogo', 'sucursal', [...new Set(anaqCanindo.map(p => p.unidad))]);

// ── 2. RE-CORRIDA: TIENE QUE SER INOFENSIVA ─────────────────────────────────
console.log('');
console.log('2) RE-CORRIDA sobre lo ya sembrado — no debe crear nada');
const yaPlazas = plazas.map(p => ({ id: p.id, puesto_id: p.puestoId, lugar: p.lugar, numero: null, datos: { slot: p.slot } }));
const yaCobs = cobs.map(c => ({ id: c.id, plaza_id: c.plazaId, uid: c.uid, tipo: 'titular' }));

let P2 = planear({ fichas: FICHAS, plazasExistentes: yaPlazas, coberturasAbiertas: yaCobs, hoy: HOY, ahora: AHORA });
ok(P2.acciones.length === 0, 'la segunda corrida no escribe NADA', 0, P2.acciones.length);
ok(P2.yaEstaban === 9, 'las nueve se reconocen como ya sembradas', 9, P2.yaEstaban);

// Y no pisa un número ya confirmado por la Encargada.
const conNumero = yaPlazas.map((p, i) => ({ ...p, numero: i + 1 }));
let P2b = planear({ fichas: FICHAS, plazasExistentes: conNumero, coberturasAbiertas: yaCobs, hoy: HOY, ahora: AHORA });
ok(P2b.acciones.length === 0, 'tampoco toca las plazas ya numeradas', 0, P2b.acciones.length);

// ── 3. CONTRATACIÓN: una plaza más, sin renumerar las viejas ────────────────
console.log('');
console.log('3) CONTRATACIÓN — llega un sexto anaquelista a Canindo');
const CON_NUEVO = [...FICHAS, { id: 'u11', nombre: 'Karla', cargo: '', datos: { puestoId: 'anaquelista', ...suc('Canindo') } }];
let P3 = planear({ fichas: CON_NUEVO, plazasExistentes: yaPlazas, coberturasAbiertas: yaCobs, hoy: HOY, ahora: AHORA });
const p3plazas = P3.acciones.filter(a => a.tipo === 'plaza');
ok(p3plazas.length === 1, 'crea UNA plaza, no vuelve a crear las nueve', 1, p3plazas.length);
// Sin el `?.` un control negativo REVIENTA la prueba en vez de hacerla fallar, y
// entonces las aserciones de abajo no llegan a correr: no se puede saber si
// discriminan. Un crash y un fallo son dos resultados distintos (NEG-1, 9/sep).
ok(p3plazas[0]?.slot === 7, 'el slot nuevo continúa la serie (no reinicia en 1)', 7, p3plazas[0]?.slot);
ok(p3plazas[0] && !yaPlazas.some(p => p.id === p3plazas[0].id), 'y su id no choca con ninguna existente', true, p3plazas[0]?.id);

// ── 4. BAJA: la cobertura huérfana se REPORTA, no se cierra sola ────────────
console.log('');
console.log('4) BAJA — Elena ya no está activa');
const SIN_ELENA = FICHAS.filter(f => f.id !== 'u5');
let P4 = planear({ fichas: SIN_ELENA, plazasExistentes: yaPlazas, coberturasAbiertas: yaCobs, hoy: HOY, ahora: AHORA });
ok(P4.huerfanas.length === 1 && P4.huerfanas[0].uid === 'u5', 'su cobertura sale reportada como huérfana', 'u5', P4.huerfanas.map(h => h.uid));
ok(P4.acciones.length === 0, 'y NO se cierra sola (cerrar exige fecha y motivo, §5.5)', 0, P4.acciones.length);
// Su plaza sigue existiendo y libre: la plaza es permanente, la persona rota.
let P4b = planear({ fichas: SIN_ELENA, plazasExistentes: yaPlazas,
                    coberturasAbiertas: yaCobs.filter(c => c.uid !== 'u5'), hoy: HOY, ahora: AHORA });
ok(P4b.acciones.length === 0, 'cerrada su cobertura, la plaza queda LIBRE (no se recrea)', 0, P4b.acciones.length);
const SUPLENTE = [...SIN_ELENA, { id: 'u12', nombre: 'Lupita', cargo: '', datos: { puestoId: 'anaquelista', ...suc('Canindo') } }];
let P4c = planear({ fichas: SUPLENTE, plazasExistentes: yaPlazas,
                    coberturasAbiertas: yaCobs.filter(c => c.uid !== 'u5'), hoy: HOY, ahora: AHORA });
ok(P4c.acciones.filter(a => a.tipo === 'plaza').length === 0, 'y quien la releva OCUPA esa plaza, no crea otra', 0, P4c.acciones.filter(a => a.tipo === 'plaza').length);
ok(P4c.acciones.filter(a => a.tipo === 'cobertura').length === 1, 'con una cobertura nueva', 1, P4c.acciones.filter(a => a.tipo === 'cobertura').length);

// ── 5. `lugaresDe` no inventa ni duplica ────────────────────────────────────
console.log('');
console.log('5) LUGARES — sin duplicar, sin espacios, sin vacíos');
ok(lugaresDe({ datos: { sucursales: ['Canindo', ' Canindo '], sucursal: 'Canindo' } }).length === 1, 'colapsa el mismo lugar escrito distinto', 1, lugaresDe({ datos: { sucursales: ['Canindo', ' Canindo '], sucursal: 'Canindo' } }));
ok(lugaresDe({ datos: { sucursales: ['', null, 'CEDIS'] } }).length === 1, 'ignora vacíos y nulos', 1, lugaresDe({ datos: { sucursales: ['', null, 'CEDIS'] } }));
ok(lugaresDe({ datos: {} }).length === 0, 'sin sucursales devuelve vacío, no inventa una', 0, lugaresDe({ datos: {} }));

// ── CONTROLES NEGATIVOS ─────────────────────────────────────────────────────
// No basta que la prueba pase: hay que comprobar que FALLA cuando el mecanismo
// se rompe, y que falla POR LO QUE SE CAMBIÓ (7/sep).
if (NEG_LIBRE) {
  console.log('');
  console.log('NEG-1) si «buscar plaza libre» devolviera SIEMPRE la primera del grupo,');
  console.log('       los cinco anaquelistas volverían a compartir UNA sola plaza.');
  console.log('       Esperado: revientan las aserciones de «cada uno su plaza».');
}
if (NEG_IDEMPOT) {
  console.log('');
  console.log('NEG-2) si la re-corrida ignorara las coberturas abiertas, el bloque 2');
  console.log('       crearía nueve plazas más en cada corrida.');
}

console.log('');
if (fallos) {
  console.log('❌ ' + fallos + ' aserción(es) rotas.');
  process.exit(2);
}
console.log('✅ todas las aserciones pasan. ' + FICHAS.length + ' fichas · ' +
            plazas.length + ' plazas · ' + cobs.length + ' coberturas · ' +
            P.multi.length + ' grupo(s) a numerar y ' + P.unica.length + ' sin numerar.');
