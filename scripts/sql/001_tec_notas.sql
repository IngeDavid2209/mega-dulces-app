-- Fase 1 de la migración a Postgres: tabla de notas/ideas del Espacio TEC.
-- Reemplaza a la colección Firestore `tec_notas`.
-- Forma original: { titulo, texto, autor, autorUid, creadoEn, actualizadoEn }.
create table if not exists tec_notas (
  id             text primary key,
  titulo         text not null default '',
  texto          text not null default '',
  autor          text,
  autor_uid      text,
  creado_en      bigint,
  actualizado_en bigint
);

create index if not exists idx_tec_notas_creado_en on tec_notas (creado_en desc);
