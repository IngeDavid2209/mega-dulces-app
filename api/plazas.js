// ============================================================================
//  CRUD de `mdtask_plazas` — la posición, no la persona
//
//  «Anaquelista · Padre Hidalgo · 2». La plaza es permanente; el titular rota
//  vía `mdtask_coberturas` (§4 del CLAUDE.md, invariante §5.1).
//
//  ─── LAS PLAZAS NO SE CREAN A MANO ────────────────────────────────────────
//  Se derivan de la PLANTILLA autorizada (`planDePlazas` en cobertura.util.ts).
//  Este endpoint las escribe, pero quien decide cuántas hay es la plantilla:
//  crear una plaza suelta que la plantilla no autoriza dejaría una posición que
//  nadie aprobó y que aun así recibiría obligaciones.
//
//  ─── NI SE BORRAN ─────────────────────────────────────────────────────────
//  Retirar una plaza es `vigente = false` (§5.5). Sus coberturas pasadas y los
//  checklists que se le emitieron tienen que seguir teniendo a qué apuntar: una
//  plaza borrada convierte su historia en filas huérfanas.
// ============================================================================
const { crearCrud } = require('./_crud');
const { guardia, puedeDefinirEstructura, sucursalDeLaFila } = require('./_autorizar');

module.exports = crearCrud({
  tabla: 'mdtask_plazas',
  map: {
    puestoId: 'puesto_id',
    lugar: 'lugar',
    numero: 'numero',
    unidad: 'unidad',
    ambito: 'ambito',
    turno: 'turno',
    vigente: 'vigente',
    creadaEn: 'creada_en',
  },
  boolCols: ['vigente'],
  numCols: ['numero', 'creada_en'],
  // `GET /api/plazas?lugar=Canindo`. Sin el filtro, la pantalla de una
  // Encargada tendría que bajarse las plazas de toda la empresa.
  filtros: { lugar: 'lugar', puestoId: 'puesto_id' },
  orderBy: 'lugar asc, puesto_id asc, numero asc nulls last',

  // ── QUIEN ESCRIBE (19/sep) ────────────────────────────────────────────────
  //
  // Misma regla que la plantilla, y tiene que ser la misma: las plazas SE
  // DERIVAN de ella (`planDePlazas`). Si aqui se pidiera menos, la puerta de
  // atras dejaria crear plazas que ninguna plantilla autorizo — justo lo que la
  // cabecera de este archivo dice que no puede pasar.
  //
  // El lugar sale de `lugar`, no de `sucursal`: son la misma cosa con otro
  // nombre en esta tabla, y pasarle el campo equivocado autorizaria contra una
  // sucursal vacia (o sea, solo Direccion escribiria).
  autorizar: guardia({
    etiqueta: 'plazas',
    permite: puedeDefinirEstructura,
    sucursalDe: ({ cuerpo, req }) => sucursalDeLaFila({
      tabla: 'mdtask_plazas', columna: 'lugar', campo: 'lugar', cuerpo, req,
    }),
  }),
});
