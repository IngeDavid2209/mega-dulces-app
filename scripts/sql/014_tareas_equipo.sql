-- Migración a Postgres: `tareas_equipo` (Etapa 7 FERROCARRIL). Proyectos
-- colaborativos en fases. El grueso de escrituras re-escribe el blob `fases`.
create table if not exists mdtask_tareas_equipo (
  id                 text primary key,
  name               text,
  store              text,
  jefe_equipo        text,
  cerrado            boolean default false,
  timestamp_creacion bigint,
  datos              jsonb   -- objetivo, date, createdBy, integrantes[], fases[], cerradoEn, _tipo
);
create index if not exists idx_mdtask_tareas_equipo_store on mdtask_tareas_equipo (store);
