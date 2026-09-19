/**
 * 🌳 EL ÁRBOL ARRANCA EN SU PUESTO — TAMBIÉN CUANDO HAY TRABAJO
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Existe por un defecto que estuvo desplegado una semana sin que nada lo viera,
 * y la razón de por qué no se vio es la mitad de la lección:
 *
 *   `prueba-vista-por-nivel.js` sirve `/api` VACÍO a propósito —su cabecera lo
 *   dice— porque ahí lo que se mide es el GATE, no el dato. Pero cero entregas
 *   resulta ser el ÚNICO estado en el que el enraizado funcionaba. El control
 *   pasaba, y pasaba por un camino donde el caso no podía ocurrir (§8.11 c).
 *
 * Medido el 18/sep con la MISMA sesión y los MISMOS usuarios, cambiando solo
 * el número de entregas del día:
 *
 *     0 entregas  ->  raíz «Encargado(a) de Sucursal»                     ✓
 *     6 entregas  ->  raíz «Dirección General», marcada «servicio a»      ✗
 *
 * ─── LO QUE ESTA PRUEBA NO PUEDE SER ────────────────────────────────────
 * Si solo afirmara «la raíz es su puesto», la pasaría un arreglo que BORRARA
 * la salida de «servicio a» entera — y con ella, una Encargada dejaría de ver
 * a la gente de otras áreas que trabaja en su tienda: 20 personas donde trabajan 38,
 * que se lee como que el sistema está incompleto. Por eso el escenario de la
 * Encargada lleva TAMBIÉN una entrega ajena en su sucursal, y se exige que
 * esa rama siga saliendo aparte y marcada. Las dos mitades o ninguna.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const DIST = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');

function abortar(motivo) {
  console.error('');
  console.error('[rama] ABORTA: ' + motivo);
  console.error('[rama] "No pude medir" y "está roto" son dos cosas distintas.');
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

const ENCARGADA = 'Veronica Prueba Rama';
const ANAQUELISTA = 'Claudia Prueba Rama';
const CAJERA = 'Yazmin Prueba Rama';
const AJENO = 'Raul Prueba Rama';
// `checador`: tiene manual (`tareas-manual.catalogo.ts:581`) y NO cuelga de
// `encargado-sucursal` —es `operaciones-zona`—, así que ejerce el «servicio a»
// sin depender del filtro «Solo con manual», que viene encendido por omisión.
//
// ⚠ CORRECCIÓN DE UNA EXPLICACIÓN MÍA QUE ERA FALSA (§8.11 f). Cambié aquí un
// `vendedor-rd` creyendo que el filtro se comía su entrega por no tener manual.
// NO es así: la poda conserva todo puesto con entregas del día
// (`vista-organigrama.ts`: `!tieneManual && entregasHoy === 0 && sin hijos`), y
// con el vendedor el conteo daba los mismos 5 de 6. Lo que faltaba era otra
// cosa —la entrega de la propia Encargada, ver abajo—. Queda escrito porque una
// explicación equivocada en un comentario se cita después como si fuera dato.

const SESION_ENCARGADA = {
  uid: 'e1', id: 'e1', nombre: ENCARGADA, usuario: 'vero', correo: 'vero@l.invalid',
  rol: 'trabajador', sucursales: ['8 Esquinas'], puestoId: 'encargado-sucursal',
  puedeVerHistorial: true, puedeCrearChecklists: true,
};

const ITEMS = [{ id: 'i1', text: 'Punto uno', requiresPhoto: true }];
const B = { items: ITEMS, status: 'pendiente', createdBy: 'Robot del Manual', _origenManual: true };

/** Cinco de su propia rama + UNA de Ventas, que es la que prueba «servicio a». */
const CON_TRABAJO = [
  { id: 'v1', date: HOY, name: 'Checklist de apertura', assigned: ENCARGADA, store: '8 Esquinas', ...B },
  // ⚠ `time: '00:01'` EN DOS DE ELLAS. Sin esto, el arbol las da todas a tiempo
  // -su `esVencida` cae a las 23:59 cuando el checklist no trae hora- y la
  // columna «vencidas» seria 0 en las cuatro filas: un cero que significa
  // «nunca se ejercio», no «no hay». La hora se elige ya pasada a cualquier
  // hora del dia salvo el primer minuto, de lo que avisa la guardia de abajo.
  { id: 'c1', date: HOY, name: 'Acomodo de pasillo 2', assigned: ANAQUELISTA, store: '8 Esquinas', time: '00:01', ...B },
  { id: 'c2', date: HOY, name: 'Revision de caducidades', assigned: ANAQUELISTA, store: '8 Esquinas', ...B },
  { id: 'y1', date: HOY, name: 'Corte de caja', assigned: CAJERA, store: '8 Esquinas', time: '00:01', ...B },
  { id: 'y2', date: HOY, name: 'Area de cobro limpia', assigned: CAJERA, store: '8 Esquinas', ...B },
  { id: 'r1', date: HOY, name: 'Checado de pedido', assigned: AJENO, store: '8 Esquinas', ...B },
];

