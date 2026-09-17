/**
 * 🗂️ LA BANDEJA DE TAREAS: cuatro botones, medidos en el DOM
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Instrucción de David (14/sep/2026), sobre una captura de la barra anterior:
 * «aquí lo vamos a cambiar, solo debe estar Pendientes del equipo · Enviadas
 * del equipo · Mis tareas pendientes · Mis tareas enviadas».
 *
 * Antes eran TRES grupos de fichas —Pendientes/Enviadas, los tres chips de
 * origen y Mis tareas/Toda la operación—, o sea tres ejes que había que cruzar
 * mentalmente. Ahora son las cuatro combinaciones escritas con todas sus letras.
 *
 * ─── LA PREGUNTA CARA, Y LA RAZÓN DE QUE ESTA PRUEBA EXISTA ───────────────
 * David eligió, enfrentado al número, que «del equipo» sea ESTRICTO: las de los
 * DEMÁS, no todas. El «Toda la operación 112» de antes incluía sus 9, así que
 * los dos botones se solapaban y sus badges no se podían sumar.
 *
 * Eso convierte la regla en algo comprobable y con un modo de fallo silencioso:
 * si el recorte fallara, «Pendientes del equipo» traería también las propias y
 * NADIE lo notaría —la lista se ve igual de plausible, solo con una tarea más—.
 * Por eso aquí no se cuentan solo tarjetas: se cuenta **cuántas de ellas llevan
 * MI NOMBRE**, que es el mecanismo mismo de la regla. En «del equipo» tiene que
 * ser CERO y en «mis tareas» TODAS.
 *
 * ─── LAS OTRAS TRES QUE CONTESTA ─────────────────────────────────────────
 *  · Los dos badges SUMAN el total sin repetir (3 + 2 = 5). Es lo que el eje
 *    anterior no podía dar.
 *  · Quien NO puede ver lo de otros ve DOS botones, no cuatro con dos inertes.
 *  · El historial también se reparte. Hasta hoy `cargarEnviadas()` no miraba de
 *    quién eran las tareas, así que los dos botones de enviadas habrían
 *    mostrado LA MISMA lista, uno de ellos mintiendo en su etiqueta — un
 *    defecto que solo se ve cuando el nombre del botón se vuelve específico.
 *
 * ─── POR QUÉ HAY DOS SESIONES ────────────────────────────────────────────
 * La supervisora ve los cuatro botones, y en «Pendientes del equipo» se le
 * pinta el ÁRBOL del organigrama en vez de la lista (es la vista de supervisión
 * de siempre). La trabajadora no tiene árbol, así que es la que deja contar
 * tarjetas sin que otra cosa las sustituya. Con una sola de las dos, la mitad
 * de las preguntas no se podría hacer.
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
  console.error('[bandeja] ABORTA: ' + motivo);
  console.error('[bandeja] No concluyas de esta corrida.');
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

const YO = 'Ana Prueba Bandeja';
const OTRA = 'Beto Prueba Bandeja';
const OTRA2 = 'Carmen Prueba Bandeja';

/**
 * La supervisora ES «Ana», y eso importa: la regla que se mide es «las mías
 * contra las de los demás», así que la sesión tiene que tener tareas propias
 * DENTRO del conjunto. Con una sesión sin tareas, «del equipo» y «todas» darían
 * el mismo número y la prueba pasaría sin ejercer el recorte.
 */
const SUPERVISORA = {
  uid: 's1', id: 's1', nombre: YO, usuario: 'ana', correo: 'ana@l.invalid',
  rol: 'trabajador', sucursales: ['Canindo'], puedeVerEstadisticas: true,
};
/** Sin banderas de supervisión: no ve lo de otros, así que no tiene árbol. */
const TRABAJADORA = {
  uid: 'w1', id: 'w1', nombre: YO, usuario: 'ana', correo: 'ana@l.invalid',
  rol: 'trabajador', sucursales: ['Canindo'],
};

const ITEMS = [{ id: 'i1', text: 'Punto uno' }, { id: 'i2', text: 'Punto dos' }];
const BASE = { store: 'Canindo', createdBy: YO, items: ITEMS, timestampCreacion: Date.now() };
const MANUAL = { _origenManual: true, _puestoId: 'anaquelista', _formatoCodigo: 'PR-01' };

