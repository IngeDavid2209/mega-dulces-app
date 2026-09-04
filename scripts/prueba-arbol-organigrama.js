#!/usr/bin/env node
/**
 * 🌳 ¿CUÁNTO CUESTA LLEGAR A UN DATO EN EL ÁRBOL DEL ORGANIGRAMA?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA QUE CONTESTA
 * ═══════════════════════════════════════════════════════════════════════════
 * NO «¿compila?» ni «¿aparece el buscador?». Las dos se contestan solas y las
 * dos dan verde con la pantalla inservible. La pregunta es:
 *
 *     ¿SE VE ALGO AL ENTRAR, Y SE LLEGA A UNA TAREA SIN CAVAR?
 *
 * El defecto que vino a arreglar el rediseño era medible: el organigrama tiene
 * UNA raíz y el árbol arrancaba con todo cerrado, así que la pantalla abría con
 * UNA fila —«Dirección General»—. 53 de los 89 puestos (el 60%) viven en el
 * nivel 3: tres clics para que el puesto apareciera y tres más para ver su
 * primera tarea. Seis, y siete en el nivel 4.
 *
 * Eso no lo ve una prueba unitaria: el estado abierto ahora se resuelve
 * combinando tres fuentes (tu clic, la búsqueda y la siembra del día) y se
 * pinta con `*ngIf`. Hay que pintar la página.
 *
 * ─── CÓMO ───────────────────────────────────────────────────────────────────
 * Sirve el `dist/`, siembra una sesión en `localStorage`, devuelve checklists
 * SINTÉTICOS desde `/api/*`, deja pintar, TECLEA en el buscador de verdad
 * (evento `input`, como una persona) y cuenta nodos.
 *
 * ─── LO QUE VIGILA DE SÍ MISMO ──────────────────────────────────────────────
 * · TESTIGO INDEPENDIENTE del dato. Si «con dato» y «sin dato» dieran el mismo
 *   número de filas, eso tiene DOS lecturas incompatibles: la siembra está rota
 *   (fallo real) o los checklists sintéticos nunca llegaron al componente
 *   (fallo de la medición). Se distinguen leyendo el subtítulo del componente,
 *   que publica cuántas entregas contó. Sin ese testigo, un cero se leería como
 *   «no funciona» cuando podría ser «no medí» (§8.11 a).
 * · CONTROL NEGATIVO REAL, no decorativo: buscar una cadena que no existe tiene
 *   que dar CERO filas. Un filtro que ante «no hay» devuelve todo se ve
 *   idéntico a un filtro que funciona — hasta que alguien lo usa.
 * · CONTROL POSITIVO QUE AFIRMA EL MECANISMO: buscar el nombre de una persona
 *   tiene que dejar su TAREA en pantalla con cero clics. «Aparecen menos filas»
 *   lo pasa cualquier poda; lo que hay que afirmar es que la fila de entrega
 *   —tres niveles más abajo— quedó visible sola.
 * · ABORTA si Chrome, el dist/ o alguna medición faltan.
 *
 *   npm run build   (esto mide lo COMPILADO, no el código fuente)
 *   node scripts/prueba-arbol-organigrama.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIST_REAL = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');

/**
 * EL PARCHE DE AUTENTICACION, dicho y no escondido.
 *
 * `ApiService.token()` exige un usuario de Firebase Auth y lanza «Sin sesion
 * activa» si no lo hay, asi que en headless el `fetch` a /api NUNCA sale: la
 * pantalla queda vacia y el conteo mide una pantalla vacia. Es exactamente
 * lo que le paso a las dos primeras corridas de este script.
 *
 * Se copia el `dist/` y se cortocircuita esa funcion EN LA COPIA. El `dist/`
 * real no se toca (se comprueba, no se supone) y el ancla tiene que aparecer
 * EXACTAMENTE una vez: si el bundler cambia y deja de coincidir, ABORTA en vez
 * de medir de menos. Mismo mecanismo y misma ancla que
 * `prueba-dom-evidencia.js`, que ya lo tenia resuelto.
 */