const USUARIOS = [
  // ⚠ DIRECCION TIENE QUE ESTAR AQUI, no basta con sembrarle la sesion: la app
  // resincroniza el perfil contra `/api/usuarios` (`app.ts`, cada 60 s) y esa
  // fila PISA lo sembrado. Sin ella su alcance se perdia y el componente
  // contaba 0 entregas —un cero que se lee como «el arbol no recibe datos»—.
  // Lo dijo la guardia del testigo, no una sospecha.
  { id: 'd1', nombre: 'Direccion Prueba Rama', puestoId: 'direccion-general', activo: true,
    rol: 'admin', alcance: 'global', sucursales: ['8 Esquinas'] },
  { id: 'e1', nombre: ENCARGADA, puestoId: 'encargado-sucursal', activo: true, sucursales: ['8 Esquinas'] },
  { id: 'a1', nombre: ANAQUELISTA, puestoId: 'anaquelista', activo: true, sucursales: ['8 Esquinas'] },
  { id: 'y1', nombre: CAJERA, puestoId: 'cajero-sucursal', activo: true, sucursales: ['8 Esquinas'] },
  { id: 'r1', nombre: AJENO, puestoId: 'checador', activo: true, sucursales: ['8 Esquinas'] },
];

const RAIZ_ESPERADA = 'Encargado(a) de Sucursal';

/**
 * Direccion: admin global, asi que su ambito NO se restringe y el arbol se
 * queda completo. Es el contraste del titulo: sin esta fila, un
 * `tituloArbol()` que devolviera «Mi equipo» SIEMPRE pasaria las tres filas de
 * la Encargada en verde.
 */
const SESION_DIRECCION = {
  uid: 'd1', id: 'd1', nombre: 'Direccion Prueba Rama', usuario: 'dir',
  // ⚠ `alcance: 'global'` Y NO 'todas'. Los unicos valores que la app usa son
  // 'global' y 'sucursales' (`permisos.util.ts:78` y :95). Escribi 'todas' —un
  // valor que NO EXISTE— y el arbol conto 0 entregas; estuve a un paso de
  // reportar «un administrador ve la operacion vacia», que habria sido una
  // alarma falsa nacida de inventarme el dato (§8.5). Con los dos valores
  // reales cuenta las 6. Queda escrito para que nadie vuelva a teclear aqui un
  // valor de fantasia y lo lea como un hallazgo.
  //
  // Y CON sucursales: con `sucursales: []` el filtro de visibilidad la deja
  // sin nada que ver, y el escenario se quedaria sin medir su propio caso.
  correo: 'dir@l.invalid', rol: 'admin', alcance: 'global', puedeVerHistorial: true, sucursales: ['8 Esquinas'],
  puestoId: 'direccion-general', puedeVerHistorial: true, puedeCrearChecklists: true,
};

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

