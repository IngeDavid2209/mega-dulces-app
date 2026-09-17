/**
 * 🗂️ LA LISTA SE PLIEGA: cada bloque es un BOTÓN, medido en el DOM
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Instrucción de David (17/sep/2026), sobre la captura de «8 Esquinas · 42
 * tareas» con las tarjetas debajo: «no lo quiero solo así, quiero que esté
 * dentro de botones y de ahí se desglose». Y las dos decisiones que tomó
 * enfrentado a las opciones: DOS niveles (sucursal y persona), TODO CERRADO al
 * entrar, y sin recordar nada entre sesiones.
 *
 * ─── POR QUÉ ESTO NO SE PUEDE PROBAR CON `ng test` ───────────────────────
 * Lo que hay que contestar es «¿cuántas tarjetas hay DELANTE de alguien?», y un
 * `*ngIf` no es una función que se pueda llamar. Las 294 pruebas unitarias
 * siguen pasando con la lista entera desplegada: no miran el DOM.
 *
 * ─── LA PREGUNTA CARA, QUE NO ES «¿SE PLIEGA?» ──────────────────────────
 * Plegarlo todo es fácil; el riesgo es dejar a alguien mirando una pantalla de
 * botones SIN SUS TAREAS, que es indistinguible de «no tengo trabajo» (§5.2).
 * Por eso el escenario que más pesa aquí es el de la TRABAJADORA: una sola
 * persona en la bandeja, y sus tarjetas tienen que verse SIN pulsar nada. Si
 * ese caso se rompiera, se rompería para los 154 que entregan todos los días, y
 * la lista de arriba seguiría plegándose preciosa.
 *
 * ─── SE MIDE SOBRE «ENVIADAS» A PROPÓSITO ───────────────────────────────
 * Es la bandeja de la captura de David (las tarjetas llevan ENVIADO), y además
 * la única donde un supervisor ve la lista agrupada: en «Pendientes del equipo»
 * se pinta el ÁRBOL del organigrama, no esta rejilla (`verPorOrganigrama` exige
 * `vistaHistorial() === 'pendientes'`). Medir ahí habría dado ceros por
 * pintarse otra cosa, no por el plegado.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const DIST = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');

function abortar(motivo) {
  console.error('');
  console.error('[plegable] ABORTA: ' + motivo);
  console.error('[plegable] "No pude medir" y "está roto" son dos cosas. No concluyas de esta corrida.');
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

const JEFA = 'Ana Prueba Plegable';
const CLAUDIA = 'Claudia Prueba Plegable';
const YAZMIN = 'Yazmin Prueba Plegable';
const MARTA = 'Marta Prueba Plegable';

/**
 * Ve lo de los demás: con `puedeVerHistorial` pasa `esSupervisor`.
 *
 * `puedeCrearChecklists` no está de adorno: el buscador de la pantalla vive
 * dentro de un `*ngIf` que lo exige, así que sin esa bandera el escenario de la
 * búsqueda no tenía dónde escribir. Lo dijo la guardia del paso, no se adivinó.
 */
const SUPERVISORA = {
  uid: 's1', id: 's1', nombre: JEFA, usuario: 'ana', correo: 'ana@l.invalid',
  rol: 'trabajador', sucursales: ['8 Esquinas', 'Canindo'],
  puedeVerHistorial: true, puedeCrearChecklists: true,
};
/** Sin banderas: solo ve lo suyo. Es el caso de los 154 que entregan. */
const TRABAJADORA = {
  uid: 'w1', id: 'w1', nombre: CLAUDIA, usuario: 'clau', correo: 'clau@l.invalid',
  rol: 'trabajador', sucursales: ['8 Esquinas'],
};

const ITEMS = [{ id: 'i1', text: 'Punto uno' }, { id: 'i2', text: 'Punto dos' }];
const B = { items: ITEMS, enviado: true, timestampCreacion: Date.now(), createdBy: JEFA };

