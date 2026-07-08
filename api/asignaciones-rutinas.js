// CRUD de `asignaciones_rutinas` sobre Postgres (Etapa 4 FERROCARRIL).
const { crearCrud } = require('./_crud');

module.exports = crearCrud({
  tabla: 'mdtask_asignaciones_rutinas',
  map: {
    catalogoRutinaId: 'catalogo_rutina_id', nombreRutina: 'nombre_rutina',
    modoAsignacion: 'modo_asignacion', activa: 'activa', creadoEn: 'creado_en',
  },
  boolCols: ['activa'],
  numCols: ['creado_en'],
  orderBy: 'creado_en desc',
});