const ESCENARIOS = [
  {
    nombre: 'CON trabajo (6 entregas)',
    checklists: CON_TRABAJO,
    // La fila del defecto. Antes del arreglo daba «Dirección General».
    raiz: RAIZ_ESPERADA, minRaices: 2, minCruzadas: 1,
    resumen: { pendientes: 5, vencidas: 2, aTiempo: 3 },
  },
  {
    nombre: 'SIN trabajo (0 entregas)',
    checklists: [],
    // Es el estado que `prueba-vista-por-nivel` ya cubría, y el único donde el
    // enraizado funcionaba antes. Se conserva para que el arreglo no lo rompa.
    raiz: RAIZ_ESPERADA, minRaices: 1, minCruzadas: 0,
    // El vacio NO dice «todo entregado»: no se puede distinguir de «hoy no se
    // emitio nada», porque las entregadas ni siquiera estan en esta lista.
    resumen: { pendientes: 0, vencidas: 0, aTiempo: 0 },
  },
  {
    nombre: 'solo lo suyo (sin lo ajeno)',
    checklists: CON_TRABAJO.filter((c) => c.assigned !== AJENO),
    // CONTRASTE: sin trabajo ajeno NO debe aparecer ninguna pastilla «servicio
    // a». Sin esta fila, un arreglo que marcara todo como cruzado pasaría la
    // primera en verde.
    raiz: RAIZ_ESPERADA, minRaices: 1, maxCruzadas: 0,
    resumen: { pendientes: 4, vencidas: 2, aTiempo: 2 },
  },
  {
    nombre: 'CONTRASTE: Direccion ve todo',
    sesion: SESION_DIRECCION,
    checklists: CON_TRABAJO,
    // Su arbol NO se enraiza -ve la empresa- asi que la raiz vuelve a ser
    // Direccion General LEGITIMAMENTE, y el titulo no cambia.
    // LA FILA QUE CONTESTA LA SEGUNDA PREGUNTA DE DAVID: Direccion NO ve un
    // resumen roto ni en ceros. Ve SU alcance -las 6, incluida la de la
    // Encargada, que para ella no es «suya»- porque el resumen cuenta lo que la
    // pantalla ya esta autorizada a enseñar, sin suponer que quien mira es de
    // piso. Por eso NO lleva un `*ngIf` de rol: no hace falta, y cada gate
    // nuevo es una forma mas de dejar ciego a alguien sin enterarse.
    resumen: { pendientes: 6, vencidas: 2, aTiempo: 4 },
    raiz: 'Dirección General', minRaices: 1, titulo: 'Organigrama 2026',
    // Direccion no es la Encargada, asi que aqui cuentan las 6.
    todasLasEntregas: true,
  },
];

function guion(esc) {
  return [
    '<script>try{',
    'localStorage.setItem("md_sesion_actual",' + JSON.stringify(JSON.stringify(esc.sesion || SESION_ENCARGADA)) + ');',
    'localStorage.setItem("md_token","token-de-medicion");',
    '}catch(e){}</script>',
    '<script>',
    'function texto(e){return (e.textContent||"").replace(/\\s+/g," ").trim();}',
    'function fin(){',
    '  var nombres=[].slice.call(document.querySelectorAll(".org-puesto-nombre")).map(texto);',
    // Las raíces son las filas de profundidad 0. Es la clase que la plantilla
    // arma por interpolación (`org-nivel-{{ f.prof }}`), así que se pregunta
    // por ella directamente en vez de deducirla del sangrado.
    '  var raices=[].slice.call(document.querySelectorAll(".org-puesto.org-nivel-0"));',
    '  var d={',
    '    arbol: document.querySelectorAll("app-vista-organigrama").length,',
    '    titulo: (function(){ var t=document.querySelector(".org-titulo"); return t?texto(t):"(ninguno)"; })(),',
    '    resumen: (function(){ var r=document.querySelector(".org-resumen"); return r?texto(r):"(no se pinto)"; })(),',
    '    resumenChips: [].slice.call(document.querySelectorAll(".org-resumen-chip")).map(texto),',
    // La pregunta de David: ¿el bloque nuevo empuja el arbol fuera de la
    // primera pantalla? Se mide DONDE EMPIEZA la primera fila del arbol contra
    // el alto de la ventana. Un bloque que resuelve la carga cognitiva
    // escondiendo el trabajo no resuelve nada.
    '    topPrimeraFila: (function(){ var f=document.querySelector(".org-puesto"); return f?Math.round(f.getBoundingClientRect().top):-1; })(),',
    '    altoVentana: window.innerHeight,',
    '    altoResumen: (function(){ var r=document.querySelector(".org-resumen"); return r?Math.round(r.getBoundingClientRect().height):0; })(),',
    '    topResumen: (function(){ var r=document.querySelector(".org-resumen"); return r?Math.round(r.getBoundingClientRect().top):-1; })(),',
    '    altoBarra: (function(){ var b=document.querySelector(".org-barra"); return b?Math.round(b.getBoundingClientRect().height):0; })(),',
    '    topBarra: (function(){ var b=document.querySelector(".org-barra"); return b?Math.round(b.getBoundingClientRect().top):0; })(),',
    '    anchoViewport: window.innerWidth,',
    '    raiz: nombres[0] || "(ninguna)",',
    '    puestos: nombres.length,',
    '    raices: raices.length,',
    '    nombresRaices: raices.map(function(e){',
    '      var n=e.querySelector(".org-puesto-nombre"); return n?texto(n):"(sin nombre)";',
    '    }),',
    '    cruzadas: document.querySelectorAll(".org-puesto .org-cruzada").length,',
    // TESTIGO: el componente publica cuántas entregas contó. Sin esto, un árbol
    // vacío por no haber llegado el dato se ve igual que uno vacío de verdad.
    '    subtitulo: (function(){',
    // ⚠ SE LEE DEL ELEMENTO, NO DEL TEXTO VISIBLE: en telefono ese renglon se
    // esconde a proposito (el resumen lo supersede) y `innerText` no ve lo
    // escondido, asi que el testigo se apagaba justo en el modo que vigila.
    '      var e=document.querySelector(".org-sub-totales");',
    '      var t=e ? e.textContent : (document.body.innerText||"");',
    '      var m=/(\\d+)\\s+puestos\\s+·\\s+(\\d+)\\s+entregadas/.exec(t);',
    '      return m ? {puestos:+m[1], entregas:+m[2]} : null;',
    '    })(),',
    '  };',
    '  try{ fetch("/__medida",{method:"POST",body:JSON.stringify(d)}); }catch(e){}',
    '}',
    'window.addEventListener("load",function(){setTimeout(fin,4200);});',
    '</script>',
  ].join('\n');
}

