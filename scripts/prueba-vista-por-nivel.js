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
  // El caso de la captura del 9/sep: una Gerente de Zona que veía la empresa
  // entera desde Dirección General, con los 11 chips de unidad y 104 entregas.
  gerente: { uid: 'z', id: 'z', nombre: 'Veronica Gerente', usuario: 'ger', correo: 'g@l.invalid',
    rol: 'trabajador', puestoId: 'gerencia-zona', puedeVerEstadisticas: true, sucursales: ['8 Esquinas'] },
  // Ficha SIN puesto resoluble pero con banderas de supervisión: hoy son
  // decenas. Es quien se quedaría con la pantalla en blanco si el recorte no
  // tuviera su lado seguro, y por eso tiene que estar en la muestra.
  sinPuesto: { uid: 's', id: 's', nombre: 'Sin Puesto', usuario: 'sp', correo: 's@l.invalid',
    rol: 'trabajador', cargo: 'Cargo Que No Existe', puedeVerEstadisticas: true, sucursales: ['Canindo'] },
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

  // ── EL ÁRBOL: quién lo abre, Y QUÉ VE DENTRO ────────────────────────────
  // `raizArbol` es la aserción que importa. Hasta el 11/sep aquí solo decía
  // `arbol: 1` —«el componente monta»— y con eso una Gerente de Zona pasaba en
  // verde viendo la empresa entera desde Dirección General.
  { ruta: 'tareas-manual', sesion: 'global',    arbol: 1, raizArbol: 'Dirección General', ambitoVacio: true,  chipsUnidad: 11 },
  // Su árbol arranca en SU puesto, no en Dirección General, y la pantalla dice
  // por qué: un recorte mudo se lee como un bug.
  // Su rama es la sucursal: un solo chip. Antes eran los once.
  { ruta: 'tareas-manual', sesion: 'encargada', arbol: 1, raizArbol: 'Encargado(a) de Sucursal', ambitoVacio: false, chipsUnidad: 1 },
  // 5 y no 2, y el número se DERIVÓ del catálogo antes de escribirlo aquí (era
  // 2 a ojo y estaba mal): de `gerencia-zona` cuelgan 40 puestos repartidos en
  // zona · staff-zona · ventas · sucursal · operaciones-zona. Ventas SÍ le
  // reporta a ella, y por eso los vendedores que son «servicio a» para una
  // Encargada son gente PROPIA para su Gerente. Las dos lecturas son correctas
  // y es justo lo que el eje vertical tiene que distinguir.
  { ruta: 'tareas-manual', sesion: 'gerente',   arbol: 1, raizArbol: 'Gerencia de Zona',         ambitoVacio: false, chipsUnidad: 5 },
  // Una ficha sin puesto NO se recorta —es el lado seguro del error— pero la
  // pantalla tiene que DECIRLE por qué y a quién pedírselo.
  { ruta: 'tareas-manual', sesion: 'sinPuesto', arbol: 1, raizArbol: 'Dirección General', ambitoVacio: false, chipsUnidad: 11 },
  // El árbol es una herramienta de supervisión. Un anaquelista ve SUS tareas.
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
      // ── EL EJE VERTICAL, medido en el DOM ──────────────────────────────
      // Hasta el 11/sep esto contestaba «¿MONTA el árbol?» (arbol: 0|1) y
      // nunca «¿QUÉ VE dentro?». Por eso una Gerente de Zona podía tener el
      // árbol completo de la empresa con la prueba en verde: el componente
      // montaba, que era lo único que se miraba. Es el mismo hueco que el
      // spec del tablero tuvo el 3/sep, un nivel más adentro.
      //
      // `raizArbol` es el discriminador bueno: el NOMBRE del primer puesto.
      // Dirección lee «Dirección General»; una Encargada tiene que leer su
      // propio puesto. Contar filas no discrimina —dos personas distintas
      // pueden ver el mismo número de filas de ramas distintas—.
      ' raizArbol: ((document.querySelector(".org-lista .org-puesto .org-puesto-nombre")||{}).textContent||"").trim(),' +
      ' chipsUnidad: document.querySelectorAll(".org-chip-uni").length,' +
      ' servicioA: document.querySelectorAll(".org-lista .org-puesto .org-cruzada").length,' +
      ' ambito: ((document.querySelector(".org-ambito")||{}).textContent||"").trim(),' +
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

  // `raizArbol` es el eje que mide QUÉ VE DENTRO del árbol, no si monta.
  const EJES = ['tablero', 'arbol', 'unidades', 'silencioVisible', 'hueco', 'raizArbol', 'chipsUnidad'];
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
    if (f.d.arbol) {
      console.log('%s árbol: raíz=%s · filas=%s · chips=%s · servicio-a=%s',
        ' '.repeat(29), JSON.stringify(f.d.raizArbol), f.d.filasArbol, f.d.chipsUnidad, f.d.servicioA);
      console.log('%s ámbito: %s', ' '.repeat(29),
        f.d.ambito ? JSON.stringify(f.d.ambito.slice(0, 90)) : '(sin línea)');
    }
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
    for (const k of ['tablero', 'arbol', 'unidades', 'silencioVisible', 'hueco', 'url', 'raizArbol', 'chipsUnidad']) {
      if (f[k] === undefined) continue;
      if (f.d[k] !== f[k]) {
        fallos.push('/' + f.ruta + ' · ' + f.sesion + ' · ' + k + ': esperaba ' +
          JSON.stringify(f[k]) + ', medí ' + JSON.stringify(f.d[k]));
      }
    }
    // La línea que explica el recorte. `ambitoVacio: true` es tan aserción como
    // su contrario: a un acceso total NO se le anuncia que ve todo —sería ruido
    // permanente— y a quien sí tiene recorte no se le puede callar.
    if (f.ambitoVacio !== undefined) {
      const hay = !!f.d.ambito;
      if (hay === f.ambitoVacio) {
        fallos.push('/' + f.ruta + ' · ' + f.sesion + ' · línea de ámbito: esperaba ' +
          (f.ambitoVacio ? 'NINGUNA' : 'una que explicara el recorte') + ', medí ' +
          JSON.stringify(f.d.ambito || ''));
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