/**
 * DOS sucursales con DISTINTO número de gente y de tareas, y ninguna cifra
 * repetida: 8 Esquinas 5 (Claudia 3 + Yazmin 2) y Canindo 2 (Marta 2).
 *
 * Los números tienen que diferir o la prueba no distingue «abrió la que pulsé»
 * de «abrió otra»: con dos bloques de 3 y 3, pulsar el equivocado daría el
 * mismo conteo y pasaría en verde. Es el control que le faltaba al arnés de la
 * bandeja hasta que se le pusieron tamaños distintos (14/sep).
 */
const FILAS = [
  { id: 'a1', date: HOY, name: 'Pasillo 2 y cabeceras', assigned: CLAUDIA, store: '8 Esquinas', ...B },
  { id: 'a2', date: HOY, name: 'Acomodo de mercancia', assigned: CLAUDIA, store: '8 Esquinas', ...B },
  { id: 'a3', date: HOY, name: 'Pasillo limpio sin restos', assigned: CLAUDIA, store: '8 Esquinas', ...B },
  { id: 'a4', date: HOY, name: 'Puntualidad y uniforme', assigned: YAZMIN, store: '8 Esquinas', ...B },
  { id: 'a5', date: HOY, name: 'Revision de caducidades', assigned: YAZMIN, store: '8 Esquinas', ...B },
  { id: 'b1', date: HOY, name: 'Bodega ordenada', assigned: MARTA, store: 'Canindo', ...B },
  { id: 'b2', date: HOY, name: 'Anden despejado', assigned: MARTA, store: 'Canindo', ...B },
];
const OCHO_TOTAL = 5, CLAUDIA_TAREAS = 3;

const USUARIOS = [
  // ⚠ LAS DOS SUCURSALES, y no es un detalle del fixture: la app resincroniza
  // el perfil contra /api/usuarios, así que esta fila PISA las sucursales de la
  // sesión sembrada. Con una sola aquí, Canindo se quedaba fuera del alcance de
  // la jefa, el agrupador veía un solo bloque y no pintaba encabezado de
  // sucursal: cero botones. La guardia lo dijo con todas sus letras («no
  // encontré "8 Esquinas", había 0 candidatos») en vez de dejar pasar unos
  // ceros que se habrían leído como «el plegado no funciona».
  { id: 's1', nombre: JEFA, puestoId: 'encargado-sucursal', activo: true,
    sucursales: ['8 Esquinas', 'Canindo'] },
  { id: 'u2', nombre: CLAUDIA, puestoId: 'anaquelista', activo: true, sucursales: ['8 Esquinas'] },
  { id: 'u3', nombre: YAZMIN, puestoId: 'anaquelista', activo: true, sucursales: ['8 Esquinas'] },
  { id: 'u4', nombre: MARTA, puestoId: 'anaquelista', activo: true, sucursales: ['Canindo'] },
];
const CUERPO = JSON.stringify({ checklists: FILAS, usuarios: USUARIOS, areas: [] });

const IR_A_ENVIADAS = { tipo: 'boton', sel: '.cl-bandeja .vista-tab', texto: 'Enviadas del equipo' };
const IR_A_MIS_ENVIADAS = { tipo: 'boton', sel: '.cl-bandeja .vista-tab', texto: 'Mis tareas enviadas' };

