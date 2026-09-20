#!/usr/bin/env node
// ============================================================================
//  ¿QUÉ ÓRDENES DE MANTENIMIENTO Y SISTEMAS VE UNA ENCARGADA EN PANTALLA?
//
//  Instrucción de David (20/sep): los puestos de sucursal y zona no ven las
//  tareas de esos dos departamentos «a menos de que su sucursal las haya
//  asignado; solo así pueden ver las que asignaron».
//
//  Las unitarias prueban la REGLA. Esto prueba lo que hay delante de la
//  persona, que es otra cosa: la regla podía estar bien y no engancharse a uno
//  de los tres filtros, y la Encargada seguiría viendo las órdenes ajenas en
//  la bandeja que no se tocó.
//
//  ─── NO SE CUENTAN TARJETAS: SE MIRA CUÁLES QUEDAN ────────────────────────
//  «Hay menos tarjetas» lo pasa un filtro que borre al azar. Cada fixture lleva
//  un nombre distinto y se comprueba el CONJUNTO exacto que sobrevive (§8.11 b).
//
//    npm run build   (mide lo COMPILADO)
//    node scripts/prueba-area-transversal.js
// ============================================================================
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIST_REAL = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');

function abortar(m) {
  console.error('\n[transversal] ABORTA: ' + m);
  console.error('[transversal] No concluyas de esta corrida.');
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
const AYER = (() => {
  const d = new Date(Date.now() - 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
})();

const ENCARGADA = 'Elena Encargada Transversal';
const TECNICO   = 'Mario Mantenimiento Transversal';
// Las ordenes van asignadas a un SEGUNDO tecnico, no a Mario. «Del equipo» es
// estricto desde el 14/sep —excluye lo propio— asi que con las tres asignadas
// a el, su bandeja salia VACIA y el contraste no medi­a nada. Lo cazó la
// primera corrida: 0 de 3, con el filtro funcionando perfectamente.
const TECNICO2  = 'Tono Tecnico Transversal';
const OTRA      = 'Otra Persona Transversal';

// La ficha REAL de una Encargada, medida el 15/sep: su `sucursales[]` lleva su
// tienda y las dos áreas, porque desde ahí levanta tickets. Ese es el motivo
// de que hoy vea las órdenes de las otras siete tiendas.
const SESION_ENCARGADA = {
  uid: 'e1', id: 'e1', nombre: ENCARGADA, usuario: 'elena', correo: 'elena@l.invalid',
  rol: 'trabajador', sucursales: ['8 Esquinas', 'MANTENIMIENTO', 'SISTEMAS'],
  puestoId: 'encargado-sucursal', puedeVerEstadisticas: true,
};
// CONTRASTE: quien hace el trabajo. Mismos fixtures, conjunto distinto.
const SESION_TECNICO = {
  uid: 'm1', id: 'm1', nombre: TECNICO, usuario: 'mario', correo: 'mario@l.invalid',
  rol: 'trabajador', sucursales: ['MANTENIMIENTO'],
  puestoId: 'jefe-mantenimiento', puedeVerEstadisticas: true,
};

const ITEMS = [{ id: 'i1', text: 'Punto uno' }];
const BASE = { items: ITEMS, timestampCreacion: Date.now(), date: HOY, enviado: true };

// Todas van asignadas a OTRA persona: así caen en «del equipo», que es la
// bandeja donde se pinta la rejilla de tarjetas.
const FILAS = [
  { id: 'm-ajena', name: 'MANT ajena', store: 'MANTENIMIENTO', assigned: TECNICO2,
    createdBy: OTRA, mantenimiento: { sucursalOrigen: 'Canindo' }, ...BASE },
  { id: 'm-mia', name: 'MANT de mi sucursal', store: 'MANTENIMIENTO', assigned: TECNICO2,
    createdBy: OTRA, mantenimiento: { sucursalOrigen: '8 Esquinas' }, ...BASE },
  { id: 'm-yo', name: 'MANT que levante yo', store: 'MANTENIMIENTO', assigned: TECNICO2,
    createdBy: ENCARGADA, mantenimiento: {}, ...BASE },
  { id: 's-ajena', name: 'SIS ajena', store: 'SISTEMAS', assigned: OTRA,
    createdBy: OTRA, ...BASE },
  { id: 's-yo', name: 'SIS que levante yo', store: 'SISTEMAS', assigned: OTRA,
    createdBy: ENCARGADA, ...BASE },
  // CONTROL: una tarea normal de su tienda. Si esta desapareciera, el recorte
  // se habría llevado por delante algo que no venía a tocar.
  { id: 'n1', name: 'Tarea normal de mi tienda', store: '8 Esquinas', assigned: OTRA,
    createdBy: OTRA, ...BASE },
  // ⏱️ SOLO LAS DEL DÍA (20/sep). Reporte de David: «en enviadas del equipo
  // aparecen las viejas y tienen que ser solo las del día». `cargarEnviadas`
  // pedía TREINTA DÍAS y no recortaba la fecha, mientras «Pendientes» pedía
  // desde hoy: las dos bandejas en escalas distintas.
  //
  // Esta fila es de AYER y de su propia tienda, así que solo puede quedar
  // fuera por la fecha — si el recorte de áreas se la llevara, el fixture no
  // distinguiría cuál de los dos filtros actuó.
  { id: 'v1', name: 'VIEJA de mi tienda', store: '8 Esquinas', assigned: OTRA,
    createdBy: OTRA, ...BASE, date: AYER },
];

const USUARIOS = [
  { id: 'e1', nombre: ENCARGADA, puestoId: 'encargado-sucursal', activo: true,
    sucursales: ['8 Esquinas', 'MANTENIMIENTO', 'SISTEMAS'] },
  { id: 'm1', nombre: TECNICO, puestoId: 'jefe-mantenimiento', activo: true,
    sucursales: ['MANTENIMIENTO'] },
  { id: 'm2', nombre: TECNICO2, puestoId: 'jefe-mantenimiento', activo: true,
    sucursales: ['MANTENIMIENTO'] },
  { id: 'o1', nombre: OTRA, puestoId: 'anaquelista', activo: true, sucursales: ['8 Esquinas'] },
];
const CUERPO = JSON.stringify({ checklists: FILAS, usuarios: USUARIOS, areas: [] });

const B_EQ_ENV = 'Enviadas del equipo';

const ESCENARIOS = [
  {
    nombre: 'ENCARGADA · enviadas del equipo',
    sesion: SESION_ENCARGADA,
    // Ve la de su tienda, la que levantó ella, la de Sistemas que levantó ella,
    // y la tarea normal. NO ve la de Canindo ni la de Sistemas ajena.
    espera: ['MANT de mi sucursal', 'MANT que levante yo', 'SIS que levante yo',
             'Tarea normal de mi tienda'],
  },
  {
    nombre: 'TECNICO de mantenimiento (CONTRASTE)',
    sesion: SESION_TECNICO,
    // Ve LAS TRES órdenes, incluida la de Canindo: es su trabajo. Y no ve la
    // tarea de la tienda ni las de Sistemas, porque `alcanceCubre` ya las
    // recorta por su `sucursales: ['MANTENIMIENTO']` — ese filtro sigue vivo.
    espera: ['MANT ajena', 'MANT de mi sucursal', 'MANT que levante yo'],
  },
];

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function medir(esc, puerto) {
  return new Promise((resolve) => {
    const iny =
      '<script>try{localStorage.setItem("md_sesion_actual",' +
      JSON.stringify(JSON.stringify(esc.sesion)) + ');}catch(e){}' +
      'try{localStorage.setItem("md_token","token-de-medicion");}catch(e){}</script>' +
      '<script>window.addEventListener("load",function(){' +
      // Las tarjetas nacen plegadas desde el 17/sep: sin abrir los bloques esto
      // contaria 0 y reportaria «se esconden todas» sobre un filtro intacto.
      // Se pulsa solo lo que se anuncia CERRADO, el mismo atributo que mira
      // `prueba-lista-plegable`, para que las dos caigan juntas si se invierte.
      'function abrir(sel){[].slice.call(document.querySelectorAll(sel))' +
      '  .forEach(function(b){if(b.getAttribute("aria-expanded")==="false")b.click();});}' +
      'setTimeout(function(){' +
      'var bs=[].slice.call(document.querySelectorAll(".cl-bandeja .vista-tab"));' +
      'var b=bs.filter(function(e){return (e.textContent||"").indexOf(' +
      JSON.stringify(B_EQ_ENV) + ')>=0;})[0];' +
      'if(b){b.click();}else{window.__sinBoton=1;}' +
      'setTimeout(function(){abrir("button.cl-grupo-suc");' +
      'setTimeout(function(){abrir("button.cl-grupo-per");' +
      'setTimeout(function(){' +
      'var cards=[].slice.call(document.querySelectorAll(".checklist-card"));' +
      'var nombres=cards.map(function(c){' +
      '  var t=c.querySelector(".cl-title,.checklist-title,h3,h4");' +
      '  return ((t?t.textContent:c.textContent)||"").replace(/\\s+/g," ").trim();});' +
      'document.title="RES "+JSON.stringify({' +
      ' sinBoton: window.__sinBoton?1:0,' +
      ' tarjetas: cards.length,' +
      ' nombres: nombres' +
      '});},900);},900);},900);},2500);});</script>';

    const sano = fs.readFileSync(path.join(DIST_REAL, 'index.html'), 'utf8');
    const html = sano.replace('<body>', '<body>' + iny);
    if (html === sano) return resolve({ error: 'no pude inyectar la sesion en el index' });

    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url.indexOf('/api/') === 0) {
        // ⚠ SE HONRAN `desde` y `hasta`, como el endpoint real. Devolviendo
        // SIEMPRE las seis filas, el arnés probaría solo el filtro de cliente y
        // daría verde aunque la consulta siguiera pidiendo treinta días — que
        // es justo la mitad del defecto. Con esto se mide lo que de verdad
        // llega al navegador.
        const q = new URL(req.url, 'http://x').searchParams;
        const desde = q.get('desde'), hasta = q.get('hasta');
        const filas = FILAS.filter(f =>
          (!desde || String(f.date) >= desde) && (!hasta || String(f.date) <= hasta));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ checklists: filas, usuarios: USUARIOS, areas: [] }));
      }
      if (url === '/' || !path.extname(url)) {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        return res.end(html);
      }
      const f = path.join(DIST_REAL, url);
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.on('error', (e) => resolve({ error: 'el servidor local no levanto: ' + e.message }));
    srv.listen(puerto, () => {
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-transv-'));
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--user-data-dir=' + perfil, '--virtual-time-budget=30000',
        '--disable-background-networking', '--disable-sync', '--disable-component-update',
        '--disable-features=PushMessaging,OptimizationHints',
        '--dump-dom', 'http://localhost:' + puerto + '/tareas'],
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
        catch (e) { resolve({ error: 'el titulo no era JSON: ' + m[1].slice(0, 160) }); }
      });
    });
  });
}

