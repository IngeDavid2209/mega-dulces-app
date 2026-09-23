#!/usr/bin/env node
/**
 * 📷 CUÁNTO PESA PEDIR FOTO EN TODOS LOS PUNTOS
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA QUE CONTESTA
 * ═══════════════════════════════════════════════════════════════════════════
 * El 29/ago la migración 046 APAGÓ la foto opcional en todos los puntos porque
 * el bloque de evidencia son ~200 líneas de DOM por punto: un checklist de 23
 * puntos cuadruplicó su DOM y la app se puso a trabar en los celulares de piso.
 *
 * El 3/sep Dirección pidió lo contrario: foto obligatoria en los 377 puntos, y
 * más de una. Así que la pregunta no es «¿se puede?» sino **¿cuánto DOM cuesta,
 * y sigue respondiendo el teléfono al final del turno?**
 *
 * Y una segunda, que es de seguridad y no de rendimiento: **los 45 puntos que
 * piden un DOCUMENTO que ya existe (factura, póliza, tarjeta de circulación)
 * NO pueden quedar con la cámara forzada**, o la persona no puede adjuntar el
 * PDF que se le pide y el punto es imposible de cerrar.
 *
 * ─── POR QUÉ ESTO NO LO PUEDE CONTESTAR UNA PRUEBA UNITARIA ────────────────
 * El costo vive en la plantilla. Un `*ngIf` no es una función que se pueda
 * llamar, y `ng test` no pinta nada: compila. Hay que abrir un navegador.
 *
 * ─── EL TRUCO QUE LO HACE BARATO ───────────────────────────────────────────
 * La plantilla pinta según las BANDERAS DEL ITEM, no según el robot. Así que
 * las cuatro condiciones se miden contra el MISMO build, cambiando solo el
 * checklist sintético que devuelve `/api/checklists`. No hace falta base de
 * datos, ni credenciales, ni desplegar.
 *
 * ─── CÓMO CONSIGUE TOKEN (ya no hay parche; ver la nota de abajo) ──────────
 * `ApiService.token()` lanza «Sin sesión activa» si no hay usuario de Firebase,
 * y entonces el `fetch` nunca sale: la pantalla queda vacía y el conteo mide
 * una pantalla vacía. Así que el script COPIA el `dist/` y en la copia
 * cortocircuita esa función. El `dist/` real no se toca (se comprueba), y el
 * parche exige encontrar EXACTAMENTE una ocurrencia: si el bundle cambia y el
 * ancla ya no aparece, ABORTA en vez de medir de menos.
 *
 * ─── LO QUE VIGILA DE SÍ MISMO ─────────────────────────────────────────────
 * · ABORTA si alguna condición no se pudo medir. «No pude abrir el detalle» y
 *   «no hay bloques de evidencia» dan los dos un cero (§8.11 a).
 * · ABORTA si la app nunca pidió `/api/*`: el checklist sintético no llegó y el
 *   conteo es de una pantalla vacía.
 * · ABORTA si ningún eje discrimina entre las cuatro condiciones (§8.11 c).
 *
 *   npm run build   (mide lo COMPILADO, no el código fuente)
 *   node scripts/prueba-dom-evidencia.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const DIST_REAL = path.join(RAIZ, 'dist', 'mega-dulces-app', 'browser');

// El ancla del parche de autenticación. Es código minificado: si el bundler
// cambia de versión puede dejar de coincidir, y por eso se exige 1 ocurrencia.
// ─── YA NO SE PARCHEA LA AUTENTICACION (13/sep/2026) ──────────────────────
//
// Estas pruebas copiaban el dist/ y le inyectaban un token dentro de
// ApiService.token(), buscando una cadena del codigo MINIFICADO. Funcionaba y
// era fragil: al añadir el acceso por plaza ese metodo cambio, el ancla
// desaparecio y las TRES pruebas abortaron a la vez.
//
// Ahora `token()` devuelve el JWT de localStorage.md_token si existe -el camino
// del acceso por plaza-, asi que basta sembrarlo. Es un camino legitimo del
// producto, no un parche al bundle, y no se rompe cada vez que ese metodo se
// toca. El token no tiene que ser valido: estas pruebas sirven /api ellas
// mismas.
const TOKEN_MEDICION = 'token-de-medicion';

// 23 puntos: el tamaño que la 046 midió. Textos del manual real para que el
// largo del texto no falsee el conteo de nodos.
const TEXTOS = [
  'Inicio: Usuario propio y caja correcta', 'Inicio: Fondo contado/registrado',
  'Inicio: Lector, impresora y rollos disponibles', 'Inicio: Terminal bancaria operativa',
  'Inicio: Material y detector de billetes disponibles', 'Inicio: Área de cobro limpia y ordenada',
  'Surtido: Bolsas y empaque suficientes', 'Surtido: Exhibidor de impulso surtido',
  'Surtido: Precios visibles y correctos', 'Surtido: Producto sin caducidad próxima',
  'Checado: Arqueo intermedio realizado', 'Checado: Retiros parciales resguardados',
  'Checado: Vales y cortesías documentados', 'Cierre: Corte impreso y firmado',
  'Cierre: Efectivo entregado y contado', 'Cierre: Terminal cortada',
  'Cierre: Área de cobro entregada limpia', 'Cierre: Bitácora del turno firmada',
  'Anexo: Bodega y áreas críticas revisadas', 'Anexo: Extintor con carga vigente',
  'Anexo: Salidas de emergencia libres', 'Anexo: Botiquín completo',
  'Anexo: Termómetro de refrigeración registrado',
];

// Un GIF de 1x1: ocupa un nodo <img> igual que una foto de Cloudinary y no pesa
// nada. Lo que se mide es el DOM, no el ancho de banda.
const PIX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const CONDICIONES = [
  { clave: 'hoy',     que: '3 de 23 piden foto (la proporción de antes: 51 de 377)' },
  { clave: 'todos',   que: 'los 23 piden foto, galería vacía (el arranque del turno)' },
  { clave: 'cargado', que: 'los 23 con TRES fotos cada uno (el final del turno)' },
  { clave: 'docs',    que: 'los 23 son puntos de DOCUMENTO (los 45 que piden un PDF)' },
];

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function abortar(motivo) {
  console.error('');
  console.error('[dom-evidencia] ABORTA: ' + motivo);
  console.error('[dom-evidencia] No concluyas de esta corrida.');
  process.exit(3);
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

// ══════════════════════════════════════════════════════════════════════════
//  MODO HIJO: sirve el dist parcheado, pinta y cuenta
// ══════════════════════════════════════════════════════════════════════════
function checklistDe(cond) {
  const todos = cond !== 'hoy';
  const cuales = todos ? TEXTOS.map((_, i) => i) : [1, 10, 14];
  const hoy = new Date();
  const fecha = new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000).toISOString().split('T')[0];
  return {
    id: 'medicion-dom', timestampCreacion: Date.now(),
    name: 'Operación de caja — turno',
    // TRABAJADORA, no admin: para un admin la vista por defecto de
    // /tareas-manual es el ÁRBOL del organigrama y `.checklist-card` no
    // aparece nunca. Y además el caso que importa es un celular de piso.
    assigned: 'Carolina Anaquelista', assignedUid: 'w',
    store: 'Canindo', date: fecha, time: '22:00', status: 'pendiente',
    createdBy: 'Manual Corporativo', created_by: 'Manual Corporativo', enviado: false,
    // `_origenManual`, NO `esTareaManual`: `esTareaDeManual()` mira exactamente
    // ese campo y con el nombre equivocado la tarjeta no aparece nunca, sin
    // error. Es el mapeo de nombres de §12.
    _origenManual: true, tareaManualId: 'caja-turno',
    items: TEXTOS.map((t, i) => {
      const pide = cuales.includes(i);
      const photos = [];
      if (pide && cond === 'cargado') {
        for (let k = 0; k < 3; k++) photos.push({ url: PIX, time: '14:0' + k });
      }
      return {
        id: 'caja-turno_' + i, text: t, checked: false,
        photo: null, photoTime: null, photoAntes: null, photoAntesTime: null,
        photoAntesTimestamp: null, photos, horaInicio: null, horaLimite: '22:00',
        requiresPhoto: false, requiresVariasFotos: pide, requiresAntesDespues: false,
        permiteFotos: false, permiteDocumentos: cond === 'docs',
        tiempoEstimadoMin: null, requiereMonto: false, requiereFolio: false, requiereComentario: false,
      };
    }),
  };
}

function hijo(dist, puerto, cond) {
  const sesion = { uid: 'w', id: 'w', nombre: 'Carolina Anaquelista', usuario: 'ana',
    correo: 'an@l.invalid', rol: 'trabajador', puestoId: 'anaquelista', sucursales: ['Canindo'] };
  const checklist = checklistDe(cond);

  const iny =
    '<script>try{localStorage.setItem("md_sesion_actual",' + JSON.stringify(JSON.stringify(sesion)) + ');}catch(e){}'
      + 'try { localStorage.setItem(\"md_token\", \"token-de-medicion\"); } catch (e) {}</script>' +
    '<script>window.addEventListener("load",function(){' +
    // 1) esperar la lista · 2) tocar la tarjeta · 3) esperar el detalle · 4) contar.
    // Cada paso dice si NO se cumplió, para no confundir "cero porque no abrió"
    // con "cero porque no pinta".
    ' var t0=Date.now(); var res={cond:' + JSON.stringify(cond) + '};' +
    ' function espera(sel,cb,ms){var f=function(){' +
    '   if(document.querySelector(sel)) return cb(true);' +
    '   if(Date.now()-t0>ms) return cb(false);' +
    '   setTimeout(f,150);}; f();}' +
    ' espera(".checklist-card",function(hay){' +
    '   if(!hay){res.error="nunca aparecio .checklist-card";' +
    '     res.enPantalla=(document.body.innerText||"").replace(/\\s+/g," ").slice(0,200);' +
    '     return fin();}' +
    '   document.querySelector(".checklist-card").click();' +
    '   espera(".item-photo-section, .item-sin-evidencia",function(det){' +
    '     if(!det){res.error="el detalle no abrio";return fin();}' +
    '     setTimeout(function(){' +
    '       var files=[].slice.call(document.querySelectorAll("input[type=file]"));' +
    '       res.nodos=document.getElementsByTagName("*").length;' +
    '       res.bloques=document.querySelectorAll(".item-photo-section").length;' +
    '       res.sinEvid=document.querySelectorAll(".item-sin-evidencia").length;' +
    '       res.inputs=files.length;' +
    '       res.conCaptura=files.filter(function(e){return e.getAttribute("capture")==="environment";}).length;' +
    '       res.sinCaptura=files.filter(function(e){return e.getAttribute("capture")===null;}).length;' +
    '       res.conMultiple=document.querySelectorAll("input[type=file][multiple]").length;' +
    '       res.miniaturas=document.querySelectorAll(".item-photo-section img").length;' +
    '       res.lazy=document.querySelectorAll(".item-photo-section img[loading=lazy]").length;' +
    // ⚠ EL AVISO DE «no puedes editar» TIENE QUE SER 0 AQUI (20/sep). La
    // sesion de este arnes ES la dueña del checklist, asi que si el aviso
    // saliera, le estaria diciendo a TODO EL MUNDO que no puede subir su
    // evidencia. Es la direccion peligrosa del cambio, y la unica que este
    // arnes ya estaba en posicion de vigilar sin montar nada nuevo.
    '       res.noEditable=document.querySelectorAll(".cl-no-editable").length;' +
    '       res.htmlKb=Math.round(document.body.innerHTML.length/1024);' +
    '       fin();},1200);' +
    '   },14000);' +
    ' },12000);' +
    ' function fin(){document.title="RES "+JSON.stringify(res);}' +
    '});</script>';

  const sano = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const html = sano.replace('<body>', '<body>' + iny);
  if (html === sano) { console.error(JSON.stringify({ cond, error: 'no pude inyectar' })); process.exit(2); }

  let pedidos = 0;
  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url.indexOf('/api/') === 0) {
      pedidos++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (url === '/api/checklists') return res.end(JSON.stringify({ checklists: [checklist] }));
      return res.end(JSON.stringify({ checklists: [], usuarios: [], areas: [], tareas: [] }));
    }
    if (url === '/' || !path.extname(url)) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    const f = path.join(dist, url);
    if (!fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('no'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  srv.listen(puerto, () => {
    const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-dom-'));
    const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--user-data-dir=' + perfil, '--virtual-time-budget=45000', '--window-size=412,900',
      '--disable-background-networking', '--disable-sync', '--disable-component-update',
      '--disable-features=PushMessaging,OptimizationHints',
      // La ruta se arma AQUÍ. Nunca se pasa con barra inicial por variable de
      // entorno: MSYS la convierte en 'C:/Program Files/Git/...', la URL sale
      // malformada y Chrome abre la pestaña nueva — que se lee como «no pinta».
      '--dump-dom', 'http://localhost:' + puerto + '/tareas-manual'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    let dom = '';
    h.stdout.on('data', (d) => { dom += d.toString('utf8'); });
    h.on('error', (e) => { srv.close(); console.error(JSON.stringify({ cond, error: 'Chrome: ' + e.message })); process.exit(2); });
    h.on('close', () => {
      srv.close();
      const m = /<title>RES ([\s\S]*?)<\/title>/.exec(dom);
      if (!m) {
        const t = /<title>([\s\S]*?)<\/title>/.exec(dom);
        console.error(JSON.stringify({ cond, error: 'sin medición · title=' +
          (t ? t[1] : 'ninguno') + ' · dom=' + dom.length + 'B · pedidos=' + pedidos }));
        process.exit(2);
      }
      if (pedidos === 0) {
        console.error(JSON.stringify({ cond, error: 'la app no pidió /api/*: el checklist sintético no llegó' }));
        process.exit(2);
      }
      console.log(m[1]);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  MODO PADRE
// ══════════════════════════════════════════════════════════════════════════
function prepararCopia() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'md-dist-'));
  const copiar = (de, a) => {
    fs.mkdirSync(a, { recursive: true });
    for (const e of fs.readdirSync(de, { withFileTypes: true })) {
      const o = path.join(de, e.name), d = path.join(a, e.name);
      if (e.isDirectory()) copiar(o, d); else fs.copyFileSync(o, d);
    }
  };
  copiar(DIST_REAL, destino);

  // Ya no se parchea nada: el token se siembra en localStorage (ver arriba).
  // La copia se conserva porque desde aqui se sirve.
  console.log('[evidencia] copia servida desde %s (sin parchear)', destino);
  return destino;
}

function medir(dist, puerto, cond) {
  return new Promise((ok) => {
    const h = spawn(process.execPath, [__filename, '--hijo', dist, String(puerto), cond],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    h.stdout.on('data', (d) => { out += d; });
    h.stderr.on('data', (d) => { err += d; });
    h.on('close', () => {
      try { return ok({ dato: JSON.parse(out.trim()) }); } catch { /* cae abajo */ }
      let motivo = err.trim().split('\n').pop() || 'sin salida';
      try { motivo = JSON.parse(motivo).error || motivo; } catch { /* texto pelado */ }
      ok({ error: motivo });
    });
  });
}

