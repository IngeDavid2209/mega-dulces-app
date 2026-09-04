#!/usr/bin/env node
/**
 * 🌳 ¿CUÁNTO CUESTA LLEGAR A UN DATO EN EL ÁRBOL DEL ORGANIGRAMA?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA QUE CONTESTA
 * ═══════════════════════════════════════════════════════════════════════════
 * NO «¿compila?» ni «¿aparece el buscador?». Las dos se contestan solas y las
 * dos dan verde con la pantalla inservible. La pregunta es:
 *
 *     ¿SE VE ALGO AL ENTRAR, Y SE LLEGA A UNA TAREA SIN CAVAR?
 *
 * El defecto que vino a arreglar el rediseño era medible: el organigrama tiene
 * UNA raíz y el árbol arrancaba con todo cerrado, así que la pantalla abría con
 * UNA fila —«Dirección General»—. 53 de los 89 puestos (el 60%) viven en el
 * nivel 3: tres clics para que el puesto apareciera y tres más para ver su
 * primera tarea. Seis, y siete en el nivel 4.
 *
 * Eso no lo ve una prueba unitaria: el estado abierto ahora se resuelve
 * combinando tres fuentes (tu clic, la búsqueda y la siembra del día) y se
 * pinta con `*ngIf`. Hay que pintar la página.
 *
 * ─── CÓMO ───────────────────────────────────────────────────────────────────
 * Sirve el `dist/`, siembra una sesión en `localStorage`, devuelve checklists
 * SINTÉTICOS desde `/api/*`, deja pintar, TECLEA en el buscador de verdad
 * (evento `input`, como una persona) y cuenta nodos.
 *
 * ─── LO QUE VIGILA DE SÍ MISMO ──────────────────────────────────────────────
 * · TESTIGO INDEPENDIENTE del dato. Si «con dato» y «sin dato» dieran el mismo
 *   número de filas, eso tiene DOS lecturas incompatibles: la siembra está rota
 *   (fallo real) o los checklists sintéticos nunca llegaron al componente
 *   (fallo de la medición). Se distinguen leyendo el subtítulo del componente,
 *   que publica cuántas entregas contó. Sin ese testigo, un cero se leería como
 *   «no funciona» cuando podría ser «no medí» (§8.11 a).
 * · CONTROL NEGATIVO REAL, no decorativo: buscar una cadena que no existe tiene
 *   que dar CERO filas. Un filtro que ante «no hay» devuelve todo se ve
 *   idéntico a un filtro que funciona — hasta que alguien lo usa.
 * · CONTROL POSITIVO QUE AFIRMA EL MECANISMO: buscar el nombre de una persona
 *   tiene que dejar su TAREA en pantalla con cero clics. «Aparecen menos filas»
 *   lo pasa cualquier poda; lo que hay que afirmar es que la fila de entrega
 *   —tres niveles más abajo— quedó visible sola.
 * · ABORTA si Chrome, el dist/ o alguna medición faltan.
 *
 *   npm run build   (esto mide lo COMPILADO, no el código fuente)
 *   node scripts/prueba-arbol-organigrama.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIST_REAL = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');

/**
 * EL PARCHE DE AUTENTICACION, dicho y no escondido.
 *
 * `ApiService.token()` exige un usuario de Firebase Auth y lanza «Sin sesion
 * activa» si no lo hay, asi que en headless el `fetch` a /api NUNCA sale: la
 * pantalla queda vacia y el conteo mide una pantalla vacia. Es exactamente
 * lo que le paso a las dos primeras corridas de este script.
 *
 * Se copia el `dist/` y se cortocircuita esa funcion EN LA COPIA. El `dist/`
 * real no se toca (se comprueba, no se supone) y el ancla tiene que aparecer
 * EXACTAMENTE una vez: si el bundler cambia y deja de coincidir, ABORTA en vez
 * de medir de menos. Mismo mecanismo y misma ancla que
 * `prueba-dom-evidencia.js`, que ya lo tenia resuelto.
 */
const ANCLA = 'token(t=!1){return i(this,null,function*(){let r=g(),s=r.currentUser;';
const PARCHE = 'token(t=!1){return i(this,null,function*(){return"token-de-medicion";let r=g(),s=r.currentUser;';

/** La copia parcheada. Se llena en la corrida. */
let DIST = DIST_REAL;

/** Admin global: es quien ve el árbol completo (lo midió prueba-vista-por-nivel). */
const SESION = {
  uid: 'g', id: 'g', nombre: 'Dir Global', usuario: 'dir', correo: 'd@l.invalid',
  rol: 'admin', alcance: 'global',
};

function hoyLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

/**
 * Los checklists sintéticos.
 *
 * Se eligen puestos REALES del catálogo y a distintas profundidades a
 * propósito: `anaquelista` está en el nivel 3 y `practicante-caja-general` en
 * el 4, que son justo los que antes quedaban sepultados. Si la siembra sirve,
 * estos tienen que quedar visibles sin tocar nada.
 *
 * Va `_puestoId` en el checklist Y `puestoId` en la plantilla: si el
 * post-proceso de `checklist.ts` perdiera el primero, el segundo lo resuelve
 * por nombre, y si fallaran los dos las entregas caerían en «sin puesto» —
 * que el testigo del subtítulo delata.
 */
