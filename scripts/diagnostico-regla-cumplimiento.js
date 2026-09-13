#!/usr/bin/env node
/**
 * 📏 FASE 2 · ¿CUÁNTO CUESTA HOY ARREGLAR `esItemHecho`?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA, Y POR QUÉ NO ES LA QUE YA SE CONTESTÓ
 * ═══════════════════════════════════════════════════════════════════════════
 * El CLAUDE.md dice que corregir la regla de cumplimiento «ahora es gratis»,
 * apoyado en la migración 045 del 31/ago: `por_justificacion = 1` punto en toda
 * la empresa.
 *
 * ESA MEDICIÓN CADUCÓ EL 3/SEP, y no por un error de quien la hizo: por un
 * cambio de la realidad. La regla es
 *
 *     esItemHecho(item, ck) = tieneEvidencia(item) || tieneJustificacionChecklist(ck)
 *
 * y `tieneEvidencia` cae a `item.checked === true` SOLO cuando el punto no pide
 * evidencia. El 31/ago casi ningún punto pedía —50 de 377—, así que un punto
 * palomeado se cerraba solo y la rama de la justificación casi nunca se usaba.
 * Desde el 3/sep los 377 traen `requiresVariasFotos`, así que un punto palomeado
 * SIN FOTO ya no tiene evidencia y cae en la justificación. Podían caer 50;
 * ahora pueden caer los 377.
 *
 * Por eso este script vuelve a medir antes de que nadie toque la regla. Lo que
 * devuelve es lo que la Fase 2.1 le va a QUITAR a los tableros:
 *
 *     puntos que hoy cuentan como hechos SIN evidencia, solo por la nota o
 *     por el retraso — partidos ANTES y DESPUÉS del 3/sep.
 *
 * Si el número sigue siendo despreciable, 2.1 es gratis y se hace. Si no lo es,
 * 2.1 mueve el cumplimiento de 186 personas y eso se habla antes, no después.
 *
 * ─── NO SE TRANSCRIBE LA REGLA ──────────────────────────────────────────────
 * Se compila `item-completado.util.ts` y se llama al `esItemHecho` REAL. Copiar
 * la condición aquí crearía una TERCERA versión (front, bot de WhatsApp, y
 * esta), y en este repo una copia que se queda atrás ya costó un día: el spec
 * del tablero midió su propia copia mientras la app usaba otra regla.
 *
 * ─── LO QUE VIGILA DE SÍ MISMO (§8.11) ──────────────────────────────────────
 * · Imprime el TAMAÑO de sus entradas antes de concluir y ABORTA si alguna
 *   viene vacía: «no pude leer» y «no hay nada» se ven idénticos.
 * · `--autoprueba` corre la clasificación sobre casos sintéticos de respuesta
 *   conocida, con control positivo Y negativo, y aborta si la muestra no
 *   discrimina. No necesita credenciales: sirve para probar el script ANTES de
 *   apuntarlo a producción.
 * · Solo LEE. No escribe una sola fila.
 *
 * ─── CÓMO SE CORRE ──────────────────────────────────────────────────────────
 *   node scripts/diagnostico-regla-cumplimiento.js --autoprueba
 *
 *   $env:DATABASE_URL="postgresql://..."     # la PÚBLICA de Railway
 *   node scripts/diagnostico-regla-cumplimiento.js
 *   node scripts/diagnostico-regla-cumplimiento.js --desde 2026-08-01
 *
 * Códigos: 0 midió · 1 no pudo medir · 2 la autoprueba falló.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');

/** El día en que los 377 puntos empezaron a pedir foto. Parte el reporte. */
const CORTE_EVIDENCIA = '2026-09-03';

/** Por omisión se mira un mes: suficiente para ver los dos lados del corte. */
const DIAS_POR_OMISION = 30;

