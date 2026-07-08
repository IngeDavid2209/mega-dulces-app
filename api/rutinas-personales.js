// CRUD de `rutinas_personales` sobre Postgres (Etapa 8 FERROCARRIL).
const { crearCrud } = require('./_crud');

module.exports = crearCrud({
  tabla: 'mdtask_rutinas_personales',
  map: {
    uid: 'uid', nombre: 'nombre', frecuencia: 'frecuencia',
    activa: 'activa', creadoEn: 'creado_en',
  },
  boolCols: ['activa'],
  numCols: ['creado_en'],
  orderBy: 'creado_en desc',
  filtros: { uid: 'uid' },
});