/**
 * La pantalla contra la que se mide "todo en una sola vista".
 *
 * OJO CON `--window-size`: en `--headless=new` Chrome emula una ventana CON
 * cromo, asi que pedir 900 de alto deja un viewport de 748 — se midio y la
 * etiqueta decia "1440x900" mientras las filas se contaban contra 748. Un
 * numero sin su denominador, otra vez. Se pide el alto MAS el cromo y se
 * comprueba el resultado: si el viewport real no cae donde debe, ABORTA, para
 * que nunca se concluya "caben N" contra una pantalla distinta a la declarada.
 */
const VENTANA = { w: 1440, h: 1052, objetivoAlto: 900, tolerancia: 40 };

const HOY = hoyLocal();
const ITEMS = [{ id: 'i1', text: 'Punto uno' }, { id: 'i2', text: 'Punto dos' }];
/**
 * `_origenManual: true` NO es decoracion: es el candado del apartado.
 * `checklistsFiltrados` (checklist.ts:1016) recorta con
 * `esTareaDeManual(c) === modoManual`, y esa funcion lee exactamente esta
 * bandera. Sin ella los checklists LLEGAN al componente y el apartado del
 * manual los descarta, asi que el arbol los cuenta como cero. La primera
 * corrida de este script cayo justo ahi: cuatro escenarios midiendo nada, con
 * "5 filas con dato" y "5 filas sin dato" — que se lee como «la siembra esta
 * rota» cuando lo roto era el dato de prueba. Lo delato el testigo, no el cero.
 */
const MARCA_MANUAL = { _origenManual: true, timestampCreacion: Date.now() };
const CHECKLISTS = [
  { id: 'c1', date: HOY, time: '08:00', name: 'Apertura de pasillo', store: 'Canindo',
    assigned: 'Yesenia Prueba Uno', _puestoId: 'anaquelista', items: ITEMS, ...MARCA_MANUAL },
  { id: 'c2', date: HOY, time: '09:00', name: 'Acomodo de anaquel', store: 'Canindo',
    assigned: 'Rogelio Prueba Dos', _puestoId: 'anaquelista', items: ITEMS, ...MARCA_MANUAL },
  { id: 'c3', date: HOY, time: '10:00', name: 'Frente de tienda', store: '8 Esquinas',
    assigned: 'Yesenia Prueba Uno', _puestoId: 'anaquelista', items: ITEMS, ...MARCA_MANUAL },
  { id: 'c4', date: HOY, time: '11:00', name: 'Corte parcial', store: 'Padre Hidalgo',
    assigned: 'Marisol Prueba Tres', _puestoId: 'practicante-caja-general', items: ITEMS, ...MARCA_MANUAL },
  { id: 'c5', date: HOY, time: '12:00', name: 'Revisión de turno', store: 'Canindo',
    assigned: 'Alma Prueba Cuatro', _puestoId: 'encargado-sucursal', items: ITEMS, ...MARCA_MANUAL },
];
const USUARIOS = [
  { id: 'u1', nombre: 'Yesenia Prueba Uno', puestoId: 'anaquelista', activo: true, sucursales: ['Canindo'] },
  { id: 'u2', nombre: 'Rogelio Prueba Dos', puestoId: 'anaquelista', activo: true, sucursales: ['Canindo'] },
  { id: 'u3', nombre: 'Marisol Prueba Tres', puestoId: 'practicante-caja-general', activo: true, sucursales: ['Padre Hidalgo'] },
  { id: 'u4', nombre: 'Alma Prueba Cuatro', puestoId: 'encargado-sucursal', activo: true, sucursales: ['Canindo'] },
];

/**
 * Los cuatro escenarios. `teclea` es lo que se escribe en el buscador REAL.
 * `datos: false` es el control de la siembra: sin trabajo del día no hay nada
 * que sembrar y el árbol debe caer al primer nivel.
 */
/**
 * FIXTURE DEL EJE TRANSVERSAL, aparte del de arriba a propósito.
 *
 * Cubre los cuatro tipos de lugar y los dos lados de la regla de atribución.
 * Los puestos NO se eligen al azar: `anaquelista` es unidad `sucursal` y
 * `practicante-caja-general` es `administrativa`, así que entre los dos la
 * regla tiene que decir SÍ en uno y NO en el otro. Si los dos fueran de
 * sucursal, la prueba recorrería sin comparar un `cruzada` contra el de al
 * lado — que es el fallo del 31/ago con los diez perfiles que veían las cuatro
 * pestañas o ninguna.
 *
 * "Sucursal Fantasma" no está en `zonas.util.ts` y tiene que salir DESCONOCIDA:
 * es el control de que lo que no se sabe se ve, en vez de acomodarse por
 * parecido.
 */
