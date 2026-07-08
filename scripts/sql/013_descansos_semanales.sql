-- Migración a Postgres: `descansos_semanales` (Etapa 6 FERROCARRIL). Días de
-- descanso por empleado y semana ISO. `semana_iso` es la única query server-side.
create table if not exists mdtask_descansos_semanales (
  id             text primary key,   -- idDescanso(userId, semanaISO)
  user_id        text,
  user_nombre    text,
  semana_iso     text,               -- 'YYYY-Www'
  actualizado_en bigint,
  datos          jsonb               -- dias[], actualizadoPor
);
create index if not exists idx_mdtask_descansos_semana      on mdtask_descansos_semanales (semana_iso);
create index if not exists idx_mdtask_descansos_user_semana on mdtask_descansos_semanales (user_id, semana_iso);
