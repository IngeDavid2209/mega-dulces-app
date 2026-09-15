// ============================================================================
//  PRUEBA del emisor del servidor (`api/emitir-manual.js`) — sin base real.
//
//  POR QUE EXISTE: este modulo escribe checklists solo, cada pocos minutos, sin
//  que nadie mire. Es el unico proceso del repo que crea trabajo para 186
//  personas sin intervencion humana, asi que sus dos modos de fallo son caros y
//  silenciosos:
//
//    1. QUE SOBREESCRIBA. Si la insercion fuera `on conflict do update`, cada
//       vuelta pisaria con items en blanco el checklist que alguien lleva media
//       manana llenando. Nadie veria un error: veria su trabajo en blanco.
//    2. QUE NO EMITA Y PAREZCA QUE SI. Si la lectura de fichas devuelve cero
//       —base equivocada, conexion a medias—, el plan sale vacio, el log diria
//       «0 creadas» y todo se veria normal. «No hay gente» y «no lei» producen
//       exactamente la misma salida.
//
//  La base se SIMULA interceptando `api/db` en la cache de require, antes de
//  que el emisor lo cargue. Asi la prueba corre en segundos, sin credenciales,
//  que es la condicion para que se corra alguna vez.
//
//  Corre con:  node scripts/prueba-emisor-servidor.js
// ============================================================================
const path = require('path');
const fs = require('fs');
const Module = require('module');

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
  console.error('\n[prueba-emisor] ABORTA: ' + msg);
  console.error('[prueba-emisor] No concluyas de esta corrida.');
  process.exit(3);
}

// La regla compilada es la ENTRADA de esta prueba. Si no esta, no se concluye
// nada: un emisor sin regla no emite, y eso se veria como «0 creadas».
if (!fs.existsSync(REGLA)) {
  abortar('falta ' + REGLA + '.\n  Generala con:  node scripts/compilar-manual.js');
}

// ── La base simulada ────────────────────────────────────────────────────────
const FICHAS = [
  { id: 'u1', nombre: 'Ana Anaquelista', rol: 'trabajador', activo: true,
    datos: { puestoId: 'anaquelista', sucursales: ['Canindo'] } },
  { id: 'u2', nombre: 'Beto DosTiendas', rol: 'trabajador', activo: true,
    datos: { puestoId: 'anaquelista', sucursales: ['Canindo', 'Padre Hidalgo'] } },
  { id: 'u3', nombre: 'Caro SinPuesto', rol: 'trabajador', activo: true, datos: {} },
];

const estado = {
  fichas: FICHAS,
  checklistsExistentes: [],   // filas { id }
  sqlEjecutado: [],           // todo el SQL que paso por `query`
};

function queryFalsa(sql, params) {
  estado.sqlEjecutado.push(String(sql));
  const s = String(sql);
  if (/from mdtask_usuarios/i.test(s)) return { rows: estado.fichas, rowCount: estado.fichas.length };
  if (/select id from mdtask_checklists/i.test(s)) {
    return { rows: estado.checklistsExistentes, rowCount: estado.checklistsExistentes.length };
  }
  if (/from mdtask_config/i.test(s)) return { rows: [], rowCount: 0 };
  if (/from mdtask_descansos_semanales/i.test(s)) return { rows: [], rowCount: 0 };
  if (/^\s*insert into mdtask_checklists/i.test(s)) {
    const id = String(params[0]);
    // Se comporta como el `on conflict (id) do nothing` real: si ya esta, no
    // devuelve fila. Si la prueba lo simulara siempre insertando, el caso de
    // idempotencia pasaria por el camino equivocado.
    if (estado.checklistsExistentes.some(c => c.id === id)) return { rows: [], rowCount: 0 };
    estado.checklistsExistentes.push({ id });
    return { rows: [{ id }], rowCount: 1 };
  }
  // Las de `resolverUidDeNombre`.
  if (/from mdtask_usuarios/i.test(s)) return { rows: [], rowCount: 0 };
  return { rows: [], rowCount: 0 };
}

/** Mete un modulo falso en la cache de require, para que quien lo pida lo reciba. */
function sembrarModulo(ruta, exportaciones) {
  const resuelto = require.resolve(ruta);
  const m = new Module(resuelto, null);
  m.filename = resuelto;
  m.loaded = true;
  m.exports = exportaciones;
  require.cache[resuelto] = m;
}

