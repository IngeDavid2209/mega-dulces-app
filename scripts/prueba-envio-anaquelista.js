/**
 * 📷 EL ENVÍO DE LA ANAQUELISTA, MEDIDO EN EL DOM
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Paso 1 del plan del 18/sep/2026: desbloquear a los 154 que entregan todos los
 * días. Tres cosas que `ng test` no puede contestar, porque ninguna es una
 * función que se pueda llamar:
 *
 *   1. ¿Salió un cuadro de diálogo DEL NAVEGADOR al intentar enviar?
 *   2. ¿El aviso de «se pasó la hora» sale UNA vez o una por punto?
 *   3. ¿El botón dice lo que falta ANTES de tocarlo?
 *
 * ─── LA PREGUNTA QUE ESTO CONTESTA, Y LA QUE NO ──────────────────────────
 * Contesta «¿qué tiene delante quien entrega?». NO contesta si se ve bien:
 * son sesiones sintéticas en Chrome headless y nadie ha entrado con una cuenta
 * real.
 *
 * ─── EL CONTROL POSITIVO ES EL QUE HACE VÁLIDO AL CERO ───────────────────
 * «0 diálogos nativos» y «mi intercepción no funcionó» se ven IDÉNTICOS
 * (§8.11 a). Por eso el guion, al final de todo, llama a `confirm()` a
 * propósito y exige que el contador suba a 1. Sin esa línea, este arnés daría
 * verde con la intercepción rota y con el `confirm()` viejo todavía puesto.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const DIST = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');

function abortar(motivo) {
  console.error('');
  console.error('[envio] ABORTA: ' + motivo);
  console.error('[envio] "No pude medir" y "está roto" son dos cosas distintas.');
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

const ANAQUELISTA = 'Claudia Prueba Envio';
const SESION = {
  uid: 'a1', id: 'a1', nombre: ANAQUELISTA, usuario: 'clau', correo: 'clau@l.invalid',
  rol: 'trabajador', sucursales: ['8 Esquinas'], puestoId: 'anaquelista',
};

/**
 * ⚠ LA HORA LÍMITE SE FIJA EN 00:01, NO EN UNA CONSTANTE BONITA.
 * Con una hora fija tipo «09:00» esta prueba pasaría por la mañana y fallaría
 * por la tarde —o al revés— según a qué hora la corriera alguien. A las 00:01
 * de hoy ya pasó siempre, salvo el primer minuto del día, y de eso avisa la
 * guardia de abajo.
 */
const VENCIDA = '00:01';

const punto = (id, texto) => ({
  id, text: texto, completed: false, requiresPhoto: true,
  horaInicio: '00:00', horaLimite: VENCIDA,
});
const puntoHecho = (id, texto) => ({
  ...punto(id, texto),
  photo: 'https://ejemplo.invalid/' + id + '.jpg',
  photoTime: '12:00 AM',
});

const TRES_PUNTOS = 3;
const FILAS = [
  {
    id: 'sinfoto', date: HOY, name: 'Acomodo de pasillo 2', assigned: ANAQUELISTA,
    store: '8 Esquinas', status: 'pendiente', createdBy: 'Robot del Manual',
    _origenManual: true, _manualCodigo: 'MC-3.1',
    items: [
      punto('p1', 'Pasillo 2 sin producto en el piso'),
      punto('p2', 'Cabecera con precio visible'),
      punto('p3', 'Caducidades revisadas'),
    ],
  },
  {
    // HORAS DISTINTAS. Existe para ejercer el chip por punto: con todos los
    // puntos compartiendo ventana el chip no se pinta (diria lo mismo que el
    // aviso de arriba, una vez por renglon), asi que sin esta tarea la columna
    // `chips` seria cero en las cinco filas y ese cero significaria «nunca se
    // ejercio», no «no se pinta cuando no debe».
    id: 'mixta', date: HOY, name: 'Apertura con dos horarios', assigned: ANAQUELISTA,
    store: '8 Esquinas', status: 'pendiente', createdBy: 'Robot del Manual',
    _origenManual: true, _manualCodigo: 'MC-3.3',
    items: [
      { ...punto('m1', 'Cortina abierta'), horaLimite: '00:01' },
      { ...punto('m2', 'Corte de caja'), horaLimite: '00:02' },
    ],
  },
  {
    id: 'confoto', date: HOY, name: 'Revision de caducidades', assigned: ANAQUELISTA,
    store: '8 Esquinas', status: 'completo', createdBy: 'Robot del Manual',
    _origenManual: true, _manualCodigo: 'MC-3.2',
    items: [puntoHecho('q1', 'Anaquel 4 revisado'), puntoHecho('q2', 'Anaquel 5 revisado')],
  },
];

