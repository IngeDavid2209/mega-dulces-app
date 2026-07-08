-- Migración a Postgres: colección `usuarios_tokens` (Etapa 10 FERROCARRIL).
-- Tokens FCM de cada dispositivo. El ENVÍO de push sigue siendo FCM (transporte);
-- aquí solo se mueve el DATO (los tokens) fuera de Firestore.
create table if not exists mdtask_usuarios_tokens (
  id       text primary key,   -- uid || nombre (igual que en Firestore)
  uid      text,
  usuario  text,
  token    text,
  datos    jsonb               -- actualizado, userAgent
);
create index if not exists idx_mdtask_tokens_uid on mdtask_usuarios_tokens (uid);
