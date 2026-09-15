/**
 * 📕 DAR UNA TAREA DEL MANUAL A MANO — el documento que sale, capturado
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Instrucción de David (14/sep/2026): «los catálogos que creaste de acuerdo a
 * los puestos, los dejarás creados como un catálogo para poder agregarlo a
 * cualquier trabajador, quiero que le aparezca los usuarios que tiene de
 * acuerdo su sucursal».
 *
 * ─── LO QUE MIDE, Y POR QUÉ NO BASTA CON MIRAR LA PANTALLA ────────────────
 * Que el modal se abra y los botones se pinten no prueba lo que importa. Lo que
 * importa es **el documento que se escribe**, porque de ahí salen tres cosas
 * que nadie puede corregir después:
 *
 *  1 · EL SELLO DE LA NORMA (invariante §4). La tarea tiene que nacer con su
 *      documento, su código y su VERSIÓN. Sin eso, dentro de seis meses no se
 *      podrá decir con qué versión del manual se juzgó a esa persona, que es
 *      justo lo que la hoja de auditoría necesita poder imprimir.
 *
 *  2 · EL CANDADO. `_origenManual: true` es lo que impide editarla y borrarla.
 *      Si saliera sin él, sería una tarea libre con cara de manual.
 *
 *  3 · LA LLAVE DE IDEMPOTENCIA, que es la misma del robot
 *      (`man_<tarea>_<periodo>_<sucursal>_<persona>`, sin el puesto dentro).
 *      De ella depende que asignar a mano algo que el robot ya entrega NO
 *      produzca dos documentos para el mismo punto. Un duplicado no se ve: solo
 *      sube el denominador de esa persona y su cumplimiento baja sin motivo.
 *
 * Por eso el servidor de esta prueba **captura el POST** y lo compara campo por
 * campo contra el catálogo real. Un `*ngIf` no es una función que se pueda
 * llamar, y un payload tampoco se puede leer desde el código: o se recoge lo
 * que de verdad salió por el cable, o no se sabe.
 *
 * ─── EL CONTROL NEGATIVO, POR MECANISMO ──────────────────────────────────
 * El último escenario vuelve a asignar LO MISMO habiendo servido ya ese
 * checklist en la lista del día. Si la idempotencia funciona, no sale un
 * segundo POST y la pantalla lo dice. Si alguien cambiara la llave —o quitara
 * la comprobación— saldría un POST más, y esta prueba lo cuenta.
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
  console.error('[catalogo] ABORTA: ' + motivo);
  console.error('[catalogo] No concluyas de esta corrida.');
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

/**
 * LO QUE SE VA A ASIGNAR, leído del catálogo REAL con `tsc` y no escrito a mano.
 *
 * Si los valores esperados se teclearan aquí, esta prueba diría que el sello es
 * correcto comparándolo consigo misma. Se compila el `.ts` y se usa la misma
 * función que usa la app: así, el día que el manual cambie de versión, lo que
 * cambia es el dato y no la expectativa.
 */
function leerCatalogo() {
  const { execFileSync } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-cat-ts-'));
  const raiz = path.join(__dirname, '..');
  try {
    execFileSync('npx', ['tsc',
      path.join(raiz, 'src/app/shared/tareas-manual.catalogo.ts'),
      path.join(raiz, 'src/app/shared/organigrama.catalogo.ts'),
      '--outDir', tmp, '--module', 'commonjs', '--target', 'es2019',
      '--skipLibCheck', '--moduleResolution', 'node'],
      { stdio: 'pipe', shell: process.platform === 'win32' });
  } catch (e) {
    abortar('no pude compilar el catálogo con tsc: ' + String(e.stdout || e.message).slice(0, 300));
  }
  const cat = require(path.join(tmp, 'tareas-manual.catalogo.js'));
  const org = require(path.join(tmp, 'organigrama.catalogo.js'));
  return { cat, org };
}

const { cat, org } = leerCatalogo();