const USUARIOS = [
  { id: 'a1', nombre: ANAQUELISTA, puestoId: 'anaquelista', activo: true, sucursales: ['8 Esquinas'] },
];
const CUERPO = JSON.stringify({ checklists: FILAS, usuarios: USUARIOS, areas: [] });

const TIPOS = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

const ABRIR_SIN_FOTO = { tipo: 'boton', sel: '.checklist-card', texto: 'Acomodo de pasillo 2' };
const ABRIR_CON_FOTO = { tipo: 'boton', sel: '.checklist-card', texto: 'Revision de caducidades' };
const ENVIAR = { tipo: 'boton', sel: '.btn-send', texto: '' };
const CONTESTAR_TODOS = { tipo: 'motivos', codigo: 'no_aplica' };

const ESCENARIOS = [
  {
    nombre: 'abro mi tarea sin fotos',
    pasos: [ABRIR_SIN_FOTO],
    // UN aviso de reloj, no tres. Y el botón dice lo que falta ANTES de tocarlo.
    relojes: 1, chipsTarde: 0, modal: 0, filasModal: 0,
    nativos: 0, envioHabilitado: null,
    enBoton: 'te faltan 3 fotos',
  },
  {
    nombre: 'pulso Enviar con 0 de 3',
    pasos: [ABRIR_SIN_FOTO, ENVIAR],
    // LA FILA QUE MÁS PESA: cero cuadros del navegador, y un modal de la app
    // con un renglón por punto.
    relojes: 1, chipsTarde: 0, modal: 1, filasModal: TRES_PUNTOS,
    nativos: 0, envioHabilitado: false,
    enBoton: 'Faltan 3 por contestar',
  },
  {
    nombre: 'contesto los 3 motivos',
    pasos: [ABRIR_SIN_FOTO, ENVIAR, CONTESTAR_TODOS],
    relojes: 1, chipsTarde: 0, modal: 1, filasModal: TRES_PUNTOS,
    nativos: 0, envioHabilitado: true,
    enBoton: 'Enviar mi tarea',
  },
  {
    nombre: 'tarea con horas DISTINTAS: sale el chip',
    pasos: [{ tipo: 'boton', sel: '.checklist-card', texto: 'Apertura con dos horarios' }],
    // Aqui el aviso de arriba solo puede nombrar el mas proximo (00:01), asi que
    // el chip por punto es lo unico que dice cual es cual.
    relojes: 1, chipsTarde: 2, modal: 0, filasModal: 0,
    nativos: 0, envioHabilitado: null,
    enBoton: 'te faltan 2 fotos',
  },
  {
    nombre: 'CONTRASTE: tarea con sus fotos',
    pasos: [ABRIR_CON_FOTO],
    // Sin esta fila, un `claseUrgencia()` que devolviera siempre 'vencida' y un
    // botón que siempre dijera «te faltan» pasarían las tres de arriba.
    relojes: 0, chipsTarde: 0, modal: 0, filasModal: 0,
    nativos: 0, envioHabilitado: null,
    enBoton: 'Confirmar y Enviar',
  },
  {
    nombre: 'CONTRASTE: enviar la que sí tiene fotos',
    pasos: [ABRIR_CON_FOTO, ENVIAR],
    // No se le pide motivo a quien no debe nada: el modal NO sale y la tarea SE
    // ENVIA. El esperado sale de la regla, no de lo que midio la corrida: al
    // enviar con exito la plantilla cambia `.btn-send` por `.send-section-success`,
    // asi que pedirle aqui el texto del boton era pedirle a un boton que ya no
    // existe. Afirmar el exito es ademas mas fuerte: prueba que el camino
    // completo sigue funcionando y que no lo rompio el modal nuevo.
    relojes: 0, chipsTarde: 0, modal: 0, filasModal: 0,
    nativos: 0, envioHabilitado: null,
    enBoton: '', exito: 1,
  },
];

