// ============================================================================
//  PASO 0.2 · ¿CUÁNTOS CHECKLISTS EXISTEN SOLO EN FIRESTORE?
//
//  ─── QUÉ MIDE, Y POR QUÉ NO ES "LA DIFERENCIA ENTRE LAS DOS BASES" ────────
//  La app ESCRIBE a Firestore y luego a Postgres (dual-write, best-effort), pero
//  LEE solo de Postgres. Entonces la divergencia peligrosa es direccional:
//
//    · Documento en Firestore que NO está en Postgres  →  la app no lo muestra.
//      El trabajo se hizo, quedó guardado, y desapareció de la vista. ESTE es el
//      numero que dice que tan caro sale cerrar el ferrocarril (Fase 1).
//
//    · Fila en Postgres que ya no esta en Firestore  →  ESPERADO, no es falla.
//      `scripts/corte.js` borraba cada mes TODO `enviado == true`, sin filtro de
//      fecha. Firestore nunca conservo el historico de enviados; Postgres si.
//      Comparar totales a secas produce un numero enorme y sin significado.
//
//  ─── LAS DOS TRAMPAS QUE ESTE SCRIPT EVITA A PROPOSITO ────────────────────
//  1. EL NOMBRE DEL CAMPO. En Firestore la fecha se llama `date`; en Postgres se
//     renombro a `fecha` (ver `scripts/migrar-checklists.js`: `date: 'fecha'`).
//     Un `where('fecha', ...)` contra Firestore devuelve CERO documentos sin dar
//     ningun error. Por eso aqui se verifica que el doc de muestra traiga `date`
//     antes de consultar cualquier cosa.
//
//  2. EL CERO QUE NO MIDIO NADA. Un conteo en cero se ve identico a "no hay
//     divergencia" y a "no pude leer". Por eso el script imprime el tamaño de
//     TODAS sus entradas antes de concluir, y ABORTA con codigo 2 si alguna
//     viene vacia. Un cero solo vale si viene acompañado de la cifra de la que
//     salio.
//
//  ─── CREDENCIALES: POR VARIABLE DE ENTORNO, NUNCA POR ARCHIVO DEL REPO ────
//  Requiere dos variables. El script no las imprime, no las guarda y no las
//  deriva de ninguna ruta dentro del repositorio:
//
//    FIREBASE_SERVICE_ACCOUNT  el JSON del service account, como texto
//                              (la misma variable que ya usa Railway), o bien
//    GOOGLE_APPLICATION_CREDENTIALS  ruta al json, si prefieres tenerlo fuera
//
//    DATABASE_URL              OJO: desde tu maquina tiene que ser la URL
//                              PUBLICA de Railway. El host *.railway.internal
//                              solo resuelve dentro de Railway. `api/db.js` ya
//                              activa SSL solo, segun el host.
//
//  PowerShell:
//    $env:DATABASE_URL="postgresql://..."
//    $env:FIREBASE_SERVICE_ACCOUNT=(Get-Content ruta\al\service-account.json -Raw)
//    node scripts/diagnostico-divergencia.js
//
//  ─── COSTO DE CUOTA ───────────────────────────────────────────────────────
//  El conteo agregado (`count()`) cuesta ~1 lectura por cada 1000 entradas de
//  indice. La lista de ids cuesta 1 lectura por documento, aunque se pidan solo
//  tres campos. Por eso el conteo va PRIMERO y se imprime: si sale muy grande,
//  cancela con Ctrl-C antes de que empiece la lista y decidimos otra estrategia.
//
//  ─── VIDA UTIL ────────────────────────────────────────────────────────────
//  Este script lee Firestore. Se retira en el paso 1.7, junto con el resto de la
//  dependencia a Firestore. No lo dejes vivo despues de eso.
// ============================================================================
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('../api/db');

const LOTE_PG = 500;   // ids por consulta a Postgres
const LOTE_MAX_AVISO = 50000; // arriba de esto, avisa antes de gastar cuota

