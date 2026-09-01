#!/usr/bin/env node
/**
 * 🛟 PRUEBA DEL RESCATE DE ARRANQUE (el <script> inline de src/index.html)
 *
 * Contesta DOS preguntas distintas, y las dos hacen falta:
 *
 *   NEGATIVO  · con un index sano, ¿se queda quieto?    -> 1 navegacion
 *   POSITIVO  · con un index cuyos chunks ya no existen  -como el que sirve un
 *               service worker atascado-, ¿recupera la app?  -> 2 navegaciones
 *               y <app-root> pintado
 *
 * El negativo pesa MAS que el positivo: un rescate que recarga cuando no debe
 * es un bucle de recargas para 186 personas, peor que la pantalla blanca que
 * vino a arreglar.
 *
 * ─── POR QUE SE MIDE POR `Sec-Fetch-Mode` ──────────────────────────────────
 * La primera version de esta prueba servia el index roto a la PRIMERA peticion
 * de "/", y la sonda de "¿ya levanto el servidor?" se lo comia: el navegador
 * recibia el index SANO, la app arrancaba, y la prueba daba verde SIN HABER
 * EJERCIDO NADA. El control pasaba por el camino equivocado, y solo se noto al
 * imprimir la cabecera de cada peticion.
 *
 * Ahora solo se cuentan y se rompen las peticiones con `Sec-Fetch-Mode:
 * navigate` -las del navegador abriendo la pagina- y la prueba ABORTA si el 404
 * del chunk fantasma no aparece en el log: sin ese 404 el mecanismo no se
 * ejercio, aunque el resultado se vea bien.
 *
 * Requiere Chrome o Edge instalado. No toca la base ni produccion.
 *   node scripts/prueba-rescate-arranque.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIST = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');
const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.txt': 'text/plain',
};

function abortar(motivo) {
  console.error('');
  console.error('[rescate] ABORTA: ' + motivo);
  console.error('[rescate] No concluyas de esta corrida.');
  process.exit(2);
}

function buscarNavegador() {
  const candidatos = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  for (const c of candidatos) if (fs.existsSync(c)) return c;
  abortar('no encontre Chrome ni Edge. Esta prueba necesita un navegador real: el ' +
    'rescate es codigo que solo se puede comprobar ejecutandolo.');
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  abortar('no hay dist/ construido. Corre `npm run build` primero: sin build no hay ' +
    'index que romper, y "no pude leerlo" se ve igual que "esta bien".');
}
const SANO = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (SANO.indexOf('md_rescate_arranque') === -1) {
  abortar('el index construido NO trae el rescate (falta la marca "md_rescate_arranque"). ' +
    'Probar sin el mecanismo presente daria un verde vacio.');
}
const ROTO = SANO.replace(/main-[A-Z0-9]+\.js/g, 'main-FANTASMA0.js');
if (ROTO === SANO) {
  abortar('no pude renombrar el bundle principal dentro del index: el control positivo ' +
    'no romperia nada y pasaria por no hacer nada.');
}

function servir(puerto, romper) {
  const estado = { navegaciones: 0, log: [] };
  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/' || !path.extname(url)) {
      const esNav = (req.headers['sec-fetch-mode'] || '') === 'navigate';
      if (esNav) estado.navegaciones++;
      const roto1 = romper && esNav && estado.navegaciones === 1;
      estado.log.push('index ' + (esNav ? 'NAV#' + estado.navegaciones : '(no-nav)') +
        ' -> ' + (roto1 ? 'ROTO' : 'sano'));
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      return res.end(roto1 ? ROTO : SANO);
    }
    const f = path.join(DIST, url);
    if (!fs.existsSync(f)) {
      estado.log.push('404 ' + url);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('No encontrado');
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  srv.listen(puerto);
  return { srv, estado };
}

/**
 * ⚠ ASINCRONA A PROPOSITO. La primera version usaba `execFileSync`, que BLOQUEA
 * el event loop de Node — y el servidor HTTP vive en ESTE mismo proceso, asi que
 * no podia contestarle al navegador. La prueba se ahogaba a si misma y moria por
 * timeout: un fallo que se lee como "el rescate no funciona" cuando lo que no
 * funciona es el andamio.
 */