function medir(esc, puerto) {
  return new Promise((resolve) => {
    const cuerpo = JSON.stringify({ checklists: esc.checklists, usuarios: USUARIOS, areas: [] });
    const sano = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const html = sano.replace('<body>', '<body>' + guion(esc));
    if (html === sano) return resolve({ error: 'no pude inyectar la sesión' });

    let apis = 0; let medida = null;
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/__medida') {
        let b = ''; req.on('data', (c) => { b += c; });
        req.on('end', () => { try { medida = JSON.parse(b); } catch (e) {} res.writeHead(204); res.end(); });
        return;
      }
      if (url.indexOf('/api/') === 0) {
        apis++; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(cuerpo);
      }
      if (url === '/movil') {
        // 390px REALES. Chrome topa el ancho minimo de ventana en ~500px, asi
        // que `--window-size=390` mediria el escritorio y daria verde sin tocar
        // el caso (leccion del 7/sep). Un documento dentro de un marco evalua
        // sus media queries contra el viewport DEL MARCO.
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        return res.end('<!doctype html><html><head><meta charset="utf-8">' +
          '<style>html,body{margin:0;padding:0}iframe{border:0;display:block;width:390px;height:844px}</style>' +
          '</head><body><iframe src="/tareas"></iframe></body></html>');
      }
      if (url === '/' || !path.extname(url)) {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        return res.end(html);
      }
      const f = path.join(DIST, url);
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.on('error', (e) => resolve({ error: 'el servidor local no levantó: ' + e.message }));
    srv.listen(puerto, () => {
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-rama-'));
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--window-size=' + (process.env.MOVIL ? '420,900' : '1440,1400'), '--user-data-dir=' + perfil, '--virtual-time-budget=30000',
        '--disable-background-networking', '--disable-sync', '--disable-component-update',
        '--disable-features=PushMessaging,OptimizationHints',
        '--dump-dom', 'http://localhost:' + puerto + (process.env.MOVIL ? '/movil' : '/tareas')],
        { stdio: ['ignore', 'pipe', 'ignore'] });
      let dom = '';
      h.stdout.on('data', (d) => { dom += d.toString('utf8'); });
      h.on('error', (e) => { srv.close(); resolve({ error: 'no pude lanzar Chrome: ' + e.message }); });
      h.on('close', () => {
        srv.close();
        // En modo telefono el `--dump-dom` devuelve el ENVOLTORIO del iframe
        // -unos 200 bytes- y no la app, asi que esta guardia no aplica ahi. La
        // que sirve en los dos modos es la de abajo: sin `medida` no hubo
        // medicion, y sin `apis` los ceros no valen.
        if (!process.env.MOVIL && dom.length < 500) {
          return resolve({ error: 'DOM de ' + dom.length + ' bytes' });
        }
        if (!medida) return resolve({ error: 'el guion no reportó medición (dom=' + dom.length + 'B)' });
        resolve({ dato: medida, apis });
      });
    });
  });
}

