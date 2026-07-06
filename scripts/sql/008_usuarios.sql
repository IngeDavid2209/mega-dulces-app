-- Migración a Postgres: colección `usuarios` (empleados/admins) + su subcolección `agenda`.
-- Sigue el patrón del proyecto: columnas para lo buscable + `datos` jsonb para el resto
-- (arrays sucursales/areas, permisos puede*, grupoTec, fotoPerfil, ultimoLatido, password espejo, etc.).
-- El login sigue en Firebase Auth; aquí solo viven los DATOS del perfil.
create table if not exists usuarios (
  id             text primary key,          -- uid de Firebase Auth
  usuario        text,                      -- nombre de usuario (login por nombre)
  correo         text,                      -- correo (coincide con Firebase Auth)
  nombre         text,
  rol            text,                      -- 'admin' | 'trabajador'
  telefono       text,                      -- para identificar en el bot de WhatsApp
  alcance        text,                      -- 'global' | 'sucursales'
  cargo          text,
  activo         boolean default true,
  creado_en      bigint,
  actualizado_en bigint,
  datos          jsonb                      -- todo lo demás del documento Firestore
);

create index if not exists idx_usuarios_usuario on usuarios (lower(usuario));
create index if not exists idx_usuarios_correo  on usuarios (lower(correo));
create index if not exists idx_usuarios_rol      on usuarios (rol);

-- Tareas personales (antes subcolección usuarios/{uid}/agenda).
create table if not exists usuarios_agenda (
  id             text primary key,          -- id de la tarea
  uid            text not null,             -- dueño (usuarios.id)
  texto          text not null default '',
  completada     boolean default false,
  fecha          text default '',           -- 'YYYY-MM-DD' o '' (igual que Firestore)
  prioridad      text default '',
  fecha_creacion bigint,
  completada_en  bigint,
  datos          jsonb                      -- fechaInicio, horaInicio, fechaFin, horaFin, instrucciones, comentarios, adjunto, frecuencia, asignadaPor, creadaPorVoz, etc.
);

create index if not exists idx_usuarios_agenda_uid       on usuarios_agenda (uid);
create index if not exists idx_usuarios_agenda_uid_fecha on usuarios_agenda (uid, fecha);