function abortar(motivo) {
  console.error('');
  console.error('[regla] ABORTA: ' + motivo);
  console.error('[regla] No concluyas de esta corrida.');
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════════
//  LA REGLA REAL, compilada del TypeScript del proyecto
// ══════════════════════════════════════════════════════════════════════════
function cargarRegla() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtask-regla-'));
  const fuente = path.join(RAIZ, 'src', 'app', 'shared', 'item-completado.util.ts');
  if (!fs.existsSync(fuente)) abortar('no encuentro ' + fuente);

  try {
    execSync('npx tsc --outDir "' + tmp + '" --module commonjs --target ES2022 ' +
      '--skipLibCheck --moduleResolution node "' + fuente + '"',
      { cwd: RAIZ, stdio: 'pipe' });
  } catch (e) {
    abortar('tsc no compiló item-completado.util.ts:\n' +
      (e.stdout || e.stderr || e.message || '').toString().slice(0, 1200));
  }

  const emitido = path.join(tmp, 'item-completado.util.js');
  if (!fs.existsSync(emitido)) abortar('tsc no emitió item-completado.util.js en ' + tmp);

  const M = require(emitido);
  for (const f of ['esItemHecho', 'tieneEvidencia', 'tieneJustificacionChecklist']) {
    if (typeof M[f] !== 'function') {
      abortar('item-completado.util.ts ya no exporta ' + f + '(). La regla cambió de forma y ' +
        'este diagnóstico mediría otra cosa sin avisar.');
    }
  }
  return { M, tmp };
}

/**
 * La cubeta de UN punto. Son excluyentes y suman el total: si alguna vez dejan
 * de sumar, el reporte lo dice en vez de cuadrar solo.
 *
 *   con_evidencia     · se cierra por su prueba. La 2.1 no lo toca.
 *   por_justificacion · HOY cuenta como hecho y NO tiene prueba. Es lo que la
 *                       2.1 le quita a los tableros. ES EL NÚMERO.
 *   no_hecho          · no cuenta hoy ni contará.
 */
function cubetaDe(M, item, checklist) {
  if (M.tieneEvidencia(item)) return 'con_evidencia';
  if (M.esItemHecho(item, checklist)) return 'por_justificacion';
  return 'no_hecho';
}

/** ¿Este punto pide evidencia? Es lo que cambió el 3/sep. */
function pideEvidencia(item) {
  return !!(item && (item.requiresPhoto || item.requiresAntesDespues || item.requiresVariasFotos));
}

