/**
 * ✅ LAS DOS LISTAS SON UNA — medido en el DOM, no leído en el código
 * ══════════════════════════════════════════════════════════════════════════
 *
 * El 14/sep/2026 «Tareas del Manual» y «Tareas fuera del manual» dejaron de ser
 * dos entradas de menú y pasaron a ser UNA lista con tres chips. Instrucción de
 * David: «quiero que queden unidas […] solo que esté todo ahí».
 *
 * Esta prueba contesta las tres preguntas que ese cambio abre, y NINGUNA de las
 * tres se puede contestar leyendo el código:
 *
 *  1 · ¿De verdad está todo junto? El chip «Todas» tiene que traer las dos
 *      clases, y cada chip bajar a SU mitad. Un `*ngIf` no es una función que
 *      se pueda llamar: o se pinta y se cuenta, o no se sabe.
 *
 *  2 · ¿SIGUE CERRADO EL MANUAL? Es la pregunta cara. Mientras fueron dos
 *      pantallas, «no se edita el manual» lo garantizaba el modo: en
 *      /tareas-manual no existían los botones. Al juntarlas, eso lo tiene que
 *      garantizar el candado POR TARJETA — y si ese candado fallara, la app
 *      ofrecería editar un documento controlado (invariante §5.4) sin un solo
 *      error visible.
 *
 *  3 · ¿Aterrizan los enlaces viejos DONDE SERVÍAN? `/tareas-manual` y
 *      `/checklist` llevan meses en WhatsApp. Redirigen a `/tareas` con su
 *      `?ver=`, y ese query param se pierde en silencio si alguien cambia el
 *      redirect a uno de cadena: no da error, sólo aterriza en «Todas».
 *
 * ─── EL CONTROL NEGATIVO AFIRMA EL MECANISMO, NO LA APARIENCIA ─────────────
 * El último escenario sirve EL MISMO fixture sin `_origenManual`. Si el chip y
 * el candado cuelgan de ese sello —que es lo que se afirma—, entonces sin él
 * las cinco tareas tienen que volverse editables y el chip «Del manual» caer a
 * cero. Un control que sólo dijera «el caso conocido aparece» lo pasaría una
 * pantalla que marcara todo (§8.11 c).
 *
 * ─── LA SESIÓN ES UNA TRABAJADORA A PROPÓSITO ─────────────────────────────
 * Sin banderas de supervisión: así `puedeFiltrarVista` es false, no se monta el
 * árbol del organigrama y lo que se cuenta son TARJETAS. Con un admin, el chip
 * «Del manual» enseña el árbol y las tarjetas darían cero — un cero que no
 * significaría «no hay», sino «se pintó otra cosa».
 * `createdBy` es ella en las cinco: el botón de editar pide ser admin o autora,
 * así que sin eso el conteo de acciones daría cero por el permiso y no por el
 * candado, y las dos causas se ven idénticas.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const DIST_REAL = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');
let DIST = DIST_REAL;

function abortar(motivo) {
  console.error('');
  console.error('[unidas] ABORTA: ' + motivo);
  console.error('[unidas] No concluyas de esta corrida.');
  process.exit(3);
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

function hoyLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}
const HOY = hoyLocal();

const YO = 'Ana Prueba Unidas';
const SESION = {
  uid: 'w1', id: 'w1', nombre: YO, usuario: 'ana', correo: 'ana@l.invalid',
  rol: 'trabajador', sucursales: ['Canindo'],
};

const ITEMS = [{ id: 'i1', text: 'Punto uno' }, { id: 'i2', text: 'Punto dos' }];
const BASE = { store: 'Canindo', assigned: YO, createdBy: YO, items: ITEMS, timestampCreacion: Date.now() };

/** TRES del manual y DOS libres: los dos lados tienen que poder compararse. */
const MANUALES = [
  { id: 'm1', date: HOY, time: '08:00', name: 'Apertura de pasillo', _puestoId: 'anaquelista', ...BASE },
  { id: 'm2', date: HOY, time: '09:00', name: 'Acomodo de anaquel', _puestoId: 'anaquelista', ...BASE },
  { id: 'm3', date: HOY, time: '10:00', name: 'Cierre de pasillo', _puestoId: 'anaquelista', ...BASE },
];
const LIBRES = [
  { id: 'l1', date: HOY, time: '11:00', name: 'Limpiar bodega chica', ...BASE },
  { id: 'l2', date: HOY, time: '12:00', name: 'Apoyo en caja', ...BASE },
];
const USUARIOS = [{ id: 'w1', nombre: YO, puestoId: 'anaquelista', activo: true, sucursales: ['Canindo'] }];

