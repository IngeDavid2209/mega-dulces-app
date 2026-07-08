// CRUD de `catalogo_rutinas` sobre Postgres (Etapa 4 FERROCARRIL).
const { crearCrud } = require('./_crud');

module.exports = crearCrud({
  tabla: 'mdtask_catalogo_rutinas',
  map: {
    nombre: 'nombre', tipo: 'tipo', frecuencia: 'frecuencia',
    activa: 'activa', creadoPor: 'creado_por', creadoEn: 'creado_en',
  },
  boolCols: ['activa'],
  numCols: ['creado_en'],
  orderBy: 'nombre asc',
});
