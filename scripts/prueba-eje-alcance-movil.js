#!/usr/bin/env node
/**
 * 📱 EL RIEL «Mis tareas / Toda la operación» EN UN CELULAR
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA QUE CONTESTA
 * ═══════════════════════════════════════════════════════════════════════════
 * NO «¿se ve bien?». La pregunta es:
 *
 *     ¿LOS DOS BOTONES DEL RIEL CAEN EN EL MISMO RENGLÓN, Y CABE LA BARRA
 *     ENTERA DENTRO DEL ANCHO DE LA PANTALLA?
 *
 * Es la captura de David del 14/sep/2026: en iPhone y en Android «se descuadra».
 * Un control segmentado —dos opciones dentro de UN riel con forma de pastilla—
 * solo comunica «esto es un interruptor de dos» mientras las dos opciones estén
 * lado a lado. Si se parte en dos renglones, el riel redondeado queda con dos
 * filas dentro y deja de leerse como un interruptor: se lee como roto.
 *
 * ─── POR QUÉ NO SE VE DESDE EL CÓDIGO ───────────────────────────────────────
 * Porque el que decide es el REPARTO DE ESPACIO del navegador, y eso solo
 * existe cuando la página se pinta a un ancho concreto. Dos reglas con la misma
 * especificidad —`.cl-toolbar .vista-tabs` y `.vista-tabs.eje-alcance`— se
 * resuelven por ORDEN EN EL ARCHIVO, y el resultado no se lee mirando ninguna
 * de las dos por separado.
 *
 * ─── LO QUE VIGILA DE SÍ MISMO (§8.11) ──────────────────────────────────────
 * · ABORTA si el riel nunca apareció. «0 renglones» porque no se pintó y
 *   porque está roto se ven idénticos, y son cosas opuestas.
 * · ABORTA si el viewport de dentro no es el declarado: «cabe en 390» medido
 *   contra otro ancho es un número sin su denominador.
 * · ABORTA si las media queries de móvil no se aplicaron. El testigo es
 *   `--tap-min` (44px en táctil, 0px en escritorio), que vive en `styles.css`
 *   y NO lo toca este arreglo — a diferencia de cualquier propiedad del riel,
 *   que es justo lo que se está cambiando (§8.11 b: la guardia no va sobre un
 *   proxy del arreglo).
 * · ABORTA si la app nunca pidió `/api/*`.
 *
 *   npm run build   (mide lo COMPILADO)
 *   node scripts/prueba-eje-alcance-movil.js [salida.png]
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIST = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');

/** Ver la cabecera de `prueba-tarjeta-movil.js`: Chrome topa la ventana en
 *  504px, así que el celular se emula con un iframe y no con --window-size. */
/**
 * El ancho y la cantidad se pueden pedir por variable de entorno, y eso NO es
 * comodidad: la primera corrida midio 390px con 6 tareas y paso en verde. La
 * captura de David dice 286 -tres digitos en la pastilla del contador- y su
 * telefono puede ser de 375. Un caso facil que pasa no dice nada del dificil.
 *
 *   ANCHO=375 N=286 node scripts/prueba-eje-alcance-movil.js
 */
const MARCO = { ancho: Number(process.env.ANCHO || 390), alto: 900, tolerancia: 4 };
// La ventana tiene que caber el marco: con 760 fijos, pedir 1024 medía otra
// cosa. Hace falta poder correr un ancho de ESCRITORIO como control —«esto no
// cambió un píxel arriba de 640»— y sin eso ese control no existía.
const VENTANA = { w: Math.max(760, MARCO.ancho + 140), h: 1000 };

/**
 * ADMIN a propósito: el riel solo existe si `puedeFiltrarVista` es cierto
 * (`checklist.ts:303` → admin o supervisor). Con una trabajadora esta pantalla
 * no tiene riel y la prueba pasaría sin medir el caso.
 */
