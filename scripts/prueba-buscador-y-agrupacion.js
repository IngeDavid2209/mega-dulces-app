/**
 * 🔍🏪 EL BUSCADOR Y EL AGRUPADOR POR SUCURSAL, medidos en el DOM
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Reporte de David (17/sep/2026), con captura: «no esta funcionando el buscador
 * y tampoco el agrupador de los usuarios para que los tengas por sucursal».
 * En la captura está en «Enviadas del equipo», había tecleado «la piedad
 * abastos», y las cuatro tarjetas visibles eran de **Padre Hidalgo** con el
 * contador intacto en (94).
 *
 * ─── LAS DOS CAUSAS, Y NINGUNA ERA «la regla está mal escrita» ────────────
 *  1. El filtro de texto vivía DENTRO de `checklistsFiltrados`, que solo
 *     alimenta Pendientes. `enviadasFiltradas` nunca lo llamaba.
 *  2. El botón de agrupar pedía `puedeFiltrarVista && vistaTareas === 'equipo'`
 *     dentro de un contenedor que pedía `!verPorOrganigrama && pendientes` —y
 *     `verPorOrganigrama` es exactamente `puedeFiltrarVista && equipo &&
 *     pendientes`—, así que las dos condiciones eran CONTRADICTORIAS: el botón
 *     no se pintaba en ninguna combinación posible. No es que no funcionara;
 *     es que no existía en pantalla.
 *
 * ─── QUÉ PREGUNTA CONTESTA CADA COLUMNA (§8.11) ──────────────────────────
 * No «¿hay menos tarjetas?» —eso lo pasa un filtro que borre al azar— sino:
 *  · `dePH` / `deLPA`: de QUÉ SUCURSAL son las tarjetas que quedan. Es el
 *    mecanismo: buscar «la piedad abastos» tiene que dejar dePH en CERO.
 *  · `encSuc`: cuántos encabezados de sucursal se pintaron.
 *  · `btnAgrupar`: si el control existe. Cero aquí es el defecto 2.
 *
 * ⚠ EL ÁRBOL DEL ORGANIGRAMA NO SE TOCA (instrucción de David: «solo no
 * toques el organigrama»). Por eso hay un escenario que EXIGE que en
 * «Pendientes del equipo» siga saliendo el árbol y NO el agrupador: sin él,
 * este cambio podría habérselo llevado por delante sin que nadie lo notara.
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
  console.error('[buscador] ABORTA: ' + motivo);
  console.error('[buscador] No concluyas de esta corrida.');
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

const YO = 'Ana Prueba Buscador';
const OTRA = 'Beto Prueba Buscador';
const OTRA2 = 'Carmen Prueba Buscador';
const PH = 'Padre Hidalgo';
const LPA = 'La Piedad Abastos';
const TERMINO = 'la piedad abastos';   // el de la captura, tal cual

/** Ve lo de otros y puede crear (el buscador pide ese permiso para pintarse). */
const SUPERVISORA = {
  uid: 's1', id: 's1', nombre: YO, usuario: 'ana', correo: 'ana@l.invalid',
  rol: 'trabajador', sucursales: [PH, LPA],
  puedeVerEstadisticas: true, puedeCrearChecklists: true,
};
/** Sin banderas de supervisión: no tiene árbol, así que su lista SÍ se puede
 *  contar. Conserva `puedeCrearChecklists` porque de eso cuelga el buscador. */
const TRABAJADORA = {
  uid: 'w1', id: 'w1', nombre: YO, usuario: 'ana', correo: 'ana@l.invalid',
  rol: 'trabajador', sucursales: [PH, LPA], puedeCrearChecklists: true,
};

const ITEMS = [{ id: 'i1', text: 'Punto uno' }, { id: 'i2', text: 'Punto dos' }];
const BASE = { createdBy: YO, items: ITEMS, timestampCreacion: Date.now() };
const MANUAL = { _origenManual: true, _puestoId: 'anaquelista', _formatoCodigo: 'PR-01' };

/**
 * DOS sucursales, con CANTIDADES DISTINTAS a propósito (2 ≠ 1): con conjuntos
 * del mismo tamaño, un filtro invertido daría el mismo número y la prueba no
 * distinguiría «filtra» de «filtra al revés».
 *
 * Y las mías van en las DOS sucursales, que es lo que hace medible el
 * agrupador en «Mis tareas»: con una sola, el encabezado no se pinta —por
 * diseño— y ese escenario no ejercería nada.
 */
