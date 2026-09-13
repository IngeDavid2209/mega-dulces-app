#!/usr/bin/env node
/**
 * 📱 LA TARJETA DE TAREA EN UN CELULAR — ¿cabe el título?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA QUE CONTESTA
 * ═══════════════════════════════════════════════════════════════════════════
 * NO «¿se ve mejor?» — eso lo dice una captura y no se puede volver a correr.
 * La pregunta es:
 *
 *     ¿CUÁNTOS PÍXELES DE ANCHO TIENE EL TÍTULO, Y EN CUÁNTOS RENGLONES CAE?
 *
 * El defecto que vino a arreglar esto era medible y brutal: en un celular de
 * 390px el título de la tarea se leía EN VERTICAL, una letra por renglón.
 * `.cl-head` era una fila de tres columnas y `.cl-head-actions` conservaba
 * `flex-shrink: 0` con sus tres pastillas en `nowrap`, así que reclamaba ~279
 * de los ~334px útiles y al título le quedaban ~0. Con 0px de ancho y
 * `word-break: break-word`, cada letra es un renglón.
 *
 * Eso no lo ve `ng test` ni el build: el ancho de una columna flex solo existe
 * cuando el navegador reparte el espacio. Hay que pintar la página y MEDIR.
 *
 * ─── LO QUE VIGILA DE SÍ MISMO ──────────────────────────────────────────────
 * · ABORTA si `.checklist-card` nunca apareció. Un `ancho: 0` por «la tarjeta
 *   no se pintó» y por «el título está estrangulado» se ven IDÉNTICOS, y son
 *   dos cosas distintas (§8.11 a).
 * · ABORTA si el viewport real no es el declarado. En `--headless=new` Chrome
 *   descuenta la barra de scroll, así que «390» no es 390 — y «caben N» sin su
 *   denominador no significa nada.
 * · ABORTA si la app nunca pidió `/api/*`: el checklist sintético no llegó y se
 *   estaría midiendo una pantalla vacía.
 * · La sesión es una TRABAJADORA a propósito: para un admin, `/tareas-manual`
 *   pinta el ÁRBOL del organigrama y `.checklist-card` no aparece nunca.
 *
 *   npm run build   (mide lo COMPILADO, no el código fuente)
 *   node scripts/prueba-tarjeta-movil.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIST_REAL = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');

// Misma ancla y mismo parche que `prueba-dom-evidencia.js`: sin esto
// `ApiService.token()` lanza «Sin sesión activa» y el fetch a /api nunca sale.
// ─── YA NO SE PARCHEA LA AUTENTICACION (13/sep/2026) ──────────────────────
//
// Estas pruebas copiaban el dist/ y le inyectaban un token dentro de
// ApiService.token(), buscando una cadena del codigo MINIFICADO. Funcionaba y
// era fragil: al añadir el acceso por plaza ese metodo cambio, el ancla
// desaparecio y las TRES pruebas abortaron a la vez.
//
// Ahora `token()` devuelve el JWT de localStorage.md_token si existe -el camino
// del acceso por plaza-, asi que basta sembrarlo. Es un camino legitimo del
// producto, no un parche al bundle, y no se rompe cada vez que ese metodo se
// toca. El token no tiene que ser valido: estas pruebas sirven /api ellas
// mismas.
const TOKEN_MEDICION = 'token-de-medicion';

/**
 * EL CELULAR SE EMULA CON UN IFRAME, y no con `--window-size`.
 *
 * Medido: Chrome TOPA el ancho de ventana en 504px en las dos variantes de
 * headless (pedí 390, 360 y 405 — las tres devolvieron un viewport de 504).
 * Y 504 está POR ENCIMA del breakpoint de 480px, así que la media query móvil
 * —la que tiene el defecto— no se habría aplicado nunca: la prueba habría
 * medido la versión de escritorio y pasado en verde sin tocar el caso.
 *
 * Un documento dentro de un `<iframe>` evalúa sus media queries contra el
 * viewport DEL IFRAME. Así que la app se carga en un marco de 390px de ancho
 * dentro de una ventana normal, y se mide desde el padre —mismo origen, así
 * que `contentDocument` y `localStorage` se comparten—.
 *
 * Se COMPRUEBA el ancho de dentro: si el iframe no queda en 390, se aborta.
 * Un «el título mide N» contra un viewport distinto al declarado es un número
 * sin su denominador.
 */