const ESCENARIOS = [
  {
    nombre: 'entro a Enviadas (todo cerrado)',
    sesion: SUPERVISORA, pasos: [IR_A_ENVIADAS],
    // LO QUE DAVID PIDIÓ: se ven los botones y NINGUNA tarjeta.
    sucBotones: 2, perBotones: 0, tarjetas: 0,
  },
  {
    nombre: 'abro 8 Esquinas',
    sesion: SUPERVISORA,
    pasos: [IR_A_ENVIADAS, { tipo: 'boton', sel: '.cl-grupo-suc', texto: '8 Esquinas' }],
    // Salen SUS dos personas, y todavía ninguna tarjeta: son dos niveles.
    sucBotones: 2, perBotones: 2, tarjetas: 0,
  },
  {
    nombre: 'abro 8 Esquinas y a Claudia',
    sesion: SUPERVISORA,
    pasos: [IR_A_ENVIADAS,
            { tipo: 'boton', sel: '.cl-grupo-suc', texto: '8 Esquinas' },
            { tipo: 'boton', sel: '.cl-grupo-per', texto: CLAUDIA }],
    // Las 3 de Claudia y NINGUNA de Yazmin: si saliera 5, el segundo nivel no
    // estaría recortando y el «desglose» sería un adorno.
    sucBotones: 2, perBotones: 2, tarjetas: CLAUDIA_TAREAS,
  },
  {
    nombre: 'abro Canindo (la otra sigue cerrada)',
    sesion: SUPERVISORA,
    pasos: [IR_A_ENVIADAS, { tipo: 'boton', sel: '.cl-grupo-suc', texto: 'Canindo' }],
    // 1 sola persona visible (Marta) prueba que abrir una sucursal NO abre la
    // de al lado. Con 3 aquí, el estado sería global y no por bloque.
    sucBotones: 2, perBotones: 1, tarjetas: 0,
  },
  {
    nombre: 'escribo en el buscador',
    sesion: SUPERVISORA,
    pasos: [IR_A_ENVIADAS, { tipo: 'buscar', texto: 'Bodega' }],
    // GUARDA 3: quien ya recortó la lista no tiene que volver a abrir nada.
    // Sin ella, buscar devolvería una pantalla de botones vacíos.
    //
    // ⚠ CERO botones de sucursal, y el esperado sale de la REGLA, no de lo que
    // midió la corrida: «Bodega» deja un solo grupo, y `mostrarEncabezadoSucursal`
    // ya decía desde antes de este cambio que con un grupo el encabezado diría
    // siempre lo mismo y es ruido. Aquí escribí 1 a ojo, falló, y lo correcto
    // era 0 — ajustar el esperado al artefacto sin derivarlo del código es
    // justo el defecto que la §8.11 persigue, así que queda dicho de dónde sale.
    sucBotones: 0, perBotones: 1, tarjetas: 1,
  },
  {
    nombre: 'TRABAJADORA: sus tareas, sin pulsar',
    sesion: TRABAJADORA, pasos: [IR_A_MIS_ENVIADAS],
    // GUARDA 1 y 2, y es la fila que protege a los 154. Una sola sucursal y una
    // sola persona: no se pinta encabezado de sucursal, y el de persona no
    // pliega porque no hay entre qué elegir. Sus 3 tarjetas se ven de entrada.
    sucBotones: 0, perBotones: 1, tarjetas: CLAUDIA_TAREAS,
  },
];

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

/**
 * El guion que se inyecta en la página.
 *
 * Se arma con un arreglo de líneas y se une con saltos, en vez de concatenar
 * con `+` al final de cada una. El motivo está escrito dos veces en la bitácora
 * de este repo: si falta un `+`, JavaScript NO da error — la inserción
 * automática de punto y coma parte la expresión en dos sentencias válidas, el
 * guion sale truncado y el título nunca se fija, que se lee como «la app no
 * pintó». Con un arreglo, una coma olvidada es un error de sintaxis aquí mismo.
 */
