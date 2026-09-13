#!/usr/bin/env node
/**
 * 🚚 ¿LLEGÓ EL DESPLIEGUE? — marcadores contados en TODO lo que se sirve
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA QUE CONTESTA
 * ═══════════════════════════════════════════════════════════════════════════
 * NO «¿corrió `railway up`?» ni «¿cambió la fecha del ngsw?». Esas dos dan
 * verde con el código viejo servido — y ya dieron tres falsos positivos en un
 * día. La pregunta es:
 *
 *     ¿EL CÓDIGO NUEVO ESTÁ EN LOS ARCHIVOS QUE EL NAVEGADOR DESCARGA?
 *
 * ─── LAS TRES TRAMPAS QUE ESTO EVITA, todas cobradas antes ──────────────────
 *
 * 1. BUSCAR EN EL ARCHIVO EQUIVOCADO. Las pantallas van en chunks *lazy*:
 *    buscar un marcador en `main-*.js` da CERO por mirar donde no está. Aquí se
 *    recorren TODOS los archivos de código que declara el `ngsw.json`.
 *
 * 2. EL HOST ESCRITO DE MEMORIA. `mdtask.up.railway.app` no existe. El edge de
 *    Railway responde 404 CON CUERPO (101 bytes de JSON y `x-railway-fallback`)
 *    cuando el host no tiene servicio detrás, así que un conteo sobre eso no
 *    falla: solo no encuentra nada. El host se pasa por argumento y se lee del
 *    repo, y el script ABORTA si el `ngsw.json` no es JSON o viene enano.
 *
 * 3. EL MARCADOR QUE YA VALÍA 1. Un marcador que existía antes del cambio da
 *    verde sin desplegar nada. Por eso cada marcador se declara con lo que se
 *    espera ANTES y DESPUÉS, y el script exige que el conjunto incluya:
 *      · al menos un marcador NUEVO (0 antes, >0 después), y
 *      · al menos un CONTROL presente en las dos (prueba que el recorrido
 *        alcanza el chunk correcto: sin él, un cero se lee como «no llegó»
 *        cuando puede ser «no busqué donde está»).
 *
 *   node scripts/verificar-despliegue.js <host>
 *   node scripts/verificar-despliegue.js mdtask-production-ed88.up.railway.app
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = process.argv[2];
const DIST = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');

/**
 * Los marcadores. `nuevo: true` = tiene que pasar de 0 a >0 con este
 * despliegue. `control: true` = ya existía y tiene que seguir >0: es lo que
 * prueba que el recorrido llega al chunk del organigrama.
 */
