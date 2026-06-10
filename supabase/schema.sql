-- ============================================================================
-- Mega Dulces Task - Schema Postgres para Supabase
-- ============================================================================
-- Mapeo de las 9 colecciones de Firestore a tablas Postgres relacionales.
-- Diseno: preservamos el documento JSON original en una columna "raw" (jsonb)
-- para no perder campos no normalizados, y exponemos los campos mas usados como
-- columnas tipadas para queries eficientes con indices.
--
-- Reglas de seguridad (RLS) se definen aparte en rls.sql.
-- ============================================================================

-- Extensiones utiles
create extension if not exists "pgcrypto";    -- gen_random_uuid()
create extension if not exists "pg_trgm";     -- busqueda fuzzy de texto

-- ============================================================================
-- 1. USUARIOS
-- ============================================================================
-- Origen: collection 'usuarios' en Firestore.
-- Auth: integraremos con Supabase Auth, pero mantenemos doc propio porque
-- contiene rol, sucursales, areas y flags de permisos especificos del negocio.
create table if not exists usuarios (
  id              uuid primary key default gen_random_uuid(),
  uid_firebase    text unique,                            -- uid original de Firebase Auth
  uid_supabase    uuid unique references auth.users(id),  -- uid de Supabase Auth (post-migracion)
  usuario         text unique not null,                    -- login (ej. 'tania.sanchez')
  nombre          text not null,
  correo          text,
  password        text,                                    -- legacy: en plano de Firestore, no usar en Supabase
  cargo           text,
  rol             text not null check (rol in ('admin','trabajador')),
  alcance         text check (alcance in ('global','sucursales')),
  sucursales      text[] default '{}',
  areas           text[] default '{}',
  telefono        text,
  -- Permisos de gestion (flags booleanos)
  puede_crear_checklists       boolean default false,
  puede_crear_rutinas          boolean default false,
  puede_crear_tareas_unicas    boolean default false,
  puede_ver_checkstore         boolean default false,
  puede_ver_estadisticas       boolean default false,
  puede_ver_historial          boolean default false,
  puede_administrar_personal   boolean default false,
  puede_ver_calendario         boolean default false,
  puede_administrar_areas      boolean default false,
  -- Tracking
  ultimo_latido    bigint,                                 -- timestamp ms para "en linea"
  ultima_edicion   bigint,
  fcm_tokens       text[] default '{}',
  -- Raw del doc original (por compatibilidad con campos no normalizados)
  raw              jsonb,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index if not exists idx_usuarios_rol on usuarios(rol);
create index if not exists idx_usuarios_alcance on usuarios(alcance);
create index if not exists idx_usuarios_sucursales on usuarios using gin(sucursales);
create index if not exists idx_usuarios_nombre_trgm on usuarios using gin(nombre gin_trgm_ops);

-- ============================================================================
-- 2. CHECKLISTS
-- ============================================================================
-- Origen: collection 'checklists'. Cada checklist es 1 tarea/dia/persona.
-- El array `items` (subtareas/lineas con foto) se guarda como jsonb para no
-- perder estructura. Si se necesita query por item, se puede normalizar despues.
create table if not exists checklists (
  id              uuid primary key default gen_random_uuid(),
  doc_id_firebase text unique,                             -- id original del doc en Firestore
  name            text not null,
  assigned        text not null,                            -- nombre del responsable
  store           text not null,                            -- sucursal/area
  fecha           date not null,                            -- 'date' en Firestore (YYYY-MM-DD)
  hora_limite     text,                                     -- 'time' (HH:mm)
  status          text default 'pendiente',
  enviado         boolean default false,
  eliminado       boolean default false,
  archivado       boolean default false,
  archivado_mes   text,                                     -- 'YYYY-MM'
  archivado_en    timestamptz,
  archivado_por   text,
  fotos_borradas  boolean default false,
  fotos_borradas_en      timestamptz,
  fotos_borradas_count   integer,
  -- Comentario del colaborador / entrega con retraso
  nota_empleado          text,
  entrega_con_retraso    boolean default false,
  motivo_categoria       text,
  motivo_comentario      text,
  -- Quien lo creo
  created_by             text,
  timestamp_creacion     bigint,
  -- Orden de mantenimiento (sub-objeto, opcional)
  mantenimiento          jsonb,
  -- Subtareas (fases anidadas)
  subtareas              jsonb default '[]',
  -- Items: tareas individuales con foto, antes/despues, palomeo, etc.
  items                  jsonb default '[]',
  -- Raw completo (compatibilidad)
  raw                    jsonb,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);
create index if not exists idx_checklists_fecha on checklists(fecha);
create index if not exists idx_checklists_store on checklists(store);
create index if not exists idx_checklists_assigned on checklists(assigned);
create index if not exists idx_checklists_enviado on checklists(enviado);
create index if not exists idx_checklists_archivado on checklists(archivado);
create index if not exists idx_checklists_eliminado on checklists(eliminado);
create index if not exists idx_checklists_fecha_store on checklists(fecha, store);  -- query mas comun
create index if not exists idx_checklists_assigned_fecha on checklists(assigned, fecha);

-- ============================================================================
-- 3. AREAS_OPERATIVAS
-- ============================================================================
-- Origen: collections 'areas' y 'areas_operativas' (hay 2 en el codigo).
-- Definen los catalogos de areas (Cajas, Pasillos, Precios, Bodega, etc.).
create table if not exists areas (
  id              uuid primary key default gen_random_uuid(),
  doc_id_firebase text unique,
  nombre          text not null unique,
  descripcion     text,
  activa          boolean default true,
  bloqueada       boolean default false,
  fecha_bloqueo   date,
  raw             jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================================
-- 4. CATALOGO_RUTINAS
-- ============================================================================
-- Origen: collection 'catalogo_rutinas' (Robot V2).
-- Plantillas de rutinas reutilizables que despues se asignan a personas/sucursales.
create table if not exists rutinas_catalogo (
  id              uuid primary key default gen_random_uuid(),
  doc_id_firebase text unique,
  nombre          text not null,
  descripcion     text,
  items           jsonb default '[]',          -- lista de tareas
  evidencia       text,                         -- 'ninguna' | 'foto' | 'antesDespues' | 'variasFotos'
  tiempo_estimado integer,
  activa          boolean default true,
  raw             jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_rutinas_catalogo_activa on rutinas_catalogo(activa);

-- ============================================================================
-- 5. ASIGNACIONES_RUTINAS
-- ============================================================================
-- Origen: collection 'asignaciones_rutinas' (Robot V2).
-- Conecta rutinas del catalogo con personas/sucursales y reglas de frecuencia.
create table if not exists asignaciones_rutinas (
  id              uuid primary key default gen_random_uuid(),
  doc_id_firebase text unique,
  rutina_id       text,                        -- ref al catalogo (id firebase)
  rutina_nombre   text,
  modo_asignacion text,                        -- 'persona' | 'rol' | 'todas'
  asignados       text[] default '{}',         -- nombres de personas asignadas
  store           text,                        -- sucursal donde aplica
  area            text,
  frecuencia      text,                        -- 'Diaria' | 'Semanal' | etc.
  dia_semana      text,
  dia_mes         integer,
  fecha_inicio    date,
  fecha_fin       date,
  hora_inicio     text,
  hora_limite     text,
  activa          boolean default true,
  raw             jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_asignaciones_activa on asignaciones_rutinas(activa);
create index if not exists idx_asignaciones_store on asignaciones_rutinas(store);

-- ============================================================================
-- 6. MOLDES_CHECKLISTS (V1 - legacy, mantener por compatibilidad)
-- ============================================================================
-- Origen: collection 'moldes_checklists'. Robot V1 los expande a checklists
-- diarios. Se conserva mientras V1 conviva con V2.
create table if not exists moldes_checklists (
  id              uuid primary key default gen_random_uuid(),
  doc_id_firebase text unique,
  name            text not null,
  assigned        text not null,
  store           text,
  frecuencia      text,
  dia_semana      text,
  dia_mes         integer,
  fecha_inicio    date,
  fecha_fin       date,
  hora_inicio     text,
  hora_limite     text,
  items           jsonb default '[]',
  activo          boolean default true,
  raw             jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================================
-- 7. TAREAS_EQUIPO
-- ============================================================================
-- Origen: collection 'tareas_equipo'. Proyectos colaborativos con fases.
create table if not exists tareas_equipo (
  id                  uuid primary key default gen_random_uuid(),
  doc_id_firebase     text unique,
  titulo              text not null,
  descripcion         text,
  jefe_equipo         text,
  integrantes         text[] default '{}',
  store               text,
  fecha_inicio        date,
  fecha_fin           date,
  cerrado             boolean default false,
  fases               jsonb default '[]',
  raw                 jsonb,
  timestamp_creacion  bigint,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
create index if not exists idx_tareas_equipo_jefe on tareas_equipo(jefe_equipo);
create index if not exists idx_tareas_equipo_cerrado on tareas_equipo(cerrado);

-- ============================================================================
-- 8. NOTIFICACIONES
-- ============================================================================
-- Origen: collection 'notificaciones'.
create table if not exists notificaciones (
  id              uuid primary key default gen_random_uuid(),
  doc_id_firebase text unique,
  empleado        text not null,                  -- destinatario (nombre)
  remitente       text,
  titulo          text,
  mensaje         text,
  leido           boolean default false,
  fecha_creacion  timestamptz default now(),
  raw             jsonb
);
create index if not exists idx_notificaciones_empleado_leido
  on notificaciones(empleado, leido);

-- ============================================================================
-- 9. DESCANSOS_SEMANALES
-- ============================================================================
-- Origen: collection 'descansos_semanales'. Define que dia descansa cada
-- empleado en una semana ISO especifica.
create table if not exists descansos_semanales (
  id              uuid primary key default gen_random_uuid(),
  doc_id_firebase text unique,
  empleado        text not null,
  semana_iso      text not null,                  -- '2026-W23'
  dia_descanso    text,                            -- 'Lunes' | 'Martes' | ...
  raw             jsonb,
  created_at      timestamptz default now(),
  unique (empleado, semana_iso)
);

-- ============================================================================
-- Trigger generico: actualizar updated_at en cada UPDATE
-- ============================================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  for t in select unnest(array['usuarios','checklists','areas','rutinas_catalogo',
                                'asignaciones_rutinas','moldes_checklists',
                                'tareas_equipo'])
  loop
    execute format('drop trigger if exists trg_updated_%I on %I; '
                  'create trigger trg_updated_%I before update on %I '
                  'for each row execute function set_updated_at();', t, t, t, t);
  end loop;
end $$;

-- ============================================================================
-- Realtime: habilitar para tablas que el front consume con tiempo real
-- ============================================================================
-- Se ejecuta despues de crear las tablas. Asi Supabase emite eventos via WS.
alter publication supabase_realtime add table usuarios;
alter publication supabase_realtime add table checklists;
alter publication supabase_realtime add table areas;
alter publication supabase_realtime add table rutinas_catalogo;
alter publication supabase_realtime add table asignaciones_rutinas;
alter publication supabase_realtime add table moldes_checklists;
alter publication supabase_realtime add table tareas_equipo;
alter publication supabase_realtime add table notificaciones;
alter publication supabase_realtime add table descansos_semanales;
