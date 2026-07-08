-- Migración a Postgres: `rutinas_personales` (Etapa 8 FERROCARRIL). Tareas
-- recurrentes personales del empleado. `uid` es la única query server-side.
create table if not exists mdtask_rutinas_personales (
  id         text primary key,
  uid        text,
  nombre     text,
  frecuencia text,       -- Diaria|Semanal|Mensual|Anual
  activa     boolean default true,
  creado_en  bigint,
  datos      jsonb       -- texto, hora, horaInicio, sucursal, diaSemana, diaMes, fechaAnual, actividades[], permiteFotos, origenTec, createdBy
);
create index if not exists idx_mdtask_rutinas_pers_uid on mdtask_rutinas_personales (uid);