/**
 * TRES pendientes de otros y DOS mías · DOS enviadas de otros y UNA mía.
 * Los números son distintos a propósito (3≠2, 2≠1): con conjuntos del mismo
 * tamaño, intercambiar los dos filtros daría el mismo resultado y la prueba no
 * distinguiría «recorta bien» de «recorta al revés».
 */
const FILAS = [
  { id: 'p1', date: HOY, time: '08:00', name: 'Apertura de pasillo', assigned: OTRA, ...BASE, ...MANUAL },
  { id: 'p2', date: HOY, time: '09:00', name: 'Acomodo de anaquel', assigned: OTRA, ...BASE, ...MANUAL },
  { id: 'p3', date: HOY, time: '10:00', name: 'Cierre de pasillo', assigned: OTRA2, ...BASE, ...MANUAL },
  { id: 'p4', date: HOY, time: '11:00', name: 'Limpiar bodega chica', assigned: YO, ...BASE },
  { id: 'p5', date: HOY, time: '12:00', name: 'Apoyo en caja', assigned: YO, ...BASE, ...MANUAL },
  // Enviadas: el poll de pendientes las descarta (`enviado === true`) y
  // `cargarEnviadas()` las recoge aparte, del mismo endpoint.
  { id: 'e1', date: HOY, time: '07:00', name: 'Corte de ayer uno', assigned: OTRA, enviado: true, ...BASE, ...MANUAL },
  { id: 'e2', date: HOY, time: '07:10', name: 'Corte de ayer dos', assigned: OTRA2, enviado: true, ...BASE, ...MANUAL },
  { id: 'e3', date: HOY, time: '07:20', name: 'Mi corte de ayer', assigned: YO, enviado: true, ...BASE, ...MANUAL },
];
const PEND_OTROS = 3, PEND_MIAS = 2, ENV_OTROS = 2, ENV_MIAS = 1;

const USUARIOS = [
  { id: 's1', nombre: YO, puestoId: 'anaquelista', activo: true, sucursales: ['Canindo'] },
  { id: 'u2', nombre: OTRA, puestoId: 'anaquelista', activo: true, sucursales: ['Canindo'] },
  { id: 'u3', nombre: OTRA2, puestoId: 'anaquelista', activo: true, sucursales: ['Canindo'] },
];

const CUERPO = JSON.stringify({ checklists: FILAS, usuarios: USUARIOS, areas: [] });

const B_EQ_PEND = 'Pendientes del equipo';
const B_EQ_ENV = 'Enviadas del equipo';
const B_MIS_PEND = 'Mis tareas pendientes';
const B_MIS_ENV = 'Mis tareas enviadas';

