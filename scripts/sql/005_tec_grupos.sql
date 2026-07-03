-- Migración a Postgres: colección `tec_grupos` (Equipos / Proyectos del Espacio TEC).
-- Documento con arreglos anidados (miembros[], tareas[]) → se guarda completo en jsonb.
create table if not exists tec_grupos (
  id     text primary key,
  nombre text,
  datos  jsonb
);
