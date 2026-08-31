// ============================================================================
//  ¿A QUIÉN LE ESTAMOS ASIGNANDO TRABAJO QUE NO LE TOCA?
//
//  Sale del hallazgo del selector: el 22/may a las 13:11:11 una Encargada real
//  hizo una asignación en bloque en La Piedad Abastos y el selector le ofreció
//  dos fichas que no son de esa plaza, una de ellas una cuenta de pruebas.
//
//  Completa el cuadro del silencio: el robot emite al vacío (60 de 97 fichas con
//  puesto no abren la app) Y LAS PERSONAS TAMBIÉN. Los dos inflan el mismo
//  denominador, y los tableros lo muestran como incumplimiento.
//
//  ─── POR QUÉ TRES CUBETAS Y NO UN NÚMERO ──────────────────────────────────
//  El criterio ancho —«assigned que no corresponde a ninguna ficha activa con
//  puesto»— mete en la misma bolsa tres cosas que se arreglan distinto:
//
//    A. NO CRUZA CON NINGUNA FICHA (activa o no) → huérfana de verdad. Nadie con
//       ese nombre existe en el sistema. ÉSTA es la que contesta la pregunta.
//    B. Cruza con una ficha DESACTIVADA → historia normal. Alguien trabajó ahí y
//       ya no está. No es falla.
//    C. Cruza con una ficha SIN PUESTO → legítimo. Hay 53 fichas activas sin
//       puesto que reciben tareas libres a propósito.
//
//  Publicar un solo número de titular las suma y no significa nada.
//
//  ─── Y LA CUBETA A NO ES LO QUE PARECE ────────────────────────────────────
//  Emparejar `assigned` con una ficha exige normalizar el nombre, y eso es
//  exactamente lo que hoy quedó demostrado que está roto: `Yaadira` con doble a,
//  `LUISA RENATAHERNANDEZ` sin espacio, dobles espacios, `olivarez` por
//  `OLIVARES`. Así que las que «no cruzan» **no son necesariamente huérfanas:
//  son la métrica del hallazgo 1.** Por eso la cubeta A se reporta con ese
//  nombre y sin titular único: según cómo se cuente es cota inferior o superior.
//
//  ─── `store` HACE DOBLE TRABAJO ───────────────────────────────────────────
//  No siempre es una sucursal. La 050 mostró FINANZAS, RH, COMPRAS y MKT como
//  centro, y `scripts/sql/009_checklists.sql:11` documenta `'MANTENIMIENTO'`
//  como valor especial. Sin excluirlos, cada checklist administrativo saldría
//  marcado como discrepancia. Y se excluye también a quien tenga
//  `alcance: 'global'` o la sucursal `General (Acceso Total)`: para ellos no hay
//  sucursal que incumplir.
//
//  Los nombres de sucursal se LEEN del catálogo, no se copian aquí.
//
//  ─── CONTROL POSITIVO **Y** NEGATIVO ──────────────────────────────────────
//  Una consulta que marque TODO también encuentra los dos casos del 22/may. Así
//  que además del control positivo hay uno negativo: los checklists que el robot
//  generó hoy (`createdBy = 'Manual Corporativo'`) NO deben caer en ninguna
//  cubeta. Sin eso se comprueba que la consulta encuentra, no que discrimina.
//
//  ─── SE CORRE ASÍ (las credenciales las pone David, §8.7) ─────────────────
//    $env:DATABASE_URL="postgresql://..."   # la PÚBLICA de Railway
//    node scripts/diagnostico-asignaciones-huerfanas.js
// ============================================================================
const fs = require('fs');
const path = require('path');
const { query, dbConfigurada } = require('../api/db');

const RUTA_SUC = path.join(__dirname, '..', 'src', 'app', 'shared', 'sucursales-ubicaciones.util.ts');

function abortar(motivo, detalle) {
  console.error('');
  console.error('[huerfanas] ABORTA: ' + motivo);
  if (detalle) console.error(detalle);
  console.error('[huerfanas] No concluyas de esta corrida.');
  process.exit(2);
}