const ANCLA = 'token(t=!1){return i(this,null,function*(){let r=g(),s=r.currentUser;';
const PARCHE = 'token(t=!1){return i(this,null,function*(){return"token-de-medicion";let r=g(),s=r.currentUser;';

/** La copia parcheada. Se llena en la corrida. */
let DIST = DIST_REAL;

/** Admin global: es quien ve el árbol completo (lo midió prueba-vista-por-nivel). */
const SESION = {
  uid: 'g', id: 'g', nombre: 'Dir Global', usuario: 'dir', correo: 'd@l.invalid',
  rol: 'admin', alcance: 'global',
};

function hoyLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

/**
 * Los checklists sintéticos.
 *
 * Se eligen puestos REALES del catálogo y a distintas profundidades a
 * propósito: `anaquelista` está en el nivel 3 y `practicante-caja-general` en
 * el 4, que son justo los que antes quedaban sepultados. Si la siembra sirve,
 * estos tienen que quedar visibles sin tocar nada.
 *
 * Va `_puestoId` en el checklist Y `puestoId` en la plantilla: si el
 * post-proceso de `checklist.ts` perdiera el primero, el segundo lo resuelve
 * por nombre, y si fallaran los dos las entregas caerían en «sin puesto» —
 * que el testigo del subtítulo delata.
 */
const HOY = hoyLocal();
const ITEMS = [{ id: 'i1', text: 'Punto uno' }, { id: 'i2', text: 'Punto dos' }];
/**
 * `_origenManual: true` NO es decoracion: es el candado del apartado.
 * `checklistsFiltrados` (checklist.ts:1016) recorta con
 * `esTareaDeManual(c) === modoManual`, y esa funcion lee exactamente esta
 * bandera. Sin ella los checklists LLEGAN al componente y el apartado del
 * manual los descarta, asi que el arbol los cuenta como cero. La primera
 * corrida de este script cayo justo ahi: cuatro escenarios midiendo nada, con
 * "5 filas con dato" y "5 filas sin dato" — que se lee como «la siembra esta
 * rota» cuando lo roto era el dato de prueba. Lo delato el testigo, no el cero.
 */
const MARCA_MANUAL = { _origenManual: true, timestampCreacion: Date.now() };
const CHECKLISTS = [
  { id: 'c1', date: HOY, time: '08:00', name: 'Apertura de pasillo', store: 'Canindo',
    assigned: 'Yesenia Prueba Uno', _puestoId: 'anaquelista', items: ITEMS, ...MARCA_MANUAL },
  { id: 'c2', date: HOY, time: '09:00', name: 'Acomodo de anaquel', store: 'Canindo',
    assigned: 'Rogelio Prueba Dos', _puestoId: 'anaquelista', items: ITEMS, ...MARCA_MANUAL },
  { id: 'c3', date: HOY, time: '10:00', name: 'Frente de tienda', store: '8 Esquinas',
    assigned: 'Yesenia Prueba Uno', _puestoId: 'anaquelista', items: ITEMS, ...MARCA_MANUAL },
  { id: 'c4', date: HOY, time: '11:00', name: 'Corte parcial', store: 'Padre Hidalgo',
    assigned: 'Marisol Prueba Tres', _puestoId: 'practicante-caja-general', items: ITEMS, ...MARCA_MANUAL },
  { id: 'c5', date: HOY, time: '12:00', name: 'Revisión de turno', store: 'Canindo',
    assigned: 'Alma Prueba Cuatro', _puestoId: 'encargado-sucursal', items: ITEMS, ...MARCA_MANUAL },
];
const USUARIOS = [
  { id: 'u1', nombre: 'Yesenia Prueba Uno', puestoId: 'anaquelista', activo: true, sucursales: ['Canindo'] },
  { id: 'u2', nombre: 'Rogelio Prueba Dos', puestoId: 'anaquelista', activo: true, sucursales: ['Canindo'] },
  { id: 'u3', nombre: 'Marisol Prueba Tres', puestoId: 'practicante-caja-general', activo: true, sucursales: ['Padre Hidalgo'] },
  { id: 'u4', nombre: 'Alma Prueba Cuatro', puestoId: 'encargado-sucursal', activo: true, sucursales: ['Canindo'] },
];

