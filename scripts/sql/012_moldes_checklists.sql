-- Migración a Postgres: `moldes_checklists` (Etapa 5 FERROCARRIL). Moldes de
-- rutinas legacy (Robot V1). Prefijo mdtask_ (Postgres compartido).
create table if not exists mdtask_moldes_checklists (
  id                 text primary key,
  name               text,
  assigned           text,
  store              text,
  frecuencia         text,
  timestamp_creacion bigint,
  created_by         text,
  datos              jsonb   -- diaSemana, diaMes, items[], _migradoA{rutinaId,asignacionId,migradoEn}, _pausadoPorMigracion
);
create index if not exists idx_mdtask_moldes_name     on mdtask_moldes_checklists (name);
create index if not exists idx_mdtask_moldes_assigned on mdtask_moldes_checklists (assigned);