/** Mismo criterio que shared/permisos.util.ts: sin acentos, minúsculas, un espacio. */
function norm(t) {
  return String(t || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // marcas combinantes, escapadas para que se puedan leer
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Nombres de sucursal, leídos del catálogo. */
function sucursalesDelCatalogo() {
  if (!fs.existsSync(RUTA_SUC)) abortar('no existe ' + RUTA_SUC);
  const texto = fs.readFileSync(RUTA_SUC, 'utf8');
  const nombres = [...texto.matchAll(/nombre:\s*'([^']+)'/g)].map(m => m[1]);
  if (nombres.length === 0) {
    abortar('el parseo del catálogo de sucursales devolvió CERO nombres. Cambió el formato.');
  }
  return new Set(nombres.map(norm));
}

async function main() {
  if (!dbConfigurada()) {
    abortar('falta DATABASE_URL. Desde tu máquina usa la URL PÚBLICA de Railway.');
  }

  const sucursales = sucursalesDelCatalogo();
  console.log('[huerfanas] catálogo → %d nombres de sucursal', sucursales.size);

  // ── Fichas: todas, activas o no, porque la cubeta B las necesita ────────
  const ru = await query(`
    select u.id, u.nombre, u.activo, u.rol,
           coalesce(u.datos->>'alcance','') as alcance,
           coalesce(u.datos->>'puestoId','') as puesto_id,
           coalesce(u.datos->'sucursales', '[]'::jsonb) as sucursales,
           coalesce(u.datos->>'sucursal','') as sucursal_simple
      from mdtask_usuarios u`);
  if (ru.rows.length === 0) abortar('cero fichas de usuario. No se leyó nada.');
  console.log('[huerfanas] fichas leídas (activas y no) → %d', ru.rows.length);

  const porNombre = new Map();
  for (const u of ru.rows) {
    const k = norm(u.nombre);
    if (k) porNombre.set(k, u);
  }

  // ── Checklists ─────────────────────────────────────────────────────────
  const rc = await query(`
    select c.id, c.fecha, c.assigned, c.store, c.created_by, c.timestamp_creacion
      from mdtask_checklists c
     where coalesce(c.eliminado,false) = false`);
  if (rc.rows.length === 0) abortar('cero checklists. No se leyó nada.');
  console.log('[huerfanas] checklists leídos → %d', rc.rows.length);

  // A: no cruza con ninguna ficha · B: ficha desactivada · C: activa sin puesto
  // D: store ajeno a las sucursales del asignado (ficha CON sucursales)
  // E: ficha SIN NINGUNA sucursal, asignada a una sucursal real  <- el selector
  //
  // D y E son EXCLUYENTES entre si por construccion (una tiene sucursales y la
  // otra no), pero NINGUNA es excluyente con A/B/C: un mismo checklist puede
  // estar en C y en E a la vez. Los numeros NO suman al denominador, y la salida
  // lo dice para que nadie los sume.
  const A = [], B = [], C = [], D = [], E = [];
  for (const c of rc.rows) {
    const k = norm(c.assigned);
    if (!k) { A.push(c); continue; }
    const u = porNombre.get(k);

    if (!u)                        A.push(c);
    else if (u.activo === false)   B.push(c);
    else if (!u.puesto_id)         C.push(c);

    // ── Cubeta D: el store no es de las sucursales del asignado ──────────
    // Solo se evalúa si la ficha existe, está activa y el store ES una
    // sucursal del catálogo. Un store que es área (FINANZAS, RH, MKT,
    // MANTENIMIENTO...) no se juzga: no hay sucursal que incumplir.
    if (u && u.activo !== false) {
      const st = norm(c.store);
      const esSucursalReal = sucursales.has(st);
      const global = (u.alcance || 'global') === 'global' && u.rol === 'admin';
      const suyas = new Set(
        [...(Array.isArray(u.sucursales) ? u.sucursales : []), u.sucursal_simple]
          .map(norm).filter(Boolean)
      );
      const juzgable = esSucursalReal && !global && st !== norm('General (Acceso Total)');
      if (juzgable) {
        if (suyas.size === 0) {
          // EL CASO DEL SELECTOR. Antes esta rama no existia: el guardian
          // `suyas.size > 0` la descartaba, asi que las fichas sin plaza -que son
          // justo las que el selector ofrece de mas- no se juzgaban NUNCA. El
          // control positivo pasaba por la cubeta C y D quedaba sin ejercer: un
          // D=0 se habria leido como "el problema no existe".
          E.push(c);
        } else if (!suyas.has(st)) {
          D.push({ ...c, suyas: [...suyas].join(', ') });
        }
      }
    }
  }

  const pct = n => ((n / rc.rows.length) * 100).toFixed(2) + '%';
  console.log('');
  console.log('════════════ ASIGNACIONES QUE NO CUADRAN ════════════');
  console.log('Denominador: %d checklists no eliminados', rc.rows.length);
  console.log('');
  console.log('A · NO CRUZAN CON NINGUNA FICHA .......... %d (%s)', A.length, pct(A.length));
  console.log('    ↑ NO son "huérfanas" a secas: es la MÉTRICA DEL HALLAZGO 1.');
  console.log('      El cruce es por nombre normalizado, y eso está roto (Yaadira,');
  console.log('      RENATAHERNANDEZ, dobles espacios). Según cómo se cuente es cota');
  console.log('      inferior o superior — no publiques este número solo.');
  console.log('B · ficha DESACTIVADA ................... %d (%s)  ← historia normal, no falla',
    B.length, pct(B.length));
  console.log('C · ficha activa SIN PUESTO ............. %d (%s)  ← legítimo: tareas libres',
    C.length, pct(C.length));
  console.log('D · store ajeno a SUS sucursales ......... %d (%s)  ← tiene plazas, y no es ésa',
    D.length, pct(D.length));
  console.log('E · ficha SIN plaza, asignada a una real . %d (%s)  ← EL CASO DEL SELECTOR',
    E.length, pct(E.length));
  console.log('');
  console.log('OJO: las cubetas NO son excluyentes entre sí. Un mismo checklist puede estar');
  console.log('     en C y en E a la vez, así que estos números NO suman al denominador.');

  const muestra = (arr, n = 8) => arr.slice(0, n).forEach(c =>
    console.log('      %s · "%s" · store=%s · creado_por=%s',
      c.fecha, c.assigned, c.store || '(vacío)', c.created_by || '(sin creador)'));

  if (A.length) { console.log(''); console.log('  Muestra de A:'); muestra(A); }
  if (E.length) { console.log(''); console.log('  Muestra de E (el selector):'); muestra(E); }
  if (D.length) {
    console.log(''); console.log('  Muestra de D (con las sucursales que sí son suyas):');
    D.slice(0, 8).forEach(c => console.log('      %s · "%s" · store=%s · suyas=[%s] · creado_por=%s',
      c.fecha, c.assigned, c.store, c.suyas, c.created_by || '(sin creador)'));
  }

  // ── CONTROL POSITIVO: los dos del 22/may 13:11:11 ──────────────────────
  console.log('');
  console.log('──────── controles ────────');
  // El control afirma LA CUBETA, no la aparicion. Antes miraba si los casos
  // salian en CUALQUIERA de las cubetas, y pasaban por C -sin puesto- mientras
  // el mecanismo que se quiere medir, el del store, quedaba sin ejercer. Un
  // control que pasa por otro camino da confianza falsa, y eso es peor que
  // fallar: verifica que aparece, no que aparece POR LO QUE SE ESTA MIDIENDO.
  const esCaso = c => c.fecha === '2026-05-22' && /pimentel/i.test(c.created_by || '');
  const enE = E.filter(esCaso);
  const enCualquiera = [...A, ...B, ...C, ...D, ...E].filter(esCaso);
  console.log('POSITIVO · casos del 22/may por Claudia Pimentel → en la cubeta E: %d (en cualquiera: %d)',
    enE.length, enCualquiera.length);
  if (enE.length === 0) {
    abortar(
      'el control POSITIVO falló: los casos del 22/may NO están en la cubeta E, que es la que ' +
      'mide el mecanismo del selector' +
      (enCualquiera.length > 0
        ? '. Aparecen en otra cubeta (' + enCualquiera.length + '), asi que el script encuentra por otro camino y E podria estar muerta.'
        : '. No aparecen en ninguna cubeta.')
    );
  }

  // ── CONTROL NEGATIVO: lo que el robot generó hoy NO debe caer ───────────
  const hoy = new Date();
  const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const delRobotHoy = rc.rows.filter(c => c.fecha === hoyISO && c.created_by === 'Manual Corporativo');
  const idsMarcados = new Set([...A, ...B, ...C, ...D, ...E].map(c => c.id));
  const falsosPositivos = delRobotHoy.filter(c => idsMarcados.has(c.id));

  console.log('NEGATIVO · checklists del robot de hoy: %d · marcados por error: %d',
    delRobotHoy.length, falsosPositivos.length);
  if (delRobotHoy.length === 0) {
    console.log('           AVISO: cero checklists del robot hoy, así que el control negativo');
    console.log('           NO se ejecutó. Sin él solo se comprobó que la consulta encuentra,');
    console.log('           no que discrimina.');
  } else if (falsosPositivos.length > 0) {
    falsosPositivos.slice(0, 5).forEach(c =>
      console.log('           !! "%s" store=%s', c.assigned, c.store));
    abortar('el control NEGATIVO falló: ' + falsosPositivos.length +
      ' checklists legítimos del robot de hoy quedaron marcados. La consulta marca de más.');
  } else {
    console.log('           OK: ninguno de los %d legítimos quedó marcado.', delRobotHoy.length);
  }

  console.log('');
  console.log('Los dos controles pasaron: la consulta encuentra Y discrimina.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[huerfanas] ERROR:', e && e.message);
    console.error('[huerfanas] Una corrida con error no mide nada.');
    process.exit(1);
  });
