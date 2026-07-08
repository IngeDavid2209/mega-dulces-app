// CRUD de `usuarios_tokens` sobre Postgres (Etapa 10 FERROCARRIL).
// Lo usa el frontend para registrar el token FCM (POST upsert por id).
// Los endpoints de push (notificar/notify-update) leen la tabla directo con db.
const { crearCrud } = require('./_crud');

module.exports = crearCrud({
  tabla: 'mdtask_usuarios_tokens',
  map: { uid: 'uid', usuario: 'usuario', token: 'token' },
  orderBy: 'id asc',
  filtros: { uid: 'uid' },
});
