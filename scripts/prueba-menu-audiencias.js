// ============================================================================
//  ¿EL MENÚ NUEVO LE MUESTRA A CADA QUIEN LO MISMO QUE EL VIEJO?
//
//  ─── EL HUECO QUE ESTO TAPA ───────────────────────────────────────────────
//  El criterio del paso 4.1 comparó el CONJUNTO DE RUTAS del `NAV` contra el del
//  `sidebar.html` anterior. Eso atrapó tres rutas caídas —/home, /promociones,
//  /venta-promos— y estuvo bien. Pero NO comprobó QUIÉN LAS VE.
//
//  Un predicado `ve` que quedó más estricto de lo que era —una entrada que antes
//  aparecía para una trabajadora y ahora pide `esAdmin`— pasa ese chequeo sin
//  ruido, porque la ruta sigue estando en el arreglo. Y `grep "nav-seccion"`
//  sobre el bundle confirma que el código se sirvió, no que el menú se pinte
//  bien.
//
//  Es el patrón del día una vez más: verificar el artefacto, no la pregunta. Con
//  una diferencia que importa — los diagnósticos eran reversibles y no los veía
//  nadie; **el sidebar es lo primero que toda la empresa experimenta.**
//
//  ─── NINGUNA DE LAS DOS LÓGICAS SE TRANSCRIBE ─────────────────────────────
//  Las condiciones viejas se leen de git (`sidebar.html` y `sidebar.ts` del
//  commit anterior) y las nuevas de `nav.config.ts`. Si yo copiara a mano
//  cualquiera de las dos, la prueba compararía mi transcripción contra el
//  código, que es justo la clase de control que pasa por el camino equivocado.
//
//  ─── SE CORRE ASÍ (no necesita credenciales ni base) ──────────────────────
//    node scripts/prueba-menu-audiencias.js [commit-viejo]
//
//  Es, de paso, la primera prueba del proyecto sobre quién ve qué — y hay que
//  volver a correrla ANTES del paso 4.3, que reemplaza los predicados por la
//  función de alcance. Sin ella no habrá forma de saber si ese reemplazo cambió
//  audiencias.
// ============================================================================
const { execSync } = require('child_process');
const fs = require('fs');

// FIJADO POR SHA, no por HEAD~1. Al principio era relativo, y un commit despues
// -el de esta misma prueba- HEAD~1 ya apuntaba al sidebar NUEVO: la prueba se
// comparaba contra si misma y marcaba las 15 rutas como "ganadas". Es el
// corolario (e) de la §8.11 -un control anclado a algo que se mueve caduca-
// aplicandose a la prueba escrita para ese corolario, el mismo dia.
//
// 78b89a3 es el ultimo commit ANTES del paso 4.1. Es una referencia estable: el
// menu viejo no va a cambiar nunca mas.
const COMMIT_VIEJO = process.argv[2] || '78b89a3';

function abortar(motivo) {
  console.error('');
  console.error('[menu] ABORTA: ' + motivo);
  console.error('[menu] No concluyas de esta corrida.');
  process.exit(2);
}

function deGit(ruta) {
  try {
    return execSync('git show ' + COMMIT_VIEJO + ':' + ruta, { encoding: 'utf8', maxBuffer: 8e6 });
  } catch (e) {
    abortar('no se pudo leer ' + ruta + ' de ' + COMMIT_VIEJO + ' (' + (e.message || '').split('\n')[0] + ')');
  }
}

// ── Las condiciones VIEJAS, leídas del commit anterior ────────────────────
const htmlViejo = deGit('src/app/shared/sidebar/sidebar.html');
const tsViejo = deGit('src/app/shared/sidebar/sidebar.ts');

const viejas = new Map();   // ruta -> expresión (string) o null = siempre
for (const b of htmlViejo.match(/<a class="nav-item"[\s\S]*?<\/a>/g) || []) {
  const r = b.match(/routerLink="([^"]+)"/);
  if (!r) continue;
  const cond = b.match(/\*ngIf="([^"]+)"/);
  viejas.set(r[1], cond ? cond[1] : null);
}
if (viejas.size === 0) abortar('cero entradas en el sidebar.html viejo. El formato cambió.');