function guion(esc) {
  const sesion = JSON.stringify(JSON.stringify(esc.sesion || SESION));
  const pasos = JSON.stringify(esc.pasos);
  return [
    '<script>try{',
    'localStorage.setItem("md_sesion_actual",' + sesion + ');',
    'localStorage.setItem("md_token","token-de-medicion");',
    '}catch(e){}</script>',
    '<script>',
    // ── LA INTERCEPCIÓN VA ANTES QUE ANGULAR ───────────────────────────────
    // Si se instalara después del arranque, un diálogo disparado durante la
    // carga no se contaría y el cero sería falso.
    'window.__nativos=[];',
    'window.confirm=function(m){window.__nativos.push("confirm: "+String(m).slice(0,60));return false;};',
    'window.alert=function(m){window.__nativos.push("alert: "+String(m).slice(0,60));};',
    'window.__pasos=' + pasos + ';',
    'function texto(e){return (e.textContent||"").replace(/\\s+/g," ").trim();}',
    'function hacer(p){',
    '  if(p.tipo==="motivos"){',
    '    var sels=[].slice.call(document.querySelectorAll(".sp-select"));',
    '    if(!sels.length){window.__falla="no encontre ningun <select> de motivo";return;}',
    '    sels.forEach(function(s){',
    '      s.value=p.codigo;',
    // Fijar `.value` sin disparar `change` NO avisa a ngModel: la medición
    // saldría como si nadie hubiera contestado. Es el no-op que da verde.
    '      s.dispatchEvent(new Event("change",{bubbles:true}));',
    '    });',
    '    var sinPoner=sels.filter(function(s){return s.value!==p.codigo;}).length;',
    '    if(sinPoner){window.__falla="el valor no se fijo en "+sinPoner+" selects";}',
    '    return;',
    '  }',
    '  var todos=[].slice.call(document.querySelectorAll(p.sel));',
    '  var b=p.texto ? todos.filter(function(e){return texto(e).indexOf(p.texto)>=0;})[0] : todos[0];',
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
    '  var envio=document.querySelector(".sp-pie .btn-primary");',
    '  var btnSend=document.querySelector(".btn-send");',
    '  var d={',
    '    falla: window.__falla||"",',
    '    relojes: document.querySelectorAll(".cl-reloj").length,',
    '    chipsTarde: document.querySelectorAll(".item-chip-tarde").length,',
    '    modal: document.querySelectorAll(".sp-modal").length,',
'    exito: document.querySelectorAll(".send-section-success").length,',
'    justificante: document.querySelectorAll(".modal-overlay").length - document.querySelectorAll(".sp-modal").length,',
    '    filasModal: document.querySelectorAll(".sp-fila").length,',
    '    envioHabilitado: envio ? !envio.disabled : null,',
    '    textoEnvioModal: envio ? texto(envio) : "",',
    '    textoBotonEnviar: btnSend ? texto(btnSend) : "",',
    // El párrafo viejo, que se repetía punto por punto. Tiene que ser 0: si
    // quedara uno, la mitad del cambio no habría aplicado.
    '    parrafosViejos: [].slice.call(document.querySelectorAll(".alert-box"))',
    '      .filter(function(e){return texto(e).indexOf("justificante de retraso")>=0;}).length,',
    '    nativos: window.__nativos.slice(),',
    '  };',
    // ── CONTROL POSITIVO: ¿la intercepción de verdad atrapa algo? ──────────
    // Se hace AL FINAL y sobre una copia ya tomada, para no ensuciar el conteo.
    '  window.confirm("control positivo");',
    '  d.interceptaDeVerdad = window.__nativos.length === d.nativos.length + 1;',
    '  try{ fetch("/__medida",{method:"POST",body:JSON.stringify(d)}); }catch(e){}',
    '}',
    'window.addEventListener("load",function(){setTimeout(function(){paso(0);},3400);});',
    '</script>',
  ].join('\n');
}

