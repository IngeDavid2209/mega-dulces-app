#!/usr/bin/env node
/**
 * 📝 LO QUE TIENE DELANTE QUIEN LLENA UN PUNTO DE EVIDENCIA ESCRITA
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA QUE CONTESTA — y no es «¿funciona la regla?»
 * ═══════════════════════════════════════════════════════════════════════════
 * Que `tieneEvidencia` cuente el texto ya lo fijan 21 pruebas unitarias. Lo que
 * ninguna prueba unitaria puede contestar es **qué ve la Encargada al abrir la
 * tarea**: un `*ngIf` no es una función que se pueda llamar, y `ng test` no
 * pinta nada — compila.
 *
 * Las tres cosas que solo se ven aquí:
 *
 *  1. QUE LOS DOS PUNTOS ESCRITOS NO TENGAN CÁMARA DELANTE. Si la tuvieran, la
 *     persona pasaría el turno intentando fotografiar una ausencia.
 *  2. QUE NO TENGAN «MARCAR COMO HECHA» AL LADO. Sería una segunda forma de
 *     cerrar el punto, sin prueba, y la palomita diría lo contrario que el
 *     porcentaje.
 *  3. QUE AL ESCRIBIR, EL PUNTO SE MARQUE HECHO EN PANTALLA. Es literalmente lo
 *     que pidió David: que lo escrito cuente en el porcentaje.
 *
 * ─── EL CHECKLIST SALE DE LA REGLA REAL, NO DE UN FIXTURE A MANO ───────────
 * Se construye llamando a `armarChecklist` de `dist/manual` —la misma función
 * que corre en el servidor— en vez de tecleando el documento aquí. Un fixture
 * con una forma que el sistema no produce no solo deja de encontrar defectos:
 * FABRICA defectos que no existen, y eso ya cambió la prioridad de un plan una
 * vez (19/sep). Además evita una tercera versión de la regla (§8.11 d).
 *
 * ─── LO QUE VIGILA DE SÍ MISMO ─────────────────────────────────────────────
 * · ABORTA si algún escenario no se pudo medir: «no abrió el detalle» y «no
 *   pinta el bloque» dan los dos un cero (§8.11 a).
 * · ABORTA si la app nunca pidió `/api/*`.
 * · ABORTA si al escribir en un campo el valor no quedó puesto: fijar `.value`
 *   sin disparar `input` no avisa a ngModel, y la medición saldría como si
 *   nadie hubiera escrito — un no-op que da VERDE (17/sep).
 * · ABORTA si el eje que importa no discrimina: si `itemDone` saliera igual en
 *   todas las filas, no se estaría midiendo nada.
 *
 *   npm run build   (mide lo COMPILADO)
 *   node scripts/prueba-evidencia-escrita.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const DIST_REAL = path.join(RAIZ, 'dist', 'mega-dulces-app', 'browser');
const DIST_MANUAL = path.join(RAIZ, 'dist', 'manual');

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

function abortar(motivo) {
  console.error('');
  console.error('[escrita] ABORTA: ' + motivo);
  console.error('[escrita] No concluyas de esta corrida.');
  process.exit(3);
}

// ══════════════════════════════════════════════════════════════════════════
//  EL CHECKLIST, ARMADO POR LA REGLA COMPILADA
// ══════════════════════════════════════════════════════════════════════════
function checklistReal(cual) {
  const { armarChecklist } = require(path.join(DIST_MANUAL, 'emision-manual.util.js'));
  const { tareasAutomaticasDePuesto } = require(path.join(DIST_MANUAL, 'tareas-manual.catalogo.js'));
  const tareas = tareasAutomaticasDePuesto('encargado-sucursal');
  const id = cual === 'apertura' ? 'encargado-sucursal.apertura' : 'encargado-sucursal.operacion';
  const tarea = tareas.find((t) => t.id === id);
  if (!tarea) throw new Error('no existe ' + id + ' en el catálogo compilado');

  const hoy = new Date();
  const fecha = new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const ck = armarChecklist({
    checklistId: 'medicion-escrita', tarea, puestoId: 'encargado-sucursal',
    sucursal: 'Canindo', destinatario: 'Ana Encargada', destinatarioUid: 'w',
    fechaYmd: fecha,
  }, []);
  // La hora límite se estira para que el arnés no mida una tarea ya vencida:
  // el aviso de vencida cambia el DOM y no es lo que se viene a medir.
  ck.time = '23:59';
  for (const it of ck.items) it.horaLimite = '23:59';
  return ck;
}

const ESCENARIOS = [
  { clave: 'abro',     tarea: 'operacion', que: 'abro la tarea de Operación del turno' },
  { clave: 'texto',    tarea: 'operacion', que: 'escribo el cuadro de la ausencia' },
  { clave: 'lista',    tarea: 'operacion', que: 'agrego un pendiente y lo escribo' },
  { clave: 'ambos',    tarea: 'operacion', que: 'lleno los dos' },
  { clave: 'apertura', tarea: 'apertura',  que: 'CONTRASTE: la apertura, que sí pide fotos' },
];

// ══════════════════════════════════════════════════════════════════════════
//  MODO HIJO
// ══════════════════════════════════════════════════════════════════════════
function hijo(dist, puerto, clave) {
  const esc = ESCENARIOS.find((e) => e.clave === clave);
  const sesion = {
    uid: 'w', id: 'w', nombre: 'Ana Encargada', usuario: 'ana', correo: 'an@l.invalid',
    // TRABAJADORA y no admin a propósito: para un admin la vista por defecto es
    // el ÁRBOL del organigrama y `.checklist-card` no aparece nunca. Lo que se
    // viene a medir es lo que tiene delante quien LLENA el checklist.
    rol: 'trabajador', puestoId: 'encargado-sucursal', sucursales: ['Canindo'],
  };
  const checklist = checklistReal(esc.tarea);

  // El guion se arma UNIENDO UN ARREGLO DE LÍNEAS, no concatenando con `+` al
  // final de cada una: así una coma olvidada es un error de sintaxis en Node y
  // no un guion truncado que se lee como «la app no pintó» (17/sep).
  const pasos = [
    '<script>',
    'try{localStorage.setItem("md_sesion_actual",' + JSON.stringify(JSON.stringify(sesion)) + ');}catch(e){}',
    'try{localStorage.setItem("md_token","token-de-medicion");}catch(e){}',
    '</script>',
    '<script>window.addEventListener("load",function(){',
    ' var t0=Date.now(); var res={esc:' + JSON.stringify(clave) + '};',
    ' function espera(sel,cb,ms){var f=function(){',
    '   if(document.querySelector(sel)) return cb(true);',
    '   if(Date.now()-t0>ms) return cb(false);',
    '   setTimeout(f,150);}; f();}',
    // Escribir DE VERDAD: `.value` sin evento no avisa a ngModel.
    ' function escribir(el,txt){ el.value=txt;',
    '   el.dispatchEvent(new Event("input",{bubbles:true}));',
    '   el.dispatchEvent(new Event("change",{bubbles:true})); return el.value===txt; }',
    ' espera(".checklist-card",function(hay){',
    '   if(!hay){res.error="nunca aparecio .checklist-card";return fin();}',
    '   document.querySelector(".checklist-card").click();',
    '   espera(".item-photo-section, .item-sin-evidencia, .cl-escrito",function(det){',
    '     if(!det){res.error="el detalle no abrio";return fin();}',
    '     setTimeout(actuar,700);',
    '   },14000);',
    ' },12000);',
    ' function actuar(){',
    '   var quiere=' + JSON.stringify(clave) + '; res.escrituraOk=true;',
    '   if(quiere==="texto"||quiere==="ambos"){',
    '     var a=document.querySelector(".cl-escrito-area");',
    '     if(!a){res.error="no hay cuadro de texto que llenar";return fin();}',
    '     if(!escribir(a,"Falto Ana Perez (anaquelista, pasillo 3) por incapacidad; cubrio Luis Ramos (cajero).")) res.escrituraOk=false;',
    '   }',
    '   if(quiere==="lista"||quiere==="ambos"){',
    '     var b=document.querySelector(".cl-escrito-agregar");',
    '     if(!b){res.error="no hay boton de agregar renglon";return fin();}',
    '     b.click();',
    '     return setTimeout(function(){',
    '       var i=document.querySelector(".cl-escrito-input");',
    '       if(!i){res.error="el renglon no aparecio tras pulsar agregar";return fin();}',
    '       if(!escribir(i,"Falto surtir el pasillo 3")) res.escrituraOk=false;',
    '       setTimeout(contar,500);',
    '     },400);',
    '   }',
    '   setTimeout(contar,500);',
    ' }',
    ' function contar(){',
    '   if(res.contado) return; res.contado=true;',
    '   var files=[].slice.call(document.querySelectorAll("input[type=file]"));',
    '   res.escritos=document.querySelectorAll(".cl-escrito").length;',
    '   res.areas=document.querySelectorAll(".cl-escrito-area").length;',
    '   res.agregar=document.querySelectorAll(".cl-escrito-agregar").length;',
    '   res.renglones=document.querySelectorAll(".cl-escrito-input").length;',
    '   res.inputArchivo=files.length;',
    '   res.palomear=document.querySelectorAll(".btn-marcar-hecha").length;',
    '   res.itemDone=document.querySelectorAll(".item-done").length;',
    '   res.avisoVacio=document.querySelectorAll(".cl-escrito-vacio").length;',
    '   res.items=document.querySelectorAll(".checklist-item, .item-row").length;',
    '   fin();',
    ' }',
    ' function fin(){document.title="RES "+JSON.stringify(res);}',
    '});</script>',
  ].join('\n');

  const sano = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const html = sano.replace('<body>', '<body>' + pasos);
  if (html === sano) { console.error(JSON.stringify({ esc: clave, error: 'no pude inyectar' })); process.exit(2); }

  let pedidos = 0;
  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url.indexOf('/api/') === 0) {
      pedidos++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (url === '/api/checklists') return res.end(JSON.stringify({ checklists: [checklist] }));
      return res.end(JSON.stringify({ checklists: [], usuarios: [], areas: [], tareas: [] }));
    }
    if (url === '/' || !path.extname(url)) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    const f = path.join(dist, url);
    if (!fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('no'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  srv.listen(puerto, () => {
    const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-esc-'));
    // La ruta se arma AQUÍ y nunca se pasa con barra inicial por variable de
    // entorno: MSYS la convierte en 'C:/Program Files/Git/...' y Chrome abre la
    // pestaña nueva, que se lee como «la app no pinta» (tres veces ya).
    const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--user-data-dir=' + perfil, '--virtual-time-budget=45000', '--window-size=412,900',
      '--disable-background-networking', '--disable-sync', '--disable-component-update',
      '--disable-features=PushMessaging,OptimizationHints',
      '--dump-dom', 'http://localhost:' + puerto + '/tareas'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    let dom = '';
    h.stdout.on('data', (d) => { dom += d.toString('utf8'); });
    h.on('error', (e) => { srv.close(); console.error(JSON.stringify({ esc: clave, error: 'Chrome: ' + e.message })); process.exit(2); });
    h.on('close', () => {
      srv.close();
      const m = /<title>RES ([\s\S]*?)<\/title>/.exec(dom);
      if (!m) {
        const t = /<title>([\s\S]*?)<\/title>/.exec(dom);
        console.error(JSON.stringify({ esc: clave, error: 'sin medición · title=' +
          (t ? t[1] : 'ninguno') + ' · dom=' + dom.length + 'B · pedidos=' + pedidos }));
        process.exit(2);
      }
      if (pedidos === 0) {
        console.error(JSON.stringify({ esc: clave, error: 'la app no pidió /api/*: el checklist no llegó' }));
        process.exit(2);
      }
      console.log(m[1]);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  MODO PADRE
// ══════════════════════════════════════════════════════════════════════════
function copiarDist() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'md-dist-esc-'));
  const copiar = (de, a) => {
    fs.mkdirSync(a, { recursive: true });
    for (const e of fs.readdirSync(de, { withFileTypes: true })) {
      const o = path.join(de, e.name), d = path.join(a, e.name);
      if (e.isDirectory()) copiar(o, d); else fs.copyFileSync(o, d);
    }
  };
  copiar(DIST_REAL, destino);
  return destino;
}

function medir(dist, puerto, clave) {
  return new Promise((ok) => {
    const h = spawn(process.execPath, [__filename, '--hijo', dist, String(puerto), clave],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    h.stdout.on('data', (d) => { out += d; });
    h.stderr.on('data', (d) => { err += d; });
    h.on('close', () => {
      try { return ok(JSON.parse(out.trim())); } catch { /* cae abajo */ }
      let motivo = err.trim().split('\n').pop() || 'sin salida';
      try { motivo = JSON.parse(motivo).error || motivo; } catch { /* texto pelado */ }
      ok({ esc: clave, error: motivo });
    });
  });
}

