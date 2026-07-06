-- Migración a Postgres: colección `usuarios` (empleados/admins) + subcolección `agenda`.
-- OJO: este Postgres está COMPARTIDO con otras apps (ya existen tablas `usuarios`,
-- `pagos`, etc. de otros servicios). Por eso las tablas de MDTask llevan prefijo
-- `mdtask_` para NO colisionar. El login sigue en Firebase Auth; aquí solo viven
-- los DATOS del perfil. Patrón del proyecto: columnas buscables + `datos` jsonb.
create table if not exists mdtask_usuarios (
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
  datos          jsonb                      -- sucursales[], areas[], permisos puede*, grupoTec, fotoPerfil, ultimoLatido, password espejo...
);

create index if not exists idx_mdtask_usuarios_usuario on mdtask_usuarios (lower(usuario));
create index if not exists idx_mdtask_usuarios_correo  on mdtask_usuarios (lower(correo));
create index if not exists idx_mdtask_usuarios_rol      on mdtask_usuarios (rol);

-- Tareas personales (antes subcolección usuarios/{uid}/agenda en Firestore).
create table if not exists mdtask_agenda (
  id             text primary key,          -- id de la tarea
  uid            text not null,             -- dueño (mdtask_usuarios.id)
  texto          text not null default '',
  completada     boolean default false,
  fecha          text default '',           -- 'YYYY-MM-DD' o '' (igual que Firestore)
  prioridad      text default '',
  fecha_creacion bigint,
  completada_en  bigint,
  datos          jsonb                      -- fechaInicio, horaInicio, fechaFin, horaFin, instrucciones, comentarios, adjunto, frecuencia, asignadaPor, creadaPorVoz...
);

create index if not exists idx_mdtask_agenda_uid       on mdtask_agenda (uid);
create index if not exists idx_mdtask_agenda_uid_fecha on mdtask_agenda (uid, fecha);
