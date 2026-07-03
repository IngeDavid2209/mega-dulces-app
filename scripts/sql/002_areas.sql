-- Migración a Postgres: colección `areas` (áreas dinámicas, solo lectura hoy;
-- la consume Checkstore para mostrar tarjetas de áreas).
-- `datos` guarda el documento completo por si hay más campos que agregar luego.
create table if not exists areas (
  id     text primary key,
  nombre text,
  datos  jsonb
);
