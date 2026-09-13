#!/usr/bin/env node
/**
 * 📱 ¿QUÉ PANTALLAS SE DESBORDAN, Y POR CULPA DE QUÉ?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA QUE CONTESTA
 * ═══════════════════════════════════════════════════════════════════════════
 * NO «¿tiene media queries?» — casi todas tienen, y aun así el título de una
 * tarjeta se leía en vertical el 7/sep. La pregunta es la que sufre quien usa
 * la app:
 *
 *     ¿HAY QUE HACER SCROLL LATERAL PARA LEER ESTA PANTALLA?
 *
 * Se mide con `scrollWidth > clientWidth` del documento, que es exactamente
 * eso, y además se NOMBRA al culpable: el elemento más ancho que se sale del
 * viewport. Sin el culpable, un «se desborda 240px» manda a buscar a ciegas en
 * un CSS de 3 800 líneas.
 *
 * ─── EL CELULAR SE EMULA CON UN IFRAME, NO CON --window-size ───────────────
 * Medido el 7/sep: Chrome TOPA el ancho de ventana en 504px en las dos
 * variantes de headless (se pidieron 390, 360 y 405; las tres devolvieron 504).
 * Y 504 está POR ENCIMA del breakpoint de 480, así que las media queries de
 * móvil NO SE HABRÍAN APLICADO NUNCA: la prueba habría medido la versión de
 * escritorio y dado verde sin tocar el caso. Un documento dentro de un
 * `<iframe>` evalúa sus media queries contra el viewport DEL MARCO, así que la
 * app se carga en marcos de 390, 768 y 1024, y se comprueba que el ancho de
 * dentro sea el pedido —si no, se aborta en vez de concluir.
 *
 * ─── POR QUÉ HACE FALTA PARCHEAR LA AUTENTICACIÓN ─────────────────────────
 * `ApiService.token()` exige un usuario de Firebase Auth y lanza «Sin sesión
 * activa»: en headless el `fetch` a `/api` nunca sale y media app se queda sin
 * pintar. Se parchea EN UNA COPIA del dist —nunca en el real, y se comprueba
 * que el real quedó intacto— igual que hacen las otras pruebas del repo.
 *
 * ─── LO QUE ESTO NO MIDE, dicho para que no se lea de más ─────────────────
 * Que se vea BIEN. Mide que quepa. Un texto ilegible de 9px, un contraste malo
 * o un botón de 20px caben perfectamente y siguen estando mal. Para eso hacen
 * falta ojos — y de las tres fugas de privilegio de septiembre, las tres las
 * cazó David en pantalla, no una medición.
 *
 *   node scripts/diagnostico-responsivo.js            (todas las rutas)
 *   node scripts/diagnostico-responsivo.js /checklist (una sola)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');

const DIST_REAL = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');

// El mismo parche de las otras pruebas. Si el ancla deja de aparecer, es que el
// build cambió: se aborta en vez de medir una app que no carga datos.
const ANCLA = 'token(t=!1){return i(this,null,function*(){let r=g(),s=r.currentUser;';
const PARCHE = 'token(t=!1){return i(this,null,function*(){return"token-de-medicion";let r=g(),s=r.currentUser;';

/**
 * Los tres anchos que de verdad usa la gente. El 390 es el iPhone más común y
 * el 100% de la operación pasa ahí; 768 es una tablet en vertical; 1024 es el
 * escritorio donde se leen los tableros.
 */
const ANCHOS = [
  { ancho: 390, alto: 844, nombre: 'celular' },
  { ancho: 768, alto: 1024, nombre: 'tablet' },
  { ancho: 1024, alto: 768, nombre: 'escritorio' },
];

/** Sesión de admin global: ve TODAS las pantallas, que es lo que se quiere aquí. */
const SESION = {
  uid: 'r', id: 'r', nombre: 'Medicion Responsiva', usuario: 'medicion',
  correo: 'm@l.invalid', rol: 'admin',
  puedeVerEstadisticas: true, puedeVerCheckstore: true, puedeVerHistorial: true,
  puedeAdministrarPersonal: true, sucursales: ['Padre Hidalgo'],
};

