-- Migración a Postgres: colección `tec_conversaciones` (mensajes del Espacio TEC).
-- Cada mensaje tiene un arreglo de respuestas (jsonb).
create table if not exists tec_conversaciones (
  id         text primary key,
  texto      text not null default '',
  autor      text,
  autor_uid  text,
  creado_en  bigint,
  editado_en bigint,
  respuestas jsonb not null default '[]'::jsonb
);

create index if not exists idx_tec_conversaciones_creado_en on tec_conversaciones (creado_en desc);