function medir(esc, puerto) {
  return new Promise((resolve) => {
    const sano = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const html = sano.replace('<body>', '<body>' + guion(esc));
    if (html === sano) return resolve({ error: 'no pude inyectar la sesión en el index' });

    let apiPedidos = 0; let medida = null;
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/__medida') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => { try { medida = JSON.parse(body); } catch (e) {} res.writeHead(204); res.end(); });
        return;
      }
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
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.on('error', (e) => resolve({ error: 'el servidor local no levantó: ' + e.message }));
    srv.listen(puerto, () => {
      const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'md-envio-'));
      // La URL se arma aquí con la barra puesta por código: en Git Bash, MSYS
      // convierte '/tareas' en 'C:/Program Files/Git/tareas' si pasa por una
      // variable de entorno, y el DOM llega vacío.
      const h = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--window-size=1440,1400', '--user-data-dir=' + perfil, '--virtual-time-budget=30000',
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
        if (!medida) return resolve({ error: 'el guion no reportó medición (dom=' + dom.length + 'B)' });
        resolve({ dato: medida, apiPedidos });
      });
    });
  });
}

(async () => {
  if (!CHROME) abortar('no encontré Chrome.');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) abortar('no hay dist/. Corre `npm run build` antes.');

  // §8.11(a): la hora de la corrida es una ENTRADA de esta prueba. En el primer
  // minuto del día la tarea de las 00:01 todavía no ha vencido y las filas de
  // arriba medirían otra cosa. Se aborta en vez de reportar un fallo falso.
  const ahora = new Date();
  if (ahora.getHours() === 0 && ahora.getMinutes() <= 1) {
    abortar('son las ' + ahora.toTimeString().slice(0, 5) + ': la tarea de las ' + VENCIDA +
            ' todavía no vence y los escenarios no medirían lo que vienen a medir.');
  }

  console.log('');
  console.log('  📷 EL ENVÍO DE LA ANAQUELISTA — %s escenarios · %s tareas · límite %s (ya pasó)',
    ESCENARIOS.length, FILAS.length, VENCIDA);
  console.log('  ──────────────────────────────────────────────────────────────────────');
  console.log('  %s reloj chips modal filas nativos enviada retraso', 'escenario'.padEnd(38));

  let fallos = 0; const vistos = [];

  for (let i = 0; i < ESCENARIOS.length; i++) {
    const esc = ESCENARIOS[i];
    const r = await medir(esc, 4930 + i);
    if (r.error) abortar(esc.nombre + ' → ' + r.error);
    const d = r.dato;
    if (d.falla) abortar(esc.nombre + ' → el escenario no montó lo que venía a medir: ' + d.falla);
    if (!r.apiPedidos) abortar(esc.nombre + ' → la app nunca pidió /api: los ceros no valen.');
    // EL CONTROL POSITIVO. Sin esto, «0 nativos» puede ser «no intercepté».
    if (!d.interceptaDeVerdad) {
      abortar(esc.nombre + ' → la intercepción de diálogos NO funciona, así que el 0 de ' +
              'la columna «nativos» no prueba nada.');
    }
    vistos.push(d);

    console.log('  %s %s %s %s %s %s %s %s', esc.nombre.padEnd(38),
      String(d.relojes).padStart(5), String(d.chipsTarde).padStart(5),
      String(d.modal).padStart(5), String(d.filasModal).padStart(5),
      String(d.nativos.length).padStart(7), String(d.exito).padStart(7),
      String(d.justificante).padStart(7));

    const comprobar = (que, esperado, medido) => {
      if (esperado !== medido) {
        console.log('      ✗ %s: esperaba %s, medí %s', que, JSON.stringify(esperado), JSON.stringify(medido));
        fallos++;
      }
    };
    comprobar('avisos de reloj', esc.relojes, d.relojes);
    comprobar('chips de «se pasó la hora»', esc.chipsTarde, d.chipsTarde);
    comprobar('modal de motivos', esc.modal, d.modal);
    comprobar('renglones del modal', esc.filasModal, d.filasModal);
    comprobar('botón de enviar del modal habilitado', esc.envioHabilitado, d.envioHabilitado);

    if (d.nativos.length !== esc.nativos) {
      console.log('      ✗ salieron %s cuadro(s) DEL NAVEGADOR: %s',
        d.nativos.length, d.nativos.join(' | '));
      fallos++;
    }
    if (d.parrafosViejos) {
      console.log('      ✗ quedan %s párrafos viejos de «justificante de retraso» repetidos por punto',
        d.parrafosViejos);
      fallos++;
    }
    comprobar('tarea enviada (bloque de exito)', esc.exito || 0, d.exito);
    const enPantalla = esc.modal ? d.textoEnvioModal : d.textoBotonEnviar;
    if (esc.enBoton && enPantalla.indexOf(esc.enBoton) < 0) {
      console.log('      ✗ el botón debía decir «%s» y dice «%s»', esc.enBoton, enPantalla);
      fallos++;
    }
  }

  // ── GUARDIA DE DISCRIMINACIÓN (§8.11 c) ────────────────────────────────
  // Sin esto, una pantalla que NUNCA pintara el reloj ni el modal pasaría las
  // dos filas de contraste con ceros perfectos y el resto quedaría sin ejercer.
  console.log('');
  const conReloj = vistos.filter((d) => d.relojes > 0).length;
  const conModal = vistos.filter((d) => d.modal > 0).length;
  if (!conReloj || conReloj === vistos.length) {
    abortar('el aviso de reloj sale en ' + conReloj + ' de ' + vistos.length +
            ' escenarios: la muestra no distingue «vencida» de «a tiempo».');
  }
  if (!conModal || conModal === vistos.length) {
    abortar('el modal sale en ' + conModal + ' de ' + vistos.length +
            ' escenarios: la muestra no distingue «faltan fotos» de «están todas».');
  }
  const conChip = vistos.filter((d) => d.chipsTarde > 0).length;
  if (!conChip || conChip === vistos.length) {
    abortar('el chip por punto sale en ' + conChip + ' de ' + vistos.length +
            ' escenarios: la muestra no distingue «horas distintas» de «misma ventana», ' +
            'asi que el cero de esa columna no prueba nada.');
  }
  const habilitados = new Set(vistos.map((d) => d.envioHabilitado));
  if (!habilitados.has(true) || !habilitados.has(false)) {
    abortar('el botón del modal nunca cambió de estado: un `puedeConfirmarSinPrueba()` ' +
            'constante pasaría todo lo de arriba.');
  }

  console.log('  ──────────────────────────────────────────────────────────────────────');
  console.log('  %s escenarios medidos · %s fallo(s) · intercepción de diálogos verificada',
    vistos.length, fallos);
  console.log('  ⚠ Son sesiones sintéticas en Chrome headless: prueba QUÉ hay delante de');
  console.log('    quien entrega, no que se VEA bien. Nadie ha entrado con una cuenta real.');
  console.log('');
  process.exit(fallos ? 2 : 0);
})();