/** Credencial de Firebase, de variable de entorno. Nunca se imprime. */
function credencialFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim()) return JSON.parse(raw);
  const ruta = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (ruta && ruta.trim()) return require(require('path').resolve(ruta));
  throw new Error(
    'Falta la credencial. Define FIREBASE_SERVICE_ACCOUNT (el JSON como texto) ' +
    'o GOOGLE_APPLICATION_CREDENTIALS (ruta al archivo).'
  );
}

function abortar(motivo) {
  console.error('');
  console.error('[div] ABORTA: ' + motivo);
  console.error('[div] NO concluyas nada de esta corrida. Un cero sin su cifra de entrada no es un resultado.');
  process.exit(2);
}

/** Conteo agregado; si la version del SDK no lo soporta, cae a contar la lista. */
async function contarFirestore(col) {
  try {
    const r = await col.count().get();
    return { n: r.data().count, via: 'count() agregado' };
  } catch (_) {
    const s = await col.select().get();
    return { n: s.size, via: 'select() completo (el SDK no soporta count agregado)' };
  }
}

async function main() {
  // ---------- 1. Entradas y prueba de vida ---------------------------------
  if (!dbConfigurada()) {
    abortar('falta DATABASE_URL. Desde tu maquina usa la URL PUBLICA de Railway (railway.internal no resuelve fuera).');
  }
  admin.initializeApp({ credential: admin.credential.cert(credencialFirebase()) });
  const fs = admin.firestore();
  const col = fs.collection('checklists');

  const { n: totalFS, via } = await contarFirestore(col);
  console.log('[div] Firestore/checklists  → %d documentos (%s)', totalFS, via);
  if (totalFS === 0) {
    abortar('cero documentos en Firestore. O no hay permiso de lectura, o la coleccion esta vacia. Son cosas distintas y este script no puede distinguirlas.');
  }

  const muestra = await col.limit(1).get();
  if (muestra.empty) abortar('el conteo dio ' + totalFS + ' pero la muestra vino vacia. Algo no cuadra.');
  const campos = Object.keys(muestra.docs[0].data());
  console.log('[div] campos del doc de muestra → %s', campos.join(', '));
  if (!campos.includes('date')) {
    abortar("el documento no trae el campo 'date'. En Firestore la fecha es 'date'; en Postgres es 'fecha'. Si el esquema cambio, ajusta este script ANTES de medir.");
  }

  const rPg = await query('select count(*)::bigint as c from mdtask_checklists');
  const totalPG = Number(rPg.rows[0].c);
  console.log('[div] Postgres/mdtask_checklists → %d filas', totalPG);
  if (totalPG === 0) {
    abortar('cero filas en Postgres. Revisa que DATABASE_URL apunte a la base correcta.');
  }

  if (totalFS > LOTE_MAX_AVISO) {
    console.log('');
    console.log('[div] AVISO: son %d documentos y la lista de ids cuesta 1 lectura por documento.', totalFS);
    console.log('[div] Tienes 10 segundos para cancelar con Ctrl-C si prefieres otra estrategia.');
    await new Promise(r => setTimeout(r, 10000));
  }

  // ---------- 2. Ids de Firestore (solo 3 campos) --------------------------
  console.log('');
  console.log('[div] leyendo ids de Firestore...');
  const docsFS = [];
  const snap = await col.select('date', 'store', 'enviado').get();
  snap.forEach(d => docsFS.push({
    id: d.id,
    date: d.get('date') || '(sin fecha)',
    store: d.get('store') || '(sin sucursal)',
    enviado: d.get('enviado') === true,
  }));
  console.log('[div] ids leidos → %d (el conteo decia %d)', docsFS.length, totalFS);
  if (docsFS.length === 0) abortar('la lista de ids vino vacia despues de un conteo de ' + totalFS + '.');

  // ---------- 3. Cuales NO estan en Postgres ------------------------------
  const soloEnFirestore = [];
  let revisados = 0;
  for (let i = 0; i < docsFS.length; i += LOTE_PG) {
    const lote = docsFS.slice(i, i + LOTE_PG);
    const r = await query(
      'select id from mdtask_checklists where id = any($1::text[])',
      [lote.map(x => x.id)]
    );
    const existentes = new Set(r.rows.map(x => x.id));
    for (const x of lote) if (!existentes.has(x.id)) soloEnFirestore.push(x);
    revisados += lote.length;
    if (revisados % 2500 === 0) console.log('[div]   revisados %d / %d', revisados, docsFS.length);
  }
  console.log('[div] ids revisados contra Postgres → %d', revisados);
  if (revisados !== docsFS.length) {
    abortar('se revisaron ' + revisados + ' de ' + docsFS.length + ' ids. El recorrido no termino.');
  }

  // ---------- 4. Resultado ------------------------------------------------
  const enAmbas = docsFS.length - soloEnFirestore.length;
  console.log('');
  console.log('══════════════════ RESULTADO PASO 0.2 ══════════════════');
  console.log('Entradas medidas: %d docs en Firestore · %d filas en Postgres', docsFS.length, totalPG);
  console.log('');
  console.log('▸ SOLO EN FIRESTORE (la app NO los muestra): %d de %d  (%s%%)',
    soloEnFirestore.length, docsFS.length,
    ((soloEnFirestore.length / docsFS.length) * 100).toFixed(2));

  if (soloEnFirestore.length > 0) {
    const porFecha = new Map();
    const porSucursal = new Map();
    for (const x of soloEnFirestore) {
      porFecha.set(x.date, (porFecha.get(x.date) || 0) + 1);
      porSucursal.set(x.store, (porSucursal.get(x.store) || 0) + 1);
    }
    console.log('');
    console.log('  Por fecha:');
    [...porFecha.keys()].sort().forEach(f => console.log('    %s → %d', f, porFecha.get(f)));
    console.log('');
    console.log('  Por sucursal:');
    [...porSucursal.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([s, n]) => console.log('    %s → %d', s, n));
    const enviados = soloEnFirestore.filter(x => x.enviado).length;
    console.log('');
    console.log('  De esos, ya entregados por el colaborador: %d', enviados);
    console.log('  ↑ Son los mas graves: trabajo hecho y entregado que la app no muestra.');
  } else {
    console.log('  Ningun documento de Firestore falta en Postgres. El dual-write no ha perdido nada');
    console.log('  de lo que Firestore conserva hoy.');
  }

  console.log('');
  console.log('▸ En ambas: %d', enAmbas);
  console.log('▸ Filas en Postgres que Firestore ya no tiene: %d', totalPG - enAmbas);
  console.log('  ↑ ESPERADO, no es falla: corte.js borraba de Firestore todo `enviado == true`');
  console.log('    sin filtro de fecha. Es el historico acumulado de los cortes mensuales.');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
  console.log('Criterio del paso 0.2: si "solo en Firestore" es 0, la Fase 1 puede migrar directo.');
  console.log('Si es > 0, la Fase 1 empieza por conciliar esos ids ANTES de quitar el espejo.');

  // Lista completa de ids, solo si se pide una ruta FUERA del repo.
  const salida = process.env.SALIDA;
  if (salida && soloEnFirestore.length > 0) {
    const fsNode = require('fs');
    const filas = ['id,date,store,enviado']
      .concat(soloEnFirestore.map(x => `${x.id},${x.date},"${String(x.store).replace(/"/g, '""')}",${x.enviado}`));
    fsNode.writeFileSync(salida, filas.join('\n'), 'utf8');
    console.log('');
    console.log('Ids escritos en: %s', salida);
    console.log('Lleva id, fecha y sucursal — ningun nombre de persona. Aun asi, que viva FUERA del repo.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[div] ERROR:', e && e.message);
    console.error('[div] Una corrida con error no mide nada. No concluyas de aqui.');
    process.exit(1);
  });
