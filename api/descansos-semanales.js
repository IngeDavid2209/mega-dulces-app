// CRUD de `descansos_semanales` sobre Postgres (Etapa 6 FERROCARRIL).
const { crearCrud } = require('./_crud');

module.exports = crearCrud({
  tabla: 'mdtask_descansos_semanales',
  map: {
    userId: 'user_id', userNombre: 'user_nombre',
    semanaISO: 'semana_iso', actualizadoEn: 'actualizado_en',
  },
  numCols: ['actualizado_en'],
  orderBy: 'semana_iso desc',
  filtros: { semanaISO: 'semana_iso', userId: 'user_id' },
});