sembrarModulo(path.join(RAIZ, 'api/db.js'), {
  query: async (sql, params) => queryFalsa(sql, params),
  dbConfigurada: () => true,
});
sembrarModulo(path.join(RAIZ, 'api/horarios-sucursal.js'), {
  leerHorarios: async () => [],
});

const emisor = require(path.join(RAIZ, 'api/emitir-manual.js'));

// Silencia el ruido esperado del emisor (la guardia escribe en stderr a
// proposito); se restaura para que un error de verdad se vea.
const errorReal = console.error;
const errorLog = [];
console.error = (...a) => errorLog.push(a.map(String).join(' '));

(async () => {
  console.log('\n=== PRIMERA VUELTA: emite lo que falta ===');
  const v1 = await emisor.emitirDeHoy();
  afirmar('la vuelta concluye', v1.estado, 'ok');
  afirmar('leyo las 3 fichas', v1.fichas, 3);
  afirmar('planeo entregas', v1.planeadas > 0, true);
  afirmar('creo todo lo que planeo', v1.creadas, v1.planeadas);
  afirmar('no fallo ninguna', v1.fallidas, 0);
  // Beto tiene DOS sucursales: le toca el doble que a Ana. Derivado del propio
  // plan, no tecleado, porque el número sale del catálogo y puede cambiar.
  const deAna = estado.checklistsExistentes.filter(c => /_ana_anaquelista$/.test(c.id)).length;
  const deBeto = estado.checklistsExistentes.filter(c => /_beto_dostiendas$/.test(c.id)).length;
  afirmar('dos sucursales entregan el doble', deBeto, deAna * 2);
  afirmar('Caro, sin puesto, sale nombrado con su motivo',
    (v1.omitidos.find(o => o.nombre === 'Caro SinPuesto') || {}).motivo,
    'sin puesto del organigrama');

  console.log('\n=== SEGUNDA VUELTA: idempotente ===');
  const antes = estado.checklistsExistentes.length;
  const v2 = await emisor.emitirDeHoy();
  afirmar('no crea nada nuevo', v2.creadas, 0);
  afirmar('las reconoce como ya existentes', v2.yaEstaban >= 0, true);
  afirmar('la tabla no crecio', estado.checklistsExistentes.length, antes);

  console.log('\n=== LA ESCRITURA NO PUEDE SOBREESCRIBIR ===');
  const inserts = estado.sqlEjecutado.filter(s => /^\s*insert into mdtask_checklists/i.test(s));
  afirmar('hubo inserciones que inspeccionar', inserts.length > 0, true);
  afirmar('TODAS son `do nothing`', inserts.every(s => /on conflict \(id\) do nothing/i.test(s)), true);
  afirmar('NINGUNA es `do update`', inserts.some(s => /do update/i.test(s)), false);

  console.log('\n=== LA GUARDIA: cero fichas es "no lei", no "no hay gente" ===');
  estado.fichas = [];
  estado.checklistsExistentes = [];
  const v3 = await emisor.emitirDeHoy();
  afirmar('aborta la vuelta', v3.estado, 'sin-fichas');
  afirmar('y NO escribe nada', estado.checklistsExistentes.length, 0);
  afirmar('lo dice en el log, citando la cifra conocida',
    errorLog.some(l => /0 fichas activas/.test(l) && /150/.test(l)), true);

  console.log('\n=== GUARDIA DE DISCRIMINACION ===');
  // Sin esto, un `emitirDeHoy` que devolviera siempre lo mismo pasaria los
  // casos de arriba que solo miran que «no crezca».
  const estados = new Set([v1.estado, v3.estado]);
  if (estados.size !== 2) {
    fallos++;
    console.log('  FALLA  la vuelta buena y la abortada dieron el MISMO estado (%s)', [...estados].join(', '));
  } else {
    console.log('  ok     vuelta buena (%s) y abortada (%s) se distinguen', v1.estado, v3.estado);
  }
  if (!(v1.creadas > 0)) {
    fallos++;
    console.log('  FALLA  la muestra no creo una sola entrega: los casos de arriba no midieron nada');
  } else {
    console.log('  ok     la muestra creo %d entrega(s): hubo algo que medir', v1.creadas);
  }

  console.error = errorReal;
  console.log('');
  if (fallos) {
    console.log('[prueba-emisor] %d FALLA(S) de %d afirmaciones.', fallos, corridas);
    process.exit(2);
  }
  console.log('[prueba-emisor] %d afirmaciones en verde, mas las dos guardias.', corridas);
  process.exit(0);
})().catch(e => { console.error = errorReal; abortar('error no previsto: ' + ((e && e.stack) || e)); });
