// CRUD de `vehiculos` (Modulo Flotilla) sobre Postgres.
// Catalogo de coches de la empresa. Mismo patron que catalogo-rutinas.
//   GET    /api/vehiculos               -> { items } (todos, o ?sucursal=..)
//   GET    /api/vehiculos?id=..         -> { item }
//   POST   /api/vehiculos               -> upsert { id, nombre, sucursal, activo, ... }
//   PATCH  /api/vehiculos               -> merge parcial { id, ...campos }
//   DELETE /api/vehiculos?id=..         -> elimina
const { crearCrud } = require('./_crud');

module.exports = crearCrud({
  tabla: 'vehiculos',
  map: {
    nombre: 'nombre',
    sucursal: 'sucursal',
    activo: 'activo',
  },
  boolCols: ['activo'],
  orderBy: 'nombre asc',
  filtros: { sucursal: 'sucursal' },
});
