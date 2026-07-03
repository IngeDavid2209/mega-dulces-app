-- Migración a Postgres: colección `tec_tareas` (tablero Kanban del Espacio TEC).
-- Tarjeta con columna/orden/subtareas → se guarda completa en jsonb.
create table if not exists tec_tareas (
  id    text primary key,
  datos jsonb
);
