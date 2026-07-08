// CRUD de `moldes_checklists` sobre Postgres (Etapa 5 FERROCARRIL).
const { crearCrud } = require('./_crud');

module.exports = crearCrud({
  tabla: 'mdtask_moldes_checklists',
  map: {
    name: 'name', assigned: 'assigned', store: 'store', frecuencia: 'frecuencia',
    timestampCreacion: 'timestamp_creacion', createdBy: 'created_by',
  },
  numCols: ['timestamp_creacion'],
  orderBy: 'name asc',
});
