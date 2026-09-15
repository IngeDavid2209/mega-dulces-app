// ============================================================================
//  QUITA LAS ENTREGAS REPETIDAS POR AREA DE LA FICHA
//
//  ─── QUE PASO ─────────────────────────────────────────────────────────────
//  Hasta el 15/sep de madrugada, el emisor entregaba el manual UNA VEZ POR CADA
//  entrada de `sucursales[]` de la ficha. Una Encargada con «8 Esquinas»,
//  «MANTENIMIENTO» y «SISTEMAS» recibia sus 3 tareas TRES veces: 9. El dano no
//  es visual — su denominador se triplica, asi que alguien que cumplio todo
//  aparece al 33%.
//
//  El arreglo (`lugaresDeEmision`) ya esta desplegado, pero solo evita las
//  NUEVAS. Las de hoy nacieron a las 00:01, antes del arreglo. Esto limpia esas.
//
//  ─── LO QUE ESTE SCRIPT NO HACE, Y ES LO QUE LO HACE SEGURO ───────────────
//
//  1. NO BORRA FISICAMENTE. Marca `eliminado = true`, que es el soft-delete que
//     la app ya usa, y deja en `datos` un rastro con el motivo, el autor, la
//     fecha y EL ID QUE SE CONSERVA. Corregir es un evento nuevo que apunta al
//     anterior (§5.5), no un `delete`.
//
//  2. NO TOCA NADA QUE ALGUIEN HAYA TRABAJADO. Ni enviado, ni archivado, ni con
//     una sola foto, ni un solo palomeo, ni una nota. Es la guarda que importa:
//     el resto del script puede equivocarse y lo peor que pasa es que sobre una
//     tarjeta; si esta falla, se destruye trabajo de una persona. Se comprueba
//     ANTES de decidir nada.
//
//  3. NO ADIVINA CUAL SOBRA. La decision la toma `lugaresDeEmision`, LA MISMA
//     funcion compilada que usa el emisor. Si aqui se escribiera un criterio
//     propio —«las de MANTENIMIENTO y SISTEMAS»— seria una segunda definicion,
//     libre de discrepar de la que emite (§8.11 d), y ademas se quedaria vieja
//     el dia que cambie la lista de sitios con cuadrilla.
//
//  4. NO TOCA EL PASADO por omision. Solo de hoy en adelante. Un checklist de
//     ayer ya conto en los numeros de ayer, y reescribir eso es rehacer la
//     historia. Con `--desde=YYYY-MM-DD` se amplia, a proposito y a mano.
//
//  5. NO ESCRIBE SIN QUE SE LO PIDAN. Por omision imprime el plan y no toca la
//     base. Hay que pasarle `--aplicar`.
//
//  ─── LA REVERSA, ESCRITA ANTES QUE LA IDA (§8.3) ──────────────────────────
//      node scripts/quitar-entregas-repetidas.js --revertir
//  Devuelve a `eliminado = false` EXACTAMENTE las que marco este script —las
//  reconoce por su rastro, no por su forma— y no toca ninguna otra.
//
//  ─── COMO SE CORRE ────────────────────────────────────────────────────────
//      $env:DATABASE_URL = "<URL PUBLICA de Postgres de Railway>"
//      node scripts/quitar-entregas-repetidas.js                  (solo mira)
//      node scripts/quitar-entregas-repetidas.js --aplicar        (marca)
//      node scripts/quitar-entregas-repetidas.js --revertir       (deshace)
// ============================================================================
const path = require('path');
const { query, dbConfigurada } = require('../api/db');

const RAIZ = path.resolve(__dirname, '..');
const RUTA_REGLA = path.join(RAIZ, 'dist/manual/emision-manual.util.js');
const MARCA = '_repetidaPorArea';   // el rastro que permite revertir