function fixture(conSello) {
  const marca = conSello
    ? { _origenManual: true, _manualDocumento: 'Manual de prueba', _formatoCodigo: 'PR-01' }
    : {};
  return {
    checklists: MANUALES.map((c) => ({ ...c, ...marca })).concat(LIBRES),
    usuarios: USUARIOS,
    areas: [],
  };
}

/**
 * Qué se espera de cada escenario. Los números salen del fixture de arriba
 * (3 + 2), no de lo que la pantalla devolvió.
 */
const ESCENARIOS = [
  { nombre: 'entro a /tareas (por omision)', url: '/tareas', sello: true,
    chipActivo: 'Todas', tarjetas: 5, conPastilla: 3, conAcciones: 2,
    badges: { 'Todas': 5, 'Del manual': 3, 'Fuera del manual': 2 },
    ruta: '/tareas', query: '' },
  { nombre: 'pulso «Del manual»', url: '/tareas', sello: true, pulsa: 'Del manual',
    chipActivo: 'Del manual', tarjetas: 3, conPastilla: 3, conAcciones: 0,
    badges: { 'Todas': 5, 'Del manual': 3, 'Fuera del manual': 2 },
    ruta: '/tareas', query: '?ver=manual' },
  { nombre: 'pulso «Fuera del manual»', url: '/tareas', sello: true, pulsa: 'Fuera del manual',
    chipActivo: 'Fuera del manual', tarjetas: 2, conPastilla: 0, conAcciones: 2,
    badges: { 'Todas': 5, 'Del manual': 3, 'Fuera del manual': 2 },
    ruta: '/tareas', query: '?ver=libres' },
  // Los dos enlaces viejos, tal como están escritos en WhatsApp.
  { nombre: 'enlace viejo /tareas-manual', url: '/tareas-manual', sello: true,
    chipActivo: 'Del manual', tarjetas: 3, conPastilla: 3, conAcciones: 0,
    ruta: '/tareas', query: '?ver=manual' },
  { nombre: 'enlace viejo /checklist', url: '/checklist', sello: true,
    chipActivo: 'Fuera del manual', tarjetas: 2, conPastilla: 0, conAcciones: 2,
    ruta: '/tareas', query: '?ver=libres' },
  // CONTROL NEGATIVO DEL MECANISMO: el mismo fixture sin el sello del robot.
  { nombre: 'sin _origenManual (control)', url: '/tareas', sello: false,
    chipActivo: 'Todas', tarjetas: 5, conPastilla: 0, conAcciones: 5,
    badges: { 'Todas': 5, 'Del manual': 0, 'Fuera del manual': 5 },
    ruta: '/tareas', query: '' },
];

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function prepararCopia() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'md-unidas-dist-'));
  const copiar = (de, a) => {
    fs.mkdirSync(a, { recursive: true });
    for (const e of fs.readdirSync(de, { withFileTypes: true })) {
      const o = path.join(de, e.name), d = path.join(a, e.name);
      if (e.isDirectory()) copiar(o, d); else fs.copyFileSync(o, d);
    }
  };
  copiar(DIST_REAL, destino);
  console.log('[unidas] copia servida desde %s', destino);
  return destino;
}

