// ============================================================================
//  CRUD de `mdtask_puestos_declarados` — los puestos «de temporada»
//
//  Puestos que Dirección declara y que NO están en `organigrama.catalogo.ts`.
//  Instrucción de David (13/sep/2026): «si el puesto no existe, poder agregar
//  uno que sea de Temporada».
//
//  ─── LOS CANDADOS NO ESTÁN AQUÍ, Y ESO ES A PROPÓSITO ─────────────────────
//  Los dos que de verdad protegen viven en la TABLA (migración 057), no en este
//  archivo:
//
//    · `check (id like 'tmp-%')`  — un puesto declarado no puede pisar el id de
//      uno publicado. En SQL, así que ninguna ruta de escritura lo puede saltar:
//      ni un script, ni una consulta a mano, ni un endpoint futuro.
//    · `hasta` NOT NULL — una temporada sin fecha de fin es un puesto
//      permanente con otro nombre.
//
//  Ponerlos en el handler los habría dejado a merced del siguiente camino que
//  alguien abra. El aviso de nombre parecido sí vive en el cliente
//  (`revisarDeclaracion`), porque AVISA en vez de bloquear: puede haber una
//  razón real para tener dos puestos parecidos, y esa decisión es de quien
//  captura, no del servidor.
//
//  ─── NO SE BORRAN ─────────────────────────────────────────────────────────
//  Una temporada que termina se marca `vigente = false`. Los checklists que se
//  le emitieron tienen que seguir teniendo a qué puesto apuntar (§2: los ids
//  publicados se conservan).
// ============================================================================
const { crearCrud } = require('./_crud');

module.exports = crearCrud({
  tabla: 'mdtask_puestos_declarados',
  map: {
    nombre: 'nombre',
    tipo: 'tipo',
    unidad: 'unidad',
    reportaA: 'reporta_a',
    desde: 'desde',
    hasta: 'hasta',
    vigente: 'vigente',
    creadoEn: 'creado_en',
    creadoPor: 'creado_por',
    motivo: 'motivo',
  },
  boolCols: ['vigente'],
  numCols: ['creado_en'],
  orderBy: 'nombre asc',
});