// GUARDIA DE FIXTURE, y hace falta: `viejas.size === 0` NO alcanzaba. El sidebar
// nuevo conserva un `nav-item` -el de Perfil, en el pie- asi que apuntar al
// commit equivocado devolvia 1 ruta en vez de 0, pasaba el guardian, y producia
// una comparacion limpia y completamente falsa.
//
// La marca de que el commit es el correcto es que su sidebar.html TENGA las
// condiciones de permiso: son exactamente lo que el paso 4.1 elimino.
const condicionesViejas = (htmlViejo.match(/ngIf="[^"]*(?:puede|grupo)[^"]*"/g) || []).length;
if (condicionesViejas < 5) {
  abortar('el commit ' + COMMIT_VIEJO + ' NO es anterior al paso 4.1: su sidebar.html tiene ' +
    condicionesViejas + ' condiciones de permiso (se esperan ~11). ' +
    'Comparar contra el menu nuevo lo compara consigo mismo y todo sale "igual" o todo "ganado".');
}
console.log('[menu] condiciones viejas leídas de %s → %d rutas, %d condiciones de permiso',
  COMMIT_VIEJO, viejas.size, condicionesViejas);

// Los dos getters que no eran banderas simples, también del código viejo.
function cuerpoGetter(nombre) {
  const m = tsViejo.match(new RegExp('get ' + nombre + '\\(\\): boolean \\{([\\s\\S]*?)\\n  \\}'));
  if (!m) abortar('no se encontró el getter ' + nombre + ' en el sidebar.ts viejo.');
  return m[1];
}
function evalGetter(cuerpo, currentUser) {
  // El cuerpo usa `this.currentUser`; se le da un `this` con ese campo.
  // Ojo con la doble invocacion: antes esto llamaba al resultado otra vez.
  return new Function('u', 'return (function(){' + cuerpo + '}).call({ currentUser: u });')(currentUser);
}
const cuerpoPromos = cuerpoGetter('verPromociones');
const cuerpoVenta = cuerpoGetter('verVentaPromos');

function veViejo(ruta, u) {
  const cond = viejas.get(ruta);
  if (cond === undefined) return false;      // no estaba en el menú viejo
  if (cond === null) return true;            // sin *ngIf = siempre
  const verPromociones = evalGetter(cuerpoPromos, u);
  const verVentaPromos = evalGetter(cuerpoVenta, u);
  return !!new Function('currentUser', 'verPromociones', 'verVentaPromos',
    'return (' + cond + ');')(u, verPromociones, verVentaPromos);
}

// ── Los predicados NUEVOS: SE COMPILA EL ARCHIVO, NO SE PARSEA ────────────
//
// El primer intento leia nav.config.ts con expresiones regulares y salio mal de
// la peor forma: encontro 18 entradas de 24 y reporto como "perdidas" cinco
// rutas que SI estaban en el arreglo. Un parser roto no da error — da una lista
// mas corta y una conclusion falsa, y yo habria estado depurando el menu en vez
// del parser.
//
// Compilando el archivo se usa el `menuDe()` DE VERDAD, el mismo que corre en la
// app. Deja de haber una tercera version de la logica que pueda discrepar.
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-'));
try {
  execSync('npx tsc --outDir "' + tmp + '" --module commonjs --target ES2022 ' +
    '--moduleResolution node --skipLibCheck src/app/shared/sidebar/nav.config.ts',
    { stdio: 'pipe' });
} catch (e) {
  abortar('no se pudo compilar nav.config.ts: ' + String(e.stdout || e.message).slice(0, 300));
}
// Se BUSCA el archivo emitido en vez de asumir su ruta. Antes se daba por
// hecho que estaria en la raiz del outDir, y eso valia solo mientras
// nav.config.ts no importara nada: en cuanto empezo a importar `veControl`, tsc
// emitio un arbol y la prueba aborto diciendo "tsc no produjo ..." — que suena a
// fallo del compilador cuando era un supuesto mio caducado.
function buscar(dir, nombre) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = buscar(p, nombre); if (r) return r; }
    else if (e.name === nombre) return p;
  }
  return null;
}
const compilado = buscar(tmp, 'nav.config.js');
if (!compilado) {
  abortar('tsc no emitio nav.config.js en ' + tmp + '. Revisa la salida del compilador.');
}
const NAVMOD = require(compilado);

