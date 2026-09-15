// ============================================================================
//  ¿LA PANTALLA DE USUARIOS DICE DE VERDAD LO QUE CONCEDE CADA PERMISO?
//  Mide en el DOM, sobre el `dist/` COMPILADO. No toca la base ni la red.
// ============================================================================
//
//  QUE PREGUNTA CONTESTA (§8.11: primero la pregunta, luego el artefacto).
//  NO es «¿se pinta el bloque?» — eso lo pasa cualquier `<div>` vacío. Es:
//
//    1. Con nivel COLABORADOR, ¿los nueve permisos explican lo que hacen, o
//       siguen con la línea genérica de antes? Se mide por LONGITUD del texto
//       y por la presencia de las dos mitades que se agregaron hoy: el límite
//       («qué NO puede») y la trampa («OJO»). Un permiso puede no tener
//       límite; lo que NO puede pasar es que NINGUNO lo tenga.
//
//    2. Con nivel ADMINISTRADOR, ¿aparece el desglose de lo que se concede?
//       Y sobre todo: ¿el bloque de los nueve DESAPARECE? Las dos mitades
//       importan — si los dos bloques se pintaran a la vez, la pantalla diría
//       dos cosas distintas del mismo usuario.
//
//    3. ¿La lista de lo que pierde un admin LIMITADO aparece solo al elegir
//       ese alcance? Ese bloque es la corrección de un rótulo que decía
//       «mismos privilegios» y era falso.
//
//  LA GUARDIA QUE MAS IMPORTA — DISCRIMINACION. Los tres escenarios tienen que
//  producir resultados DISTINTOS entre sí. Una muestra donde todos los perfiles
//  ven lo mismo no discrimina nada, y sus aserciones pasan sin comparar (la
//  lección del 31/ago: «un control correcto sobre una muestra que no discrimina
//  no discrimina»). Si los tres salen iguales, esto ABORTA.
//
//  Y LA OTRA: un cero no es un resultado hasta saber de cuántos salió. Si el
//  modal no llegó a abrirse, TODOS los conteos serían cero — y «no se abrió» y
//  «no se pintó» se ven idénticos. Por eso lo primero que se comprueba es que
//  el formulario esté en pantalla, y si no, se aborta en vez de concluir.
//
//  USO:  node scripts/prueba-permisos-desglose.js
//        NEG=1 node scripts/prueba-permisos-desglose.js   (control negativo)
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const DIST_REAL = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');
let DIST = DIST_REAL;

// El control negativo VACIA el catálogo de poderes del admin en la copia
// servida, para comprobar que las aserciones cuelgan de ese catálogo y no de
// que el `<div>` exista. Cambia UNA cosa; el resto del bundle queda intacto.
const NEG = process.env.NEG === '1';

function abortar(motivo) {
  console.error('');
  console.error('[desglose] ABORTA: ' + motivo);
  console.error('[desglose] No concluyo nada. «No pude medir» y «está mal» son cosas distintas.');
  process.exit(3);
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.CHROME_PATH,
].filter(Boolean).find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });

// ─── LA SESION ──────────────────────────────────────────────────────────────
// El DUEÑO, porque desde el 13/sep `veUsuarios` solo deja entrar a él y a
// Dirección General: con cualquier otro perfil la ruta /personal redirige y
// esto mediría otra pantalla. Va ya NORMALIZADO (rol admin + banderas), que es
// exactamente como el login lo guarda tras `conPermisosDeDueno`. Sembrar el
// perfil crudo mediría el login, no la pantalla.
const DUENO = {
  nombre: 'David Cisneros', usuario: 'david.cisneros',
  correo: 'davidcisneros2209@outlook.es',
  rol: 'admin', alcance: 'global', activo: true,
  sucursales: ['General (Acceso Total)'], areas: ['Todas las áreas'],
  puestoId: 'direccion-general',
  puedeAdministrarPersonal: true, puedeAdministrarAreas: true,
  puedeCrearChecklists: true, puedeCrearRutinas: true, puedeCrearTareasUnicas: true,
  puedeVerCalendario: true, puedeVerCheckstore: true,
  puedeVerEstadisticas: true, puedeVerHistorial: true,
};

