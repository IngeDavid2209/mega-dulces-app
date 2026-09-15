// ============================================================================
//  PRUEBA de `_schema-mdtask.js` — sin base, sin credenciales, en milisegundos
//
//  LA PREGUNTA QUE CONTESTA: ¿la eleccion del schema DISCRIMINA, y aborta en
//  los dos casos en que un cero no significa «no hay»?
//
//  Corre con un ejecutor SIMULADO. Eso no es una comodidad: la eleccion del
//  schema solo se ejercita con credenciales de produccion, o sea que sin esto
//  se ejercitaria UNA vez cada varias semanas, a mano, y nadie sabria si sigue
//  funcionando. La logica se escribio lanzando errores (no `process.exit`)
//  justamente para poder llegar hasta aqui.
//
//    node scripts/prueba-schema-mdtask.js
// ============================================================================
const { schemaDeMdtask, ErrorDeSchema } = require('./_schema-mdtask');

let fallos = 0, verdes = 0;
function afirmar(loQueMide, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { verdes++; console.log('  ok     ' + loQueMide); }
  else {
    fallos++;
    console.log('  FALLA  ' + loQueMide);
    console.log('         esperaba ' + JSON.stringify(esperado) + ' y medi ' + JSON.stringify(real));
  }
}

/**
 * Ejecutor simulado: recibe el mapa {schema: filas} y responde las DOS consultas
 * que hace el modulo. Se escribe aqui una sola vez para que ningun caso pueda
 * inventarse un comportamiento distinto del de al lado.
 */
function ejecutorCon(mapa, tablaExistente) {
  const tabla = tablaExistente || 'mdtask_usuarios';
  const vistas = [];
  const fn = async (sql, params) => {
    vistas.push(sql);
    if (sql.includes('information_schema')) {
      if (params[0] !== tabla) return { rows: [] };
      return { rows: Object.keys(mapa).map(s => ({ table_schema: s })) };
    }
    const m = sql.match(/from "([^"]+)"\./);
    return { rows: [{ n: mapa[m[1]] }] };
  };
  fn.vistas = vistas;
  return fn;
}

const callado = () => {};
const opc = { registrar: callado };

/**
 * Llama al modulo y convierte una excepcion en un VALOR, en vez de dejar que
 * tumbe la corrida.
 *
 * No es comodidad, es la leccion del 9/sep/2026 escrita en el CLAUDE.md: un
 * control negativo que REVIENTA no es un control que falla. Al crashear, las
 * aserciones de abajo no llegan a correr, asi que no se puede saber si
 * discriminan — y desde fuera «tumbo la suite» se parece demasiado a «detecto».
 * Con esto, romper el orden de eleccion produce FALLOS LIMPIOS que nombran que
 * se esperaba `eajd` y llego un aborto.
 */
async function intentar(promesa) {
  try { return await promesa; }
  catch (e) { return { schema: '(lanzo: ' + (e.codigo || e.name) + ')', conteos: [] }; }
}

