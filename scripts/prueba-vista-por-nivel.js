#!/usr/bin/env node
/**
 * 👁️ QUÉ VE CADA NIVEL, MEDIDO EN UN NAVEGADOR DE VERDAD
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA QUE CONTESTA, y por qué ninguna otra prueba la contestaba
 * ═══════════════════════════════════════════════════════════════════════════
 * Las pruebas unitarias contestan «¿la función dice que sí o que no?».
 * `prueba-menu-audiencias.js` contesta «¿quién ve cada entrada del menú?».
 * Ninguna de las dos contesta **«¿qué hay en la pantalla?»** — y ahí vivió un
 * día entero una fuga real:
 *
 *   El tablero tenía el gate `verEmpresa` puesto en TRES de sus cuatro bloques
 *   de nivel empresa. Al cuarto le faltaba. Resultado: una Encargada entraba y
 *   veía las DIEZ unidades de control de la empresa, con la cabecera rotulada
 *   «Dirección · Canindo». `ng test` en verde, el build en verde, el menú en
 *   verde. El defecto solo existe en el DOM.
 *
 * Un gate de plantilla no lo puede ver una prueba unitaria: `*ngIf` no es una
 * función que se pueda llamar. Hace falta pintar la página.
 *
 * ─── CÓMO ────────────────────────────────────────────────────────────────────
 * Sirve el `dist/` desde un servidor local, inyecta una sesión sintética en
 * `localStorage` antes de que arranque Angular, deja pintar, y cuenta nodos.
 * No necesita base de datos ni credenciales: `/api/*` devuelve listas vacías,
 * así que lo que se mide es EL GATE, no el dato.
 *
 * ─── LO QUE VIGILA DE SÍ MISMO ──────────────────────────────────────────────
 * · ABORTA si alguna sesión no pudo medirse. «No pude leer» y «no hay nada» se
 *   ven idénticos, y aquí un `unidades: 0` significaría «está gateado» cuando
 *   en realidad sería «la app no arrancó» (§8.11 a).
 * · ABORTA si ningún eje DISCRIMINA. Si las cuatro sesiones vieran lo mismo,
 *   todas las aserciones de abajo podrían pasar por casualidad — un control
 *   sobre una muestra que no discrimina no discrimina (§8.11 c).
 * · Mide la cifra de empresa DENTRO de un bloque abierto (`silencioVisible`),
 *   no solo bloques enteros. Sin eso el gate por cifra `esEmpresa` no lo
 *   ejerce ninguna medición: es la cubeta que se queda sin tocar.
 *
 *   npm run build   (hace falta un dist/ fresco: esto mide lo COMPILADO)
 *   node scripts/prueba-vista-por-nivel.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIST = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');

// ── LAS SESIONES ──────────────────────────────────────────────────────────
// Cuatro niveles reales, no cuatro variantes del mismo. Los dos de en medio
// existen porque son los que producen la respuesta interesante: ENTRAN al
// tablero (son jefatura) y NO deben ver el nivel empresa.
const SESIONES = {
  global: { uid: 'g', id: 'g', nombre: 'Dir Global', usuario: 'dir', correo: 'd@l.invalid',
    rol: 'admin', alcance: 'global' },
  limitado: { uid: 'l', id: 'l', nombre: 'Adm Sucursal', usuario: 'adm', correo: 'a@l.invalid',
    rol: 'admin', alcance: 'sucursales', sucursales: ['8 Esquinas'] },
  encargada: { uid: 'e', id: 'e', nombre: 'Encargada', usuario: 'enc', correo: 'e@l.invalid',
    rol: 'trabajador', puestoId: 'encargado-sucursal', puedeVerEstadisticas: true, sucursales: ['Canindo'] },
  // El caso que David cazó en pantalla: lo más bajo de la jerarquía mirando el
  // tablero de la empresa y el organigrama completo.
  anaquelista: { uid: 'a', id: 'a', nombre: 'Carolina Anaquelista', usuario: 'ana', correo: 'an@l.invalid',
    rol: 'trabajador', puestoId: 'anaquelista', sucursales: ['Padre Hidalgo'] },
};

// ── LO ESPERADO, escrito antes de correr ──────────────────────────────────
// `null` = no se asevera (no toda medición aplica a toda ruta).
const ESPERADO = [
  { ruta: 'home', sesion: 'global',      tablero: 1, unidades: 10, silencioVisible: 1, hueco: 0, prefijo: 'Dirección' },
  { ruta: 'home', sesion: 'limitado',    tablero: 1, unidades: 0,  silencioVisible: 0, hueco: 1, prefijo: 'Mi alcance' },
  { ruta: 'home', sesion: 'encargada',   tablero: 1, unidades: 0,  silencioVisible: 0, hueco: 1, prefijo: 'Mi alcance' },
  // No solo "no ve el tablero": el guard lo MANDA a su trabajo. Una pantalla
  // vacía y una redirección se ven distinto para quien la usa.
  { ruta: 'home', sesion: 'anaquelista', tablero: 0, unidades: 0,  silencioVisible: 0, hueco: 0, url: '/tareas-manual' },

  { ruta: 'tareas-manual', sesion: 'global',      arbol: 1 },
  { ruta: 'tareas-manual', sesion: 'encargada',   arbol: 1 },
  // El árbol es el organigrama de la empresa entera. Un anaquelista ve SUS
  // tareas, no la estructura.
  { ruta: 'tareas-manual', sesion: 'anaquelista', arbol: 0 },
];

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function abortar(motivo) {
  console.error('');
  console.error('[vista] ABORTA: ' + motivo);
  console.error('[vista] No concluyas de esta corrida.');
  process.exit(3);
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

// ══════════════════════════════════════════════════════════════════════════
//  UNA MEDICIÓN
// ══════════════════════════════════════════════════════════════════════════
function medir(sesion, ruta, puerto) {
  return new Promise((resolve) => {
    const iny =
      '<script>try{localStorage.setItem("md_sesion_actual",' +
      JSON.stringify(JSON.stringify(SESIONES[sesion])) + ');}catch(e){}</script>' +
      '<script>window.addEventListener("load",function(){setTimeout(function(){' +
      'document.title="RES "+JSON.stringify({' +
      ' tablero: document.querySelectorAll("app-tablero-direccion").length,' +
      ' arbol: document.querySelectorAll("app-vista-organigrama").length,' +
      ' filasArbol: document.querySelectorAll(".org-lista .org-puesto").length,' +
      ' url: location.pathname,' +
      ' bloques: document.querySelectorAll(".td-bloque").length,' +
      ' unidades: document.querySelectorAll(".td-unidad").length,' +
      ' hueco: document.querySelectorAll(".td-bloque-hueco").length,' +
      // La cifra de empresa DENTRO de un bloque abierto: ejerce `esEmpresa`.
      ' silencioVisible: [...document.querySelectorAll(".td-cifra")]' +
      '   .filter(function(e){return !e.hidden && /silencio/.test(e.textContent);}).length,' +
      ' alcance: (document.querySelector(".td-alcance")||{}).textContent || null' +
      '});},4000);});</script>';

    const sano = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const html = sano.replace('<body>', '<body>' + iny);
    if (html === sano) return resolve({ error: 'no pude inyectar la sesión en el index' });

    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url.indexOf('/api/') === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ checklists: [], usuarios: [], areas: [] }));
      }
      // Sin extensión = navegación de Angular: siempre el index.
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
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-vista-'));
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--user-data-dir=' + perfil, '--virtual-time-budget=20000', '--disable-background-networking',
        '--disable-sync', '--disable-component-update',
        '--disable-features=PushMessaging,OptimizationHints',
        // La ruta se arma AQUÍ, con la barra puesta por código. Nunca se pasa
        // con barra inicial por variable de entorno o argumento: en Git Bash,
        // MSYS convierte '/tareas-manual' en 'C:/Program Files/Git/...', la URL
        // sale malformada, Chrome abre la pestaña nueva y el DOM llega vacío —
        // que se lee como «la app no pinta». Costó una tarde el 3/sep.
        '--dump-dom', 'http://localhost:' + puerto + '/' + ruta],
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
          const raiz = /<app-root[^>]*>([\s\S]*?)<\/app-root>/.exec(dom);
          return resolve({ error: 'sin medición · title=' + (t ? JSON.stringify(t[1]) : 'ninguno') +
            ' · dom=' + dom.length + 'B · app-root=' + (raiz ? raiz[1].trim().length : 0) + 'B' });
        }
        try { resolve({ dato: JSON.parse(m[1]) }); }
        catch (e) { resolve({ error: 'el título no era JSON: ' + m[1].slice(0, 120) }); }
      });
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  LA CORRIDA
// ══════════════════════════════════════════════════════════════════════════
(async () => {
  if (!CHROME) abortar('no encontré Chrome. Sin navegador esto no mide nada.');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    abortar('no hay dist/ en ' + DIST + '. Corre `npm run build` primero: esto mide lo COMPILADO, ' +
      'no el código fuente.');
  }

  const EJES = ['tablero', 'arbol', 'unidades', 'silencioVisible', 'hueco'];
  const filas = [];
  let puerto = 5300 + Math.floor(Math.random() * 200);

  for (const e of ESPERADO) {
    const r = await medir(e.sesion, e.ruta, puerto++);
    if (r.error) abortar('sesión "' + e.sesion + '" en /' + e.ruta + ': ' + r.error +
      '. Una medición fallida no es un cero: son dos cosas distintas y se ven igual.');
    filas.push({ ...e, d: r.dato });
  }

  // ── la tabla ────────────────────────────────────────────────────────────
  console.log('');
  console.log('ruta            sesión        tablero  árbol  unidades  cifra-empresa  hueco  aterriza en');
  console.log('─'.repeat(100));
  for (const f of filas) {
    console.log('%s %s %s %s %s %s %s %s',
      ('/' + f.ruta).padEnd(15), f.sesion.padEnd(13),
      String(f.d.tablero).padEnd(8), String(f.d.arbol).padEnd(6),
      String(f.d.unidades).padEnd(9), String(f.d.silencioVisible).padEnd(14),
      String(f.d.hueco).padEnd(6), f.d.url);
    if (f.d.alcance) console.log('%s etiqueta: %s', ' '.repeat(29), JSON.stringify(f.d.alcance));
  }
  console.log('─'.repeat(100));

  // ── GUARDIA DE DISCRIMINACIÓN, antes de leer un solo verde ──────────────
  const sinDiscriminar = EJES.filter((k) => new Set(filas.map((f) => f.d[k])).size < 2);
  if (sinDiscriminar.length === EJES.length) {
    abortar('NINGUNO de los ' + EJES.length + ' ejes discrimina: las ' + filas.length +
      ' sesiones ven lo mismo. Las aserciones de abajo pasarían por casualidad.');
  }
  console.log('ejes que discriminan: %d de %d%s', EJES.length - sinDiscriminar.length, EJES.length,
    sinDiscriminar.length ? ' · sin discriminar: ' + sinDiscriminar.join(', ') : '');

  // ── las aserciones ──────────────────────────────────────────────────────
  const fallos = [];
  for (const f of filas) {
    for (const k of ['tablero', 'arbol', 'unidades', 'silencioVisible', 'hueco', 'url']) {
      if (f[k] === undefined) continue;
      if (f.d[k] !== f[k]) {
        fallos.push('/' + f.ruta + ' · ' + f.sesion + ' · ' + k + ': esperaba ' +
          JSON.stringify(f[k]) + ', medí ' + JSON.stringify(f.d[k]));
      }
    }
    if (f.prefijo) {
      const etq = String(f.d.alcance || '');
      if (etq.indexOf(f.prefijo) !== 0) {
        fallos.push('/' + f.ruta + ' · ' + f.sesion + ' · etiqueta: esperaba que empezara con "' +
          f.prefijo + '", decía ' + JSON.stringify(etq));
      }
      // El defecto literal que se corrigió el 3/sep: «Dirección · Canindo» a
      // una Encargada. La etiqueta nunca afirma más de lo que la persona ve.
      if (f.prefijo !== 'Dirección' && etq.indexOf('Dirección') >= 0) {
        fallos.push('/' + f.ruta + ' · ' + f.sesion + ' · la etiqueta dice "Dirección" a quien no lo es: ' +
          JSON.stringify(etq));
      }
    }
  }

  console.log('');
  if (fallos.length) {
    console.error('✗ %d aserción(es) rotas:', fallos.length);
    for (const x of fallos) console.error('   · ' + x);
    process.exit(2);
  }
  console.log('✓ las %d combinaciones (ruta × nivel) coinciden con lo esperado.', filas.length);
  console.log('');
  console.log('Lo que esto NO prueba: que el CONTENIDO de cada bloque sea correcto. Prueba quién');
  console.log('ve qué bloque. El dato de dentro lo cubren `indicador.util.spec.ts` y el filtro de');
  console.log('alcance de `home.ts`, que aquí devuelve listas vacías a propósito.');
})();
