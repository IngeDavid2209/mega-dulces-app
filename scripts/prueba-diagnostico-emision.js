// ============================================================================
//  PRUEBA de `diagnostico-emision-hoy.js` — sin base, sin credenciales.
//
//  POR QUE EXISTE: ese diagnostico va a decidir si el siguiente paso es el
//  robot, la pantalla o reponer datos en produccion. Una herramienta de
//  verificacion tambien se verifica (§8.11, el auditor de `raise notice` que
//  dio un falso positivo por contar comas). Y como solo corre con la
//  DATABASE_URL de produccion, sin esta prueba no se ejercitaria nunca.
//
//  LO QUE COMPRUEBA, en este orden:
//    1. que cada caso de fixture produzca SU letra;
//    2. que el reparto en cubetas respete el mismo orden que el poll de la app
//       (eliminado gana a enviado), que es lo que hace comparables los numeros;
//    3. LA GUARDIA QUE IMPORTA: que las cuatro letras sean CUATRO. Un veredicto
//       que siempre contesta lo mismo pasa los tres casos de arriba sin medir
//       nada; la unica forma de cazarlo es exigir que la muestra discrimine.
//
//  Corre con:  node scripts/prueba-diagnostico-emision.js
// ============================================================================
const { cubetas, veredicto } = require('./diagnostico-emision-hoy');

let fallos = 0;
let corridas = 0;   // se CUENTAN, no se escriben a mano: un total tecleado
                    // deja de cuadrar con la primera afirmacion que se agregue.
function afirmar(loQueMide, real, esperado) {
  corridas++;
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    fallos++;
    console.log('  FALLA  %s', loQueMide);
    console.log('         esperaba %s, medi %s', JSON.stringify(esperado), JSON.stringify(real));
  } else {
    console.log('  ok     %s', loQueMide);
  }
}

/** Una fila como la devuelve Postgres, con lo justo que el diagnostico mira. */
function fila(id, estado, assigned) {
  return {
    id,
    assigned: assigned || 'Persona X',
    store: 'Canindo',
    fecha: '2026-09-14',
    enviado: estado === 'enviada',
    eliminado: estado === 'eliminada',
    archivado: estado === 'archivada',
    timestamp_creacion: 1789000000000,
    created_by: 'Manual Corporativo',
  };
}

// ── Los cuatro casos, cada uno con el dia que representa ────────────────────
const CASOS = [
  {
    letra: 'A',
    nombre: 'A: nadie abrio la app, no hay una sola fila del manual',
    // Ojo: NO es un dia vacio. Hay trabajo suelto creado a mano; lo que falta
    // es la emision del manual. Un fixture vacio confundiria «no se emitio el
    // manual» con «no hubo nada», que son dos dias distintos.
    filas: [fila('1757000000001', 'viva'), fila('molde_x_2026', 'viva')],
  },
  {
    letra: 'B',
    nombre: 'B: se emitieron y se borraron (el caso del 14/sep)',
    filas: [fila('man_a_2026-9-14_canindo_ana', 'eliminada'),
            fila('man_b_2026-9-14_canindo_ana', 'eliminada'),
            fila('man_c_2026-9-14_canindo_luis', 'eliminada')],
  },
  {
    letra: 'C',
    nombre: 'C: existen y estan vivas, el cero es de la pantalla',
    filas: [fila('man_a_2026-9-14_canindo_ana', 'viva'),
            fila('man_b_2026-9-14_canindo_ana', 'eliminada')],
  },
  {
    letra: 'D',
    nombre: 'D: se trabajaron y se entregaron, el cero es correcto',
    filas: [fila('man_a_2026-9-14_canindo_ana', 'enviada'),
            fila('man_b_2026-9-14_canindo_luis', 'enviada')],
  },
];

console.log('\n=== CADA CASO DA SU LETRA ===');
const letras = [];
for (const c of CASOS) {
  const letra = veredicto(cubetas(c.filas));
  letras.push(letra);
  afirmar(c.nombre, letra, c.letra);
}

console.log('\n=== EL REPARTO EN CUBETAS ===');
const mezcla = cubetas([
  fila('man_1_x', 'viva'),
  fila('man_2_x', 'enviada'),
  fila('man_3_x', 'eliminada'),
  fila('man_4_x', 'archivada'),
  fila('1757000000009', 'viva'),          // no es del manual
  fila('man_5_x', 'viva', 'Persona Y'),   // segunda persona
]);
afirmar('cuenta el total', mezcla.total, 6);
afirmar('separa las del manual por el prefijo man_', mezcla.manual, 5);
afirmar('y las que no lo son', mezcla.otras, 1);
afirmar('vivas', mezcla.vivas, 3);
afirmar('enviadas', mezcla.enviadas, 1);
afirmar('eliminadas', mezcla.eliminadas, 1);
afirmar('archivadas', mezcla.archivadas, 1);
afirmar('personas distintas', mezcla.personas.size, 2);

// Una fila enviada Y eliminada tiene que caer en ELIMINADA, que es el orden que
// aplica el poll de checklist.ts. Si se invirtiera, «vivas» dejaria de
// significar lo que la pantalla pinta y los dos numeros no serian comparables.
const doble = { ...fila('man_9_x', 'eliminada'), enviado: true };
const c9 = cubetas([doble]);
afirmar('enviada Y eliminada cuenta como eliminada (el orden del poll)',
  [c9.eliminadas, c9.enviadas], [1, 0]);

// ── LA GUARDIA ─────────────────────────────────────────────────────────────
console.log('\n=== GUARDIA DE DISCRIMINACION ===');
const distintas = new Set(letras);
if (distintas.size !== CASOS.length) {
  fallos++;
  console.log('  FALLA  los %d casos produjeron %d letra(s) distinta(s): %s',
    CASOS.length, distintas.size, [...distintas].join(', '));
  console.log('         Un veredicto que no distingue no es un diagnostico.');
} else {
  console.log('  ok     %d casos -> %d letras distintas (%s)',
    CASOS.length, distintas.size, letras.join(' '));
}

console.log('');
if (fallos) {
  console.log('[prueba-emision] %d FALLA(S).', fallos);
  process.exit(2);
}
console.log('[prueba-emision] %d afirmaciones en verde, mas la guardia.', corridas);
process.exit(0);