/**
 * EL CASO: una tarea de un puesto que NO es el de la persona.
 *
 * Es el caso que David pidió —dar del catálogo a cualquier trabajador— y
 * además el único que prueba algo: si se eligiera una tarea del propio puesto
 * de la persona, el robot ya se la entregaría y no se sabría si el documento lo
 * creó la asignación a mano o la entrega automática.
 */
const PUESTO_ORIGEN = 'encargado-sucursal';
const TAREAS_ORIGEN = cat.tareasDePuesto(PUESTO_ORIGEN).filter((t) => !t.soloPorEvento);
if (!TAREAS_ORIGEN.length) {
  abortar('el puesto "' + PUESTO_ORIGEN + '" no tiene tareas automáticas en el catálogo, ' +
    'así que este caso no se puede montar. El catálogo cambió: elige otro puesto.');
}
const TAREA = TAREAS_ORIGEN[0];
const MANUAL = cat.manualDePuesto(PUESTO_ORIGEN);
const PUESTO_PERSONA = 'anaquelista';
if (cat.tareasAutomaticasDePuesto(PUESTO_PERSONA).some((t) => t.id === TAREA.id)) {
  abortar('la tarea elegida TAMBIÉN la recibe «' + PUESTO_PERSONA + '» por su puesto, así que ' +
    'este escenario no distinguiría la asignación a mano de la entrega automática.');
}

const SUCURSAL = 'Canindo';
const DESTINO = 'Ana Prueba Catalogo';
const YO = 'Jefa Prueba Catalogo';

const SESION = {
  uid: 'a1', id: 'a1', nombre: YO, usuario: 'jefa', correo: 'jefa@l.invalid',
  rol: 'admin', alcance: 'sucursales', sucursales: [SUCURSAL],
};

const USUARIOS = [
  { id: 'a1', nombre: YO, puestoId: 'encargado-sucursal', activo: true, rol: 'admin',
    alcance: 'sucursales', sucursales: [SUCURSAL] },
  { id: 'u2', nombre: DESTINO, puestoId: PUESTO_PERSONA, activo: true, rol: 'trabajador',
    sucursales: [SUCURSAL] },
];

/**
 * ⚠ AQUI NO SE REPLICA LA LLAVE, Y ESA ES LA CORRECCION QUE ESTA PRUEBA APRENDIO.
 *
 * El primer intento la reconstruia a mano: `man_<slug>_<periodo>_...`. Fallo, y
 * fallo BIEN: mi periodo decia `2026-09-14` y el de la app `2026-9-14`, porque
 * `llavePeriodo` arma la fecha con numeros sin rellenar. Con esa llave falsa, el
 * escenario de idempotencia servia un checklist que la app no reconocia, asi que
 * creaba otro — y el reporte habria dicho «la idempotencia no aplica» sobre un
 * mecanismo intacto. Es §8.11(d): si tu verificador parsea o reconstruye algo,
 * primero verifica eso; o mejor, NO lo reconstruyas.
 *
 * La solucion es mas fuerte que la replica: el escenario de «ya existia» sirve
 * EL ID QUE LA PROPIA APP ACABA DE PRODUCIR en el escenario anterior. Asi no
 * hay tercera version de la regla que pueda discrepar, y lo que se prueba es
 * justo lo que importa — que la app reconoce su propia llave.
 *
 * De la FORMA si se puede afirmar lo que no depende del periodo, y se afirma
 * abajo: prefijo del robot y los tres slugs que la componen.
 */
function slug(x) {
  return String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
}

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function prepararCopia() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'md-cat-dist-'));
  const copiar = (de, a) => {
    fs.mkdirSync(a, { recursive: true });
    for (const e of fs.readdirSync(de, { withFileTypes: true })) {
      const o = path.join(de, e.name), d = path.join(a, e.name);
      if (e.isDirectory()) copiar(o, d); else fs.copyFileSync(o, d);
    }
  };
  copiar(DIST_REAL, destino);
  console.log('[catalogo] copia servida desde %s', destino);
  return destino;
}

/**
 * @param idSembrado  si viene, la lista del día ya trae ESE checklist. Es el
 *                    control de idempotencia, y el id sale de lo que la app
 *                    produjo en la corrida anterior: nunca de una réplica.
 */
