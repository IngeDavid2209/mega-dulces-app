-- Migración a Postgres: colección `config` (Etapa 9 FERROCARRIL). Docículos de
-- configuración (turnos, recomendaciones). Se leen por id. Todo el documento va
-- en `datos` jsonb. Prefijo mdtask_ (Postgres compartido).
create table if not exists mdtask_config (
  id     text primary key,   -- 'turnos' | 'recomendaciones' | ...
  datos  jsonb
);
