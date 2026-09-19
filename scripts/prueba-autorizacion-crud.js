#!/usr/bin/env node
// ============================================================================
//  ¿QUIÉN PUEDE ESCRIBIR LA ESTRUCTURA, POR EL CABLE?
//
//  No mira la pantalla: llama a los handlers de `api/` con un token firmado y
//  comprueba el código HTTP. Es la única forma de contestar la pregunta que
//  este paso vino a cerrar, porque un `*ngIf` no viaja por la red.
//
//  ─── NO NECESITA CREDENCIALES NI PRODUCCIÓN ───────────────────────────────
//  `JWT_SECRET` es local y de mentira, y `api/db.js` se siembra en la caché de
//  require con una base simulada (el patrón de `prueba-emisor-servidor.js`).
//  Lo que NO se simula son las reglas: `_autorizar.js` carga `esAdminGlobal` y
//  `esJefatura` de `dist/manual`, o sea las MISMAS que usa el navegador. Si se
//  simularan, esto mediría su propia copia (§8.11 d).
//
//  ─── LAS DOS MITADES ──────────────────────────────────────────────────────
//  Un candado se prueba en las dos direcciones o no se prueba: que rechace a
//  quien debe Y que siga dejando pasar a quien ya trabajaba. La segunda es la
//  que importa más — un 403 de más en medio de un turno se lee como «la app se
//  rompió», y esa es la forma en que este paso podría hacer daño.
//
//    node scripts/prueba-autorizacion-crud.js
// ============================================================================
const path = require('path');
const fs = require('fs');
const Module = require('module');

const RAIZ = path.resolve(__dirname, '..');
process.env.JWT_SECRET = 'secreto-de-prueba-local-no-es-el-de-produccion';

let fallos = 0, corridos = 0;
function abortar(motivo) {
  console.error('\n[autorizacion] ABORTA: ' + motivo);
  console.error('[autorizacion] No concluyas de esta corrida.');
  process.exit(3);
}
function afirmar(nombre, real, esperado) {
  corridos++;
  const ok = real === esperado;
  if (!ok) { fallos++; console.log('   ✗ ' + nombre + ': esperaba ' + esperado + ', dio ' + real); }
  return ok;
}

// ── La guardia de entradas: sin `dist/manual` esto no mide nada ────────────
//
// `_autorizar.js` falla ABIERTO cuando no puede cargar las reglas, a propósito.
// O sea que un `dist/manual` ausente daría 200 en todas las filas — que se lee
// exactamente igual que «el candado no sirve». Se comprueba antes de concluir.
const DIST = path.join(RAIZ, 'dist', 'manual');
for (const f of ['permisos.util.js', 'alcance.util.js']) {
  if (!fs.existsSync(path.join(DIST, f))) {
    abortar('falta dist/manual/' + f + '. Corre `node scripts/compilar-manual.js` primero: ' +
            'sin las reglas, la autorizacion pasa todo y la tabla saldria verde sin medir.');
  }
}

// ── La base simulada ───────────────────────────────────────────────────────
const FICHAS = {
  'u-direccion': { id: 'u-direccion', nombre: 'Dora Direccion', rol: 'admin', alcance: 'global',
                   correo: 'dora@md.com', activo: true, datos: { puestoId: 'direccion-general' } },
  'u-dueno':     { id: 'u-dueno', nombre: 'David', rol: 'trabajador', activo: true,
                   correo: 'davidcisneros2209@outlook.es', datos: { puestoId: 'full-stack-developer' } },
  'u-encargada': { id: 'u-encargada', nombre: 'Elena Encargada', rol: 'trabajador', activo: true,
                   correo: 'elena@md.com',
                   datos: { puestoId: 'encargado-sucursal', sucursales: ['Canindo'] } },
  'u-anaquel':   { id: 'u-anaquel', nombre: 'Ana Anaquelista', rol: 'trabajador', activo: true,
                   correo: 'ana@md.com',
                   datos: { puestoId: 'anaquelista', sucursales: ['Canindo'] } },
};

const estado = { plantillas: [], tareasPuesto: [], escrituras: 0 };