if (typeof NAVMOD.menuDe !== 'function' || !Array.isArray(NAVMOD.NAV)) {
  abortar('el modulo compilado no exporta menuDe() y NAV. Cambio la forma del archivo.');
}
const ocultas = NAVMOD.NAV.filter(e => e.oculta).length;
console.log('[menu] nav.config.ts COMPILADO → %d entradas (%d ocultas)', NAVMOD.NAV.length, ocultas);

// Contraste independiente: el conteo del modulo contra el texto del archivo.
const cfgTexto = fs.readFileSync('src/app/shared/sidebar/nav.config.ts', 'utf8');
const rutasEnTexto = (cfgTexto.match(/ruta: '/g) || []).length;
if (NAVMOD.NAV.length !== rutasEnTexto) {
  abortar('el modulo trae ' + NAVMOD.NAV.length + ' entradas y el texto tiene ' +
    rutasEnTexto + ' rutas. Algo no cuadra.');
}

/** Rutas visibles para este usuario, usando el menuDe() real de la app. */
function rutasNuevas(u) {
  return NAVMOD.menuDe(u).flatMap(g => g.entradas.map(e => e.ruta)).sort();
}

// ── FUSIONES DECLARADAS ───────────────────────────────────────────────────
//
// Cuando cuatro pantallas se vuelven una con pestañas, sus rutas DESAPARECEN del
// menu a proposito. Sin este mapa la prueba reportaria
// "PIERDE: /estadisticas /productividad /ranking-sucursales" y fallaria por
// diseño — y una prueba que falla por diseño es una prueba que alguien silencia
// en tres semanas.
//
// PERO NO BASTA TOLERAR LA AUSENCIA. Eso convertiria el mapa en una lista de
// excepciones, que es como se apagan los controles. Para cada fusion declarada
// se verifica que el DESTINO exista en el NAV y sea VISIBLE PARA EL MISMO PERFIL
// que veia el origen. Asi la fusion deja de ser una perdida perdonada y se
// vuelve una verificacion mas fuerte: nadie perdio acceso, solo cambio de puerta.
//
// Hoy esta vacio, asi que la prueba mide exactamente lo mismo que antes.
const FUNDIDAS = {
  '/estadisticas': '/control',   // paso 2a
  // '/ranking-sucursales': '/control',
  // '/productividad':      '/control',
  // '/checkstore':         '/control',
  // '/reportes':           '/control',
};

/**
 * Revisa las rutas que faltan en el menu nuevo para UN perfil.
 * Devuelve { verificadas, problemas } — no aborta, para que el autodiagnostico
 * de mas abajo pueda ejercitarla sin matar el proceso.
 */
function revisarFusiones(perfil, faltantes, rutasVisibles, mapa, rutasDelNav) {
  const verificadas = [];
  const problemas = [];
  for (const origen of faltantes) {
    if (!(origen in mapa)) {
      problemas.push({ origen, motivo: 'no esta declarada como fusion: es una perdida real' });
      continue;
    }
    const destino = mapa[origen];
    if (!destino) { verificadas.push(origen + ' → (retirada a proposito)'); continue; }
    if (!rutasDelNav.has(destino)) {
      problemas.push({ origen, motivo: 'su destino ' + destino + ' NO EXISTE en el NAV' });
      continue;
    }
    if (!rutasVisibles.includes(destino)) {
      problemas.push({ origen,
        motivo: 'su destino ' + destino + ' existe pero NO es visible para "' + perfil + '"' });
      continue;
    }
    verificadas.push(origen + ' → ' + destino);
  }
  return { verificadas, problemas };
}

// ── Los cuatro usuarios sintéticos ────────────────────────────────────────
const USUARIOS = [
  { nombre: 'admin global', u: { rol: 'admin' } },
  { nombre: 'admin de sucursales', u: { rol: 'admin', alcance: 'sucursales' } },
  { nombre: 'supervisora con banderas', u: {
      rol: 'trabajador', puedeVerCheckstore: true, puedeVerEstadisticas: true,
      puedeVerHistorial: true, puedeAdministrarPersonal: true } },
  { nombre: 'operadora sin banderas', u: { rol: 'trabajador' } },

  // ── UNA BANDERA DE PROMOS A LA VEZ ────────────────────────────────────
  //
  // Los cuatro de arriba cubren lo estructural pero NO TIENEN NINGUNA bandera de
  // promos, asi que los dos lados devolvian false para /promociones y
  // /venta-promos: el verde pasaba SIN EJERCER esos predicados. Es el mismo
  // fallo del control que pasa por el camino equivocado, aqui por omision.
  //
  // Y son justo los dos que mas se pueden desviar: no eran banderas simples sino
  // getters con TRES permisos cada uno, y basta cualquiera. Un `&&` donde iba un
  // `||` deja fuera a dos tercios de la gente de promociones sin que nadie lo
  // note hasta que alguien reclame que le desaparecio el menu.
  //
  // Seis perfiles, uno por permiso, para que cada rama se pruebe sola.
  { nombre: 'promos · solo formato',    u: { rol: 'trabajador', promocionesFormato: true } },
  { nombre: 'promos · solo expediente', u: { rol: 'trabajador', promocionesExpediente: true } },
  { nombre: 'promos · solo grupo',      u: { rol: 'trabajador', grupoPromociones: true } },
  { nombre: 'venta · solo caja',        u: { rol: 'trabajador', ventaPromosCaja: true } },
  { nombre: 'venta · solo vendedor',    u: { rol: 'trabajador', ventaPromosVendedor: true } },
  { nombre: 'venta · solo monitor',     u: { rol: 'trabajador', ventaPromosMonitor: true } },
];

// ── La comparación ────────────────────────────────────────────────────────
const rutasDelNav = new Set(NAVMOD.NAV.filter(e => !e.oculta).map(e => e.ruta));
let difs = 0;
for (const { nombre, u } of USUARIOS) {
  const antes = [...viejas.keys()].filter(r => r !== '/perfil' && veViejo(r, u)).sort();
  const ahora = rutasNuevas(u);

  const perdio = antes.filter(r => !ahora.includes(r));
  const gano = ahora.filter(r => !antes.includes(r));

  console.log('');
  console.log('── %s ──', nombre);
  console.log('   antes: %d entradas · ahora: %d', antes.length, ahora.length);

  const mapa = FUNDIDAS;
  const { verificadas, problemas } = revisarFusiones(nombre, perdio, ahora, mapa, rutasDelNav);
  for (const v of verificadas) console.log('   ✓ fusión verificada: %s', v);
  for (const p of problemas) {
    difs++;
    console.log('   ✗ %s · %s', p.origen, p.motivo);
  }
  // ── ¿UNA RUTA GANADA ES ESCALADA? ──────────────────────────────────────
  //
  // Aqui aparece, gratis, la comprobacion que faltaba. El destino de una fusion
  // ES una ruta nueva, asi que sin esto la prueba lo reporta como "GANA" y falla
  // por diseño. Pero perdonarlo a secas seria peor: dejaria pasar el riesgo real
  // de fundir pantallas con permisos distintos.
  //
  // La regla: el destino es legitimo para un perfil SOLO si ese perfil tenia al
  // menos UNO de los origenes que apuntan a el. Si lo gana sin tener ninguno, es
  // ESCALADA — alguien se lleva una pantalla que nunca le tocaba, regalada por
  // una reorganizacion de menu.
  const ganoLimpio = [], escalada = [];
  for (const r of gano) {
    const origenes = Object.keys(mapa).filter(o => mapa[o] === r);
    if (origenes.length === 0) { escalada.push({ ruta: r, motivo: 'no es destino de ninguna fusion declarada' }); continue; }
    const tenia = origenes.filter(o => antes.includes(o));
    if (tenia.length === 0) {
      escalada.push({ ruta: r,
        motivo: 'ESCALADA: es destino de [' + origenes.join(', ') + '] y este perfil no tenia ninguna' });
      continue;
    }
    ganoLimpio.push(r + ' ← ' + tenia.join(', '));
  }
  for (const g of ganoLimpio) console.log('   ✓ destino legítimo: %s', g);
  for (const e of escalada) { difs++; console.log('   ✗ %s · %s', e.ruta, e.motivo); }
  if (!problemas.length && !escalada.length && !verificadas.length && !ganoLimpio.length) {
    console.log('   ✓ misma audiencia');
  } else if (!problemas.length && !escalada.length) {
    console.log('   ✓ sin pérdidas ni escaladas');
  }
  if (ahora.length > 7) {
    console.log('   ⚠ ve %d entradas · el objetivo del documento 4 son 7 (falta el paso 4.1b)', ahora.length);
  }
}

// ── AUTODIAGNÓSTICO DEL MECANISMO DE FUSIONES ────────────────────────────
//
// Con FUNDIDAS vacío, `revisarFusiones` no se ejerce en ninguna corrida — y un
// mecanismo que nunca corre puede estar roto desde el día que se escribió. Así
// que se le pasan tres casos armados a mano y se exige el veredicto correcto de
// cada uno. Es el control NEGATIVO del paso 0: prueba que la función distingue,
// no solo que existe.
{
  const nav = new Set(['/control', '/mis-tareas']);

  const casos = [
    { nombre: 'destino visible → verifica',
      perfil: 'operadora', faltantes: ['/estadisticas'], visibles: ['/control'],
      mapa: { '/estadisticas': '/control' }, esperaProblema: false },

    { nombre: 'destino INVISIBLE para el perfil → problema',
      perfil: 'operadora', faltantes: ['/estadisticas'], visibles: ['/mis-tareas'],
      mapa: { '/estadisticas': '/control' }, esperaProblema: true },

    { nombre: 'destino que NO existe en el NAV → problema',
      perfil: 'operadora', faltantes: ['/estadisticas'], visibles: [],
      mapa: { '/estadisticas': '/inventada' }, esperaProblema: true },

    { nombre: 'ausencia NO declarada → problema',
      perfil: 'operadora', faltantes: ['/estadisticas'], visibles: ['/control'],
      mapa: {}, esperaProblema: true },
  ];

  for (const c of casos) {
    const r = revisarFusiones(c.perfil, c.faltantes, c.visibles, c.mapa, nav);
    const hubo = r.problemas.length > 0;
    if (hubo !== c.esperaProblema) {
      abortar('el AUTODIAGNÓSTICO del mecanismo de fusiones falló en el caso "' + c.nombre +
        '": se esperaba ' + (c.esperaProblema ? 'un problema' : 'ningún problema') +
        ' y hubo ' + (hubo ? r.problemas.map(p => p.motivo).join('; ') : 'ninguno') +
        '. Con FUNDIDAS vacío este mecanismo no se ejerce solo, así que sin este ' +
        'autodiagnóstico podría estar roto sin que nada lo dijera.');
    }
  }
  console.log('');
  console.log('✓ mecanismo de fusiones: los %d casos del autodiagnóstico dan el veredicto correcto',
    casos.length);
  console.log('  (destino visible · destino invisible para el perfil · destino inexistente · ausencia sin declarar)');
}

// ── ¿SE EJERCIERON LAS RUTAS DE PROMOS? ──────────────────────────────────
// Sin esto, agregar los perfiles no garantiza nada: si manana alguien les quita
// las banderas, el verde vuelve a pasar por omision y nadie se entera.
const ejercidas = new Set();
for (const { u } of USUARIOS) for (const r of rutasNuevas(u)) ejercidas.add(r);
for (const r of ['/promociones', '/venta-promos']) {
  if (!ejercidas.has(r)) {
    abortar('ningun perfil de prueba llego a ver ' + r + ', asi que su predicado NO se ejercio. ' +
      'Un verde que pasa porque los dos lados estan apagados no prueba nada.');
  }
}
console.log('');
console.log('✓ rutas de promos ejercidas por al menos un perfil: /promociones, /venta-promos');

console.log('');
if (difs > 0) {
  abortar(difs + ' diferencia(s) de audiencia entre el menú viejo y el nuevo. ' +
    'El paso 4.1 NO debe cambiar quien ve que: si una es intencional, se documenta y se ajusta esta prueba.');
}
console.log('✓ Los %d perfiles ven exactamente las mismas rutas que antes.', USUARIOS.length);
console.log('  (%d rutas viejas leídas de git · %d entradas nuevas del módulo COMPILADO.)',
  viejas.size, NAVMOD.NAV.length);