/**
 * Los cuatro escenarios. `teclea` es lo que se escribe en el buscador REAL.
 * `datos: false` es el control de la siembra: sin trabajo del día no hay nada
 * que sembrar y el árbol debe caer al primer nivel.
 */
const ESCENARIOS = [
  { nombre: 'con dato, sin tocar nada', datos: true,  teclea: null },
  { nombre: 'sin ningún dato',          datos: false, teclea: null },
  { nombre: 'busco "Yesenia"',          datos: true,  teclea: 'Yesenia' },
  { nombre: 'busco "zzzqqq" (no existe)', datos: true, teclea: 'zzzqqq' },
];

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function abortar(motivo) {
  console.error('');
  console.error('[arbol] ABORTA: ' + motivo);
  console.error('[arbol] No concluyas de esta corrida.');
  process.exit(3);
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

// ══════════════════════════════════════════════════════════════════════════
//  LA COPIA PARCHEADA
// ══════════════════════════════════════════════════════════════════════════
function prepararCopia() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'md-arbol-dist-'));
  const copiar = (de, a) => {
    fs.mkdirSync(a, { recursive: true });
    for (const e of fs.readdirSync(de, { withFileTypes: true })) {
      const o = path.join(de, e.name), d = path.join(a, e.name);
      if (e.isDirectory()) copiar(o, d); else fs.copyFileSync(o, d);
    }
  };
  copiar(DIST_REAL, destino);

  let n = 0;
  for (const f of fs.readdirSync(destino)) {
    if (!f.endsWith('.js')) continue;
    const p = path.join(destino, f);
    const s = fs.readFileSync(p, 'utf8');
    if (s.indexOf(ANCLA) >= 0) {
      n += s.split(ANCLA).length - 1;
      fs.writeFileSync(p, s.split(ANCLA).join(PARCHE));
    }
  }
  if (n !== 1) {
    abortar('el ancla del parche de autenticacion aparece ' + n + ' veces (esperaba 1). ' +
      'Si el bundler cambio, hay que reencontrarla: sin el parche la app no pide /api y ' +
      'el conteo seria de una pantalla vacia.');
  }
  const tocado = fs.readdirSync(DIST_REAL)
    .filter((f) => f.endsWith('.js'))
    .some((f) => fs.readFileSync(path.join(DIST_REAL, f), 'utf8').indexOf('token-de-medicion') >= 0);
  if (tocado) abortar('el dist/ REAL quedo parcheado. Reconstruye antes de desplegar.');
  console.log('[arbol] copia parcheada en %s (ancla: 1 ocurrencia)', destino);
  return destino;
}