const USUARIOS = [DUENO, {
  nombre: 'Ana Prueba Permisos', usuario: 'ana.prueba', rol: 'trabajador',
  activo: true, sucursales: ['Canindo'], puestoId: 'anaquelista',
}];
const CUERPO = JSON.stringify({ usuarios: USUARIOS, checklists: [], areas: [] });

// Los nueve permisos de Colaborador, por su TITULO en pantalla. Si alguien
// renombra uno, esto falla ruidosamente en vez de medir ocho y dar verde.
const LOS_NUEVE = [
  'Gestión de Checklists', 'Ver Manual por Puesto', 'Asignación de Tareas Únicas',
  'Acceso a Checkstore', 'Acceso a Estadísticas', 'Acceso a Calendario',
  'Auditoría e Historial', 'Administración de Áreas', 'Administración de Personal',
];

// El piso de longitud. La línea más larga de las viejas era «Visualización de
// tareas, rutinas y programación mensual.» = 47 caracteres; el umbral se fija
// MUY por encima para que ninguna de aquellas pudiera pasarlo por accidente.
const MINIMO_TEXTO = 120;

const ESCENARIOS = [
  { nombre: 'nivel Colaborador', rol: 'trabajador', alcance: null },
  { nombre: 'nivel Administrador (Global)', rol: 'admin', alcance: 'global' },
  { nombre: 'nivel Administrador (Limitado)', rol: 'admin', alcance: 'sucursales' },
];

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function prepararCopia() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'md-desglose-dist-'));
  const copiar = (de, a) => {
    fs.mkdirSync(a, { recursive: true });
    for (const e of fs.readdirSync(de, { withFileTypes: true })) {
      const o = path.join(de, e.name), d = path.join(a, e.name);
      if (e.isDirectory()) copiar(o, d); else fs.copyFileSync(o, d);
    }
  };
  copiar(DIST_REAL, destino);
  if (NEG) vaciarCatalogo(destino);
  return destino;
}

/**
 * CONTROL NEGATIVO — vacía el catálogo del admin en la copia servida.
 *
 * Ancla: el título del primer grupo, que es una cadena literal y por eso
 * SOBREVIVE a la minificación (los NOMBRES de función no: el minificador se
 * los come, lección del 13/sep al elegir marcador de despliegue).
 *
 * Se exige que el ancla aparezca EXACTAMENTE UNA VEZ. Un reemplazo que no pega
 * es un no-op, y un no-op da verde: «el control no detecta» leído como «no hay
 * nada que detectar». Ya pasó dos veces en este repo.
 */