if (process.argv[2] === '--hijo') {
  if (!CHROME) { console.error(JSON.stringify({ error: 'no encontré Chrome' })); process.exit(2); }
  hijo(process.argv[3], Number(process.argv[4]), process.argv[5]);
} else {
  (async () => {
    if (!CHROME) abortar('no encontré Chrome. Sin navegador esto no mide nada.');
    if (!fs.existsSync(path.join(DIST_REAL, 'index.html'))) {
      abortar('no hay dist/ en ' + DIST_REAL + '. Corre `npm run build`: esto mide lo COMPILADO.');
    }
    const dist = prepararCopia();
    console.log('  copia parcheada en %s', dist);
    console.log('');

    const filas = [];
    let puerto = 5300 + Math.floor(Math.random() * 300);
    for (const c of CONDICIONES) {
      const r = await medir(dist, puerto++, c.clave);
      if (r.error) abortar('condición "' + c.clave + '": ' + r.error +
        '. Una medición fallida no es un cero: son dos cosas distintas y se ven igual.');
      filas.push({ ...c, d: r.dato });
    }

    console.log('condición  nodos  bloques  inputs  cámara  sin-cámara  multiple  miniat.  lazy  HTML');
    console.log('─'.repeat(92));
    for (const f of filas) {
      const d = f.d;
      console.log('%s %s %s %s %s %s %s %s %s %s',
        f.clave.padEnd(10), String(d.nodos).padEnd(6), String(d.bloques).padEnd(8),
        String(d.inputs).padEnd(7), String(d.conCaptura).padEnd(7), String(d.sinCaptura).padEnd(11),
        String(d.conMultiple).padEnd(9), String(d.miniaturas).padEnd(8), String(d.lazy).padEnd(5),
        d.htmlKb + ' KB');
    }
    console.log('─'.repeat(92));
    for (const f of filas) console.log('  %s = %s', f.clave, f.que);

    // ── GUARDIA DE DISCRIMINACIÓN, antes de leer un verde ─────────────────
    const EJES = ['nodos', 'bloques', 'conCaptura', 'sinCaptura', 'miniaturas'];
    const mudos = EJES.filter((k) => new Set(filas.map((f) => f.d[k])).size < 2);
    if (mudos.length === EJES.length) {
      abortar('ninguno de los ' + EJES.length + ' ejes discrimina entre las cuatro condiciones. ' +
        'Las aserciones de abajo pasarían por casualidad.');
    }
    console.log('');
    console.log('ejes que discriminan: %d de %d', EJES.length - mudos.length, EJES.length);

    // ── LAS ASERCIONES ────────────────────────────────────────────────────
    const por = (c) => filas.find((f) => f.clave === c).d;
    const fallos = [];
    const exigir = (ok, txt) => { if (!ok) fallos.push(txt); };

    exigir(por('todos').bloques === 23, 'con todos los puntos deberían pintarse 23 bloques de evidencia, hay ' + por('todos').bloques);
    exigir(por('todos').conCaptura === 23, 'los 23 puntos de foto deben forzar la cámara, la fuerzan ' + por('todos').conCaptura);
    exigir(por('todos').conMultiple === 23, 'los 23 inputs deben aceptar más de un archivo, lo aceptan ' + por('todos').conMultiple);
    // LA ASERCIÓN DE SEGURIDAD: un punto de documento con la cámara forzada es
    // un punto imposible de cerrar. Son 45 en el manual.
    exigir(por('docs').conCaptura === 0, 'NINGÚN punto de documento debe forzar la cámara, la fuerzan ' + por('docs').conCaptura + ' (no podrían adjuntar su PDF)');

    // ⚠ EL AVISO DE «no puedes editar», EN LAS CUATRO CONDICIONES (20/sep).
    // La sesion de este arnes ES la dueña, asi que debe salir 0. Si saliera,
    // le estaria diciendo a todo el mundo que no puede subir su evidencia — la
    // direccion peligrosa del cambio, y la unica que se puede romper sin que
    // ninguna prueba unitaria lo note, porque el defecto estaria en el `*ngIf`.
    for (const c of ['hoy', 'todos', 'cargado', 'docs']) {
      exigir(por(c).noEditable === 0,
        'la dueña del checklist NO debe ver el aviso de «no puedes editar» en «' + c +
        '», y lo ve ' + por(c).noEditable + ' vez(ces)');
    }
    exigir(por('docs').sinCaptura === 23, 'los 23 puntos de documento deben dejar el selector libre, lo dejan ' + por('docs').sinCaptura);
    exigir(por('cargado').lazy === por('cargado').miniaturas,
      'las ' + por('cargado').miniaturas + ' miniaturas deben ir en carga diferida, van ' + por('cargado').lazy);
    // El techo que la 046 fijó con sangre: el estado VACÍO no puede cuadruplicar.
    const crecimiento = por('todos').nodos / por('hoy').nodos;
    exigir(crecimiento < 2,
      'el DOM vacío crece x' + crecimiento.toFixed(2) + ' al encender los 23 puntos. La 046 apagó ' +
      'esto por un x4 que trababa los celulares; por encima de x2 hay que volver a mirar.');

    console.log('');
    if (fallos.length) {
      console.error('✗ %d aserción(es) rotas:', fallos.length);
      for (const x of fallos) console.error('   · ' + x);
      process.exit(2);
    }
    console.log('✓ las %d condiciones pasan. DOM vacío x%s · al final del turno %d nodos y %d miniaturas.',
      filas.length, crecimiento.toFixed(2), por('cargado').nodos, por('cargado').miniaturas);
    console.log('');
    console.log('Lo que esto NO prueba: que la foto sea de lo que dice ser. `capture` abre la');
    console.log('cámara en el celular pero es una indicación al navegador, no un candado. El');
    console.log('ancla real es la hora de captura que se guarda con cada foto.');
  })();
}