const SESION = {
  uid: 'a', id: 'a', nombre: 'David Cisneros', usuario: 'david',
  correo: 'davidcisneros2209@outlook.es', rol: 'admin',
};

function hoyLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

/** Basta con que la pantalla tenga trabajo: el riel se pinta igual, pero una
 *  pantalla vacía no ejerce el ancho real de la barra. */
const CUANTOS = Number(process.env.N || 286);
const CHECKLISTS = Array.from({ length: CUANTOS }, (_, i) => ({
  id: 'c' + i, timestampCreacion: Date.now(),
  name: 'Apertura y acomodo del pasillo ' + (i + 1),
  assigned: 'Persona ' + i, assignedUid: 'p' + i,
  store: 'Padre Hidalgo', date: hoyLocal(), time: '11:59 PM',
  status: 'pendiente', enviado: false,
  createdBy: 'Manual Corporativo', created_by: 'Manual Corporativo',
  _origenManual: true, _formatoCodigo: '3.1 - 3.13',
  _manualDocumento: 'Manual Corporativo de Operación', _manualVersion: '2026',
  _puestoId: 'anaquelista', tareaManualId: 'pasillo-turno',
  items: [{ id: 'i', text: 'Punto de control', checked: false }],
}));

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function abortar(motivo) {
  console.error('');
  console.error('[riel] ABORTA: ' + motivo);
  console.error('[riel] No concluyas de esta corrida.');
  process.exit(3);
}

const CAPTURA = process.argv[2] || null;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