function vaciarCatalogo(destino) {
  // EL ANCLA VA SIN LA VOCAL ACENTUADA, y eso no es un detalle: el bundle
  // escribe «menú» como `menú`, así que el literal con acento NO CASA y el
  // primer intento reportó «no encontré el catálogo en ningún chunk». Un ancla
  // que no pega es un no-op, y un no-op da verde. Aquí abortó, que era lo
  // correcto, pero el modo de fallo es el de siempre: la herramienta de
  // verificación necesitaba verificarse antes que lo verificado.
  const ancla = 'titulo:"Apartados que se le abren en el men';
  let tocados = 0;
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { recorrer(f); continue; }
      if (!f.endsWith('.js')) continue;
      const s = fs.readFileSync(f, 'utf8');
      const veces = s.split(ancla).length - 1;
      if (!veces) continue;
      if (veces !== 1) abortar('el ancla del control negativo aparece ' + veces + ' veces en ' +
        e.name + '. Con más de una, no sé qué estoy cambiando.');

      // El minificador se come el nombre `PODERES_ADMIN` (los identificadores
      // no sobreviven; los LITERALES de cadena sí — la misma razón por la que
      // un marcador de despliegue nunca puede ser un nombre de función). Así
      // que el nombre de la variable del primer grupo se LEE del bundle, y con
      // él se localiza el arreglo que la contiene.
      const m = /([A-Za-z_$][\w$]*)\s*=\s*\{\s*titulo:"Apartados que se le abren en el men/.exec(s);
      if (!m) abortar('encontré el ancla pero no el nombre de la variable del primer grupo.');
      const primerGrupo = m[1];
      const arreglo = new RegExp('=\\[' + primerGrupo + ',[^\\]]*\\]');
      if (!arreglo.test(s)) {
        abortar('no encontré el arreglo que agrupa los cuatro bloques (buscaba «=[' +
          primerGrupo + ',…]»). Sin vaciarlo, el control no probaría nada.');
      }
      const roto = s.replace(arreglo, '=[]');
      if (roto === s) abortar('el control negativo no cambió NADA en ' + e.name + '. ' +
        'Un no-op prueba tanto como un cero sin denominador, y encima da verde.');
      fs.writeFileSync(f, roto);
      tocados++;
    }
  };
  recorrer(destino);
  if (!tocados) abortar('el control negativo no encontró el catálogo en ningún chunk servido.');
  console.log('[desglose] CONTROL NEGATIVO: catálogo del admin vaciado en %d archivo(s)', tocados);
}