/**
 * Normaliza la ruta que llega por argumento.
 *
 * GIT BASH SE COME LAS RUTAS QUE EMPIEZAN POR «/». MSYS las traduce a rutas de
 * Windows antes de que el proceso las vea, así que `/tareas-manual` llega como
 * `C:/Program Files/Git/tareas-manual`, Angular cae al wildcard, la pantalla
 * que se mide es el LOGIN y el resultado se lee como «no pintó nada».
 *
 * Es el mismo mordisco que dio los ceros falsos del 31/ago con
 * `origin/main:.github/...` y el DOM vacío del 3/sep con `/tareas-manual`. La
 * tercera vez ya no es una anécdota: se normaliza aquí, por código.
 */
function normalizarRuta(a) {
  let r = String(a || '').replace(/\\/g, '/');
  const i = r.toLowerCase().indexOf('/git/');
  if (i >= 0) r = r.slice(i + '/git'.length);
  if (!r.startsWith('/')) r = '/' + r;
  return r;
}

/** Las rutas con pantalla propia. Se listan a mano porque no todas son de menú. */
const RUTAS = process.argv[2] ? [normalizarRuta(process.argv[2])] : [
  '/home', '/checklist', '/tareas-manual', '/control/estadisticas', '/control/ranking',
  '/control/productividad', '/control/sucursales', '/control/plantilla', '/control/pase-lista',
  '/personal', '/reportes', '/descansos', '/manual-puestos', '/tareas-asignadas',
  '/cierre-mensual', '/perfil',
  // NO van /areas, /calendario, /bloques, /turnos ni /flotilla: las cinco son
  // `redirectTo: 'home'` desde que se retiraron. La primera corrida las midió y
  // dieron EXACTAMENTE las cifras de /home -472 nodos, 167 textos chicos- o sea
  // que el reporte contaba /home seis veces y decía «21 pantallas revisadas».
  // Medir un redirect y llamarlo pantalla infla el denominador, que es la forma
  // más silenciosa de mentir con un diagnóstico.
];

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function hoyLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Datos sintéticos por endpoint.
 *
 * Con TEXTOS LARGOS a propósito: los nombres reales del manual son cosas como
 * «Inicio: Fondo de caja contado y registrado en bitácora», y un fixture con
 * «tarea 1» mediría un caso más fácil que el real y daría verde sobre una
 * pantalla que en la tienda se rompe. El desbordamiento se produce con el
 * contenido que de verdad llega.
 */
function datosDe(url) {
  const hoy = hoyLocal();
  if (url.indexOf('/api/checklists') === 0) {
    return Array.from({ length: 6 }, (_, k) => ({
      id: 'c' + k,
      name: 'Apertura de turno · Anaquelista de Sucursal · pasillo de abarrotes',
      assigned: 'Maria Guadalupe Hernandez Villanueva',
      assignedUid: 'w', store: 'Padre Hidalgo', date: hoy,
      time: '12:00', enviado: k % 2 === 0,
      _origenManual: true, _manualDocumento: 'Manual Corporativo de Operacion',
      _manualCodigo: 'MCO-3.1-3.13', _tareaManualId: 'pasillo-turno',
      items: Array.from({ length: 9 }, (_, i) => ({
        id: 'i' + i,
        text: 'Punto de control ' + (i + 1) + ': anaquel alineado, precio visible y producto al frente',
        checked: true, requiresVariasFotos: true,
        photos: [{ url: GIF, time: '14:0' + i, timestamp: Date.now() }],
      })),
    }));
  }
  if (url.indexOf('/api/usuarios') === 0) {
    return Array.from({ length: 12 }, (_, k) => ({
      id: 'u' + k, nombre: 'Colaborador De Prueba Numero ' + (k + 1) + ' Apellido Largo',
      usuario: 'u' + k, activo: true, rol: 'trabajador',
      datos: { puestoId: k === 0 ? 'encargado-sucursal' : 'anaquelista', sucursales: ['Padre Hidalgo'] },
    }));
  }
  if (url.indexOf('/api/plazas') === 0) {
    return Array.from({ length: 5 }, (_, k) => ({
      id: 'Padre Hidalgo::anaquelista::' + (k + 1),
      puesto_id: 'anaquelista', puestoId: 'anaquelista',
      lugar: 'Padre Hidalgo', numero: k + 1, vigente: true,
    }));
  }
  if (url.indexOf('/api/plantillas') === 0) {
    return [{ id: 'p1', sucursal: 'Padre Hidalgo', puestoId: 'anaquelista', cantidad: 4, vigente: true }];
  }
  return [];
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

function abortar(motivo) {
  console.error('');
  console.error('[responsivo] ABORTA: ' + motivo);
  console.error('[responsivo] No concluyas de esta corrida.');
  process.exit(3);
}

function prepararCopia() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'md-resp-'));
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
    if (s.indexOf(ANCLA) >= 0) { n += s.split(ANCLA).length - 1; fs.writeFileSync(p, s.split(ANCLA).join(PARCHE)); }
  }
  if (n !== 1) abortar('el ancla del parche de autenticación aparece ' + n + ' veces (esperaba 1). ' +
    'El build cambió: sin el parche, media app no carga y todo se mediría vacío.');
  const tocado = fs.readdirSync(DIST_REAL).filter((f) => f.endsWith('.js'))
    .some((f) => fs.readFileSync(path.join(DIST_REAL, f), 'utf8').indexOf('token-de-medicion') >= 0);
  if (tocado) abortar('el dist/ REAL quedó parcheado. Reconstruye antes de desplegar.');
  return destino;
}