// ══════════════════════════════════════════════════════════════════════════
//  AUTOPRUEBA · sin credenciales, con los dos controles
// ══════════════════════════════════════════════════════════════════════════
function autoprueba(M) {
  console.log('AUTOPRUEBA de la clasificación (usa la regla REAL compilada)\n');

  const sinNota = { notaEmpleado: '', entregaConRetraso: false };
  const conNota = { notaEmpleado: 'se acabó el papel', entregaConRetraso: false };
  const conRetraso = { notaEmpleado: '', entregaConRetraso: true };

  const casos = [
    // [etiqueta, item, checklist, cubeta esperada, por qué]
    ['palomeado, no pedía nada, sin nota',
      { checked: true }, sinNota, 'con_evidencia',
      'el mundo ANTES del 3/sep: el palomeo ERA la evidencia'],
    ['pide fotos y las trae',
      { checked: true, requiresVariasFotos: true, photos: [{ url: 'a' }] }, sinNota, 'con_evidencia',
      'la prueba está'],
    ['PIDE FOTOS, no las trae, pero hay NOTA',
      { checked: true, requiresVariasFotos: true, photos: [] }, conNota, 'por_justificacion',
      'EL DEFECTO: una nota cierra un punto sin prueba'],
    ['PIDE FOTOS, no las trae, entrega con RETRASO',
      { checked: true, requiresVariasFotos: true, photos: [] }, conRetraso, 'por_justificacion',
      'el retraso tapa igual que la nota'],
    ['pide fotos, no las trae, sin nota ni retraso',
      { checked: true, requiresVariasFotos: true, photos: [] }, sinNota, 'no_hecho',
      'NEGATIVO: sin la justificación, el punto NO se cierra'],
    ['ni palomeado ni nada, sin nota',
      { checked: false }, sinNota, 'no_hecho',
      'NEGATIVO: el vacío no se cuenta'],
    ['ni palomeado, pero hay nota',
      { checked: false }, conNota, 'por_justificacion',
      'la nota tapa incluso lo que nadie tocó'],
    ['foto a medias ("subiendo...") con nota',
      { checked: true, requiresPhoto: true, photo: 'subiendo...' }, conNota, 'por_justificacion',
      'una subida a medias no es prueba'],
    ['antes/despues completo',
      { requiresAntesDespues: true, photoAntes: 'a', photoDespues: 'b' }, sinNota, 'con_evidencia',
      'las dos fotos están'],
    ['antes/despues a la mitad, sin nota',
      { requiresAntesDespues: true, photoAntes: 'a', photoDespues: null }, sinNota, 'no_hecho',
      'NEGATIVO: media prueba no es prueba'],
  ];

  let fallos = 0;
  const vistas = new Map();
  for (const [etiqueta, item, ck, esperada, porque] of casos) {
    const dada = cubetaDe(M, item, ck);
    vistas.set(dada, (vistas.get(dada) || 0) + 1);
    if (dada === esperada) {
      console.log('   ok    ' + etiqueta.padEnd(44) + ' → ' + dada.padEnd(18) + '  ' + porque);
    } else {
      console.log('   FALLA ' + etiqueta.padEnd(44) + ' → ' + dada + ', esperaba ' + esperada);
      fallos++;
    }
  }

  console.log('');
  console.log('   reparto de la muestra: ' +
    ['con_evidencia', 'por_justificacion', 'no_hecho']
      .map(c => c + '=' + (vistas.get(c) || 0)).join('  '));

  // GUARDIA DE DISCRIMINACIÓN (§8.11c). Una clasificación que mandara todo a una
  // sola cubeta pasaría cualquier prueba escrita como «encuentra el caso
  // conocido». Si las tres no se ejercen, esta corrida no prueba nada.
  for (const c of ['con_evidencia', 'por_justificacion', 'no_hecho']) {
    if (!vistas.get(c)) {
      // ── EL CASO QUE HAY QUE DISTINGUIR (§8.11e) ────────────────────────
      // Este diagnóstico está anclado a un defecto de HOY, y su trabajo es que
      // ese defecto desaparezca. El día que la Fase 2.1 entre, `esItemHecho`
      // dejará de caer en la justificación y la cubeta se vaciará — y eso NO es
      // «el script está roto», es «el script ya cumplió». Sin esta rama, el
      // aborto se leería como un fallo de medición y en tres semanas alguien lo
      // silenciaría por «siempre falla».
      const caeEnJustificacion = M.esItemHecho({ checked: false }, { notaEmpleado: 'x' }) === true;
      if (c === 'por_justificacion' && !caeEnJustificacion) {
        console.error('');
        console.error('[regla] CONTROL CADUCADO, y por la buena razón: `esItemHecho` YA NO cae');
        console.error('        en la justificación, así que la Fase 2.1 entró. Este diagnóstico');
        console.error('        mide el mundo anterior y hay que actualizarlo EN EL MISMO COMMIT');
        console.error('        que cerró la 2.1 (§8.11e). Los otros casos siguen siendo válidos.');
        process.exit(3);
      }
      console.error('\n[regla] ABORTA: ningún caso cayó en "' + c + '". La muestra no ' +
        'discrimina, así que un verde aquí no significa nada.');
      process.exit(1);
    }
  }

  if (fallos) {
    console.error('\n❌ ' + fallos + ' caso(s) fallaron: la clasificación no coincide con la regla real.');
    process.exit(2);
  }
  console.log('\n✅ autoprueba en verde, y las tres cubetas se ejercen.');
  console.log('   Ahora sí: corre sin --autoprueba y con DATABASE_URL para medir producción.');
}

// ══════════════════════════════════════════════════════════════════════════
//  LA MEDICIÓN CONTRA PRODUCCIÓN
// ══════════════════════════════════════════════════════════════════════════
/**
 * Lee las filas. Aparte de `agregar()` A PROPÓSITO: así la aritmética se puede
 * probar sin credenciales, en vez de estrenarse contra producción. Un
 * diagnóstico cuya agregación nunca corrió es un diagnóstico sin probar, y de
 * este sale un número que puede mover el cumplimiento de 186 personas.
 */