function guion(esc) {
  const sesion = JSON.stringify(JSON.stringify(esc.sesion));
  const pasos = JSON.stringify(esc.pasos);
  return [
    '<script>try{',
    'localStorage.setItem("md_sesion_actual",' + sesion + ');',
    'localStorage.setItem("md_token","token-de-medicion");',
    // El modo de agrupación se siembra: es el que David tiene puesto y el que
    // esta pantalla viene a medir. Dejarlo a lo que traiga el navegador sería
    // medir otra vista sin enterarse.
    'localStorage.setItem("md_agrupacion_tareas","sucursal");',
    '}catch(e){}</script>',
    '<script>',
    'window.__pasos=' + pasos + ';',
    'function texto(e){return (e.textContent||"").replace(/\\s+/g," ").trim();}',
    'function hacer(p){',
    '  if(p.tipo==="buscar"){',
    '    var i=document.querySelector("input.form-input[placeholder^=\'Buscar tarea\']");',
    '    if(!i){window.__falla="no encontre el buscador";return;}',
    '    i.value=p.texto;',
    '    i.dispatchEvent(new Event("input",{bubbles:true}));',
    '    return;',
    '  }',
    '  var todos=[].slice.call(document.querySelectorAll(p.sel));',
    '  var b=todos.filter(function(e){return texto(e).indexOf(p.texto)>=0;})[0];',
    // La guardia nombra el paso Y cuántos candidatos había: «no encontré el
    // botón» y «había 4 y ninguno decía eso» mandan a sitios distintos.
    '  if(!b){window.__falla="no encontre \\""+p.texto+"\\" en "+p.sel+" (habia "+todos.length+" candidatos)";return;}',
    '  b.click();',
    '}',
    'function paso(i){',
    '  if(window.__falla) return fin();',
    '  if(i>=window.__pasos.length) return setTimeout(fin,900);',
    '  hacer(window.__pasos[i]);',
    '  setTimeout(function(){paso(i+1);},900);',
    '}',
    'function fin(){',
    'var sucs=[].slice.call(document.querySelectorAll("button.cl-grupo-suc"));',
    'var pers=[].slice.call(document.querySelectorAll("button.cl-grupo-per"));',
    'document.title="RES "+JSON.stringify({',
    ' sucBotones: sucs.length,',
    ' perBotones: pers.length,',
    ' tarjetas: document.querySelectorAll(".checklist-card").length,',
    ' sucTextos: sucs.map(texto),',
    ' perTextos: pers.map(texto),',
    // El mecanismo, no la apariencia: `aria-expanded` es lo que el botón AFIRMA
    // de sí mismo. Si dijera "true" con las tarjetas escondidas, el plegado
    // estaría mintiéndole a quien navega con lector de pantalla.
    ' sucAbiertos: sucs.filter(function(e){return e.getAttribute("aria-expanded")==="true";}).length,',
    // Los <div> viejos tienen que ser CERO. Si quedara uno, habría un
    // encabezado que no se puede plegar y la mitad del cambio no aplicaría.
    ' divsViejos: document.querySelectorAll("div.cl-grupo-suc, div.cl-grupo-per").length,',
    ' falla: window.__falla || ""',
    '});}',
    'window.addEventListener("load",function(){setTimeout(function(){paso(0);},3400);});',
    '</script>',
  ].join('\n');
}

function medir(esc, puerto) {
  return new Promise((resolve) => {
    const sano = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const html = sano.replace('<body>', '<body>' + guion(esc));
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
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-plegable-'));
      // La URL se arma AQUÍ, con la barra puesta por código: en Git Bash, MSYS
      // convierte '/tareas' en 'C:/Program Files/Git/tareas' si pasa por una
      // variable de entorno, y el DOM llega vacío. Es la cuarta vez en el repo.
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--window-size=1440,1052', '--user-data-dir=' + perfil, '--virtual-time-budget=30000',
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
          return resolve({
            error: 'sin medición · title=' + (t ? JSON.stringify(t[1]) : 'ninguno') +
                   ' · dom=' + dom.length + 'B',
          });
        }
        try { resolve({ dato: JSON.parse(m[1]), apiPedidos }); }
        catch (e) { resolve({ error: 'el título no era JSON: ' + m[1].slice(0, 140) }); }
      });
    });
  });
}