const MARCO = { ancho: 390, alto: 900, tolerancia: 4 };
const VENTANA = { w: 700, h: 1000 };

/** Trabajadora: es quien ve la LISTA de tarjetas y no el árbol. */
const SESION = {
  uid: 'w', id: 'w', nombre: 'Carolina Guzman Ruiz', usuario: 'ana',
  correo: 'an@l.invalid', rol: 'trabajador', puestoId: 'anaquelista',
  sucursales: ['Padre Hidalgo'],
};

function hoyLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

/**
 * El checklist de la captura de David, reproducido campo por campo.
 *
 * Importa que sea EL MISMO caso: título largo, `completo`, `enviado` y con
 * código de formato. Las tres pastillas juntas son lo que estrangulaba el
 * título — con una sola no se reproduce, y la prueba pasaría sin medir nada.
 */
const CHECKLIST = {
  id: 'medicion-movil', timestampCreacion: Date.now(),
  name: 'Operación de pasillo del turno',
  assigned: 'Carolina Guzman Ruiz', assignedUid: 'w',
  store: 'Padre Hidalgo', date: hoyLocal(), time: '11:59 PM',
  status: 'completo', enviado: true,
  createdBy: 'Manual Corporativo', created_by: 'Manual Corporativo',
  _origenManual: true, _formatoCodigo: '3.1 - 3.13',
  _manualDocumento: 'Manual Corporativo de Operación', _manualVersion: '2026',
  tareaManualId: 'pasillo-turno',
  items: Array.from({ length: 9 }, (_, i) => ({
    id: 'i' + i, text: 'Punto de control ' + (i + 1), checked: true,
    photos: [{ url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', time: '14:0' + i }],
    requiresVariasFotos: true,
  })),
};

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function abortar(motivo) {
  console.error('');
  console.error('[tarjeta] ABORTA: ' + motivo);
  console.error('[tarjeta] No concluyas de esta corrida.');
  process.exit(3);
}

/** Si se pasa una ruta, la corrida saca un PNG y no mide. */
const CAPTURA = process.argv[2] || null;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

function prepararCopia() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tarjeta-'));
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
    if (s.indexOf('ApiService') >= 0) n++;   // solo se cuenta; ya no se parchea
  }
  return destino;
}

