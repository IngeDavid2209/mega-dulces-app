// ============================================================================
//  CRUD de `mdtask_coberturas` — quién ocupa cada plaza, y desde cuándo
//
//  Es la pieza que el §4 llama identidad: «la identidad sale de la cobertura,
//  no del nombre escrito». El día que el acceso sea por plaza, ESTA tabla es la
//  que pone un nombre y un apellido detrás de cada fotografía.
//
//  ─── CERRAR NO ES BORRAR ──────────────────────────────────────────────────
//  Una cobertura que termina se cierra poniéndole `hasta`, nunca borrándola
//  (§5.5). Si se borrara, la evidencia de los días que esa persona sí cubrió se
//  quedaría sin a quién atribuirse, y el sistema perdería —hacia atrás— la
//  respuesta a «¿quién estaba ese día?».
//
//  ─── UN HUECO ES UNA FILA ─────────────────────────────────────────────────
//  `tipo = 'hueco'` con `uid` nulo. No es la ausencia de filas: el invariante
//  §5.2 exige que «nadie la cubre hoy» y «nadie ha pasado lista» sean cosas
//  distintas y distinguibles.
// ============================================================================
const { crearCrud } = require('./_crud');
const { guardiaCoberturas } = require('./_autorizar');

module.exports = crearCrud({
  tabla: 'mdtask_coberturas',
  map: {
    plazaId: 'plaza_id',
    uid: 'uid',
    tipo: 'tipo',
    desde: 'desde',
    hasta: 'hasta',
    motivo: 'motivo',
    creadaEn: 'creada_en',
  },
  numCols: ['creada_en'],
  filtros: { plazaId: 'plaza_id', uid: 'uid' },
  // Las más recientes primero: es el orden en que se leen cuando se busca
  // «quién cubre esto ahora».
  orderBy: 'desde desc, id asc',

  // ── QUIEN ESCRIBE (20/sep) ────────────────────────────────────────────────
  //
  // Es la unica tabla con DOS caminos legitimos, y por eso quedo fuera del
  // cierre del 19/sep hasta poder medirlos:
  //
  //   1. el PASE DE LISTA — una Encargada, que NO es admin. La regla es la de
  //      `pase-lista.ts:132`, con la sucursal resuelta bajando plaza -> lugar.
  //   2. el LOGIN POR PLAZA — `login.ts:361` escribe una suplencia CON EL TOKEN
  //      DE PLAZA cuando la persona declara quien es al entrar. Se permite solo
  //      «hoy, en MI plaza, como suplente»: cada condicion tapa un abuso
  //      concreto, y el detalle esta en `guardiaCoberturas`.
  //
  // Quien cubre una plaza decide a quien se le atribuye la evidencia de ese dia
  // (§4: la identidad sale de la cobertura, no del nombre escrito). Dejarlo
  // abierto era dejar que cualquier token reescribiera esa atribucion.
  autorizar: guardiaCoberturas(),
});