(async () => {
  if (!CHROME) abortar('no encontré Chrome.');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) abortar('no hay dist/. Corre `npm run build` antes.');

  // §8.11(a): la hora de la corrida es una ENTRADA. En el primer minuto del dia
  // las dos entregas de las 00:01 todavia no han vencido y la tabla mediria otra
  // cosa. Se aborta en vez de reportar un fallo falso.
  const ahora = new Date();
  if (ahora.getHours() === 0 && ahora.getMinutes() <= 1) {
    abortar('son las ' + ahora.toTimeString().slice(0, 5) + ': las entregas de las 00:01 ' +
            'todavia no vencen y los esperados de vencidas no aplican.');
  }

  console.log('');
  console.log('  🌳 EL ÁRBOL DE LA ENCARGADA — raíz «%s» · %s', RAIZ_ESPERADA,
    process.env.MOVIL ? 'TELEFONO 390x844' : 'escritorio 1440');
  console.log('  ──────────────────────────────────────────────────────────────────────');
  console.log('  %s %s %s %s  %s  raíz', 'escenario'.padEnd(28),
    'entregas'.padStart(9), 'raíces'.padStart(7), 'cruzadas'.padStart(9), 'titulo'.padEnd(16) + ' resumen');

  let fallos = 0; const vistos = [];

  for (let i = 0; i < ESCENARIOS.length; i++) {
    const esc = ESCENARIOS[i];
    const r = await medir(esc, 5210 + i);
    if (r.error) abortar(esc.nombre + ' → ' + r.error);
    const d = r.dato;
    if (!r.apis) abortar(esc.nombre + ' → la app nunca pidió /api: los ceros no valen.');
    if (!d.arbol) abortar(esc.nombre + ' → el árbol no se montó, así que no medí el enraizado.');
    // El testigo: sin él, «0 cruzadas» puede ser «no llegó el dato».
    if (!d.subtitulo) abortar(esc.nombre + ' → no encontré el subtítulo con el conteo de entregas.');
    if (process.env.MOVIL && d.anchoViewport !== 390) {
      abortar(esc.nombre + ' → el viewport mide ' + d.anchoViewport + 'px y no 390: ' +
              'estaria midiendo el escritorio y dando verde sin tocar el caso del telefono.');
    }
    // ⚠ EL ESPERADO NO ES «todo lo que servi», Y ESO SALE DE LA REGLA.
    // «Del equipo» es ESTRICTO desde el 14/sep: son las de los DEMAS, no todas.
    // Asi que la propia de la Encargada no entra en este arbol. Lo descubri
    // porque la guardia aborto -servi 6, conto 5- y la explicacion cuadra en
    // los cuatro escenarios; ajustar el numero a ojo habria tapado justo la
    // clase de fallo que esta guardia existe para cazar.
    const esperadas = esc.todasLasEntregas
      ? esc.checklists.length
      : esc.checklists.filter((c) => c.assigned !== ENCARGADA).length;
    if (d.subtitulo.entregas !== esperadas) {
      abortar(esc.nombre + ' → el componente contó ' + d.subtitulo.entregas +
              ' entregas del equipo y le serví ' + esperadas +
              ' (de ' + esc.checklists.length + ', una es suya): no estoy midiendo lo que creo.');
    }
    vistos.push(d);

    console.log('  %s %s %s %s  %s  %s', esc.nombre.padEnd(28),
      String(d.subtitulo.entregas).padStart(9), String(d.raices).padStart(7),
      String(d.cruzadas).padStart(9), d.titulo.padEnd(16) + ' ' + d.resumen.slice(0, 44), d.raiz);

    // ── EL RESUMEN (Capa 1) ──────────────────────────────────────────────
    const esperado = esc.resumen;
    const chips = d.resumenChips.join(' · ');
    if (d.resumen === '(no se pinto)') {
      console.log('      ✗ el bloque de resumen no se pinto');
      fallos++;
    } else {
      const frase = esperado.pendientes === 0
        ? 'No hay entregas pendientes'
        : (esperado.pendientes === 1 ? 'Falta 1 entrega' : 'Faltan ' + esperado.pendientes + ' entregas');
      if (d.resumen.indexOf(frase) < 0) {
        console.log('      ✗ el titular debia decir «%s» y la linea dice «%s»', frase, d.resumen);
        fallos++;
      }
      const esperaVenc = esperado.vencidas ? esperado.vencidas + ' vencida' : '';
      const esperaTiempo = esperado.aTiempo ? esperado.aTiempo + ' a tiempo' : '';
      if (esperaVenc && chips.indexOf(esperaVenc) < 0) {
        console.log('      ✗ esperaba «%s» en los chips y hay «%s»', esperaVenc, chips || '(ninguno)');
        fallos++;
      }
      if (esperaTiempo && chips.indexOf(esperaTiempo) < 0) {
        console.log('      ✗ esperaba «%s» en los chips y hay «%s»', esperaTiempo, chips || '(ninguno)');
        fallos++;
      }
      // LOS TRES CUADRAN. Es la asercion que impide que la linea mienta: tres
      // numeros juntos se leen como partes de un todo.
      if (esperado.vencidas + esperado.aTiempo !== esperado.pendientes) {
        abortar(esc.nombre + ' → el ESPERADO de esta fila no cuadra (' +
                esperado.vencidas + ' + ' + esperado.aTiempo + ' ≠ ' + esperado.pendientes +
                '): la prueba estaria fijando una linea que miente.');
      }
    }

    // ── ¿EL BLOQUE NUEVO EMPUJA EL ARBOL FUERA DE LA PANTALLA? ───────────
    // La pregunta de David. Si la primera fila del arbol arranca por debajo
    // del borde, habriamos creado un problema donde no lo habia: resolver la
    // carga cognitiva escondiendo el trabajo no resuelve nada.
    // ⚠ SE DISTINGUE «lo rompi yo» DE «ya estaba roto», que es la diferencia
    // entre una guardia util y una que alguien afloja en tres semanas porque
    // «siempre falla». La linea de resumen solo puede responder por SU alto.
    const PLIEGUE = d.altoVentana - 60;

    // ═══════════════════════════════════════════════════════════════════
    //  LA PREGUNTA DE VERDAD: ¿SE VE LA RESPUESTA SIN HACER SCROLL?
    // ═══════════════════════════════════════════════════════════════════
    // Es la unica asercion de posicion que esta Capa 1 puede prometer. Exigir
    // que ADEMAS el arbol quepa seria exigir algo que no era cierto antes de
    // este cambio -hay ~780px de cabecera, titulo, bandejas y botones antes de
    // el- y la guardia acabaria aflojandose por fallar siempre. Lo que si
    // depende de este bloque: que la linea que contesta la pregunta este
    // DELANTE de los ojos al aterrizar. Si cae bajo el pliegue, no sirve de
    // nada y es mejor saberlo aqui que en la tienda.
    if (d.topResumen < 0) {
      console.log('      ✗ el bloque de resumen no existe en el DOM');
      fallos++;
    } else if (d.topResumen > d.altoVentana - 80) {
      console.log('      ✗ LA RESPUESTA NO SE VE: el resumen empieza en y=%s de %s. ' +
                  'Una linea que contesta la pregunta pero hay que buscarla scrolleando ' +
                  'no contesta nada.', d.topResumen, d.altoVentana);
      fallos++;
    }
    const sinResumen = d.topPrimeraFila - d.altoResumen;
    // Tope de humo, NO la guardia de verdad. Las que mandan son otras dos, y
    // cada una vive donde puede medirse: en escritorio, que al arbol le quede
    // >=55% de la pantalla (`prueba-arbol-organigrama`, que ya cazo este bloque
    // una vez y lo nombro); en telefono, que la respuesta este sobre el pliegue
    // (abajo). Esto solo caza que la linea se convierta en un bloque de tres
    // renglones, que es como empezo y como medi 92px en 390px.
    if (d.altoResumen > 56) {
      console.log('      ✗ el resumen mide %spx: dejo de ser un renglon. Con dos ya son ~50px, ' +
                  'asi que esto son tres o mas y esta tapando trabajo', d.altoResumen);
      fallos++;
    }
    if (d.topPrimeraFila >= 0 && d.topPrimeraFila > PLIEGUE) {
      if (sinResumen <= PLIEGUE && !process.env.MOVIL) {
        console.log('      ✗ LO ROMPIO EL RESUMEN: la primera fila pasa de y=%s a y=%s con una ' +
                    'ventana de %s. El bloque que existe para que el ojo aterrice esta ' +
                    'escondiendo el trabajo.', sinResumen, d.topPrimeraFila, d.altoVentana);
        fallos++;
      } else if (process.env.MOVIL) {
        console.log('      ⚠ en telefono el arbol arranca en y=%s de %s (sin el resumen, y=%s). ' +
                    'Se consumen %spx antes de el: la respuesta se ve, el detalle pide scroll. ' +
                    'Bajar ese cromo es Capa 2.', d.topPrimeraFila, d.altoVentana, sinResumen, d.topBarra);
      } else {
        console.log('      ⚠ PENDIENTE AJENO (no lo rompio este cambio): la primera fila del ' +
                    'arbol empieza en y=%s de %s, y SIN el resumen ya empezaba en y=%s. ' +
                    'Se consumen %spx antes del arbol -cabecera, titulo, 4 bandejas, 3 botones- ' +
                    'y la barra mide otros %spx. Es lo que tiene que atacar la Capa 2.',
          d.topPrimeraFila, d.altoVentana, sinResumen, d.topBarra, d.altoBarra);
      }
    }

    const tituloEsperado = esc.titulo || 'Mi equipo';
    if (d.titulo !== tituloEsperado) {
      console.log('      ✗ el titulo debia decir «%s» y dice «%s»', tituloEsperado, d.titulo);
      fallos++;
    }
    if (d.raiz !== esc.raiz) {
      console.log('      ✗ la raíz debía ser «%s» y es «%s»', esc.raiz, d.raiz);
      fallos++;
    }
    if (esc.minRaices != null && d.raices < esc.minRaices) {
      console.log('      ✗ esperaba al menos %s raíz(ces) y hay %s: %s',
        esc.minRaices, d.raices, d.nombresRaices.join(' | '));
      fallos++;
    }
    if (esc.minCruzadas != null && d.cruzadas < esc.minCruzadas) {
      console.log('      ✗ el trabajo ajeno en su tienda DEJÓ de salir marcado «servicio a» ' +
                  '(esperaba ≥%s, hay %s). Una Encargada estaría viendo menos gente de la que trabaja ahí.',
        esc.minCruzadas, d.cruzadas);
      fallos++;
    }
    if (esc.maxCruzadas != null && d.cruzadas > esc.maxCruzadas) {
      console.log('      ✗ salieron %s pastillas «servicio a» SIN trabajo ajeno que las justifique',
        d.cruzadas);
      fallos++;
    }
  }

  // ── GUARDIA DE DISCRIMINACIÓN (§8.11 c) ────────────────────────────────
  console.log('');
  const conCruzada = vistos.filter((d) => d.cruzadas > 0).length;
  if (!conCruzada || conCruzada === vistos.length) {
    abortar('la pastilla «servicio a» sale en ' + conCruzada + ' de ' + vistos.length +
            ' escenarios: la muestra no distingue «hay trabajo ajeno» de «no lo hay», ' +
            'así que un arreglo que la borrara entera pasaría en verde.');
  }
  const conVencidas = vistos.filter((d) => d.resumenChips.some((c) => c.indexOf('vencida') >= 0)).length;
  if (!conVencidas || conVencidas === vistos.length) {
    abortar('el chip de vencidas sale en ' + conVencidas + ' de ' + vistos.length +
            ' escenarios: la muestra no distingue «hay atrasos» de «no los hay», ' +
            'asi que ese numero no esta probado.');
  }
  const titulos = new Set(vistos.map((d) => d.titulo));
  if (titulos.size < 2) {
    abortar('los ' + vistos.length + ' escenarios dieron el MISMO titulo («' +
            [...titulos][0] + '»): un `tituloArbol()` constante pasaria todo lo de arriba.');
  }
  const entregas = new Set(vistos.map((d) => d.subtitulo.entregas));
  if (entregas.size < 2) {
    abortar('los tres escenarios sirvieron el mismo número de entregas: la prueba no ' +
            'ejerce el caso que la trajo aquí, que es el árbol CON trabajo.');
  }

  console.log('  ──────────────────────────────────────────────────────────────────────');
  console.log('  %s escenarios medidos · %s fallo(s)', vistos.length, fallos);
  console.log('  Lo que esto NO prueba: que se VEA bien, ni que los NÚMEROS de cada');
  console.log('  columna sean correctos. Prueba dónde arranca el árbol y que lo ajeno');
  console.log('  sigue saliendo marcado. Nadie ha entrado con una cuenta real.');
  console.log('');
  process.exit(fallos ? 2 : 0);
})();