function medir(dist, puerto) {
  return new Promise((resolve) => {
    // La pagina MARCO: siembra la sesion, mete la app en un iframe de 390px y
    // mide desde fuera. Va como archivo aparte y NO inyectada en el index,
    // porque el index es justamente lo que carga el iframe: inyectarlo ahi lo
    // haria medirse a si mismo y anidar marcos sin fin.
    const marco = '<!doctype html><html><head><meta charset="utf-8"><title>inicial</title>'
      + '<style>body{margin:0;background:#333}iframe{border:0;display:block}</style></head><body>'
      + '<script>'
      + 'try { localStorage.setItem("md_sesion_actual", ' + JSON.stringify(JSON.stringify(SESION)) + '); } catch (e) {}'
      + 'try { localStorage.setItem(\"md_token\", \"token-de-medicion\"); } catch (e) {}'
      + 'var res = {};'
      + 'var f = document.createElement("iframe");'
      + 'f.width = ' + MARCO.ancho + '; f.height = ' + MARCO.alto + '; f.src = "/tareas-manual";'
      + 'document.body.appendChild(f);'
      + 'var t0 = Date.now();'
      + 'function fin() { document.title = "RES " + JSON.stringify(res); }'
      + 'function dentro() { try { return f.contentDocument; } catch (e) { return null; } }'
      + 'function espera(sel, cb, ms) { var g = function () {'
      + '  var d = dentro();'
      + '  if (d && d.querySelector(sel)) return cb(true);'
      + '  if (Date.now() - t0 > ms) return cb(false);'
      + '  setTimeout(g, 150); }; g(); }'
      + 'function ancho(e) { return e ? Math.round(e.getBoundingClientRect().width) : -1; }'
      + 'function renglones(e) { if (!e) return -1;'
      + '  var w = f.contentWindow;'
      + '  var lh = parseFloat(w.getComputedStyle(e).lineHeight);'
      + '  if (!lh || isNaN(lh)) lh = parseFloat(w.getComputedStyle(e).fontSize) * 1.3;'
      + '  return Math.round(e.getBoundingClientRect().height / lh); }'
      // LA CAPTURA ES DE LA PESTANA «ENVIADAS», y no es un detalle: el
      // post-proceso DESCARTA los `enviado === true` de la vista «pendientes»,
      // asi que con la vista por omision la tarjeta NO EXISTE -la primera
      // corrida abortó justo ahi-. Y la pastilla «Enviado» es una de las TRES
      // que estrangulaban el titulo: medir en «pendientes» habria medido un
      // caso mas debil que el real.
      + 'espera(".vista-tab", function (hayTabs) {'
      + '  var w = f.contentWindow, d = dentro();'
      + '  res.marco = w ? (w.innerWidth + "x" + w.innerHeight) : "sin acceso";'
      + '  if (!hayTabs) { res.error = "nunca aparecieron las pestanas .vista-tab dentro del marco";'
      + '    res.enPantalla = d ? (d.body.innerText || "").replace(/\\s+/g, " ").slice(0, 180) : "(sin documento)";'
      + '    return fin(); }'
      + '  var env = [].slice.call(d.querySelectorAll(".vista-tab"))'
      + '    .filter(function (b) { return (b.textContent || "").trim().indexOf("Enviadas") === 0; })[0];'
      + '  if (!env) { res.error = "no encontre la pestana Enviadas";'
      + '    res.tabs = [].slice.call(d.querySelectorAll(".vista-tab"))'
      + '      .map(function (b) { return (b.textContent || "").trim().slice(0, 20); }).join(" | ");'
      + '    return fin(); }'
      + '  env.click();'
      + '  espera(".checklist-card", function (hay) {'
      + '    var d2 = dentro();'
      + '    if (!hay) { res.error = "nunca aparecio .checklist-card";'
      + '      res.enPantalla = d2 ? (d2.body.innerText || "").replace(/\\s+/g, " ").slice(0, 180) : "(sin documento)";'
      + '      return fin(); }'
      + '    var t = d2.querySelector(".cl-head-text .cl-title");'
      + '    var m = d2.querySelector(".cl-head-text .cl-meta-line");'
      + '    var a = d2.querySelector(".cl-head-actions");'
      + '    var c = d2.querySelector(".checklist-card");'
      + '    var h = d2.querySelector(".cl-head");'
      + '    res.tarjetaAncho  = ancho(c);'
      + '    res.tituloAncho   = ancho(t);'
      + '    res.tituloRengls  = renglones(t);'
      + '    res.tituloTexto   = t ? (t.textContent || "").trim().slice(0, 40) : null;'
      + '    res.metaAncho     = ancho(m);'
      + '    res.metaRengls    = renglones(m);'
      + '    res.accionesAncho = ancho(a);'
      + '    res.pastillas     = d2.querySelectorAll(".cl-head-actions > *").length;'
      + '    res.cabeceraAlto  = h ? Math.round(h.getBoundingClientRect().height) : -1;'
      // El `display` de `.cl-head` dice si la media query MOVIL se aplico:
      // "grid" es el arreglo, "flex" es la version de escritorio. Sin esta
      // cifra, un verde podria venir de haber medido la pantalla grande.
      + '    res.headDisplay   = h ? f.contentWindow.getComputedStyle(h).display : "?";'
      // TESTIGO DE «ES MOVIL», independiente del arreglo: el avatar mide 44px
      // en la regla base y 38px dentro de la media query de <=480. No lo toca
      // este cambio, asi que sirve para distinguir «no es movil» de «es movil
      // sin el arreglo» — dos cosas que `display: grid` NO distingue, porque
      // grid ES el arreglo.
      + '    res.avatarAncho   = ancho(d2.querySelector(".cl-avatar"));'
      + '    fin();'
      + '  }, 25000);'
      + '}, 15000);'
      + '</script></body></html>';

    const cuerpo = JSON.stringify({ checklists: [CHECKLIST], usuarios: [], areas: [] });
    let apiPedidos = 0;
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      // El marco va PRIMERO: cualquier ruta sin extension cae en el index de
      // Angular, asi que sin este corte la pagina de medicion nunca se serviria.
      if (url === '/__marco') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        return res.end(marco);
      }
      if (url.indexOf('/api/') === 0) {
        apiPedidos++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(cuerpo);
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
    srv.on('error', (e) => resolve({ error: 'el servidor local no levanto: ' + e.message }));
    srv.listen(puerto, () => {
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tj-perfil-'));
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--user-data-dir=' + perfil, '--virtual-time-budget=45000',
        '--window-size=' + VENTANA.w + ',' + VENTANA.h,
        '--disable-background-networking', '--disable-sync', '--disable-component-update',
        '--disable-features=PushMessaging,OptimizationHints',
        // La ruta se arma AQUI, con la barra por codigo: MSYS convierte
        // '/__marco' en 'C:/Program Files/Git/__marco' y Chrome abre otra cosa.
        // Con CAPTURA se pide un PNG en vez del DOM: Chrome no hace las dos
        // cosas en una corrida. El marco y el servidor son los MISMOS, asi que
        // la imagen y las cifras salen de la misma pantalla — si fueran dos
        // caminos distintos, la captura podria no ser de lo que se midio.
        ...(CAPTURA ? ['--screenshot=' + CAPTURA, '--hide-scrollbars']
                    : ['--dump-dom']),
        'http://localhost:' + puerto + '/' + '__marco'],
        { stdio: ['ignore', 'pipe', 'ignore'] });
      let dom = '';
      h.stdout.on('data', (d) => { dom += d.toString('utf8'); });
      h.on('error', (e) => { srv.close(); resolve({ error: 'no pude lanzar Chrome: ' + e.message }); });
      h.on('close', () => {
        srv.close();
        if (CAPTURA) {
          return resolve({ captura: fs.existsSync(CAPTURA) ? fs.statSync(CAPTURA).size : 0 });
        }
        if (dom.length < 300) return resolve({ error: 'DOM de ' + dom.length + ' bytes' });
        const m = /<title>RES ([\s\S]*?)<\/title>/.exec(dom);
        if (!m) {
          const t = /<title>([\s\S]*?)<\/title>/.exec(dom);
          return resolve({ error: 'sin medicion . title=' + (t ? JSON.stringify(t[1]) : 'ninguno') +
            ' . dom=' + dom.length + 'B' });
        }
        try { resolve({ dato: JSON.parse(m[1]), apiPedidos }); }
        catch (e) { resolve({ error: 'el titulo no era JSON: ' + m[1].slice(0, 140) }); }
      });
    });
  });
}