const ESCENARIOS = [
  // ── SUPERVISORA: los cuatro botones ────────────────────────────────────
  {
    nombre: 'supervisora, por omision', sesion: SUPERVISORA, pulsa: null,
    botones: 4, activo: B_EQ_PEND,
    // En «del equipo» se pinta el ÁRBOL, no la lista: es la vista de
    // supervisión de siempre. Por eso aquí las tarjetas son 0 y lo que se
    // comprueba son los badges.
    arbol: 1, tarjetas: 0, conMiNombre: 0,
    badges: { [B_EQ_PEND]: PEND_OTROS, [B_MIS_PEND]: PEND_MIAS },
  },
  {
    nombre: 'supervisora → mis pendientes', sesion: SUPERVISORA, pulsa: B_MIS_PEND,
    botones: 4, activo: B_MIS_PEND,
    arbol: 0, tarjetas: PEND_MIAS, conMiNombre: PEND_MIAS,
    badges: { [B_EQ_PEND]: PEND_OTROS, [B_MIS_PEND]: PEND_MIAS },
  },
  {
    nombre: 'supervisora → enviadas equipo', sesion: SUPERVISORA, pulsa: B_EQ_ENV,
    botones: 4, activo: B_EQ_ENV,
    // LA QUE CAZA EL DEFECTO: hasta hoy el historial no miraba de quién eran,
    // así que este botón habría traído las 3, con la mía dentro.
    arbol: 0, tarjetas: ENV_OTROS, conMiNombre: 0,
  },
  {
    nombre: 'supervisora → mis enviadas', sesion: SUPERVISORA, pulsa: B_MIS_ENV,
    botones: 4, activo: B_MIS_ENV,
    arbol: 0, tarjetas: ENV_MIAS, conMiNombre: ENV_MIAS,
  },
  // ── TRABAJADORA: solo los dos suyos ────────────────────────────────────
  {
    nombre: 'trabajadora, por omision', sesion: TRABAJADORA, pulsa: null,
    botones: 2, activo: B_MIS_PEND,
    arbol: 0, tarjetas: PEND_MIAS, conMiNombre: PEND_MIAS,
    badges: { [B_MIS_PEND]: PEND_MIAS },
  },
  {
    nombre: 'trabajadora → mis enviadas', sesion: TRABAJADORA, pulsa: B_MIS_ENV,
    botones: 2, activo: B_MIS_ENV,
    arbol: 0, tarjetas: ENV_MIAS, conMiNombre: ENV_MIAS,
  },
];

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function prepararCopia() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'md-bandeja-dist-'));
  const copiar = (de, a) => {
    fs.mkdirSync(a, { recursive: true });
    for (const e of fs.readdirSync(de, { withFileTypes: true })) {
      const o = path.join(de, e.name), d = path.join(a, e.name);
      if (e.isDirectory()) copiar(o, d); else fs.copyFileSync(o, d);
    }
  };
  copiar(DIST_REAL, destino);
  console.log('[bandeja] copia servida desde %s', destino);
  return destino;
}