if (process.argv[2] === '--hijo') {
  if (!CHROME) { console.error(JSON.stringify({ error: 'no encontré Chrome' })); process.exit(2); }
  hijo(process.argv[3], Number(process.argv[4]), process.argv[5]);
} else {
  (async () => {
    if (!CHROME) abortar('no encontré Chrome. Sin navegador esto no mide nada.');
    if (!fs.existsSync(path.join(DIST_REAL, 'index.html'))) {
      abortar('no hay dist/ en ' + DIST_REAL + '. Corre `npm run build`: esto mide lo COMPILADO.');
    }
    if (!fs.existsSync(path.join(DIST_MANUAL, 'emision-manual.util.js'))) {
      abortar('no hay dist/manual. Sin la regla compilada el checklist saldría de un fixture a mano.');
    }

    // El tamaño de la entrada ANTES de concluir nada (§8.11 a).
    const muestra = checklistReal('operacion');
    console.log('');
    console.log('[escrita] la tarea sale de la regla compilada: %d puntos, %d con evidencia escrita',
      muestra.items.length, muestra.items.filter((i) => i.evidenciaEscrita).length);
    if (muestra.items.filter((i) => i.evidenciaEscrita).length === 0) {
      abortar('el catálogo compilado no declara NINGÚN punto escrito. No hay nada que medir.');
    }

    const dist = copiarDist();
    const filas = [];
    let puerto = 43110;
    for (const e of ESCENARIOS) filas.push(await medir(dist, puerto++, e.clave));

    console.log('');
    console.log('escenario                                   escritos area lista rengl archivo paloma done vacio');
    console.log('─────────────────────────────────────────── ──────── ──── ───── ───── ─────── ────── ──── ─────');
    for (const e of ESCENARIOS) {
      const r = filas.find((f) => f.esc === e.clave) || {};
      if (r.error) { console.log(e.que.padEnd(43) + ' ⚠ ' + r.error); continue; }
      console.log(
        e.que.padEnd(43) + ' ' +
        String(r.escritos).padStart(8) + ' ' + String(r.areas).padStart(4) + ' ' +
        String(r.agregar).padStart(5) + ' ' + String(r.renglones).padStart(5) + ' ' +
        String(r.inputArchivo).padStart(7) + ' ' + String(r.palomear).padStart(6) + ' ' +
        String(r.itemDone).padStart(4) + ' ' + String(r.avisoVacio).padStart(5));
    }
    console.log('');

    // ── GUARDIAS, antes de cualquier conclusión ────────────────────────────
    const sinMedir = filas.filter((f) => f.error);
    if (sinMedir.length) {
      abortar(sinMedir.length + ' escenario(s) sin medir: ' +
        sinMedir.map((f) => f.esc + ' (' + f.error + ')').join(' · '));
    }
    const noEscribio = filas.filter((f) => f.escrituraOk === false);
    if (noEscribio.length) {
      abortar('en ' + noEscribio.map((f) => f.esc).join(', ') + ' el valor NO quedó puesto en el ' +
        'campo. Sería un no-op que da verde: se estaría midiendo una pantalla en la que nadie escribió.');
    }

    const f = (k) => filas.find((x) => x.esc === k);
    const fallos = [];
    const afirmar = (ok, msg) => { if (!ok) fallos.push(msg); };

    // 1 · Los dos puntos escritos se pintan, y NO tienen cámara ni palomita.
    afirmar(f('abro').escritos === 2,
      'esperaba 2 bloques de evidencia escrita y medí ' + f('abro').escritos);
    afirmar(f('abro').areas === 1 && f('abro').agregar === 1,
      'esperaba 1 cuadro de texto y 1 botón de agregar; medí ' + f('abro').areas + ' y ' + f('abro').agregar);
    afirmar(f('abro').inputArchivo === 3,
      'LOS PUNTOS ESCRITOS TIENEN CÁMARA: esperaba 3 inputs de archivo (los 3 que sí piden foto) y medí ' +
      f('abro').inputArchivo);
    afirmar(f('abro').palomear === 0,
      'SALE «Marcar como hecha» junto al cuadro de texto: son ' + f('abro').palomear +
      ', y sería una segunda forma de cerrar el punto SIN prueba');

    // 2 · Vacíos NO cuentan; escritos SÍ. Es lo que pidió David.
    afirmar(f('abro').itemDone === 0,
      'un punto escrito VACÍO ya cuenta como hecho: ' + f('abro').itemDone + ' marcados sin escribir nada');
    afirmar(f('abro').avisoVacio === 2,
      'el vacío no se nombra en los dos puntos: ' + f('abro').avisoVacio + ' de 2');
    afirmar(f('texto').itemDone === 1,
      'ESCRIBIR EL CUADRO NO CIERRA EL PUNTO: esperaba 1 marcado y medí ' + f('texto').itemDone);
    afirmar(f('lista').itemDone === 1,
      'ESCRIBIR UN RENGLÓN NO CIERRA EL PUNTO: esperaba 1 marcado y medí ' + f('lista').itemDone);
    afirmar(f('lista').renglones === 1,
      'el renglón nuevo no apareció: ' + f('lista').renglones);
    afirmar(f('ambos').itemDone === 2,
      'llenando los dos esperaba 2 marcados y medí ' + f('ambos').itemDone);

    // 3 · CONTRASTE: la apertura no cambió. Sin esta fila, un cambio que
    //     apagara la cámara en TODA la app pasaría las de arriba en verde.
    afirmar(f('apertura').escritos === 0,
      'la apertura pinta bloques de evidencia escrita y no debería: ' + f('apertura').escritos);
    afirmar(f('apertura').inputArchivo === 7,
      'la apertura dejó de pedir fotos en sus 7 puntos: ' + f('apertura').inputArchivo + ' inputs');

    // ── DISCRIMINACIÓN: sin esto, algo que marcara TODO pasaría lo de arriba ─
    const dones = new Set(filas.filter((x) => x.esc !== 'apertura').map((x) => x.itemDone));
    if (dones.size < 3) {
      abortar('la muestra NO discrimina: `itemDone` toma ' + dones.size + ' valores distintos (' +
        [...dones].join(',') + '). Una app que marcara todo, o nada, pasaría las aserciones de arriba.');
    }

    if (fallos.length) {
      console.error('[escrita] ' + fallos.length + ' aserción(es) en rojo:');
      for (const x of fallos) console.error('  ✗ ' + x);
      process.exit(2);
    }
    console.log('[escrita] ' + ESCENARIOS.length + ' escenarios · 11 aserciones · todo en verde.');
    console.log('[escrita] `itemDone` discrimina con ' + dones.size + ' valores distintos.');
  })();
}