(async () => {
  console.log('\n=== ELIGE EL SCHEMA QUE DE VERDAD TIENE LOS DATOS ===');

  // El caso real del 14/sep: `eajd` con los datos, `public` con el esquema vacio.
  const r1 = await intentar(schemaDeMdtask(ejecutorCon({ public: 0, eajd: 159 }), opc));
  afirmar('el caso del 14/sep: gana eajd sobre un public vacio', r1.schema, 'eajd');
  afirmar('y publica los dos candidatos para que la eleccion sea auditable',
    r1.conteos, [{ schema: 'eajd', filas: 159 }, { schema: 'public', filas: 0 }]);

  // El orden en que `information_schema` los devuelva NO puede decidir.
  const r2 = await intentar(schemaDeMdtask(ejecutorCon({ eajd: 159, public: 0 }), opc));
  afirmar('el orden de llegada no cambia la eleccion', r2.schema, 'eajd');

  const r3 = await intentar(schemaDeMdtask(ejecutorCon({ public: 150 }), opc));
  afirmar('con un solo schema poblado, lo usa', r3.schema, 'public');

  // Empate: tiene que ser DETERMINISTA. Dos corridas del mismo diagnostico que
  // eligieran schemas distintos producirian dos verdades sobre la misma base.
  const r4a = await intentar(schemaDeMdtask(ejecutorCon({ zeta: 10, alfa: 10 }), opc));
  const r4b = await intentar(schemaDeMdtask(ejecutorCon({ alfa: 10, zeta: 10 }), opc));
  afirmar('un empate se rompe alfabeticamente, no por el orden de la base', r4a.schema, 'alfa');
  afirmar('y da lo mismo en las dos direcciones (es determinista)', r4b.schema, r4a.schema);

  console.log('\n=== ABORTA CUANDO UN CERO NO SIGNIFICA «NO HAY» ===');

  let e1 = null;
  try { await schemaDeMdtask(ejecutorCon({}), opc); } catch (e) { e1 = e; }
  afirmar('sin la tabla en ningun schema, lanza', e1 instanceof ErrorDeSchema, true);
  afirmar('y lo nombra: SIN_TABLA', e1 && e1.codigo, 'SIN_TABLA');

  let e2 = null;
  try { await schemaDeMdtask(ejecutorCon({ public: 0, eajd: 0 }), opc); } catch (e) { e2 = e; }
  afirmar('con TODOS los schemas vacios, lanza en vez de devolver uno',
    e2 instanceof ErrorDeSchema, true);
  afirmar('y lo nombra: TODOS_VACIOS', e2 && e2.codigo, 'TODOS_VACIOS');
  afirmar('el error carga los conteos, para poder verlos sin repetir la consulta',
    e2 && e2.conteos.length, 2);

  console.log('\n=== MIDE POR LA TABLA QUE DE VERDAD SE USA (§8.11 b) ===');

  // `diagnostico-emision-hoy.js` lee `mdtask_checklists`. Si el modulo eligiera
  // siempre mirando `mdtask_usuarios`, quedaria la rendija de que las dos no
  // vivan en el mismo schema y el diagnostico leyera una tabla vacia.
  const ejChecklists = ejecutorCon({ eajd: 4148 }, 'mdtask_checklists');
  const r5 = await intentar(schemaDeMdtask(ejChecklists, { tabla: "mdtask_checklists", registrar: callado }));
  afirmar('elige mirando la tabla que se le pide', r5.schema, 'eajd');
  afirmar('y esa es la que consulto, no otra',
    ejChecklists.vistas.some(s => s.includes('mdtask_checklists')), true);

  let e3 = null;
  try {
    await schemaDeMdtask(ejecutorCon({ eajd: 1 }), { tabla: 'mdtask_usuarios; drop table x', registrar: callado });
  } catch (e) { e3 = e; }
  afirmar('un nombre de tabla que no sea un identificador se rechaza', e3 instanceof TypeError, true);

  // ── GUARDIA DE DISCRIMINACION ────────────────────────────────────────────
  // Sin esto, un `schemaDeMdtask` que devolviera SIEMPRE 'eajd' pasaria casi
  // todo lo de arriba. La muestra tiene que producir resultados distintos.
  console.log('\n=== GUARDIA DE DISCRIMINACION ===');
  const distintos = new Set([r1.schema, r3.schema, r4a.schema]);
  afirmar('la muestra produce schemas DISTINTOS (si no, no mide nada)', distintos.size, 3);
  const codigos = new Set([e1 && e1.codigo, e2 && e2.codigo]);
  afirmar('y los dos abortos son por motivos distintos', codigos.size, 2);

  console.log('');
  if (fallos) {
    console.error('[prueba-schema] ' + fallos + ' FALLA(S) de ' + (fallos + verdes) + '.');
    process.exit(2);
  }
  console.log('[prueba-schema] ' + verdes + ' afirmaciones en verde, mas las dos guardias.');
  process.exit(0);
})().catch(e => { console.error('[prueba-schema] excepcion no prevista:', e); process.exit(3); });