function medir(esc, puerto) {
  return new Promise((resolve) => {
    // Se pulsa el botón REAL buscándolo por su texto, que es el que David
    // dictó: si alguien lo reescribe, esto falla ruidosamente en vez de medir
    // otra cosa.
    const pulsar = esc.pulsa
      ? 'var bs=[].slice.call(document.querySelectorAll(".cl-bandeja .vista-tab"));' +
        'var b=bs.filter(function(e){return (e.textContent||"").indexOf(' +
        JSON.stringify(esc.pulsa) + ')>=0;})[0];' +
        'if(b){b.click();}else{window.__sinBoton=1;}'
      : '';

    // OJO CON LOS `+` DEL FINAL DE CADA LÍNEA: sin uno, JS no da error — la
    // inserción automática de punto y coma parte la expresión en dos sentencias
    // válidas, el script sale truncado y el título nunca se fija. Se lee como
    // «la app no pintó». Ya pasó dos veces en este repo.
    const iny =
      '<script>try{localStorage.setItem("md_sesion_actual",' +
      JSON.stringify(JSON.stringify(esc.sesion)) + ');}catch(e){}' +
      'try{localStorage.setItem("md_token","token-de-medicion");}catch(e){}</script>' +
      '<script>window.addEventListener("load",function(){' +
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
      'setTimeout(function(){' + pulsar + 'setTimeout(function(){' +
      'abrirNivel("button.cl-grupo-suc");' +
      'setTimeout(function(){abrirNivel("button.cl-grupo-per");' +
      'setTimeout(function(){' +
      'var bs=[].slice.call(document.querySelectorAll(".cl-bandeja .vista-tab"));' +
      'var cards=[].slice.call(document.querySelectorAll(".checklist-card"));' +
      'document.title="RES "+JSON.stringify({' +
      ' botones: bs.map(function(b){' +
      '   var bg=b.querySelector(".vista-tab-badge");' +
      '   return {texto:(b.textContent||"").replace(/\\s+/g," ").replace(/\\s*\\d+\\s*$/,"").trim(),' +
      '           badge: bg ? Number((bg.textContent||"").trim()) : null,' +
      '           activo: b.className.indexOf("vista-tab-active")>=0 ? 1 : 0};}),' +
      ' tarjetas: cards.length,' +
      // EL MECANISMO, no la apariencia: de cuántas tarjetas visibles soy YO la
      // ASIGNADA. Es lo que separa «recorta» de «recorta al revés».
      //
      // ⚠ SE MIRA `.cl-meta-empleado`, NO el texto de la tarjeta. La primera
      // versión buscaba mi nombre en el `textContent` entero y dio 2 de 2 en
      // «Enviadas del equipo» —que se lee como «el recorte no aplica»— cuando
      // el recorte estaba bien: yo era la `createdBy` de las ocho filas del
      // fixture, así que mi nombre salía en tarjetas que no son mías. El
      // defecto estaba en la MEDICIÓN, no en la app, y era del tipo que manda a
      // depurar lo que funciona.
      ' conMiNombre: cards.filter(function(c){' +
      '   var e=c.querySelector(".cl-meta-empleado");' +
      '   return e && (e.textContent||"").trim() === ' + JSON.stringify(YO) + ';}).length,' +
      ' arbol: document.querySelectorAll("app-vista-organigrama").length,' +
      ' sinBoton: window.__sinBoton ? 1 : 0,' +
      ' ruta: location.pathname' +
      '});},600);},600);},1400);},3400);});</script>';

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
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-bandeja-'));
      // La URL se arma AQUÍ, con la barra puesta por código: en Git Bash MSYS
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
  console.log('[bandeja] entrada: %d filas · pendientes %d de otros + %d mías · enviadas %d de otros + %d mía',
    FILAS.length, PEND_OTROS, PEND_MIAS, ENV_OTROS, ENV_MIAS);

  DIST = prepararCopia();

  const filas = [];
  let puerto = 5700 + Math.floor(Math.random() * 200);
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
        'Todos los conteos serían cero por no haber dato, no por el filtro.');
    }
    if (f.d.sinBoton) {
      abortar('en "' + f.nombre + '" no encontré el botón «' + f.pulsa + '» para pulsarlo. ' +
        'Lo medido sería la pantalla sin tocar, no la que dice el escenario.');
    }
    if (f.d.botones === 0) {
      abortar('en "' + f.nombre + '" no se pintó ningún botón de la bandeja. Sin barra, ' +
        'cualquier conteo de abajo sería de una pantalla que no es la que se quiere medir.');
    }
    if (f.d.ruta !== '/tareas') {
      abortar('en "' + f.nombre + '" la app aterrizó en "' + f.d.ruta + '" y no en /tareas.');
    }
  }

  // ── LA TABLA ─────────────────────────────────────────────────────────────
  console.log('');
  console.log('escenario                        botones  activo                  árbol  tarjetas  con mi nombre');
  console.log('─'.repeat(104));
  for (const f of filas) {
    const act = (f.d.botones.find((b) => b.activo) || {}).texto || '(ninguno)';
    console.log('%s %s %s %s %s %s',
      f.nombre.padEnd(32), String(f.d.botones.length).padEnd(8), act.padEnd(23),
      String(f.d.arbol).padEnd(6), String(f.d.tarjetas).padEnd(9), String(f.d.conMiNombre));
  }
  console.log('─'.repeat(104));
  console.log('');
  console.log('badges');
  console.log('─'.repeat(104));
  for (const f of filas) {
    console.log('  %s %s', f.nombre.padEnd(32),
      f.d.botones.map((b) => b.texto + '=' + (b.badge === null ? '—' : b.badge)).join(' · '));
  }
  console.log('─'.repeat(104));

  // ── LAS ASERCIONES ───────────────────────────────────────────────────────
  const fallos = [];
  const pide = (ok, msg) => { if (!ok) fallos.push(msg); };

  for (const f of filas) {
    const act = (f.d.botones.find((b) => b.activo) || {}).texto || '(ninguno)';
    pide(f.d.botones.length === f.botones,
      f.nombre + ': ' + f.d.botones.length + ' botón(es) y se esperaban ' + f.botones +
      '. A quien no ve lo de otros se le pintan DOS, no cuatro con dos inertes.');
    pide(act === f.activo,
      f.nombre + ': el botón activo es «' + act + '» y debía ser «' + f.activo + '». Una barra ' +
      'sin nada seleccionado deja la lista mostrando algo que ningún botón nombra.');
    pide(f.d.arbol === f.arbol,
      f.nombre + ': el árbol del organigrama salió ' + f.d.arbol + ' y se esperaba ' + f.arbol + '.');
    pide(f.d.tarjetas === f.tarjetas,
      f.nombre + ': ' + f.d.tarjetas + ' tarjeta(s) y se esperaban ' + f.tarjetas + '.');
    // LA QUE IMPORTA: «del equipo» es estricto, decisión de David.
    pide(f.d.conMiNombre === f.conMiNombre,
      f.nombre + ': ' + f.d.conMiNombre + ' de las tarjetas llevan mi nombre y se esperaban ' +
      f.conMiNombre + '. «Del equipo» son las de los DEMÁS: si aparecen las mías, el recorte ' +
      'no está aplicando, y una lista con una tarea de más se ve igual de plausible.');
    if (f.badges) {
      for (const [texto, esperado] of Object.entries(f.badges)) {
        const b = f.d.botones.find((x) => x.texto === texto);
        pide(b && b.badge === esperado,
          f.nombre + ': el badge de «' + texto + '» dice ' + (b ? b.badge : '(no está)') +
          ' y el fixture tiene ' + esperado + '.');
      }
    }
  }

  // ── LOS DOS BADGES SUMAN EL TOTAL SIN REPETIR ────────────────────────────
  // Es lo que el eje anterior NO podía dar: «Toda la operación» incluía las
  // propias, así que los dos números se solapaban y no se podían leer juntos.
  const sup = filas[0];
  const bEq = sup.d.botones.find((b) => b.texto === B_EQ_PEND);
  const bMis = sup.d.botones.find((b) => b.texto === B_MIS_PEND);
  pide(bEq && bMis && bEq.badge + bMis.badge === PEND_OTROS + PEND_MIAS,
    'los badges no suman el total: ' + (bEq ? bEq.badge : '?') + ' + ' + (bMis ? bMis.badge : '?') +
    ' ≠ ' + (PEND_OTROS + PEND_MIAS) + '. O se repite una tarea en los dos botones o se pierde.');

  // ── GUARDIA DE DISCRIMINACIÓN ────────────────────────────────────────────
  const distintos = new Set(filas.map((f) => f.d.tarjetas + '/' + f.d.conMiNombre + '/' + f.d.arbol));
  if (distintos.size < 3) {
    abortar('los ' + filas.length + ' escenarios produjeron ' + distintos.size + ' resultado(s) ' +
      'distinto(s). Una muestra que no discrimina no prueba nada, por muchos casos que tenga.');
  }
  // Y que los dos lados del eje se ejerzan de verdad: sin un escenario con
  // `conMiNombre > 0` y otro con `=== 0` sobre tarjetas visibles, la regla
  // estricta no se estaría comparando contra nada.
  const conMias = filas.filter((f) => f.d.tarjetas > 0 && f.d.conMiNombre === f.d.tarjetas).length;
  const sinMias = filas.filter((f) => f.d.tarjetas > 0 && f.d.conMiNombre === 0).length;
  if (!conMias || !sinMias) {
    abortar('la muestra no enfrenta los dos lados del eje: ' + conMias + ' escenario(s) con ' +
      'tarjetas todas mías y ' + sinMias + ' con ninguna mía. Sin un sí y un no, «del equipo ' +
      'es estricto» no se comprueba.');
  }

  console.log('');
  if (fallos.length) {
    console.log('✗ %d aserción(es) rotas:', fallos.length);
    for (const f of fallos) console.log('   · %s', f);
    process.exit(2);
  }
  console.log('✓ los %d escenarios pasan · %d resultados distintos · %d con todas mías y %d con ninguna.',
    filas.length, distintos.size, conMias, sinMias);
  console.log('');
  console.log('  los badges suman sin repetir: %d del equipo + %d mías = %d',
    bEq.badge, bMis.badge, bEq.badge + bMis.badge);
  console.log('  «del equipo» es estricto: 0 tarjetas con mi nombre, en pendientes y en enviadas');
  console.log('  quien no ve lo de otros ve 2 botones, no 4');
  console.log('');
  console.log('Lo que esto NO prueba: que se vea bien, ni el comportamiento en un celular real.');
  console.log('Los cuatro rótulos son largos y en 390px la barra es otra pregunta.');
})();
