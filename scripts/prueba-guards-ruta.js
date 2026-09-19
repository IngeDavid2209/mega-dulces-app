#!/usr/bin/env node
/**
 * 🚪 ¿QUIÉN ENTRA ESCRIBIENDO LA URL?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA, y por qué ninguna otra prueba la contestaba
 * ═══════════════════════════════════════════════════════════════════════════
 * `prueba-menu-audiencias.js` contesta «¿quién VE la entrada del menú?». Eso no
 * es lo mismo que «¿quién puede ABRIR la pantalla?», y la diferencia costó seis
 * rutas: hasta el 19/sep cinco de ellas solo pedían `authGuard`, así que la
 * entrada estaba escondida y la puerta abierta.
 *
 * Aquí se navega a la URL con una sesión sembrada y se mira **dónde aterriza la
 * persona** y **qué componente se montó**. Un guard no es una función que se
 * pueda llamar desde una prueba unitaria: necesita el router.
 *
 * ─── LAS DOS MITADES, otra vez ────────────────────────────────────────────
 * Que rebote a quien debe Y que deje pasar a quien ya entraba. La segunda pesa
 * más: un guard de más deja a alguien sin poder trabajar, y «no me deja» se lee
 * como «la app no sirve».
 *
 * ─── LO QUE VIGILA DE SÍ MISMO ────────────────────────────────────────────
 * · ABORTA si alguna medición no se pudo hacer. Un `montado: 0` significaría
 *   «el guard lo rebotó» cuando podría ser «la app no arrancó» (§8.11 a).
 * · ABORTA si la muestra no DISCRIMINA: tiene que haber, para cada ruta, al
 *   menos alguien que entra y alguien que rebota. Cinco rutas que rebotaran a
 *   todo el mundo pasarían todas las aserciones de «rebota» y estarían rotas.
 * · Exige que el COMPONENTE se monte, no solo que la URL coincida: una ruta
 *   puede quedarse en su path y pintar la pantalla en blanco, y eso se ve
 *   igual de bien desde fuera.
 *
 *   npm run build   (mide lo COMPILADO, hace falta un dist/ fresco)
 *   node scripts/prueba-guards-ruta.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIST = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');
const TIPOS = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function abortar(motivo) {
  console.error('\n[guards] ABORTA: ' + motivo);
  console.error('[guards] No concluyas de esta corrida.');
  process.exit(3);
}

// ── LAS SESIONES ───────────────────────────────────────────────────────────
//
// `puestoId` va TAMBIÉN suelto además de dentro de `datos`: `resolverPuesto`
// mira los dos sitios según de dónde venga el perfil, y sembrar solo uno deja
// medir a medias sin que nada falle.
const SESIONES = {
  'admin global': {
    uid: 'a1', nombre: 'Ana Admin', rol: 'admin', alcance: 'global',
    correo: 'ana@md.com', sucursales: ['Canindo'],
  },
  'admin de sucursales': {
    uid: 'a2', nombre: 'Alma AdminLim', rol: 'admin', alcance: 'sucursales',
    correo: 'alma@md.com', sucursales: ['Canindo'],
  },
  // El caso que la instrucción de David pone aparte: se reconoce por CORREO.
  // Aquí va SIN `rol: 'admin'` a propósito — es el escenario imposible que
  // `audiencias.ts` blinda, y si algún día deja de estarlo, esta fila lo dice.
  'el dueño (por correo, SIN rol admin)': {
    uid: 'd1', nombre: 'David', rol: 'trabajador',
    correo: 'davidcisneros2209@outlook.es', sucursales: ['Canindo'],
  },
  'Encargada (jefatura, sin banderas)': {
    uid: 'e1', nombre: 'Elena Encargada', rol: 'trabajador', correo: 'elena@md.com',
    sucursales: ['Canindo'], puestoId: 'encargado-sucursal',
    datos: { puestoId: 'encargado-sucursal', sucursales: ['Canindo'] },
  },
  'con puedeVerHistorial': {
    uid: 'h1', nombre: 'Hilda Historial', rol: 'trabajador', correo: 'hilda@md.com',
    sucursales: ['Canindo'], puedeVerHistorial: true,
  },
  'con puedeAdministrarPersonal': {
    uid: 'p1', nombre: 'Pura Personal', rol: 'trabajador', correo: 'pura@md.com',
    sucursales: ['Canindo'], puedeAdministrarPersonal: true,
  },
  'con puedeCrearRutinas': {
    uid: 'r1', nombre: 'Rita Rutinas', rol: 'trabajador', correo: 'rita@md.com',
    sucursales: ['Canindo'], puedeCrearRutinas: true,
  },
  'Anaquelista (sin nada)': {
    uid: 'n1', nombre: 'Ana Anaquelista', rol: 'trabajador', correo: 'anaq@md.com',
    sucursales: ['Canindo'], puestoId: 'anaquelista',
    datos: { puestoId: 'anaquelista', sucursales: ['Canindo'] },
  },
};

// ── LAS CINCO RUTAS QUE SE CIERRAN, con quién debe entrar ──────────────────
//
// `entran` se escribe a mano A PROPÓSITO: es la audiencia declarada, y tiene
// que poder discrepar del código para que la prueba sirva de algo. Si saliera
// de llamar al mismo predicado que usa el guard, esto compararía la regla
// consigo misma (§8.11 d).
const RUTAS = [
  { ruta: 'reportes', sel: 'app-reportes', etiqueta: 'Auditoría',
    entran: ['admin global', 'admin de sucursales', 'el dueño (por correo, SIN rol admin)',
             'con puedeVerHistorial'] },
  { ruta: 'cierre-mensual', sel: 'app-cierre-mensual', etiqueta: 'Cierre Mensual',
    entran: ['admin global', 'el dueño (por correo, SIN rol admin)'] },
  { ruta: 'manual-puestos', sel: 'app-manual-puestos', etiqueta: 'Manual por Puesto',
    entran: ['admin global', 'admin de sucursales', 'el dueño (por correo, SIN rol admin)',
             'con puedeCrearRutinas'] },
  { ruta: 'descansos', sel: 'app-descansos', etiqueta: 'Días de Descanso',
    entran: ['admin global', 'admin de sucursales', 'el dueño (por correo, SIN rol admin)',
             'con puedeAdministrarPersonal'] },
  { ruta: 'tareas-asignadas', sel: 'app-tareas-asignadas', etiqueta: 'Tareas asignadas (huérfana)',
    entran: ['admin global', 'admin de sucursales', 'el dueño (por correo, SIN rol admin)'] },
  // CONTRASTE: una ruta que NO se tocó. Si también cambiara, el arreglo se
  // habría llevado por delante algo que no venía a tocar.
  { ruta: 'tareas', sel: 'app-checklist', etiqueta: 'CONTRASTE · Tareas (sin guard nuevo)',
    entran: Object.keys(SESIONES) },
];

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

function medir(sesion, ruta, sel, puerto) {
  return new Promise((resolve) => {
    const iny =
      '<script>try{localStorage.setItem("md_sesion_actual",' +
      JSON.stringify(JSON.stringify(SESIONES[sesion])) + ');}catch(e){}</script>' +
      '<script>window.addEventListener("load",function(){setTimeout(function(){' +
      'document.title="RES "+JSON.stringify({' +
      ' url: location.pathname,' +
      ' montado: document.querySelectorAll(' + JSON.stringify(sel) + ').length,' +
      ' raiz: document.querySelectorAll("app-root").length' +
      '});},4000);});</script>';

    const sano = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const html = sano.replace('<body>', '<body>' + iny);
    if (html === sano) return resolve({ error: 'no pude inyectar la sesion en el index' });

    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url.indexOf('/api/') === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ checklists: [], usuarios: [], areas: [], items: [], usuario: null }));
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
    srv.on('error', (e) => resolve({ error: 'el servidor local no levanto: ' + e.message }));
    srv.listen(puerto, () => {
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-guards-'));
      // La ruta se arma AQUI con la barra puesta por codigo: en Git Bash, MSYS
      // convierte '/reportes' en 'C:/Program Files/Git/reportes' si viaja por
      // argumento, y el DOM llega vacio — que se lee como «la app no pinta».
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--user-data-dir=' + perfil, '--virtual-time-budget=20000',
        '--disable-background-networking', '--disable-sync', '--disable-component-update',
        '--disable-features=PushMessaging,OptimizationHints',
        '--dump-dom', 'http://localhost:' + puerto + '/' + ruta],
        { stdio: ['ignore', 'pipe', 'ignore'] });

      let dom = '';
      h.stdout.on('data', (d) => { dom += d.toString('utf8'); });
      h.on('error', (e) => { srv.close(); resolve({ error: 'no pude lanzar Chrome: ' + e.message }); });
      h.on('close', () => {
        srv.close();
        if (dom.length < 500) return resolve({ error: 'DOM de ' + dom.length + ' bytes' });
        const m = /<title>RES ([\s\S]*?)<\/title>/.exec(dom);
        if (!m) return resolve({ error: 'sin medicion · dom=' + dom.length + 'B' });
        try { resolve({ dato: JSON.parse(m[1]) }); }
        catch (e) { resolve({ error: 'el titulo no era JSON: ' + m[1].slice(0, 120) }); }
      });
    });
  });
}

(async () => {
  if (!CHROME) abortar('no encontre Chrome. Sin navegador esto no mide nada.');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    abortar('no hay dist/. Corre `npm run build`: esto mide lo COMPILADO.');
  }

  const nombres = Object.keys(SESIONES);
  console.log('\nENTRADAS: ' + RUTAS.length + ' ruta(s) x ' + nombres.length +
              ' sesion(es) = ' + (RUTAS.length * nombres.length) + ' medicion(es)\n');

  let fallos = 0, corridos = 0, puerto = 45610;
  const noMedidos = [];
  const problemas = [];

  for (const R of RUTAS) {
    console.log('── /' + R.ruta + '  ' + R.etiqueta);
    console.log('   ' + 'sesion'.padEnd(38) + 'aterriza en'.padEnd(20) + 'monta  esperado');
    const entraron = [];
    for (const s of nombres) {
      const r = await medir(s, R.ruta, R.sel, puerto++);
      if (r.error) { noMedidos.push('/' + R.ruta + ' · ' + s + ': ' + r.error); continue; }
      const d = r.dato;
      const debeEntrar = R.entran.indexOf(s) !== -1;
      // Entrar = la URL se quedó Y el componente se montó. Solo la URL no basta:
      // una ruta puede conservar su path y pintar la pantalla en blanco.
      const entro = d.url === '/' + R.ruta && d.montado > 0;
      if (entro) entraron.push(s);
      corridos++;
      const ok = entro === debeEntrar;
      if (!ok) fallos++;
      console.log('   ' + s.padEnd(38) + String(d.url).padEnd(20) +
                  String(d.montado).padEnd(7) + (debeEntrar ? 'entra' : 'rebota') +
                  (ok ? '' : '   ✗'));
    }
    // Por ruta: tiene que haber alguien dentro y alguien fuera.
    //
    // ⚠ SE ANOTA, NO SE ABORTA AQUÍ. La primera versión abortaba en el acto, y
    // eso TAPABA las aserciones ya rotas: con un guard quitado, el arnés decía
    // «no pude medir» (código 3) en vez de nombrar las cuatro filas que se
    // acababan de abrir. «No medí» y «está roto» son conclusiones opuestas
    // (§8.11 a), y un control negativo tiene que NOMBRAR el mecanismo.
    if (R.ruta !== 'tareas') {
      if (entraron.length === 0) {
        problemas.push('/' + R.ruta + ': NADIE entro. Un guard que rebota a todo el ' +
                       'mundo pasa todas las aserciones de «rebota» y esta roto.');
      }
      if (entraron.length === nombres.length) {
        problemas.push('/' + R.ruta + ': entraron TODOS. El guard no esta gateando ' +
                       'nada, y las aserciones de «entra» pasarian igual.');
      }
    }
    console.log('');
  }

  if (noMedidos.length) {
    abortar(noMedidos.length + ' medicion(es) no se pudieron hacer. «No pude leer» y ' +
            '«el guard lo reboto» se ven identicos:\n   ' + noMedidos.join('\n   '));
  }

  console.log('   ✓ ' + corridos + ' mediciones, todas con dato');
  // Primero los FALLOS: son los que nombran qué se rompió. Las guardias de
  // discriminación solo hablan cuando todo lo demás pasó.
  if (fallos) {
    console.log('\n[guards] ' + fallos + ' de ' + corridos + ' FALLARON');
    if (problemas.length) {
      console.log('[guards] y ademas la muestra dejo de discriminar:');
      for (const pr of problemas) console.log('   - ' + pr);
    }
    process.exit(2);
  }
  if (problemas.length) abortar('la muestra NO DISCRIMINA:\n   ' + problemas.join('\n   '));
  console.log('[guards] ' + corridos + ' mediciones en verde');
})().catch(e => abortar('la corrida revento: ' + (e && e.stack || e)));
