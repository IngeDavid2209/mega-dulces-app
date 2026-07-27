// ============================================================================
//  Sube el cumplimiento de una SUCURSAL a un PORCENTAJE dado en una FECHA.
//
//  Hermano de marcar-sucursal-100.js, pero para un objetivo PARCIAL (ej. 85%).
//  Diferencia clave: NO pone nota de empleado, porque una nota hace que TODOS
//  los items cuenten como hechos (=100%). Aqui palomeamos item por item, solo
//  lo necesario para llegar al objetivo.
//
//  Trabaja a nivel de la SUCURSAL en el dia: objetivo = round(PCT% * totalItems).
//  Sube el cumplimiento hasta ese objetivo (nunca desmarca trabajo ya hecho),
//  con la via mas honesta primero:
//    1) Palomea (checked=true) items que NO pidan foto -> cuentan sin inventar nada.
//    2) Si aun falta y lo que queda son items de FOTO (no se inventan fotos), usa
//       el mismo mecanismo del script de 100%: pone la nota de "Cierre
//       administrativo" a esos checklists, con lo que TODOS sus items cuentan
//       como hechos. Se aplica solo a los checklists necesarios para topar el %.
//    - Marca enviado=true (se ve entregado).
//  El % se mide igual que el Ranking/Estadisticas: hechos / total de items,
//  agregando TODOS los checklists de la sucursal ese dia.
//  Escribe en Postgres y espeja a Firestore (dual-write), igual que la app.
//
//  Config por variables de entorno:
//    SUCURSAL   (default 'Padre Hidalgo')
//    FECHA      (default: AYER en hora de Mexico, UTC-6) formato YYYY-MM-DD
//    PCT        (default 85) porcentaje objetivo, 0..100
//    APLICAR=1  para escribir de verdad (sin el, es DRY-RUN y no toca nada)
//
//  Uso:
//    DRY-RUN:  railway run bash -c "PCT=85 FECHA=2026-07-14 node scripts/marcar-sucursal-porcentaje.js"
//    APLICAR:  railway run bash -c "APLICAR=1 PCT=85 FECHA=2026-07-14 node scripts/marcar-sucursal-porcentaje.js"
// ============================================================================
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('../api/db');

const APLICAR = process.env.APLICAR === '1';
const SUCURSAL = process.env.SUCURSAL || 'Padre Hidalgo';
const PCT = Math.max(0, Math.min(100, Number(process.env.PCT || 85)));
const NOTA = process.env.NOTA || 'Cierre administrativo';
const FECHA = process.env.FECHA || (() => {
  // Ayer en hora de Mexico (UTC-6, sin horario de verano en el centro/occidente).
  const t = new Date(Date.now() - 6 * 3600 * 1000 - 24 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
})();

// Inicializa Firebase solo si hay credenciales. Devuelve true si quedo listo el
// espejo a Firestore; false si no (en ese caso solo se escribe Postgres, que es
// de donde la app YA lee; Firestore es respaldo).
function initAdmin() {
  if (admin.apps.length) return true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return false;
  try { admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) }); return true; }
  catch (e) { console.error('[PCT] Aviso: no se pudo iniciar Firebase (' + e.message + '). Se escribira SOLO Postgres.'); return false; }
}

// Mismo criterio de "item con evidencia propia" que la app (item-completado.util.ts).
// OJO: aqui NO consideramos la nota del checklist a proposito (esa hace 100%).
function itemRequierefoto(item) {
  return !!(item && (item.requiresAntesDespues || item.requiresVariasFotos || item.requiresPhoto));
}
function tieneEvidencia(item) {
  if (!item) return false;
  if (item.requiresAntesDespues) {
    return !!item.photoAntes && item.photoAntes !== 'subiendo...' &&
           !!item.photoDespues && item.photoDespues !== 'subiendo...';
  }
  if (item.requiresVariasFotos) return Array.isArray(item.photos) && item.photos.length > 0;
  if (item.requiresPhoto) return !!item.photo && item.photo !== 'subiendo...';
  return item.checked === true;
}
function tieneNota(datos) {
  const nota = (datos.notaEmpleado || '').toString().trim();
  return nota.length > 0 || datos.entregaConRetraso === true;
}