async function leerFilas(desde) {
  const { query, dbConfigurada } = require('../api/db');
  if (!dbConfigurada()) {
    abortar('falta DATABASE_URL. Desde tu máquina usa la URL PÚBLICA de Railway ' +
      '(railway.internal no resuelve fuera). Este script SOLO LEE.');
  }

  // `fecha` es text 'YYYY-MM-DD' (009_checklists.sql:12), no una fecha: se
  // compara como texto y el orden lexicográfico coincide con el cronológico.
  // Es el mismo campo que casi se lleva por delante a la 055 el 3/sep.
  const r = await query(`
    select id, fecha, store, assigned,
           coalesce(enviado,false)   as enviado,
           coalesce(archivado,false) as archivado,
           datos
      from mdtask_checklists
     where coalesce(eliminado,false) = false
       and fecha >= $1
     order by fecha`, [desde]);

  const filas = r.rows;
  console.log('[regla] checklists leídos desde %s → %d', desde, filas.length);
  if (filas.length === 0) {
    abortar('CERO checklists desde ' + desde + '. Con la app en producción eso no es ' +
      '«no hay»: es «no leí». Revisa la DATABASE_URL y el rango.');
  }
  return filas;
}

/** Toda la aritmética del reporte. Pura: filas entran, conteos salen. */
function agregar(M, filas) {
  const vacio = () => ({ con_evidencia: 0, por_justificacion: 0, no_hecho: 0, puntos: 0, checklists: 0 });
  const tot = { antes: vacio(), desde3sep: vacio() };
  const afectados = { checklists: new Set(), personas: new Set(), stores: new Map() };
  let sinItems = 0;
  let conBanderas = 0, sinBanderas = 0;

  // POR QUÉ PUERTA entra cada punto sin prueba. Son dos y tienen dueños
  // distintos en el modelo de causas: una nota la escribe quien ejecuta, el
  // retraso lo produce la entrega. Sumarlas escondería esa diferencia.
  const puerta = { solo_nota: 0, solo_retraso: 0, ambas: 0 };

  // CUMPLIMIENTO A NIVEL CHECKLIST, que es OTRO problema y no lo arregla la 2.1.
  // La herramienta `estadisticas` del bot (asistente-chat.js:2653) mide
  // `docs.filter(c => c.enviado === true)`, así que un checklist entregado con
  // puntos sin prueba —incluido el envío forzado— cuenta 100% en el número que
  // un Gerente le pide por WhatsApp.
  const enviados = { total: 0, con_puntos_sin_prueba: 0, puntos_sin_prueba: 0 };

  for (const f of filas) {
    const d = f.datos || {};
    const items = Array.isArray(d.items) ? d.items : [];
    if (!items.length) { sinItems++; continue; }

    // El checklist que juzga la regla: los campos que mira
    // `tieneJustificacionChecklist` viven en `datos`, no en columnas.
    const ck = { notaEmpleado: d.notaEmpleado, entregaConRetraso: d.entregaConRetraso };
    const lado = (f.fecha >= CORTE_EVIDENCIA) ? 'desde3sep' : 'antes';
    tot[lado].checklists++;

    const hayNota = ((d.notaEmpleado || '').toString().trim().length > 0);
    const hayRetraso = (d.entregaConRetraso === true);

    let sinPruebaAqui = 0;
    for (const it of items) {
      if (pideEvidencia(it)) conBanderas++; else sinBanderas++;
      const c = cubetaDe(M, it, ck);
      tot[lado][c]++;
      tot[lado].puntos++;
      if (!M.tieneEvidencia(it)) sinPruebaAqui++;
      if (c === 'por_justificacion') {
        afectados.checklists.add(f.id);
        if (f.assigned) afectados.personas.add(String(f.assigned).trim());
        const s = (f.store || '(sin lugar)').trim();
        afectados.stores.set(s, (afectados.stores.get(s) || 0) + 1);
        if (hayNota && hayRetraso) puerta.ambas++;
        else if (hayNota) puerta.solo_nota++;
        else if (hayRetraso) puerta.solo_retraso++;
      }
    }

    if (f.enviado === true) {
      enviados.total++;
      if (sinPruebaAqui > 0) {
        enviados.con_puntos_sin_prueba++;
        enviados.puntos_sin_prueba += sinPruebaAqui;
      }
    }
  }

  // ── GUARDIA: las cubetas tienen que sumar el total ──────────────────────
  for (const lado of ['antes', 'desde3sep']) {
    const t = tot[lado];
    const suma = t.con_evidencia + t.por_justificacion + t.no_hecho;
    if (suma !== t.puntos) {
      abortar('las cubetas de "' + lado + '" no suman: ' + suma + ' contra ' + t.puntos +
        ' puntos. La clasificación tiene un hueco y el reporte sería falso.');
    }
  }

  return { tot, afectados, puerta, enviados, sinItems, conBanderas, sinBanderas };
}

