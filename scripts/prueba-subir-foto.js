/**
 * ¿QUÉ PASA CUANDO UNA ANAQUELISTA INTENTA SUBIR SU FOTO?
 *
 * Es el único camino que ningún arnés había ejercido: los 377 puntos del manual
 * llevan `requiresVariasFotos`, así que su evidencia entra por la GALERÍA
 * (`onMultiplePhotoSelected` -> `onFileSelected(tempItem)`), no por la foto única.
 *
 * Cloudinary se INTERCEPTA en el navegador (window.fetch): así se mide el camino
 * de éxito Y el de fallo sin depender de la red ni subir nada real.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const DIST_REAL = path.join(RAIZ, 'dist', 'mega-dulces-app', 'browser');
const DIST_MANUAL = path.join(RAIZ, 'dist', 'manual');
const TIPOS = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.txt': 'text/plain', '.woff2': 'font/woff2' };
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });

function abortar(m) {
  console.error('\n[foto] ABORTA: ' + m);
  console.error('[foto] No concluyas de esta corrida.');
  process.exit(3);
}

function checklistReal() {
  const { armarChecklist } = require(path.join(DIST_MANUAL, 'emision-manual.util.js'));
  const { tareasAutomaticasDePuesto } = require(path.join(DIST_MANUAL, 'tareas-manual.catalogo.js'));
  const tarea = tareasAutomaticasDePuesto('anaquelista').find((t) => t.id === 'anaquelista.pasillo');
  if (!tarea) throw new Error('no existe anaquelista.pasillo en el catálogo compilado');
  const hoy = new Date();
  const fecha = new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const ck = armarChecklist({ checklistId: 'medicion-foto', tarea, puestoId: 'anaquelista',
    sucursal: 'Canindo', destinatario: 'Ana Anaquelista', destinatarioUid: 'w', fechaYmd: fecha }, []);
  ck.time = '23:59';
  for (const it of ck.items) it.horaLimite = '23:59';
  return ck;
}

const ESCENARIOS = [
  { clave: 'exito', cloud: 'ok',    accion: 'foto',  que: 'elijo una foto y Cloudinary responde bien' },
  { clave: 'falla', cloud: 'falla', accion: 'foto',  que: 'elijo una foto y Cloudinary la RECHAZA' },
  { clave: 'toque', cloud: 'ok',    accion: 'toque', que: 'toco el circulo del punto (no subo foto)' },
];

function hijo(dist, puerto, clave) {
  const esc = ESCENARIOS.find((e) => e.clave === clave);
  const sesion = { uid: 'w', id: 'w', nombre: 'Ana Anaquelista', usuario: 'ana', correo: 'an@l.invalid',
    rol: 'trabajador', puestoId: 'anaquelista', sucursales: ['Canindo'] };
  const checklist = checklistReal();

  const pasos = [
    '<script>',
    'try{localStorage.setItem("md_sesion_actual",' + JSON.stringify(JSON.stringify(sesion)) + ');}catch(e){}',
    'try{localStorage.setItem("md_token","token-de-medicion");}catch(e){}',
    'window.__cloud=0; window.__postApp=0; window.__modo=' + JSON.stringify(esc.cloud) + ';',
    'var _f=window.fetch;',
    'window.fetch=function(u,o){ var s=String((u&&u.url)||u||"");',
    // Cuenta lo que la APP intenta guardar, para distinguir "no lo intento"
    // de "lo intento y no llego". Sin esto, un 0 en el servidor significa las
    // dos cosas a la vez.
    '  if(s.indexOf("/api/checklists")>=0 && o && String(o.method||"").toUpperCase()==="POST") window.__postApp++;',
    '  if(s.indexOf("api.cloudinary.com")>=0){ window.__cloud++;',
    '    if(window.__modo==="ok") return Promise.resolve(new Response(',
    '      JSON.stringify({secure_url:"https://res.cloudinary.com/duherjgyg/image/upload/medicion.jpg"}),',
    '      {status:200,headers:{"Content-Type":"application/json"}}));',
    '    return Promise.resolve(new Response(JSON.stringify({error:{message:"prueba: rechazado"}}),',
    '      {status:400,headers:{"Content-Type":"application/json"}})); }',
    '  return _f.apply(this,arguments); };',
    '</script>',
    '<script>window.addEventListener("load",function(){',
    ' var t0=Date.now(); var res={esc:' + JSON.stringify(clave) + '};',
    ' function espera(sel,cb,ms){var f=function(){',
    '   if(document.querySelector(sel)) return cb(true);',
    '   if(Date.now()-t0>ms) return cb(false); setTimeout(f,150);}; f();}',
    ' espera(".checklist-card",function(hay){',
    '   if(!hay){res.error="nunca aparecio .checklist-card";return fin();}',
    '   document.querySelector(".checklist-card").click();',
    '   espera("input[type=file]",function(det){',
    '     if(!det){res.error="el detalle no abrio o no hay input de archivo";return fin();}',
    '     setTimeout(actuar,700);',
    '   },14000);',
    ' },12000);',
    ' function actuar(){',
    '   var quiere=' + JSON.stringify(esc.accion) + ';',
    '   var inputs=[].slice.call(document.querySelectorAll("input[type=file]"));',
    '   res.inputs=inputs.length;',
    '   res.conCapture=inputs.filter(function(i){return i.hasAttribute("capture");}).length;',
    '   res.conMultiple=inputs.filter(function(i){return i.hasAttribute("multiple");}).length;',
    '   if(quiere==="toque"){',
    // Lo que una persona TOCA cuando quiere marcar el punto: la fila del punto.
    '     var fila=document.querySelector(".checklist-detail-item");',
    '     res.hayFila=!!fila;',
    '     res.puntos=document.querySelectorAll(".checklist-detail-item").length;',
    '     res.botonHecha=document.querySelectorAll(".btn-marcar-hecha").length;',
    '     res.botonFoto=document.querySelectorAll(".btn-upload-mini").length;',
    '     if(fila){ fila.click();',
    '       var txt=fila.querySelector(".item-text"); if(txt) txt.click(); }',
    '     return setTimeout(contar,1500);',
    '   }',
    '   var b=atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");',
    '   var arr=new Uint8Array(b.length); for(var i=0;i<b.length;i++)arr[i]=b.charCodeAt(i);',
    '   var file=new File([arr],"evidencia.png",{type:"image/png"});',
    '   var dt=new DataTransfer(); dt.items.add(file);',
    '   var inp=inputs[0]; inp.files=dt.files;',
    '   res.archivoPuesto=inp.files.length;',
    '   inp.dispatchEvent(new Event("change",{bubbles:true}));',
    '   setTimeout(contar,5000);',
    ' }',
    ' function contar(){',
    '   if(res.contado) return; res.contado=true;',
    '   res.intentosCloud=window.__cloud||0;',
    '   res.miniaturas=document.querySelectorAll(".item-photo-section img").length;',
    '   res.itemDone=document.querySelectorAll(".item-done").length;',
    '   res.avisoSwal=document.querySelectorAll(".swal2-popup").length;',
    '   res.tituloSwal=((document.querySelector(".swal2-title")||{}).textContent||"").slice(0,60);',
    '   res.toast=((document.querySelector(".toast-notification")||{}).textContent||"").trim().slice(0,70);',
    '   res.galeriaCuenta=((document.body.innerText||"").match(/Galer[^\\n]*/)||[""])[0].slice(0,40);',
    '   res.postApp=window.__postApp||0;',
    // CONTROL POSITIVO: un POST hecho a mano. Si este NO llega al servidor, el
    // cero de la app no prueba nada -seria el arnes el que no sabe medir POSTs-.
    '   _f("/api/checklists",{method:"POST",headers:{"Content-Type":"application/json"},',
    '      body:JSON.stringify({id:"control-positivo",items:[]})})',
    '     .catch(function(){}).then(function(){ setTimeout(fin,400); });',
    ' }',
    ' function fin(){document.title="RES "+JSON.stringify(res);}',
    '});</script>',
  ].join('\n');

  const sano = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const html = sano.replace('<body>', '<body>' + pasos);
  if (html === sano) { console.error(JSON.stringify({ esc: clave, error: 'no pude inyectar' })); process.exit(2); }

  let pedidos = 0;
  const posts = [];
  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url.indexOf('/api/') === 0) {
      pedidos++;
      if (req.method === 'POST' && url === '/api/checklists') {
        let cuerpo = '';
        req.on('data', (d) => { cuerpo += d; });
        return req.on('end', () => {
          try { posts.push(JSON.parse(cuerpo)); } catch { posts.push(null); }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ checklist: {} }));
        });
      }
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
    const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-foto-'));
    const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--user-data-dir=' + perfil, '--virtual-time-budget=60000', '--window-size=412,900',
      '--disable-background-networking', '--disable-sync', '--disable-component-update',
      '--disable-features=PushMessaging,OptimizationHints',
      '--dump-dom', 'http://localhost:' + puerto + '/tareas'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let dom = '';
    h.stdout.on('data', (d) => { dom += d.toString('utf8'); });
    h.on('error', (e) => { srv.close(); console.error(JSON.stringify({ esc: clave, error: 'Chrome: ' + e.message })); process.exit(2); });
    h.on('close', () => {
      srv.close();
      const m = /<title>RES ([\s\S]*?)<\/title>/.exec(dom);
      if (!m) {
        const t = /<title>([\s\S]*?)<\/title>/.exec(dom);
        console.error(JSON.stringify({ esc: clave, error: 'sin medicion · title=' + (t ? t[1] : 'ninguno') +
          ' · dom=' + dom.length + 'B · pedidos=' + pedidos }));
        process.exit(2);
      }
      const r = JSON.parse(m[1]);
      // El control positivo se separa de los guardados REALES de la app.
      const deLaApp = posts.filter((p) => !p || p.id !== 'control-positivo');
      r.controlLlego = posts.some((p) => p && p.id === 'control-positivo');
      const ult = deLaApp.length ? deLaApp[deLaApp.length - 1] : null;
      r.posts = deLaApp.length;
      r.fotosEnElUltimoPost = ult && Array.isArray(ult.items)
        ? ult.items.reduce((n, i) => n + ((i && Array.isArray(i.photos)) ? i.photos.length : 0), 0) : 0;
      r.urlsRaras = ult && Array.isArray(ult.items)
        ? ult.items.reduce((n, i) => n + ((i && Array.isArray(i.photos))
            ? i.photos.filter((f) => !/^https?:/.test(String((f && f.url) || f))).length : 0), 0) : 0;
      console.log(JSON.stringify(r));
    });
  });
}

