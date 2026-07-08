// CRUD de `tareas_equipo` sobre Postgres (Etapa 7 FERROCARRIL).
const { crearCrud } = require('./_crud');

module.exports = crearCrud({
  tabla: 'mdtask_tareas_equipo',
  map: {
    name: 'name', store: 'store', jefeEquipo: 'jefe_equipo',
    cerrado: 'cerrado', timestampCreacion: 'timestamp_creacion',
  },
  boolCols: ['cerrado'],
  numCols: ['timestamp_creacion'],
  orderBy: 'timestamp_creacion desc',
});