/** La página marco: siembra sesión, mete la app en un iframe y mide desde fuera. */
function paginaMarco(ruta, medida) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>inicial</title>'
    + '<style>html,body{margin:0;background:#333}iframe{border:0;display:block}</style></head><body>'
    + '<script>'
    + 'try { localStorage.setItem("md_sesion_actual", ' + JSON.stringify(JSON.stringify(SESION)) + '); } catch (e) {}'
    + 'var res = { ruta: ' + JSON.stringify(ruta) + ', ancho: ' + medida.ancho + ' };'
    + 'var f = document.createElement("iframe");'
    + 'f.width = ' + medida.ancho + '; f.height = ' + medida.alto + ';'
    + 'f.src = ' + JSON.stringify(ruta) + ';'
    + 'document.body.appendChild(f);'
    + 'var t0 = Date.now();'
    + 'function fin() { document.title = "RES " + JSON.stringify(res); }'
    + 'function dentro() { try { return f.contentDocument; } catch (e) { return null; } }'
    // Se espera a que haya CONTENIDO, no solo a que exista el documento: un
    // `<app-root>` vacío mide 0 de desbordamiento y se leería como «cabe».
    + 'function esperar(cb) { var g = function () {'
    + '  var d = dentro();'
    + '  var listo = d && d.body && (d.body.innerText || "").trim().length > 40;'
    + '  if (listo) return setTimeout(function(){ cb(true); }, 600);'
    + '  if (Date.now() - t0 > 12000) return cb(false);'
    + '  setTimeout(g, 200); }; g(); }'
    + 'esperar(function (listo) {'
    + '  var d = dentro(), w = f.contentWindow;'
    + '  if (!d || !w) { res.error = "no pude entrar al marco"; return fin(); }'
    + '  res.viewport = w.innerWidth;'
    + '  if (!listo) { res.error = "la pantalla no pinto nada en 12s";'
    + '    res.texto = (d.body.innerText || "").replace(/\\s+/g," ").slice(0,120); return fin(); }'
    + '  var de = d.documentElement, b = d.body;'
    + '  res.scrollW = Math.max(de.scrollWidth, b.scrollWidth);'
    + '  res.clientW = de.clientWidth;'
    + '  res.desborde = Math.max(0, res.scrollW - res.clientW);'
    + '  res.texto = (b.innerText || "").replace(/\\s+/g," ").slice(0, 60);'
    // EL TESTIGO. Sin él, «cabe» y «no había nada que quepa» se leen igual, que
    // es como la primera versión de este script declaró sana una pantalla que
    // estaba sirviendo listas vacías.
    + '  res.nodos = d.querySelectorAll("body *").length;'
    + '  res.letras = (b.innerText || "").trim().length;'
    // ── LO QUE EL DESBORDAMIENTO DEL DOCUMENTO NO VE ────────────────────────
    // Una pantalla puede «caber» y ser inusable: un contenedor con scroll
    // lateral propio, texto de 9px, o un botón que no se puede tocar con el
    // dedo. Los tres son «no responsivo» para quien la usa, y ninguno mueve el
    // scrollWidth del documento.
    + '  res.scrollInterno = 0; res.textoChico = 0; res.tactilChico = 0;'
    + '  res.ejemploChico = ""; res.ejemploTactil = "";'
    + '  var els = d.querySelectorAll("body *");'
    + '  for (var j = 0; j < els.length; j++) {'
    + '    var x = els[j], rr = x.getBoundingClientRect();'
    + '    if (rr.width === 0 || rr.height === 0) continue;'
    + '    var st = w.getComputedStyle(x);'
    + '    if (x.scrollWidth > x.clientWidth + 2 && (st.overflowX === "auto" || st.overflowX === "scroll")) {'
    + '      res.scrollInterno++;'
    + '    }'
    + '    var propio = "";'
    + '    for (var k = 0; k < x.childNodes.length; k++) {'
    + '      if (x.childNodes[k].nodeType === 3) propio += x.childNodes[k].nodeValue;'
    + '    }'
    + '    propio = propio.trim();'
    + '    if (propio.length > 2) {'
    + '      var fs = parseFloat(st.fontSize);'
    + '      if (fs && fs < 12) { res.textoChico++;'
    // QUE CLASE lo produce. Sin esto, «167 textos pequeños» no se puede
    // arreglar: habria que ir elemento por elemento en un CSS de 3 800 lineas.
    // Agrupado por clase, los 167 casi siempre salen de tres o cuatro reglas.
    + '        var cl = (x.className && typeof x.className === "string")'
    + '          ? x.className.trim().split(/\\s+/)[0] : x.tagName.toLowerCase();'
    + '        res.clasesChicas = res.clasesChicas || {};'
    + '        var k2 = cl + " @" + Math.round(fs) + "px";'
    + '        res.clasesChicas[k2] = (res.clasesChicas[k2] || 0) + 1;'
    + '        if (!res.ejemploChico) res.ejemploChico = Math.round(fs) + "px «" + propio.slice(0,28) + "»"; }'
    + '    }'
    + '    var tag = x.tagName.toLowerCase();'
    + '    var tocable = tag === "button" || tag === "a" || tag === "select" ||'
    + '      (tag === "input" && x.type !== "hidden");'
    + '    if (tocable && rr.height < 40) { res.tactilChico++;'
    + '      if (!res.ejemploTactil) res.ejemploTactil = Math.round(rr.height) + "px «" +'
    + '        ((x.innerText || x.value || tag).trim().slice(0,20)) + "»"; }'
    + '  }'
    // EL CULPABLE. Sin esto, un "se desborda 240px" manda a buscar a ciegas.
    + '  var peor = null, peorX = res.clientW;'
    + '  var todos = d.querySelectorAll("body *");'
    + '  for (var i = 0; i < todos.length; i++) {'
    + '    var el = todos[i], r = el.getBoundingClientRect();'
    + '    if (r.width === 0 || r.height === 0) continue;'
    + '    var est = w.getComputedStyle(el);'
    + '    if (est.position === "fixed") continue;'   // barras fijas: otro problema
    + '    if (r.right > peorX + 1) { peorX = r.right; peor = el; }'
    + '  }'
    + '  if (peor) {'
    + '    res.culpable = peor.tagName.toLowerCase()'
    + '      + (peor.className && typeof peor.className === "string" ? "." + peor.className.trim().split(/\\s+/).slice(0,2).join(".") : "")'
    + '      + " (llega a " + Math.round(peorX) + "px)";'
    + '    res.culpableTexto = (peor.innerText || "").replace(/\\s+/g," ").slice(0, 40);'
    + '  }'
    + '  fin();'
    + '});'
    + '</script></body></html>';
}