async function main() {
  if (!dbConfigurada()) throw new Error('DATABASE_URL no configurada.');

  const r = await query(
    `select * from mdtask_checklists
      where store = $1 and fecha = $2
        and coalesce(eliminado,false) = false
        and coalesce(archivado,false) = false`,
    [SUCURSAL, FECHA]
  );

  console.log(`[PCT] sucursal="${SUCURSAL}" fecha=${FECHA} objetivo=${PCT}% | checklists: ${r.rows.length}`);
  if (r.rows.length === 0) {
    console.log('[PCT] No hay checklists para esa sucursal y fecha. Revisa el nombre exacto y la FECHA.');
    return;
  }

  // Estado por checklist. hechos/total a nivel item, igual que el Ranking.
  const estado = r.rows.map(c => {
    const datos = c.datos || {};
    const items = Array.isArray(datos.items) ? datos.items : [];
    const justificado = tieneNota(datos);
    const hechos = justificado ? items.length : items.filter(tieneEvidencia).length;
    return {
      id: c.id, name: c.name, datos, items, n: items.length,
      justificado, hechos,
      // items que NO cuentan y NO piden foto -> se pueden palomear honestamente.
      sinFoto: items.filter(it => !tieneEvidencia(it) && !itemRequierefoto(it)),
      // items que NO cuentan y SI piden foto -> solo via cierre administrativo.
      deFoto: items.filter(it => !tieneEvidencia(it) && itemRequierefoto(it)),
      nuevoItems: null, ponerNota: false, palomeados: 0
    };
  });

  const totItems = estado.reduce((s, e) => s + e.n, 0);
  const hechosAntes = estado.reduce((s, e) => s + e.hechos, 0);
  const objetivoGlobal = Math.round((PCT / 100) * totItems);
  let deficit = objetivoGlobal - hechosAntes;

  console.log(`[PCT] items totales: ${totItems} | hechos ahora: ${hechosAntes} (${totItems ? Math.round(hechosAntes / totItems * 100) : 0}%) | objetivo: ${objetivoGlobal} (${PCT}%)`);

  if (deficit > 0) {
    // VIA 1: palomear items sin foto (honesto, no inventa evidencia).
    for (const e of estado) {
      if (deficit <= 0) break;
      if (e.sinFoto.length === 0) continue;
      e.nuevoItems = e.items.map(i => ({ ...i }));
      for (const it of e.nuevoItems) {
        if (deficit <= 0) break;
        if (tieneEvidencia(it) || itemRequierefoto(it)) continue;
        it.checked = true; e.palomeados++; deficit--;
      }
    }
    // VIA 2: cierre administrativo (nota) en checklists cuyos pendientes son de
    // foto. Poner nota hace que TODOS los items de ese checklist cuenten, asi que
    // aporta = items pendientes de ese checklist. Se recorren de menor a mayor
    // pendiente y se toma cada uno mientras no sobrepase el faltante -> con
    // checklists de 1 item queda exacto.
    const pendientesDe = (e) => e.n - (e.nuevoItems || e.items).filter(tieneEvidencia).length;
    const candidatos = estado
      .filter(e => !e.justificado && !e.ponerNota && e.deFoto.length > 0)
      .sort((a, b) => pendientesDe(a) - pendientesDe(b));
    for (const e of candidatos) {
      if (deficit <= 0) break;
      const pendientes = pendientesDe(e);
      if (pendientes <= 0 || pendientes > deficit) continue;
      e.ponerNota = true;
      deficit -= pendientes;
    }
  }

  // Reporte y recuento final.
  let hechosDespuesTot = 0;
  const cambios = [];
  for (const e of estado) {
    let hechosD;
    if (e.ponerNota || e.justificado) hechosD = e.n;
    else hechosD = (e.nuevoItems || e.items).filter(tieneEvidencia).length;
    hechosDespuesTot += hechosD;
    const cambia = e.palomeados > 0 || e.ponerNota;
    if (cambia) {
      const flags = [];
      if (e.palomeados) flags.push(`palomeados:${e.palomeados}`);
      if (e.ponerNota) flags.push('cierre administrativo');
      console.log(`  - "${e.name}" items:${e.n} -> ${Math.round(hechosD / e.n * 100)}% [${flags.join('; ')}]`);
      cambios.push(e);
    }
  }

  const pctDespuesGlobal = totItems ? Math.round((hechosDespuesTot / totItems) * 100) : 0;
  const pctAntesGlobal = totItems ? Math.round((hechosAntes / totItems) * 100) : 0;
  console.log(`\n[PCT] SUCURSAL (agregado del dia): ${pctAntesGlobal}% -> ${pctDespuesGlobal}%  (${hechosDespuesTot}/${totItems} items) | checklists a modificar: ${cambios.length}`);
  if (deficit > 0) console.log(`[PCT] AVISO: no se alcanzo el objetivo por ${deficit} item(s) (no habia mas tareas disponibles).`);

  if (!APLICAR) { console.log('\n[PCT] DRY-RUN (no se escribio nada). Para aplicar: APLICAR=1'); return; }
  if (cambios.length === 0) { console.log('[PCT] Nada que escribir.'); return; }

  const espejaFirestore = initAdmin();
  let ok = 0;
  for (const e of cambios) {
    const patch = { enviado: true };
    if (e.nuevoItems) patch.items = e.nuevoItems;
    if (e.ponerNota) {
      patch.status = 'completo';
      const notaFinal = (e.datos.notaEmpleado && String(e.datos.notaEmpleado).trim()) ? e.datos.notaEmpleado : NOTA;
      patch.notaEmpleado = notaFinal;
      // al poner nota, TODOS los items cuentan; ademas los palomeamos para que se vean hechos.
      patch.items = (e.nuevoItems || e.items).map(i => ({ ...i, checked: true }));
    }
    const merge = JSON.stringify(patch);
    await query(
      `update mdtask_checklists
          set enviado=true,
              status = coalesce($3, status),
              datos = coalesce(datos,'{}'::jsonb) || $1::jsonb
        where id=$2`,
      [merge, String(e.id), e.ponerNota ? 'completo' : null]
    );
    if (espejaFirestore) {
      await admin.firestore().collection('checklists').doc(String(e.id)).set(patch, { merge: true });
    }
    ok++;
  }
  console.log(`\n[PCT] APLICADO. checklists modificados: ${ok} (sucursal "${SUCURSAL}", fecha ${FECHA}, objetivo ${PCT}%)`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[PCT] ERROR:', e.message); process.exit(1); });