function queryFalsa(sql, params) {
  const s = String(sql).replace(/\s+/g, ' ').trim();

  if (/^select \* from mdtask_usuarios where id =/i.test(s)) {
    const f = FICHAS[String(params[0])];
    return { rows: f ? [f] : [], rowCount: f ? 1 : 0 };
  }
  if (/from mdtask_usuarios where lower\(trim\(correo\)\)/i.test(s)) {
    const c = String(params[0]);
    const f = Object.values(FICHAS).find(x => String(x.correo || '').toLowerCase() === c);
    return { rows: f ? [f] : [], rowCount: f ? 1 : 0 };
  }
  // La que usa `sucursalDeLaFila` para resolver el lugar de un PATCH.
  if (/^select sucursal as suc from mdtask_plantillas where id =/i.test(s)) {
    const f = estado.plantillas.find(x => x.id === String(params[0]));
    return { rows: f ? [{ suc: f.sucursal }] : [], rowCount: f ? 1 : 0 };
  }
  if (/^select \* from mdtask_plantillas where id =/i.test(s)) {
    const f = estado.plantillas.find(x => x.id === String(params[0]));
    return { rows: f ? [f] : [], rowCount: f ? 1 : 0 };
  }
  if (/^select id from mdtask_tareas_puesto where id =/i.test(s)) {
    const f = estado.tareasPuesto.find(x => x.id === String(params[0]));
    return { rows: f ? [f] : [], rowCount: f ? 1 : 0 };
  }
  if (/^insert into mdtask_plantillas/i.test(s)) {
    estado.escrituras++;
    const fila = { id: String(params[0]), sucursal: params[1], puesto_id: params[2],
                   cantidad: params[3], vigente: params[4], datos: {} };
    const i = estado.plantillas.findIndex(x => x.id === fila.id);
    if (i >= 0) estado.plantillas[i] = fila; else estado.plantillas.push(fila);
    return { rows: [fila], rowCount: 1 };
  }
  if (/^update mdtask_plantillas set/i.test(s)) {
    estado.escrituras++;
    const f = estado.plantillas.find(x => x.id === String(params[0]));
    return { rows: [f || { id: String(params[0]), datos: {} }], rowCount: 1 };
  }
  if (/^insert into mdtask_tareas_puesto/i.test(s)) {
    estado.escrituras++;
    const fila = { id: String(params[0]), datos: {} };
    estado.tareasPuesto.push(fila);
    return { rows: [fila], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

function sembrarModulo(ruta, exportaciones) {
  const resuelto = require.resolve(ruta);
  const m = new Module(resuelto, null);
  m.filename = resuelto; m.loaded = true; m.exports = exportaciones;
  require.cache[resuelto] = m;
}
sembrarModulo(path.join(RAIZ, 'api/db.js'), {
  query: async (sql, params) => queryFalsa(sql, params),
  dbConfigurada: () => true,
  getPool: () => null,
});

const { firmarToken } = require(path.join(RAIZ, 'api/_auth.js'));
const plantillas = require(path.join(RAIZ, 'api/plantillas.js'));
const tareasPuesto = require(path.join(RAIZ, 'api/tareas-puesto.js'));

// ── Un req/res de mentira, lo mínimo que tocan los handlers ────────────────
function llamar(handler, { token, metodo, cuerpo, query }) {
  const req = {
    method: metodo,
    headers: token ? { authorization: 'Bearer ' + token } : {},
    body: cuerpo || {},
    query: query || {},
  };
  let estadoHttp = 200, cuerpoResp = null;
  const res = {
    setHeader() {},
    status(n) { estadoHttp = n; return res; },
    json(o) { cuerpoResp = o; return res; },
    end() { return res; },
  };
  return Promise.resolve(handler(req, res)).then(() => ({ http: estadoHttp, resp: cuerpoResp }));
}

const TOKENS = {
  direccion: firmarToken({ uid: 'u-direccion', rol: 'admin' }),
  dueno:     firmarToken({ uid: 'u-dueno', rol: 'admin' }),   // login.js firma admin por correo
  encargada: firmarToken({ uid: 'u-encargada', rol: 'trabajador' }),
  anaquel:   firmarToken({ uid: 'u-anaquel', rol: 'trabajador' }),
  plaza:     firmarToken({ uid: 'plaza:pz-1', rol: 'plaza' }),
  // Sesión vieja de Firebase: el token NO trae rol. `identidadDe` tiene que
  // reconocerla por la ficha, o un administrador con sesión vieja quedaría
  // pasando por la puerta de la excepción en cada escritura.
  fantasma:  firmarToken({ uid: 'u-no-existe', rol: null }),
};

// El ruido de la guardia es esperado (escribe en stderr a propósito). Se
// guarda para poder afirmar sobre él y se restaura al final.
const warnReal = console.warn;
const avisos = [];
console.warn = (...a) => avisos.push(a.map(String).join(' '));

(async () => {
  const filas = [];
  let n = 0;
  const idNuevo = () => 'pl-' + (++n);

  async function caso(nombre, args, esperado) {
    const r = await llamar(args.handler, args);
    filas.push({ nombre, metodo: args.metodo, http: r.http, esperado });
    afirmar(nombre, r.http, esperado);
    return r;
  }

  console.log('\n=== PLANTILLAS (definir la estructura de una sucursal) ===\n');

  // — La mitad que más importa: quien ya trabajaba sigue trabajando —
  await caso('Direccion escribe la plantilla de Canindo',
    { handler: plantillas, token: TOKENS.direccion, metodo: 'POST',
      cuerpo: { id: idNuevo(), sucursal: 'Canindo', puestoId: 'anaquelista', cantidad: 4, vigente: true } }, 200);

  await caso('Direccion escribe la de OTRA sucursal (alcance global)',
    { handler: plantillas, token: TOKENS.direccion, metodo: 'POST',
      cuerpo: { id: idNuevo(), sucursal: 'Padre Hidalgo', puestoId: 'anaquelista', cantidad: 5, vigente: true } }, 200);

  const suya = idNuevo();
  await caso('Encargada escribe la plantilla de SU sucursal',
    { handler: plantillas, token: TOKENS.encargada, metodo: 'POST',
      cuerpo: { id: suya, sucursal: 'Canindo', puestoId: 'cajero-sucursal', cantidad: 3, vigente: true } }, 200);

  // El PATCH no manda sucursal (`plantilla.ts:434`): se resuelve de la fila.
  await caso('Encargada corrige una cantidad (PATCH SIN sucursal en el cuerpo)',
    { handler: plantillas, token: TOKENS.encargada, metodo: 'PATCH',
      cuerpo: { id: suya, cantidad: 4 } }, 200);

  // — La otra mitad: lo que tiene que rebotar —
  await caso('Encargada escribe la plantilla de OTRA sucursal',
    { handler: plantillas, token: TOKENS.encargada, metodo: 'POST',
      cuerpo: { id: idNuevo(), sucursal: 'Padre Hidalgo', puestoId: 'anaquelista', cantidad: 9, vigente: true } }, 403);

  await caso('Encargada corrige una fila de OTRA sucursal (PATCH)',
    { handler: plantillas, token: TOKENS.encargada, metodo: 'PATCH',
      cuerpo: { id: 'pl-2', cantidad: 99 } }, 403);

  await caso('Anaquelista escribe una plantilla',
    { handler: plantillas, token: TOKENS.anaquel, metodo: 'POST',
      cuerpo: { id: idNuevo(), sucursal: 'Canindo', puestoId: 'anaquelista', cantidad: 1, vigente: true } }, 403);

  await caso('Token de PLAZA escribe una plantilla',
    { handler: plantillas, token: TOKENS.plaza, metodo: 'POST',
      cuerpo: { id: idNuevo(), sucursal: 'Canindo', puestoId: 'anaquelista', cantidad: 1, vigente: true } }, 403);

  // — Leer no se tocó —
  await caso('Anaquelista LEE las plantillas (no se gatea la lectura)',
    { handler: plantillas, token: TOKENS.anaquel, metodo: 'GET', query: {} }, 200);

  // — La identidad no reconocida pasa, y se anota —
  await caso('Sesion sin ficha: pasa por EXCEPCION (falla abierto, a proposito)',
    { handler: plantillas, token: TOKENS.fantasma, metodo: 'POST',
      cuerpo: { id: idNuevo(), sucursal: 'Canindo', puestoId: 'anaquelista', cantidad: 2, vigente: true } }, 200);

  await caso('Sin token: 401 antes de llegar a la guardia',
    { handler: plantillas, token: null, metodo: 'POST', cuerpo: { id: idNuevo() } }, 401);

  console.log('\n=== TAREAS-PUESTO (la norma: mas estrecho que la plantilla) ===\n');

  await caso('El dueño publica una norma',
    { handler: tareasPuesto, token: TOKENS.dueno, metodo: 'POST',
      cuerpo: { id: 'tp-1', puestoId: 'vendedor-rd', nombre: 'Apertura', version: '1.0' } }, 200);

  await caso('Direccion global publica una norma',
    { handler: tareasPuesto, token: TOKENS.direccion, metodo: 'POST',
      cuerpo: { id: 'tp-2', puestoId: 'vendedor-rd', nombre: 'Cierre', version: '1.0' } }, 200);

  // Es jefatura y SÍ puede la plantilla de su tienda, y AUN ASI no la norma.
  // Esa asimetria es el diseño, no un descuido: la plantilla es de una tienda,
  // la norma es de todo un puesto de la empresa.
  await caso('Encargada publica una norma (jefatura, pero la norma es de empresa)',
    { handler: tareasPuesto, token: TOKENS.encargada, metodo: 'POST',
      cuerpo: { id: 'tp-3', puestoId: 'vendedor-rd', nombre: 'Otra', version: '1.0' } }, 403);

  await caso('Anaquelista publica una norma',
    { handler: tareasPuesto, token: TOKENS.anaquel, metodo: 'POST',
      cuerpo: { id: 'tp-4', puestoId: 'anaquelista', nombre: 'La mia', version: '1.0' } }, 403);

  await caso('Anaquelista LEE el manual capturado',
    { handler: tareasPuesto, token: TOKENS.anaquel, metodo: 'GET', query: {} }, 200);

  console.log('\n=== LA TABLA ===\n');
  console.log('   ' + 'escenario'.padEnd(58) + 'metodo  http  esperado');
  console.log('   ' + '─'.repeat(84));
  for (const f of filas) {
    const marca = f.http === f.esperado ? ' ' : '✗';
    console.log('   ' + f.nombre.padEnd(58) + String(f.metodo).padEnd(8) +
                String(f.http).padEnd(6) + String(f.esperado) + ' ' + marca);
  }

  // ── Las guardias del propio arnés ────────────────────────────────────────
  //
  // ⚠ EL ORDEN IMPORTA, y la primera versión lo tenía al revés. Con el candado
  // apagado, la guardia del log saltaba primero y el arnés abortaba con «no
  // pude medir» (código 3) — TAPANDO las seis afirmaciones que ya habían dicho
  // exactamente qué se rompió. Un control negativo tiene que NOMBRAR el
  // mecanismo, no esconderse detrás de un aborto: «no medí» y «está roto» son
  // conclusiones opuestas (§8.11 a). Así que si algo falló, se reporta como
  // FALLO; las guardias de integridad solo hablan cuando todo lo demás pasó.
  console.log('');
  if (fallos) {
    console.warn = warnReal;
    console.log('[autorizacion] ' + fallos + ' de ' + corridos + ' afirmaciones FALLARON');
    console.log('[autorizacion] (las guardias de integridad no se evaluan: primero arregla esto)');
    process.exit(2);
  }

  const permitidos = filas.filter(f => f.esperado === 200).length;
  const negados = filas.filter(f => f.esperado === 403).length;
  if (permitidos === 0 || negados === 0) {
    abortar('la muestra NO DISCRIMINA: ' + permitidos + ' permitidos y ' + negados +
            ' negados. Un candado que solo se prueba en una direccion no esta probado.');
  }
  console.log('   ✓ la muestra discrimina: ' + permitidos + ' permitidos · ' + negados + ' negados');

  // Un 403 tiene que ser DEL CANDADO, no de que el handler reventara por otra
  // cosa. Si la escritura no ocurrio en ningun caso, el 200 tampoco vale.
  if (estado.escrituras === 0) {
    abortar('CERO escrituras llegaron a la base simulada. Los 200 no prueban nada: ' +
            'puede que ningun handler haya hecho su trabajo.');
  }
  console.log('   ✓ llegaron ' + estado.escrituras + ' escritura(s) a la base: los 200 son reales');

  const bloqueos = avisos.filter(a => /bloqueado/.test(a)).length;
  if (bloqueos !== negados) {
    abortar('la guardia anoto ' + bloqueos + ' bloqueo(s) para ' + negados + ' negacion(es). ' +
            'Un 403 sin linea en el log no se puede rastrear despues.');
  }
  console.log('   ✓ los ' + negados + ' bloqueos quedaron anotados en el log');

  const excepciones = avisos.filter(a => /EXCEPCION/.test(a)).length;
  if (excepciones !== 1) {
    abortar('esperaba 1 paso por excepcion (la sesion sin ficha) y hubo ' + excepciones +
            '. Si son mas, el reconocimiento de identidad no esta funcionando y el ' +
            'candado se esta cayendo abierto sin que se note.');
  }
  console.log('   ✓ exactamente 1 paso por excepcion, y esta anotado');

  console.warn = warnReal;
  console.log('');
  console.log('[autorizacion] ' + corridos + ' afirmaciones en verde');
})().catch(e => { console.warn = warnReal; abortar('la corrida reventó: ' + (e && e.stack || e)); });