(async () => {
  if (!CHROME) abortar('no encontré Chrome. Sin navegador esto no mide nada.');
  if (!fs.existsSync(path.join(DIST_REAL, 'index.html'))) {
    abortar('no hay dist/. Corre `npm run build`: esto mide lo COMPILADO.');
  }
  console.log('');
  console.log('[tarjeta] entrada: 1 checklist sintético · %d puntos · título %s',
    CHECKLIST.items.length, JSON.stringify(CHECKLIST.name));

  const dist = prepararCopia();
  const r = await medir(dist, 5900 + Math.floor(Math.random() * 200));
  if (r.captura !== undefined) {
    if (!r.captura) abortar('la captura salió vacía: ' + CAPTURA);
    console.log('[tarjeta] captura escrita: %s (%d bytes)', CAPTURA, r.captura);
    return;
  }
  if (r.error) abortar(r.error + '. Una medición fallida no es un cero.');
  const d = r.dato;
  if (d.error) {
    abortar(d.error + ' · en pantalla decía: ' + JSON.stringify(d.enPantalla || '') +
      (d.tabs ? ' · pestañas vistas: ' + d.tabs : '') +
      '. Un «ancho 0» por no pintarse y por estar estrangulado se ven idénticos.');
  }
  if (!r.apiPedidos) abortar('la app nunca pidió /api/*: el checklist no llegó.');

  // GUARDIA DEL DENOMINADOR: «el título mide N» no dice nada sin el viewport.
  const anchoReal = Number(String(d.marco).split('x')[0] || 0);
  if (!anchoReal || Math.abs(anchoReal - MARCO.ancho) > MARCO.tolerancia) {
    abortar('el viewport DENTRO del marco es ' + d.marco + ' y se iba a concluir sobre ' +
      MARCO.ancho + 'px.');
  }
  // GUARDIA DE «ES MOVIL», y va sobre el AVATAR y no sobre `display: grid`.
  // El avatar mide 38px solo dentro de la media query de <=480 (44 en la base)
  // y este cambio no lo toca. `display: grid` no sirve de guardia porque grid
  // ES el arreglo: con el CSS viejo daria `flex` y se leeria como «no es
  // movil» cuando en realidad seria «es movil y el arreglo no esta». Guardia
  // sobre la entrada que de verdad se usa, no sobre un proxy (§8.11 b).
  if (d.avatarAncho < 34 || d.avatarAncho > 42) {
    abortar('el avatar mide ' + d.avatarAncho + 'px y en móvil son 38 (44 en escritorio): ' +
      'la media query de <=480px no se aplicó, así que esto midió otra pantalla.');
  }

  console.log('[tarjeta] viewport DENTRO del marco %s · avatar %dpx (móvil=38) · .cl-head: %s · %d petición(es) a /api',
    d.marco, d.avatarAncho, d.headDisplay, r.apiPedidos);
  console.log('');
  // SIN `%4d`: `util.format` de Node NO soporta el padding de printf -solo
  // %s %d %i %f %j %o %O %c %%- y un '%4d' se imprime literal Y DESPLAZA los
  // argumentos. Este mismo script salio con "tarjeta %4d px 360" en su primera
  // corrida: el bug que se arreglo en `diagnostico-silencio-por-unidad.js` el
  // 4/sep, repetido dos dias despues por el mismo autor. Se usa padStart.
  const px = (n) => String(n).padStart(4) + ' px';
  console.log('  tarjeta                  %s', px(d.tarjetaAncho));
  console.log('  TÍTULO                   %s  ·  %d renglón(es)   %s',
    px(d.tituloAncho), d.tituloRengls, JSON.stringify(d.tituloTexto));
  console.log('  meta (nombre·suc·fecha)  %s  ·  %d renglón(es)', px(d.metaAncho), d.metaRengls);
  console.log('  pastillas                %s  ·  %d elemento(s)', px(d.accionesAncho), d.pastillas);
  console.log('  alto de la cabecera      %s', px(d.cabeceraAlto));
  console.log('');

  const fallos = [];
  const pide = (ok, msg) => { if (!ok) fallos.push(msg); };

  // Las tres pastillas TIENEN que estar: con una sola el defecto no se
  // reproduce y la prueba pasaría sin haber medido el caso real.
  pide(d.pastillas >= 3,
    'solo hay ' + d.pastillas + ' pastilla(s) en la cabecera. El defecto lo causaban TRES ' +
    '(estado + Enviado + MANUAL·código) sumando ~279px; con menos, esta prueba pasa sin ' +
    'ejercer el caso de la captura.');

  // `grid` es el arreglo: las pastillas en otra fila. Como ASERCION, no como
  // guardia — la diferencia importa: si esto fuera guardia, el CSS viejo
  // abortaria («no medí») en vez de fallar («está roto»).
  pide(d.headDisplay === 'grid',
    '`.cl-head` se pintó con display: ' + JSON.stringify(d.headDisplay) + '. En móvil tiene que ' +
    'ser `grid`: es lo que pone las pastillas en su propia fila y le deja el ancho al título.');

  pide(d.tituloAncho >= 200,
    'el título mide ' + d.tituloAncho + 'px de ' + d.tarjetaAncho + ' disponibles. Estrangulado: ' +
    'las pastillas le están quitando el ancho.');

  pide(d.tituloRengls >= 1 && d.tituloRengls <= 2,
    'el título cae en ' + d.tituloRengls + ' renglones. Más de dos para cuatro palabras significa ' +
    'que se está quebrando por carácter — es el defecto de la captura del 7/sep.');

  pide(d.metaRengls >= 1 && d.metaRengls <= 2,
    'la meta (nombre · sucursal · fecha) cae en ' + d.metaRengls + ' renglones: se está apilando ' +
    'uno por línea, que es la misma causa que el título.');

  if (fallos.length) {
    console.error('✗ %d aserción(es) rotas:', fallos.length);
    for (const x of fallos) console.error('   · ' + x);
    process.exit(2);
  }
  console.log('✓ el título ocupa %d de %d px y cae en %d renglón(es); la meta en %d.',
    d.tituloAncho, d.tarjetaAncho, d.tituloRengls, d.metaRengls);
  console.log('');
  console.log('Lo que esto NO prueba: que se vea bonito. Prueba que el título tiene ancho y no');
  console.log('se quiebra por letra. El color, el aire y el orden siguen necesitando ojos.');
})();
