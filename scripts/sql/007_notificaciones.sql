-- Migración a Postgres: colección `notificaciones` (campana de alertas/zumbidos).
create table if not exists notificaciones (
  id        text primary key,
  empleado  text,
  de        text,
  mensaje   text,
  leido     boolean default false,
  timestamp bigint
);

create index if not exists idx_notificaciones_empleado_leido on notificaciones (empleado, leido);