function correr(modo, puerto) {
  const { srv, estado } = servir(puerto, modo === 'roto');
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-rescate-'));
  return new Promise((resolve) => {
    const hijo = spawn(buscarNavegador(), [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--user-data-dir=' + perfil, '--virtual-time-budget=25000',
      // La app registra notificaciones push, y sin esto Chrome se queda
      // reintentando el alta en GCM despues de que la pagina ya termino: el
      // proceso no cierra y la prueba muere por timeout en vez de contestar.
      '--disable-background-networking', '--disable-sync', '--disable-default-apps',
      '--disable-component-update', '--no-default-browser-check',
      '--disable-features=PushMessaging,OptimizationHints,CalculateNativeWinOcclusion',
      '--dump-dom', 'http://localhost:' + puerto + '/',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    let dom = '';
    hijo.stdout.on('data', (d) => { dom += d.toString('utf8'); });
    const reloj = setTimeout(() => { try { hijo.kill(); } catch (_) {} }, 90000);
    hijo.on('close', () => {
      clearTimeout(reloj);
      srv.close();
      if (dom.length < 200) {
        abortar('el navegador devolvio ' + dom.length + ' bytes de DOM en modo ' + modo +
          '. Eso es "no pude medir", no "la app no pinto".');
      }
      const m = /<app-root[^>]*>([\s\S]*?)<\/app-root>/.exec(dom);
      resolve({ estado, pintado: m ? m[1].trim().length : 0 });
    });
  });
}

async function principal() {
console.log('-- NEGATIVO . index sano: NO debe recargar --');
const sano = await correr('sano', 4341);
sano.estado.log.forEach((l) => console.log('   ' + l));
console.log('   navegaciones: %d . app-root: %d bytes', sano.estado.navegaciones, sano.pintado);
if (sano.pintado < 50) {
  abortar('con un index SANO la app no pinto. El problema no es el rescate; no sigas.');
}
if (sano.estado.navegaciones !== 1) {
  abortar('con un index SANO hubo ' + sano.estado.navegaciones + ' navegaciones. El rescate ' +
    'esta recargando cuando no debe, y eso en produccion es un bucle de recargas.');
}

console.log('');
console.log('-- POSITIVO . index con chunk inexistente: debe recuperarse --');
const roto = await correr('roto', 4342);
roto.estado.log.forEach((l) => console.log('   ' + l));
console.log('   navegaciones: %d . app-root: %d bytes', roto.estado.navegaciones, roto.pintado);

// Afirmar el MECANISMO, no la aparicion: sin el 404 del fantasma el navegador
// nunca choco con el chunk que falta, y el verde no significa nada.
if (!roto.estado.log.some((l) => l.indexOf('404 /main-FANTASMA0.js') === 0)) {
  abortar('el navegador nunca pidio el chunk fantasma: la rotura no llego a ejercerse. ' +
    'Revisa que el index ROTO se sirva a la NAVEGACION y no a una sonda.');
}
if (!roto.estado.log.some((l) => l.indexOf('index NAV#1 -> ROTO') === 0)) {
  abortar('la primera navegacion no recibio el index roto. Es exactamente el fallo que ' +
    'esta prueba ya tuvo una vez.');
}
if (roto.estado.navegaciones !== 2) {
  abortar('hubo ' + roto.estado.navegaciones + ' navegaciones; se esperaban 2 (la rota + UNA ' +
    'recarga). ' + (roto.estado.navegaciones > 2 ? 'Mas de 2 es un bucle.' : 'Menos de 2 es que no rescato.'));
}
if (roto.pintado < 50) {
  abortar('tras el rescate <app-root> siguio vacio: no recupero la app.');
}

console.log('');
console.log('OK  El rescate se queda quieto con un index sano (1 navegacion) y recupera la');
console.log('    app en UNA recarga cuando el chunk no existe (2 navegaciones, %d bytes).', roto.pintado);
}

principal().catch((e) => abortar('error inesperado: ' + (e && e.stack || e)));
