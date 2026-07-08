// CRUD de `config` (turnos, recomendaciones) sobre Postgres (Etapa 9 FERROCARRIL).
// Se lee por id: GET /api/config?id=turnos -> { item: { ...datos, id } }.
const { crearCrud } = require('./_crud');

module.exports = crearCrud({
  tabla: 'mdtask_config',
  map: {},          // todo el documento vive en `datos`
  orderBy: 'id asc',
});