const ITEMS_EJE = [{ id: 'i1', text: 'Punto uno' }];
const EJE = {
  checklists: [
    // Misma persona, MISMO puesto, CUATRO lugares: los cuatro tipos de destino
    // y, de paso, el ×4 en su denominador.
    { id: 'e1', date: HOY, time: '08:00', name: 'En la sucursal', store: 'Canindo',
      assigned: 'Ana Eje Uno', _puestoId: 'anaquelista', items: ITEMS_EJE, ...MARCA_MANUAL },
    { id: 'e2', date: HOY, time: '09:00', name: 'En un área', store: 'COMPRAS',
      assigned: 'Ana Eje Uno', _puestoId: 'anaquelista', items: ITEMS_EJE, ...MARCA_MANUAL },
    { id: 'e3', date: HOY, time: '10:00', name: 'En el canal', store: 'MANTENIMIENTO',
      assigned: 'Ana Eje Uno', _puestoId: 'anaquelista', items: ITEMS_EJE, ...MARCA_MANUAL },
    { id: 'e4', date: HOY, time: '11:00', name: 'En un lugar sin zona', store: 'Sucursal Fantasma',
      assigned: 'Ana Eje Uno', _puestoId: 'anaquelista', items: ITEMS_EJE, ...MARCA_MANUAL },
    // Unidad `administrativa` trabajando en una SUCURSAL: atribución cruzada.
    { id: 'e5', date: HOY, time: '12:00', name: 'Servicio a la plaza', store: 'Padre Hidalgo',
      assigned: 'Beto Eje Dos', _puestoId: 'practicante-caja-general', items: ITEMS_EJE, ...MARCA_MANUAL },
  ],
  usuarios: [
    { id: 'e-u1', nombre: 'Ana Eje Uno', puestoId: 'anaquelista', activo: true,
      sucursales: ['Canindo', 'COMPRAS', 'MANTENIMIENTO', 'Sucursal Fantasma'] },
    { id: 'e-u2', nombre: 'Beto Eje Dos', puestoId: 'practicante-caja-general', activo: true,
      sucursales: ['Padre Hidalgo'] },
  ],
};

const ESCENARIOS = [
  { nombre: 'con dato, sin tocar nada', datos: true,  teclea: null },
  { nombre: 'sin ningún dato',          datos: false, teclea: null },
  { nombre: 'busco "Yesenia"',          datos: true,  teclea: 'Yesenia' },
  { nombre: 'busco "zzzqqq" (no existe)', datos: true, teclea: 'zzzqqq' },
  // TECLEA 'Eje' A PROPÓSITO, y el primer intento fue con `teclea: null`.
  // Dio SEIS CEROS perfectos, que se leen como «las pastillas no se pintan».
  // No era eso: `sembrar()` abre los ANCESTROS del puesto con trabajo y deja el
  // puesto con trabajo VISIBLE PERO CERRADO (ver su comentario), así que sin
  // clic ni búsqueda no existe ninguna fila de lugar que pintar. El cero era
  // del escenario, no de la función. Buscando "Eje" caen las DOS ramas del
  // fixture —la de sucursal y la administrativa— que es lo que hace falta para
  // que la regla de atribución tenga un sí y un no que comparar.
  { nombre: 'eje transversal',          datos: true,  teclea: 'Eje', fixture: EJE },
];

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function abortar(motivo) {
  console.error('');
  console.error('[arbol] ABORTA: ' + motivo);
  console.error('[arbol] No concluyas de esta corrida.');
  process.exit(3);
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

// ══════════════════════════════════════════════════════════════════════════
//  LA COPIA PARCHEADA
// ══════════════════════════════════════════════════════════════════════════
function prepararCopia() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'md-arbol-dist-'));
  const copiar = (de, a) => {
    fs.mkdirSync(a, { recursive: true });
    for (const e of fs.readdirSync(de, { withFileTypes: true })) {
      const o = path.join(de, e.name), d = path.join(a, e.name);
      if (e.isDirectory()) copiar(o, d); else fs.copyFileSync(o, d);
    }
  };
  copiar(DIST_REAL, destino);

  let n = 0;
  for (const f of fs.readdirSync(destino)) {
    if (!f.endsWith('.js')) continue;
    const p = path.join(destino, f);
    const s = fs.readFileSync(p, 'utf8');
    if (s.indexOf(ANCLA) >= 0) {
      n += s.split(ANCLA).length - 1;
      fs.writeFileSync(p, s.split(ANCLA).join(PARCHE));
    }
  }
  if (n !== 1) {
    abortar('el ancla del parche de autenticacion aparece ' + n + ' veces (esperaba 1). ' +
      'Si el bundler cambio, hay que reencontrarla: sin el parche la app no pide /api y ' +
      'el conteo seria de una pantalla vacia.');
  }
  const tocado = fs.readdirSync(DIST_REAL)
    .filter((f) => f.endsWith('.js'))
    .some((f) => fs.readFileSync(path.join(DIST_REAL, f), 'utf8').indexOf('token-de-medicion') >= 0);
  if (tocado) abortar('el dist/ REAL quedo parcheado. Reconstruye antes de desplegar.');
  console.log('[arbol] copia parcheada en %s (ancla: 1 ocurrencia)', destino);
  return destino;
}