function guionDeMedicion() {
  // Va como cadena para inyectarla en la página marco. Se arma con un arreglo
  // de líneas —y no concatenando con `+` al vuelo— porque una línea que termine
  // sin operador se parte en dos sentencias VÁLIDAS por inserción automática de
  // punto y coma: el guion queda truncado, la página no mide, y eso se lee como
  // «la app no pintó» (lección del 4/sep).
  return [
    'try { localStorage.setItem("md_sesion_actual", ' + JSON.stringify(JSON.stringify(SESION)) + '); } catch (e) {}',
    'try { localStorage.setItem("md_token", "token-de-medicion"); } catch (e) {}',
    'var res = {};',
    'var f = document.createElement("iframe");',
    'f.width = ' + MARCO.ancho + '; f.height = ' + MARCO.alto + '; f.src = "/tareas-manual";',
    'document.body.appendChild(f);',
    'var t0 = Date.now();',
    'function fin() { document.title = "RES " + JSON.stringify(res); }',
    'function dentro() { try { return f.contentDocument; } catch (e) { return null; } }',
    'function espera(sel, cb, ms) { var g = function () {',
    '  var d = dentro();',
    '  if (d && d.querySelector(sel)) return cb(true);',
    '  if (Date.now() - t0 > ms) return cb(false);',
    '  setTimeout(g, 150); }; g(); }',
    'function caja(e) { if (!e) return null; var r = e.getBoundingClientRect();',
    '  return { x: Math.round(r.left), y: Math.round(r.top),',
    '           w: Math.round(r.width), h: Math.round(r.height) }; }',
    // RENGLONES = cuántos valores distintos de `top` tienen los hijos. Es lo que
    // de verdad se pregunta: «¿se partió el riel?». Contar hijos no discrimina
    // (siempre son dos) y mirar la altura tampoco, porque un botón más alto y
    // dos filas apretadas dan alturas parecidas.
    'function renglonesDe(cont) { if (!cont) return -1;',
    '  var ys = []; var hijos = cont.children;',
    '  for (var i = 0; i < hijos.length; i++) {',
    '    var rc = hijos[i].getBoundingClientRect();',
    '    if (!rc.width && !rc.height) continue;',
    '    var y = Math.round(rc.top);',
    '    var visto = false;',
    '    for (var k = 0; k < ys.length; k++) { if (Math.abs(ys[k] - y) <= 3) { visto = true; break; } }',
    '    if (!visto) ys.push(y); }',
    '  return ys.length; }',
    'espera(".vista-tabs.eje-alcance", function (hay) {',
    '  var w = f.contentWindow, d = dentro();',
    '  res.marco = w ? (w.innerWidth + "x" + w.innerHeight) : "sin acceso";',
    '  res.tapMin = w ? w.getComputedStyle(d.documentElement).getPropertyValue("--tap-min").trim() : "?";',
    '  if (!hay) { res.error = "nunca aparecio el riel .vista-tabs.eje-alcance";',
    '    res.enPantalla = d ? (d.body.innerText || "").replace(/\\s+/g, " ").slice(0, 200) : "(sin documento)";',
    '    return fin(); }',
    '  var riel = d.querySelector(".vista-tabs.eje-alcance");',
    '  var vista = d.querySelector(".vista-tabs.eje-vista");',
    '  var barra = d.querySelector(".cl-toolbar");',
    '  var izq = d.querySelector(".cl-toolbar-izq");',
    '  var sep = d.querySelector(".cl-toolbar-sep");',
    '  var cs = w.getComputedStyle(riel);',
    '  res.riel = caja(riel);',
    '  res.rielRenglones = renglonesDe(riel);',
    '  res.rielWrap = cs.flexWrap;',
    '  res.rielGap = cs.columnGap;',
    '  res.barra = caja(barra);',
    '  res.izq = caja(izq);',
    '  res.izqRenglones = renglonesDe(izq);',
    '  res.vista = caja(vista);',
    '  res.sepDisplay = sep ? w.getComputedStyle(sep).display : "(no existe)";',
    // Desbordamiento: lo que de verdad «se sale de la pantalla».
    '  res.docScroll = d.documentElement.scrollWidth;',
    '  res.docAncho = w.innerWidth;',
    '  res.barraScroll = barra ? barra.scrollWidth : -1;',
    '  res.barraCliente = barra ? barra.clientWidth : -1;',
    '  var bs = [].slice.call(riel.children);',
    '  res.botones = bs.map(function (b) { var c = caja(b);',
    '    return { t: (b.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 24),',
    '             w: c.w, h: c.h, y: c.y,',
    '             fs: w.getComputedStyle(b).fontSize }; });',
    // ─── EL ARBOL, que es donde la captura se descuadra de verdad ─────────
    // Una fila cuyo contenido pide mas ancho del que tiene queda CORTADA, no
    // desplazada: `.org-card` lleva `overflow: hidden`, asi que el documento
    // NO crece y el diagnostico del 13/sep decia «no se desborda» con razon.
    // Por eso se mide fila por fila y no con el scroll del documento.
    '  var filas = [].slice.call(d.querySelectorAll(".org-puesto"));',
    '  res.filas = filas.length;',
    '  res.filaDerMax = 0;',
    '  for (var i3 = 0; i3 < filas.length; i3++) {',
    '    var rr = Math.round(filas[i3].getBoundingClientRect().right);',
    '    if (rr > res.filaDerMax) res.filaDerMax = rr; }',
    '  res.filasFuera = filas.filter(function (x) {',
    '    return x.getBoundingClientRect().right > w.innerWidth + 1; }).length;',
    '  res.nombreMasAngosto = -1;',
    '  for (var i2 = 0; i2 < filas.length; i2++) {',
    '    var nm = filas[i2].querySelector(".org-puesto-nombre"); if (!nm) continue;',
    '    var an = Math.round(nm.getBoundingClientRect().width);',
    '    if (res.nombreMasAngosto < 0 || an < res.nombreMasAngosto) res.nombreMasAngosto = an; }',
    // Los dos ejes derechos: el encabezado de columnas vive en la barra y las
    // cifras en la lista. Si sus contenedores no llevan el MISMO padding, los
    // rotulos dejan de caer sobre su columna — el defecto de 4px del 4/sep,
    // que en movil es de 6 porque `.org-barra` baja a 12 y `.org-menu` no.
    '  var cabDatos = d.querySelector(".org-cab .org-puesto-datos");',
    '  var filaDatos = d.querySelector(".org-puesto .org-puesto-datos");',
    '  res.ejeCab = cabDatos ? Math.round(cabDatos.getBoundingClientRect().right) : -1;',
    '  res.ejeFila = filaDatos ? Math.round(filaDatos.getBoundingClientRect().right) : -1;',
    '  res.anchoDatos = filaDatos ? Math.round(filaDatos.getBoundingClientRect().width) : -1;',
    // Cuantas columnas de la rejilla se están pintando. Es el eje del CONTROL
    // DE ESCRITORIO: en un teléfono son 3 y arriba de 640 tienen que seguir
    // siendo 5. Se cuentan las ranuras VISIBLES, no las del HTML —que siempre
    // son cinco— porque lo que cambia es el `display`.
    '  res.columnas = filaDatos ? [].slice.call(filaDatos.children).filter(function (x) {',
    '    return w.getComputedStyle(x).display !== "none"; }).length : -1;',
    // Los paddings de los cuatro implicados. La ASERCION de arriba culpa al
    // padding horizontal; sin estas cifras esa culpa es una teoria, no un dato.
    '  function padDer(sel) { var e = d.querySelector(sel);',
    '    return e ? w.getComputedStyle(e).paddingRight : "(no existe)"; }',
    '  res.pads = { menu: padDer(".org-menu"), barra: padDer(".org-barra"),',
    '               cab: padDer(".org-barra .org-cab"), fila: padDer(".org-puesto") };',
    // Las acciones de la barra: en la captura «Solo con manual» sale cortado.
    '  var acc = d.querySelector(".org-acciones");',
    '  var barraOrg = d.querySelector(".org-barra");',
    '  res.accionesDer = acc ? Math.round(acc.getBoundingClientRect().right) : -1;',
    '  res.barraOrgDer = barraOrg ? Math.round(barraOrg.getBoundingClientRect().right) : -1;',
    '  fin();',
    '}, 20000);',
  ].join('\n');
}