const APLICAR = process.argv.includes('--aplicar');
const REVERTIR = process.argv.includes('--revertir');
const argDesde = (process.argv.find(a => a.startsWith('--desde=')) || '').split('=')[1];

function abortar(msg, detalle) {
  console.error('\n[repetidas] ABORTA: ' + msg);
  if (detalle) console.error(detalle);
  console.error('[repetidas] No se escribio nada.');
  process.exit(1);
}

const izq = (s, n) => String(s == null ? '' : s).padEnd(n).slice(0, n);

function ymd(d) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().split('T')[0];
}

/**
 * ¿Este checklist lo toco alguien?
 *
 * Deliberadamente AMPLIO: cualquier senal cuenta. El error se comete hacia el
 * lado de NO borrar, porque las consecuencias no son simetricas — dejar una
 * tarjeta de mas es una molestia, borrar el turno de alguien no se deshace con
 * una disculpa. Incluye el palomeo aunque no tenga foto: que la regla de
 * cumplimiento no lo cuente (Fase 2.1) no significa que la persona no lo haya
 * hecho, y aqui la pregunta es «¿trabajo en esto?», no «¿cumplio?».
 */
function fueTrabajado(c) {
  if (c.enviado || c.archivado) return true;
  if (String(c.status || '') === 'completo') return true;
  const d = c.datos || {};
  if (String(d.notaEmpleado || '').trim()) return true;
  if (d.entregaConRetraso) return true;
  const items = Array.isArray(d.items) ? d.items : [];
  for (const it of items) {
    if (!it) continue;
    if (it.checked === true) return true;
    if (it.photo || it.photoAntes || it.photoDespues) return true;
    if (Array.isArray(it.photos) && it.photos.length) return true;
    if (String(it.comentario || '').trim()) return true;
    if (it.monto != null && it.monto !== '') return true;
    if (String(it.folio || '').trim()) return true;
  }
  return false;
}

/** Las sucursales de una ficha, como las ve la app. */
function sucursalesDeFicha(f) {
  const d = f.datos || {};
  const lista = (Array.isArray(d.sucursales) && d.sucursales.length)
    ? d.sucursales
    : (d.sucursal ? [d.sucursal] : []);
  return [...new Set(lista.map(s => String(s || '').trim()).filter(Boolean))];
}

async function revertir() {
  const filas = (await query(
    `select id, assigned, store, fecha, datos
       from mdtask_checklists
      where coalesce(eliminado,false) = true
        and datos ? $1`, [MARCA]
  )).rows;

  console.log('\n=== REVERSA ===');
  console.log('  marcadas por este script y hoy eliminadas: %d', filas.length);
  if (!filas.length) {
    console.log('  Nada que revertir.');
    return;
  }
  for (const f of filas.slice(0, 20)) {
    console.log('  %s %s %s', izq(f.fecha, 12), izq(f.assigned, 26), f.store);
  }
  if (!APLICAR) {
    console.log('\n  Esto es un ENSAYO. Para aplicarlo de verdad:');
    console.log('    node scripts/quitar-entregas-repetidas.js --revertir --aplicar');
    return;
  }
  let n = 0;
  for (const f of filas) {
    const datos = { ...(f.datos || {}) };
    delete datos[MARCA];
    await query(
      'update mdtask_checklists set eliminado = false, datos = $2 where id = $1',
      [f.id, JSON.stringify(datos)]
    );
    n++;
  }
  console.log('\n  Revertidas: %d', n);
}