// ══════════════════════════════════════════════════════════════════════════
//  UNA MEDICIÓN
// ══════════════════════════════════════════════════════════════════════════
function medir(esc, puerto) {
  return new Promise((resolve) => {
    // Teclear de verdad: `[ngModel]`/`(ngModelChange)` reacciona al evento
    // `input`, así que esto recorre el mismo camino que una persona. Escribir
    // en el signal desde fuera probaría el computed, no la pantalla.
    const teclear = esc.teclea
      ? 'var campo=document.querySelector(".org-buscar-campo");' +
        'if(campo){campo.value=' + JSON.stringify(esc.teclea) + ';' +
        'campo.dispatchEvent(new Event("input",{bubbles:true}));}' +
        'else{window.__sinCampo=1;}'
      : '';

    const iny =
      '<script>try{localStorage.setItem("md_sesion_actual",' +
      JSON.stringify(JSON.stringify(SESION)) + ');}catch(e){}</script>' +
      '<script>window.addEventListener("load",function(){' +
      // Primero se deja pintar y sembrar; después se teclea; después se mide.
      'setTimeout(function(){' + teclear + 'setTimeout(function(){' +
      'var sub=document.querySelector(".org-sub");' +
      'document.title="RES "+JSON.stringify({' +
      ' arbol: document.querySelectorAll("app-vista-organigrama").length,' +
      ' puestos: document.querySelectorAll(".org-lista .org-puesto").length,' +
      ' sucursales: document.querySelectorAll(".org-lista .org-fila-suc").length,' +
      ' personas: document.querySelectorAll(".org-lista .org-fila-per").length,' +
      ' entregas: document.querySelectorAll(".org-lista .org-fila-ent").length,' +
      ' guias: document.querySelectorAll(".org-lista .org-guia").length,' +
      ' vacio: document.querySelectorAll(".org-menu-vacio").length,' +
      ' campo: document.querySelectorAll(".org-buscar-campo").length,' +
      ' chips: document.querySelectorAll(".org-chip-uni").length,' +
      ' sinCampo: window.__sinCampo || 0,' +
      // EL TESTIGO: el propio componente publica cuántas entregas contó. Es lo
      // que separa «la siembra no sirve» de «el dato no llegó».
      ' sub: sub ? sub.textContent.replace(/\\s+/g," ").trim() : null' +
      '});},1500);},3500);});</script>';

    const sano = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const html = sano.replace('<body>', '<body>' + iny);
    if (html === sano) return resolve({ error: 'no pude inyectar la sesión en el index' });

    const cuerpo = JSON.stringify({
      checklists: esc.datos ? CHECKLISTS : [],
      usuarios: esc.datos ? USUARIOS : [],
      areas: [],
    });

    let apiPedidos = 0;
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url.indexOf('/api/') === 0) {
        apiPedidos++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(cuerpo);
      }
      if (url === '/' || !path.extname(url)) {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        return res.end(html);
      }
      const f = path.join(DIST, url);
      if (!fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('no'); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.on('error', (e) => resolve({ error: 'el servidor local no levantó: ' + e.message }));
    srv.listen(puerto, () => {
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-arbol-'));
      // La ruta se arma AQUÍ, con la barra puesta por código, nunca por
      // variable de entorno: en Git Bash MSYS convierte '/tareas-manual' en
      // 'C:/Program Files/Git/tareas-manual', la URL sale malformada y el DOM
      // llega vacío — que se lee como «la app no pinta». Costó una tarde.
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--user-data-dir=' + perfil, '--virtual-time-budget=25000', '--disable-background-networking',
        '--disable-sync', '--disable-component-update',
        '--disable-features=PushMessaging,OptimizationHints',
        '--dump-dom', 'http://localhost:' + puerto + '/' + 'tareas-manual'],
        { stdio: ['ignore', 'pipe', 'ignore'] });

      let dom = '';
      h.stdout.on('data', (d) => { dom += d.toString('utf8'); });
      h.on('error', (e) => { srv.close(); resolve({ error: 'no pude lanzar Chrome: ' + e.message }); });
      h.on('close', () => {
        srv.close();
        if (dom.length < 500) return resolve({ error: 'DOM de ' + dom.length + ' bytes' });
        const m = /<title>RES ([\s\S]*?)<\/title>/.exec(dom);
        if (!m) {
          const t = /<title>([\s\S]*?)<\/title>/.exec(dom);
          return resolve({ error: 'sin medición · title=' + (t ? JSON.stringify(t[1]) : 'ninguno') +
            ' · dom=' + dom.length + 'B' });
        }
        try { resolve({ dato: JSON.parse(m[1]), apiPedidos }); }
        catch (e) { resolve({ error: 'el título no era JSON: ' + m[1].slice(0, 140) }); }
      });
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  LA CORRIDA
// ══════════════════════════════════════════════════════════════════════════
(async () => {
  if (!CHROME) abortar('no encontré Chrome. Sin navegador esto no mide nada.');
  if (!fs.existsSync(path.join(DIST_REAL, 'index.html'))) {
    abortar('no hay dist/ en ' + DIST_REAL + '. Corre `npm run build`: esto mide lo COMPILADO.');
  }
  // §8.11(a): el tamaño de la entrada, ANTES de concluir nada.
  console.log('');
  console.log('[arbol] entrada: %d checklists sintéticos · %d fichas · fecha %s',
    CHECKLISTS.length, USUARIOS.length, HOY);

  DIST = prepararCopia();

  const filas = [];
  let puerto = 5600 + Math.floor(Math.random() * 200);
  for (const e of ESCENARIOS) {
    const r = await medir(e, puerto++);
    if (r.error) {
      abortar('escenario "' + e.nombre + '": ' + r.error +
        '. Una medición fallida no es un cero: son dos cosas distintas y se ven igual.');
    }
    filas.push({ ...e, d: r.dato, apiPedidos: r.apiPedidos });
  }

  console.log('');
  console.log('escenario                  puestos  sucurs  personas  entregas  guías  vacío  chips');
  console.log('─'.repeat(92));
  for (const f of filas) {
    console.log('%s %s %s %s %s %s %s %s',
      f.nombre.padEnd(26), String(f.d.puestos).padEnd(8), String(f.d.sucursales).padEnd(7),
      String(f.d.personas).padEnd(9), String(f.d.entregas).padEnd(9),
      String(f.d.guias).padEnd(6), String(f.d.vacio).padEnd(6), String(f.d.chips));
  }
  console.log('─'.repeat(92));
  for (const f of filas) console.log('  subtítulo · %s → %s', f.nombre, JSON.stringify(f.d.sub));

  const conDato = filas[0], sinDato = filas[1], busca = filas[2], nada = filas[3];

  // ── El árbol tiene que estar montado en las cuatro, o no se midió nada ──
  for (const f of filas) {
    if (f.d.arbol !== 1) {
      abortar('el escenario "' + f.nombre + '" no montó <app-vista-organigrama> (arbol=' +
        f.d.arbol + '). Todo lo demás sería un cero por no haber pintado.');
    }
    if (f.d.sinCampo) abortar('el buscador no existía al teclear en "' + f.nombre + '".');
  }

  // ── ¿La app PIDIO los datos? Un cero aqui no es "no hay dato": es que el
  //    parche no sirvio y se esta midiendo una pantalla vacia.
  for (const f of filas) {
    if (!f.apiPedidos) {
      abortar('el escenario "' + f.nombre + '" nunca pidio /api/*: el parche de autenticacion ' +
        'no surtio efecto. Todo lo medido seria de una pantalla vacia.');
    }
  }
  console.log('[arbol] peticiones a /api por escenario: %s',
    filas.map((f) => f.nombre.split(',')[0] + '=' + f.apiPedidos).join(' · '));

  // ── EL TESTIGO, antes de cualquier verde ────────────────────────────────
  // Distingue «la siembra está rota» de «el dato nunca llegó». Sin esto, las
  // dos producen el mismo número y la conclusión sería la contraria.
  const declara = /(\d+)\s+tarea\(s\) del manual/.exec(conDato.d.sub || '');
  const contadas = declara ? Number(declara[1]) : -1;
  if (contadas <= 0) {
    abortar('el componente declara ' + (contadas < 0 ? 'un subtítulo ilegible' : '0 entregas') +
      ' con ' + CHECKLISTS.length + ' checklists servidos: el dato NO llegó al árbol. ' +
      'Sin dato, "la siembra no abre nada" y "no hubo qué abrir" se ven idénticos. ' +
      'Subtítulo: ' + JSON.stringify(conDato.d.sub));
  }
  console.log('');
  console.log('✓ testigo: el componente contó %d de %d entregas servidas.', contadas, CHECKLISTS.length);

  // ── LAS ASERCIONES ──────────────────────────────────────────────────────
  const fallos = [];
  const pide = (ok, msg) => { if (!ok) fallos.push(msg); };

  // 1 · Ya no arranca con UNA fila. Es el defecto que motivó el rediseño.
  pide(conDato.d.puestos > 1,
    'con dato se sigue entrando a ' + conDato.d.puestos + ' fila(s). Era 1 y el rediseño ' +
    'existe justamente para eso.');

  // 2 · La siembra DISCRIMINA: con trabajo del día se destapa más que sin él.
  //     Con el testigo arriba en verde, un empate aquí solo puede ser la siembra.
  pide(conDato.d.puestos > sinDato.d.puestos,
    'la siembra no destapa nada: ' + conDato.d.puestos + ' filas con dato contra ' +
    sinDato.d.puestos + ' sin dato. El testigo confirma que el dato SÍ llegó, así que ' +
    'esto es la siembra.');

  // 3 · Sin dato tampoco se cae a una sola fila (la caída al primer nivel).
  pide(sinDato.d.puestos > 1,
    'sin dato se entra a ' + sinDato.d.puestos + ' fila(s): la caída al primer nivel no ocurrió.');

  // 4 · CONTROL POSITIVO QUE AFIRMA EL MECANISMO: buscar un nombre deja la
  //     TAREA a la vista con cero clics. «Menos filas» lo pasa cualquier poda.
  pide(busca.d.entregas >= 1,
    'buscar "Yesenia" no dejó ninguna fila de entrega visible (entregas=' + busca.d.entregas +
    '). La búsqueda por persona tiene que aterrizar en SUS tareas, no en el puesto del ' +
    'que cuelga: eso es lo que convierte seis clics en cero.');
  pide(busca.d.personas >= 1, 'buscar "Yesenia" no abrió su fila de colaborador.');
  pide(busca.d.puestos < conDato.d.puestos,
    'buscar "Yesenia" no podó el árbol: ' + busca.d.puestos + ' puestos contra ' +
    conDato.d.puestos + ' sin filtro.');

  // 5 · CONTROL NEGATIVO: lo que no existe da CERO, no todo.
  pide(nada.d.puestos === 0,
    'buscar una cadena inexistente dejó ' + nada.d.puestos + ' puestos en pantalla. Un filtro ' +
    'que ante "no hay" devuelve algo se ve idéntico a uno que funciona.');
  pide(nada.d.vacio === 1,
    'el vacío por filtro no se NOMBRA (vacio=' + nada.d.vacio + '). Una lista vacía sin ' +
    'explicación se lee como "la pantalla está rota".');

  // 6 · Lo nuevo existe de verdad en el DOM, no solo en el código fuente.
  pide(conDato.d.guias > 0, 'no se pintó ninguna guía de nivel.');
  pide(conDato.d.chips === 11,
    'esperaba los 11 chips de unidad del catálogo, medí ' + conDato.d.chips +
    '. Una unidad que se pierde en silencio es el modo de fallo de siempre.');

  console.log('');
  if (fallos.length) {
    console.error('✗ %d aserción(es) rotas:', fallos.length);
    for (const x of fallos) console.error('   · ' + x);
    process.exit(2);
  }
  console.log('✓ las %d mediciones pasan.', filas.length);
  console.log('');
  console.log('  al entrar:      1 fila  →  %d', conDato.d.puestos);
  console.log('  sin dato:       1 fila  →  %d (caída al primer nivel)', sinDato.d.puestos);
  console.log('  ver una tarea:  6 clics →  0 (buscando el nombre)');
  console.log('');
  console.log('Lo que esto NO prueba: que se VEA bien. Prueba que el árbol se abre solo, que');
  console.log('el filtro discrimina y que el vacío se nombra. La alineación, el color y el');
  console.log('comportamiento en un celular real siguen necesitando ojos.');
})();
