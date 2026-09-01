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

// Las pestañas de Control salen de SU definicion real, compilada junto al NAV.
// Reimplementar aqui "quien ve que pestaña" seria una tercera version de la
// logica — justo lo que se evito al compilar nav.config en vez de parsearlo.
let TABSDE = () => [];
{
  const tabsJs = buscar(tmp, 'control.tabs.js');
  if (tabsJs) {
    const M = require(tabsJs);
    if (typeof M.tabsVisibles === 'function') TABSDE = M.tabsVisibles;
    console.log('[menu] control.tabs.ts COMPILADO → %d pestañas', (M.TABS_CONTROL || []).length);
  } else {
    console.log('[menu] (sin control.tabs.js: aun no hay pestañas que verificar)');
  }
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
  // ⚠ EL DESTINO ES LA PESTAÑA, NO EL CASCARON, y la diferencia solo se nota
  // cuando hay mas de una pestaña — o sea, cuando ya seria tarde.
  //
  // Con UNA sola pestaña, "se ve /control" y "se ve la pestaña" son lo mismo, y
  // apuntar al cascaron funciona. Con dos dejan de serlo, y el control se
  // debilita EN SILENCIO: un usuario con solo `puedeVerEstadisticas` hoy ve
  // Estadisticas, Ranking y Productividad. Si el `ve` de Ranking se escribe
  // demasiado estrecho, ese usuario PIERDE Ranking — pero sigue viendo el
  // cascaron por la pestaña de Estadisticas, asi que un control que preguntara
  // "¿ve /control?" contestaria que si y pasaria en verde.
  //
  // Preguntando por la pestaña, la perdida sale a la luz.
  '/estadisticas':       '/control/estadisticas',   // paso 2a
  '/ranking-sucursales': '/control/ranking',        // paso 2b
  '/productividad':      '/control/productividad',  // paso 2c
  '/checkstore':         '/control/sucursales',     // paso 2d
  // '/checkstore':         '/control',
  // '/reportes':           '/control',
};

/**
 * Revisa las rutas que faltan en el menu nuevo para UN perfil.
 * Devuelve { verificadas, problemas } — no aborta, para que el autodiagnostico
 * de mas abajo pueda ejercitarla sin matar el proceso.
 */