function medir(esc, puerto) {
  return new Promise((resolve) => {
    // Se pulsa el chip REAL buscándolo por su texto: si cambia de clase, esto
    // falla ruidosamente en vez de medir otra cosa.
    const pulsar = esc.pulsa
      ? 'var ch=[].slice.call(document.querySelectorAll(".cl-chip-origen .vista-tab"));' +
        'var b=ch.filter(function(e){return (e.textContent||"").indexOf(' +
        JSON.stringify(esc.pulsa) + ')>=0;})[0];' +
        'if(b){b.click();}else{window.__sinChip=1;}'
      : '';

    // OJO CON LOS `+` DEL FINAL DE CADA LÍNEA: sin uno, JS no da error — la
    // inserción automática de punto y coma parte la expresión en dos sentencias
    // válidas, el script sale truncado y el título nunca se fija. Se lee como
    // «la app no pintó». Ya pasó en este repo (4/sep y otra vez hoy).
    const iny =
      '<script>try{localStorage.setItem("md_sesion_actual",' +
      JSON.stringify(JSON.stringify(SESION)) + ');}catch(e){}' +
      'try{localStorage.setItem("md_token","token-de-medicion");}catch(e){}</script>' +
      '<script>window.addEventListener("load",function(){' +
      'setTimeout(function(){' + pulsar + 'setTimeout(function(){' +
      'var chips=[].slice.call(document.querySelectorAll(".cl-chip-origen .vista-tab"));' +
      'document.title="RES "+JSON.stringify({' +
      ' chips: chips.map(function(b){' +
      '   var bg=b.querySelector(".vista-tab-badge");' +
      '   return {texto:(b.textContent||"").replace(/\\s+/g," ").replace(/\\s*\\d+\\s*$/,"").trim(),' +
      '           badge: bg ? Number((bg.textContent||"").trim()) : -1,' +
      '           activo: b.className.indexOf("vista-tab-active")>=0 ? 1 : 0};}),' +
      ' tarjetas: document.querySelectorAll(".checklist-card").length,' +
      // La pastilla 🔒 MANUAL y los botones de editar/borrar son las DOS mitades
      // del candado: la que se ve y la que se puede pulsar.
      ' conPastilla: document.querySelectorAll(".checklist-card .cl-pill-manual").length,' +
      ' conAcciones: document.querySelectorAll(".checklist-card .cl-actions").length,' +
      ' arbol: document.querySelectorAll("app-vista-organigrama").length,' +
      ' sinChip: window.__sinChip ? 1 : 0,' +
      ' ruta: location.pathname,' +
      ' query: location.search' +
      '});},1200);},3200);});</script>';

    const sano = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const html = sano.replace('<body>', '<body>' + iny);
    if (html === sano) return resolve({ error: 'no pude inyectar la sesión en el index' });

    const cuerpo = JSON.stringify(fixture(esc.sello));
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
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-unidas-'));
      // La URL se arma AQUÍ, con la barra puesta por código: en Git Bash MSYS
      // convierte '/tareas' en 'C:/Program Files/Git/tareas' si pasa por una
      // variable de entorno, y el DOM llega vacío — que se lee como «la app no
      // pinta». Es la cuarta vez en este proyecto.
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--window-size=1440,1052', '--user-data-dir=' + perfil, '--virtual-time-budget=25000',
        '--disable-background-networking', '--disable-sync', '--disable-component-update',
        '--disable-features=PushMessaging,OptimizationHints',
        '--dump-dom', 'http://localhost:' + puerto + esc.url],
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
        try { resolve({ dato: JSON.parse(m[1]), apiPedidos, dom: dom.length }); }
        catch (e) { resolve({ error: 'el título no era JSON: ' + m[1].slice(0, 140) }); }
      });
    });
  });
}