const MARCADORES = [
  // ── COMO SE ELIGE UN MARCADOR, que es la leccion del 13/sep/2026 ─────────
  // Para la Fase 2.1 el primer candidato fue `no_ejecutado`, el estado nuevo de
  // la regla. Parecia inmejorable y estaba MAL: medido contra produccion ANTES
  // de desplegar YA VALIA 2 — esa cadena vive desde hace dias en
  // `tablero-direccion.util.ts` (el modelo de 5 causas), asi que habria dado
  // verde sin desplegar nada. `justificado` tampoco servia: 6 archivos en HEAD.
  //
  // La raiz: un cambio de LOGICA PURA no introduce ninguna cadena propia, y el
  // minificador ademas se come los nombres de funcion (`estadoItem` -> 0 en el
  // bundle) aunque respete los literales de cadena. Por eso los marcadores
  // buenos acaban siendo clases CSS de algo que de verdad se pinta, y cada una
  // se valida en LAS DOS DIRECCIONES: inexistente en HEAD, presente en el dist.
  //
  // EL NUEVO DE ESTE DESPLIEGUE va SIEMPRE en esta linea, y los de despliegues
  // anteriores bajan a control. Mantener ese orden importa: dos veces hoy el
  // comentario se quedo describiendo el marcador ANTERIOR, y un comentario que
  // narra otra cosa que la linea de abajo es doctrina falsa en dos semanas.
  { txt: 'plz-codigo', nuevo: true, que: 'el login por plaza y su paso de identidad' },
  { txt: 'pl-accesos', control: true, que: 'la pantalla de accesos de plaza' },
  { txt: 'min-height:var(--tap-min)', control: true, que: 'el minimo tactil' },
  { txt: 'pa-sin_asignar', control: true, que: 'la pantalla de pase de lista' },
  // Los de antes, ahora controles. Cada uno fue el "nuevo" de su momento, y
  // juntos prueban que el recorrido alcanza los chunks lazy de esas pantallas.
  { txt: 'pl-plazas',    control: true, que: 'la generacion de plazas desde la plantilla' },
  { txt: 'pl-sinpuesto', control: true, que: 'la pantalla de plantilla' },
  { txt: 'pr-justif',    control: true, que: 'los justificados nombrados en pantalla' },
  // Controles: existian antes de este despliegue y deben seguir en pie. Viven
  // en chunks DISTINTOS (tablero, tarjeta, organigrama, index), asi que si uno
  // diera 0 seria por no haber recorrido ese chunk, no por no haber llegado.
  { txt: 'no_ejecutado',       control: true, que: 'el modelo de causas del tablero' },
  { txt: 'avatar texto',       control: true, que: 'la rejilla movil de la tarjeta' },
  { txt: 'org-destino',        control: true, que: 'el eje transversal' },
  { txt: 'md_rescate_arranque', control: true, que: 'el rescate del index' },
];

function abortar(motivo) {
  console.error('');
  console.error('[despliegue] ABORTA: ' + motivo);
  console.error('[despliegue] No concluyas de esta corrida.');
  process.exit(3);
}

function bajar(url) {
  return new Promise((ok, mal) => {
    https.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return mal(new Error('HTTP ' + res.statusCode + ' en ' + url +
          (res.headers['x-railway-fallback'] ? ' (x-railway-fallback: el host no tiene servicio detrás)' : '')));
      }
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => ok(d));
    }).on('error', mal);
  });
}

function contarEn(textos, aguja) {
  return textos.reduce((n, t) => n + (t.split(aguja).length - 1), 0);
}