/** Imprime el reporte a partir de lo que devolvió `agregar()`. */
function reportar(ag) {
  const { tot, afectados, puerta, enviados, sinItems, conBanderas, sinBanderas } = ag;
  const puntos = tot.antes.puntos + tot.desde3sep.puntos;
  console.log('[regla] checklists sin items (no se clasifican): %d', sinItems);
  console.log('[regla] puntos clasificados → %d   (piden evidencia %d · no piden %d)',
    puntos, conBanderas, sinBanderas);
  if (puntos === 0) abortar('cero puntos clasificados: no se midió nada.');

  const pct = (n, de) => de ? (Math.round((n * 1000) / de) / 10).toFixed(1) + '%' : '—';

  console.log('');
  console.log('                        checklists   puntos   con evidencia   POR JUSTIFICACIÓN   no hechos');
  console.log('─'.repeat(104));
  for (const [lado, etiqueta] of [['antes', 'antes del 3/sep'], ['desde3sep', 'del 3/sep en adelante']]) {
    const t = tot[lado];
    console.log('%s %s %s %s %s %s',
      etiqueta.padEnd(23), String(t.checklists).padEnd(12), String(t.puntos).padEnd(8),
      (t.con_evidencia + ' (' + pct(t.con_evidencia, t.puntos) + ')').padEnd(15),
      (t.por_justificacion + ' (' + pct(t.por_justificacion, t.puntos) + ')').padEnd(19),
      t.no_hecho + ' (' + pct(t.no_hecho, t.puntos) + ')');
  }
  console.log('─'.repeat(104));

  const total = tot.antes.por_justificacion + tot.desde3sep.por_justificacion;
  console.log('');
  console.log('═══ LO QUE LA FASE 2.1 LE QUITA A LOS TABLEROS ═══');
  console.log('  %d punto(s) de %d cuentan hoy como HECHOS SIN NINGUNA PRUEBA (%s).',
    total, puntos, pct(total, puntos));
  console.log('  Reparto: %d antes del 3/sep · %d desde el 3/sep.',
    tot.antes.por_justificacion, tot.desde3sep.por_justificacion);
  console.log('  Alcanza a %d checklist(s) y a %d persona(s).',
    afectados.checklists.size, afectados.personas.size);
  console.log('');
  console.log('  Ese número es DOS cosas a la vez, y conviene decirlo:');
  console.log('   (a) exactamente los puntos que CAMBIARÍAN DE ESTADO con la 2.1. Un punto');
  console.log('       con foto Y con nota no está aquí: se cierra por su prueba y no se mueve.');
  console.log('   (b) exactamente donde el TABLERO y el BOT ya se contradicen HOY. El');
  console.log('       `itemHecho` de api/asistente-chat.js:569 es espejo de `tieneEvidencia`,');
  // CORREGIDO el 13/sep/2026. Aquí decía «verificado: 0 referencias a
  // notaEmpleado/entregaConRetraso», y eso era una CADENA ESCRITA A MANO, no
  // una medición: el archivo tiene 10 referencias. La conclusión aguanta —las
  // 10 están en el mapeo de columnas, en un comentario, en la ESCRITURA de la
  // justificación al enviar y en reportes de envío; ninguna dentro de las 7
  // líneas de `itemHecho`— pero un «verificado» que nadie verificó es justo lo
  // que la §8.11 persigue. Se dice lo comprobable y dónde mirarlo.
  console.log('       cuyo cuerpo (líneas 569-575) NO consulta notaEmpleado ni');
  console.log('       entregaConRetraso: el bot ESCRIBE la justificación al enviar, pero');
  console.log('       nunca cierra un punto con ella. De ahí comen el bot y los avisos de');
  console.log('       WhatsApp (tareas-notificar.js lo importa, no lo copia). Así que la 2.1');
  console.log('       no abre una divergencia: CIERRA la que ya existe en producción.');
  console.log('');
  console.log('  Por qué puerta entra (dueños distintos en el modelo de causas):');
  console.log('     solo la nota      %s', puerta.solo_nota);
  console.log('     solo el retraso   %s', puerta.solo_retraso);
  console.log('     las dos           %s', puerta.ambas);

  console.log('');
  console.log('═══ Y UN PROBLEMA APARTE, QUE LA 2.1 NO ARREGLA ═══');
  console.log('  De %d checklist(s) ENVIADOS, %d tienen al menos un punto SIN PRUEBA (%s),',
    enviados.total, enviados.con_puntos_sin_prueba, pct(enviados.con_puntos_sin_prueba, enviados.total));
  console.log('  y suman %d punto(s) sin prueba dentro de algo ya entregado.', enviados.puntos_sin_prueba);
  console.log('  La herramienta `estadisticas` del bot cuenta cumplimiento como');
  console.log('  `enviado === true` a nivel checklist, así que los cuenta al 100%.');
  console.log('  Eso vive en asistente-chat.js:2653 y se arregla aparte de la regla de items.');

  if (afectados.stores.size) {
    console.log('');
    console.log('  dónde se concentra (puntos sin prueba por lugar):');
    for (const [s, n] of [...afectados.stores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log('     ' + s.padEnd(30) + n);
    }
  }

  console.log('');
  console.log('CÓMO SE LEE ESTO, y no se lee solo:');
  console.log('  · La 045 midió 1 punto el 31/ago, cuando solo ~50 de 377 puntos pedían');
  console.log('    evidencia. Compara el lado "desde el 3/sep" contra ese 1: si creció, la');
  console.log('    Fase 2.1 YA NO ES GRATIS y mueve el cumplimiento de gente real.');
  console.log('  · Un punto en "por justificación" NO es alguien haciendo trampa: es la regla');
  console.log('    dándole por bueno lo que no tiene prueba. La causa se tipifica en la Fase 5.');
  console.log('  · Y ESTO NO DICE QUE ESA GENTE NO TRABAJÓ. Dice que el sistema no lo puede');
  console.log('    demostrar. Son cosas distintas y confundirlas le cuesta el puesto a alguien.');
}

async function medir(M, desde) {
  const filas = await leerFilas(desde);
  reportar(agregar(M, filas));
}

/**
 * PRUEBA DE LA ARITMÉTICA, sin base. Filas con la MISMA forma que devuelve la
 * consulta (los campos que la regla mira viven en `datos`, no en columnas: es el
 * §12 del contexto, y equivocarse ahí devuelve cero o devuelve todo sin un solo
 * error de SQL).
 */
function autopruebaAgregacion(M) {
  console.log('\nAUTOPRUEBA de la agregación (mismas filas que devuelve la consulta)\n');

  const pt = (extra) => Object.assign({ checked: true, requiresVariasFotos: true, photos: [] }, extra);
  const filas = [
    // ANTES del corte: sin banderas, el palomeo bastaba.
    { id: 'a1', fecha: '2026-09-01', store: 'Canindo', assigned: 'Ana', enviado: true,
      datos: { notaEmpleado: '', items: [{ checked: true }, { checked: false }] } },
    // DESDE el corte, con NOTA: los dos sin foto entran por la justificación.
    { id: 'b1', fecha: '2026-09-04', store: 'Canindo', assigned: 'Ana', enviado: true,
      datos: { notaEmpleado: 'faltó material', items: [pt(), pt({ photos: [{ url: 'x' }] })] } },
    // DESDE el corte, con RETRASO: la otra puerta.
    { id: 'b2', fecha: '2026-09-04', store: '8 Esquinas', assigned: 'Beto', entregaConRetraso: true,
      enviado: false, datos: { entregaConRetraso: true, items: [pt()] } },
    // DESDE el corte, sin nada: no se cierra. Es el control negativo.
    { id: 'b3', fecha: '2026-09-04', store: '8 Esquinas', assigned: 'Beto', enviado: false,
      datos: { items: [pt()] } },
    // Sin items: no se clasifica, pero tiene que CONTARSE aparte.
    { id: 'c1', fecha: '2026-09-04', store: 'Canindo', assigned: 'Ana', enviado: false, datos: {} },
  ];

  const a = agregar(M, filas);
  const esperado = [
    ['puntos antes del corte', a.tot.antes.puntos, 2],
    ['  · con evidencia (el palomeo bastaba)', a.tot.antes.con_evidencia, 1],
    ['  · no hechos', a.tot.antes.no_hecho, 1],
    ['puntos desde el corte', a.tot.desde3sep.puntos, 4],
    ['  · con evidencia (trae foto)', a.tot.desde3sep.con_evidencia, 1],
    ['  · POR JUSTIFICACIÓN', a.tot.desde3sep.por_justificacion, 2],
    ['  · no hechos (NEGATIVO: sin nota no se cierra)', a.tot.desde3sep.no_hecho, 1],
    ['puerta · solo nota', a.puerta.solo_nota, 1],
    ['puerta · solo retraso', a.puerta.solo_retraso, 1],
    ['puerta · las dos', a.puerta.ambas, 0],
    ['checklists sin items, contados aparte', a.sinItems, 1],
    ['personas alcanzadas', a.afectados.personas.size, 2],
    // SON DOS, y al escribir la prueba puse 1: me faltó contar que en `a1` el
    // punto sin palomear TAMPOCO tiene prueba. El código tenía razón y la
    // expectativa estaba mal — la misma clase de error que los "66 azules" que
    // resultaron ser 82. Por eso la cifra esperada se comprueba, no se supone.
    ['enviados con puntos sin prueba', a.enviados.con_puntos_sin_prueba, 2],
    ['puntos sin prueba dentro de enviados', a.enviados.puntos_sin_prueba, 2],
    ['enviados en total', a.enviados.total, 2],
  ];

  let fallos = 0;
  for (const [etiqueta, dado, esp] of esperado) {
    if (dado === esp) console.log('   ok    ' + etiqueta.padEnd(46) + dado);
    else { console.log('   FALLA ' + etiqueta.padEnd(46) + dado + ', esperaba ' + esp); fallos++; }
  }
  if (fallos) {
    console.error('\n❌ la agregación no cuadra en ' + fallos + ' cifra(s). NO la corras contra producción.');
    process.exit(2);
  }
  console.log('\n✅ la aritmética cuadra, y las cubetas suman el total (la guardia interna no abortó).');

  // Y se ejercita el REPORTE. Sin esto, `reportar()` se estrenaría en la corrida
  // de David: un `padEnd` sobre un undefined y se pierde la medición buena.
  // Va rotulado porque un reporte falso que parece real es peor que ninguno.
  console.log('\n' + '━'.repeat(78));
  console.log('LO DE ABAJO ES DATO SINTÉTICO — 5 checklists inventados, NO producción.');
  console.log('Solo prueba que el reporte se imprime sin reventar. NO lo cites.');
  console.log('━'.repeat(78));
  reportar(a);
  console.log('━'.repeat(78));
  console.log('FIN DEL DATO SINTÉTICO.');
  console.log('━'.repeat(78));
}

// ══════════════════════════════════════════════════════════════════════════
(async () => {
  const args = process.argv.slice(2);
  const { M, tmp } = cargarRegla();

  try {
    if (args.includes('--autoprueba')) {
      autoprueba(M);
      autopruebaAgregacion(M);
      return;
    }
    const i = args.indexOf('--desde');
    let desde;
    if (i >= 0 && args[i + 1]) {
      desde = args[i + 1];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) abortar('--desde pide YYYY-MM-DD, llegó "' + desde + '"');
    } else {
      const d = new Date(Date.now() - DIAS_POR_OMISION * 86400000);
      desde = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    }
    await medir(M, desde);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* da igual */ }
  }
})().catch((e) => abortar((e && e.message) || String(e)));