function medir(puerto) {
  return new Promise((resolve) => {
    const marco = '<!doctype html><html><head><meta charset="utf-8"><title>inicial</title>'
      + '<style>body{margin:0;background:#333}iframe{border:0;display:block}</style></head><body>'
      + '<script>' + guionDeMedicion() + '</' + 'script></body></html>';

    const cuerpo = JSON.stringify({ checklists: CHECKLISTS, usuarios: [], areas: [] });
    let apiPedidos = 0;
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      // El marco va PRIMERO: cualquier ruta sin extensión cae en el index de
      // Angular, así que sin este corte la página de medición no se serviría.
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
        return res.end(fs.readFileSync(path.join(DIST, 'index.html'), 'utf8'));
      }
      const f = path.join(DIST, url);
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.on('error', (e) => resolve({ error: 'el servidor local no levanto: ' + e.message }));
    srv.listen(puerto, () => {
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-riel-'));
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--user-data-dir=' + perfil, '--virtual-time-budget=40000',
        '--window-size=' + VENTANA.w + ',' + VENTANA.h,
        '--disable-background-networking', '--disable-sync', '--disable-component-update',
        '--disable-features=PushMessaging,OptimizationHints',
        ...(CAPTURA ? ['--screenshot=' + CAPTURA, '--hide-scrollbars'] : ['--dump-dom']),
        // La barra se pone POR CÓDIGO: MSYS convierte '/__marco' en
        // 'C:/Program Files/Git/__marco'. Cuarta vez en el proyecto.
        'http://localhost:' + puerto + '/' + '__marco'],
        { stdio: ['ignore', 'pipe', 'ignore'] });
      let dom = '';
      h.stdout.on('data', (d) => { dom += d.toString('utf8'); });
      h.on('error', (e) => { srv.close(); resolve({ error: 'no pude lanzar Chrome: ' + e.message }); });
      h.on('close', () => {
        srv.close();
        if (CAPTURA) return resolve({ captura: fs.existsSync(CAPTURA) ? fs.statSync(CAPTURA).size : 0 });
        if (dom.length < 300) return resolve({ error: 'DOM de ' + dom.length + ' bytes' });
        const m = /<title>RES ([\s\S]*?)<\/title>/.exec(dom);
        if (!m) {
          const t = /<title>([\s\S]*?)<\/title>/.exec(dom);
          return resolve({ error: 'sin medicion . title=' + (t ? JSON.stringify(t[1]) : 'ninguno')
            + ' . dom=' + dom.length + 'B' });
        }
        try { resolve({ dato: JSON.parse(m[1]), apiPedidos }); }
        catch (e) { resolve({ error: 'el titulo no era JSON: ' + m[1].slice(0, 140) }); }
      });
    });
  });
}