// ══════════════════════════════════════════════════════════════════════════
//  UNA MEDICIÓN
// ══════════════════════════════════════════════════════════════════════════
function medir(esc, puerto) {
  return new Promise((resolve) => {
    // Teclear de verdad: `[ngModel]`/`(ngModelChange)` reacciona al evento
    // `input`, así que esto recorre el mismo camino que una persona. Escribir
    // en el signal desde fuera probaría el computed, no la pantalla.
    const teclear = esc.teclea
      ? 'var campo=document.querySelector(".org-buscar-campo");' +
        'if(campo){campo.value=' + JSON.stringify(esc.teclea) + ';' +
        'campo.dispatchEvent(new Event("input",{bubbles:true}));}' +
        'else{window.__sinCampo=1;}'
      : '';

    const iny =
      '<script>try{localStorage.setItem("md_sesion_actual",' +
      JSON.stringify(JSON.stringify(SESION)) + ');}catch(e){}</script>' +
      '<script>window.addEventListener("load",function(){' +
      // Primero se deja pintar y sembrar; después se teclea; después se mide.
      'setTimeout(function(){' + teclear + 'setTimeout(function(){' +
      'var sub=document.querySelector(".org-sub");' +
      'document.title="RES "+JSON.stringify({' +
      ' arbol: document.querySelectorAll("app-vista-organigrama").length,' +
      ' puestos: document.querySelectorAll(".org-lista .org-puesto").length,' +
      ' sucursales: document.querySelectorAll(".org-lista .org-fila-suc").length,' +
      ' personas: document.querySelectorAll(".org-lista .org-fila-per").length,' +
      ' entregas: document.querySelectorAll(".org-lista .org-fila-ent").length,' +
      ' guias: document.querySelectorAll(".org-lista .org-guia").length,' +
      ' vacio: document.querySelectorAll(".org-menu-vacio").length,' +
      ' campo: document.querySelectorAll(".org-buscar-campo").length,' +
      ' chips: document.querySelectorAll(".org-chip-uni").length,' +
      // EJE TRANSVERSAL. Se cuenta por TIPO y no solo ".org-destino": un
      // "3 pastillas" no distingue tres sucursales de un canal mal pintado como
      // sucursal, que es justo el defecto que esto vino a arreglar.
      ' dSuc: document.querySelectorAll(".org-destino-sucursal").length,' +
      ' dCorp: document.querySelectorAll(".org-destino-corporativo").length,' +
      ' dCanal: document.querySelectorAll(".org-destino-canal").length,' +
      ' dDesc: document.querySelectorAll(".org-destino-desconocido").length,' +
      ' cruzada: document.querySelectorAll(".org-cruzada").length,' +
      ' multi: document.querySelectorAll(".org-multi").length,' +
      ' sinCampo: window.__sinCampo || 0,' +
      // CUANTAS FILAS CABEN SIN SCROLLEAR. Es la pregunta de "todo en una sola
      // vista", y no se contesta contando filas del DOM: una fila existe
      // aunque este 3000px abajo.
      ' enPantalla: [].slice.call(document.querySelectorAll(".org-lista .org-fila-wrap"))' +
      '   .filter(function(e){var r=e.getBoundingClientRect();' +
      '     return r.top >= 0 && r.bottom <= window.innerHeight;}).length,' +
      ' anchoLista: (function(){var e=document.querySelector(".org-lista");' +
      '   return e ? Math.round(e.getBoundingClientRect().width) : 0;})(),' +
      // Scroll DENTRO del scroll: el recuadro con barra propia metido en una
      // pagina que tambien scrollea. 1 = sigue encajonado.
      ' scrollInterno: (function(){var e=document.querySelector(".org-menu");' +
      '   return e && e.scrollHeight > e.clientHeight + 4 ? 1 : 0;})(),' +
      // EL TOPE, leido del estilo calculado y no de si HOY desborda. Con un
      // fixture chico la lista no llega a los 640px del recuadro viejo, asi que
      // `scrollInterno` valdria 0 con el recuadro PUESTO: una asercion que no
      // puede fallar no prueba nada (§8.11 c). Esto discrimina siempre.
      ' topeMenu: (function(){var e=document.querySelector(".org-menu");' +
      '   return e ? getComputedStyle(e).maxHeight : "?";})(),' +
      // DONDE SE VA EL ALTO. "No caben" tiene dos causas muy distintas -filas
      // gordas, o cromo de la pagina comiendose la pantalla- y se ven igual.
      // Esto lista lo que hay ENCIMA de la lista, con su altura.
      // EL DENOMINADOR DE "caben N". Sin el alto REAL de la ventana, "caben 11"
      // no dice nada: `--window-size` puede no aplicarse y el default de
      // headless es 800x600. Se mide, no se supone.
      ' ventana: window.innerWidth + "x" + window.innerHeight,' +
      ' arriba: (function(){var l=document.querySelector(".org-lista");' +
      '   if(!l) return null; var out=[]; var e=l;' +
      '   while(e && e!==document.body){ var p=e.parentElement; if(!p) break;' +
      '     for(var i=0;i<p.children.length;i++){ var c=p.children[i]; if(c===e) break;' +
      '       var cr=c.getBoundingClientRect();' +
      '       if(cr.height>2) out.push(((c.className||c.tagName)+"").slice(0,28)+"="+Math.round(cr.height)); }' +
      '     e=p; }' +
      '   return {top: Math.round(l.getBoundingClientRect().top), ancho: Math.round(l.getBoundingClientRect().width), encima: out};})(),' +
      // EL EJE DERECHO. El encabezado de columnas y las filas comparten UNA
      // definicion de anchuras, pero viven en contenedores distintos desde que
      // el `org-cab` se mudo a la barra pegajosa. Si sus ejes derechos se
      // separan, los rotulos dejan de nombrar la columna que estan encima —
      // que es el defecto de los 94px del 1/sep, con otra ropa.
      ' ejes: (function(){var c=document.querySelector(".org-cab .org-puesto-datos");' +
      '   var f=document.querySelector(".org-lista .org-puesto .org-puesto-datos");' +
      '   if(!c||!f) return null;' +
      '   return {cab: Math.round(c.getBoundingClientRect().right),' +
      '           fila: Math.round(f.getBoundingClientRect().right),' +
      '           anchoCab: Math.round(c.getBoundingClientRect().width),' +
      '           anchoFila: Math.round(f.getBoundingClientRect().width)};})(),' +
      ' altoFila: (function(){var e=document.querySelector(".org-lista .org-puesto");' +
      '   return e ? Math.round(e.getBoundingClientRect().height) : 0;})(),' +
      // OJO CON ESE `+`: sin el, JS NO da error. La insercion automatica de
      // punto y coma parte la expresion en dos sentencias validas, `iny` se
      // queda sin su cierre ni su </script>, y el navegador recibe un script
      // truncado que nunca fija el titulo. `node --check` pasa. Se lee como
      // «la app no pinto». Un caracter que no rompe: acorta la cadena en
      // silencio, que es la familia de fallas de §8.11(d).
      // EL TESTIGO: el propio componente publica cuántas entregas contó. Es lo
      // que separa «la siembra no sirve» de «el dato no llegó».
      ' sub: sub ? sub.textContent.replace(/\\s+/g," ").trim() : null' +
      '});},1500);},3500);});</script>';

    const sano = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const html = sano.replace('<body>', '<body>' + iny);
    if (html === sano) return resolve({ error: 'no pude inyectar la sesión en el index' });

    const cuerpo = JSON.stringify({
      // `fixture` deja que un escenario traiga SU PROPIO dato. Se agregó para el
      // eje transversal sin tocar el fixture de los cuatro primeros: sus
      // conteos ("caben 9 de 17", "5 entregadas") están anclados a esos 5
      // checklists, y meter dos más los habría movido todos.
      checklists: esc.fixture ? esc.fixture.checklists : (esc.datos ? CHECKLISTS : []),
      usuarios: esc.fixture ? esc.fixture.usuarios : (esc.datos ? USUARIOS : []),
      areas: [],
    });

    let apiPedidos = 0;
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url.indexOf('/api/') === 0) {
        apiPedidos++;
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
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-arbol-'));
      // La ruta se arma AQUÍ, con la barra puesta por código, nunca por
      // variable de entorno: en Git Bash MSYS convierte '/tareas-manual' en
      // 'C:/Program Files/Git/tareas-manual', la URL sale malformada y el DOM
      // llega vacío — que se lee como «la app no pinta». Costó una tarde.
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        // VENTANA FIJA. "Cuantas filas caben en pantalla" no significa nada sin
        // decir en que pantalla: 1440x900 es un portatil comun de oficina.
        '--window-size=' + VENTANA.w + ',' + VENTANA.h,
        '--user-data-dir=' + perfil, '--virtual-time-budget=25000', '--disable-background-networking',
        '--disable-sync', '--disable-component-update',
        '--disable-features=PushMessaging,OptimizationHints',
        '--dump-dom', 'http://localhost:' + puerto + '/' + 'tareas-manual'],
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

// ══════════════════════════════════════════════════════════════════════════
//  LA CORRIDA
// ══════════════════════════════════════════════════════════════════════════
(async () => {
  if (!CHROME) abortar('no encontré Chrome. Sin navegador esto no mide nada.');
  if (!fs.existsSync(path.join(DIST_REAL, 'index.html'))) {
    abortar('no hay dist/ en ' + DIST_REAL + '. Corre `npm run build`: esto mide lo COMPILADO.');
  }
  // §8.11(a): el tamaño de la entrada, ANTES de concluir nada.
  console.log('');
  console.log('[arbol] entrada: %d checklists sintéticos · %d fichas · fecha %s',
    CHECKLISTS.length, USUARIOS.length, HOY);

  DIST = prepararCopia();

  const filas = [];
  let puerto = 5600 + Math.floor(Math.random() * 200);
  for (const e of ESCENARIOS) {
    const r = await medir(e, puerto++);
    if (r.error) {
      abortar('escenario "' + e.nombre + '": ' + r.error +
        '. Una medición fallida no es un cero: son dos cosas distintas y se ven igual.');
    }
    filas.push({ ...e, d: r.dato, apiPedidos: r.apiPedidos });
  }

  console.log('');
  console.log('escenario                  puestos  sucurs  personas  entregas  guías  vacío  chips');
  console.log('─'.repeat(92));
  for (const f of filas) {
    console.log('%s %s %s %s %s %s %s %s',
      f.nombre.padEnd(26), String(f.d.puestos).padEnd(8), String(f.d.sucursales).padEnd(7),
      String(f.d.personas).padEnd(9), String(f.d.entregas).padEnd(9),
      String(f.d.guias).padEnd(6), String(f.d.vacio).padEnd(6), String(f.d.chips));
  }
  console.log('─'.repeat(92));

  // EJE TRANSVERSAL, en su propia tabla: son cubetas y hay que verlas separadas.
  console.log('');
  console.log('escenario                  sucursal  corporativo  canal  sin-zona  servicio-a  +lugares');
  console.log('─'.repeat(92));
  for (const f of filas) {
    console.log('%s %s %s %s %s %s %s',
      f.nombre.padEnd(26), String(f.d.dSuc).padEnd(9), String(f.d.dCorp).padEnd(12),
      String(f.d.dCanal).padEnd(6), String(f.d.dDesc).padEnd(9),
      String(f.d.cruzada).padEnd(11), String(f.d.multi));
  }
  console.log('─'.repeat(92));
  // GUARDIA DEL DENOMINADOR: sin esto, "caben 11" puede ser contra 748px o
  // contra 900px y se lee igual.
  const vp = String(filas[0].d.ventana || '');
  const altoReal = Number(vp.split('x')[1] || 0);
  if (!altoReal || Math.abs(altoReal - VENTANA.objetivoAlto) > VENTANA.tolerancia) {
    abortar('el viewport real es ' + (vp || 'ilegible') + ', y las filas se iban a contar ' +
      'como si fuera de ' + VENTANA.objetivoAlto + 'px de alto. Ajusta VENTANA.h: en headless ' +
      'el alto pedido incluye el cromo de la ventana.');
  }
  console.log('');
  console.log('EN UNA SOLA VISTA (viewport REAL %s)', vp);
  console.log('escenario                  filas que CABEN  ancho lista  alto fila  scroll interno');
  console.log('─'.repeat(92));
  for (const f of filas) {
    console.log('%s %s %s %s %s',
      f.nombre.padEnd(26), String(f.d.enPantalla).padEnd(16),
      (f.d.anchoLista + 'px').padEnd(12), (f.d.altoFila + 'px').padEnd(10),
      f.d.scrollInterno ? 'SÍ (encajonado)' : 'no');
  }
  console.log('─'.repeat(92));
  const geo = filas[0].d.arriba;
  if (geo) {
    console.log('');
    console.log('DONDE SE VA EL ALTO · ventana REAL %s · la lista empieza en y=%dpx y mide %dpx',
      filas[0].d.ventana, geo.top, geo.ancho);
    console.log('  encima de ella: %s', geo.encima.join(' · ') || '(nada)');
  }
  console.log('');
  for (const f of filas) console.log('  subtítulo · %s → %s', f.nombre, JSON.stringify(f.d.sub));

  const conDato = filas[0], sinDato = filas[1], busca = filas[2], nada = filas[3];
  const eje = filas[4];

  // ── El árbol tiene que estar montado en las cuatro, o no se midió nada ──
  for (const f of filas) {
    if (f.d.arbol !== 1) {
      abortar('el escenario "' + f.nombre + '" no montó <app-vista-organigrama> (arbol=' +
        f.d.arbol + '). Todo lo demás sería un cero por no haber pintado.');
    }
    if (f.d.sinCampo) abortar('el buscador no existía al teclear en "' + f.nombre + '".');
  }

  // ── ¿La app PIDIO los datos? Un cero aqui no es "no hay dato": es que el
  //    parche no sirvio y se esta midiendo una pantalla vacia.
  for (const f of filas) {
    if (!f.apiPedidos) {
      abortar('el escenario "' + f.nombre + '" nunca pidio /api/*: el parche de autenticacion ' +
        'no surtio efecto. Todo lo medido seria de una pantalla vacia.');
    }
  }
  console.log('[arbol] peticiones a /api por escenario: %s',
    filas.map((f) => f.nombre.split(',')[0] + '=' + f.apiPedidos).join(' · '));

  // ── EL TESTIGO, antes de cualquier verde ────────────────────────────────
  // Distingue «la siembra está rota» de «el dato nunca llegó». Sin esto, las
  // dos producen el mismo número y la conclusión sería la contraria.
  // Tolerante a las DOS redacciones del subtitulo. La primera version de esta
  // regex se anclo al texto largo ("N tarea(s) del manual entregada(s) hoy") y
  // se rompio en cuanto la barra se compacto a "N entregadas hoy": es el
  // corolario (e), un control anclado a algo que se mueve. Abortar fue lo
  // correcto -no concluyo con el testigo ciego-, pero el testigo no deberia
  // depender de como se redacte una etiqueta.
  const declara = /(\d+)\s+(?:tarea\(s\) del manual entregada\(s\)|entregadas)\s+hoy/
    .exec(conDato.d.sub || '');
  const contadas = declara ? Number(declara[1]) : -1;
  if (contadas <= 0) {
    abortar('el componente declara ' + (contadas < 0 ? 'un subtítulo ilegible' : '0 entregas') +
      ' con ' + CHECKLISTS.length + ' checklists servidos: el dato NO llegó al árbol. ' +
      'Sin dato, "la siembra no abre nada" y "no hubo qué abrir" se ven idénticos. ' +
      'Subtítulo: ' + JSON.stringify(conDato.d.sub));
  }
  console.log('');
  console.log('✓ testigo: el componente contó %d de %d entregas servidas.', contadas, CHECKLISTS.length);

  // ── LAS ASERCIONES ──────────────────────────────────────────────────────
  const fallos = [];
  const pide = (ok, msg) => { if (!ok) fallos.push(msg); };

  // 1 · Ya no arranca con UNA fila. Es el defecto que motivó el rediseño.
  pide(conDato.d.puestos > 1,
    'con dato se sigue entrando a ' + conDato.d.puestos + ' fila(s). Era 1 y el rediseño ' +
    'existe justamente para eso.');

  // 2 · La siembra DISCRIMINA: con trabajo del día se destapa más que sin él.
  //     Con el testigo arriba en verde, un empate aquí solo puede ser la siembra.
  pide(conDato.d.puestos > sinDato.d.puestos,
    'la siembra no destapa nada: ' + conDato.d.puestos + ' filas con dato contra ' +
    sinDato.d.puestos + ' sin dato. El testigo confirma que el dato SÍ llegó, así que ' +
    'esto es la siembra.');

  // 3 · Sin dato tampoco se cae a una sola fila (la caída al primer nivel).
  pide(sinDato.d.puestos > 1,
    'sin dato se entra a ' + sinDato.d.puestos + ' fila(s): la caída al primer nivel no ocurrió.');

  // 4 · CONTROL POSITIVO QUE AFIRMA EL MECANISMO: buscar un nombre deja la
  //     TAREA a la vista con cero clics. «Menos filas» lo pasa cualquier poda.
  pide(busca.d.entregas >= 1,
    'buscar "Yesenia" no dejó ninguna fila de entrega visible (entregas=' + busca.d.entregas +
    '). La búsqueda por persona tiene que aterrizar en SUS tareas, no en el puesto del ' +
    'que cuelga: eso es lo que convierte seis clics en cero.');
  pide(busca.d.personas >= 1, 'buscar "Yesenia" no abrió su fila de colaborador.');
  pide(busca.d.puestos < conDato.d.puestos,
    'buscar "Yesenia" no podó el árbol: ' + busca.d.puestos + ' puestos contra ' +
    conDato.d.puestos + ' sin filtro.');

  // 4b · EJE TRANSVERSAL · los cuatro tipos de lugar se distinguen EN PANTALLA.
  //      Se afirma cada cubeta por separado y no el total: un ".org-destino"
  //      contado en bloque daría 4 aunque los cuatro fueran de la misma clase,
  //      que es exactamente el defecto de origen —todo pintado como sucursal—.
  pide(eje.d.dSuc === 2,
    'el eje: esperaba 2 lugares tipo SUCURSAL —Canindo bajo anaquelista y Padre Hidalgo ' +
    'bajo el puesto administrativo— y hay ' + eje.d.dSuc + '.');
  pide(eje.d.dCorp === 1,
    'el eje: COMPRAS tiene que salir como CORPORATIVO y hay ' + eje.d.dCorp + '.');
  pide(eje.d.dCanal === 1,
    'el eje: MANTENIMIENTO tiene que salir como CANAL, no como sucursal. Hay ' +
    eje.d.dCanal + '. Es el defecto que dio origen a todo esto.');
  pide(eje.d.dDesc === 1,
    'el eje: "Sucursal Fantasma" no está en el mapa de zonas y tiene que verse como ' +
    'DESCONOCIDA. Hay ' + eje.d.dDesc + '. Un lugar sin zona que se pinta como si la ' +
    'tuviera le daría a una Gerencia números que no son suyos.');

  // 4c · Y LA REGLA DE ATRIBUCIÓN DISCRIMINA. El fixture tiene a propósito un
  //      puesto de sucursal y uno administrativo en lugares de tipo sucursal:
  //      si marcara todo darían 2, si no marcara nada darían 0. Solo el 1 puede
  //      venir de la regla correcta.
  pide(eje.d.cruzada === 1,
    'el eje: esperaba EXACTAMENTE 1 "servicio a" —el puesto administrativo en una ' +
    'sucursal— y hay ' + eje.d.cruzada + '. Con 2 estaría marcando también al ' +
    'anaquelista, que sí es de la sucursal; con 0 no estaría marcando nada.');

  // 4d · La misma persona en varios lugares se NOMBRA. Vive en la fila de
  //      colaborador, por eso se mide en el escenario que la abre.
  pide(eje.d.multi >= 1,
    'la persona que recibe su manual en cuatro lugares no lleva el aviso "+N lugares" ' +
    '(multi=' + eje.d.multi + '). Es lo que convierte un nombre repetido sin ' +
    'explicación en un dato: cada copia le suma al denominador.');
  pide(eje.d.personas >= 1,
    'el escenario de la persona no abrió ninguna fila de colaborador (personas=' +
    eje.d.personas + '): el "+N lugares" no se pudo ni buscar.');
  // NEGATIVO del mismo eje: quien está en UN solo lugar no lleva el aviso. Sin
  // esto, un `multi` que se pintara siempre pasaría la aserción de arriba.
  pide(eje.d.multi < eje.d.personas || eje.d.personas === 0,
    'el aviso "+N lugares" aparece en TODAS las filas de colaborador (' + eje.d.multi +
    ' de ' + eje.d.personas + '): entonces no distingue a quien sí está repetido.');

  // 5 · CONTROL NEGATIVO: lo que no existe da CERO, no todo.
  pide(nada.d.puestos === 0,
    'buscar una cadena inexistente dejó ' + nada.d.puestos + ' puestos en pantalla. Un filtro ' +
    'que ante "no hay" devuelve algo se ve idéntico a uno que funciona.');
  pide(nada.d.vacio === 1,
    'el vacío por filtro no se NOMBRA (vacio=' + nada.d.vacio + '). Una lista vacía sin ' +
    'explicación se lee como "la pantalla está rota".');

  // 6 · TODO EN UNA SOLA VISTA. Las tres propiedades del encajonamiento.
  //     Las dos primeras son estables -no dependen del fixture-; la tercera sí,
  //     y por eso su mensaje distingue las dos lecturas posibles.
  pide(conDato.d.topeMenu === 'none',
    'el menú del árbol sigue con `max-height: ' + conDato.d.topeMenu + '`: el recuadro con ' +
    'barra propia dentro del scroll de la página no se quitó. (Se lee del estilo calculado y ' +
    'no de si hoy desborda: con pocos datos la lista no llega al tope y "no desborda" se ' +
    'vería igual que "no hay recuadro".)');
  pide(conDato.d.scrollInterno === 0,
    'el árbol desborda su propio contenedor: dos barras de scroll peleándose.');
  pide(conDato.d.anchoLista > 900,
    'la lista mide ' + conDato.d.anchoLista + 'px: el tope de 820px sigue puesto y sobra ' +
    'ancho de pantalla sin usar.');
  // "Que quepan TODAS las filas" NO se puede asertar: depende del fixture, y en
  // produccion un arbol sembrado son decenas de filas — ninguna altura las mete
  // en una pantalla. Asertar eso seria fijar el diseño a los 5 checklists de
  // esta prueba, y caducaria el dia que alguien agregue el sexto.
  //
  // Lo que SI es una propiedad del diseño, y no del dato, es cuanta pantalla se
  // queda el arbol. Antes: la lista empezaba en y=532 de 900 y encima de ella
  // habia 236px de cromo del propio componente. El limite deja margen para el
  // cromo de la PAGINA (header, toolbar, section-header = 200px) y aprieta lo
  // que si es nuestro.
  const totalFilas = conDato.d.puestos + conDato.d.sucursales + conDato.d.personas + conDato.d.entregas;
  const altoVp = Number(String(conDato.d.ventana).split('x')[1]);
  const paraElArbol = (altoVp - conDato.d.arriba.top) / altoVp;
  console.log('[arbol] la lista se queda con el %d%% de la pantalla · caben %d de %d filas',
    Math.round(paraElArbol * 100), conDato.d.enPantalla, totalFilas);
  pide(paraElArbol >= 0.55,
    'al árbol le queda el ' + Math.round(paraElArbol * 100) + '% de la pantalla (empieza en y=' +
    conDato.d.arriba.top + ' de ' + altoVp + '). Encima de él: ' + conDato.d.arriba.encima.join(' · ') +
    '. Si el bloque que crecio es `org-barra`, es nuestro y se arregla; si es de la pagina, ' +
    'esta asercion esta midiendo algo que este componente no controla.');

  // 7 · EL EJE DERECHO, medido. Los rótulos de columna tienen que caer sobre
  //     la columna que nombran, y desde que `org-cab` se mudó a la barra viven
  //     en contenedores distintos: la única definición compartida de anchuras
  //     ya no garantiza sola que coincidan.
  const ej = conDato.d.ejes;
  if (!ej) {
    fallos.push('no pude medir el eje de columnas: falta `.org-cab .org-puesto-datos` o la ' +
      'rejilla de una fila. Sin eso, la alineación queda sin comprobar.');
  } else {
    console.log('[arbol] eje derecho · encabezado %dpx · fila %dpx · anchos %d/%d',
      ej.cab, ej.fila, ej.anchoCab, ej.anchoFila);
    pide(Math.abs(ej.cab - ej.fila) <= 1,
      'el encabezado de columnas y las filas NO comparten eje derecho: ' + ej.cab + 'px contra ' +
      ej.fila + 'px (' + Math.abs(ej.cab - ej.fila) + 'px de diferencia). Los rótulos dejan de ' +
      'nombrar la columna que tienen encima. Es el defecto de los 94px del 1/sep.');
    pide(ej.anchoCab === ej.anchoFila,
      'la rejilla del encabezado mide ' + ej.anchoCab + 'px y la de las filas ' + ej.anchoFila +
      'px: alguien duplicó las anchuras en vez de reusar `.org-puesto-datos`.');
  }

  // 8 · Lo nuevo existe de verdad en el DOM, no solo en el código fuente.
  pide(conDato.d.guias > 0, 'no se pintó ninguna guía de nivel.');
  pide(conDato.d.chips === 11,
    'esperaba los 11 chips de unidad del catálogo, medí ' + conDato.d.chips +
    '. Una unidad que se pierde en silencio es el modo de fallo de siempre.');

  console.log('');
  if (fallos.length) {
    console.error('✗ %d aserción(es) rotas:', fallos.length);
    for (const x of fallos) console.error('   · ' + x);
    process.exit(2);
  }
  console.log('✓ las %d mediciones pasan.', filas.length);
  console.log('');
  console.log('  al entrar:      1 fila  →  %d', conDato.d.puestos);
  console.log('  sin dato:       1 fila  →  %d (caída al primer nivel)', sinDato.d.puestos);
  console.log('  ver una tarea:  6 clics →  0 (buscando el nombre)');
  console.log('');
  console.log('Lo que esto NO prueba: que se VEA bien. Prueba que el árbol se abre solo, que');
  console.log('el filtro discrimina y que el vacío se nombra. La alineación, el color y el');
  console.log('comportamiento en un celular real siguen necesitando ojos.');
})();