(async () => {
  if (!CHROME) abortar('no encontré Chrome.');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) abortar('no hay dist/. Corre `npm run build` antes.');

  console.log('');
  console.log('  🗂️  LA LISTA SE PLIEGA — %s entregas, 2 sucursales, 3 personas', FILAS.length);
  console.log('  ──────────────────────────────────────────────────────────────');
  console.log('  %s  suc  per  tarjetas', 'escenario'.padEnd(34));

  let fallos = 0, medidos = 0;
  const vistos = [];

  for (let i = 0; i < ESCENARIOS.length; i++) {
    const esc = ESCENARIOS[i];
    const r = await medir(esc, 4700 + i);
    if (r.error) abortar(esc.nombre + ' → ' + r.error);
    const d = r.dato;
    if (d.falla) abortar(esc.nombre + ' → el escenario no montó lo que venía a medir: ' + d.falla);
    // Sin peticiones a /api la app no tiene datos, y todos los ceros de abajo
    // significarían «no llegó nada», no «está plegado». Son dos frases.
    if (!r.apiPedidos) abortar(esc.nombre + ' → la app nunca pidió /api: los ceros no valen.');
    medidos++;
    vistos.push(d);

    console.log('  %s  %s  %s  %s', esc.nombre.padEnd(34),
      String(d.sucBotones).padStart(3), String(d.perBotones).padStart(3),
      String(d.tarjetas).padStart(8));

    const comprobar = (que, esperado, medido) => {
      if (esperado !== medido) {
        console.log('      ✗ %s: esperaba %s, medí %s', que, esperado, medido);
        fallos++;
      }
    };
    comprobar('botones de sucursal', esc.sucBotones, d.sucBotones);
    comprobar('botones de persona', esc.perBotones, d.perBotones);
    comprobar('tarjetas visibles', esc.tarjetas, d.tarjetas);
    if (d.divsViejos) {
      console.log('      ✗ quedaron %s encabezados como <div>: ésos no se pueden plegar', d.divsViejos);
      fallos++;
    }
  }

  // ── Las que no se contestan con una fila sola ──────────────────────────
  console.log('');
  const entro = vistos[0], ochoAbierta = vistos[1], claudiaAbierta = vistos[2], canindo = vistos[3];

  // 1. El botón dice de sí mismo lo que de verdad está pasando.
  if (entro.sucAbiertos !== 0) {
    console.log('  ✗ al entrar, %s sucursal(es) se anuncian abiertas con las tarjetas escondidas',
      entro.sucAbiertos);
    fallos++;
  }
  if (ochoAbierta.sucAbiertos !== 1) {
    console.log('  ✗ tras abrir una, aria-expanded="true" en %s (esperaba 1)', ochoAbierta.sucAbiertos);
    fallos++;
  }

  // 2. El número del encabezado es el que se despliega. Un botón que dice 5 y
  //    abre 3 es peor que no decir nada: se lee como tareas perdidas.
  const rotulo = ochoAbierta.sucTextos.find(t => t.indexOf('8 Esquinas') >= 0) || '';
  if (rotulo.indexOf(String(OCHO_TOTAL)) < 0) {
    console.log('  ✗ el botón de 8 Esquinas no dice %s: «%s»', OCHO_TOTAL, rotulo);
    fallos++;
  }
  const rotClaudia = claudiaAbierta.perTextos.find(t => t.indexOf(CLAUDIA) >= 0) || '';
  if (rotClaudia.indexOf(String(CLAUDIA_TAREAS)) < 0 || claudiaAbierta.tarjetas !== CLAUDIA_TAREAS) {
    console.log('  ✗ el botón de Claudia dice «%s» y desplegó %s tarjetas',
      rotClaudia, claudiaAbierta.tarjetas);
    fallos++;
  }

  // 3. GUARDIA DE DISCRIMINACIÓN. Sin esto, un `perAbierta()` que devolviera
  //    siempre `false` pasaría casi todo lo de arriba con ceros perfectos. La
  //    muestra tiene que producir un SÍ y un NO del mismo eje.
  const hayCerrado = vistos.some(d => d.tarjetas === 0);
  const hayAbierto = vistos.some(d => d.tarjetas > 0);
  if (!hayCerrado || !hayAbierto) {
    abortar('la muestra no discrimina: ningún escenario ' +
      (hayAbierto ? 'quedó plegado' : 'llegó a desplegar tarjetas') +
      '. Un verde aquí no probaría nada.');
  }
  if (ochoAbierta.perBotones === canindo.perBotones) {
    abortar('abrir 8 Esquinas y abrir Canindo dan el mismo número de personas (' +
      canindo.perBotones + '): la prueba no distingue cuál se abrió.');
  }

  console.log('  ──────────────────────────────────────────────────────────────');
  console.log('  %s escenarios medidos · %s fallo(s)', medidos, fallos);
  console.log('  discrimina: plegado %s ↔ desplegado %s tarjetas',
    Math.min(...vistos.map(d => d.tarjetas)), Math.max(...vistos.map(d => d.tarjetas)));
  console.log('');
  process.exit(fallos ? 2 : 0);
})();
