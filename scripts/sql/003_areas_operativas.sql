-- Migración a Postgres: colección `areas_operativas` (Panel de Áreas Operativas).
-- Doc de configuración (nombre, descripción, horarios, turno, recurrencia, etc.).
-- `datos` guarda el objeto completo (jsonb) para no perder ningún campo; `nombre`
-- se saca aparte para ordenar/buscar.
create table if not exists areas_operativas (
  id     text primary key,
  nombre text,
  datos  jsonb
);

create index if not exists idx_areas_operativas_nombre on areas_operativas (nombre);