(async () => {
  if (!HOST) abortar('falta el host. Léelo del repo, no de memoria: ' +
    'node scripts/verificar-despliegue.js mdtask-production-ed88.up.railway.app');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    abortar('no hay dist/ local. Hace falta para comparar «lo que debería estar» contra ' +
      '«lo que se sirve».');
  }

  // ── 1 · el ngsw.json, con su tamaño ANTES de concluir nada ──────────────
  const base = 'https://' + HOST;
  let ngsw;
  try { ngsw = await bajar(base + '/ngsw.json?t=' + Date.now()); }
  catch (e) { abortar('no pude leer el ngsw.json: ' + e.message); }
  console.log('[despliegue] host %s · ngsw.json %d bytes', HOST, ngsw.length);
  if (ngsw.length < 2000) {
    abortar('el ngsw.json trae solo ' + ngsw.length + ' bytes. El 404 del edge de Railway ' +
      'viene CON cuerpo, así que esto puede ser una página de error que no falla al grepear.');
  }
  let manifiesto;
  try { manifiesto = JSON.parse(ngsw); }
  catch (e) { abortar('el ngsw.json no es JSON: ' + ngsw.slice(0, 120)); }

  const rutas = Object.keys(manifiesto.hashTable || {})
    .filter((r) => r.endsWith('.js') || r.endsWith('.css'));
  if (rutas.length < 10) abortar('el ngsw declara solo ' + rutas.length + ' archivos de código.');

  // ── 2 · bajarlos TODOS. Uno ilegible invalida el conteo ─────────────────
  const cuerpos = [];
  let bytes = 0, fallos = 0;
  for (const r of rutas) {
    try {
      const c = await bajar(base + r);
      cuerpos.push(c); bytes += c.length;
    } catch (e) { fallos++; console.error('  ! no pude bajar %s: %s', r, e.message); }
  }
  if (fallos) abortar(fallos + ' de ' + rutas.length + ' archivos no se pudieron leer. ' +
    'Un marcador ausente sería indistinguible de un archivo que no bajó.');
  // El `index.html` NO está en el `hashTable` del ngsw, y el navegador SÍ lo
  // descarga: ahí vive el <script> inline del rescate de arranque. Dejarlo
  // fuera hacía que su marcador diera 0 por no haberlo buscado — que es
  // exactamente el falso cero que el control de esta herramienta destapó.
  try {
    const idx = await bajar(base + '/index.html?t=' + Date.now());
    cuerpos.push(idx); bytes += idx.length;
    console.log('[despliegue] index.html %d bytes', idx.length);
  } catch (e) { abortar('no pude leer el index.html: ' + e.message); }

  console.log('[despliegue] servido: %d archivos de código + index · %s MB',
    rutas.length, (bytes / 1048576).toFixed(2));

  // ── 3 · el dist/ local, la otra mitad de la comparación ─────────────────
  const locales = [];
  const recoger = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recoger(p);
      else if (/\.(js|css|html)$/.test(e.name)) locales.push(fs.readFileSync(p, 'utf8'));
    }
  };
  recoger(DIST);
  console.log('[despliegue] dist/ local: %d archivos', locales.length);

  // ── 4 · la tabla ────────────────────────────────────────────────────────
  console.log('');
  console.log('marcador                              dist/  servido  qué prueba');
  console.log('─'.repeat(88));
  const filas = MARCADORES.map((m) => {
    const enDist = contarEn(locales, m.txt);
    const enProd = contarEn(cuerpos, m.txt);
    console.log('%s %s %s %s',
      m.txt.padEnd(37), String(enDist).padEnd(6), String(enProd).padEnd(8), m.que);
    return { ...m, enDist, enProd };
  });
  console.log('─'.repeat(88));

  // ── 5 · las aserciones ──────────────────────────────────────────────────
  const fallas = [];
  const nuevos = filas.filter((f) => f.nuevo);
  const controles = filas.filter((f) => f.control);
  if (!nuevos.length) abortar('no hay ningún marcador NUEVO declarado: nada probaría que llegó.');
  if (!controles.length) abortar('no hay ningún CONTROL declarado: un cero sería indistinguible ' +
    'de haber buscado donde el código no está.');

  for (const f of controles) {
    if (f.enProd === 0) {
      abortar('el CONTROL "' + f.txt + '" da 0 en lo servido, y ya existía antes de este ' +
        'despliegue. Eso no dice «no llegó»: dice que el recorrido NO alcanza el chunk donde ' +
        'vive el código. Cualquier otro cero de esta tabla es igual de sospechoso.');
    }
  }
  for (const f of nuevos) {
    if (f.enDist === 0) {
      fallas.push('"' + f.txt + '" no está ni en el dist/ local: el marcador está mal elegido, ' +
        'no es que no haya llegado. Un marcador que vale 0 en el dist/ no puede validar nada.');
    } else if (f.enProd === 0) {
      fallas.push('"' + f.txt + '" (' + f.que + ') está en el dist/ (' + f.enDist +
        ') y NO en lo servido: el despliegue todavía no llegó.');
    }
  }

  console.log('');
  if (fallas.length) {
    console.error('✗ %d marcador(es) sin llegar:', fallas.length);
    for (const x of fallas) console.error('   · ' + x);
    process.exit(2);
  }
  console.log('✓ los %d marcadores nuevos están servidos, y los %d controles siguen en pie.',
    nuevos.length, controles.length);
  console.log('  (%d archivos, %s MB recorridos)', rutas.length, (bytes / 1048576).toFixed(2));
})();