(async () => {
  if (!CHROME) abortar('no encontré Chrome. Sin navegador esto no mide nada.');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    abortar('no hay dist/. Corre `npm run build`: esto mide lo COMPILADO.');
  }
  console.log('');
  console.log('[riel] entrada: %d checklists sintéticos · marco de %dpx · sesión admin',
    CHECKLISTS.length, MARCO.ancho);

  const r = await medir(5700 + Math.floor(Math.random() * 200));
  if (r.captura !== undefined) {
    if (!r.captura) abortar('la captura salió vacía: ' + CAPTURA);
    console.log('[riel] captura escrita: %s (%d bytes)', CAPTURA, r.captura);
    return;
  }
  if (r.error) abortar(r.error + '. Una medición fallida no es un cero.');
  const d = r.dato;
  if (d.error) abortar(d.error + ' · en pantalla decía: ' + JSON.stringify(d.enPantalla || ''));
  if (!r.apiPedidos) abortar('la app nunca pidió /api/*: la pantalla se midió vacía.');

  const anchoReal = Number(String(d.marco).split('x')[0] || 0);
  if (!anchoReal || Math.abs(anchoReal - MARCO.ancho) > MARCO.tolerancia) {
    abortar('el viewport DENTRO del marco es ' + d.marco + ' y se iba a concluir sobre '
      + MARCO.ancho + 'px.');
  }
  // ─── CONTROL DE ESCRITORIO ────────────────────────────────────────────────
  // `ESCRITORIO=1` invierte la pregunta: ya no «¿cabe en el teléfono?» sino
  // «¿SIGUE INTACTO arriba de 640?». Sin esto, un arreglo que arrasara con la
  // pantalla grande pasaría las cuatro corridas de móvil en verde.
  if (process.env.ESCRITORIO) {
    if (d.tapMin !== '0px') {
      abortar('`--tap-min` vale ' + JSON.stringify(d.tapMin) + ' y en escritorio son 0px: '
        + 'esto no midió la pantalla grande.');
    }
    console.log('[riel] CONTROL DE ESCRITORIO a %s · --tap-min %s', d.marco, d.tapMin);
    console.log('  rejilla de cifras %dpx · %d columnas visibles · ejes %d / %d',
      d.anchoDatos, d.columnas, d.ejeCab, d.ejeFila);
    const malos = [];
    if (d.columnas !== 5) {
      malos.push('la rejilla pinta ' + d.columnas + ' columnas y en escritorio son CINCO '
        + '(rama·manual·avance·propio·venc.): el arreglo de móvil se derramó hacia arriba.');
    }
    if (Math.abs(d.anchoDatos - 262) > 2) {
      malos.push('la rejilla mide ' + d.anchoDatos + 'px y en escritorio son 262.');
    }
    if (Math.abs(d.ejeCab - d.ejeFila) > 1) {
      malos.push('los ejes derechos se separan ' + Math.abs(d.ejeCab - d.ejeFila) + 'px.');
    }
    if (malos.length) {
      console.error('✗ el control de escritorio falla:');
      for (const x of malos) console.error('   · ' + x);
      process.exit(2);
    }
    console.log('✓ escritorio intacto: 5 columnas, 262px, ejes alineados.');
    return;
  }

  // GUARDIA DE «ES MÓVIL», sobre algo que este arreglo NO toca.
  if (d.tapMin !== '44px') {
    abortar('`--tap-min` vale ' + JSON.stringify(d.tapMin) + ' y en táctil son 44px: las media '
      + 'queries de móvil no se aplicaron, así que esto midió la pantalla de escritorio.');
  }

  // SIN `%4d`: util.format no soporta el padding de printf y ADEMÁS desplaza
  // los argumentos. Ya pasó dos veces en este repo.
  const px = (n) => String(n).padStart(4) + ' px';
  console.log('[riel] viewport DENTRO del marco %s · --tap-min %s · %d petición(es) a /api',
    d.marco, d.tapMin, r.apiPedidos);
  console.log('');
  console.log('  barra (.cl-toolbar)       %s · scroll %d / cliente %d',
    px(d.barra ? d.barra.w : -1), d.barraScroll, d.barraCliente);
  console.log('  grupo izquierdo           %s · %d renglón(es)', px(d.izq ? d.izq.w : -1), d.izqRenglones);
  console.log('  riel Pendientes/Enviadas  %s', px(d.vista ? d.vista.w : -1));
  console.log('  RIEL Mis/Toda             %s · alto %d · %d RENGLÓN(ES) · wrap:%s gap:%s',
    px(d.riel.w), d.riel.h, d.rielRenglones, d.rielWrap, d.rielGap);
  for (const b of d.botones) {
    console.log('     · %s %s · alto %d · y=%d · %s',
      String(b.t).padEnd(22), px(b.w), b.h, b.y, b.fs);
  }
  console.log('  documento                 scroll %d / ventana %d', d.docScroll, d.docAncho);
  console.log('');
  console.log('  ÁRBOL · filas                 %d  ·  que se salen de la pantalla %d',
    d.filas, d.filasFuera);
  console.log('  ÁRBOL · borde derecho máximo  x=%d  (la pantalla acaba en %d)',
    d.filaDerMax, d.docAncho);
  console.log('  ÁRBOL · nombre más angosto    %s', px(d.nombreMasAngosto));
  console.log('  ÁRBOL · rejilla de cifras     %s · %d columnas visibles',
    px(d.anchoDatos), d.columnas);
  console.log('  ÁRBOL · eje derecho  cabecera %d  ·  fila %d  (deben coincidir)',
    d.ejeCab, d.ejeFila);
  console.log('  ÁRBOL · acciones hasta x=%d  ·  la barra acaba en x=%d',
    d.accionesDer, d.barraOrgDer);
  console.log('  ÁRBOL · padding derecho  menu %s · barra %s · cabecera %s · fila %s',
    d.pads.menu, d.pads.barra, d.pads.cab, d.pads.fila);
  console.log('');

  const fallos = [];
  const pide = (ok, msg) => { if (!ok) fallos.push(msg); };

  pide(d.botones.length === 2,
    'el riel tiene ' + d.botones.length + ' botón(es) y son dos: «Mis tareas» y «Toda la '
    + 'operación». Con otro número esta prueba no está midiendo el control de la captura.');

  // LA ASERCIÓN DEL DÍA.
  pide(d.rielRenglones === 1,
    'el riel se parte en ' + d.rielRenglones + ' renglones. Un control segmentado con dos filas '
    + 'dentro de una pastilla redondeada es exactamente el «se descuadra» de la captura: deja de '
    + 'leerse como un interruptor de dos.');

  pide(d.docScroll <= d.docAncho + 2,
    'el documento mide ' + d.docScroll + 'px de scroll contra ' + d.docAncho + 'px de ventana: '
    + 'la pantalla se desborda a lo ancho y hay que arrastrar de lado para ver los botones.');

  pide(d.barraScroll <= d.barraCliente + 2,
    'la barra de controles pide ' + d.barraScroll + 'px y tiene ' + d.barraCliente + ': sus '
    + 'controles se salen del ancho disponible.');

  // Los dos segmentos tienen que poder pulsarse con el dedo.
  const bajo = d.botones.filter((b) => b.h < 40);
  pide(!bajo.length,
    bajo.length + ' de los ' + d.botones.length + ' segmentos miden menos de 40px de alto ('
    + bajo.map((b) => b.t + '=' + b.h).join(', ') + '). En táctil el mínimo es 44 (--tap-min).');

  // Y que ninguno quede tan angosto que su texto no quepa: dos segmentos de un
  // interruptor que miden muy distinto se leen como si uno estuviera cortado.
  const anchos = d.botones.map((b) => b.w);
  const menor = Math.min.apply(null, anchos);
  pide(menor >= 90,
    'el segmento más angosto mide ' + menor + 'px. A ese ancho «Toda la operación» no cabe y se '
    + 'parte por palabras dentro del riel.');

  // ───────────────── EL ÁRBOL ─────────────────
  // Sin filas no hay nada que concluir: un «0 cortadas» sobre 0 filas es el
  // cero sin denominador de siempre.
  if (!d.filas) {
    abortar('el árbol no pintó ni una fila `.org-puesto`. Un «0 filas cortadas» sobre 0 filas '
      + 'no es un resultado.');
  }

  pide(d.filasFuera === 0,
    d.filasFuera + ' de ' + d.filas + ' filas del árbol se salen de la pantalla (la más lejana '
    + 'llega a x=' + d.filaDerMax + ' y la pantalla acaba en ' + d.docAncho + '). `.org-card` '
    + 'lleva overflow:hidden, así que eso no se desplaza: DESAPARECE. Es el «se descuadra».');

  pide(d.nombreMasAngosto >= 90,
    'el nombre de puesto más angosto mide ' + d.nombreMasAngosto + 'px. La rejilla de cifras es '
    + '`flex: 0 0 auto` y no cede: le está quitando el ancho al nombre, igual que las pastillas '
    + 'al título de la tarjeta el 7/sep.');

  pide(Math.abs(d.ejeCab - d.ejeFila) <= 1,
    'el eje derecho del encabezado (' + d.ejeCab + ') y el de las filas (' + d.ejeFila + ') se '
    + 'separan ' + Math.abs(d.ejeCab - d.ejeFila) + 'px: los rótulos RAMA/MANUAL/AVANCE dejan de '
    + 'caer sobre su columna. Paddings derechos medidos → lista ' + d.pads.menu + ', barra '
    + d.pads.barra + ', cabecera ' + d.pads.cab + ', fila ' + d.pads.fila + '.');

  pide(d.accionesDer <= d.barraOrgDer + 1,
    'las acciones de la barra llegan hasta x=' + d.accionesDer + ' y la barra acaba en x='
    + d.barraOrgDer + ': «Solo con manual» se sale y queda cortado.');

  if (fallos.length) {
    console.error('✗ %d aserción(es) rotas:', fallos.length);
    for (const x of fallos) console.error('   · ' + x);
    process.exit(2);
  }
  console.log('✓ el riel cae en 1 renglón (%dpx), los segmentos miden %s, y las %d filas del',
    d.riel.h, anchos.join(' y ') + 'px', d.filas);
  console.log('  árbol caben dentro de la pantalla (borde máximo x=%d de %d, ejes en %d).',
    d.filaDerMax, d.docAncho, d.ejeFila);
  console.log('');
  console.log('Lo que esto NO prueba: que se vea bonito, ni el comportamiento con un dedo real.');
  console.log('Prueba que el interruptor no se parte y que nada se sale del ancho.');
})();