function servir(dist, marco) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/__marco') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        return res.end(marco.actual);
      }
      if (url.indexOf('/api/') === 0) {
        // CON DATOS, y no vacío. La primera versión servía `{"items":[]}` y
        // /tareas-manual salió «cabe» en los tres anchos — con la pantalla sin
        // una sola tarjeta que desbordar. Es el cero falso del 4/sep: medir un
        // escenario vacío y leerlo como que el código está bien.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ items: datosDe(url) }));
      }
      if (url === '/' || !path.extname(url)) {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'));
      }
      const f = path.join(dist, url);
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.on('error', (e) => abortar('el servidor local no levantó: ' + e.message));
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function chrome(url, perfil) {
  return new Promise((resolve) => {
    execFile(CHROME, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + perfil, '--virtual-time-budget=15000', '--dump-dom', url,
    ], { maxBuffer: 6e7, timeout: 60000 }, (err, stdout) => resolve(stdout || ''));
  });
}

(async () => {
  if (!CHROME) abortar('no encontré Chrome.');
  if (!fs.existsSync(path.join(DIST_REAL, 'index.html'))) {
    abortar('no hay dist/. Corre `npm run build` primero: esto mide lo COMPILADO.');
  }

  const dist = prepararCopia();
  const marco = { actual: '' };
  const srv = await servir(dist, marco);
  const puerto = srv.address().port;
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-perfil-'));

  console.log('[responsivo] %d ruta(s) × %d ancho(s) · dist parcheado en copia',
    RUTAS.length, ANCHOS.length);
  console.log('');

  const filas = [];
  let sinPintar = 0;
  for (const ruta of RUTAS) {
    for (const medida of ANCHOS) {
      marco.actual = paginaMarco(ruta, medida);
      const dom = await chrome('http://127.0.0.1:' + puerto + '/__marco', perfil);
      const m = /<title>RES (\{.*?\})<\/title>/s.exec(dom);
      if (!m) { filas.push({ ruta, ancho: medida.ancho, error: 'sin resultado del marco' }); continue; }
      let r;
      try { r = JSON.parse(m[1]); } catch { r = { error: 'resultado ilegible' }; }
      if (r.error) sinPintar++;
      // La guardia del 7/sep: si el marco no quedó en el ancho pedido, lo medido
      // no es lo que dice la etiqueta.
      if (!r.error && r.viewport && Math.abs(r.viewport - medida.ancho) > 4) {
        abortar('pedí un marco de ' + medida.ancho + ' y dentro midió ' + r.viewport +
          '. Todas las cifras estarían contra un viewport distinto del declarado.');
      }
      filas.push({ ruta, ancho: medida.ancho, ...r });
    }
  }

  srv.close();

  // ── El reporte ───────────────────────────────────────────────────────────
  console.log('En CELULAR (390px), lo que hace una pantalla inusable aunque «quepa»:');
  console.log('');
  console.log('ruta                        scroll  texto   toque   ejemplo');
  console.log('                            propio  <12px   <40px');
  console.log('─'.repeat(100));
  for (const ruta of RUTAS) {
    const c = filas.find(f => f.ruta === ruta && f.ancho === 390) || {};
    if (c.error) { console.log('%s  (no medida)', ruta.padEnd(26)); continue; }
    const marca = (n) => (n ? String(n).padStart(5) + '!' : '     ·');
    console.log('%s %s  %s  %s   %s',
      ruta.padEnd(26), marca(c.scrollInterno), marca(c.textoChico), marca(c.tactilChico),
      (c.ejemploChico || c.ejemploTactil || '').slice(0, 40));
  }
  console.log('─'.repeat(100));
  console.log('El mínimo táctil de iOS son 44px y el 100% de la operación pasa en celular.');
  console.log('');

  // ── DE DÓNDE SALEN LOS TEXTOS PEQUEÑOS ───────────────────────────────────
  // Sumadas todas las pantallas. Lo que importa no es el total sino el reparto:
  // si 400 casos salen de cinco clases, son cinco reglas de CSS; si salieran de
  // doscientas, el arreglo sería otro.
  const porClase = new Map();
  for (const f of filas.filter(x => x.ancho === 390 && x.clasesChicas)) {
    for (const [k, n] of Object.entries(f.clasesChicas)) {
      porClase.set(k, (porClase.get(k) || 0) + n);
    }
  }
  if (porClase.size) {
    const top = [...porClase.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
    const total = [...porClase.values()].reduce((a, b) => a + b, 0);
    console.log('TEXTOS < 12px, agrupados por la clase que los produce (%d casos en %d clases):',
      total, porClase.size);
    for (const [k, n] of top) console.log('   %s  %s', String(n).padStart(4), k);
    const cubre = top.reduce((a, [, n]) => a + n, 0);
    console.log('   → estas %d clases cubren %d de %d casos (%d%%)',
      top.length, cubre, total, Math.round(cubre * 100 / total));
    console.log('');
  }

  console.log('ruta                       390   768  1024  nodos   culpable en celular');
  console.log('─'.repeat(108));
  const rotas = [];
  const flacas = [];
  for (const ruta of RUTAS) {
    const de = (a) => filas.find(f => f.ruta === ruta && f.ancho === a) || {};
    const c = de(390), t = de(768), e = de(1024);
    const celda = (f) => f.error ? '  ??' : (f.desborde > 0 ? String(f.desborde).padStart(4) : '   ·');
    const culp = c.error ? c.error : (c.desborde > 0 ? (c.culpable || '(no identificado)') : '');
    // Una pantalla con cuatro nodos no «cabe»: es que no pintó casi nada. Se
    // marca para no leer su «·» como un aprobado.
    const pocos = !c.error && (c.nodos || 0) < 40;
    if (pocos) flacas.push({ ruta, nodos: c.nodos || 0, texto: c.texto || '' });
    console.log('%s %s  %s  %s %s   %s',
      ruta.padEnd(26), celda(c), celda(t), celda(e),
      String(c.nodos == null ? '  ?' : c.nodos).padStart(5) + (pocos ? '!' : ' '),
      culp.slice(0, 42));
    if (c.desborde > 0 || t.desborde > 0 || e.desborde > 0) {
      rotas.push({ ruta, celular: c.desborde || 0, tablet: t.desborde || 0,
                   escritorio: e.desborde || 0, culpable: c.culpable || t.culpable || e.culpable });
    }
  }
  console.log('─'.repeat(100));
  console.log('Las cifras son PÍXELES QUE SE SALEN del viewport. «·» = cabe.');
  console.log('');

  // Un cero no vale sin su denominador (§8.11 a).
  const medidas = filas.filter(f => !f.error).length;
  console.log('[responsivo] %d de %d mediciones válidas · %d pantalla(s) no pintaron',
    medidas, filas.length, sinPintar);

  if (medidas === 0) {
    abortar('NINGUNA medición fue válida. Un "0 pantallas rotas" aquí sería «no pude medir», ' +
      'no «todo cabe».');
  }
  if (sinPintar > 0) {
    console.log('[responsivo] OJO: las que no pintaron NO están medidas. Su «·» no significa que quepan.');
    for (const f of filas.filter(x => x.error)) {
      console.log('    %s @%d → %s', f.ruta, f.ancho, f.error);
    }
  }

  // ── ¿ESTOY MIDIENDO 21 PANTALLAS O LA MISMA VARIAS VECES? ────────────────
  //
  // La primera corrida completa dio a /areas, /calendario, /bloques, /turnos y
  // /flotilla EXACTAMENTE las mismas cifras que /home: 472 nodos y 167 textos
  // chicos. Con cifras identicas hasta el ultimo digito, lo honesto es suponer
  // que NO se midieron esas pantallas sino un redirect a /home — y sin esta
  // guardia el reporte las habria contado como cinco pantallas revisadas.
  //
  // Es §8.11(c) por una puerta nueva: el control recorria sin comparar una ruta
  // contra la de al lado.
  const porTexto = new Map();
  for (const f of filas.filter(x => x.ancho === 390 && !x.error)) {
    const clave = (f.texto || '').slice(0, 50);
    const arr = porTexto.get(clave) || [];
    arr.push(f.ruta); porTexto.set(clave, arr);
  }
  const gemelas = [...porTexto.values()].filter(a => a.length > 1);
  if (gemelas.length) {
    console.log('');
    console.log('⚠ RUTAS QUE MIDIERON LO MISMO — probablemente un guard las redirige:');
    for (const g of gemelas) {
      console.log('    %s', g.join('  =  '));
    }
    console.log('    Sus cifras son las de la pantalla a la que aterrizan, NO las suyas.');
  }

  // Las «flacas» invalidan su propio resultado, y decirlo es la mitad del valor
  // de este script: un aprobado sobre una pantalla vacía es peor que un fallo.
  if (flacas.length) {
    console.log('');
    console.log('⚠ %d pantalla(s) pintaron MENOS DE 40 NODOS. Su «·» NO significa que quepan:', flacas.length);
    for (const f of flacas) {
      console.log('    %s  %d nodos · «%s»', f.ruta.padEnd(26), f.nodos, (f.texto || '').slice(0, 40));
    }
    console.log('    Puede ser un guard que redirige, un permiso, o datos que este arnés no sirve.');
  }

  console.log('');
  if (!rotas.length) {
    console.log('✓ ninguna de las %d rutas medidas se desborda en ningún ancho.', RUTAS.length);
  } else {
    console.log('✗ %d ruta(s) se desbordan. En orden de cuánto:', rotas.length);
    rotas.sort((a, b) => (b.celular + b.tablet) - (a.celular + a.tablet));
    for (const r of rotas) {
      console.log('   %s  celular %dpx · tablet %dpx · escritorio %dpx',
        r.ruta.padEnd(26), r.celular, r.tablet, r.escritorio);
      if (r.culpable) console.log('       culpable: %s', r.culpable);
    }
  }

  console.log('');
  console.log('LO QUE ESTO NO MIDE: que se VEA bien. Un texto de 9px o un botón de 20px caben');
  console.log('perfectamente y siguen estando mal. Eso necesita ojos.');
  process.exit(rotas.length ? 2 : 0);
})();