function revisarFusiones(perfil, faltantes, rutasVisibles, mapa, rutasDelNav, tabsDe, perfilUsuario) {
  const verificadas = [];
  const problemas = [];
  for (const origen of faltantes) {
    if (!(origen in mapa)) {
      problemas.push({ origen, motivo: 'no esta declarada como fusion: es una perdida real' });
      continue;
    }
    const destino = mapa[origen];
    if (!destino) { verificadas.push(origen + ' → (retirada a proposito)'); continue; }
    // Un destino con pestaña -/control/xxx- se resuelve contra las pestañas que
    // ESTE usuario puede abrir, no contra la visibilidad del cascaron.
    const m = /^(\/[^/]+)\/(.+)$/.exec(destino);
    if (m) {
      const [, padre, tab] = m;
      if (!rutasDelNav.has(padre)) {
        problemas.push({ origen, motivo: 'su destino ' + destino + ': el cascaron ' + padre + ' NO EXISTE en el NAV' });
        continue;
      }
      if (!tabsDe(perfilUsuario).some(t => t.ruta === tab)) {
        problemas.push({ origen,
          motivo: 'su destino ' + destino + ': la PESTAÑA no es visible para "' + perfil +
                  '" (el cascaron si, pero eso no basta)' });
        continue;
      }
      verificadas.push(origen + ' → ' + destino);
      continue;
    }
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

  // ── LOS DOS SUBCONJUNTOS: SIN ELLOS EL CHEQUEO DE PESTAÑAS NO COMPARA NADA ─
  //
  // Los cuatro de arriba ven las CUATRO pestañas (admin, o las dos banderas) o
  // NINGUNA. Con solo esos, el control por pestaña recorreria conjuntos
  // completos o vacios y nunca enfrentaria el `ve` de una pestaña contra el de
  // la de al lado: pasaria en verde sin ejercer la discriminacion, que es el
  // control que pasa por el camino equivocado.
  //
  // Estos dos ven TRES de cuatro, y NO LA MISMA TRES:
  //   solo checkstore    -> ranking, productividad, sucursales   (sin Estadisticas)
  //   solo estadisticas  -> estadisticas, ranking, productividad (sin Sucursales)
  // Entre los dos, cada pestaña queda excluida de al menos un perfil.
  { nombre: 'solo puedeVerCheckstore',   u: { rol: 'trabajador', puedeVerCheckstore: true } },
  { nombre: 'solo puedeVerEstadisticas', u: { rol: 'trabajador', puedeVerEstadisticas: true } },

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

// Cuantas pestañas revisó el control de escalada, y si ALGUN perfil ejerció un
// subconjunto estricto. Se afirman al final: un contador en cero significa que
// el chequeo no comparó nada, no que todo esté bien.
let tabsRevisadas = 0;
const perfilesConSubconjunto = [];

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
  const { verificadas, problemas } = revisarFusiones(nombre, perdio, ahora, mapa, rutasDelNav, TABSDE, u);
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
    const origenes = Object.keys(mapa).filter(o => (mapa[o] || '').split('/')[1] === r.split('/')[1]);
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

  // ── ¿UNA PESTAÑA VISIBLE ES ESCALADA? ──────────────────────────────────
  //
  // El control de arriba mira RUTAS DEL MENU, y desde 2b las cuatro fusiones
  // aterrizan en la MISMA: /control. Ahi las pestañas son indistinguibles — el
  // perfil "gana /control" una sola vez, y basta haber tenido UNA de las cuatro
  // pantallas para que pase. Las otras tres viajan de polizon.
  //
  // Ese es exactamente el agujero que describe control.tabs.ts: quien solo tenia
  // Sucursales entra al cascaron con derecho propio, y si el `ve` de Estadisticas
  // se escribiera de mas se llevaria una pantalla que nunca tuvo. La ruta del
  // menu no cambia, asi que arriba no se ve nada.
  //
  // Aqui se pregunta por PESTAÑA: cada una tiene que ser RECLAMABLE por una
  // pantalla que este perfil ya veia antes del cambio.
  const misTabs = TABSDE(u);
  tabsRevisadas += misTabs.length;
  if (misTabs.length > 0 && misTabs.length < TABSDE({ rol: 'admin' }).length) {
    perfilesConSubconjunto.push(nombre + ' (' + misTabs.map(t => t.ruta).join(', ') + ')');
  }
  for (const t of misTabs) {
    const destino = '/control/' + t.ruta;
    const origenes = Object.keys(mapa).filter(o => mapa[o] === destino);
    if (origenes.length === 0) {
      difs++;
      console.log('   ✗ pestaña %s · no es destino de ninguna fusión declarada', t.ruta);
      continue;
    }
    const tenia = origenes.filter(o => antes.includes(o));
    if (tenia.length === 0) {
      difs++;
      console.log('   ✗ pestaña %s · ESCALADA: viene de [%s] y este perfil no veía ninguna',
                  t.ruta, origenes.join(', '));
    }
  }
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

// ── ¿SE EJERCIO EL CHEQUEO POR PESTAÑA, Y COMPARO ALGO? ──────────────────
// Dos afirmaciones distintas, y hacen falta las dos:
//   · que el recorrido no haya sido vacio (si no, un cero no dice nada);
//   · que algun perfil vea un SUBCONJUNTO ESTRICTO, que es la unica forma de
//     que el `ve` de una pestaña se enfrente al de la de al lado. Con perfiles
//     que ven las cuatro o ninguna, el chequeo recorre y no compara.
if (tabsRevisadas === 0) {
  abortar('el control por pestaña no reviso ni una sola pestaña. O ningun perfil ve el ' +
    'cascaron, o tabsVisibles no se compilo. Un cero aqui no es "sin escaladas": es "sin medir".');
}
if (perfilesConSubconjunto.length === 0) {
  abortar('ningun perfil de prueba ve un SUBCONJUNTO ESTRICTO de las pestañas: todos ven ' +
    'todas o ninguna. El chequeo por pestaña paso sin comparar un solo `ve` contra el de al ' +
    'lado — es el control que pasa por el camino equivocado. Agrega un perfil con una sola ' +
    'bandera de las que distinguen (hoy: puedeVerCheckstore vs puedeVerEstadisticas).');
}
console.log('✓ escalada por pestaña: %d pestañas revisadas · %d perfil(es) con subconjunto estricto',
  tabsRevisadas, perfilesConSubconjunto.length);
for (const x of perfilesConSubconjunto) console.log('    %s', x);

console.log('');
if (difs > 0) {
  abortar(difs + ' diferencia(s) de audiencia entre el menú viejo y el nuevo. ' +
    'El paso 4.1 NO debe cambiar quien ve que: si una es intencional, se documenta y se ajusta esta prueba.');
}
console.log('✓ Los %d perfiles ven exactamente las mismas rutas que antes.', USUARIOS.length);
console.log('  (%d rutas viejas leídas de git · %d entradas nuevas del módulo COMPILADO.)',
  viejas.size, NAVMOD.NAV.length);