const FILAS = [
  // Pendientes de otros (las ve la supervisora en «del equipo»)
  { id: 'p1', date: HOY, time: '08:00', name: 'Apertura de pasillo', assigned: OTRA, store: PH, ...BASE, ...MANUAL },
  { id: 'p2', date: HOY, time: '09:00', name: 'Acomodo de anaquel', assigned: OTRA, store: PH, ...BASE, ...MANUAL },
  { id: 'p3', date: HOY, time: '10:00', name: 'Cierre de pasillo', assigned: OTRA2, store: LPA, ...BASE, ...MANUAL },
  // Pendientes mías, repartidas en las dos sucursales
  { id: 'p4', date: HOY, time: '11:00', name: 'Limpiar bodega chica', assigned: YO, store: PH, ...BASE },
  { id: 'p5', date: HOY, time: '12:00', name: 'Apoyo en caja', assigned: YO, store: PH, ...BASE, ...MANUAL },
  { id: 'p6', date: HOY, time: '13:00', name: 'Revisión de andén', assigned: YO, store: LPA, ...BASE, ...MANUAL },
  // Enviadas: LA PANTALLA DE LA CAPTURA. 2 de PH y 1 de LPA entre las de otros.
  { id: 'e1', date: HOY, time: '07:00', name: 'Corte de ayer uno', assigned: OTRA, enviado: true, store: PH, ...BASE, ...MANUAL },
  { id: 'e2', date: HOY, time: '07:10', name: 'Corte de ayer dos', assigned: OTRA, enviado: true, store: PH, ...BASE, ...MANUAL },
  { id: 'e3', date: HOY, time: '07:20', name: 'Corte de ayer tres', assigned: OTRA2, enviado: true, store: LPA, ...BASE, ...MANUAL },
  { id: 'e4', date: HOY, time: '07:30', name: 'Mi corte de ayer', assigned: YO, enviado: true, store: PH, ...BASE, ...MANUAL },
];

const USUARIOS = [
  { id: 's1', nombre: YO, puestoId: 'encargado-sucursal', activo: true, sucursales: [PH, LPA] },
  { id: 'u2', nombre: OTRA, puestoId: 'anaquelista', activo: true, sucursales: [PH] },
  { id: 'u3', nombre: OTRA2, puestoId: 'anaquelista', activo: true, sucursales: [LPA] },
];
const CUERPO = JSON.stringify({ checklists: FILAS, usuarios: USUARIOS, areas: [] });

const B_EQ_PEND = 'Pendientes del equipo';
const B_EQ_ENV = 'Enviadas del equipo';
const B_MIS_PEND = 'Mis tareas pendientes';

const ESCENARIOS = [
  // ══ LA PANTALLA DE LA CAPTURA ══════════════════════════════════════════
  {
    nombre: 'enviadas equipo, sin buscar', sesion: SUPERVISORA, pulsa: B_EQ_ENV, busca: '',
    esperado: { tarjetas: 3, dePH: 2, deLPA: 1, encSuc: 2, btnAgrupar: 1, arbol: 0 },
  },
  {
    // EL DEFECTO EXACTO QUE REPORTÓ DAVID. Antes: 3 tarjetas, 2 de Padre
    // Hidalgo, con el término escrito.
    nombre: 'enviadas equipo + «la piedad abastos»', sesion: SUPERVISORA, pulsa: B_EQ_ENV, busca: TERMINO,
    esperado: { tarjetas: 1, dePH: 0, deLPA: 1, encSuc: 0, btnAgrupar: 1, arbol: 0 },
  },
  // ══ EL ORGANIGRAMA NO SE TOCA ══════════════════════════════════════════
  {
    // Aquí manda el ÁRBOL, como siempre. Si este escenario empezara a dar
    // tarjetas o `btnAgrupar: 1`, este cambio se habría llevado por delante la
    // vista de supervisión, que es justo lo que David dijo que no se tocara.
    nombre: 'pendientes equipo (árbol intacto)', sesion: SUPERVISORA, pulsa: B_EQ_PEND, busca: '',
    esperado: { tarjetas: 0, dePH: 0, deLPA: 0, encSuc: 0, btnAgrupar: 0, arbol: 1 },
  },
  // ══ LA LISTA DE QUIEN NO SUPERVISA ═════════════════════════════════════
  {
    nombre: 'mis pendientes, sin buscar', sesion: TRABAJADORA, pulsa: B_MIS_PEND, busca: '',
    esperado: { tarjetas: 3, dePH: 2, deLPA: 1, encSuc: 2, btnAgrupar: 1, arbol: 0 },
  },
  {
    nombre: 'mis pendientes + «la piedad abastos»', sesion: TRABAJADORA, pulsa: B_MIS_PEND, busca: TERMINO,
    esperado: { tarjetas: 1, dePH: 0, deLPA: 1, encSuc: 0, btnAgrupar: 1, arbol: 0 },
  },
  {
    // Buscar por NOMBRE DE TAREA, no por sucursal: el eje tiene que seguir
    // siendo libre. Y con el acento escrito sin acento, que es como se teclea
    // en un celular.
    nombre: 'mis pendientes + «anden» (sin acento)', sesion: TRABAJADORA, pulsa: B_MIS_PEND, busca: 'anden',
    esperado: { tarjetas: 1, dePH: 0, deLPA: 1, encSuc: 0, btnAgrupar: 1, arbol: 0 },
  },
];

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function prepararCopia() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'md-buscador-dist-'));
  const copiar = (de, a) => {
    fs.mkdirSync(a, { recursive: true });
    for (const e of fs.readdirSync(de, { withFileTypes: true })) {
      const o = path.join(de, e.name), d = path.join(a, e.name);
      if (e.isDirectory()) copiar(o, d); else fs.copyFileSync(o, d);
    }
  };
  copiar(DIST_REAL, destino);
  return destino;
}

