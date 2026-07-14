// ============================================================================
//  Marca una SUCURSAL al 100% de cumplimiento en una FECHA dada.
//
//  Que hace por cada checklist (no eliminado/archivado) de esa sucursal+fecha:
//    - Palomea todos sus items (checked = true)
//    - status = 'completo', enviado = true
//    - notaEmpleado = 'Cierre administrativo' (si estaba vacia)
//  Con esto cuenta 100% en Ranking, Estadisticas y Checkstore, se ve palomeado
//  y entregado, y SIN etiqueta de "entrega con retraso".
//  Escribe en Postgres y espeja a Firestore (dual-write), igual que la app.
//
//  Config por variables de entorno:
//    SUCURSAL   (default 'Padre Hidalgo')
//    FECHA      (default: AYER en hora de Mexico, UTC-6) formato YYYY-MM-DD
//    NOTA       (default 'Cierre administrativo')
//    APLICAR=1  para escribir de verdad (sin el, es DRY-RUN y no toca nada)
//
//  Uso:
//    DRY-RUN:  railway run bash -c "node scripts/marcar-sucursal-100.js"
//    APLICAR:  railway run bash -c "APLICAR=1 node scripts/marcar-sucursal-100.js"
//    Otra fecha/sucursal: ... FECHA=2026-07-13 SUCURSAL='Padre Hidalgo' ...
// ============================================================================
const admin = require('firebase-admin');
const { query, dbConfigurada } = require('../api/db');

const APLICAR = process.env.APLICAR === '1';
const SUCURSAL = process.env.SUCURSAL || 'Padre Hidalgo';
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
  catch (e) { console.error('[100%] Aviso: no se pudo iniciar Firebase (' + e.message + '). Se escribira SOLO Postgres.'); return false; }
}

// Mismo criterio de "item hecho" que la app (item-completado.util.ts): con nota
// de empleado, TODOS los items cuentan; ademas los palomeamos para que se vean
// hechos. Aqui solo lo usamos para reportar el % actual en el DRY-RUN.
function itemHechoActual(item) {
  if (item && item.requiresAntesDespues) return !!item.photoAntes && !!item.photoDespues;
  if (item && item.requiresVariasFotos) return Array.isArray(item.photos) && item.photos.length > 0;
  if (item && item.requiresPhoto) return !!item.photo && item.photo !== 'subiendo...';
  return !!(item && item.checked === true);
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

  console.log(`[100%] sucursal="${SUCURSAL}" fecha=${FECHA} | checklists encontrados: ${r.rows.length}`);
  if (r.rows.length === 0) {
    console.log('[100%] No hay checklists para esa sucursal y fecha. Revisa el nombre exacto de la sucursal y la FECHA.');
    return;
  }

  const cambios = [];
  for (const c of r.rows) {
    const datos = c.datos || {};
    const items = Array.isArray(datos.items) ? datos.items : [];
    const hechosAntes = items.filter(itemHechoActual).length;
    const pctAntes = items.length ? Math.round((hechosAntes / items.length) * 100) : 0;
    const itemsNuevos = items.map(i => ({ ...i, checked: true }));
    const notaFinal = (datos.notaEmpleado && String(datos.notaEmpleado).trim()) ? datos.notaEmpleado : NOTA;
    cambios.push({ id: c.id, name: c.name, assigned: c.assigned, items: itemsNuevos, nota: notaFinal, pctAntes, nItems: items.length });
    console.log(`  - "${c.name}" [${c.assigned || 'sin asignado'}] items:${items.length} progreso ${pctAntes}% -> 100%`);
  }

  if (!APLICAR) { console.log('\n[100%] DRY-RUN (no se escribio nada). Para aplicar: APLICAR=1'); return; }

  const espejaFirestore = initAdmin();
  let ok = 0;
  for (const x of cambios) {
    const merge = JSON.stringify({ items: x.items, notaEmpleado: x.nota });
    await query(
      `update mdtask_checklists
          set status='completo', enviado=true,
              datos = coalesce(datos,'{}'::jsonb) || $1::jsonb
        where id=$2`,
      [merge, String(x.id)]
    );
    if (espejaFirestore) {
      await admin.firestore().collection('checklists').doc(String(x.id))
        .set({ status: 'completo', enviado: true, items: x.items, notaEmpleado: x.nota }, { merge: true });
    }
    ok++;
  }
  console.log(`\n[100%] APLICADO. checklists marcados al 100%: ${ok} (sucursal "${SUCURSAL}", fecha ${FECHA})`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[100%] ERROR:', e.message); process.exit(1); });
