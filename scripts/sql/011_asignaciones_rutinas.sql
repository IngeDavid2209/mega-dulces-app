-- Migración a Postgres: `asignaciones_rutinas` (Etapa 4 FERROCARRIL). Asigna una
-- rutina maestra a sucursales/personas con frecuencia y vigencia (Robot V2).
create table if not exists mdtask_asignaciones_rutinas (
  id                 text primary key,
  catalogo_rutina_id text,        -- FK -> mdtask_catalogo_rutinas
  nombre_rutina      text,        -- denormalizado
  modo_asignacion    text,        -- porRol|porPersonas
  activa             boolean default true,
  creado_en          bigint,
  datos              jsonb        -- sucursales[], rolObjetivo, empleadosNombres[], frecuencia, diaSemana, diaMes, horaInicio, horaLimite, fechaInicio, fechaFin, excepciones[], reasignacionAuto, ordenReemplazo[], creadoPor, actualizadoPor, actualizadoEn
);
create index if not exists idx_mdtask_asig_activa   on mdtask_asignaciones_rutinas (activa);
create index if not exists idx_mdtask_asig_catalogo on mdtask_asignaciones_rutinas (catalogo_rutina_id);