function medir(esc, puerto) {
  return new Promise((resolve) => {
    const pulsar = esc.pulsa
      ? 'var bs=[].slice.call(document.querySelectorAll(".cl-bandeja .vista-tab"));' +
        'var b=bs.filter(function(e){return (e.textContent||"").indexOf(' +
        JSON.stringify(esc.pulsa) + ')>=0;})[0];' +
        'if(b){b.click();}else{window.__sinBoton=1;}'
      : '';

    // Escribir en el buscador REAL: se fija el valor y se dispara `input`, que
    // es lo que `[(ngModel)]` escucha. Poner solo `.value` no avisa a Angular
    // y la medición saldría como si nadie hubiera escrito — un no-op que da
    // verde, que es peor que fallar.
    const escribir = esc.busca
      ? 'var inp=[].slice.call(document.querySelectorAll("input.form-input")).filter(function(e){' +
        '  return (e.placeholder||"").indexOf("Buscar tarea")>=0;})[0];' +
        'if(inp){inp.value=' + JSON.stringify(esc.busca) + ';' +
        '  inp.dispatchEvent(new Event("input",{bubbles:true}));}else{window.__sinInput=1;}'
      : '';

    // OJO CON LOS `+` DEL FINAL DE CADA LÍNEA (lección del repo): sin uno, la
    // inserción automática de punto y coma parte la expresión en dos sentencias
    // válidas, el script sale truncado y el título nunca se fija.
    const iny =
      '<script>try{localStorage.setItem("md_sesion_actual",' +
      JSON.stringify(JSON.stringify(esc.sesion)) + ');}catch(e){}' +
      'try{localStorage.setItem("md_token","token-de-medicion");}catch(e){}' +
      // El modo de agrupación se siembra explícitamente: si dependiera del
      // valor por omisión, el día que alguien lo cambie esta prueba mediría
      // otra cosa sin decirlo.
      'try{localStorage.setItem("md_agrupacion_tareas","sucursal");}catch(e){}</script>' +
      '<script>window.addEventListener("load",function(){' +
      'setTimeout(function(){' + pulsar + 'setTimeout(function(){' + escribir +
      // ⚠ SE ABREN LOS BLOQUES ANTES DE CONTAR (17/sep/2026).
      //
      // Desde que la lista se pliega (`scripts/prueba-lista-plegable.js`), las
      // tarjetas nacen ESCONDIDAS detrás de sus botones. Este arnés no vino a
      // medir el plegado sino el filtrado, así que sin estos dos clics contaría
      // 0 tarjetas y reportaría «el buscador no filtra» sobre un buscador
      // intacto: un control caducado que manda a depurar lo que funciona.
      //
      // Se pulsa solo lo que se anuncia CERRADO (`aria-expanded="false"`), que
      // es lo mismo que mira la prueba del plegado: si alguien invirtiera ese
      // atributo, esto cerraría en vez de abrir y las dos pruebas caerían
      // juntas, en vez de que ésta tape a la otra.
      'function abrirNivel(sel){[].slice.call(document.querySelectorAll(sel))' +
      '  .forEach(function(b){if(b.getAttribute("aria-expanded")==="false")b.click();});}' +
      'setTimeout(function(){abrirNivel("button.cl-grupo-suc");' +
      'setTimeout(function(){abrirNivel("button.cl-grupo-per");' +
      'setTimeout(function(){' +
      'var cards=[].slice.call(document.querySelectorAll(".checklist-card"));' +
      'function suc(c){var e=c.querySelector(".cl-meta-sucursal");return e?(e.textContent||"").trim():"";}' +
      'document.title="RES "+JSON.stringify({' +
      ' tarjetas: cards.length,' +
      // EL MECANISMO: de qué sucursal son las que quedan. Contar tarjetas no
      // distingue «filtra» de «filtra al revés» ni de «borra al azar».
      ' dePH: cards.filter(function(c){return suc(c)===' + JSON.stringify(PH) + ';}).length,' +
      ' deLPA: cards.filter(function(c){return suc(c)===' + JSON.stringify(LPA) + ';}).length,' +
      ' encSuc: document.querySelectorAll(".cl-grupo-suc").length,' +
      ' encPer: document.querySelectorAll(".cl-grupo-per").length,' +
      ' btnAgrupar: document.querySelectorAll(".agrupar-toggle").length,' +
      ' rotulo: document.querySelector(".agrupar-toggle")' +
      '   ? (document.querySelector(".agrupar-toggle").textContent||"").replace(/\\s+/g," ").trim() : "",' +
      ' arbol: document.querySelectorAll("app-vista-organigrama").length,' +
      ' valorInput: (function(){var i=[].slice.call(document.querySelectorAll("input.form-input"))' +
      '   .filter(function(e){return (e.placeholder||"").indexOf("Buscar tarea")>=0;})[0];' +
      '   return i ? i.value : null;})(),' +
      ' sinBoton: window.__sinBoton ? 1 : 0,' +
      ' sinInput: window.__sinInput ? 1 : 0,' +
      ' ruta: location.pathname' +
      '});},600);},600);},900);},900);},3400);});</script>';

    const sano = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const html = sano.replace('<body>', '<body>' + iny);
    if (html === sano) return resolve({ error: 'no pude inyectar la sesión en el index' });

    let apiPedidos = 0;
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url.indexOf('/api/') === 0) {
        apiPedidos++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(CUERPO);
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
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-buscador-'));
      // La URL se arma AQUÍ con la barra puesta por código: en Git Bash, MSYS
      // convierte '/tareas' en 'C:/Program Files/Git/tareas' si pasa por una
      // variable de entorno, y el DOM llega vacío — que se lee como «la app no
      // pinta». Es la cuarta vez en este proyecto.
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--window-size=1440,1052', '--user-data-dir=' + perfil, '--virtual-time-budget=25000',
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
        if (!m) {
          const t = /<title>([\s\S]*?)<\/title>/.exec(dom);
          return resolve({ error: 'sin medición · title=' + (t ? JSON.stringify(t[1]) : 'ninguno') +
            ' · dom=' + dom.length + 'B' });
        }
        try { resolve({ dato: JSON.parse(m[1]), apiPedidos }); }
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
  console.log('[buscador] entrada: %d filas · %d en %s · %d en %s · término «%s»',
    FILAS.length, FILAS.filter((f) => f.store === PH).length, PH,
    FILAS.filter((f) => f.store === LPA).length, LPA, TERMINO);

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
        'Todos los conteos serían cero por falta de dato, no por el filtro.');
    }
    if (f.d.sinBoton) abortar('en "' + f.nombre + '" no encontré el botón «' + f.pulsa + '».');
    if (f.busca && f.d.sinInput) {
      abortar('en "' + f.nombre + '" no encontré el buscador para escribir en él. Sin escribir, ' +
        'la tabla mediría la pantalla sin filtrar y el verde no probaría nada.');
    }
    if (f.busca && f.d.valorInput !== f.busca) {
      abortar('en "' + f.nombre + '" el input quedó con «' + f.d.valorInput + '» y se escribió «' +
        f.busca + '». El evento no llegó a ngModel: sería un no-op que da verde.');
    }
    if (f.d.ruta !== '/tareas') {
      abortar('en "' + f.nombre + '" la app aterrizó en "' + f.d.ruta + '" y no en /tareas.');
    }
  }

  // ── LA TABLA ─────────────────────────────────────────────────────────────
  console.log('');
  console.log('escenario                             tarjetas  de PH  de LPA  encSuc  encPer  btn  árbol');
  console.log('─'.repeat(100));
  for (const f of filas) {
    console.log('%s %s %s %s %s %s %s %s',
      f.nombre.padEnd(37), String(f.d.tarjetas).padEnd(9), String(f.d.dePH).padEnd(6),
      String(f.d.deLPA).padEnd(7), String(f.d.encSuc).padEnd(7), String(f.d.encPer).padEnd(7),
      String(f.d.btnAgrupar).padEnd(4), String(f.d.arbol));
  }
  console.log('─'.repeat(100));
  const conBoton = filas.find((f) => f.d.rotulo);
  if (conBoton) console.log('rótulo del agrupador: «%s»', conBoton.d.rotulo);

  // ── LAS ASERCIONES ───────────────────────────────────────────────────────
  const fallos = [];
  const pide = (ok, msg) => { if (!ok) fallos.push(msg); };

  for (const f of filas) {
    const e = f.esperado;
    pide(f.d.tarjetas === e.tarjetas,
      f.nombre + ': ' + f.d.tarjetas + ' tarjeta(s) y se esperaban ' + e.tarjetas + '.');
    // LA QUE CAZA EL DEFECTO DE LA CAPTURA.
    pide(f.d.dePH === e.dePH,
      f.nombre + ': quedaron ' + f.d.dePH + ' tarjeta(s) de «' + PH + '» y se esperaban ' + e.dePH +
      '. Ése es el defecto que reportó David: buscó «' + TERMINO + '» y siguió viendo ' + PH + '.');
    pide(f.d.deLPA === e.deLPA,
      f.nombre + ': ' + f.d.deLPA + ' de «' + LPA + '» y se esperaban ' + e.deLPA + '.');
    pide(f.d.encSuc === e.encSuc,
      f.nombre + ': ' + f.d.encSuc + ' encabezado(s) de sucursal y se esperaban ' + e.encSuc +
      '. Con una sola sucursal en pantalla el encabezado diría siempre lo mismo y no se pinta.');
    pide(f.d.btnAgrupar === e.btnAgrupar,
      f.nombre + ': el agrupador salió ' + f.d.btnAgrupar + ' vez/veces y se esperaban ' +
      e.btnAgrupar + '. Hasta hoy sus dos condiciones eran contradictorias y NO se pintaba nunca.');
    pide(f.d.arbol === e.arbol,
      f.nombre + ': el árbol del organigrama salió ' + f.d.arbol + ' y se esperaba ' + e.arbol +
      '. David pidió expresamente que el organigrama no se toque.');
  }

  // ── EL BUSCADOR NO PUEDE «ENCONTRAR» MÁS DE LO QUE HABÍA ────────────────
  const sinBuscar = filas[0], buscando = filas[1];
  pide(buscando.d.tarjetas < sinBuscar.d.tarjetas,
    'buscar no redujo la lista de enviadas: ' + sinBuscar.d.tarjetas + ' → ' + buscando.d.tarjetas +
    '. Es el defecto original: el término se escribe y la lista no lo lee.');

  // ── GUARDIA DE DISCRIMINACIÓN ────────────────────────────────────────────
  // Sin esto, un filtro que devolviera SIEMPRE una tarjeta de LPA pasaría casi
  // todo lo de arriba. La muestra tiene que producir resultados distintos.
  const distintos = new Set(filas.map((f) => f.d.tarjetas + '/' + f.d.dePH + '/' + f.d.encSuc));
  if (distintos.size < 3) {
    abortar('los ' + filas.length + ' escenarios produjeron ' + distintos.size + ' resultado(s) ' +
      'distinto(s). Una muestra que no discrimina no prueba nada, por muchos casos que tenga.');
  }
  // Y que los dos lados de cada eje se ejerzan: con todos los escenarios
  // buscando, o ninguno agrupando, la mitad de las aserciones sería decorativa.
  if (!filas.some((f) => f.busca) || !filas.some((f) => !f.busca)) {
    abortar('no hay escenarios con y sin búsqueda: el eje no se ejerce.');
  }
  if (!filas.some((f) => f.d.encSuc > 0) || !filas.some((f) => f.d.encSuc === 0)) {
    abortar('los encabezados de sucursal salieron siempre igual: el agrupador no discrimina.');
  }

  console.log('');
  if (fallos.length) {
    console.error('[buscador] %d ASERCIÓN(ES) ROTA(S):', fallos.length);
    for (const f of fallos) console.error('  ✗ ' + f);
    process.exit(2);
  }
  console.log('[buscador] ✅ %d escenarios, %d resultados distintos. El buscador recorta en las ' +
    'cuatro bandejas, el agrupador existe y el árbol sigue en su sitio.', filas.length, distintos.size);
})();