function copiarDist() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'md-dist-foto-'));
  const copiar = (de, a) => {
    fs.mkdirSync(a, { recursive: true });
    for (const e of fs.readdirSync(de, { withFileTypes: true })) {
      const o = path.join(de, e.name); const d = path.join(a, e.name);
      if (e.isDirectory()) copiar(o, d); else fs.copyFileSync(o, d);
    }
  };
  copiar(DIST_REAL, destino);
  return destino;
}

if (process.argv[2] === '--hijo') {
  hijo(process.argv[3], Number(process.argv[4]), process.argv[5]);
} else {
  (async () => {
    if (!CHROME) abortar('no encontre Chrome.');
    if (!fs.existsSync(path.join(DIST_REAL, 'index.html'))) abortar('no hay dist/. Corre `npm run build`.');
    if (!fs.existsSync(DIST_MANUAL)) abortar('no hay dist/manual.');
    const dist = copiarDist();
    const filas = [];
    let puerto = 4610;
    for (const e of ESCENARIOS) {
      const r = await new Promise((ok) => {
        const p = spawn(process.execPath, [__filename, '--hijo', dist, String(puerto++), e.clave],
          { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = ''; let err = '';
        p.stdout.on('data', (d) => { out += d; });
        p.stderr.on('data', (d) => { err += d; });
        p.on('close', () => {
          try { ok(JSON.parse(out.trim().split('\n').pop())); }
          catch { ok({ esc: e.clave, error: (err || out).trim().slice(0, 220) }); }
        });
      });
      filas.push({ e, r });
    }
    console.log('\n  SUBIR LA FOTO POR LA GALERIA - lo que ningun arnes habia ejercido');
    console.log('  ' + '-'.repeat(96));
    console.log('  escenario                                      inputs capt mult cloud minis done intento guardo ctrl');
    let sinControl = 0;
    for (const { e, r } of filas) {
      if (r.error) { console.log('  ' + e.que.padEnd(46) + '  ERROR: ' + r.error); continue; }
      if (!r.controlLlego) sinControl++;
      console.log('  ' + e.que.padEnd(46) +
        String(r.inputs).padStart(6) + String(r.conCapture).padStart(5) + String(r.conMultiple).padStart(5) +
        String(r.intentosCloud).padStart(6) + String(r.miniaturas).padStart(6) + String(r.itemDone).padStart(5) +
        String(r.postApp).padStart(8) + String(r.posts).padStart(7) + String(r.controlLlego ? 'si' : 'NO').padStart(5));
    }
    console.log('  ' + '-'.repeat(96));
    console.log('  intento = POST que la APP lanzo · guardo = POST que LLEGO al servidor · ctrl = control positivo');
    if (sinControl) {
      console.error('\n  [foto] ABORTA: el control positivo NO llego en ' + sinControl +
        ' escenario(s): este arnes no sabe medir POSTs, asi que el cero de la app no prueba nada.');
      process.exitCode = 3;
    }
    for (const { e, r } of filas) {
      if (r.error) continue;
      if (r.tituloSwal) console.log('  aviso en "' + e.clave + '": ' + r.tituloSwal);
      if (e.clave === 'toque') {
        console.log('  toque: ' + r.puntos + ' punto(s) en pantalla · botones "marcar como hecha"=' +
          r.botonHecha + ' · botones de foto=' + r.botonFoto);
        console.log('         toque la fila del punto -> done=' + r.itemDone +
          ' · aviso="' + (r.toast || r.tituloSwal || '(ninguno)') + '"');
      }
      if (r.galeriaCuenta) console.log('  "' + e.clave + '" galeria dice: ' + r.galeriaCuenta);
    }
  })();
}
