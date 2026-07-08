-- Migración a Postgres: `catalogo_rutinas` (Etapa 4 FERROCARRIL). Catálogo de
-- rutinas maestras (Robot V2). Prefijo mdtask_ (Postgres compartido).
create table if not exists mdtask_catalogo_rutinas (
  id           text primary key,
  nombre       text,
  tipo         text,        -- apertura|cierre|administracion|contabilidad|operacion
  frecuencia   text,        -- Diaria|Semanal|Catorcenal|Mensual|Trimestral|PorEvento
  activa       boolean default true,
  creado_por   text,
  creado_en    bigint,
  datos        jsonb        -- descripcion, diaSemana, diaMes, horaInicio, horaLimite, responsableSugerido, nivelCritico, tareas[], actualizadoPor, actualizadoEn
);
create index if not exists idx_mdtask_catalogo_activa on mdtask_catalogo_rutinas (activa);