(async () => {
  if (!CHROME) abortar('no encontre Chrome. Sin navegador esto no mide nada.');
  if (!fs.existsSync(path.join(DIST_REAL, 'index.html'))) {
    abortar('no hay dist/. Corre `npm run build`: esto mide lo COMPILADO.');
  }

  console.log('\nENTRADAS: ' + FILAS.length + ' checklists servidos · ' +
              ESCENARIOS.length + ' sesiones\n');

  let fallos = 0, puerto = 45710;
  const vistos = [];

  for (const esc of ESCENARIOS) {
    const r = await medir(esc, puerto++);
    if (r.error) abortar(esc.nombre + ': ' + r.error);
    const d = r.dato;
    if (d.sinBoton) abortar(esc.nombre + ': no encontre el boton «' + B_EQ_ENV + '». ' +
      'O cambio el rotulo, o esta sesion no ve esa bandeja: en los dos casos no medi nada.');

    // Se compara el CONJUNTO, no el conteo.
    const quedaron = esc.espera.filter(n => d.nombres.some(x => x.indexOf(n) >= 0));
    const colados = [
      ...FILAS.map(f => f.name).filter(n => esc.espera.indexOf(n) === -1),
    ].filter(n => d.nombres.some(x => x.indexOf(n) >= 0));

    vistos.push(quedaron.length);
    const ok = quedaron.length === esc.espera.length && colados.length === 0;
    if (!ok) fallos++;

    console.log('── ' + esc.nombre);
    console.log('   tarjetas: ' + d.tarjetas);
    console.log('   esperadas y presentes : ' + quedaron.length + ' de ' + esc.espera.length +
                (quedaron.length === esc.espera.length ? '' :
                 '   ✗ FALTAN: ' + esc.espera.filter(n => quedaron.indexOf(n) === -1).join(' · ')));
    console.log('   coladas (no deberian) : ' + colados.length +
                (colados.length ? '   ✗ ' + colados.join(' · ') : ''));
    console.log('');
  }

  // ── GUARDIAS ─────────────────────────────────────────────────────────────
  if (fallos) {
    console.log('[transversal] ' + fallos + ' de ' + ESCENARIOS.length + ' escenarios FALLARON');
    process.exit(2);
  }
  // Los dos conjuntos tienen que ser DISTINTOS. Si la Encargada y el tecnico
  // vieran lo mismo, todas las aserciones de arriba podrian pasar con el
  // filtro apagado (§8.11 c).
  const a = ESCENARIOS[0].espera.join('|'), b = ESCENARIOS[1].espera.join('|');
  if (a === b) abortar('los dos escenarios esperan lo MISMO: la muestra no discrimina.');
  console.log('   ✓ la muestra discrimina: la Encargada ve ' + ESCENARIOS[0].espera.length +
              ' y el tecnico ' + ESCENARIOS[1].espera.length + ', y no son las mismas');
  // Y ninguno puede verlas todas, o el recorte no se estaria ejerciendo.
  if (vistos.some(v => v === FILAS.length)) {
    abortar('alguna sesion vio las ' + FILAS.length + ' filas: el recorte no se ejerce.');
  }
  console.log('   ✓ ninguna sesion ve las ' + FILAS.length + ' filas servidas');
  console.log('\n[transversal] los ' + ESCENARIOS.length + ' escenarios en verde');
})().catch(e => abortar('la corrida revento: ' + (e && e.stack || e)));