(async () => {
  if (!CHROME) abortar('no encontré Chrome. Sin navegador esto no mide nada.');
  if (!fs.existsSync(path.join(DIST_REAL, 'index.html'))) {
    abortar('no hay dist/ en ' + DIST_REAL + '. Corre `npm run build`: esto mide lo COMPILADO.');
  }
  console.log('');
  console.log('[unidas] entrada: %d checklists (%d del manual · %d libres) · %d ficha(s) · fecha %s',
    MANUALES.length + LIBRES.length, MANUALES.length, LIBRES.length, USUARIOS.length, HOY);

  DIST = prepararCopia();

  const filas = [];
  let puerto = 5900 + Math.floor(Math.random() * 200);
  for (const e of ESCENARIOS) {
    const r = await medir(e, puerto++);
    if (r.error) {
      abortar('escenario "' + e.nombre + '": ' + r.error +
        '. Una medición fallida no es un cero: son dos cosas distintas y se ven igual.');
    }
    filas.push({ ...e, d: r.dato, apiPedidos: r.apiPedidos });
  }

  // ── GUARDIAS: antes de comparar nada ─────────────────────────────────────
  for (const f of filas) {
    if (!f.apiPedidos) {
      abortar('el escenario "' + f.nombre + '" nunca pidió /api/*: se midió una pantalla vacía. ' +
        'Todos los conteos serían cero por no haber dato, no por el filtro.');
    }
    if (f.d.sinChip) {
      abortar('en "' + f.nombre + '" no encontré el chip «' + f.pulsa + '» para pulsarlo. ' +
        'Lo medido sería la pantalla sin tocar, no la que dice el escenario.');
    }
    if (f.d.chips.length !== 3) {
      abortar('en "' + f.nombre + '" hay ' + f.d.chips.length + ' chips de origen y son 3. ' +
        'Sin los tres, «cada chip baja a su mitad» no se puede ni preguntar.');
    }
    if (f.d.arbol !== 0) {
      abortar('en "' + f.nombre + '" se montó el árbol del organigrama. Esta sesión es una ' +
        'trabajadora justamente para que no salga: con el árbol en pantalla las tarjetas dan ' +
        'cero y ese cero NO significa «no hay».');
    }
  }

  // ── LA TABLA ─────────────────────────────────────────────────────────────
  console.log('');
  console.log('escenario                      aterriza en          chip activo        tarjetas  manual  editables');
  console.log('─'.repeat(108));
  for (const f of filas) {
    const act = (f.d.chips.find((c) => c.activo) || {}).texto || '(ninguno)';
    console.log('%s %s %s %s %s %s',
      f.nombre.padEnd(30), (f.d.ruta + f.d.query).padEnd(20), act.padEnd(18),
      String(f.d.tarjetas).padEnd(9), String(f.d.conPastilla).padEnd(7), String(f.d.conAcciones));
  }
  console.log('─'.repeat(108));
  console.log('');
  console.log('badges de los chips por escenario');
  console.log('─'.repeat(108));
  for (const f of filas) {
    console.log('  %s %s', f.nombre.padEnd(30),
      f.d.chips.map((c) => c.texto + '=' + c.badge).join(' · '));
  }
  console.log('─'.repeat(108));

  // ── LAS ASERCIONES ───────────────────────────────────────────────────────
  const fallos = [];
  const pide = (ok, msg) => { if (!ok) fallos.push(msg); };

  for (const f of filas) {
    const act = (f.d.chips.find((c) => c.activo) || {}).texto || '(ninguno)';
    pide(f.d.ruta === f.ruta,
      f.nombre + ': aterrizó en "' + f.d.ruta + '" y se esperaba "' + f.ruta + '". Un redirect ' +
      'que no casa NO da error de compilación: cae al wildcard y manda al login.');
    pide(f.d.query === f.query,
      f.nombre + ': la URL quedó con "' + f.d.query + '" y se esperaba "' + f.query + '". El ' +
      'ver= es lo que hace que un enlace viejo abra la mitad que servía.');
    pide(act === f.chipActivo,
      f.nombre + ': el chip activo es «' + act + '» y debía ser «' + f.chipActivo + '».');
    pide(f.d.tarjetas === f.tarjetas,
      f.nombre + ': ' + f.d.tarjetas + ' tarjeta(s) y se esperaban ' + f.tarjetas + '.');
    pide(f.d.conPastilla === f.conPastilla,
      f.nombre + ': ' + f.d.conPastilla + ' tarjeta(s) con la pastilla MANUAL y se esperaban ' +
      f.conPastilla + '.');
    // LA QUE MÁS IMPORTA: el candado del documento controlado (§5.4).
    pide(f.d.conAcciones === f.conAcciones,
      f.nombre + ': ' + f.d.conAcciones + ' tarjeta(s) ofrecen editar/borrar y se esperaban ' +
      f.conAcciones + '. Si sobran, la app está ofreciendo editar el Manual Corporativo.');
    if (f.badges) {
      for (const c of f.d.chips) {
        pide(c.badge === f.badges[c.texto],
          f.nombre + ': el chip «' + c.texto + '» dice ' + c.badge + ' y el fixture tiene ' +
          f.badges[c.texto] + '. Un badge que no cuadra con su lista se lee como tareas perdidas.');
      }
    }
  }

  // ── «TODO ESTÁ AHÍ»: la suma, que es el punto entero del cambio ──────────
  const todas = filas[0], soloManual = filas[1], soloLibres = filas[2];
  pide(todas.d.tarjetas === soloManual.d.tarjetas + soloLibres.d.tarjetas,
    'la lista de «Todas» (' + todas.d.tarjetas + ') no es la suma de las dos mitades (' +
    soloManual.d.tarjetas + ' + ' + soloLibres.d.tarjetas + '). O sobra algo o se está ' +
    'perdiendo una tarea al juntar las listas, que es justo lo que este paso no puede hacer.');

  // ── GUARDIA DE DISCRIMINACIÓN ────────────────────────────────────────────
  // Sin esto, una pantalla que mostrara SIEMPRE lo mismo pasaría lo de arriba.
  const distintos = new Set(filas.map((f) => f.d.tarjetas + '/' + f.d.conAcciones));
  if (distintos.size < 3) {
    abortar('los ' + filas.length + ' escenarios produjeron ' + distintos.size + ' resultado(s) ' +
      'distinto(s). Una muestra que no discrimina no prueba nada, por muchos casos que tenga.');
  }

  // ── EL CONTROL NEGATIVO, afirmado por su mecanismo ───────────────────────
  const neg = filas[filas.length - 1];
  pide(neg.d.conPastilla === 0 && neg.d.conAcciones === todas.d.tarjetas,
    'quité _origenManual del fixture y la pantalla siguió marcando ' + neg.d.conPastilla +
    ' tarjeta(s) como del manual con ' + neg.d.conAcciones + ' editable(s). Entonces el chip y ' +
    'el candado NO cuelgan de ese sello, y esta prueba no está midiendo lo que dice.');

  console.log('');
  if (fallos.length) {
    console.log('✗ %d aserción(es) rotas:', fallos.length);
    for (const f of fallos) console.log('   · %s', f);
    process.exit(2);
  }
  console.log('✓ las %d mediciones pasan · %d resultados distintos entre escenarios.',
    filas.length, distintos.size);
  console.log('');
  console.log('  «Todas» = %d = %d del manual + %d libres', todas.d.tarjetas,
    soloManual.d.tarjetas, soloLibres.d.tarjetas);
  console.log('  el candado: %d tarjetas del manual y NINGUNA ofrece editar ni borrar',
    soloManual.d.conPastilla);
  console.log('  los dos enlaces viejos aterrizan en /tareas con su mitad puesta');
  console.log('');
  console.log('Lo que esto NO prueba: que se VEA bien, ni que el candado del servidor exista.');
  console.log('El de verdad está en editarChecklist/eliminarChecklist, que rechazan la tarea');
  console.log('del manual aunque alguien llame al método; esto mide que ni siquiera se ofrezca.');
})();