function medir(idSembrado, puerto) {
  return new Promise((resolve) => {
    const existente = idSembrado ? [{
      id: idSembrado, date: HOY, time: '23:59', name: TAREA.nombre, assigned: DESTINO,
      store: SUCURSAL, items: [{ id: 'i1', text: 'Punto' }], _origenManual: true,
      timestampCreacion: Date.now(),
    }] : [];

    const cuerpo = JSON.stringify({
      checklists: existente,
      usuarios: USUARIOS,
      areas: [],
      items: [],
    });

    // El guion pulsa la pantalla REAL: abre el modal, elige sucursal, persona y
    // tarea por su TEXTO, y pulsa Asignar. Nada se llama por dentro: si un
    // botón cambia de sitio o de nombre, esto falla ruidosamente.
    const iny =
      '<script>try{localStorage.setItem("md_sesion_actual",' +
      JSON.stringify(JSON.stringify(SESION)) + ');}catch(e){}' +
      'try{localStorage.setItem("md_token","token-de-medicion");}catch(e){}</script>' +
      '<script>window.addEventListener("load",function(){' +
      'function porTexto(sel, txt){return [].slice.call(document.querySelectorAll(sel))' +
      '  .filter(function(e){return (e.textContent||"").indexOf(txt)>=0;})[0];}' +
      'var R={pasos:[]};' +
      'setTimeout(function(){' +
      // 1 · abrir
      '  var b=porTexto(".cat-manual-btn","Del manual");' +
      '  if(!b){R.error="no encontre el boton «Del manual»";return fin();}' +
      '  b.click();' +
      '  setTimeout(function(){' +
      '    R.modal=document.querySelectorAll(".cat-manual").length;' +
      '    var suc=porTexto(".cat-chip",' + JSON.stringify(SUCURSAL) + ');' +
      '    if(suc){suc.click();}' +
      '    setTimeout(function(){' +
      '      R.personas=document.querySelectorAll(".cat-persona").length;' +
      '      var per=porTexto(".cat-persona",' + JSON.stringify(DESTINO) + ');' +
      '      if(!per){R.error="la persona no aparecio en la sucursal";return fin();}' +
      '      per.click();' +
      '      setTimeout(function(){' +
      '        var campo=document.querySelector(".cat-buscar");' +
      '        if(campo){campo.value=' + JSON.stringify(TAREA.nombre) + ';' +
      '          campo.dispatchEvent(new Event("input",{bubbles:true}));}' +
      '        setTimeout(function(){' +
      '          R.tareas=document.querySelectorAll(".cat-tarea").length;' +
      '          var t=porTexto(".cat-tarea",' + JSON.stringify(TAREA.nombre) + ');' +
      '          if(!t){R.error="la tarea no aparecio en el catalogo";return fin();}' +
      '          t.click();' +
      '          setTimeout(function(){' +
      '            var asig=porTexto(".cat-botones .wizard-btn-next","Asignar");' +
      '            if(!asig){R.error="no encontre el boton Asignar";return fin();}' +
      '            R.deshabilitado=asig.disabled?1:0;' +
      '            asig.click();' +
      '            setTimeout(function(){' +
      '              var av=document.querySelector(".cat-aviso");' +
      '              R.aviso=av?av.textContent.replace(/\\s+/g," ").trim():"";' +
      '              R.modalDespues=document.querySelectorAll(".cat-manual").length;' +
      '              fin();' +
      '            },2500);' +
      '          },500);' +
      '        },700);' +
      '      },500);' +
      '    },500);' +
      '  },700);' +
      '},3200);' +
      'function fin(){document.title="RES "+JSON.stringify(R);}' +
      '});</script>';

    const sano = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const html = sano.replace('<body>', '<body>' + iny);
    if (html === sano) return resolve({ error: 'no pude inyectar la sesión en el index' });

    const enviados = [];
    let apiPedidos = 0;
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url.indexOf('/api/') === 0) {
        apiPedidos++;
        if (req.method === 'POST') {
          let crudo = '';
          req.on('data', (c) => { crudo += c; });
          req.on('end', () => {
            try { enviados.push({ url, cuerpo: JSON.parse(crudo) }); }
            catch (e) { enviados.push({ url, cuerpo: null, crudo: crudo.slice(0, 200) }); }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
          });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(cuerpo);
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
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-cat-'));
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--window-size=1440,1052', '--user-data-dir=' + perfil, '--virtual-time-budget=45000',
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
        try { resolve({ dato: JSON.parse(m[1]), enviados, apiPedidos }); }
        catch (e) { resolve({ error: 'el título no era JSON: ' + m[1].slice(0, 160) }); }
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
  console.log('[catalogo] entrada: catálogo con %d manuales · la tarea «%s» (%s, %d puntos)',
    cat.MANUALES_POR_PUESTO.length, TAREA.nombre, TAREA.frecuencia, TAREA.items.length);
  console.log('[catalogo] del puesto «%s» → a «%s», que es «%s» (otro puesto, ese es el caso)',
    org.nombrePuesto(PUESTO_ORIGEN), DESTINO, org.nombrePuesto(PUESTO_PERSONA));

  DIST = prepararCopia();

  const puerto = 5800 + Math.floor(Math.random() * 150);
  const a = await medir(null, puerto);
  if (a.error) abortar('escenario «asignar»: ' + a.error);
  if (a.dato.error) abortar('escenario «asignar»: ' + a.dato.error);

  // EL ID SALE DE LO QUE LA APP ESCRIBIO, no de una receta paralela.
  const primero = a.enviados.filter((e) => e.url === '/api/checklists'
    && e.cuerpo && e.cuerpo._tareaManualId === TAREA.id && e.cuerpo.assigned === DESTINO)[0];
  if (!primero || !primero.cuerpo || !primero.cuerpo.id) {
    abortar('el primer escenario no envió ningún documento con id, así que el control de ' +
      'idempotencia no tendría qué sembrar.');
  }
  const ID_REAL = String(primero.cuerpo.id);

  const b = await medir(ID_REAL, puerto + 1);
  if (b.error) abortar('escenario «ya existía»: ' + b.error);
  if (b.dato.error) abortar('escenario «ya existía»: ' + b.dato.error);

  // ── GUARDIAS ─────────────────────────────────────────────────────────────
  if (!a.apiPedidos || !b.apiPedidos) {
    abortar('algún escenario nunca pidió /api/*: se midió una pantalla vacía.');
  }
  if (!a.dato.modal) abortar('el modal no se abrió: nada de lo de abajo se ejerció.');
  if (!a.dato.personas) {
    abortar('el selector de personas salió VACÍO con ' + USUARIOS.length + ' fichas servidas en ' +
      SUCURSAL + '. Es el defecto que ya se cobró dos veces (Plantilla y Pase de lista): sin ' +
      'gente que elegir, la pantalla se bloquea a sí misma.');
  }

  /**
   * ⚠ EL ROBOT TAMBIEN ESCRIBE AQUI, Y HASTA HOY NO LO HACIA.
   *
   * Esta prueba contaba TODOS los POST a /api/checklists y daba 1, porque el
   * robot del navegador moria antes de escribir: hacia `setDoc` a Firestore
   * primero y esa promesa no vuelve sin red. O sea que mi prueba dependia, sin
   * saberlo, de que el robot estuviera roto.
   *
   * El 14/sep/2026 otra sesion invirtio ese orden —API primero, Firestore
   * best-effort— y el robot empezo a emitir de verdad: 4 POST en la misma
   * corrida. Mi `posts[0]` paso a ser el suyo y la prueba reporto siete fallos
   * sobre un mecanismo intacto.
   *
   * Se distingue por el PAR (tarea × persona), que es lo que yo elegi en la
   * pantalla y el robot no puede producir: esa tarea es del manual de
   * `encargado-sucursal` y la persona es `anaquelista`, asi que el robot nunca
   * se la entrega. NO se filtra por `_asignadoAMano`, que es justo lo que se
   * quiere afirmar: filtrar por la afirmacion la volveria una tautologia.
   *
   * Y el ruido del robot se CONSERVA a proposito: que mi documento siga siendo
   * identificable mientras otro emisor escribe a la vez es ahora una propiedad
   * del sistema, no una molestia del arnes.
   */
  const mio = (e) => e.url === '/api/checklists'
    && e.cuerpo && e.cuerpo._tareaManualId === TAREA.id && e.cuerpo.assigned === DESTINO;
  const todosA = a.enviados.filter((e) => e.url === '/api/checklists');
  const todosB = b.enviados.filter((e) => e.url === '/api/checklists');
  const posts = todosA.filter(mio);
  const postsB = todosB.filter(mio);
  console.log('');
  console.log('[catalogo] POST a /api/checklists: %d en total, %d míos (el resto los emitió el ' +
    'robot del navegador para la gente del fixture)', todosA.length, posts.length);

  console.log('');
  console.log('escenario            modal  personas  tareas  POST míos / total     aviso');
  console.log('─'.repeat(100));
  console.log('%s %s %s %s %s %s', 'asignar'.padEnd(20), String(a.dato.modal).padEnd(6),
    String(a.dato.personas).padEnd(9), String(a.dato.tareas).padEnd(7),
    (posts.length + ' de ' + todosA.length).padEnd(21), JSON.stringify(a.dato.aviso || ''));
  console.log('%s %s %s %s %s %s', 'ya existía'.padEnd(20), String(b.dato.modal).padEnd(6),
    String(b.dato.personas).padEnd(9), String(b.dato.tareas).padEnd(7),
    (postsB.length + ' de ' + todosB.length).padEnd(21), JSON.stringify(b.dato.aviso || ''));
  console.log('─'.repeat(100));

  const fallos = [];
  const pide = (ok, msg) => { if (!ok) fallos.push(msg); };

  pide(posts.length === 1,
    'se enviaron ' + posts.length + ' POST míos (de ' + todosA.length + ' en total) y debía ser ' +
    'UNO. «Mío» es el par tarea × persona que se eligió en la pantalla; el resto son del robot.');

  const doc = posts.length ? posts[0].cuerpo : null;
  if (doc) {
    console.log('');
    console.log('EL DOCUMENTO QUE SALIÓ POR EL CABLE');
    console.log('  id            %s', doc.id);
    console.log('  name          %s', doc.name);
    console.log('  assigned      %s   ·  store %s  ·  date %s  ·  time %s',
      doc.assigned, doc.store, doc.date, doc.time);
    console.log('  items         %d', (doc.items || []).length);
    console.log('  sello         _origenManual=%s · _puestoId=%s · _tareaManualId=%s',
      doc._origenManual, doc._puestoId, doc._tareaManualId);
    console.log('                _manualDocumento=%s · _manualVersion=%s · _formatoCodigo=%s',
      JSON.stringify(doc._manualDocumento), JSON.stringify(doc._manualVersion),
      JSON.stringify(doc._formatoCodigo));
    console.log('  a mano        _asignadoAMano=%s · _asignadoPor=%s',
      doc._asignadoAMano, JSON.stringify(doc._asignadoPor));
    console.log('');

    // ── EL SELLO DE LA NORMA (§4) ──────────────────────────────────────────
    pide(doc._origenManual === true,
      'el documento salió SIN `_origenManual`: sería una tarea libre con cara de manual, ' +
      'editable y borrable.');
    pide(doc._tareaManualId === TAREA.id,
      'el `_tareaManualId` es ' + JSON.stringify(doc._tareaManualId) + ' y la tarea elegida es ' +
      JSON.stringify(TAREA.id) + '.');
    pide(doc._puestoId === PUESTO_ORIGEN,
      'el `_puestoId` es ' + JSON.stringify(doc._puestoId) + ' y debe ser el puesto DEL QUE SALE ' +
      'la norma (' + PUESTO_ORIGEN + '), no el de la persona.');
    pide(!!doc._manualDocumento && doc._manualDocumento === (MANUAL && MANUAL.documento),
      'el documento del manual es ' + JSON.stringify(doc._manualDocumento) + ' y el catálogo dice ' +
      JSON.stringify(MANUAL && MANUAL.documento) + '.');
    pide(!!doc._manualVersion && doc._manualVersion === (MANUAL && MANUAL.version),
      'la VERSIÓN es ' + JSON.stringify(doc._manualVersion) + ' y el catálogo dice ' +
      JSON.stringify(MANUAL && MANUAL.version) + '. Sin versión sellada no se puede decir con ' +
      'qué norma se juzgó a esta persona (§4).');

    // ── QUIÉN Y A QUIÉN ────────────────────────────────────────────────────
    pide(doc.assigned === DESTINO,
      'la tarea salió a nombre de ' + JSON.stringify(doc.assigned) + ' y se eligió ' +
      JSON.stringify(DESTINO) + '.');
    pide(doc.store === SUCURSAL,
      'la sucursal es ' + JSON.stringify(doc.store) + ' y se eligió ' + JSON.stringify(SUCURSAL) + '.');
    pide(doc.date === HOY, 'la fecha es ' + doc.date + ' y se pidió ' + HOY + '.');
    pide(doc._asignadoAMano === true,
      'falta `_asignadoAMano`: sin él, esta entrega es indistinguible de una del robot y nadie ' +
      'puede saber que la decidió una persona.');
    pide(doc._asignadoPor === YO,
      'el autor es ' + JSON.stringify(doc._asignadoPor) + ' y la sesión es ' + JSON.stringify(YO) +
      '. Sin autor no es auditable.');

    // ── LOS PUNTOS SON LOS DEL MANUAL, NO UNA LISTA INVENTADA ──────────────
    pide((doc.items || []).length === TAREA.items.length,
      'el documento trae ' + (doc.items || []).length + ' puntos y el manual dice ' +
      TAREA.items.length + '.');
    const conGaleria = (doc.items || []).filter((i) => i.requiresVariasFotos).length;
    pide(conGaleria === (doc.items || []).length,
      conGaleria + ' de ' + (doc.items || []).length + ' puntos piden varias fotos. Desde el ' +
      '3/sep los piden TODOS (orden de Dirección), y esa regla vive en `armarChecklist`: si ' +
      'aquí no se cumple, esta entrega no está pasando por ahí.');

    // ── LA LLAVE, QUE ES LA DEL ROBOT ──────────────────────────────────────
    // De la llave se afirma la FORMA, que es lo que no depende del periodo: el
    // prefijo del robot y los tres slugs. El periodo NO se replica a propósito
    // (ver la nota de arriba); que la app reconozca su propia llave lo prueba el
    // escenario de «ya existía», que es más fuerte que compararla contra una
    // receta escrita aquí.
    pide(/^man_/.test(String(doc.id || '')),
      'la llave ' + JSON.stringify(doc.id) + ' no empieza por `man_`, que es el prefijo con el ' +
      'que el robot marca sus entregas. Con otro prefijo, sus dos llaves nunca coinciden y ' +
      'asignar a mano algo que el robot ya entrega crearía DOS documentos para el mismo punto.');
    for (const parte of [slug(TAREA.id), slug(SUCURSAL), slug(DESTINO)]) {
      pide(String(doc.id || '').indexOf(parte) >= 0,
        'la llave ' + JSON.stringify(doc.id) + ' no contiene ' + JSON.stringify(parte) + '. La ' +
        'del robot es tarea × periodo × sucursal × persona: si le falta una parte, dos entregas ' +
        'distintas pueden colisionar en el mismo id.');
    }
  }

  // ── LA COSTURA QUE PROTEGE ESTA ENTREGA DE UN BORRADO AUTOMÁTICO ─────────
  //
  // Desde el 15/sep el servidor LIMPIA las entregas repetidas del robot: las
  // marca como eliminadas solo. Y `entregarDelCatalogo` permite dar una tarea
  // del manual en el sitio que quien asigna elija —que puede no tener cuadrilla
  // A PROPÓSITO—, así que sin una excepción esa limpieza borraría decisiones de
  // una persona aplicándoles un criterio pensado para el robot.
  //
  // La excepción existe y mira `datos._asignadoAMano`. Que el sello llegue en el
  // POST ya se afirmó arriba; lo que se comprueba aquí es que SOBREVIVA AL
  // GUARDADO, que es otra cosa: `api/checklists.js` reparte el documento entre
  // columnas tipadas y el jsonb `datos`, y un campo que cayera en el saco de los
  // ignorados desaparecería sin error. Dos comparaciones de cadena exactas, sin
  // parsear nada (§8.11 d): que el campo NO esté tratado de forma especial en
  // ese archivo, y que siga existiendo la línea que manda al jsonb todo lo que
  // no es columna.
  const apiChecklists = fs.readFileSync(path.join(__dirname, '..', 'api', 'checklists.js'), 'utf8');
  if (apiChecklists.length < 1000) {
    abortar('api/checklists.js vino con ' + apiChecklists.length + ' caracteres: eso es «no ' +
      'pude leerlo», no «está bien».');
  }
  pide(apiChecklists.indexOf('_asignadoAMano') === -1,
    '`api/checklists.js` menciona `_asignadoAMano`. Hoy NO lo hace, y eso es lo que garantiza ' +
    'que caiga en el jsonb `datos` como un campo más. Si ahora lo trata aparte, revisa que la ' +
    'limpieza automática del servidor lo siga viendo: de ese campo depende que no borre las ' +
    'asignaciones hechas a mano.');
  pide(apiChecklists.indexOf('else if (!IGNORAR.has(k)) datos[k] = v;') !== -1,
    'cambió la línea que manda al jsonb `datos` todo lo que no es columna. El sello ' +
    '`_asignadoAMano` viaja por ahí, y sin él la limpieza del servidor borraría entregas ' +
    'asignadas a mano.');

  // ── EL CONTROL NEGATIVO: LA IDEMPOTENCIA ─────────────────────────────────
  pide(postsB.length === 0,
    'con el checklist YA existente se enviaron ' + postsB.length + ' POST míos: la comprobación de ' +
    'idempotencia no está aplicando y se acaba de crear un duplicado. Un duplicado no se ve: ' +
    'solo sube el denominador de esa persona.');
  pide(/ya tiene esa tarea/i.test(b.dato.aviso || ''),
    'con el checklist ya existente la pantalla dijo ' + JSON.stringify(b.dato.aviso) + '. Tiene ' +
    'que DECIRLO: si se cierra en silencio, quien asigna cree que lo hizo y no lo hizo.');
  pide(b.dato.modalDespues === 1,
    'el modal se cerró tras el intento repetido. Debe quedarse abierto con el aviso a la vista.');

  // ── GUARDIA DE DISCRIMINACIÓN ────────────────────────────────────────────
  if (posts.length === postsB.length) {
    abortar('los dos escenarios enviaron el mismo número de POST (' + posts.length + '). Sin una ' +
      'diferencia entre «no existía» y «ya existía», la idempotencia no se ha probado.');
  }

  console.log('');
  if (fallos.length) {
    console.log('✗ %d aserción(es) rotas:', fallos.length);
    for (const f of fallos) console.log('   · %s', f);
    process.exit(2);
  }
  console.log('✓ pasa: 1 POST cuando no existía y 0 cuando ya existía.');
  console.log('  el sello viaja completo: documento «%s», versión %s, tarea %s',
    doc._manualDocumento, doc._manualVersion, doc._tareaManualId);
  console.log('  la llave (%s) lleva el prefijo del robot y sus tres partes,', doc.id);
  console.log('  y la app RECONOCIO LA SUYA: servida en la lista del dia, no creo otra.');
  console.log('  los %d puntos son los del manual y todos piden evidencia', (doc.items || []).length);
  console.log('');
  console.log('Lo que esto NO prueba: que la persona la vea en su teléfono, ni que la copia a');
  console.log('Firestore se haya hecho — es best-effort a propósito, porque la app lee Postgres.');
})();