function medir(esc, puerto) {
  return new Promise((resolve) => {
    const sesion = { ...DUENO };

    // Se cambia el <select> de Nivel de Acceso y el radio de alcance como los
    // cambiaría una persona: por su valor, disparando el evento que Angular
    // escucha. Tocar la propiedad del componente a mano mediría otra cosa.
    // EL NIVEL DE ACCESO PRIMERO, Y EL ALCANCE EN OTRO TICK.
    // El bloque de alcance vive bajo `*ngIf="formRol === 'admin'"`, así que en
    // el mismo tick del cambio de rol TODAVIA NO EXISTE en el DOM. La primera
    // versión buscaba el radio en la misma línea y abortó con «no encontré el
    // radio»: un aborto correcto, que dijo «no pude medir» en vez de fingir un
    // cero. Es justo lo que la guardia estaba para hacer.
    const ajustar =
      'var sel=[].slice.call(document.querySelectorAll("select")).filter(function(s){' +
      '  return (s.textContent||"").indexOf("Administrador (Panel Total)")>=0;})[0];' +
      'if(!sel){window.__sinSelect=1;}else{sel.value=' + JSON.stringify(esc.rol) + ';' +
      '  sel.dispatchEvent(new Event("change",{bubbles:true}));}';

    const ajustarAlcance = esc.alcance === 'sucursales'
      ? 'var r=document.querySelector(\'input[name="alcance"][value="sucursales"]\');' +
        'if(r){r.click();}else{window.__sinRadio=1;}'
      : '';

    // ⚠ CADA LINEA TERMINA EN `+`. Sin uno, JS no da error: la inserción
    // automática de punto y coma parte la expresión en dos sentencias válidas,
    // el script sale truncado y el título nunca se fija — que se lee como «la
    // app no pintó».
    const iny =
      '<script>try{localStorage.setItem("md_sesion_actual",' +
      JSON.stringify(JSON.stringify(sesion)) + ');}catch(e){}' +
      'try{localStorage.setItem("md_token","token-de-medicion");}catch(e){}</script>' +
      '<script>window.addEventListener("load",function(){' +
      'setTimeout(function(){' +
      // Se pulsa el botón REAL de «Nuevo Usuario», no se fuerza `isModalOpen`:
      // así el guard de `abrirModal()` se ejerce de verdad.
      'var bs=[].slice.call(document.querySelectorAll("button.btn-primary"));' +
      'var b=bs.filter(function(e){return /Nuevo|Agregar|Usuario/i.test(e.textContent||"");})[0];' +
      'if(b){b.click();}else{window.__sinBoton=1;}' +
      'setTimeout(function(){' + ajustar + 'setTimeout(function(){' + ajustarAlcance +
      'setTimeout(function(){' +
      'var items=[].slice.call(document.querySelectorAll(".premium-permissions-list .premium-perm-item"));' +
      'var lee=function(n){return (n?(n.textContent||""):"").replace(/\\s+/g," ").trim();};' +
      'document.title="RES "+JSON.stringify({' +
      // ── el bloque de los nueve ────────────────────────────────────────────
      ' nueve: items.map(function(i){' +
      '   return {titulo: lee(i.querySelector("strong")),' +
      // Se mide el bloque de texto COMPLETO del permiso, título incluido. Es lo
      // que la persona lee, y el umbral se fijó contra eso: la más larga de las
      // descripciones viejas, con su título delante, daba ~75 caracteres
      // («Acceso a Calendario» + «Visualización de tareas, rutinas y
      // programación mensual.»), así que 120 deja margen y ninguna de aquellas
      // podía pasarlo por accidente.
      '           largo: lee(i.querySelector(".perm-text")).length,' +
      '           no: i.querySelectorAll(".perm-no").length,' +
      '           ojo: i.querySelectorAll(".perm-ojo").length};}),' +
      // ── el desglose del admin ─────────────────────────────────────────────
      ' desglose: document.querySelectorAll(".pm-desglose").length,' +
      ' grupos: document.querySelectorAll(".pm-desglose .pm-grupo").length,' +
      ' poderes: document.querySelectorAll(".pm-desglose .pm-poder").length,' +
      ' soloGlobal: document.querySelectorAll(".pm-desglose .pm-solo-global").length,' +
      ' pierde: document.querySelectorAll(".pm-pierde li").length,' +
      // ── guardias: ¿de verdad estoy mirando el formulario? ─────────────────
      ' formulario: document.querySelectorAll(".form-label").length,' +
      ' sinBoton: window.__sinBoton ? 1 : 0,' +
      ' sinSelect: window.__sinSelect ? 1 : 0,' +
      ' sinRadio: window.__sinRadio ? 1 : 0,' +
      ' ruta: location.pathname' +
      '});},700);},700);},900);},3200);});</script>';

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
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-desglose-'));
      // La URL se arma AQUI con la barra puesta por codigo: en Git Bash, MSYS
      // convierte '/personal' en 'C:/Program Files/Git/personal' si pasa por
      // una variable de entorno, y el DOM llega vacio.
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--window-size=1440,1052', '--user-data-dir=' + perfil, '--virtual-time-budget=25000',
        '--disable-background-networking', '--disable-sync', '--disable-component-update',
        '--disable-features=PushMessaging,OptimizationHints',
        '--dump-dom', 'http://localhost:' + puerto + '/personal'],
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
        try { resolve({ dato: JSON.parse(m[1]), apiPedidos, dom: dom.length }); }
        catch (e) { resolve({ error: 'el título no era JSON: ' + m[1].slice(0, 140) }); }
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Y EN UN TELEFONO
// ═══════════════════════════════════════════════════════════════════════════
//  El desglose son treinta y un renglones de texto largo en una pantalla que
//  hoy solo se abre en escritorio — pero la operación entera pasa por el
//  celular, y este repo ya se llevó dos sustos ahí. Se mide aparte porque la
//  pregunta es otra: no «¿dice lo correcto?» sino «¿CABE?».
//
//  SE USA UN IFRAME, NO `--window-size`. Chrome topa el ancho mínimo de ventana
//  en 504px, así que pedir 390 devuelve 504 — por encima del breakpoint de 480,
//  o sea que la media query del teléfono NO SE APLICARIA y la prueba mediría la
//  versión de escritorio dando verde sin tocar el caso (lección del 7/sep). Un
//  documento dentro de un marco evalúa sus media queries contra el marco.
//
//  EL TESTIGO ES `--tap-min`, que vale 44px en táctil y vive en `styles.css`,
//  FUERA de lo que este cambio toca. Si no vale 44, el iframe no está siendo
//  tratado como teléfono y no se concluye nada (§8.11 b: la guardia va sobre la
//  entrada real, nunca sobre un proxy del propio arreglo).
const MOVIL = { ancho: 390, alto: 780 };

function medirMovil(puerto) {
  return new Promise((resolve) => {
    // Cada renglón es un elemento del arreglo: así ninguna línea puede quedar
    // sin su operador y truncar el guion en silencio.
    const guion = [
      'try { localStorage.setItem("md_sesion_actual", ' + JSON.stringify(JSON.stringify(DUENO)) + '); } catch (e) {}',
      'try { localStorage.setItem("md_token", "token-de-medicion"); } catch (e) {}',
      'var res = {};',
      'var f = document.createElement("iframe");',
      'f.width = ' + MOVIL.ancho + '; f.height = ' + MOVIL.alto + '; f.src = "/personal";',
      'document.body.appendChild(f);',
      'var t0 = Date.now();',
      'function fin() { document.title = "RES " + JSON.stringify(res); }',
      'function dentro() { try { return f.contentDocument; } catch (e) { return null; } }',
      'function espera(sel, cb, ms) { var g = function () {',
      '  var d = dentro();',
      '  if (d && d.querySelector(sel)) return cb(true);',
      '  if (Date.now() - t0 > ms) return cb(false);',
      '  setTimeout(g, 150); }; g(); }',
      'espera("button.btn-primary", function (hay) {',
      '  var w = f.contentWindow, d = dentro();',
      '  res.marco = w ? (w.innerWidth + "x" + w.innerHeight) : "sin acceso";',
      '  res.tapMin = w ? w.getComputedStyle(d.documentElement).getPropertyValue("--tap-min").trim() : "?";',
      '  if (!hay) { res.error = "nunca apareció el botón de Nuevo Usuario"; return fin(); }',
      '  var bs = [].slice.call(d.querySelectorAll("button.btn-primary"));',
      '  var b = bs.filter(function (e) { return /Nuevo|Agregar|Usuario/i.test(e.textContent || ""); })[0];',
      '  if (!b) { res.error = "el botón existe pero no casa por texto"; return fin(); }',
      '  b.click();',
      '  setTimeout(function () {',
      '    var sel = [].slice.call(d.querySelectorAll("select")).filter(function (s) {',
      '      return (s.textContent || "").indexOf("Administrador (Panel Total)") >= 0; })[0];',
      '    if (!sel) { res.error = "no apareció el selector de Nivel de Acceso"; return fin(); }',
      '    sel.value = "admin";',
      '    sel.dispatchEvent(new Event("change", { bubbles: true }));',
      '    setTimeout(function () {',
      '      var filas = [].slice.call(d.querySelectorAll(".pm-desglose .pm-poder"));',
      '      res.filas = filas.length;',
      '      if (!filas.length) { res.error = "el desglose no pintó una sola fila"; return fin(); }',
      // EL BORDE DERECHO CONTRA EL ANCHO DE LA PANTALLA, que es la métrica que
      // sí contesta. `scrollWidth > clientWidth` de la fila da CERO aunque se
      // salga, porque la fila mide 100% de un padre que ya se desbordó: es un
      // proxy del arreglo, no el arreglo (§8.11 b, cobrado el 14/sep).
      '      var maxDer = 0, minFs = 999, cortadas = 0;',
      '      filas.forEach(function (el) {',
      '        var r = el.getBoundingClientRect();',
      '        var der = Math.round(r.right);',
      '        if (der > maxDer) maxDer = der;',
      '        if (der > ' + MOVIL.ancho + ') cortadas++;',
      '        var fs = parseFloat(w.getComputedStyle(el.querySelector(".pm-texto") || el).fontSize);',
      '        if (fs && fs < minFs) minFs = fs; });',
      '      res.bordeDerecho = maxDer;',
      '      res.cortadas = cortadas;',
      '      res.fuenteMin = minFs;',
      '      res.docScroll = d.documentElement.scrollWidth;',
      '      res.docAncho = w.innerWidth;',
      '      fin();',
      '    }, 700);',
      '  }, 700);',
      '}, 9000);',
    ].join('\n');

    const envoltura = '<!doctype html><html><head><meta charset="utf-8">' +
      '<style>body{margin:0;background:#333}iframe{border:0;display:block}</style></head><body>' +
      '<script>' + guion + '</script></body></html>';

    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/marco') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        return res.end(envoltura);
      }
      if (url.indexOf('/api/') === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(CUERPO);
      }
      if (url === '/' || !path.extname(url)) {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(path.join(DIST, 'index.html'), 'utf8'));
      }
      const f = path.join(DIST, url);
      if (!fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('no'); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.on('error', (e) => resolve({ error: 'el servidor local no levantó: ' + e.message }));
    srv.listen(puerto, () => {
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-desglose-mov-'));
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--window-size=1100,1000', '--user-data-dir=' + perfil, '--virtual-time-budget=25000',
        '--disable-background-networking', '--disable-sync', '--disable-component-update',
        '--dump-dom', 'http://localhost:' + puerto + '/marco'],
        { stdio: ['ignore', 'pipe', 'ignore'] });
      let dom = '';
      h.stdout.on('data', (d) => { dom += d.toString('utf8'); });
      h.on('error', (e) => { srv.close(); resolve({ error: 'no pude lanzar Chrome: ' + e.message }); });
      h.on('close', () => {
        srv.close();
        const m = /<title>RES ([\s\S]*?)<\/title>/.exec(dom);
        if (!m) return resolve({ error: 'sin medición móvil · dom=' + dom.length + 'B' });
        try { resolve({ dato: JSON.parse(m[1]) }); }
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
  console.log('[desglose] entrada: %d perfiles servidos · %d permisos de colaborador esperados · umbral de texto %d caracteres',
    USUARIOS.length, LOS_NUEVE.length, MINIMO_TEXTO);

  DIST = prepararCopia();

  const filas = [];
  let puerto = 5900 + Math.floor(Math.random() * 200);
  for (const e of ESCENARIOS) {
    const r = await medir(e, puerto++);
    if (r.error) {
      abortar('escenario "' + e.nombre + '": ' + r.error +
        '. Una medición fallida no es un cero: son dos cosas distintas y se ven igual.');
    }
    filas.push({ ...e, d: r.dato, apiPedidos: r.apiPedidos, dom: r.dom });
  }

  // ── GUARDIAS, antes de comparar nada ─────────────────────────────────────
  for (const f of filas) {
    if (f.d.ruta !== '/personal') {
      abortar('en "' + f.nombre + '" la app aterrizó en "' + f.d.ruta + '" y no en /personal. ' +
        'Probablemente el guard rechazó la sesión: lo medido no es esta pantalla.');
    }
    if (f.d.sinBoton) abortar('en "' + f.nombre + '" no encontré el botón de «Nuevo Usuario».');
    if (f.d.sinSelect) abortar('en "' + f.nombre + '" no encontré el selector de Nivel de Acceso. ' +
      'El modal no llegó a abrirse, así que TODOS los conteos serían cero por eso.');
    if (f.d.sinRadio) abortar('en "' + f.nombre + '" no encontré el radio de alcance «sucursales».');
    if (!f.d.formulario) abortar('en "' + f.nombre + '" no se pintó una sola etiqueta de formulario.');
    if (!f.apiPedidos) abortar('el escenario "' + f.nombre + '" nunca pidió /api/*.');
  }

  // ── LA TABLA ─────────────────────────────────────────────────────────────
  const col = (f) => f.d;
  console.log('');
  console.log('escenario                        9 permisos  desglose  grupos  poderes  «solo Global»  pierde');
  console.log('─'.repeat(100));
  for (const f of filas) {
    console.log('%s %s %s %s %s %s %s',
      f.nombre.padEnd(32), String(col(f).nueve.length).padEnd(11),
      String(col(f).desglose).padEnd(9), String(col(f).grupos).padEnd(7),
      String(col(f).poderes).padEnd(8), String(col(f).soloGlobal).padEnd(14),
      String(col(f).pierde));
  }
  console.log('─'.repeat(100));

  const colab = filas[0];
  if (colab.d.nueve.length) {
    console.log('');
    console.log('los nueve permisos de Colaborador — caracteres de su descripción');
    console.log('─'.repeat(100));
    for (const p of colab.d.nueve) {
      console.log('  %s %s  límite:%s  ojo:%s',
        p.titulo.padEnd(30), String(p.largo).padStart(5), p.no, p.ojo);
    }
    console.log('─'.repeat(100));
  }

  // ── LAS ASERCIONES ───────────────────────────────────────────────────────
  const fallos = [];
  const pide = (ok, msg) => { if (!ok) fallos.push(msg); };
  const admG = filas[1], admL = filas[2];

  // 1 · COLABORADOR: los nueve, y explicados
  pide(colab.d.nueve.length === 9,
    'con nivel Colaborador se pintaron ' + colab.d.nueve.length + ' permisos y son 9. ' +
    'Si falta alguno, alguien lo quitó del HTML sin quitarlo de la ficha.');
  for (const titulo of LOS_NUEVE) {
    const p = colab.d.nueve.find((x) => x.titulo === titulo);
    if (!p) { fallos.push('falta el permiso «' + titulo + '» en pantalla.'); continue; }
    pide(p.largo >= MINIMO_TEXTO,
      '«' + titulo + '» se explica en ' + p.largo + ' caracteres y el mínimo es ' + MINIMO_TEXTO +
      '. Sigue con la descripción corta de antes: no alcanza para decidir si concederlo.');
  }
  // Las dos mitades NUEVAS. No se exige que TODOS las tengan —un permiso puede
  // no tener límite— pero sí que el mecanismo exista en la mayoría: si nadie
  // las trae, el bloque se pintó con el texto viejo.
  const conNo = colab.d.nueve.filter((p) => p.no > 0).length;
  const conOjo = colab.d.nueve.filter((p) => p.ojo > 0).length;
  pide(conNo >= 6, 'solo ' + conNo + ' de 9 permisos dicen qué NO puede hacer quien lo tiene. ' +
    'El límite es la mitad que evita conceder de más.');
  pide(conOjo === 9, 'solo ' + conOjo + ' de 9 permisos traen su «OJO». Los nueve comparten uno ' +
    '—convierten a la persona en supervisora de su sucursal— y ese es el efecto que nadie ve venir.');

  // 2 · ADMINISTRADOR: aparece el desglose Y desaparecen los nueve
  pide(admG.d.desglose === 1,
    'con nivel Administrador no se pintó el desglose (pm-desglose = ' + admG.d.desglose + '). ' +
    'La pantalla vuelve a conceder 135 condiciones sin decir una palabra.');
  pide(admG.d.grupos === 4,
    'el desglose trae ' + admG.d.grupos + ' grupos y son 4 (menú · poder en pantalla · el OJO ' +
    'de las nueve banderas · lo que NO gana).');
  pide(admG.d.poderes >= 25,
    'el desglose lista ' + admG.d.poderes + ' poderes. Con menos de 25 el catálogo llegó ' +
    'recortado: son 31 líneas medidas.');
  // SON CUATRO, CONTADOS EN EL CATALOGO: Cierre Mensual, reabrir una tarea
  // cerrada, archivar el mes y generar las credenciales de plaza. El primer
  // borrador de esta línea decía «y son 5» — un número puesto a ojo, en el
  // mensaje de una aserción, que es el peor sitio para equivocarse: el día que
  // falle, manda a buscar un quinto que no existe.
  pide(admG.d.soloGlobal === 4,
    'hay ' + admG.d.soloGlobal + ' poderes marcados como «solo con acceso Global» y son 4. ' +
    'Sin esa marca, un admin limitado parece tener poderes que no tiene.');
  pide(admG.d.nueve.length === 0,
    'con nivel Administrador se siguen pintando ' + admG.d.nueve.length + ' permisos de ' +
    'Colaborador junto al desglose. Los dos bloques a la vez dicen dos cosas distintas ' +
    'del mismo usuario.');

  // 3 · LIMITADO: la lista de lo que pierde, solo ahí
  pide(admL.d.pierde === 6,
    'el admin Limitado ve ' + admL.d.pierde + ' renglones de «lo que NO va a poder hacer» y son 6.');
  pide(admG.d.pierde === 0,
    'el admin GLOBAL también ve la lista de lo que pierde un limitado (' + admG.d.pierde +
    ' renglones). Ese bloque es de la otra opción: ahí confunde.');
  pide(colab.d.desglose === 0,
    'el desglose del Administrador se está pintando con nivel Colaborador.');

  // ── GUARDIA DE DISCRIMINACION ────────────────────────────────────────────
  // Sin esto, un bloque que se pintara SIEMPRE igual pasaría todo lo de arriba.
  const huella = (f) => [f.d.nueve.length, f.d.desglose, f.d.pierde].join('/');
  const huellas = new Set(filas.map(huella));
  if (huellas.size !== filas.length) {
    abortar('los ' + filas.length + ' escenarios produjeron ' + huellas.size + ' resultados ' +
      'distintos: ' + [...huellas].join(' · ') + '. Una muestra que no discrimina no prueba nada, ' +
      'por bien escritas que estén las aserciones.');
  }

  console.log('');
  console.log('[desglose] discriminación: %d escenarios → %d huellas distintas (%s)',
    filas.length, huellas.size, [...huellas].join(' · '));

  // ── Y EN UN TELEFONO DE 390px ────────────────────────────────────────────
  const mov = await medirMovil(puerto++);
  if (mov.error) abortar('la medición móvil: ' + mov.error);
  if (mov.dato.error) abortar('la medición móvil: ' + mov.dato.error);
  const d = mov.dato;
  if (d.tapMin !== '44px') {
    abortar('dentro del marco --tap-min vale «' + d.tapMin + '» y en táctil vale 44px. ' +
      'El iframe no está siendo tratado como teléfono, así que lo de abajo sería la ' +
      'versión de escritorio con etiqueta de móvil.');
  }
  console.log('');
  console.log('en un teléfono de %dpx — marco real %s · --tap-min %s',
    MOVIL.ancho, d.marco, d.tapMin);
  console.log('─'.repeat(100));
  console.log('  filas del desglose ......... %d', d.filas);
  console.log('  borde derecho más lejano ... %dpx (la pantalla mide %d)', d.bordeDerecho, MOVIL.ancho);
  console.log('  filas que se salen ......... %d de %d', d.cortadas, d.filas);
  console.log('  fuente más chica ........... %spx (el piso táctil es 12)', d.fuenteMin);
  console.log('  scroll del documento ....... %d de %d de ventana', d.docScroll, d.docAncho);
  console.log('─'.repeat(100));

  pide(d.cortadas === 0,
    d.cortadas + ' de ' + d.filas + ' filas del desglose se salen de un teléfono de ' +
    MOVIL.ancho + 'px (borde derecho en ' + d.bordeDerecho + 'px).');
  pide(d.fuenteMin >= 12,
    'la fuente más chica del desglose mide ' + d.fuenteMin + 'px y el piso táctil del ' +
    'sistema de diseño es 12px.');

  if (fallos.length) {
    console.error('');
    console.error('[desglose] %d FALLO(S):', fallos.length);
    for (const f of fallos) console.error('   ✗ ' + f);
    console.error('');
    process.exit(2);
  }
  console.log('[desglose] ✓ %d escenarios, todas las aserciones en verde.', filas.length);
  console.log('');
})();