async function main() {
  if (!dbConfigurada()) {
    abortar('falta DATABASE_URL. Desde tu maquina usa la URL PUBLICA de Railway.');
  }
  if (REVERTIR) { await revertir(); return; }

  // La regla compilada: la MISMA que decide en el emisor.
  let regla;
  try {
    regla = require(RUTA_REGLA);
  } catch (e) {
    abortar('no encuentro la regla compilada en ' + RUTA_REGLA,
      '  Generala con:  node scripts/compilar-manual.js\n' +
      '  Sin ella habria que escribir aqui un criterio propio de «que sitio\n' +
      '  cuenta», y esa segunda definicion es justo lo que no puede existir.');
  }
  if (typeof regla.lugaresDeEmision !== 'function') {
    abortar('la regla compilada no exporta `lugaresDeEmision`. Recompila: el ' +
            'arreglo de las repetidas es de esa funcion, y sin ella este script ' +
            'no sabe cual conservar.');
  }

  const desde = argDesde || ymd(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) abortar('--desde espera YYYY-MM-DD');

  // ── Fichas ────────────────────────────────────────────────────────────────
  const fichas = (await query(
    `select id, nombre, activo, datos from mdtask_usuarios
      where coalesce(activo, true) = true`
  )).rows;
  console.log('\n=== TAMANO DE LA ENTRADA ===');
  console.log('  fichas activas leidas ........ %d', fichas.length);
  if (fichas.length === 0) {
    abortar('CERO fichas activas. La migracion 050 conto 150: esto es un fallo de ' +
            'lectura, no una empresa vacia.');
  }

  const cks = (await query(
    `select id, assigned, store, fecha, enviado, eliminado, archivado, status, datos
       from mdtask_checklists
      where fecha >= $1
        and coalesce(eliminado,false) = false
        and id like 'man\\_%'
      order by fecha, assigned`, [desde]
  )).rows;
  console.log('  checklists del manual vivos desde %s .. %d', desde, cks.length);
  if (cks.length === 0) {
    abortar('CERO entregas del manual vivas desde ' + desde + '. Con el emisor ' +
            'corriendo eso no es «no hay»: es «no lei» o la fecha esta mal.');
  }

  // Nombre normalizado -> sucursales de su ficha.
  const norm = (s) => String(s || '').trim().toLowerCase();
  const porNombre = new Map();
  for (const f of fichas) porNombre.set(norm(f.nombre), f);

  // ── Agrupar: misma persona, misma tarea, mismo dia ────────────────────────
  // La llave NO incluye el `store`, que es justo el eje por el que se
  // duplicaron. `_tareaManualId` lo sella el emisor en cada documento.
  const grupos = new Map();
  let sinTareaId = 0;
  for (const c of cks) {
    const tareaId = (c.datos || {})._tareaManualId;
    if (!tareaId) { sinTareaId++; continue; }
    const k = norm(c.assigned) + '||' + tareaId + '||' + c.fecha;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(c);
  }
  console.log('  grupos (persona x tarea x dia) ........ %d', grupos.size);
  if (sinTareaId) console.log('  sin `_tareaManualId`, no se tocan ..... %d', sinTareaId);

  // ── Decidir ───────────────────────────────────────────────────────────────
  const aQuitar = [];
  const conflictos = [];
  let gruposConRepetidas = 0;
  const porPersona = new Map();

  for (const [, lista] of grupos) {
    if (lista.length < 2) continue;         // no hay repeticion
    gruposConRepetidas++;

    const ficha = porNombre.get(norm(lista[0].assigned));
    // Sin ficha resoluble NO se decide: no se sabe cuales son sus lugares.
    if (!ficha) {
      conflictos.push({ lista, motivo: 'no encuentro su ficha activa por nombre' });
      continue;
    }
    const validos = new Set(regla.lugaresDeEmision(sucursalesDeFicha(ficha)));

    const conservar = lista.filter(c => validos.has(c.store));
    const sobran = lista.filter(c => !validos.has(c.store));

    // Si la regla no conserva ninguna, algo no cuadra: no se borra el grupo entero.
    if (conservar.length === 0) {
      conflictos.push({ lista, motivo: 'la regla no conserva ninguna de las ' + lista.length });
      continue;
    }
    // Si alguna de las que sobran YA SE TRABAJO, no se toca el grupo: hay que
    // mirarlo a mano. Borrar la trabajada perderia el trabajo; borrar la otra
    // dejaria a la persona con la tarjeta en un sitio que la regla no reconoce.
    const trabajadasQueSobran = sobran.filter(fueTrabajado);
    if (trabajadasQueSobran.length) {
      conflictos.push({
        lista,
        motivo: 'una copia que sobra YA SE TRABAJO (' +
          trabajadasQueSobran.map(c => c.store).join(', ') + ')',
      });
      continue;
    }

    for (const c of sobran) {
      aQuitar.push({ c, conserva: conservar[0].id, conservaStore: conservar[0].store });
      porPersona.set(c.assigned, (porPersona.get(c.assigned) || 0) + 1);
    }
  }

  // ── El plan ───────────────────────────────────────────────────────────────
  console.log('\n=== EL PLAN ===');
  console.log('  grupos con repeticion ................ %d', gruposConRepetidas);
  console.log('  entregas a marcar como eliminadas .... %d', aQuitar.length);
  console.log('  personas afectadas ................... %d', porPersona.size);
  console.log('  grupos que NO se tocan (conflicto) ... %d', conflictos.length);

  if (porPersona.size) {
    console.log('\n  Por persona (hasta 25):');
    const orden = [...porPersona.entries()].sort((a, b) => b[1] - a[1]);
    for (const [nombre, n] of orden.slice(0, 25)) {
      console.log('    %s %d copia(s) de mas', izq(nombre, 34), n);
    }
  }

  if (aQuitar.length) {
    console.log('\n  Muestra de lo que se marcaria (hasta 15):');
    console.log('    %s%s%s%s', izq('persona', 26), izq('se quita en', 18), izq('se conserva en', 18), 'fecha');
    for (const q of aQuitar.slice(0, 15)) {
      console.log('    %s%s%s%s', izq(q.c.assigned, 26), izq(q.c.store, 18),
        izq(q.conservaStore, 18), q.c.fecha);
    }
  }

  if (conflictos.length) {
    console.log('\n  ⚠ NO SE TOCAN, hay que mirarlos a mano (hasta 15):');
    for (const k of conflictos.slice(0, 15)) {
      console.log('    %s%s  [%s]', izq(k.lista[0].assigned, 26),
        izq(k.lista.map(c => c.store).join(' + '), 34), k.motivo);
    }
  }

  if (!APLICAR) {
    console.log('\n=== ESTO FUE UN ENSAYO: NO SE ESCRIBIO NADA ===');
    console.log('  Para aplicarlo:');
    console.log('    node scripts/quitar-entregas-repetidas.js --aplicar');
    console.log('  Y para deshacerlo despues:');
    console.log('    node scripts/quitar-entregas-repetidas.js --revertir --aplicar');
    return;
  }

  // ── Aplicar ───────────────────────────────────────────────────────────────
  // Una a una y con el rastro dentro. No hay `delete` en ninguna linea.
  let n = 0;
  const ahora = new Date().toISOString();
  for (const q of aQuitar) {
    const datos = { ...(q.c.datos || {}) };
    datos[MARCA] = {
      motivo: 'copia de mas: el manual se entregaba una vez por cada area de la ficha',
      conservada: q.conserva,
      conservadaEn: q.conservaStore,
      quitadaEn: q.c.store,
      por: 'scripts/quitar-entregas-repetidas.js',
      en: ahora,
    };
    await query(
      'update mdtask_checklists set eliminado = true, datos = $2 where id = $1',
      [q.c.id, JSON.stringify(datos)]
    );
    n++;
  }
  console.log('\n=== APLICADO ===');
  console.log('  marcadas como eliminadas: %d', n);
  console.log('  Ninguna se borro fisicamente. Para deshacerlo:');
  console.log('    node scripts/quitar-entregas-repetidas.js --revertir --aplicar');
}

main().catch(e => abortar('error no previsto: ' + ((e && e.stack) || e)));
