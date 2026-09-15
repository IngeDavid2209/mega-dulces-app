#!/usr/bin/env node
/**
 * 📝 QUIÉN PUEDE ESCRIBIR LA NORMA — medido en un navegador de verdad
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA QUE CONTESTA, y por qué ninguna otra la contesta
 * ═══════════════════════════════════════════════════════════════════════════
 * `tareas-puesto.util.spec.ts` contesta «¿la regla acepta o rechaza este
 * borrador?» — 28 casos, todos verdes. Lo que NO puede contestar es «¿QUIÉN
 * tiene el botón delante?», porque un `*ngIf` no es una función que se pueda
 * llamar.
 *
 * Y ésa es exactamente la clase de fallo que este repo ya pagó tres veces en
 * un día (3/sep): el gate puesto en tres bloques de cuatro, el menú en verde,
 * el build en verde, y una Encargada viendo el tablero de la empresa. Aquí el
 * daño sería peor que ver de más: quien capture una tarea le reparte
 * obligaciones diarias a personas reales.
 *
 * ─── LAS TRES SESIONES, Y POR QUÉ ESAS ───────────────────────────────────
 *   dueño       · escribe la norma (reconocido por CORREO, 13/sep)
 *   adminGlobal · escribe la norma
 *   encargada   · ABRE la pantalla y NO puede escribir  <- la que discrimina
 *
 * La Encargada es la fila que hace válida a las otras dos. Sin un perfil que
 * entre y no pueda escribir, «ve el botón» sería cierto para todos y la
 * aserción no probaría nada: un control sobre una muestra que no discrimina no
 * discrimina (§8.11 c).
 *
 * ─── LO QUE VIGILA DE SÍ MISMO ───────────────────────────────────────────
 * · ABORTA si una sesión no se pudo medir. «No pude leer» y «no hay botón» se
 *   ven idénticos (§8.11 a).
 * · ABORTA si la pantalla no montó (`hoja: 0`): sin la hoja pintada, un
 *   `botones: 0` significaría «no arrancó», no «está gateado».
 * · ABORTA si ningún eje discrimina.
 *
 *   npm run build   (mide lo COMPILADO, no el fuente)
 *   node scripts/prueba-captura-norma.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIST = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');
const RUTA = 'manual-puestos';

// El correo del dueño NO se escribe de memoria: se lee del código que lo
// reconoce, para que este arnés no pueda quedar apuntando a un correo viejo.
const FUENTE_DUENO = path.join(__dirname, '..', 'src', 'app', 'shared', 'permisos.util.ts');

function correoDelDueno() {
  const src = fs.readFileSync(FUENTE_DUENO, 'utf8');
  const m = /['"]([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})['"]/i.exec(src);
  return m ? m[1] : null;
}

const SESIONES = (correo) => ({
  dueno: { uid: 'd', id: 'd', nombre: 'David Dueño', usuario: 'dav', correo,
    rol: 'trabajador', puestoId: 'direccion-general', sucursales: ['Canindo'] },
  adminGlobal: { uid: 'g', id: 'g', nombre: 'Dir Global', usuario: 'dir', correo: 'dir@l.invalid',
    rol: 'admin', alcance: 'global' },
  // ENTRA y NO escribe. Es la fila que hace válidas a las otras dos.
  encargada: { uid: 'e', id: 'e', nombre: 'Encargada', usuario: 'enc', correo: 'e@l.invalid',
    rol: 'trabajador', puestoId: 'encargado-sucursal', puedeVerEstadisticas: true,
    sucursales: ['Canindo'] },
});

// Lo esperado, escrito ANTES de correr.
const ESPERADO = [
  { sesion: 'dueno',       puedeEscribir: true  },
  { sesion: 'adminGlobal', puedeEscribir: true  },
  { sesion: 'encargada',   puedeEscribir: false },
];

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function abortar(motivo) {
  console.error('');
  console.error('[norma] ABORTA: ' + motivo);
  console.error('[norma] No concluyas de esta corrida.');
  process.exit(3);
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

function medir(sesionObj, puerto) {
  return new Promise((resolve) => {
    const iny =
      '<script>try{localStorage.setItem("md_sesion_actual",' +
      JSON.stringify(JSON.stringify(sesionObj)) + ');}catch(e){}</script>' +
      // Sin esto el `fetch` a /api NUNCA SALE: `ApiService.token()` iba siempre
      // a Firebase Auth, que en headless no tiene usuario, y lanzaba «Sin
      // sesión activa» — la pantalla se quedaba sin datos sin un solo error
      // visible (4/sep). Desde el acceso por plaza (13/sep) el JWT propio manda
      // si existe, así que se siembra ESE, que es el camino legítimo del
      // producto: ya no hace falta parchear el bundle.
      '<script>try{localStorage.setItem("md_token","token-de-medicion");}catch(e){}</script>' +
      '<script>window.addEventListener("load",function(){setTimeout(function(){' +
      // Se abre el detalle de un puesto SIN manual: es donde vive el botón.
      // Sin este clic, `botones: 0` sería cierto para todos y no mediría nada.
      'var f=[].slice.call(document.querySelectorAll(".mp-fila-cab,.mp-fila button"));' +
      'for(var i=0;i<f.length;i++){var t=(f[i].textContent||"");' +
      ' if(/vendedor|promotora|surtidor|chofer/i.test(t)){f[i].click();break;}}' +
      'setTimeout(function(){' +
      'document.title="RES "+JSON.stringify({' +
      ' hoja: document.querySelectorAll(".mp-unidad").length,' +
      ' seccionPropias: document.querySelectorAll(".mp-propias").length,' +
      ' botonNueva: document.querySelectorAll(".mp-btn-nueva").length,' +
      ' detalles: document.querySelectorAll(".mp-detalle").length,' +
      ' vacios: document.querySelectorAll(".mp-detalle-vacio").length,' +
      ' url: location.pathname' +
      '});},1500);},3500);});</script>';

    const sano = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const html = sano.replace('<body>', '<body>' + iny);
    if (html === sano) return resolve({ error: 'no pude inyectar la sesión en el index' });

    let pidioApi = false;
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url.indexOf('/api/') === 0) {
        if (url.indexOf('/api/tareas-puesto') === 0) pidioApi = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ items: [], checklists: [], usuarios: [], areas: [] }));
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
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-norma-'));
      // La ruta se arma AQUÍ con la barra puesta por código: en Git Bash, MSYS
      // convierte '/manual-puestos' en 'C:/Program Files/Git/...' y el DOM
      // llega vacío, que se lee como «la app no pinta» (3/sep, 13/sep).
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--user-data-dir=' + perfil, '--virtual-time-budget=20000',
        '--disable-background-networking', '--disable-sync', '--disable-component-update',
        '--disable-features=PushMessaging,OptimizationHints',
        '--dump-dom', 'http://localhost:' + puerto + '/' + RUTA],
        { stdio: ['ignore', 'pipe', 'ignore'] });

      let dom = '';
      h.stdout.on('data', (d) => { dom += d.toString('utf8'); });
      h.on('error', (e) => { srv.close(); resolve({ error: 'no pude lanzar Chrome: ' + e.message }); });
      h.on('close', () => {
        srv.close();
        if (dom.length < 500) return resolve({ error: 'DOM de ' + dom.length + ' bytes' });
        const m = /<title>RES ([\s\S]*?)<\/title>/.exec(dom);
        if (!m) {
          const raiz = /<app-root[^>]*>([\s\S]*?)<\/app-root>/.exec(dom);
          return resolve({ error: 'sin medición · dom=' + dom.length + 'B · app-root=' +
            (raiz ? raiz[1].trim().length : 0) + 'B' });
        }
        try { resolve({ dato: JSON.parse(m[1]), pidioApi }); }
        catch (e) { resolve({ error: 'el título no era JSON: ' + m[1].slice(0, 120) }); }
      });
    });
  });
}

(async () => {
  if (!CHROME) abortar('no encontré Chrome. Sin navegador esto no mide nada.');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    abortar('no hay dist/ en ' + DIST + '. Corre `npm run build` primero.');
  }
  const correo = correoDelDueno();
  if (!correo) abortar('no pude leer el correo del dueño de permisos.util.ts. ' +
    'Sin él, la sesión "dueno" sería un usuario cualquiera y su fila no mediría lo que dice.');
  console.log('[norma] correo del dueño leído del código: ' + correo);

  const sesiones = SESIONES(correo);
  const filas = [];
  let puerto = 5600 + Math.floor(Math.random() * 200);

  for (const e of ESPERADO) {
    const r = await medir(sesiones[e.sesion], puerto++);
    if (r.error) abortar('sesión "' + e.sesion + '": ' + r.error +
      '. Una medición fallida no es un cero: son dos cosas distintas y se ven igual.');
    filas.push({ ...e, d: r.dato, pidioApi: r.pidioApi });
  }

  console.log('');
  console.log('sesión         hoja  detalles  sección-propias  botón-nueva   pidió /api  esperado');
  console.log('─'.repeat(88));
  for (const f of filas) {
    console.log('%s %s %s %s %s %s %s',
      f.sesion.padEnd(14),
      String(f.d.hoja).padStart(4),
      String(f.d.detalles).padStart(9),
      String(f.d.seccionPropias).padStart(16),
      String(f.d.botonNueva).padStart(12),
      String(f.pidioApi).padStart(11),
      f.puedeEscribir ? '  escribe' : '  NO escribe');
  }
  console.log('');

  const fallos = [];
  const ok = (cond, msg) => { if (!cond) fallos.push(msg); };

  // ── Guardias: sin esto, un cero no se puede interpretar ────────────────
  for (const f of filas) {
    ok(f.d.hoja > 0,
      `[${f.sesion}] la hoja NO se pintó (mp-unidad = 0). Un "botón: 0" aquí significaría ` +
      '«la app no arrancó», no «está gateado»: la fila no mide lo que dice.');
    ok(f.pidioApi,
      `[${f.sesion}] la pantalla nunca pidió /api/tareas-puesto: no está leyendo la norma capturada.`);
    ok(f.d.detalles > 0,
      `[${f.sesion}] no se abrió ningún detalle de puesto, así que el botón no pudo ni existir.`);
  }

  // ── Lo que se vino a comprobar ─────────────────────────────────────────
  for (const f of filas) {
    if (f.puedeEscribir) {
      ok(f.d.botonNueva > 0,
        `[${f.sesion}] DEBERÍA poder capturar y no tiene el botón: ` +
        `mp-btn-nueva = ${f.d.botonNueva}.`);
      ok(f.d.seccionPropias > 0,
        `[${f.sesion}] no ve la sección de tareas capturadas.`);
    } else {
      ok(f.d.botonNueva === 0,
        `[${f.sesion}] FUGA: puede capturar la norma sin ser Dirección. ` +
        `mp-btn-nueva = ${f.d.botonNueva}, esperaba 0. Quien capture le reparte ` +
        'obligaciones diarias a personas reales.');
    }
  }

  // ── Discriminación: la muestra tiene que producir las dos respuestas ───
  const conBoton = filas.filter(f => f.d.botonNueva > 0).length;
  ok(conBoton > 0 && conBoton < filas.length,
    `la muestra NO discrimina: ${conBoton} de ${filas.length} sesiones ven el botón. ` +
    'Si todas lo vieran (o ninguna), las aserciones de arriba pasarían por casualidad.');

  if (fallos.length) {
    console.error('FALLOS (' + fallos.length + '):');
    fallos.forEach(f => console.error('  ✗ ' + f));
    process.exit(2);
  }
  console.log('✓ ' + filas.length + ' sesiones: solo Dirección y el dueño pueden capturar la norma.');
  console.log('✓ la muestra discrimina: ' + conBoton + ' de ' + filas.length + ' ven el botón.');
})();
